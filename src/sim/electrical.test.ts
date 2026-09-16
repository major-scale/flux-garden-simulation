/**
 * BATCH 4 STAGE 3 — THE INDEPENDENT COUPLED WITNESSES. Against
 * BATCH4-ELECTRONICS-ACCEPTANCE-v1 §5, §6, §7 and ELECTRICAL-DECLARATION.md.
 *
 * Every reference here is an INDEPENDENTLY COMPUTED P*t from the analytic power,
 * never the ledger that fills Q. The extended-system balance is the SEPARATELY
 * DERIVED one, not resistor Q bolted onto the old damper-only remainder.
 */
import { beforeAll, expect, test } from 'vitest';
import { SimWorld, canonicalSimState } from './world';
import type { Construction } from '../model/construction';
import type { ComponentDesc } from '../model/circuit';
import { totalElectricalRouted, totalResistorEnergy } from '../model/circuit';
import {
  assertThermalRouting, extendedSystemBalance, routeResistorHeat, temperature, totalDamperRouted,
  totalHeat, totalResistorRouted, totalRouted,
} from '../model/thermal';
import { AuthoringSession, canonical, copy, deleteBody, deleteCircuitNode, loadAuthored, requireRecordingBase, saveAuthored, validateAuthored } from '../model/authoring';
import { captureRun, differences } from '../model/comparison';
import { Meter, quantity } from '../model/measure';
import { Recorder, replay, restoreCheckpoint, takeCheckpoint, type InputRecord } from './record';
import { SI } from '../model/units';

/**
 * The DECLARED THERMAL OSCILLATOR of THERMAL-DECLARATION.md, restated here rather
 * than imported from `thermal.test.ts` — importing a test module would re-run its
 * suite inside this file and double-count it.
 */
function damperFixture(M = 4, damping = .4, thermal = true): Construction {
  return { format: 'fp1-construction', formatVersion: 1, name: 'Declared thermal oscillator', nextSerial: 2,
    numerics: { substeps: M }, environment: { medium: 'vacuum', gravity: { x: 0, y: 0, z: 0 } },
    entities: [{ id: 'housing', label: 'Damper housing', kinematics: 'dynamic', shape: { kind: 'sphere', radius: .1 },
      material: { mass: 1, friction: 0, restitution: 0 }, translation: { x: 1.2, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 },
      colour: 0xffaa22, ...(thermal ? { thermal: { heatCapacity: 2, initialTemperature: 300 } } : {}) }],
    springs: [{ id: 'damper', a: { kind: 'world', point: { x: 0, y: 0, z: 0 } },
      b: { kind: 'body', entityId: 'housing', localPoint: { x: 0, y: 0, z: 0 } },
      restLength: 1, stiffness: 4, damping, ...(thermal ? { heatReceiver: 'housing' } : {}) }] };
}

beforeAll(async () => { await SimWorld.initEngine(); });

const src = (id: string, pos: string, neg: string, voltage: number): ComponentDesc =>
  ({ kind: 'source', model: 'ideal-dc-voltage', modelVersion: 1, id, label: id, pos, neg, voltage });
const res = (id: string, a: string, b: string, resistance: number, heatReceiver?: string): ComponentDesc =>
  ({ kind: 'resistor', model: 'linear-resistor', modelVersion: 1, id, label: id, a, b, resistance, ...(heatReceiver ? { heatReceiver } : {}) });

/** A receiver body with NO mechanics at all: fixed, vacuum, zero gravity, no springs. */
const receiver = (id: string, C = 2, T0 = 300, x = 0) => ({
  id, label: id, kinematics: 'fixed' as const, shape: { kind: 'sphere' as const, radius: 0.1 },
  material: { mass: 0, friction: 0, restitution: 0 },
  translation: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
  linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 }, colour: 0x88aacc,
  thermal: { heatCapacity: C, initialTemperature: T0 },
});

/** THE DECLARED COUPLED FIXTURE: 10 V, 10 ohm, C = 2 J/K, T0 = 300 K, no mechanics. */
function coupled(M = 4, R = 10, routed = true): Construction {
  return {
    format: 'fp1-construction', formatVersion: 1, name: 'Declared coupled heater', nextSerial: 2,
    numerics: { substeps: M }, environment: { medium: 'vacuum', gravity: { x: 0, y: 0, z: 0 } },
    entities: [receiver('housing')], springs: [],
    circuit: { nodes: [{ id: 'n0', label: 'reference' }, { id: 'n1', label: 'supply' }],
      components: [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', R, routed ? 'housing' : undefined)] },
  };
}
const run = (s: SimWorld, n: number): void => { for (let i = 0; i < n; i++) s.tickOnce(); };
const TOL_J = 1e-8, TOL_K = 1e-8;
/** The INDEPENDENT reference: analytic P = V^2/R, times N public ticks of SI.DT. */
const PtRef = (V: number, R: number, N: number): number => (V * V / R) * (N * SI.DT);
const Q = (s: SimWorld, id: string): number => s.thermal.bodies.find((b) => b.id === id)!.heat;
const T = (s: SimWorld, id: string): number => temperature(s.runtime(id).desc.thermal!, Q(s, id));

// ===========================================================================
// §7 — THE DECLARED COUPLED WITNESS, AT M = 4 AND M = 64
// ===========================================================================
test('C1 10 V / 10 ohm, C = 2 J/K, T0 = 300 K -> at 10 s supplied 100 J, Q 100 J, T 350 K, at M4 AND M64', () => {
  const results: Array<{ M: number; supplied: number; Q: number; T: number; canonical: string }> = [];
  for (const M of [4, 64]) {
    const s = new SimWorld(); s.build(coupled(M));
    expect(s.electrical.rejected).toBe(null);
    run(s, 600);
    expect(s.tick).toBe(600);
    const ref = PtRef(10, 10, 600);
    expect(Math.abs(s.electrical.suppliedEnergy - 100), `M${M} supplied vs 100 J`).toBeLessThanOrEqual(TOL_J);
    expect(Math.abs(s.electrical.suppliedEnergy - ref), `M${M} supplied vs independent P*t`).toBeLessThanOrEqual(TOL_J);
    expect(Math.abs(Q(s, 'housing') - 100), `M${M} receiver Q vs 100 J`).toBeLessThanOrEqual(TOL_J);
    expect(Math.abs(T(s, 'housing') - 350), `M${M} temperature vs 350 K`).toBeLessThanOrEqual(TOL_K);
    assertThermalRouting(s.thermal);
    results.push({ M, supplied: s.electrical.suppliedEnergy, Q: Q(s, 'housing'), T: T(s, 'housing'), canonical: canonicalSimState(s) });
    console.log('C1', { M, supplied: s.electrical.suppliedEnergy, Q: Q(s, 'housing'), T: T(s, 'housing'), ticks: s.electrical.ticks });
    s.rapier.free();
  }
  // SAME PER-PUBLIC-TICK ACCUMULATION: the internal sub-step count is irrelevant to it.
  expect(results[0].supplied).toBe(results[1].supplied);
  expect(results[0].Q).toBe(results[1].Q);
  expect(results[0].T).toBe(results[1].T);
  console.log('C1 M4 and M64 accumulations are BIT-IDENTICAL:', results[0].Q, '===', results[1].Q, 'J');
});

test('C2 the same fixture at R = 20 -> Q 50 J, T 325 K', () => {
  for (const M of [4, 64]) {
    const s = new SimWorld(); s.build(coupled(M, 20));
    run(s, 600);
    expect(Math.abs(Q(s, 'housing') - 50), `M${M} Q vs 50 J`).toBeLessThanOrEqual(TOL_J);
    expect(Math.abs(T(s, 'housing') - 325), `M${M} T vs 325 K`).toBeLessThanOrEqual(TOL_K);
    expect(Math.abs(Q(s, 'housing') - PtRef(10, 20, 600)), `M${M} vs independent P*t`).toBeLessThanOrEqual(TOL_J);
    expect(Math.abs(s.electrical.suppliedEnergy - 50)).toBeLessThanOrEqual(TOL_J);
    console.log('C2', { M, R: 20, Q: Q(s, 'housing'), T: T(s, 'housing') });
    s.rapier.free();
  }
});

test('C3 two resistors routed to DIFFERENT receivers each get their OWN P*t, never a global total', () => {
  const c: Construction = {
    format: 'fp1-construction', formatVersion: 1, name: 'two heaters', nextSerial: 2,
    numerics: { substeps: 4 }, environment: { medium: 'vacuum', gravity: { x: 0, y: 0, z: 0 } },
    entities: [receiver('hotA', 2, 300, 0), receiver('hotB', 4, 280, 5)], springs: [],
    circuit: { nodes: [{ id: 'n0', label: 'ref' }, { id: 'n1', label: 'supply' }],
      components: [src('V1', 'n1', 'n0', 12), res('RA', 'n1', 'n0', 10, 'hotA'), res('RB', 'n1', 'n0', 20, 'hotB')] },
  };
  const s = new SimWorld(); s.build(c); run(s, 600);
  const qa = PtRef(12, 10, 600), qb = PtRef(12, 20, 600);          // 144 J and 72 J
  expect(Math.abs(Q(s, 'hotA') - qa)).toBeLessThanOrEqual(TOL_J);
  expect(Math.abs(Q(s, 'hotB') - qb)).toBeLessThanOrEqual(TOL_J);
  // The GLOBAL-TOTAL-TO-EVERY-BODY bug would give each receiver qa + qb.
  expect(Math.abs(Q(s, 'hotA') - (qa + qb))).toBeGreaterThan(1);
  expect(Math.abs(Q(s, 'hotB') - (qa + qb))).toBeGreaterThan(1);
  expect(Math.abs(T(s, 'hotA') - (300 + qa / 2))).toBeLessThanOrEqual(TOL_K);
  expect(Math.abs(T(s, 'hotB') - (280 + qb / 4))).toBeLessThanOrEqual(TOL_K);
  expect(Math.abs(s.electrical.suppliedEnergy - (qa + qb))).toBeLessThanOrEqual(TOL_J);
  assertThermalRouting(s.thermal);
  console.log('C3', { hotA: Q(s, 'hotA'), refA: qa, hotB: Q(s, 'hotB'), refB: qb, supplied: s.electrical.suppliedEnergy });
  s.rapier.free();
});

test('C4 a MIXED routed/unrouted pair: the receiver takes only its own resistor; the other stays explicitly OUTGOING', () => {
  const c: Construction = {
    format: 'fp1-construction', formatVersion: 1, name: 'mixed', nextSerial: 2,
    numerics: { substeps: 4 }, environment: { medium: 'vacuum', gravity: { x: 0, y: 0, z: 0 } },
    entities: [receiver('hot')], springs: [],
    circuit: { nodes: [{ id: 'n0', label: 'ref' }, { id: 'n1', label: 'supply' }],
      components: [src('V1', 'n1', 'n0', 12), res('Rrouted', 'n1', 'n0', 10, 'hot'), res('Rloose', 'n1', 'n0', 20)] },
  };
  const s = new SimWorld(); s.build(c); run(s, 600);
  const routed = PtRef(12, 10, 600), loose = PtRef(12, 20, 600);
  expect(Math.abs(Q(s, 'hot') - routed)).toBeLessThanOrEqual(TOL_J);
  expect(Math.abs(s.electrical.unroutedEnergy - loose)).toBeLessThanOrEqual(TOL_J);
  expect(Math.abs(totalElectricalRouted(s.electrical) - routed)).toBeLessThanOrEqual(TOL_J);
  // NO DEFAULT RECEIVER AND NO SPLIT: the unrouted resistor reaches no body at all.
  expect(Math.abs(Q(s, 'hot') - (routed + loose))).toBeGreaterThan(1);
  expect(Math.abs(totalResistorEnergy(s.electrical) - (routed + loose))).toBeLessThanOrEqual(TOL_J);
  assertThermalRouting(s.thermal);
  console.log('C4', { receiverQ: Q(s, 'hot'), routedRef: routed, unrouted: s.electrical.unroutedEnergy, unroutedRef: loose });
  s.rapier.free();
});

test('C5 a DAMPER and a RESISTOR sharing ONE receiver coexist: separate ledgers, neither overwrites the other', () => {
  const c = damperFixture(4);      // spring damper routed to `housing`
  c.circuit = { nodes: [{ id: 'n0', label: 'ref' }, { id: 'n1', label: 'supply' }],
    components: [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10, 'housing')] };
  validateAuthored(c);
  const s = new SimWorld(); s.build(c); run(s, 600);

  // The same construction with the CIRCUIT REMOVED gives the damper-only heat.
  const mechOnly = copy(c); delete mechOnly.circuit;
  const m = new SimWorld(); m.build(mechOnly); run(m, 600);

  const damperQ = totalDamperRouted(m.thermal);
  const joule = PtRef(10, 10, 600);
  expect(damperQ, 'the damper really does deliver heat in this fixture').toBeGreaterThan(0.01);
  expect(Math.abs(totalDamperRouted(s.thermal) - damperQ), 'damper ledger unchanged by the resistor').toBeLessThanOrEqual(1e-12);
  expect(Math.abs(totalResistorRouted(s.thermal) - joule), 'resistor ledger matches its own P*t').toBeLessThanOrEqual(TOL_J);
  expect(Math.abs(Q(s, 'housing') - (damperQ + joule)), 'the shared receiver holds BOTH transfers').toBeLessThanOrEqual(TOL_J);
  assertThermalRouting(s.thermal);
  expect(Math.abs(totalRouted(s.thermal) - (totalDamperRouted(s.thermal) + totalResistorRouted(s.thermal)))).toBe(0);
  console.log('C5', { damperQ, joule, sharedReceiver: Q(s, 'housing'), sum: damperQ + joule });
  s.rapier.free(); m.rapier.free();
});

test('C6 mechanics are IDENTICAL with electrical coupling enabled and disabled, every tick', () => {
  const withCircuit = damperFixture(4);
  withCircuit.circuit = { nodes: [{ id: 'n0', label: 'ref' }, { id: 'n1', label: 'supply' }],
    components: [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10, 'housing')] };
  const without = copy(withCircuit); delete without.circuit;
  const a = new SimWorld(), b = new SimWorld();
  a.build(withCircuit); b.build(without);
  for (let i = 0; i < 600; i++) {
    a.tickOnce(); b.tickOnce();
    expect(a.budget).toEqual(b.budget);
    expect(a.body('housing').translation()).toEqual(b.body('housing').translation());
    expect(a.body('housing').linvel()).toEqual(b.body('housing').linvel());
    expect(a.body('housing').rotation()).toEqual(b.body('housing').rotation());
    expect(a.body('housing').angvel()).toEqual(b.body('housing').angvel());
    expect(a.thermal.routed).toEqual(b.thermal.routed);
  }
  expect(a.budget.unattributed).toBe(b.budget.unattributed);
  console.log('C6 600 ticks: trajectories, budgets, mechanical UNATTRIBUTED and the damper ledger all bit-identical');
  a.rapier.free(); b.rapier.free();
});

test('C7 the SEPARATELY DERIVED extended balance closes, and Joule power is not counted twice', () => {
  const c = damperFixture(4);
  c.circuit = { nodes: [{ id: 'n0', label: 'ref' }, { id: 'n1', label: 'supply' }],
    components: [src('V1', 'n1', 'n0', 12), res('Rhot', 'n1', 'n0', 10, 'housing'), res('Rloose', 'n1', 'n0', 20)] };
  const s = new SimWorld(); s.build(c); run(s, 600);
  const bal = extendedSystemBalance(s.budget, s.thermal, s.electrical);
  const routedJoule = PtRef(12, 10, 600), looseJoule = PtRef(12, 20, 600);

  // Every declared term, checked against an independent value.
  expect(Math.abs(bal.inElectricalSupplied - (routedJoule + looseJoule)), 'supplied').toBeLessThanOrEqual(TOL_J);
  expect(Math.abs(bal.outElectricalUnrouted - looseJoule), 'unrouted outgoing').toBeLessThanOrEqual(TOL_J);
  expect(Math.abs(bal.sourceGap), 'supplied minus resistor dissipation').toBeLessThanOrEqual(TOL_J);
  expect(Math.abs(bal.routingGap), 'receiver Q minus both routed ledgers').toBeLessThanOrEqual(TOL_J);
  // NO DOUBLE COUNTING: the routed Joule energy appears in STORED, not also in OUT.
  expect(Math.abs(bal.storedReceiverHeat - (totalDamperRouted(s.thermal) + routedJoule))).toBeLessThanOrEqual(TOL_J);
  // The balance closes to the SAME small remainder the mechanical books already had,
  // with the sign of an IN - STORED - OUT statement. That relation is DERIVED, not assumed:
  expect(Math.abs(bal.residual + bal.mechanicalUnattributed), 'IN-STORED-OUT vs the old mechanical remainder').toBeLessThanOrEqual(1e-9);
  expect(Math.abs(bal.residual), 'the extended remainder is small').toBeLessThanOrEqual(1e-3);
  // ... and the OLD damper-only remainder is untouched by any of this.
  const mechOnly = copy(c); delete mechOnly.circuit;
  const m = new SimWorld(); m.build(mechOnly); run(m, 600);
  expect(s.budget.unattributed).toBe(m.budget.unattributed);
  console.log('C7', { supplied: bal.inElectricalSupplied, storedQ: bal.storedReceiverHeat,
    outElec: bal.outElectricalUnrouted, outMech: bal.outMechanicalUnrouted, residual: bal.residual,
    sourceGap: bal.sourceGap, routingGap: bal.routingGap, oldUnattributed: bal.mechanicalUnattributed });
  s.rapier.free(); m.rapier.free();
});

test('C8 an UNDAMPED spring and an UNROUTED resistor feed no receiver at all', () => {
  const c = damperFixture(4, 0);            // c = 0: no damper dissipation
  c.circuit = { nodes: [{ id: 'n0', label: 'ref' }, { id: 'n1', label: 'supply' }],
    components: [src('V1', 'n1', 'n0', 10), res('Rloose', 'n1', 'n0', 10)] };
  delete c.springs[0].heatReceiver;
  const s = new SimWorld(); s.build(c);
  for (let i = 0; i < 600; i++) {
    s.tickOnce();
    expect(Q(s, 'housing')).toBe(0);
    expect(T(s, 'housing')).toBe(300);
  }
  expect(totalHeat(s.thermal)).toBe(0);
  expect(Math.abs(s.electrical.unroutedEnergy - PtRef(10, 10, 600))).toBeLessThanOrEqual(TOL_J);
  expect(Math.abs(s.budget.unattributed), 'the mechanical integration residual is non-vacuous').toBeGreaterThan(1e-8);
  console.log('C8 receiver stayed at exactly 300 K for 600 ticks while', s.electrical.unroutedEnergy,
    'J left as declared outgoing loss and the mechanical residual was', s.budget.unattributed, 'J');
  s.rapier.free();
});

test('C9 PAUSE adds no heat; ONE step adds exactly ONE tick of it; the display rate is irrelevant', () => {
  const s = new SimWorld(); s.build(coupled(4));
  const perTick = 10 * SI.DT;
  s.tickOnce();
  expect(Math.abs(Q(s, 'housing') - perTick)).toBeLessThanOrEqual(1e-12);
  expect(s.electrical.ticks).toBe(1);
  const held = Q(s, 'housing'), heldSupplied = s.electrical.suppliedEnergy;
  // "Paused" is simply not calling tickOnce. Nothing else may advance the accounts.
  for (let i = 0; i < 100; i++) { s.refreshSpringDiagnostics(); }
  expect(Q(s, 'housing')).toBe(held);
  expect(s.electrical.suppliedEnergy).toBe(heldSupplied);
  s.tickOnce();
  expect(Math.abs(Q(s, 'housing') - 2 * perTick)).toBeLessThanOrEqual(1e-12);
  expect(s.electrical.ticks).toBe(2);
  console.log('C9 one tick =', perTick, 'J; 100 non-tick refreshes added exactly 0 J; two ticks =', Q(s, 'housing'), 'J');
  s.rapier.free();
});

// ===========================================================================
// §7 — THE MUTANTS. EXECUTED, against routing and source integrity.
// ===========================================================================
test('C10 a DOUBLE-COUNTING mutant and a RESIDUAL-INJECTION mutant are both REJECTED', () => {
  const s = new SimWorld(); s.build(coupled(4)); run(s, 600);
  assertThermalRouting(s.thermal);

  // (a) DOUBLE COUNTING: the routed Joule energy credited to the receiver a second time.
  const dbl = copy(s.thermal);
  dbl.bodies[0].heat += totalElectricalRouted(s.electrical);
  expect(() => assertThermalRouting(dbl)).toThrow('routing integrity failed');
  console.log('C10a double-counting mutant: receiver Q inflated by a second copy of', totalElectricalRouted(s.electrical),
    'J — routing integrity assertion RED as required');

  // (b) RESIDUAL INJECTION: mechanical numerical residual relabelled as heat. The
  //     extended balance would look BETTER; routing integrity must still reject it.
  const inj = copy(s.thermal);
  inj.bodies[0].heat -= s.budget.unattributed === 0 ? 1e-6 : s.budget.unattributed;
  expect(() => assertThermalRouting(inj)).toThrow('routing integrity failed');
  console.log('C10b residual-injection mutant: routing integrity assertion RED as required');

  // (c) SOURCE INTEGRITY: energy claimed as supplied that no resistor dissipated.
  const bad = copy(s.electrical); bad.suppliedEnergy += 5;
  const bal = extendedSystemBalance(s.budget, s.thermal, bad);
  expect(Math.abs(bal.sourceGap - 5)).toBeLessThanOrEqual(TOL_J);
  expect(Math.abs(bal.sourceGap), 'source gap must exceed the declared tolerance').toBeGreaterThan(TOL_J);
  console.log('C10c source-integrity mutant: sourceGap became', bal.sourceGap, 'J, far outside the declared', TOL_J, 'J');

  // (d) PASSIVE POWER IS NON-NEGATIVE: a negative Joule increment is REFUSED, not
  //     booked as the damper's numerical backflow.
  expect(() => routeResistorHeat(s.thermal, 'R1', 'housing', -1)).toThrow(/non-negative/);
  console.log('C10d a negative resistor heat increment is REFUSED, never recorded as backflow');
  s.rapier.free();
});

// ===========================================================================
// §8 — PERSISTENCE AND IDENTITY
// ===========================================================================
test('P1 exact-schema mutation and roundtrip matrix over EVERY new field and optional presence', () => {
  const base = coupled(4);
  const rows: Array<[string, (c: Construction) => void, boolean]> = [
    // ---- VALID mutations: each must roundtrip EXACTLY and differ from the base.
    ['resistance value', c => { (c.circuit!.components[1] as any).resistance = 47; }, true],
    ['source voltage value', c => { (c.circuit!.components[0] as any).voltage = 5; }, true],
    ['source voltage zero', c => { (c.circuit!.components[0] as any).voltage = 0; }, true],
    ['reversed source terminals', c => { const s = c.circuit!.components[0] as any; const p = s.pos; s.pos = s.neg; s.neg = p; }, true],
    ['reversed resistor terminals', c => { const r = c.circuit!.components[1] as any; const a = r.a; r.a = r.b; r.b = a; }, true],
    ['receiver ABSENCE', c => { delete (c.circuit!.components[1] as any).heatReceiver; }, true],
    ['receiver value changed to another configured body', c => {
      c.entities.push(receiver('other', 3, 290, 4)); (c.circuit!.components[1] as any).heatReceiver = 'other'; }, true],
    ['node label', c => { c.circuit!.nodes[0].label = 'chassis reference'; }, true],
    ['component label', c => { c.circuit!.components[1].label = 'heater element'; }, true],
    ['an added node with an added resistor', c => {
      c.circuit!.nodes.push({ id: 'n2', label: 'mid' });
      c.circuit!.components.push(res('R2', 'n1', 'n2', 33)); }, true],
    ['an added ideal WIRE', c => {
      c.circuit!.nodes.push({ id: 'n2', label: 'mid' });
      c.circuit!.components.push({ kind: 'wire', model: 'ideal-wire', modelVersion: 1, id: 'W1', label: 'W1', a: 'n1', b: 'n2' });
      c.circuit!.components.push(res('R2', 'n2', 'n0', 33)); }, true],
    ['CIRCUIT ABSENCE entirely', c => { delete c.circuit; }, true],
    // ---- INVALID mutations: each must be REFUSED.
    ['resistance zero', c => { (c.circuit!.components[1] as any).resistance = 0; }, false],
    ['resistance negative', c => { (c.circuit!.components[1] as any).resistance = -5; }, false],
    ['resistance NaN', c => { (c.circuit!.components[1] as any).resistance = NaN; }, false],
    ['resistance above range', c => { (c.circuit!.components[1] as any).resistance = 1e10; }, false],
    ['voltage infinite', c => { (c.circuit!.components[0] as any).voltage = Infinity; }, false],
    ['voltage above range', c => { (c.circuit!.components[0] as any).voltage = 1e7; }, false],
    ['missing resistance', c => { delete (c.circuit!.components[1] as any).resistance; }, false],
    ['missing voltage', c => { delete (c.circuit!.components[0] as any).voltage; }, false],
    ['missing model', c => { delete (c.circuit!.components[1] as any).model; }, false],
    ['missing modelVersion', c => { delete (c.circuit!.components[1] as any).modelVersion; }, false],
    ['unknown field on a resistor', c => { (c.circuit!.components[1] as any).capacitance = 1e-6; }, false],
    ['unknown field on a node', c => { (c.circuit!.nodes[0] as any).voltage = 0; }, false],
    ['a source given a resistance field', c => { (c.circuit!.components[0] as any).resistance = 1; }, false],
    ['a resistor given a voltage field', c => { (c.circuit!.components[1] as any).voltage = 1; }, false],
    ['unknown component kind', c => { (c.circuit!.components[1] as any).kind = 'capacitor'; }, false],
    ['unknown model version', c => { (c.circuit!.components[1] as any).modelVersion = 2; }, false],
    ['dangling terminal', c => { (c.circuit!.components[1] as any).b = 'nowhere'; }, false],
    ['dangling receiver', c => { (c.circuit!.components[1] as any).heatReceiver = 'nobody'; }, false],
    ['receiver naming a body with NO thermal parameters', c => {
      c.entities.push({ ...receiver('cold'), thermal: undefined } as any);
      delete (c.entities[1] as any).thermal; (c.circuit!.components[1] as any).heatReceiver = 'cold'; }, false],
    ['null receiver', c => { (c.circuit!.components[1] as any).heatReceiver = null; }, false],
    ['id colliding with a BODY id', c => { (c.circuit!.nodes[0] as any).id = 'housing'; (c.circuit!.components[0] as any).neg = 'housing'; (c.circuit!.components[1] as any).b = 'housing'; }, false],
    ['duplicate node ids', c => { c.circuit!.nodes.push({ id: 'n0', label: 'again' }); }, false],
    ['two sources', c => { c.circuit!.components.push(src('V2', 'n1', 'n0', 5)); }, false],
    ['no source', c => { c.circuit!.components = [c.circuit!.components[1]]; }, false],
    ['wire shorting the source', c => {
      c.circuit!.components.push({ kind: 'wire', model: 'ideal-wire', modelVersion: 1, id: 'W1', label: 'W1', a: 'n1', b: 'n0' }); }, false],
    ['floating island', c => {
      c.circuit!.nodes.push({ id: 'n8', label: 'a' }, { id: 'n9', label: 'b' });
      c.circuit!.components.push(res('Rfar', 'n8', 'n9', 10)); }, false],
    ['node with no component', c => { c.circuit!.nodes.push({ id: 'n7', label: 'orphan' }); }, false],
    ['empty circuit object', c => { c.circuit = { nodes: [], components: [] }; }, false],
    ['a solver handle smuggled into the authored circuit', c => { (c.circuit as any).handle = 3; }, false],
    ['a row index smuggled onto a component', c => { (c.circuit!.components[1] as any).rapier = 7; }, false],
  ];
  let valid = 0;
  for (const [name, change, ok] of rows) {
    const c = copy(base); change(c);
    if (ok) {
      validateAuthored(c);
      expect(canonical(loadAuthored(saveAuthored(c))), name).toBe(canonical(c));
      expect(canonical(c), name).not.toBe(canonical(base));
      valid++;
    } else {
      expect(() => validateAuthored(c), name).toThrow();
    }
  }
  // Roundtrip of the UNMUTATED base too, so the matrix is not vacuous.
  expect(canonical(loadAuthored(saveAuthored(base)))).toBe(canonical(base));
  console.log('P1 circuit mutation/roundtrip matrix', rows.length, 'of', rows.length,
    `(${valid} valid roundtrips, ${rows.length - valid} refusals)`);
});

test('P2 save AFTER heating reproduces the STARTING temperatures and the circuit; runtime accounts never leak into the document', () => {
  const c = coupled(4);
  const session = new AuthoringSession(c);
  const s = new SimWorld(); s.build(c); run(s, 300);
  expect(Q(s, 'housing')).toBeGreaterThan(0);
  expect(T(s, 'housing')).toBeGreaterThan(300);

  const reopened = loadAuthored(session.save());
  expect(canonical(reopened)).toBe(canonical(c));
  expect(reopened.entities[0].thermal!.initialTemperature).toBe(300);
  expect(reopened.circuit!.components).toEqual(c.circuit!.components);
  // NO RUNTIME ACCOUNT AND NO SOLVER HANDLE IS IN THE DOCUMENT.
  const doc = session.save();
  for (const leak of ['suppliedEnergy', 'unroutedEnergy', 'routedElectrical', 'sourceCurrent', 'nodeVoltages', 'handle', 'rapier']) {
    expect(doc.includes(leak), `authored document must not contain ${leak}`).toBe(false);
  }
  // Reopening starts a cold run: the accounts are zero and the temperature is the authored one.
  const fresh = new SimWorld(); fresh.build(reopened);
  expect(fresh.electrical.suppliedEnergy).toBe(0);
  expect(T(fresh, 'housing')).toBe(300);
  console.log('P2 after heating to', T(s, 'housing'), 'K the saved document still starts at',
    T(fresh, 'housing'), 'K with the same circuit and no runtime fields');
  s.rapier.free(); fresh.rapier.free();
});

test('P3 a CHECKPOINT resumes the accumulated energies, and canonical replay state covers every new value', () => {
  const c = coupled(4);
  const s = new SimWorld(); s.build(c); run(s, 120);
  const cp = takeCheckpoint(s, { pendingEvents: [], selectedId: 'housing', settings: { paused: true, recording: false }, seqCounter: 0, recordedEvents: [], recordingBase: c });
  const t = new SimWorld(); restoreCheckpoint(t, cp);
  expect(canonicalSimState(t)).toBe(canonicalSimState(s));
  expect(t.electrical.suppliedEnergy).toBe(s.electrical.suppliedEnergy);
  expect(t.electrical.ticks).toBe(120);
  expect(Q(t, 'housing')).toBe(Q(s, 'housing'));
  // A restore that silently restarted at zero would show up here.
  expect(t.electrical.suppliedEnergy).toBeGreaterThan(0);
  run(t, 60); run(s, 60);
  expect(canonicalSimState(t)).toBe(canonicalSimState(s));

  // RECORD REPLAY from tick 0 reaches exactly the same declared state.
  const rec: InputRecord = { format: 'fp1-record', formatVersion: 1,
    engine: `@dimforge/rapier3d-compat@${SimWorld.engineVersion()}`, construction: c, events: [], checkpointEvery: 60 };
  const r = new SimWorld(); replay(r, rec, 180);
  expect(canonicalSimState(r)).toBe(canonicalSimState(s));

  // The canonical state ACTUALLY NAMES the new values — a fingerprint that agreed
  // while the electrical half was omitted would be the failure mode we refuse.
  const canon = canonicalSimState(s);
  for (const needle of ['circuit-node n0', 'circuit-component V1 source', 'circuit-component R1 resistor',
    'circuit-merged', 'electrical-state supplied=', 'electrical-resistor R1', 'electrical-routed R1',
    'circuit-voltage', 'circuit-branch R1', 'circuit-source', 'thermal-ledger-elec R1']) {
    expect(canon.includes(needle), `canonical replay state must name ${needle}`).toBe(true);
  }
  // ... and a changed resistance CHANGES it.
  const other = copy(c); (other.circuit!.components[1] as any).resistance = 20;
  const o = new SimWorld(); o.build(other); run(o, 180);
  expect(canonicalSimState(o)).not.toBe(canon);
  console.log('P3 checkpoint resumed', t.electrical.suppliedEnergy, 'J; replay matched; canonical state names all 11 new keys');
  for (const w of [s, t, r, o]) w.rapier.free();
});

test('P4 DELETE NODE removes attached components atomically, and REFUSES VISIBLY when the node carries a source terminal', () => {
  const c = coupled(4);
  c.circuit!.nodes.push({ id: 'n2', label: 'mid' });
  c.circuit!.components.push(res('R2', 'n1', 'n2', 33), res('R3', 'n2', 'n0', 47));
  validateAuthored(c);

  // A node carrying a SOURCE terminal is REFUSED, and NOTHING is changed by the attempt.
  const before = canonical(c);
  expect(() => deleteCircuitNode(c, 'n0')).toThrow(/REFUSED/);
  expect(() => deleteCircuitNode(c, 'n1')).toThrow(/REFUSED/);
  expect(canonical(c)).toBe(before);

  // An ordinary node goes ATOMICALLY with every component attached to it.
  const d = copy(c); deleteCircuitNode(d, 'n2');
  expect(d.circuit!.nodes.map(n => n.id)).toEqual(['n0', 'n1']);
  expect(d.circuit!.components.map(x => x.id)).toEqual(['V1', 'R1']);
  validateAuthored(d);
  // NO GHOSTS: nothing anywhere still names the deleted node.
  expect(saveAuthored(d).includes('"n2"')).toBe(false);
  expect(() => deleteCircuitNode(d, 'n2')).toThrow(/No circuit node/);
  console.log('P4 node deletion: source-bearing nodes refused with the scene untouched; n2 removed with R2 and R3 atomically');
});

test('P5 DELETE RECEIVER clears ELECTRICAL and MECHANICAL routing, and the heat already transferred is preserved as exported', () => {
  const c = damperFixture(4);
  c.circuit = { nodes: [{ id: 'n0', label: 'ref' }, { id: 'n1', label: 'supply' }],
    components: [src('V1', 'n1', 'n0', 10), res('R1', 'n1', 'n0', 10, 'housing')] };
  validateAuthored(c);

  // In the AUTHORED document.
  const d = copy(c); deleteBody(d, 'housing');
  expect(d.springs).toEqual([]);
  expect((d.circuit!.components[1] as any).heatReceiver).toBeUndefined();
  expect(saveAuthored(d).includes('housing')).toBe(false);
  validateAuthored(d);

  // In the RUNNING world: exported heat preserves what was already transferred.
  const s = new SimWorld(); s.build(c); run(s, 120);
  const held = Q(s, 'housing');
  expect(held).toBeGreaterThan(0);
  s.removeEntity('housing');
  expect(s.thermal.bodies).toEqual([]);
  expect(s.thermal.exportedHeat).toBe(held);
  expect(s.springs.every(x => x.heatReceiver === undefined)).toBe(true);
  expect((s.construction.circuit!.components[1] as any).heatReceiver).toBeUndefined();
  assertThermalRouting(s.thermal);
  console.log('P5 removing the shared receiver exported', s.thermal.exportedHeat,
    'J and cleared BOTH the damper route and the resistor route');
  s.rapier.free();
});

test('P6 a capture carries its OWN circuit and is never bound to the active one by coincidence of IDs', () => {
  const make = (R: number) => {
    const c = coupled(4); (c.circuit!.components[1] as any).resistance = R;
    const w = new SimWorld(); w.build(c);
    const meter = new Meter('thermal.T', { kind: 'body', entityId: 'housing' }); meter.sample(w);
    for (let i = 0; i < 120; i++) { w.tickOnce(); meter.sample(w); }
    const capture = captureRun(`R=${R}`, c, new Recorder().toRecord(c), meter, w.tick);
    w.rapier.free(); return capture;
  };
  const a = make(10), b = make(20);
  // COMPARISON NAMES THE CHANGED FIELD, by its authored path.
  expect(differences(a.construction, b.construction, 'scene')).toEqual(['scene.circuit.components.1.resistance: 10 → 20']);
  // Topology and receiver changes are named too.
  const t = copy(a.construction); t.circuit!.nodes.push({ id: 'n2', label: 'mid' });
  t.circuit!.components.push(res('R2', 'n1', 'n2', 33), res('R3', 'n2', 'n0', 47));
  expect(differences(a.construction, t, 'scene').some(x => x.includes('circuit.nodes'))).toBe(true);
  expect(differences(a.construction, t, 'scene').some(x => x.includes('circuit.components'))).toBe(true);
  const rcv = copy(a.construction); delete (rcv.circuit!.components[1] as any).heatReceiver;
  expect(differences(a.construction, rcv, 'scene')).toEqual(['scene.circuit.components.1.heatReceiver: removed']);

  // THE ID COINCIDENCE. The active scene has the SAME node and component ids and a
  // DIFFERENT resistance; the capture must NOT be rebound to it.
  const active = b.construction;
  expect(a.construction.circuit!.components.map(x => x.id)).toEqual(active.circuit!.components.map(x => x.id));
  expect(() => requireRecordingBase(a.input, active)).toThrow(/different authored construction/);
  expect(() => requireRecordingBase(a.input, a.construction)).not.toThrow();

  // CAPTURED-BASE REPLAY restores the capture's OWN graph, receiver and profile.
  const r = new SimWorld(); replay(r, a.input, 120);
  expect((r.construction.circuit!.components[1] as any).resistance).toBe(10);
  expect((r.construction.circuit!.components[1] as any).heatReceiver).toBe('housing');
  expect(r.subSteps).toBe(4);
  expect(r.electrical.suppliedEnergy).toBeGreaterThan(0);
  expect(Math.abs(r.electrical.suppliedEnergy - PtRef(10, 10, 120))).toBeLessThanOrEqual(TOL_J);
  // The traces really do differ: a resistance change IS a temperature change.
  expect(a.samples.at(-1)!.value).not.toBe(b.samples.at(-1)!.value);
  console.log('P6 R=10 trace ended at', a.samples.at(-1)!.value, 'K and R=20 at', b.samples.at(-1)!.value,
    'K; the capture refused rebinding to an identically-named circuit');
  r.rapier.free();
});

test('P7 a REJECTED electrical solve accumulates nothing and never reuses a last-good result', () => {
  // A construction that VALIDATES but whose numerical solve we then reject by hand,
  // to exercise the rejection path end to end.
  const c = coupled(4);
  const s = new SimWorld(); s.build(c); run(s, 60);
  const good = s.electrical.suppliedEnergy;
  expect(good).toBeGreaterThan(0);
  s.electrical.rejected = 'forced rejection for the witness';
  run(s, 60);
  expect(s.electrical.suppliedEnergy).toBe(good);          // nothing more accumulated
  expect(s.electrical.ticks).toBe(60);
  expect(quantity('elec.P').read(s, { kind: 'world' })).toBe(null);   // and nothing stale is displayed
  console.log('P7 a rejected solve froze the accounts at', good, 'J and reports no power rather than a stale one');
  s.rapier.free();
});
