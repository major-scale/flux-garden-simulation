/**
 * ONE AUTHORITATIVE DESCRIPTION OF THE COIL, built once and then only read.
 *
 * Peter's requirement: a component's geometry, its solver definition, its field and its visual
 * mappings come from ONE package, and no physics is evaluated per render. This is that package.
 *
 * It is built from a validated geometry, carries the inductance the CIRCUIT uses, and holds
 * the field lines already integrated. The field lines are current-independent: Biot–Savart is
 * linear, so B = i·B_unit and a scalar changes neither the tangent direction nor the curve.
 * A signed current therefore reverses the direction of travel and scales the encoding, and
 * nothing else — so the renderer needs the signed current from a simulation snapshot and
 * nothing more.
 */
import {
  COIL_LIMITS, coilInductance, loopSelfInductance, streamline, turnZ, validateCoil,
  type CoilGeometry, type Streamline,
} from './coil';
import { mutualToPickup, type PickupGeometry } from './pickup';

export interface CoilFieldLine {
  /** Meridional (r, z) in METRES, z from the coil centre. Revolve to any azimuth to draw. */
  points: [number, number][];
  stop: Streamline['stop'];
  /** Seed radius in metres, kept so a line can be identified without re-deriving it. */
  seedR: number;
}

/**
 * THE PICKUP, in the same descriptor as the coil that induces its voltage.
 *
 * One package, so the pose that determines the mutual inductance is the SAME pose that gets
 * drawn. Splitting them would let the number and the picture drift, which is the fault this
 * whole line of work started from.
 */
export interface PickupPackage {
  geometry: PickupGeometry;
  /** Henries, from the two geometries together. */
  mutualH: number;
  /** |M| / √(L₁L₂). Reported so an implausible pose is visible rather than merely wrong. */
  couplingK: number;
}

export interface CoilPackage {
  geometry: CoilGeometry;
  /** Henries, from the winding — this is what the circuit uses. */
  inductanceH: number;
  /** Where each turn sits along the axis, metres from centre. */
  turnPositionsM: number[];
  /** Integrated once. Shape does not depend on the current, only its sign does. */
  fieldLines: CoilFieldLine[];
  /**
   * Scene units per metre. The scene's VERTICAL axis means volts, not length, so a coil with
   * real dimensions has to be mapped by a stated factor rather than pretending the two share
   * a metric. Drawn size is therefore not comparable with terrace heights, and the page says so.
   */
  sceneUnitsPerMetre: number;
  /** Present only when a pickup is placed. Its pose lives here, with the coil that drives it. */
  pickup?: PickupPackage;
  /** How long the build took, so a slow geometry is visible rather than felt. */
  buildMs: number;
}

export interface CoilPackageOptions {
  /** Fractions of the winding radius to seed field lines at, on the mid-plane. */
  seedFractions?: number[];
  integrationStepM?: number;
  maxSteps?: number;
  /** Domain limits as multiples of the winding radius and half-length. */
  rMaxFactor?: number;
  zMaxFactor?: number;
  sceneUnitsPerMetre?: number;
  /** Place a pickup loop. Its mutual inductance is computed here, once, with the coil. */
  pickup?: PickupGeometry;
}

/**
 * Points for drawing. Decimation is lossy — a spline through fewer points is NOT the solved
 * polyline — so the last point is always kept (dropping it shortens the trace and, on a line
 * that stops at the conductor, moves its end away from where the field actually took it), and
 * a renderer must check the drawn curve against the solved one rather than assume they agree.
 */
export function displayPolyline(points: [number, number][], maxPoints: number): [number, number][] {
  if (points.length <= maxPoints) return points.slice();
  const stride = Math.ceil(points.length / maxPoints);
  const out: [number, number][] = [];
  for (let k = 0; k < points.length; k += stride) out.push(points[k]);
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

export function buildCoilPackage(geometry: CoilGeometry, opts: CoilPackageOptions = {}): CoilPackage {
  validateCoil(geometry);
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Seeds chosen from a survey of THIS geometry, and RE-SURVEYED when the default changed —
  // the previous set was tuned for a narrower coil and one of its seeds ran into the winding
  // here, which the package test caught rather than letting it draw quietly. Lines nearer the
  // axis genuinely run far out, since a solenoid's return flux spreads over a large volume:
  // 0.30a reaches 17.7a. These three close and nest at 6.2a, 4.3a and 3.0a — wide enough to
  // read as a field, tight enough not to swamp the circuit. Nothing is clipped to make that
  // true; a line ends where the field takes it and reports why.
  const seeds = opts.seedFractions ?? [0.50, 0.60, 0.70];
  const step = opts.integrationStepM ?? geometry.wireRadius * 0.5;
  const maxSteps = opts.maxSteps ?? 20000;
  const rMax = (opts.rMaxFactor ?? 20) * geometry.radius;
  const zMax = (opts.zMaxFactor ?? 20) * geometry.radius;

  const fieldLines: CoilFieldLine[] = [];
  for (const f of seeds) {
    const seedR = f * geometry.radius;
    const line = streamline(geometry, seedR, 0, { step, maxSteps, rMax, zMax });
    fieldLines.push({ points: line.points, stop: line.stop, seedR });
  }
  const turnPositionsM = Array.from({ length: geometry.turns }, (_, j) => turnZ(geometry, j));
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // FROZEN, and deeply. It is described as built once and only read, so handing back the
  // caller's own mutable geometry object and live arrays would let the geometry, the
  // inductance derived from it and the cached field drift apart with nothing to catch it.
  const inductanceH = coilInductance(geometry);
  // Built here so the pose that sets M is the pose that gets drawn — one descriptor, as agreed.
  let pickup: PickupPackage | undefined;
  if (opts.pickup) {
    const mutualH = mutualToPickup(geometry, opts.pickup);      // validates and refuses intersections
    // The pickup's own wire is the COIL's wire — it is the same conductor stock, and saying so
    // is what makes its self-inductance computable at all. But the thin-wire formula that
    // computes it needs rw ≪ loop radius, and a small enough pickup violates that while every
    // individual input still looks legal. Checked here rather than assumed.
    const selfH = loopSelfInductance(opts.pickup.radius, geometry.wireRadius);
    if (!Number.isFinite(selfH) || selfH <= 0)
      throw new Error(`Pickup self-inductance is not usable at radius ${opts.pickup.radius} m `
        + `with ${geometry.wireRadius} m wire`);
    if (geometry.wireRadius / opts.pickup.radius > COIL_LIMITS.maxWireToRadius)
      throw new Error(`Pickup radius ${opts.pickup.radius} m is too small for ${geometry.wireRadius} m `
        + `wire: the thin-wire self-inductance formula is not valid below a `
        + `${1 / COIL_LIMITS.maxWireToRadius}:1 ratio`);
    const couplingK = mutualH / Math.sqrt(inductanceH * selfH);
    if (!Number.isFinite(couplingK) || Math.abs(couplingK) >= 1)
      throw new Error(`Coupling coefficient ${couplingK} is not physically admissible; `
        + `|M| must stay below sqrt(L1*L2)`);
    pickup = Object.freeze({ geometry: Object.freeze({ ...opts.pickup }), mutualH, couplingK });
  }
  const frozen: CoilPackage = {
    geometry: Object.freeze({ ...geometry }),
    inductanceH,
    turnPositionsM: Object.freeze(turnPositionsM.slice()) as number[],
    fieldLines: Object.freeze(fieldLines.map((l) => Object.freeze({
      points: Object.freeze(l.points.map((pt) => Object.freeze([pt[0], pt[1]]) as [number, number])) as [number, number][],
      stop: l.stop,
      seedR: l.seedR,
    }))) as CoilFieldLine[],
    sceneUnitsPerMetre: opts.sceneUnitsPerMetre ?? 1,
    pickup,
    buildMs: t1 - t0,
  };
  return Object.freeze(frozen);
}

/**
 * The DEFAULT coil. Chosen so its derived inductance sits inside the timing envelope with the
 * page's plate capacitor — see coilTimingBudget — and so every turn can be drawn one for one.
 */
export const DEFAULT_COIL: CoilGeometry = {
  turns: 20, radius: 0.04, length: 0.10, wireRadius: 0.0008,
};

/**
 * WHY THIS COIL AND NOT ANOTHER.
 *
 * The timing constraint is a LOWER BOUND ONLY: with the ~88.5 pF plate capacitor and a 1 ns
 * interval floor at 240 samples per cycle, L must be at least ~16.5 µH or the sampling
 * coarsens silently. Larger inductances are fine — a bigger coil rings more slowly and is
 * sampled more finely, not less. I previously wrote that this "pins every workable geometry
 * to roughly 19 µH"; that was a selection artefact, since the nine geometries I compared had
 * all been picked near the boundary. Nothing forbids a larger coil.
 *
 * So this is a CHOICE within a large space, not a forced value. Among geometries just above
 * the bound, this one has the most open winding — a 5 mm pitch, twice that of a 40-turn coil
 * of similar inductance — so 20 turns can be drawn one for one and still be told apart. Its
 * headroom over the resolvable minimum is about 1.14, which is why coilTimingBudget exists
 * and why a test asserts the default stays above the bound.
 */
