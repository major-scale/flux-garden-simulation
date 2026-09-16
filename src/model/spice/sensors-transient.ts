/**
 * THE SOLVED SENSING TRAJECTORY. Currents by where they go:
 *   supplyAmps    = −i(Vcc)   out of the supply (divider + reference + comparator output stage)
 *   dividerAmps   = +i(Vdiv)  into the sensor divider's top
 *   refInAmps     = +i(Vap)   into the reference pot's end A
 *   outStageAmps  = +i(Vcp)   from Vcc into the comparator's high-side switch (the LED's path)
 *   ledAmps       = +i(Vdl)   anode → cathode
 * The comparator's DECISION is read as the solved HIGH-side switch state: `switchStates` on its
 * control node with the SW model's own VT/VH — the same walk the controls bench uses. It is a
 * nearest-sample state, and it is called that.
 */
import { SENSORS_NODES, type SensorsDescription } from './sensors-netlist';
import { readGrid, locate, SolveFault, type RawResult } from './grid';
import { switchStates } from './controls-transient';

export interface SensorsSnapshot {
  timeSeconds: number;
  environment: number;
  supplyVolts: number; vinVolts: number; vrefVolts: number; opVolts: number; outVolts: number; ledAnodeVolts: number; controlVolts: number;
  supplyAmps: number; dividerAmps: number; refInAmps: number; outStageAmps: number; ledAmps: number;
  /** The solved high-side switch state at the nearest sample: the comparator's decision. */
  high: boolean;
  /** The SOLVED sensor resistance: its voltage over the divider current (not the law re-evaluated). */
  sensorOhmsSolved: number;
}
export interface SensorsTransient {
  topology: 'sensors';
  times: Float64Array;
  environment: Float64Array;
  supplyVolts: Float64Array; vinVolts: Float64Array; vrefVolts: Float64Array; opVolts: Float64Array; outVolts: Float64Array; ledAnodeVolts: Float64Array; controlVolts: Float64Array;
  supplyAmps: Float64Array; dividerAmps: Float64Array; refInAmps: Float64Array; outStageAmps: Float64Array; ledAmps: Float64Array;
  high: Uint8Array;
  description: SensorsDescription;
  stopSeconds: number; requestedStopSeconds: number; requestedStepSeconds: number;
  actualStepSeconds: { min: number; median: number; max: number };
  edges: { atSeconds: number; edgeSeconds: number }[];
  engine: string;
}
const N = SENSORS_NODES;
const REQUIRED = ['time', `v(${N.env})`, `v(${N.vcc})`, `v(${N.vin})`, `v(${N.vref})`, `v(${N.op})`, `v(${N.out})`, `v(${N.ledAnode})`, `v(${N.ctl})`,
  'i(vcc)', 'i(vdiv)', 'i(vap)', `i(${N.comparatorProbe})`, 'i(vdl)'] as const;

export function toSensorsTransient(raw: RawResult, c: SensorsDescription, engine: string): SensorsTransient {
  const { times, pick, reached, actualStepSeconds } = readGrid(raw, REQUIRED, c);
  if (times[0] !== 0) throw new SolveFault(`The first sample is at ${times[0].toExponential(4)} s; a sensing run starts from its operating point at exactly 0 s.`);
  const neg = (v: Float64Array) => { const o = new Float64Array(v.length); for (let k = 0; k < v.length; k++) o[k] = -v[k] + 0; return o; };
  const ctl = pick(`v(${N.ctl})`);
  const edges: SensorsTransient['edges'] = [];
  for (let k = 1; k < c.environment.length; k++) {
    const a = c.environment[k - 1], b = c.environment[k];
    if (a.value !== b.value) edges.push({ atSeconds: a.atSeconds, edgeSeconds: b.atSeconds - a.atSeconds });
  }
  return {
    topology: 'sensors', times, environment: pick(`v(${N.env})`),
    supplyVolts: pick(`v(${N.vcc})`), vinVolts: pick(`v(${N.vin})`), vrefVolts: pick(`v(${N.vref})`), opVolts: pick(`v(${N.op})`), outVolts: pick(`v(${N.out})`),
    ledAnodeVolts: pick(`v(${N.ledAnode})`), controlVolts: ctl,
    supplyAmps: neg(pick('i(vcc)')), dividerAmps: pick('i(vdiv)'), refInAmps: pick('i(vap)'), outStageAmps: pick(`i(${N.comparatorProbe})`), ledAmps: pick('i(vdl)'),
    high: switchStates(ctl), description: c,
    stopSeconds: reached, requestedStopSeconds: c.stopSeconds, requestedStepSeconds: c.stepSeconds, actualStepSeconds, edges, engine,
  };
}

export function sampleSensorsAt(t: SensorsTransient, timeSeconds: number):
    SensorsSnapshot & { clampedToHorizon: boolean; onEdge: boolean; requestedTimeSeconds: number } {
  const { lo, hi, f, clamped } = locate(t.times, timeSeconds);
  let onEdge = false;
  for (const e of t.edges) if (t.times[lo] < e.atSeconds + e.edgeSeconds && t.times[hi] > e.atSeconds) { onEdge = true; break; }
  const at = (a: Float64Array) => a[lo] + (a[hi] - a[lo]) * f;
  const vin = at(t.vinVolts), vcc = at(t.supplyVolts), idiv = at(t.dividerAmps);
  const lower = t.description.sensor.kind === 'ldr';
  const sensorV = lower ? vin : vcc - vin;
  return {
    timeSeconds: at(t.times), environment: at(t.environment), supplyVolts: vcc, vinVolts: vin, vrefVolts: at(t.vrefVolts), opVolts: at(t.opVolts),
    outVolts: at(t.outVolts), ledAnodeVolts: at(t.ledAnodeVolts), controlVolts: at(t.controlVolts),
    supplyAmps: at(t.supplyAmps), dividerAmps: idiv, refInAmps: at(t.refInAmps), outStageAmps: at(t.outStageAmps), ledAmps: at(t.ledAmps),
    high: t.high[f < 0.5 ? lo : hi] === 1, sensorOhmsSolved: Math.abs(idiv) > 1e-15 ? sensorV / idiv : Infinity,
    clampedToHorizon: clamped, onEdge, requestedTimeSeconds: timeSeconds,
  };
}
