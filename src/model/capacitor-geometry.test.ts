/**
 * GC1 — geometry to capacitance, and the SIMULATED-INTERVAL contract.
 *
 * Reference values are computed from the textbook formula here, not taken from the
 * implementation. The domain checks matter as much as the arithmetic: this is a
 * MODEL approximation with an explicit boundary, and outside it we REFUSE.
 */
import { describe, it, expect } from 'vitest';
import {
  EPSILON_0, GEOMETRY_LIMITS, MAX_GAP_TO_SIDE, VACUUM,
  capacitanceOf, gapToSide, interiorField, plateSide, validateGeometry,
  type Dielectric, type PlateGeometry,
} from './capacitor-geometry';
import { RC_DT, RC_LIMITS, RcClock, RcExperiment } from './rc';

const g = (over: Partial<PlateGeometry> = {}): PlateGeometry =>
  ({ area: 1e-2, gap: 1e-4, dielectric: VACUUM, ...over });

describe('C = eps0 eps_r A / d, against the formula rather than against itself', () => {
  it('matches a hand-computed vacuum case', () => {
    // 1 cm^2 plates, 1 mm gap, vacuum
    const c = capacitanceOf(g({ area: 1e-4, gap: 1e-3 }));
    expect(c).toBeCloseTo((EPSILON_0 * 1e-4) / 1e-3, 24);
    expect(c / 1e-12).toBeCloseTo(0.885, 2);          // ~0.885 pF
  });
  it('is linear in area and inverse in gap', () => {
    const base = capacitanceOf(g());
    expect(capacitanceOf(g({ area: 2e-2 }))).toBeCloseTo(2 * base, 20);
    expect(capacitanceOf(g({ gap: 2e-4 }))).toBeCloseTo(base / 2, 20);
  });
  it('scales with a named dielectric', () => {
    const mylarLike: Dielectric = { id: 'x', label: 'idealised film', relativePermittivity: 3.1, basis: 'nominal, fixed conditions' };
    expect(capacitanceOf(g({ dielectric: mylarLike }))).toBeCloseTo(3.1 * capacitanceOf(g()), 20);
  });
  it('plates are declared SQUARE, so side = sqrt(A) — area alone fixes no lateral pair', () => {
    expect(plateSide(1e-2)).toBeCloseTo(0.1, 12);
  });
});

describe('the DOMAIN is enforced by refusal, not by a warning', () => {
  const refused = (o: Partial<PlateGeometry>, re: RegExp) =>
    expect(() => capacitanceOf(g(o))).toThrow(re);

  it('REFUSES a gap that is not small compared with the plate side', () => {
    // 1 cm^2 -> side 0.01 m. A 5 mm gap is half the side: nowhere near uniform.
    refused({ area: 1e-4, gap: 5e-3 }, /gap-to-side ratio/);
  });
  it('accepts exactly at the declared ratio and refuses just beyond it', () => {
    const side = 0.1, area = side * side;             // 0.1 m square
    expect(() => capacitanceOf(g({ area, gap: side * MAX_GAP_TO_SIDE * 0.999 }))).not.toThrow();
    refused({ area, gap: side * MAX_GAP_TO_SIDE * 1.001 }, /gap-to-side ratio/);
  });
  it('says WHY, and says it is a supported-approximation boundary not an error bound', () => {
    let msg = '';
    try { capacitanceOf(g({ area: 1e-4, gap: 5e-3 })); } catch (e) { msg = String(e); }
    expect(msg).toMatch(/fringing/i);
    expect(msg).toMatch(/not an error bound/i);
  });
  it('refuses non-finite, out-of-range and sub-vacuum permittivity', () => {
    refused({ area: Number.NaN }, /finite/);
    refused({ area: GEOMETRY_LIMITS.maxArea * 10 }, /outside the declared range/);
    refused({ gap: GEOMETRY_LIMITS.minGap / 10 }, /outside the declared range/);
    expect(() => validateGeometry(g({ dielectric: { ...VACUUM, relativePermittivity: 0.5 } })))
      .toThrow(/below 1/);
  });
  it('NON-VACUITY: an in-domain geometry passes, so the refusals discriminate', () => {
    expect(() => capacitanceOf(g())).not.toThrow();
    expect(gapToSide(g())).toBeLessThan(MAX_GAP_TO_SIDE);
  });
});

describe('the interior field is a LOCAL model, and honest about zero', () => {
  it('E = V/d inside the declared approximation', () => {
    expect(interiorField(10, g({ gap: 1e-4 }))).toBeCloseTo(1e5, 6);
  });
  it('zero volts is EXACTLY zero field, not a small one', () => {
    expect(interiorField(0, g())).toBe(0);
  });
  it('sign follows the voltage', () => {
    expect(interiorField(-5, g())).toBeLessThan(0);
  });
});

describe('SIMULATED INTERVAL is not playback speed — the correction that makes this work', () => {
  const rc = (dt: number) => new RcExperiment(
    { voltage: 10, resistance: 1e6, capacitance: 2.7e-9, initialVoltage: 0 }, dt);

  it('at 1/60 s a millisecond transient is finished inside ONE interval — the problem', () => {
    const tau = 1e6 * 2.7e-9;                          // 2.7 ms
    expect(tau).toBeLessThan(RC_DT / 5);               // far finer than the default tick
    const coarse = rc(RC_DT);
    coarse.step();
    expect(coarse.voltage / 10).toBeGreaterThan(0.99); // essentially fully charged in one step
  });

  it('a declared finer interval gives SEVERAL samples within one tau', () => {
    const tau = 1e6 * 2.7e-9;
    const e = rc(tau / 20);
    const within: number[] = [];
    for (let i = 0; i < 20; i++) { e.step(); within.push(e.voltage); }
    expect(within.length).toBe(20);
    expect(within[0] / 10).toBeLessThan(0.1);          // the rise is now resolved
    expect(within[19] / 10).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it('the finer interval is still ANALYTICALLY exact, not merely smaller', () => {
    const tau = 1e6 * 2.7e-9, h = tau / 20;
    const e = rc(h);
    for (let i = 0; i < 37; i++) e.step();
    expect(e.voltage).toBeCloseTo(10 * (1 - Math.exp(-(37 * h) / tau)), 12);
    expect(Math.abs(e.residual)).toBeLessThanOrEqual(e.tolerance);
  });

  it('simulatedSeconds reports SIMULATED time, never a scaled tick count', () => {
    const h = 1e-4, e = rc(h);
    for (let i = 0; i < 50; i++) e.step();
    expect(e.simulatedSeconds).toBeCloseTo(50 * h, 15);
  });

  it('IDENTICAL STATE at equal simulated time under DIFFERENT playback speeds', () => {
    const h = 1e-4;
    const run = (playback: number, wallSeconds: number) => {
      const e = rc(h);
      const c = new RcClock(e);
      c.paused = false; c.playback = playback; c.maxStepsPerFrame = 1e9;
      c.advance(wallSeconds);
      return e;
    };
    // 0.01 s of SIMULATED time, reached two different ways
    const slow = run(0.05, 0.2);
    const fast = run(0.2, 0.05);
    expect(slow.tick).toBe(fast.tick);
    expect(slow.voltage).toBe(fast.voltage);
    expect(slow.receiverHeat).toBe(fast.receiverHeat);
    expect(slow.simulatedSeconds).toBeCloseTo(0.01, 12);
  });

  it('RC-1 default behaviour is UNCHANGED — no silent reinterpretation', () => {
    const e = new RcExperiment({ voltage: 10, resistance: 100, capacitance: 0.01, initialVoltage: 0 });
    expect(e.dt).toBe(RC_DT);
    for (let i = 0; i < 60; i++) e.step();
    expect(e.voltage).toBeCloseTo(10 * (1 - Math.exp(-1)), 12);
    expect(e.simulatedSeconds).toBeCloseTo(1, 12);
  });
});

describe('the DECLARED DOMAIN EXTENSION — deliberate, not a quietly relaxed limit', () => {
  it('every input valid under the OLD domain is still valid', () => {
    for (const c of [1e-6, 1e-3, 0.01, 0.5, 1]) {
      expect(() => new RcExperiment({ voltage: 10, resistance: 100, capacitance: c, initialVoltage: 0 })).not.toThrow();
    }
    for (const r of [1, 100, 1e6]) {
      expect(() => new RcExperiment({ voltage: 10, resistance: r, capacitance: 0.01, initialVoltage: 0 })).not.toThrow();
    }
  });
  it('the extension reaches where REAL PLATE GEOMETRY actually lands', () => {
    // 1 cm^2 across 1 mm of vacuum, and 10 cm^2 across 10 um of an idealised film
    const tiny = capacitanceOf(g({ area: 1e-4, gap: 1e-3 }));
    expect(tiny).toBeGreaterThan(RC_LIMITS.minC);
    expect(() => new RcExperiment({ voltage: 10, resistance: 1e6, capacitance: tiny, initialVoltage: 0 })).not.toThrow();
  });
  it('it is still a BOUNDED domain — below the floor is refused, not merely small', () => {
    expect(() => new RcExperiment({ voltage: 10, resistance: 100, capacitance: RC_LIMITS.minC / 10, initialVoltage: 0 }))
      .toThrow(/RC refused/);
    expect(() => new RcExperiment({ voltage: 10, resistance: RC_LIMITS.maxR * 10, capacitance: 0.01, initialVoltage: 0 }))
      .toThrow(/RC refused/);
  });
  it('a megohm resistor with a nanofarad capacitor gives a millisecond tau, as intended', () => {
    const C = 2.7e-9, R = 1e6;
    const e = new RcExperiment({ voltage: 10, resistance: R, capacitance: C, initialVoltage: 0 }, (R * C) / 20);
    expect(R * C).toBeCloseTo(2.7e-3, 12);
    for (let i = 0; i < 20; i++) e.step();
    expect(e.voltage).toBeCloseTo(10 * (1 - Math.exp(-1)), 9);
    expect(Math.abs(e.residual)).toBeLessThanOrEqual(e.tolerance);
  });
});

describe('the CLOCK across the whole supported h domain — Astra`s blocker', () => {
  const tiny = () => new RcExperiment(
    { voltage: 10, resistance: 1, capacitance: 1e-13, initialVoltage: 0 }, (1 * 1e-13) / 20);

  it('ZERO elapsed time advances NOTHING and books NO dropped time, at the smallest h', () => {
    // The defect: an absolute 1e-12 s tolerance is 200x LARGER than h = 5e-15 s, so
    // advance(0) advanced five ticks and booked 1e-12 s of dropped time out of
    // nothing at all. The tolerance now scales with h.
    const e = tiny(); const c = new RcClock(e); c.paused = false;
    c.advance(0);
    expect(e.tick).toBe(0);
    expect(c.droppedSeconds).toBe(0);
  });

  it('sub-interval elapsed time advances nothing and is not silently lost', () => {
    const e = tiny(); const c = new RcClock(e); c.paused = false;
    c.playback = e.dt / 2;            // half an interval of simulated time per wall second
    c.advance(1);
    expect(e.tick).toBe(0);
  });

  it('many tiny frames accumulate correctly instead of being eaten by the tolerance', () => {
    // MY TEST WAS WRONG FIRST TIME, not the clock: `advance` caps accepted WALL time
    // at 0.25 s before playback scaling, which is the pre-existing catch-up bound.
    // A frame of 1 s therefore delivers a quarter of what I assumed. Staying under
    // the cap, each frame delivers exactly one interval.
    const e = tiny(); const c = new RcClock(e); c.paused = false;
    c.playback = e.dt / 0.2;          // one interval per 0.2 s wall frame
    for (let i = 0; i < 10; i++) c.advance(0.2);
    expect(e.tick).toBe(10);
    expect(c.droppedSeconds).toBe(0);
  });

  it('grouping equivalence AT THE SMALLEST h, within the declared catch-up bound', () => {
    const mk = () => { const e = tiny(); const c = new RcClock(e); c.paused = false;
      c.playback = e.dt / 0.2; c.maxStepsPerFrame = 1000; return { e, c }; };
    const a = mk(); for (let i = 0; i < 20; i++) a.c.advance(0.2);
    const b = mk(); for (let i = 0; i < 4; i++) b.c.advance(1.0);   // 1 s frames, capped at 0.25
    expect(a.e.tick).toBe(20);
    expect(b.e.tick).toBe(5);                                       // the cap bites, as designed
    expect(b.c.droppedSeconds).toBeGreaterThan(0);                  // and the excess is REPORTED
    // Equivalence holds where no frame exceeds the cap:
    const c1 = mk(); for (let i = 0; i < 8; i++) c1.c.advance(0.1);
    const c2 = mk(); for (let i = 0; i < 4; i++) c2.c.advance(0.2);
    expect(c1.e.tick).toBe(c2.e.tick);
    expect(c1.e.voltage).toBe(c2.e.voltage);
  });

  it('playback and the step cap REFUSE invalid settings before they can corrupt the clock', () => {
    const c = new RcClock(tiny());
    expect(() => { c.playback = -1; }).toThrow(/finite and not negative/);
    expect(() => { c.playback = Number.NaN; }).toThrow(/finite/);
    expect(() => { c.maxStepsPerFrame = 0; }).toThrow(/positive whole number/);
    expect(() => { c.maxStepsPerFrame = 2.5; }).toThrow(/positive whole number/);
    expect(c.playback).toBe(1);       // rejected settings did not take effect
  });
});

describe('tiny-energy fixtures need SCALE-RELATIVE checks, not absolute floors', () => {
  it('the absolute 1e-10 J residual floor is VACUOUS at picofarad scale — so check relatively', () => {
    const C = 1e-13, R = 1e6, V = 10;
    const e = new RcExperiment({ voltage: V, resistance: R, capacitance: C, initialVoltage: 0 }, (R * C) / 20);
    for (let i = 0; i < 400; i++) e.step();
    const scale = (C * V * V) / 2;                       // ~5e-12 J: the whole experiment
    expect(scale).toBeLessThan(1e-10);                   // the absolute floor exceeds EVERYTHING here
    // so assert against the SCALE, not against an absolute epsilon
    expect(Math.abs(e.residual) / scale).toBeLessThan(1e-9);
    expect(e.storedEnergy / scale).toBeCloseTo(1, 6);
    expect(e.receiverHeat / scale).toBeCloseTo(1, 6);    // half-energy, relatively
  });

  it('CONTROL: zero heat FAILS where nonzero is predicted — the check is not vacuous', () => {
    const C = 1e-13, R = 1e6, V = 10;
    const e = new RcExperiment({ voltage: V, resistance: R, capacitance: C, initialVoltage: 0 }, (R * C) / 20);
    for (let i = 0; i < 40; i++) e.step();
    const scale = (C * V * V) / 2;
    expect(e.receiverHeat).toBeGreaterThan(0);           // a zero-heat model would fail here
    expect(e.receiverHeat / scale).toBeGreaterThan(0.1);
    expect(e.sourceWork / scale).toBeGreaterThan(0.1);
  });
});
