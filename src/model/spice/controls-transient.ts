/**
 * THE SOLVED CONTROLS TRAJECTORY. Currents named by where they go:
 *   sourceAmps = −i(Vdd)   out of the supply, through the toggle
 *   potInAmps  = +i(Vap)   into the pot's end A  (probe `Vap na p_a`: current entering `na` side)
 *   wiperAmps  = +i(Vwp)   out of the wiper toward W (probe `Vwp p_w nw`)
 *   legBAmps   = potInAmps − wiperAmps   through R_WB to ground (KCL at the track node)
 *   ledAmps    = +i(Vdl)   anode → cathode through the LED (probe in its cathode lead)
 * KCL at W: wiperAmps = ledAmps (the series resistor carries the wiper current), at every sample.
 */
import { CONTROLS_NODES, type ControlsDescription } from './controls-netlist';
import { readGrid, locate, SolveFault, type RawResult } from './grid';

/**
 * THE SWITCH STATE IS DERIVED THE WAY THE SOLVED SWITCH MODEL DECIDES IT — with its hysteresis:
 * `SW(VT=0.5 VH=0.1)` closes when the control RISES past VT + VH = 0.6 and opens when it FALLS
 * below VT − VH = 0.4. A first version read `control ≥ 0.5`, which called the switch CLOSED at
 * 5.275 ms (control 0.55) while the solver still had it open — Astra's catch. It is a DISCRETE
 * state per solver sample, walked from the operating point, and is never interpolated.
 */
export function switchStates(control: Float64Array, vt = 0.5, vh = 0.1): Uint8Array {
  const out = new Uint8Array(control.length);
  let closed = control[0] > vt + vh;
  for (let k = 0; k < control.length; k++) {
    if (!closed && control[k] > vt + vh) closed = true;
    else if (closed && control[k] < vt - vh) closed = false;
    out[k] = closed ? 1 : 0;
  }
  return out;
}

export interface ControlsSnapshot {
  timeSeconds: number;
  /** The solved switch model's state at the nearest sample — discrete, not interpolated. */
  switchClosed: boolean;
  supplyVolts: number; potAVolts: number; wiperVolts: number; ledAnodeVolts: number; controlVolts: number;
  /** The pot's internal track node (between the two legs, before the contact resistance). */
  trackVolts: number;
  sourceAmps: number; potInAmps: number; wiperAmps: number; legBAmps: number; ledAmps: number;
}
export interface ControlsTransient {
  topology: 'controls';
  times: Float64Array;
  supplyVolts: Float64Array; potAVolts: Float64Array; wiperVolts: Float64Array; ledAnodeVolts: Float64Array; controlVolts: Float64Array;
  sourceAmps: Float64Array; potInAmps: Float64Array; wiperAmps: Float64Array; legBAmps: Float64Array; ledAmps: Float64Array;
  /** The pot's internal track node, so each leg's Ohm's law can be checked independently of KCL. */
  trackVolts: Float64Array;
  switchClosed: Uint8Array;
  description: ControlsDescription;
  stopSeconds: number; requestedStopSeconds: number; requestedStepSeconds: number;
  actualStepSeconds: { min: number; median: number; max: number };
  edges: { atSeconds: number; edgeSeconds: number }[];
  engine: string;
}

const N = CONTROLS_NODES;
const REQUIRED = ['time', `v(${N.supply})`, `v(${N.potA})`, `v(${N.wiper})`, `v(${N.ledAnode})`, `v(${N.control})`,
  'v(p_t)', 'i(vdd)', 'i(vap)', 'i(vwp)', 'i(vdl)'] as const;

export function toControlsTransient(raw: RawResult, c: ControlsDescription, engine: string): ControlsTransient {
  const { times, pick, reached, actualStepSeconds } = readGrid(raw, REQUIRED, c);
  if (times[0] !== 0) throw new SolveFault(`The first sample is at ${times[0].toExponential(4)} s; a controls run starts from its operating point at exactly 0 s.`);
  const neg = (v: Float64Array) => { const o = new Float64Array(v.length); for (let k = 0; k < v.length; k++) o[k] = -v[k] + 0; return o; };
  const potIn = pick('i(vap)'), wiper = pick('i(vwp)'), control = pick(`v(${N.control})`);
  const legB = new Float64Array(times.length); for (let k = 0; k < times.length; k++) legB[k] = potIn[k] - wiper[k];
  return {
    topology: 'controls', times,
    supplyVolts: pick(`v(${N.supply})`), potAVolts: pick(`v(${N.potA})`), wiperVolts: pick(`v(${N.wiper})`),
    ledAnodeVolts: pick(`v(${N.ledAnode})`), controlVolts: control,
    sourceAmps: neg(pick('i(vdd)')), potInAmps: potIn, wiperAmps: wiper, legBAmps: legB, ledAmps: pick('i(vdl)'),
    trackVolts: pick('v(p_t)'), switchClosed: switchStates(control),
    description: c, stopSeconds: reached, requestedStopSeconds: c.stopSeconds, requestedStepSeconds: c.stepSeconds, actualStepSeconds,
    edges: c.toggle.closed ? [{ atSeconds: c.toggle.closeAtSeconds, edgeSeconds: c.toggle.edgeSeconds }] : [], engine,
  };
}

export function sampleControlsAt(t: ControlsTransient, timeSeconds: number):
    ControlsSnapshot & { clampedToHorizon: boolean; onEdge: boolean; requestedTimeSeconds: number } {
  const { lo, hi, f, clamped } = locate(t.times, timeSeconds);
  let onEdge = false;
  for (const e of t.edges) if (t.times[lo] < e.atSeconds + e.edgeSeconds && t.times[hi] > e.atSeconds) { onEdge = true; break; }
  const at = (a: Float64Array) => a[lo] + (a[hi] - a[lo]) * f;
  return { timeSeconds: at(t.times), switchClosed: t.switchClosed[f < 0.5 ? lo : hi] === 1,
    supplyVolts: at(t.supplyVolts), potAVolts: at(t.potAVolts), wiperVolts: at(t.wiperVolts),
    ledAnodeVolts: at(t.ledAnodeVolts), controlVolts: at(t.controlVolts), trackVolts: at(t.trackVolts), sourceAmps: at(t.sourceAmps), potInAmps: at(t.potInAmps),
    wiperAmps: at(t.wiperAmps), legBAmps: at(t.legBAmps), ledAmps: at(t.ledAmps), clampedToHorizon: clamped, onEdge, requestedTimeSeconds: timeSeconds };
}
