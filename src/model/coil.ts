/**
 * COIL-1 — the magnetic side of the RLC, as geometry rather than decoration.
 *
 * WHY THIS EXISTS. The scene drew a coil whose length followed the voltage terraces and whose
 * turns and radius fed nothing, while the circuit's inductance was an authored 1 H. Peter
 * called the field faked and he was right: a 1 H air-core solenoid cannot exist at the drawn
 * size, so the drawn object was not the circuit's inductor and no field around it could be
 * that inductor's field.
 *
 * WHAT THIS MODULE IS. Pure functions: no THREE, no DOM, no simulation state. A coil is
 * modelled as N COAXIAL CIRCULAR FILAMENTS — not a helix. That is an idealization with a
 * price (the pitch is discarded, so the small azimuthal component and the axial current are
 * not represented) and a payment: the field is then EXACTLY axisymmetric, and each loop's
 * field has a closed form in complete elliptic integrals, so there is no polygon
 * discretization and no azimuthal error to bound.
 *
 * WHAT IS NOT CLAIMED. No wave propagation, no eddy currents, no core, no proximity or skin
 * effect, no parasitic winding capacitance, and therefore no claim that a real coil of these
 * dimensions would behave exactly like this at the resulting frequency. The filament model
 * needs a wire radius only for the self-inductance term, and that assumption is explicit.
 */

export interface CoilGeometry {
  /** Number of turns, each modelled as one circular filament. */
  turns: number;
  /** Winding radius, metres, measured to the wire centre. */
  radius: number;
  /** Axial length over which the turns are distributed, metres. */
  length: number;
  /** Conductor radius, metres. Used ONLY by the self-inductance term, where a filament diverges. */
  wireRadius: number;
}

export const COIL_LIMITS = {
  minTurns: 1, maxTurns: 400,
  minRadius: 1e-4, maxRadius: 1,
  minLength: 1e-4, maxLength: 10,
  minWire: 1e-6, maxWire: 1e-2,
  /**
   * Largest supported wireRadius/radius. loopSelfInductance uses the standard THIN-WIRE
   * asymptotic ln(8a/rw) − 7/4, which is derived for rw ≪ a; this keeps us inside that
   * regime instead of applying it to an arbitrarily thick wire and reporting the result as a
   * geometric inductance. NO ERROR BOUND IS CLAIMED at this ratio: knowing the neglected
   * terms are higher order does not by itself pin their size without their coefficients and
   * a reference, and I have not checked those.
   */
  maxWireToRadius: 0.1,
} as const;

export const MU0 = 4e-7 * Math.PI;

export function validateCoil(g: CoilGeometry): void {
  const ok = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!Number.isInteger(g.turns) || !ok(g.turns, COIL_LIMITS.minTurns, COIL_LIMITS.maxTurns))
    throw new Error(`Turns must be a whole number ${COIL_LIMITS.minTurns}…${COIL_LIMITS.maxTurns}`);
  if (!ok(g.radius, COIL_LIMITS.minRadius, COIL_LIMITS.maxRadius))
    throw new Error(`Coil radius must be ${COIL_LIMITS.minRadius}…${COIL_LIMITS.maxRadius} m`);
  if (!ok(g.length, COIL_LIMITS.minLength, COIL_LIMITS.maxLength))
    throw new Error(`Coil length must be ${COIL_LIMITS.minLength}…${COIL_LIMITS.maxLength} m`);
  if (!ok(g.wireRadius, COIL_LIMITS.minWire, COIL_LIMITS.maxWire))
    throw new Error(`Wire radius must be ${COIL_LIMITS.minWire}…${COIL_LIMITS.maxWire} m`);
  if (g.wireRadius * 2 * g.turns > g.length * 1.001)
    throw new Error('Turns of that wire do not fit in that length');
  if (g.wireRadius / g.radius > COIL_LIMITS.maxWireToRadius)
    throw new Error(`Wire radius must be at most ${COIL_LIMITS.maxWireToRadius} of the winding `
      + `radius: the thin-wire self-inductance formula is not valid outside that`);
}

/**
 * Complete elliptic integrals K(m) and E(m), parameter convention m = k².
 * Arithmetic–geometric mean: quadratically convergent, so a handful of iterations reaches
 * double precision, and no series truncation has to be justified separately.
 */
export function ellipticKE(m: number): { K: number; E: number } {
  if (!(m >= 0) || m >= 1) {
    if (m === 0) return { K: Math.PI / 2, E: Math.PI / 2 };
    throw new Error(`Elliptic parameter must satisfy 0 ≤ m < 1 (got ${m})`);
  }
  let a = 1, b = Math.sqrt(1 - m), c = Math.sqrt(m);
  let sum = 0.5 * m;                     // n = 0 term: 2^(n−1)·c₀², c₀² = m
  let weight = 1;                        // 2^(n−1) for n = 1
  for (let n = 1; n < 60; n++) {
    const an = (a + b) / 2;
    c = (a - b) / 2;
    b = Math.sqrt(a * b);
    a = an;
    sum += weight * c * c;
    weight *= 2;
    if (Math.abs(c) < 1e-17 * a) break;
  }
  const K = Math.PI / (2 * a);
  return { K, E: K * (1 - sum) };
}

/** Field of ONE circular filament of radius `a` centred on the axis at z = `z0`, per ampere. */
export function loopFieldUnit(a: number, z0: number, r: number, z: number): { br: number; bz: number } {
  const dz = z - z0;
  // On the axis the general form is 0/0; the closed form is exact and used directly.
  if (r < 1e-14) return { br: 0, bz: (MU0 * a * a) / (2 * Math.pow(a * a + dz * dz, 1.5)) };
  const q = (a + r) * (a + r) + dz * dz;
  const d = (a - r) * (a - r) + dz * dz;
  // ON the filament the field diverges. Returning Infinity here let NaN propagate silently
  // into the streamline integrator, which then failed several steps later inside ellipticKE
  // with a NaN parameter — a crash whose message pointed nowhere near the cause.
  if (!(d > 0)) throw new Error(`Field is singular on the filament itself (r=${r}, z=${z})`);
  const m = (4 * a * r) / q;
  const { K, E } = ellipticKE(Math.min(m, 1 - 1e-15));
  const rootQ = Math.sqrt(q);
  const bz = (MU0 / (2 * Math.PI * rootQ)) * (K + E * (a * a - r * r - dz * dz) / d);
  const br = (MU0 * dz / (2 * Math.PI * r * rootQ)) * (E * (a * a + r * r + dz * dz) / d - K);
  if (!Number.isFinite(br) || !Number.isFinite(bz))
    throw new Error(`Non-finite loop field at r=${r}, z=${z}`);
  return { br, bz };
}

/** Axial position of turn `j` (0-based), distributed evenly over the winding length. */
export function turnZ(g: CoilGeometry, j: number): number {
  return g.turns === 1 ? 0 : -g.length / 2 + (g.length * (j + 0.5)) / g.turns;
}

/**
 * The coil's field per ampere at cylindrical (r, z), with z measured from the coil centre.
 * Exactly axisymmetric: there is no azimuthal dependence to approximate, because every
 * source is a full circle evaluated in closed form.
 */
export function coilFieldUnit(g: CoilGeometry, r: number, z: number): { br: number; bz: number } {
  let br = 0, bz = 0;
  for (let j = 0; j < g.turns; j++) {
    const f = loopFieldUnit(g.radius, turnZ(g, j), r, z);
    br += f.br; bz += f.bz;
  }
  if (!Number.isFinite(br) || !Number.isFinite(bz))
    throw new Error(`Non-finite coil field at r=${r}, z=${z}`);
  return { br, bz };
}

/**
 * Distance from (r, z) to the NEAREST turn, over every turn — not just the end ones.
 * The streamline mask was checking only the first and last turn, so a path seeded on or
 * driven into any INTERIOR turn walked straight into the singularity.
 */
export function distanceToWinding(g: CoilGeometry, r: number, z: number): number {
  let best = Infinity;
  for (let j = 0; j < g.turns; j++)
    best = Math.min(best, Math.hypot(r - g.radius, z - turnZ(g, j)));
  return best;
}

/**
 * Exact closest approach of the SEGMENT (r0,z0)→(r1,z1) to any turn, in the meridional plane.
 *
 * Sampling the endpoints and the midpoint is not a proof: a chord can grazes a turn between
 * the samples while all three stay outside the mask, so the path clips the singularity and
 * nothing notices. Point-to-segment distance settles it for the whole segment at once, and
 * costs one clamped dot product per turn.
 */
export function segmentDistanceToWinding(g: CoilGeometry,
                                         r0: number, z0: number, r1: number, z1: number): number {
  const dr = r1 - r0, dz = z1 - z0;
  const len2 = dr * dr + dz * dz;
  let best = Infinity;
  for (let j = 0; j < g.turns; j++) {
    const cr = g.radius, cz = turnZ(g, j);
    let t = len2 > 0 ? ((cr - r0) * dr + (cz - z0) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;                       // closest point ON the segment
    best = Math.min(best, Math.hypot(r0 + t * dr - cr, z0 + t * dz - cz));
  }
  return best;
}

/**
 * Mutual inductance of two coaxial circular filaments — Maxwell's formula, exact.
 * Used for every pair of distinct turns.
 */
export function mutualInductance(a: number, b: number, d: number): number {
  const q = (a + b) * (a + b) + d * d;
  const m = (4 * a * b) / q;
  const k = Math.sqrt(m);
  const { K, E } = ellipticKE(Math.min(m, 1 - 1e-15));
  return MU0 * Math.sqrt(a * b) * ((2 / k - k) * K - (2 / k) * E);
}

/**
 * Self-inductance of ONE circular turn of wire radius `rw`. A filament's self-inductance
 * diverges, so this is where the conductor's thickness has to enter; the −7/4 form assumes
 * uniform current density across the wire, i.e. low frequency, no skin effect.
 */
export function loopSelfInductance(a: number, rw: number): number {
  return MU0 * a * (Math.log((8 * a) / rw) - 7 / 4);
}

/**
 * Total self-inductance of the winding: the double sum of turn-to-turn mutuals plus each
 * turn's own self term. This is the value the CIRCUIT uses, so the drawn coil is the
 * inductor rather than an ornament beside one.
 *
 * Domain: filaments at the wire centre, uniform current density, air, no parasitic winding
 * capacitance and no proximity effect. It is a geometric inductance, not a measured one.
 */
export function coilInductance(g: CoilGeometry): number {
  validateCoil(g);
  let total = g.turns * loopSelfInductance(g.radius, g.wireRadius);
  for (let i = 0; i < g.turns; i++)
    for (let j = i + 1; j < g.turns; j++)
      total += 2 * mutualInductance(g.radius, g.radius, turnZ(g, i) - turnZ(g, j));
  return total;
}

/**
 * A ROUGH current-sheet estimate. The coefficient 1/(1 + 0.9x + 0.02x²) is an uncited fit I
 * do not have a source or an accuracy domain for, so it is NOT a reference and NOT independent
 * validation of anything — I previously called it an "accurate rational fit", which it has not
 * been shown to be. Its only job is to catch a factor-level error in the double sum: it is a
 * different model (continuous sheet, no wire radius), so agreement is expected to be loose.
 * magpylib in coil-reference.test.ts validates the FIELD; it does not check this
 * inductance sum, which has no independent validation at present.
 */
export function nagaokaSheetInductance(g: CoilGeometry): number {
  const x = (2 * g.radius) / g.length;
  const k = 1 / (1 + 0.9 * x + 0.02 * x * x);
  return (MU0 * g.turns * g.turns * Math.PI * g.radius * g.radius / g.length) * k;
}

export interface Streamline {
  /** Meridional points (r, z), r ≥ 0, z from the coil centre. */
  points: [number, number][];
  /** Why integration stopped. Streamlines are NEVER forced closed. */
  stop: 'closed' | 'boundary' | 'conductor' | 'steps' | 'stalled' | 'nonfinite';
  /**
   * The step actually taken. The requested step is clamped so it cannot straddle a turn, and
   * a caller doing a convergence study has to know when its request was overridden rather
   * than compare two runs that silently used the same step.
   */
  stepUsed: number;
}

/**
 * Integrate one field line in the meridional half-plane by RK4 on the unit-current field.
 *
 * The path is CURRENT-INDEPENDENT: Biot–Savart is linear, so B = i·B_unit and a scalar factor
 * changes neither the tangent direction nor therefore the curve. Sign only reverses the
 * direction of travel along the same curve. So this is computed once per geometry and cached.
 *
 * The curve is never forced to close. It stops when it returns near its start, leaves the
 * domain, reaches the conductor mask (whose interior is singular), stalls in a null, or runs
 * out of steps — and says which.
 */
export function streamline(g: CoilGeometry, r0: number, z0: number,
                           opts: { step: number; maxSteps: number; rMax: number; zMax: number }): Streamline {
  const pts: [number, number][] = [[r0, z0]];
  const mask = g.wireRadius * 1.5;
  // Clamping the step keeps chords short; the exact segment test below is what actually
  // guarantees the path never clips a turn.
  const h = Math.min(opts.step, mask * 0.9);
  const inside = (r: number, z: number) => distanceToWinding(g, Math.abs(r), z) < mask;
  if (inside(r0, z0)) return { points: pts, stop: 'conductor', stepUsed: h };

  type Probe = { ok: true; d: [number, number] } | { ok: false; why: 'conductor' | 'nonfinite' | 'stalled' };
  /** Field direction at a point, or the REASON it is unusable — masked, unusable, or a null. */
  const dir = (r: number, z: number): Probe => {
    const rr = Math.abs(r);
    if (!Number.isFinite(rr) || !Number.isFinite(z)) return { ok: false, why: 'nonfinite' };
    if (inside(rr, z)) return { ok: false, why: 'conductor' };
    let f;
    try { f = coilFieldUnit(g, rr, z); } catch { return { ok: false, why: 'nonfinite' }; }
    const n = Math.hypot(f.br, f.bz);
    if (!Number.isFinite(n)) return { ok: false, why: 'nonfinite' };
    if (n < 1e-30) return { ok: false, why: 'stalled' };        // a null, not a conductor
    return { ok: true, d: [f.br / n, f.bz / n] };
  };
  let r = r0, z = z0;
  for (let s = 0; s < opts.maxSteps; s++) {
    const k1 = dir(r, z); if (!k1.ok) return { points: pts, stop: k1.why, stepUsed: h };
    const k2 = dir(r + h * k1.d[0] / 2, z + h * k1.d[1] / 2);
    if (!k2.ok) return { points: pts, stop: k2.why, stepUsed: h };
    const k3 = dir(r + h * k2.d[0] / 2, z + h * k2.d[1] / 2);
    if (!k3.ok) return { points: pts, stop: k3.why, stepUsed: h };
    const k4 = dir(r + h * k3.d[0], z + h * k3.d[1]);
    if (!k4.ok) return { points: pts, stop: k4.why, stepUsed: h };
    const nr = r + (h / 6) * (k1.d[0] + 2 * k2.d[0] + 2 * k3.d[0] + k4.d[0]);
    const nz = z + (h / 6) * (k1.d[1] + 2 * k2.d[1] + 2 * k3.d[1] + k4.d[1]);
    if (!Number.isFinite(nr) || !Number.isFinite(nz)) return { points: pts, stop: 'nonfinite', stepUsed: h };
    const ar = Math.abs(nr);                              // reflect across the axis
    // Reject the whole SEGMENT before emitting its endpoint.
    if (segmentDistanceToWinding(g, Math.abs(r), z, ar, nz) < mask)
      return { points: pts, stop: 'conductor', stepUsed: h };
    r = ar; z = nz;
    pts.push([r, z]);
    if (r > opts.rMax || Math.abs(z) > opts.zMax) return { points: pts, stop: 'boundary', stepUsed: h };
    if (s > 12 && Math.hypot(r - r0, z - z0) < h * 0.9) return { points: pts, stop: 'closed', stepUsed: h };
  }
  return { points: pts, stop: 'steps', stepUsed: h };
}

/**
 * WHETHER A GIVEN COIL CAN ACTUALLY BE SIMULATED AT THE RESOLUTION WE CLAIM.
 *
 * Deriving L from geometry moves the circuit from henries to microhenries, and the resonant
 * period with it — from milliseconds to hundreds of nanoseconds. The page picks its interval
 * as max(minH, period/240), and that clamp is SILENT: past a certain frequency the samples per
 * cycle simply fall below 240 with nothing said. This reports the arithmetic so a geometry can
 * be refused or a claim narrowed BEFORE it is drawn, rather than degrading quietly.
 *
 * It is a resolution bound, not a physics bound. The analytic kernel is exact over any held
 * interval; what degrades is how finely the ring is sampled for display and history.
 */
export function coilTimingBudget(
  inductanceH: number, capacitanceF: number,
  limits: { minH: number; targetSamplesPerCycle: number },
): { periodS: number; frequencyHz: number; requestedDtS: number; actualDtS: number;
     samplesPerCycle: number; clamped: boolean } {
  const period = 2 * Math.PI * Math.sqrt(inductanceH * capacitanceF);
  const requested = period / limits.targetSamplesPerCycle;
  const actual = Math.max(limits.minH, requested);
  return {
    periodS: period,
    frequencyHz: 1 / period,
    requestedDtS: requested,
    actualDtS: actual,
    samplesPerCycle: period / actual,
    clamped: requested < limits.minH,
  };
}

/**
 * The smallest inductance that still resolves at the target sampling, for a given capacitance
 * and interval floor. Below this the coil is too small to simulate at the claimed resolution,
 * which is what bounds the supported geometry envelope.
 */
export function minimumResolvableInductance(
  capacitanceF: number, limits: { minH: number; targetSamplesPerCycle: number },
): number {
  const minPeriod = limits.minH * limits.targetSamplesPerCycle;
  return (minPeriod * minPeriod) / (4 * Math.PI * Math.PI * capacitanceF);
}
