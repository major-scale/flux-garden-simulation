/**
 * AUTHORED JOINTS AND CONNECTIONS.
 *
 * BB1 stage one shipped HINGE and SLIDER. **BB2 adds BALL and FIXED**, against
 * `bridge/BATCH2-ACCEPTANCE-v1.md` and the stamped
 * `EXPECTATIONS-BB2-CONNECTIONS.md` (sha256 748227ef…, stamped 2026-09-06T06:30:37Z).
 *
 * ===========================================================================
 * A JOINT IS AUTHORED CONTENT. NO RAPIER HANDLE EVER APPEARS IN ONE.
 * ===========================================================================
 * A `JointDesc` carries an APPLICATION-OWNED string id and application-owned
 * body ids, exactly as `SpringDesc` does. The engine's `ImpulseJointHandle`
 * lives in the runtime map and in the CHECKPOINT's id->handle mapping, and
 * nowhere else — the same boundary springs and bodies already respect.
 *
 * ===========================================================================
 * HONEST, VARIANT-SPECIFIC SEMANTICS.  NO DUMMY AXIS STANDING IN FOR A FRAME.
 * ===========================================================================
 * `JointDesc` is a DISCRIMINATED UNION, and the fields differ by variant because
 * the constraints differ:
 *
 *   hinge   anchorA anchorB axis                one rotational DOF about `axis`
 *   slider  anchorA anchorB axis                one translational DOF along `axis`
 *   ball    anchorA anchorB                     THREE rotational DOF, NO axis and
 *                                               NO frame: a ball has no preferred
 *                                               direction, so it carries no field
 *                                               pretending it has one
 *   fixed   anchorA anchorB frameA frameB       ZERO DOF. The two unit quaternions
 *                                               are the CONNECTION FRAME expressed
 *                                               in each body's own local frame.
 *                                               They are NOT an axis and an axis
 *                                               could not stand in for them: a
 *                                               frame is three-dimensional.
 *
 * An `axis` on a ball or a fixed, a missing `axis` on a hinge or slider, and a
 * missing frame on a fixed are all REFUSED as unknown/missing fields by
 * `validateAuthored` — never ignored and never defaulted.
 *
 * ===========================================================================
 * WHAT A JOINT IS *NOT*, IN THIS BUILD
 * ===========================================================================
 *   - It is NOT one of our force laws. A joint is a CONSTRAINT resolved inside
 *     Rapier's impulse solver. We never see the constraint force as a force, so
 *     the `ForceRegistry`'s single-writer discipline is untouched by joints and
 *     the user-force accumulator still contains only our own contributions.
 *
 *   - **WE DO NOT PROMISE AN EXACT DECOMPOSITION OF JOINT CONSTRAINT WORK.**
 *     An ideal holonomic constraint does no work; a solved-by-impulses one does
 *     a small amount, from position stabilization and from the finite step. We
 *     cannot separate that from contact, restitution and integration error, so
 *     it is NOT estimated, NOT booked as owned dissipation, and NOT added as a
 *     potential. It stays inside UNATTRIBUTED with everything else we cannot
 *     attribute. **The standing prohibition holds: constraint error is never
 *     relabelled physical heat.** This is unchanged by ball and fixed.
 *
 *   - It is NOT a motor. No wrapper configures a motor, a limit or a spring on
 *     any joint axis, so nothing here can be mistaken for the passive spring
 *     model in `construction.ts`.
 */

import {
  qangle, qconj, qmul, qrot, vlen, vsub,
  type Quat, type Vec3,
} from './units';

/** Fields every variant carries. */
export interface JointCommon {
  /** Application-owned id, e.g. "ball0". Stable across save/load and replay. */
  id: string;
  /** Application-owned entity ids. */
  bodyA: string;
  bodyB: string;
  /**
   * THE ATTACHMENT POINT IN BODY A'S OWN LOCAL FRAME, metres.
   * The frame is named, not implied: it is the local frame of the entity named
   * by `bodyA`, origin at that body's centre of mass, axes fixed in that body.
   */
  anchorA: Vec3;
  /** THE ATTACHMENT POINT IN BODY B'S OWN LOCAL FRAME, metres. */
  anchorB: Vec3;
}

/**
 * HINGE — one rotational degree of freedom about `axis`.
 * SLIDER — one translational degree of freedom along `axis`.
 *
 * `axis` is a unit direction in the same local frames (the two bodies' local
 * axes are taken to be the same direction at authoring time, which is what both
 * shipped scenes arrange).
 */
export interface HingeJointDesc extends JointCommon {
  kind: 'hinge';
  axis: Vec3;
}
export interface SliderJointDesc extends JointCommon {
  kind: 'slider';
  axis: Vec3;
}
/** Either variant whose remaining freedom is described by ONE axis. */
export type AxisJointDesc = HingeJointDesc | SliderJointDesc;

/**
 * BALL — three rotational degrees of freedom about the shared anchor point. The
 * two anchors are held coincident and NOTHING about orientation is constrained.
 * There is no axis and no frame, so this variant carries neither.
 */
export interface BallJointDesc extends JointCommon {
  kind: 'ball';
}

/**
 * FIXED — zero degrees of freedom. Both the anchors AND the connection frames
 * are held coincident:
 *
 *     p_A(t) = r_A(t) + R_A(t)·anchorA  ==  p_B(t) = r_B(t) + R_B(t)·anchorB
 *     Q_A(t) = R_A(t) ⊗ frameA          ==  Q_B(t) = R_B(t) ⊗ frameB
 *
 * so the AUTHORED INITIAL RELATIVE POSE q_rel = R_A⁻¹ ⊗ R_B is preserved for all
 * time, whatever it was — INCLUDING A NON-IDENTITY ONE. `makeConnection` derives
 * the pair from the bodies' authored rotations under the declared convention
 * frameA = identity, frameB = R_B⁻¹ ⊗ R_A, and then STORES BOTH EXPLICITLY. They
 * are authored content, not recomputed at build time.
 */
export interface FixedJointDesc extends JointCommon {
  kind: 'fixed';
  /** Unit quaternion: the CONNECTION FRAME expressed in body A's local frame. */
  frameA: Quat;
  /** Unit quaternion: the CONNECTION FRAME expressed in body B's local frame. */
  frameB: Quat;
}

export type JointDesc = HingeJointDesc | SliderJointDesc | BallJointDesc | FixedJointDesc;

/** Every variant this build understands, in a fixed order. */
export const JOINT_KINDS = ['hinge', 'slider', 'ball', 'fixed'] as const;
/** The variants BB2 makes AUTHORABLE through the UI. Hinge and slider stay preset-only. */
export const CONNECTION_KINDS = ['ball', 'fixed'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const isConnectionKind = (k: unknown): k is ConnectionKind =>
  (CONNECTION_KINDS as readonly unknown[]).includes(k);

/** The variants whose anchors must coincide in EVERY direction, so misalignment is well defined. */
export const isFullyAnchored = (j: JointDesc): j is BallJointDesc | FixedJointDesc =>
  j.kind === 'ball' || j.kind === 'fixed';

// ---------------------------------------------------------------------------
// THE MISALIGNMENT GATE.  EXPECTATIONS-BB2-CONNECTIONS.md PART 2.
// ---------------------------------------------------------------------------

/**
 * m / rad. A NUMERICAL-REPRESENTATION NOISE BAND, NOT A SNAPPING BAND.
 *
 * Chosen so a residual that could only have come from an IEEE-754 round trip —
 * a quaternion renormalisation, or the degrees<->quaternion round trip the body
 * edit form performs — is not mistaken for an authored misalignment. One micron
 * is THREE ORDERS OF MAGNITUDE below the 1e-3 m constraint-holding target the
 * acceptance criteria set, so nothing inside the band can be confused with the
 * solver correcting a real misalignment. The MEASURED residual is reported by
 * the panel whether or not it is inside the band, so it is never hidden.
 */
export const ALIGN_TOL_POS = 1e-6;
export const ALIGN_TOL_ANG = 1e-6;

/** Just enough of an entity to place a connection: its authored world pose. */
export interface BodyPose { translation: Vec3; rotation: Quat }
export type PoseLookup = (id: string) => BodyPose | undefined;

export interface Alignment {
  /** m. |p_A − p_B| at the state supplied. */
  separation: number;
  /** rad, or null for a variant with no orientation constraint (ball, hinge, slider). */
  frameError: number | null;
  /** True when the connection is satisfied to within the declared noise band. */
  aligned: boolean;
}

/** World position of a joint's anchor on the given side. m. */
export function anchorWorld(j: JointDesc, side: 'A' | 'B', pose: BodyPose): Vec3 {
  const local = side === 'A' ? j.anchorA : j.anchorB;
  const r = qrot(pose.rotation, local);
  return { x: pose.translation.x + r.x, y: pose.translation.y + r.y, z: pose.translation.z + r.z };
}

/** World orientation of a FIXED connection's frame on the given side. */
export function frameWorld(j: FixedJointDesc, side: 'A' | 'B', pose: BodyPose): Quat {
  return qmul(pose.rotation, side === 'A' ? j.frameA : j.frameB);
}

/**
 * The MEASURED alignment of a ball or fixed connection at the supplied poses.
 * Returns null for hinge and slider, whose gate is deliberately out of scope
 * (a slider's anchors are LEGITIMATELY separated along its free travel axis, and
 * legacy hinge/slider documents must keep loading unchanged).
 */
export function connectionAlignment(j: JointDesc, poseOf: PoseLookup): Alignment | null {
  if (!isFullyAnchored(j)) return null;
  const a = poseOf(j.bodyA), b = poseOf(j.bodyB);
  if (!a || !b) return null;
  const separation = vlen(vsub(anchorWorld(j, 'A', a), anchorWorld(j, 'B', b)));
  const frameError = j.kind === 'fixed'
    ? qangle(qmul(qconj(frameWorld(j, 'A', a)), frameWorld(j, 'B', b)))
    : null;
  return {
    separation,
    frameError,
    aligned: separation <= ALIGN_TOL_POS && (frameError === null || frameError <= ALIGN_TOL_ANG),
  };
}

export type JointIssue = { severity: 'refuse'; message: string };

/**
 * THE GATE ITSELF. A misaligned ball or fixed connection is REFUSED, with the
 * measured separation and frame error NAMED, and the authored placement
 * operation NAMED as the alternative. It is NEVER handed to the solver to be
 * pulled into place.
 */
export function alignmentIssues(j: JointDesc, poseOf: PoseLookup): JointIssue[] {
  const al = connectionAlignment(j, poseOf);
  if (!al || al.aligned) return [];
  const parts: string[] = [];
  if (al.separation > ALIGN_TOL_POS) {
    parts.push(`anchors are ${al.separation.toExponential(3)} m apart (limit ${ALIGN_TOL_POS.toExponential(0)} m)`);
  }
  if (al.frameError !== null && al.frameError > ALIGN_TOL_ANG) {
    parts.push(`connection frames differ by ${al.frameError.toExponential(3)} rad (limit ${ALIGN_TOL_ANG.toExponential(0)} rad)`);
  }
  return [{
    severity: 'refuse',
    message: `connection ${j.id}: MISALIGNED and REFUSED — ${parts.join('; ')}. `
      + `It is not snapped into place by the solver. Either author the two bodies so the connection is `
      + `satisfied, or run the placement operation "place ${j.bodyB} to satisfy ${j.id}", which is an `
      + `authored edit and is recorded in the edit audit.`,
  }];
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

/**
 * Refusals are surfaced, never silently repaired. A zero-length or badly
 * normalised axis is refused rather than normalised behind the author's back,
 * because a joint whose axis the build quietly changed is not the joint that
 * was authored. The same holds for a non-unit connection frame.
 *
 * `poseOf` is optional so that callers with no entity poses to hand (the engine
 * insert path passes them; a pure-schema caller need not) still get the
 * structural checks. When it IS supplied the misalignment gate runs too.
 */
export function validateJoint(j: JointDesc, entityIds: ReadonlySet<string>, poseOf?: PoseLookup): JointIssue[] {
  const out: JointIssue[] = [];
  if (j.bodyA === j.bodyB) {
    out.push({ severity: 'refuse', message: `joint ${j.id}: bodyA and bodyB are the same entity (${j.bodyA})` });
  }
  for (const id of [j.bodyA, j.bodyB]) {
    if (!entityIds.has(id)) out.push({ severity: 'refuse', message: `joint ${j.id}: no entity ${id}` });
  }
  if (j.kind === 'hinge' || j.kind === 'slider') {
    const n = vlen(j.axis);
    if (!(n > 0)) {
      out.push({ severity: 'refuse', message: `joint ${j.id}: axis has zero length` });
    } else if (Math.abs(n - 1) > 1e-6) {
      out.push({ severity: 'refuse', message: `joint ${j.id}: axis is not a unit vector (|axis| = ${n.toFixed(9)}); refused rather than normalised` });
    }
  }
  if (j.kind === 'fixed') {
    for (const side of ['frameA', 'frameB'] as const) {
      const q = j[side];
      const n = Math.hypot(q.x, q.y, q.z, q.w);
      if (Math.abs(n - 1) > 1e-6) {
        out.push({
          severity: 'refuse',
          message: `connection ${j.id}: ${side} is not a unit quaternion (|${side}| = ${n.toFixed(9)}); `
            + 'refused rather than renormalised — a connection frame the build quietly changed is not the one that was authored',
        });
      }
    }
  }
  if (out.length === 0 && poseOf) out.push(...alignmentIssues(j, poseOf));
  return out;
}

/** Human-readable, for the UI and the panels. The wording is part of the contract. */
export function describeJoint(j: JointDesc): string {
  const v = (a: Vec3): string => `(${a.x}, ${a.y}, ${a.z})`;
  switch (j.kind) {
    case 'hinge':
      return `HINGE ${j.id}: ${j.bodyA} <-> ${j.bodyB}, one rotational DOF about ${v(j.axis)}`;
    case 'slider':
      return `SLIDER ${j.id}: ${j.bodyA} <-> ${j.bodyB}, one translational DOF along ${v(j.axis)}`;
    case 'ball':
      return `BALL ${j.id}: ${j.bodyA} <-> ${j.bodyB}, anchors held coincident at `
        + `${v(j.anchorA)} in ${j.bodyA}'s local frame and ${v(j.anchorB)} in ${j.bodyB}'s local frame; `
        + 'THREE rotational DOF, no axis and no frame';
    case 'fixed':
      return `FIXED ${j.id}: ${j.bodyA} <-> ${j.bodyB}, anchors held coincident at `
        + `${v(j.anchorA)} in ${j.bodyA}'s local frame and ${v(j.anchorB)} in ${j.bodyB}'s local frame, `
        + `and the connection frames held coincident; ZERO DOF, relative pose held at `
        + `${((180 / Math.PI) * relativePoseAngle(j)).toFixed(3)} deg`;
  }
}

/**
 * rad. The relative pose a FIXED connection holds, as an angle: the rotation
 * taking body A's frame to body B's. Derived from the authored frames alone —
 * q_rel = R_A⁻¹ ⊗ R_B = frameA ⊗ frameB⁻¹ whenever the connection is satisfied.
 */
export function relativePoseAngle(j: FixedJointDesc): number {
  return qangle(qmul(j.frameA, qconj(j.frameB)));
}
