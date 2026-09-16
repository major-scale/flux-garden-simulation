import { validateThermal } from './thermal';
import { validateCircuit, type CircuitDesc } from './circuit';
/**
 * FP1 — the AUTHORED CONTENT layer.
 *
 * A Construction is a versioned, JSON-serialisable description of what the user
 * built. It is application-owned.
 *
 *   *** NO RAPIER HANDLE EVER APPEARS IN A CONSTRUCTION. ***
 *
 * A construction and a solver checkpoint are DIFFERENT ARTIFACTS (plan §4).
 * Entities are named by application-owned string ids ("b7"), minted from a
 * monotonic serial that is itself part of saved application state.
 */

import {
  H_SUB, LEGACY_SUBSTEPS, LIMITS, SI, hSubFor, isSupportedSubsteps, maxGammaFor, maxOmegaNFor,
  unsupportedSubstepsMessage, type Quat, type Vec3,
} from './units';
import type { JointDesc } from './joints';

export const CONSTRUCTION_FORMAT_VERSION = 1 as const;

export type ShapeDesc =
  | { kind: 'box'; hx: number; hy: number; hz: number }        // half-extents, m
  | { kind: 'sphere'; radius: number }                          // m
  | { kind: 'capsule'; halfHeight: number; radius: number };    // m (cylinder half-height)

export interface MaterialDesc {
  /** kg. The authored mass. Density is derived as mass/volume so mass is exact. */
  mass: number;
  restitution: number;   // dimensionless, 0..1
  friction: number;      // dimensionless Coulomb coefficient
  /**
   * Drag coefficient, dimensionless. Optional: when absent the per-shape default
   * from model/drag.ts is used. See drag.ts for the area convention.
   */
  dragCd?: number;
}

export interface ThermalDesc { heatCapacity: number; initialTemperature: number; }

export interface EntityDesc {
  /** Explicit lumped damper housing: total J/K and authored K. */
  thermal?: ThermalDesc;
  id: string;                        // application-owned, e.g. "b3"
  label: string;
  kinematics: 'dynamic' | 'fixed';
  shape: ShapeDesc;
  material: MaterialDesc;
  translation: Vec3;                 // m, world
  rotation: Quat;                    // unit quaternion, world
  linvel: Vec3;                      // m/s
  angvel: Vec3;                      // rad/s
  colour: number;                    // 0xRRGGBB, presentation only
}

/**
 * THE ONE SPRING REPRESENTATION IN THIS BUILD.
 *
 * A passive linear spring + linear viscous damper, computed by the application
 * and applied through Rapier's user-force accumulator at a material point of the
 * attached body. It is NOT a Rapier joint and NOT a motor controller. There is no
 * motor controller anywhere in this build, so nothing can be silently mistaken
 * for a passive spring.
 *
 *   L      = |p_b - p_a|                                       m
 *   n      = (p_b - p_a) / L                                   unit, a -> b
 *   x      = L - restLength                                    m   (+ = stretched)
 *   v_rel  = (v_b_at_point - v_a_at_point) · n                  m/s (+ = separating)
 *   F_on_b = -(k·x + c·v_rel) · n                               N
 *   F_on_a = +(k·x + c·v_rel) · n                               N   (reaction; absorbed
 *                                                                    by the world when
 *                                                                    endpoint a is a
 *                                                                    world anchor)
 *
 * DECLARED ENERGY INTERPRETATION
 *   Elastic potential  U = ½·k·x²  [J]  — this is the "declared spring potential"
 *                                         that enters resolved mechanical energy.
 *   The damper term is NON-CONSERVATIVE. It has no potential. Its dissipation is
 *   estimated separately as owned dissipation (see model/energy.ts).
 *   The rest length carries no energy: U(x=0) = 0 by definition.
 *
 * UNITS: k in N/m, c in N·s/m, restLength in m.
 */
export interface SpringDesc {
  /** Explicit receiver of 100% of this damper work; absent means unmodelled destination. */
  heatReceiver?: string;
  id: string;
  /** World-anchor endpoint, or a body-attached endpoint. */
  a: SpringEndpoint;
  b: SpringEndpoint;
  restLength: number;   // m
  stiffness: number;    // N/m
  damping: number;      // N·s/m
}

export type SpringEndpoint =
  | { kind: 'world'; point: Vec3 }                    // m, world frame, immovable
  | { kind: 'body'; entityId: string; localPoint: Vec3 }; // m, body local frame

export interface EnvironmentDesc {
  /** 'air' is the default. 'vacuum' must be explicitly selected (plan §2). */
  medium: 'air' | 'vacuum';
  gravity: Vec3;    // m/s², applied by the ENGINE (Rapier world gravity)
}

export interface Construction {
  format: 'fp1-construction';
  formatVersion: typeof CONSTRUCTION_FORMAT_VERSION;
  name: string;
  environment: EnvironmentDesc;
  entities: EntityDesc[];   // ORDER IS SIGNIFICANT: it is the insertion order.
  springs: SpringDesc[];
  /**
   * AUTHORED JOINTS — hinge and slider only (model/joints.ts). Optional so that
   * every construction saved before joints existed still loads at formatVersion
   * 1; absent means "no joints", which is what those files meant.
   * ORDER IS SIGNIFICANT: it is the joint insertion order.
   */
  joints?: JointDesc[];
  /**
   * THE DECLARED NUMERICAL PROFILE — authored content, like everything else here.
   *
   * OPTIONAL, and its ABSENCE IS MEANINGFUL: a construction with no `numerics`
   * means the LEGACY profile of 4 internal sub-steps, which is what every
   * construction saved before profiles existed meant. Old recordings keep their
   * old configuration; their interpretation is never silently changed.
   *
   * An unsupported value is REFUSED at build, never substituted.
   */
  numerics?: NumericsDesc;
  /**
   * BATCH 4 — THE AUTHORED DC CIRCUIT. Optional, and its ABSENCE IS MEANINGFUL: a
   * construction with no `circuit` has NO electrical state and NO electrical heat,
   * which is exactly what every document saved before circuits existed meant.
   * Legacy documents are not migrated, defaulted or given an empty circuit.
   *
   * NODE AND COMPONENT IDS JOIN THE ONE SHARED APPLICATION ID NAMESPACE, so a
   * circuit id can never collide with a body, spring or joint id. Solver row
   * indices, merged-node numbers and matrix handles are RUNTIME details and appear
   * nowhere in here — the authored graph is preserved, never flattened.
   */
  circuit?: CircuitDesc;
  /** Next value of the entity serial counter. Application state, saved. */
  nextSerial: number;
}

/**
 * The fixed internal sub-division of one public tick. The public tick stays
 * 1/60 s and inputs stay keyed by (tick, seq); this is only how finely that tick
 * is integrated, and our force laws are still rebuilt before every sub-step.
 */
export interface NumericsDesc {
  /** Internal fixed sub-steps per public tick. One of units.ts SUPPORTED_SUBSTEPS. */
  substeps: number;
}

/**
 * The sub-step count a construction declares. ABSENT MEANS THE LEGACY 4 — that
 * is the whole compatibility promise, in one function.
 *
 * REFUSES an unsupported declaration by throwing, with the offending value and
 * the supported set named. It does not fall back, clamp or round.
 */
export function constructionSubsteps(c: Pick<Construction, 'numerics'>): number {
  const n = c.numerics?.substeps;
  if (n === undefined) return LEGACY_SUBSTEPS;
  if (!isSupportedSubsteps(n)) throw new Error(unsupportedSubstepsMessage(n));
  return n;
}

/** s. The internal fixed sub-step a construction's declared profile implies. */
export function constructionHSub(c: Pick<Construction, 'numerics'>): number {
  return hSubFor(constructionSubsteps(c));
}

// ---------------------------------------------------------------------------

export function shapeVolume(s: ShapeDesc): number {
  switch (s.kind) {
    case 'box': return 8 * s.hx * s.hy * s.hz;
    case 'sphere': return (4 / 3) * Math.PI * s.radius ** 3;
    case 'capsule': return Math.PI * s.radius ** 2 * (2 * s.halfHeight) + (4 / 3) * Math.PI * s.radius ** 3;
  }
}

/** Largest linear dimension of a shape, m — used for UI limit checking. */
export function shapeExtent(s: ShapeDesc): number {
  switch (s.kind) {
    case 'box': return 2 * Math.max(s.hx, s.hy, s.hz);
    case 'sphere': return 2 * s.radius;
    case 'capsule': return 2 * (s.halfHeight + s.radius);
  }
}

export type ValidationIssue = { severity: 'refuse'; message: string };

/** Provisional UI limits, enforced. Refusals are surfaced, never silently clamped. */
export function validateEntity(e: EntityDesc, all: EntityDesc[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const ext = shapeExtent(e.shape);
  if (ext < LIMITS.sizeMin || ext > LIMITS.sizeMax) {
    out.push({ severity: 'refuse', message: `size ${ext.toFixed(3)} m outside UI limits [${LIMITS.sizeMin}, ${LIMITS.sizeMax}] m` });
  }
  if (e.kinematics === 'dynamic') {
    if (!(e.material.mass >= LIMITS.massMin && e.material.mass <= LIMITS.massMax)) {
      out.push({ severity: 'refuse', message: `mass ${e.material.mass} kg outside UI limits [${LIMITS.massMin}, ${LIMITS.massMax}] kg` });
    }
    const dyn = all.filter((o) => o.kinematics === 'dynamic' && o.id !== e.id).map((o) => o.material.mass);
    const masses = [...dyn, e.material.mass];
    if (masses.length > 1) {
      const ratio = Math.max(...masses) / Math.min(...masses);
      if (ratio > LIMITS.maxMassRatio) {
        out.push({ severity: 'refuse', message: `mass ratio ${ratio.toFixed(0)}:1 exceeds the excluded-extremes limit of ${LIMITS.maxMassRatio}:1` });
      }
    }
  }
  return out;
}

export function validateSpring(s: SpringDesc): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!(s.stiffness >= LIMITS.stiffnessMin && s.stiffness <= LIMITS.stiffnessMax)) {
    out.push({ severity: 'refuse', message: `stiffness ${s.stiffness} N/m outside UI limits [${LIMITS.stiffnessMin}, ${LIMITS.stiffnessMax}] N/m` });
  }
  if (!(s.damping >= LIMITS.dampingMin && s.damping <= LIMITS.dampingMax)) {
    out.push({ severity: 'refuse', message: `damping ${s.damping} N·s/m outside UI limits [${LIMITS.dampingMin}, ${LIMITS.dampingMax}] N·s/m` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// RESOLVABILITY OF THE OFFERED SPRING REGIME  (see units.ts RESOLVABILITY)
//
// The old stiffness/damping maxima (200 000 N/m, 5 000 N·s/m) were never
// validated against anything: at c = 5 000 per spring on the 20 kg platform,
// gamma·h = 4.2 and the one-sub-step determinant 1 − h·gamma is NEGATIVE. The
// UI now offers only the regime the integrator resolves, and says so.
// ---------------------------------------------------------------------------

export interface SpringMode {
  entityId: string;
  /** N/m, summed over every spring pulling on this body. */
  K: number;
  /** N·s/m, summed likewise. */
  C: number;
  mass: number;      // kg
  omegaN: number;    // rad/s, sqrt(K/m)
  gamma: number;     // s⁻¹, C/m
}

/** The heave mode each spring-carried body presents to the integrator. */
export function springModes(springs: SpringDesc[], massOf: (id: string) => number | undefined): SpringMode[] {
  const acc = new Map<string, { K: number; C: number }>();
  for (const s of springs) {
    for (const ep of [s.a, s.b]) {
      if (ep.kind !== 'body') continue;
      const cur = acc.get(ep.entityId) ?? { K: 0, C: 0 };
      cur.K += s.stiffness; cur.C += s.damping;
      acc.set(ep.entityId, cur);
    }
  }
  const out: SpringMode[] = [];
  for (const [entityId, { K, C }] of acc) {
    const mass = massOf(entityId);
    if (mass === undefined || !(mass > 0)) continue;
    out.push({ entityId, K, C, mass, omegaN: Math.sqrt(K / mass), gamma: C / mass });
  }
  return out;
}

/** Refusals, surfaced never clamped, for a spring regime the step cannot resolve. */
export function resolvabilityIssues(
  springs: SpringDesc[], massOf: (id: string) => number | undefined,
  /**
   * s. THE INTERNAL SUB-STEP THE WORLD IS ACTUALLY RUNNING. Defaults to the
   * legacy M = 4 step so every existing caller keeps its meaning; a world on a
   * declared finer profile passes its own h, because a guard computed at a step
   * the integrator is not taking is not guarding anything.
   */
  hSub: number = H_SUB,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const maxOmega = maxOmegaNFor(hSub), maxGamma = maxGammaFor(hSub);
  for (const m of springModes(springs, massOf)) {
    if (m.omegaN > maxOmega) {
      out.push({
        severity: 'refuse',
        message: `refused: springs on ${m.entityId} would give omega_n = ${m.omegaN.toFixed(1)} rad/s, `
          + `above the resolvable limit ${maxOmega.toFixed(1)} rad/s at the ${(1000 * hSub).toFixed(4)} ms internal sub-step `
          + `(K <= ${(m.mass * maxOmega * maxOmega).toFixed(0)} N/m for ${m.mass.toFixed(3)} kg)`,
      });
    }
    if (m.gamma > maxGamma) {
      out.push({
        severity: 'refuse',
        message: `refused: springs on ${m.entityId} would give gamma = ${m.gamma.toFixed(2)} s⁻¹, `
          + `above the resolvable limit ${maxGamma.toFixed(1)} s⁻¹ at the ${(1000 * hSub).toFixed(4)} ms internal sub-step `
          + `(C <= ${(m.mass * maxGamma).toFixed(0)} N·s/m for ${m.mass.toFixed(3)} kg)`,
      });
    }
  }
  return out;
}

/** N/m. The largest value this ONE spring may take, given its siblings. Used for the UI's input max. */
export function maxStiffnessForSpring(
  springs: SpringDesc[], id: string, massOf: (id: string) => number | undefined, hSub: number = H_SUB,
): number {
  return maxForSpring(springs, id, massOf, 'stiffness', hSub);
}
/** N·s/m. Likewise for damping. */
export function maxDampingForSpring(
  springs: SpringDesc[], id: string, massOf: (id: string) => number | undefined, hSub: number = H_SUB,
): number {
  return maxForSpring(springs, id, massOf, 'damping', hSub);
}

function maxForSpring(
  springs: SpringDesc[], id: string, massOf: (id: string) => number | undefined,
  field: 'stiffness' | 'damping', hSub: number,
): number {
  const me = springs.find((s) => s.id === id);
  const hard: number = field === 'stiffness' ? LIMITS.stiffnessMax : LIMITS.dampingMax;
  if (!me) return hard;
  let limit = hard;
  for (const ep of [me.a, me.b]) {
    if (ep.kind !== 'body') continue;
    const mass = massOf(ep.entityId);
    if (mass === undefined || !(mass > 0)) continue;
    let others = 0;
    for (const s of springs) {
      if (s.id === id) continue;
      if ((s.a.kind === 'body' && s.a.entityId === ep.entityId) || (s.b.kind === 'body' && s.b.entityId === ep.entityId)) {
        others += field === 'stiffness' ? s.stiffness : s.damping;
      }
    }
    const total = field === 'stiffness'
      ? mass * maxOmegaNFor(hSub) * maxOmegaNFor(hSub)
      : mass * maxGammaFor(hSub);
    limit = Math.min(limit, Math.max(0, total - others));
  }
  return Math.floor(limit);
}

export function cloneConstruction(c: Construction): Construction {
  return JSON.parse(JSON.stringify(c)) as Construction;
}

export function parseConstruction(json: string): Construction {
  const c = JSON.parse(json) as Construction;
  if (c.format !== 'fp1-construction') throw new Error(`not an fp1 construction (format=${String(c.format)})`);
  if (c.formatVersion !== CONSTRUCTION_FORMAT_VERSION) {
    throw new Error(`construction formatVersion ${c.formatVersion} != supported ${CONSTRUCTION_FORMAT_VERSION}`);
  }
  // Defence in depth for the "no engine handles in authored content" rule.
  if (/"(handle|colliderHandle|bodyHandle|rapier)"\s*:/i.test(json)) {
    throw new Error('refusing construction: it contains an engine handle field');
  }
  // AN UNSUPPORTED NUMERICAL PROFILE IS REFUSED AT LOAD, not at the first tick and
  // not by substitution. `constructionSubsteps` throws with the offending value named.
  constructionSubsteps(c);
  validateThermal(c);
  validateCircuitOf(c);
  return c;
}

/**
 * Validate the authored circuit against the bodies that exist, with the ONE shared
 * application id namespace already claimed by entities, springs and joints so a
 * cross-namespace collision is refused too. A construction with no circuit is
 * simply a construction with no electrical state.
 */
export function validateCircuitOf(c: Construction): void {
  if (c.circuit === undefined) return;
  const thermalIds = new Set(c.entities.filter((e) => e.thermal).map((e) => e.id));
  const taken = new Set<string>([
    ...c.entities.map((e) => e.id), ...c.springs.map((s) => s.id), ...(c.joints ?? []).map((j) => j.id),
  ]);
  validateCircuit(c.circuit, thermalIds, (id) => {
    if (typeof id !== 'string' || !id.length || !/^[A-Za-z0-9_.:-]+$/.test(id) || taken.has(id)) {
      throw new Error('Empty or duplicate ID');
    }
    taken.add(id);
  });
}

/** Height of the four fixed spring anchors, m. Render-only posts mark them. */
export const SPRING_ANCHOR_Y = 2.00;

const Q_ID = { x: 0, y: 0, z: 0, w: 1 };
const V0 = { x: 0, y: 0, z: 0 };

/**
 * The default construction: a spring-supported platform carrying movable blocks.
 *
 * Geometry chosen so that the acceptance phenomena are actually reachable
 * (see EXPECTATIONS.md), not assumed to fall out of an arbitrary preset:
 *   - 4 springs, k = 800 N/m each (3200 N/m total) carrying a 20 kg platform
 *     => omega_n = sqrt(3200/20) = 12.649 rad/s; with c = 10 N·s/m each
 *     (40 N·s/m total) => zeta = 40/(2*sqrt(3200*20)) = 0.0791, UNDERDAMPED.
 *   - a 3-high stack of 0.24 m cubes with a 0.24 m footprint, so a horizontal
 *     impulse at the top has enough moment arm to topple it.
 */
export function defaultConstruction(): Construction {
  const entities: EntityDesc[] = [];

  entities.push({
    id: 'ground',
    label: 'ground',
    kinematics: 'fixed',
    shape: { kind: 'box', hx: 10, hy: 0.5, hz: 10 },
    material: { mass: 0, restitution: 0.0, friction: 0.8 },
    translation: { x: 0, y: -0.5, z: 0 },   // top face at y = 0
    rotation: Q_ID, linvel: V0, angvel: V0,
    colour: 0x3a4550,
  });

  entities.push({
    id: 'platform',
    label: 'platform',
    kinematics: 'dynamic',
    shape: { kind: 'box', hx: 1.2, hy: 0.06, hz: 0.9 },
    material: { mass: 20, restitution: 0.05, friction: 0.8 },
    translation: { x: 0, y: 0.90, z: 0 },
    rotation: Q_ID, linvel: V0, angvel: V0,
    colour: 0x7aa2c8,
  });

  // A 3-high stack, centred, for the topple demonstration.
  const H = 0.12;                     // half-extent, m -> 0.24 m cubes
  const topOfPlatform = 0.90 + 0.06;  // 0.96 m
  for (let i = 0; i < 3; i++) {
    entities.push({
      id: `stack${i}`,
      label: `stack block ${i}`,
      kinematics: 'dynamic',
      shape: { kind: 'box', hx: H, hy: H, hz: H },
      material: { mass: 1.0, restitution: 0.05, friction: 0.6 },
      translation: { x: 0, y: topOfPlatform + H + i * 2 * H, z: 0 },
      rotation: Q_ID, linvel: V0, angvel: V0,
      colour: [0xd98a5a, 0xd9b45a, 0xa8d95a][i],
    });
  }

  // One loose block off to the side.
  entities.push({
    id: 'loose0',
    label: 'loose block',
    kinematics: 'dynamic',
    shape: { kind: 'box', hx: 0.15, hy: 0.15, hz: 0.15 },
    material: { mass: 1.5, restitution: 0.1, friction: 0.6 },
    translation: { x: 0.75, y: topOfPlatform + 0.15, z: 0.45 },
    rotation: Q_ID, linvel: V0, angvel: V0,
    colour: 0xc86a9a,
  });

  // ---------------------------------------------------------------------
  // Four springs, IN TENSION, from fixed world anchors ABOVE at y = 2.00 down to
  // the platform's upper corners.
  //
  // WHY HUNG AND NOT STOOD ON. A two-point axial spring computes its force along
  // the line joining its endpoints. In COMPRESSION that is a BUCKLING geometry:
  // a lateral offset tilts the line, and the compressive force then has a
  // component pushing the offset further out. Four vertical compression springs
  // under a free rigid body constrain heave and tilt but supply NEGATIVE lateral
  // stiffness, so the rig is unstable in sway and yaw and collapses. This was
  // observed and is recorded in DEVIATIONS.md.
  //
  // In TENSION the same geometry is a pendulum: the axial force's lateral
  // component is RESTORING, with lateral stiffness ~ F_axial/L ~ 192/1.04
  // ~ 185 N/m. The vertical dynamics are identical either way, so the 1-DOF
  // analysis is unchanged:
  //   omega_n = sqrt(3200/20) = 12.649 rad/s, zeta = 40/(2*sqrt(3200*20)) = 0.0791
  //
  // Static tension margin: x_eq = m·g/K = 196.2/3200 = 0.0613 m unloaded,
  // 0.0751 m carrying the four blocks. The spring law is LINEAR IN BOTH
  // DIRECTIONS (it is not a one-way tension-only element), so a large enough
  // upward disturbance can drive it back into the unstable compressed branch.
  // That is a declared limit of this rig, not a hidden one.
  //
  //   L      = 2.00 - (y_platform + 0.06)
  //   y_eq   = 2.00 - 0.06 - L0 - m·g/K = 0.96 - m·g/K   (with L0 = 0.98)
  // which is the same y_eq expression as the stood-on arrangement, so every
  // number in EXPECTATIONS.md section B carries over unchanged.
  const springs: SpringDesc[] = [];
  const corners: Array<[number, number]> = [[-1.0, -0.7], [1.0, -0.7], [-1.0, 0.7], [1.0, 0.7]];
  corners.forEach(([sx, sz], i) => {
    springs.push({
      id: `spring${i}`,
      a: { kind: 'world', point: { x: sx, y: SPRING_ANCHOR_Y, z: sz } },
      b: { kind: 'body', entityId: 'platform', localPoint: { x: sx, y: 0.06, z: sz } },
      restLength: 0.98,
      stiffness: 800,
      damping: 10,
    });
  });

  return {
    format: 'fp1-construction',
    formatVersion: CONSTRUCTION_FORMAT_VERSION,
    name: 'spring-supported platform',
    environment: { medium: 'air', gravity: { x: 0, y: -SI.G, z: 0 } },
    entities,
    springs,
    nextSerial: 1,
  };
}
