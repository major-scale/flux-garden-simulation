/**
 * A SOLVED COMPOSITION — the generic trajectory behind any typed composition the conformance kit
 * can emit. The page that shows one reads its observables BY NAME (`m.omega`, `c.control`, …) from
 * the same structure the kit built, so the picture and the checks look at one deck; nothing is
 * re-derived from a hand-written netlist. Validation is `readGrid`'s: every requested vector
 * present, finite, on a strictly increasing grid that reaches the requested horizon.
 * Derived observables (a motor's θ, a rack's height — electromechanical v1) are computed by the
 * kit's own `makePicker` from the vectors `neededVectors` asks for: one definition for page and kit.
 */
import { readGrid, locate, SolveFault, type RawResult } from './grid';
import { buildStructure, type Composition, type Structure } from '../conformance/composition';
import { makePicker, neededVectors } from '../conformance/kit';

export interface CompositionTransient {
  topology: 'composition';
  composition: Composition;
  structure: Structure;
  times: Float64Array;
  /** Observable name → solved series. `v(0)` observables are the reference: identically zero. */
  series: Record<string, Float64Array>;
  stopSeconds: number; requestedStopSeconds: number; requestedStepSeconds: number;
  actualStepSeconds: { min: number; median: number; max: number };
  engine: string;
}

/** Build the structure a composition solves as. A structural finding (an unreachable node) is refused here, before any engine sees it. */
export function prepareComposition(c: Composition): Structure {
  const s = buildStructure(c);
  if (s.findings.length) throw new SolveFault(`The composition has ${s.findings.length} structural finding(s): ${s.findings.map((f) => `${f.cause} at ${f.where}`).join('; ')}`);
  return s;
}

export function toCompositionTransient(raw: RawResult, c: Composition, structure: Structure, engine: string): CompositionTransient {
  const { times, pick, reached, actualStepSeconds } = readGrid(raw, ['time', ...neededVectors(structure)], c.analysis);
  if (times[0] !== 0) throw new SolveFault(`The first sample is at ${times[0].toExponential(4)} s; a composition run starts from its operating point at exactly 0 s.`);
  const lookup = makePicker(structure, times, pick);
  const series: Record<string, Float64Array> = {};
  for (const [name, vec] of Object.entries(structure.observables)) series[name] = lookup(vec);
  return { topology: 'composition', composition: c, structure, times, series, stopSeconds: reached,
    requestedStopSeconds: c.analysis.stopSeconds, requestedStepSeconds: c.analysis.stepSeconds, actualStepSeconds, engine };
}

/** The interpolation bracket at a time, plus a reader for any observable (linear) and any state series (nearest). */
export function sampleComposition(t: CompositionTransient, timeSeconds: number) {
  const { lo, hi, f, clamped } = locate(t.times, timeSeconds);
  const at = (name: string): number => {
    const a = t.series[name];
    if (!a) throw new SolveFault(`No observable ${JSON.stringify(name)} in this composition`);
    return a[lo] + (a[hi] - a[lo]) * f;
  };
  const nearest = (a: ArrayLike<number>): number => a[f < 0.5 ? lo : hi];
  return { timeSeconds: t.times[lo] + (t.times[hi] - t.times[lo]) * f, requestedTimeSeconds: timeSeconds, clampedToHorizon: clamped, lo, hi, f, at, nearest };
}
