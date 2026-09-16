import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { buildLampNetlist } from './lamp-netlist';
import { toLampTransient, sampleLampAt } from './lamp-transient';
import { LAMP_PRESETS, lampPresetById } from '../lamp-presets';
import { shichmanHodgesCurrent, lampReading, lampDomain } from '../lamp';

/**
 * THE LAMP PIPELINE THROUGH THE ENGINE THE PAGE RUNS (WASM). Checks agreed with Astra:
 * Shichman–Hodges on SETTLED PLATEAUS only (the drain terminal current carries capacitive terms
 * through an edge); the gate current sign against (v(c) − v(g)) / RG at every sample; signed
 * three-terminal KCL at every sample; and the named states OFF / ON / NEAR-THRESHOLD.
 */
async function solve(id: string) {
  const d = lampPresetById(id)!.build();
  const sim = new Simulation();
  await sim.start();
  sim.setNetList(buildLampNetlist(d));
  const raw = await sim.runSim();
  return { d, t: toLampTransient(raw as never, d, 'eecircuit-engine (test)') };
}

describe('the solved lamp trajectory', () => {
  it('starts at the operating point, at t = 0 exactly, with the lamp off', async () => {
    const { t } = await solve('switch-on');
    expect(t.times[0]).toBe(0);
    expect(Math.abs(t.drainAmps[0])).toBeLessThan(1e-9);
    expect(t.drainVolts[0]).toBeCloseTo(12, 6);
  }, 60000);

  it('obeys Shichman–Hodges on the plateaus, ON and NEAR THRESHOLD', async () => {
    for (const [id, at] of [['switch-on', 30e-6], ['near-threshold', 40e-6]] as const) {
      const { t } = await solve(id);
      const s = sampleLampAt(t, at);
      const sh = shichmanHodgesCurrent(s.gateVolts, s.drainVolts, t.mosfet);
      expect(Math.abs(s.drainAmps - sh) / sh).toBeLessThan(2e-3);
    }
  }, 120000);

  it('reads the gate current with the right sign: (v(c) − v(g)) / RG, at EVERY sample', async () => {
    const { t } = await solve('switch-on');
    let peak = 0, worst = 0;
    for (let k = 0; k < t.times.length; k++) {
      const viaR = (t.controlVolts[k] - t.gateVolts[k]) / t.gateOhms;
      peak = Math.max(peak, Math.abs(viaR));
      worst = Math.max(worst, Math.abs(t.gateAmps[k] - viaR));
    }
    expect(peak).toBeGreaterThan(1e-5);            // the edge really charges the gate
    expect(worst / peak).toBeLessThan(1e-6);
    // And it flows INTO the gate while the gate is rising, out while it falls.
    const rising = sampleLampAt(t, 11e-6);
    expect(rising.gateAmps).toBeGreaterThan(0);
    const { t: off } = await solve('switch-off');
    expect(sampleLampAt(off, 11e-6).gateAmps).toBeLessThan(0);
  }, 120000);

  it('closes KCL on the three terminals at every sample, through the edges', async () => {
    const { t } = await solve('switch-on');
    let peak = 0, worst = 0;
    for (let k = 0; k < t.times.length; k++) {
      peak = Math.max(peak, Math.abs(t.drainAmps[k]));
      worst = Math.max(worst, Math.abs(t.drainAmps[k] + t.gateAmps[k] - t.sourceAmps[k]));
    }
    expect(worst / peak).toBeLessThan(1e-6);
  }, 60000);

  it('reaches the named states, and the near-threshold transistor out-dissipates its lamp', async () => {
    const { t } = await solve('switch-on');
    const on = lampReading(sampleLampAt(t, 30e-6), t);
    expect(on.region).toBe('triode');
    expect(on.drainAmps).toBeGreaterThan(0.45);
    expect(on.brightness).toBeGreaterThan(0.9);
    const { t: nt } = await solve('near-threshold');
    const near = lampReading(sampleLampAt(nt, 40e-6), nt);
    expect(near.region).toBe('saturation');
    expect(near.brightness).toBeLessThan(0.02);
    expect(near.drainTerminalWatts).toBeGreaterThan(5 * near.lampWatts);
  }, 120000);

  it('keeps every preset inside the supported domain and reaches its horizon', async () => {
    for (const p of LAMP_PRESETS) {
      const { t } = await solve(p.id);
      expect(lampDomain(t).ok).toBe(true);
      expect(t.stopSeconds).toBeCloseTo(60e-6, 12);
    }
  }, 240000);
});
