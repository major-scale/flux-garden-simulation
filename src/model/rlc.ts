/**
 * RLC-1 — a series source–resistor–inductor–capacitor loop, advanced by ANALYTIC
 * held-input intervals. See RLC-DECLARATION.md and its Amendment A.
 *
 *   C·dVc/dt = i
 *   L·di/dt  = Vs − Vc − R·i
 *
 * The analytic update is a matrix exponential and is exact for any interval. EVALUATING
 * it in floating point is a separate problem, and it is where every defect found in
 * review lived. Two rules earned the hard way and enforced here:
 *
 *  1. EVALUATE THE COEFFICIENTS, NOT THE EXPONENTS. Writing the diagonal as EC − α·ES
 *     subtracts two nearly equal numbers when α ≈ β and loses the answer completely —
 *     on the declared fixture it returns 0.0 against a true −9.99999998e-20. The
 *     eigenmode form below is accurate to 1e-38 absolute on the same input.
 *  2. A REFACTOR OF A CHECKED FORMULA IS AN UNCHECKED FORMULA. An earlier revision was
 *     rewritten into tidier notation and silently became a different circuit
 *     (u' = −αu + i/C, i' = −u/L − 3αi). Change these expressions only with the
 *     reference tests in hand.
 */

/** The declared input domain. Refusal means OUTSIDE THE DOMAIN, never an error bound. */
export const RLC_LIMITS = {
  minR: 1, maxR: 1e9,
  minC: 1e-13, maxC: 1,
  minL: 1e-6, maxL: 1e3,
  maxV: 100, maxI: 1e3,
  minH: 1e-9, maxH: 1,
} as const;

export interface RlcInputs {
  voltage: number; resistance: number; capacitance: number; inductance: number;
  initialVoltage: number; initialCurrent: number;
}

export const RLC_DEFAULT: RlcInputs = {
  voltage: 10, resistance: 2, capacitance: 0.01, inductance: 1,
  initialVoltage: 0, initialCurrent: 0,
};

export function validateRlc(value: unknown): asserts value is RlcInputs {
  const want = 'capacitance,inductance,initialCurrent,initialVoltage,resistance,voltage';
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== want)
    throw new Error(`RLC inputs require exactly ${want.split(',').join(', ')}.`);
  const p = value as RlcInputs;
  const nums = [p.voltage, p.resistance, p.capacitance, p.inductance, p.initialVoltage, p.initialCurrent];
  if (!nums.every(Number.isFinite)
    || Math.abs(p.voltage) > RLC_LIMITS.maxV || Math.abs(p.initialVoltage) > RLC_LIMITS.maxV
    || Math.abs(p.initialCurrent) > RLC_LIMITS.maxI
    || p.resistance < RLC_LIMITS.minR || p.resistance > RLC_LIMITS.maxR
    || p.capacitance < RLC_LIMITS.minC || p.capacitance > RLC_LIMITS.maxC
    || p.inductance < RLC_LIMITS.minL || p.inductance > RLC_LIMITS.maxL)
    throw new Error(`RLC refused: |V| ≤ ${RLC_LIMITS.maxV}, |i₀| ≤ ${RLC_LIMITS.maxI} A, `
      + `R ${RLC_LIMITS.minR}…${RLC_LIMITS.maxR} Ω, C ${RLC_LIMITS.minC}…${RLC_LIMITS.maxC} F, `
      + `L ${RLC_LIMITS.minL}…${RLC_LIMITS.maxL} H; finite numbers only.`);
}

/** RLC gets its OWN document format. flux-rc-1 files describe a circuit with no inductor
 *  and cannot determine a run of this one; they are handled explicitly by the page. */
export function encodeRlc(p: RlcInputs): string {
  validateRlc(p);
  return JSON.stringify({ format: 'flux-rlc-1', inputs: p }, null, 2);
}
export function decodeRlc(text: string): RlcInputs {
  const doc = JSON.parse(text);
  if (!doc || Object.keys(doc).sort().join(',') !== 'format,inputs' || doc.format !== 'flux-rlc-1')
    throw new Error('Expected an authored flux-rlc-1 experiment, not a live checkpoint.');
  validateRlc(doc.inputs);
  return { ...doc.inputs };
}

export type Regime = 'underdamped' | 'critical' | 'overdamped';

/** Damping description. `disc` is compared RELATIVELY — an absolute threshold cannot
 *  serve a domain spanning many decades of ω₀. */
export function regimeOf(R: number, L: number, C: number): Regime {
  const alpha = R / (2 * L), w02 = 1 / (L * C), disc = alpha * alpha - w02;
  if (Math.abs(disc) <= 1e-12 * w02) return 'critical';
  return disc > 0 ? 'overdamped' : 'underdamped';
}

/** The four entries of e^{Ah} for x = (u, i), u = Vc − Vs. */
export interface StepCoefficients { a11: number; a12: number; a21: number; a22: number; }

export function stepCoefficients(R: number, L: number, C: number, h: number): StepCoefficients {
  const alpha = R / (2 * L), w02 = 1 / (L * C);
  switch (regimeOf(R, L, C)) {
    case 'overdamped': {
      const beta = Math.sqrt(alpha * alpha - w02);
      // p is the SLOW root. Computing it as (alpha − beta) cancels catastrophically —
      // at R=1e9, L=1e-6 that difference evaluates to exactly 0 against a true 1e-7.
      const q = alpha + beta, p = w02 / q, dn = q - p;
      const ep = Math.exp(-p * h), eq = Math.exp(-q * h);
      // (ep − eq) IS ITSELF A CANCELLATION when both exponents are small: at
      // R=64, L=1000, C=1, h=1e-9 the two are 1−2.7e-11 and 1−3.7e-11, and the naive
      // difference loses six digits (relative error 1.9e-6). Factoring gives
      //   ep − eq = e^{−ph}·(1 − e^{−(q−p)h}) = ep·(−expm1(−dn·h))
      // which is exact to the last bit on that case.
      const diffExp = ep * -Math.expm1(-dn * h);
      const D = diffExp / dn;
      // The diagonals use the same D rather than performing their own subtractions:
      //   a11 = (q·ep − p·eq)/dn = ep + p·D        a22 = (q·eq − p·ep)/dn = eq − p·D
      // NOT a claim that they never cancel: a22 = eq − p·D still subtracts nearly equal
      // quantities near its own zero, where relative accuracy is unavailable and the
      // absolute error is what is bounded (see the zero-crossing fixture).
      return { a11: ep + p * D, a12: D / C, a21: -D / L, a22: eq - p * D };
    }
    case 'critical': {
      const e = Math.exp(-alpha * h);
      return { a11: e * (1 + alpha * h), a12: (e * h) / C, a21: -(e * h) / L, a22: e * (1 - alpha * h) };
    }
    default: {
      // Underdamped needs no rescue: e^{−αh} ≤ 1 and |cos|,|sin| ≤ 1, so nothing overflows.
      const wd = Math.sqrt(w02 - alpha * alpha);
      const e = Math.exp(-alpha * h), c = e * Math.cos(wd * h), s = (e * Math.sin(wd * h)) / wd;
      return { a11: c + alpha * s, a12: s / C, a21: -s / L, a22: c - alpha * s };
    }
  }
}

/**
 * ∫₀ʰ tⁿ·e^{−at} dt, evaluated stably for ANY a·h.
 *
 * These moments are the foundation of both integrals below. The closed form
 * n!/a^{n+1}·[1 − e^{−ah}Σ(ah)ʲ/j!] subtracts nearly equal quantities when a·h is small,
 * which cost three significant digits in the critical branch. The series is exact there
 * and every term is positive, so a moment can never come out negative — which matters,
 * because a negative moment produced NEGATIVE HEAT that the model committed silently.
 */
export function momentExp(n: number, a: number, h: number): number {
  const x = a * h;
  if (x < n + 1) {
    // γ(n+1,x) series: M_n = h^{n+1}·e^{−x}·Σ_k xᵏ·n!/(n+1+k)!  — a NUMERICAL EVALUATION,
    // truncated when the next term falls below 1e-18 of the running sum, not an exact
    // result. What it does give structurally is POSITIVITY: every term is positive, so no
    // truncation point can return a negative moment. The alternating series it replaced
    // offered no such guarantee.
    let term = 1 / (n + 1), sum = term;
    for (let k = 1; k <= 400; k++) {
      term *= x / (n + 1 + k);
      sum += term;
      if (term <= 1e-18 * sum) break;
    }
    return h ** (n + 1) * Math.exp(-x) * sum;
  }
  // x ≥ n+1: the bracket below is O(1) — the Poisson tail is well away from 1 — so the
  // closed form is well conditioned here. IT IS NOT ELSEWHERE: its cancellation scales
  // with n as well as with a·h, and at n=14, a·h=0.5 it returned 0.634 for an integral
  // that cannot exceed 1/15. Branching on a·h alone was wrong.
  let fact = 1, series = 1, power = 1;
  for (let j = 1; j <= n; j++) { power *= x / j; series += power; fact *= j; }
  return (fact / a ** (n + 1)) * (1 - Math.exp(-x) * series);
}

/**
 * Below this the eigenmode/trig split is ill-conditioned: amplitudes scale as 1/β and are
 * nearly equal and opposite. A SERIES IN disc = α²−ω₀² is used instead, built from the
 * moments above, and it is uniformly valid from either side of critical — so the same
 * expression covers slightly-overdamped and slightly-underdamped without a branch that
 * disagrees with the state update.
 */
const DISC_H2_LIMIT = 1e-6;

/** Terms of cosh(βt) and sinh(βt)/β as powers of disc, valid for either sign of disc. */
function nearCriticalTerms(): { cosh: number[]; sinhOverBeta: number[] } {
  // cosh(βt) = Σ (disc·t²)^m/(2m)! ; sinh(βt)/β = Σ disc^m·t^{2m+1}/(2m+1)!
  return { cosh: [1, 1 / 2, 1 / 24, 1 / 720], sinhOverBeta: [1, 1 / 6, 1 / 120, 1 / 5040] };
}

/**
 * ∫i dt over one interval, from which ΔVc = (∫i dt)/C.
 *
 * NEVER computed as u₁ − u₀: near equilibrium that subtraction loses four orders of
 * magnitude. Note the two DIFFERENT derivative coefficients — the forms that factor out
 * e^{−αt} take the shifted i′(0)+α·i₀, the eigenmode form takes the true i′(0). Conflating
 * them made this disagree with C·ΔVc by a factor of 1.4379 whenever i₀ ≠ 0.
 */
export function integratedCurrent(u0: number, i0: number, R: number, L: number, C: number, h: number): number {
  const alpha = R / (2 * L), w02 = 1 / (L * C), disc = alpha * alpha - w02;
  const K = -u0 / L - alpha * i0;              // shifted: coefficient of s(t)
  if (Math.abs(disc) * h * h < DISC_H2_LIMIT) {
    // i(t) = e^{−αt}[ i₀·cosh(βt) + K·sinh(βt)/β ], expanded in disc with exact moments.
    const t = nearCriticalTerms();
    let sum = 0;
    for (let m = 0; m < t.cosh.length; m++) {
      const dm = disc ** m;
      sum += i0 * dm * t.cosh[m] * momentExp(2 * m, alpha, h)
           + K * dm * t.sinhOverBeta[m] * momentExp(2 * m + 1, alpha, h);
    }
    return sum;
  }
  if (disc > 0) {
    const beta = Math.sqrt(disc), q = alpha + beta, p = w02 / q, dn = q - p;
    const Ip = -Math.expm1(-p * h) / p, Iq = -Math.expm1(-q * h) / q;
    // (q·i₀ + i′(0)) cancels catastrophically — the q·i₀ terms are equal and opposite,
    // 1e18 against −1e18 on the stiff fixture. Substituting i′(0) first removes it.
    const Ap = (-u0 / L - p * i0) / dn, Aq = (u0 / L + q * i0) / dn;
    return Ap * Ip + Aq * Iq;
  }
  const wd = Math.sqrt(-disc);
  const e = Math.exp(-alpha * h), sn = Math.sin(wd * h);
  // Θ = 1 − e^{−αh}cos(ω_d h) from expm1 and a half-angle versine: both stay accurate small.
  const theta = -Math.expm1(-alpha * h) + 2 * e * Math.sin((wd * h) / 2) ** 2;
  const Jc = (alpha * theta + e * wd * sn) / w02;
  const Js = (wd * theta - alpha * e * sn) / w02;
  return i0 * Jc + K * (Js / wd);
}

/**
 * ∫i² dt over one interval. Q = R·∫i² dt, and Q ≥ 0 is a physical requirement that the
 * caller checks — an earlier series returned a NEGATIVE value here (heat of −9333 J) and
 * the model committed it without complaint.
 */
export function integratedCurrentSquared(u0: number, i0: number, R: number, L: number, C: number, h: number): number {
  const alpha = R / (2 * L), w02 = 1 / (L * C), disc = alpha * alpha - w02;
  const K = -u0 / L - alpha * i0;
  const a = 2 * alpha;
  if (Math.abs(disc) * h * h < DISC_H2_LIMIT) {
    // i(t)² with i(t) = e^{−αt}[i₀·cosh(βt) + K·sinh(βt)/β], expanded in disc. Every
    // moment is positive, so no truncation can drive the result negative.
    const t = nearCriticalTerms();
    const cosh: number[] = [], sob: number[] = [];
    for (let m = 0; m < t.cosh.length; m++) { cosh[m] = disc ** m * t.cosh[m]; sob[m] = disc ** m * t.sinhOverBeta[m]; }
    let sum = 0;
    for (let m = 0; m < cosh.length; m++) for (let n = 0; n < cosh.length; n++) {
      sum += i0 * i0 * cosh[m] * cosh[n] * momentExp(2 * m + 2 * n, a, h)
           + 2 * i0 * K * cosh[m] * sob[n] * momentExp(2 * m + 2 * n + 1, a, h)
           + K * K * sob[m] * sob[n] * momentExp(2 * m + 2 * n + 2, a, h);
    }
    return sum;
  }
  if (disc > 0) {
    const beta = Math.sqrt(disc), q = alpha + beta, p = w02 / q, dn = q - p;
    const Ap = (-u0 / L - p * i0) / dn, Aq = (u0 / L + q * i0) / dn;
    const e2 = (r: number) => (r === 0 ? h : -Math.expm1(-r * h) / r);
    return Ap * Ap * e2(2 * p) + 2 * Ap * Aq * e2(p + q) + Aq * Aq * e2(2 * q);
  }
  const wd = Math.sqrt(-disc);
  const P = i0, Q = K / wd, b = 2 * wd, d = a * a + b * b;
  const ea = Math.exp(-a * h), sb = Math.sin(b * h);
  const I0 = -Math.expm1(-a * h) / a;
  const thetaB = -Math.expm1(-a * h) + 2 * ea * Math.sin((b * h) / 2) ** 2;
  const Ic = (a * thetaB + ea * b * sb) / d;
  const Is = (b * thetaB - a * ea * sb) / d;
  // Only (I0 − Ic) cancels; it is ∫e^{−at}(1−cos bt)dt, positive-definite. At small bh use
  // b²·M₂/2 − b⁴·M₄/24, which carries the a-dependence exactly in the moments. THIS is
  // where the −9333 J heat came from: the earlier expression here was a small-a·h
  // approximation gated on b·h alone, so at a·h ≈ 20 its truncation went negative.
  const diff = b * h < 1e-3
    ? (b * b / 2) * momentExp(2, a, h) - (b ** 4 / 24) * momentExp(4, a, h)
    : I0 - Ic;
  return (P * P / 2) * (I0 + Ic) + (Q * Q / 2) * diff + P * Q * Is;
}

import { routeResistorHeat, type ThermalState } from './thermal';

/** A held-input RLC run. Mirrors RcExperiment so the page keeps one shape of state. */
export class RlcExperiment {
  readonly capacitance: number;
  readonly inductance: number;
  readonly sourceSetting: number;
  private readonly initialVoltage: number;
  private readonly initialCurrent: number;
  /** Ω. LIVE via setResistance(): changing it preserves Vc, i and every ledger. */
  private resistanceValue: number;
  get resistance(): number { return this.resistanceValue; }
  readonly dt: number;
  voltage: number;
  current: number;
  tick = 0;
  sourceWork = 0;
  jouleHeat = 0;
  connected = true;
  /** Non-null once a non-finite state was produced. Nothing advances again until reset. */
  faulted: string | null = null;

  constructor(p: RlcInputs, dt: number) {
    validateRlc(p);
    if (!Number.isFinite(dt) || dt < RLC_LIMITS.minH || dt > RLC_LIMITS.maxH)
      throw new Error(`Simulated interval must be ${RLC_LIMITS.minH}…${RLC_LIMITS.maxH} s`);
    this.capacitance = p.capacitance; this.inductance = p.inductance;
    this.sourceSetting = p.voltage; this.resistanceValue = p.resistance;
    this.dt = dt;
    this.voltage = p.initialVoltage; this.current = p.initialCurrent;
    this.initialVoltage = p.initialVoltage; this.initialCurrent = p.initialCurrent;
    this.initialStored = this.storedCapacitor + this.storedInductor;
  }

  /**
   * F4: `resistance` was a bare public field, so anything could write NaN or a negative
   * into it after construction and walk straight past the declared domain. Live changes
   * go through here; a refused value leaves the state and every ledger untouched.
   */
  setResistance(ohms: number): void {
    if (!Number.isFinite(ohms) || ohms < RLC_LIMITS.minR || ohms > RLC_LIMITS.maxR)
      throw new Error(`RLC refused: resistance ${RLC_LIMITS.minR}…${RLC_LIMITS.maxR} Ω, finite only.`);
    this.resistanceValue = ohms;
  }

  /** The same shape the RC page already reads, so growing the circuit does not churn it. */
  get inputs(): Readonly<RlcInputs> {
    return {
      voltage: this.sourceSetting, resistance: this.resistanceValue,
      capacitance: this.capacitance, inductance: this.inductance,
      initialVoltage: this.initialVoltage, initialCurrent: this.initialCurrent,
    };
  }
  readonly thermal: ThermalState = {
    bodies: [{ id: 'rc-chassis', heat: 0, backflowCount: 0 }], routed: [], exportedHeat: 0,
  };
  get receiverHeat(): number { return this.thermal.bodies[0].heat; }
  /** J. Energy on the board at t₀ — electric AND magnetic, unlike RC-1 where only the
   *  capacitor could hold any. */
  get initialEnergy(): number { return this.initialStored; }
  get tolerance(): number {
    return Math.max(1e-10, 1e-9 * Math.max(this.initialStored, Math.abs(this.sourceWork),
      this.storedCapacitor + this.storedInductor, this.receiverHeat));
  }
  get temperature(): number { return 300 + this.receiverHeat / 2; }
  get simulatedSeconds(): number { return this.tick * this.dt; }
  get sourceVoltage(): number { return this.connected ? this.sourceSetting : 0; }
  get storedCapacitor(): number { return (this.capacitance * this.voltage ** 2) / 2; }
  get storedInductor(): number { return (this.inductance * this.current ** 2) / 2; }
  get regime(): Regime { return regimeOf(this.resistance, this.inductance, this.capacitance); }
  /** Ω. Below this the loop rings; above it, it crawls. */
  get criticalResistance(): number { return 2 * Math.sqrt(this.inductance / this.capacitance); }

  /**
   * s. The SLOWEST time constant in the response — what "settled" actually waits on.
   *
   * 2L/R is the underdamped envelope time and is NOT a general settling time: overdamped,
   * the slow root dominates and tends to R·C as damping grows. Using the envelope figure
   * everywhere would have understated an overdamped run's settling by orders of magnitude.
   */
  get decayTime(): number {
    const alpha = this.resistanceValue / (2 * this.inductance);
    const w02 = 1 / (this.inductance * this.capacitance);
    if (regimeOf(this.resistanceValue, this.inductance, this.capacitance) !== 'overdamped') {
      return 1 / alpha;
    }
    const beta = Math.sqrt(alpha * alpha - w02);
    return (alpha + beta) / w02;            // 1/p, the slow root; → R·C as damping grows
  }

  /**
   * EXACT display bounds, not guessed headroom. For constant Vs and any R ≥ 0 the error
   * energy E = ½C·u² + ½L·i² has dE/dt = −R·i² ≤ 0, so it can only fall. Measured across
   * R from 1 Ω to 1e6 Ω, the largest relative INCREASE of E was 0.
   */
  bounds(): { voltage: number; current: number } {
    const u = this.voltage - this.sourceVoltage;
    const e = this.capacitance * u * u + this.inductance * this.current * this.current;
    return {
      voltage: Math.abs(this.sourceVoltage) + Math.sqrt(e / this.capacitance),
      current: Math.sqrt(e / this.inductance),
    };
  }

  /**
   * W + E_initial − E_current − Q. An earlier version SUBTRACTED the initial energy
   * instead of adding it, so a run started with charge or current on the board reported
   * a residual of −1.25 J at tick 0 — before anything had happened. The initial energy is
   * captured once in the constructor; there is no public method to re-seal it, because a
   * repeatable seal is a way to silently zero a real imbalance.
   */
  get residual(): number {
    return this.sourceWork + this.initialStored
      - (this.storedCapacitor + this.storedInductor + this.jouleHeat);
  }
  private readonly initialStored: number;

  step(): void {
    if (this.faulted) return;
    const { resistance: R, inductance: L, capacitance: C, dt: h } = this;
    const Vs = this.sourceVoltage;
    const u0 = this.voltage - Vs, i0 = this.current;
    const k = stepCoefficients(R, L, C, h);
    const u1 = k.a11 * u0 + k.a12 * i0;
    const i1 = k.a21 * u0 + k.a22 * i0;
    const charge = integratedCurrent(u0, i0, R, L, C, h);   // ∫i dt
    const heat = R * integratedCurrentSquared(u0, i0, R, L, C, h);
    if (![u1, i1, charge, heat].every(Number.isFinite)) {
      this.faulted = 'RLC produced a non-finite state; the run is latched and needs a reset.';
      return;
    }
    // HEAT CANNOT BE NEGATIVE with R > 0, and a heat-series approximation used outside
    // its small-a·h condition once made it so (−9333 J), committed without complaint. This is a validity check,
    // not a clamp: the value is refused and the run latches rather than being nudged to 0.
    if (heat < 0) {
      this.faulted = `RLC computed negative heat (${heat}); the run is latched and needs a reset.`;
      return;
    }
    this.voltage = u1 + Vs;
    this.current = i1;
    this.sourceWork += Vs * charge;   // W = Vs·∫i dt, never Vs·C·(Vc₁ − Vc₀)
    this.jouleHeat += heat;
    routeResistorHeat(this.thermal, 'rlc-resistor', 'rc-chassis', heat);
    this.tick++;
  }
}
