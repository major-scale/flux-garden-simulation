import { describe, it, expect } from 'vitest';
import { shichmanHodgesCurrent, lampReading, lampDomain } from './lamp';
import { DEFAULT_MOSFET_PART } from './spice/lamp-netlist';
import type { LampSnapshot, LampTransient } from './spice/lamp-transient';

const M = DEFAULT_MOSFET_PART;
const beta = M.kp * M.widthM / M.lengthM;   // 0.2 A/V²

describe('Shichman–Hodges, the verification equation (never called by the renderer)', () => {
  it('is zero below threshold, quadratic in saturation, and continuous at the boundary', () => {
    expect(shichmanHodgesCurrent(1.9, 5, M)).toBe(0);
    expect(shichmanHodgesCurrent(2.6, 11, M)).toBeCloseTo(beta / 2 * 0.36 * 1.11, 15);
    const vov = 3, vds = vov;
    const tri = beta * (vov * vds - vds * vds / 2) * (1 + M.lambda * vds);
    expect(shichmanHodgesCurrent(5, vds - 1e-12, M)).toBeCloseTo(tri, 9);
    expect(shichmanHodgesCurrent(5, vds, M)).toBeCloseTo(tri, 9);
  });
  it('mirrors for a negative Vds, as the model does, rather than extrapolating the formula', () => {
    expect(shichmanHodgesCurrent(5, -1, M)).toBeCloseTo(-shichmanHodgesCurrent(6, 1, M), 15);
  });
});

const snap = (vg: number, vd: number, id: number, ig = 0): LampSnapshot => ({
  timeSeconds: 1e-6, supplyVolts: 12, drainVolts: vd, gateVolts: vg, controlVolts: vg,
  drainAmps: id, gateAmps: ig, sourceAmps: id + ig,
});
const circuit = { lampOhms: 24, nominalSupplyVolts: 12, mosfet: M };

describe('the lamp reading is derived from the snapshot alone', () => {
  it('names the region, the lamp power, the DRAIN TERMINAL power and the ideal reference', () => {
    const r = lampReading(snap(10, 0.31, 0.487), circuit);
    expect(r.region).toBe('triode');
    expect(r.lampWatts).toBeCloseTo((12 - 0.31) * 0.487, 12);
    expect(r.drainTerminalWatts).toBeCloseTo(0.31 * 0.487, 12);
    expect(r.idealFullWatts).toBe(6);                       // Vdd²/R, the IDEAL zero-drop maximum
    expect(r.brightness).toBeCloseTo(r.lampWatts / 6, 12);  // linear in power, below 1
    expect(lampReading(snap(0, 12, 0), circuit).region).toBe('off');
    expect(lampReading(snap(2.6, 11.04, 0.04), circuit).region).toBe('saturation');
  });
  it('normalises the zero so an off lamp never reads −0 W', () => {
    const r = lampReading(snap(0, 12, -0), circuit);
    expect(Object.is(r.lampWatts, -0)).toBe(false);
    expect(Object.is(r.drainTerminalWatts, -0)).toBe(false);
    expect(r.brightness).toBe(0);
  });
});

describe('the supported domain is a tolerance, not a physics claim', () => {
  const tr = (drain: number[]): LampTransient => ({
    topology: 'lamp', times: Float64Array.from(drain.map((_, k) => k * 1e-6)),
    supplyVolts: new Float64Array(drain.length).fill(12), drainVolts: Float64Array.from(drain),
    gateVolts: new Float64Array(drain.length), controlVolts: new Float64Array(drain.length),
    drainAmps: new Float64Array(drain.length), gateAmps: new Float64Array(drain.length),
    sourceAmps: new Float64Array(drain.length), lampOhms: 24, gateOhms: 1000, nominalSupplyVolts: 12,
    mosfet: M, gateAtStartVolts: 0, stopSeconds: (drain.length - 1) * 1e-6,
    requestedStopSeconds: (drain.length - 1) * 1e-6, requestedStepSeconds: 1e-6,
    actualStepSeconds: { min: 1e-6, median: 1e-6, max: 1e-6 }, edges: [], engine: 'test',
  });
  it('accepts a drain that merely grazes zero within tolerance, and refuses a real reversal', () => {
    expect(lampDomain(tr([12, 0.3, -0.0005, 0.2])).ok).toBe(true);
    const d = lampDomain(tr([12, 0.3, -0.5, 0.2]));
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/^Not supported: the drain went 0\.500 V below the source/);
  });
});
