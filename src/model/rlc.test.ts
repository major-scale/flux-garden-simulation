import { describe, it, expect } from 'vitest';
import reference from './rlc-reference.json';
import { RcClock } from './rc';
import {
  RLC_LIMITS, RLC_DEFAULT, RlcExperiment, regimeOf, stepCoefficients,
  integratedCurrent, integratedCurrentSquared, validateRlc, momentExp,
} from './rlc';

/**
 * The reference is NOT this code. Every expected value in rlc-reference.json comes from
 * a 60-decimal-digit matrix exponential (mpmath.expm) plus high-precision quadrature of
 * the resulting current, and was ADMITTED ONLY IF a 90-digit recomputation agreed. That
 * gate did real work: the stiff fixture was rejected on the first pass because the fast
 * mode decays over ~1e-15 s inside a 0.02 s interval and the quadrature stepped over the
 * boundary layer. It is admitted now because the reference resolves that layer, not
 * because the tolerance was widened.
 */

/**
 * Amendment A2 declared a mixed criterion with atol = 1e-12. Building the tests showed
 * that is TOO COARSE TO BE A TEST here: the stiff fixture's a22 is ~1e-23, so an
 * absolute slack of 1e-12 accepts literally any answer including the 0.0 that the
 * defective formulation returns. The tolerance is therefore TIGHTENED, not loosened —
 * every reference value in this suite is non-zero, so the comparison is RELATIVE, which
 * is strictly stronger. An absolute floor is reintroduced only for a quantity expected
 * to pass through zero, where it must be justified against the terms that formed it.
 */
const RTOL = 1e-9;
const near = (got: number, want: number, atol = 0) =>
  Math.abs(got - want) <= atol + RTOL * Math.abs(want);

/**
 * Per-fixture absolute floors, and BOTH kinds of tolerance coexist rather than one
 * replacing the other.
 *
 * `zero-crossing-a22` samples h just past the root of a22 = e^{−αh}(cos ω_d h −
 * α·sin(ω_d h)/ω_d), where the true value is −8.6e-12 formed by cancelling two O(1)
 * quantities. Relative accuracy is not achievable there and demanding it would be
 * demanding the impossible; the measured absolute error is 7e-17, i.e. machine epsilon
 * against those O(1) constituents, so 1e-15 is the justified floor.
 *
 * `stiff-astra` gets NO floor on purpose. Its a22 is ~1e-23 and is NOT the difference of
 * larger terms — it is computed directly — so a floor of 1e-15 there would accept the
 * 0.0 that the defective formulation returns, which is the exact failure this suite exists
 * to catch.
 */
const COEFF_ATOL: Record<string, number> = { 'zero-crossing-a22': 1e-15 };

type Fixture = typeof reference[keyof typeof reference];
const fixtures = Object.entries(reference) as Array<[string, Fixture]>;

describe('RLC-1 kernel against an independent high-precision reference', () => {
  for (const [name, f] of fixtures) {
    it(`${name}: all four coefficients of e^{Ah}`, () => {
      const k = stepCoefficients(f.R, f.L, f.C, f.h);
      const at = COEFF_ATOL[name] ?? 0;
      expect(near(k.a11, f.a11, at), `a11 ${k.a11} vs ${f.a11}`).toBe(true);
      expect(near(k.a12, f.a12, at), `a12 ${k.a12} vs ${f.a12}`).toBe(true);
      expect(near(k.a21, f.a21, at), `a21 ${k.a21} vs ${f.a21}`).toBe(true);
      expect(near(k.a22, f.a22, at), `a22 ${k.a22} vs ${f.a22}`).toBe(true);
    });

    it(`${name}: one interval of state`, () => {
      const k = stepCoefficients(f.R, f.L, f.C, f.h);
      const u1 = k.a11 * f.u0 + k.a12 * f.i0;
      const i1 = k.a21 * f.u0 + k.a22 * f.i0;
      expect(near(u1, f.u1), `u1 ${u1} vs ${f.u1}`).toBe(true);
      expect(near(i1, f.i1), `i1 ${i1} vs ${f.i1}`).toBe(true);
    });

    it(`${name}: integral of i and of i squared`, () => {
      const q1 = integratedCurrent(f.u0, f.i0, f.R, f.L, f.C, f.h);
      const q2 = integratedCurrentSquared(f.u0, f.i0, f.R, f.L, f.C, f.h);
      expect(near(q1, f.integral_i), `∫i ${q1} vs ${f.integral_i}`).toBe(true);
      expect(near(q2, f.integral_i2), `∫i² ${q2} vs ${f.integral_i2}`).toBe(true);
    });
  }
});

describe('THE FIXTURE THAT KILLED THE PREVIOUS FORMULATION', () => {
  /**
   * Astra's counterexample. Revision 3 evaluated the diagonal as EC − α·ES, which
   * subtracts two nearly equal numbers when α ≈ β: it returns 0 and loses the answer
   * entirely. This is the specific defect the eigenmode form exists to prevent.
   */
  const f = reference['stiff-astra'];
  it('a22 survives α ≈ β instead of cancelling to zero', () => {
    const k = stepCoefficients(f.R, f.L, f.C, f.h);
    expect(k.a22).not.toBe(0);
    expect(near(k.a22, f.a22)).toBe(true);
    // the failing form, kept as an executable record of what was wrong
    const alpha = f.R / (2 * f.L), w02 = 1 / (f.L * f.C);
    const beta = Math.sqrt(alpha * alpha - w02), q = alpha + beta, p = w02 / q;
    const EC = (Math.exp(-p * f.h) + Math.exp(-q * f.h)) / 2;
    const ES = (Math.exp(-p * f.h) - Math.exp(-q * f.h)) / (2 * beta);
    expect(near(EC - alpha * ES, f.a22)).toBe(false);
  });

  it('a 1e-15 floor would ACCEPT the broken value here, which is why this fixture has none', () => {
    // Guards the tolerance itself: if anyone later applies the zero-crossing floor
    // globally, the defective a22 (0.0 against a true 1e-23) starts passing.
    expect(near(0, f.a22, 1e-15)).toBe(true);      // the floor would accept it…
    expect(near(0, f.a22, 0)).toBe(false);         // …and pure relative does not.
  });

  it('the naive slow root cancels to exactly zero, the stable one does not', () => {
    const alpha = f.R / (2 * f.L), w02 = 1 / (f.L * f.C);
    const beta = Math.sqrt(alpha * alpha - w02);
    expect(alpha - beta).toBe(0);                  // catastrophic cancellation
    expect(w02 / (alpha + beta)).toBeGreaterThan(0);
  });
});

describe('targeted mutations — each must be caught by a named check', () => {
  const f = reference['benign-underdamped'];
  const k = stepCoefficients(f.R, f.L, f.C, f.h);

  it('flipping the i0 coupling sign breaks the state', () => {
    const u1 = k.a11 * f.u0 - k.a12 * f.i0;
    expect(near(u1, f.u1)).toBe(false);
  });

  it('dropping the α·ES term from a11 breaks the state', () => {
    const alpha = f.R / (2 * f.L);
    const wd = Math.sqrt(1 / (f.L * f.C) - alpha * alpha);
    const e = Math.exp(-alpha * f.h);
    const mutated = e * Math.cos(wd * f.h);        // a11 without + α·s
    expect(near(mutated * f.u0 + k.a12 * f.i0, f.u1)).toBe(false);
  });

  it('the small-argument branch in the current integral is load-bearing', () => {
    const g = reference['near-equilibrium'];
    const alpha = g.R / (2 * g.L), w02 = 1 / (g.L * g.C);
    const wd = Math.sqrt(w02 - alpha * alpha);
    const e = Math.exp(-alpha * g.h), sn = Math.sin(wd * g.h);
    // Θ built by direct subtraction instead of expm1 + versine
    const theta = 1 - e * Math.cos(wd * g.h);
    const Jc = (alpha * theta + e * wd * sn) / w02;
    const Js = (wd * theta - alpha * e * sn) / w02;
    const K = -g.u0 / g.L - alpha * g.i0;
    const naive = g.i0 * Jc + K * (Js / wd);
    const good = integratedCurrent(g.u0, g.i0, g.R, g.L, g.C, g.h);
    expect(near(good, g.integral_i)).toBe(true);
    expect(Math.abs(naive - g.integral_i)).toBeGreaterThan(Math.abs(good - g.integral_i));
  });
});

describe('regimes and the domain', () => {
  it('classifies by a RELATIVE discriminant threshold', () => {
    expect(regimeOf(2, 1, 0.01)).toBe('underdamped');
    expect(regimeOf(20, 1, 0.01)).toBe('critical');       // R_crit = 2√(L/C) = 20
    expect(regimeOf(400, 1, 0.01)).toBe('overdamped');
  });

  it('refuses inputs outside the declared domain, and says so', () => {
    const ok = { ...RLC_DEFAULT };
    expect(() => validateRlc(ok)).not.toThrow();
    expect(() => validateRlc({ ...ok, inductance: RLC_LIMITS.minL / 10 })).toThrow(/refused/);
    expect(() => validateRlc({ ...ok, inductance: RLC_LIMITS.maxL * 10 })).toThrow(/refused/);
    expect(() => validateRlc({ ...ok, initialCurrent: RLC_LIMITS.maxI * 2 })).toThrow(/refused/);
    expect(() => validateRlc({ ...ok, resistance: 0 })).toThrow(/refused/);
  });

  it('refuses an interval outside the declared range', () => {
    expect(() => new RlcExperiment(RLC_DEFAULT, RLC_LIMITS.maxH * 2)).toThrow(/interval/);
    expect(() => new RlcExperiment(RLC_DEFAULT, 0)).toThrow(/interval/);
  });
});

describe('energy accounting closes with heat computed INDEPENDENTLY', () => {
  for (const [label, R] of [['underdamped', 2], ['critical', 20], ['overdamped', 400]] as const) {
    it(`${label}: source work = stored + heat`, () => {
      const x = new RlcExperiment({ ...RLC_DEFAULT, resistance: R }, 0.02);
      for (let n = 0; n < 400; n++) x.step();
      expect(x.faulted).toBeNull();
      const scale = Math.max(Math.abs(x.sourceWork), x.storedCapacitor, x.jouleHeat, 1e-30);
      expect(Math.abs(x.residual) / scale).toBeLessThan(1e-12);
    });
  }

  it('with the source off, the DECREASE in stored energy equals the heat', () => {
    // Corrected from an earlier draft that wrongly claimed conservation: with R ≥ 1 Ω
    // the energy is dissipated, not conserved.
    const x = new RlcExperiment({ ...RLC_DEFAULT, initialVoltage: 8 }, 0.02);
    x.connected = false;
    const before = x.storedCapacitor + x.storedInductor;
    for (let n = 0; n < 400; n++) x.step();
    const after = x.storedCapacitor + x.storedInductor;
    expect(before - after).toBeGreaterThan(0);
    expect(Math.abs((before - after) - x.jouleHeat) / before).toBeLessThan(1e-12);
  });
});

describe('behaviour that only exists because of L', () => {
  it('an underdamped run overshoots above the source, then settles AT the source', () => {
    const x = new RlcExperiment({ ...RLC_DEFAULT, resistance: 2 }, 0.005);
    let peak = -Infinity;
    for (let n = 0; n < 400; n++) { x.step(); peak = Math.max(peak, x.voltage); }
    expect(peak).toBeGreaterThan(RLC_DEFAULT.voltage);      // the overshoot
    for (let n = 0; n < 20000; n++) x.step();
    expect(x.voltage).toBeCloseTo(RLC_DEFAULT.voltage, 9);  // the settled value
    expect(x.current).toBeCloseTo(0, 9);
  });

  it('an overdamped run never exceeds the source', () => {
    const x = new RlcExperiment({ ...RLC_DEFAULT, resistance: 400 }, 0.005);
    let peak = -Infinity;
    for (let n = 0; n < 4000; n++) { x.step(); peak = Math.max(peak, x.voltage); }
    expect(peak).toBeLessThanOrEqual(RLC_DEFAULT.voltage);
  });

  it('current is continuous across a source switch — it cannot jump', () => {
    const x = new RlcExperiment({ ...RLC_DEFAULT, resistance: 2 }, 0.005);
    for (let n = 0; n < 60; n++) x.step();
    const i = x.current, v = x.voltage;
    expect(Math.abs(i)).toBeGreaterThan(0);
    x.connected = false;                       // source substituted, loop stays closed
    expect(x.current).toBe(i);
    expect(x.voltage).toBe(v);
  });

  it('changing R live preserves state and ledgers', () => {
    const x = new RlcExperiment({ ...RLC_DEFAULT, resistance: 2 }, 0.005);
    for (let n = 0; n < 60; n++) x.step();
    const snap = { v: x.voltage, i: x.current, w: x.sourceWork, q: x.jouleHeat };
    x.setResistance(50);
    expect(x.voltage).toBe(snap.v); expect(x.current).toBe(snap.i);
    expect(x.sourceWork).toBe(snap.w); expect(x.jouleHeat).toBe(snap.q);
    expect(x.regime).toBe('overdamped');
  });

  it('refuses an out-of-domain live R and leaves state and ledgers untouched', () => {
    const x = new RlcExperiment({ ...RLC_DEFAULT, resistance: 2 }, 0.005);
    for (let n = 0; n < 60; n++) x.step();
    const snap = { r: x.resistance, v: x.voltage, i: x.current, w: x.sourceWork, q: x.jouleHeat };
    for (const bad of [NaN, -1, 0, RLC_LIMITS.maxR * 10]) {
      expect(() => x.setResistance(bad)).toThrow(/refused/);
      expect(x.resistance).toBe(snap.r);
      expect(x.voltage).toBe(snap.v); expect(x.current).toBe(snap.i);
      expect(x.sourceWork).toBe(snap.w); expect(x.jouleHeat).toBe(snap.q);
    }
  });
});

describe("Astra's four kernel defects — each reproduced, then fixed", () => {
  it('F1: heat is never negative near critical at a long interval', () => {
    // R just under critical with h = 1 s: the old series was chosen on b·h alone while
    // a·h ≈ 20, and its truncation went negative — R·∫i² came out as −9333 J.
    const R = 20 * (1 - 1e-10), L = 1, C = 0.01, h = 1;
    const q = integratedCurrentSquared(-10, 0, R, L, C, h);
    expect(q).toBeGreaterThan(0);
    expect(R * q).toBeGreaterThan(0);
    const x = new RlcExperiment({ ...RLC_DEFAULT, resistance: R }, h);
    x.step();
    expect(x.faulted).toBeNull();
    expect(x.jouleHeat).toBeGreaterThan(0);
    expect(Math.abs(x.residual)).toBeLessThan(1e-9);
  });

  it('F1b: negative heat would latch the run rather than commit', () => {
    const x = new RlcExperiment(RLC_DEFAULT, 0.02);
    x.step();
    expect(x.faulted).toBeNull();
    expect(x.jouleHeat).toBeGreaterThanOrEqual(0);
  });

  it('F2: residual is zero at tick 0 with BOTH electric and magnetic initial energy', () => {
    const x = new RlcExperiment({ ...RLC_DEFAULT, initialVoltage: 5, initialCurrent: 1 }, 0.02);
    expect(x.storedCapacitor + x.storedInductor).toBeCloseTo(0.625, 12);
    expect(x.residual).toBe(0);                     // was −1.25 J before anything happened
    for (let n = 0; n < 200; n++) x.step();
    x.connected = false;                            // and it survives a switch
    for (let n = 0; n < 200; n++) x.step();
    const scale = Math.max(Math.abs(x.sourceWork), 0.625, x.jouleHeat);
    expect(Math.abs(x.residual) / scale).toBeLessThan(1e-12);
  });

  it('F3: the critical branch is accurate at a tiny interval', () => {
    // (1 − e^{−αh}(1+αh))/α² subtracts nearly equal quantities as αh → 0; it returned
    // 1.11e-17 against a true 5.0e-18 — more than a factor of two.
    const got = integratedCurrent(-10, 0, 20, 1, 0.01, 1e-9);
    const want = 4.999999966666667e-18;
    expect(Math.abs(got / want - 1)).toBeLessThan(1e-9);
  });
});

describe('momentExp — the foundation both integrals are built on', () => {
  /** ∫₀ʰ tⁿe^{−at}dt at 50 digits (mpmath quadrature), spanning small and large a·h. */
  const MOMENTS: Array<[number, number, number, number]> = [
    [0, 4.0, 0.02, 0.019220913403341054], [0, 4.0, 1e-09, 9.99999998e-10],
    [0, 1000000.0, 0.02, 1e-06], [0, 0.001, 1.0, 0.9995001666250083],
    [1, 4.0, 0.02, 0.00018964661890208466], [1, 4.0, 1e-09, 4.999999986666667e-19],
    [1, 1000000.0, 0.02, 1e-12], [1, 0.001, 1.0, 0.49966679163334027],
    [2, 4.0, 0.02, 2.511674812378749e-06], [2, 4.0, 1e-09, 3.333333323333334e-28],
    [2, 1000000.0, 0.02, 2e-18], [2, 0.001, 1.0, 0.3330834333055615],
    [3, 4.0, 0.02, 3.752341651078979e-08], [3, 4.0, 1e-09, 2.499999992000001e-37],
    [3, 1000000.0, 0.02, 6e-24], [3, 0.001, 1.0, 0.24980008330952902],
    [4, 4.0, 0.02, 5.98762655324356e-10], [4, 4.0, 1e-09, 1.999999993333334e-46],
    [4, 1000000.0, 0.02, 2.4e-29], [4, 0.001, 1.0, 0.19983340474107605],
  ];

  it('matches the high-precision moments across six decades of a·h', () => {
    for (const [n, a, h, want] of MOMENTS) {
      const got = momentExp(n, a, h);
      expect(near(got, want), `M${n}(a=${a},h=${h}): ${got} vs ${want}`).toBe(true);
    }
  });

  it('is strictly positive everywhere — a negative moment is what produced negative heat', () => {
    for (const a of [1e-3, 1, 4, 100, 1e6, 1e9]) {
      for (const h of [1e-9, 1e-6, 0.02, 1, 20]) {
        for (let n = 0; n <= 4; n++) expect(momentExp(n, a, h)).toBeGreaterThan(0);
      }
    }
  });
});

describe("Astra's second round — two more in-domain failures", () => {
  it('F5: the exponential difference in a12/a21 must not be formed by subtraction', () => {
    // R=64, L=1000, C=1, h=1e-9: both exponentials are ~1 (1−2.7e-11 and 1−3.7e-11), so
    // (ep − eq) loses six digits. Naive gave 9.9999808794762e-10, relative error 1.9e-6.
    const k = stepCoefficients(64, 1000, 1, 1e-9);
    expect(near(k.a11, 1.0)).toBe(true);
    expect(near(k.a12, 9.99999999968e-10)).toBe(true);
    expect(near(k.a21, -9.99999999968e-13)).toBe(true);
    expect(near(k.a22, 0.999999999936)).toBe(true);
    // the failing form, kept executable
    const alpha = 64 / 2000, w02 = 1 / 1000, beta = Math.sqrt(alpha * alpha - w02);
    const q = alpha + beta, p = w02 / q, dn = q - p;
    const naive = (Math.exp(-p * 1e-9) - Math.exp(-q * 1e-9)) / (dn * 1);
    expect(near(naive, 9.99999999968e-10)).toBe(false);
  });

  it('F6: momentExp branches on n as well as a·h', () => {
    // The closed form's cancellation scales with n. momentExp(14, 0.5, 1) returned
    // 0.634 for an integral that cannot exceed 1/15 = 0.0667.
    const cases: Array<[number, number, number, number]> = [
      [14, 0.5, 1.0, 0.04173720794459772],
      [14, 2.0, 1.0, 0.010299293564286442],
      [8, 0.5, 1.0, 0.07092171097749335],
      [14, 20.0, 1.0, 2.3814820057705523e-09],
      [6, 1.0, 1.0, 0.059933627487376635],
    ];
    for (const [n, a, h, want] of cases) {
      const got = momentExp(n, a, h);
      expect(near(got, want), `M${n}(a=${a},h=${h}): ${got} vs ${want}`).toBe(true);
      expect(got).toBeLessThanOrEqual(h ** (n + 1) / (n + 1));   // ∫₀ʰtⁿe^{−at}dt ≤ ∫₀ʰtⁿdt
    }
  });

  it('F6b: no moment exceeds its zero-damping upper bound, for any n and a·h', () => {
    for (let n = 0; n <= 16; n++) {
      for (const a of [1e-3, 0.5, 1, 2, 20, 1e3, 1e6]) {
        for (const h of [1e-9, 1e-3, 1, 20]) {
          const m = momentExp(n, a, h);
          expect(m).toBeGreaterThan(0);
          expect(m).toBeLessThanOrEqual(h ** (n + 1) / (n + 1) * (1 + 1e-12));
        }
      }
    }
  });
});

describe('settling time is regime-aware', () => {
  it('decayTime: envelope when underdamped, slow root tending to RC when overdamped', () => {
  const u = new RlcExperiment({ ...RLC_DEFAULT, resistance: 2 }, 0.02);
  expect(u.decayTime).toBeCloseTo(2 * 1 / 2, 12);                 // 2L/R
  const o = new RlcExperiment({ ...RLC_DEFAULT, resistance: 1e5 }, 0.02);
  const rc = 1e5 * RLC_DEFAULT.capacitance;
  expect(Math.abs(o.decayTime / rc - 1)).toBeLessThan(1e-3);      // → R·C
  expect(o.decayTime).toBeGreaterThan(2 * RLC_DEFAULT.inductance / 1e5);  // ≫ envelope figure
});
});

describe('PLAYBACK INDEPENDENCE — the GUI must not be able to change the physics', () => {
  /**
   * The requirement, in Peter's words: pause, slow motion and frame rate must not change
   * electrical behaviour, reset reactive state, skip evolution, or invent dynamics across a
   * switching event. That is testable rather than promisable: drive two identical
   * experiments to the SAME SIMULATED TIME by completely different wall-clock routes and
   * demand bit-identical state.
   */
  const build = () => {
    const x = new RlcExperiment({ ...RLC_DEFAULT, resistance: 2 }, 1e-3);
    const c = new RcClock<RlcExperiment>(x);
    c.paused = false; c.maxStepsPerFrame = 100000;
    return { x, c };
  };

  it('same simulated time by different wall-clock routes gives identical state', () => {
    const a = build(), b = build();
    a.c.playback = 1;      for (let n = 0; n < 600; n++) a.c.advance(1 / 60);   // 10 s at 60 fps
    b.c.playback = 0.25;   for (let n = 0; n < 480; n++) b.c.advance(1 / 12);   // 10 s, 12 fps, quarter speed
    expect(b.x.tick).toBe(a.x.tick);
    expect(b.x.voltage).toBe(a.x.voltage);
    expect(b.x.current).toBe(a.x.current);
    expect(b.x.sourceWork).toBe(a.x.sourceWork);
    expect(b.x.jouleHeat).toBe(a.x.jouleHeat);
  });

  it('pausing and resuming changes nothing but the wall clock', () => {
    const a = build(), b = build();
    a.c.playback = 1; b.c.playback = 1;
    for (let n = 0; n < 300; n++) a.c.advance(1 / 60);
    for (let n = 0; n < 150; n++) b.c.advance(1 / 60);
    b.c.paused = true;
    for (let n = 0; n < 999; n++) b.c.advance(1 / 60);          // a long pause changes nothing
    b.c.paused = false;
    for (let n = 0; n < 150; n++) b.c.advance(1 / 60);
    expect(b.x.tick).toBe(a.x.tick);
    expect(b.x.voltage).toBe(a.x.voltage);
    expect(b.x.current).toBe(a.x.current);
  });

  it('a switch at the same SIMULATED instant gives identical trajectories at different playback', () => {
    const a = build(), b = build();
    const switchAtTick = 3000;
    a.c.playback = 1;
    while (a.x.tick < switchAtTick) a.c.advance(1 / 60);
    a.x.connected = false;
    while (a.x.tick < 8000) a.c.advance(1 / 60);
    b.c.playback = 0.1;                                          // ten times slower on the wall
    while (b.x.tick < switchAtTick) b.c.advance(1 / 30);
    b.x.connected = false;
    while (b.x.tick < 8000) b.c.advance(1 / 30);
    expect(b.x.tick).toBe(a.x.tick);
    expect(b.x.voltage).toBe(a.x.voltage);
    expect(b.x.current).toBe(a.x.current);
    expect(b.x.jouleHeat).toBe(a.x.jouleHeat);
  });

  it('a switch at a DIFFERENT simulated instant does change the trajectory', () => {
    // Non-vacuity: the three assertions above would pass trivially if the switch were
    // being ignored. It is not.
    const a = build(), b = build();
    a.c.playback = 1; b.c.playback = 1;
    while (a.x.tick < 3000) a.c.advance(1 / 60);
    a.x.connected = false;
    while (a.x.tick < 8000) a.c.advance(1 / 60);
    while (b.x.tick < 3500) b.c.advance(1 / 60);
    b.x.connected = false;
    while (b.x.tick < 8000) b.c.advance(1 / 60);
    expect(b.x.tick).toBe(a.x.tick);
    expect(b.x.voltage).not.toBe(a.x.voltage);
  });
});

describe('display bounds are a real bound, not headroom', () => {
  it('the error energy never grows, so |Vc−Vs| and |i| stay inside the stated bounds', () => {
    for (const R of [1, 2, 20, 400, 1e6]) {
      const x = new RlcExperiment({ ...RLC_DEFAULT, resistance: R }, 0.002);
      const b = x.bounds();
      for (let n = 0; n < 3000; n++) {
        x.step();
        expect(Math.abs(x.voltage)).toBeLessThanOrEqual(b.voltage * (1 + 1e-9) + 1e-12);
        expect(Math.abs(x.current)).toBeLessThanOrEqual(b.current * (1 + 1e-9) + 1e-12);
      }
    }
  });
});

describe('L → 0 approaches RC, but only where the comparison is legitimate', () => {
  /**
   * L → 0 is a SINGULAR limit: at t=0 there is a fast layer in which the inductor
   * current rushes to the RC value. Comparing at an arbitrary initial current would be
   * meaningless, so the comparison starts from the CONSISTENT current i = (Vs−Vc)/R and
   * is made at a fixed positive time well after the layer.
   */
  it('matches the analytic RC solution at a fixed time, from a consistent start', () => {
    const Vs = 10, R = 100, C = 0.01, L = 1e-6;   // layer ~ L/R = 1e-8 s, τ = RC = 1 s
    const h = 1e-3, steps = 500;                   // t = 0.5 s, vastly beyond the layer
    const x = new RlcExperiment(
      { voltage: Vs, resistance: R, capacitance: C, inductance: L,
        initialVoltage: 0, initialCurrent: Vs / R }, h);
    for (let n = 0; n < steps; n++) x.step();
    const t = h * steps;
    const rc = Vs * (1 - Math.exp(-t / (R * C)));
    expect(Math.abs(x.voltage - rc)).toBeLessThan(1e-6);
  });
});
