/**
 * THE SOLVED TIME GRID, validated once for every topology.
 *
 * This is the part of reading a solver result that has nothing to do with WHICH circuit was
 * solved: that the engine returned the channels it was asked for, that time is finite and
 * strictly increasing, that the run began at the start and reached the horizon, and what the
 * actual (adaptive, irregular) sample spacing was. It was written for the RLC `Transient` and
 * lifted out unchanged when the MOSFET lamp needed the same guarantees over different channels.
 * Every rule below was earned by an observed failure; see the comments and `transient.test.ts`.
 */

export class SolveFault extends Error {}

interface RawSeries { name: string; values: number[] | Float64Array }
export interface RawResult {
  numPoints?: number;
  variableNames?: string[];
  data?: RawSeries[];
}

/**
 * A ceiling on ACTUAL returned samples. The netlist limit bounds the grid we ASK for; it says
 * nothing about how many internal points an adaptive solver returns, which is the memory that
 * actually arrives. Measured: a request for ~1200 points came back as 1211, but a stiff or
 * badly posed circuit can return far more.
 */
export const MAX_ACTUAL_POINTS = 400_000;

export interface GridWindow { stepSeconds: number; stopSeconds: number }

export interface SolvedGrid {
  times: Float64Array;
  /** A validated channel: same length as `times`, every value finite. */
  pick: (key: string) => Float64Array;
  /** The horizon actually reached, within ULPs of the request (checked). */
  reached: number;
  actualStepSeconds: { min: number; median: number; max: number };
}

/**
 * Validate the grid and the presence of `wanted` channels, or refuse with a reason.
 *
 * A run that stops early is a legitimate solver outcome (non-convergence, a step floor) and must
 * be reported as one — not padded, not extrapolated, and not silently accepted as complete.
 */
export function readGrid(raw: RawResult, wanted: readonly string[], c: GridWindow): SolvedGrid {
  if (!raw || typeof raw !== 'object') throw new SolveFault('The solver returned nothing usable.');
  const names = (raw.variableNames ?? []).map((n) => n.toLowerCase());
  if (names.length === 0)
    throw new SolveFault('The solver returned no variables — the netlist did not run. '
      + 'This is the shape a malformed or unparsable circuit produces.');
  const series = new Map<string, Float64Array>();
  for (const d of raw.data ?? [])
    series.set(String(d.name).toLowerCase(), d.values instanceof Float64Array
      ? d.values : Float64Array.from(d.values));
  for (const key of wanted)
    if (!series.has(key)) throw new SolveFault(`The solver did not return ${key}. `
      + `Present: ${[...series.keys()].join(', ') || '(none)'}`);

  const times = series.get('time')!;
  if (times.length < 2)
    throw new SolveFault(`The solver produced ${times.length} point(s). A transient needs a `
      + `trajectory; one point is what a refused circuit returns.`);
  for (let k = 0; k < times.length; k++) {
    if (!Number.isFinite(times[k])) throw new SolveFault(`Non-finite time at sample ${k}.`);
    if (k > 0 && !(times[k] > times[k - 1]))
      throw new SolveFault(`Time is not strictly increasing at sample ${k}: `
        + `${times[k - 1]} then ${times[k]}.`);
  }
  const pick = (key: string): Float64Array => {
    const v = series.get(key);
    if (!v) throw new SolveFault(`The solver did not return ${key}.`);
    if (v.length !== times.length)
      throw new SolveFault(`${key} has ${v.length} samples against ${times.length} times.`);
    for (let k = 0; k < v.length; k++)
      if (!Number.isFinite(v[k])) throw new SolveFault(`Non-finite ${key} at sample ${k}.`);
    return v;
  };
  if (times.length > MAX_ACTUAL_POINTS)
    throw new SolveFault(`The solver returned ${times.length} samples, above the `
      + `${MAX_ACTUAL_POINTS} ceiling. The requested grid bounds what we ask for, not what an `
      + `adaptive solver returns.`);
  if (times[0] < 0)
    throw new SolveFault(`The first sample is at ${times[0].toExponential(4)} s, before the `
      + `start of the run.`);
  // COVERAGE AT THE START, not only at the end. ngspice's first sample is NOT t = 0 under
  // `uic` — measured at 1.07e-11 s for a 1.07e-9 s request — so a run that began late would
  // otherwise pass unnoticed and its opening would be filled in by clamping.
  const startBudget = Math.max(c.stepSeconds, c.stopSeconds * 1e-6);
  if (times[0] > startBudget)
    throw new SolveFault(`The first sample is at ${times[0].toExponential(4)} s, more than `
      + `${startBudget.toExponential(4)} s into a run that should begin at 0.`);
  const reached = times[times.length - 1];
  // THE HORIZON MUST BE REACHED — but "reached" is a claim about the trajectory, not about the
  // last bit of a double. `reached < c.stopSeconds` was an exact comparison against ngspice's
  // own accumulation of tstop, and measured across nine coil geometries (tools/spice-harness/
  // horizon.ts) the final sample lands 0, +1, +2 or -1 ULP from the request with the sign
  // varying by geometry: 10/20/35 turns hit it exactly, 15/30/40/60 fell one or two ULP short,
  // 25 overshot. Every one of those runs returned all 1211 points over the full interval. So
  // four of eight supported geometries faulted on rounding, and the message printed the same
  // number twice — "stopped at 1.9063e-6 s, short of the requested 1.9063e-6 s".
  //
  // THE TOLERANCE IS ULP-SCALE, AND ONLY ULP-SCALE. My first fix allowed half an output step,
  // on the argument that a genuinely early run must be missing a whole output point. That is
  // FALSE, as Astra pointed out: ngspice returns its own adaptive internal grid, not the
  // requested one — irregular spacing, 1211 points for a 1201 point request — so a run that
  // terminated early stops wherever the stepper stopped, which can be a small fraction of a
  // nominal step short of tstop. A half-step slack would have swallowed exactly that. The
  // measured worst deviation is 0.98 × |t|·EPSILON, so the bound below carries roughly 8×
  // headroom over observed engine behaviour and nothing more. If a future engine ever exceeds
  // this, that is something to investigate, not to widen.
  const horizonSlack = 8 * Number.EPSILON * Math.max(Math.abs(c.stopSeconds), Math.abs(reached));
  const deficit = c.stopSeconds - reached;
  const inUlps = (x: number) => (x / (Number.EPSILON * Math.abs(c.stopSeconds))).toFixed(2);
  if (deficit > horizonSlack)
    throw new SolveFault(`The solver stopped at ${reached.toExponential(4)} s, short of the `
      + `requested ${c.stopSeconds.toExponential(4)} s by ${deficit.toExponential(4)} s `
      + `(${inUlps(deficit)} ULP, tolerance 8). Reported as a fault rather than shown as a `
      + `completed run.`);
  // OVERSHOOT IS THE SAME CLAIM IN REVERSE and was previously unchecked, so a run that carried
  // on past the request would have been presented as the requested experiment. One ULP of
  // overshoot is real and measured (25 turns), hence the same slack rather than equality.
  if (-deficit > horizonSlack)
    throw new SolveFault(`The solver ran to ${reached.toExponential(4)} s, past the requested `
      + `${c.stopSeconds.toExponential(4)} s by ${(-deficit).toExponential(4)} s `
      + `(${inUlps(-deficit)} ULP, tolerance 8). A longer run is a different experiment.`);
  const gaps: number[] = [];
  for (let k = 1; k < times.length; k++) gaps.push(times[k] - times[k - 1]);
  gaps.sort((a, b) => a - b);
  return { times, pick, reached,
    actualStepSeconds: { min: gaps[0], median: gaps[gaps.length >> 1], max: gaps[gaps.length - 1] } };
}

/**
 * Locate `time` on the grid for linear interpolation: the bracketing indices and the fraction.
 * Clamped to the grid's ends, and says so.
 */
export function locate(times: Float64Array, timeSeconds: number):
    { lo: number; hi: number; f: number; clamped: boolean } {
  if (!Number.isFinite(timeSeconds))
    throw new SolveFault(`Cannot sample at a non-finite time (${timeSeconds}).`);
  const last = times.length - 1;
  const clamped = timeSeconds >= times[last] || timeSeconds <= times[0];
  const time = Math.min(Math.max(timeSeconds, times[0]), times[last]);
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid; else hi = mid;
  }
  const span = times[hi] - times[lo];
  const f = span > 0 ? (time - times[lo]) / span : 0;
  return { lo, hi, f, clamped };
}
