import { validateThermal } from './thermal';
import { constructionSubsteps, parseConstruction, validateCircuitOf, validateEntity, validateSpring, resolvabilityIssues, type Construction } from './construction';
import { sourcesOf, terminalsOf, type ComponentDesc } from './circuit';
import {
  ALIGN_TOL_ANG, ALIGN_TOL_POS, anchorWorld, connectionAlignment, isConnectionKind, validateJoint,
  type BodyPose, type ConnectionKind, type FixedJointDesc, type JointDesc, type PoseLookup,
} from './joints';
import { hSubFor, qconj, qmul, qrot, type Quat, type Vec3 } from './units';
import { f64hex, SimWorld } from '../sim/world';
import { Recorder, RECORD_FORMAT_VERSION, worldReplaced, type InputRecord } from '../sim/record';

/** Canonical CONTENT, not a hash. Tagged nodes distinguish every JSON type and -0. */
export function canonical(value: unknown): string {
  const node = (v: unknown): unknown => {
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('Nonfinite number'); return ['number', f64hex(v)]; }
    if (v === null) return ['null'];
    if (typeof v === 'string' || typeof v === 'boolean') return [typeof v, v];
    if (Array.isArray(v)) return ['array', v.map(node)];
    if (typeof v === 'object') return ['object', Object.keys(v).sort().map(k => [k, node((v as Record<string, unknown>)[k])])];
    throw new Error('Unsupported authored value');
  };
  return JSON.stringify(node(value));
}
export const copy = <T>(v: T): T => structuredClone(v);
const fail = (s: string): never => { throw new Error(s); };
function keys(v: unknown, required: string[], optional: string[] = []): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('Expected object');
  const o = v as Record<string, unknown>;
  for (const k of required) if (!(k in o)) fail(`Missing ${k}`);
  for (const k of Object.keys(o)) if (![...required, ...optional].includes(k)) fail(`Unknown field ${k}`);
}
function vector(v: unknown, quaternion = false): void {
  const names = quaternion ? ['x','y','z','w'] : ['x','y','z']; keys(v, names);
  if (names.some(k => typeof v[k] !== 'number' || !Number.isFinite(v[k]))) fail('Invalid vector');
  if (quaternion && Math.abs(Math.hypot(...names.map(k => v[k] as number)) - 1) > 1e-6) fail('Rotation must be a unit quaternion');
}
export function validateAuthored(c: Construction): void {
  validateThermal(c);
  canonical(c); // refuses nonfinite / undefined at any depth
  keys(c, ['format','formatVersion','name','environment','entities','springs','nextSerial'], ['joints','numerics','circuit']);
  parseConstruction(JSON.stringify(c));
  if (typeof c.name !== 'string' || !Number.isSafeInteger(c.nextSerial) || c.nextSerial < 0) fail('Invalid name or serial');
  if (c.numerics) keys(c.numerics, ['substeps']);
  keys(c.environment, ['medium','gravity']); vector(c.environment.gravity);
  if (!['air','vacuum'].includes(c.environment.medium)) fail('Unknown medium');
  if (!Array.isArray(c.entities) || !Array.isArray(c.springs) || (c.joints !== undefined && !Array.isArray(c.joints))) fail('Invalid collections');
  const ids = new Set<string>();
  const id = (s: string) => { if (typeof s !== 'string' || !s.length || !/^[A-Za-z0-9_.:-]+$/.test(s) || ids.has(s)) fail('Empty or duplicate ID'); ids.add(s); };
  for (const e of c.entities) {
    keys(e, ['id','label','kinematics','shape','material','translation','rotation','linvel','angvel','colour'], ['thermal']); id(e.id);
    if (typeof e.label !== 'string' || !['fixed','dynamic'].includes(e.kinematics) || !Number.isInteger(e.colour) || e.colour < 0 || e.colour > 0xffffff) fail('Invalid body metadata');
    vector(e.translation); vector(e.rotation, true); vector(e.linvel); vector(e.angvel);
    keys(e.material, ['mass','friction','restitution'], ['dragCd']);
    if (e.material.restitution > 1) fail('Restitution must be between 0 and 1');
    if (Object.values(e.material).some(v => typeof v !== 'number' || v < 0)) fail('Invalid material');
    const dims = e.shape.kind === 'box' ? ['hx','hy','hz'] : e.shape.kind === 'sphere' ? ['radius'] : e.shape.kind === 'capsule' ? ['radius','halfHeight'] : fail('Unknown shape');
    keys(e.shape, ['kind', ...dims]);
    if (dims.some(k => typeof (e.shape as unknown as Record<string, unknown>)[k] !== 'number' || ((e.shape as unknown as Record<string, number>)[k] <= 0))) fail('Invalid dimensions');
    // Fixed authored scenery (including the shipped 20 m ground) predates dynamic-object UI limits.
    const issues = validateEntity(e, c.entities).filter(i => !(e.kinematics === 'fixed' && i.message.startsWith('size '))); if (issues.length) fail(issues.map(i => i.message).join('; '));
  }
  const entityIds = new Set(ids);
  for (const s of c.springs) {
    keys(s, ['id','a','b','restLength','stiffness','damping'], ['heatReceiver']); id(s.id);
    for (const ep of [s.a,s.b]) {
      if (ep.kind === 'world') { keys(ep, ['kind','point']); vector(ep.point); }
      else if (ep.kind === 'body') { keys(ep, ['kind','entityId','localPoint']); vector(ep.localPoint); if (!entityIds.has(ep.entityId)) fail('Dangling spring endpoint'); }
      else fail('Unknown spring endpoint');
    }
    if (typeof s.restLength !== 'number' || s.restLength < 0) fail('Rest length must be nonnegative');
    const issues = validateSpring(s); if (issues.length) fail(issues.map(i => i.message).join('; '));
  }
  // VARIANT-SPECIFIC KEY SETS. A `ball` has no axis and no frame; a `fixed` has
  // frames and no axis; a hinge/slider has an axis and no frames. A field that does
  // not belong to the variant is REFUSED as an unknown field, and a field the
  // variant requires is REFUSED as a missing one — never ignored, never defaulted.
  // This is what stops a dummy axis standing in for a connection frame.
  const jointKeys: Record<JointDesc['kind'], string[]> = {
    hinge:  ['id','kind','bodyA','bodyB','anchorA','anchorB','axis'],
    slider: ['id','kind','bodyA','bodyB','anchorA','anchorB','axis'],
    ball:   ['id','kind','bodyA','bodyB','anchorA','anchorB'],
    fixed:  ['id','kind','bodyA','bodyB','anchorA','anchorB','frameA','frameB'],
  };
  const poseOf = poseLookup(c);
  for (const j of c.joints ?? []) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) fail('Expected object');
    const kind = (j as { kind?: unknown }).kind;
    if (typeof kind !== 'string' || !(kind in jointKeys)) fail(`Unknown joint kind ${JSON.stringify(kind)}`);
    keys(j, jointKeys[kind as JointDesc['kind']]); id(j.id as string);
    vector(j.anchorA); vector(j.anchorB);
    if (kind === 'hinge' || kind === 'slider') vector(j.axis);
    if (kind === 'fixed') { vector(j.frameA, true); vector(j.frameB, true); }
    const issues = validateJoint(j as unknown as JointDesc, entityIds, poseOf);
    if (issues.length) fail(issues.map(i => i.message).join('; '));
  }
  // BATCH 4 — VARIANT-SPECIFIC KEY SETS FOR CIRCUIT COMPONENTS, exactly as for
  // joints. A field the variant does not carry is REFUSED as an unknown field and
  // a field it requires is REFUSED as a missing one. There are no capacitor,
  // inductor, switch or AC fields to leave unused, and an unrecognised kind or
  // model version is REFUSED rather than guessed at or silently dropped.
  if (c.circuit !== undefined) {
    keys(c.circuit, ['nodes','components']);
    if (!Array.isArray(c.circuit.nodes) || !Array.isArray(c.circuit.components)) fail('Invalid circuit collections');
    for (const n of c.circuit.nodes) { keys(n, ['id','label']); id(n.id as string); if (typeof n.label !== 'string') fail('Invalid node label'); }
    const componentKeys: Record<ComponentDesc['kind'], { required: string[]; optional: string[] }> = {
      source:   { required: ['id','label','kind','model','modelVersion','pos','neg','voltage'], optional: [] },
      resistor: { required: ['id','label','kind','model','modelVersion','a','b','resistance'], optional: ['heatReceiver'] },
      wire:     { required: ['id','label','kind','model','modelVersion','a','b'], optional: [] },
    };
    for (const x of c.circuit.components) {
      if (!x || typeof x !== 'object' || Array.isArray(x)) fail('Expected a component object');
      const kind = (x as { kind?: unknown }).kind;
      if (typeof kind !== 'string' || !(kind in componentKeys)) fail(`Unknown circuit component kind ${JSON.stringify(kind)}`);
      const spec = componentKeys[kind as ComponentDesc['kind']];
      keys(x, spec.required, spec.optional); id((x as { id: string }).id);
    }
    validateCircuitOf(c);
  }
  const issues = resolvabilityIssues(c.springs, k => c.entities.find(e => e.id === k)?.material.mass, hSubFor(constructionSubsteps(c)));
  if (issues.length) fail(issues.map(i => i.message).join('; '));
}
/** -0 is the only finite number JSON itself cannot preserve. */
export function encode(v: unknown): string { canonical(v); return JSON.stringify(v, (_k,x) => typeof x === 'number' && Object.is(x,-0) ? { '$minusZero': true } : x, 2); }
export function decode(s: string): unknown { return JSON.parse(s, (_k,x) => x && typeof x === 'object' && Object.keys(x).length === 1 && x.$minusZero === true ? -0 : x); }
export function saveAuthored(c: Construction): string { validateAuthored(c); return encode({ format: 'fg-authored', version: 1, construction: c }); }
export function loadAuthored(s: string): Construction {
  const v = decode(s); keys(v, ['format','version','construction']);
  if (v.format !== 'fg-authored' || v.version !== 1) fail('Unsupported authored document');
  const c = v.construction as Construction; validateAuthored(c); return copy(c);
}
export interface EditAudit { before: Construction; after: Construction; deltaInitialEnergy: number; reason: string; }
export function initialEnergy(c: Construction): number {
  const s = new SimWorld(); try { s.build(c); return s.budget.current.total; } finally { s.rapier?.free(); }
}
/** Owns the starting scene, never aliases the solver's mutable descriptors. */
export class AuthoringSession {
  private base: Construction;
  audit: EditAudit[] = [];
  constructor(c: Construction) { validateAuthored(c); this.base = copy(c); }
  get authored(): Construction { return copy(this.base); }
  get identity(): string { return canonical(this.base); }
  save(): string { return saveAuthored(this.base); }
  replace(c: Construction): void { validateAuthored(c); this.base = copy(c); }
  edit(change: (c: Construction) => void, reason: string): void {
    const before = this.authored, after = this.authored; change(after); validateAuthored(after);
    const deltaInitialEnergy = initialEnergy(after) - initialEnergy(before);
    this.base = copy(after); this.audit.push({ before, after: copy(after), deltaInitialEnergy, reason });
  }
  /** No state from the previous run crosses this boundary. UI clears its own bindings. */
  start(sim: SimWorld, recorder: Recorder): void { sim.build(this.base); recorder.stop(); worldReplaced(recorder, 'load', this.base); }
}
export function deleteBody(c: Construction, id: string): void {
  // DELETING A RECEIVER CLEARS **BOTH** DOMAINS' ROUTING. A resistor left naming a
  // deleted body would be a dangling receiver, and silently keeping it would be
  // exactly the ghost the acceptance forbids.
  for(const s of c.springs) if(s.heatReceiver===id) delete s.heatReceiver;
  for(const x of c.circuit?.components ?? []) if(x.kind==='resistor' && x.heatReceiver===id) delete x.heatReceiver;
  c.entities = c.entities.filter(e => e.id !== id);
  c.springs = c.springs.filter(s => ![s.a,s.b].some(ep => ep.kind === 'body' && ep.entityId === id));
  if (c.joints) c.joints = c.joints.filter(j => j.bodyA !== id && j.bodyB !== id);
}
/**
 * DELETE ONE CIRCUIT NODE, ATOMICALLY WITH EVERY COMPONENT ATTACHED TO IT — or
 * REFUSE VISIBLY.
 *
 * It REFUSES when the node carries a terminal of the SOURCE. Removing it would
 * either leave a dangling source terminal or silently delete the one source and
 * quietly turn a live circuit into an unsolvable one. Neither is acceptable, so
 * the operation says what to do instead rather than repairing the graph.
 */
export function deleteCircuitNode(c: Construction, nodeId: string): void {
  const circuit = c.circuit;
  if (!circuit) throw new Error('This scene has no circuit');
  if (!circuit.nodes.some((n) => n.id === nodeId)) throw new Error(`No circuit node ${nodeId}`);
  const src = sourcesOf(circuit)[0];
  if (src && terminalsOf(src).some((t) => t.node === nodeId)) {
    throw new Error(`REFUSED: node ${nodeId} carries a terminal of the source ${src.id}. `
      + 'Delete or re-terminate the source first — the node is not removed and the source is not silently dropped.');
  }
  circuit.nodes = circuit.nodes.filter((n) => n.id !== nodeId);
  circuit.components = circuit.components.filter((x) => !terminalsOf(x).some((t) => t.node === nodeId));
}

/** Remove one circuit component by id. Nodes are untouched. */
export function deleteCircuitComponent(c: Construction, componentId: string): void {
  if (!c.circuit) return;
  c.circuit.components = c.circuit.components.filter((x) => x.id !== componentId);
}

export function requireRecordingBase(record: InputRecord, active: Construction): void {
  if (record.format !== 'fp1-record' || record.formatVersion !== RECORD_FORMAT_VERSION) fail('Unsupported recording format');
  validateAuthored(record.construction);
  if (canonical(record.construction) !== canonical(active)) fail('Recording belongs to a different authored construction. Load its base explicitly first.');
  if (record.engine !== `@dimforge/rapier3d-compat@${SimWorld.engineVersion()}`) fail('Recording engine version mismatch');
}

// ===========================================================================
// BB2 — AUTHORED CONNECTIONS (ball, fixed). The operations the UI drives.
// Against EXPECTATIONS-BB2-CONNECTIONS.md §1.3 and PART 2.
// ===========================================================================

/** The authored world pose of every entity in a construction, for the alignment gate. */
export function poseLookup(c: Construction): PoseLookup {
  const m = new Map<string, BodyPose>();
  for (const e of c.entities) m.set(e.id, { translation: e.translation, rotation: e.rotation });
  return (id) => m.get(id);
}

const Q_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Mint an unused connection id of the form `<kind>N`. Application-owned, like every other id. */
export function nextConnectionId(c: Construction, kind: ConnectionKind): string {
  const used = new Set((c.joints ?? []).map((j) => j.id));
  for (let i = 0; ; i++) { const id = `${kind}${i}`; if (!used.has(id)) return id; }
}

/**
 * BUILD one authored connection descriptor between two DISTINCT bodies.
 *
 * For `fixed`, the two connection frames are DERIVED HERE from the two bodies'
 * AUTHORED ROTATIONS AT THIS MOMENT, under the declared convention
 *
 *     frameA = identity ,  frameB = R_B⁻¹ ⊗ R_A
 *
 * so that R_A ⊗ frameA == R_B ⊗ frameB exactly and the INTENDED INITIAL RELATIVE
 * POSE q_rel = R_A⁻¹ ⊗ R_B is what the constraint holds — including a non-identity
 * one. Both frames are then stored explicitly in the authored document; nothing is
 * recomputed at build time.
 *
 * This function does NOT place the bodies. If the anchors do not already coincide
 * the descriptor it returns is MISALIGNED, `validateAuthored` will refuse it, and
 * the caller must either author the poses or run `placeToSatisfyConnection`.
 */
export function makeConnection(
  c: Construction, kind: ConnectionKind, bodyA: string, bodyB: string,
  anchorA: Vec3, anchorB: Vec3, id: string = nextConnectionId(c, kind),
): JointDesc {
  if (!isConnectionKind(kind)) throw new Error(`Unknown connection kind ${String(kind)}`);
  if (bodyA === bodyB) throw new Error('A connection needs two DISTINCT bodies');
  const A = c.entities.find((e) => e.id === bodyA), B = c.entities.find((e) => e.id === bodyB);
  if (!A || !B) throw new Error('A connection names a body that is not in this scene');
  const common = { id, bodyA, bodyB, anchorA: { ...anchorA }, anchorB: { ...anchorB } };
  if (kind === 'ball') return { ...common, kind: 'ball' };
  return { ...common, kind: 'fixed', frameA: { ...Q_IDENTITY }, frameB: qmul(qconj(B.rotation), A.rotation) };
}

/**
 * THE AUTHORED PLACEMENT OPERATION.  Moves BODY B ONLY, so the connection named
 * is satisfied exactly. This is the ONLY sanctioned way to resolve a misalignment
 * other than refusing it: it is an EDIT TO THE STARTING SCENE, it runs through
 * `AuthoringSession.edit` so it lands in the existing edit audit with its own
 * energy delta and reason, and it is NOT physical motion. THE SOLVER NEVER DOES
 * THIS.
 *
 *   fixed:  R_B := R_A ⊗ frameA ⊗ frameB⁻¹     then    r_B := p_A − R_B·anchorB
 *   ball:                                              r_B := p_A − R_B·anchorB
 */
export function placeToSatisfyConnection(c: Construction, connectionId: string): void {
  const j = (c.joints ?? []).find((x) => x.id === connectionId);
  if (!j) throw new Error(`No connection ${connectionId}`);
  if (j.kind !== 'ball' && j.kind !== 'fixed') throw new Error(`Placement is defined for ball and fixed connections only, not ${j.kind}`);
  const A = c.entities.find((e) => e.id === j.bodyA), B = c.entities.find((e) => e.id === j.bodyB);
  if (!A || !B) throw new Error(`Connection ${connectionId} names a body that is not in this scene`);
  if (B.kinematics === 'fixed' && A.kinematics === 'fixed') throw new Error('Both bodies are fixed scenery; move one of them by hand instead');
  if (j.kind === 'fixed') {
    B.rotation = qmul(qmul(A.rotation, j.frameA), qconj(j.frameB));
  }
  const pA = anchorWorld(j, 'A', A);
  const rb = qrot(B.rotation, j.anchorB);
  B.translation = { x: pA.x - rb.x, y: pA.y - rb.y, z: pA.z - rb.z };
}

/** The reason string the placement edit is audited under. One wording, so UI and tests agree. */
export const placementReason = (j: JointDesc): string =>
  `place ${j.bodyB} to satisfy ${j.kind} connection ${j.id}`;

/**
 * The measured misalignment of a candidate connection against a construction, for
 * the UI's refusal message. Returns null when it is aligned inside the declared
 * numerical-noise band, or when the variant has no gate.
 */
export function connectionMisalignment(c: Construction, j: JointDesc): { separation: number; frameError: number | null } | null {
  const al = connectionAlignment(j, poseLookup(c));
  return !al || al.aligned ? null : { separation: al.separation, frameError: al.frameError };
}

export { ALIGN_TOL_ANG, ALIGN_TOL_POS };

/** Remove one authored connection by id. Bodies are untouched. */
export function deleteConnection(c: Construction, connectionId: string): void {
  if (c.joints) c.joints = c.joints.filter((j) => j.id !== connectionId);
}

/** Every connection naming this body. Used by the UI before a delete, and by the delete witness. */
export const connectionsOn = (c: Construction, bodyId: string): JointDesc[] =>
  (c.joints ?? []).filter((j) => j.bodyA === bodyId || j.bodyB === bodyId);

/** A FIXED connection's authored frames, for display. Never recomputed silently. */
export const fixedFrames = (j: FixedJointDesc): { frameA: Quat; frameB: Quat } => ({ frameA: j.frameA, frameB: j.frameB });
