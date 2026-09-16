/**
 * THERMAL FEEDBACK V1 (bridge/THERMAL-FEEDBACK-V1-PLAN.md, docs/THERMAL-FEEDBACK-V1-DECLARATION.md), criteria frozen there:
 *   1. parameter mapping (R(T), the NTC node in °C, Ohm/Joule on the solve) and its negatives on production paths;
 *   2. open loop: no bindings = the accepted electrothermal result; the implicit constant-voltage analytic trajectory (first order);
 *      the derived equilibrium with cooling; constant voltage vs near-constant current;
 *   3. the thermostat: cycles, switching at the thresholds, refinement, both initial states, threshold starts;
 *   4. an ambient disturbance; 5. accounting, a linked heatsink, double booking, resume, failed solves, coarse steps.
 * Every run goes through `runFeedback` (the production adapter) on ngspice WASM, one reused instance.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { readFileSync } from 'node:fs';
import { buildStructure, type Composition } from './conformance/composition';
import { makePicker, neededVectors } from './conformance/kit';
import { readGrid } from './spice/grid';
import { ntcOhms, type NtcSpec } from './spice/parts';
import { thermalFromComposition, ThermalError } from './thermal-lumped';
import { runFeedback, feedbackAudit, validateFeedback, FeedbackError, type FeedbackDescriptor, type FeedbackEngine, type FeedbackRun } from './thermal-feedback';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../tools/conformance/fixtures/${name}`, import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const cause = async (p: Promise<unknown> | (() => unknown)): Promise<string> => {
  try { await (typeof p === 'function' ? p() : p); return 'no error'; } catch (e) { return (e as FeedbackError | ThermalError).cause_ ?? `other: ${(e as Error).message}`; }
};
let engine: FeedbackEngine;
beforeAll(async () => { const sim = new Simulation(); await sim.start(); engine = { async run(netlist: string) { sim.setNetList(netlist); return sim.runSim(); } }; });

const heaterC = (): Composition => fixture('feedback-heater.composition.json');
const heaterD = (): FeedbackDescriptor => fixture('feedback-heater.feedback.json');
const thermoC = (): Composition => fixture('thermostat.composition.json');
const thermoD = (): FeedbackDescriptor => fixture('thermostat.feedback.json');
const oneStep = { stopSeconds: 1, stepSeconds: 1, eventToleranceSeconds: 1e-3 };
const endT = (r: FeedbackRun, b = 'plate') => r.trajectory.temperatureK[b][r.trajectory.temperatureK[b].length - 1];
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
/** Isolated constant-voltage heating with R = R_ref·(1 + α·ΔT), T0 = T_ref, no ambient: R_ref·(ΔT + α·ΔT²/2) = V²·t/C. */
const implicitRise = (V: number, C: number, R: number, a: number, t: number) => (Math.sqrt(1 + 2 * a * V * V * t / (C * R)) - 1) / a;
/** The temperature resolution of a located switch: the fastest rate × the event tolerance, plus the comparator band in kelvin. */
function switchResolutionK(r: FeedbackRun, d: FeedbackDescriptor, gain = 1e4) {
  const T = r.trajectory.temperatureK.plate, t = r.trajectory.times; let rate = 0;
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) rate = Math.max(rate, Math.abs(T[i] - T[i - 1]) / (t[i] - t[i - 1]));
  const dVdT = (r.calibration!.highVolts - r.calibration!.lowVolts) / (d.controller!.highK - d.controller!.lowK);
  return rate * d.clock.eventToleranceSeconds + (0.1 / gain) / Math.abs(dVdT);
}

// ---------------------------------------------------------------- 1
describe('1 · parameter mapping on the production path', () => {
  it('R(T) at known temperatures is exact; the solved current and power obey Ohm and Joule (constant voltage and near-constant current)', async () => {
    for (const T0 of [233.15, 293.15, 343.15]) {
      const d = heaterD(); d.thermal.bodies[0].initialTemperatureK = T0; d.clock = oneStep;
      const s = (await runFeedback(heaterC(), d, engine)).solves[0], R = 24 * (1 + 0.004 * (T0 - 293.15));
      expect(rel(s.parameters.rh, R)).toBeLessThan(1e-12);
      expect(rel(s.powersW.rh, 144 / R)).toBeLessThan(1e-9);                         // Joule: V²/R
      expect(rel(-s.powersW.vs, 144 / R)).toBeLessThan(1e-9);                        // the source delivers exactly that
    }
    const dc = fixture('feedback-heater-cc.feedback.json') as FeedbackDescriptor; dc.clock = oneStep;
    const s = (await runFeedback(fixture('feedback-heater-cc.composition.json'), dc, engine)).solves[0], I = 1000 / (10000 + 24);
    expect(rel(s.powersW.rh, I * I * 24)).toBeLessThan(1e-9); expect(rel(s.powersW.rs, I * I * 10000)).toBeLessThan(1e-9);
  });
  it('the NTC node reads T − 273.15 exactly and the SOLVED NTC resistance is the β law', async () => {
    const spec = (thermoC().parts.find((p) => p.name === 'sn')!.spec) as NtcSpec;
    for (const T0 of [293.15, 313.15, 330]) {
      const d = thermoD(); d.clock = oneStep; d.disturbances = []; d.thermal.bodies[0].initialTemperatureK = T0;
      const s = (await runFeedback(thermoC(), d, engine)).solves[0];
      expect(s.parameters.sn).toBe(T0 - 273.15);
      const solvedOhms = 10000 * s.powersW.sn / s.powersW.rf;                       // same current through NTC and R_f: R = R_f·P_ntc/P_f
      expect(rel(solvedOhms, ntcOhms(T0 - 273.15, spec))).toBeLessThan(1e-9);
    }
  });
  it('negatives: a reversed slope and a stale temperature fail the audit; Kelvin-for-Celsius fails it and is refused by domain; an invalid domain is refused', async () => {
    const c = thermoC(), d = thermoD(); d.clock.stopSeconds = 60; d.disturbances = [];
    const r = await runFeedback(c, d, engine);
    expect(feedbackAudit(r, c)).toEqual({ mappingErr: 0, staleErr: 0, missing: 0 });
    const reversed = clone(d); (reversed.bindings[0] as { alphaPerK: number }).alphaPerK = -0.004;
    expect(feedbackAudit(r, c, reversed).mappingErr).toBeGreaterThan(1e-3);
    const stale = { ...r, solves: r.solves.map((s, i) => (i === 0 ? s : { ...s, parameters: r.solves[i - 1].parameters })) };
    expect(feedbackAudit(stale, c).mappingErr).toBeGreaterThan(1e-6);
    const kelvin = { ...r, solves: r.solves.map((s) => ({ ...s, parameters: { ...s.parameters, sn: s.temperaturesK.plate } })) };
    expect(feedbackAudit(kelvin, c).mappingErr).toBeCloseTo(273.15, 6);
    const hot = clone(d); hot.thermal.bodies[0].initialTemperatureK = 373.15;          // 100 °C: outside the NTC's −20…80 °C
    expect(await cause(runFeedback(c, hot, engine))).toBe('sensor-domain');
    const negative = heaterD(); (negative.bindings[0] as { alphaPerK: number }).alphaPerK = -0.01;   // R(473 K) < 0 inside the domain
    expect(await cause(() => validateFeedback(heaterC(), negative))).toBe('feedback-domain');
    const narrow = heaterD(); (narrow.bindings[0] as { domainK: [number, number] }).domainK = [233.15, 300];
    expect(await cause(runFeedback(heaterC(), narrow, engine))).toBe('feedback-domain');   // heats out of its domain: refused, not extrapolated
  });
  it('only memoryless parts and DC sources: storage, PWL programmes, stray environments and unordered thresholds are refused', async () => {
    const cap = heaterC(); cap.parts.push({ kind: 'capacitor', name: 'cx', ports: { plus: 'vcc', minus: '0' }, spec: { farads: 1e-6 } } as never);
    expect(await cause(() => validateFeedback(cap, heaterD()))).toBe('unsupported-feedback-part');
    const pwl = heaterC(); pwl.sources[0] = { kind: 'pwl', name: 'vs', plus: 'vcc', minus: '0', points: [{ atSeconds: 0, value: 12 }, { atSeconds: 1, value: 12 }] };
    expect(await cause(() => validateFeedback(pwl, heaterD()))).toBe('unsupported-feedback-part');
    const stray = heaterC(); stray.environments = [{ name: 'e', node: 'x', points: [{ atSeconds: 0, value: 20 }, { atSeconds: 1, value: 20 }] }];
    expect(await cause(() => validateFeedback(stray, heaterD()))).toBe('unsupported-feedback-part');
    const unordered = thermoD(); unordered.controller!.lowK = 320;
    expect(await cause(() => validateFeedback(thermoC(), unordered))).toBe('controller-thresholds');
  });
});

// ---------------------------------------------------------------- 2
describe('2 · open loop', () => {
  it('with no bindings the loop reproduces the accepted electrothermal result for the same composition', async () => {
    const c = heaterC(), d = heaterD(); d.bindings = [];
    const r = await runFeedback(c, d, engine);
    const ct = clone(c); ct.analysis = { stopSeconds: 100, stepSeconds: 0.5 };
    // the SAME shared solver instance: a second eecircuit instance in one process makes a reused one lag (see the stale-solve test)
    const st = buildStructure(ct), wanted = ['time', ...neededVectors(st)];
    const g = readGrid(await engine.run(st.netlist, wanted.slice(1)) as never, wanted, ct.analysis);
    const v1 = thermalFromComposition(ct, st, g.times, makePicker(st, g.times, g.pick), d.thermal), e = g.times.length - 1;
    const rise = v1.run.temperatureK.plate[e] - 293.15;
    expect(Math.abs(endT(r) - v1.run.temperatureK.plate[e]) / rise).toBeLessThan(1e-9);
    expect(Math.abs(endT(r) - 293.15 - 6 * 100 / 5) / rise).toBeLessThan(1e-9);         // 6 W into 5 J/K for 100 s
  }, 120000);
  it('isolated constant voltage with a linear R(T): first-order convergence to the implicit analytic trajectory', async () => {
    const errs: number[] = [];
    for (const h of [1, 0.5, 0.25]) {
      const d = heaterD(); d.clock.stepSeconds = h;
      const r = await runFeedback(heaterC(), d, engine);
      let w = 0; r.trajectory.times.forEach((t, i) => { w = Math.max(w, Math.abs(r.trajectory.temperatureK.plate[i] - 293.15 - implicitRise(12, 5, 24, 0.004, t))); });
      errs.push(w);
    }
    console.log(`FEEDBACK constant-voltage R(T) vs implicit analytic: worst |ΔT error| at h = 1 / 0.5 / 0.25 s = ${errs.map((x) => x.toExponential(3)).join(' / ')} K (rise ${implicitRise(12, 5, 24, 0.004, 100).toFixed(3)} K)`);
    expect(errs[0] / errs[1]).toBeGreaterThan(1.8); expect(errs[1] / errs[2]).toBeGreaterThan(1.8);
  }, 120000);
  it('with cooling it settles at the separately derived equilibrium; constant voltage and near-constant current have opposite power–temperature slopes', async () => {
    const d = heaterD(); d.thermal.bodies[0].conductanceWPerK = 0.1; d.clock = { stopSeconds: 1500, stepSeconds: 1, eventToleranceSeconds: 1e-3 };
    const r = await runFeedback(heaterC(), d, engine);
    // G·x·R_ref·(1 + α·x) = V² with x = T − T_a (T_a = T_ref): α·G·R_ref·x² + G·R_ref·x − V² = 0
    const G = 0.1, a = 0.004 * G * 24, b = G * 24, x = (-b + Math.sqrt(b * b + 4 * a * 144)) / (2 * a);
    console.log(`FEEDBACK cooled equilibrium: ΔT ${(endT(r) - 293.15).toFixed(9)} K vs derived ${x.toFixed(9)} K`);
    expect(rel(endT(r) - 293.15, x)).toBeLessThan(1e-9);
    expect(r.solves[0].powersW.rh).toBeGreaterThan(r.solves[r.solves.length - 1].powersW.rh);   // CV: hotter → more ohms → less power
    const cc = await runFeedback(fixture('feedback-heater-cc.composition.json'), fixture('feedback-heater-cc.feedback.json'), engine);
    expect(cc.solves[cc.solves.length - 1].powersW.rh).toBeGreaterThan(cc.solves[0].powersW.rh);   // near-CC: hotter → more power
  }, 120000);
});

// ---------------------------------------------------------------- 3
describe('3 · the thermostat (NTC divider → comparator → heater, explicit hysteresis state)', () => {
  it('warms from below, switches off at T_high and on at T_low, and keeps cycling (≥ 3 full cycles)', async () => {
    const c = thermoC(), d = thermoD(); d.disturbances = []; d.clock.stopSeconds = 150;
    const r = await runFeedback(c, d, engine), res = switchResolutionK(r, d);
    expect(r.events.length).toBeGreaterThanOrEqual(6);
    r.events.forEach((e, i) => {
      expect(e.from).toBe(i % 2 === 0); expect(e.to).toBe(i % 2 !== 0);                   // heating → idle → heating …
      expect(Math.abs(e.temperatureK - (e.to ? d.controller!.lowK : d.controller!.highK)), `event ${i}`).toBeLessThanOrEqual(res);
      expect(e.bracket[1] - e.bracket[0]).toBeLessThanOrEqual(d.clock.eventToleranceSeconds);
    });
    const T = r.trajectory.temperatureK.plate, after = T.slice(r.trajectory.times.findIndex((t) => t >= r.events[0].t));
    expect(Math.max(...after)).toBeLessThanOrEqual(d.controller!.highK + res); expect(Math.min(...after)).toBeGreaterThanOrEqual(d.controller!.lowK - res);
    console.log(`FEEDBACK thermostat: ${r.events.length} switches in 150 s, ${r.solveCount} solves (${r.bisectionSolves} for event location), ${r.wallMs} ms; worst |T_switch − threshold| ${Math.max(...r.events.map((e) => Math.abs(e.temperatureK - (e.to ? 313.15 : 318.15)))).toExponential(2)} K ≤ resolution ${res.toExponential(2)} K`);
  }, 120000);
  it('refinement: switching times and energy totals converge (first order); extrema stay pinned at the thresholds', async () => {
    const runs: FeedbackRun[] = [];
    for (const h of [1, 0.5, 0.25]) { const d = thermoD(); d.disturbances = []; d.clock.stopSeconds = 140; d.clock.stepSeconds = h; runs.push(await runFeedback(thermoC(), d, engine)); }
    const n = Math.min(...runs.map((r) => r.events.length)), times = runs.map((r) => r.events.slice(0, n).map((e) => e.t));
    const dt = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
    const t1 = dt(times[0], times[1]), t2 = dt(times[1], times[2]);
    const w1 = Math.abs(runs[0].account.sourceWorkJ - runs[1].account.sourceWorkJ), w2 = Math.abs(runs[1].account.sourceWorkJ - runs[2].account.sourceWorkJ);
    const ext = runs.map((r) => r.events.slice(0, n).map((e) => e.temperatureK)), x1 = dt(ext[0], ext[1]), x2 = dt(ext[1], ext[2]);
    console.log(`FEEDBACK thermostat refinement (h = 1 / 0.5 / 0.25 s, ${n} switches): switch times differ ${t1.toExponential(3)} then ${t2.toExponential(3)} s (×${(t1 / t2).toFixed(2)}); source work ${w1.toExponential(3)} then ${w2.toExponential(3)} J (×${(w1 / w2).toFixed(2)}); switch temperatures ${x1.toExponential(2)} then ${x2.toExponential(2)} K`);
    expect(n).toBeGreaterThanOrEqual(6);
    expect(t1 / t2).toBeGreaterThan(1.8); expect(w1 / w2).toBeGreaterThan(1.8);
    const res = Math.max(...runs.map((r) => switchResolutionK(r, thermoD())));
    expect(x1).toBeLessThanOrEqual(2 * res); expect(x2).toBeLessThanOrEqual(2 * res);
  }, 240000);
  it('both initial states give the same trajectory from the same start; exactly at T_high a heating start stops at once; exactly at T_low an idle start stays idle', async () => {
    const run = async (initial: 'heating' | 'idle', T0 = 293.15, stop = 60) => {
      const d = thermoD(); d.disturbances = []; d.clock.stopSeconds = stop; d.controller!.initial = initial; d.thermal.bodies[0].initialTemperatureK = T0;
      return runFeedback(thermoC(), d, engine);
    };
    const h = await run('heating'), i = await run('idle');
    expect(i.events[0]).toMatchObject({ t: 0, from: false, to: true, located: false });  // idle below T_low: heating starts at once
    expect(i.trajectory.temperatureK.plate).toEqual(h.trajectory.temperatureK.plate);
    const atHigh = await run('heating', 318.15);
    expect(atHigh.events[0]).toMatchObject({ t: 0, from: true, to: false });           // equality at T_high = off
    const atLow = await run('idle', 313.15, 100);
    expect(atLow.events[0].t).toBeGreaterThan(0); expect(atLow.events[0].to).toBe(true); // equality at T_low stays idle; it heats only after cooling below
    expect(atLow.trajectory.temperatureK.plate[1]).toBeLessThan(313.15);
  }, 120000);
});

// ---------------------------------------------------------------- 4
describe('4 · an ambient disturbance (a thermal boundary change at a known time)', () => {
  it('ambient drops from 20 °C to 0 °C at 150 s: the controller keeps T between its thresholds and its duty cycle rises', async () => {
    const d = thermoD(), r = await runFeedback(thermoC(), d, engine), res = switchResolutionK(r, d);
    const duty = (a: number, b: number) => { let on = 0; for (const s of r.segments) { const lo = Math.max(a, s.t0), hi = Math.min(b, s.t1); if (hi > lo && s.heating) on += hi - lo; } return on / (b - a); };
    const before = duty(50, 150), after = duty(200, 300);
    console.log(`FEEDBACK disturbance: duty cycle ${before.toFixed(4)} before (50–150 s), ${after.toFixed(4)} after (200–300 s); expected mean heater balance G·(T_mid − T_a)/P ≈ ${(0.05 * (315.65 - 293.15) / 5.53).toFixed(3)} → ${(0.05 * (315.65 - 273.15) / 5.53).toFixed(3)}`);
    expect(after).toBeGreaterThan(before);
    const late = r.events.filter((e) => e.t > 150);
    expect(late.length).toBeGreaterThanOrEqual(4);
    for (const e of late) expect(Math.abs(e.temperatureK - (e.to ? 313.15 : 318.15))).toBeLessThanOrEqual(res);
  }, 120000);
});

// ---------------------------------------------------------------- 5
describe('5 · accounting, a linked heatsink, booking faults, state and failure handling', () => {
  it('source work = stored + ambient + outgoing (+ the electrical residual, reported); the thermal books close', async () => {
    const r = await runFeedback(thermoC(), thermoD(), engine), a = r.account;
    expect(Math.abs(a.compositeResidualJ)).toBeLessThanOrEqual(1e-9 * a.sourceWorkJ);
    expect(Math.abs(a.electricalResidualJ)).toBeLessThanOrEqual(1e-9 * a.sourceWorkJ);
    expect(Math.abs(a.routedJ + a.outgoingJ - Object.values(a.lossesJ).reduce((s, x) => s + x, 0))).toBeLessThanOrEqual(1e-12 * a.sourceWorkJ);
    expect(Math.abs(a.storedJ + a.ambientJ - a.routedJ)).toBeLessThanOrEqual(1e-12 * a.sourceWorkJ);
    console.log(`FEEDBACK accounting (thermostat, 300 s): source work ${a.sourceWorkJ.toFixed(6)} J = stored ${a.storedJ.toFixed(6)} + ambient ${a.ambientJ.toFixed(6)} + outgoing ${a.outgoingJ.toFixed(6)} (comparator + divider); composite residual ${a.compositeResidualJ.toExponential(2)} J; losses ${JSON.stringify(Object.fromEntries(Object.entries(a.lossesJ).map(([k, v]) => [k, +v.toFixed(6)])))}`);
  }, 120000);
  it('a plate linked to a heatsink: the internal transfer cancels and the composite still closes', async () => {
    const d = thermoD(); d.disturbances = [];
    d.thermal.bodies.push({ id: 'sink', heatCapacityJPerK: 50, initialTemperatureK: 293.15, ambientTemperatureK: 293.15, conductanceWPerK: 0.5 });
    d.thermal.links = [{ id: 'mount', a: 'plate', b: 'sink', conductanceWPerK: 0.2 }];
    const r = await runFeedback(thermoC(), d, engine), a = r.account;
    expect(Math.abs(a.linkNetJ)).toBeLessThanOrEqual(1e-12 * Math.abs(r.totals.linkJ.mount));
    expect(r.totals.linkJ.mount).toBeGreaterThan(0);
    expect(Math.abs(a.compositeResidualJ)).toBeLessThanOrEqual(1e-9 * a.sourceWorkJ);
    expect(r.events.length).toBeGreaterThanOrEqual(4);
  }, 120000);
  it('double booking and a missing loss are refused; a wrong mapping fails the audit (above)', async () => {
    const dup = thermoD(); dup.thermal.routes.push({ source: 'sn', receiver: null });
    expect(await cause(runFeedback(thermoC(), dup, engine))).toBe('duplicate-route');
    const missing = thermoD(); missing.thermal.routes = missing.thermal.routes.filter((x) => x.source !== 'c');
    expect(await cause(runFeedback(thermoC(), missing, engine))).toBe('unrouted-source');
  });
  it('whole vs split (Astra, d87c32c4): at an ordinary boundary, just after a switch, and at a switch coinciding with a disturbance — events, temperatures, controller, totals and the whole account identical', async () => {
    const c = thermoC();
    const base = (dist: FeedbackDescriptor['disturbances'] = []) => { const d = thermoD(); d.clock.stopSeconds = 60; d.disturbances = dist; return d; };
    for (const [pause, dist] of [[10, []], [28, []], [28, [{ atSeconds: 28, body: 'plate', ambientTemperatureK: 273.15 }]]] as const) {
      const d = base([...dist]);
      const whole = await runFeedback(c, d, engine), first = await runFeedback(c, d, engine, { untilSeconds: pause }), rest = await runFeedback(c, d, engine, { from: first.state });
      const label = `pause ${pause}${dist.length ? ' + disturbance' : ''}`;
      expect([...first.events, ...rest.events], label).toEqual(whole.events);
      expect(endT(rest), label).toBe(endT(whole));
      expect(rest.state.heating, label).toBe(whole.state.heating);
      expect(rest.totals, label).toEqual(whole.totals);
      expect(rest.account, label).toEqual(whole.account);                                // cumulative from 0, both
      expect(Math.abs(rest.account.compositeResidualJ), label).toBeLessThanOrEqual(1e-9 * rest.account.sourceWorkJ);
      expect(first.account.toSeconds).toBe(pause); expect(rest.runFromSeconds).toBe(pause);
      if (pause === 28) expect(first.events.map((e) => e.to)).toEqual([false]);           // the 27.036 s switch is resolved BEFORE the checkpoint
    }
    // the disturbance at the switch boundary is not lost by the rollback: the ambient ends at 0 °C and the run differs from one without it
    const withD = await runFeedback(c, base([{ atSeconds: 28, body: 'plate', ambientTemperatureK: 273.15 }]), engine), without = await runFeedback(c, base(), engine);
    expect((withD.state.stepper as { ambient: Record<string, number> }).ambient.plate).toBe(273.15);
    expect(withD.events.length).toBeGreaterThan(without.events.length - 1);
    expect(endT(withD)).not.toBe(endT(without));
  }, 240000);
  it('a standalone run stopping inside the first switch interval (28 s) ends with that switch located, not pending', async () => {
    const d = thermoD(); d.clock.stopSeconds = 28; d.disturbances = [];
    const r = await runFeedback(thermoC(), d, engine);
    expect(r.events.length).toBe(1);
    expect(r.events[0]).toMatchObject({ from: true, to: false, located: true });
    expect(r.events[0].t).toBeGreaterThan(27); expect(r.events[0].t).toBeLessThan(28);
    expect(r.state.heating).toBe(false);
    expect(r.segments[r.segments.length - 1]).toMatchObject({ t1: 28, heating: false });
    expect(Math.abs(r.account.compositeResidualJ)).toBeLessThanOrEqual(1e-9 * r.account.sourceWorkJ);
  }, 120000);
  it('a checkpoint resumes only its own composition and descriptor', async () => {
    const d = thermoD(); d.clock.stopSeconds = 20; d.disturbances = [];
    const first = await runFeedback(thermoC(), d, engine, { untilSeconds: 10 }), other = clone(d); other.controller!.highK = 319.15;
    expect(await cause(runFeedback(thermoC(), other, engine, { from: first.state }))).toBe('invalid-resume');
  }, 120000);
  it('a failed electrical solve stops the loop; a step too coarse for the hysteresis is refused', async () => {
    const dead: FeedbackEngine = { async run() { return {}; } };
    expect(await cause(runFeedback(thermoC(), thermoD(), dead))).toBe('solve-failed');
    const coarse = thermoD(); coarse.disturbances = []; coarse.clock.stepSeconds = 5; coarse.clock.stopSeconds = 60;
    expect(await cause(runFeedback(thermoC(), coarse, engine))).toBe('step-too-coarse');
  });
  it('a solver that answers with a previous deck\'s result is refused (stale-solve), never used; the reused instance is stateless across decks', async () => {
    // Found while building this: a second eecircuit instance in one process made the reused one return the PREVIOUS deck's result.
    // Every deck now carries its solve number on a tag source; a lagging answer is refused. Here a real engine is made to lag by one.
    let last: unknown = null;
    const lagging: FeedbackEngine = { async run(netlist: string, v: string[]) { const now = await engine.run(netlist, v), out = last ?? now; last = now; return out; } };
    const d = thermoD(); d.disturbances = []; d.clock.stopSeconds = 3;
    expect(await cause(runFeedback(thermoC(), d, lagging))).toBe('stale-solve');
    // and the shared instance itself: the same run twice, with other decks in between, gives identical solves
    const a = await runFeedback(thermoC(), d, engine);
    await runFeedback(heaterC(), { ...heaterD(), clock: oneStep }, engine);
    const b = await runFeedback(thermoC(), d, engine);
    expect(b.solves.map((s) => s.powersW)).toEqual(a.solves.map((s) => s.powersW));
  }, 120000);
});
