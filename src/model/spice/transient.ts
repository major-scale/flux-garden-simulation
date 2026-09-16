/**
 * A SOLVED TRANSIENT, AND WHY IT IS CHECKED RATHER THAN TRUSTED.
 *
 * The WASM engine DOES NOT THROW ON FAILURE. Measured, before any of this was written: a
 * malformed netlist and an unknown device model both RESOLVE, returning `numPoints: 1` with
 * zero variables, while the reason goes to a log nobody awaited. A caller that trusted
 * resolution would treat a failed solve as a successful one-point run — the fail-open shape
 * this project has been bitten by before.
 *
 * So nothing here trusts the promise. Every result is validated against what was asked for:
 * required channels present, time strictly increasing, all values finite, and the horizon
 * actually reached. A result that fails any of those is a FAULT with a reason, never an empty
 * or truncated snapshot presented as physics.
 */
import { NODES, type CircuitDescription } from './netlist';
import { readGrid, locate, type RawResult } from './grid';

/** What the renderer is allowed to read. Named quantities, never raw solver vectors. */
export interface Snapshot {
  /** Simulated seconds at this sample. */
  timeSeconds: number;
  /** Signed current through the inductor branch, amperes, positive from source toward capacitor. */
  currentAmps: number;
  /** Capacitor terminal voltage, volts. */
  capacitorVolts: number;
  /** Source terminal voltage at this instant — it can be scheduled, so it is not a constant. */
  sourceVolts: number;
  /**
   * TWO DISTINCT NODES, and conflating them is a diode-shaped bug waiting to happen.
   *
   * `afterResistorVolts` is node `na`: the far side of the resistor and the ANODE side of the
   * diode when one is present. `inductorInVolts` is node `n2`: the inductor's own upper
   * terminal, which is Vc + vL. With no diode they are the same node; with a diode they differ
   * by exactly its drop, which is the entire point of putting one there.
   */
  afterResistorVolts: number;
  inductorInVolts: number;
  /** Voltage across the inductor, volts. Its terminal difference, so a diode drop is included. */
  inductorVolts: number;
  /**
   * di/dt from the INDUCTOR'S OWN TERMINALS: v_L / L. Not (Vs − Vc − iR)/L, which silently
   * encodes a topology and would be wrong the moment a diode sits in the loop.
   */
  diDtAmpsPerSecond: number;
  /** Stored energies, computable from this sample alone. */
  capacitorJoules: number;
  inductorJoules: number;
}

export interface Transient {
  /** Ascending simulated times, seconds. */
  times: Float64Array;
  currents: Float64Array;
  capacitorVolts: Float64Array;
  sourceVolts: Float64Array;
  afterResistorVolts: Float64Array;
  inductorInVolts: Float64Array;
  inductorVolts: Float64Array;
  inductanceHenries: number;
  capacitanceFarads: number;
  /** The horizon actually reached, and the one that was asked for. */
  stopSeconds: number;
  requestedStopSeconds: number;
  /**
   * REQUESTED versus ACTUAL step. ngspice returns ITS OWN internal timepoints, not the grid
   * asked for: with a 1.0696e-9 s request, the first sample came back at 1.0696e-11 s and the
   * spacing varied around 1.7e-10 s. So the grid is irregular and `sampleAt` interpolates on
   * it; treating the output as evenly spaced would misread every value.
   */
  requestedStepSeconds: number;
  actualStepSeconds: { min: number; median: number; max: number };
  /** Scheduled event, so lookup can refuse to interpolate across it. */
  event?: { atSeconds: number; edgeSeconds: number };
  /**
   * THE AUTHORED STARTING STATE, kept separately because the solver never returns t = 0.
   *
   * ngspice's first sample is at a small positive time — measured at 1.07e-11 s for a 1.07e-9 s
   * request — so asking the trajectory for t = 0 clamps to a sample that is already moving.
   * With a non-zero initial current or charge, showing that as "the reset state" would display
   * a value the experiment never started from. The description states the initial conditions
   * exactly, and `.ic` + `uic` is what the solver was told to start from, so these are the
   * authored truth and are reported as such rather than inferred from the first sample.
   */
  initialState: { timeSeconds: 0; currentAmps: number; capacitorVolts: number };
  /** Provenance of the engine that produced it. */
  engine: string;
}

export { SolveFault, MAX_ACTUAL_POINTS } from './grid';
export type { RawResult } from './grid';

const REQUIRED = ['time', 'i(l1)', `v(${NODES.sourcePlus})`,
  `v(${NODES.inductorIn})`, `v(${NODES.capacitorPlus})`] as const;

/**
 * Turn a raw engine result into a Transient, or refuse with a reason.
 *
 * `requireFullHorizon` exists because a run that stops early is a legitimate solver outcome
 * (non-convergence, a step floor) and must be reported as one — not padded, not extrapolated,
 * and not silently accepted as if the horizon had been reached.
 */
export function toTransient(raw: RawResult, c: CircuitDescription, engine: string): Transient {
  // THE GRID IS VALIDATED IN ONE PLACE FOR EVERY TOPOLOGY (`grid.ts`): channels present, time
  // finite and increasing, the run started at the start and reached the horizon to within the
  // measured ULP budget. Lifted out unchanged when the lamp needed the same checks.
  const wanted = c.diode ? [...REQUIRED, `v(${NODES.afterResistor})`] : [...REQUIRED];
  const { times, pick, reached, actualStepSeconds } = readGrid(raw, wanted, c);
  const vSource = pick(`v(${NODES.sourcePlus})`);
  const vInductorIn = pick(`v(${NODES.inductorIn})`);
  const vCap = pick(`v(${NODES.capacitorPlus})`);
  const vAfterR = c.diode ? pick(`v(${NODES.afterResistor})`) : vInductorIn;
  const currents = pick('i(l1)');
  const vL = new Float64Array(times.length);
  for (let k = 0; k < times.length; k++) vL[k] = vInductorIn[k] - vCap[k];

  return {
    times, currents, capacitorVolts: vCap, sourceVolts: vSource,
    afterResistorVolts: vAfterR, inductorInVolts: vInductorIn, inductorVolts: vL,
    inductanceHenries: c.inductanceHenries, capacitanceFarads: c.capacitanceFarads,
    stopSeconds: reached, requestedStopSeconds: c.stopSeconds,
    requestedStepSeconds: c.stepSeconds,
    initialState: { timeSeconds: 0, currentAmps: c.initialInductorAmps,
                    capacitorVolts: c.initialCapacitorVolts },
    actualStepSeconds,
    event: c.event ? { atSeconds: c.event.atSeconds, edgeSeconds: c.event.edgeSeconds } : undefined,
    engine,
  };
}

/**
 * Read the transient at a simulated instant.
 *
 * INTERPOLATION IS LINEAR between adjacent samples. Across a scheduled event's finite ramp that
 * is LEGITIMATE — the source really is moving smoothly between the PWL corners, so interpolating
 * there is not faking anything, and my first comment here wrongly said it was. What the flag is
 * for is honesty about resolution: inside the ramp the trajectory turns fastest, so the sample
 * is marked `onEventEdge` and both the requested and the actually represented time are returned,
 * because a caller asking for a specific instant during a transition deserves to know which one
 * it got.
 *
 * Time must be a finite number. A NaN request used to sail through the binary search and return
 * whatever index happened to survive the comparisons.
 */
export function sampleAt(t: Transient, timeSeconds: number):
    Snapshot & { clampedToHorizon: boolean; onEventEdge: boolean; requestedTimeSeconds: number } {
  const times = t.times;
  const { lo, hi, f, clamped } = locate(times, timeSeconds);
  let onEdge = false;
  if (t.event) {
    const a = t.event.atSeconds, b = a + t.event.edgeSeconds;
    if (times[lo] < b && times[hi] > a) onEdge = true;   // flagged, still interpolated
  }
  const at = (arr: Float64Array) => arr[lo] + (arr[hi] - arr[lo]) * f;
  const i = at(t.currents);
  const vc = at(t.capacitorVolts);
  const vL = at(t.inductorVolts);
  return {
    timeSeconds: at(times), currentAmps: i, capacitorVolts: vc,
    sourceVolts: at(t.sourceVolts), afterResistorVolts: at(t.afterResistorVolts),
    inductorInVolts: at(t.inductorInVolts), inductorVolts: vL,
    diDtAmpsPerSecond: vL / t.inductanceHenries,
    capacitorJoules: 0.5 * t.capacitanceFarads * vc * vc,
    inductorJoules: 0.5 * t.inductanceHenries * i * i,
    clampedToHorizon: clamped, onEventEdge: onEdge, requestedTimeSeconds: timeSeconds,
  };
}
