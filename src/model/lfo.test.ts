/**
 * BATCH 5 — the sweep's two load-bearing promises:
 *   1. the value at a tick is a PURE FUNCTION of that tick, so replay is exact;
 *   2. a sweep outside the model range is REFUSED, never silently clamped.
 */
import { describe, it, expect } from 'vitest';
import {
  LFO_LIMITS, LFO_WAVEFORMS, lfoHz, lfoIsQuasiStatic, lfoPeriodSeconds,
  lfoPhaseAt, lfoShape, lfoValueAt, newLfoSpec, validateLfo,
  type LfoSpec, type LfoTarget,
} from './lfo';

const target = (over: Partial<LfoTarget> = {}): LfoTarget => ({
  key: 'resistance:R4', kind: 'resistance', id: 'R4', label: 'R1 — resistance',
  unit: 'Ω', current: 10, min: 1e-6, max: 1e9, ...over,
});
const spec = (over: Partial<LfoSpec> = {}): LfoSpec => ({
  ...newLfoSpec(), enabled: true, targetKey: 'resistance:R4',
  periodTicks: 240, lo: 2.5, hi: 40, startTick: 0, ...over,
});

describe('the sweep value is a pure function of the tick', () => {
  it('same tick always gives the same value, however often it is asked', () => {
    const s = spec();
    for (const t of [0, 1, 7, 119, 120, 239, 240, 1_000_003]) {
      const a = lfoValueAt(s, t);
      for (let i = 0; i < 5; i++) expect(lfoValueAt(s, t)).toBe(a);
    }
  });

  it('is exactly periodic, with NO accumulated phase drift over a million ticks', () => {
    const s = spec({ periodTicks: 240 });
    // If phase were accumulated in floating point per tick this would drift.
    for (const t of [0, 7, 61, 239]) {
      expect(lfoValueAt(s, t + 240 * 4167)).toBe(lfoValueAt(s, t));
      expect(lfoPhaseAt(s, t + 240 * 4167)).toBe(lfoPhaseAt(s, t));
    }
  });

  it('is total for ticks BEFORE the start tick — negative phase wraps, never NaN', () => {
    const s = spec({ startTick: 500 });
    for (const t of [0, 1, 499, 500, 501]) {
      const v = lfoValueAt(s, t);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(s.lo);
      expect(v).toBeLessThanOrEqual(s.hi);
    }
  });

  it('every waveform stays inside [lo, hi] and spans essentially all of it', () => {
    for (const w of LFO_WAVEFORMS) {
      const s = spec({ waveform: w.id, periodTicks: 360 });
      const vals: number[] = [];
      for (let t = 0; t < 360; t++) vals.push(lfoValueAt(s, t));
      expect(Math.min(...vals)).toBeGreaterThanOrEqual(s.lo);
      expect(Math.max(...vals)).toBeLessThanOrEqual(s.hi);
      // reaches both ends to within one sample step
      expect(Math.min(...vals)).toBeLessThan(s.lo + (s.hi - s.lo) * 0.02);
      expect(Math.max(...vals)).toBeGreaterThan(s.hi - (s.hi - s.lo) * 0.02);
    }
  });

  it('shape is unipolar [0,1] for every waveform across the cycle', () => {
    for (const w of LFO_WAVEFORMS) {
      for (let i = 0; i < 200; i++) {
        const y = lfoShape(w.id, i / 200);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('square really is two values and nothing between — zero can never read as "nearly"', () => {
    const s = spec({ waveform: 'square', periodTicks: 100 });
    const set = new Set(Array.from({ length: 100 }, (_, t) => lfoValueAt(s, t)));
    expect([...set].sort((a, b) => a - b)).toEqual([2.5, 40]);
  });

  it('Hz is DERIVED from the integer period, and the two agree', () => {
    const s = spec({ periodTicks: 240 });
    expect(lfoPeriodSeconds(s)).toBe(4);
    expect(lfoHz(s)).toBeCloseTo(0.25, 12);
    expect(lfoIsQuasiStatic(s)).toBe(true);
    expect(lfoIsQuasiStatic(spec({ periodTicks: 6 }))).toBe(false);
  });
});

describe('an out-of-range sweep is REFUSED, never clamped', () => {
  const expectRefusal = (s: LfoSpec, t: LfoTarget | null, match: RegExp): void => {
    let msg = '';
    try { validateLfo(s, t); } catch (e) { msg = String(e); }
    expect(msg).toMatch(/LFO refused/);
    expect(msg).toMatch(match);
  };

  it('refuses bounds outside the model range and says both the range and why', () => {
    expectRefusal(spec({ lo: -5 }), target(), /leaves the model range/);
    expectRefusal(spec({ hi: 2e9 }), target(), /leaves the model range/);
  });
  it('refuses lo >= hi', () => {
    expectRefusal(spec({ lo: 40, hi: 40 }), target(), /lo < hi/);
    expectRefusal(spec({ lo: 41, hi: 40 }), target(), /lo < hi/);
  });
  it('refuses a fractional period, because phase must be exact integer tick arithmetic', () => {
    expectRefusal(spec({ periodTicks: 240.5 }), target(), /whole number of public ticks/);
  });
  it('refuses a period outside the declared limits', () => {
    expectRefusal(spec({ periodTicks: LFO_LIMITS.minPeriodTicks - 1 }), target(), /below the minimum/);
    expectRefusal(spec({ periodTicks: LFO_LIMITS.maxPeriodTicks + 1 }), target(), /exceeds the maximum/);
  });
  it('refuses a non-finite bound and an absent target', () => {
    expectRefusal(spec({ hi: Number.POSITIVE_INFINITY }), target(), /finite/);
    expectRefusal(spec(), null, /no target selected/);
  });
  it('a DISABLED sweep validates trivially — nothing is being driven', () => {
    expect(() => validateLfo({ ...spec({ lo: -999 }), enabled: false }, null)).not.toThrow();
  });
  it('NON-VACUITY: a legitimate sweep passes, so the refusals above discriminate', () => {
    expect(() => validateLfo(spec(), target())).not.toThrow();
    expect(() => validateLfo(spec({ lo: -12, hi: 12 }), target({ kind: 'emf', unit: 'V', min: -1e6, max: 1e6 }))).not.toThrow();
  });
});
