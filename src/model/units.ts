/**
 * FP1 — SI units, declared limits, and small vector/quaternion helpers.
 *
 * UNITS ARE SI AND DECLARED, everywhere in this build:
 *   length      m
 *   mass        kg
 *   time        s
 *   velocity    m/s
 *   angular vel rad/s
 *   force       N        = kg·m/s²
 *   torque      N·m
 *   impulse     N·s      = kg·m/s          (NOT a force)
 *   energy      J        = kg·m²/s²
 *   power       W        = J/s
 *   density     kg/m³
 *   stiffness k        N/m                 (linear spring: F = -k·x)
 *   damping   c        N·s/m               (linear damper: F = -c·v_rel)
 *
 * The ranges below are PROVISIONAL UI LIMITS. They are not a claim that every
 * combination inside them is validated. The validated set is the tested presets.
 * Extreme mass ratios are EXCLUDED rather than silently permitted.
 */

export const SI = {
  /** Standard gravity used as the world gravity magnitude. m/s². */
  G: 9.81,
  /** Density of the default still-air environment at ~15 °C, 1 atm. kg/m³. */
  RHO_AIR: 1.225,
  /** Density of the explicitly-selected vacuum environment. kg/m³. */
  RHO_VACUUM: 0.0,
  /** Fixed PUBLIC physics tick. s. Never varied — see sim/step.ts. */
  DT: 1 / 60,
  /**
   * INTERNAL FIXED SUB-STEPS PER PUBLIC TICK.
   *
   * A fixed public tick does not forbid a fixed internal subdivision. One public
   * tick advances the engine SUBSTEPS times by DT/SUBSTEPS, and OUR force
   * accumulators are cleared and rebuilt from the current state before EVERY one
   * of them. Rapier's own sub-division is pinned to 1 (see world.ts) so that our
   * refresh lands on every integration sub-step.
   *
   * Freezing a force across N engine sub-steps injects w·h²·omega² into the
   * one-step determinant, with w = 1 − (N+1)/(2N). At the shipped N = 4 that was
   * w = 0.375 and it cancelled roughly half the physical damping — recorded as
   * D-1 in DEVIATIONS.md. With N = 1, w = 0 and the sub-step determinant is
   * exactly 1 − h·gamma, independent of stiffness.
   */
  SUBSTEPS: 4,
} as const;

/** s. The internal fixed sub-step actually handed to the engine at the LEGACY profile. */
export const H_SUB = SI.DT / SI.SUBSTEPS;

/**
 * ===========================================================================
 * DECLARED NUMERICAL PROFILES.  (BB1 stage two, EXPECTATIONS-BB1-S2.md part A)
 * ===========================================================================
 * `SI.SUBSTEPS = 4` was a SELECTED CONFIGURATION, not a law of this project. A
 * construction may DECLARE its fixed internal sub-division; the public tick
 * stays 1/60 s and inputs stay keyed by (tick, seq), so nothing about public
 * tick or input semantics changes.
 *
 *   *** A CONSTRUCTION WITH NO DECLARED PROFILE MEANS M = 4, FOREVER. ***
 *
 * Replay promises the same result from the same initial state, the same input
 * AND the same numerical configuration. It does NOT promise that a coarse and a
 * refined solver walk the same trajectory. Old recordings therefore keep their
 * old configuration rather than having their interpretation silently changed.
 *
 * The supported set is the ladder that was actually MEASURED (the bounded
 * M = 4, 8, 16, 32, 64, 128 sweep the reviewer commissioned, stopped at 128).
 * A value outside it is REFUSED and surfaced — never silently substituted, and
 * never quietly rounded to a neighbour.
 */
export const SUPPORTED_SUBSTEPS: readonly number[] = [4, 8, 16, 32, 64, 128] as const;

/** The sub-step count a construction with no declared profile means. */
export const LEGACY_SUBSTEPS = SI.SUBSTEPS;

export function isSupportedSubsteps(n: unknown): n is number {
  return typeof n === 'number' && SUPPORTED_SUBSTEPS.includes(n);
}

/** The refusal message. One wording, so the UI, the loader and the tests agree. */
export function unsupportedSubstepsMessage(n: unknown): string {
  return `refused: numerical profile substeps = ${String(n)} is not one of the supported, measured `
    + `profiles {${SUPPORTED_SUBSTEPS.join(', ')}}. It is REFUSED rather than substituted: a run whose `
    + `internal step the build quietly changed is not the run that was authored.`;
}

/** s. The internal fixed sub-step for a given profile. */
export const hSubFor = (substeps: number): number => SI.DT / substeps;

/**
 * DECLARED RESOLVABILITY LIMIT for the spring regime the UI offers.
 *
 * The corrected scheme is first order in h: sigma_num/sigma − 1 ≈ h·gamma/2 and
 * T_num/T_d − 1 ≈ −(h·gamma/4 + (h·omega_d)²/24). Those bounds are only useful
 * while h·omega and h·gamma are small, so the offered regime is bounded by them
 * rather than by the old, never-validated stiffness/damping maxima.
 *
 * At h = 1/240 s: omega_n <= 72 rad/s, gamma <= 12 s⁻¹, worst-case derived error
 * sigma +2.59 %, T −1.64 %. Edits outside are REFUSED and surfaced, not clamped.
 */
export const RESOLVABILITY = {
  /** Dimensionless. omega_n · h. */
  maxOmegaH: 0.30,
  /** Dimensionless. gamma · h. */
  maxGammaH: 0.05,
} as const;

/**
 * rad/s / s⁻¹. The resolvable limits AT A GIVEN INTERNAL SUB-STEP. These are the
 * primitives: the guard must be computed from the h the world is ACTUALLY running,
 * not from a module constant that assumes M = 4. A scene that declares a finer
 * profile resolves a proportionally stiffer regime, and saying otherwise would be
 * a guard that no longer describes the integrator it is guarding.
 */
export const maxOmegaNFor = (hSub: number): number => RESOLVABILITY.maxOmegaH / hSub;
export const maxGammaFor = (hSub: number): number => RESOLVABILITY.maxGammaH / hSub;

/** rad/s. Largest natural frequency of a spring-carried mode this scheme resolves AT THE LEGACY M = 4. */
export const MAX_OMEGA_N = maxOmegaNFor(H_SUB);
/** s⁻¹. Largest damping rate C/m this scheme resolves AT THE LEGACY M = 4. */
export const MAX_GAMMA = maxGammaFor(H_SUB);

/** Provisional UI limits — see the header note. */
export const LIMITS = {
  sizeMin: 0.05,      // m, smallest half-extent*2 / diameter the UI will author
  sizeMax: 10.0,      // m
  massMin: 0.01,      // kg
  massMax: 500.0,     // kg
  speedMax: 20.0,     // m/s — the speed regime the drag model is declared over
  stiffnessMin: 1.0,      // N/m
  stiffnessMax: 200_000,  // N/m
  dampingMin: 0.0,        // N·s/m
  dampingMax: 5_000,      // N·s/m
  /**
   * Extreme mass ratios are excluded, not silently permitted. If the ratio of the
   * heaviest to the lightest dynamic body would exceed this, the edit is REFUSED
   * and the refusal is surfaced in the UI.
   */
  maxMassRatio: 2000,
  impulseMax: 200,    // N·s
  /**
   * m/s². The magnitude of world gravity the UI will author. 0 is allowed and
   * means free space. The upper bound is a PROVISIONAL UI limit like the others:
   * it is not a claim that every value inside it is validated, only that values
   * outside it are REFUSED rather than silently accepted.
   */
  gravityMax: 50,
} as const;

/** Vertical datum for gravitational potential energy. m. Declared, not assumed. */
export const GRAVITY_PE_DATUM_Y = 0;

// ---------------------------------------------------------------------------
// Minimal vector / quaternion helpers. Plain objects so they interop directly
// with Rapier's {x,y,z} and {x,y,z,w} value types with no conversion layer.
// ---------------------------------------------------------------------------

export interface Vec3 { x: number; y: number; z: number; }
export interface Quat { x: number; y: number; z: number; w: number; }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vlen = (a: Vec3): number => Math.sqrt(vdot(a, a));
export const vcross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vclone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

/** Rotate v by quaternion q (q must be unit). */
export function qrot(q: Quat, v: Vec3): Vec3 {
  // t = 2 * (q_vec x v); v' = v + q.w * t + q_vec x t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export const qconj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function qmul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Rotate v by the inverse of q. */
export const qinvrot = (q: Quat, v: Vec3): Vec3 => qrot(qconj(q), v);

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

// ---------------------------------------------------------------------------
// BB2 — quaternion angle / axis-angle / log map.
//
// Added for the ball and fixed CONNECTION witnesses and the misalignment gate
// (EXPECTATIONS-BB2-CONNECTIONS.md §1.2, §2.1, §4.1). Pure arithmetic on unit
// quaternions: no physics, no force law and no tolerance lives here.
// ---------------------------------------------------------------------------

/** The rotation angle of a unit quaternion, rad, in [0, π]. Sign-insensitive: q and -q are the same rotation. */
export function qangle(q: Quat): number {
  const v = Math.hypot(q.x, q.y, q.z);
  return 2 * Math.atan2(v, Math.abs(q.w));
}

/** Unit quaternion for a rotation of `angle` rad about `axis` (need not be normalised, must be nonzero). */
export function qaxisAngle(axis: Vec3, angle: number): Quat {
  const n = vlen(axis);
  if (!(n > 0)) throw new Error('qaxisAngle: zero axis');
  const s = Math.sin(angle / 2) / n;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

/**
 * The ROTATION VECTOR of a unit quaternion: direction = rotation axis, length =
 * rotation angle in rad, in [0, π]. The branch is chosen on the sign of w so that
 * q and -q — the same rotation — give the same vector.
 */
export function qlog(q: Quat): Vec3 {
  const s = q.w < 0 ? -1 : 1;
  const x = s * q.x, y = s * q.y, z = s * q.z, w = s * q.w;
  const v = Math.hypot(x, y, z);
  if (!(v > 0)) return { x: 0, y: 0, z: 0 };
  const a = 2 * Math.atan2(v, w) / v;
  return { x: x * a, y: y * a, z: z * a };
}

/** The angle between two unit quaternions as rotations, rad, in [0, π]. */
export const qdistance = (a: Quat, b: Quat): number => qangle(qmul(qconj(a), b));

/** Renormalise a unit quaternion. Used ONLY where an exact unit is derived arithmetically, never to repair authored data. */
export function qnorm(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (!(n > 0)) throw new Error('qnorm: zero quaternion');
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}
