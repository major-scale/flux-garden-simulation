/**
 * ELECTROTHERMAL V1 — solved losses become lumped temperatures that exchange heat with ambient (docs/ELECTROTHERMAL-V1-DECLARATION.md).
 *
 * A separate headless layer over the conformance kit's ONE solved composition run. It does not touch `thermal.ts` (the batch-3/4
 * routing into Rapier bodies, whose `exportedHeat` means heat carried away by a REMOVED body — never ambient transfer) and it does
 * not force the Construction interface onto solved transients.
 *
 *   C·dT/dt = P_in(t) − G·(T − T_a)          one temperature per body; ambient exchange SIGNED (+ = heat to ambient)
 *
 * P_in is the sum of the loss sources routed to the body. Sources come from the kit's own extraction (`elementPowerSeries`,
 * `motorPowerSeries`), the same series the electrical/mechanical `energy-balance` integrates. Sampled power is taken as CONSTANT
 * PER SOLVER INTERVAL at its trapezoid average, so the energy entering here per interval equals the account's trapezoid integral;
 * within the interval the ODE is integrated EXACTLY (exponential update, closed-form ambient integral). One-way coupling:
 * temperature changes no circuit parameter. The result is a pure function of (trajectory, descriptor): replay is re-evaluation.
 *
 * THERMAL NETWORK V1 (docs/THERMAL-NETWORK-V1-DECLARATION.md): optional `links` join bodies through conductances,
 *   C_i·dT_i/dt = P_i − G_amb,i·(T_i − T_a,i) − Σ_l outward G_l·(T_a − T_b)      (link power positive FROM a TO b)
 * Each linked component is integrated as ONE exact linear network per interval (a simultaneous update; each transfer computed once
 * and booked with opposite signs at its two ends). A body with no links still takes the accepted one-body update, unchanged.
 */
import type { Composition, Structure, PartInstance } from './conformance/composition';
import { elementPowerSeries, motorPowerSeries, energyAccountOf, motorDomainOf, type EnergyAccount } from './conformance/kit';
import { ENERGY_ROLE } from './conformance/terminals';

export interface LumpedBody { id: string; heatCapacityJPerK: number; initialTemperatureK: number; ambientTemperatureK: number; conductanceWPerK: number }
/** Every loss source is booked exactly once: to one body, or to `null` = explicitly OUTGOING (unrouted, unmodelled destination). */
export interface ThermalRoute { source: string; receiver: string | null }
/** A thermal link (thermal network v1): a conductance between two distinct bodies; power G·(T_a − T_b), POSITIVE FROM a TO b. */
export interface ThermalLink { id: string; a: string; b: string; conductanceWPerK: number }
export interface ThermalDescriptor { id: string; bodies: LumpedBody[]; routes: ThermalRoute[]; links?: ThermalLink[] }
export type LossKind = 'passive-part' | 'motor-winding' | 'motor-viscous' | 'motor-brake';
export interface LossSource { id: string; kind: LossKind; watts: Float64Array }
export interface Excluded { id: string; reason: string }

export class ThermalError extends Error {
  constructor(public readonly cause_: string, public readonly where: string, message: string) { super(message); }
}
/** The batch-3 ranges for capacity and temperature; conductance 0 (isolated) … 1e6 W/K. */
export const THERMAL_LIMITS = { capacity: [1e-6, 1e9], temperature: [0, 1e6], conductance: [0, 1e6] } as const;
const BODY_FIELDS = ['id', 'heatCapacityJPerK', 'initialTemperatureK', 'ambientTemperatureK', 'conductanceWPerK'];
/** Thermal network v1: a linked component is solved as one dense exact network per interval; bounded so that solve stays small. */
export const NETWORK_LIMITS = { bodiesPerComponent: 16, links: 64 } as const;
const DESCRIPTOR_FIELDS = ['id', 'bodies', 'routes', 'links'], LINK_FIELDS = ['id', 'a', 'b', 'conductanceWPerK'];
const supported = (t: number) => Number.isFinite(t) && t > THERMAL_LIMITS.temperature[0] && t <= THERMAL_LIMITS.temperature[1];
/** φ(x) = (1 − e^{−x})/x and 1 − φ(x) for x = G·Δt/C ≥ 0, stable down to x = 0: a series below 1e-4, expm1 above. */
/**
 * A Neumaier-compensated running sum. The thermal totals (stored, ambient, input energy) grow by increments that can be
 * thousands of times smaller than the ulp of the total (a large body, a short step): a plain sum rounds part or all of each one
 * away. The compensation term carries what the total cannot hold, so no increment is silently dropped (amendment T-7).
 */
interface Acc { s: number; c: number }
const acc = (s = 0): Acc => ({ s, c: 0 });
function add(x: Acc, v: number): void { const t = x.s + v; x.c += Math.abs(x.s) >= Math.abs(v) ? (x.s - t) + v : (v - t) + x.s; x.s = t; }
const value = (x: Acc): number => x.s + x.c;
function relaxation(x: number): { phi: number; oneMinusPhi: number } {
  if (x < 1e-4) return { phi: 1 - x / 2 + x * x / 6 - x * x * x / 24, oneMinusPhi: x / 2 - x * x / 6 + x * x * x / 24 };
  const phi = -Math.expm1(-x) / x;
  return { phi, oneMinusPhi: 1 - phi };
}

/**
 * THE ACCEPTED ONE-BODY UPDATE over one interval (electrothermal v1), shared by `simulateThermal` and the feedback stepper — thermal
 * feedback v1 moved it here without changing a floating-point operation. Returns the new temperature (K, derived for reporting).
 * AUTHORITATIVE STATE = the accumulated stored energy Q (relative to T0), not the absolute temperature (Astra,
 * electrothermal-v1-b98f8b61: C = 1e9 J/K with 1 µs steps lost ALL heat — each ΔT ≈ 5e-15 K is below ulp(300 K)). Q grows by its own
 * increments; T = T0 + Q/C is derived; u0 = (T0 − Ta) + Q/C never subtracts two rounded temperatures. The exact interval solution is
 * written WITHOUT T_eq = T_a + P/G, which cancels catastrophically as G → 0 (Astra, electrothermal-v1-db85ae2a: G = 1e-16 gave 304 K
 * from 5 J; G = 1e-20 refused a computed 0 K). With x = G·Δt/C and φ = (1 − e^{−x})/x (φ → 1 as G → 0): ΔT = φ·Δt·(P̄ − G·u0)/C and
 * ∫G·(T − T_a) dt = φ·G·u0·Δt + (1 − φ)·P̄·Δt — the same closed form, exact at G = 0, and C·ΔT + ambient = P̄·Δt identically.
 */
function bodyInterval(b: LumpedBody, Ta: number, q: Acc, amb: Acc, inp: Acc, dt: number, Pbar: number): number {
  const C = b.heatCapacityJPerK, G = b.conductanceWPerK, u0 = (b.initialTemperatureK - Ta) + value(q) / C;
  const { phi, oneMinusPhi } = relaxation((G / C) * dt);
  const dQ = phi * dt * (Pbar - G * u0);                          // J: the stored-energy increment (C·ΔT, never formed from rounded T)
  const out = phi * G * u0 * dt + oneMinusPhi * Pbar * dt;
  add(q, dQ); add(amb, out); add(inp, Pbar * dt);                 // compensated sums: sub-ulp increments are carried, not dropped
  return b.initialTemperatureK + value(q) / C;
}

export function validateDescriptor(d: ThermalDescriptor): void {
  if (!d || typeof d !== 'object' || !Array.isArray(d.bodies) || !Array.isArray(d.routes))
    throw new ThermalError('thermal-shape', '$', 'A thermal descriptor is { id, bodies: [ {id, heatCapacityJPerK, initialTemperatureK, ambientTemperatureK, conductanceWPerK} ], routes: [ {source, receiver | null} ], links?: [ {id, a, b, conductanceWPerK} ] }');
  // A misspelled top-level field (say `link`) would silently drop every link: only the declared fields are accepted.
  for (const k of Object.keys(d)) if (!DESCRIPTOR_FIELDS.includes(k))
    throw new ThermalError('unsupported-field', '$', `Thermal descriptor field ${k} is not supported (supported: ${DESCRIPTOR_FIELDS.join(', ')})`);
  const ids = new Set<string>();
  for (const b of d.bodies) {
    if (!b || typeof b !== 'object' || typeof b.id !== 'string' || !b.id) throw new ThermalError('thermal-shape', '?', 'Every thermal body needs a string id');
    for (const k of Object.keys(b)) if (!BODY_FIELDS.includes(k)) throw new ThermalError('unsupported-field', b.id, `Thermal body ${b.id}: field ${k} is not supported (supported: ${BODY_FIELDS.join(', ')})`);
    if (ids.has(b.id)) throw new ThermalError('duplicate-body', b.id, `Thermal body ${b.id} is declared twice`);
    ids.add(b.id);
    const f = (what: string, v: unknown, lo: number, hi: number, lowOpen = false) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || (lowOpen ? v <= lo : v < lo) || v > hi)
        throw new ThermalError('invalid-parameter', b.id, `Thermal body ${b.id}: ${what} must be a finite number in ${lowOpen ? '(' : '['}${lo}, ${hi}] (got ${JSON.stringify(v)})`);
    };
    f('heat capacity C (J/K)', b.heatCapacityJPerK, THERMAL_LIMITS.capacity[0], THERMAL_LIMITS.capacity[1]);
    f('initial temperature T0 (K)', b.initialTemperatureK, THERMAL_LIMITS.temperature[0], THERMAL_LIMITS.temperature[1], true);
    f('ambient temperature Ta (K)', b.ambientTemperatureK, THERMAL_LIMITS.temperature[0], THERMAL_LIMITS.temperature[1], true);
    f('conductance G (W/K)', b.conductanceWPerK, THERMAL_LIMITS.conductance[0], THERMAL_LIMITS.conductance[1]);
  }
  const seen = new Set<string>();
  for (const r of d.routes) {
    if (!r || typeof r !== 'object' || typeof r.source !== 'string' || !(r.receiver === null || typeof r.receiver === 'string'))
      throw new ThermalError('thermal-shape', '?', 'Every route is { source: string, receiver: body id or null }');
    if (seen.has(r.source)) throw new ThermalError('duplicate-route', r.source, `Loss source ${r.source} is routed twice: every loss is booked exactly once`);
    seen.add(r.source);
    if (r.receiver !== null && !ids.has(r.receiver)) throw new ThermalError('unknown-body', r.source, `Loss source ${r.source} is routed to ${r.receiver}, which is not a declared body (bodies: ${[...ids].join(', ')})`);
  }
  if (d.links !== undefined) {
    if (!Array.isArray(d.links)) throw new ThermalError('thermal-shape', 'links', 'links is an array of { id, a, b, conductanceWPerK }');
    if (d.links.length > NETWORK_LIMITS.links) throw new ThermalError('network-too-large', 'links', `${d.links.length} links: at most ${NETWORK_LIMITS.links} are supported`);
    const lids = new Set<string>();
    for (const l of d.links) {
      if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !l.id) throw new ThermalError('thermal-shape', '?', 'Every link is { id, a, b, conductanceWPerK } with a string id');
      for (const k of Object.keys(l)) if (!LINK_FIELDS.includes(k)) throw new ThermalError('unsupported-field', l.id, `Thermal link ${l.id}: field ${k} is not supported (supported: ${LINK_FIELDS.join(', ')})`);
      if (lids.has(l.id)) throw new ThermalError('duplicate-link', l.id, `Thermal link ${l.id} is declared twice (parallel paths need distinct ids: they add, and each is reported separately)`);
      lids.add(l.id);
      for (const end of [l.a, l.b]) if (typeof end !== 'string' || !ids.has(end))
        throw new ThermalError('unknown-body', l.id, `Thermal link ${l.id} joins ${JSON.stringify(end)}, which is not a declared body (bodies: ${[...ids].join(', ')})`);
      if (l.a === l.b) throw new ThermalError('self-link', l.id, `Thermal link ${l.id} joins body ${l.a} to itself`);
      const g = l.conductanceWPerK;
      if (typeof g !== 'number' || !Number.isFinite(g) || g < THERMAL_LIMITS.conductance[0] || g > THERMAL_LIMITS.conductance[1])
        throw new ThermalError('invalid-parameter', l.id, `Thermal link ${l.id}: conductance G (W/K) must be a finite number in [0, 1e6] (got ${JSON.stringify(g)})`);
    }
    for (const c of linkedComponents(d)) if (c.bodies.length > NETWORK_LIMITS.bodiesPerComponent)
      throw new ThermalError('network-too-large', c.bodies[0], `A linked component of ${c.bodies.length} bodies: at most ${NETWORK_LIMITS.bodiesPerComponent} per component are supported`);
  }
}

/**
 * The loss sources of a solved composition, by identity, from the kit's own extraction: every passive part's terminal power
 * (`<part>`), and a motor's `<m>.winding` (R·i²), `<m>.viscous` (b·ω²) and — with a brake — `<m>.brake` (−τ_brake·ω). Named
 * exclusions: storing elements (they store, they do not lose), MOSFETs (Meyer charge exchange is not a signed-definite loss) and
 * `<m>.load` (work on the declared external load, not heat).
 */
export function lossSources(c: Composition, s: Structure, times: Float64Array, pick: (vec: string) => Float64Array): { sources: LossSource[]; excluded: Excluded[] } {
  const n = times.length, power = elementPowerSeries(c, s, pick, n), sources: LossSource[] = [], excluded: Excluded[] = [];
  for (const p of c.parts) {
    const role = ENERGY_ROLE[p.kind];
    if (role === 'dissipative') sources.push({ id: p.name, kind: 'passive-part', watts: power.get(p.name)! });
    else if (p.kind === 'motor') {
      const m = motorPowerSeries(p as Extract<PartInstance, { kind: 'motor' }>, s, pick, n);
      sources.push({ id: `${p.name}.winding`, kind: 'motor-winding', watts: m.winding }, { id: `${p.name}.viscous`, kind: 'motor-viscous', watts: m.viscous });
      if (p.spec.brake) sources.push({ id: `${p.name}.brake`, kind: 'motor-brake', watts: m.brake });
      excluded.push({ id: `${p.name}.load`, reason: 'work done on the declared external load, not a loss' });
    } else excluded.push({ id: p.name, reason: role === 'storing' ? 'a storing element: its energy is stored, not lost' : 'a MOSFET: its work includes non-charge-conserving gate-charge exchange, not a signed-definite loss' });
  }
  return { sources, excluded };
}

export interface ThermalRun {
  descriptor: ThermalDescriptor; times: Float64Array;
  /** K, per body, on the trajectory grid. */
  temperatureK: Record<string, Float64Array>;
  /** J, per body: stored thermal energy RELATIVE TO THE INITIAL STATE — the AUTHORITATIVE thermal state, accumulated from its
   *  increments; `temperatureK` = T0 + storedJ/C is derived from it. */
  storedJ: Record<string, Float64Array>;
  /** J, per body, cumulative SIGNED ambient transfer ∫G·(T − T_a) dt: positive = heat given to ambient. */
  ambientOutJ: Record<string, Float64Array>;
  /** J, per body, cumulative routed input ∫P_in dt. */
  routedInJ: Record<string, Float64Array>;
  /** J, per source, over the run (trapezoid — the energy account's own rule). */
  sourceEnergyJ: Record<string, number>;
  routedJ: number; outgoingJ: number;
  /** Per source: samples in [−floor, 0) kept signed (a declared noise ALLOWANCE — a policy, not proof of noise), never clipped. */
  negativeSamples: Record<string, number>;
  /** J per source: the signed (≤ 0) energy those negative samples contribute, so their cumulative effect is inspectable. */
  negativeEnergyJ: Record<string, number>;
  excluded: Excluded[];
  /** J, per link, cumulative ∫G·(T_a − T_b) dt: positive = heat moved from a to b (thermal network v1). */
  linkJ: Record<string, Float64Array>;
  /** J, per body, cumulative NET link outflow Σ_{l: a=i} F_l − Σ_{l: b=i} F_l: each transfer booked once, opposite signs at its ends. */
  linkOutJ: Record<string, Float64Array>;
  network: NetworkReport;
}

export interface NetworkReport {
  components: LinkedComponent[];
  /** J per body: stored + ambient + link outflow − input at the end — the books, closed by construction up to compensated rounding. */
  bodyBooksGapJ: Record<string, number>;
  bodyBooksScaleJ: Record<string, number>;
  /** J per linked body: Σ over intervals of (booked increment − the exact modal increment C·(U·Δz)) — the SOLVE RESIDUAL, reported,
   *  not absorbed (0 for singletons). Above 1e-9 of its scale the run is refused (`network-residual`). */
  bodySolveResidualJ: Record<string, number>;
  /** J per linked body: that residual's scale — input, |ambient|, |transfers| and the coordinate mixing C·Σ_k|U_ik·Δz_k| of the
   *  modal increment (the G·∫|u| conditioning terms were withdrawn in N-5). */
  bodySolveScaleJ: Record<string, number>;
  /** K per linked body: a FORWARD rounding ESTIMATE for its temperature (N-5) — a conditioning estimate from where rounding enters the
   *  booked terms, not a rigorous guarantee (a one-ulp reporting error can exceed it; not every exponential or coordinate error is
   *  bounded by it). Above 1e-9 of the network's temperature scale the run is refused. */
  bodyForwardBoundK: Record<string, number>;
  /** J: Σ of the per-body books gaps, and Σ of the energy scales (input, |ambient|, C·max|u|). */
  globalBooksGapJ: number; energyScaleJ: number;
  /** Distinct interval lengths whose exponential blocks were computed. */
  blocksComputed: number;
}

/** The thermal layer over a trajectory grid. Refuses bad time grids, unroutable or unlisted sources, negative loss beyond the noise floor and unsupported temperatures. */
export function simulateThermal(times: Float64Array, sources: LossSource[], d: ThermalDescriptor, excluded: Excluded[] = []): ThermalRun {
  validateDescriptor(d);
  const n = times.length;
  if (n < 2) throw new ThermalError('invalid-time', '$', 'A thermal run needs at least two samples');
  for (let k = 0; k < n; k++) if (!Number.isFinite(times[k]) || (k > 0 && !(times[k] > times[k - 1])))
    throw new ThermalError('invalid-time', `t[${k}]`, `Sample times must be finite and strictly increasing (sample ${k}: ${times[k]} s)`);
  // Each loss has ONE identity (Astra, electrothermal-v1-db85ae2a): a second source with the same id is refused, never allowed to
  // overwrite the first in a lookup table.
  const byId = new Map<string, LossSource>();
  for (const x of sources) {
    if (byId.has(x.id)) throw new ThermalError('duplicate-source', x.id, `Loss source ${x.id} appears twice in the source list: each loss has one identity and is booked once`);
    byId.set(x.id, x);
  }
  for (const r of d.routes) {
    const ex = excluded.find((x) => x.id === r.source);
    if (ex) throw new ThermalError('not-a-loss', r.source, `${r.source} cannot be routed as heat: ${ex.reason}`);
    if (!byId.has(r.source)) throw new ThermalError('unknown-source', r.source, `No loss source ${r.source} in this run (sources: ${[...byId.keys()].join(', ')})`);
  }
  for (const x of sources) if (!d.routes.some((r) => r.source === x.id))
    throw new ThermalError('unrouted-source', x.id, `Loss source ${x.id} is not listed: route it to a body or to null (explicitly outgoing) — no loss may silently vanish`);
  const negativeSamples: Record<string, number> = {}, negativeEnergyJ: Record<string, number> = {}, sourceEnergyJ: Record<string, number> = {};
  for (const x of sources) {
    if (x.watts.length !== n) throw new ThermalError('invalid-time', x.id, `Loss source ${x.id} is not on the trajectory grid`);
    let peak = 0; for (let k = 0; k < n; k++) { if (!Number.isFinite(x.watts[k])) throw new ThermalError('nonfinite-loss', x.id, `Loss source ${x.id} is non-finite at ${times[k]} s`); peak = Math.max(peak, Math.abs(x.watts[k])); }
    const floor = Math.max(1e-15, 1e-9 * peak); let neg = 0, e = 0, negE = 0;
    for (let k = 0; k < n; k++) {
      if (x.watts[k] < -floor) throw new ThermalError('negative-loss', x.id, `Loss source ${x.id} is ${x.watts[k].toExponential(3)} W at ${times[k]} s: a passive loss cannot be negative beyond the solver-noise floor ${floor.toExponential(2)} W`);
      if (x.watts[k] < 0) neg++;
      if (k > 0) {
        const dt = times[k] - times[k - 1];
        e += 0.5 * (x.watts[k] + x.watts[k - 1]) * dt;
        negE += 0.5 * (Math.min(x.watts[k], 0) + Math.min(x.watts[k - 1], 0)) * dt;
      }
    }
    negativeSamples[x.id] = neg; negativeEnergyJ[x.id] = negE; sourceEnergyJ[x.id] = e;
  }
  const temperatureK: Record<string, Float64Array> = {}, storedJ: Record<string, Float64Array> = {}, ambientOutJ: Record<string, Float64Array> = {}, routedInJ: Record<string, Float64Array> = {};
  const comps = linkedComponents(d), linked = new Set(comps.flatMap((c) => c.bodies));
  for (const b of d.bodies) {
    if (linked.has(b.id)) continue;                                  // linked bodies are integrated together, below
    const feeds = d.routes.filter((r) => r.receiver === b.id).map((r) => byId.get(r.source)!.watts);
    const Ta = b.ambientTemperatureK, T = new Float64Array(n), Q = new Float64Array(n), A = new Float64Array(n), I = new Float64Array(n);
    T[0] = b.initialTemperatureK;
    const q = acc(), amb = acc(), inp = acc();
    const P = (k: number) => { let s = 0; for (const f of feeds) s += f[k]; return s; };
    for (let k = 1; k < n; k++) {
      const dt = times[k] - times[k - 1], Pbar = 0.5 * (P(k - 1) + P(k));
      const next = bodyInterval(b, Ta, q, amb, inp, dt, Pbar);      // K: derived for reporting and the supported-range check
      if (!supported(next)) throw new ThermalError('unsupported-temperature', b.id, `Thermal body ${b.id} reaches ${next} K at ${times[k]} s, outside the supported (0, 1e6] K`);
      T[k] = next; Q[k] = value(q); A[k] = value(amb); I[k] = value(inp);
    }
    temperatureK[b.id] = T; storedJ[b.id] = Q; ambientOutJ[b.id] = A; routedInJ[b.id] = I;
  }
  // THERMAL NETWORK V1: each LINKED component is integrated as ONE exact linear network per interval — simultaneous (every body's
  // update uses the same interval-start state), every link transfer computed once and booked with opposite signs at its two ends.
  const linkJ: Record<string, Float64Array> = {}, linkOutJ: Record<string, Float64Array> = {};
  const bodyBooksGapJ: Record<string, number> = {}, bodyBooksScaleJ: Record<string, number> = {};
  const bodySolveResidualJ: Record<string, number> = {}, bodySolveScaleJ: Record<string, number> = {}, bodyForwardBoundK: Record<string, number> = {};
  let globalBooksGapJ = 0, energyScaleJ = 0, blocksComputed = 0;
  for (const comp of comps) {
    const net = buildNetwork(comp, d), m = net.ids.length, st = networkState(net);
    const feeds = net.ids.map((id) => d.routes.filter((r) => r.receiver === id).map((r) => byId.get(r.source)!.watts));
    const P = (i: number, k: number) => { let s = 0; for (const f of feeds[i]) s += f[k]; return s; };
    const series = () => net.ids.map(() => new Float64Array(n));
    const T = series(), Q = series(), A = series(), I = series(), O = series(), L = net.links.map(() => new Float64Array(n));
    for (let i = 0; i < m; i++) T[i][0] = net.T0[i];
    const Pbar = new Array<number>(m);
    for (let k = 1; k < n; k++) {
      for (let i = 0; i < m; i++) Pbar[i] = 0.5 * (P(i, k - 1) + P(i, k));
      networkStep(net, st, times[k] - times[k - 1], Pbar);
      for (let i = 0; i < m; i++) {
        const q = value(st.q[i]), next = net.T0[i] + q / net.C[i];
        if (!supported(next)) throw new ThermalError('unsupported-temperature', net.ids[i], `Thermal body ${net.ids[i]} reaches ${next} K at ${times[k]} s, outside the supported (0, 1e6] K`);
        T[i][k] = next; Q[i][k] = q; A[i][k] = value(st.amb[i]); I[i][k] = value(st.inp[i]); O[i][k] = value(st.out[i]);
      }
      for (let l = 0; l < net.links.length; l++) L[l][k] = value(st.link[l]);
    }
    const closed = networkClose(net, st, 'run');
    net.ids.forEach((id, i) => {
      temperatureK[id] = T[i]; storedJ[id] = Q[i]; ambientOutJ[id] = A[i]; routedInJ[id] = I[i]; linkOutJ[id] = O[i];
      bodySolveResidualJ[id] = closed.res[i]; bodySolveScaleJ[id] = closed.scale[i]; bodyForwardBoundK[id] = closed.bound[i];
    });
    net.links.forEach((l, j) => { linkJ[l.id] = L[j]; });
    energyScaleJ += closed.E; blocksComputed += net.computed;
  }
  for (const l of d.links ?? []) if (!linkJ[l.id]) linkJ[l.id] = new Float64Array(n);   // an insulating link between separate bodies
  for (const b of d.bodies) {
    const e = n - 1;
    if (!linked.has(b.id)) {
      linkOutJ[b.id] = new Float64Array(n); bodySolveResidualJ[b.id] = 0; bodySolveScaleJ[b.id] = 0;
      energyScaleJ += Math.abs(routedInJ[b.id][e]) + Math.abs(ambientOutJ[b.id][e]);
    }
    const g = storedJ[b.id][e] + ambientOutJ[b.id][e] + linkOutJ[b.id][e] - routedInJ[b.id][e];
    bodyBooksGapJ[b.id] = g; globalBooksGapJ += g;
    bodyBooksScaleJ[b.id] = Math.abs(routedInJ[b.id][e]) + Math.abs(ambientOutJ[b.id][e]) + Math.abs(linkOutJ[b.id][e]) + Math.abs(storedJ[b.id][e]);
  }
  let routedJ = 0, outgoingJ = 0;
  for (const r of d.routes) (r.receiver === null ? (outgoingJ += sourceEnergyJ[r.source]) : (routedJ += sourceEnergyJ[r.source]));
  return { descriptor: d, times, temperatureK, storedJ, ambientOutJ, routedInJ, sourceEnergyJ, routedJ, outgoingJ, negativeSamples, negativeEnergyJ, excluded,
    linkJ, linkOutJ, network: { components: comps, bodyBooksGapJ, bodyBooksScaleJ, bodySolveResidualJ, bodySolveScaleJ, bodyForwardBoundK, globalBooksGapJ, energyScaleJ, blocksComputed } };
}

/**
 * A ZERO-INPUT CONTINUATION (a labelled thermal boundary condition, not a switched-off motor solve): from the run's final state,
 * every body relaxes toward its ambient with P = 0 for `seconds`, exactly (T = T_a + (T_end − T_a)·e^{−G·t/C}).
 */
export function continueCooling(run: ThermalRun, seconds: number, steps = 200) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ThermalError('invalid-time', 'seconds', 'A continuation needs a positive finite duration');
  if (!Number.isSafeInteger(steps) || steps < 1) throw new ThermalError('invalid-time', 'steps', 'A continuation needs a positive integer number of steps');
  const t0 = run.times[run.times.length - 1], times = new Float64Array(steps + 1);
  for (let k = 0; k <= steps; k++) times[k] = t0 + seconds * k / steps;
  const temperatureK: Record<string, Float64Array> = {}, ambientOutJ: Record<string, Float64Array> = {}, storedJ: Record<string, Float64Array> = {};
  const comps = linkedComponents(run.descriptor), linked = new Set(comps.flatMap((c) => c.bodies));
  for (const b of run.descriptor.bodies) {
    if (linked.has(b.id)) continue;                                  // linked bodies continue together, below
    const e0 = run.times.length - 1, C = b.heatCapacityJPerK, G = b.conductanceWPerK, Ta = b.ambientTemperatureK;
    const T = new Float64Array(steps + 1), A = new Float64Array(steps + 1), Q = new Float64Array(steps + 1);
    T[0] = run.temperatureK[b.id][e0]; A[0] = run.ambientOutJ[b.id][e0]; Q[0] = run.storedJ[b.id][e0];
    const q = acc(Q[0]), amb = acc(A[0]);
    for (let k = 1; k <= steps; k++) {
      // P = 0 in the same stable closed form as the run, on the same authoritative state (the stored energy relative to T0).
      const dt = times[k] - times[k - 1], u0 = (b.initialTemperatureK - Ta) + Q[k - 1] / C, { phi } = relaxation((G / C) * dt);
      const out = phi * G * u0 * dt;
      add(q, -out); add(amb, out); Q[k] = value(q); A[k] = value(amb); T[k] = b.initialTemperatureK + Q[k] / C;
    }
    temperatureK[b.id] = T; ambientOutJ[b.id] = A; storedJ[b.id] = Q;
  }
  // Thermal network v1: the SAME network continues with its links intact (P = 0 on every body), from the run's final state.
  const e0 = run.times.length - 1, at = (r: Record<string, ArrayLike<number>> | undefined, id: string) => r?.[id]?.[e0] ?? 0;
  const linkJ: Record<string, Float64Array> = {}, linkOutJ: Record<string, Float64Array> = {};
  const bodySolveResidualJ: Record<string, number> = {}, bodySolveScaleJ: Record<string, number> = {};
  let energyScaleJ = 0;
  for (const comp of comps) {
    const net = buildNetwork(comp, run.descriptor), m = net.ids.length;
    const st = networkState(net, { q: net.ids.map((id) => at(run.storedJ, id)), amb: net.ids.map((id) => at(run.ambientOutJ, id)),
      inp: net.ids.map((id) => at(run.routedInJ, id)), out: net.ids.map((id) => at(run.linkOutJ, id)), link: net.links.map((l) => at(run.linkJ, l.id)) });
    const series = () => net.ids.map(() => new Float64Array(steps + 1));
    const T = series(), Q = series(), A = series(), O = series(), L = net.links.map(() => new Float64Array(steps + 1));
    const record = (k: number) => {
      for (let i = 0; i < m; i++) {
        const q = value(st.q[i]), next = net.T0[i] + q / net.C[i];
        if (!supported(next)) throw new ThermalError('unsupported-temperature', net.ids[i], `Thermal body ${net.ids[i]} reaches ${next} K at ${times[k]} s, outside the supported (0, 1e6] K`);
        T[i][k] = next; Q[i][k] = q; A[i][k] = value(st.amb[i]); O[i][k] = value(st.out[i]);
      }
      for (let l = 0; l < net.links.length; l++) L[l][k] = value(st.link[l]);
    };
    record(0);
    const zero = new Array<number>(m).fill(0);
    for (let k = 1; k <= steps; k++) { networkStep(net, st, times[k] - times[k - 1], zero); record(k); }
    const closed = networkClose(net, st, 'continuation');
    net.ids.forEach((id, i) => { temperatureK[id] = T[i]; storedJ[id] = Q[i]; ambientOutJ[id] = A[i]; linkOutJ[id] = O[i]; bodySolveResidualJ[id] = closed.res[i]; bodySolveScaleJ[id] = closed.scale[i]; });
    net.links.forEach((l, j) => { linkJ[l.id] = L[j]; });
    energyScaleJ += closed.E;
  }
  for (const b of run.descriptor.bodies) if (!linked.has(b.id)) linkOutJ[b.id] = new Float64Array(steps + 1).fill(at(run.linkOutJ, b.id));
  for (const l of run.descriptor.links ?? []) if (!linkJ[l.id]) linkJ[l.id] = new Float64Array(steps + 1).fill(at(run.linkJ, l.id));
  return { boundary: 'zero-input thermal continuation (P = 0): not an electrical solve', times, temperatureK, ambientOutJ, storedJ,
    linkJ, linkOutJ, network: { bodySolveResidualJ, bodySolveScaleJ, energyScaleJ } };
}

export interface CompositeBalance {
  /** J over the run, from the electrical/mechanical energy account. */
  delivered: number; electromechanicalStores: number; externalLoadJ: number; mosfetJ: number;
  /** J: routed losses now appear ONLY as thermal storage + ambient transfer; unrouted losses stay outgoing. */
  routedStoredJ: number; routedAmbientJ: number; unroutedOutgoingJ: number;
  /** J: the electromechanical numerical residual, carried separately; and the composite residual that must equal it. */
  electromechanicalResidualJ: number; compositeResidualJ: number;
  /** J: Σ (storage + ambient + net link outflow) − Σ routed input — the thermal books, zero up to rounding. */
  thermalBooksGapJ: number;
  /** J: Σ over bodies of the net link outflow. Every transfer is booked once with opposite signs, so this is zero up to rounding; it
   *  is added to the composite explicitly so a transfer booked twice or with one end's sign reversed SHOWS in the residual. */
  linkNetJ: number;
}

/** The composite balance: each routed loss's old outgoing entry is REPLACED by storage + ambient transfer, never repeated. */
export function compositeBalance(acc: EnergyAccount, run: ThermalRun): CompositeBalance {
  let routedAccount = 0, unrouted = 0;
  const listed = new Set(run.descriptor.routes.map((r) => r.source));
  for (const id of Object.keys(acc.losses)) if (!listed.has(id)) throw new ThermalError('unrouted-source', id, `The energy account books loss ${id}, which the thermal descriptor does not list`);
  for (const r of run.descriptor.routes) {
    const L = acc.losses[r.source];
    if (L === undefined) throw new ThermalError('unknown-source', r.source, `The energy account has no loss ${r.source}`);
    if (r.receiver === null) unrouted += L; else routedAccount += L;
  }
  const e = run.times.length - 1; let stored = 0, ambient = 0, input = 0, linkNet = 0;
  for (const b of run.descriptor.bodies) {
    stored += run.storedJ[b.id][e]; ambient += run.ambientOutJ[b.id][e]; input += run.routedInJ[b.id][e];
    linkNet += run.linkOutJ?.[b.id]?.[e] ?? 0;                        // 0 exactly without links: the v1 numbers are unchanged
  }
  const compositeResidualJ = acc.delivered - (acc.stores + stored + ambient + linkNet + unrouted + acc.external + acc.mosfet);
  return { delivered: acc.delivered, electromechanicalStores: acc.stores, externalLoadJ: acc.external, mosfetJ: acc.mosfet,
    routedStoredJ: stored, routedAmbientJ: ambient, unroutedOutgoingJ: unrouted,
    electromechanicalResidualJ: acc.residual, compositeResidualJ, thermalBooksGapJ: stored + ambient + linkNet - input, linkNetJ: linkNet };
}

/**
 * THE PRODUCTION ADAPTER: a solved composition (the kit's structure, grid and lookup) + a descriptor → the thermal run, the
 * electromechanical energy account and the composite balance, from ONE trajectory. A run outside a motor's supported
 * (motoring) domain is refused, as the kit's `motor-domain` check would name it.
 */
export function thermalFromComposition(c: Composition, s: Structure, times: Float64Array, pick: (vec: string) => Float64Array, d: ThermalDescriptor, opts: { graceSeconds?: number } = {}) {
  for (const p of c.parts) if (p.kind === 'motor') {
    const dom = motorDomainOf(p, s, times, pick, { graceSeconds: opts.graceSeconds ?? 0.005 });
    if (!dom.ok) throw new ThermalError('outside-motor-domain', p.name, `Motor ${p.name}: ${dom.reason} — thermal evaluation of an unsupported run is refused`);
  }
  const { sources, excluded } = lossSources(c, s, times, pick);
  const run = simulateThermal(times, sources, d, excluded);
  const account = energyAccountOf(c, s, times, pick);
  return { run, account, composite: compositeBalance(account, run) };
}

// ================================================================ thermal network v1 (docs/THERMAL-NETWORK-V1-DECLARATION.md)
export interface LinkedComponent { bodies: string[]; links: ThermalLink[] }

/** The connected groups the CONDUCTING links (G > 0) form, bodies in descriptor order (amendment N-5). */
export function linkedComponents(d: ThermalDescriptor): LinkedComponent[] {
  const links = d.links ?? [];
  if (!links.length) return [];
  const parent = new Map<string, string>(d.bodies.map((b) => [b.id, b.id] as const));
  const find = (x: string): string => { let r = x; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  // Only a CONDUCTING link joins bodies into one network: a G = 0 link is insulation, so its bodies stay exactly independent (the
  // one-body path). A G = 0 link between bodies already joined rides along and transfers exactly nothing; any other reports zeros.
  for (const l of links) if (l.conductanceWPerK > 0) { const ra = find(l.a), rb = find(l.b); if (ra !== rb) parent.set(ra, rb); }
  const groups = new Map<string, LinkedComponent>();
  for (const l of links) if (l.conductanceWPerK > 0) { const r = find(l.a); let g = groups.get(r); if (!g) groups.set(r, (g = { bodies: [], links: [] })); g.links.push(l); }
  for (const l of links) if (!(l.conductanceWPerK > 0)) { const r = find(l.a); if (r === find(l.b)) groups.get(r)?.links.push(l); }
  for (const b of d.bodies) groups.get(find(b.id))?.bodies.push(b.id);
  return [...groups.values()];
}

type Mat = number[][];
const zeroMat = (r: number, c: number = r): Mat => Array.from({ length: r }, () => new Array<number>(c).fill(0));
function matMul(a: Mat, b: Mat): Mat {
  const r = a.length, inner = b.length, c = b[0].length, out = zeroMat(r, c);
  for (let i = 0; i < r; i++) {
    const oi = out[i];
    for (let k = 0; k < inner; k++) { const v = a[i][k]; if (v === 0) continue; const bk = b[k]; for (let j = 0; j < c; j++) oi[j] += v * bk[j]; }
  }
  return out;
}
function norm1(a: Mat): number { let m = 0; for (let j = 0; j < a[0].length; j++) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i][j]); if (s > m) m = s; } return m; }

/**
 * e^{M} − I in INCREMENT form: scale by 2^{−s} (exact) until ‖·‖₁ ≤ 1/2, sum the Taylor series of e^{S} − I (it must converge
 * within 40 terms, or the run is refused), then square back with Y ← Y² + 2Y. e^{M} is never formed and then reduced by I, so an
 * increment far below ulp(1) keeps its digits (the b98f8b61 lesson, for matrices).
 */
export function expm1Increment(M: Mat): Mat {
  const N = M.length; let nrm = norm1(M), s = 0;
  if (!Number.isFinite(nrm)) throw new ThermalError('expm-not-converged', '$', `The network exponential has a non-finite entry (‖M‖₁ = ${nrm})`);
  if (nrm === 0) return zeroMat(N);
  while (nrm > 0.5) { nrm /= 2; s++; }
  const scale = 2 ** -s, S = M.map((r) => r.map((v) => v * scale));
  let term = S, Y = S.map((r) => r.slice()), converged = false;
  for (let k = 2; k <= 40 && !converged; k++) {
    term = matMul(term, S);
    for (const r of term) for (let j = 0; j < N; j++) r[j] /= k;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) Y[i][j] += term[i][j];
    converged = norm1(term) <= 1e-18 * norm1(Y);
  }
  if (!converged) throw new ThermalError('expm-not-converged', '$', 'The Taylor series of the scaled network exponential did not converge within 40 terms');
  for (let q = 0; q < s; q++) { const Y2 = matMul(Y, Y); for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) Y2[i][j] += 2 * Y[i][j]; Y = Y2; }
  return Y;
}

interface NetworkLink { id: string; ia: number; ib: number; G: number; path: [number, number][] }
interface NetworkBlocks { X: Mat; P1: Mat; P2: Mat }
/**
 * A linked component in CONSERVATIVE coordinates z = (ū, δ) (amendment N-2): ū = Σ C_i·w_i / ΣC with w = T − T_ref (ONE reference
 * for the component, N-5), and for every non-root body j of a spanning tree rooted at the largest capacity, δ_j = w_j − w_parent(j). The ū equation carries only the input
 * and the ambient terms — the links are LEFT OUT of it by construction, never cancelled in rounding — so a stiff link cannot leak
 * energy through the conserved direction. A link's temperature difference is an exact signed path sum of δs, so its transfer is
 * computed without subtracting two nearly equal temperatures.
 */
interface Network {
  ids: string[]; C: number[]; Gamb: number[]; T0: number[]; Ta: number[]; links: NetworkLink[]; Csum: number;
  /** For δ coordinate k ≥ 1: its body and that body's tree parent (index 0 is ū). */
  coordBody: number[]; coordParent: number[];
  /** u = U·z: column 0 is 1; column k is δ_k's deviation pattern, (complement or −subtree capacity)/ΣC, so Σ_i C_i·U[i][k] = 0. */
  U: Mat;
  /** z' = B·z + g_z. */
  B: Mat;
  /** K: the component's one reference temperature; per body the ACTIVE ambient's offset T_a − T_ref (0 when G_amb = 0). */
  Tref: number; offset: number[];
  /** W per body: G_amb·(T_a − T_ref), the ambient forcing relative to the reference (0 for an inactive ambient). */
  forcingOffset: number[];
  cache: Map<number, NetworkBlocks>; computed: number;
}

function buildNetwork(comp: LinkedComponent, d: ThermalDescriptor): Network {
  const byId = new Map(d.bodies.map((b) => [b.id, b] as const)), ids = comp.bodies, m = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i] as const)), body = ids.map((id) => byId.get(id)!);
  const C = body.map((b) => b.heatCapacityJPerK), Gamb = body.map((b) => b.conductanceWPerK);
  const T0 = body.map((b) => b.initialTemperatureK), Ta = body.map((b) => b.ambientTemperatureK);
  const raw = comp.links.map((l) => ({ id: l.id, ia: idx.get(l.a)!, ib: idx.get(l.b)!, G: l.conductanceWPerK }));
  // the spanning tree: breadth-first over every link (G = 0 included), rooted at the largest capacity so no deviation pattern
  // is formed as 1 − (almost all the capacity)/ΣC
  let root = 0; for (let i = 1; i < m; i++) if (C[i] > C[root]) root = i;
  const adj: number[][] = ids.map(() => []);
  for (const l of raw) { adj[l.ia].push(l.ib); adj[l.ib].push(l.ia); }
  const parent = new Array<number>(m).fill(-1), seen = new Array<boolean>(m).fill(false), order = [root];
  seen[root] = true;
  for (let q = 0; q < order.length; q++) for (const j of adj[order[q]]) if (!seen[j]) { seen[j] = true; parent[j] = order[q]; order.push(j); }
  const coordBody = [-1, ...order.slice(1)], coordParent = coordBody.map((b) => (b < 0 ? -1 : parent[b]));
  const coordOf = new Map(coordBody.map((b, k) => [b, k] as const));
  // Pth[i][k] = 1 when δ_k's body lies on the tree path from the root to i (i included): u_i − u_root = Σ_k Pth[i][k]·δ_k
  const Pth = zeroMat(m);
  for (let i = 0; i < m; i++) for (let b = i; b !== root; b = parent[b]) Pth[i][coordOf.get(b)!] = 1;
  let Csum = 0; for (const c of C) Csum += c;
  const U = zeroMat(m);
  for (let i = 0; i < m; i++) U[i][0] = 1;
  for (let k = 1; k < m; k++) {
    let sub = 0, rest = 0; for (let i = 0; i < m; i++) (Pth[i][k] ? (sub += C[i]) : (rest += C[i]));   // both explicit sums
    for (let i = 0; i < m; i++) U[i][k] = Pth[i][k] ? rest / Csum : -sub / Csum;
  }
  // H·U with H = C⁻¹K: column 0 is G_amb/C (K·1 = G_amb, structurally); a link adds G·s with s = Pth[a][k] − Pth[b][k] ∈ {−1, 0, 1}
  // taken EXACTLY from the tree, never as a difference of two rounded deviation patterns.
  const HU = zeroMat(m);
  for (let i = 0; i < m; i++) { HU[i][0] = Gamb[i] / C[i]; for (let k = 1; k < m; k++) HU[i][k] = Gamb[i] * U[i][k] / C[i]; }
  for (const l of raw) for (let k = 1; k < m; k++) {
    const s = Pth[l.ia][k] - Pth[l.ib][k];
    if (s !== 0) { HU[l.ia][k] += l.G * s / C[l.ia]; HU[l.ib][k] -= l.G * s / C[l.ib]; }
  }
  const B = zeroMat(m);
  for (let k = 0; k < m; k++) { let s = 0; for (let j = 0; j < m; j++) s += Gamb[j] * U[j][k]; B[0][k] = -s / Csum; }   // ū: ambient only
  for (let k = 1; k < m; k++) { const c = coordBody[k], p = coordParent[k]; for (let j = 0; j < m; j++) B[k][j] = -(HU[c][j] - HU[p][j]); }
  // ONE reference temperature for the whole component (N-5): a link's difference is then a plain difference of the state, never
  // (excess over one ambient) − (excess over another) + ΔT_a, and an inactive ambient (G_amb = 0) cannot enter the arithmetic at all.
  // The reference is the ambient of the body with the stiffest ACTIVE ambient coupling (largest G_amb/C), whose offset is then 0;
  // with no active ambient it is the first body's initial temperature. With one common ambient every offset is 0.
  let refBody = -1;
  for (let i = 0; i < m; i++) if (Gamb[i] > 0 && (refBody < 0 || Gamb[i] / C[i] > Gamb[refBody] / C[refBody])) refBody = i;
  const Tref = refBody >= 0 ? Ta[refBody] : T0[0];
  const offset = Gamb.map((g, i) => (g > 0 ? Ta[i] - Tref : 0));
  const forcingOffset = Gamb.map((g, i) => (g > 0 ? g * offset[i] : 0));
  const links = raw.map((l) => {
    const path: [number, number][] = [];
    for (let k = 1; k < m; k++) { const s = Pth[l.ia][k] - Pth[l.ib][k]; if (s !== 0) path.push([k, s]); }
    return { ...l, path };
  });
  return { ids, C, Gamb, T0, Ta, Tref, offset, links, Csum, coordBody, coordParent, U, B, forcingOffset, cache: new Map(), computed: 0 };
}

/**
 * The exact blocks for an interval of length h, from ONE augmented exponential M = [[B, I, 0], [0, 0, I], [0, 0, 0]]·h:
 * X = e^{Bh} − I,  Φ1 = ∫₀ʰ e^{Bs} ds,  Φ2 = ∫₀ʰ∫₀ˢ e^{Bσ} dσ ds. Cached per distinct h.
 */
function networkBlocks(net: Network, h: number): NetworkBlocks {
  const hit = net.cache.get(h);
  if (hit) return hit;
  const m = net.ids.length, M = zeroMat(3 * m);
  for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) M[i][j] = net.B[i][j] * h; M[i][m + i] = h; M[m + i][2 * m + i] = h; }
  const Y = expm1Increment(M), block = (c0: number) => Y.slice(0, m).map((r) => r.slice(c0, c0 + m));
  const b = { X: block(0), P1: block(m), P2: block(2 * m) };
  net.computed++;
  if (net.cache.size < 8192) net.cache.set(h, b);
  return b;
}

interface NetworkState { q: Acc[]; amb: Acc[]; inp: Acc[]; out: Acc[]; link: Acc[]; res: Acc[]; scale: number[]; io: number[]; maxQ: number[]; localMax: number[]; ambErr: number[] }
function networkState(net: Network, base?: { q: number[]; amb: number[]; inp: number[]; out: number[]; link: number[] }): NetworkState {
  const m = net.ids.length, accs = (v: number[] | undefined, len: number) => Array.from({ length: len }, (_, i) => acc(v ? v[i] : 0));
  return { q: accs(base?.q, m), amb: accs(base?.amb, m), inp: accs(base?.inp, m), out: accs(base?.out, m), link: accs(base?.link, net.links.length),
    res: accs(undefined, m), scale: new Array<number>(m).fill(0), io: new Array<number>(m).fill(0),
    maxQ: net.ids.map((_, i) => Math.abs(base ? base.q[i] : 0)), localMax: new Array<number>(m).fill(0), ambErr: new Array<number>(m).fill(0) };
}

/** TEST-ONLY fault injection (amendment N-5): a relative error multiplied into every link transfer, so the tests can show the
 *  solve-residual gate firing on a wrong transfer. It is 0 in production (F·(1 + 0) is F exactly); tests set it inside try/finally. */
export const NETWORK_FAULT_INJECTION = { transferRelError: 0 };

/**
 * ONE interval of a linked component, SIMULTANEOUSLY for every body (all from the interval-start state). The state is w = T − T_ref
 * with ONE reference for the component (N-5), in conservative coordinates: Δz = X·z0 + Φ1·g_z and ∫z dt = Φ1·z0 + Φ2·g_z. Each link's
 * transfer F = G·Σ_path ±∫δ is computed ONCE from an exact path sum of state differences; ambient export is G_amb·(∫w − o·h) with o
 * the active ambient's offset from the reference. The AUTHORITATIVE increment is the BOOKED one (N-3): input − ambient − (+F at a,
 * −F at b), each term compensated. The exact modal increment C·(U·Δz) is the cross-check; their difference is the solve residual.
 */
function networkStep(net: Network, st: NetworkState, h: number, Pbar: number[]): void {
  const m = net.ids.length, { X, P1, P2 } = networkBlocks(net, h);
  const w0 = new Array<number>(m), z0 = new Array<number>(m), gz = new Array<number>(m), dz = new Array<number>(m), Iz = new Array<number>(m);
  let mean = 0, forcing = 0;
  for (let i = 0; i < m; i++) { w0[i] = (net.T0[i] - net.Tref) + value(st.q[i]) / net.C[i]; mean += net.C[i] * w0[i]; forcing += Pbar[i] + net.forcingOffset[i]; }
  z0[0] = mean / net.Csum; gz[0] = forcing / net.Csum;
  for (let k = 1; k < m; k++) {
    const c = net.coordBody[k], p = net.coordParent[k];
    z0[k] = w0[c] - w0[p];
    gz[k] = (Pbar[c] + net.forcingOffset[c]) / net.C[c] - (Pbar[p] + net.forcingOffset[p]) / net.C[p];
  }
  for (let k = 0; k < m; k++) {
    let a = 0, b = 0;
    for (let j = 0; j < m; j++) { a += X[k][j] * z0[j] + P1[k][j] * gz[j]; b += P1[k][j] * z0[j] + P2[k][j] * gz[j]; }
    dz[k] = a; Iz[k] = b;
  }
  const modal = new Array<number>(m), mix = new Array<number>(m), amb = new Array<number>(m), out = new Array<number>(m).fill(0), flux = new Array<number>(m).fill(0);
  for (let i = 0; i < m; i++) {
    let a = 0, w = 0, b = 0;
    for (let k = 0; k < m; k++) { const t = net.U[i][k] * dz[k]; a += t; w += Math.abs(t); b += net.U[i][k] * Iz[k]; }
    modal[i] = net.C[i] * a; mix[i] = net.C[i] * w;
    amb[i] = net.Gamb[i] > 0 ? net.Gamb[i] * (b - net.offset[i] * h) : 0;
  }
  const fault = 1 + NETWORK_FAULT_INJECTION.transferRelError;
  for (let l = 0; l < net.links.length; l++) {
    const { ia, ib, G, path } = net.links[l];
    let diff = 0; for (const [k, s] of path) diff += s * Iz[k];
    const F = G * diff * fault;
    add(st.link[l], F); add(st.out[ia], F); add(st.out[ib], -F); add(st.q[ia], -F); add(st.q[ib], F);
    out[ia] += F; out[ib] -= F; flux[ia] += Math.abs(F); flux[ib] += Math.abs(F);
  }
  for (let i = 0; i < m; i++) {
    const inp = Pbar[i] * h;
    add(st.q[i], inp); add(st.q[i], -amb[i]); add(st.amb[i], amb[i]); add(st.inp[i], inp);
    add(st.res[i], inp); add(st.res[i], -amb[i]); add(st.res[i], -out[i]); add(st.res[i], -modal[i]);   // booked − modal
    // the residual's scale: the energies actually exchanged (input, |ambient|, |transfers|) and the rounding scale of the modal
    // increment itself, C·Σ_k|U_ik·Δz_k| (N-3). No conditioning term: after N-5 no transfer is formed from offset quantities.
    st.scale[i] += Math.abs(inp) + Math.abs(amb[i]) + flux[i] + mix[i];
    st.io[i] += Math.abs(inp) + Math.abs(amb[i]);
    const q = Math.abs(value(st.q[i])); if (q > st.maxQ[i]) st.maxQ[i] = q;
    // FORWARD rounding bound (N-5), from where rounding enters the booked terms: each flux carries a relative error ≈ ε, so the
    // body's temperature is off by ≈ ε·(|input| + |ambient| + Σ|F|)/C locally (a transfer error is booked ± and only moves energy
    // between bodies, so this part does not accumulate); an ACTIVE ambient offset o adds ε·max(1, x)·|o| (x = G_amb·h/C, the
    // cancellation in G_amb·(∫w − o·h)); ambient-flux rounding leaves the component and accumulates, over its whole capacity.
    const x = net.Gamb[i] * h / net.C[i];
    const local = 4 * Number.EPSILON * (Math.abs(inp) + Math.abs(amb[i]) + flux[i]) / net.C[i] + (net.offset[i] !== 0 ? 8 * Number.EPSILON * Math.max(1, x) * Math.abs(net.offset[i]) : 0);
    if (local > st.localMax[i]) st.localMax[i] = local;
    st.ambErr[i] += 4 * Number.EPSILON * Math.abs(amb[i]);
  }
}

/**
 * Before any trajectory is returned: a body whose FORWARD rounding estimate exceeds 1e-9 of the component's temperature scale is
 * refused (`network-conditioning`); a body whose solve residual exceeds 1e-9 of its scale is refused (`network-residual`). The
 * temperature scale is the component's physical spread — the largest excursion |T − T0| of any of its bodies, or the largest
 * ACTIVE ambient offset — never an inactive ambient or the arbitrary reference: a body that barely moves while heat flows through
 * it is judged against the temperature differences that drive it. Never passed silently.
 */
function networkClose(net: Network, st: NetworkState, where: string) {
  const res = st.res.map(value), scale = st.scale.slice(); let E = 0, ambErr = 0;
  for (let i = 0; i < net.ids.length; i++) ambErr += st.ambErr[i];
  const bound = net.ids.map((_, i) => st.localMax[i] + ambErr / net.Csum);
  let theta = 0; for (let i = 0; i < net.ids.length; i++) theta = Math.max(theta, st.maxQ[i] / net.C[i], Math.abs(net.offset[i]));
  for (let i = 0; i < net.ids.length; i++) if (!(bound[i] <= 1e-9 * theta))
    throw new ThermalError('network-conditioning', net.ids[i], `Thermal network body ${net.ids[i]} (${where}): its forward rounding bound ${bound[i].toExponential(3)} K exceeds 1e-9 × the network's temperature scale ${theta.toExponential(3)} K — too stiff, or too much heat through too little capacity per step, for these steps; refused, no trajectory returned`);
  for (let i = 0; i < net.ids.length; i++) {
    E += st.io[i] + st.maxQ[i];
    if (!(Math.abs(res[i]) <= 1e-9 * scale[i]))
      throw new ThermalError('network-residual', net.ids[i], `Thermal network body ${net.ids[i]} (${where}): the booked increment (input − ambient − link outflow) and the exact modal increment differ by ${res[i].toExponential(3)} J, over 1e-9 × its scale ${scale[i].toExponential(3)} J — refused, never passed silently`);
  }
  return { res, scale, E, bound };
}

/**
 * An independent audit of a run's network books from its cumulative series: per body, stored + ambient + booked link outflow − input;
 * the booked outflow against what the links' own transfers and orientations imply; and Σ booked outflow (zero when every transfer is
 * booked once with opposite signs). A reversed or doubled booking shows here.
 */
export function networkAudit(run: Pick<ThermalRun, 'descriptor' | 'times' | 'storedJ' | 'ambientOutJ' | 'routedInJ' | 'linkJ' | 'linkOutJ'>) {
  const e = run.times.length - 1, links = run.descriptor.links ?? [];
  const bodyBooksGapJ: Record<string, number> = {}, orientationGapJ: Record<string, number> = {};
  let linkCancellationJ = 0, transferMagnitudeJ = 0;
  for (const l of links) transferMagnitudeJ += Math.abs(run.linkJ[l.id][e]);
  for (const b of run.descriptor.bodies) {
    const out = run.linkOutJ[b.id]?.[e] ?? 0;
    let implied = 0;
    for (const l of links) { if (l.a === b.id) implied += run.linkJ[l.id][e]; if (l.b === b.id) implied -= run.linkJ[l.id][e]; }
    linkCancellationJ += out; orientationGapJ[b.id] = out - implied;
    bodyBooksGapJ[b.id] = run.storedJ[b.id][e] + run.ambientOutJ[b.id][e] + out - run.routedInJ[b.id][e];
  }
  return { bodyBooksGapJ, orientationGapJ, linkCancellationJ, transferMagnitudeJ };
}

// ================================================================ thermal feedback v1: a state-preserving thermal stepper
/**
 * THE THERMAL SIDE OF A CLOSED LOOP (docs/THERMAL-FEEDBACK-V1-DECLARATION.md). The same bodies, routes, links and updates as
 * `simulateThermal`, advanced one interval at a time with each loss source's power HELD over the interval (a zero-order hold): a
 * body uses the accepted one-body update (`bodyInterval`, shared with `simulateThermal`), a linked component the network step, both
 * fed P̄ = the held power. The stored energy relative to T0 stays the authoritative state; an ambient change at a boundary alters
 * only the rate, never the state; a snapshot/restore lets an event be located from the interval start without resetting anything.
 */
export interface ThermalStepperTotals {
  storedJ: Record<string, number>; ambientOutJ: Record<string, number>; routedInJ: Record<string, number>;
  linkJ: Record<string, number>; linkOutJ: Record<string, number>; sourceJ: Record<string, number>;
}
export interface ThermalStepper {
  readonly descriptor: ThermalDescriptor;
  time(): number;
  temperatureK(body: string): number;
  /** Advance by h seconds with each source's power (W) held constant. Every source must be given, finite, and not negative beyond the noise floor. */
  advance(h: number, watts: Record<string, number>): void;
  /** A declared thermal boundary change at the present time: the body's ambient temperature, from now on. */
  setAmbient(body: string, kelvin: number): void;
  snapshot(): unknown;
  restore(snapshot: unknown): void;
  totals(): ThermalStepperTotals;
  /** The network gates (forward estimate, solve residual) over everything advanced so far; refuses by name like a run. */
  close(): { bodySolveResidualJ: Record<string, number>; bodyForwardBoundK: Record<string, number> };
}

export function createThermalStepper(d: ThermalDescriptor, sourceIds: string[], t0 = 0): ThermalStepper {
  validateDescriptor(d);
  if (!Number.isFinite(t0)) throw new ThermalError('invalid-time', 't0', 'The stepper start time must be finite');
  const seen = new Set<string>();
  for (const id of sourceIds) { if (seen.has(id)) throw new ThermalError('duplicate-source', id, `Loss source ${id} appears twice in the source list: each loss has one identity and is booked once`); seen.add(id); }
  for (const r of d.routes) if (!seen.has(r.source)) throw new ThermalError('unknown-source', r.source, `No loss source ${r.source} in this loop (sources: ${sourceIds.join(', ')})`);
  for (const id of sourceIds) if (!d.routes.some((r) => r.source === id))
    throw new ThermalError('unrouted-source', id, `Loss source ${id} is not listed: route it to a body or to null (explicitly outgoing) — no loss may silently vanish`);
  const ambient: Record<string, number> = Object.fromEntries(d.bodies.map((b) => [b.id, b.ambientTemperatureK]));
  const comps = linkedComponents(d), linked = new Set(comps.flatMap((c) => c.bodies));
  const feeds: Record<string, string[]> = Object.fromEntries(d.bodies.map((b) => [b.id, d.routes.filter((r) => r.receiver === b.id).map((r) => r.source)]));
  const singles = d.bodies.filter((b) => !linked.has(b.id)).map((b) => ({ b, q: acc(), amb: acc(), inp: acc() }));
  const withAmbient = (): ThermalDescriptor => ({ ...d, bodies: d.bodies.map((b) => ({ ...b, ambientTemperatureK: ambient[b.id] })) });
  let nets = comps.map((comp) => { const net = buildNetwork(comp, d); return { comp, net, st: networkState(net) }; });
  const clock = acc(t0), sourceJ = Object.fromEntries(sourceIds.map((id) => [id, acc()])), peak: Record<string, number> = Object.fromEntries(sourceIds.map((id) => [id, 0]));
  const body = (id: string) => { const b = d.bodies.find((x) => x.id === id); if (!b) throw new ThermalError('unknown-body', id, `No thermal body ${id}`); return b; };
  const copyAcc = (x: Acc): Acc => ({ s: x.s, c: x.c });
  const self: ThermalStepper = {
    descriptor: d,
    time: () => value(clock),
    temperatureK(id) {
      const b = body(id), s = singles.find((x) => x.b.id === id);
      if (s) return b.initialTemperatureK + value(s.q) / b.heatCapacityJPerK;
      for (const { net, st } of nets) { const i = net.ids.indexOf(id); if (i >= 0) return net.T0[i] + value(st.q[i]) / net.C[i]; }
      throw new ThermalError('unknown-body', id, `No thermal body ${id}`);
    },
    advance(h, watts) {
      if (!(Number.isFinite(h) && h > 0)) throw new ThermalError('invalid-time', 'h', `A step must be a positive finite duration (got ${h})`);
      for (const id of sourceIds) {
        const w = watts[id];
        if (typeof w !== 'number' || !Number.isFinite(w)) throw new ThermalError('nonfinite-loss', id, `Loss source ${id} has no finite power for the step at ${value(clock)} s (got ${w})`);
        peak[id] = Math.max(peak[id], Math.abs(w));
        const floor = Math.max(1e-15, 1e-9 * peak[id]);
        if (w < -floor) throw new ThermalError('negative-loss', id, `Loss source ${id} is ${w.toExponential(3)} W at ${value(clock)} s: a passive loss cannot be negative beyond the solver-noise floor ${floor.toExponential(2)} W`);
      }
      for (const id of Object.keys(watts)) if (!seen.has(id)) throw new ThermalError('unknown-source', id, `Power given for ${id}, which is not a loss source of this loop`);
      const P = (id: string) => { let s = 0; for (const src of feeds[id]) s += watts[src]; return s; };
      const t1 = value(clock) + h;
      for (const s of singles) {
        const next = bodyInterval(s.b, ambient[s.b.id], s.q, s.amb, s.inp, h, P(s.b.id));
        if (!supported(next)) throw new ThermalError('unsupported-temperature', s.b.id, `Thermal body ${s.b.id} reaches ${next} K at ${t1} s, outside the supported (0, 1e6] K`);
      }
      for (const { net, st } of nets) {
        networkStep(net, st, h, net.ids.map(P));
        net.ids.forEach((id, i) => { const T = net.T0[i] + value(st.q[i]) / net.C[i];
          if (!supported(T)) throw new ThermalError('unsupported-temperature', id, `Thermal body ${id} reaches ${T} K at ${t1} s, outside the supported (0, 1e6] K`); });
      }
      for (const id of sourceIds) add(sourceJ[id], watts[id] * h);
      add(clock, h);
    },
    setAmbient(id, kelvin) {
      body(id);
      if (!(Number.isFinite(kelvin) && kelvin > THERMAL_LIMITS.temperature[0] && kelvin <= THERMAL_LIMITS.temperature[1]))
        throw new ThermalError('invalid-parameter', id, `Ambient temperature of ${id} must be a finite number in (0, 1e6] K (got ${kelvin})`);
      ambient[id] = kelvin;
      // a linked component's reference and ambient offsets depend on the ambients: rebuild its network, KEEP its state
      nets = nets.map(({ comp, st }) => ({ comp, net: buildNetwork(comp, withAmbient()), st }));
    },
    snapshot() {
      return { clock: copyAcc(clock), ambient: { ...ambient }, peak: { ...peak }, sourceJ: Object.fromEntries(Object.entries(sourceJ).map(([k, v]) => [k, copyAcc(v)])),
        singles: singles.map((s) => ({ q: copyAcc(s.q), amb: copyAcc(s.amb), inp: copyAcc(s.inp) })),
        nets: nets.map(({ st }) => ({ q: st.q.map(copyAcc), amb: st.amb.map(copyAcc), inp: st.inp.map(copyAcc), out: st.out.map(copyAcc), link: st.link.map(copyAcc),
          res: st.res.map(copyAcc), scale: st.scale.slice(), io: st.io.slice(), maxQ: st.maxQ.slice(), localMax: st.localMax.slice(), ambErr: st.ambErr.slice() })) };
    },
    restore(snap) {
      const s = snap as ReturnType<ThermalStepper['snapshot']> & Record<string, any>;
      Object.assign(clock, s.clock); Object.assign(peak, s.peak);
      for (const k of Object.keys(sourceJ)) Object.assign(sourceJ[k], s.sourceJ[k]);
      const ambientChanged = d.bodies.some((b) => ambient[b.id] !== s.ambient[b.id]);
      Object.assign(ambient, s.ambient);
      singles.forEach((x, i) => { Object.assign(x.q, s.singles[i].q); Object.assign(x.amb, s.singles[i].amb); Object.assign(x.inp, s.singles[i].inp); });
      nets.forEach(({ st }, i) => { const n = s.nets[i];
        (['q', 'amb', 'inp', 'out', 'link', 'res'] as const).forEach((k) => st[k].forEach((a, j) => Object.assign(a, n[k][j])));
        st.scale = n.scale.slice(); st.io = n.io.slice(); st.maxQ = n.maxQ.slice(); st.localMax = n.localMax.slice(); st.ambErr = n.ambErr.slice(); });
      if (ambientChanged) nets = nets.map(({ comp, st }) => ({ comp, net: buildNetwork(comp, withAmbient()), st }));
    },
    totals() {
      const t: ThermalStepperTotals = { storedJ: {}, ambientOutJ: {}, routedInJ: {}, linkJ: {}, linkOutJ: {}, sourceJ: {} };
      for (const s of singles) { t.storedJ[s.b.id] = value(s.q); t.ambientOutJ[s.b.id] = value(s.amb); t.routedInJ[s.b.id] = value(s.inp); t.linkOutJ[s.b.id] = 0; }
      for (const { net, st } of nets) {
        net.ids.forEach((id, i) => { t.storedJ[id] = value(st.q[i]); t.ambientOutJ[id] = value(st.amb[i]); t.routedInJ[id] = value(st.inp[i]); t.linkOutJ[id] = value(st.out[i]); });
        net.links.forEach((l, j) => { t.linkJ[l.id] = value(st.link[j]); });
      }
      for (const l of d.links ?? []) if (t.linkJ[l.id] === undefined) t.linkJ[l.id] = 0;
      for (const id of sourceIds) t.sourceJ[id] = value(sourceJ[id]);
      return t;
    },
    close() {
      const bodySolveResidualJ: Record<string, number> = {}, bodyForwardBoundK: Record<string, number> = {};
      for (const { net, st } of nets) { const c = networkClose(net, st, 'feedback'); net.ids.forEach((id, i) => { bodySolveResidualJ[id] = c.res[i]; bodyForwardBoundK[id] = c.bound[i]; }); }
      return { bodySolveResidualJ, bodyForwardBoundK };
    },
  };
  return self;
}
