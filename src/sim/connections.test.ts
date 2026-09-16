/**
 * BB2 — AUTHORABLE CONNECTIONS: THE MECHANICAL AND DISCRIMINATING WITNESSES.
 *
 * Against `bridge/BATCH2-ACCEPTANCE-v1.md` §2 and §3, and the stamped
 * `EXPECTATIONS-BB2-CONNECTIONS.md`
 * (sha256 748227ef98ea752c4ab85a55bee9c5eb1ff94d67c5f1edbc3769c4e4242a9c8d,
 * stamped 2026-09-06T06:30:37Z), under `bridge/ACCEPTANCE-RULES-v1.md`.
 *
 * ===========================================================================
 * ORDERING: THIS FILE WAS WRITTEN AND RUN BEFORE THE DEPENDENT AUTHORING UI.
 * ===========================================================================
 * Every fixture literal, every formula and every tolerance below is COPIED FROM
 * THAT STAMPED FILE. Nothing observed has been copied back into it. The §2
 * numbers are REQUIREMENTS on the built thing, not predictions that Rapier
 * necessarily meets: a material miss pauses the dependent UI and is retained.
 *
 * The analytic references are computed from the stamped initial conditions and
 * the AUTHORED masses and radii alone. Reading the adapter's own fields back
 * would not be a reference and is not used as one.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { SimWorld } from './world';
import { runTicks } from './step';
import { applyEvent } from './record';
import {
  CONSTRUCTION_FORMAT_VERSION, type Construction, type EntityDesc,
} from '../model/construction';
import {
  SI, SUPPORTED_SUBSTEPS, qangle, qaxisAngle, qconj, qinvrot, qlog, qmul, qrot,
  vadd, vcross, vdot, vlen, vscale, vsub, type Quat, type Vec3,
} from '../model/units';
import { anchorWorld, frameWorld, type BallJointDesc, type FixedJointDesc, type HingeJointDesc, type JointDesc } from '../model/joints';

beforeAll(async () => { await SimWorld.initEngine(); });

const log = (...a: unknown[]): void => { console.log('[BB2]', ...a); };

// ===========================================================================
// THE STAMPED FIXTURE LITERALS.  EXPECTATIONS-BB2-CONNECTIONS.md PART 3.
// Every one of these is copied from the declaration; none was measured.
// ===========================================================================

/** Duration: 10.000 simulated seconds = 600 public ticks at the fixed 1/60 s tick. */
const TICKS = 600;
const T_END = TICKS * SI.DT;

const M_A = 2.0, M_B = 1.0, R_SPH = 0.10;
/** Analytic sphere inertia 0.4·m·r², computed from the AUTHORED sphere, never read back. */
const I_A = 0.4 * M_A * R_SPH * R_SPH;      // 0.008 kg·m²
const I_B = 0.4 * M_B * R_SPH * R_SPH;      // 0.004 kg·m²
const M_TOT = M_A + M_B;

/** Assembly-local COM positions; the connection point is the assembly-local origin. */
const LOCAL_A_X = -0.45, LOCAL_B_X = 0.15;
const LOCAL_COM_X = (M_A * LOCAL_A_X + M_B * LOCAL_B_X) / M_TOT;   // -0.25
const OFF_A_X = LOCAL_A_X - LOCAL_COM_X;                            // -0.20
const OFF_B_X = LOCAL_B_X - LOCAL_COM_X;                            // +0.40
/**
 * A1.5 — THE CONNECTION POINT, in the assembly-local frame.
 *
 * The declaration placed it at the assembly-local ORIGIN, which put it COLLINEAR
 * with body B's centre of mass and the composite centre of mass, all on the local
 * x axis, while the assembly spins about local z. The centripetal force the
 * connection supplies to B was then PARALLEL to the lever arm from B's COM to the
 * anchor and the torque r x F was IDENTICALLY ZERO — and at zero torque a ball
 * and a fixed connection produce the same motion, so the fixture could not
 * discriminate between them. That is a FIXTURE DEFECT, provable from the stamped
 * literals with no reference to any measured output, and the original failure is
 * retained (DEVIATIONS D-36, EXPECTATIONS-BB2-CONNECTIONS-A1.md A1.5).
 *
 * The connection point moves off that axis and NOTHING else changes.
 */
const JOINT_LOCAL: Vec3 = { x: 0, y: 0.12, z: 0 };
const JOINT_OFF: Vec3 = { x: JOINT_LOCAL.x - LOCAL_COM_X, y: JOINT_LOCAL.y, z: JOINT_LOCAL.z };  // (0.25, 0.12, 0)

/** Composite inertia about the composite COM. I_yy = I_zz EXACTLY -> local z is principal. */
const I_XX = I_A + I_B;
const I_ZZ = I_XX + M_A * OFF_A_X * OFF_A_X + M_B * OFF_B_X * OFF_B_X;   // 0.252 kg·m²

const Q0: Quat = qaxisAngle({ x: 1, y: 2, z: 3 }, 0.7);
const QREL_ANGLE = 35 * Math.PI / 180;                              // 0.6108652381980153 rad
const QREL: Quat = qaxisAngle({ x: 0, y: 1, z: 0 }, QREL_ANGLE);

const R_C0: Vec3 = { x: 0, y: 0, z: 0 };
const V_C: Vec3 = { x: 0.70, y: -0.30, z: 0.45 };
const OMEGA_MAG = 2.0;
const OMEGA0: Vec3 = qrot(Q0, { x: 0, y: 0, z: OMEGA_MAG });

const R_A0: Vec3 = vadd(R_C0, qrot(Q0, { x: OFF_A_X, y: 0, z: 0 }));
const R_B0: Vec3 = vadd(R_C0, qrot(Q0, { x: OFF_B_X, y: 0, z: 0 }));
const P_W0: Vec3 = vadd(R_C0, qrot(Q0, JOINT_OFF));
const ROT_A0: Quat = Q0;
const ROT_B0: Quat = qmul(Q0, QREL);

const ANCHOR_A: Vec3 = qinvrot(ROT_A0, vsub(P_W0, R_A0));
const ANCHOR_B: Vec3 = qinvrot(ROT_B0, vsub(P_W0, R_B0));
const FRAME_A: Quat = { x: 0, y: 0, z: 0, w: 1 };
const FRAME_B: Quat = qmul(qconj(ROT_B0), ROT_A0);

/** F-BALL-PAIR's relative spin. */
const D_OMEGA: Vec3 = qrot(Q0, { x: 0.9, y: -0.6, z: 1.3 });
/** The hinge substitute's relative spin: along the hinge axis ONLY, so its own constraints hold at t = 0. */
const D_OMEGA_HINGE: Vec3 = qrot(Q0, { x: 0, y: 0, z: 1.3 });
/**
 * A1.4 — THE HINGE SUBSTITUTE'S RELATIVE POSE.
 *
 * `JointDesc` carries ONE shared `axis` for both bodies — the schema hinge and
 * slider have shipped with since BB1, which legacy documents contain and which
 * this batch does not change. The declaration asked for independent per-body axes,
 * which that schema cannot express, so the substitute as first built named world
 * directions 35 deg APART at t = 0 (because Qrel rotates about y, not about the
 * hinge axis) and its own constraint was VIOLATED at release. The solver spent the
 * run yanking it, and the yank is what produced a second rotation axis. Retained
 * as a failure in DEVIATIONS D-36.
 *
 * Under its OWN BEST CONDITIONS the substitute's relative pose is a rotation ABOUT
 * THE HINGE AXIS, so the one shared local axis really is the same world direction
 * in both bodies. Same bodies, same anchors, same Q0, same spin magnitude, same
 * thresholds: only the relative pose changes.
 */
const QREL_HINGE: Quat = qaxisAngle({ x: 0, y: 0, z: 1 }, QREL_ANGLE);
const HINGE_AXIS: Vec3 = { x: 0, y: 0, z: 1 };

/** F-FIXED-WORLD. */
const FW_HELD_R: Vec3 = qrot(Q0, { x: 0.40, y: 0, z: 0 });
const FW_IMPULSE: Vec3 = { x: 0.60, y: -0.50, z: 0.62 };
const FW_PUSH_TICK = 60;

/** §2 product targets, copied from the declaration. */
const T1_ANCHOR = 1e-3;          // m
const T2_FRAME = 1e-3;           // rad
const T3_ENERGY = 0.01;          // 1 % of KE_0
/** §3 analytic tolerances, copied from the declaration. */
const ANALYTIC_POS = 5e-3;       // m
const ANALYTIC_ANG = 5e-3;       // rad
const MOM_P = 1e-3, MOM_L = 1e-2, MOM_L0 = 1e-6;
/**
 * A1.2 / A1.3 — FOUR UNITS IN THE LAST PLACE OF AN f32.
 *
 * The stamped 1e-9 agreement between an analytic value and one read back through
 * the engine's MASS PROPERTIES is not reachable by any correct implementation: a
 * separate probe on a different, trivial construction read back 2.0000002384185791
 * for an authored 2.0 kg — an error of EXACTLY one f32 epsilon, 2^-23 — and the
 * inertia likewise. That is the same f32 boundary this build already documents for
 * the timestep. The original 1e-9 failures are retained in DEVIATIONS D-36; this
 * bound is derived from the MECHANISM, not fitted to the observed values.
 */
const F32_ULPS = 4 * Math.pow(2, -23);   // 4.76837158203125e-7, relative
/** §3 discrimination thresholds, copied from the declaration. */
const BALL_MOTION = 0.5;         // rad
const BALL_SPREAD = 0.05;
const HINGE_SPREAD = 0.01;
const BALL_SUBSTITUTE_FAILS = 1e-2;   // rad
const FIXED_MOVES = 5;           // m
const FIXED_TURNS = 2 * Math.PI;  // rad
const FW_CONTROL = 0.5;          // m

// ===========================================================================
// FIXTURE CONSTRUCTION
// ===========================================================================

const sphere = (id: string, mass: number, t: Vec3, r: Quat, v: Vec3, w: Vec3, colour: number): EntityDesc => ({
  id, label: id, kinematics: 'dynamic',
  shape: { kind: 'sphere', radius: R_SPH },
  material: { mass, restitution: 0, friction: 0 },
  translation: { ...t }, rotation: { ...r }, linvel: { ...v }, angvel: { ...w }, colour,
});

/** Vacuum, gravity-free, NO GROUND, no springs. The fixture shell for every §2/§3 witness. */
function fixtureShell(name: string, entities: EntityDesc[], joints: JointDesc[], substeps: number): Construction {
  return {
    format: 'fp1-construction', formatVersion: CONSTRUCTION_FORMAT_VERSION, name,
    environment: { medium: 'vacuum', gravity: { x: 0, y: 0, z: 0 } },
    entities, springs: [], joints, numerics: { substeps }, nextSerial: 1,
  };
}

/** Rigid-body kinematics, DERIVED HERE: v_i = v_c + ω × (r_i − r_c). */
const rigidVel = (vc: Vec3, w: Vec3, r: Vec3, rc: Vec3): Vec3 => vadd(vc, vcross(w, vsub(r, rc)));

export function fixedPairScene(substeps: number): Construction {
  const j: FixedJointDesc = {
    id: 'fixed0', kind: 'fixed', bodyA: 'sphA', bodyB: 'sphB',
    anchorA: ANCHOR_A, anchorB: ANCHOR_B, frameA: FRAME_A, frameB: FRAME_B,
  };
  return fixtureShell('F-FIXED-PAIR', [
    sphere('sphA', M_A, R_A0, ROT_A0, rigidVel(V_C, OMEGA0, R_A0, R_C0), OMEGA0, 0x7aa2c8),
    sphere('sphB', M_B, R_B0, ROT_B0, rigidVel(V_C, OMEGA0, R_B0, R_C0), OMEGA0, 0xd98a5a),
  ], [j], substeps);
}

/**
 * F-BALL-PAIR. B carries a genuine relative spin, and v_B is DERIVED from the
 * ball's velocity constraint — the world velocity of the shared connection point
 * must agree — not read back from anything.
 */
function ballPairKinematics(omegaB: Vec3): { vA: Vec3; vB: Vec3; wA: Vec3; wB: Vec3 } {
  const wA = OMEGA0, wB = omegaB;
  const vA = rigidVel(V_C, OMEGA0, R_A0, R_C0);
  const vP = vadd(vA, vcross(wA, vsub(P_W0, R_A0)));
  const vB = vsub(vP, vcross(wB, vsub(P_W0, R_B0)));
  return { vA, vB, wA, wB };
}

export function ballPairScene(substeps: number): Construction {
  const { vA, vB, wA, wB } = ballPairKinematics(vadd(OMEGA0, D_OMEGA));
  const j: BallJointDesc = {
    id: 'ball0', kind: 'ball', bodyA: 'sphA', bodyB: 'sphB', anchorA: ANCHOR_A, anchorB: ANCHOR_B,
  };
  return fixtureShell('F-BALL-PAIR', [
    sphere('sphA', M_A, R_A0, ROT_A0, vA, wA, 0x7aa2c8),
    sphere('sphB', M_B, R_B0, ROT_B0, vB, wB, 0xd98a5a),
  ], [j], substeps);
}

/**
 * THE HINGE SUBSTITUTE, built under its OWN BEST CONDITIONS: same bodies, same
 * anchors, a hinge about the assembly-local z, and a relative spin ALONG THAT
 * AXIS ONLY, so the hinge's own position and velocity constraints hold exactly
 * at t = 0. It is not sabotaged; it simply cannot reach a second axis.
 */
const ROT_B0_HINGE: Quat = qmul(Q0, QREL_HINGE);
const ANCHOR_B_HINGE: Vec3 = qinvrot(ROT_B0_HINGE, vsub(P_W0, R_B0));

function hingeSubstituteScene(substeps: number): Construction {
  const wB0 = vadd(OMEGA0, D_OMEGA_HINGE);
  const vA = rigidVel(V_C, OMEGA0, R_A0, R_C0);
  const vP = vadd(vA, vcross(OMEGA0, vsub(P_W0, R_A0)));
  const vB = vsub(vP, vcross(wB0, vsub(P_W0, R_B0)));
  const j: HingeJointDesc = {
    id: 'hingeSub', kind: 'hinge', bodyA: 'sphA', bodyB: 'sphB',
    anchorA: ANCHOR_A, anchorB: ANCHOR_B_HINGE, axis: HINGE_AXIS,
  };
  return fixtureShell('HINGE-SUBSTITUTE', [
    sphere('sphA', M_A, R_A0, ROT_A0, vA, OMEGA0, 0x7aa2c8),
    sphere('sphB', M_B, R_B0, ROT_B0_HINGE, vB, wB0, 0xd98a5a),
  ], [j], substeps);
}

/** THE BALL SUBSTITUTE: F-FIXED-PAIR with kind swapped to ball and NOTHING else changed. */
function ballSubstituteScene(substeps: number): Construction {
  const c = fixedPairScene(substeps);
  c.name = 'BALL-SUBSTITUTE';
  c.joints = [{ id: 'ball0', kind: 'ball', bodyA: 'sphA', bodyB: 'sphB', anchorA: ANCHOR_A, anchorB: ANCHOR_B }];
  return c;
}

/** F-FIXED-WORLD: a dynamic body fixed-connected to immovable scenery. */
function fixedWorldScene(substeps: number, connected: boolean): Construction {
  const post: EntityDesc = {
    id: 'post', label: 'post', kinematics: 'fixed',
    shape: { kind: 'box', hx: 0.05, hy: 0.05, hz: 0.05 },
    material: { mass: 0, restitution: 0, friction: 0 },
    translation: { x: 0, y: 0, z: 0 }, rotation: Q0,
    linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 }, colour: 0x5c6b78,
  };
  const held = sphere('held', M_A, FW_HELD_R, ROT_B0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0xd96a6a);
  const j: FixedJointDesc = {
    id: 'fixedWorld0', kind: 'fixed', bodyA: 'post', bodyB: 'held',
    anchorA: { x: 0, y: 0, z: 0 },
    anchorB: qinvrot(ROT_B0, vsub({ x: 0, y: 0, z: 0 }, FW_HELD_R)),
    frameA: { x: 0, y: 0, z: 0, w: 1 },
    frameB: qmul(qconj(ROT_B0), Q0),
  };
  return fixtureShell(connected ? 'F-FIXED-WORLD' : 'F-FIXED-WORLD-CONTROL',
    [post, held], connected ? [j] : [], substeps);
}

// ===========================================================================
// MEASUREMENT — every formula copied from the declaration
// ===========================================================================

interface Trace {
  maxAnchor: number;
  maxFrame: number;
  ke0: number;
  maxEnergyDrift: number;
  msPerTick: number;
  contacts: number;
  ownedDissipation: number;
  maxContributions: number;
  foreign: number;
  /** rotation-vector samples of the CHANGE in relative pose, rad */
  u: Vec3[];
  /** per-sample per-body pose read back, for the analytic comparison */
  poses: Array<{ t: number; rA: Vec3; rB: Vec3; qA: Quat; qB: Quat; vA: Vec3; vB: Vec3; wA: Vec3; wB: Vec3 }>;
}

function poseOfBody(sim: SimWorld, id: string): { translation: Vec3; rotation: Quat } {
  const b = sim.body(id);
  return { translation: b.translation(), rotation: b.rotation() };
}

/**
 * Run a fixture for the declared 10.000 s, sampling at t = 0 and after every tick.
 * `pushAt` optionally injects the recorded `push` intervention of F-FIXED-WORLD.
 */
function traceRun(c: Construction, opts: { pushAt?: { tick: number; target: string; impulse: Vec3 } } = {}): Trace {
  const sim = new SimWorld();
  sim.build(c);
  const j = sim.jointDescs()[0] as JointDesc | undefined;
  const bodies = c.entities.filter((e) => e.kinematics === 'dynamic').map((e) => e.id);
  const [idA, idB] = j ? [j.bodyA, j.bodyB] : [bodies[0], bodies[bodies.length - 1]];

  const measure = (): { anchor: number; frame: number } => {
    if (!j) return { anchor: 0, frame: 0 };
    const pa = poseOfBody(sim, j.bodyA), pb = poseOfBody(sim, j.bodyB);
    const anchor = j.kind === 'ball' || j.kind === 'fixed'
      ? vlen(vsub(anchorWorld(j, 'A', pa), anchorWorld(j, 'B', pb))) : 0;
    const frame = j.kind === 'fixed'
      ? qangle(qmul(qconj(frameWorld(j, 'A', pa)), frameWorld(j, 'B', pb))) : 0;
    return { anchor, frame };
  };

  const relPose = (): Quat => qmul(qconj(sim.body(idA).rotation()), sim.body(idB).rotation());
  const rel0 = relPose();

  const sample = (): Trace['poses'][number] => {
    const a = sim.body(idA), b = sim.body(idB);
    return {
      t: sim.tick * SI.DT,
      rA: a.translation(), rB: b.translation(), qA: a.rotation(), qB: b.rotation(),
      vA: a.linvel(), vB: b.linvel(), wA: a.angvel(), wB: b.angvel(),
    };
  };

  const ke0 = sim.budget.current.total;
  let maxAnchor = 0, maxFrame = 0, maxDrift = 0, contacts = 0, maxContrib = 0;
  const u: Vec3[] = [];
  const poses: Trace['poses'] = [];
  const record = (): void => {
    const m = measure();
    maxAnchor = Math.max(maxAnchor, m.anchor); maxFrame = Math.max(maxFrame, m.frame);
    maxDrift = Math.max(maxDrift, Math.abs(sim.budget.current.total - ke0));
    u.push(qlog(qmul(qconj(rel0), relPose())));
    poses.push(sample());
    maxContrib = Math.max(maxContrib, sim.registry.contributions.length);
    for (const id of bodies) sim.rapier.contactPairsWith(sim.body(id).collider(0), () => { contacts++; });
  };
  record();
  const t0 = performance.now();
  for (let i = 0; i < TICKS; i++) {
    if (opts.pushAt && sim.tick === opts.pushAt.tick) {
      const refusal = applyEvent(sim, {
        kind: 'push', target: opts.pushAt.target, impulse: opts.pushAt.impulse,
        tick: sim.tick, seq: 0, wallClockMs: 0,
      });
      if (refusal) throw new Error(`fixture push refused: ${refusal}`);
    }
    sim.tickOnce();
    record();
  }
  const msPerTick = (performance.now() - t0) / TICKS;
  const out: Trace = {
    maxAnchor, maxFrame, ke0, maxEnergyDrift: maxDrift, msPerTick, contacts,
    ownedDissipation: sim.budget.dissipatedDrag + sim.budget.dissipatedSpringDamper,
    maxContributions: maxContrib, foreign: sim.foreignAccumulatorWrites, u, poses,
  };
  sim.rapier.free();
  return out;
}

/** SPREAD = sqrt(λ2/λ1) of Σ u uᵀ. Declaration §4.1. */
function spread(u: Vec3[]): { spread: number; maxU: number; eig: number[] } {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let maxU = 0;
  for (const v of u) {
    const a = [v.x, v.y, v.z];
    maxU = Math.max(maxU, vlen(v));
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) M[i][k] += a[i] * a[k];
  }
  const eig = symmetricEigenvalues(M).sort((a, b) => b - a);
  return { spread: eig[0] > 0 ? Math.sqrt(Math.max(0, eig[1]) / eig[0]) : 0, maxU, eig };
}

/** Eigenvalues of a real symmetric 3x3, by cyclic Jacobi. Local to this witness. */
function symmetricEigenvalues(m: number[][]): number[] {
  const a = m.map((r) => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let k = i + 1; k < 3; k++) off += a[i][k] * a[i][k];
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
    }
  }
  return [a[0][0], a[1][1], a[2][2]];
}

// ===========================================================================
// C0 — THE FIXTURES ARE WHAT THE DECLARATION SAYS THEY ARE
// ===========================================================================

describe('C0 — the stamped fixture arithmetic, checked before anything is run against it', () => {
  test('C0a the declared layout, composite COM and composite inertia are what the declaration computed', () => {
    expect(LOCAL_COM_X).toBeCloseTo(-0.25, 15);
    expect(OFF_A_X).toBeCloseTo(-0.20, 15);
    expect(OFF_B_X).toBeCloseTo(0.40, 15);
    expect(M_A * OFF_A_X + M_B * OFF_B_X).toBeCloseTo(0, 15);
    expect(I_A).toBeCloseTo(0.008, 15);
    expect(I_B).toBeCloseTo(0.004, 15);
    expect(I_XX).toBeCloseTo(0.012, 15);
    expect(I_ZZ).toBeCloseTo(0.252, 15);
    // The two bodies can NEVER touch, however a ball lets them tumble.
    expect(Math.abs(vlen(ANCHOR_A) - vlen(ANCHOR_B))).toBeGreaterThan(2 * R_SPH);
    expect(Math.abs(vlen(ANCHOR_A) - vlen(ANCHOR_B))).toBeCloseTo(0.2736315137648152, 12);
    log(`C0a |anchorA| = ${vlen(ANCHOR_A).toFixed(9)} m, |anchorB| = ${vlen(ANCHOR_B).toFixed(9)} m, `
      + `closest possible COM separation ${Math.abs(vlen(ANCHOR_A) - vlen(ANCHOR_B)).toFixed(3)} m > 2r = ${(2 * R_SPH).toFixed(2)} m`);
  });

  test('C0b anchors are OFF-CENTRE, body rotations are NON-IDENTITY, and the relative pose is NON-IDENTITY 35 deg', () => {
    // A1.5's recomputed literals, from the corrected connection point (0, 0.12, 0).
    expect(ANCHOR_A.x).toBeCloseTo(0.45, 12);
    expect(ANCHOR_A.y).toBeCloseTo(0.12, 12);
    expect(vlen(ANCHOR_A)).toBeCloseTo(0.4657252408878007, 12);
    expect(vlen(ANCHOR_B)).toBeCloseTo(0.19209372712298547, 12);
    // anchorB has two nonzero components: it is off-centre in a ROTATED local frame.
    expect(Math.abs(ANCHOR_B.x)).toBeGreaterThan(1e-3);
    expect(Math.abs(ANCHOR_B.z)).toBeGreaterThan(1e-3);
    expect(qangle(ROT_A0)).toBeGreaterThan(0.5);
    expect(qangle(ROT_B0)).toBeGreaterThan(0.5);
    expect(qangle(QREL)).toBeCloseTo(QREL_ANGLE, 12);
    expect(QREL_ANGLE).toBeCloseTo(0.6108652381980153, 15);
    log(`C0b anchorA = (${ANCHOR_A.x.toFixed(9)}, ${ANCHOR_A.y.toFixed(9)}, ${ANCHOR_A.z.toFixed(9)}) m; `
      + `anchorB = (${ANCHOR_B.x.toFixed(9)}, ${ANCHOR_B.y.toFixed(9)}, ${ANCHOR_B.z.toFixed(9)}) m; `
      + `R_A angle ${(qangle(ROT_A0) * 180 / Math.PI).toFixed(4)} deg, R_B angle ${(qangle(ROT_B0) * 180 / Math.PI).toFixed(4)} deg, `
      + `q_rel angle ${(qangle(QREL) * 180 / Math.PI).toFixed(6)} deg`);
  });

  test('C0c KE_0 of F-FIXED-PAIR is 1.67775 J by TWO independent routes, and the adapter agrees', () => {
    const composite = 0.5 * M_TOT * vdot(V_C, V_C) + 0.5 * I_ZZ * OMEGA_MAG * OMEGA_MAG;
    const vA = rigidVel(V_C, OMEGA0, R_A0, R_C0), vB = rigidVel(V_C, OMEGA0, R_B0, R_C0);
    const perBody = 0.5 * M_A * vdot(vA, vA) + 0.5 * I_A * vdot(OMEGA0, OMEGA0)
      + 0.5 * M_B * vdot(vB, vB) + 0.5 * I_B * vdot(OMEGA0, OMEGA0);
    log(`C0c KE_0 composite route ${composite.toFixed(9)} J | per-body route ${perBody.toFixed(9)} J | `
      + `stamped literal 1.67775 J`);
    expect(composite).toBeCloseTo(1.67775, 12);                  // the STAMPED literal
    expect(Math.abs(perBody / composite - 1)).toBeLessThan(1e-12);
    const sim = new SimWorld(); sim.build(fixedPairScene(4));
    const rel = Math.abs(sim.budget.current.total / 1.67775 - 1);
    log(`C0c adapter E_mech(0) = ${sim.budget.current.total.toFixed(12)} J, relative ${rel.toExponential(4)} `
      + `(<= 4 ulps of f32 = ${F32_ULPS.toExponential(4)}; the stamped 1e-9 was below the engine's f32 floor — D-36)`);
    expect(rel).toBeLessThanOrEqual(F32_ULPS);
    // DISCRIMINATING: a 25 % wrong authored mass must be DETECTED at this same bound.
    const wrong = fixedPairScene(4); wrong.entities[0].material.mass = 2.5;
    const bad = new SimWorld(); bad.build(wrong);
    const badRel = Math.abs(bad.budget.current.total / 1.67775 - 1);
    log(`C0c DISCRIMINATING CONTROL: authoring sphA at 2.5 kg instead of 2.0 gives E_mech(0) `
      + `${bad.budget.current.total.toFixed(9)} J, relative ${badRel.toExponential(4)} — DETECTED`);
    expect(badRel).toBeGreaterThan(F32_ULPS);
    bad.rapier.free();
    sim.rapier.free();
  });

  test('C0e A1.5 — the connection is OFF the axis of collinearity, so the ball substitute feels a REAL torque', () => {
    // Assembly-local. The centripetal force the connection must supply to B is
    // -m_B·ω²·(B's offset perpendicular to the spin axis, which is local z).
    const bOff = { x: OFF_B_X, y: 0, z: 0 };
    const lever = vsub(JOINT_OFF, bOff);
    const F = vscale({ x: bOff.x, y: bOff.y, z: 0 }, -M_B * OMEGA_MAG * OMEGA_MAG);
    const tau = vcross(lever, F);
    const alpha = vlen(tau) / I_B;
    log(`C0e lever (B's COM -> anchor) = (${lever.x}, ${lever.y}, ${lever.z}) m; centripetal F = `
      + `(${F.x}, ${F.y}, ${F.z}) N; torque r x F = (${tau.x}, ${tau.y}, ${tau.z}) N·m, |tau| = `
      + `${vlen(tau).toFixed(6)} N·m => alpha = ${alpha.toFixed(1)} rad/s². `
      + 'At the DECLARATION\'s collinear anchor this was IDENTICALLY ZERO and the fixture could not '
      + 'tell a ball from a fixed connection at all (D-36, A1.5).');
    expect(vlen(tau)).toBeCloseTo(0.192, 12);        // A1.5's FORWARD PREDICTION
    expect(vlen(tau)).toBeGreaterThan(0);
    // ...and the DEFECTIVE collinear anchor really did give exactly zero, shown here so the
    // correction is evidence and not an assertion about itself.
    const leverBad = vsub({ x: 0 - LOCAL_COM_X, y: 0, z: 0 }, bOff);
    expect(vlen(vcross(leverBad, F))).toBe(0);
  });

  test('C0f A1.4/A2 — the hinge substitute\'s ONE shared local axis is the SAME world direction in both bodies', () => {
    // A2 — the WELL-CONDITIONED angle between two unit vectors. ACOS IS UNRELIABLE AT
    // THE REQUESTED ANGULAR SCALE: it has a sqrt(machine-epsilon) floor of ~2.1e-8 rad
    // near zero angle, and a dot product that rounds to exactly 1 yields zero — so at
    // 1e-12 it carries no information in either direction. atan2(|a x b|, a·b) has no
    // such cancellation. The original 1e-12 failure against the acos measure is
    // retained (D-36, A2.1) and its value is printed here.
    const angle = (a: Vec3, b: Vec3): number => Math.atan2(vlen(vcross(a, b)), vdot(a, b));
    const worldA = qrot(ROT_A0, HINGE_AXIS);
    const worldB = qrot(ROT_B0_HINGE, HINGE_AXIS);
    const misalign = angle(worldA, worldB);
    const misalignAcos = Math.acos(Math.min(1, Math.max(-1, vdot(worldA, worldB))));
    // ...and what the DECLARATION's Qrel (about y, not about the hinge axis) would have given.
    const worldBad = qrot(ROT_B0, HINGE_AXIS);
    const misalignBad = angle(worldA, worldBad);
    log(`C0f hinge substitute initial axis misalignment ${misalign.toExponential(3)} rad by atan2 `
      + `(<= 1e-14: the substitute's own constraint HOLDS at release); the ill-conditioned acos measure of `
      + `A1.4 reported ${misalignAcos.toExponential(3)} rad against its own 1e-12, a scale at which acos is `
      + `unreliable — D-36/A2 | `
      + `with the declaration's Qrel the SAME corrected measure gives ${(misalignBad * 180 / Math.PI).toFixed(4)} deg: `
      + 'its constraint was VIOLATED at release and the solver spent the run yanking it (D-36, A1.4)');
    expect(misalign).toBeLessThanOrEqual(1e-14);                 // A2.3's FORWARD PREDICTION
    // DISCRIMINATING: the same corrected formula must still SEE the 35 deg defect.
    expect(misalignBad).toBeCloseTo(0.6108652381980153, 12);
  });

  test('C0d the stamped momentum literals: |P(0)| = 2.653912... and |L(0)| = 0.504', () => {
    const P = M_TOT * vlen(V_C);
    log(`C0d |P(0)| = ${P.toFixed(9)} kg·m/s (stamped 2.653912…), |L(0)| = ${(I_ZZ * OMEGA_MAG).toFixed(9)} kg·m²/s (stamped 0.504)`);
    // A1.1 — the stamped 2.6539121 was MY ARITHMETIC SLIP and stays on the record as wrong.
    // Corrected by hand recomputation (A1.1): 3 x sqrt(0.7825) = 3 x 0.8845903006477066.
    expect(P).toBeCloseTo(2.65377090194312, 12);
    expect(I_ZZ * OMEGA_MAG).toBeCloseTo(0.504, 12);
  });
});

// ===========================================================================
// C1 — THE M LADDER AND THE OFFERED PROFILE.  Declaration §3.7, §3.8.
// The selection rule was declared before any of this ran.
// ===========================================================================

interface Rung { M: number; ball: Trace; fixed: Trace }
const ladder: Rung[] = [];

describe('C1 — the §2 witnesses over the whole supported ladder, at M = 4 and every rung', () => {
  test('C1a ball pair and fixed pair, 10.000 s, vacuum, gravity-free, no contacts, at every supported profile', () => {
    for (const M of SUPPORTED_SUBSTEPS) {
      const ball = traceRun(ballPairScene(M));
      const fixed = traceRun(fixedPairScene(M));
      ladder.push({ M, ball, fixed });
      for (const [name, t] of [['BALL ', ball], ['FIXED', fixed]] as const) {
        log(`C1a M=${String(M).padStart(3)} ${name} | max anchor ${t.maxAnchor.toExponential(3)} m`
          + ` | max frame err ${t.maxFrame.toExponential(3)} rad`
          + ` | KE_0 ${t.ke0.toFixed(6)} J | max |dE|/KE_0 ${(100 * t.maxEnergyDrift / t.ke0).toFixed(4)} %`
          + ` | ${t.msPerTick.toFixed(4)} ms/tick | contacts ${t.contacts}`
          + ` | D_owned ${t.ownedDissipation} | contributions ${t.maxContributions} | foreign ${t.foreign}`);
      }
    }
    // NO CONTACTS, NO OWNED DISSIPATION, NO FORCE OF OURS — asserted, not assumed.
    for (const r of ladder) for (const t of [r.ball, r.fixed]) {
      expect(t.contacts).toBe(0);
      expect(t.ownedDissipation).toBe(0);
      expect(t.maxContributions).toBe(0);
      expect(t.foreign).toBe(0);
    }
  }, 900_000);

  test('C1b THE OFFERED PROFILE, by the rule declared before any measurement', () => {
    expect(ladder.length).toBe(SUPPORTED_SUBSTEPS.length);
    const meets = (t: Trace, isFixed: boolean): boolean =>
      t.maxAnchor <= T1_ANCHOR && (!isFixed || t.maxFrame <= T2_FRAME) && t.maxEnergyDrift / t.ke0 <= T3_ENERGY;
    const rows = ladder.map((r) => ({
      M: r.M, ball: meets(r.ball, false), fixed: meets(r.fixed, true),
    }));
    for (const r of rows) log(`C1b M=${String(r.M).padStart(3)}  ball meets T1+T3: ${r.ball}   fixed meets T1+T2+T3: ${r.fixed}`);
    const offered = rows.find((r) => r.ball && r.fixed)?.M ?? null;
    log(`C1b OFFERED PROFILE = ${offered === null ? 'NONE — §2 IS A MATERIAL MISS' : `M = ${offered}`}`
      + `  (declaration's stamped PREDICTION was M = 32)`);
    expect(offered).not.toBeNull();
  });
});

// ===========================================================================
// C2 — §2 PRODUCT TARGETS AT THE OFFERED PROFILE
// ===========================================================================

/** Resolved by C1b's rule. Read only after C1a has filled the ladder. */
function offeredProfile(): number {
  const meets = (t: Trace, isFixed: boolean): boolean =>
    t.maxAnchor <= T1_ANCHOR && (!isFixed || t.maxFrame <= T2_FRAME) && t.maxEnergyDrift / t.ke0 <= T3_ENERGY;
  const r = ladder.find((x) => meets(x.ball, false) && meets(x.fixed, true));
  if (!r) throw new Error('No supported profile meets the §2 targets: §2 is a material miss and dependent UI is PAUSED');
  return r.M;
}

describe('C2 — §2 targets T1/T2/T3 at the offered profile, and the legacy M = 4 reported alongside', () => {
  test('C2a BALL PAIR meets T1 (anchor <= 1e-3 m) and T3 (energy <= 1 %)', () => {
    const M = offeredProfile();
    const t = ladder.find((r) => r.M === M)!.ball, legacy = ladder.find((r) => r.M === 4)!.ball;
    log(`C2a BALL at M=${M}: anchor ${t.maxAnchor.toExponential(3)} m (<= 1e-3), `
      + `energy ${(100 * t.maxEnergyDrift / t.ke0).toFixed(4)} % (<= 1 %), ${t.msPerTick.toFixed(4)} ms/tick`
      + ` || LEGACY M=4: anchor ${legacy.maxAnchor.toExponential(3)} m, energy `
      + `${(100 * legacy.maxEnergyDrift / legacy.ke0).toFixed(4)} %, ${legacy.msPerTick.toFixed(4)} ms/tick`);
    expect(t.maxAnchor).toBeLessThanOrEqual(T1_ANCHOR);
    expect(t.maxEnergyDrift / t.ke0).toBeLessThanOrEqual(T3_ENERGY);
  });

  test('C2b FIXED PAIR meets T1, T2 (frame <= 1e-3 rad) and T3', () => {
    const M = offeredProfile();
    const t = ladder.find((r) => r.M === M)!.fixed, legacy = ladder.find((r) => r.M === 4)!.fixed;
    log(`C2b FIXED at M=${M}: anchor ${t.maxAnchor.toExponential(3)} m, frame ${t.maxFrame.toExponential(3)} rad, `
      + `energy ${(100 * t.maxEnergyDrift / t.ke0).toFixed(4)} %, ${t.msPerTick.toFixed(4)} ms/tick`
      + ` || LEGACY M=4: anchor ${legacy.maxAnchor.toExponential(3)} m, frame ${legacy.maxFrame.toExponential(3)} rad, `
      + `energy ${(100 * legacy.maxEnergyDrift / legacy.ke0).toFixed(4)} %, ${legacy.msPerTick.toFixed(4)} ms/tick`);
    expect(t.maxAnchor).toBeLessThanOrEqual(T1_ANCHOR);
    expect(t.maxFrame).toBeLessThanOrEqual(T2_FRAME);
    expect(t.maxEnergyDrift / t.ke0).toBeLessThanOrEqual(T3_ENERGY);
  });

  test('C2c NO constraint loss is booked as heat or owned dissipation: it stays UNATTRIBUTED', () => {
    const M = offeredProfile();
    const sim = new SimWorld(); sim.build(ballPairScene(M));
    const e0 = sim.budget.current.total;
    runTicks(sim, TICKS);
    const b = sim.budget;
    log(`C2c BALL at M=${M} after 10 s: E_mech ${e0.toFixed(9)} -> ${b.current.total.toFixed(9)} J | `
      + `D_owned ${b.dissipatedDrag + b.dissipatedSpringDamper} J | interventions ${b.interventionsTotal} J | `
      + `W_hand ${b.handWorkExternal} J | UNATTRIBUTED ${b.unattributed.toExponential(6)} J`);
    expect(b.dissipatedDrag).toBe(0);
    expect(b.dissipatedSpringDamper).toBe(0);
    expect(b.interventionsTotal).toBe(0);
    expect(b.handWorkExternal).toBe(0);
    // The WHOLE deficit is the unattributed remainder, to the last bit of the identity.
    expect(Math.abs(b.unattributed - (b.current.total - e0))).toBeLessThan(1e-12);
    sim.rapier.free();
  }, 300_000);
});

// ===========================================================================
// C3 — §3 DISCRIMINATION.  A SUBSTITUTE MUST FAIL.
// ===========================================================================

describe('C3 — discriminating witnesses: the substitutes must FAIL', () => {
  test('C3a BALL allows rotation about at least TWO independent axes while its anchors stay joined', () => {
    const M = offeredProfile();
    const t = ladder.find((r) => r.M === M)!.ball;
    const s = spread(t.u);
    log(`C3a BALL at M=${M}: max |u| ${s.maxU.toFixed(6)} rad (>= ${BALL_MOTION}), SPREAD ${s.spread.toFixed(6)} `
      + `(>= ${BALL_SPREAD}), eigenvalues ${s.eig.map((x) => x.toExponential(3)).join(', ')}, `
      + `max anchor ${t.maxAnchor.toExponential(3)} m (<= 1e-3)`);
    expect(s.maxU).toBeGreaterThanOrEqual(BALL_MOTION);     // B1 — NOT FROZEN
    expect(s.spread).toBeGreaterThanOrEqual(BALL_SPREAD);   // B2 — two independent axes
    expect(t.maxAnchor).toBeLessThanOrEqual(T1_ANCHOR);     // B3 — anchors stay joined
  });

  test('C3b THE HINGE SUBSTITUTE, under its own best conditions, FAILS the ball criterion', () => {
    const M = offeredProfile();
    const t = traceRun(hingeSubstituteScene(M));
    const s = spread(t.u);
    log(`C3b HINGE SUBSTITUTE at M=${M}: max |u| ${s.maxU.toFixed(6)} rad (>= ${BALL_MOTION}: it is NOT frozen), `
      + `SPREAD ${s.spread.toExponential(4)} — must be < ${HINGE_SPREAD} and it fails the ball's >= ${BALL_SPREAD}`);
    expect(s.maxU).toBeGreaterThanOrEqual(BALL_MOTION);     // H1 — the substitute rotates plenty
    expect(s.spread).toBeLessThan(HINGE_SPREAD);            // H2 — it cannot reach a second axis
    expect(s.spread).toBeLessThan(BALL_SPREAD);             // ...so it FAILS B2
  }, 300_000);

  test('C3c FIXED retains its NON-IDENTITY relative pose while the assembly genuinely moves', () => {
    const M = offeredProfile();
    const t = ladder.find((r) => r.M === M)!.fixed;
    const first = t.poses[0], last = t.poses[t.poses.length - 1];
    const comFirst = vscale(vadd(vscale(first.rA, M_A), vscale(first.rB, M_B)), 1 / M_TOT);
    const comLast = vscale(vadd(vscale(last.rA, M_A), vscale(last.rB, M_B)), 1 / M_TOT);
    const travelled = vlen(vsub(comLast, comFirst));
    const turned = OMEGA_MAG * T_END;                       // analytic, from the stamped ω
    log(`C3c FIXED at M=${M}: q_rel(0) angle ${(qangle(QREL) * 180 / Math.PI).toFixed(4)} deg (non-identity), `
      + `max frame err ${t.maxFrame.toExponential(3)} rad (<= 1e-3), COM travelled ${travelled.toFixed(6)} m `
      + `(>= ${FIXED_MOVES}, predicted ${(vlen(V_C) * T_END).toFixed(6)}), assembly turned ${turned.toFixed(3)} rad (>= 2π)`);
    expect(qangle(QREL)).toBeGreaterThan(0.1);              // F1 — NON-IDENTITY
    expect(t.maxFrame).toBeLessThanOrEqual(T2_FRAME);       // F2 — retained
    expect(travelled).toBeGreaterThanOrEqual(FIXED_MOVES);  // F3 — it really MOVES
    expect(turned).toBeGreaterThanOrEqual(FIXED_TURNS);     // F4 — it really ROTATES
    expect(t.maxAnchor).toBeLessThanOrEqual(T1_ANCHOR);     // F5
  });

  test('C3d THE BALL SUBSTITUTE, on the identical fixture, FAILS the fixed criterion', () => {
    const M = offeredProfile();
    const sub = ballSubstituteScene(M);
    const sim = new SimWorld(); sim.build(sub);
    const decl: FixedJointDesc = fixedPairScene(M).joints![0] as FixedJointDesc;
    let maxTheta = 0;
    for (let i = 0; i <= TICKS; i++) {
      const pa = poseOfBody(sim, 'sphA'), pb = poseOfBody(sim, 'sphB');
      maxTheta = Math.max(maxTheta, qangle(qmul(qconj(frameWorld(decl, 'A', pa)), frameWorld(decl, 'B', pb))));
      if (i < TICKS) sim.tickOnce();
    }
    log(`C3d BALL SUBSTITUTE at M=${M} on the IDENTICAL fixed fixture: max relative-pose error `
      + `${maxTheta.toFixed(6)} rad — must be >= ${BALL_SUBSTITUTE_FAILS} (it fails the fixed criterion of 1e-3 by `
      + `${(maxTheta / T2_FRAME).toExponential(2)}x)`);
    expect(maxTheta).toBeGreaterThanOrEqual(BALL_SUBSTITUTE_FAILS);   // S1
    expect(maxTheta).toBeGreaterThan(T2_FRAME);
    sim.rapier.free();
  }, 300_000);

  test('C3e FIXED-TO-WORLD holds under a recorded impulse, and the unconnected control MOVES', () => {
    const M = offeredProfile();
    const t = traceRun(fixedWorldScene(M, true), { pushAt: { tick: FW_PUSH_TICK, target: 'held', impulse: FW_IMPULSE } });
    const ctl = traceRun(fixedWorldScene(M, false), { pushAt: { tick: FW_PUSH_TICK, target: 'held', impulse: FW_IMPULSE } });
    const ctlMoved = vlen(vsub(ctl.poses[ctl.poses.length - 1].rB, ctl.poses[0].rB));
    log(`C3e FIXED-TO-WORLD at M=${M}, impulse |J| = ${vlen(FW_IMPULSE).toFixed(6)} N·s at t = 1.000 s: `
      + `max anchor ${t.maxAnchor.toExponential(3)} m (<= 1e-3), max frame err ${t.maxFrame.toExponential(3)} rad (<= 1e-3), `
      + `contacts ${t.contacts} | NON-VACUITY CONTROL, same impulse with the connection removed: the body moved `
      + `${ctlMoved.toFixed(6)} m (>= ${FW_CONTROL})`);
    expect(t.contacts).toBe(0);
    expect(t.maxAnchor).toBeLessThanOrEqual(T1_ANCHOR);           // FW-POS
    expect(t.maxFrame).toBeLessThanOrEqual(T2_FRAME);             // FW-ANG
    expect(ctlMoved).toBeGreaterThanOrEqual(FW_CONTROL);          // FW-CONTROL
  }, 300_000);
});

// ===========================================================================
// C4 — THE INDEPENDENT REFERENCE.  §3: reading the adapter's own fields back is
// explicitly insufficient, so both references here are computed from the stamped
// initial conditions and the AUTHORED masses and radii alone.
// ===========================================================================

describe('C4 — the ANALYTIC rigid-assembly reference and the phase-free momentum reference', () => {
  /** The analytic comparison, for one trace. */
  function analyticError(t: Trace): { maxPos: number; maxAng: number } {
    let maxPos = 0, maxAng = 0;
    for (const p of t.poses) {
      const Rw = qaxisAngle(OMEGA0, OMEGA_MAG * p.t);
      for (const [r0, q0, r, q] of [
        [R_A0, ROT_A0, p.rA, p.qA], [R_B0, ROT_B0, p.rB, p.qB],
      ] as Array<[Vec3, Quat, Vec3, Quat]>) {
        const want = vadd(vadd(R_C0, vscale(V_C, p.t)), qrot(Rw, vsub(r0, R_C0)));
        maxPos = Math.max(maxPos, vlen(vsub(r, want)));
        maxAng = Math.max(maxAng, qangle(qmul(qconj(qmul(Rw, q0)), q)));
      }
    }
    return { maxPos, maxAng };
  }

  /**
   * ===========================================================================
   * C4a IS A RETAINED RED.  IT MUST STAY RED AND UNCHANGED.
   * ===========================================================================
   * ANALYTIC-POS <= 5e-3 m and ANALYTIC-ANG <= 5e-3 rad are the ORIGINAL stamped
   * tolerances of EXPECTATIONS-BB2-CONNECTIONS.md §3.4, asserted against the
   * ORIGINAL 10.000 s window on the ORIGINAL fixture. THEY ARE NOT WIDENED, the
   * duration is NOT shortened, the case is NOT deleted and no passing rung is
   * substituted. See DEVIATIONS D-36 and EXPECTATIONS-BB2-CONNECTIONS-A1.md A1.6.
   *
   * NO MECHANISM IS ESTABLISHED. The measured orientation discrepancy is CONSISTENT
   * WITH accumulated angular-momentum drift, Δφ ≈ (|ΔL|/|L|)·|ω|·T/2, UNDER THE
   * ASSUMPTIONS of approximately linear rate drift, fixed relevant inertia and axis,
   * and negligible other orientation error. That is a scalar consistency check, not
   * an identified cause, and a consistent account does not license amending the
   * prediction. §3's independent-reference requirement is met
   * by C4b, the phase-free momentum reference, which PASSES every stamped bound.
   */
  test('C4a [RETAINED RED] the fixed assembly follows the CLOSED-FORM free rigid-body motion', () => {
    const M = offeredProfile();
    for (const r of ladder) {
      const e = analyticError(r.fixed);
      log(`C4a ladder M=${String(r.M).padStart(3)}: analytic position error ${e.maxPos.toExponential(4)} m, `
        + `orientation error ${e.maxAng.toExponential(4)} rad, max |ΔL|/|L0| implied phase `
        + `${(e.maxAng / (OMEGA_MAG * T_END)).toExponential(3)} rad per rad turned`);
    }
    const t = ladder.find((r) => r.M === M)!.fixed;
    let maxPos = 0, maxAng = 0;
    for (const p of t.poses) {
      // ANALYTIC: R_ω(t) = rotation by |ω0|·t about ω̂0 ; r_i = r_c(0) + v_c·t + R_ω·(r_i(0) − r_c(0))
      const Rw = qaxisAngle(OMEGA0, OMEGA_MAG * p.t);
      for (const [r0, q0, r, q] of [
        [R_A0, ROT_A0, p.rA, p.qA], [R_B0, ROT_B0, p.rB, p.qB],
      ] as Array<[Vec3, Quat, Vec3, Quat]>) {
        const want = vadd(vadd(R_C0, vscale(V_C, p.t)), qrot(Rw, vsub(r0, R_C0)));
        maxPos = Math.max(maxPos, vlen(vsub(r, want)));
        maxAng = Math.max(maxAng, qangle(qmul(qconj(qmul(Rw, q0)), q)));
      }
    }
    log(`C4a ANALYTIC RIGID-ASSEMBLY REFERENCE at M=${M} over ${T_END.toFixed(3)} s `
      + `(${(OMEGA_MAG * T_END).toFixed(2)} rad = ${(OMEGA_MAG * T_END / (2 * Math.PI)).toFixed(3)} turns): `
      + `max position error ${maxPos.toExponential(4)} m (<= ${ANALYTIC_POS}), `
      + `max orientation error ${maxAng.toExponential(4)} rad (<= ${ANALYTIC_ANG})`);
    expect(maxPos).toBeLessThanOrEqual(ANALYTIC_POS);
    expect(maxAng).toBeLessThanOrEqual(ANALYTIC_ANG);
  });

  test('C4b linear and angular momentum are conserved against the ANALYTIC predicted constants', () => {
    const M = offeredProfile();
    const t = ladder.find((r) => r.M === M)!.fixed;
    // I_i is the ANALYTIC 0.4·m·r² of the authored sphere, isotropic, never read back.
    const momenta = t.poses.map((p) => {
      const P = vadd(vscale(p.vA, M_A), vscale(p.vB, M_B));
      const rc = vscale(vadd(vscale(p.rA, M_A), vscale(p.rB, M_B)), 1 / M_TOT);
      const vc = vscale(P, 1 / M_TOT);
      const L = vadd(
        vadd(vscale(p.wA, I_A), vscale(vcross(vsub(p.rA, rc), vsub(p.vA, vc)), M_A)),
        vadd(vscale(p.wB, I_B), vscale(vcross(vsub(p.rB, rc), vsub(p.vB, vc)), M_B)),
      );
      return { P, L };
    });
    const P0 = momenta[0].P, L0 = momenta[0].L;
    const maxP = Math.max(...momenta.map((m) => vlen(vsub(m.P, P0)) / vlen(P0)));
    const maxL = Math.max(...momenta.map((m) => vlen(vsub(m.L, L0)) / vlen(L0)));
    const l0Err = Math.abs(vlen(L0) / (I_ZZ * OMEGA_MAG) - 1);
    log(`C4b MOMENTUM at M=${M}: |P(0)| ${vlen(P0).toFixed(9)} (analytic ${(M_TOT * vlen(V_C)).toFixed(9)}), `
      + `max |ΔP|/|P0| ${maxP.toExponential(3)} (<= ${MOM_P}) | `
      + `|L(0)| ${vlen(L0).toFixed(9)} vs the ANALYTIC composite I_zz·ω = ${(I_ZZ * OMEGA_MAG).toFixed(9)} `
      + `kg·m²/s, relative ${l0Err.toExponential(3)} (<= ${MOM_L0}) | max |ΔL|/|L0| ${maxL.toExponential(3)} (<= ${MOM_L})`);
    expect(Math.abs(vlen(P0) / (M_TOT * vlen(V_C)) - 1)).toBeLessThanOrEqual(F32_ULPS);
    expect(l0Err).toBeLessThanOrEqual(MOM_L0);      // MOM-L0: the composite inertia is the analytic one
    expect(maxP).toBeLessThanOrEqual(MOM_P);        // MOM-P
    expect(maxL).toBeLessThanOrEqual(MOM_L);        // MOM-L
  });
});
