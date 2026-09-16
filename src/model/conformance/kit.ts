/**
 * THE CONFORMANCE KIT — frozen expectations, the checks, the run and the report.
 *
 * Expectations are a SEPARATE document from the composition. A builder may edit the circuit; the
 * checks are frozen by whoever wrote the brief, and the report carries the SHA-256 of both so a
 * loosened check set is visible. Every check runs on INDEPENDENT observables — probe currents and
 * node voltages the deck actually returns — never on a quantity reconstructed from the identity
 * under test. Statuses: pass | fail | unsupported | error | warn. A check that could not run is an
 * error, an empty or unknown check set cannot pass, a window outside the solved horizon is an
 * error (never clamped), and the OVERALL verdict is pass only when every required check executed
 * and passed. Reference (approximation) error and solver tolerance are reported separately.
 */
import { buildStructure, ConformanceError, type Composition, type Structure, type PartInstance } from './composition';
import { readGrid, locate, SolveFault, type RawResult } from '../spice/grid';
import { shockleyCurrent } from '../diode';
import { potLegs, ldrOhms, ntcOhms, comparatorThresholdVolts, mutualHenries, shaftInertia, shaftLoadTorque } from '../spice/parts';
import { gravityTorque } from '../spice/shaft-load';
import { coupledReference } from '../motor';
import { switchStates } from '../spice/controls-transient';
import { terminalMap, ENERGY_ROLE } from './terminals';

export type Check =
  | { id: string; kind: 'connectivity'; danglingPorts?: 'fail' | 'warn' | 'off' }
  /** Law and balance checks carry an EXCITATION floor: a trajectory whose peak current never reaches it establishes nothing (0 = 0 is not conformance) and is `unsupported`. */
  | { id: string; kind: 'kcl'; into: string[]; out: string[]; tolRel?: number; minPeakAmps?: number }
  | { id: string; kind: 'ohm'; part: string; tolRel?: number; minPeakAmps?: number }
  | { id: string; kind: 'diode-law'; part: string; tolRel?: number; floorAmps?: number; minPeakAmps?: number }
  /** Voltage-domain residual |i·R(env) − (va − vb)| relative to max(|va − vb|, floorVolts), over the samples with excitation; needs the sensor's OWN probe. */
  | { id: string; kind: 'sensor-law'; part: string; tolRel?: number; floorVolts?: number; minCoverage?: number }
  | { id: string; kind: 'bounds'; observable: string; min?: number; max?: number }
  /** The largest value of an observable inside a window must reach `min` — for a transient that a single sample cannot pin (a freewheel pulse, an inrush). */
  | { id: string; kind: 'peak'; observable: string; window: [number, number]; min: number }
  /** The smallest value of an observable inside a window must reach `max` or below — a reverse current, an undershoot. Sampled like `peak`. */
  | { id: string; kind: 'trough'; observable: string; window: [number, number]; max: number }
  | { id: string; kind: 'state'; at: number | 'end'; observable: string; op: 'gt' | 'lt' | 'near'; value: number; tolAbs?: number }
  | { id: string; kind: 'switching'; part: string; direction: 'low->high' | 'high->low'; window: [number, number] }
  | { id: string; kind: 'comparator'; part: string }
  /**
   * A capacitor's, inductor's or coupled pair's ELEMENT LAW and ENERGY from its own observables: i = C·dv/dt, v = L·di/dt, or
   * v₁ = L₁·di₁/dt + M·di₂/dt and v₂ = M·di₁/dt + L₂·di₂/dt (M = k·√(L₁L₂)), as residuals relative to the peak; and over `window`
   * the integrated port work ∫Σv·i dt against the change of stored energy ½Cv², ½Li² or ½L₁i₁² + ½L₂i₂² + M·i₁i₂ — the solver's
   * current and voltage series must agree with the element's own law and bookkeeping. This is a consistency check of the
   * trajectory with the declared element, not an independent model of the circuit.
   */
  | { id: string; kind: 'storage-law'; part: string; window?: [number, number]; tolRel?: number; tolEnergyRel?: number; minPeakAmps?: number }
  /**
   * An INDEPENDENT ANALYTIC REFERENCE over `window` (which must start at or after `startAtSeconds`) within `tolRel` of |to − from|.
   * `first-order-step`:  x(t) = to + (from − to)·exp(−(t − t₀)/τ)          (an RC step: τ = R·C; an RL step: τ = L/R)
   * `second-order-step`: x(t) = to + (from − to)·e^(−α(t − t₀))·(cos ω(t − t₀) + (α/ω)·sin ω(t − t₀))
   *                      — the underdamped step with zero initial slope (a series RLC capacitor voltage from rest:
   *                      α = R/2L, ω = √(1/LC − α²)). The author states every parameter by hand; the kit derives nothing.
   */
  | { id: string; kind: 'reference'; observable: string; model: 'first-order-step'; startAtSeconds: number; from: number; to: number; tauSeconds: number; window: [number, number]; tolRel?: number }
  | { id: string; kind: 'reference'; observable: string; model: 'second-order-step'; startAtSeconds: number; from: number; to: number; alphaPerSecond: number; omegaRadPerSecond: number; window: [number, number]; tolRel?: number }
  /**
   * THE WHOLE NETWORK'S ENERGY ACCOUNT over `window`, from the terminal map (`terminals.ts`): every element's absorbed work
   * W = ∫Σ v(node)·i(into terminal) dt. Reported SEPARATELY: energy the sources delivered, PHYSICAL dissipation (resistive and
   * other passive parts — each must absorb ≥ 0), storage change, motor conversion (load work), MOSFET work (reported, not
   * bounded: its Meyer gate capacitances are not charge-conserving), and the NUMERICAL residuals: the Tellegen closure ΣW
   * (zero for any network obeying KCL — so its size is solver/quadrature error, never heat) and each storing element's
   * W − ΔE. Pass: |closure| ≤ tolRel (1e-3) of the throughput, storage residuals ≤ tolStorageRel (2e-2), no passive part
   * delivering energy beyond tolRel. Below `minWorkJoules` (1e-12 J) of throughput: `unsupported`.
   */
  | { id: string; kind: 'energy-balance'; window?: [number, number]; tolRel?: number; tolStorageRel?: number; minWorkJoules?: number }
  /**
   * THE MOTORING DOMAIN (electromechanical v1): reverse rotation beyond `toleranceRadPerS` (1e-3) outside a declared grace after
   * the brake releases (`graceSeconds`, 0), or reverse winding current beyond `toleranceAmps` (1e-4), is a named UNSUPPORTED
   * outcome — the generator / four-quadrant regime is deferred, never clamped or relabelled. Reports min ω, min i and
   * min K·i·ω (negative: the machine was generating at that instant).
   */
  | { id: string; kind: 'motor-domain'; part: string; toleranceRadPerS?: number; toleranceAmps?: number; graceSeconds?: number }
  /**
   * THE ANALYTIC MOTOR REFERENCE (the page's matrix-exponential solution, `coupledReference` in motor.ts): with the drive a
   * constant `supplyVolts` through `seriesOhms` (a closed switch's R_on) across the motor terminals, from the SOLVED state at the
   * window start, i, ω and θ must follow the exact linear solution built from the part's own declaration (J_eff, τ, b, R, L, K);
   * `braked` holds ω ≡ 0 (a 1-state LR). The author states V and the series resistance by hand; the kit derives nothing else.
   */
  | { id: string; kind: 'motor-reference'; part: string; supplyVolts: number; seriesOhms: number; window: [number, number]; braked: boolean; tolRel?: number };

export interface ExpectationSet { id: string; checks: Check[] }
const EXCITATION_FLOOR_AMPS = 1e-9;

/**
 * Validate one check's SCHEMA before anything is solved: a malformed check is a named `invalid-check` error, never a
 * vacuous pass (an empty KCL, a bounds with no bound, a negative tolerance and an observable that cancels itself all
 * used to pass). Observable names are resolved against the structure here too.
 */
function validateCheck(check: Check, s: Structure, seen: Set<string>): void {
  const id = (check as { id?: unknown }).id;
  if (typeof id !== 'string' || !id) throw new ConformanceError('invalid-check', '?', 'every check needs a non-empty string id');
  if (seen.has(id)) throw new ConformanceError('invalid-check', id, `duplicate check id ${JSON.stringify(id)}`);
  seen.add(id);
  const bad = (m: string): never => { throw new ConformanceError('invalid-check', id, m); };
  const finite = (v: unknown, what: string) => { if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${what} must be a finite number`); return v as number; };
  const optTol = (v: unknown, what: string) => { if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) bad(`${what} must be a finite non-negative number`); };
  const obs = (o: unknown, what: string) => { if (typeof o !== 'string') bad(`${what} must name an observable`); vecOf(s, o as string); return o as string; };
  const win = (w: unknown) => { if (!Array.isArray(w) || w.length !== 2) bad('window must be [start, end]'); const [a, b] = (w as unknown[]).map((x, i) => finite(x, `window[${i}]`)); if (!(b > a)) bad('window end must follow window start'); };
  switch (check.kind) {
    case 'connectivity': if (check.danglingPorts !== undefined && !['fail', 'warn', 'off'].includes(check.danglingPorts)) bad('danglingPorts must be fail | warn | off'); return;
    case 'kcl': {
      if (!Array.isArray(check.into) || !Array.isArray(check.out) || check.into.length + check.out.length < 2) bad('kcl needs at least two observables across into[] and out[]');
      const all = [...check.into, ...check.out].map((o) => obs(o, 'kcl observable'));
      if (new Set(all).size !== all.length) bad('kcl observables must be distinct (an observable cannot balance itself)');
      optTol(check.tolRel, 'tolRel'); optTol(check.minPeakAmps, 'minPeakAmps'); return;
    }
    case 'ohm': case 'diode-law': case 'sensor-law': case 'comparator': case 'switching': {
      if (typeof check.part !== 'string') bad(`${check.kind} needs a part name`);
      if (check.kind !== 'comparator' && check.kind !== 'switching') { optTol(check.tolRel, 'tolRel'); optTol((check as { minPeakAmps?: number }).minPeakAmps, 'minPeakAmps'); }
      if (check.kind === 'diode-law') optTol(check.floorAmps, 'floorAmps');
      if (check.kind === 'sensor-law') { optTol(check.floorVolts, 'floorVolts'); if (check.minCoverage !== undefined && (typeof check.minCoverage !== 'number' || !(check.minCoverage > 0 && check.minCoverage <= 1))) bad('minCoverage must be in (0, 1]'); }
      if (check.kind === 'switching') { if (check.direction !== 'low->high' && check.direction !== 'high->low') bad('direction must be low->high or high->low'); win(check.window); }
      return;
    }
    case 'bounds': obs(check.observable, 'observable'); if (check.min === undefined && check.max === undefined) bad('bounds needs min and/or max');
      if (check.min !== undefined) finite(check.min, 'min'); if (check.max !== undefined) finite(check.max, 'max');
      if (check.min !== undefined && check.max !== undefined && check.min > check.max) bad('min must not exceed max'); return;
    case 'peak': obs(check.observable, 'observable'); win(check.window); finite(check.min, 'min'); return;
    case 'trough': obs(check.observable, 'observable'); win(check.window); finite(check.max, 'max'); return;
    case 'energy-balance': if (check.window !== undefined) win(check.window);
      optTol(check.tolRel, 'tolRel'); optTol(check.tolStorageRel, 'tolStorageRel'); optTol(check.minWorkJoules, 'minWorkJoules'); return;
    case 'motor-domain': if (typeof check.part !== 'string') bad('motor-domain needs a part name');
      optTol(check.toleranceRadPerS, 'toleranceRadPerS'); optTol(check.toleranceAmps, 'toleranceAmps'); optTol(check.graceSeconds, 'graceSeconds'); return;
    case 'motor-reference': if (typeof check.part !== 'string') bad('motor-reference needs a part name');
      finite(check.supplyVolts, 'supplyVolts'); if (finite(check.seriesOhms, 'seriesOhms') < 0) bad('seriesOhms must be ≥ 0');
      if (typeof check.braked !== 'boolean') bad('braked must be true or false'); win(check.window); optTol(check.tolRel, 'tolRel'); return;
    case 'state': obs(check.observable, 'observable'); if (check.at !== 'end') finite(check.at, 'at');
      if (!['gt', 'lt', 'near'].includes(check.op)) bad('op must be gt | lt | near'); finite(check.value, 'value'); optTol(check.tolAbs, 'tolAbs'); return;
    case 'storage-law': if (typeof check.part !== 'string') bad('storage-law needs a part name'); if (check.window !== undefined) win(check.window);
      optTol(check.tolRel, 'tolRel'); optTol(check.tolEnergyRel, 'tolEnergyRel'); optTol(check.minPeakAmps, 'minPeakAmps'); return;
    case 'reference': {
      obs(check.observable, 'observable'); finite(check.startAtSeconds, 'startAtSeconds'); finite(check.from, 'from'); finite(check.to, 'to');
      if (check.model === 'first-order-step') { const tau = finite(check.tauSeconds, 'tauSeconds'); if (!(tau > 0)) bad('tauSeconds must be positive'); }
      else if (check.model === 'second-order-step') {
        const a = finite(check.alphaPerSecond, 'alphaPerSecond'), w = finite(check.omegaRadPerSecond, 'omegaRadPerSecond');
        if (a < 0) bad('alphaPerSecond must be ≥ 0'); if (!(w > 0)) bad('omegaRadPerSecond must be positive (an overdamped or critically damped response is not this model)');
      } else bad(`model must be first-order-step or second-order-step (got ${JSON.stringify((check as { model?: unknown }).model)})`);
      if (check.from === check.to) bad('from and to must differ (a flat reference establishes nothing)'); win(check.window); if (check.window[0] < check.startAtSeconds) bad('window must start at or after startAtSeconds'); optTol(check.tolRel, 'tolRel'); return;
    }
    default: throw new ConformanceError('unknown-check', id, `Unknown check kind ${JSON.stringify((check as { kind: unknown }).kind)}`);
  }
}
export type Status = 'pass' | 'fail' | 'unsupported' | 'error' | 'warn';
export interface Result {
  check: string; kind: string; status: Status; component?: string; node?: string;
  expected?: string; observed?: string; tolerance?: string; unit?: string; atSeconds?: number; message: string;
}
/** The solver behind the kit. `vectors` are the SPICE vectors the checks will read (a native runner writes exactly those). */
export interface Engine { name: string; version: string; run(netlist: string, vectors: string[]): Promise<RawResult> }
export interface Report {
  kit: 'flux-conformance-1';
  composition: { id: string; sha256: string };
  expectations: { id: string; sha256: string; checks: number };
  engine: { name: string; version: string; options: { reltol: number }; requestedStopSeconds: number; requestedStepSeconds: number; samples: number | null; reachedSeconds: number | null };
  structure: { externalNodes: string[]; privateNodes: string[]; elements: number; models: number; danglingPorts: string[] };
  results: Result[];
  verdict: 'pass' | 'fail' | 'unsupported' | 'error';
  summary: string;
}

/** SHA-256 of canonical JSON (sorted keys) — the identity of an input, platform-independent. */
export async function sha256Json(value: unknown): Promise<string> {
  const canon = JSON.stringify(sortKeys(value));
  const bytes = new TextEncoder().encode(canon);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const sortKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;

interface Run { times: Float64Array; pick: (vec: string) => Float64Array; reached: number }

/**
 * Vector lookup for a solved structure, including DERIVED observables (electromechanical v1): `derived:<part>.<q>` is
 * Σ coefficient·vector at each sample, integrated from t = 0 by the trapezoid rule on the solver's own grid when declared
 * (θ = ∫ω dt from θ(0) = 0 — the motor page's definition; x = r·θ likewise). `v(0)` is the reference, identically zero.
 * Shared by the kit, the tests and the diagnostics, so a derived quantity has one definition.
 */
export function makePicker(s: Structure, times: Float64Array, pick: (vec: string) => Float64Array): (vec: string) => Float64Array {
  const n = times.length, zeros = new Float64Array(n), cache = new Map<string, Float64Array>();
  const base = (v: string) => v === 'v(0)' ? zeros : pick(v);
  return (vec: string) => {
    if (!vec.startsWith('derived:')) return base(vec);
    const hit = cache.get(vec); if (hit) return hit;
    const d = s.derived[vec];
    if (!d) throw new ConformanceError('missing-observable', vec, `No derived observable ${JSON.stringify(vec)} in this composition`);
    let out = new Float64Array(n);
    for (const [v, coef] of d.terms) { const a = base(v); for (let k = 0; k < n; k++) out[k] += coef * a[k]; }
    if (d.integrate) { const y = new Float64Array(n); for (let k = 1; k < n; k++) y[k] = y[k - 1] + 0.5 * (out[k] + out[k - 1]) * (times[k] - times[k - 1]); out = y; }
    cache.set(vec, out);
    return out;
  };
}
/** The SPICE vectors a structure needs from the engine: every plain observable and every term of every derived one. */
export const neededVectors = (s: Structure): string[] => [...new Set([...Object.values(s.observables).filter((v) => !v.startsWith('derived:')),
  ...Object.values(s.derived).flatMap((d) => d.terms.map(([v]) => v))])].filter((v) => v !== 'v(0)');

const partOf = (c: Composition, name: string): PartInstance | undefined => c.parts.find((p) => p.name === name);
const vecOf = (s: Structure, observable: string): string => {
  const v = s.observables[observable];
  if (!v) throw new ConformanceError('missing-observable', observable, `No observable ${JSON.stringify(observable)} in this composition (known: ${Object.keys(s.observables).slice(0, 12).join(', ')}…)`);
  return v;
};

// ---------------------------------------------------------------- shared numerics for the reference and energy checks
const interp = (r: Run, arr: Float64Array, t: number): number => { const { lo, hi, f } = locate(r.times, t); return arr[lo] + (arr[hi] - arr[lo]) * f; };
/** ∫ f dt over [w0, w1] by the trapezoid rule on the solver's samples, the window ends interpolated. */
function trapz(r: Run, f: Float64Array, w0: number, w1: number): number {
  let sum = 0, prevT = w0, prevF = interp(r, f, w0);
  for (let k = 0; k < r.times.length; k++) { const t = r.times[k]; if (t <= w0 || t >= w1) continue; sum += (f[k] + prevF) / 2 * (t - prevT); prevT = t; prevF = f[k]; }
  return sum + (interp(r, f, w1) + prevF) / 2 * (w1 - prevT);
}

type ReferenceCheck = Extract<Check, { kind: 'reference' }>;
function referenceAt(c: ReferenceCheck, t: number): number {
  const x = t - c.startAtSeconds;
  if (c.model === 'first-order-step') return c.to + (c.from - c.to) * Math.exp(-x / c.tauSeconds);
  const a = c.alphaPerSecond, w = c.omegaRadPerSecond;
  return c.to + (c.from - c.to) * Math.exp(-a * x) * (Math.cos(w * x) + (a / w) * Math.sin(w * x));
}
const referenceFormula = (c: ReferenceCheck): string => c.model === 'first-order-step'
  ? `x(t) = ${c.to} + (${c.from} − ${c.to})·exp(−(t − ${c.startAtSeconds})/${c.tauSeconds})`
  : `x(t) = ${c.to} + (${c.from} − ${c.to})·e^(−${c.alphaPerSecond}·τ)·(cos ${c.omegaRadPerSecond}·τ + (${c.alphaPerSecond}/${c.omegaRadPerSecond})·sin ${c.omegaRadPerSecond}·τ), τ = t − ${c.startAtSeconds}`;

type StorageCheck = Extract<Check, { kind: 'storage-law' }>;
type CoupledPart = Extract<PartInstance, { kind: 'coupled' }>;
/** storage-law for a coupled pair: both winding laws at interval midpoints; ∫(v₁i₁ + v₂i₂) dt against Δ(½L₁i₁² + ½L₂i₂² + M·i₁i₂). */
function coupledStorageLaw(check: StorageCheck, p: CoupledPart, s: Structure, r: Run, base: { check: string; kind: string }, w0: number, w1: number): Result {
  const L1 = p.spec.primaryHenries, L2 = p.spec.secondaryHenries, M = mutualHenries(p.spec);
  const pick = (q: string) => r.pick(vecOf(s, `${p.name}.${q}`));
  const i1 = pick('current1'), i2 = pick('current2'), vp1 = pick('vplus1'), vm1 = pick('vminus1'), vp2 = pick('vplus2'), vm2 = pick('vminus2');
  const n = r.times.length, v1 = new Float64Array(n), v2 = new Float64Array(n), pw = new Float64Array(n);
  let peakI = 0;
  for (let k = 0; k < n; k++) { v1[k] = vp1[k] - vm1[k]; v2[k] = vp2[k] - vm2[k]; pw[k] = v1[k] * i1[k] + v2[k] * i2[k]; peakI = Math.max(peakI, Math.abs(i1[k]), Math.abs(i2[k])); }
  let worst = 0, peakV = 0, samples = 0;
  for (let k = 1; k < n; k++) {
    const t0 = r.times[k - 1], t1 = r.times[k]; if (t1 <= t0 || t0 < w0 || t1 > w1) continue; samples++;
    const dt = t1 - t0, d1 = (i1[k] - i1[k - 1]) / dt, d2 = (i2[k] - i2[k - 1]) / dt;
    const c1 = L1 * d1 + M * d2, c2 = M * d1 + L2 * d2;
    // The same numerical acceptance envelope as a single winding (D-2): midpoint or endpoint form, whichever fits — not an
    // identification of the integrator, and not a guarantee that every wrong law fails (the ×1.02 control is the evidence).
    worst = Math.max(worst, Math.min(Math.abs((v1[k - 1] + v1[k]) / 2 - c1), Math.abs(v1[k] - c1)), Math.min(Math.abs((v2[k - 1] + v2[k]) / 2 - c2), Math.abs(v2[k] - c2)));
    peakV = Math.max(peakV, Math.abs(v1[k]), Math.abs(v2[k]));
  }
  const floorA = check.minPeakAmps ?? EXCITATION_FLOOR_AMPS;
  if (peakI < floorA || samples < 2) return { ...base, status: 'unsupported', component: check.part, expected: `peak winding current ≥ ${floorA} A over ≥ 2 intervals`, observed: `peak ${peakI.toExponential(2)} A, ${samples} intervals`, unit: 'A', message: 'no excitation: a storage law on zeros establishes nothing' };
  const E = (t: number) => { const a = interp(r, i1, t), b = interp(r, i2, t); return 0.5 * L1 * a * a + 0.5 * L2 * b * b + M * a * b; };
  const work = trapz(r, pw, w0, w1), dE = E(w1) - E(w0);
  const absP = new Float64Array(n); for (let k = 0; k < n; k++) absP[k] = Math.abs(v1[k] * i1[k]) + Math.abs(v2[k] * i2[k]);
  const scale = Math.max(Math.abs(work), Math.abs(dE), trapz(r, absP, w0, w1), 0.5 * (L1 + L2) * peakI * peakI * 1e-3);
  const tol = check.tolRel ?? 2e-2, tolE = check.tolEnergyRel ?? 2e-2, relLaw = worst / Math.max(peakV, 1e-30), relE = Math.abs(work - dE) / scale;
  const ok = relLaw <= tol && relE <= tolE;
  return { ...base, status: ok ? 'pass' : 'fail', component: check.part,
    expected: `v₁ = L₁·di₁/dt + M·di₂/dt, v₂ = M·di₁/dt + L₂·di₂/dt with L₁ ${L1} H, L₂ ${L2} H, M ${M.toExponential(4)} H; ∫(v₁i₁ + v₂i₂) dt = Δ(½L₁i₁² + ½L₂i₂² + M·i₁i₂) over ${w0}…${w1} s`,
    observed: `law residual ${worst.toExponential(2)} V = ${relLaw.toExponential(2)} of peak; port work ${work.toExponential(4)} J vs Δstored ${dE.toExponential(4)} J (${relE.toExponential(2)} relative)`,
    tolerance: `${tol} relative (law), ${tolE} relative (energy)`, unit: 'J',
    message: ok ? 'both winding laws and the coupled stored-energy bookkeeping agree with the trajectory' : relLaw > tol ? 'the winding voltages do not follow the coupled laws (a wrong dot or a wrong M shows here)' : 'integrated port work does not match the change of coupled stored energy' };
}

// ---------------------------------------------------------------- loss series, shared with the thermal layer (electrothermal v1)
/** Each element's absorbed power p_e(t) = Σ v(node)·i(into terminal) over its terminals, on the solver grid (the terminal map). */
export function elementPowerSeries(c: Composition, s: Structure, pick: (vec: string) => Float64Array, n: number): Map<string, Float64Array> {
  const power = new Map<string, Float64Array>();
  for (const term of terminalMap(c)) {
    const v = pick(vecOf(s, `node:${term.node}`));
    const currents = term.into.map(([o, coef]) => [pick(vecOf(s, o)), coef] as const);
    let pw = power.get(term.element); if (!pw) { pw = new Float64Array(n); power.set(term.element, pw); }
    for (let k = 0; k < n; k++) { let i = 0; for (const [arr, coef] of currents) i += coef * arr[k]; pw[k] += v[k] * i; }
  }
  return power;
}
type MotorPart = Extract<PartInstance, { kind: 'motor' }>;
/**
 * A motor's internal power flows on the solver grid: winding heat R·i², viscous heat b·ω², brake heat −τ_brake·ω (the brake's
 * reaction resists motion, so this is ≥ 0 up to solver noise), and the power τ_const·ω delivered to the declared external load
 * (work ON the load, not heat). The energy account and the thermal layer integrate THESE series — one extraction.
 */
export function motorPowerSeries(p: MotorPart, s: Structure, pick: (vec: string) => Float64Array, n: number) {
  const { motor: m, load } = p.spec, i = pick(vecOf(s, `${p.name}.windingCurrent`)), w = pick(vecOf(s, `${p.name}.omega`));
  const bt = p.spec.brake ? pick(vecOf(s, `${p.name}.brakeTorque`)) : null;
  const winding = new Float64Array(n), viscous = new Float64Array(n), brake = new Float64Array(n), external = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    winding[k] = m.resistanceOhms * i[k] * i[k]; viscous[k] = load.viscousNmS * w[k] * w[k];
    brake[k] = bt ? -bt[k] * w[k] : 0; external[k] = load.constantTorqueNm * w[k];
  }
  return { winding, viscous, brake, external };
}

/**
 * THE MOTORING DOMAIN of a solved motor — what the `motor-domain` check reports and what the thermal layer requires before it
 * heats anything (electrothermal v1): reverse rotation beyond the tolerance outside the post-release grace, or reverse winding
 * current, is outside the supported domain, with the reason named. Never clamped.
 */
export interface MotorDomainOptions { toleranceRadPerS?: number; toleranceAmps?: number; graceSeconds?: number }
export interface MotorDomain {
  ok: boolean; reason: string | null; atSeconds?: number; toleranceRadPerS: number; toleranceAmps: number;
  minOmega: number; minOmegaAt: number; minOmegaInGrace: number; minCurrent: number; minCurrentAt: number; minConversionW: number;
  graceWindow: [number, number] | null;
}
export function motorDomainOf(p: MotorPart, s: Structure, times: Float64Array, pick: (vec: string) => Float64Array, o: MotorDomainOptions = {}): MotorDomain {
  const tolW = o.toleranceRadPerS ?? 1e-3, tolI = o.toleranceAmps ?? 1e-4, grace = o.graceSeconds ?? 0, K = p.spec.motor.kVsPerRad;
  const w = pick(vecOf(s, `${p.name}.omega`)), i = pick(vecOf(s, `${p.name}.windingCurrent`));
  const rel = p.spec.brake?.releaseAtSeconds ?? null, edge = p.spec.brake?.edgeSeconds ?? 0;
  const graceWindow: [number, number] | null = rel !== null ? [rel, rel + edge + grace] : null;
  let minW = Infinity, minWt = 0, minWGrace = Infinity, minI = Infinity, minIt = 0, minConv = Infinity;
  for (let k = 0; k < times.length; k++) {
    const t = times[k];
    if (graceWindow && t >= graceWindow[0] && t <= graceWindow[1]) minWGrace = Math.min(minWGrace, w[k]); else if (w[k] < minW) { minW = w[k]; minWt = t; }
    if (i[k] < minI) { minI = i[k]; minIt = t; }
    minConv = Math.min(minConv, K * i[k] * w[k]);
  }
  const base = { toleranceRadPerS: tolW, toleranceAmps: tolI, minOmega: minW, minOmegaAt: minWt, minOmegaInGrace: minWGrace, minCurrent: minI, minCurrentAt: minIt, minConversionW: minConv, graceWindow };
  if (minW < -tolW) return { ...base, ok: false, atSeconds: minWt, reason: `outside the supported motoring domain: reverse rotation ${(-minW).toPrecision(3)} rad/s at ${minWt.toFixed(4)} s — the generator / four-quadrant regime is deferred, and the run is not clamped` };
  if (minI < -tolI) return { ...base, ok: false, atSeconds: minIt, reason: `outside the supported motoring domain: reverse winding current ${(-minI).toPrecision(3)} A at ${minIt.toFixed(4)} s` };
  return { ...base, ok: true, reason: null };
}

type EnergyCheck = Extract<Check, { kind: 'energy-balance' }>;
/** The whole network's energy account (see the `energy-balance` Check doc): physical terms and numerical residuals reported apart. */
/**
 * THE ENERGY ACCOUNT of a solved composition over [w0, w1]: the numbers behind `energy-balance`, exported (electrothermal v1) so
 * the thermal layer books the SAME losses from the SAME trajectory instead of re-deriving them. `losses` is keyed by loss-source
 * identity — a passive part's name (its terminal work) and `<motor>.winding` / `.viscous` / `.brake` — the ids the thermal
 * descriptor routes. `residual` = delivered − (stores + Σ losses + external load work + MOSFET work): numerical, never heat.
 */
export interface EnergyAccount {
  window: [number, number];
  throughput: number; closure: number; relClosure: number; relInst: number; peakFlow: number;
  delivered: number; dissipated: number; stores: number; potential: number; external: number; brakeWork: number; mosfet: number;
  losses: Record<string, number>;
  worstStorage: number; worstStorageAt: string; passiveDelivering: string[];
  residual: number;
}
export function energyAccountOf(c: Composition, s: Structure, times: Float64Array, pick: (vec: string) => Float64Array,
  w0 = times[0], w1 = times[times.length - 1], tol = 1e-3): EnergyAccount {
  return accountOf(c, s, { times, pick, reached: w1 }, w0, w1, tol);
}
function accountOf(c: Composition, s: Structure, r: Run, w0: number, w1: number, tol: number): EnergyAccount {
  const n = r.times.length, power = elementPowerSeries(c, s, r.pick, n);
  const work = new Map<string, number>(); for (const [el, pw] of power) work.set(el, trapz(r, pw, w0, w1));
  let throughput = 0, closure = 0; for (const w of work.values()) { throughput += Math.abs(w); closure += w; } throughput /= 2;
  let delivered = 0; for (const x of [...c.sources.map((q) => q.name), ...(c.environments ?? []).map((e) => e.name)]) delivered -= work.get(x) ?? 0;
  let dissipated = 0, stores = 0, external = 0, mosfet = 0, potential = 0, brakeWork = 0, worstStorage = 0, worstStorageAt = '';
  const losses: Record<string, number> = {}, passiveDelivering: string[] = [];
  const at = (o: string, t: number) => interp(r, r.pick(vecOf(s, o)), t);
  for (const p of c.parts) {
    const W = work.get(p.name) ?? 0, role = ENERGY_ROLE[p.kind];
    if (role === 'dissipative') { dissipated += W; losses[p.name] = W; if (W < -tol * throughput) passiveDelivering.push(`${p.name} (${p.kind}) delivered ${(-W).toExponential(3)} J, which a passive part cannot`); continue; }
    if (role === 'unbounded') { mosfet += W; continue; }
    let dE = 0, loss = 0, conv = 0, brakeW = 0;
    if (p.kind === 'capacitor') { const v = (t: number) => at(`${p.name}.vplus`, t) - at(`${p.name}.vminus`, t); dE = 0.5 * p.spec.farads * (v(w1) ** 2 - v(w0) ** 2); }
    else if (p.kind === 'inductor') dE = 0.5 * p.spec.henries * (at(`${p.name}.current`, w1) ** 2 - at(`${p.name}.current`, w0) ** 2);
    else if (p.kind === 'coupled') {
      const M = mutualHenries(p.spec), E = (t: number) => { const a = at(`${p.name}.current1`, t), b = at(`${p.name}.current2`, t); return 0.5 * p.spec.primaryHenries * a * a + 0.5 * p.spec.secondaryHenries * b * b + M * a * b; };
      dE = E(w1) - E(w0);
    } else if (p.kind === 'motor') {
      // Electromechanical v1: J_eff carries the rack's reflected inertia, so ½·J_eff·ω² counts the rack's kinetic energy ONCE;
      // its weight does work m·g·Δx into a gravitational STORE (not a loss); the constant torque is external load work; the
      // brake's work on the shaft (≤ 0 while it resists) is booked from its solved reaction torque, never assumed. The loss
      // series are `motorPowerSeries` — the same ones the thermal layer routes (electrothermal v1).
      const { motor: m, load, rack } = p.spec, iw = `${p.name}.windingCurrent`, om = `${p.name}.omega`;
      const dPot = rack ? gravityTorque(rack) * (at(`${p.name}.theta`, w1) - at(`${p.name}.theta`, w0)) : 0;
      dE = 0.5 * m.inductanceHenries * (at(iw, w1) ** 2 - at(iw, w0) ** 2) + 0.5 * shaftInertia(load, rack) * (at(om, w1) ** 2 - at(om, w0) ** 2) + dPot;
      potential += dPot;
      const ms = motorPowerSeries(p, s, r.pick, n);
      const winding = trapz(r, ms.winding, w0, w1), viscous = trapz(r, ms.viscous, w0, w1), brakeHeat = trapz(r, ms.brake, w0, w1);
      losses[`${p.name}.winding`] = winding; losses[`${p.name}.viscous`] = viscous;
      if (p.spec.brake) losses[`${p.name}.brake`] = brakeHeat;
      loss = winding + viscous; conv = trapz(r, ms.external, w0, w1); brakeW = -brakeHeat; brakeWork += brakeW;
    }
    stores += dE; dissipated += loss; external += conv;
    // Scale: the element's GROSS port energy too — a storing element that returns to its start state has W ≈ ΔE ≈ 0, which is
    // no scale for a quadrature error (electronics v1 amendment D-4, the same defect as D-2 in storage-law).
    const pw = power.get(p.name), absPw = new Float64Array(n); if (pw) for (let k = 0; k < n; k++) absPw[k] = Math.abs(pw[k]);
    // Port work = ΔE + losses + external load work − work the brake did on the shaft (motor); the rest is numerical.
    const res = Math.abs(W - dE - loss - conv + brakeW) / Math.max(Math.abs(W), Math.abs(dE), trapz(r, absPw, w0, w1), 1e-3 * throughput);
    if (res > worstStorage) { worstStorage = res; worstStorageAt = p.name; }
  }
  // INSTANTANEOUS closure too: Σ_e p_e(t) at every sample in the window against the power flow Σ|p_e(t)|/2. The integral alone
  // cannot see a mis-scaled current on an element whose net work over the window is ~0 (a ring-down); the sample-wise sum can.
  let worstInst = 0, peakFlow = 0;
  for (let k = 0; k < n; k++) {
    const t = r.times[k]; if (t < w0 || t > w1) continue;
    let sum = 0, abs = 0; for (const pw of power.values()) { sum += pw[k]; abs += Math.abs(pw[k]); }
    worstInst = Math.max(worstInst, Math.abs(sum)); peakFlow = Math.max(peakFlow, abs / 2);
  }
  let lossSum = 0; for (const v of Object.values(losses)) lossSum += v;
  return { window: [w0, w1], throughput, closure, relClosure: throughput > 0 ? Math.abs(closure) / throughput : 0, relInst: peakFlow > 0 ? worstInst / peakFlow : 0, peakFlow,
    delivered, dissipated, stores, potential, external, brakeWork, mosfet, losses, worstStorage, worstStorageAt, passiveDelivering,
    residual: delivered - (stores + lossSum + external + mosfet) };
}

function energyBalance(check: EnergyCheck, c: Composition, s: Structure, r: Run, base: { check: string; kind: string }, w0: number, w1: number): Result {
  const tol = check.tolRel ?? 1e-3, tolS = check.tolStorageRel ?? 2e-2, minW = check.minWorkJoules ?? 1e-12;
  const a = accountOf(c, s, r, w0, w1, tol);
  if (a.throughput < minW) return { ...base, status: 'unsupported', expected: `throughput ≥ ${minW} J`, observed: `${a.throughput.toExponential(2)} J`, unit: 'J', message: 'no excitation: an energy account of zeros establishes nothing' };
  const { throughput, closure, relClosure, relInst, peakFlow, delivered, dissipated, potential, brakeWork, mosfet, worstStorage, worstStorageAt } = a;
  const stored = a.stores, converted = a.external;
  const problems: string[] = [...a.passiveDelivering];
  if (relInst > tol) problems.push(`instantaneous closure ${relInst.toExponential(2)} of the peak power flow ${peakFlow.toExponential(3)} W (a sign/mapping error or a solver fault — never heat)`);
  const ok = relClosure <= tol && relInst <= tol && worstStorage <= tolS && problems.length === 0;
  const e = (x: number) => x.toExponential(4);
  return { ...base, status: ok ? 'pass' : 'fail',
    expected: `Tellegen closure ΣW = 0 within ${tol} of the throughput; each storing element W − ΔE within ${tolS}; every passive part absorbs ≥ 0 — over ${w0}…${w1} s`,
    observed: `PHYSICAL: delivered ${e(delivered)} J → dissipated ${e(dissipated)} J, stored Δ ${e(stored)} J (of which gravitational m·g·Δx ${e(potential)} J), converted (motor load) ${e(converted)} J, brake work on the shaft ${e(brakeWork)} J, MOSFET (channel + gate charge, unbounded) ${e(mosfet)} J. NUMERICAL: closure ${closure.toExponential(2)} J = ${relClosure.toExponential(2)} of throughput ${throughput.toExponential(3)} J; worst storage residual ${worstStorage.toExponential(2)}${worstStorageAt ? ` (${worstStorageAt})` : ''}${problems.length ? `. ${problems.join('; ')}` : ''}`,
    tolerance: `closure ${tol}, storage ${tolS} relative`, unit: 'J',
    message: ok ? 'energy account closes: the numerical residual is reported apart from the physical dissipation'
      : relClosure > tol || relInst > tol ? 'the terminal powers do not sum to zero (a sign/mapping error or a solver fault — never heat)'
      : problems.length ? 'a passive part delivered energy' : 'a storing element\'s port work does not match its stored-energy change' };
}

function evaluate(check: Check, c: Composition, s: Structure, run: Run | null): Result {
  const base = { check: check.id, kind: check.kind };
  const need = (): Run => { if (!run) throw new ConformanceError('no-solve', check.id, 'The solve did not produce a usable trajectory'); return run; };
  const window = (t: number, label: string) => { const r = need(); if (!Number.isFinite(t) || t < 0 || t > r.reached) throw new ConformanceError('window-outside-horizon', check.id, `${label} ${t} s is outside the solved horizon 0…${r.reached} s`); };
  const at = (arr: Float64Array, r: Run, t: number) => { const { lo, hi, f } = locate(r.times, t); return arr[lo] + (arr[hi] - arr[lo]) * f; };
  switch (check.kind) {
    case 'connectivity': {
      const unreachable = s.findings.filter((f) => f.cause === 'unreachable-node');
      if (unreachable.length) return { ...base, status: 'fail', node: unreachable[0].where, message: unreachable.map((f) => f.message).join('; ') };
      const mode = check.danglingPorts ?? 'warn';
      if (mode !== 'off' && s.danglingPorts.length) return { ...base, status: mode === 'fail' ? 'fail' : 'warn', node: s.danglingPorts[0], message: `dangling-port heuristic: external node(s) with a single conduction edge: ${s.danglingPorts.join(', ')} (a heuristic, not a floating-node verdict)` };
      return { ...base, status: 'pass', message: `every external node reaches ground over conduction edges (${s.externalNodes.size} nodes)` };
    }
    case 'kcl': {
      const r = need(), tol = check.tolRel ?? 1e-6;
      const into = check.into.map((o) => r.pick(vecOf(s, o))), out = check.out.map((o) => r.pick(vecOf(s, o)));
      let worst = 0, peak = 0;
      for (let k = 0; k < r.times.length; k++) { let sum = 0; for (const a of into) sum += a[k]; for (const b of out) sum -= b[k]; let mag = 0; for (const a of [...into, ...out]) mag = Math.max(mag, Math.abs(a[k])); peak = Math.max(peak, mag); worst = Math.max(worst, Math.abs(sum)); }
      const floor = check.minPeakAmps ?? EXCITATION_FLOOR_AMPS;
      if (peak < floor) return { ...base, status: 'unsupported', expected: `peak current ≥ ${floor} A`, observed: `peak ${peak.toExponential(2)} A`, unit: 'A', message: 'no excitation: a balance of zeros establishes nothing' };
      const rel = worst / peak;
      return { ...base, status: rel <= tol ? 'pass' : 'fail', expected: `Σ into = Σ out`, observed: `worst |Σ| ${worst.toExponential(2)} A = ${rel.toExponential(2)} of peak ${peak.toExponential(2)} A`, tolerance: `${tol} relative`, unit: 'A', message: `KCL between probed currents at every sample` };
    }
    case 'ohm': {
      const r = need(), p = partOf(c, check.part), tol = check.tolRel ?? 1e-4;
      if (!p) throw new ConformanceError('missing-observable', check.part, `No part ${check.part}`);
      let worst = 0, peak = 0, what = '';
      if (p.kind === 'resistor') {
        const va = r.pick(vecOf(s, `${p.name}.va`)), vb = r.pick(vecOf(s, `${p.name}.vb`)), i = r.pick(vecOf(s, `${p.name}.current`));
        for (let k = 0; k < r.times.length; k++) { worst = Math.max(worst, Math.abs((va[k] - vb[k]) / p.spec.ohms - i[k])); peak = Math.max(peak, Math.abs(i[k])); }
        what = `(v_a − v_b)/R = i  with R ${p.spec.ohms} Ω`;
      } else if (p.kind === 'pot') {
        const { aw, wb } = potLegs(p.spec);
        const va = r.pick(vecOf(s, `${p.name}.va`)), vt = r.pick(vecOf(s, `${p.name}.vtrack`)), vw = r.pick(vecOf(s, `${p.name}.vw`)), vb = r.pick(vecOf(s, `${p.name}.vb`));
        const ia = r.pick(vecOf(s, `${p.name}.currentA`)), iw = r.pick(vecOf(s, `${p.name}.currentW`));
        for (let k = 0; k < r.times.length; k++) {
          worst = Math.max(worst, Math.abs((va[k] - vt[k]) / aw - ia[k]), Math.abs((vt[k] - vb[k]) / wb - (ia[k] - iw[k])), Math.abs((vt[k] - vw[k]) / p.spec.contactOhms - iw[k]));
          peak = Math.max(peak, Math.abs(ia[k]));
        }
        what = `each leg's Ohm's law from the track node (A–W ${aw} Ω, W–B ${wb} Ω, contact ${p.spec.contactOhms} Ω)`;
      } else return { ...base, status: 'unsupported', component: check.part, message: `ohm check is defined for resistor and pot, not ${p.kind}` };
      const floorA = check.minPeakAmps ?? EXCITATION_FLOOR_AMPS;
      if (peak < floorA) return { ...base, status: 'unsupported', component: check.part, expected: `peak current ≥ ${floorA} A`, observed: `peak ${peak.toExponential(2)} A`, unit: 'A', message: 'no excitation: Ohm on zeros establishes nothing' };
      const rel = worst / peak;
      return { ...base, status: rel <= tol ? 'pass' : 'fail', component: check.part, expected: what, observed: `worst residual ${worst.toExponential(2)} A = ${rel.toExponential(2)} of peak ${peak.toExponential(2)} A`, tolerance: `${tol} relative (solver reltol ${c.analysis.reltol ?? 1e-4})`, unit: 'A', message: 'Ohm law on independent observables' };
    }
    case 'diode-law': {
      const r = need(), p = partOf(c, check.part), tol = check.tolRel ?? 2e-3, floor = check.floorAmps ?? 1e-6;
      if (!p || (p.kind !== 'diode' && p.kind !== 'led')) return { ...base, status: 'unsupported', component: check.part, message: `diode-law needs a diode or led part` };
      const spec = p.kind === 'diode' ? p.spec : p.spec.part;
      const va = r.pick(vecOf(s, `${p.name}.vanode`)), vc = r.pick(vecOf(s, `${p.name}.vcathode`)), i = r.pick(vecOf(s, `${p.name}.current`));
      let worst = 0, peak = 0;
      for (let k = 0; k < r.times.length; k++) { const law = shockleyCurrent(va[k] - vc[k], { ...spec, orientation: 'forward' }); worst = Math.max(worst, Math.abs(i[k] - law) / Math.max(Math.abs(law), floor)); peak = Math.max(peak, Math.abs(i[k])); }
      const floorA = check.minPeakAmps ?? EXCITATION_FLOOR_AMPS;
      if (peak < floorA) return { ...base, status: 'unsupported', component: check.part, expected: `peak current ≥ ${floorA} A`, observed: `peak ${peak.toExponential(2)} A`, unit: 'A', message: 'no excitation: the diode never conducted, so its law was not exercised' };
      return { ...base, status: worst <= tol ? 'pass' : 'fail', component: check.part, expected: 'i = Shockley(v_anode − v_cathode) with RS', observed: `worst ${worst.toExponential(2)} of max(|i_law|, ${floor} A); peak ${peak.toExponential(2)} A`, tolerance: `${tol} relative (model equation vs solver; the model is illustrative)`, unit: 'A', message: 'diode law at every sample' };
    }
    case 'sensor-law': {
      const r = need(), p = partOf(c, check.part), tol = check.tolRel ?? 1e-3, floorV = check.floorVolts ?? 1e-3, minCov = check.minCoverage ?? 0.5;
      if (!p || (p.kind !== 'ldr' && p.kind !== 'ntc')) return { ...base, status: 'unsupported', component: check.part, message: 'sensor-law needs an ldr or ntc part' };
      // The sensor's OWN probe. Residual in the voltage domain: |i·R(env) − (va − vb)| against max(|va − vb|, floorVolts),
      // so a zero current is a real residual, never a NaN to skip. Coverage = fraction of samples with |va − vb| ≥ floorVolts.
      const va = r.pick(vecOf(s, `${p.name}.va`)), vb = r.pick(vecOf(s, `${p.name}.vb`)), env = r.pick(vecOf(s, `${p.name}.env`)), i = r.pick(vecOf(s, `${p.name}.current`));
      let worst = 0, covered = 0;
      for (let k = 0; k < r.times.length; k++) {
        const law = p.kind === 'ldr' ? ldrOhms(env[k], p.spec) : ntcOhms(env[k], p.spec);
        const dv = va[k] - vb[k];
        if (Math.abs(dv) >= floorV) covered++;
        worst = Math.max(worst, Math.abs(i[k] * law - dv) / Math.max(Math.abs(dv), floorV));
      }
      const coverage = covered / r.times.length;
      if (coverage < minCov) return { ...base, status: 'unsupported', component: check.part, expected: `≥ ${minCov} of samples with |va − vb| ≥ ${floorV} V`, observed: `coverage ${coverage.toFixed(3)}`, unit: 'V', message: 'insufficient excitation: the sensor law was not exercised' };
      return { ...base, status: worst <= tol ? 'pass' : 'fail', component: check.part, expected: `i·R(env) = va − vb per the declared ${p.kind.toUpperCase()} law`, observed: `worst ${worst.toExponential(2)} relative (voltage domain), coverage ${coverage.toFixed(3)}`, tolerance: `${tol} relative to max(|va − vb|, ${floorV} V) (implementation agreement, not sensor accuracy)`, unit: 'V', message: `law vs solved trajectory at every sample, current from the sensor's own probe` };
    }
    case 'bounds': {
      const r = need(), v = r.pick(vecOf(s, check.observable));
      let lo = Infinity, hi = -Infinity; for (let k = 0; k < v.length; k++) { if (v[k] < lo) lo = v[k]; if (v[k] > hi) hi = v[k]; }
      const ok = (check.min === undefined || lo >= check.min) && (check.max === undefined || hi <= check.max);
      return { ...base, status: ok ? 'pass' : 'fail', component: check.observable.split('.')[0], expected: `${check.min ?? '−∞'} ≤ value ≤ ${check.max ?? '+∞'}`, observed: `min ${lo.toExponential(3)}, max ${hi.toExponential(3)}`, message: 'bounds over every sample' };
    }
    case 'peak': case 'trough': {
      const r = need(); window(check.window[0], 'window start'); window(check.window[1], 'window end');
      if (check.window[1] <= check.window[0]) throw new ConformanceError('invalid-check', check.id, 'window end must follow window start');
      const v = r.pick(vecOf(s, check.observable)), high = check.kind === 'peak';
      let best = high ? -Infinity : Infinity, when = NaN, n = 0;
      for (let k = 0; k < v.length; k++) { const t = r.times[k]; if (t < check.window[0] || t > check.window[1]) continue; n++; if (high ? v[k] > best : v[k] < best) { best = v[k]; when = t; } }
      if (n === 0) throw new ConformanceError('invalid-check', check.id, `no samples inside [${check.window[0]}, ${check.window[1]}] s`);
      const ok = check.kind === 'peak' ? best >= check.min : best <= check.max;
      const bound = check.kind === 'peak' ? `max ≥ ${check.min}` : `min ≤ ${check.max}`;
      return { ...base, status: ok ? 'pass' : 'fail', component: check.observable.split('.')[0], atSeconds: when, expected: `${bound} in [${check.window[0]}, ${check.window[1]}] s`, observed: `${high ? 'max' : 'min'} ${best.toExponential(4)} at ${when.toFixed(5)} s over ${n} samples`, message: `${high ? 'peak' : 'trough'} inside a window (sampled: a pulse shorter than the step can be missed, which fails, never passes)` };
    }
    case 'state': {
      const r = need(); const t = check.at === 'end' ? r.reached : check.at; window(t, 'state time');
      const v = at(r.pick(vecOf(s, check.observable)), r, t), tol = check.tolAbs ?? 0;
      const ok = check.op === 'gt' ? v > check.value : check.op === 'lt' ? v < check.value : Math.abs(v - check.value) <= tol;
      return { ...base, status: ok ? 'pass' : 'fail', component: check.observable.split('.')[0], atSeconds: t, expected: `${check.op} ${check.value}${check.op === 'near' ? ` ± ${tol}` : ''}`, observed: v.toExponential(4), message: `named state at ${t} s` };
    }
    case 'storage-law': {
      const r = need(), p = partOf(c, check.part);
      if (!p || (p.kind !== 'capacitor' && p.kind !== 'inductor' && p.kind !== 'coupled')) return { ...base, status: 'unsupported', component: check.part, message: `storage-law is defined for capacitor, inductor and coupled, not ${p?.kind ?? 'a missing part'}` };
      const [w0, w1] = check.window ?? [0, r.reached]; window(w0, 'window start'); window(w1, 'window end');
      if (p.kind === 'coupled') return coupledStorageLaw(check, p, s, r, base, w0, w1);
      const vp = r.pick(vecOf(s, `${p.name}.vplus`)), vm = r.pick(vecOf(s, `${p.name}.vminus`)), i = r.pick(vecOf(s, `${p.name}.current`));
      const n = r.times.length; const v = new Float64Array(n); for (let k = 0; k < n; k++) v[k] = vp[k] - vm[k];
      // The element law per interval, relative to the peak: the finite-difference derivative against the current (voltage) at the
      // interval MIDPOINT or at its END, whichever fits — a NUMERICAL ACCEPTANCE ENVELOPE (amendment D-2), not an identification of
      // the integrator ngspice used on that step. It admits up to |Δi|/2 (|Δv|/2) per interval that the midpoint form alone would
      // flag (rc-charge-discharge at 11 ms: 1.25e-4 A = 2.5 % of peak, consistent with a backward-Euler step after the breakpoint).
      // It does not guarantee that every wrong law fails; the scaled-current controls (×1.1, ×1.02) are the evidence that those do.
      const K = p.kind === 'capacitor' ? p.spec.farads : p.spec.henries;
      let worst = 0, peak = 0, samples = 0;
      for (let k = 1; k < n; k++) {
        const t0 = r.times[k - 1], t1 = r.times[k]; if (t1 <= t0 || t0 < w0 || t1 > w1) continue; samples++;
        const dt = t1 - t0;
        const chord = p.kind === 'capacitor' ? K * (v[k] - v[k - 1]) / dt : K * (i[k] - i[k - 1]) / dt;
        const y0 = p.kind === 'capacitor' ? i[k - 1] : v[k - 1], y1 = p.kind === 'capacitor' ? i[k] : v[k];
        const res = Math.min(Math.abs((y0 + y1) / 2 - chord), Math.abs(y1 - chord));
        worst = Math.max(worst, Math.abs(res)); peak = Math.max(peak, p.kind === 'capacitor' ? Math.abs(i[k]) : Math.abs(v[k]));
      }
      const floorA = check.minPeakAmps ?? EXCITATION_FLOOR_AMPS; let peakI = 0; for (let k = 0; k < n; k++) peakI = Math.max(peakI, Math.abs(i[k]));
      if (peakI < floorA || samples < 2) return { ...base, status: 'unsupported', component: check.part, expected: `peak current ≥ ${floorA} A over ≥ 2 intervals`, observed: `peak ${peakI.toExponential(2)} A, ${samples} intervals`, unit: 'A', message: 'no excitation: a storage law on zeros establishes nothing' };
      const tol = check.tolRel ?? 2e-2, relLaw = worst / peak;
      // Port work ∫ v·i dt (trapezoid, window ends interpolated) against Δ(½·K·x²), relative to the larger of the two.
      const x = p.kind === 'capacitor' ? v : i; const val = (arr: Float64Array, t: number) => at(arr, r, t);
      let work = 0; let prevT = w0, prevP = val(v, w0) * val(i, w0);
      for (let k = 0; k < n; k++) { const t = r.times[k]; if (t <= w0 || t >= w1) continue; const pw = v[k] * i[k]; work += (pw + prevP) / 2 * (t - prevT); prevT = t; prevP = pw; }
      work += (val(v, w1) * val(i, w1) + prevP) / 2 * (w1 - prevT);
      const x0 = val(x, w0), x1 = val(x, w1); const dE = 0.5 * K * (x1 * x1 - x0 * x0);
      let xPeak = 0; for (let k = 0; k < n; k++) xPeak = Math.max(xPeak, Math.abs(x[k]));   // a loop: a spread over a long adaptive run would hit the argument limit (Astra, b05fd421)
      // Scale: the larger of the net terms and the GROSS port energy ∫|v·i| dt. A window that returns to its start state (a full
      // charge–discharge, a ring-down) has a near-zero net change, which is no scale for an error (electronics v1 amendment D-2).
      const absP = new Float64Array(n); for (let k = 0; k < n; k++) absP[k] = Math.abs(v[k] * i[k]);
      const scale = Math.max(Math.abs(work), Math.abs(dE), trapz(r, absP, w0, w1), 0.5 * K * xPeak * xPeak * 1e-3);
      const tolE = check.tolEnergyRel ?? 2e-2, relE = Math.abs(work - dE) / scale;
      const ok = relLaw <= tol && relE <= tolE;
      return { ...base, status: ok ? 'pass' : 'fail', component: check.part,
        expected: p.kind === 'capacitor' ? `i = C·dv/dt with C ${K} F; ∫v·i dt = Δ(½Cv²) over ${w0}…${w1} s` : `v = L·di/dt with L ${K} H; ∫v·i dt = Δ(½Li²) over ${w0}…${w1} s`,
        observed: `law residual ${worst.toExponential(2)} = ${relLaw.toExponential(2)} of peak; port work ${work.toExponential(4)} J vs Δstored ${dE.toExponential(4)} J (${relE.toExponential(2)} relative)`,
        tolerance: `${tol} relative (law), ${tolE} relative (energy)`, unit: 'J', message: ok ? 'element law and stored-energy bookkeeping agree with the trajectory' : relLaw > tol ? 'the current/voltage series do not follow the element law' : 'integrated port work does not match the change of stored energy' };
    }
    case 'reference': {
      const r = need(); window(check.window[0], 'window start'); window(check.window[1], 'window end');
      const xs = r.pick(vecOf(s, check.observable)); const span = Math.abs(check.to - check.from); const tol = check.tolRel ?? 1e-2;
      let worst = 0, worstT = check.window[0], count = 0;
      for (let k = 0; k < r.times.length; k++) { const t = r.times[k]; if (t < check.window[0] || t > check.window[1]) continue; count++;
        const ref = referenceAt(check, t); const e = Math.abs(xs[k] - ref); if (e > worst) { worst = e; worstT = t; } }
      if (count < 2) return { ...base, status: 'unsupported', message: 'fewer than two samples in the window' };
      const rel = worst / span;
      return { ...base, status: rel <= tol ? 'pass' : 'fail', component: check.observable.split('.')[0], atSeconds: worstT, expected: `${referenceFormula(check)} over ${check.window[0]}…${check.window[1]} s`, observed: `worst |x − ref| ${worst.toExponential(3)} at ${worstT.toExponential(3)} s = ${rel.toExponential(2)} of the span ${span}`, tolerance: `${tol} of the span`, message: rel <= tol ? `follows the ${check.model} (${count} samples)` : `departs from the ${check.model}` };
    }
    case 'energy-balance': {
      const r = need(); const [w0, w1] = check.window ?? [0, r.reached]; window(w0, 'window start'); window(w1, 'window end');
      if (!(w1 > w0)) throw new ConformanceError('invalid-check', check.id, 'window end must follow window start');
      return energyBalance(check, c, s, r, base, w0, w1);
    }
    case 'motor-domain': {
      const r = need(), p = partOf(c, check.part);
      if (!p || p.kind !== 'motor') return { ...base, status: 'unsupported', component: check.part, message: 'motor-domain needs a motor part' };
      const d = motorDomainOf(p, s, r.times, r.pick, check);
      const observed = `min ω ${d.minOmega.toExponential(3)} rad/s at ${d.minOmegaAt.toFixed(4)} s outside the grace${d.graceWindow ? `; in the post-release grace [${d.graceWindow[0]}, ${d.graceWindow[1].toFixed(4)}] s: min ω ${d.minOmegaInGrace === Infinity ? 'n/a' : d.minOmegaInGrace.toExponential(3)} rad/s (reported, not refused)` : ''}; min winding current ${d.minCurrent.toExponential(3)} A; min K·i·ω ${d.minConversionW.toExponential(3)} W (negative = generating at that instant)`;
      const expected = `ω ≥ −${d.toleranceRadPerS} rad/s outside the post-release grace and i ≥ −${d.toleranceAmps} A (motoring)`;
      if (!d.ok) return { ...base, status: 'unsupported', component: p.name, atSeconds: d.atSeconds, expected, observed, message: d.reason! };
      return { ...base, status: 'pass', component: p.name, expected, observed, message: 'inside the supported motoring domain' };
    }
    case 'motor-reference': {
      const r = need(), p = partOf(c, check.part);
      if (!p || p.kind !== 'motor') return { ...base, status: 'unsupported', component: check.part, message: 'motor-reference needs a motor part' };
      const [t0, t1] = check.window; window(t0, 'window start'); window(t1, 'window end');
      const { motor: m, load, rack } = p.spec, tol = check.tolRel ?? 5e-3;
      const params = { R: m.resistanceOhms + check.seriesOhms, L: m.inductanceHenries, K: m.kVsPerRad, J: shaftInertia(load, rack), b: load.viscousNmS, tau: shaftLoadTorque(load, rack), V: check.supplyVolts };
      const I = r.pick(vecOf(s, `${p.name}.windingCurrent`)), W = r.pick(vecOf(s, `${p.name}.omega`)), TH = r.pick(vecOf(s, `${p.name}.theta`));
      const from = { i: interp(r, I, t0), omega: check.braked ? 0 : interp(r, W, t0), theta: interp(r, TH, t0) };
      let worstI = 0, worstW = 0, worstTh = 0, peakI = 0, peakW = 0, peakTh = 0;
      for (let j = 0; j < 400; j++) {
        const t = t0 + (j + 0.5) / 400 * (t1 - t0), ref = coupledReference(params, check.braked, from, t0, t);
        const i = interp(r, I, t), w = interp(r, W, t), th = interp(r, TH, t);
        worstI = Math.max(worstI, Math.abs(i - ref.i)); worstW = Math.max(worstW, Math.abs(w - ref.omega)); worstTh = Math.max(worstTh, Math.abs(th - ref.theta));
        peakI = Math.max(peakI, Math.abs(i)); peakW = Math.max(peakW, Math.abs(w)); peakTh = Math.max(peakTh, Math.abs(th - from.theta));
      }
      const relI = worstI / Math.max(peakI, 1e-12), relW = check.braked ? worstW : worstW / Math.max(peakW, 1e-12), relTh = check.braked ? 0 : worstTh / Math.max(peakTh, 1e-12);
      const ok = relI <= tol && (check.braked ? worstW <= 1e-5 : relW <= tol) && relTh <= tol;
      return { ...base, status: ok ? 'pass' : 'fail', component: p.name,
        expected: `the exact ${check.braked ? 'braked 1-state LR' : 'coupled 3-state'} solution (J_eff ${params.J.toExponential(4)} kg·m², τ ${params.tau.toExponential(4)} N·m, R ${params.R} Ω, V ${params.V} V) over ${t0}…${t1} s from the solved state at ${t0} s`,
        observed: `worst Δi ${relI.toExponential(2)} of peak ${peakI.toExponential(3)} A; ${check.braked ? `worst |ω| ${worstW.toExponential(2)} rad/s (absolute, bound 1e-5)` : `worst Δω ${relW.toExponential(2)} of peak ${peakW.toExponential(3)} rad/s; worst Δθ ${relTh.toExponential(2)} of the travel ${peakTh.toExponential(3)} rad`} (400 instants)`,
        tolerance: `${tol} relative`, message: ok ? 'follows the analytic motor reference (the page\'s matrix exponential, shared)' : 'departs from the analytic motor reference' };
    }
    case 'switching': {
      const r = need(), p = partOf(c, check.part);
      if (!p || (p.kind !== 'switch' && p.kind !== 'comparator')) return { ...base, status: 'unsupported', component: check.part, message: 'switching needs a switch or comparator' };
      window(check.window[0], 'window start'); window(check.window[1], 'window end');
      if (check.window[1] <= check.window[0]) throw new ConformanceError('invalid-check', check.id, 'window end must follow window start');
      const st = switchStates(r.pick(vecOf(s, `${p.name}.control`)));
      const transitions: { t: number; dir: string }[] = [];
      for (let k = 1; k < st.length; k++) if (st[k] !== st[k - 1]) transitions.push({ t: r.times[k], dir: st[k] === 1 ? 'low->high' : 'high->low' });
      const inWindow = transitions.filter((x) => x.t >= check.window[0] && x.t <= check.window[1]);
      const ok = inWindow.length === 1 && inWindow[0].dir === check.direction;
      return { ...base, status: ok ? 'pass' : 'fail', component: check.part, expected: `exactly one ${check.direction} in [${check.window[0]}, ${check.window[1]}] s`, observed: inWindow.length ? inWindow.map((x) => `${x.dir} at ${x.t.toFixed(4)} s`).join(', ') : `none in window (all: ${transitions.map((x) => `${x.dir}@${x.t.toFixed(4)}`).join(', ') || 'none'})`, message: 'switch-model state transitions (hysteresis walk, nearest sample)' };
    }
    case 'comparator': {
      const r = need(), p = partOf(c, check.part);
      if (!p || p.kind !== 'comparator') return { ...base, status: 'unsupported', component: check.part, message: 'comparator check needs a comparator part' };
      const th = comparatorThresholdVolts(p.spec);
      const vp = r.pick(vecOf(s, `${p.name}.vinp`)), vn = r.pick(vecOf(s, `${p.name}.vinn`)), st = switchStates(r.pick(vecOf(s, `${p.name}.control`)));
      if (Math.abs(vp[0] - vn[0]) <= th) return { ...base, status: 'unsupported', component: check.part, atSeconds: 0, expected: `|inp − inn| > ${th} V at t = 0`, observed: `${(vp[0] - vn[0]).toExponential(2)} V`, message: 'the run starts inside the comparator band: its initial state is the solver\'s, not the circuit\'s — unsupported, not a pass' };
      let wrong = 0, band = 0;
      for (let k = 0; k < st.length; k++) { const d = vp[k] - vn[k]; if (Math.abs(d) <= th) { band++; continue; } if ((d > 0) !== (st[k] === 1)) wrong++; }
      return { ...base, status: wrong === 0 ? 'pass' : 'fail', component: check.part, expected: 'state = sign(inp − inn) outside the band; retained inside', observed: `${wrong} disagreements, ${band} samples inside the ±${th} V band`, tolerance: `band ±${th} V from gain and switch VT/VH`, message: 'comparator decision vs its inputs at every sample' };
    }
    default: {
      const k = (check as { kind: string }).kind;
      throw new ConformanceError('unknown-check', (check as { id?: string }).id ?? '?', `Unknown check kind ${JSON.stringify(k)}`);
    }
  }
}

/** Run the whole kit: structure → solve → checks → report. Never throws for a circuit fault; the report says what happened. */
export async function runConformance(c: Composition, x: ExpectationSet, engine: Engine): Promise<Report> {
  const [cSha, xSha] = await Promise.all([sha256Json(c), sha256Json(x)]);
  const reltol = c?.analysis?.reltol ?? 1e-4;
  const head = { kit: 'flux-conformance-1' as const, composition: { id: c?.id ?? '?', sha256: cSha }, expectations: { id: x?.id ?? '?', sha256: xSha, checks: Array.isArray(x?.checks) ? x.checks.length : 0 },
    engine: { name: engine.name, version: engine.version, options: { reltol }, requestedStopSeconds: c?.analysis?.stopSeconds ?? NaN, requestedStepSeconds: c?.analysis?.stepSeconds ?? NaN, samples: null as number | null, reachedSeconds: null as number | null } };
  const results: Result[] = [];
  const finish = (structure: Structure | null, verdict: Report['verdict'], summary: string): Report => ({ ...head, structure: structure
    ? { externalNodes: [...structure.externalNodes], privateNodes: [...structure.privateNodes], elements: structure.elements.size, models: structure.models.size, danglingPorts: structure.danglingPorts }
    : { externalNodes: [], privateNodes: [], elements: 0, models: 0, danglingPorts: [] }, results, verdict, summary });
  if (!x || !Array.isArray(x.checks) || x.checks.length === 0) { results.push({ check: '(set)', kind: 'expectations', status: 'error', message: 'The expectation set is empty: nothing can be established, so nothing passes' }); return finish(null, 'error', 'empty expectation set'); }
  let structure: Structure;
  try { structure = buildStructure(c); }
  catch (e) {
    const ce = e instanceof ConformanceError ? e : new ConformanceError('structure-error', '?', e instanceof Error ? e.message : String(e));
    results.push({ check: '(structure)', kind: 'structure', status: 'fail', component: ce.where, message: `${ce.cause_}: ${ce.message}` });
    return finish(null, 'fail', `structural fault: ${ce.cause_} at ${ce.where}`);
  }
  // Validate every check's SCHEMA against the structure before solving: malformed checks are named errors.
  const invalid = new Map<number, ConformanceError>(); const ids = new Set<string>();
  x.checks.forEach((check, k) => { try { validateCheck(check, structure, ids); } catch (e) { invalid.set(k, e instanceof ConformanceError ? e : new ConformanceError('invalid-check', '?', e instanceof Error ? e.message : String(e))); } });
  // Solve, with the vectors every check will need.
  let run: Run | null = null, solveError: string | null = null;
  try {
    if (structure.findings.length) throw new SolveFault(`not solved: the structure has ${structure.findings.length} finding(s) (${structure.findings.map((f) => f.cause).join(', ')}); a circuit with an unreachable node is not sent to the engine`);
    // v(0) is the reference itself: identically zero, never a vector the engine returns. Derived observables are computed
    // from their term vectors (makePicker), so the engine is asked only for real vectors.
    const wanted = ['time', ...neededVectors(structure)];
    const raw = await engine.run(structure.netlist, wanted.slice(1));
    const g = readGrid(raw, wanted, c.analysis);
    run = { times: g.times, pick: makePicker(structure, g.times, g.pick), reached: g.reached };
    head.engine.samples = g.times.length; head.engine.reachedSeconds = g.reached;
  } catch (e) { solveError = e instanceof SolveFault ? e.message : (e instanceof Error ? e.message : String(e)); }
  // A failed solve is a result in its own right, so the verdict is error whatever the check mix (a connectivity-only set cannot PASS on a dead engine).
  if (solveError) results.push({ check: '(solve)', kind: 'solve', status: 'error', message: `solve failed: ${solveError}` });
  x.checks.forEach((check, k) => {
    try {
      const bad = invalid.get(k);
      if (bad) { results.push({ check: String((check as { id?: unknown }).id ?? '?'), kind: String((check as { kind?: unknown }).kind ?? '?'), status: 'error', component: bad.where, message: `${bad.cause_}: ${bad.message}` }); return; }
      if (check.kind !== 'connectivity' && solveError) { results.push({ check: check.id, kind: check.kind, status: 'error', message: `not evaluated: ${solveError}` }); return; }
      results.push(evaluate(check, c, structure, run));
    } catch (e) {
      const ce = e instanceof ConformanceError ? e : null;
      results.push({ check: (check as { id?: string }).id ?? '?', kind: (check as { kind?: string }).kind ?? '?', status: 'error', component: ce?.where, message: ce ? `${ce.cause_}: ${ce.message}` : (e instanceof Error ? e.message : String(e)) });
    }
  });
  const counts = { pass: 0, fail: 0, unsupported: 0, error: 0, warn: 0 } as Record<Status, number>;
  for (const r of results) counts[r.status]++;
  // Precedence: a FAIL is a finding about the circuit and outranks an ERROR (a check that could not run);
  // both outrank UNSUPPORTED; PASS needs every check executed and passed (warn is a passed heuristic).
  const verdict: Report['verdict'] = counts.fail ? 'fail' : counts.error ? 'error' : counts.unsupported ? 'unsupported' : 'pass';
  const summary = `${verdict.toUpperCase()}: ${counts.pass} pass, ${counts.fail} fail, ${counts.unsupported} unsupported, ${counts.error} error, ${counts.warn} warn of ${x.checks.length} checks${solveError ? ` · SOLVE FAILED: ${solveError}` : ''}`;
  return finish(structure, verdict, summary);
}
