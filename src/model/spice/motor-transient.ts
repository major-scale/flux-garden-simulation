/**
 * THE SOLVED MOTOR TRAJECTORY, read with named fields and stated signs.
 *
 *   sourceAmps   = −i(Vdd)   out of the supply's + terminal, through the switch
 *   motorAmps    = +i(LM)    INTO the motor's + terminal (through R then L then the E source)
 *   diodeAmps    = +i(Vdp)   anode-to-cathode through the freewheel diode (ground → terminal)
 *   brakeTorque  = −i(Vbr)   the torque the brake APPLIES TO THE SHAFT. `Vbr vw bk` + `Sb bk 0`
 *                            means +i(Vbr) LEAVES the mechanical node — the resisting torque —
 *                            so the applied torque is its negative (Astra's correction; my first
 *                            reading had the sign wrong and a near-perfect lock hid it).
 *   omega        = v(vw)     rad/s;  theta = ∫ω dt by trapezoid (the reader's);  height = r·theta
 * KCL at the motor terminal: sourceAmps + diodeAmps = motorAmps, at every sample.
 */
import { MOTOR_NODES, type MotorDescription, effectiveInertia, loadTorque } from './motor-netlist';
import { readGrid, locate, SolveFault, type RawResult } from './grid';
import { switchStates } from './controls-transient';

export interface MotorSnapshot {
  timeSeconds: number;
  /** The solved switch model's state (hysteresis 0.6 / 0.4) at the nearest sample; discrete. */
  switchClosed: boolean;
  supplyVolts: number;
  terminalVolts: number;
  afterRVolts: number;
  backEmfVolts: number;
  controlVolts: number;
  brakeControlVolts: number;
  sourceAmps: number;
  motorAmps: number;
  diodeAmps: number;
  brakeTorqueNm: number;
  omegaRadPerS: number;
  thetaRad: number;
  heightM: number;
}

export interface MotorTransient {
  topology: 'motor';
  times: Float64Array;
  supplyVolts: Float64Array; terminalVolts: Float64Array; afterRVolts: Float64Array; backEmfVolts: Float64Array;
  controlVolts: Float64Array; brakeControlVolts: Float64Array;
  sourceAmps: Float64Array; motorAmps: Float64Array; diodeAmps: Float64Array; brakeTorqueNm: Float64Array;
  omegaRadPerS: Float64Array; thetaRad: Float64Array;
  switchClosed: Uint8Array;
  description: MotorDescription;
  effectiveInertiaKgM2: number;
  loadTorqueNm: number;
  stopSeconds: number;
  requestedStopSeconds: number;
  requestedStepSeconds: number;
  actualStepSeconds: { min: number; median: number; max: number };
  /** Every declared finite edge: switch close/open, brake release. */
  edges: { atSeconds: number; edgeSeconds: number; what: 'close' | 'open' | 'release' }[];
  engine: string;
}

const N = MOTOR_NODES;
const REQUIRED = ['time', `v(${N.supply})`, `v(${N.terminal})`, `v(${N.afterR})`, `v(${N.backEmf})`,
  `v(${N.control})`, `v(${N.brakeControl})`, 'i(vdd)', 'i(lm)', 'i(vdp)', 'i(vbr)', `v(${N.omega})`] as const;

export function toMotorTransient(raw: RawResult, c: MotorDescription, engine: string): MotorTransient {
  const { times, pick, reached, actualStepSeconds } = readGrid(raw, REQUIRED, c);
  if (times[0] !== 0)
    throw new SolveFault(`The first sample is at ${times[0].toExponential(4)} s; a motor run starts `
      + `from its braked operating point at exactly 0 s.`);
  const neg = (v: Float64Array) => { const o = new Float64Array(v.length); for (let k = 0; k < v.length; k++) o[k] = -v[k] + 0; return o; };
  const p = c.programme;
  const edges: MotorTransient['edges'] = [];
  if (p.closeAtSeconds !== null) edges.push({ atSeconds: p.closeAtSeconds, edgeSeconds: p.edgeSeconds, what: 'close' });
  if (p.openAtSeconds !== null) edges.push({ atSeconds: p.openAtSeconds, edgeSeconds: p.edgeSeconds, what: 'open' });
  if (p.releaseBrakeAtSeconds !== null) edges.push({ atSeconds: p.releaseBrakeAtSeconds, edgeSeconds: p.edgeSeconds, what: 'release' });
  // θ = ∫ω dt, from rest at t = 0, trapezoid on the solver's own grid. See the netlist header for
  // why the deck does not carry a θ node.
  const omega = pick(`v(${N.omega})`);
  const theta = new Float64Array(times.length);
  for (let k = 1; k < times.length; k++) theta[k] = theta[k - 1] + 0.5 * (omega[k] + omega[k - 1]) * (times[k] - times[k - 1]);
  return {
    topology: 'motor', times,
    supplyVolts: pick(`v(${N.supply})`), terminalVolts: pick(`v(${N.terminal})`), afterRVolts: pick(`v(${N.afterR})`),
    backEmfVolts: pick(`v(${N.backEmf})`), controlVolts: pick(`v(${N.control})`), brakeControlVolts: pick(`v(${N.brakeControl})`),
    sourceAmps: neg(pick('i(vdd)')), motorAmps: pick('i(lm)'), diodeAmps: pick('i(vdp)'), brakeTorqueNm: neg(pick('i(vbr)')),
    omegaRadPerS: omega, thetaRad: theta, switchClosed: switchStates(pick(`v(${N.control})`)),
    description: c, effectiveInertiaKgM2: effectiveInertia(c), loadTorqueNm: loadTorque(c),
    stopSeconds: reached, requestedStopSeconds: c.stopSeconds, requestedStepSeconds: c.stepSeconds,
    actualStepSeconds, edges, engine,
  };
}

export function sampleMotorAt(t: MotorTransient, timeSeconds: number):
    MotorSnapshot & { clampedToHorizon: boolean; onEdge: boolean; requestedTimeSeconds: number } {
  const { lo, hi, f, clamped } = locate(t.times, timeSeconds);
  let onEdge = false;
  for (const e of t.edges) if (t.times[lo] < e.atSeconds + e.edgeSeconds && t.times[hi] > e.atSeconds) { onEdge = true; break; }
  const at = (a: Float64Array) => a[lo] + (a[hi] - a[lo]) * f;
  const theta = at(t.thetaRad);
  return {
    timeSeconds: at(t.times), switchClosed: t.switchClosed[f < 0.5 ? lo : hi] === 1,
    supplyVolts: at(t.supplyVolts), terminalVolts: at(t.terminalVolts),
    afterRVolts: at(t.afterRVolts), backEmfVolts: at(t.backEmfVolts), controlVolts: at(t.controlVolts),
    brakeControlVolts: at(t.brakeControlVolts), sourceAmps: at(t.sourceAmps), motorAmps: at(t.motorAmps),
    diodeAmps: at(t.diodeAmps), brakeTorqueNm: at(t.brakeTorqueNm), omegaRadPerS: at(t.omegaRadPerS),
    thetaRad: theta, heightM: t.description.load.pinionRadiusM * theta,
    clampedToHorizon: clamped, onEdge, requestedTimeSeconds: timeSeconds,
  };
}
