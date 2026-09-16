/**
 * BB1 stage one — THE SCENE / PRESET CATALOGUE.
 *
 * ===========================================================================
 * PRESETS ARE AUTHORED CONTENT, NOT A CONSTRUCTION FRAMEWORK.
 * ===========================================================================
 * Each preset is a function that returns a `Construction`. They share the
 * helpers below where they genuinely share geometry, and they DO NOT go through
 * one identical construction path — the brief says explicitly not to force that.
 * Authored initial conditions, interventions and reference calculations rightly
 * differ per demo; what is shared is the physics, state, measurement and
 * recording machinery underneath.
 *
 * *** EVERY CONSTANT HERE IS THE ONE WRITTEN DOWN IN EXPECTATIONS-BB1-S1.md ***
 * (sha256 db9311d0…, stamped 2026-09-06T04:16:49Z, before any of this ran). The
 * witnesses read these same functions, so a scene and its prediction cannot
 * drift apart.
 *
 * The selector that switches between them resets the world AND the recording
 * coherently, through the existing `worldReplaced` boundary — see ui/main.ts.
 */

import {
  CONSTRUCTION_FORMAT_VERSION, defaultConstruction,
  type Construction, type EntityDesc, type NumericsDesc,
} from './construction';
import type { JointDesc } from './joints';
import { SI, type Quat, type Vec3 } from './units';

const Q_ID: Quat = { x: 0, y: 0, z: 0, w: 1 };
const V0: Vec3 = { x: 0, y: 0, z: 0 };

/** Quaternion for a rotation of `a` radians about +Z. */
export function qz(a: number): Quat {
  return { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) };
}

function ground(hx: number, hz: number): EntityDesc {
  return {
    id: 'ground', label: 'ground', kinematics: 'fixed',
    shape: { kind: 'box', hx, hy: 0.5, hz },
    material: { mass: 0, restitution: 0.0, friction: 0.8 },
    translation: { x: 0, y: -0.5, z: 0 },   // top face at y = 0
    rotation: Q_ID, linvel: V0, angvel: V0,
    colour: 0x3a4550,
  };
}

function shell(name: string, entities: EntityDesc[], opts: {
  medium: 'air' | 'vacuum';
  gravity?: Vec3;
  springs?: Construction['springs'];
  joints?: JointDesc[];
  /**
   * DECLARED NUMERICAL PROFILE. Left undefined by every scene that has not
   * measured one — and undefined MEANS the legacy 4 sub-steps, not "unspecified".
   */
  numerics?: NumericsDesc;
}): Construction {
  const c: Construction = {
    format: 'fp1-construction',
    formatVersion: CONSTRUCTION_FORMAT_VERSION,
    name,
    environment: { medium: opts.medium, gravity: opts.gravity ?? { x: 0, y: -SI.G, z: 0 } },
    entities,
    springs: opts.springs ?? [],
    joints: opts.joints ?? [],
    nextSerial: 1,
  };
  if (opts.numerics) c.numerics = { ...opts.numerics };
  return c;
}

// ===========================================================================
// DEMO 1 — VACUUM PROJECTILE.  Card 1.
// ===========================================================================

export const PROJECTILE = {
  /** m, COM at launch. */
  launch: { x: -4.0, y: 1.20, z: 0 },
  radius: 0.09,     // m
  mass: 0.4,        // kg
  speed: 12,        // m/s
  /** deg, above +X in the XY plane. */
  angleDeg: 40,
} as const;

/**
 * The shot sits at the launch point at rest. **Nothing launches it until the
 * launch intervention fires**, which is why this scene starts paused: a body
 * hanging in the air under gravity is not the declared initial condition, and a
 * pad to rest it on would put a contact force in the first tick of a demo whose
 * whole claim is that the flight is contact-free.
 */
export function projectileScene(medium: 'air' | 'vacuum' = 'vacuum'): Construction {
  const shot: EntityDesc = {
    id: 'shot', label: 'shot', kinematics: 'dynamic',
    shape: { kind: 'sphere', radius: PROJECTILE.radius },
    material: { mass: PROJECTILE.mass, restitution: 0.35, friction: 0.4 },
    translation: { ...PROJECTILE.launch },
    rotation: Q_ID, linvel: V0, angvel: V0,
    colour: 0xe8b44f,
  };
  // The ground is wide because gravity is editable: a Moon launch at the same
  // speed has a ~87 m range. It plays no part in the measured flight, which is
  // declared to end when the COM returns to launch height, well above it.
  return shell('vacuum projectile', [ground(100, 8), shot], { medium });
}

/**
 * The launch impulse, in N·s. An IMPULSE, not a force — the build's existing
 * intervention. J = m v0, so the post-impulse velocity is v0 up to the engine's
 * f32 mass round trip.
 */
export function launchImpulse(angleDeg: number = PROJECTILE.angleDeg, speed: number = PROJECTILE.speed, mass: number = PROJECTILE.mass): Vec3 {
  const a = (angleDeg * Math.PI) / 180;
  return { x: mass * speed * Math.cos(a), y: mass * speed * Math.sin(a), z: 0 };
}

// ===========================================================================
// DEMO 2 — SIMPLE PENDULUM ON A HINGE.  Card 2.
// ===========================================================================

export const PENDULUM = {
  pivot: { x: 0, y: 2.0, z: 0 },
  /** m, pivot to bob centre. */
  L: 0.60,
  /** m, bob radius. */
  r: 0.06,
  /** kg. */
  mass: 1.0,
  /** deg, release amplitude from the downward vertical. */
  amplitudeDeg: 30,
} as const;

/**
 * A PHYSICAL pendulum and treated as one: the hinge ties the bob's orientation
 * to the arm angle, so the sphere co-rotates and I_pivot = (2/5) m r² + m L².
 * The bob's pose at release is set so the joint is satisfied EXACTLY at t = 0 —
 * position `pivot + L(sin θ, −cos θ, 0)` AND rotation `R_z(θ)`. Setting only the
 * position would leave the constraint violated and the solver would start by
 * yanking it.
 */
/**
 * ===========================================================================
 * DEMO 2's DECLARED NUMERICAL PROFILE.
 * ===========================================================================
 * The pendulum scene, and ONLY the pendulum scene, declares a finer fixed
 * internal sub-division. `SI.SUBSTEPS = 4` was a selected configuration, not a
 * law: at M = 4 this scene's measured period missed the exact rigid-pendulum
 * period by −4.07 % at 90° and −11.73 % at 120° against a stamped 1.0 %
 * tolerance (D-29), and that failure is RETAINED, still red, still asserted at
 * M = 4 in the suite. What changed is the scene's declared profile, chosen from
 * the bounded ladder M = 4, 8, 16, 32, 64, 128 measured against the UNMOVED
 * stamped criteria. M = 128 is the first rung that meets them.
 *
 * *** THIS IS NOT AN ENERGY CLAIM. *** A finer step buys period accuracy; the
 * hinge still loses kinetic energy with no torque at all, and how much is
 * reported alongside the period, never instead of it. See EXPECTATIONS-BB1-S2.md
 * part A.4 and D-29/D-33 in DEVIATIONS.md.
 *
 * The public tick stays 1/60 s and inputs stay keyed by (tick, seq).
 */
export const PENDULUM_PROFILE: NumericsDesc = { substeps: 128 };

export function pendulumScene(
  amplitudeDeg: number = PENDULUM.amplitudeDeg,
  /**
   * The declared profile of the scene being built. Defaults to the scene's own
   * declared profile; the witnesses pass a rung of the ladder, and the explicit
   * sentinel `'legacy'` builds a construction with NO `numerics` field at all —
   * the M = 4 construction that D-29's retained red is asserted against.
   *
   * The sentinel is a WORD, not `undefined`: an optional parameter defaulted to
   * the profile would silently turn an explicit "give me the legacy one" into
   * "give me the default one", which is exactly the substitution this whole
   * mechanism exists to refuse.
   */
  numerics: NumericsDesc | 'legacy' = PENDULUM_PROFILE,
): Construction {
  const th = (amplitudeDeg * Math.PI) / 180;
  const pivot: EntityDesc = {
    id: 'pivot', label: 'hinge pivot', kinematics: 'fixed',
    shape: { kind: 'box', hx: 0.05, hy: 0.05, hz: 0.05 },
    material: { mass: 0, restitution: 0, friction: 0.5 },
    translation: { ...PENDULUM.pivot },
    rotation: Q_ID, linvel: V0, angvel: V0,
    colour: 0x5c6b78,
  };
  const bob: EntityDesc = {
    id: 'bob', label: 'bob', kinematics: 'dynamic',
    shape: { kind: 'sphere', radius: PENDULUM.r },
    material: { mass: PENDULUM.mass, restitution: 0.2, friction: 0.5 },
    translation: {
      x: PENDULUM.pivot.x + PENDULUM.L * Math.sin(th),
      y: PENDULUM.pivot.y - PENDULUM.L * Math.cos(th),
      z: PENDULUM.pivot.z,
    },
    rotation: qz(th), linvel: V0, angvel: V0,
    colour: 0xd96a6a,
  };
  const hinge: JointDesc = {
    id: 'hinge0', kind: 'hinge',
    bodyA: 'pivot', bodyB: 'bob',
    anchorA: { x: 0, y: 0, z: 0 },
    anchorB: { x: 0, y: PENDULUM.L, z: 0 },
    axis: { x: 0, y: 0, z: 1 },
  };
  return shell('simple pendulum on a hinge', [ground(6, 6), pivot, bob],
    { medium: 'vacuum', joints: [hinge], numerics: numerics === 'legacy' ? undefined : numerics });
}

/** T0 = 2π sqrt((0.4 r² + L²)/(g L)). The SMALL-ANGLE period of this physical pendulum. */
export function pendulumSmallAnglePeriod(
  L: number = PENDULUM.L, r: number = PENDULUM.r, g: number = SI.G,
): number {
  return 2 * Math.PI * Math.sqrt((0.4 * r * r + L * L) / (g * L));
}

/**
 * The EXACT period of a rigid pendulum released from rest at `theta0`:
 *     T(θ0) = T0 · (2/π) K(sin(θ0/2))
 * with K evaluated by the arithmetic–geometric mean, so this is a derivation and
 * not a table of literals.
 */
export function pendulumExactPeriod(theta0Rad: number, T0: number = pendulumSmallAnglePeriod()): number {
  return T0 * (2 / Math.PI) * completeK(Math.sin(theta0Rad / 2));
}

/** Complete elliptic integral of the first kind, modulus k, by AGM. K = π/(2·AGM(1, √(1−k²))). */
export function completeK(k: number): number {
  let a = 1, b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 60 && Math.abs(a - b) > 1e-16; i++) {
    const an = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = an;
  }
  return Math.PI / (2 * a);
}

// ===========================================================================
// DEMO 3 — GUIDED SPRING OSCILLATOR ON A SLIDER.  Card 3.
// ===========================================================================

export const OSCILLATOR = {
  /** The slider line: the cart's COM is confined to y = railY, z = 0. */
  railY: 1.00,
  /** m, the rail collider sits clear ABOVE the line so it cannot touch the cart. */
  railOffsetY: 0.22,
  half: 0.12,       // m, cart half-extent
  mass: 2.0,        // kg
  anchor: { x: -1.5, y: 1.00, z: 0 },
  restLength: 1.5,  // m
  stiffness: 200,   // N/m
  damping: 4,       // N·s/m
  /** m, release displacement along +X from the spring's rest position. */
  x0: 0.30,
} as const;

/**
 * The cart is confined to one axis by a SLIDER, so gravity is carried entirely
 * by the constraint and the gravitational potential is constant: the only owned
 * dissipation is our own spring damper. The spring is the build's CORRECTED
 * model (D-8), not a Rapier joint spring and not a motor.
 */
export function oscillatorScene(x0: number = OSCILLATOR.x0, k: number = OSCILLATOR.stiffness, c: number = OSCILLATOR.damping): Construction {
  const rail: EntityDesc = {
    id: 'rail', label: 'slider rail', kinematics: 'fixed',
    shape: { kind: 'box', hx: 1.6, hy: 0.03, hz: 0.03 },
    material: { mass: 0, restitution: 0, friction: 0.5 },
    translation: { x: 0, y: OSCILLATOR.railY + OSCILLATOR.railOffsetY, z: 0 },
    rotation: Q_ID, linvel: V0, angvel: V0,
    colour: 0x5c6b78,
  };
  const cart: EntityDesc = {
    id: 'cart', label: 'cart', kinematics: 'dynamic',
    shape: { kind: 'box', hx: OSCILLATOR.half, hy: OSCILLATOR.half, hz: OSCILLATOR.half },
    material: { mass: OSCILLATOR.mass, restitution: 0.1, friction: 0.5 },
    translation: { x: x0, y: OSCILLATOR.railY, z: 0 },
    rotation: Q_ID, linvel: V0, angvel: V0,
    colour: 0x7ad9a8,
  };
  const slider: JointDesc = {
    id: 'slider0', kind: 'slider',
    bodyA: 'rail', bodyB: 'cart',
    anchorA: { x: 0, y: -OSCILLATOR.railOffsetY, z: 0 },
    anchorB: { x: 0, y: 0, z: 0 },
    axis: { x: 1, y: 0, z: 0 },
  };
  return shell('guided spring oscillator on a slider', [ground(6, 6), rail, cart], {
    medium: 'vacuum',
    joints: [slider],
    springs: [{
      id: 'spring0',
      a: { kind: 'world', point: { ...OSCILLATOR.anchor } },
      b: { kind: 'body', entityId: 'cart', localPoint: { x: 0, y: 0, z: 0 } },
      restLength: OSCILLATOR.restLength,
      stiffness: k,
      damping: c,
    }],
  });
}

/**
 * THE ONE-SUB-STEP MAP OF THIS SCHEME for a 1-DOF mass–spring–damper whose force
 * we evaluate at the start of the sub-step and hold across it, with the engine
 * then doing semi-implicit Euler:
 *
 *   M = [[1 − h²ω², h(1 − hγ)], [−hω², 1 − hγ]]
 *   det M = 1 − hγ   (exactly, independent of stiffness — D-8's result)
 *   tr  M = 2 − h²ω² − hγ
 *
 * so |λ| = √det and cos φ = tr / (2√det). Returns the DISCRETE decay rate and
 * period this build should exhibit — not the continuum ones.
 */
export function discreteOscillator(omegaN: number, gamma: number, h: number): {
  det: number; sigma: number; period: number; peakRatio: number;
} {
  const det = 1 - h * gamma;
  const tr = 2 - h * h * omegaN * omegaN - h * gamma;
  const sigma = -Math.log(det) / (2 * h);
  const phi = Math.acos(tr / (2 * Math.sqrt(det)));
  const period = (2 * Math.PI * h) / phi;
  return { det, sigma, period, peakRatio: Math.exp(-sigma * period) };
}

// ===========================================================================
// DEMO 4 — TWO-BODY COLLISION, a controlled ISOLATED PAIR.  Card 4.
// ===========================================================================

export const COLLISION = {
  /** m. Both spheres. */
  radius: 0.25,
  y: 1.0,
  /** m. Symmetric about the origin, so the impact happens on screen centre. */
  x0: 1.20,
  massA: 1.0,   // kg
  massB: 2.0,   // kg
  vA: 3.0,      // m/s, +X
  vB: -1.0,     // m/s, +X (i.e. moving -X)
  /** Dimensionless. Authored on BOTH colliders, so Average/Min/Max all give e. */
  restitution: 0.6,
} as const;

/**
 * A CONTROLLED ISOLATED PAIR — not a many-body cradle.
 *
 * GRAVITY IS EXACTLY ZERO here, and that is a declared part of the fixture, not
 * a convenience: with no external force of any kind the pair's total momentum is
 * conserved EXACTLY, for all time, so the momentum claim can be asserted at
 * every tick rather than only across the impact. The ground slab is there so the
 * viewer has a floor to judge scale against; nothing ever reaches it, and the
 * witness asserts zero contacts with anything but the two balls.
 *
 * BOTH colliders carry the SAME restitution. Rapier's default coefficient
 * combine rule is Average (read back from the engine, not assumed), and with
 * equal coefficients Average, Min and Max all return e — so a measured e² would
 * falsify the assumption instead of hiding inside it.
 */
export function collisionScene(e: number = COLLISION.restitution): Construction {
  const ball = (id: string, mass: number, x: number, vx: number, colour: number): EntityDesc => ({
    id, label: id, kinematics: 'dynamic',
    shape: { kind: 'sphere', radius: COLLISION.radius },
    material: { mass, restitution: e, friction: 0.0 },
    translation: { x, y: COLLISION.y, z: 0 },
    rotation: Q_ID, linvel: { x: vx, y: 0, z: 0 }, angvel: V0,
    colour,
  });
  return shell('two-body collision (isolated pair)', [
    ground(8, 4),
    ball('ballA', COLLISION.massA, -COLLISION.x0, COLLISION.vA, 0xe8b44f),
    ball('ballB', COLLISION.massB, COLLISION.x0, COLLISION.vB, 0x7aa2c8),
  ], { medium: 'vacuum', gravity: { x: 0, y: 0, z: 0 } });
}

/**
 * The 1-D isolated-pair result for a coefficient of restitution e. A DERIVATION,
 * evaluated here, so the witness and the on-screen panel assert against the same
 * formulas rather than against a table of literals.
 */
export function collisionOutcome(
  e: number = COLLISION.restitution,
  mA: number = COLLISION.massA, mB: number = COLLISION.massB,
  vA: number = COLLISION.vA, vB: number = COLLISION.vB,
): { vA1: number; vB1: number; p: number; vcm: number; ke0: number; ke1: number; keCm: number; keCom: number } {
  const M = mA + mB;
  const vA1 = ((mA - e * mB) * vA + mB * (1 + e) * vB) / M;
  const vB1 = ((mB - e * mA) * vB + mA * (1 + e) * vA) / M;
  const p = mA * vA + mB * vB;
  const vcm = p / M;
  const mu = (mA * mB) / M;
  const u = vA - vB;
  const keCm = 0.5 * mu * u * u;
  const keCom = 0.5 * M * vcm * vcm;
  return {
    vA1, vB1, p, vcm,
    ke0: 0.5 * mA * vA * vA + 0.5 * mB * vB * vB,
    ke1: 0.5 * mA * vA1 * vA1 + 0.5 * mB * vB1 * vB1,
    keCm, keCom,
  };
}

/** s. The GEOMETRIC contact instant: the gap divided by the closing speed. */
export function collisionContactTime(): number {
  const gap = 2 * COLLISION.x0 - 2 * COLLISION.radius;
  return gap / (COLLISION.vA - COLLISION.vB);
}

// ===========================================================================
// DEMO 5 — INCLINED-PLANE SLIDE.  Card 5.
// ===========================================================================

export const INCLINE = {
  angleDeg: 25,
  /** Dimensionless. A GENERIC MECHANICAL COEFFICIENT, not a named material. */
  mu: 0.30,
  rampCentre: { x: 0, y: 1.0, z: 0 },
  rampHalf: { hx: 2.0, hy: 0.08, hz: 0.8 },
  /** m, block half-extent. */
  half: 0.12,
  mass: 2.0,        // kg
  /** m, ramp-local +X coordinate of the block's start, up-slope. */
  u0: -1.5,
} as const;

/** Surface normal of the ramp at angle theta (rad). Unit. */
export const inclineNormal = (th: number): Vec3 => ({ x: Math.sin(th), y: Math.cos(th), z: 0 });
/** DOWN-slope unit vector of the ramp at angle theta (rad). */
export const inclineDown = (th: number): Vec3 => ({ x: Math.cos(th), y: -Math.sin(th), z: 0 });

/** World position of the block's centre at ramp-local coordinate u, resting flush. */
export function inclineBlockStart(angleDeg: number = INCLINE.angleDeg, u: number = INCLINE.u0): Vec3 {
  const th = (angleDeg * Math.PI) / 180;
  const c = Math.cos(th), sn = Math.sin(th);
  // R_z(-th) applied to (u, rampHalf.hy, 0), then out along the normal by the block half-extent.
  const px = u * c + INCLINE.rampHalf.hy * sn;
  const py = -u * sn + INCLINE.rampHalf.hy * c;
  const n = inclineNormal(th);
  return {
    x: INCLINE.rampCentre.x + px + INCLINE.half * n.x,
    y: INCLINE.rampCentre.y + py + INCLINE.half * n.y,
    z: 0,
  };
}

/**
 * THE FRICTIONLESS REFERENCE IS THE STARTING POINT, and friction is added only
 * with its engine assumption stated (card 5). `mu = 0` gives both colliders zero
 * friction, so the pair coefficient is zero under any combine rule.
 *
 * The block starts AT REST AND FLUSH on the surface, sharing the ramp's rotation,
 * so the contact is established at t = 0 rather than through a drop.
 */
export function inclineScene(angleDeg: number = INCLINE.angleDeg, mu = 0): Construction {
  const th = (angleDeg * Math.PI) / 180;
  const ramp: EntityDesc = {
    id: 'ramp', label: 'ramp', kinematics: 'fixed',
    shape: { kind: 'box', ...INCLINE.rampHalf },
    material: { mass: 0, restitution: 0, friction: mu },
    translation: { ...INCLINE.rampCentre },
    rotation: qz(-th), linvel: V0, angvel: V0,
    colour: 0x5c6b78,
  };
  const block: EntityDesc = {
    id: 'block', label: 'block', kinematics: 'dynamic',
    shape: { kind: 'box', hx: INCLINE.half, hy: INCLINE.half, hz: INCLINE.half },
    material: { mass: INCLINE.mass, restitution: 0, friction: mu },
    translation: inclineBlockStart(angleDeg),
    rotation: qz(-th), linvel: V0, angvel: V0,
    colour: 0xd98a5a,
  };
  return shell('inclined-plane slide', [ground(8, 6), ramp, block], { medium: 'vacuum' });
}

/**
 * Along-slope acceleration of a sliding block. `mu = 0` is the FRICTIONLESS
 * reference; a non-zero mu is the Coulomb MODEL, and it describes the motion only
 * while the block is actually sliding — `tan(theta) <= mu` means it does not move
 * at all, and this returns 0 there rather than a negative acceleration.
 */
export function inclineAcceleration(angleDeg: number, mu = 0, g: number = SI.G): number {
  const th = (angleDeg * Math.PI) / 180;
  const net = Math.sin(th) - mu * Math.cos(th);
  return net <= 0 ? 0 : g * net;
}

/** True when the Coulomb model says the block stays put. tan(theta) <= mu. */
export function inclineIsStatic(angleDeg: number, mu: number): boolean {
  return Math.tan((angleDeg * Math.PI) / 180) <= mu;
}

// ===========================================================================
// DEMO 6 — AIR / DRAG-FREE FALL COMPARISON.  Card 6.
// ===========================================================================

export const FALL = {
  radius: 0.12,     // m
  mass: 0.15,       // kg
  releaseY: 50.0,   // m
  /** m, the two release points, so both balls are visible and never interact. */
  xAir: -0.9,
  xFree: 0.9,
} as const;

/**
 * TWO IDENTICAL SPHERES, DIFFERING IN ONE AUTHORED NUMBER.
 *
 * `freeBall` carries an authored **C_d = 0**, which makes its drag force
 * identically zero — the same equation of motion as vacuum FOR THAT BODY. It is
 * a DRAG-FREE BODY IN AN AIR WORLD, not a second vacuum world, and the UI says
 * so. Setting the world to vacuum makes the two fall identically, which is the
 * discriminating check that the drag term is the only difference between them.
 *
 * The drag law itself is NOT revalidated here. It is the already-accepted A0-A5
 * work in EXPECTATIONS.md, reused unchanged.
 */
export function fallScene(medium: 'air' | 'vacuum' = 'air'): Construction {
  const sphere = (id: string, x: number, cd: number | undefined, colour: number): EntityDesc => ({
    id, label: id, kinematics: 'dynamic',
    shape: { kind: 'sphere', radius: FALL.radius },
    material: { mass: FALL.mass, restitution: 0.2, friction: 0.4, ...(cd === undefined ? {} : { dragCd: cd }) },
    translation: { x, y: FALL.releaseY, z: 0 },
    rotation: Q_ID, linvel: V0, angvel: V0,
    colour,
  });
  return shell('air vs drag-free fall', [
    ground(8, 8),
    sphere('airBall', FALL.xAir, undefined, 0x7ad9a8),
    sphere('freeBall', FALL.xFree, 0, 0xe8b44f),
  ], { medium });
}

// ===========================================================================
// THE CATALOGUE
// ===========================================================================

export interface ScenePreset {
  id: string;
  label: string;
  /** One line the UI shows under the selector. */
  blurb: string;
  build: () => Construction;
  /**
   * RENDER-ONLY camera framing. A demo you cannot see is not a demo: the first
   * on-screen look at demo 1 showed an empty plane, because the camera was still
   * framed on the FP1 rig while the shot flew 14 m away. Presentation only — it
   * touches nothing the simulation reads.
   */
  camera: { pos: Vec3; target: Vec3 };
  /** One short line over the viewport, replacing the grab instructions. */
  instruction: string;
  /**
   * Start the driver paused. Only the projectile needs it, and it needs it for a
   * physical reason: the declared initial condition is "at the launch point, at
   * rest, not yet launched".
   */
  startPaused: boolean;
}

export const SCENES: readonly ScenePreset[] = [
  {
    id: 'platform',
    label: 'spring-supported platform (FP1/DM1)',
    blurb: 'The original slice-one and slice-two rig: a 20 kg platform hung in tension from four springs, '
      + 'carrying a stack and a loose block. Grab and haul anything.',
    build: () => defaultConstruction(),
    camera: { pos: { x: 4.6, y: 2.9, z: 5.4 }, target: { x: 0, y: 1.15, z: 0 } },
    instruction: '<b>Drag a coloured body to grab and haul it.</b> The hand is an '
      + '<span class="actuator">EXTERNAL, POWERED COMPLIANT ACTUATOR</span> — not a spring inside the world. '
      + 'It pulls at the exact point you grabbed, so a corner grab spins the body <b>much more</b> than a centre '
      + 'grab. Drag empty space or the ground to <b>orbit the camera</b>. <b>Esc</b> releases.',
    startPaused: false,
  },
  {
    id: 'projectile',
    label: 'demo 1 — vacuum projectile',
    blurb: 'A 0.4 kg shot launched at 12 m/s. Trajectory and range against the analytic reference, '
      + 'under declared launch/landing conditions. Air is a NUMERICAL comparison only.',
    build: () => projectileScene('vacuum'),
    camera: { pos: { x: 3.2, y: 7.0, z: 17.5 }, target: { x: 3.2, y: 2.4, z: 0 } },
    instruction: '<b>Demo 1 — vacuum projectile.</b> Press <b>launch</b>. The pale line is the flown path; '
      + 'the plot on the right draws it against the <b>continuum parabola</b>. Landing is declared as the '
      + 'centre of mass returning to <b>y = 1.2 m</b>, not ground contact. Switch to <b>air</b> for a '
      + 'comparison that is <b>numerical only</b> — no closed form is claimed for it.',
    startPaused: true,
  },
  {
    id: 'pendulum',
    label: 'demo 2 — simple pendulum on a HINGE',
    blurb: 'A 1 kg bob on a 0.6 m hinge. Small-amplitude period — and where that approximation stops being true.',
    build: () => pendulumScene(),
    camera: { pos: { x: 0.05, y: 1.98, z: 2.35 }, target: { x: 0, y: 1.78, z: 0 } },
    instruction: '<b>Demo 2 — pendulum on a HINGE.</b> Release from 3°, then 30°, then 90°. The dashed line on '
      + 'the plot is the <b>small-angle approximation</b>; the residual printed under it is that approximation '
      + 'failing. At 90° and above this build\'s own measured period is a <b>retained red</b> — the panel says why.',
    startPaused: false,
  },
  {
    id: 'oscillator',
    label: 'demo 3 — guided spring oscillator on a SLIDER',
    blurb: 'A 2 kg cart confined to one axis by a slider, pulled by the corrected spring model. '
      + 'Displacement and energy trace.',
    build: () => oscillatorScene(),
    camera: { pos: { x: -0.35, y: 1.85, z: 4.05 }, target: { x: -0.55, y: 1.02, z: 0 } },
    instruction: '<b>Demo 3 — spring oscillator on a SLIDER.</b> The cart is confined to one axis, so gravity is '
      + 'carried by the constraint and the only owned dissipation is our own spring damper. The plot compares '
      + 'the displacement with the <b>continuum underdamped solution</b>, and the panel with this scheme\'s '
      + '<b>discrete</b> one.',
    startPaused: false,
  },
  {
    id: 'collision',
    label: 'demo 4 — two-body collision (isolated pair)',
    blurb: 'A 1 kg and a 2 kg sphere meeting head-on in ZERO gravity. Momentum, and what restitution '
      + 'does to the energy. Two bodies and one impact — not a cradle.',
    build: () => collisionScene(),
    // FOUND BY LOOKING AT THE SCREEN: at 6.4 m back the pair left the frame about a
    // second after the impact, because in ZERO gravity nothing ever brings them
    // back. Framed wide enough to hold both balls from release through roughly two
    // seconds past the impact, and the scene starts PAUSED so the declared initial
    // condition is what you see first. Presentation only.
    camera: { pos: { x: 0.0, y: 3.4, z: 11.0 }, target: { x: 0, y: 1.0, z: 0 } },
    instruction: '<b>Demo 4 — two-body collision.</b> Gravity is <b>exactly zero</b>, so the pair is genuinely '
      + 'ISOLATED and total momentum is conserved at <b>every</b> tick, not just across the impact — the momentum '
      + 'plot is a flat line and it is meant to stay flat. Change <b>e</b> and fire again: at e = 1 the kinetic '
      + 'energy comes back, at e = 0.6 it does not. The loss is <b>real and inelastic</b>, but this build owns no '
      + 'contact-dissipation channel, so it stays in <b>UNATTRIBUTED</b> and is never called heat.',
    startPaused: false,
  },
  {
    id: 'incline',
    label: 'demo 5 — inclined-plane slide',
    blurb: 'A 2 kg block on a ramp. The FRICTIONLESS acceleration g·sin θ first; friction only afterwards, '
      + 'with its engine model named.',
    build: () => inclineScene(),
    // FOUND BY LOOKING AT THE SCREEN: at 4.6 m back only part of the ramp was in
    // frame and the block was gone by the time it reached the ramp's end. Framed to
    // hold the WHOLE ramp, so the start, the measured window and the block leaving
    // the finite ramp are all visible. Presentation only.
    camera: { pos: { x: 0.4, y: 3.6, z: 7.6 }, target: { x: 0.0, y: 1.2, z: 0 } },
    instruction: '<b>Demo 5 — inclined-plane slide.</b> The reference is the <b>frictionless</b> one: '
      + 'a = g·sin θ along the slope. Add <b>μ</b> and the model becomes a = g(sin θ − μ·cos θ) <i>while sliding</i>; '
      + 'below tan θ = μ the block stays put. μ here is a <b>generic mechanical coefficient, not a material</b>, and '
      + 'no angle of repose is measured or claimed.',
    startPaused: false,
  },
  {
    id: 'fall',
    label: 'demo 6 — air vs drag-free fall',
    blurb: 'Two identical spheres dropped together; one carries an authored C_d = 0. The already-validated '
      + 'drag law, made visible side by side.',
    build: () => fallScene('air'),
    // A STATIC camera cannot hold this demo: the balls are 12.7 m apart by t = 2.5 s
    // and fall past 30 m. `followFallingPair` in ui/main.ts tracks their midpoint and
    // widens to their separation; this is only the pose at release. Presentation only.
    camera: { pos: { x: 0.0, y: 46.0, z: 16.0 }, target: { x: 0, y: 45.0, z: 0 } },
    instruction: '<b>Demo 6 — air vs drag-free fall.</b> Both spheres are identical: same radius, same mass, '
      + 'released together. The right one carries an authored <b>C_d = 0</b>, so its drag force is identically '
      + 'zero — a <b>drag-free body in an air world</b>, not a second vacuum. Switch the medium to <b>vacuum</b> '
      + 'and they fall together, which is the check that drag is the <b>only</b> difference between them. '
      + 'The drag law is the one already validated in <b>EXPECTATIONS.md §A</b>; nothing here revalidates it.',
    startPaused: false,
  },
] as const;

export function sceneById(id: string): ScenePreset {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`no such scene preset: ${id}`);
  return s;
}
