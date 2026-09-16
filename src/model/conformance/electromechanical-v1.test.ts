/**
 * ELECTROMECHANICAL V1 (bridge/ELECTROMECHANICAL-V1-PLAN.md, docs/ELECTROMECHANICAL-V1-DECLARATION.md):
 *   1. the hoist fixtures pass their frozen, hand-derived checks on the WASM engine;
 *   2. REUSE, not duplication: the page deck is byte-identical to its recorded baseline, `motorReference` is the shared
 *      `coupledReference`, and the public composition hoist solves the page's Lift-it circuit to the same trajectory;
 *   3. production functions and solved trajectories meet the identities of formal/ElectromechanicalCoupling.lean (the rack
 *      mapping, reflected inertia, gravity work, conversion power, balance composition) — correspondence, not refinement;
 *   4. negatives fail the intended check: reversed polarity, wrong radius, reflected mass left out of the deck, the rack
 *      mass double counted in the account, a reversed torque transfer, coasting into reversal, a rack without a brake.
 */
import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { readFileSync } from 'node:fs';
import { runConformance, makePicker, neededVectors, type Engine, type ExpectationSet, type Report } from './kit';
import { buildStructure, type Composition, type PartInstance } from './composition';
import { readGrid } from '../spice/grid';
import { emitDcMotorPort, shaftInertia, shaftLoadTorque } from '../spice/parts';
import { reflectedInertia, gravityTorque, rackHeight, rackVelocity } from '../spice/shaft-load';
import { buildMotorNetlist } from '../spice/motor-netlist';
import { toMotorTransient, sampleMotorAt } from '../spice/motor-transient';
import { MOTOR_PRESETS, motorPresetById } from '../motor-presets';
import { motorReference, coupledReference } from '../motor';

const file = (path: string) => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const fx = (name: string) => file(`tools/conformance/fixtures/${name}.json`);
const wasm: Engine = { name: 'eecircuit-engine (test)', version: 'test', async run(netlist) { const sim = new Simulation(); await sim.start(); sim.setNetList(netlist); return sim.runSim() as never; } };
/** An engine that edits the deck before solving: the way to build a WRONG machine without touching production code. */
const rewriting = (edit: (netlist: string) => string): Engine => ({ name: 'rewriting', version: '0', run: (netlist, vectors) => wasm.run(edit(netlist), vectors) });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const statusOf = (r: Report, id: string) => r.results.find((x) => x.check === id)?.status;
const motorOf = (c: Composition) => c.parts.find((p) => p.kind === 'motor') as Extract<PartInstance, { kind: 'motor' }>;
const cause = (fn: () => unknown): string => { try { fn(); return 'no error'; } catch (e) { return (e as { cause_?: string }).cause_ ?? `other: ${(e as Error).message}`; } };

async function solve(c: Composition, engine: Engine = wasm) {
  const s = buildStructure(c);
  const wanted = ['time', ...neededVectors(s)];
  const g = readGrid(await engine.run(s.netlist, wanted.slice(1)), wanted, c.analysis);
  const pick = makePicker(s, g.times, g.pick);
  return { times: g.times, obs: (o: string) => pick(s.observables[o]) };
}

const HOISTS = ['hoist-lift', 'hoist-light', 'hoist-heavy', 'hoist-locked', 'hoist-balanced-hold', 'hoist-coast'];

describe('hoist fixtures pass every frozen, hand-derived check (WASM)', () => {
  for (const name of HOISTS) {
    it(`${name}: PASS with every check executed`, async () => {
      const x = fx(`${name}.expectations`) as ExpectationSet;
      const r = await runConformance(fx(`${name}.composition`), x, wasm);
      expect(r.results.filter((q) => q.status !== 'pass' && q.status !== 'warn').map((q) => `${q.check}: ${q.status} ${q.observed ?? q.message}`)).toEqual([]);
      expect(r.verdict).toBe('pass'); expect(r.results.length).toBe(x.checks.length);
    }, 120000);
  }
});

describe('reuse, not duplication', () => {
  it('the motor page decks are byte-identical to the baseline recorded before this batch', () => {
    const base = file('tools/evidence/electromechanical-v1/baseline-page-netlists.json').presets as Record<string, { netlist: string }>;
    for (const p of MOTOR_PRESETS) expect(buildMotorNetlist(p.build()), p.id).toBe(base[p.id].netlist);
  });
  it('motorReference IS coupledReference on the page description (one reference, not two)', () => {
    const d = MOTOR_PRESETS[0].build(), m = d.motor;
    const params = { R: m.resistanceOhms + d.switch.rOnOhms, L: m.inductanceHenries, K: m.kVsPerRad, J: m.rotorInertiaKgM2 + reflectedInertia(d.load), b: m.viscousNmS, tau: gravityTorque(d.load), V: d.supplyVolts };
    for (const t of [0.001, 0.01, 0.1, 0.5]) expect(motorReference(d, false, { i: 0, omega: 0, theta: 0 }, 0, t)).toEqual(coupledReference(params, false, { i: 0, omega: 0, theta: 0 }, 0, t));
  });
  it('the public composition hoist solves the page Lift-it circuit to the same trajectory (i, ω, θ, height)', async () => {
    const d = motorPresetById('lift-it')!.build();
    const sim = new Simulation(); await sim.start(); sim.setNetList(buildMotorNetlist(d));
    const page = toMotorTransient(await sim.runSim() as never, d, 'page');
    const c = await solve(fx('hoist-lift.composition'));
    const at = (arr: Float64Array, t: number) => { let k = 1; while (k < c.times.length - 1 && c.times[k] < t) k++; const f = (t - c.times[k - 1]) / (c.times[k] - c.times[k - 1]); return arr[k - 1] + (arr[k] - arr[k - 1]) * f; };
    const I = c.obs('m.windingCurrent'), W = c.obs('m.omega'), TH = c.obs('m.theta'), H = c.obs('m.height');
    let worstI = 0, worstW = 0, worstH = 0;
    for (let j = 0; j < 200; j++) {
      const t = 0.02 + (j + 0.5) / 200 * 0.58, s = sampleMotorAt(page, t);
      worstI = Math.max(worstI, Math.abs(at(I, t) - s.motorAmps)); worstW = Math.max(worstW, Math.abs(at(W, t) - s.omegaRadPerS));
      worstH = Math.max(worstH, Math.abs(at(H, t) - s.heightM));
      expect(at(H, t)).toBeCloseTo(d.load.pinionRadiusM * at(TH, t), 12);
    }
    expect(worstI / 2.93).toBeLessThan(1e-3); expect(worstW / 18.7).toBeLessThan(1e-3); expect(worstH / 0.42).toBeLessThan(1e-3);
  }, 120000);
});

describe('production functions and trajectories meet the Lean identities (correspondence evidence)', () => {
  const rack = { massKg: 0.1, pinionRadiusM: 0.04, gravity: 9.80665 }, load = { inertiaKgM2: 5e-4, viscousNmS: 1e-3, constantTorqueNm: 0.01 };
  it('rack mapping, reflected inertia and weight torque are the model equations (x = rθ, v = rω, m r², m g r)', () => {
    expect(reflectedInertia(rack)).toBeCloseTo(0.1 * 0.04 ** 2, 15); expect(gravityTorque(rack)).toBeCloseTo(0.1 * 9.80665 * 0.04, 15);
    expect(rackHeight(rack, 2)).toBeCloseTo(0.08, 15); expect(rackVelocity(rack, 10)).toBeCloseTo(0.4, 15);
    expect(shaftInertia(load, rack)).toBeCloseTo(5e-4 + 0.1 * 0.04 ** 2, 15); expect(shaftLoadTorque(load, rack)).toBeCloseTo(0.01 + 0.1 * 9.80665 * 0.04, 15);
    // kinetic_once: ½·J_eff·ω² = ½·J·ω² + ½·m·v² with v = rω — the reflected term IS the rack's kinetic energy
    const w = 13, v = rackVelocity(rack, w);
    expect(0.5 * shaftInertia(load, rack) * w * w).toBeCloseTo(0.5 * load.inertiaKgM2 * w * w + 0.5 * rack.massKg * v * v, 12);
    // gravity_work: m g r · θ = m g · x
    expect(gravityTorque(rack) * 3).toBeCloseTo(rack.massKg * rack.gravity * rackHeight(rack, 3), 12);
  });
  it('the emitted deck carries exactly those numbers: Cj = J + m r², Il = τ + m g r, and no rack means the pre-v1 lines', () => {
    const m = { resistanceOhms: 2, inductanceHenries: 5e-3, kVsPerRad: 0.3 };
    const lines = emitDcMotorPort('m', 'na', '0', m, load, rack, { releaseAtSeconds: 0.02, edgeSeconds: 0.001 }, 0.6);
    expect(lines).toContain(`Cjm m_w 0 ${shaftInertia(load, rack)}`); expect(lines).toContain(`Ilm m_w 0 DC ${shaftLoadTorque(load, rack)}`);
    expect(lines).toContain('Vbrm m_w m_bp DC 0');
    expect(emitDcMotorPort('m', 'na', '0', m, load)).toEqual(['Vmm na m_p DC 0', 'Rm m_p m_r 2', 'Lm m_r m_e 0.005', 'Ebm m_e 0 m_w 0 0.3', 'Btm 0 m_w I=0.3*i(Lm)', 'Cjm m_w 0 0.0005', 'Rbm m_w 0 1000', 'Ilm m_w 0 DC 0.01']);
  });
  it('on the solved hoist: height = r·θ and velocity = r·ω at every sample; back-EMF = K·ω; emf·i = (K·i)·ω (conversion_power)', async () => {
    const c = fx('hoist-lift.composition') as Composition, r = motorOf(c).spec.rack!.pinionRadiusM, K = motorOf(c).spec.motor.kVsPerRad;
    const s = await solve(c);
    const W = s.obs('m.omega'), TH = s.obs('m.theta'), H = s.obs('m.height'), V = s.obs('m.velocity'), E = s.obs('m.backEmf'), I = s.obs('m.windingCurrent');
    let worstMap = 0, worstEmf = 0, worstP = 0, peakP = 0;
    for (let k = 0; k < W.length; k++) {
      worstMap = Math.max(worstMap, Math.abs(H[k] - r * TH[k]), Math.abs(V[k] - r * W[k]));
      worstEmf = Math.max(worstEmf, Math.abs(E[k] - K * W[k]));
      worstP = Math.max(worstP, Math.abs(E[k] * I[k] - (K * I[k]) * W[k])); peakP = Math.max(peakP, Math.abs(E[k] * I[k]));
    }
    expect(worstMap).toBeLessThan(1e-12); expect(worstEmf / (K * 18.7)).toBeLessThan(1e-6); expect(worstP / peakP).toBeLessThan(1e-6);
  }, 120000);
  it('balance composition on the solved hoist: port work = heat + Δ½Li² + Δ½J_eff·ω² + m·g·Δx + b∫ω² − brake work (transfer cancelled); adding ½·m·v² again breaks it', async () => {
    const c = fx('hoist-lift.composition') as Composition, { motor: m, load, rack } = motorOf(c).spec;
    const s = await solve(c), t = s.times, n = t.length, e = n - 1;
    const VP = s.obs('m.vplus'), VM = s.obs('m.vminus'), IP = s.obs('m.current'), I = s.obs('m.windingCurrent'), W = s.obs('m.omega'), TH = s.obs('m.theta'), V = s.obs('m.velocity'), BT = s.obs('m.brakeTorque');
    const trap = (f: (k: number) => number) => { let a = 0; for (let k = 1; k < n; k++) a += 0.5 * (f(k) + f(k - 1)) * (t[k] - t[k - 1]); return a; };
    const port = trap((k) => (VP[k] - VM[k]) * IP[k]);
    const heat = m.resistanceOhms * trap((k) => I[k] * I[k]), viscous = load.viscousNmS * trap((k) => W[k] * W[k]), brakeWork = trap((k) => BT[k] * W[k]);
    const dMagnetic = 0.5 * m.inductanceHenries * (I[e] ** 2 - I[0] ** 2), dKinetic = 0.5 * shaftInertia(load, rack) * (W[e] ** 2 - W[0] ** 2), dPotential = gravityTorque(rack!) * (TH[e] - TH[0]);
    const residual = port - (heat + dMagnetic + dKinetic + dPotential + viscous - brakeWork);
    expect(port).toBeGreaterThan(0.3);
    expect(Math.abs(residual) / port).toBeLessThan(2e-3);                                        // kinetic counted ONCE: closes
    const doubleCounted = residual - 0.5 * rack!.massKg * (V[e] ** 2 - V[0] ** 2);              // an account that adds ½·m·v² again
    expect(Math.abs(doubleCounted) / port).toBeGreaterThan(1e-2);                                // ≈ 4 % of the port work: caught
    expect(dPotential).toBeCloseTo(rack!.massKg * rack!.gravity * s.obs('m.height')[e], 9);     // gravity_work on the trajectory
  }, 120000);
});

describe('negative controls fail the INTENDED check', () => {
  it('reversed polarity (plus and minus swapped): the shaft runs backward — the motoring domain is UNSUPPORTED by name and nothing is lifted', async () => {
    const c = clone(fx('hoist-lift.composition')) as Composition; motorOf(c).ports = { plus: '0', minus: 'na' };
    const r = await runConformance(c, fx('hoist-lift.expectations'), wasm);
    expect(statusOf(r, 'motoring-domain')).toBe('unsupported'); expect(statusOf(r, 'lifted-at-least')).toBe('fail');
    expect(r.results.find((q) => q.check === 'motoring-domain')!.message).toMatch(/reverse/);
  }, 120000);
  it('wrong radius (44 mm declared where the analysis assumed 40 mm): the hand-derived steady speed and height fail', async () => {
    const c = clone(fx('hoist-lift.composition')) as Composition; motorOf(c).spec.rack!.pinionRadiusM = 0.044;
    const r = await runConformance(c, fx('hoist-lift.expectations'), wasm);
    expect(statusOf(r, 'steady-speed')).toBe('fail'); expect(statusOf(r, 'steady-current')).toBe('fail');
  }, 120000);
  it('the reflected mass left out of the deck (Cj = J only): the motor energy account fails — kinetic energy no longer matches port work', async () => {
    const r = await runConformance(fx('hoist-lift.composition'), fx('hoist-lift.expectations'), rewriting((n) => n.replace(/^Cjm m_w 0 \S+$/m, 'Cjm m_w 0 0.0005')));
    expect(statusOf(r, 'energy-account')).toBe('fail'); expect(statusOf(r, 'coupled-reference')).toBe('fail');
  }, 120000);
  it('a REVERSED torque transfer (Bt driving the shaft the wrong way): over the full run the machine creates energy and runs away — the solve aborts and every solved check is ERROR, never a pass', async () => {
    const reversed = rewriting((n) => n.replace(/^Btm 0 m_w /m, 'Btm m_w 0 '));
    const full = await runConformance(fx('hoist-lift.composition'), fx('hoist-lift.expectations'), reversed);
    expect(full.verdict).toBe('error'); expect(full.summary).toMatch(/SOLVE FAILED/);
    expect(statusOf(full, 'energy-account')).toBe('error');
    // Amendment A-1: over a horizon the solve completes (50 ms), the non-cancelling transfer is caught by the account itself
    // (the two ports now book +K·i·ω and −K·i·ω) and the analytic reference departs.
    const c = clone(fx('hoist-lift.composition')) as Composition; c.analysis.stopSeconds = 0.05;
    const short = await runConformance(c, { id: 'reversed-short', checks: [
      { id: 'energy-account', kind: 'energy-balance', tolRel: 0.001, tolStorageRel: 0.02 },
      { id: 'coupled-reference', kind: 'motor-reference', part: 'm', supplyVolts: 6, seriesOhms: 0.05, window: [0.021, 0.05], braked: false, tolRel: 0.005 }] }, reversed);
    expect(short.summary).not.toMatch(/SOLVE FAILED/);
    expect(statusOf(short, 'energy-account')).toBe('fail'); expect(statusOf(short, 'coupled-reference')).toBe('fail');
    // the same short run with the production deck passes both: the failure is the reversed transfer, not the horizon
    const good = await runConformance(c, { id: 'good-short', checks: [
      { id: 'energy-account', kind: 'energy-balance', tolRel: 0.001, tolStorageRel: 0.02 },
      { id: 'coupled-reference', kind: 'motor-reference', part: 'm', supplyVolts: 6, seriesOhms: 0.05, window: [0.021, 0.05], braked: false, tolRel: 0.005 }] }, wasm);
    expect(good.verdict).toBe('pass');
  }, 120000);
  it('coasting past zero speed (1.2 s run): the load drives the shaft backward — UNSUPPORTED by name, never clamped', async () => {
    const c = clone(fx('hoist-coast.composition')) as Composition; c.analysis.stopSeconds = 1.2;
    const r = await runConformance(c, { id: 'long', checks: [{ id: 'domain', kind: 'motor-domain', part: 'm', graceSeconds: 0.005 }] }, wasm);
    expect(r.results[0].status).toBe('unsupported'); expect(r.results[0].message).toMatch(/reverse rotation/);
  }, 120000);
  it('a rack without a brake is refused (no rest operating point); a brake released outside the run is refused', () => {
    const c = clone(fx('hoist-lift.composition')) as Composition; delete motorOf(c).spec.brake;
    expect(cause(() => buildStructure(c))).toBe('unsupported-initial-state');
    const d = clone(fx('hoist-lift.composition')) as Composition; motorOf(d).spec.brake!.releaseAtSeconds = 0.9;
    expect(cause(() => buildStructure(d))).toBe('invalid-parameter');
  });
  it('the locked shaft and the torque-balanced hold are different cases: only the locked brake carries torque', async () => {
    const locked = await solve(fx('hoist-locked.composition')), hold = await solve(fx('hoist-balanced-hold.composition'));
    const mid = (a: Float64Array) => a[Math.floor(a.length / 2)];
    expect(mid(locked.obs('m.brakeTorque'))).toBeLessThan(-0.8);
    expect(Math.abs(mid(hold.obs('m.brakeTorque')))).toBeLessThan(1e-6);
    expect(Math.abs(mid(hold.obs('m.omega')))).toBeLessThan(1e-3);
  }, 120000);
});
