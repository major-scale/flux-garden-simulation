/**
 * THE SOLVED LAMP TRAJECTORY, and how it is read.
 *
 * Its own type, with named fields. Nothing transistor-shaped is stored in the RLC transient's
 * `currentAmps` or `capacitorVolts` — Astra's point, agreed in the plan: those names carry a
 * topology, and reusing them would be a lie about what the number is.
 *
 * THE SIGN CONVENTION IS MIXED, AND NAMED: the two currents that ENTER the device are stated
 * into their terminals, the one that LEAVES is stated out of its terminal — the way current
 * actually goes through a low-side switch, in at drain and gate, out at source to ground:
 *   drainAmps  = −i(Vdd)   INTO the drain (through the lamp from the supply)
 *   gateAmps   = −i(Vg)    INTO the gate (through RG from the control source)
 *   sourceAmps = +i(Vsrc)  OUT of the source terminal to ground
 * so KCL for the whole device reads drainAmps + gateAmps − sourceAmps = 0, and the source leg
 * on screen carries sourceAmps — not drainAmps reused, which would be wrong while the gate charges. The signs follow
 * SPICE's convention — i(V) is the current entering the source's positive terminal — and were
 * checked against `(v(c) − v(g)) / RG` before being trusted, because a sign here would put the
 * control current on screen backwards.
 */
import { LAMP_NODES, gateAtStart, gateEdges, type LampDescription, type MosfetSpec } from './lamp-netlist';
import { readGrid, locate, SolveFault, type RawResult } from './grid';

export interface LampSnapshot {
  timeSeconds: number;
  supplyVolts: number;
  drainVolts: number;
  gateVolts: number;
  controlVolts: number;
  /** Into the drain terminal, A. */
  drainAmps: number;
  /** Into the gate terminal, A: the control current, which is gate CHARGING current. */
  gateAmps: number;
  /** Out of the source terminal to ground, A. */
  sourceAmps: number;
}

export interface LampTransient {
  topology: 'lamp';
  times: Float64Array;
  supplyVolts: Float64Array;
  drainVolts: Float64Array;
  gateVolts: Float64Array;
  controlVolts: Float64Array;
  drainAmps: Float64Array;
  gateAmps: Float64Array;
  sourceAmps: Float64Array;
  /** The circuit as described: the lamp reading needs R and the nominal supply. */
  lampOhms: number;
  gateOhms: number;
  nominalSupplyVolts: number;
  mosfet: MosfetSpec;
  /** The gate programme's value at t = 0 — the one authored fact about the starting state. */
  gateAtStartVolts: number;
  stopSeconds: number;
  requestedStopSeconds: number;
  requestedStepSeconds: number;
  actualStepSeconds: { min: number; median: number; max: number };
  /** Finite PWL transitions, so lookup can flag a sample inside one. */
  edges: { atSeconds: number; edgeSeconds: number }[];
  engine: string;
}

const N = LAMP_NODES;
const REQUIRED = ['time', `v(${N.supply})`, `v(${N.drain})`, `v(${N.gate})`, `v(${N.control})`,
  'i(vdd)', 'i(vg)', 'i(vsrc)'] as const;

export function toLampTransient(raw: RawResult, c: LampDescription, engine: string): LampTransient {
  const { times, pick, reached, actualStepSeconds } = readGrid(raw, REQUIRED, c);
  // THE RUN STARTS AT ZERO EXACTLY. Without `uic` ngspice computes the operating point and its
  // first sample is t = 0; that sample IS the starting state and is shown as such. A first
  // sample after zero would mean the deck was solved some other way than described.
  if (times[0] !== 0)
    throw new SolveFault(`The first sample is at ${times[0].toExponential(4)} s; a lamp run `
      + `starts from its operating point at exactly 0 s.`);
  const neg = (v: Float64Array): Float64Array => { const o = new Float64Array(v.length); for (let k = 0; k < v.length; k++) o[k] = -v[k] + 0; return o; };
  return {
    topology: 'lamp', times,
    supplyVolts: pick(`v(${N.supply})`), drainVolts: pick(`v(${N.drain})`),
    gateVolts: pick(`v(${N.gate})`), controlVolts: pick(`v(${N.control})`),
    drainAmps: neg(pick('i(vdd)')), gateAmps: neg(pick('i(vg)')), sourceAmps: pick('i(vsrc)'),
    lampOhms: c.lampOhms, gateOhms: c.gateOhms, nominalSupplyVolts: c.supplyVolts,
    mosfet: { ...c.mosfet }, gateAtStartVolts: gateAtStart(c.gate),
    stopSeconds: reached, requestedStopSeconds: c.stopSeconds, requestedStepSeconds: c.stepSeconds,
    actualStepSeconds, edges: gateEdges(c.gate), engine,
  };
}

/**
 * Read the trajectory at an instant. LINEAR between samples, as the RLC lookup is, and for the
 * same reason: inside a PWL edge the source really is moving between corners. `onEdge` says the
 * sample is inside a programmed transition, where the trajectory turns fastest.
 */
export function sampleLampAt(t: LampTransient, timeSeconds: number):
    LampSnapshot & { clampedToHorizon: boolean; onEdge: boolean; requestedTimeSeconds: number } {
  const times = t.times;
  const { lo, hi, f, clamped } = locate(times, timeSeconds);
  let onEdge = false;
  for (const e of t.edges) {
    const a = e.atSeconds, b = a + e.edgeSeconds;
    if (times[lo] < b && times[hi] > a) { onEdge = true; break; }
  }
  const at = (arr: Float64Array) => arr[lo] + (arr[hi] - arr[lo]) * f;
  return {
    timeSeconds: at(times),
    supplyVolts: at(t.supplyVolts), drainVolts: at(t.drainVolts),
    gateVolts: at(t.gateVolts), controlVolts: at(t.controlVolts),
    drainAmps: at(t.drainAmps), gateAmps: at(t.gateAmps), sourceAmps: at(t.sourceAmps),
    clampedToHorizon: clamped, onEdge, requestedTimeSeconds: timeSeconds,
  };
}
