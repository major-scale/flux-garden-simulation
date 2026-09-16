/**
 * THERMAL FEEDBACK V1 — a circuit senses and regulates temperature (docs/THERMAL-FEEDBACK-V1-DECLARATION.md).
 *
 * A PARTITIONED, ZERO-ORDER-HOLD coupling on one physical clock (an approximation, checked by refinement — not an exact continuous
 * coupled solve). Each step [t_k, t_k+1]: read the bound bodies' temperatures from the thermal state; map them to the bound parameters
 * (a resistor's R(T); an NTC's temperature node, T − 273.15 °C); solve the MEMORYLESS circuit through the conformance kit (a fixed
 * two-point window from the operating point — every returned sample must agree); take every element's terminal power; hold those
 * powers over the step while the SAME thermal state advances (`createThermalStepper`, the accepted updates). The thermal state owns
 * temperature, the solve owns currents, powers and the comparator decision, the controller owns only its discrete state.
 *
 * Hysteresis is EXPLICIT DISCRETE STATE outside the solve, not a solved Schmitt trigger: while heating the comparator's reference is
 * the sensed voltage at T_high, while idle the sensed voltage at T_low (both CALIBRATED by solving the circuit with the sensor at that
 * temperature). The decision is the solved comparator output: heating ⇔ v(out) > ½·v(vcc); a solve inside the comparator's ±0.1/G
 * band reads "not heating" (both output switches open at the operating point). A flip is located by bounded bisection of actual solves.
 */
import { buildStructure, type Composition, type PartInstance } from './conformance/composition';
import { makePicker, neededVectors, elementPowerSeries } from './conformance/kit';
import { ENERGY_ROLE } from './conformance/terminals';
import { readGrid } from './spice/grid';
import { ntcOhms } from './spice/parts';
import { createThermalStepper, type ThermalDescriptor, type ThermalStepper, type ThermalStepperTotals } from './thermal-lumped';

export class FeedbackError extends Error {
  constructor(public readonly cause_: string, public readonly where: string, message: string) { super(message); }
}

export type FeedbackBinding =
  | { part: string; law: 'linear'; body: string; rRefOhms: number; alphaPerK: number; tRefK: number; domainK: [number, number] }
  | { part: string; law: 'ntc'; body: string };
export interface FeedbackController { comparator: string; reference: string; sensor: string; lowK: number; highK: number; initial: 'heating' | 'idle' }
export interface FeedbackDescriptor {
  id: string;
  thermal: ThermalDescriptor;
  bindings: FeedbackBinding[];
  controller?: FeedbackController;
  clock: { stopSeconds: number; stepSeconds: number; eventToleranceSeconds: number };
  disturbances?: { atSeconds: number; body: string; ambientTemperatureK: number }[];
}
/** A solver engine: the kit's shape (tools/conformance/engines.mjs). */
export interface FeedbackEngine { run(netlist: string, vectors: string[]): Promise<unknown> }

/** Every electrical solve uses this window from the operating point; the memoryless check compares its samples. */
export const FEEDBACK_SOLVE_WINDOW = { stopSeconds: 2e-6, stepSeconds: 1e-6, reltol: 1e-9 } as const;
/** Memoryless parts only: a parameter change of these stores no energy. Everything else is refused at this interface. */
export const FEEDBACK_PART_KINDS: PartInstance['kind'][] = ['resistor', 'pot', 'ntc', 'comparator', 'diode', 'led'];
export const FEEDBACK_LIMITS = { maxBisections: 60, maxSteps: 200_000 } as const;
const DESCRIPTOR_FIELDS = ['id', 'thermal', 'bindings', 'controller', 'clock', 'disturbances'];

/** The declared linear law R(T) = R_ref·(1 + α·(T − T_ref)). */
export const linearOhms = (b: Extract<FeedbackBinding, { law: 'linear' }>, T: number): number => b.rRefOhms * (1 + b.alphaPerK * (T - b.tRefK));
export const kelvinToCelsius = (T: number): number => T - 273.15;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The loss sources of a feedback composition: every dissipative part, by name (sources are not losses). */
export const lossIds = (c: Composition): string[] => c.parts.filter((p) => ENERGY_ROLE[p.kind] === 'dissipative').map((p) => p.name);

export function validateFeedback(c: Composition, d: FeedbackDescriptor): void {
  if (!d || typeof d !== 'object') throw new FeedbackError('feedback-shape', '$', 'A feedback descriptor is { id, thermal, bindings, controller?, clock, disturbances? }');
  for (const k of Object.keys(d)) if (!DESCRIPTOR_FIELDS.includes(k)) throw new FeedbackError('unsupported-field', '$', `Feedback field ${k} is not supported (supported: ${DESCRIPTOR_FIELDS.join(', ')})`);
  for (const p of c.parts) if (!FEEDBACK_PART_KINDS.includes(p.kind))
    throw new FeedbackError('unsupported-feedback-part', p.name, `${p.kind} ${p.name} cannot sit in a feedback loop: only memoryless parts (${FEEDBACK_PART_KINDS.join(', ')}) — repeated operating-point solves would restart any stored electrical state, and a programmed switch runs on deck time, not the physical clock`);
  for (const s of c.sources) if (s.kind !== 'dc') throw new FeedbackError('unsupported-feedback-part', s.name, `Source ${s.name} is ${s.kind}: only DC sources (a programme would run on deck time, not the physical clock)`);
  const byPart = new Map(c.parts.map((p) => [p.name, p] as const)), bodies = new Set(d.thermal?.bodies?.map((b) => b.id) ?? []);
  if (!Array.isArray(d.bindings)) throw new FeedbackError('feedback-shape', 'bindings', 'bindings is an array');
  const bound = new Set<string>();
  for (const b of d.bindings) {
    const p = byPart.get(b?.part);
    if (!p) throw new FeedbackError('unknown-part', String(b?.part), `Binding for ${b?.part}: no such part`);
    if (bound.has(b.part)) throw new FeedbackError('duplicate-binding', b.part, `Part ${b.part} is bound twice`);
    bound.add(b.part);
    if (!bodies.has(b.body)) throw new FeedbackError('unknown-body', b.part, `Binding for ${b.part}: no thermal body ${b.body}`);
    if (b.law === 'linear') {
      if (p.kind !== 'resistor') throw new FeedbackError('binding-kind', b.part, `A linear R(T) binds a resistor; ${b.part} is a ${p.kind}`);
      for (const k of ['rRefOhms', 'alphaPerK', 'tRefK'] as const) if (!fin(b[k])) throw new FeedbackError('invalid-parameter', b.part, `Binding ${b.part}: ${k} must be finite`);
      const [lo, hi] = b.domainK ?? [];
      if (!fin(lo) || !fin(hi) || !(lo > 0 && lo < hi && hi <= 1e6)) throw new FeedbackError('feedback-domain', b.part, `Binding ${b.part}: domainK must be [lo, hi] with 0 < lo < hi ≤ 1e6 K`);
      if (!(b.rRefOhms > 0)) throw new FeedbackError('feedback-domain', b.part, `Binding ${b.part}: R_ref must be positive`);
      for (const T of [lo, hi]) if (!(linearOhms(b, T) >= 1e-3)) throw new FeedbackError('feedback-domain', b.part, `Binding ${b.part}: R(${T} K) = ${linearOhms(b, T)} Ω — the law must stay positive (≥ 1 mΩ, the resistor's own range) over the whole declared domain; it is never extrapolated`);
    } else if (b.law === 'ntc') {
      if (p.kind !== 'ntc') throw new FeedbackError('binding-kind', b.part, `An ntc binding binds an NTC; ${b.part} is a ${p.kind}`);
      const env = (c.environments ?? []).filter((e) => e.node === p.ports.env);
      if (env.length !== 1) throw new FeedbackError('unsupported-feedback-part', b.part, `NTC ${b.part}: its temperature node ${p.ports.env} must be driven by exactly one environment, which the loop sets each step`);
    } else throw new FeedbackError('binding-kind', String((b as { part?: string }).part), `Unknown binding law ${(b as { law?: string }).law}`);
  }
  const ntcEnvs = new Set(d.bindings.filter((b) => b.law === 'ntc').map((b) => (byPart.get(b.part) as Extract<PartInstance, { kind: 'ntc' }>).ports.env));
  for (const e of c.environments ?? []) if (!ntcEnvs.has(e.node))
    throw new FeedbackError('unsupported-feedback-part', e.name, `Environment ${e.name} drives ${e.node}, which no bound NTC reads: an environment programme would run on deck time, not the physical clock`);
  const k = d.clock;
  if (!k || !fin(k.stopSeconds) || !fin(k.stepSeconds) || !fin(k.eventToleranceSeconds) || !(k.stepSeconds > 0 && k.stopSeconds >= k.stepSeconds))
    throw new FeedbackError('invalid-clock', 'clock', 'clock needs finite stopSeconds ≥ stepSeconds > 0 and eventToleranceSeconds');
  if (k.stopSeconds / k.stepSeconds > FEEDBACK_LIMITS.maxSteps) throw new FeedbackError('invalid-clock', 'clock', `more than ${FEEDBACK_LIMITS.maxSteps} steps`);
  if (!(k.eventToleranceSeconds > 0 && k.eventToleranceSeconds < k.stepSeconds && Math.ceil(Math.log2(k.stepSeconds / k.eventToleranceSeconds)) <= FEEDBACK_LIMITS.maxBisections))
    throw new FeedbackError('invalid-clock', 'clock', `eventToleranceSeconds must be in (0, stepSeconds) and reachable in ≤ ${FEEDBACK_LIMITS.maxBisections} halvings`);
  const ctl = d.controller;
  if (ctl) {
    const cmp = byPart.get(ctl.comparator);
    if (!cmp || cmp.kind !== 'comparator') throw new FeedbackError('controller', 'controller', `controller.comparator ${ctl.comparator} is not a comparator`);
    const ref = c.sources.find((s) => s.name === ctl.reference);
    if (!ref || ref.kind !== 'dc' || ref.minus !== '0' || (ref.plus !== cmp.ports.inp && ref.plus !== cmp.ports.inn))
      throw new FeedbackError('controller', 'controller', `controller.reference ${ctl.reference} must be a DC source from ground to one of ${ctl.comparator}'s inputs`);
    const sb = d.bindings.find((b) => b.part === ctl.sensor);
    if (!sb || sb.law !== 'ntc') throw new FeedbackError('controller', 'controller', `controller.sensor ${ctl.sensor} must be an ntc binding`);
    if (!fin(ctl.lowK) || !fin(ctl.highK) || !(ctl.lowK < ctl.highK)) throw new FeedbackError('controller-thresholds', 'controller', `Thresholds must be ordered: lowK < highK (got ${ctl.lowK}, ${ctl.highK})`);
    const ntc = byPart.get(ctl.sensor) as Extract<PartInstance, { kind: 'ntc' }>;
    for (const T of [ctl.lowK, ctl.highK]) {
      const tc = kelvinToCelsius(T);
      if (tc < ntc.spec.celsiusDomain[0] || tc > ntc.spec.celsiusDomain[1]) throw new FeedbackError('controller-thresholds', 'controller', `Threshold ${T} K (${tc} °C) is outside NTC ${ctl.sensor}'s domain ${ntc.spec.celsiusDomain.join('…')} °C`);
    }
    if (ctl.initial !== 'heating' && ctl.initial !== 'idle') throw new FeedbackError('controller', 'controller', 'controller.initial must be declared: heating or idle');
  }
  let last = 0;
  for (const x of d.disturbances ?? []) {
    if (!fin(x.atSeconds) || !(x.atSeconds > last && x.atSeconds < k.stopSeconds)) throw new FeedbackError('invalid-disturbance', 'disturbances', 'Disturbances must be at strictly increasing times inside (0, stop)');
    if (!bodies.has(x.body)) throw new FeedbackError('unknown-body', 'disturbances', `Disturbance on unknown body ${x.body}`);
    last = x.atSeconds;
  }
}

export interface FeedbackSolve {
  t: number; temperaturesK: Record<string, number>;
  /** part → ohms (linear) or °C written to the NTC's temperature node */
  parameters: Record<string, number>;
  /** element → terminal power (W), sources negative when delivering */
  powersW: Record<string, number>;
  heating: boolean | null; referenceVolts: number | null; residualW: number;
}
export interface FeedbackSegment { t0: number; t1: number; heating: boolean | null; solve: number }
export interface FeedbackEvent { t: number; from: boolean; to: boolean; bracket: [number, number]; temperatureK: number; solves: number; located: boolean }
/** The segment being held: everything needed to locate a switch inside it lives here — snapshot, solve record, disturbance count. */
interface HeldSegment { snap: unknown; t: number; h: number; losses: Record<string, number>; heating: boolean | null; solve: number; record: FeedbackSolve; applied: number }
/**
 * A SELF-CONTAINED checkpoint (Astra, thermal-feedback-v1-d87c32c4). A run finalizes any switch inside its last held segment before it
 * returns, so the checkpoint needs no held segment and no index into the previous run's arrays. It carries the thermal state, the
 * controller state, the calibration, the disturbances applied, the compensated energy sums (a resumed account continues the SAME
 * sums) and a key of the composition and descriptor it belongs to (a resume with another is refused).
 */
export interface FeedbackState {
  t: number; heating: boolean | null; stepper: unknown; calibration: { lowVolts: number; highVolts: number } | null; disturbancesApplied: number;
  energy: { work: [number, number]; residual: [number, number]; losses: Record<string, [number, number]> }; key: string;
}
export interface FeedbackRun {
  descriptor: FeedbackDescriptor;
  solves: FeedbackSolve[]; segments: FeedbackSegment[]; events: FeedbackEvent[];
  /** body temperatures at every committed segment boundary */
  trajectory: { times: number[]; temperatureK: Record<string, number[]> };
  totals: ThermalStepperTotals;
  /** CUMULATIVE from the loop's origin (t = 0) to `toSeconds`, across resumes — the same interval as the thermal totals. */
  account: { fromSeconds: number; toSeconds: number; sourceWorkJ: number; lossesJ: Record<string, number>; routedJ: number; outgoingJ: number;
    electricalResidualJ: number; storedJ: number; ambientJ: number; linkNetJ: number; compositeResidualJ: number };
  /** Where this run's own records (solves, segments, events, trajectory) begin: 0, or the checkpoint it resumed from. */
  runFromSeconds: number;
  network: ReturnType<ThermalStepper['close']>;
  calibration: FeedbackState['calibration'];
  solveCount: number; bisectionSolves: number; wallMs: number;
  state: FeedbackState;
}

/** Neumaier sum for energy totals. */
class Sum {
  s = 0; c = 0;
  add(v: number) { const t = this.s + v; this.c += Math.abs(this.s) >= Math.abs(v) ? (this.s - t) + v : (v - t) + this.s; this.s = t; }
  get value() { return this.s + this.c; }
  save(): [number, number] { return [this.s, this.c]; }
  load(x: [number, number]) { this.s = x[0]; this.c = x[1]; }
}

export async function runFeedback(c: Composition, d: FeedbackDescriptor, engine: FeedbackEngine, opts: { from?: FeedbackState; untilSeconds?: number } = {}): Promise<FeedbackRun> {
  const wall = Date.now();
  validateFeedback(c, d);
  const losses = lossIds(c), stepper = createThermalStepper(d.thermal, losses), ctl = d.controller ?? null, k = d.clock;
  const byPart = new Map(c.parts.map((p) => [p.name, p] as const));
  const cmp = ctl ? (byPart.get(ctl.comparator) as Extract<PartInstance, { kind: 'comparator' }>) : null;
  const sensedNode = cmp && ctl ? (c.sources.find((s) => s.name === ctl.reference)!.plus === cmp.ports.inp ? cmp.ports.inn : cmp.ports.inp) : null;
  let solveCount = 0, bisectionSolves = 0;

  // ---- one electrical solve at the present thermal state (or with an override for calibration)
  async function solve(t: number, refVolts: number | null, override?: Record<string, number>): Promise<FeedbackSolve & { sensedVolts: number | null }> {
    const comp: Composition = JSON.parse(JSON.stringify(c));
    comp.analysis = { ...FEEDBACK_SOLVE_WINDOW };
    const temperaturesK: Record<string, number> = {}, parameters: Record<string, number> = {};
    for (const b of d.bindings) {
      const T = override?.[b.part] ?? stepper.temperatureK(b.body);
      temperaturesK[b.body] = stepper.temperatureK(b.body);
      const p = comp.parts.find((x) => x.name === b.part)!;
      if (b.law === 'linear') {
        if (!(T >= b.domainK[0] && T <= b.domainK[1])) throw new FeedbackError('feedback-domain', b.part, `Body ${b.body} is at ${T} K at ${t} s, outside ${b.part}'s declared domain ${b.domainK.join('…')} K: refused, never extrapolated`);
        (p as Extract<PartInstance, { kind: 'resistor' }>).spec.ohms = parameters[b.part] = linearOhms(b, T);
      } else {
        const ntc = p as Extract<PartInstance, { kind: 'ntc' }>, tc = kelvinToCelsius(T);
        if (!(tc >= ntc.spec.celsiusDomain[0] && tc <= ntc.spec.celsiusDomain[1])) throw new FeedbackError('sensor-domain', b.part, `NTC ${b.part} would read ${tc} °C (${T} K) at ${t} s, outside its domain ${ntc.spec.celsiusDomain.join('…')} °C: refused`);
        const env = comp.environments!.find((e) => e.node === ntc.ports.env)!;
        env.points = [{ atSeconds: 0, value: tc }, { atSeconds: 1, value: tc }];
        parameters[b.part] = tc;
      }
    }
    if (ctl && refVolts !== null) (comp.sources.find((s) => s.name === ctl.reference) as Extract<Composition['sources'][number], { kind: 'dc' }>).volts = refVolts;
    const st = buildStructure(comp), extra = cmp ? [`v(${cmp.ports.out})`, `v(${cmp.ports.vcc})`, `v(${sensedNode})`] : [];
    // STALE-SOLVE GUARD: every deck carries its own number on a tag source outside the composition (no terminal of any part, so it
    // enters no energy term); every returned sample must carry that number back. A solver that answers with a previous deck's
    // result (seen: a second eecircuit instance in the same process makes a reused one lag by one solve) is refused, never used.
    const tag = ++solveCount;
    if (!/^\.options/m.test(st.netlist)) throw new FeedbackError('solve-failed', `${t} s`, 'The deck has no .options line to tag');
    const netlist = st.netlist.replace(/^\.options/m, `Vfbtag fbtag 0 DC ${tag}\n.options`);
    const wanted = ['time', ...new Set([...neededVectors(st), ...extra, 'v(fbtag)'])];
    let raw: unknown;
    try { raw = await engine.run(netlist, wanted.slice(1)); } catch (e) { throw new FeedbackError('solve-failed', `${t} s`, `The electrical solve at ${t} s failed: ${(e as Error).message}`); }
    let g;
    try { g = readGrid(raw as never, wanted, comp.analysis); } catch (e) { throw new FeedbackError('solve-failed', `${t} s`, `The electrical solve at ${t} s returned no usable result: ${(e as Error).message} — the loop stops, it does not continue on stale values`); }
    const echoed = g.pick('v(fbtag)');
    for (let j = 0; j < echoed.length; j++) if (echoed[j] !== tag)
      throw new FeedbackError('stale-solve', `${t} s`, `Solve ${tag} at ${t} s came back carrying tag ${echoed[j]}: the solver returned another deck's result — refused, never used`);
    const pick = makePicker(st, g.times, g.pick), n = g.times.length, power = elementPowerSeries(comp, st, pick, n), powersW: Record<string, number> = {};
    let scale = 0; for (const pw of power.values()) scale = Math.max(scale, Math.abs(pw[0]));
    for (const [el, pw] of power) {
      for (let j = 1; j < n; j++) if (Math.abs(pw[j] - pw[0]) > 1e-9 * Math.max(scale, 1e-12))
        throw new FeedbackError('not-memoryless', el, `${el}'s power changes within one operating-point window at ${t} s (${pw[0]} → ${pw[j]} W): the circuit is not memoryless`);
      powersW[el] = pw[0];
    }
    let residualW = 0; for (const v of Object.values(powersW)) residualW += v;
    let decision: boolean | null = null, sensedVolts: number | null = null;
    if (cmp) {
      const vout = pick(`v(${cmp.ports.out})`)[0], vcc = pick(`v(${cmp.ports.vcc})`)[0];
      decision = vout > 0.5 * vcc; sensedVolts = pick(`v(${sensedNode})`)[0];
    }
    return { t, temperaturesK, parameters, powersW, heating: decision, referenceVolts: ctl ? refVolts : null, residualW, sensedVolts };
  }

  // ---- calibration: the sensed voltage at each threshold, solved; it must not depend on the comparator's output
  let calibration = opts.from?.calibration ?? null;
  if (ctl && !calibration) {
    const at = async (T: number) => {
      const a = await solve(0, 0, { [ctl.sensor]: T }), b = await solve(0, 1e3, { [ctl.sensor]: T });
      if (Math.abs(a.sensedVolts! - b.sensedVolts!) > 1e-9 * Math.max(1, Math.abs(a.sensedVolts!)))
        throw new FeedbackError('sensed-input-depends-on-output', ctl.comparator, `The sensed input ${sensedNode} moves with the comparator's state (${a.sensedVolts} vs ${b.sensedVolts} V): the thresholds cannot be calibrated`);
      return a.sensedVolts!;
    };
    calibration = { lowVolts: await at(ctl.lowK), highVolts: await at(ctl.highK) };
    // polarity, executed: below T_low with the heating reference the comparator must heat; above T_high it must not
    const w = ctl.highK - ctl.lowK;
    const cold = await solve(0, calibration.highVolts, { [ctl.sensor]: ctl.lowK - w / 2 }), hot = await solve(0, calibration.highVolts, { [ctl.sensor]: ctl.highK + w / 2 });
    if (cold.heating !== true || hot.heating !== false)
      throw new FeedbackError('controller-polarity', ctl.comparator, `With the heating reference the comparator reads ${cold.heating ? 'heat' : 'idle'} below T_low and ${hot.heating ? 'heat' : 'idle'} above T_high: this circuit does not heat when cold`);
  }
  const reference = (heating: boolean | null) => (ctl && calibration ? (heating ? calibration.highVolts : calibration.lowVolts) : null);

  // ---- the boundaries: multiples of the step, disturbance times, the stop (and a pause)
  const stop = Math.min(k.stopSeconds, opts.untilSeconds ?? Infinity);
  const nSteps = Math.round(k.stopSeconds / k.stepSeconds), grid: number[] = [];
  for (let j = 0; j <= nSteps; j++) grid.push(Math.min(j * k.stepSeconds, k.stopSeconds));
  if (grid[grid.length - 1] < k.stopSeconds) grid.push(k.stopSeconds);
  const dist = d.disturbances ?? [];
  const bounds = [...new Set([...grid, ...dist.map((x) => x.atSeconds)])].sort((a, b) => a - b);
  if (opts.untilSeconds !== undefined && !bounds.includes(opts.untilSeconds)) throw new FeedbackError('invalid-clock', 'untilSeconds', 'A pause must fall on a step boundary or a disturbance time');

  const key = JSON.stringify({ c, d });
  const work = new Sum(), lossJ = Object.fromEntries(losses.map((id) => [id, new Sum()])), resJ = new Sum();
  let t = 0, heating: boolean | null = ctl ? ctl.initial === 'heating' : null, prev: HeldSegment | null = null, applied = 0;
  if (opts.from) {
    const f = opts.from;
    if (f.key !== key) throw new FeedbackError('invalid-resume', `${f.t} s`, 'This checkpoint belongs to a different composition or feedback descriptor');
    if (!bounds.includes(f.t)) throw new FeedbackError('invalid-resume', `${f.t} s`, 'A run can only be resumed at a boundary it paused on');
    stepper.restore(f.stepper); t = f.t; heating = f.heating; applied = f.disturbancesApplied;
    work.load(f.energy.work); resJ.load(f.energy.residual); for (const id of losses) lossJ[id].load(f.energy.losses[id]);
  }
  const t0 = t, solves: FeedbackSolve[] = [], segments: FeedbackSegment[] = [], events: FeedbackEvent[] = [];
  const bodyIds = d.thermal.bodies.map((b) => b.id), traj = { times: [t], temperatureK: Object.fromEntries(bodyIds.map((id) => [id, [stepper.temperatureK(id)]])) };
  const lossesOf = (s: FeedbackSolve) => Object.fromEntries(losses.map((id) => [id, s.powersW[id]]));
  const book = (s: FeedbackSolve, h: number, sign = 1) => {
    for (const src of c.sources) work.add(-sign * (s.powersW[src.name] ?? 0) * h);
    for (const id of losses) lossJ[id].add(sign * s.powersW[id] * h);
    resJ.add(sign * s.residualW * h);
  };
  const record = (tt: number) => { traj.times.push(tt); for (const id of bodyIds) traj.temperatureK[id].push(stepper.temperatureK(id)); };
  const sensorBody = ctl ? d.bindings.find((b) => b.part === ctl.sensor)!.body : null;
  const guard = (T0: Record<string, number>) => {
    if (!ctl) return;
    const dT = Math.abs(stepper.temperatureK(sensorBody!) - T0[sensorBody!]);
    if (dT > (ctl.highK - ctl.lowK) / 2) throw new FeedbackError('step-too-coarse', `${stepper.time()} s`, `Body ${sensorBody} moved ${dT} K in one step, more than half the hysteresis width ${(ctl.highK - ctl.lowK)} K: a double switch inside the step could not be seen; use a shorter stepSeconds`);
  };
  const applyDisturbances = (tt: number) => { while (applied < dist.length && dist[applied].atSeconds <= tt) { stepper.setAmbient(dist[applied].body, dist[applied].ambientTemperatureK); applied++; } };

  /**
   * At the boundary t: apply its disturbances and solve. If the decision has flipped since the held segment began, the switch lies
   * INSIDE that segment: rewind to its snapshot — thermal state AND disturbance count (Astra, thermal-feedback-v1-d87c32c4: keeping
   * the count lost a disturbance at the boundary) — locate the switch by bounded bisection of actual solves, re-advance, re-apply the
   * boundary's disturbances, and re-solve at t. Returns the solve that starts the next segment.
   */
  async function settle(): Promise<FeedbackSolve> {
    applyDisturbances(t);
    let S = await solve(t, reference(heating));
    if (!ctl || S.heating === heating) return S;
    if (prev && prev.heating === heating) {
      const held = prev, wasSegment = segments.pop()!;
      book(held.record, held.h, -1); traj.times.pop(); for (const id of bodyIds) traj.temperatureK[id].pop();
      let lo = 0, hi = held.h, n = 0;
      while (hi - lo > k.eventToleranceSeconds) {
        if (++n > FEEDBACK_LIMITS.maxBisections) throw new FeedbackError('event-not-located', `${held.t} s`, 'The switching time was not located within the bisection limit');
        const mid = 0.5 * (lo + hi);
        stepper.restore(held.snap); stepper.advance(mid, held.losses);
        const trial = await solve(held.t + mid, reference(held.heating)); bisectionSolves++;
        if (trial.heating === held.heating) lo = mid; else hi = mid;
      }
      stepper.restore(held.snap); applied = held.applied;
      stepper.advance(hi, held.losses); book(held.record, hi);
      segments.push({ t0: held.t, t1: held.t + hi, heating: held.heating, solve: held.solve }); record(held.t + hi);
      const flip = await solve(held.t + hi, reference(held.heating)); bisectionSolves++;
      if (flip.heating === held.heating) throw new FeedbackError('event-inconsistent', `${held.t + hi} s`, 'The located switching time does not show the switch');
      const from = held.heating!, to = flip.heating!;
      heating = to;
      const after = await solve(held.t + hi, reference(heating));
      if (after.heating !== heating) throw new FeedbackError('event-chatter', `${held.t + hi} s`, 'The comparator does not hold its new state under the new reference: the hysteresis does not suppress chatter here');
      events.push({ t: held.t + hi, from, to, bracket: [held.t + lo, held.t + hi], temperatureK: stepper.temperatureK(sensorBody!), solves: n + 1, located: true });
      solves.push(after);
      const rest = wasSegment.t1 - (held.t + hi);
      if (rest > 0) {
        const T0 = Object.fromEntries(bodyIds.map((id) => [id, stepper.temperatureK(id)]));
        stepper.advance(rest, lossesOf(after)); guard(T0); book(after, rest);
        segments.push({ t0: held.t + hi, t1: wasSegment.t1, heating, solve: solves.length - 1 }); record(wasSegment.t1);
      }
      applyDisturbances(t);
      S = await solve(t, reference(heating));
      if (S.heating !== heating) throw new FeedbackError('event-chatter', `${t} s`, 'The state flipped again within one step: use a shorter stepSeconds');
    } else {
      // at the start: the declared initial state meets its temperature (after a checkpoint no switch can be pending: see FINALIZE)
      events.push({ t, from: heating!, to: S.heating!, bracket: [t, t], temperatureK: stepper.temperatureK(sensorBody!), solves: 1, located: false });
      heating = S.heating;
      S = await solve(t, reference(heating));
      if (S.heating !== heating) throw new FeedbackError('event-chatter', `${t} s`, 'The comparator does not hold its new state under the new reference');
    }
    return S;
  }

  while (t < stop) {
    const S = await settle();
    solves.push(S);
    const tb = bounds.find((x) => x > t)!, next = Math.min(tb, stop), h = next - t;
    prev = { snap: stepper.snapshot(), t, h, losses: lossesOf(S), heating, solve: solves.length - 1, record: S, applied };
    const T0 = Object.fromEntries(bodyIds.map((id) => [id, stepper.temperatureK(id)]));
    stepper.advance(h, prev.losses); guard(T0); book(S, h);
    segments.push({ t0: t, t1: next, heating, solve: solves.length - 1 }); record(next);
    t = next;
  }
  // ---- FINALIZE (Astra, thermal-feedback-v1-d87c32c4): a switch inside the last held segment is located BEFORE returning — at a stop
  // and at a pause alike — so a run never ends with a pending crossing and its checkpoint holds no segment and no index into this run.
  // The boundary solve used here starts the NEXT run, which repeats it; it is not recorded in this one.
  if (ctl && prev) await settle();

  const totals = stepper.totals(), network = stepper.close();
  let routedJ = 0, outgoingJ = 0;
  for (const r of d.thermal.routes) (r.receiver === null ? (outgoingJ += lossJ[r.source].value) : (routedJ += lossJ[r.source].value));
  let storedJ = 0, ambientJ = 0, linkNetJ = 0;
  for (const id of bodyIds) { storedJ += totals.storedJ[id]; ambientJ += totals.ambientOutJ[id]; linkNetJ += totals.linkOutJ[id]; }
  const sourceWorkJ = work.value, electricalResidualJ = sourceWorkJ - Object.values(lossJ).reduce((s, x) => s + x.value, 0);
  return {
    descriptor: d, solves, segments, events, trajectory: traj, totals, network, calibration, solveCount, bisectionSolves, wallMs: Date.now() - wall,
    account: { fromSeconds: 0, toSeconds: t, sourceWorkJ, lossesJ: Object.fromEntries(losses.map((id) => [id, lossJ[id].value])), routedJ, outgoingJ, electricalResidualJ,
      storedJ, ambientJ, linkNetJ, compositeResidualJ: sourceWorkJ - (storedJ + ambientJ + linkNetJ + outgoingJ) },
    runFromSeconds: t0,
    state: { t, heating, stepper: stepper.snapshot(), calibration, disturbancesApplied: applied, key,
      energy: { work: work.save(), residual: resJ.save(), losses: Object.fromEntries(losses.map((id) => [id, lossJ[id].save()])) } },
  };
}

/**
 * An independent audit of a run from its records: every solve's parameters are the declared mapping of the temperature the THERMAL
 * trajectory had at that solve's time (not a stale one), the NTC node reads T − 273.15, and every committed decision obeys the
 * controller's transition away from the comparator's band. Returns the worst mismatches; a wrong mapping or a stale temperature
 * shows here.
 */
export function feedbackAudit(run: FeedbackRun, c: Composition, d: FeedbackDescriptor = run.descriptor) {
  const byTime = new Map<number, number>(); run.trajectory.times.forEach((tt, i) => byTime.set(tt, i));
  let mappingErr = 0, staleErr = 0, missing = 0;
  const byPart = new Map(c.parts.map((p) => [p.name, p] as const));
  for (const s of run.solves) {
    const i = byTime.get(s.t);
    for (const b of d.bindings) {
      const T = i === undefined ? NaN : run.trajectory.temperatureK[b.body][i];
      if (i === undefined) { missing++; continue; }
      staleErr = Math.max(staleErr, Math.abs(s.temperaturesK[b.body] - T));
      if (b.law === 'linear') mappingErr = Math.max(mappingErr, Math.abs(s.parameters[b.part] - linearOhms(b, T)) / linearOhms(b, T));
      else {
        mappingErr = Math.max(mappingErr, Math.abs(s.parameters[b.part] - kelvinToCelsius(T)));
        const p = byPart.get(b.part) as Extract<PartInstance, { kind: 'ntc' }>;
        void ntcOhms(s.parameters[b.part], p.spec);                                     // the value the emitter's law receives
      }
    }
  }
  return { mappingErr, staleErr, missing };
}
