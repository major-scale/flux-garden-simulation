/**
 * THE MOTOR, READ AND CHECKED — never modelled in the render path.
 *
 * Three things live here:
 *   1. `motorReference`: the ANALYTIC 3-state solution (i, ω, θ) of the coupled linear system
 *      for the two controls that admit it — switch closed at a fixed voltage, brake released
 *      (Lift it), or brake held (Locked shaft, a 1-state LR). It is the independent reference
 *      the solved trajectory is checked against on those presets. It does NOT apply once the
 *      switch opens: the freewheel diode makes the circuit piecewise-nonlinear, and that run is
 *      checked by native/WASM parity, KCL and the energy balance instead.
 *   2. `motorEnergy`: the interval balances, every term integrated from the SAME trajectory by
 *      the trapezoid rule, with residuals PRINTED rather than absorbed. Heat is R·∫i²dt.
 *   3. `motorDomain`: the supported domain against the trajectory — the shaft never runs
 *      backwards beyond tolerance (the generator regime is deferred, not entered).
 */
import type { MotorDescription } from './spice/motor-netlist';
import { effectiveInertia, loadTorque } from './spice/motor-netlist';
import type { MotorTransient } from './spice/motor-transient';

// ---------------------------------------------------------------- a small matrix exponential
type Mat = number[][];
const zeros = (n: number): Mat => Array.from({ length: n }, () => new Array<number>(n).fill(0));
const eye = (n: number): Mat => { const m = zeros(n); for (let k = 0; k < n; k++) m[k][k] = 1; return m; };
const mul = (a: Mat, b: Mat): Mat => { const n = a.length, m = zeros(n);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) { const aik = a[i][k]; if (aik === 0) continue; for (let j = 0; j < n; j++) m[i][j] += aik * b[k][j]; } return m; };
const add = (a: Mat, b: Mat, s = 1): Mat => a.map((r, i) => r.map((v, j) => v + s * b[i][j]));
const norm1 = (a: Mat): number => Math.max(...a[0].map((_, j) => a.reduce((s, r) => s + Math.abs(r[j]), 0)));

/**
 * e^{M} by scaling-and-squaring with a Taylor series run to convergence in double precision.
 * For the 4×4 augmented matrices here this is exact to rounding; it is a REFERENCE routine and
 * costs nothing that matters.
 */
export function expm(M: Mat): Mat {
  const n = M.length;
  let s = 0; let nrm = norm1(M);
  while (nrm > 0.5) { nrm /= 2; s++; }
  const A = M.map((r) => r.map((v) => v / 2 ** s));
  let term = eye(n), sum = eye(n);
  for (let k = 1; k < 60; k++) {
    term = mul(term, A).map((r) => r.map((v) => v / k));
    sum = add(sum, term);
    if (norm1(term) < 1e-18 * Math.max(norm1(sum), 1e-300)) break;
  }
  for (let k = 0; k < s; k++) sum = mul(sum, sum);
  return sum;
}

export interface ReferenceState { i: number; omega: number; theta: number }

/**
 * The coupled linear system with the switch closed (its R_on in series) at the supply voltage:
 *     L·di/dt = V − (R + R_on)·i − K·ω
 *     J_eff·dω/dt = K·i − b·ω − τ_load          (brake released)
 *     dθ/dt = ω
 * or, with the brake held, ω ≡ 0 and the first line alone. Affine, so it is integrated exactly
 * as e^{[A c; 0 0]·h} on the augmented state (i, ω, θ, 1). `from` is the state at `t0`.
 */
export function motorReference(c: MotorDescription, braked: boolean, from: ReferenceState, t0: number, t: number): ReferenceState {
  const m = c.motor;
  return coupledReference({ R: m.resistanceOhms + c.switch.rOnOhms, L: m.inductanceHenries, K: m.kVsPerRad,
    J: effectiveInertia(c), b: m.viscousNmS, tau: loadTorque(c), V: c.supplyVolts }, braked, from, t0, t);
}

/**
 * The same exact reference on plain parameters (electromechanical v1): total series resistance R (winding + switch), L, K,
 * shaft inertia J (rotor + reflected), viscous b, opposing load torque τ, supply V. The page's `motorReference` and the
 * kit's `motor-reference` check both call it, so there is one reference, not two.
 */
export interface CoupledParams { R: number; L: number; K: number; J: number; b: number; tau: number; V: number }
export function coupledReference(p: CoupledParams, braked: boolean, from: ReferenceState, t0: number, t: number): ReferenceState {
  const h = t - t0;
  if (h <= 0) return { ...from };
  const { R, L, K, J, b, V } = p, tl = p.tau;
  const A: Mat = braked
    ? [[-R / L, 0, 0, V / L], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
    : [[-R / L, -K / L, 0, V / L], [K / J, -b / J, 0, -tl / J], [0, 1, 0, 0], [0, 0, 0, 0]];
  const E = expm(A.map((r) => r.map((v) => v * h)));
  const x = [from.i, from.omega, from.theta, 1];
  const y = E.map((r) => r.reduce((s, v, j) => s + v * x[j], 0));
  return { i: y[0], omega: y[1], theta: y[2] };
}

/**
 * Where the analytic reference APPLIES on a described run: from the end of the switch-closing
 * edge (and brake-release edge, if any) until the switch begins to open, or the horizon. Null if
 * the switch never closes. Before the window the exact state is rest; the edges themselves are
 * finite ramps the reference does not model.
 */
export function referenceWindow(c: MotorDescription): { from: number; to: number; braked: boolean } | null {
  const p = c.programme;
  if (p.closeAtSeconds === null) return null;
  const braked = p.releaseBrakeAtSeconds === null;
  const from = Math.max(p.closeAtSeconds, p.releaseBrakeAtSeconds ?? 0) + p.edgeSeconds;
  const to = p.openAtSeconds ?? c.stopSeconds;
  return from < to ? { from, to, braked } : null;
}

/**
 * COASTING, after the freewheel current has died: i = 0, and the shaft is decelerated by the
 * load and the viscous term alone, `J_eff·dω/dt = −b·ω − τ_load`, whose solution is
 *     ω(t) = (ω0 + τ_load/b)·e^{−b(t−t0)/J} − τ_load/b        (b > 0)
 * This is the reference for the Switch-it-off tail — a supported interval, named, distinct from
 * the ~1 ms freewheel that precedes it (Astra: do not call the whole span freewheeling).
 */
export function coastingReference(c: MotorDescription, from: { omega: number; theta: number }, t0: number, t: number): { omega: number; theta: number } {
  const h = t - t0; if (h <= 0) return { ...from };
  const J = effectiveInertia(c), b = c.motor.viscousNmS, tl = loadTorque(c);
  if (b === 0) return { omega: from.omega - tl / J * h, theta: from.theta + from.omega * h - 0.5 * tl / J * h * h };
  const a = b / J, wInf = -tl / b, e = Math.exp(-a * h);
  const omega = wInf + (from.omega - wInf) * e;
  const theta = from.theta + wInf * h + (from.omega - wInf) * (1 - e) / a;
  return { omega, theta };
}

/** Where coasting is the reference: from a few electrical time constants after the switch opened. */
export function coastingWindow(c: MotorDescription): { from: number; to: number } | null {
  const p = c.programme;
  if (p.openAtSeconds === null || p.releaseBrakeAtSeconds === null) return null;
  const from = p.openAtSeconds + p.edgeSeconds + 8 * c.motor.inductanceHenries / c.motor.resistanceOhms;
  return from < c.stopSeconds ? { from, to: c.stopSeconds } : null;
}

// ---------------------------------------------------------------- energy
export interface MotorEnergy {
  times: Float64Array;
  /** J, cumulative from t = 0, one array per named term. */
  sourceWork: Float64Array;       // ∫ V_dd · i_src
  switchLoss: Float64Array;       // ∫ (V_dd − v_a) · i_src
  diodeLoss: Float64Array;        // ∫ (−v_a) · i_d   (anode at ground, cathode at the terminal)
  portInput: Float64Array;        // ∫ v_a · i_m       (motor terminal power)
  heat: Float64Array;             // R · ∫ i_m²
  magnetic: Float64Array;         // ½ L i_m²          (a state, not an integral)
  converted: Float64Array;        // ∫ K · ω · i_m     (the port's conversion term, both sides)
  kinetic: Float64Array;          // ½ J_eff ω²
  potential: Float64Array;        // m g r θ = m g h
  viscous: Float64Array;          // b · ∫ ω²
  brakeWork: Float64Array;        // ∫ τ_brake · ω, τ_brake the torque the brake APPLIES (≤ 0 resisting)
  /**
   * The three balances, as residuals, with the STORES AS DELTAS FROM t = 0: the operating point
   * is not exactly rest (the brake switch leaks ~5e-8 rad/s and the diode ~1e-8 A), so the
   * balance is between changes, not absolute energies. The displayed vessels stay absolute.
   * Printed, never absorbed.
   */
  portResidual: Float64Array;     // portInput − heat − Δmagnetic − converted
  loadResidual: Float64Array;     // converted − Δkinetic − potential − viscous + brakeWork
  sourceResidual: Float64Array;   // sourceWork − switchLoss − diodeLoss − portInput
}

export function motorEnergy(t: MotorTransient): MotorEnergy {
  const n = t.times.length, d = t.description, m = d.motor;
  const J = t.effectiveInertiaKgM2, tl = t.loadTorqueNm;
  const cum = (f: (k: number) => number): Float64Array => {
    const out = new Float64Array(n); let acc = 0, prev = f(0);
    for (let k = 1; k < n; k++) { const cur = f(k); acc += 0.5 * (prev + cur) * (t.times[k] - t.times[k - 1]); out[k] = acc; prev = cur; }
    return out;
  };
  const state = (f: (k: number) => number): Float64Array => { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = f(k); return out; };
  const sourceWork = cum((k) => t.supplyVolts[k] * t.sourceAmps[k]);
  const switchLoss = cum((k) => (t.supplyVolts[k] - t.terminalVolts[k]) * t.sourceAmps[k]);
  const diodeLoss = cum((k) => -t.terminalVolts[k] * t.diodeAmps[k]);
  const portInput = cum((k) => t.terminalVolts[k] * t.motorAmps[k]);
  const heat = cum((k) => m.resistanceOhms * t.motorAmps[k] * t.motorAmps[k]);
  const magnetic = state((k) => 0.5 * m.inductanceHenries * t.motorAmps[k] * t.motorAmps[k]);
  const converted = cum((k) => m.kVsPerRad * t.omegaRadPerS[k] * t.motorAmps[k]);
  const kinetic = state((k) => 0.5 * J * t.omegaRadPerS[k] * t.omegaRadPerS[k]);
  const potential = state((k) => tl * t.thetaRad[k]);
  const viscous = cum((k) => m.viscousNmS * t.omegaRadPerS[k] * t.omegaRadPerS[k]);
  const brakeWork = cum((k) => t.brakeTorqueNm[k] * t.omegaRadPerS[k]);
  const res = (f: (k: number) => number) => state(f);
  return {
    times: t.times, sourceWork, switchLoss, diodeLoss, portInput, heat, magnetic, converted, kinetic, potential, viscous, brakeWork,
    portResidual: res((k) => portInput[k] - heat[k] - (magnetic[k] - magnetic[0]) - converted[k]),
    loadResidual: res((k) => converted[k] - (kinetic[k] - kinetic[0]) - potential[k] - viscous[k] + brakeWork[k]),
    sourceResidual: res((k) => sourceWork[k] - switchLoss[k] - diodeLoss[k] - portInput[k]),
  };
}

// ---------------------------------------------------------------- domain
export interface MotorDomain {
  ok: boolean; reason: string | null;
  minOmega: number; minOmegaSwitchOpen: number; minMotorAmps: number;
  /** min of K·i·ω: negative means the machine was GENERATING at that instant (power out of the shaft). */
  minConversionWatts: number;
}

/**
 * THE SUPPORTED DOMAIN, against the trajectory: no reverse rotation with the switch open and no
 * reverse winding current — the guard is "unsupported reverse rotation / current", stated as
 * that, not as a definition of the generator regime. Whether the machine is motoring or
 * generating at an instant is the SIGN OF THE CONVERSION K·i·ω (positive: electrical → shaft;
 * negative: shaft → electrical), and that is reported as `minConversionWatts`. Two things are
 * reported rather than refused: the brief backward dip after the brake releases, with the
 * switch closed (measured −9e-3 rad/s for ~1 ms on Lift it — the rack sinks a fraction of a
 * millimetre before the motor catches it; during it K·i·ω is briefly negative), and the brake
 * switch's residual.
 */
export function motorDomain(t: MotorTransient, toleranceRadPerS = 1e-3, toleranceAmps = 1e-4): MotorDomain {
  let minOmega = Infinity, minOpen = Infinity, minI = Infinity, minConv = Infinity;
  const K = t.description.motor.kVsPerRad;
  for (let k = 0; k < t.times.length; k++) {
    const w = t.omegaRadPerS[k], i = t.motorAmps[k];
    if (w < minOmega) minOmega = w;
    if (t.switchClosed[k] === 0 && w < minOpen) minOpen = w;
    if (i < minI) minI = i;
    if (K * i * w < minConv) minConv = K * i * w;
  }
  if (minOpen === Infinity) minOpen = 0;
  const base = { minOmega, minOmegaSwitchOpen: minOpen, minMotorAmps: minI, minConversionWatts: minConv };
  if (minOpen < -toleranceRadPerS)
    return { ...base, ok: false, reason: `Not supported: reverse rotation with the switch open `
      + `(${(-minOpen).toPrecision(3)} rad/s) — outside this demonstration.` };
  if (minI < -toleranceAmps)
    return { ...base, ok: false, reason: `Not supported: reverse winding current (${(-minI).toPrecision(3)} A) — outside this demonstration.` };
  return { ...base, ok: true, reason: null };
}
