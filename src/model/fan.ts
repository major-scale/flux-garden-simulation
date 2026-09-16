/**
 * THE TEMPERATURE-CONTROLLED MOTOR — the smaller-model trial's composition, READ, never modelled.
 *
 * The circuit is `tools/conformance/trial/fan.composition.json`, authored by the builder model
 * against the frozen expectation set and accepted by Astra (fan-trial-dcca855b). This module does
 * not re-describe it: it imports that JSON, solves it through the same structure the conformance
 * kit checks, and reads the solved observables by name. What it adds is reader-side:
 *   θ(t) = ∫ω dt by trapezoid on the solver's grid (the rotor's angle — the model has no θ node);
 *   the comparator's decision as the solved switch state (the hysteresis walk every bench uses);
 *   the MOSFET region from V_GS, V_DS and V_TO of the declared level-1 model (a label);
 *   the motor PORT energy balance, every term integrated from the same trajectory.
 * The load is a DECLARED inertia and linear viscous drag. The rotor on screen is an illustration
 * of that load; no aerodynamic torque, airflow or heat transfer exists anywhere in the model, and
 * the sensor's temperature is the PRESCRIBED programme — nothing the motor does reaches it.
 */
import composition from '../../tools/conformance/trial/fan.composition.json';
import type { Composition, PartInstance } from './conformance/composition';
import { sampleComposition, type CompositionTransient } from './spice/composition-transient';
import { switchStates } from './spice/controls-transient';
import { comparatorThresholdVolts, ntcOhms, type NtcSpec, type MosfetSpec, type ComparatorSpec, type DcMotorSpec, type RotationalLoadSpec } from './spice/parts';

export const FAN_COMPOSITION = composition as unknown as Composition;

// ---------------------------------------------------------------- the editable experiment (2026-09-10 batch)
/**
 * WHAT MAY BE EDITED. The page's experiment is a deep copy of the accepted trial composition with exactly two
 * knobs: the supply voltage of the `vdd` source (this circuit's ONE rail — the sensing divider, the reference,
 * the comparator and the motor all hang on it, so it is the circuit supply, not an isolated motor rail) and the
 * prescribed temperature programme. Nothing else — no rewiring, no part values — because the adapter in this
 * module assumes the trial's exact port wiring and zero constant load torque (Astra's correction 4).
 */
export const FAN_SUPPLY_VOLTS = { min: 3, max: 9, default: 6 };
/**
 * THE VERIFIED SUPPLY SETTINGS — the only voltages the control offers. Every 0.25 V step from 3 to 9 V was solved
 * in both programmes on the WASM engine this page runs (`tools/evidence/fan/supply-scan.mjs` → `supply-scan.json`)
 * and checked against FAN_DOMAIN; 7.50 V is EXCLUDED because its warm-then-cool run's turn-off transient reaches
 * −1.095 mA, past the −1 mA floor adopted from the trial (an OBSERVED solver transient at turn-off on this engine,
 * not monotone in voltage — 7.25 V gives −0.996 mA and 7.75 V −0.729 mA — and not independently established as a
 * numerical artefact). The list is the verification's result, not a claim about voltages between the steps or
 * about other engines' grids.
 */
export const FAN_SUPPLY_SETTINGS: readonly number[] = Object.freeze(Array.from({ length: 25 }, (_, k) => 3 + k * 0.25).filter((v) => Math.abs(v - 7.5) > 1e-9));
export const isSupportedSupply = (v: number): boolean => FAN_SUPPLY_SETTINGS.some((x) => Math.abs(x - v) < 1e-9);
/** The trajectory domain the page REFUSES to leave, adopted from the trial's frozen bounds (not certified by them). */
export const FAN_DOMAIN = { minAmps: -0.001, maxAmps: 3.1, minOmega: -0.001, maxOmega: 30 };
export type FanProgramme = 'cycle' | 'hold-warm';
export const FAN_PROGRAMMES: Record<FanProgramme, { label: string; blurb: string; points: { atSeconds: number; value: number }[] }> = {
  cycle: { label: 'Warm, then cool', blurb: 'The trial\'s cycle: cold at 10 °C, warm to 45 °C from 0.1 s, hold, cool from 0.7 s. The motor switches on, runs, switches off and coasts.',
    points: [{ atSeconds: 0, value: 10 }, { atSeconds: 0.1, value: 10 }, { atSeconds: 0.3, value: 45 }, { atSeconds: 0.7, value: 45 }, { atSeconds: 0.9, value: 10 }, { atSeconds: 1.2, value: 10 }] },
  'hold-warm': { label: 'Hold warm', blurb: 'Cold start at 10 °C, the same ramp to 45 °C from 0.1 s, then HELD warm to the end: the motor spins up from rest and settles to a steady speed you can compare across supply voltages.',
    points: [{ atSeconds: 0, value: 10 }, { atSeconds: 0.1, value: 10 }, { atSeconds: 0.3, value: 45 }, { atSeconds: 1.2, value: 45 }] },
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export function supplyVoltsOf(c: Composition): number { const src = c.sources.find((x) => x.name === 'vdd'); return src && src.kind === 'dc' ? src.volts : NaN; }
export function programmeOf(c: Composition): FanProgramme | null {
  const env = (c.environments ?? []).find((e) => e.name === 'temp'); if (!env) return null;
  for (const [id, p] of Object.entries(FAN_PROGRAMMES)) if (JSON.stringify(env.points) === JSON.stringify(p.points)) return id as FanProgramme;
  return null;
}
export function withSupplyVolts(c: Composition, volts: number): Composition {
  const next = clone(c); const src = next.sources.find((x) => x.name === 'vdd');
  if (!src || src.kind !== 'dc') throw new Error('The composition has no DC source named "vdd"');
  src.volts = volts; return next;
}
export function withProgramme(c: Composition, id: FanProgramme): Composition {
  const next = clone(c); const env = (next.environments ?? []).find((e) => e.name === 'temp');
  if (!env) throw new Error('The composition has no environment named "temp"');
  env.points = clone(FAN_PROGRAMMES[id].points); return next;
}
/**
 * The ONLY compositions this page accepts: the accepted base circuit with the supply inside the supported range and
 * a known programme; anything else differing from the base — a rewired port, a changed part value, a different
 * analysis — is refused by name. Structural validation (`buildStructure`) still runs on the result at solve time.
 */
export function assertSupportedFan(c: Composition, base: Composition = FAN_COMPOSITION): { volts: number; programme: FanProgramme } {
  const volts = supplyVoltsOf(c);
  if (!Number.isFinite(volts) || volts < FAN_SUPPLY_VOLTS.min || volts > FAN_SUPPLY_VOLTS.max) throw new Error(`Supply ${volts} V is outside the supported ${FAN_SUPPLY_VOLTS.min}–${FAN_SUPPLY_VOLTS.max} V`);
  if (!isSupportedSupply(volts)) throw new Error(`Supply ${volts} V is not one of the verified settings (0.25 V steps from ${FAN_SUPPLY_VOLTS.min} to ${FAN_SUPPLY_VOLTS.max} V, except 7.50 V — see the model notes)`);
  const programme = programmeOf(c);
  if (!programme) throw new Error('The temperature programme is not one of the page\'s programmes (Warm, then cool / Hold warm)');
  const normalised = withProgramme(withSupplyVolts(c, supplyVoltsOf(base)), programmeOf(base) ?? 'cycle');
  if (JSON.stringify(normalised) !== JSON.stringify(base)) throw new Error('This page only accepts the accepted trial circuit with a different supply voltage or temperature programme; the loaded composition differs elsewhere (wiring, part values or analysis)');
  return { volts, programme };
}

/** The instances this page reads, resolved by NAME and KIND from the composition — a mismatch is a refusal, not a guess. */
export interface FanParts {
  ntc: { name: string; spec: NtcSpec }; bleeder: { name: string }; pot: { name: string; wiperFraction: number; totalOhms: number };
  comparator: { name: string; spec: ComparatorSpec }; mosfet: { name: string; spec: MosfetSpec };
  motor: { name: string; motor: DcMotorSpec; load: RotationalLoadSpec }; diode: { name: string };
  supply: { name: string; volts: number }; environment: { name: string; node: string; points: { atSeconds: number; value: number }[] };
}
export function fanParts(c: Composition = FAN_COMPOSITION): FanParts {
  const part = <K extends PartInstance['kind']>(name: string, kind: K): Extract<PartInstance, { kind: K }> => {
    const p = c.parts.find((x) => x.name === name);
    if (!p || p.kind !== kind) throw new Error(`The composition has no ${kind} named ${JSON.stringify(name)}`);
    return p as Extract<PartInstance, { kind: K }>;
  };
  const s = part('s', 'ntc'), p = part('p', 'pot'), cmp = part('c', 'comparator'), q = part('q', 'mosfet'), m = part('m', 'motor');
  const src = c.sources.find((x) => x.name === 'vdd');
  if (!src || src.kind !== 'dc') throw new Error('The composition has no DC source named "vdd"');
  const env = (c.environments ?? []).find((e) => e.name === 'temp');
  if (!env) throw new Error('The composition has no environment named "temp"');
  return { ntc: { name: s.name, spec: s.spec }, bleeder: { name: part('rb', 'resistor').name }, pot: { name: p.name, wiperFraction: p.spec.wiperFraction, totalOhms: p.spec.totalOhms },
    comparator: { name: cmp.name, spec: cmp.spec }, mosfet: { name: q.name, spec: q.spec }, motor: { name: m.name, motor: m.spec.motor, load: m.spec.load },
    diode: { name: part('fw', 'diode').name }, supply: { name: src.name, volts: src.volts }, environment: env };
}

export interface FanTransient extends CompositionTransient {
  parts: FanParts;
  /** ∫ω dt from rest at t = 0, trapezoid on the solver's own grid. */
  thetaRad: Float64Array;
  /** The comparator's high-side switch state per sample. */
  high: Uint8Array;
  /** The environment's ramps, for the "ramping" tag. */
  edges: { atSeconds: number; edgeSeconds: number }[];
}
export function toFanTransient(t: CompositionTransient): FanTransient {
  const parts = fanParts(t.composition);
  const omega = t.series[`${parts.motor.name}.omega`];
  const theta = new Float64Array(t.times.length);
  for (let k = 1; k < t.times.length; k++) theta[k] = theta[k - 1] + 0.5 * (omega[k] + omega[k - 1]) * (t.times[k] - t.times[k - 1]);
  const edges: FanTransient['edges'] = [];
  const pts = parts.environment.points;
  for (let k = 1; k < pts.length; k++) if (pts[k - 1].value !== pts[k].value) edges.push({ atSeconds: pts[k - 1].atSeconds, edgeSeconds: pts[k].atSeconds - pts[k - 1].atSeconds });
  return { ...t, parts, thetaRad: theta, high: switchStates(t.series[`${parts.comparator.name}.control`]), edges };
}

/** Gate current from the comparator's solved output stage: through R_out from the stage node, less the leak to ground. */
export function gateCurrentAt(P: FanParts, vop: number, vgate: number): number {
  return (vop - vgate) / P.comparator.spec.rOutOhms - vgate / P.comparator.spec.leakOhms;
}
/** The whole gate-current series, for scales and checks. */
export function gateCurrentSeries(t: FanTransient): Float64Array {
  const P = t.parts, vop = t.series[`${P.comparator.name}.vop`], vg = t.series[`${P.mosfet.name}.vgate`], out = new Float64Array(t.times.length);
  for (let k = 0; k < out.length; k++) out[k] = gateCurrentAt(P, vop[k], vg[k]);
  return out;
}

export interface FanSnapshot {
  timeSeconds: number; requestedTimeSeconds: number; clampedToHorizon: boolean; onEdge: boolean;
  temperatureC: number;
  supplyVolts: number; senseVolts: number; referenceVolts: number; gateVolts: number; motorLowVolts: number;
  /** Currents, SI, by where they go (SPICE probe signs turned into circuit signs). */
  supplyAmps: number; sensorAmps: number; bleederAmps: number; potAmps: number; comparatorStageAmps: number;
  motorAmps: number; windingAmps: number; mosfetSourceAmps: number; diodeAmps: number;
  /**
   * The MOSFET's three terminal currents, DISTINCT (Astra's return fan-trial-1968f486: the gate current peaks at
   * 34 mA while the comparator charges the gate — not picoamps). `mosfetGateAmps` is read from the solved output
   * stage that exists in the deck: (v(c_op) − v(gate))/R_out − v(gate)/R_leak, the current the comparator's
   * output resistor delivers to the gate node less what its leak takes; `mosfetDrainAmps` = source − gate by
   * KCL at the device (into D and G, out of S). No deck change; the comparator's SUPPLY current is not its
   * output current while sinking, so it is not used here.
   */
  mosfetGateAmps: number; mosfetDrainAmps: number;
  /** The comparator's ground-pin current, signed out of the pin: supply − output. During discharge the stage sinks the gate's charge to ground; while sourcing it is the leak. DERIVED by KCL at the stage, not probed. */
  comparatorGroundAmps: number;
  omegaRadPerS: number; thetaRad: number;
  /** The solved comparator decision at the nearest sample. */
  high: boolean;
}
export function sampleFanAt(t: FanTransient, timeSeconds: number): FanSnapshot {
  const s = sampleComposition(t, timeSeconds), P = t.parts;
  const gate = gateCurrentAt(P, s.at(`${P.comparator.name}.vop`), s.at(`${P.mosfet.name}.vgate`));
  let onEdge = false;
  for (const e of t.edges) if (t.times[s.lo] < e.atSeconds + e.edgeSeconds && t.times[s.hi] > e.atSeconds) { onEdge = true; break; }
  return {
    timeSeconds: s.timeSeconds, requestedTimeSeconds: s.requestedTimeSeconds, clampedToHorizon: s.clampedToHorizon, onEdge,
    temperatureC: s.at(`${P.environment.name}.value`),
    supplyVolts: s.at(`${P.motor.name}.vplus`), senseVolts: s.at(`${P.ntc.name}.vb`), referenceVolts: s.at(`${P.pot.name}.vw`),
    gateVolts: s.at(`${P.mosfet.name}.vgate`), motorLowVolts: s.at(`${P.motor.name}.vminus`),
    supplyAmps: -s.at(`${P.supply.name}.current`), sensorAmps: s.at(`${P.ntc.name}.current`), bleederAmps: s.at(`${P.bleeder.name}.current`),
    potAmps: s.at(`${P.pot.name}.currentA`), comparatorStageAmps: s.at(`${P.comparator.name}.supplyCurrent`),
    motorAmps: s.at(`${P.motor.name}.current`), windingAmps: s.at(`${P.motor.name}.windingCurrent`), mosfetSourceAmps: s.at(`${P.mosfet.name}.sourceCurrent`),
    diodeAmps: s.at(`${P.diode.name}.current`), omegaRadPerS: s.at(`${P.motor.name}.omega`), thetaRad: t.thetaRad[s.lo] + (t.thetaRad[s.hi] - t.thetaRad[s.lo]) * s.f,
    mosfetGateAmps: gate, mosfetDrainAmps: s.at(`${P.mosfet.name}.sourceCurrent`) - gate,
    comparatorGroundAmps: s.at(`${P.comparator.name}.supplyCurrent`) - gate,
    high: s.nearest(t.high) === 1,
  };
}

export interface FanReading {
  sensorOhmsSolved: number; sensorOhmsLaw: number;
  differenceVolts: number; thresholdVolts: number; insideBand: boolean;
  gateSourceVolts: number; drainSourceVolts: number; region: 'off' | 'triode' | 'saturation';
  backEmfVolts: number; torqueNm: number;
  /** The motor's TERMINAL voltage (v+ − v−), the power it absorbs at those terminals (V·I, a measured consequence of the supply setting), and the shaft in RPM. */
  terminalVolts: number; terminalWatts: number; rpm: number;
}
export function fanReading(f: FanSnapshot, P: FanParts): FanReading {
  const sensorV = f.supplyVolts - f.senseVolts;
  const vgs = f.gateVolts, vds = f.motorLowVolts, vto = P.mosfet.spec.vto;
  return {
    sensorOhmsSolved: Math.abs(f.sensorAmps) > 1e-15 ? sensorV / f.sensorAmps : Infinity, sensorOhmsLaw: ntcOhms(f.temperatureC, P.ntc.spec),
    differenceVolts: f.senseVolts - f.referenceVolts, thresholdVolts: comparatorThresholdVolts(P.comparator.spec),
    insideBand: Math.abs(f.senseVolts - f.referenceVolts) <= comparatorThresholdVolts(P.comparator.spec),
    gateSourceVolts: vgs, drainSourceVolts: vds, region: vgs <= vto ? 'off' : vds < vgs - vto ? 'triode' : 'saturation',
    backEmfVolts: P.motor.motor.kVsPerRad * f.omegaRadPerS, torqueNm: P.motor.motor.kVsPerRad * f.windingAmps,
    terminalVolts: f.supplyVolts - f.motorLowVolts, terminalWatts: (f.supplyVolts - f.motorLowVolts) * f.motorAmps, rpm: f.omegaRadPerS * 60 / (2 * Math.PI),
  };
}

/** The MOTOR PORT balance from the trajectory: input = heat + Δmagnetic + Δkinetic + drag (constant torque is declared zero). Residual printed, never absorbed. */
export interface FanEnergy { times: Float64Array; input: Float64Array; heat: Float64Array; drag: Float64Array; magnetic: Float64Array; kinetic: Float64Array; residual: Float64Array; relativeAtEnd: number }
export function fanEnergy(t: FanTransient): FanEnergy {
  const P = t.parts, m = P.motor.motor, l = P.motor.load, n = t.times.length;
  const i = t.series[`${P.motor.name}.current`], w = t.series[`${P.motor.name}.omega`], vp = t.series[`${P.motor.name}.vplus`], vn = t.series[`${P.motor.name}.vminus`];
  const cum = (f: (k: number) => number): Float64Array => { const out = new Float64Array(n); let acc = 0, prev = f(0); for (let k = 1; k < n; k++) { const cur = f(k); acc += 0.5 * (prev + cur) * (t.times[k] - t.times[k - 1]); out[k] = acc; prev = cur; } return out; };
  const state = (f: (k: number) => number): Float64Array => { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = f(k); return out; };
  const input = cum((k) => (vp[k] - vn[k]) * i[k]), heat = cum((k) => m.resistanceOhms * i[k] * i[k]), drag = cum((k) => l.viscousNmS * w[k] * w[k]);
  const magnetic = state((k) => 0.5 * m.inductanceHenries * i[k] * i[k]), kinetic = state((k) => 0.5 * l.inertiaKgM2 * w[k] * w[k]);
  const residual = state((k) => input[k] - heat[k] - drag[k] - (magnetic[k] - magnetic[0]) - (kinetic[k] - kinetic[0]));
  const e = n - 1, scale = Math.max(1e-9, Math.abs(input[e]) + Math.abs(heat[e]) + Math.abs(drag[e]) + Math.abs(magnetic[e] - magnetic[0]) + Math.abs(kinetic[e] - kinetic[0]));
  return { times: t.times, input, heat, drag, magnetic, kinetic, residual, relativeAtEnd: Math.abs(residual[e]) / scale };
}

/** The supported domain of THIS trajectory, reported as facts: what was checked and what was seen. */
export interface FanDomain { ok: boolean; reason: string | null; crossings: { atSeconds: number; to: 'high' | 'low' }[]; minMotorAmps: number; maxMotorAmps: number; minOmega: number; maxOmega: number; temperatureRange: [number, number] }
export function fanDomain(t: FanTransient): FanDomain {
  const P = t.parts, [dlo, dhi] = P.ntc.spec.celsiusDomain, temp = t.series[`${P.environment.name}.value`];
  let tlo = Infinity, thi = -Infinity; for (let k = 0; k < temp.length; k++) { if (temp[k] < tlo) tlo = temp[k]; if (temp[k] > thi) thi = temp[k]; }
  const i = t.series[`${P.motor.name}.current`], w = t.series[`${P.motor.name}.omega`];
  let imin = Infinity, wmin = Infinity; for (let k = 0; k < i.length; k++) { if (i[k] < imin) imin = i[k]; if (w[k] < wmin) wmin = w[k]; }
  const crossings: FanDomain['crossings'] = [];
  for (let k = 1; k < t.high.length; k++) if (t.high[k] !== t.high[k - 1]) crossings.push({ atSeconds: t.times[k], to: t.high[k] === 1 ? 'high' : 'low' });
  const sense = t.series[`${P.ntc.name}.vb`], ref = t.series[`${P.pot.name}.vw`], th = comparatorThresholdVolts(P.comparator.spec);
  let imax = -Infinity, wmax = -Infinity; for (let k = 0; k < i.length; k++) { if (i[k] > imax) imax = i[k]; if (w[k] > wmax) wmax = w[k]; }
  let reason: string | null = null;
  if (tlo < dlo || thi > dhi) reason = `The prescribed temperature ${tlo.toFixed(1)}…${thi.toFixed(1)} °C leaves the thermistor's declared domain ${dlo}…${dhi} °C.`;
  else if (Math.abs(sense[0] - ref[0]) <= th) reason = `The run starts inside the comparator's ±${th} V band; its initial state would be the solver's, not the circuit's.`;
  else if (imin < FAN_DOMAIN.minAmps || imax > FAN_DOMAIN.maxAmps) reason = `The motor current ${imin.toFixed(4)}…${imax.toFixed(3)} A leaves the declared domain ${FAN_DOMAIN.minAmps}…${FAN_DOMAIN.maxAmps} A (adopted from the trial's bounds).`;
  else if (wmin < FAN_DOMAIN.minOmega || wmax > FAN_DOMAIN.maxOmega) reason = `The shaft speed ${wmin.toFixed(4)}…${wmax.toFixed(2)} rad/s leaves the declared domain ${FAN_DOMAIN.minOmega}…${FAN_DOMAIN.maxOmega} rad/s (adopted from the trial's bounds).`;
  return { ok: reason === null, reason, crossings, minMotorAmps: imin, maxMotorAmps: imax, minOmega: wmin, maxOmega: wmax, temperatureRange: [tlo, thi] };
}
