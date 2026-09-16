import { describe, expect, it } from 'vitest';
import { RcExperiment, RcClock, RC_DEFAULT, decodeRc, encodeRc, validateRc } from './rc';
import { assertThermalRouting } from './thermal';
const run = (s: RcExperiment, n: number) => { for (let i = 0; i < n; i++) s.step(); return s; };
describe('RC-1 physical acceptance', () => {
  it('charges at one and five time constants with separately integrated energy', () => {
    const s = run(new RcExperiment(RC_DEFAULT), 60);
    expect(s.voltage).toBeCloseTo(10 * (1 - Math.exp(-1)), 12);
    expect(s.sourceWork).toBeCloseTo(1 * (1 - Math.exp(-1)), 12);
    expect(s.jouleHeat).toBeCloseTo(0.5 * (1 - Math.exp(-2)), 12);
    run(s, 240);
    expect(s.voltage).toBeCloseTo(10 * (1 - Math.exp(-5)), 12);
    expect(Math.abs(s.residual)).toBeLessThan(s.tolerance);
    expect(s.receiverHeat).toBe(s.jouleHeat);
    expect(s.thermal.routedElectrical).toEqual([{ componentId: 'rc-resistor', heat: s.jouleHeat }]);
    expect(s.temperature).toBeCloseTo(300 + s.jouleHeat / 2, 12);
    assertThermalRouting(s.thermal);
  });
  it('discharges without resetting state or booking fictitious source work', () => {
    const s = run(new RcExperiment(RC_DEFAULT), 60);
    const v = s.voltage, w = s.sourceWork, q = s.jouleHeat;
    s.connected = false;
    run(s, 60);
    expect(s.voltage).toBeCloseTo(v / Math.E, 12);
    expect(s.sourceWork).toBe(w);
    expect(s.jouleHeat - q).toBeCloseTo(0.005 * v * v * (1 - Math.exp(-2)), 12);
    expect(Math.abs(s.residual)).toBeLessThan(s.tolerance);
    s.connected = true; s.step();
    expect(s.current).toBeGreaterThan(0);
  });
  it('keeps equilibrium exactly and supports reverse polarity and source absorption', () => {
    const steady = run(new RcExperiment({ ...RC_DEFAULT, initialVoltage: 10 }), 600);
    expect([steady.voltage, steady.sourceWork, steady.jouleHeat]).toEqual([10, 0, 0]);
    const negative = run(new RcExperiment({ ...RC_DEFAULT, voltage: -10 }), 60);
    expect(negative.voltage).toBeCloseTo(-10 * (1 - Math.exp(-1)), 12);
    expect(negative.current).toBeLessThan(0);
    const absorb = run(new RcExperiment({ ...RC_DEFAULT, voltage: 5, initialVoltage: 10 }), 60);
    expect(absorb.sourceWork).toBeLessThan(0);
    expect(absorb.jouleHeat).toBeGreaterThan(0);
    expect(Math.abs(absorb.residual)).toBeLessThan(absorb.tolerance);
  });
  it('honors the energy bound at every range corner across 600 ticks', () => {
    for (const resistance of [1, 1e6]) for (const capacitance of [1e-6, 1])
      for (const voltage of [-100, 100]) for (const initialVoltage of [-100, 100]) {
        const s = new RcExperiment({ resistance, capacitance, voltage, initialVoltage });
        for (let i = 0; i < 600; i++) {
          s.step();
          expect(Number.isFinite(s.voltage)).toBe(true);
          expect(s.jouleHeat).toBeGreaterThanOrEqual(0);
          expect(Math.abs(s.residual)).toBeLessThanOrEqual(s.tolerance);
        }
      }
  });
  it('produces identical states with different frame grouping and reports dropped time', () => {
    const a = new RcClock(new RcExperiment(RC_DEFAULT));
    const b = new RcClock(new RcExperiment(RC_DEFAULT));
    a.paused = b.paused = false;
    for (let i = 0; i < 600; i++) a.advance(1 / 60);
    for (let i = 0; i < 200; i++) b.advance(1 / 20);
    expect(a.experiment).toEqual(b.experiment);
    a.advance(1);
    expect(a.experiment.tick).toBe(605);
    expect(a.droppedSeconds).toBeCloseTo(1 - 5 / 60, 12);
    a.paused = true; a.advance(1); expect(a.experiment.tick).toBe(605);
  });
  it('saves authored initial conditions, not the evolved state; reload resets all ledgers', () => {
    const s = run(new RcExperiment(RC_DEFAULT), 60);
    const restored = new RcExperiment(decodeRc(encodeRc(s.inputs)));
    expect(restored.voltage).toBe(0);
    expect(restored.tick).toBe(0);
    expect(restored.sourceWork).toBe(0);
    expect(restored.receiverHeat).toBe(0);
    expect(restored.connected).toBe(true);
  });
  it('refuses invalid and unknown inputs without mutating an existing run', () => {
    const s = run(new RcExperiment(RC_DEFAULT), 10), before = JSON.stringify(s);
    for (const p of [ { ...RC_DEFAULT, resistance: 0 }, { ...RC_DEFAULT, capacitance: 0 },
      { ...RC_DEFAULT, voltage: Infinity }, { ...RC_DEFAULT, voltage: 101 },
      { ...RC_DEFAULT, initialVoltage: NaN }, { ...RC_DEFAULT, extra: 1 },
      // DOMAIN EXTENDED BY GC1, and this line is the visible consequence.
      // Astra's original pinned `resistance: 1e7` as refused, which was correct
      // under the old 1e6 ceiling. GC1 raised it to 1e9 deliberately and with a
      // declaration, because nanofarad plate geometry needs megohms to give a
      // watchable time constant. The boundary is re-pinned here rather than the
      // assertion being deleted: 1e7 is now VALID and 1e9*10 is still refused, so
      // the domain is still bounded and this test still discriminates.
      { ...RC_DEFAULT, capacitance: 2 }, { ...RC_DEFAULT, resistance: 1e10 },
      { ...RC_DEFAULT, capacitance: 1e-14 } ])
      expect(() => validateRc(p)).toThrow();
    expect(() => decodeRc('{"format":"other","inputs":{}}')).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });
});
