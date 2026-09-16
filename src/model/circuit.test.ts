/**
 * BATCH 4 STAGE 2 — INDEPENDENT ELECTRICAL WITNESSES. Against
 * BATCH4-ELECTRONICS-ACCEPTANCE-v1 §4 and ELECTRICAL-DECLARATION.md §7.
 *
 * ===========================================================================
 * THE REFERENCES HERE ARE INDEPENDENT OF THE SOLVER.
 * ===========================================================================
 * The expected currents, voltages and powers are the ANALYTIC values written in
 * the frozen acceptance document, typed in by hand.
 *
 * The conservation checks are ASSEMBLED HERE, from the AUTHORED GRAPH and the
 * RETURNED NODE VOLTAGES, with this file's OWN equipotential merge. **The
 * solver's own residual check is never called as the reference** — that would be
 * the accounting checking itself. Two mutants are EXECUTED to show these
 * assertions actually bite.
 */
import { expect, test } from 'vitest';
import {
  CIRCUIT_LIMITS, mergeNodes, solveCircuit, validateCircuit,
  type CircuitDesc, type CircuitSolution, type ComponentDesc,
} from './circuit';

// ---------------------------------------------------------------------------
// Fixtures. Declared in ELECTRICAL-DECLARATION.md §7 before any of this ran.
// ---------------------------------------------------------------------------
const node = (id: string) => ({ id, label: id });
const src = (id: string, pos: string, neg: string, voltage: number): ComponentDesc =>
  ({ kind: 'source', model: 'ideal-dc-voltage', modelVersion: 1, id, label: id, pos, neg, voltage });
const res = (id: string, a: string, b: string, resistance: number, heatReceiver?: string): ComponentDesc =>
  ({ kind: 'resistor', model: 'linear-resistor', modelVersion: 1, id, label: id, a, b, resistance, ...(heatReceiver ? { heatReceiver } : {}) });
const wire = (id: string, a: string, b: string): ComponentDesc =>
  ({ kind: 'wire', model: 'ideal-wire', modelVersion: 1, id, label: id, a, b });
const circuit = (nodes: string[], components: ComponentDesc[]): CircuitDesc =>
  ({ nodes: nodes.map(node), components });

/** A fresh id claimer, the same shape the authored validator supplies. */
const claimer = () => { const seen = new Set<string>(); return (id: string) => {
  if (typeof id !== 'string' || !id.length || !/^[A-Za-z0-9_.:-]+$/.test(id) || seen.has(id)) throw new Error('Empty or duplicate ID');
  seen.add(id); }; };
const check = (c: CircuitDesc, thermal: string[] = []) => validateCircuit(c, new Set(thermal), claimer());
const solved = (c: CircuitDesc): CircuitSolution => {
  check(c);
  const r = solveCircuit(c);
  if (!r.ok) throw new Error(`unexpectedly rejected: ${r.reason}`);
  return r.solution;
};

/** max(1e-10 absolute in the relevant SI unit, 1e-9 relative), per §4. */
const near = (got: number, want: number, what: string): void => {
  const tol = Math.max(1e-10, 1e-9 * Math.abs(want));
  expect(Math.abs(got - want), `${what}: got ${got}, want ${want}, tol ${tol}`).toBeLessThanOrEqual(tol);
};

// ---------------------------------------------------------------------------
// THIS FILE'S OWN equipotential merge and conservation laws.
// ---------------------------------------------------------------------------
function ownMerge(c: CircuitDesc): (id: string) => string {
  const p = new Map(c.nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => { let r = x; while (p.get(r) !== r) r = p.get(r)!; return r; };
  for (const w of c.components) if (w.kind === 'wire') { const a = find(w.a), b = find(w.b); if (a !== b) p.set(b, a); }
  return find;
}

/**
 * KCL and the power balance, assembled HERE from the authored graph and the
 * returned node voltages. Resistor currents are RECOMPUTED from Ohm's law rather
 * than read out of the solution, and the source current is derived from KCL at
 * the reference node, so nothing the solver computed is trusted as its own check.
 */
function independentChecks(c: CircuitDesc, sol: CircuitSolution): { sourceCurrent: number; resistorPower: number } {
  const find = ownMerge(c);
  const source = c.components.find((x) => x.kind === 'source')! as Extract<ComponentDesc, { kind: 'source' }>;
  const V = (id: string): number => {
    const row = sol.nodeVoltages.find((r) => r.rep === find(id) || r.members.includes(id));
    if (!row) throw new Error(`no returned potential for ${id}`);
    return row.voltage;
  };
  // The source's own terminals must sit at the declared reference and the declared EMF.
  near(V(source.neg), 0, 'reference node is 0 V');
  near(V(source.pos) - V(source.neg), source.voltage, 'source EMF across its own terminals');

  const branches = c.components.filter((x) => x.kind === 'resistor').map((r) => {
    const rr = r as Extract<ComponentDesc, { kind: 'resistor' }>;
    const v = V(rr.a) - V(rr.b);
    return { id: rr.id, a: find(rr.a), b: find(rr.b), i: v / rr.resistance, p: (v * v) / rr.resistance };
  });

  // Source current, from KCL at the source's POSITIVE merged node.
  const posRep = find(source.pos);
  let sourceCurrent = 0;
  for (const br of branches) { if (br.a === posRep) sourceCurrent += br.i; if (br.b === posRep) sourceCurrent -= br.i; }

  // KCL at every OTHER merged node must be exactly balanced by the source injection.
  for (const rep of new Set(c.nodes.map((n) => find(n.id)))) {
    if (rep === posRep) continue;
    let net = 0, scale = 0;
    for (const br of branches) { if (br.a === rep) { net += br.i; scale += Math.abs(br.i); } if (br.b === rep) { net -= br.i; scale += Math.abs(br.i); } }
    const inject = rep === find(source.neg) ? -sourceCurrent : 0;
    expect(Math.abs(net - inject), `independent KCL at ${rep}`).toBeLessThanOrEqual(Math.max(1e-10, 1e-9 * Math.max(scale, Math.abs(sourceCurrent))));
  }

  // Source power = sum of resistor powers, both assembled here.
  const resistorPower = branches.reduce((a, b) => a + b.p, 0);
  near(source.voltage * sourceCurrent, resistorPower, 'independent source power vs sum of resistor powers');
  for (const br of branches) expect(br.p, `independent power of ${br.id} is non-negative`).toBeGreaterThanOrEqual(0);
  return { sourceCurrent, resistorPower };
}

const R = (sol: CircuitSolution, id: string) => sol.resistors.find((r) => r.id === id)!;

// ===========================================================================
// §4 — THE FIVE ANALYTIC WITNESSES
// ===========================================================================
test('E1 single resistor 10 V, 10 ohm -> I = 1 A, P = 10 W', () => {
  const c = circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10)]);
  const s = solved(c);
  near(R(s, 'R1').current, 1, 'R1 current');
  near(R(s, 'R1').power, 10, 'R1 power');
  near(R(s, 'R1').voltage, 10, 'R1 voltage');
  const ind = independentChecks(c, s);
  near(ind.sourceCurrent, 1, 'independent source current');
  near(ind.resistorPower, 10, 'independent resistor power total');
  near(s.sourceDeliveredPower, 10, 'reported source delivered power');
  console.log('E1', { I: R(s, 'R1').current, P: R(s, 'R1').power, Isrc: ind.sourceCurrent });
});

test('E2 series 10 + 20 ohm at 12 V -> I = 0.4 A, drops 4 / 8 V, powers 1.6 / 3.2 W', () => {
  const c = circuit(['n0', 'n1', 'n2'], [src('V1', 'n1', 'n0', 12), res('R1', 'n1', 'n2', 10), res('R2', 'n2', 'n0', 20)]);
  const s = solved(c);
  near(R(s, 'R1').current, 0.4, 'R1 current'); near(R(s, 'R2').current, 0.4, 'R2 current');
  near(R(s, 'R1').voltage, 4, 'R1 drop'); near(R(s, 'R2').voltage, 8, 'R2 drop');
  near(R(s, 'R1').power, 1.6, 'R1 power'); near(R(s, 'R2').power, 3.2, 'R2 power');
  const ind = independentChecks(c, s);
  near(ind.sourceCurrent, 0.4, 'independent source current');
  near(ind.resistorPower, 4.8, 'independent resistor power total');
  console.log('E2', { I: R(s, 'R1').current, v1: R(s, 'R1').voltage, v2: R(s, 'R2').voltage });
});

test('E3 parallel 10 || 20 at 12 V -> 1.2 / 0.6 A, total 1.8 A, powers 14.4 / 7.2 W', () => {
  const c = circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 12), res('R1', 'n1', 'n0', 10), res('R2', 'n1', 'n0', 20)]);
  const s = solved(c);
  near(R(s, 'R1').current, 1.2, 'R1 current'); near(R(s, 'R2').current, 0.6, 'R2 current');
  near(R(s, 'R1').power, 14.4, 'R1 power'); near(R(s, 'R2').power, 7.2, 'R2 power');
  const ind = independentChecks(c, s);
  near(ind.sourceCurrent, 1.8, 'independent total source current');
  near(ind.resistorPower, 21.6, 'independent resistor power total');
  console.log('E3', { i1: R(s, 'R1').current, i2: R(s, 'R2').current, Isrc: ind.sourceCurrent });
});

test('E4 loaded divider Rtop 10, Rbottom 20, load 20 across the bottom, 12 V -> output 6 V, source 0.6 A', () => {
  const c = circuit(['n0', 'n1', 'n2'], [
    src('V1', 'n1', 'n0', 12), res('Rtop', 'n1', 'n2', 10), res('Rbot', 'n2', 'n0', 20), res('Rload', 'n2', 'n0', 20)]);
  const s = solved(c);
  const out = s.nodeVoltages.find((r) => r.members.includes('n2'))!.voltage;
  near(out, 6, 'divider output at n2');
  const ind = independentChecks(c, s);
  near(ind.sourceCurrent, 0.6, 'independent source current');
  near(R(s, 'Rtop').current, 0.6, 'Rtop current');
  near(R(s, 'Rbot').current, 0.3, 'Rbot current'); near(R(s, 'Rload').current, 0.3, 'Rload current');
  console.log('E4', { out, Isrc: ind.sourceCurrent });
});

test('E5a a wire-equivalent topology gives the identical solution: wires MERGE nodes, they are not tiny resistors', () => {
  const direct = circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10)]);
  const wired = circuit(['n0', 'n1', 'n2', 'n3'], [
    src('V1', 'n1', 'n0', 10), wire('W1', 'n1', 'n2'), wire('W2', 'n0', 'n3'), res('R1', 'n2', 'n3', 10)]);
  const a = solved(direct), b = solved(wired);
  expect(R(b, 'R1').current).toBe(R(a, 'R1').current);
  expect(R(b, 'R1').voltage).toBe(R(a, 'R1').voltage);
  expect(R(b, 'R1').power).toBe(R(a, 'R1').power);
  expect(b.sourceCurrent).toBe(a.sourceCurrent);
  // The merge is DERIVED; the authored graph still holds all four nodes and both wires.
  expect(wired.nodes.length).toBe(4);
  expect(wired.components.filter((x) => x.kind === 'wire').length).toBe(2);
  expect(mergeNodes(wired).representatives.length).toBe(2);
  // NO PER-WIRE CURRENT IS DETERMINED OR REPORTED: the solution names resistors only.
  expect(b.resistors.map((r) => r.id)).toEqual(['R1']);
  independentChecks(wired, b);
  // A wire LOOP collapses harmlessly.
  const looped = circuit(['n0', 'n1', 'n2'], [src('V1', 'n1', 'n0', 10), wire('W1', 'n1', 'n2'), wire('W2', 'n2', 'n1'), res('R1', 'n2', 'n0', 10)]);
  near(R(solved(looped), 'R1').current, 1, 'wire-loop current');
  console.log('E5a wire-merged solution is bit-identical to the direct one; 4 authored nodes -> 2 merged');
});

test('E5b reversed source polarity: every current FLIPS, every resistor heat does NOT', () => {
  const fwd = circuit(['n0', 'n1', 'n2'], [src('V1', 'n1', 'n0', 12), res('R1', 'n1', 'n2', 10), res('R2', 'n2', 'n0', 20)]);
  const rev = circuit(['n0', 'n1', 'n2'], [src('V1', 'n0', 'n1', 12), res('R1', 'n1', 'n2', 10), res('R2', 'n2', 'n0', 20)]);
  const a = solved(fwd), b = solved(rev);
  for (const id of ['R1', 'R2']) {
    near(R(b, id).current, -R(a, id).current, `${id} current flips`);
    near(R(b, id).power, R(a, id).power, `${id} power unchanged`);
    expect(R(b, id).power, `${id} power stays non-negative`).toBeGreaterThan(0);
  }
  independentChecks(rev, b);
  console.log('E5b', { fwd: R(a, 'R1').current, rev: R(b, 'R1').current, powerFwd: R(a, 'R1').power, powerRev: R(b, 'R1').power });
});

test('E5c zero voltage gives zero current and zero power; a connected open-ended branch carries exactly zero current', () => {
  const zero = circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 0), res('R1', 'n1', 'n0', 10)]);
  const z = solved(zero);
  expect(R(z, 'R1').current).toBe(0); expect(R(z, 'R1').power).toBe(0); expect(z.sourceDeliveredPower).toBe(0);
  independentChecks(zero, z);
  // A DANGLING BRANCH attached to a defined-potential node is NOT an ungrounded island.
  const open = circuit(['n0', 'n1', 'n2'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10), res('Rstub', 'n1', 'n2', 25)]);
  const o = solved(open);
  expect(R(o, 'Rstub').current).toBe(0); expect(R(o, 'Rstub').power).toBe(0);
  near(R(o, 'R1').current, 1, 'the live branch is unaffected by the stub');
  near(o.sourceCurrent, 1, 'source current is unaffected by the stub');
  independentChecks(open, o);
  console.log('E5c zero-volt run and open-ended stub both give exactly 0 A / 0 W, and the stub is accepted, not refused');
});

// ===========================================================================
// §4 — THE MUTANTS. These are EXECUTED, and the assertion that catches each is named.
// ===========================================================================
test('E6 wrong-CONNECTIVITY mutant is caught: by the analytic value, and by the INDEPENDENTLY assembled KCL', () => {
  const good = circuit(['n0', 'n1', 'n2'], [src('V1', 'n1', 'n0', 12), res('R1', 'n1', 'n2', 10), res('R2', 'n2', 'n0', 20)]);
  const s = solved(good);
  near(R(s, 'R1').current, 0.4, 'baseline series current');

  // (a) REWIRE the graph: R2 moved from n2->n0 to n1->n0, making a parallel pair.
  const mutant = circuit(['n0', 'n1', 'n2'], [src('V1', 'n1', 'n0', 12), res('R1', 'n1', 'n2', 10), res('R2', 'n1', 'n0', 20)]);
  // n2 now dangles through R1: still connected, still solvable, but NOT the series answer.
  const m = solved(mutant);
  expect(() => near(R(m, 'R1').current, 0.4, 'series current')).toThrow();
  console.log('E6a rewired connectivity: R1 current became', R(m, 'R1').current, 'A and the 0.4 A assertion FAILED as required');

  // (b) Hand the INDEPENDENT checker the mutated graph with the CORRECT voltages.
  //     Its own KCL assembly must reject the pair.
  expect(() => independentChecks(mutant, s)).toThrow();
  console.log('E6b independent KCL/power assembly REJECTED correct voltages against rewired connectivity, as required');
});

test('E7 wrong-RESISTANCE mutant: the RETAINED failing one-resistor case, and the DISCRIMINATING case that catches it', () => {
  // ---- THE ORIGINAL PREDICTION, RETAINED. -------------------------------
  // Predicted: "a wrong-resistance mutant is caught by the independently assembled
  // power balance", probed on a ONE-RESISTOR loop. IT WAS NOT CAUGHT, and the
  // reason is a property of that FIXTURE, not of the implementation: with a single
  // branch, KCL DERIVES the source current FROM that same branch, so
  //     V_src * I_src  ==  V_src * (V_src/R)  ==  V_src^2/R  ==  P_R
  // holds IDENTICALLY for every R. Evidence independent of the failing assertion:
  // the balance stays exactly satisfied over a whole FAMILY of wrong resistances
  // (x0.1, x0.5, x2, x2.5, x7, x1000), which no single failing output could show.
  // The original outcome is preserved below as an ASSERTED degeneracy, not deleted.
  const oneLoop = circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10)]);
  const sOne = solved(oneLoop);
  near(R(sOne, 'R1').power, 10, 'baseline power');
  for (const k of [0.1, 0.5, 2, 2.5, 7, 1000]) {
    const m = circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10 * k)]);
    // RETAINED RESULT: the independent balance does NOT reject this. Degenerate topology.
    expect(() => independentChecks(m, sOne), `one-resistor loop, R x${k}`).not.toThrow();
    // The solved network is of course a different network, and THAT is detectable.
    expect(() => near(R(solved(m), 'R1').current, 1, 'current at the authored resistance')).toThrow();
  }
  console.log('E7a RETAINED: on a one-resistor loop the independent power balance is DEGENERATE — '
    + 'it accepts every wrong resistance in x0.1..x1000, because I_src is derived from that same branch');

  // ---- THE DISCRIMINATING CASE. ------------------------------------------
  // A topology in which the mutated resistance participates in a NODE constraint.
  // Here KCL at the middle node is no longer satisfiable by the correct voltages.
  const series = circuit(['n0', 'n1', 'n2'], [src('V1', 'n1', 'n0', 12), res('R1', 'n1', 'n2', 10), res('R2', 'n2', 'n0', 20)]);
  const sSeries = solved(series);
  near(R(sSeries, 'R1').current, 0.4, 'baseline series current');
  for (const k of [0.5, 2, 2.5]) {
    const m = circuit(['n0', 'n1', 'n2'], [src('V1', 'n1', 'n0', 12), res('R1', 'n1', 'n2', 10), res('R2', 'n2', 'n0', 20 * k)]);
    expect(() => independentChecks(m, sSeries), `series divider, R2 x${k}`).toThrow();
  }
  // Control on the control: the UNMUTATED graph passes the same assembly.
  expect(() => independentChecks(series, sSeries)).not.toThrow();
  console.log('E7b DISCRIMINATING: the same mutation on a constrained topology is REJECTED by the '
    + 'independently assembled KCL/power balance at x0.5, x2 and x2.5, and the unmutated control passes');
});

// ===========================================================================
// §2 — THE INVALID-GRAPH CONTROLS. Every one is EXECUTED.
// ===========================================================================
test('E8 invalid graphs are REFUSED explicitly — never grounded, never repaired, never silently dropped', () => {
  const rows: Array<[string, () => void]> = [
    ['wire shorts the source across its own terminals', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), wire('W1', 'n1', 'n0'), res('R1', 'n1', 'n0', 10)]))],
    ['floating subnetwork with no path to the reference', () => check(circuit(['n0', 'n1', 'n2', 'n3'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10), res('R2', 'n2', 'n3', 5)]))],
    ['node carrying no component at all', () => check(circuit(['n0', 'n1', 'n9'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10)]))],
    ['dangling terminal naming an absent node', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'nX', 10)]))],
    ['dangling heat receiver', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10, 'nobody')]))],
    ['duplicate id between a node and a component', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('n1', 'n1', 'n0', 10)]))],
    ['duplicate id between two components', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 20)]))],
    ['no source', () => check(circuit(['n0', 'n1'], [res('R1', 'n1', 'n0', 10)]))],
    ['two sources', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), src('V2', 'n1', 'n0', 5), res('R1', 'n1', 'n0', 10)]))],
    ['zero resistance', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 0)]))],
    ['negative resistance', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', -10)]))],
    ['non-finite resistance', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', NaN)]))],
    ['resistance above the declared range', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', CIRCUIT_LIMITS.maxResistance * 10)]))],
    ['resistance below the declared range', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', CIRCUIT_LIMITS.minResistance / 10)]))],
    ['non-finite source voltage', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', Infinity), res('R1', 'n1', 'n0', 10)]))],
    ['source voltage above the declared range', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', CIRCUIT_LIMITS.maxVoltage * 10), res('R1', 'n1', 'n0', 10)]))],
    ['resistor self-loop', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n1', 10)]))],
    ['source with both terminals on one node', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n1', 10), res('R1', 'n1', 'n0', 10)]))],
    ['wire self-loop', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), wire('W1', 'n1', 'n1'), res('R1', 'n1', 'n0', 10)]))],
    ['unknown component kind', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), { kind: 'capacitor', model: 'ideal-cap', modelVersion: 1, id: 'C1', label: 'C1', a: 'n1', b: 'n0', capacitance: 1 } as unknown as ComponentDesc]))],
    ['unknown resistor model', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), { ...(res('R1', 'n1', 'n0', 10) as Record<string, unknown>), model: 'thermistor' } as unknown as ComponentDesc]))],
    ['unknown model version', () => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), { ...(res('R1', 'n1', 'n0', 10) as Record<string, unknown>), modelVersion: 2 } as unknown as ComponentDesc]))],
    ['circuit present with no nodes', () => check(circuit([], [src('V1', 'n1', 'n0', 10)]))],
    ['circuit present with no components', () => check(circuit(['n0'], []))],
    ['more nodes than the declared limit', () => check(circuit(Array.from({ length: CIRCUIT_LIMITS.maxNodes + 1 }, (_, i) => `n${i}`), [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10)]))],
  ];
  for (const [name, run] of rows) expect(run, name).toThrow(/Circuit refused|duplicate ID/);
  // And the CONTROLS ON THE CONTROLS: each near-miss valid graph is accepted.
  expect(() => check(circuit(['n0', 'n1', 'n2'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10), res('Rstub', 'n1', 'n2', 5)]))).not.toThrow();
  expect(() => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 0), res('R1', 'n1', 'n0', 10)]))).not.toThrow();
  expect(() => check(circuit(['n0', 'n1'], [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10, 'housing')], ), ['housing'])).not.toThrow();
  console.log('E8 invalid-graph controls EXECUTED:', rows.length, 'of', rows.length, 'refused; 3 near-miss valid graphs accepted');
});

test('E9 a resistor shorted by a wire is determinate at exactly zero current, and the source still solves', () => {
  const c = circuit(['n0', 'n1', 'n2'], [
    src('V1', 'n1', 'n0', 10), res('Rshorted', 'n1', 'n2', 10), wire('W1', 'n1', 'n2'), res('R2', 'n2', 'n0', 5)]);
  const s = solved(c);
  expect(R(s, 'Rshorted').current).toBe(0);
  expect(R(s, 'Rshorted').power).toBe(0);
  near(R(s, 'R2').current, 2, 'the un-shorted resistor still carries V/R');
  independentChecks(c, s);
  console.log('E9 wire-shorted resistor: exactly 0 A, 0 W; R2 carries', R(s, 'R2').current, 'A');
});
