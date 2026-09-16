/**
 * FP1 — expectations D from EXPECTATIONS.md (sha256 d55e4ee0…).
 *
 * PHYSICAL DRIFT AND REPLAY DIVERGENCE ARE SEPARATE CRITERIA. Nothing here is a
 * tolerance comparison — and, since the FP1 return, nothing here is a HASH
 * comparison either. `stateHash` is a 32-bit FNV fingerprint of SELECTED fields;
 * it omits environment, budget, pending input and recorder state, and 32 bits
 * collide. Exactness is decided on `canonicalSimState` / `canonicalAppState`:
 * the declared replay state, every number written as its IEEE-754 bit pattern,
 * compared BYTE FOR BYTE. The scope of that claim is declared in
 * REPLAY_STATE_SCOPE and asserted below. No bit-identical whole-engine-memory
 * claim is made anywhere.
 *
 * Determinism is claimed ONLY for: the same pinned engine build, the same
 * initialized state, the same insertion/removal order, the same input record, on
 * the one named test machine and browser.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { SimWorld, canonicalSimState, REPLAY_STATE_SCOPE } from './world';
import {
  Recorder, applyDue, applyEvent, canonicalAppState, extrasFrom, replay, sortEvents,
  takeCheckpoint, restoreCheckpoint, worldReplaced,
  type CheckpointExtras, type InputEvent, type InputRecord,
} from './record';
import { cloneConstruction, defaultConstruction, parseConstruction, type EntityDesc } from '../model/construction';

beforeAll(async () => { await SimWorld.initEngine(); });

const Q_ID = { x: 0, y: 0, z: 0, w: 1 };
const V0 = { x: 0, y: 0, z: 0 };

function newBlock(id: string, x: number, y: number, z: number): EntityDesc {
  return {
    id, label: id, kinematics: 'dynamic',
    shape: { kind: 'box', hx: 0.13, hy: 0.13, hz: 0.13 },
    material: { mass: 1.2, restitution: 0.1, friction: 0.6 },
    translation: { x, y, z }, rotation: Q_ID, linvel: V0, angvel: V0, colour: 0x88cc88,
  };
}

/** A session exercising EVERY intervention kind the plan names. */
function session(): InputRecord {
  type EvBody = InputEvent extends infer T ? (T extends InputEvent ? Omit<T, 'tick' | 'seq' | 'wallClockMs'> : never) : never;
  const ev = (tick: number, seq: number, e: EvBody): InputEvent =>
    ({ tick, seq, wallClockMs: 1_700_000_000_000 + tick * 17, ...e } as InputEvent);
  const events: InputEvent[] = [
    ev(30, 0, { kind: 'push', target: 'stack2', impulse: { x: 0.8, y: 0, z: 0.2 } }),
    ev(60, 0, { kind: 'addBlock', target: 'add1', entity: newBlock('add1', -0.6, 1.6, -0.3) }),
    ev(60, 1, { kind: 'addBlock', target: 'add2', entity: newBlock('add2', 0.5, 1.9, 0.2) }),
    ev(90, 0, { kind: 'setMass', target: 'loose0', mass: 4.0 }),
    ev(120, 0, { kind: 'setStiffness', target: 'spring0', stiffness: 1500 }),
    ev(120, 1, { kind: 'setStiffness', target: 'spring3', stiffness: 400 }),
    ev(150, 0, { kind: 'push', target: 'platform', impulse: { x: 0, y: 6, z: 0 }, point: { x: 0.8, y: 0.9, z: 0.5 } }),
    ev(180, 0, { kind: 'removeBlock', target: 'stack0' }),
    ev(240, 0, { kind: 'setEnvironment', target: 'world', medium: 'vacuum' }),
    ev(300, 0, { kind: 'setDamping', target: 'spring1', damping: 40 }),
    ev(330, 0, { kind: 'addBlock', target: 'add3', entity: newBlock('add3', 0.0, 2.2, 0.0) }),
    ev(360, 0, { kind: 'setEnvironment', target: 'world', medium: 'air' }),
    ev(420, 0, { kind: 'push', target: 'add1', impulse: { x: -1.5, y: 1.0, z: 0 } }),
    ev(480, 0, { kind: 'removeBlock', target: 'add2' }),
  ];
  return {
    format: 'fp1-record', formatVersion: 1,
    engine: 'set-at-run-time',
    construction: defaultConstruction(),
    events, checkpointEvery: 60,
  };
}

describe('D — replay and restore', () => {
  test('D1 replay twice -> identical at every checkpoint', () => {
    const rec = session();
    const a = replay(new SimWorld(), rec, 600);
    const b = replay(new SimWorld(), rec, 600);
    console.log(`D1: ${a.length} checkpoints, ticks ${a.map((c) => c.tick).join(',')}`);
    console.log(`D1: run A hashes ${a.map((c) => c.hash.split(':')[0]).join(' ')}`);
    console.log(`D1: run B hashes ${b.map((c) => c.hash.split(':')[0]).join(' ')}`);
    expect(a.length).toBe(11);
    let bytes = 0;
    for (let i = 0; i < a.length; i++) {
      expect(b[i].tick).toBe(a[i].tick);
      expect(b[i].canonical).toBe(a[i].canonical);   // BYTE FOR BYTE, declared scope
      bytes += a[i].canonical.length;
    }
    console.log(`D1: compared ${bytes} bytes of canonical declared replay state, not ${a.length} 32-bit hashes`);
    // The session really did exercise add/remove: the body set changed.
    expect(a[0].hash.split(':')[1]).not.toBe(a[10].hash.split(':')[1]);
  });

  test('D2 snapshot / restore / continue -> identical to the unbroken run', () => {
    const rec = session();
    const queue = sortEvents(rec.events);

    // (i) unbroken run to 600, recording a hash every 60 ticks
    const unbroken = new SimWorld();
    unbroken.build(rec.construction);
    const unbrokenHashes = new Map<number, string>();
    for (let i = 0; i < 600; i++) {
      applyDue(unbroken, queue);
      unbroken.tickOnce();
      if (unbroken.tick % 60 === 0) unbrokenHashes.set(unbroken.tick, canonicalSimState(unbroken));
    }

    // (ii) run to 300, take a checkpoint, restore into a FRESH world, continue
    const broken = new SimWorld();
    broken.build(rec.construction);
    for (let i = 0; i < 300; i++) { applyDue(broken, queue); broken.tickOnce(); }
    const canonical300 = canonicalSimState(broken);
    const cp = takeCheckpoint(broken, {
      pendingEvents: queue.filter((e) => e.tick >= broken.tick),
      selectedId: 'platform',
      settings: { paused: false, recording: true },
      seqCounter: 7,
      recordedEvents: queue.filter((e) => e.tick < broken.tick),
      recordingBase: rec.construction,
    });
    console.log(`D2: checkpoint at tick ${cp.app.tick}, solver blob ${cp.solverSnapshotBase64.length} b64 chars, ${cp.app.handles.length} handle mappings`);

    const fresh = new SimWorld();
    fresh.build(rec.construction);                 // a different world entirely
    for (let i = 0; i < 47; i++) fresh.tickOnce(); // deliberately desynchronised
    const extras = restoreCheckpoint(fresh, cp);

    // D4 — APPLICATION state came back, not just engine state
    expect(fresh.tick).toBe(300);
    expect(canonicalSimState(fresh)).toBe(canonical300);
    expect(fresh.nextSerial).toBe(broken.nextSerial);
    expect(fresh.order).toEqual(broken.order);
    expect(extras.selectedId).toBe('platform');
    expect(extras.settings).toEqual({ paused: false, recording: true });
    expect(extras.seqCounter).toBe(7);
    expect(extras.pendingEvents.length).toBe(queue.filter((e) => e.tick >= 300).length);
    expect(fresh.budget.interventionsTotal).toBeCloseTo(broken.budget.interventionsTotal, 12);
    expect(fresh.budget.interventions.length).toBe(broken.budget.interventions.length);
    console.log(`D4: tick ${fresh.tick}, nextSerial ${fresh.nextSerial}, ${fresh.order.length} bodies, ${extras.pendingEvents.length} pending events, ${fresh.budget.interventions.length} interventions restored`);

    // continue from the restored state using the restored queue
    const restoredQueue = sortEvents(extras.pendingEvents);
    let mismatches = 0;
    for (let i = 0; i < 300; i++) {
      applyDue(fresh, restoredQueue);
      fresh.tickOnce();
      if (fresh.tick % 60 === 0) {
        const want = unbrokenHashes.get(fresh.tick)!;
        const got = canonicalSimState(fresh);
        if (want !== got) mismatches++;
        console.log(`D2: tick ${fresh.tick}  ${want.length} canonical bytes  ${want === got ? 'MATCH' : 'DIVERGED'}`);
        expect(got).toBe(want);   // BYTE FOR BYTE over the declared scope
      }
    }
    expect(mismatches).toBe(0);
  });

  test('D4b the application half of a checkpoint round-trips independently of the engine half', () => {
    const sim = new SimWorld();
    sim.build(defaultConstruction());
    for (let i = 0; i < 25; i++) sim.tickOnce();
    const minted = [sim.mintId(), sim.mintId(), sim.mintId()];
    expect(minted).toEqual(['b1', 'b2', 'b3']);
    const pending: InputEvent[] = [
      { tick: 900, seq: 0, wallClockMs: 0, kind: 'push', target: 'platform', impulse: { x: 1, y: 2, z: 3 } },
    ];
    const cp = takeCheckpoint(sim, {
      pendingEvents: pending, selectedId: 'stack1', settings: { paused: true, recording: false },
      seqCounter: 12, recordedEvents: [], recordingBase: null,
    });

    const other = new SimWorld();
    other.build(defaultConstruction());
    const extras = restoreCheckpoint(other, cp);
    expect(other.nextSerial).toBe(4);
    expect(other.mintId()).toBe('b4');           // the counter really continued
    expect(extras.pendingEvents).toEqual(pending);
    expect(extras.selectedId).toBe('stack1');
    expect(extras.settings).toEqual({ paused: true, recording: false });
    expect(extras.seqCounter).toBe(12);
    expect(other.springs.map((s) => s.stiffness)).toEqual(sim.springs.map((s) => s.stiffness));
    console.log(`D4b: nextSerial ${other.nextSerial}, pending ${extras.pendingEvents.length}, selection ${extras.selectedId}, settings ${JSON.stringify(extras.settings)} all restored`);
  });

  test('D3 saved authored content contains NO engine handle', () => {
    const sim = new SimWorld();
    sim.build(defaultConstruction());
    for (let i = 0; i < 30; i++) sim.tickOnce();
    const json = JSON.stringify(sim.construction, null, 2);
    expect(json).not.toMatch(/"(handle|colliderHandle|bodyHandle)"\s*:/);
    expect(json).not.toMatch(/rapier/i);
    expect(() => parseConstruction(json)).not.toThrow();
    // and the guard actually bites
    expect(() => parseConstruction(json.replace('"name"', '"bodyHandle": 3, "name"'))).toThrow(/engine handle/);
    console.log(`D3: construction JSON ${json.length} chars, no engine handle present; guard verified to reject one`);
  });
});

/**
 * R-8 — THE CHECKPOINT / RECORD LIFECYCLE DEFECT.
 *
 * Found by source inspection, missed by every test that existed: the checkpoint
 * carried `settings.recording` and `seqCounter` but NOT `recorder.events`, so a
 * restore rewound the world and the counter while leaving the recorded history
 * holding events that belonged to the discarded future — and the next event then
 * reused a sequence number that was still live in that history.
 */
describe('R-8 — rewind rewinds the RECORD, not just the world', () => {
  /** The minimal app: a world, a recorder, a pending queue. */
  function harness() {
    const sim = new SimWorld();
    const recorder = new Recorder();
    sim.build(defaultConstruction());
    recorder.begin(sim.construction);
    const pending: InputEvent[] = [];
    const fire = (kind: 'push', target: string, impulse: { x: number; y: number; z: number }): InputEvent => {
      const e: InputEvent = { tick: sim.tick, seq: recorder.nextSeq(), wallClockMs: 0, kind, target, impulse };
      expect(applyEvent(sim, e)).toBeNull();
      recorder.record(e);
      return e;
    };
    const runTo = (t: number): void => { while (sim.tick < t) sim.tickOnce(); };
    return { sim, recorder, pending, fire, runTo };
  }

  test('R-8a/b record A, checkpoint, record B, restore -> B is gone with its future, and a FRESH app has A', () => {
    const h = harness();
    h.runTo(30);
    const A = h.fire('push', 'stack2', { x: 0.8, y: 0, z: 0.2 });
    expect(A.seq).toBe(0);

    h.runTo(60);
    const cp = takeCheckpoint(h.sim, extrasFrom(h.recorder, { pendingEvents: h.pending, selectedId: 'platform', paused: false }));
    const canonicalAt60 = canonicalSimState(h.sim);
    expect(cp.app.recordedEvents.length).toBe(1);
    expect(cp.app.recordingBase).not.toBeNull();

    h.runTo(90);
    const B = h.fire('push', 'loose0', { x: 0, y: 1.5, z: 0 });
    expect(B.seq).toBe(1);
    expect(h.recorder.events.length).toBe(2);

    // ---- restore ----
    const extras = restoreCheckpoint(h.sim, cp);
    h.recorder.adopt(extras);

    // R-8a: the history is exactly [A]; B went with the future it belonged to.
    console.log(`R-8a after restore: tick ${h.sim.tick}, history ${h.recorder.events.length} event(s) `
      + `[${h.recorder.events.map((e) => `${e.kind}@${e.tick}.${e.seq}`).join(', ')}], next seq ${h.recorder.seq}`);
    expect(h.sim.tick).toBe(60);
    expect(h.recorder.events).toEqual([A]);
    expect(h.recorder.events.some((e) => e.seq === B.seq)).toBe(false);
    // and the next minted seq is B's old number, now genuinely free
    expect(h.recorder.seq).toBe(1);
    expect(h.recorder.nextSeq()).toBe(B.seq);

    // R-8b: a FRESH app restoring the same checkpoint holds A too, and the base.
    const fresh = new SimWorld();
    fresh.build(defaultConstruction());
    const freshRec = new Recorder();
    const fx = restoreCheckpoint(fresh, cp);
    freshRec.adopt(fx);
    console.log(`R-8b fresh app: ${freshRec.events.length} event(s), base "${freshRec.base?.name}", recording ${String(freshRec.recording)}`);
    expect(freshRec.events).toEqual([A]);
    expect(freshRec.recording).toBe(true);
    expect(freshRec.base).toEqual(cloneConstruction(defaultConstruction()));

    // R-8c: replaying the restored record reproduces the checkpointed continuation.
    const rec = freshRec.toRecord(freshRec.base!, 60);
    const cps = replay(new SimWorld(), rec, 60);
    const last = cps[cps.length - 1];
    console.log(`R-8c replay of the restored record to tick ${last.tick}: `
      + `${last.canonical === canonicalAt60 ? 'IDENTICAL' : 'DIVERGED'} to the checkpointed state (${last.canonical.length} bytes)`);
    expect(last.tick).toBe(60);
    expect(last.canonical).toBe(canonicalAt60);
  });

  test('R-8d loading a construction drops pending replay events and terminates recording', () => {
    const h = harness();
    h.runTo(10);
    h.fire('push', 'stack2', { x: 0.5, y: 0, z: 0 });
    h.pending.push({ tick: 500, seq: 0, wallClockMs: 0, kind: 'removeBlock', target: 'stack0' });
    expect(h.recorder.recording).toBe(true);

    const loaded = defaultConstruction();
    loaded.name = 'something the recording never ran against';
    const lc = worldReplaced(h.recorder, 'load', loaded);
    console.log(`R-8d ${lc.note}`);
    expect(lc.pending).toEqual([]);                 // no stale event can reach the new world
    expect(h.recorder.recording).toBe(false);       // honest semantics, stated in the UI
    expect(h.recorder.events).toEqual([]);
    expect(h.recorder.base).toBeNull();
    expect(lc.note).toMatch(/TERMINATED/);
  });

  test('R-8e reset while recording leaves history, counter and base coherent with a tick-0 world', () => {
    const h = harness();
    h.runTo(40);
    h.fire('push', 'stack2', { x: 0.5, y: 0, z: 0 });
    h.fire('push', 'loose0', { x: 0, y: 1, z: 0 });
    expect(h.recorder.seq).toBe(2);

    const fresh = defaultConstruction();
    h.sim.build(fresh);
    const lc = worldReplaced(h.recorder, 'reset', fresh);
    console.log(`R-8e ${lc.note}; tick ${h.sim.tick}, history ${h.recorder.events.length}, next seq ${h.recorder.seq}`);
    expect(lc.pending).toEqual([]);
    expect(h.recorder.recording).toBe(true);        // the recording survives the reset
    expect(h.recorder.events).toEqual([]);          // but nothing in it outlives the old world
    expect(h.recorder.seq).toBe(0);
    expect(h.recorder.base).not.toBeNull();
    for (const e of h.recorder.events) expect(e.tick).toBeLessThan(h.sim.tick);
  });
});

/**
 * R-9 — WHAT THE EXACTNESS CLAIM COVERS, AND WHAT IT DOES NOT.
 */
describe('R-9 — the exactness comparison and its declared scope', () => {
  function stateAt(ticks: number): { sim: SimWorld; extras: CheckpointExtras } {
    const sim = new SimWorld();
    sim.build(defaultConstruction());
    for (let i = 0; i < ticks; i++) sim.tickOnce();
    const rec = new Recorder();
    rec.begin(sim.construction);
    rec.record({ tick: 5, seq: 0, wallClockMs: 0, kind: 'push', target: 'stack1', impulse: { x: 1, y: 0, z: 0 } });
    const extras = extrasFrom(rec, {
      pendingEvents: [{ tick: 99, seq: 0, wallClockMs: 0, kind: 'removeBlock', target: 'stack0' }],
      selectedId: 'platform', paused: false,
    });
    return { sim, extras };
  }

  test('R-9b/c a targeted mutation of state INSIDE the promised contract is detected', () => {
    const undetectedByHash: string[] = [];
    const cases: Array<[string, (s: SimWorld, x: CheckpointExtras) => void]> = [
      ['environment.medium', (s) => { s.construction.environment.medium = 'vacuum'; }],
      ['budget.dissipatedDrag', (s) => { s.budget.dissipatedDrag += 1e-12; }],
      ['budget.unattributed', (s) => { s.budget.unattributed = -s.budget.unattributed; }],
      ['foreignAccumulatorWrites', (s) => { s.foreignAccumulatorWrites += 1; }],
      ['spring damping', (s) => { s.springs[2].damping += 1e-9; }],
      ['pending event', (_s, x) => { x.pendingEvents[0] = { ...x.pendingEvents[0], tick: 100 }; }],
      ['recorded event', (_s, x) => { x.recordedEvents[0] = { ...x.recordedEvents[0], seq: 4 }; }],
      ['seqCounter', (_s, x) => { x.seqCounter += 1; }],
      ['selectedId', (_s, x) => { x.selectedId = 'stack1'; }],
      ['settings.recording', (_s, x) => { x.settings.recording = !x.settings.recording; }],
      ['recordingBase', (_s, x) => { if (x.recordingBase) x.recordingBase.name = 'tampered'; }],
    ];
    for (const [label, mutate] of cases) {
      const a = stateAt(30), b = stateAt(30);
      const simBefore = canonicalSimState(a.sim), appBefore = canonicalAppState(a.extras);
      expect(canonicalSimState(b.sim)).toBe(simBefore);        // identical before mutation
      expect(canonicalAppState(b.extras)).toBe(appBefore);
      const hashBefore = b.sim.stateHash();
      mutate(b.sim, b.extras);
      const changed = canonicalSimState(b.sim) !== simBefore || canonicalAppState(b.extras) !== appBefore;
      const hashChanged = b.sim.stateHash() !== hashBefore;
      if (!hashChanged) undetectedByHash.push(label);
      console.log(`R-9b ${label.padEnd(26)} canonical: ${changed ? 'DETECTED' : 'MISSED'}   32-bit stateHash: ${hashChanged ? 'detected' : 'MISSED'}`);
      expect(changed).toBe(true);                              // R-9b
    }
    // R-9c — the evidence that the old hash-based claim was an overreach.
    console.log(`R-9c the 32-bit stateHash MISSED ${undetectedByHash.length} of ${cases.length}: ${undetectedByHash.join(', ')}`);
    expect(undetectedByHash.length).toBeGreaterThan(0);
  });

  test('R-9d the declared scope is stated, and the engine-blob comparison is reported either way', () => {
    console.log(`R-9  IN scope (sim): ${REPLAY_STATE_SCOPE.simIn.join(' | ')}`);
    console.log(`R-9  IN scope (app): ${REPLAY_STATE_SCOPE.appIn.join(' | ')}`);
    console.log(`R-9  OUT of scope, never claimed: ${REPLAY_STATE_SCOPE.out.join(' | ')}`);
    expect(REPLAY_STATE_SCOPE.out.length).toBeGreaterThan(0);

    // The strongest engine-level statement we attempt: Rapier's own snapshot blob,
    // byte for byte, between two identical replays. It is REPORTED, not required.
    const rec = session();
    const a = new SimWorld(); a.build(rec.construction);
    const b = new SimWorld(); b.build(rec.construction);
    const q = sortEvents(rec.events);
    for (let i = 0; i < 120; i++) { applyDue(a, q); a.tickOnce(); applyDue(b, q); b.tickOnce(); }
    const sa = a.rapier.takeSnapshot(), sb = b.rapier.takeSnapshot();
    let same = sa.length === sb.length;
    if (same) for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) { same = false; break; }
    console.log(`R-9d engine snapshot blob, two replays to tick 120: ${sa.length} vs ${sb.length} bytes, `
      + `${same ? 'BYTE-IDENTICAL' : 'DIFFERENT (reported; no whole-memory claim is made or needed)'}`);
    expect(sa.length).toBeGreaterThan(0);
  });
});
