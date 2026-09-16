/**
 * PICKUP-1 — an open single-turn loop near the coil, so the field has a consequence.
 *
 * The loop is OPEN: no current flows in it. That is what keeps this slice small and honest —
 * with i₂ = 0 there is no back-reaction on the primary, no second energy store, and no change
 * to the field, so the verified RLC kernel, the energy vessels and the cached field all stand
 * untouched. Nothing here may claim the pickup carries current, stores energy, or receives any.
 *
 * The physics reduces to ONE geometric number. Flux linkage through the loop is λ = M·i₁, so
 *
 *     dλ/dt = M · di₁/dt      and     di₁/dt = (Vs − Vc − i₁·R) / L₁
 *
 * comes exactly from the kernel — no numerical differentiation of a sampled current.
 *
 * SIGN CONVENTION, declared rather than assumed (see `pickupTerminalVoltage`).
 */
import { mutualInductance, turnZ, validateCoil, type CoilGeometry } from './coil';

/** Orientations supported in this slice. Arbitrary poses are deliberately not offered. */
export type PickupOrientation = 0 | 90 | 180;

export interface PickupGeometry {
  /** Loop radius, metres. */
  radius: number;
  /** Loop centre on the coil axis, metres from the coil centre. Axis-centred poses only. */
  separation: number;
  /** 0° faces the coil's +axis, 180° faces the other way, 90° edge-on. */
  orientation: PickupOrientation;
}

export const PICKUP_LIMITS = {
  minRadius: 1e-4, maxRadius: 0.5,
  maxSeparation: 2,
} as const;

export function validatePickup(p: PickupGeometry): void {
  if (!Number.isFinite(p.radius) || p.radius < PICKUP_LIMITS.minRadius || p.radius > PICKUP_LIMITS.maxRadius)
    throw new Error(`Pickup radius must be ${PICKUP_LIMITS.minRadius}…${PICKUP_LIMITS.maxRadius} m`);
  if (!Number.isFinite(p.separation) || Math.abs(p.separation) > PICKUP_LIMITS.maxSeparation)
    throw new Error(`Pickup separation must be within ±${PICKUP_LIMITS.maxSeparation} m of the coil centre`);
  if (p.orientation !== 0 && p.orientation !== 90 && p.orientation !== 180)
    throw new Error('Pickup orientation must be 0, 90 or 180 degrees in this slice');
}

/**
 * Mutual inductance between the coil and the pickup, in CLOSED FORM: the sum of Maxwell mutual
 * inductances between each coil turn and the coaxial loop. Not a quadrature — quadrature is the
 * cross-check in the tests.
 *
 * It uses the same `mutualInductance` the coil's self-inductance sum uses. That is shared code,
 * NOT inherited verification: COIL-FIELD-DECLARATION.md records that the inductance sum has no
 * independent validation — magpylib validated the FIELD only. This mutual DOES get independent
 * validation, by magpylib flux quadrature over the loop, which is a different and stronger
 * position than the self-inductance is in. The two must not be conflated.
 *
 * At 90° the answer is EXACTLY ZERO by symmetry, and that is returned as a structural zero
 * rather than as the residue of a numerical integral. Reason: the coil's field is axisymmetric
 * with no azimuthal component, and an axis-centred loop turned edge-on has its plane containing
 * the axis — so at every point of that loop the field lies IN the plane and none of it passes
 * through. The tests check that claim against an independent quadrature rather than trusting it.
 */
export function mutualToPickup(coil: CoilGeometry, pickup: PickupGeometry): number {
  validateCoil(coil);
  validatePickup(pickup);
  assertNoIntersection(coil, pickup);
  if (pickup.orientation === 90) return 0;
  const facing = pickup.orientation === 0 ? 1 : -1;   // 180° reverses the reference normal
  let total = 0;
  for (let j = 0; j < coil.turns; j++)
    total += mutualInductance(coil.radius, pickup.radius, pickup.separation - turnZ(coil, j));
  return facing * total;
}

/**
 * The pickup must not touch or pass through the winding.
 *
 * MY FIRST VERSION USED SCALAR RANGES AND HAD A HOLE. Astra's counterexample: an edge-on loop
 * of radius 50 mm centred at 77.5 mm — beyond the winding, so my `|separation| ≤ length/2`
 * test let it through — reaches back to r = 40 mm at z = 77.5 − √(50² − 40²) = 47.5 mm, which
 * is exactly the top turn. It intersected the coil and was accepted.
 *
 * So this computes the ACTUAL circle-to-turn distance instead:
 *
 *   COAXIAL (0°/180°): pickup and turn are coaxial circles, distance √((b−a)² + (Δz)²).
 *   EDGE-ON (90°): the pickup's plane contains the axis, so it reaches the winding radius `a`
 *     only if b ≥ a, and then at exactly z = separation ± √(b² − a²). Those crossing points
 *     lie at r = a, where a turn passes through every azimuth, so the distance to that turn is
 *     just |z_cross − z_turn|.
 *
 * The 90° case is the dangerous one precisely because its mutual inductance is a structural
 * zero: an intersecting edge-on pose would otherwise report a clean 0 and look fine.
 */
export function assertNoIntersection(coil: CoilGeometry, pickup: PickupGeometry): void {
  const clearance = coil.wireRadius;
  const nearestTurnZ = (z: number) => {
    let best = Infinity;
    for (let j = 0; j < coil.turns; j++) best = Math.min(best, Math.abs(z - turnZ(coil, j)));
    return best;
  };
  if (pickup.orientation === 90) {
    if (pickup.radius < coil.radius) return;                  // never reaches the winding radius
    const reach = Math.sqrt(pickup.radius * pickup.radius - coil.radius * coil.radius);
    for (const z of [pickup.separation - reach, pickup.separation + reach])
      if (nearestTurnZ(z) <= clearance)
        throw new Error(`Edge-on pickup crosses the winding at z = ${z.toFixed(6)} m: `
          + `a radius of ${pickup.radius} m reaches back to the coil radius there`);
    return;
  }
  let best = Infinity;
  for (let j = 0; j < coil.turns; j++)
    best = Math.min(best, Math.hypot(pickup.radius - coil.radius,
                                     pickup.separation - turnZ(coil, j)));
  if (best <= clearance)
    throw new Error(`Pickup loop is ${best.toExponential(3)} m from a turn, inside the `
      + `${clearance} m conductor: the mutual inductance diverges there`);
}

/** Flux linkage through the pickup, webers. One turn, so λ = Φ. */
export function fluxLinkage(mutualH: number, primaryCurrentA: number): number {
  return mutualH * primaryCurrentA;
}

/**
 * Rate of change of the primary current, from the circuit rather than from differencing samples.
 * L·di/dt = Vs − Vc − i·R is the inductor's defining relation, so this is exact at the instant.
 */
export function primaryDiDt(sourceV: number, capacitorV: number, currentA: number,
                            resistanceOhm: number, inductanceH: number): number {
  return (sourceV - capacitorV - currentA * resistanceOhm) / inductanceH;
}

/**
 * OPEN-CIRCUIT TERMINAL VOLTAGE of the pickup.
 *
 * THE CONVENTION, stated so it can be checked rather than believed: the pickup's reference
 * normal points along the coil's +axis at 0°, its winding sense is the right-hand sense about
 * that normal, and the returned value is the voltage of the terminal where the winding ENDS
 * relative to where it BEGINS. With that choice the open-circuit terminal voltage is +dλ/dt,
 * which is why there is no minus sign here even though the loop EMF is −dλ/dt: the EMF drives
 * around the loop, the terminal voltage is measured across the break, and they are opposite.
 *
 * This sign is verified against ngspice with a K-coupled open secondary and its dot convention;
 * it is NOT asserted from the formula alone.
 */
export function pickupTerminalVoltage(mutualH: number, primaryDiDtAperS: number): number {
  return mutualH * primaryDiDtAperS;
}

/**
 * Physical admissibility. A mutual inductance cannot exceed the geometric mean of the two self
 * inductances; if it does, the geometry or the arithmetic is wrong, not merely inaccurate.
 */
export function couplingCoefficient(mutualH: number, primaryH: number, pickupSelfH: number): number {
  return mutualH / Math.sqrt(primaryH * pickupSelfH);
}
