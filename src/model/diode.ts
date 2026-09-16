/**
 * THE DIODE, READ FROM A SOLVED SNAPSHOT — and independently predicted from its own model.
 *
 * This is the first component whose behaviour is genuinely nonlinear, so it is also the first
 * one where "the renderer consumes solver results" has to mean something stronger than reading
 * a number off a wire. Two separate things live here, and keeping them apart is the point:
 *
 *   - `diodeState` READS the solved snapshot. Terminal voltage, terminal current and dissipation
 *     come from the two node voltages and the branch current ngspice returned. Nothing is
 *     modelled; this is what the renderer draws.
 *   - `shockleyCurrent` PREDICTS, from the device parameters alone, what current the diode
 *     equation requires at a given terminal voltage. Nothing in the render path calls it. It
 *     exists so a test can ask whether the trajectory on screen actually satisfies the device
 *     law, rather than assuming that whatever came back must have.
 *
 * ORIENTATION IS THE ORDER OF THE TERMINALS, matching the netlist. Forward puts the anode on
 * `na` (the resistor side); reverse puts it on `n2` (the inductor side). Every signed quantity
 * below is stated anode-to-cathode, so it does not silently encode one of the two orientations.
 *
 * QUASI-STATIC ONLY. The first slice pins CJO = TT = 0 (enforced in `validateCircuit`), so the
 * junction stores no charge. That is what lets terminal power be called dissipation: with either
 * non-zero, some of v·i is charge going in and coming back out, and calling it heat would be the
 * same reclassification this project refuses everywhere else.
 */
import type { DiodeSpec, DiodeOrientation } from './spice/netlist';
import type { Snapshot } from './spice/transient';

/** Boltzmann over elementary charge, volts per kelvin, and the temperature ngspice defaults to. */
export const K_OVER_Q = 8.617333262e-5;
export const NOMINAL_TEMP_K = 300.15;              // ngspice TNOM default, 27 C
/** Thermal voltage at the nominal temperature: 0.02586... V. */
export const THERMAL_VOLTS = K_OVER_Q * NOMINAL_TEMP_K;

export interface DiodeState {
  /** Terminal voltage anode-to-cathode, volts, from the two solved node voltages. */
  terminalVolts: number;
  /** Terminal current anode-to-cathode, amperes, from the solved branch current. */
  terminalAmps: number;
  /**
   * Instantaneous terminal power, watts. With CJO = TT = 0 this IS dissipation, and it is
   * non-negative for any physical operating point; a negative value means the snapshot and the
   * orientation disagree, which is a wiring bug, not a diode that generates power.
   */
  watts: number;
  /**
   * Which way the device is being driven. `forwardBiased` is a statement about the terminal
   * voltage only — it does not claim the current is significant, because a diode at +0.2 V is
   * forward-biased and carrying almost nothing.
   */
  forwardBiased: boolean;
}

/**
 * Read the diode's terminals out of a solved snapshot.
 *
 * `afterResistorVolts` and `inductorInVolts` are the same node when no diode is present, so the
 * bypass case falls out as exactly zero volts and zero watts rather than needing a special case.
 */
export function diodeState(s: Snapshot, orientation: DiodeOrientation): DiodeState {
  // Anode-to-cathode, by orientation. The loop current is positive from source toward capacitor,
  // which runs anode-to-cathode in the forward placement and cathode-to-anode in the reverse one.
  const forward = orientation === 'forward';
  const terminalVolts = forward
    ? s.afterResistorVolts - s.inductorInVolts
    : s.inductorInVolts - s.afterResistorVolts;
  const terminalAmps = forward ? s.currentAmps : -s.currentAmps;
  return {
    terminalVolts, terminalAmps,
    // `+ 0` normalises NEGATIVE ZERO, which a bypassed diode produces for either orientation
    // (0 V across it, current of one sign or the other). A readout printing "-0 W" is wrong in
    // the only way a reader would notice.
    watts: terminalVolts * terminalAmps + 0,
    forwardBiased: terminalVolts > 0,
  };
}

/**
 * The current the DEVICE LAW requires at a given terminal voltage — the prediction, not the read.
 *
 * The junction is Shockley, `i = IS·(exp(v_j / (N·Vt)) − 1)`, but the terminal voltage is
 * `v_j + i·RS`, so with a series resistance the relation is IMPLICIT and there is no closed
 * form. It is solved for `v_j` by bisection on a bracket, which is slower than Newton and cannot
 * diverge — this runs in tests, not in a frame.
 *
 * REVERSE BREAKDOWN IS NOT MODELLED HERE. ngspice's BV region is a separate branch of its model,
 * and the operating points this project puts a diode through stay far above −BV; a caller that
 * strays past it gets a stated refusal rather than a wrong number.
 */
export function shockleyCurrent(v: number, d: DiodeSpec, gminSiemens = 0): number {
  if (!Number.isFinite(v)) throw new Error(`Diode terminal voltage is not finite: ${v}.`);
  if (v <= -d.bv)
    throw new Error(`Terminal voltage ${v.toExponential(4)} V is at or past the ${d.bv} V `
      + `breakdown, which this model does not cover. Refused rather than extrapolated.`);
  const vt = d.n * THERMAL_VOLTS;
  // `gminSiemens` is NOT part of the device. Every SPICE puts a small fixed conductance across
  // each junction so the Jacobian cannot go singular, and ngspice's default is 1e-12 S. It is
  // invisible in forward conduction and DOMINANT in reverse: at −10 V it carries 1e-11 A while
  // the diode's own saturation current is 1e-14 A, a factor of a thousand. A verifier comparing
  // against the trajectory has to include it or it is testing the wrong equation; a renderer
  // must not, because it is the simulator's numerical floor and not something the part does.
  // Hence: opt-in, defaulting to the physics.
  const junction = (vj: number) => d.is * Math.expm1(vj / vt) + gminSiemens * vj;
  if (d.rs === 0) return junction(v);
  // Bracket v_j between the two extremes it must lie within: the whole terminal voltage across
  // the junction (no drop on RS) and none of it. Both signs of v are covered because the
  // junction current and the resistor drop always share the sign of v.
  let lo = Math.min(0, v), hi = Math.max(0, v);
  const residual = (vj: number) => v - vj - junction(vj) * d.rs;
  for (let k = 0; k < 200; k++) {
    const mid = 0.5 * (lo + hi);
    if (residual(mid) > 0) lo = mid; else hi = mid;
  }
  return junction(0.5 * (lo + hi));
}

/** ngspice's default junction conductance floor, siemens. Not a property of any real diode. */
export const NGSPICE_GMIN = 1e-12;

export interface DiodeExcursion {
  /** Most negative and most positive terminal voltage over the whole trajectory, volts. */
  minTerminalVolts: number;
  maxTerminalVolts: number;
  /** Largest |i| through the device, amperes. */
  peakAmps: number;
  /** True when the run reached or passed −BV at any sample. */
  enteredBreakdown: boolean;
  /** The first sample time at which it did, or null. */
  breakdownAtSeconds: number | null;
}

/**
 * THE WHOLE TRAJECTORY'S EXCURSION, so the supported domain is checked against what the run
 * actually did rather than against the inputs it started from.
 *
 * This exists because "reverse breakdown is not covered" was a claim about `shockleyCurrent`
 * refusing past −BV — a statement about the PREDICTOR, which runs only in tests. Nothing checked
 * the trajectory, and the trajectory is where it matters: an inductor kick can drive the diode
 * well past the source voltage, so a run started at 10 V against a 75 V part is not
 * automatically inside the envelope. Astra caught that the guard was asserted, not enforced.
 *
 * What is true: ngspice DOES model the breakdown region, so a run that enters it is not
 * nonsense. What is NOT true is that we have checked it — the independent device law here stops
 * at −BV, so a run past that point is unverified. The caller refuses such a run for that reason,
 * which is a narrower and more honest statement than "the model does not cover it".
 */
export function diodeExcursion(
  samples: { afterResistorVolts: number; inductorInVolts: number; currentAmps: number;
             timeSeconds: number }[],
  orientation: DiodeOrientation, bv: number,
): DiodeExcursion {
  let minV = Infinity, maxV = -Infinity, peak = 0, at: number | null = null;
  for (const s of samples) {
    const st = diodeState(s as Snapshot, orientation);
    if (st.terminalVolts < minV) minV = st.terminalVolts;
    if (st.terminalVolts > maxV) maxV = st.terminalVolts;
    peak = Math.max(peak, Math.abs(st.terminalAmps));
    if (at === null && st.terminalVolts <= -bv) at = s.timeSeconds;
  }
  return { minTerminalVolts: minV, maxTerminalVolts: maxV, peakAmps: peak,
           enteredBreakdown: at !== null, breakdownAtSeconds: at };
}

/** Every sample of a solved transient, in the shape `diodeExcursion` reads. */
export function transientDiodeSamples(t: {
  times: Float64Array; afterResistorVolts: Float64Array; inductorInVolts: Float64Array;
  currents: Float64Array;
}): { afterResistorVolts: number; inductorInVolts: number; currentAmps: number;
      timeSeconds: number }[] {
  const out = [];
  for (let k = 0; k < t.times.length; k++)
    out.push({ timeSeconds: t.times[k], afterResistorVolts: t.afterResistorVolts[k],
               inductorInVolts: t.inductorInVolts[k], currentAmps: t.currents[k] });
  return out;
}
