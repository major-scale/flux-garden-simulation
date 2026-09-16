/**
 * GC1 — CAPACITANCE FROM GEOMETRY.  See GEOMETRIC-CAPACITOR-DECLARATION.md.
 *
 * `C = eps0 * eps_r * A / d` is a MODEL APPROXIMATION WITH AN EXPLICIT DOMAIN, not a
 * presentation liberty. Fable first called it "the 95% GUI zone"; Astra corrected
 * that, and the correction matters: this gets the model standard, which means
 * correct *within a declared domain* and refusing outside it.
 *
 * NO PERCENTAGE ACCURACY IS CLAIMED. An accuracy figure would need an error
 * analysis nobody has done. The domain below is a SUPPORTED-APPROXIMATION
 * BOUNDARY, not an error bound.
 */

/**
 * F/m. The vacuum permittivity, as a DECLARED FIXED MODEL CONSTANT.
 *
 * It is NOT exact. Astra's correction: since the 2019 SI redefinition eps0 is a
 * MEASURED quantity with uncertainty, and calling it "CODATA exact" was wrong.
 * NIST CODATA 2022 gives 8.8541878188(14)e-12 F/m.
 *   https://www.physics.nist.gov/cgi-bin/cuu/Value?eqep0=
 *
 * We pin the 2018 recommended value below so results stay reproducible across
 * revisions of the constant. That is a modelling choice, declared here, not a claim
 * of exactness. Separately: eps_r = 1 for vacuum IS exact by definition, which is a
 * different statement and is not evidence about eps0.
 */
export const EPSILON_0 = 8.8541878128e-12;
/** Provenance of the pinned value, printed wherever the constant is surfaced. */
export const EPSILON_0_BASIS =
  'CODATA 2018 recommended value, pinned for reproducibility. NOT exact: CODATA 2022 gives '
  + '8.8541878188(14)e-12 F/m. eps_r = 1 for vacuum is exact by definition; eps0 is not.';

/**
 * Relative permittivity. Vacuum is exact by definition. Anything else is a NAMED
 * IDEALISED material with a NOMINAL value under stated fixed conditions — a
 * universal eps_r for a commercial material would be an overclaim, because it
 * varies with composition, frequency and temperature. No material library here.
 */
export interface Dielectric {
  id: string;
  label: string;
  relativePermittivity: number;
  /** Why this number is allowed to be used, stated at the point of use. */
  basis: string;
}

export const VACUUM: Dielectric = {
  id: 'vacuum', label: 'vacuum', relativePermittivity: 1,
  basis: 'exact by definition; eps_r = 1',
};

/**
 * THE DOMAIN. The uniform-field approximation needs the gap to be small compared
 * with BOTH lateral dimensions. Beyond this ratio the fringing we do not model
 * stops being negligible, so a candidate geometry is REFUSED rather than drawn
 * with a warning.
 */
export const MAX_GAP_TO_SIDE = 0.1;

export const GEOMETRY_LIMITS = {
  minArea: 1e-8,      // m^2  — 0.1 mm square
  maxArea: 1e2,       // m^2
  minGap: 1e-7,       // m    — 100 nm
  maxGap: 1e-1,       // m
} as const;

export interface PlateGeometry {
  /** m^2, of ONE plate. */
  area: number;
  /** m, plate separation. */
  gap: number;
  dielectric: Dielectric;
}

const refuse = (s: string): never => { throw new Error(`Geometry refused: ${s}`); };

/**
 * AREA ALONE DOES NOT DETERMINE BOTH LATERAL DIMENSIONS. Plates are declared
 * SQUARE, so side = sqrt(A). That is a stated choice, not a derivation.
 */
export const plateSide = (area: number): number => Math.sqrt(area);

/** Refuses anything outside the declared limits or outside the approximation's domain. */
export function validateGeometry(g: PlateGeometry): void {
  const { area, gap } = g;
  if (![area, gap, g.dielectric.relativePermittivity].every(Number.isFinite)) {
    refuse('area, gap and relative permittivity must all be finite');
  }
  if (area < GEOMETRY_LIMITS.minArea || area > GEOMETRY_LIMITS.maxArea) {
    refuse(`plate area ${area} m² is outside the declared range `
      + `[${GEOMETRY_LIMITS.minArea}, ${GEOMETRY_LIMITS.maxArea}] m²`);
  }
  if (gap < GEOMETRY_LIMITS.minGap || gap > GEOMETRY_LIMITS.maxGap) {
    refuse(`plate separation ${gap} m is outside the declared range `
      + `[${GEOMETRY_LIMITS.minGap}, ${GEOMETRY_LIMITS.maxGap}] m`);
  }
  if (!(g.dielectric.relativePermittivity >= 1)) {
    refuse(`relative permittivity ${g.dielectric.relativePermittivity} is below 1`);
  }
  const side = plateSide(area);
  const ratio = gap / side;
  if (ratio > MAX_GAP_TO_SIDE) {
    refuse(`separation ${gap} m against a ${side.toPrecision(4)} m plate side is a gap-to-side `
      + `ratio of ${ratio.toPrecision(3)}, beyond the declared limit of ${MAX_GAP_TO_SIDE}. `
      + 'The uniform-field approximation assumes the gap is small compared with both lateral '
      + 'dimensions; past this the neglected fringing field stops being negligible. '
      + 'REFUSED rather than drawn with a warning: this is the boundary of a supported '
      + 'approximation, not an error bound.');
  }
}

/** F. The forward map. Validates first, so an out-of-domain value can never be returned. */
export function capacitanceOf(g: PlateGeometry): number {
  validateGeometry(g);
  return (EPSILON_0 * g.dielectric.relativePermittivity * g.area) / g.gap;
}

/**
 * V/m. The LOCAL IDEAL BULK-FIELD ESTIMATE inside the plates, within the same
 * approximation. This is a NEW LOCAL FIELD MODEL scoped to a component whose
 * geometry we authored — it is NOT implied by the nodal solve, and the standing
 * prohibition on drawing a field BETWEEN NODES is unchanged, because the solver
 * still supplies no value there.
 *
 * Sign follows the voltage: positive means the field points from the positive
 * plate toward the negative one. Zero volts gives exactly zero, not a small value.
 */
export function interiorField(voltage: number, g: PlateGeometry): number {
  validateGeometry(g);
  return voltage / g.gap;
}

/** The gap-to-side ratio, for display. Below MAX_GAP_TO_SIDE by construction once validated. */
export const gapToSide = (g: PlateGeometry): number => g.gap / plateSide(g.area);
