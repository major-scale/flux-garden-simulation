/**
 * FP1 — quadratic air drag, as a PROVISIONAL EFFECTIVE LAW.
 *
 *      F = -½ · rho · C_d · A_eff · |v| · v            [N]
 *
 * DECLARED REGIME (plan §2): subsonic, incompressible, uniform still air.
 *   - NO turbulence modelling.
 *   - NO wind. The air is still, so v_relative == the body's own velocity.
 *   - NO lift.
 *   - NO ORIENTATION DEPENDENCE. This is the reason the area convention below
 *     exists and is stated: a single scalar A_eff must stand in for a projected
 *     area that in reality changes with attitude.
 *   - NO ANGULAR DRAG. A spinning body loses no rotational energy to the air in
 *     this model. This is a declared omission, not an oversight; angular drag
 *     would need a separate coefficient convention that this slice does not have.
 *
 * THE EFFECTIVE-AREA CONVENTION, STATED EXPLICITLY, INCLUDING FOR BOXES AND
 * CAPSULES:
 *   A_eff is the ORIENTATION-AVERAGED PROJECTED AREA of the convex shape, which
 *   by Cauchy's projection formula is exactly S/4, where S is the total surface
 *   area. This is chosen because the model has no orientation dependence, so the
 *   only defensible single number is the mean over attitudes.
 *
 *     sphere  (r)          S = 4·pi·r²                 A_eff = pi·r²
 *                          (recovers the textbook pi·r² exactly)
 *     box     (hx,hy,hz)   S = 8(hx·hy + hy·hz + hz·hx)
 *                          A_eff = 2(hx·hy + hy·hz + hz·hx)
 *     capsule (h, r)       S = 4·pi·r² + 4·pi·r·h      A_eff = pi·r·(r + h)
 *                          (h = cylindrical half-height, so the cylinder side
 *                           area is 2·pi·r·2h and the two caps make one sphere)
 *
 * C_d CONVENTION: a single dimensionless scalar paired with the A_eff above.
 * Because A_eff is an orientation average and not a frontal area, these C_d
 * values are NOT interchangeable with published frontal-area coefficients. They
 * are the build's own convention. Defaults per shape:
 *     box 1.05, sphere 0.47, capsule 0.60
 */

import { SI, vlen, vscale, type Vec3 } from './units';
import type { EnvironmentDesc, ShapeDesc } from './construction';

export const DEFAULT_CD: Record<ShapeDesc['kind'], number> = {
  box: 1.05,
  sphere: 0.47,
  capsule: 0.60,
};

/** Orientation-averaged projected area (Cauchy: S/4), m². */
export function effectiveArea(s: ShapeDesc): number {
  switch (s.kind) {
    case 'box': return 2 * (s.hx * s.hy + s.hy * s.hz + s.hz * s.hx);
    case 'sphere': return Math.PI * s.radius * s.radius;
    case 'capsule': return Math.PI * s.radius * (s.radius + s.halfHeight);
  }
}

export function mediumDensity(env: EnvironmentDesc): number {
  return env.medium === 'air' ? SI.RHO_AIR : SI.RHO_VACUUM;
}

/**
 * The drag coefficient bundle for one body: k_drag = ½·rho·C_d·A_eff  [kg/m],
 * so that F = -k_drag · |v| · v.
 */
export function dragK(shape: ShapeDesc, cd: number | undefined, rho: number): number {
  return 0.5 * rho * (cd ?? DEFAULT_CD[shape.kind]) * effectiveArea(shape);
}

/** F = -k_drag·|v|·v. Still air, so v is the body's own centre-of-mass velocity. */
export function dragForce(kDrag: number, v: Vec3): Vec3 {
  const speed = vlen(v);
  if (speed === 0 || kDrag === 0) return { x: 0, y: 0, z: 0 };
  return vscale(v, -kDrag * speed);
}

/**
 * Analytic terminal speed for a body falling under gravity g with this drag law:
 *      m·g = k_drag·v_t²   =>   v_t = sqrt(m·g / k_drag)
 * Used by the expectations, and shown in the inspector.
 */
export function terminalSpeed(mass: number, kDrag: number, g: number = SI.G): number {
  if (kDrag <= 0) return Infinity;
  return Math.sqrt((mass * g) / kDrag);
}
