/**
 * RC-1 — FABLE'S INDEPENDENT ACCEPTANCE CHECKS.
 *
 * Deliberately NOT derived from `rc.test.ts`. Every reference value here comes from
 * the closed-form RC solution or from a textbook result, computed in the assertion
 * rather than taken from the implementation. The point of an independent review is
 * to be wrong in different places than the thing being reviewed.
 *
 * Per LAYER-PRINCIPLE-v1: these are MODEL-layer checks and therefore blocking.
 * The experience verdict is reported separately and is not in this file.
 */
import { describe, it, expect } from 'vitest';
import { RcExperiment } from './rc';

const DT = 1 / 60;
const run = (e: RcExperiment, n: number): RcExperiment => { for (let i = 0; i < n; i++) e.step(); return e; };
const mk = (o: Partial<{ voltage: number; resistance: number; capacitance: number; initialVoltage: number }> = {}) =>
  new RcExperiment({ voltage: 12, resistance: 1000, capacitance: 1e-3, initialVoltage: 0, ...o });

describe('RC-1 charging matches the CLOSED FORM, not just itself', () => {
  it('Vc(t) equals Vs(1 - e^{-t/RC}) at every sampled tick', () => {
    const Vs = 12, R = 1000, C = 1e-3, e = mk();
    for (const n of [1, 7, 30, 60, 137, 300]) {
      const f = run(mk(), n);
      expect(f.voltage).toBeCloseTo(Vs * (1 - Math.exp(-(n * DT) / (R * C))), 12);
    }
    expect(run(e, 60).voltage).toBeCloseTo(Vs * (1 - Math.exp(-1)), 12);
  });
});

describe('the energy books close, and close on a THEOREM rather than on themselves', () => {
  it('THE HALF-ENERGY RESULT: charging from 0 dissipates exactly what it stores', () => {
    // Textbook: charging C through ANY R from 0 to Vs stores CVs^2/2 and dissipates
    // CVs^2/2, the source doing CVs^2. This is independent of R, so it cannot be
    // satisfied by an implementation that merely balances its own bookkeeping.
    const Vs = 12, C = 1e-3;
    const e = run(mk({ voltage: Vs, capacitance: C }), 60 * 20);
    expect(e.storedEnergy).toBeCloseTo((C * Vs * Vs) / 2, 9);
    expect(e.receiverHeat).toBeCloseTo((C * Vs * Vs) / 2, 9);
    expect(e.sourceWork).toBeCloseTo(C * Vs * Vs, 9);
    expect(Math.abs(e.residual)).toBeLessThanOrEqual(e.tolerance);
  });

  it('the half-energy result holds across four decades of R — it must not depend on R', () => {
    for (const R of [1, 100, 1e4, 1e6]) {
      const Vs = 5, C = 1e-4;
      const e = run(mk({ voltage: Vs, resistance: R, capacitance: C }), Math.ceil((25 * R * C) / DT));
      expect(Math.abs(e.receiverHeat - e.storedEnergy)).toBeLessThan(1e-9 * Math.max(1, e.storedEnergy));
      expect(Math.abs(e.residual)).toBeLessThanOrEqual(e.tolerance);
    }
  });

  it('residual stays inside tolerance at EVERY tick, not only at the end', () => {
    const e = mk();
    for (let i = 0; i < 2000; i++) { e.step(); expect(Math.abs(e.residual)).toBeLessThanOrEqual(e.tolerance); }
  });
});

describe('discharge, reversal and equilibrium', () => {
  it('discharging returns the stored energy as heat and the source does NO work', () => {
    const Vs = 10, C = 1e-3;
    const e = mk({ voltage: Vs, capacitance: C, initialVoltage: Vs });
    e.connected = false;
    const u0 = e.storedEnergy, w0 = e.sourceWork;
    run(e, 60 * 20);
    // NOT zero. After 20 tau the capacitor sits at exactly Vs*e^-20, and asserting
    // "close to 0" at 1e-9 was a REVIEWER ERROR: a tolerance tighter than the
    // physics. Asserting the analytic TAIL is the stronger check, because it
    // catches a model that decays at the wrong rate rather than merely a small one.
    expect(e.voltage).toBeCloseTo(Vs * Math.exp(-20), 15);
    expect(e.receiverHeat).toBeCloseTo(u0, 9);
    expect(e.sourceWork - w0).toBe(0);
    expect(Math.abs(e.residual)).toBeLessThanOrEqual(e.tolerance);
  });

  it('a REVERSED source still SUPPLIES energy — my first expectation here was wrong', () => {
    // REVIEWER ERROR, kept as a note. I assumed Vs = -5 with Vc0 = +10 would make the
    // source absorb. It does not: dissipation is C*d^2/2 = 0.1125 J while the
    // capacitor only gives up 0.0375 J, so the source must SUPPLY the remaining
    // 0.075 J. Driving +10 V down to -5 V is work, and the model is right.
    const e = run(mk({ voltage: -5, initialVoltage: 10 }), 60 * 20);
    expect(e.voltage).toBeCloseTo(-5 + 15 * Math.exp(-20), 14);
    expect(e.sourceWork).toBeCloseTo(0.075, 7);
    expect(e.receiverHeat).toBeCloseTo(0.1125, 7);
    expect(Math.abs(e.residual)).toBeLessThanOrEqual(e.tolerance);
  });

  it('the source DOES absorb when 0 < Vs < Vc0, and the negative work is retained', () => {
    // The genuine absorbing configuration: the capacitor pushes current BACKWARDS
    // through a lower-voltage source. Signed work must survive; a model that clamped
    // source work at zero would pass every test above and fail this one.
    const e = run(mk({ voltage: 5, initialVoltage: 10 }), 60 * 20);
    expect(e.sourceWork).toBeLessThan(0);
    expect(e.sourceWork).toBeCloseTo(-0.025, 7);
    expect(Math.abs(e.residual)).toBeLessThanOrEqual(e.tolerance);
  });

  it('at equilibrium nothing drifts: no voltage change, no heat, no work — EXACTLY', () => {
    const e = run(mk({ voltage: 7, initialVoltage: 7 }), 600);
    expect(e.voltage).toBe(7);
    expect(e.receiverHeat).toBe(0);
    expect(e.sourceWork).toBe(0);
  });
});

describe('the inputs cannot silently change the energy books', () => {
  it('inputs are FROZEN, so a capacitance edit cannot retroactively rewrite stored energy', () => {
    // Astra flagged this trap before implementing: editing C would otherwise create
    // or destroy stored energy silently. It is closed BY CONSTRUCTION, not by
    // remembering to reset — which is the stronger form.
    const e = mk();
    expect(Object.isFrozen(e.inputs)).toBe(true);
    expect(() => { (e.inputs as { capacitance: number }).capacitance = 1; }).toThrow();
    expect(e.inputs.capacitance).toBe(1e-3);
  });

  it('a fresh experiment starts with zeroed books and the authored initial voltage', () => {
    const e = mk({ initialVoltage: 3 });
    expect(e.voltage).toBe(3);
    expect(e.sourceWork).toBe(0);
    expect(e.receiverHeat).toBe(0);
    expect(e.tick).toBe(0);
  });
});

describe('the model does not depend on how it is called', () => {
  it('the same number of ticks gives byte-identical state, whatever the grouping', () => {
    const a = run(mk(), 600);
    const b = mk(); for (let k = 0; k < 6; k++) run(b, 100);
    expect(a.voltage).toBe(b.voltage);
    expect(a.receiverHeat).toBe(b.receiverHeat);
    expect(a.sourceWork).toBe(b.sourceWork);
  });
});
