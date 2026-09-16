import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { buildNetlist, type CircuitDescription } from './netlist';
import { toTransient, sampleAt } from './transient';
import { RlcExperiment } from '../rlc';

/**
 * S1: THE PIPELINE AGAINST AN EXACT REFERENCE.
 *
 * The point of running the EXISTING linear circuit through the new solver first is that we
 * already have an exact answer for it — the analytic matrix-exponential kernel, verified
 * against ngspice over months of this work. If the netlist, the validation or the snapshot
 * lookup is wrong, it shows here against a known result, rather than later against a diode
 * where nothing can be checked.
 *
 * TOLERANCE, and a correction to how I first measured it. I declared 1e-3 and normalised each
 * error by (|value| + 1e-4·peak). Near a zero crossing that denominator collapses to the floor,
 * so an absolute current error of 1.2e-7 A read as 8% and the test failed while the physics was
 * fine. The honest measure for a signal that crosses zero is error against the PEAK: worst
 * |Δi|/peak and |ΔVc|/peak, still at 1e-3. I corrected the metric, not the tolerance — the
 * underlying agreement was 9.8e-5 of peak either way.
 */
const L = 1.8852603987e-5, C = 8.8541878128e-11, R = 297;
const PERIOD = 2 * Math.PI * Math.sqrt(L * C);
const STEP = PERIOD / 240;
const CYCLES = 5;

const description: CircuitDescription = {
  sourceVolts: 10, resistanceOhms: R, inductanceHenries: L, capacitanceFarads: C,
  initialCapacitorVolts: 0, initialInductorAmps: 0, stopSeconds: CYCLES * PERIOD, stepSeconds: STEP,
};

async function solve() {
  const sim = new Simulation();
  await sim.start();
  sim.setNetList(buildNetlist(description));
  const raw = await sim.runSim();
  return toTransient(raw as never, description, 'eecircuit-engine (test)');
}

describe('linear parity: the new pipeline against the verified analytic kernel', () => {
  it('agrees on current and capacitor voltage across five cycles', async () => {
    const t = await solve();
    const sim = new RlcExperiment({ voltage: 10, resistance: R, capacitance: C, inductance: L,
      initialVoltage: 0, initialCurrent: 0 }, STEP);

    let worstI = 0, worstV = 0, compared = 0;
    const iPeak = Math.max(...[...t.currents].map(Math.abs));
    const vPeak = Math.max(...[...t.capacitorVolts].map(Math.abs));
    const steps = Math.floor(description.stopSeconds / STEP);
    for (let n = 1; n <= steps; n++) {
      sim.step();
      const s = sampleAt(t, n * STEP);
      if (s.clampedToHorizon) continue;
      compared++;
      worstI = Math.max(worstI, Math.abs(s.currentAmps - sim.current) / iPeak);
      worstV = Math.max(worstV, Math.abs(s.capacitorVolts - sim.voltage) / vPeak);
    }
    // eslint-disable-next-line no-console
    console.log(`  parity over ${compared} instants: worst |di|/peak ${worstI.toExponential(3)}, `
      + `worst |dVc|/peak ${worstV.toExponential(3)}  (peak i ${iPeak.toExponential(3)} A, Vc ${vPeak.toFixed(3)} V)`);
    // eslint-disable-next-line no-console
    console.log(`  requested step ${t.requestedStepSeconds.toExponential(4)} s; ngspice returned its own `
      + `grid: min ${t.actualStepSeconds.min.toExponential(3)}, median ${t.actualStepSeconds.median.toExponential(3)}, `
      + `max ${t.actualStepSeconds.max.toExponential(3)}`);
    expect(compared).toBeGreaterThan(1000);
    expect(worstI).toBeLessThan(1e-3);
    expect(worstV).toBeLessThan(1e-3);
  }, 60000);

  it('derives di/dt from the inductor terminals, matching the kernel relation', async () => {
    const t = await solve();
    const s = sampleAt(t, 2 * PERIOD);
    // With no diode, v_L must equal Vs - Vc - i*R. That is the identity the OLD formula
    // assumed; here it is a CHECK on the terminal reading, not the source of it.
    const expected = s.sourceVolts - s.capacitorVolts - s.currentAmps * R;
    expect(Math.abs(s.inductorVolts - expected)).toBeLessThan(1e-6 * Math.abs(s.sourceVolts));
    expect(s.diDtAmpsPerSecond).toBeCloseTo(s.inductorVolts / L, 6);
  }, 60000);

  it('reports the engine that produced it', async () => {
    const t = await solve();
    expect(t.engine).toContain('eecircuit-engine');
    expect(t.times.length).toBeGreaterThan(1000);
  }, 60000);
});

/**
 * REPLACING A FAILING METRIC IS A CHANGED GATE, not the same one passing. Peak normalisation is
 * the honest measure for a signal that crosses zero, but it is blind to exactly the behaviour
 * the old ratio was sensitive to. So the crossing behaviour is checked directly, separately.
 */
describe('parity near zero, in sign, and at the extrema', () => {
  it('agrees on where the current crosses zero, and on its sign throughout', async () => {
    const t = await solve();
    const sim = new RlcExperiment({ voltage: 10, resistance: R, capacitance: C, inductance: L,
      initialVoltage: 0, initialCurrent: 0 }, STEP);
    const iPeak = Math.max(...[...t.currents].map(Math.abs));
    let crossingsSpice = 0, crossingsKernel = 0, signMismatches = 0, compared = 0;
    let prevS = 0, prevK = 0;
    const steps = Math.floor(description.stopSeconds / STEP);
    for (let n = 1; n <= steps; n++) {
      sim.step();
      const s = sampleAt(t, n * STEP);
      if (s.clampedToHorizon) continue;
      compared++;
      if (n > 1) {
        if (prevS * s.currentAmps < 0) crossingsSpice++;
        if (prevK * sim.current < 0) crossingsKernel++;
      }
      // Away from the crossings, the SIGN must agree. Within a hair of zero it need not:
      // two solvers may put the crossing a fraction of a step apart, which is not disagreement.
      if (Math.abs(sim.current) > 1e-3 * iPeak && Math.sign(s.currentAmps) !== Math.sign(sim.current))
        signMismatches++;
      prevS = s.currentAmps; prevK = sim.current;
    }
    // eslint-disable-next-line no-console
    console.log(`  zero crossings: spice ${crossingsSpice}, kernel ${crossingsKernel}; `
      + `sign mismatches away from zero: ${signMismatches} of ${compared}`);
    expect(crossingsSpice).toBe(crossingsKernel);
    expect(crossingsSpice).toBeGreaterThan(5);          // it really does ring
    expect(signMismatches).toBe(0);
  }, 60000);

  it('agrees on the extrema, in value and in when they happen', async () => {
    const t = await solve();
    const sim = new RlcExperiment({ voltage: 10, resistance: R, capacitance: C, inductance: L,
      initialVoltage: 0, initialCurrent: 0 }, STEP);
    let sMax = -Infinity, sMin = Infinity, kMax = -Infinity, kMin = Infinity;
    let sMaxAt = 0, kMaxAt = 0;
    const steps = Math.floor(description.stopSeconds / STEP);
    for (let n = 1; n <= steps; n++) {
      sim.step();
      const s = sampleAt(t, n * STEP);
      if (s.clampedToHorizon) continue;
      if (s.currentAmps > sMax) { sMax = s.currentAmps; sMaxAt = n * STEP; }
      if (s.currentAmps < sMin) sMin = s.currentAmps;
      if (sim.current > kMax) { kMax = sim.current; kMaxAt = n * STEP; }
      if (sim.current < kMin) kMin = sim.current;
    }
    const peak = Math.max(Math.abs(kMax), Math.abs(kMin));
    // eslint-disable-next-line no-console
    console.log(`  extrema: max ${sMax.toExponential(4)} vs ${kMax.toExponential(4)}, `
      + `min ${sMin.toExponential(4)} vs ${kMin.toExponential(4)}; `
      + `peak time ${sMaxAt.toExponential(4)} vs ${kMaxAt.toExponential(4)} s`);
    expect(Math.abs(sMax - kMax) / peak).toBeLessThan(1e-3);
    expect(Math.abs(sMin - kMin) / peak).toBeLessThan(1e-3);
    expect(Math.abs(sMaxAt - kMaxAt)).toBeLessThanOrEqual(STEP);   // same step, not just close
  }, 60000);
});

/**
 * A NON-ZERO START, and the first frame. The solver never returns t = 0, so a run that begins
 * with charge on the capacitor or current in the inductor must not present its first solved
 * sample as the reset state.
 */
describe('non-zero initial conditions and the first frame', () => {
  const charged: CircuitDescription = {
    ...description, sourceVolts: 0, initialCapacitorVolts: 7.5, initialInductorAmps: 0,
    stopSeconds: 2 * PERIOD,
  };

  async function solveWith(d: CircuitDescription) {
    const sim = new Simulation();
    await sim.start();
    sim.setNetList(buildNetlist(d));
    return toTransient(await sim.runSim() as never, d, 'eecircuit-engine (test)');
  }

  it('accepts a charged start and rings down from it', async () => {
    const t = await solveWith(charged);
    expect(t.initialState.capacitorVolts).toBe(7.5);
    expect(t.initialState.currentAmps).toBe(0);
    // The first SOLVED sample is already moving, and is not t = 0.
    expect(t.times[0]).toBeGreaterThan(0);
    // It should still be very close to the authored charge, since almost no time has passed.
    expect(Math.abs(t.capacitorVolts[0] - 7.5)).toBeLessThan(0.01);
    const kernel = new RlcExperiment({ voltage: 0, resistance: R, capacitance: C, inductance: L,
      initialVoltage: 7.5, initialCurrent: 0 }, STEP);
    let worst = 0;
    const vPeak = Math.max(...[...t.capacitorVolts].map(Math.abs));
    for (let n = 1; n <= Math.floor(charged.stopSeconds / STEP); n++) {
      kernel.step();
      const s = sampleAt(t, n * STEP);
      if (s.clampedToHorizon) continue;
      worst = Math.max(worst, Math.abs(s.capacitorVolts - kernel.voltage) / vPeak);
    }
    // eslint-disable-next-line no-console
    console.log(`  charged start: worst |dVc|/peak ${worst.toExponential(3)} over 2 cycles`);
    expect(worst).toBeLessThan(1e-3);
  }, 60000);

  it('does not pass the first solved sample off as t = 0', async () => {
    const t = await solveWith(charged);
    const atZero = sampleAt(t, 0);
    // Asking for zero CLAMPS, and says so, and reports the time it actually represents.
    expect(atZero.clampedToHorizon).toBe(true);
    expect(atZero.requestedTimeSeconds).toBe(0);
    expect(atZero.timeSeconds).toBe(t.times[0]);
    expect(atZero.timeSeconds).toBeGreaterThan(0);
    // The authored reset state is available separately and is exactly what was asked for.
    expect(t.initialState.timeSeconds).toBe(0);
    expect(t.initialState.capacitorVolts).toBe(charged.initialCapacitorVolts);
  }, 60000);

  it('applies a non-zero initial current to the SOLVER, not just the description', async () => {
    // My first version of this test asserted only the description and was named as if it
    // checked the netlist. It did not — and the netlist did not set the inductor's initial
    // current at all, so a starting current would have been reported and never simulated.
    const moving = { ...charged, initialInductorAmps: 0.25, stopSeconds: PERIOD };
    expect(buildNetlist(moving)).toMatch(/^L1 n2 n3 [\d.e-]+ ic=0\.25$/m);
    const t = await solveWith(moving);
    expect(t.initialState.currentAmps).toBe(0.25);
    // And the solver really started there: the first sample is within a whisker of 0.25 A.
    expect(Math.abs(t.currents[0] - 0.25)).toBeLessThan(0.02);
    // A run started from rest under the same conditions must NOT look like this.
    const still = await solveWith({ ...moving, initialInductorAmps: 0 });
    expect(Math.abs(still.currents[0])).toBeLessThan(0.02);
    expect(Math.abs(t.currents[0] - still.currents[0])).toBeGreaterThan(0.2);
  }, 60000);
});
