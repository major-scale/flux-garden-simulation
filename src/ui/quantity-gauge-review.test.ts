/**
 * FABLE'S INDEPENDENT REVIEW of the shared quantity gauge.
 *
 * Written from the CONTRACT the gauge claims to honour, not from its code. The
 * property that matters most under LAYER-PRINCIPLE-v1 is the one about clamping:
 * a display may saturate, but it may NEVER let a saturated value be mistaken for
 * a full-scale one without saying so. Silent clamping is the forbidden thing;
 * labelled saturation is legitimate.
 */
import { describe, it, expect } from 'vitest';
import { gaugeReading, type QuantityGauge } from './quantity-gauge';

const g = (over: Partial<QuantityGauge> = {}): QuantityGauge => ({
  quantity: 'Stored energy', unit: 'J', value: 0.25, reference: 'against the display range',
  scale: { min: 0, max: 1, mapping: 'linear' }, ...over,
});

describe('the fill is the linear fraction, and only that', () => {
  it('maps min, midpoint and max to 0, 0.5 and 1', () => {
    expect(gaugeReading(g({ value: 0 })).fill).toBe(0);
    expect(gaugeReading(g({ value: 0.5 })).fill).toBe(0.5);
    expect(gaugeReading(g({ value: 1 })).fill).toBe(1);
  });
  it('is linear on an offset range too, not just 0..1', () => {
    const q = g({ value: 350, scale: { min: 300, max: 400, mapping: 'linear' } });
    expect(gaugeReading(q).fill).toBeCloseTo(0.5, 12);
  });
});

describe('SATURATION IS LABELLED, NEVER SILENT — the load-bearing property', () => {
  it('a value AT full scale and one FAR ABOVE it both fill completely, but say different things', () => {
    const atFull = gaugeReading(g({ value: 1 }));
    const over = gaugeReading(g({ value: 5 }));
    expect(atFull.fill).toBe(1);
    expect(over.fill).toBe(1);                      // the drawing saturates, which is allowed
    expect(over.text).not.toBe(atFull.text);        // but the READER is told
    expect(over.text).toMatch(/ABOVE DISPLAY SCALE/);
    expect(atFull.text).not.toMatch(/ABOVE DISPLAY SCALE/);
    // and the true value is still printed, not replaced by the clamped one
    expect(over.text).toMatch(/\b5\b/);
  });
  it('below-scale is labelled the same way and still prints the true value', () => {
    const under = gaugeReading(g({ value: -3 }));
    expect(under.fill).toBe(0);
    expect(under.text).toMatch(/BELOW DISPLAY SCALE/);
    expect(under.text).toMatch(/-3/);
  });
  it('NON-VACUITY: an in-range value carries no saturation wording at all', () => {
    expect(gaugeReading(g({ value: 0.25 })).text).not.toMatch(/DISPLAY SCALE/);
  });
});

describe('the reading states what it is, so a fill can never be read as a bare number', () => {
  it('carries quantity, unit and reference', () => {
    const r = gaugeReading(g({ quantity: 'Received heat', unit: 'J', reference: 'since tick 0' }));
    expect(r.text).toMatch(/Received heat/);
    expect(r.text).toMatch(/J/);
    expect(r.text).toMatch(/since tick 0/);
    expect(r.text).toMatch(/Display .*–.*J/);       // the range is shown, not implied
  });
  it('kelvin and joules can be separate gauges — J/K is NOT a fill capacity', () => {
    const heat = gaugeReading(g({ quantity: 'Received heat', unit: 'J', value: 4, scale: { min: 0, max: 10, mapping: 'linear' } }));
    const temp = gaugeReading(g({ quantity: 'Temperature', unit: 'K', value: 302, scale: { min: 300, max: 320, mapping: 'linear' } }));
    expect(heat.fill).toBeCloseTo(0.4, 12);
    expect(temp.fill).toBeCloseTo(0.1, 12);
    expect(heat.text).toMatch(/J/);
    expect(temp.text).toMatch(/K/);
  });
});

describe('it REFUSES rather than inventing a display', () => {
  const bad = (q: QuantityGauge) => expect(() => gaugeReading(q)).toThrow(/finite values and an increasing linear/);
  it('refuses a non-finite value or bound', () => {
    bad(g({ value: Number.NaN }));
    bad(g({ value: Number.POSITIVE_INFINITY }));
    bad(g({ scale: { min: 0, max: Number.NaN, mapping: 'linear' } }));
  });
  it('refuses an empty or inverted range instead of dividing by zero', () => {
    bad(g({ scale: { min: 1, max: 1, mapping: 'linear' } }));
    bad(g({ scale: { min: 2, max: 1, mapping: 'linear' } }));
  });
  it('refuses a mapping it does not implement, rather than silently treating it as linear', () => {
    bad(g({ scale: { min: 0, max: 1, mapping: 'log' as unknown as 'linear' } }));
  });
});

describe('the gauge never touches the model value', () => {
  it('leaves its input object unmodified', () => {
    const q = g({ value: 7, scale: { min: 0, max: 2, mapping: 'linear' } });
    const before = JSON.stringify(q);
    gaugeReading(q);
    expect(JSON.stringify(q)).toBe(before);
  });
});

describe('the display bound must not chase the value — GC1 regression', () => {
  /** The model's own expression, reproduced exactly: C * v**2 / 2. */
  const energy = (C: number, v: number) => (C * v ** 2) / 2;

  it('a value AT the authored bound is AT scale, not above it', () => {
    // The defect: the bound was derived from a span including the LIVE voltage, so
    // it met the value at full charge and the reading said ABOVE DISPLAY SCALE —
    // a false statement, since the value was exactly at scale.
    const C = 1e-3, Vs = 10;
    const bound = energy(C, Vs);
    const atFull = gaugeReading({ quantity: 'capacitor energy', unit: 'J',
      value: energy(C, Vs), reference: 'r', scale: { min: 0, max: bound, mapping: 'linear' } });
    expect(atFull.fill).toBe(1);
    expect(atFull.text).not.toMatch(/ABOVE DISPLAY SCALE/);
  });

  it('computing the same energy by a DIFFERENT ROUTE can tip the comparison — so do not', () => {
    // v*v and v**2 are the same in most cases but are not guaranteed identical for
    // every double. The point of the fix is that ONE expression is used for both.
    const C = 1e-3, v = 0.1 + 0.2;             // a deliberately awkward double
    expect(energy(C, v)).toBe((C * v ** 2) / 2);
  });

  it('CONTROL: a genuinely above-scale value is STILL labelled — the fix hides nothing', () => {
    const C = 1e-3, Vs = 10;
    const bound = energy(C, Vs);
    const over = gaugeReading({ quantity: 'received heat', unit: 'J',
      value: bound * 1.5, reference: 'r', scale: { min: 0, max: bound, mapping: 'linear' } });
    expect(over.fill).toBe(1);
    expect(over.text).toMatch(/ABOVE DISPLAY SCALE/);
  });

  it('CONTROL: a value one ULP above the bound is still reported as above', () => {
    // No epsilon was added to the gauge, precisely so real overflow survives —
    // which matters most at the tiny energies GC1 now reaches.
    const bound = 5e-12;                        // a picofarad-scale experiment
    // the next representable double above `bound`, without relying on Math.nextUp
    const nextUp = (x: number): number => {
      const buf = new DataView(new ArrayBuffer(8));
      buf.setFloat64(0, x);
      buf.setBigUint64(0, buf.getBigUint64(0) + 1n);
      return buf.getFloat64(0);
    };
    const justOver = gaugeReading({ quantity: 'capacitor energy', unit: 'J',
      value: nextUp(bound), reference: 'r', scale: { min: 0, max: bound, mapping: 'linear' } });
    expect(nextUp(bound)).toBeGreaterThan(bound);
    expect(justOver.text).toMatch(/ABOVE DISPLAY SCALE/);
  });
});
