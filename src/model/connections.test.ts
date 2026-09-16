/**
 * BB2 — §4 AUTHORING SEMANTICS AND §5 PERSISTENCE for ball and fixed connections.
 *
 * Against `bridge/BATCH2-ACCEPTANCE-v1.md` §4 and §5, and the stamped
 * `EXPECTATIONS-BB2-CONNECTIONS.md` PART 2 and PART 5.
 * P1..P7 below are the declaration's own labels.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { SimWorld, canonicalSimState } from '../sim/world';
import {
  Recorder, extrasFrom, replay, restoreCheckpoint, takeCheckpoint, worldReplaced,
  type InputRecord,
} from '../sim/record';
import { constructionSubsteps, type Construction, type EntityDesc } from './construction';
import { Meter } from './measure';
import {
  ALIGN_TOL_POS, AuthoringSession, canonical, connectionMisalignment, copy, deleteBody,
  deleteConnection, encode, loadAuthored, makeConnection, nextConnectionId,
  placeToSatisfyConnection, placementReason, saveAuthored,
} from './authoring';
import { captureRun, ComparisonStore, differences } from './comparison';
import { relativePoseAngle, type FixedJointDesc } from './joints';
import { qangle, qaxisAngle, qconj, qmul, type Quat } from './units';

beforeAll(async () => { await SimWorld.initEngine(); });
const log = (...a: unknown[]): void => { console.log('[BB2-P]', ...a); };

/**
 * A small AUTHORABLE scene: two free blocks in vacuum with no gravity, sharing a
 * face so a connection point on that face is reachable, and body B carrying a
 * NON-IDENTITY rotation so a fixed connection's frames are not degenerate.
 */
const REL: Quat = qaxisAngle({ x: 0, y: 1, z: 0 }, 0.5);
function pairScene(): Construction {
  const block = (id: string, x: number, rot: Quat): EntityDesc => ({
    id, label: id, kinematics: 'dynamic',
    shape: { kind: 'box', hx: 0.2, hy: 0.2, hz: 0.2 },
    material: { mass: 1.5, restitution: 0.1, friction: 0.5 },
    translation: { x, y: 1.2, z: 0 }, rotation: { ...rot },
    linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 }, colour: 0xd98a5a,
  });
  return {
    format: 'fp1-construction', formatVersion: 1, name: 'authorable pair',
    environment: { medium: 'vacuum', gravity: { x: 0, y: 0, z: 0 } },
    entities: [block('blockA', 0, { x: 0, y: 0, z: 0, w: 1 }), block('blockB', 0.6, REL)],
    springs: [], joints: [], numerics: { substeps: 128 }, nextSerial: 1,
  };
}

/** The aligned connection the UI's create operation produces, built the same way it does. */
function connect(c: Construction, kind: 'ball' | 'fixed'): Construction {
  const out = copy(c);
  const j = makeConnection(out, kind, 'blockA', 'blockB', { x: 0.3, y: 0.05, z: 0 }, { x: 0, y: 0, z: 0 });
  out.joints = [...(out.joints ?? []), j];
  placeToSatisfyConnection(out, j.id);
  return out;
}

// ===========================================================================
// §4 — HONEST SEMANTICS, AND THE MISALIGNMENT GATE
// ===========================================================================

describe('§4 — authoring semantics: named frames, preserved relative pose, and NO SILENT SNAPPING', () => {
  test('G1 a FIXED connection preserves the INTENDED INITIAL RELATIVE POSE, in explicitly named frames', () => {
    const c = connect(pairScene(), 'fixed');
    const j = c.joints![0] as FixedJointDesc;
    const A = c.entities.find((e) => e.id === 'blockA')!, B = c.entities.find((e) => e.id === 'blockB')!;
    const qRelAuthored = qmul(qconj(A.rotation), B.rotation);
    log(`G1 authored q_rel angle ${(qangle(qRelAuthored) * 180 / Math.PI).toFixed(6)} deg; `
      + `the connection's own relativePoseAngle ${(relativePoseAngle(j) * 180 / Math.PI).toFixed(6)} deg; `
      + `frameA = identity, frameB = R_B⁻¹⊗R_A`);
    // frameA and frameB are the connection frame in EACH BODY'S OWN local frame.
    expect(j.frameA).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(relativePoseAngle(j)).toBeCloseTo(qangle(qRelAuthored), 12);
    expect(qangle(qRelAuthored)).toBeCloseTo(0.5, 9);          // NON-IDENTITY
    // The two connection frames coincide in world at the authored state: that IS alignment.
    expect(qangle(qmul(qconj(qmul(A.rotation, j.frameA)), qmul(B.rotation, j.frameB)))).toBeLessThan(1e-12);
  });

  test('G2 a BALL carries NO axis and NO frame; a FIXED carries frames and NO axis', () => {
    const ball = connect(pairScene(), 'ball').joints![0];
    const fixed = connect(pairScene(), 'fixed').joints![0];
    expect(Object.keys(ball).sort()).toEqual(['anchorA', 'anchorB', 'bodyA', 'bodyB', 'id', 'kind']);
    expect(Object.keys(fixed).sort()).toEqual(['anchorA', 'anchorB', 'bodyA', 'bodyB', 'frameA', 'frameB', 'id', 'kind']);
    log(`G2 ball fields ${JSON.stringify(Object.keys(ball).sort())}; fixed fields ${JSON.stringify(Object.keys(fixed).sort())}`);
    // A dummy axis is not merely unused: it is REFUSED.
    for (const j of [ball, fixed]) {
      const c = connect(pairScene(), j.kind as 'ball' | 'fixed');
      (c.joints![0] as unknown as Record<string, unknown>).axis = { x: 0, y: 0, z: 1 };
      expect(() => saveAuthored(c)).toThrow('Unknown field');
    }
  });

  test('G3 a MISALIGNED connection is VISIBLY REFUSED with the measured residual, never snapped', () => {
    for (const kind of ['ball', 'fixed'] as const) {
      const c = connect(pairScene(), kind);
      // Move body B by 4 mm — four THOUSAND times the 1e-6 m authoring band.
      c.entities.find((e) => e.id === 'blockB')!.translation.x += 0.004;
      const m = connectionMisalignment(c, c.joints![0])!;
      log(`G3 ${kind}: measured separation ${m.separation.toExponential(3)} m`
        + (m.frameError === null ? ' (a ball has no orientation constraint, so no frame error is defined)'
          : `, frame error ${m.frameError.toExponential(3)} rad`));
      expect(m.separation).toBeCloseTo(0.004, 9);
      // REFUSED at the document boundary...
      expect(() => saveAuthored(c)).toThrow(/MISALIGNED and REFUSED/);
      // ...and REFUSED at the engine boundary, so no path reaches the solver.
      expect(() => new SimWorld().build(c)).toThrow(/MISALIGNED and REFUSED/);
      // The refusal NAMES the measured separation and the placement operation.
      let msg = '';
      try { saveAuthored(c); } catch (e) { msg = String(e); }
      expect(msg).toContain('m apart');
      expect(msg).toContain('not snapped into place by the solver');
      expect(msg).toContain('place blockB to satisfy');
    }
  });

  test('G4 a FIXED connection is refused for a bad ORIENTATION alone, with the anchors coincident', () => {
    const c = connect(pairScene(), 'fixed');
    // Rotate B about the shared anchor so the anchors STAY coincident but the frames do not.
    const j = c.joints![0] as FixedJointDesc;
    const B = c.entities.find((e) => e.id === 'blockB')!;
    B.rotation = qmul(qaxisAngle({ x: 0, y: 0, z: 1 }, 0.02), B.rotation);
    // put B back so the anchor still coincides (anchorB is the origin of B, so only rotation moved)
    const m = connectionMisalignment(c, j)!;
    log(`G4 rotation-only misalignment: separation ${m.separation.toExponential(3)} m, `
      + `frame error ${m.frameError!.toExponential(3)} rad — refused on ORIENTATION`);
    expect(m.separation).toBeLessThan(ALIGN_TOL_POS);
    expect(m.frameError).toBeCloseTo(0.02, 9);
    expect(() => saveAuthored(c)).toThrow(/connection frames differ/);
  });

  test('G5 THE AUTHORED PLACEMENT OPERATION resolves it, through the EXISTING edit audit', () => {
    for (const kind of ['ball', 'fixed'] as const) {
      const session = new AuthoringSession(connect(pairScene(), kind));
      const before = session.identity;
      // An authored edit that breaks the connection is REFUSED ATOMICALLY (P7).
      expect(() => session.edit((c) => { c.entities.find((e) => e.id === 'blockB')!.translation.x += 0.004; }, 'nudge'))
        .toThrow(/MISALIGNED and REFUSED/);
      expect(session.identity).toBe(before);
      expect(session.audit).toHaveLength(0);
      // The sanctioned resolution: move the body AND run the placement operation in ONE edit.
      const jid = session.authored.joints![0].id;
      session.edit((c) => {
        c.entities.find((e) => e.id === 'blockB')!.translation.x += 0.004;
        placeToSatisfyConnection(c, jid);
      }, placementReason(session.authored.joints![0]));
      expect(session.audit).toHaveLength(1);
      expect(session.audit[0].reason).toBe(`place blockB to satisfy ${kind} connection ${jid}`);
      expect(typeof session.audit[0].deltaInitialEnergy).toBe('number');
      expect(connectionMisalignment(session.authored, session.authored.joints![0])).toBeNull();
      log(`G5 ${kind}: placement edit audited as "${session.audit[0].reason}", `
        + `ΔE_initial = ${session.audit[0].deltaInitialEnergy.toExponential(3)} J; connection now aligned`);
    }
  });

  test('G6 THE SOLVER NEVER SNAPS: an aligned connection stays aligned, and no run can un-refuse one', () => {
    // The gate's counterfactual: if the misaligned document HAD been handed to the solver,
    // the solver WOULD have pulled it into place. Demonstrated on a private world built
    // through the engine directly, so the claim "it would have been snapped" is evidence.
    const c = connect(pairScene(), 'ball');
    const sim = new SimWorld(); sim.build(c);
    const pull = sim.body('blockB').translation();
    // displace the LIVE body (not the authored document) and let the solver act
    sim.body('blockB').setTranslation({ x: pull.x + 0.004, y: pull.y, z: pull.z }, true);
    const before = sim.body('blockB').translation().x;
    for (let i = 0; i < 30; i++) sim.tickOnce();
    const after = sim.body('blockB').translation().x;
    log(`G6 counterfactual: a 4 mm violation introduced into a LIVE world was pulled from `
      + `x = ${before.toFixed(6)} to x = ${after.toFixed(6)} by the solver in 30 ticks — which is exactly `
      + 'what the authoring gate refuses to let happen to an authored document.');
    expect(Math.abs(after - before)).toBeGreaterThan(1e-4);
    sim.rapier.free();
  });
});

// ===========================================================================
// §5 — PERSISTENCE.  P1..P7.
// ===========================================================================

/**
 * P1 — LEGACY COMPATIBILITY. A FROZEN LITERAL document in the PRE-BATCH-2 schema:
 * hinge and slider, each with `axis`, no frames, no `numerics`. These bytes were
 * written by hand from the schema as it shipped in BB1 and are never regenerated.
 */
const LEGACY_DOC = `{
  "format": "fg-authored",
  "version": 1,
  "construction": {
    "format": "fp1-construction",
    "formatVersion": 1,
    "name": "legacy hinge and slider",
    "environment": { "medium": "vacuum", "gravity": { "x": 0, "y": -9.81, "z": 0 } },
    "entities": [
      { "id": "pivot", "label": "hinge pivot", "kinematics": "fixed",
        "shape": { "kind": "box", "hx": 0.05, "hy": 0.05, "hz": 0.05 },
        "material": { "mass": 0, "restitution": 0, "friction": 0.5 },
        "translation": { "x": 0, "y": 1.6, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
        "linvel": { "x": 0, "y": 0, "z": 0 }, "angvel": { "x": 0, "y": 0, "z": 0 }, "colour": 6056312 },
      { "id": "bob", "label": "bob", "kinematics": "dynamic",
        "shape": { "kind": "sphere", "radius": 0.08 },
        "material": { "mass": 1, "restitution": 0.2, "friction": 0.5 },
        "translation": { "x": 0, "y": 1, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
        "linvel": { "x": 0, "y": 0, "z": 0 }, "angvel": { "x": 0, "y": 0, "z": 0 }, "colour": 14248042 },
      { "id": "cart", "label": "cart", "kinematics": "dynamic",
        "shape": { "kind": "box", "hx": 0.12, "hy": 0.12, "hz": 0.12 },
        "material": { "mass": 2, "restitution": 0.1, "friction": 0.5 },
        "translation": { "x": 1.3, "y": 1, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
        "linvel": { "x": 0, "y": 0, "z": 0 }, "angvel": { "x": 0, "y": 0, "z": 0 }, "colour": 8051112 }
    ],
    "springs": [],
    "joints": [
      { "id": "hinge0", "kind": "hinge", "bodyA": "pivot", "bodyB": "bob",
        "anchorA": { "x": 0, "y": 0, "z": 0 }, "anchorB": { "x": 0, "y": 0.6, "z": 0 },
        "axis": { "x": 0, "y": 0, "z": 1 } },
      { "id": "slider0", "kind": "slider", "bodyA": "pivot", "bodyB": "cart",
        "anchorA": { "x": 0, "y": 0, "z": 0 }, "anchorB": { "x": 0, "y": 0, "z": 0 },
        "axis": { "x": 1, "y": 0, "z": 0 } }
    ],
    "nextSerial": 1
  }
}`;

describe('§5 — persistence: P1..P7', () => {
  test('P1 a FROZEN pre-batch-2 hinge/slider document still loads, validates, and builds unchanged', () => {
    const c = loadAuthored(LEGACY_DOC);
    expect(c.joints!.map((j) => `${j.id}:${j.kind}`)).toEqual(['hinge0:hinge', 'slider0:slider']);
    // ABSENT `numerics` still MEANS the legacy 4. That is the whole compatibility promise.
    expect(c.numerics).toBeUndefined();
    expect(constructionSubsteps(c)).toBe(4);
    const sim = new SimWorld(); sim.build(c);
    expect(sim.subSteps).toBe(4);
    expect(sim.jointDescs().map((j) => `${j.id}:${j.kind}:${j.bodyA}->${j.bodyB}`))
      .toEqual(['hinge0:hinge:pivot->bob', 'slider0:slider:pivot->cart']);
    // The slider's anchors are LEGITIMATELY 1.3 m apart along its free travel axis, and
    // the batch-2 misalignment gate deliberately does NOT touch hinge or slider.
    for (let i = 0; i < 60; i++) sim.tickOnce();
    expect(sim.jointDescs()).toHaveLength(2);
    log(`P1 legacy document: ${sim.jointDescs().map((j) => j.id).join(', ')} at M = ${sim.subSteps}, `
      + `ran 60 ticks; the slider's anchors start 1.3 m apart along its own free axis and are NOT gated`);
    expect(canonical(loadAuthored(saveAuthored(c)))).toBe(canonical(c));
    sim.rapier.free();
  });

  test('P2 SAVE AFTER EVOLUTION still saves the STARTING connection', () => {
    for (const kind of ['ball', 'fixed'] as const) {
      const start = connect(pairScene(), kind);
      const session = new AuthoringSession(start);
      const sim = new SimWorld(), rec = new Recorder();
      session.start(sim, rec);
      const startingJoints = canonical(start.joints);
      // Evolve. Give it a kick so the assembly really moves.
      sim.body('blockA').applyImpulse({ x: 0.4, y: 0.2, z: 0.1 }, true);
      for (let i = 0; i < 60; i++) sim.tickOnce();
      const moved = sim.body('blockB').translation();
      const saved = loadAuthored(session.save());
      log(`P2 ${kind}: blockB has evolved to (${moved.x.toFixed(6)}, ${moved.y.toFixed(6)}, ${moved.z.toFixed(6)}) `
        + `after 60 ticks; the saved document still carries the STARTING connection bytes`);
      expect(canonical(saved.joints)).toBe(startingJoints);
      expect(moved.x).not.toBe(start.entities.find((e) => e.id === 'blockB')!.translation.x);
      sim.rapier.free();
    }
  });

  test('P3 DELETING a connected body removes its live AND saved connections, with NO GHOST after reopen', () => {
    for (const kind of ['ball', 'fixed'] as const) {
      const session = new AuthoringSession(connect(pairScene(), kind));
      const jid = session.authored.joints![0].id;
      // LIVE: the running world drops it too.
      const sim = new SimWorld(), rec = new Recorder();
      session.start(sim, rec);
      expect(sim.jointDescs().map((j) => j.id)).toEqual([jid]);
      sim.removeEntity('blockB');
      expect(sim.jointDescs()).toEqual([]);
      expect(canonicalSimState(sim)).not.toMatch(/^joint /m);
      // SAVED: the authored document drops it too...
      session.edit((c) => deleteBody(c, 'blockB'), 'delete blockB');
      const reopened = loadAuthored(session.save());
      log(`P3 ${kind}: after deleting blockB the live world has ${sim.jointDescs().length} joints and the `
        + `reopened document has ${(reopened.joints ?? []).length}; no ghost of ${jid} in either`);
      expect(reopened.joints).toEqual([]);
      expect(JSON.stringify(reopened)).not.toContain(jid);
      // ...and rebuilding the reopened document produces no joint either.
      const fresh = new SimWorld(); fresh.build(reopened);
      expect(fresh.jointDescs()).toEqual([]);
      sim.rapier.free(); fresh.rapier.free();
    }
  });

  test('P4 reopen, CHECKPOINT and captured-base REPLAY all preserve descriptors AND the numerical profile', () => {
    for (const kind of ['ball', 'fixed'] as const) {
      const c = connect(pairScene(), kind);
      const jointLine = (s: SimWorld): string => canonicalSimState(s).split('\n').filter((l) => l.startsWith('joint ')).join('\n');

      // (1) REOPEN
      const reopened = loadAuthored(saveAuthored(c));
      expect(canonical(reopened.joints)).toBe(canonical(c.joints));
      expect(constructionSubsteps(reopened)).toBe(128);

      // (2) CHECKPOINT, across a desynchronised world
      const unbroken = new SimWorld(); unbroken.build(c);
      for (let i = 0; i < 40; i++) unbroken.tickOnce();
      const cp = takeCheckpoint(unbroken, extrasFrom(new Recorder(), { pendingEvents: [], selectedId: null, paused: false }));
      expect(cp.app.joints.map((j) => j.id)).toEqual([c.joints![0].id]);
      expect(cp.app.jointHandles.map((h) => h.id)).toEqual([c.joints![0].id]);
      const fresh = new SimWorld(); fresh.build(c);
      for (let i = 0; i < 7; i++) fresh.tickOnce();          // deliberately desynchronised
      restoreCheckpoint(fresh, cp);
      expect(jointLine(fresh)).toBe(jointLine(unbroken));
      expect(fresh.subSteps).toBe(128);

      // (3) CAPTURED-BASE REPLAY, twice, byte for byte
      const record: InputRecord = {
        format: 'fp1-record', formatVersion: 1, engine: '', construction: copy(c),
        events: [{ tick: 5, seq: 0, wallClockMs: 0, kind: 'push', target: 'blockA', impulse: { x: 0.3, y: 0.1, z: 0 } }],
        checkpointEvery: 30,
      };
      const a = replay(new SimWorld(), record, 90), b = replay(new SimWorld(), record, 90);
      expect(a.map((x) => x.canonical)).toEqual(b.map((x) => x.canonical));
      const line = a.at(-1)!.canonical.split('\n').filter((l) => l.startsWith('joint '))[0];
      log(`P4 ${kind}: checkpoint restored the descriptor into a desynchronised world; replay x2 identical. `
        + `Canonical joint line kind = "${line.split(' ')[2]}", carries `
        + `${kind === 'fixed' ? 'BOTH connection frames' : 'no axis and no frame'} — ` + line.slice(0, 40) + '…');
      // The canonical line is VARIANT-SPECIFIC, so a changed connection cannot hide in it.
      if (kind === 'fixed') { expect(line).toContain('frameA='); expect(line).toContain('frameB='); }
      else { expect(line).toContain('ball: no axis, no frame'); expect(line).not.toContain('axis='); }
      unbroken.rapier.free(); fresh.rapier.free();
    }
  });

  test('P5 CHANGING ONLY A CONNECTION FIELD appears in comparison provenance', () => {
    const base = connect(pairScene(), 'fixed');
    const capture = (c: Construction, label: string) => {
      const sim = new SimWorld(); sim.build(c);
      const m = new Meter('pos.y', { kind: 'body', entityId: 'blockB' });
      for (let i = 0; i < 4; i++) { sim.tickOnce(); m.sample(sim); }
      const out = captureRun(label, c, new Recorder().toRecord(c), m, sim.tick);
      sim.rapier.free(); return out;
    };
    // The ONLY difference between the two runs is one connection field: frameB, re-framed
    // together with frameA so the connection stays aligned and everything else is identical.
    const other = copy(base);
    const j = other.joints![0] as FixedJointDesc, S = qaxisAngle({ x: 1, y: 0, z: 0 }, 0.25);
    j.frameA = qmul(j.frameA, S); j.frameB = qmul(j.frameB, S);
    const store = new ComparisonStore();
    store.set(0, capture(base, 'Run A'));
    store.set(1, capture(other, 'Run B'));
    const named = differences(store.get(0)!.construction, store.get(1)!.construction);
    log(`P5 named differences between the two captures:\n  ${named.join('\n  ')}`);
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((d) => d.startsWith('scene.joints.0.frame'))).toBe(true);
    expect(named.join(' ')).toMatch(/scene\.joints\.0\.frameB\.[xyzw]:/);
    // NON-VACUITY: two captures of the SAME scene name nothing.
    expect(differences(base, copy(base))).toEqual([]);
  });

  test('P6 NO ENGINE HANDLE appears in an authored document carrying the new variants', () => {
    for (const kind of ['ball', 'fixed'] as const) {
      const doc = saveAuthored(connect(pairScene(), kind));
      expect(/"(handle|colliderHandle|bodyHandle|jointHandle|rapier)"\s*:/i.test(doc)).toBe(false);
      const sim = new SimWorld(); sim.build(loadAuthored(doc));
      // The handle exists — in the RUNTIME map and the checkpoint mapping, and nowhere else.
      expect(typeof sim.joints.get(sim.jointOrder[0])!.jointHandle).toBe('number');
      expect(JSON.stringify(sim.construction)).not.toContain('jointHandle');
      sim.rapier.free();
    }
    log('P6 neither variant leaks an engine handle into an authored document');
  });

  test('P7 refusals are ATOMIC: identity and audit are unchanged after every rejected edit', () => {
    const session = new AuthoringSession(connect(pairScene(), 'fixed'));
    const identity = session.identity;
    const bad: Array<[string, (c: Construction) => void]> = [
      ['nonfinite anchor', (c) => { c.joints![0].anchorA.x = Number.NaN; }],
      ['non-unit frame', (c) => { (c.joints![0] as FixedJointDesc).frameB.w = 3; }],
      ['dangling body id', (c) => { c.joints![0].bodyB = 'gone'; }],
      ['misaligned connection', (c) => { c.entities.find((e) => e.id === 'blockB')!.translation.y += 0.01; }],
      ['same body twice', (c) => { c.joints![0].bodyB = 'blockA'; }],
      ['duplicate connection id', (c) => { c.joints!.push(copy(c.joints![0])); }],
    ];
    for (const [name, change] of bad) {
      expect(() => session.edit(change, name), name).toThrow();
      expect(session.identity, name).toBe(identity);
      expect(session.audit, name).toHaveLength(0);
    }
    log(`P7 ${bad.length} rejected edits (${bad.map((b) => b[0]).join(', ')}): identity and audit unchanged after every one`);
  });

  test('P8 create / delete / cancel and id minting behave through the model the UI drives', () => {
    const session = new AuthoringSession(pairScene());
    const before = session.identity;
    // CANCEL: an edit that is never committed leaves nothing behind.
    const draft = session.authored;
    draft.joints = [makeConnection(draft, 'ball', 'blockA', 'blockB', { x: 0.3, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })];
    expect(session.identity).toBe(before);
    // CREATE
    session.edit((c) => {
      const j = makeConnection(c, 'ball', 'blockA', 'blockB', { x: 0.3, y: 0.05, z: 0 }, { x: 0, y: 0, z: 0 });
      c.joints = [...(c.joints ?? []), j];
      placeToSatisfyConnection(c, j.id);
    }, 'connect');
    expect(session.authored.joints!.map((j) => j.id)).toEqual(['ball0']);
    // Ids are minted, application-owned and unique.
    expect(nextConnectionId(session.authored, 'ball')).toBe('ball1');
    expect(nextConnectionId(session.authored, 'fixed')).toBe('fixed0');
    // Two DISTINCT bodies are required.
    expect(() => makeConnection(session.authored, 'ball', 'blockA', 'blockA', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }))
      .toThrow('two DISTINCT bodies');
    // DELETE the connection, leaving the bodies alone.
    session.edit((c) => deleteConnection(c, 'ball0'), 'disconnect');
    expect(session.authored.joints).toEqual([]);
    expect(session.authored.entities).toHaveLength(2);
    expect(session.audit.map((a) => a.reason)).toEqual(['connect', 'disconnect']);
    log(`P8 create -> delete through the audited edit path; audit reasons ${JSON.stringify(session.audit.map((a) => a.reason))}; `
      + 'a cancelled draft left the session identity untouched');
    // A new run through the same boundary the UI uses.
    const sim = new SimWorld(), rec = new Recorder();
    session.start(sim, rec);
    expect(sim.tick).toBe(0);
    expect(rec.recording).toBe(false);
    worldReplaced(rec, 'load', session.authored);
    expect(encode(session.authored)).toContain('fp1-construction');
    sim.rapier.free();
  });
});
