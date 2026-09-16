/**
 * FP1 — input recording, replay, and the durable boundary.  (plan §4)
 *
 * ===========================================================================
 * INPUT RECORDS ARE KEYED BY SIMULATION TICK PLUS A DETERMINISTIC WITHIN-TICK
 * SEQUENCE. NEVER BY WALL-CLOCK TIME.
 * ===========================================================================
 * A wall-clock timestamp is carried only as a non-authoritative annotation
 * (`wallClockMs`) for human reading; the replay engine never looks at it and
 * `applyDue()` sorts strictly by (tick, seq). Two events in the same tick always
 * replay in the same order because `seq` is a monotonic counter minted at record
 * time, not a hash of anything time-dependent.
 *
 * Every event below is an INTERVENTION: add, remove, mass edit, stiffness edit,
 * damping edit, push, environment change. Each is booked through
 * `SimWorld.intervene`, which measures the change in resolved mechanical energy
 * across the frozen edit, so ITS ENERGY EFFECT CAN NEVER BE MISTAKEN FOR SOLVER
 * DRIFT.
 *
 * ===========================================================================
 * A CONSTRUCTION AND A SOLVER CHECKPOINT ARE DIFFERENT ARTIFACTS.
 * ===========================================================================
 *   - `Construction`  (model/construction.ts): authored content. Versioned JSON.
 *                     NO RAPIER HANDLE APPEARS IN IT, EVER.
 *   - `Checkpoint`    (here): a Rapier snapshot BLOB *plus* the application state
 *                     needed to keep going — ids and their handle mappings, the
 *                     serial counter, the pending command queue, spring
 *                     definitions, settings, selection, and the energy budget.
 *     RESTORE COVERS ENGINE STATE **AND** APPLICATION STATE. Restoring only the
 *     engine would silently reset the id counter and lose the input queue, and
 *     the continuation would then diverge from the unbroken run.
 *
 * DETERMINISM IS CLAIMED ONLY FOR: the same pinned engine build, the same
 * initialized state, the same insertion/removal order, the same input record, on
 * the one named test machine and browser. No visual-determinism claim and no
 * cross-version claim is made.
 */

import type { EntityDesc, ShapeDesc, SpringDesc } from '../model/construction';
import {
  cloneConstruction, resolvabilityIssues, validateEntity, validateSpring,
  type Construction, type NumericsDesc,
} from '../model/construction';
import type { JointDesc } from '../model/joints';
import { LIMITS, vlen } from '../model/units';
import type { EnergyBudget } from '../model/energy';
import { RAPIER, canonicalSimState, f64hex, type SimWorld } from './world';
import { cloneHandState, type HandGestureRow, type HandState, type HandTickRow } from './hand';

export const RECORD_FORMAT_VERSION = 1 as const;
export const CHECKPOINT_FORMAT_VERSION = 1 as const;

export type InputEvent =
  | { tick: number; seq: number; wallClockMs: number; kind: 'push'; target: string; impulse: { x: number; y: number; z: number };
      /** World-frame point of application. Omitted => applied at the centre of mass. */
      point?: { x: number; y: number; z: number } }
  | { tick: number; seq: number; wallClockMs: number; kind: 'setMass'; target: string; mass: number }
  | { tick: number; seq: number; wallClockMs: number; kind: 'setStiffness'; target: string; stiffness: number }
  | { tick: number; seq: number; wallClockMs: number; kind: 'setDamping'; target: string; damping: number }
  | { tick: number; seq: number; wallClockMs: number; kind: 'addBlock'; target: string; entity: EntityDesc }
  | { tick: number; seq: number; wallClockMs: number; kind: 'removeBlock'; target: string }
  | { tick: number; seq: number; wallClockMs: number; kind: 'setEnvironment'; target: string; medium: 'air' | 'vacuum' }
  /**
   * BB1: GRAVITY EDITING AS A RECORDED INTERVENTION. An ordinary
   * (tick, seq)-keyed event like every other edit, booked through
   * `SimWorld.intervene` so the potential-energy change it causes under the
   * declared, FIXED datum is attributed to it rather than appearing as drift.
   */
  | { tick: number; seq: number; wallClockMs: number; kind: 'setGravity'; target: string;
      gravity: { x: number; y: number; z: number } }
  // ---- DM1: direct manipulation. RESOLVED WORLD-SPACE INPUT ONLY. -----------
  // No screen coordinate, NDC value, ray, drag-plane normal or camera parameter
  // appears in any of the three. The drag plane lives in the UI and resolves the
  // pointer to a world point BEFORE it can become an event; raw pixels and the
  // camera therefore cannot drive replay physics even in principle.
  | { tick: number; seq: number; wallClockMs: number; kind: 'grabBegin'; target: string;
      /** BODY-LOCAL attachment point, m. */
      localPoint: { x: number; y: number; z: number };
      /** Resolved WORLD-SPACE target, m. */
      worldTarget: { x: number; y: number; z: number } }
  | { tick: number; seq: number; wallClockMs: number; kind: 'grabMove'; target: string;
      worldTarget: { x: number; y: number; z: number } }
  | { tick: number; seq: number; wallClockMs: number; kind: 'grabEnd'; target: string };

export interface InputRecord {
  format: 'fp1-record';
  formatVersion: typeof RECORD_FORMAT_VERSION;
  engine: string;
  construction: Construction;
  events: InputEvent[];
  /** Ticks at which a determinism checkpoint hash was captured. */
  checkpointEvery: number;
}

export interface Checkpoint {
  format: 'fp1-checkpoint';
  formatVersion: typeof CHECKPOINT_FORMAT_VERSION;
  engine: string;
  /** ENGINE STATE. Base64 of the Rapier snapshot blob. Opaque to the application. */
  solverSnapshotBase64: string;
  /** APPLICATION STATE. Everything else that affects the future. */
  app: {
    tick: number;
    nextSerial: number;
    order: string[];
    /** id -> engine handles. Lives HERE, in the checkpoint, never in a construction. */
    handles: Array<{ id: string; bodyHandle: number; colliderHandle: number }>;
    entities: EntityDesc[];
    springs: SpringDesc[];
    /** AUTHORED joints, and the id -> engine-handle mapping. The mapping lives HERE. */
    joints: JointDesc[];
    jointHandles: Array<{ id: string; jointHandle: number }>;
    environment: Construction['environment'];
    thermal?: import('../model/thermal').ThermalState;
    /**
     * THE AUTHORED CIRCUIT and the RUNTIME ELECTRICAL ACCOUNTS. The accounts —
     * supplied energy, per-resistor dissipation, the routing ledger, the outgoing
     * unrouted total — are transient runtime state: they belong in a checkpoint
     * and they NEVER appear in an authored construction. A restore that dropped
     * them would silently restart a heated circuit's energies at zero.
     */
    circuit?: Construction['circuit'];
    electrical?: import('../model/circuit').ElectricalState;
    budget: EnergyBudget;
    foreignAccumulatorWrites: number;
    /**
     * TRANSIENT HAND STATE. **A CHECKPOINT INCLUDES IT; A CONSTRUCTION NEVER
     * DOES.** A mid-grab restore that dropped the hand would silently release the
     * body and diverge from the unbroken run — so it is carried here, together
     * with the bounded display buffers so a restored session also LOOKS right.
     */
    hand: HandState;
    handTickHistory: HandTickRow[];
    handGestureHistory: HandGestureRow[];
    pendingEvents: InputEvent[];
    selectedId: string | null;
    settings: { paused: boolean; recording: boolean };
    seqCounter: number;
    /**
     * THE RECORDED HISTORY BEHIND THIS CHECKPOINT, and the construction it
     * replays against.
     *
     * These were MISSING and it was a real defect, not a cosmetic one: a restore
     * rewound the world and the seq counter but left `recorder.events` holding
     * events whose future had just been discarded, so the next event reused a
     * live sequence number and a fresh app restoring the same checkpoint had no
     * history at all. See D-9 in DEVIATIONS.md.
     */
    recordedEvents: InputEvent[];
    recordingBase: Construction | null;
    /**
     * THE DECLARED NUMERICAL PROFILE the run was on. Optional so a checkpoint
     * written before profiles existed still restores — and it restores to the
     * LEGACY M = 4, which is what it was written under.
     */
    numerics?: NumericsDesc | null;
  };
}

// ---------------------------------------------------------------------------

/**
 * THE RECORDING LIFECYCLE.
 *
 * A recording is three things that must stay coherent with each other AND with
 * the world: the BASE construction it started from, the HISTORY of events keyed
 * by (tick, seq), and the seq COUNTER that mints the next key. Rewinding the
 * world without rewinding all three produces events that belong to a discarded
 * future, and sequence numbers that are reused while still live.
 */
export class Recorder {
  events: InputEvent[] = [];
  recording = false;
  /** The construction the current history replays against. Null when not recording. */
  base: Construction | null = null;
  private seqCounter = 0;

  reset(): void { this.events.length = 0; this.seqCounter = 0; this.base = null; }
  get seq(): number { return this.seqCounter; }
  set seq(v: number) { this.seqCounter = v; }

  /** Mint the next deterministic within-tick sequence number. */
  nextSeq(): number { return this.seqCounter++; }

  record(e: InputEvent): void { if (this.recording) this.events.push(e); }

  /** Start a recording against a world that is at tick 0 of `base`. */
  begin(base: Construction): void {
    this.events.length = 0;
    this.seqCounter = 0;
    this.base = cloneConstruction(base);
    this.recording = true;
  }

  stop(): void { this.recording = false; }

  /**
   * The world was replaced under a live recording (reset). The history and the
   * counter go back to tick 0 with it; nothing may survive that refers to ticks
   * the new world has not reached.
   */
  rebase(base: Construction): void {
    this.events.length = 0;
    this.seqCounter = 0;
    this.base = cloneConstruction(base);
  }

  /** Adopt a restored history wholesale. Used by checkpoint restore. */
  adopt(x: {
    recordedEvents: InputEvent[]; recordingBase: Construction | null;
    seqCounter: number; settings: { recording: boolean };
  }): void {
    this.events = JSON.parse(JSON.stringify(x.recordedEvents)) as InputEvent[];
    this.base = x.recordingBase ? cloneConstruction(x.recordingBase) : null;
    this.seqCounter = x.seqCounter;
    this.recording = x.settings.recording;
  }

  toRecord(construction: Construction, checkpointEvery = 60): InputRecord {
    return {
      format: 'fp1-record',
      formatVersion: RECORD_FORMAT_VERSION,
      engine: `@dimforge/rapier3d-compat@${RAPIER.version()}`,
      construction: cloneConstruction(construction),
      events: JSON.parse(JSON.stringify(this.events)) as InputEvent[],
      checkpointEvery,
    };
  }
}

/**
 * THE WORLD WAS REPLACED (construction load, or reset). Everything that referred
 * to the old world's future must go, coherently and visibly:
 *   - pending replay events are DROPPED — an old replay must not be able to
 *     mutate a newly loaded construction;
 *   - a live recording is either REBASED onto the new world at tick 0 (`reset`,
 *     where the new world is the recording's own base) or TERMINATED (`load`,
 *     where it is not) — never left running against a history it no longer
 *     matches.
 * Returns the human-readable consequence so the UI can state it rather than
 * silently changing meaning underneath the user.
 */
export function worldReplaced(
  recorder: Recorder,
  mode: 'reset' | 'load',
  newBase: Construction,
): { pending: InputEvent[]; note: string } {
  if (!recorder.recording) {
    recorder.base = null;
    recorder.events.length = 0;
    recorder.seq = 0;
    return { pending: [], note: 'pending replay events cleared' };
  }
  if (mode === 'reset') {
    const n = recorder.events.length;
    recorder.rebase(newBase);
    return { pending: [], note: `recording continues, history rebased to tick 0 (${n} event${n === 1 ? '' : 's'} discarded with the old run)` };
  }
  const n = recorder.events.length;
  recorder.stop();
  recorder.events.length = 0;
  recorder.seq = 0;
  recorder.base = null;
  return { pending: [], note: `RECORDING TERMINATED: the loaded construction is not the base this recording replays against (${n} event${n === 1 ? '' : 's'} dropped)` };
}

/** Strict (tick, seq) ordering. Wall clock is never consulted. */
export function sortEvents(events: InputEvent[]): InputEvent[] {
  return [...events].sort((a, b) => (a.tick - b.tick) || (a.seq - b.seq));
}

export interface ApplyResult { applied: number; refused: string[]; }

/**
 * Apply every event due at `sim.tick`, in (tick, seq) order, each booked as an
 * intervention. Called at the START of a tick, before forces are rebuilt.
 */
export function applyDue(sim: SimWorld, queue: InputEvent[]): ApplyResult {
  const refused: string[] = [];
  let applied = 0;
  const due = queue.filter((e) => e.tick === sim.tick).sort((a, b) => a.seq - b.seq);
  for (const e of due) {
    const r = applyEvent(sim, e);
    if (r) refused.push(r); else applied++;
  }
  return { applied, refused };
}

/** Returns null on success, or a refusal message. Refusals are surfaced, not clamped. */
export function applyEvent(sim: SimWorld, e: InputEvent): string | null {
  switch (e.kind) {
    case 'push': {
      if (!sim.entities.has(e.target)) return `push: no entity ${e.target}`;
      const where = e.point ? ` at point (${e.point.x}, ${e.point.y}, ${e.point.z})` : ' at centre of mass';
      sim.intervene('push', e.target, e.seq, `impulse (${e.impulse.x}, ${e.impulse.y}, ${e.impulse.z}) N·s${where}`, () => {
        const b = sim.body(e.target);
        if (e.point) b.applyImpulseAtPoint(e.impulse, e.point, true);
        else b.applyImpulse(e.impulse, true);
      });
      return null;
    }
    case 'setMass': {
      const rt = sim.entities.get(e.target);
      if (!rt) return `setMass: no entity ${e.target}`;
      const candidate: EntityDesc = { ...rt.desc, material: { ...rt.desc.material, mass: e.mass } };
      const issues = validateEntity(candidate, sim.order.map((id) => sim.entities.get(id)!.desc).filter((d) => d.id !== e.target).concat(candidate));
      if (issues.length) return `setMass refused: ${issues.map((i) => i.message).join('; ')}`;
      // RESOLVABILITY: a lighter body raises omega_n and gamma on every spring
      // pulling on it. Refused and surfaced, never clamped.
      const rIssues = resolvabilityIssues(
        sim.springs, (id) => (id === e.target ? e.mass : sim.entities.get(id)?.mass), sim.hSub);
      if (rIssues.length) return `setMass ${rIssues.map((i) => i.message).join('; ')}`;
      sim.intervene('setMass', e.target, e.seq, `mass -> ${e.mass} kg`, () => {
        rt.desc.material.mass = e.mass;
        const col = sim.rapier.getCollider(rt.colliderHandle);
        col.setDensity(e.mass / volumeOf(rt.desc.shape));
        const b = sim.rapier.getRigidBody(rt.bodyHandle);
        b.recomputeMassPropertiesFromColliders();
        rt.mass = b.mass();
        sim.refreshDragCoefficients();
        // THE HAND'S GAIN GUARD DEPENDS ON THIS BODY'S MASS AND INERTIA. If the
        // hand is holding it, the guard is re-evaluated HERE, inside the same
        // intervention, so no sub-step can run the new inertia against the gains
        // chosen for the old one. Without this the guard was stale-able through
        // an ordinary supported edit — see world.ts refreshHandGains and D-27.
        sim.refreshHandGains();
      });
      return null;
    }
    case 'setStiffness': {
      const s = sim.springs.find((x) => x.id === e.target);
      if (!s) return `setStiffness: no spring ${e.target}`;
      const issues = validateSpring({ ...s, stiffness: e.stiffness });
      if (issues.length) return `setStiffness refused: ${issues.map((i) => i.message).join('; ')}`;
      const rIssues = resolvabilityIssues(
        sim.springs.map((x) => (x.id === e.target ? { ...x, stiffness: e.stiffness } : x)),
        (id) => sim.entities.get(id)?.mass, sim.hSub);
      if (rIssues.length) return `setStiffness ${rIssues.map((i) => i.message).join('; ')}`;
      sim.intervene('setStiffness', e.target, e.seq, `k -> ${e.stiffness} N/m`, () => { s.stiffness = e.stiffness; });
      return null;
    }
    case 'setDamping': {
      const s = sim.springs.find((x) => x.id === e.target);
      if (!s) return `setDamping: no spring ${e.target}`;
      const issues = validateSpring({ ...s, damping: e.damping });
      if (issues.length) return `setDamping refused: ${issues.map((i) => i.message).join('; ')}`;
      const rIssues = resolvabilityIssues(
        sim.springs.map((x) => (x.id === e.target ? { ...x, damping: e.damping } : x)),
        (id) => sim.entities.get(id)?.mass, sim.hSub);
      if (rIssues.length) return `setDamping ${rIssues.map((i) => i.message).join('; ')}`;
      sim.intervene('setDamping', e.target, e.seq, `c -> ${e.damping} N·s/m`, () => { s.damping = e.damping; });
      return null;
    }
    case 'addBlock': {
      if (sim.entities.has(e.entity.id)) return `addBlock: id ${e.entity.id} already exists`;
      const all = sim.order.map((id) => sim.entities.get(id)!.desc).concat(e.entity);
      const issues = validateEntity(e.entity, all);
      if (issues.length) return `addBlock refused: ${issues.map((i) => i.message).join('; ')}`;
      sim.intervene('addBlock', e.entity.id, e.seq, `add ${e.entity.label}`, () => {
        sim.addEntity(JSON.parse(JSON.stringify(e.entity)) as EntityDesc);
      });
      return null;
    }
    case 'removeBlock': {
      if (!sim.entities.has(e.target)) return `removeBlock: no entity ${e.target}`;
      if (e.target === 'ground' || e.target === 'platform') return `removeBlock refused: ${e.target} is structural`;
      sim.intervene('removeBlock', e.target, e.seq, `remove ${e.target}`, () => { sim.removeEntity(e.target); });
      return null;
    }
    case 'setEnvironment': {
      sim.intervene('setEnvironment', 'world', e.seq, `medium -> ${e.medium}`, () => {
        sim.construction.environment.medium = e.medium;
        sim.refreshDragCoefficients();
      });
      return null;
    }
    case 'setGravity': {
      const mag = vlen(e.gravity);
      if (!Number.isFinite(mag) || mag > LIMITS.gravityMax) {
        return `setGravity refused: |g| = ${mag.toFixed(3)} m/s² outside the UI limit [0, ${LIMITS.gravityMax}] m/s²`;
      }
      // BOOKED AS AN INTERVENTION. Under the declared datum (world origin, and it
      // does NOT move when g does) changing gravity changes U_grav instantly by
      // -sum m_i ((g_new - g_old) . r_i). `intervene` measures exactly that with
      // the world frozen across the edit and attributes it here, so it can never
      // be mistaken for solver drift and never reaches UNATTRIBUTED.
      const g0 = sim.construction.environment.gravity;
      sim.intervene('setGravity', 'world', e.seq,
        `g (${g0.x}, ${g0.y}, ${g0.z}) -> (${e.gravity.x}, ${e.gravity.y}, ${e.gravity.z}) m/s²`,
        () => { sim.setGravity(e.gravity); });
      return null;
    }
    // -----------------------------------------------------------------------
    // DM1. THESE ARE DELIBERATELY **NOT** ROUTED THROUGH `sim.intervene`.
    //
    // The hand is an EXTERNAL POWERED ACTUATOR outside the world's energy
    // boundary. Beginning, retargeting and ending a grab move nothing: their
    // frozen-edit dE is identically zero, and booking one would double-count the
    // hand's effect, which is already accounted as SIGNED EXTERNAL WORK per
    // sub-step. See sim/hand.ts and EXPECTATIONS-DM1.md H-0c.
    // -----------------------------------------------------------------------
    case 'grabBegin': return sim.beginGrab(e.target, e.localPoint, e.worldTarget);
    case 'grabMove': return sim.moveGrab(e.worldTarget);
    case 'grabEnd': {
      if (!sim.hand.active) return 'grabEnd: no active grab';
      sim.endGrab();
      return null;
    }
  }
}

function volumeOf(s: ShapeDesc): number {
  switch (s.kind) {
    case 'box': return 8 * s.hx * s.hy * s.hz;
    case 'sphere': return (4 / 3) * Math.PI * s.radius ** 3;
    case 'capsule': return Math.PI * s.radius ** 2 * (2 * s.halfHeight) + (4 / 3) * Math.PI * s.radius ** 3;
  }
}

// ---------------------------------------------------------------------------
// Checkpoints — engine state AND application state.
// ---------------------------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoaShim(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atobShim(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const btoaShim = (s: string): string =>
  typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
const atobShim = (s: string): string =>
  typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');

export interface CheckpointExtras {
  pendingEvents: InputEvent[];
  selectedId: string | null;
  settings: { paused: boolean; recording: boolean };
  seqCounter: number;
  /** The recorded history behind the checkpoint, and the construction it replays against. */
  recordedEvents: InputEvent[];
  recordingBase: Construction | null;
}

export function takeCheckpoint(sim: SimWorld, extras: CheckpointExtras): Checkpoint {
  return {
    format: 'fp1-checkpoint',
    formatVersion: CHECKPOINT_FORMAT_VERSION,
    engine: `@dimforge/rapier3d-compat@${RAPIER.version()}`,
    solverSnapshotBase64: toBase64(sim.rapier.takeSnapshot()),
    app: {
      tick: sim.tick,
      nextSerial: sim.nextSerial,
      order: [...sim.order],
      handles: sim.order.map((id) => {
        const rt = sim.entities.get(id)!;
        return { id, bodyHandle: rt.bodyHandle, colliderHandle: rt.colliderHandle };
      }),
      entities: JSON.parse(JSON.stringify(sim.order.map((id) => sim.entities.get(id)!.desc))) as EntityDesc[],
      springs: JSON.parse(JSON.stringify(sim.springs)) as SpringDesc[],
      joints: JSON.parse(JSON.stringify(sim.jointDescs())) as JointDesc[],
      jointHandles: sim.jointOrder.map((id) => ({ id, jointHandle: sim.joints.get(id)!.jointHandle })),
      environment: JSON.parse(JSON.stringify(sim.construction.environment)) as Construction['environment'],
      thermal: structuredClone(sim.thermal),
      // OMITTED ENTIRELY when there is no circuit — not present-but-undefined.
      // `canonical` refuses undefined at any depth, and a checkpoint of a scene
      // with no circuit genuinely has no electrical half.
      ...(sim.construction.circuit
        ? { circuit: structuredClone(sim.construction.circuit), electrical: structuredClone(sim.electrical) }
        : {}),
      budget: JSON.parse(JSON.stringify(sim.budget)) as EnergyBudget,
      foreignAccumulatorWrites: sim.foreignAccumulatorWrites,
      hand: cloneHandState(sim.hand),
      handTickHistory: sim.handTickHistory.map((r) => ({ ...r })),
      handGestureHistory: sim.handGestureHistory.map((r) => ({ ...r })),
      pendingEvents: JSON.parse(JSON.stringify(extras.pendingEvents)) as InputEvent[],
      selectedId: extras.selectedId,
      settings: { ...extras.settings },
      seqCounter: extras.seqCounter,
      recordedEvents: JSON.parse(JSON.stringify(extras.recordedEvents)) as InputEvent[],
      recordingBase: extras.recordingBase ? cloneConstruction(extras.recordingBase) : null,
      // Recorded EXPLICITLY. A restore that kept the running world's sub-division
      // would silently reinterpret the run at a step it was never integrated at.
      numerics: sim.declaredNumerics ? { ...sim.declaredNumerics } : null,
    },
  };
}

/** Build the extras from a live recorder, so no caller can forget the history again. */
export function extrasFrom(
  recorder: Recorder,
  o: { pendingEvents: InputEvent[]; selectedId: string | null; paused: boolean },
): CheckpointExtras {
  return {
    pendingEvents: o.pendingEvents,
    selectedId: o.selectedId,
    settings: { paused: o.paused, recording: recorder.recording },
    seqCounter: recorder.seq,
    recordedEvents: recorder.events,
    recordingBase: recorder.base,
  };
}

export function restoreCheckpoint(sim: SimWorld, cp: Checkpoint): CheckpointExtras {
  if (cp.format !== 'fp1-checkpoint') throw new Error('not an fp1 checkpoint');
  if (cp.formatVersion !== CHECKPOINT_FORMAT_VERSION) throw new Error(`checkpoint version ${cp.formatVersion} unsupported`);
  const mine = `@dimforge/rapier3d-compat@${RAPIER.version()}`;
  if (cp.engine !== mine) throw new Error(`checkpoint engine ${cp.engine} != running engine ${mine}`);
  sim.adoptCheckpoint(cp, fromBase64);
  return {
    pendingEvents: JSON.parse(JSON.stringify(cp.app.pendingEvents)) as InputEvent[],
    selectedId: cp.app.selectedId,
    settings: { ...cp.app.settings },
    seqCounter: cp.app.seqCounter,
    // A checkpoint written before the history was part of the format restores as
    // "no history", which is honest, rather than silently keeping a live one.
    recordedEvents: JSON.parse(JSON.stringify(cp.app.recordedEvents ?? [])) as InputEvent[],
    recordingBase: cp.app.recordingBase ? cloneConstruction(cp.app.recordingBase) : null,
  };
}

/**
 * Canonical bytes of the declared APPLICATION half of replay state. Compared
 * byte for byte; every number is its IEEE-754 bit pattern. `wallClockMs` is
 * excluded ON PURPOSE — it is a non-authoritative annotation and is never
 * consulted by replay, so including it would assert an exactness the format
 * explicitly disclaims.
 */
export function canonicalAppState(x: CheckpointExtras): string {
  const n = (v: number): string => f64hex(v);
  const ev = (e: InputEvent): string => {
    const head = `${n(e.tick)} ${n(e.seq)} ${e.kind} ${e.target}`;
    switch (e.kind) {
      case 'push': return `${head} J=${n(e.impulse.x)},${n(e.impulse.y)},${n(e.impulse.z)}`
        + (e.point ? ` at=${n(e.point.x)},${n(e.point.y)},${n(e.point.z)}` : ' at=com');
      case 'setMass': return `${head} m=${n(e.mass)}`;
      case 'setStiffness': return `${head} k=${n(e.stiffness)}`;
      case 'setDamping': return `${head} c=${n(e.damping)}`;
      case 'addBlock': return `${head} entity=${JSON.stringify(e.entity)}`;
      case 'removeBlock': return head;
      case 'setEnvironment': return `${head} medium=${e.medium}`;
      case 'setGravity': return `${head} g=${n(e.gravity.x)},${n(e.gravity.y)},${n(e.gravity.z)}`;
      case 'grabBegin': return `${head} local=${n(e.localPoint.x)},${n(e.localPoint.y)},${n(e.localPoint.z)}`
        + ` wt=${n(e.worldTarget.x)},${n(e.worldTarget.y)},${n(e.worldTarget.z)}`;
      case 'grabMove': return `${head} wt=${n(e.worldTarget.x)},${n(e.worldTarget.y)},${n(e.worldTarget.z)}`;
      case 'grabEnd': return head;
    }
  };
  const L: string[] = ['fp1-canonical-app/1'];
  L.push(`selectedId ${String(x.selectedId)}`);
  L.push(`paused ${String(x.settings.paused)} recording ${String(x.settings.recording)}`);
  L.push(`seqCounter ${n(x.seqCounter)}`);
  L.push(`pending ${x.pendingEvents.length}`);
  for (const e of x.pendingEvents) L.push(`  p ${ev(e)}`);
  L.push(`recorded ${x.recordedEvents.length}`);
  for (const e of x.recordedEvents) L.push(`  r ${ev(e)}`);
  L.push(`recordingBase ${x.recordingBase ? JSON.stringify(x.recordingBase) : 'null'}`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayCheckpoint {
  tick: number;
  /** Display fingerprint only. NOT the exactness comparison. */
  hash: string;
  /** The declared replay state, canonically serialised. THIS is what is compared. */
  canonical: string;
}

/**
 * Deterministically replay a record from tick 0 for `ticks` ticks, capturing the
 * canonical declared replay state every `record.checkpointEvery` ticks. The short
 * hash rides along for log lines; equality is decided on `canonical`.
 */
export function replay(sim: SimWorld, record: InputRecord, ticks: number): ReplayCheckpoint[] {
  sim.build(record.construction);
  const queue = sortEvents(record.events);
  const out: ReplayCheckpoint[] = [];
  const snap = (): ReplayCheckpoint => ({ tick: sim.tick, hash: sim.stateHash(), canonical: canonicalSimState(sim) });
  out.push(snap());
  for (let i = 0; i < ticks; i++) {
    applyDue(sim, queue);
    sim.tickOnce();
    if (sim.tick % record.checkpointEvery === 0) out.push(snap());
  }
  return out;
}
