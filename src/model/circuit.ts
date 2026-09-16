/**
 * BATCH 4 — AUTHORED DC RESISTOR NETWORKS.  See ELECTRICAL-DECLARATION.md, frozen
 * and stamped before this file existed.
 *
 * ===========================================================================
 * WHAT THIS IS, AND DELIBERATELY WHAT IT IS NOT
 * ===========================================================================
 * It is: ONE ideal independent DC voltage source, positive finite resistors,
 * IDEAL WIRES THAT MERGE EQUIPOTENTIAL NODES, an algebraic solve done once and
 * cached, and an explicit per-resistor route for 100% of that resistor's Joule
 * power into an existing thermally configured body.
 *
 * It is NOT a netlist parser, NOT a generic multi-domain solver, and NOT a
 * plugin framework. There are no capacitor, inductor, switch, AC or
 * semiconductor fields — not even unused ones. A component variant this slice
 * does not implement is REFUSED, never guessed at and never silently dropped.
 *
 *   *** IDEAL GROUND IS A VOLTAGE REFERENCE. It is not earth, and it is not
 *       the mechanical ground body. ***
 *   *** ELECTRICAL CONNECTIVITY IS BY NODE ID ONLY. Body position, contact and
 *       drawn crossings are irrelevant to it. ***
 *   *** WIRE EQUIVALENCE IS DERIVED. The authored graph is preserved; it is
 *       never destructively flattened into a resistor list. ***
 */

import { SI } from './units';

export const CIRCUIT_LIMITS = {
  maxNodes: 32,
  maxComponents: 64,
  maxResistors: 32,
  maxWires: 32,
  minResistance: 1e-6,      // ohm
  maxResistance: 1e9,       // ohm
  maxVoltage: 1e6,          // V
} as const;

/** Scale-aware acceptance thresholds, FROZEN in the declaration before any result. */
export const CIRCUIT_TOL = {
  /** A. Absolute floor of the per-node KCL acceptance check. */
  kclAbs: 1e-12,
  /** Dimensionless. Relative part, against the sum of |branch current| at the node. */
  kclRel: 1e-9,
  /** W. Absolute floor of the source-power / resistor-power consistency check. */
  powerAbs: 1e-12,
  /** Dimensionless. Relative part, against the larger of the two powers. */
  powerRel: 1e-9,
} as const;

// ---------------------------------------------------------------------------
// AUTHORED CONTENT
// ---------------------------------------------------------------------------

export interface CircuitNodeDesc {
  /** Application-owned, stable, in the ONE shared application id namespace. */
  id: string;
  label: string;
}

/**
 * DISCRIMINATED COMPONENT DESCRIPTORS. Each carries its model identity, its model
 * VERSION, and its TERMINAL ORIENTATION explicitly. Row indices and merged-node
 * numbers are runtime details and appear nowhere here.
 */
export type ComponentDesc =
  | {
      kind: 'source'; model: 'ideal-dc-voltage'; modelVersion: 1;
      id: string; label: string;
      /** Node ids. `neg` is the 0 V reference of the whole circuit. */
      pos: string; neg: string;
      /** V. Finite, |V| <= CIRCUIT_LIMITS.maxVoltage. Zero is allowed. */
      voltage: number;
    }
  | {
      kind: 'resistor'; model: 'linear-resistor'; modelVersion: 1;
      id: string; label: string;
      /** Node ids. Current is POSITIVE FROM a TO b, and V = Va - Vb. */
      a: string; b: string;
      /** ohm. Strictly positive and inside the declared range. */
      resistance: number;
      /** Body id receiving 100% of this resistor's Joule power. Absent = outgoing, unmodelled. */
      heatReceiver?: string;
    }
  | {
      kind: 'wire'; model: 'ideal-wire'; modelVersion: 1;
      id: string; label: string;
      /** Node ids. A wire MERGES them into one equipotential node. It is not a small resistor. */
      a: string; b: string;
    };

export interface CircuitDesc {
  nodes: CircuitNodeDesc[];
  components: ComponentDesc[];
}

export type ResistorDesc = Extract<ComponentDesc, { kind: 'resistor' }>;
export type SourceDesc = Extract<ComponentDesc, { kind: 'source' }>;
export type WireDesc = Extract<ComponentDesc, { kind: 'wire' }>;

export const resistorsOf = (c: CircuitDesc): ResistorDesc[] =>
  c.components.filter((x): x is ResistorDesc => x.kind === 'resistor');
export const wiresOf = (c: CircuitDesc): WireDesc[] =>
  c.components.filter((x): x is WireDesc => x.kind === 'wire');
export const sourcesOf = (c: CircuitDesc): SourceDesc[] =>
  c.components.filter((x): x is SourceDesc => x.kind === 'source');

/** The terminals a variant actually carries. Used for refusal messages and the UI. */
export function terminalsOf(x: ComponentDesc): Array<{ name: string; node: string }> {
  return x.kind === 'source'
    ? [{ name: 'pos', node: x.pos }, { name: 'neg', node: x.neg }]
    : [{ name: 'a', node: x.a }, { name: 'b', node: x.b }];
}

// ---------------------------------------------------------------------------
// VALIDATION.  REFUSE EXPLICITLY. Never insert leakage, never insert a ground,
// never drop a component, never "repair" a topology into an easier one.
// ---------------------------------------------------------------------------

const bad = (s: string): never => { throw new Error(`Circuit refused: ${s}`); };

/**
 * Structural validity of a circuit against the bodies that exist.
 *
 * `thermalBodyIds` is the set of body ids that carry explicit thermal parameters.
 * A resistor routing heat anywhere else is a DANGLING RECEIVER and is refused.
 */
export function validateCircuit(c: CircuitDesc, thermalBodyIds: ReadonlySet<string>, claimId: (id: string) => void): void {
  if (!c || typeof c !== 'object' || Array.isArray(c)) bad('expected a circuit object');
  if (!Array.isArray(c.nodes) || !Array.isArray(c.components)) bad('nodes and components must be arrays');
  if (!c.nodes.length) bad('a circuit that is present must have at least one node; remove the circuit instead');
  if (c.nodes.length > CIRCUIT_LIMITS.maxNodes) bad(`${c.nodes.length} nodes exceeds the declared limit of ${CIRCUIT_LIMITS.maxNodes}`);
  if (!c.components.length) bad('a circuit that is present must have at least one component; remove the circuit instead');
  if (c.components.length > CIRCUIT_LIMITS.maxComponents) bad(`${c.components.length} components exceeds the declared limit of ${CIRCUIT_LIMITS.maxComponents}`);

  const nodeIds = new Set<string>();
  for (const n of c.nodes) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) bad('expected a node object');
    if (typeof n.label !== 'string') bad('node label must be a string');
    claimId(n.id);
    nodeIds.add(n.id);
  }

  let sources = 0, resistors = 0, wires = 0;
  for (const x of c.components) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) bad('expected a component object');
    claimId(x.id);
    if (typeof x.label !== 'string') bad('component label must be a string');
    switch (x.kind) {
      case 'source':
        if (x.model !== 'ideal-dc-voltage' || x.modelVersion !== 1)
          bad(`unknown source model ${JSON.stringify(x.model)} v${String(x.modelVersion)} — unknown variants are refused, not guessed`);
        if (!Number.isFinite(x.voltage) || Math.abs(x.voltage) > CIRCUIT_LIMITS.maxVoltage)
          bad(`source ${x.id} voltage must be finite and |V| <= ${CIRCUIT_LIMITS.maxVoltage} V`);
        if (x.pos === x.neg) bad(`source ${x.id} has both terminals on node ${x.pos}`);
        sources++; break;
      case 'resistor':
        if (x.model !== 'linear-resistor' || x.modelVersion !== 1)
          bad(`unknown resistor model ${JSON.stringify(x.model)} v${String(x.modelVersion)} — unknown variants are refused, not guessed`);
        if (!Number.isFinite(x.resistance) || !(x.resistance > 0))
          bad(`resistor ${x.id} resistance must be finite and strictly positive`);
        if (x.resistance < CIRCUIT_LIMITS.minResistance || x.resistance > CIRCUIT_LIMITS.maxResistance)
          bad(`resistor ${x.id} resistance ${x.resistance} outside the declared range [${CIRCUIT_LIMITS.minResistance}, ${CIRCUIT_LIMITS.maxResistance}] ohm`);
        if (x.a === x.b) bad(`resistor ${x.id} is a self-loop on node ${x.a}`);
        if (x.heatReceiver !== undefined && (typeof x.heatReceiver !== 'string' || !thermalBodyIds.has(x.heatReceiver)))
          bad(`resistor ${x.id} routes heat to ${JSON.stringify(x.heatReceiver)}, which is not a body with explicit thermal parameters`);
        resistors++; break;
      case 'wire':
        if (x.model !== 'ideal-wire' || x.modelVersion !== 1)
          bad(`unknown wire model ${JSON.stringify(x.model)} v${String(x.modelVersion)} — unknown variants are refused, not guessed`);
        if (x.a === x.b) bad(`wire ${x.id} is a self-loop on node ${x.a}`);
        wires++; break;
      default:
        bad(`unknown component kind ${JSON.stringify((x as { kind?: unknown }).kind)} — this slice implements source, resistor and wire only`);
    }
    for (const t of terminalsOf(x)) {
      if (typeof t.node !== 'string' || !nodeIds.has(t.node))
        bad(`component ${x.id} terminal ${t.name} names node ${JSON.stringify(t.node)}, which is not in this circuit`);
    }
  }
  if (sources !== 1) bad(`exactly one ideal DC voltage source is supported; this circuit has ${sources}`);
  if (resistors > CIRCUIT_LIMITS.maxResistors) bad(`${resistors} resistors exceeds the declared limit of ${CIRCUIT_LIMITS.maxResistors}`);
  if (wires > CIRCUIT_LIMITS.maxWires) bad(`${wires} wires exceeds the declared limit of ${CIRCUIT_LIMITS.maxWires}`);

  // ---- DERIVED equipotential merge, for the topology refusals only. --------
  const merge = mergeNodes(c);
  const src = sourcesOf(c)[0];
  if (merge.find(src.pos) === merge.find(src.neg))
    bad(`a wire shorts the source ${src.id} across its own terminals; no current is determined and no leakage is inserted to make one`);

  for (const n of c.nodes) {
    if (!c.components.some((x) => terminalsOf(x).some((t) => t.node === n.id)))
      bad(`node ${n.id} carries no component, so its potential is not determined; it is refused rather than given an invented one`);
  }

  // Connectivity over RESISTORS AND THE SOURCE, from the reference. A branch whose
  // far node is reached through a resistor IS connected and IS accepted with zero
  // current; only a subnetwork with no such path at all is an island.
  const adj = new Map<string, string[]>();
  const link = (p: string, q: string): void => {
    adj.set(p, [...(adj.get(p) ?? []), q]);
    adj.set(q, [...(adj.get(q) ?? []), p]);
  };
  for (const x of c.components) {
    if (x.kind === 'wire') continue;
    const t = terminalsOf(x);
    link(merge.find(t[0].node), merge.find(t[1].node));
  }
  const seen = new Set<string>([merge.find(src.neg)]);
  const stack = [merge.find(src.neg)];
  while (stack.length) {
    const v = stack.pop()!;
    for (const w of adj.get(v) ?? []) if (!seen.has(w)) { seen.add(w); stack.push(w); }
  }
  for (const n of c.nodes) {
    if (!seen.has(merge.find(n.id)))
      bad(`node ${n.id} is in a floating subnetwork with no resistive path to the 0 V reference; it is refused rather than grounded or given a leakage path`);
  }
}

// ---------------------------------------------------------------------------
// DERIVED EQUIPOTENTIAL MERGE.  Union-find over WIRES ONLY.
// A wire is not a small resistor: it MERGES two nodes into one unknown.
// ---------------------------------------------------------------------------

export interface NodeMerge {
  /** The representative authored node id of the merged node containing `id`. */
  find: (id: string) => string;
  /** Representatives in DETERMINISTIC order: the authored order of their first member. */
  representatives: string[];
  /** Members of each merged node, in authored order. */
  members: (rep: string) => string[];
}

export function mergeNodes(c: CircuitDesc): NodeMerge {
  const parent = new Map<string, string>();
  for (const n of c.nodes) parent.set(n.id, n.id);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let cur = x;
    while (parent.get(cur) !== r) { const nxt = parent.get(cur)!; parent.set(cur, r); cur = nxt; }
    return r;
  };
  // Authored component order, so the union sequence is deterministic. Wire loops
  // simply collapse: a union of two nodes already merged is a no-op.
  for (const w of c.components) {
    if (w.kind !== 'wire') continue;
    const ra = find(w.a), rb = find(w.b);
    if (ra !== rb) parent.set(rb, ra);
  }
  const reps: string[] = [];
  const seen = new Set<string>();
  const byRep = new Map<string, string[]>();
  for (const n of c.nodes) {
    const r = find(n.id);
    if (!seen.has(r)) { seen.add(r); reps.push(r); }
    byRep.set(r, [...(byRep.get(r) ?? []), n.id]);
  }
  return { find, representatives: reps, members: (rep) => byRep.get(rep) ?? [] };
}

// ---------------------------------------------------------------------------
// SOLVE.  Algebraic, done ONCE for a static authored topology and cached.
// ---------------------------------------------------------------------------

export interface ResistorSolution {
  id: string;
  /** V. Va - Vb, with the AUTHORED terminal orientation. */
  voltage: number;
  /** A. POSITIVE FROM A TO B. */
  current: number;
  /** W. V*I = V^2/R. NON-NEGATIVE — passive dissipation, never signed backflow. */
  power: number;
}

export interface CircuitSolution {
  /** V, per MERGED node representative, in deterministic order. */
  nodeVoltages: Array<{ rep: string; members: string[]; voltage: number }>;
  resistors: ResistorSolution[];
  /** A, positive OUT OF the source's positive terminal into the network. */
  sourceCurrent: number;
  /** W, positive when the ideal EXTERNAL source delivers energy to the network. */
  sourceDeliveredPower: number;
  /** W. Sum of resistor powers. Assembled here for display; the tests assemble their own. */
  resistorPowerTotal: number;
}

export interface CircuitSolveOk { ok: true; solution: CircuitSolution; }
export interface CircuitSolveRejected { ok: false; reason: string; }
export type CircuitSolveResult = CircuitSolveOk | CircuitSolveRejected;

/** V at an authored node id, from a solution. */
export function voltageAt(sol: CircuitSolution, merge: NodeMerge, nodeId: string): number {
  const rep = merge.find(nodeId);
  const row = sol.nodeVoltages.find((r) => r.rep === rep);
  if (!row) throw new Error(`No solved potential for node ${nodeId}`);
  return row.voltage;
}

/**
 * Solve the static DC network. The circuit must already have passed
 * `validateCircuit`; this function's own refusals are the NUMERICAL ones.
 *
 * A REJECTED result is REJECTED: the caller accumulates nothing and NEVER reuses a
 * previous good solution.
 */
export function solveCircuit(c: CircuitDesc): CircuitSolveResult {
  const merge = mergeNodes(c);
  const src = sourcesOf(c)[0];
  const resistors = resistorsOf(c);
  const posRep = merge.find(src.pos), negRep = merge.find(src.neg);

  // Fixed potentials: the source's own two merged nodes. The NEGATIVE node is 0 V.
  const V = new Map<string, number>([[negRep, 0], [posRep, src.voltage]]);
  const free = merge.representatives.filter((r) => r !== posRep && r !== negRep);
  const index = new Map(free.map((r, i) => [r, i]));

  // Grounded nodal conductance system over the FREE merged nodes.
  const n = free.length;
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const rhs = new Array<number>(n).fill(0);
  for (const r of resistors) {
    const g = 1 / r.resistance;
    const ra = merge.find(r.a), rb = merge.find(r.b);
    if (ra === rb) continue;   // shorted by a wire: it carries exactly zero current
    const ia = index.get(ra), ib = index.get(rb);
    if (ia !== undefined) A[ia][ia] += g;
    if (ib !== undefined) A[ib][ib] += g;
    if (ia !== undefined && ib !== undefined) { A[ia][ib] -= g; A[ib][ia] -= g; }
    if (ia !== undefined && ib === undefined) rhs[ia] += g * V.get(rb)!;
    if (ib !== undefined && ia === undefined) rhs[ib] += g * V.get(ra)!;
  }

  const x = gauss(A, rhs);
  if (!x) return { ok: false, reason: 'the nodal system is singular at the authored topology; the electrical result is rejected and no previous solution is reused' };
  free.forEach((r, i) => V.set(r, x[i]));

  for (const [rep, v] of V) {
    if (!Number.isFinite(v)) return { ok: false, reason: `node potential at ${rep} is not finite; the electrical result is rejected and no previous solution is reused` };
  }

  const sols: ResistorSolution[] = resistors.map((r) => {
    const va = V.get(merge.find(r.a))!, vb = V.get(merge.find(r.b))!;
    const voltage = va - vb;
    const current = voltage / r.resistance;
    const power = voltage * current;
    return { id: r.id, voltage, current, power };
  });
  for (const s of sols) {
    if (!Number.isFinite(s.voltage) || !Number.isFinite(s.current) || !Number.isFinite(s.power))
      return { ok: false, reason: `resistor ${s.id} has a non-finite solution; the electrical result is rejected and no previous solution is reused` };
    // PASSIVE RESISTOR POWER IS NON-NEGATIVE. This is NOT the damper's signed
    // numerical-backflow case: negative Joule heat is not physical, so it rejects.
    if (s.power < 0)
      return { ok: false, reason: `resistor ${s.id} reports negative dissipated power ${s.power} W; passive resistor power is non-negative, so the electrical result is rejected rather than booked as backflow` };
  }

  // Source current, by KCL at the source's POSITIVE merged node: everything the
  // resistors take out of it must come in through the source.
  let sourceCurrent = 0;
  resistors.forEach((r, i) => {
    const ra = merge.find(r.a), rb = merge.find(r.b);
    if (ra === rb) return;
    if (ra === posRep) sourceCurrent += sols[i].current;
    if (rb === posRep) sourceCurrent -= sols[i].current;
  });
  const sourceDeliveredPower = src.voltage * sourceCurrent;
  const resistorPowerTotal = sols.reduce((a, s) => a + s.power, 0);

  // ---- THE FROZEN, SCALE-AWARE ACCEPTANCE CHECK. -------------------------
  for (const rep of free) {
    let net = 0, scale = 0;
    resistors.forEach((r, i) => {
      const ra = merge.find(r.a), rb = merge.find(r.b);
      if (ra === rb) return;
      if (ra === rep) { net -= sols[i].current; scale += Math.abs(sols[i].current); }
      if (rb === rep) { net += sols[i].current; scale += Math.abs(sols[i].current); }
    });
    if (Math.abs(net) > Math.max(CIRCUIT_TOL.kclAbs, CIRCUIT_TOL.kclRel * scale))
      return { ok: false, reason: `KCL residual ${net} A at merged node ${rep} exceeds max(${CIRCUIT_TOL.kclAbs} A, ${CIRCUIT_TOL.kclRel} x ${scale} A); the electrical result is rejected and no previous solution is reused` };
  }
  const pScale = Math.max(Math.abs(sourceDeliveredPower), Math.abs(resistorPowerTotal));
  if (Math.abs(sourceDeliveredPower - resistorPowerTotal) > Math.max(CIRCUIT_TOL.powerAbs, CIRCUIT_TOL.powerRel * pScale))
    return { ok: false, reason: `source delivered power ${sourceDeliveredPower} W does not match the resistor total ${resistorPowerTotal} W within max(${CIRCUIT_TOL.powerAbs} W, ${CIRCUIT_TOL.powerRel} x ${pScale} W); the electrical result is rejected and no previous solution is reused` };
  if (!Number.isFinite(sourceCurrent) || !Number.isFinite(sourceDeliveredPower))
    return { ok: false, reason: 'the source solution is not finite; the electrical result is rejected and no previous solution is reused' };

  return {
    ok: true,
    solution: {
      nodeVoltages: merge.representatives.map((rep) => ({ rep, members: merge.members(rep), voltage: V.get(rep)! })),
      resistors: sols, sourceCurrent, sourceDeliveredPower, resistorPowerTotal,
    },
  };
}

/** Dense Gaussian elimination with partial pivoting. Returns null if singular. */
function gauss(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  if (n === 0) return [];
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (!(Math.abs(M[piv][col]) > 0)) return null;
    if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
    if (!Number.isFinite(x[r])) return null;
  }
  return x;
}

// ---------------------------------------------------------------------------
// RUNTIME STATE.  Cumulative accounts. NEVER part of an authored document.
// ---------------------------------------------------------------------------

export interface ElectricalState {
  /**
   * J. Cumulative energy supplied FROM AN IDEAL EXTERNAL SOURCE across the system
   * boundary. THE SOURCE HAS NO FINITE STORAGE: this is never energy created
   * inside the world, and it is never a battery charge that depletes.
   */
  suppliedEnergy: number;
  /** J. Cumulative dissipation per resistor, in authored order. */
  resistors: Array<{ id: string; energy: number }>;
  /** J. Cumulative heat routed to a receiver, keyed by COMPONENT id — its own array, distinct from the damper ledger. */
  routed: Array<{ componentId: string; heat: number }>;
  /** J. Cumulative dissipation of resistors with NO receiver: explicitly OUTGOING and unmodelled. */
  unroutedEnergy: number;
  /** Public ticks over which the accounts above were accumulated. */
  ticks: number;
  /** The solve acceptance state. A rejected circuit accumulates NOTHING. */
  rejected: string | null;
}

export const newElectricalState = (c: CircuitDesc | undefined, rejected: string | null = null): ElectricalState => ({
  suppliedEnergy: 0,
  resistors: c ? resistorsOf(c).map((r) => ({ id: r.id, energy: 0 })) : [],
  routed: [], unroutedEnergy: 0, ticks: 0, rejected,
});

export const totalResistorEnergy = (e: ElectricalState): number => e.resistors.reduce((a, r) => a + r.energy, 0);
export const totalElectricalRouted = (e: ElectricalState): number => e.routed.reduce((a, r) => a + r.heat, 0);

/**
 * ONE PUBLIC TICK of Joule accumulation: P * SI.DT, exactly once, independent of
 * the internal sub-step count and of the display rate. Returns the per-resistor
 * energies routed this tick so the caller can hand them to the thermal receivers.
 */
export function accumulateTick(
  state: ElectricalState, c: CircuitDesc, sol: CircuitSolution,
): Array<{ componentId: string; receiver: string | undefined; heat: number }> {
  const out: Array<{ componentId: string; receiver: string | undefined; heat: number }> = [];
  state.suppliedEnergy += sol.sourceDeliveredPower * SI.DT;
  const byId = new Map(resistorsOf(c).map((r) => [r.id, r]));
  for (const rs of sol.resistors) {
    const q = rs.power * SI.DT;
    const acc = state.resistors.find((x) => x.id === rs.id);
    if (!acc) throw new Error(`Electrical accumulator has no row for resistor ${rs.id}`);
    acc.energy += q;
    const receiver = byId.get(rs.id)?.heatReceiver;
    if (receiver === undefined) state.unroutedEnergy += q;
    else {
      let led = state.routed.find((x) => x.componentId === rs.id);
      if (!led) { led = { componentId: rs.id, heat: 0 }; state.routed.push(led); }
      led.heat += q;
    }
    out.push({ componentId: rs.id, receiver, heat: q });
  }
  state.ticks++;
  return out;
}

/** Checkpointed electrical state cannot silently reset a heated circuit. */
export function validateElectricalCheckpoint(c: CircuitDesc | undefined, state: ElectricalState | undefined): void {
  if (!state) {
    if (c) throw new Error('Electrical checkpoint is missing evolved state');
    return;
  }
  if (!c) throw new Error('Electrical checkpoint carries state for a construction with no circuit');
  const ids = resistorsOf(c).map((r) => r.id);
  if (!Array.isArray(state.resistors) || !Array.isArray(state.routed)
    || !Number.isFinite(state.suppliedEnergy) || !Number.isFinite(state.unroutedEnergy)
    || !Number.isSafeInteger(state.ticks) || state.ticks < 0
    || (state.rejected !== null && typeof state.rejected !== 'string')
    || JSON.stringify(state.resistors.map((r) => r.id)) !== JSON.stringify(ids)
    || state.resistors.some((r) => !Number.isFinite(r.energy))
    || state.routed.some((r) => typeof r.componentId !== 'string' || !ids.includes(r.componentId) || !Number.isFinite(r.heat))
    || new Set(state.routed.map((r) => r.componentId)).size !== state.routed.length)
    throw new Error('Malformed electrical checkpoint');
}
