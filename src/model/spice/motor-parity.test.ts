import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { buildMotorNetlist } from './motor-netlist';
import { toMotorTransient, sampleMotorAt } from './motor-transient';
import { MOTOR_PRESETS, motorPresetById } from '../motor-presets';
import { motorReference, referenceWindow, motorEnergy, motorDomain, coastingReference, coastingWindow } from '../motor';

async function solve(id: string) {
  const d = motorPresetById(id)!.build();
  const sim = new Simulation(); await sim.start();
  sim.setNetList(buildMotorNetlist(d));
  const raw = await sim.runSim();
  return { d, t: toMotorTransient(raw as never, d, 'eecircuit-engine (test)') };
}

describe('the solved motor trajectory (WASM)', () => {
  it('Lift it: obeys the analytic coupled reference inside its window', async () => {
    const { d, t } = await solve('lift-it');
    const w = referenceWindow(d)!;
    let worstI = 0, worstW = 0, worstTh = 0, peakI = 0, peakW = 0, peakTh = 0;
    const s0 = sampleMotorAt(t, w.from);
    for (let k = 0; k < 200; k++) {
      const time = w.from + (k + 0.5) / 200 * (w.to - w.from);
      const s = sampleMotorAt(t, time);
      const r = motorReference(d, false, { i: s0.motorAmps, omega: s0.omegaRadPerS, theta: s0.thetaRad }, w.from, time);
      peakI = Math.max(peakI, Math.abs(s.motorAmps)); peakW = Math.max(peakW, Math.abs(s.omegaRadPerS)); peakTh = Math.max(peakTh, Math.abs(s.thetaRad));
      worstI = Math.max(worstI, Math.abs(s.motorAmps - r.i)); worstW = Math.max(worstW, Math.abs(s.omegaRadPerS - r.omega));
      worstTh = Math.max(worstTh, Math.abs(s.thetaRad - r.theta));
    }
    expect(worstI / peakI).toBeLessThan(5e-3);
    expect(worstW / peakW).toBeLessThan(5e-3);
    // θ (and so the height) is the READER'S trapezoid reconstruction, checked here against the
    // reference's exact integral — not only i and ω.
    expect(worstTh / peakTh).toBeLessThan(1e-3);
    expect(motorDomain(t).ok).toBe(true);
  }, 120000);

  it('Locked shaft: ω stays zero, the brake reaction is booked, and the current is the LR law', async () => {
    const { d, t } = await solve('locked-shaft');
    expect(Math.max(...Array.from(t.omegaRadPerS).map(Math.abs))).toBeLessThan(1e-6);
    const s = sampleMotorAt(t, 0.3);
    const R = d.motor.resistanceOhms + d.switch.rOnOhms;
    expect(s.motorAmps).toBeCloseTo(d.supplyVolts / R, 2);
    // the brake holds K·i − τ_load
    expect(Math.abs(s.brakeTorqueNm) - Math.abs(d.motor.kVsPerRad * s.motorAmps - t.loadTorqueNm)).toBeLessThan(1e-3);
    const w = referenceWindow(d)!; const s0 = sampleMotorAt(t, w.from);
    const r = motorReference(d, true, { i: s0.motorAmps, omega: 0, theta: 0 }, w.from, 0.05);
    expect(Math.abs(sampleMotorAt(t, 0.05).motorAmps - r.i) / (d.supplyVolts / R)).toBeLessThan(5e-3);
  }, 120000);

  it('closes KCL at the motor terminal and the three energy balances, on every preset', async () => {
    for (const p of MOTOR_PRESETS) {
      const { t } = await solve(p.id);
      let peak = 0, worst = 0;
      for (let k = 0; k < t.times.length; k++) {
        peak = Math.max(peak, Math.abs(t.motorAmps[k]));
        worst = Math.max(worst, Math.abs(t.sourceAmps[k] + t.diodeAmps[k] - t.motorAmps[k]));
      }
      expect(worst / peak).toBeLessThan(1e-6);
      const e = motorEnergy(t); const k = e.times.length - 1;
      expect(Math.abs(e.portResidual[k]) / e.sourceWork[k]).toBeLessThan(2e-3);
      expect(Math.abs(e.loadResidual[k]) / e.sourceWork[k]).toBeLessThan(2e-3);
      expect(Math.abs(e.sourceResidual[k]) / e.sourceWork[k]).toBeLessThan(2e-3);
      expect(motorDomain(t).ok).toBe(true);
      expect(t.stopSeconds).toBeCloseTo(0.6, 9);
    }
  }, 300000);

  it('Switch it off: the winding current freewheels through the diode and the shaft never reverses', async () => {
    const { t } = await solve('switch-off');
    // The switch model opens at ctl < 0.4 on its 1 ms edge, ~0.4006 s. The freewheel current then
    // dies in well under a millisecond — NOT L/R = 2.5 ms: the back-EMF and the diode drop are in
    // the loop with R, so di/dt ≈ −(R·i + K·ω + V_d)/L. My first version assumed L/R and sampled
    // too late; the tool's DEBUG samples showed the current already gone. Physics, not a defect.
    // Sample where the diode current PEAKS rather than at a guessed offset: the freewheel lasts
    // ~0.15 ms here (0.19 A against 5.6 V back-EMF + diode drop), too short to hit by guessing.
    let kPeak = 0; for (let k = 0; k < t.times.length; k++) if (t.diodeAmps[k] > t.diodeAmps[kPeak]) kPeak = k;
    const open = t.description.programme.openAtSeconds!;
    expect(t.times[kPeak]).toBeGreaterThan(open);
    expect(t.times[kPeak]).toBeLessThan(open + 0.002);
    expect(t.diodeAmps[kPeak]).toBeGreaterThan(0.05);
    expect(t.sourceAmps[kPeak]).toBeLessThan(1e-3);
    expect(t.diodeAmps[kPeak]).toBeCloseTo(t.motorAmps[kPeak], 6);
    const late = sampleMotorAt(t, 0.5);
    expect(Math.abs(late.motorAmps)).toBeLessThan(1e-3);
    expect(late.omegaRadPerS).toBeGreaterThan(0);
    expect(sampleMotorAt(t, 0.6).omegaRadPerS).toBeGreaterThan(0);
    // COASTING is its own supported interval with its own closed form (load + viscous only).
    const cw = coastingWindow(t.description)!;
    const c0 = sampleMotorAt(t, cw.from); let worst = 0, worstTh = 0;
    for (let k = 0; k < 100; k++) {
      const time = cw.from + (k + 0.5) / 100 * (cw.to - cw.from), s = sampleMotorAt(t, time);
      const r = coastingReference(t.description, { omega: c0.omegaRadPerS, theta: c0.thetaRad }, cw.from, time);
      worst = Math.max(worst, Math.abs(s.omegaRadPerS - r.omega)); worstTh = Math.max(worstTh, Math.abs(s.thetaRad - r.theta));
    }
    expect(worst / c0.omegaRadPerS).toBeLessThan(2e-3);
    expect(worstTh / Math.abs(sampleMotorAt(t, cw.to).thetaRad)).toBeLessThan(1e-3);
  }, 120000);
});
