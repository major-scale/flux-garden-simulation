/**
 * DM1 — THE HAND.
 *
 * ===========================================================================
 * THE HAND IS AN EXTERNAL, POWERED COMPLIANT ACTUATOR.
 * IT IS **NOT** ANOTHER PASSIVE SPRING INSIDE THE WORLD'S ENERGY BOUNDARY.
 * ===========================================================================
 *
 * The world's energy boundary encloses the rigid bodies, their contacts, and the
 * four PASSIVE springs of the construction. The hand sits OUTSIDE it and pushes
 * across it, exactly as a motor bolted to a workbench would. Everything below
 * follows from that one decision:
 *
 *   - Its force is applied at the BODY-LOCAL GRAB POINT, converted to world
 *     coordinates and RE-EVALUATED BEFORE EVERY INTERNAL SUB-STEP, like every
 *     other force this build owns.
 *   - Its work is booked as SIGNED EXTERNAL WORK `W_hand`, a fourth term in the
 *     energy identity:
 *         UNATTRIBUTED = E_mech(t) − E_mech(0) − interventions − W_hand + D_owned
 *   - `W_hand` is NOT a frozen-edit intervention ΔE. Grab begin / move / end move
 *     nothing, so their frozen ΔE is identically zero, and they are deliberately
 *     routed AROUND `SimWorld.intervene`.
 *   - `W_hand` is NOT owned dissipation. The `−C·v` term in the law below is
 *     EXTERNAL HAND WORK — it is NOT heat in the body and never reaches
 *     `dissipatedDrag` or `dissipatedSpringDamper`.
 *   - NO virtual hand-spring potential is added to mechanical energy. Under this
 *     boundary there is no moving-anchor work term and no attachment/removal
 *     potential change to account for, which is exactly why this boundary was
 *     chosen. (Put the spring INSIDE the boundary and both of those become
 *     mandatory; that accounting is out of this slice.)
 *
 * THE DECLARED NUMERICAL ESTIMATOR for W_hand is the one this build already uses
 * for drag and the spring damper, for the same reason: the force is held CONSTANT
 * across a sub-step, so
 *
 *      W_sub = F_hand · ( x_grab(end of sub-step) − x_grab(start of sub-step) )
 *
 * is EXACT given that force. The whole approximation is the first-order
 * (start-of-sub-step) evaluation of a state-dependent force. `x_grab` is the
 * world position of the MATERIAL POINT OF THE BODY the force acts at — not the
 * centre of mass, and not the target.
 *
 * ===========================================================================
 * GAINS AND CAP — NOMINAL VALUES FIXED, CHOSEN BEFORE ANY TEST WAS RUN.
 * ===========================================================================
 * See EXPECTATIONS-DM1.md §1 (sha256 b2683f59…), written and stamped first.
 *
 * THE NOMINAL GAINS AND CAP ARE FIXED; THEY ARE REDUCED FOR NUMERICAL
 * RESOLUTION WHEN THE EFFECTIVE MASS IS LOW. There is no third rule, and the
 * reduction is not a mass-proportional gain schedule dressed up: above
 * `minEffectiveMass` — which is where every preset body of this construction
 * sits — the nominal values are used unchanged, and the response really does
 * differ from body to body. Below it, `gainsFor` scales BOTH gains AND the cap
 * by `m_eff/m_min` so the sub-step map stays inside the declared controller
 * margin; that is CONTROLLER behaviour, surfaced as such, and never a claim
 * that the body's physics changed.
 *
 * So this build DOES claim that, in the supported regime, a heavier or more
 * strongly spring-loaded body lags further behind the pointer, needs more hand
 * force, and can drive the hand into its cap — and it does NOT claim the hand
 * feels the same on every body. What it does NOT claim is that the effective
 * gains are literally constant everywhere: below the resolution floor they are
 * not, the live values are displayed while a body is held, and the guard is
 * RE-EVALUATED whenever the held body's mass or inertia changes
 * (`SimWorld.refreshHandGains`), not only when the gesture begins.
 */

import {
  qinvrot, qmul, qrot, vadd, vcross, vdot, vlen, vscale, vsub,
  type Quat, type Vec3,
} from '../model/units';

// ---------------------------------------------------------------------------
// The chosen constants. Fixed. Mass-independent.
// ---------------------------------------------------------------------------

export const HAND = {
  /**
   * N/m. NOMINAL positional gain. Fixed, and the same for every body in the
   * supported regime — NOT scheduled on mass. It is reduced (together with `C`
   * and `F_MAX`, by the same factor) only when the effective mass falls below
   * `minEffectiveMass`, purely for numerical resolution. See `gainsFor`.
   */
  K: 600,
  /**
   * N·s/m. NOMINAL velocity gain, on the ABSOLUTE grab-point velocity (target
   * velocity taken as 0). Fixed; reduced with `K` and `F_MAX` below the
   * resolution floor, never otherwise.
   */
  C: 24,
  /**
   * N. NOMINAL hard cap on |F_hand|. A clamp, never a soft blend. Fixed;
   * reduced with `K` and `C` below the resolution floor, never otherwise.
   */
  F_MAX: 400,
  /**
   * DECLARED CONTROLLER STABILITY MARGIN — NOT the spring `RESOLVABILITY` limit.
   *
   * The hand is a CONTROLLER. This build reports no physical decay rate for it,
   * so the slice-one accuracy bound `gamma·h <= 0.05` (which exists to bound the
   * error of a REPORTED physical spring decay rate) does not apply, and is NOT
   * weakened by one digit.
   *
   * What applies is stability of the same semi-implicit sub-step map
   *     v' = v + h(K(x*−x) − C v)/m ,  x' = x + h v'
   * whose characteristic polynomial λ² − (2 − hγ − h²ω²)λ + (1 − hγ) satisfies
   * Jury's conditions exactly when
   *     hγ < 2      and      h²ω² + 2hγ < 4 .
   * The margin below gives h²ω² + 2hγ <= 1.25 against a boundary of 4 (3.2×) and
   * hγ <= 0.5 against 2 (4×).
   */
  MAX_OMEGA_H: 0.5,
  MAX_GAMMA_H: 0.5,
  /** Bounded diagnostic history: one row per PUBLIC TICK, never per sub-step. */
  TICK_HISTORY: 180,
  /** Bounded per-gesture totals. */
  GESTURE_HISTORY: 8,
} as const;

/** rad/s and s⁻¹ at the internal sub-step h. */
export const handMaxOmega = (hSub: number): number => HAND.MAX_OMEGA_H / hSub;
export const handMaxGamma = (hSub: number): number => HAND.MAX_GAMMA_H / hSub;

/**
 * kg. The smallest effective mass the guard will drive at full gain.
 * `gamma = C/m_eff <= gamma_max` is the BINDING condition; the stiffness
 * condition `m_eff >= K/omega_max²` is weaker by 4.8× and never binds.
 */
export function minEffectiveMass(hSub: number): number {
  return Math.max(HAND.C / handMaxGamma(hSub), HAND.K / (handMaxOmega(hSub) ** 2));
}

// ---------------------------------------------------------------------------
// Effective mass, INCLUDING ROTATIONAL INERTIA — the quantity the ticket names.
// ---------------------------------------------------------------------------

/** Rigid-body inertia data, read from the engine but used through our own algebra. */
export interface InertiaFrame {
  mass: number;              // kg
  principal: Vec3;           // kg·m², diagonal in the principal frame
  qWorldFromPrincipal: Quat; // body rotation * principal-frame rotation
}

export function inertiaFrame(
  mass: number, rotation: Quat, principalLocalFrame: Quat, principal: Vec3,
): InertiaFrame {
  return { mass, principal, qWorldFromPrincipal: qmul(rotation, principalLocalFrame) };
}

/** I_world⁻¹ · x, without ever forming the 3×3 matrix. */
export function applyInvInertia(f: InertiaFrame, x: Vec3): Vec3 {
  const p = qinvrot(f.qWorldFromPrincipal, x);
  const i = f.principal;
  return qrot(f.qWorldFromPrincipal, {
    x: i.x > 0 ? p.x / i.x : 0,
    y: i.y > 0 ? p.y / i.y : 0,
    z: i.z > 0 ? p.z / i.z : 0,
  });
}

/**
 * The offset effective response along a unit direction `n`, EXACTLY as the ticket
 * writes it:
 *      1/m_eff(n) = 1/m + (r × n)ᵀ · I_world⁻¹ · (r × n)
 * `r` is the grab point relative to the CENTRE OF MASS.
 */
export function inverseEffectiveMass(f: InertiaFrame, r: Vec3, n: Vec3): number {
  const q = vcross(r, n);
  return 1 / f.mass + vdot(q, applyInvInertia(f, q));
}

/**
 * kg. The DIRECTION-INDEPENDENT conservative bound on m_eff, evaluated ONCE at
 * grab time. `n` swings around during a gesture, so the guard may not depend on
 * it. Using |r×n| <= |r| and qᵀI⁻¹q <= |q|²/I_min:
 *      1/m_eff_min = 1/m + |r|² / I_min
 * which is a lower bound on m_eff(n) over every direction n.
 */
export function effectiveMassBound(f: InertiaFrame, r: Vec3): number {
  const iMin = Math.min(f.principal.x, f.principal.y, f.principal.z);
  const r2 = vdot(r, r);
  const inv = 1 / f.mass + (iMin > 0 ? r2 / iMin : 0);
  return 1 / inv;
}

/**
 * THE GAIN GUARD — surfaced as CONTROLLER BEHAVIOUR, never as a material change.
 *
 * If the conservative m_eff bound falls below what the declared controller margin
 * resolves, BOTH gains and the cap are scaled by the same factor s. Scaling both
 * pins gamma exactly at its limit, leaves omega_n well inside it, and holds the
 * damping ratio constant at zeta = C/(2·sqrt(K·m_min)) = 1.0954 — so the reduced
 * hand is still well damped, just gentler.
 */
export interface HandGains { kP: number; kD: number; fMax: number; gainScale: number; }

export function gainsFor(mEffBound: number, hSub: number): HandGains {
  const mMin = minEffectiveMass(hSub);
  const s = mEffBound >= mMin ? 1 : Math.max(1e-6, mEffBound / mMin);
  return { kP: HAND.K * s, kD: HAND.C * s, fMax: HAND.F_MAX * s, gainScale: s };
}

/** The sentence the UI must show when the guard has fired. It is not about mass. */
export function gainReductionNote(g: HandGains): string | null {
  if (g.gainScale >= 1) return null;
  return `controller gains reduced ×${g.gainScale.toFixed(3)} for numerical resolution `
    + `— a CONTROLLER behaviour, not a change of this body's physics `
    + `(K ${g.kP.toFixed(1)} N/m, C ${g.kD.toFixed(2)} N·s/m, cap ${g.fMax.toFixed(0)} N)`;
}

// ---------------------------------------------------------------------------
// The force law
// ---------------------------------------------------------------------------

export interface HandForce { force: Vec3; raw: number; saturated: boolean; }

/**
 *      F_raw  = kP·(p* − p) − kD·v
 *      F_hand = F_raw, clamped to |F| <= fMax
 *
 * ONE POINT ATTACHMENT, NO ANGULAR CONTROLLER. Whatever torque appears is
 * `r × F` and nothing else.
 */
export function handForce(g: HandGains, p: Vec3, v: Vec3, target: Vec3): HandForce {
  const raw = vsub(vscale(vsub(target, p), g.kP), vscale(v, g.kD));
  const m = vlen(raw);
  if (m <= g.fMax || m === 0) return { force: raw, raw: m, saturated: false };
  return { force: vscale(raw, g.fMax / m), raw: m, saturated: true };
}

// ---------------------------------------------------------------------------
// Hand state — TRANSIENT. It is part of the SOLVER CHECKPOINT and part of the
// declared replay state. It is NEVER part of an authored Construction.
// ---------------------------------------------------------------------------

export interface HandState {
  active: boolean;
  /** Grabbed entity id, or '' when inactive. */
  entityId: string;
  /** BODY-LOCAL attachment point. The force is applied here, not at the com. */
  localPoint: Vec3;
  /** Resolved WORLD-SPACE target. No screen coordinate ever reaches the sim. */
  target: Vec3;
  /** Effective controller parameters, AFTER the guard. */
  kP: number; kD: number; fMax: number; gainScale: number;
  /** kg, the conservative bound the guard was decided on. */
  mEffBound: number;
  /** Monotonic gesture counter; survives release so gestures are distinguishable. */
  gestureId: number;
  /** J, signed external work done by the hand SINCE THIS GESTURE BEGAN. */
  gestureWork: number;
  /** Public ticks the current gesture has spanned. */
  gestureTicks: number;
  /** N, largest |F_hand| seen this gesture. */
  gesturePeakForce: number;
  /**
   * J. The DERIVED first-order accounting residual of the scheme,
   *      −½ Σ_substeps h²( |F|²/m + τᵀI⁻¹τ ),
   * accumulated since the gesture began. A PREDICTION OF NUMERICAL RESIDUAL —
   * never a claim that it is heat. See EXPECTATIONS-DM1.md §2.3.1.
   */
  gestureResidualPrediction: number;
  /** N, |F_hand| applied on the last sub-step. Display. */
  lastForce: number;
  /** Whether the last sub-step saturated the cap. Display. */
  lastSaturated: boolean;
}

export function newHandState(): HandState {
  return {
    active: false, entityId: '', localPoint: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 },
    kP: HAND.K, kD: HAND.C, fMax: HAND.F_MAX, gainScale: 1, mEffBound: 0,
    gestureId: 0, gestureWork: 0, gestureTicks: 0, gesturePeakForce: 0,
    gestureResidualPrediction: 0, lastForce: 0, lastSaturated: false,
  };
}

export function cloneHandState(h: HandState): HandState {
  return { ...h, localPoint: { ...h.localPoint }, target: { ...h.target } };
}

/** BOUNDED diagnostic row — one per PUBLIC TICK. Never one per sub-step. */
export interface HandTickRow { tick: number; forceN: number; workJ: number; saturated: boolean; }
/** BOUNDED per-gesture total. */
export interface HandGestureRow {
  gestureId: number; entityId: string; ticks: number;
  workJ: number; peakForceN: number; gainScale: number;
}

export function pushBounded<T>(buf: T[], row: T, cap: number): void {
  buf.push(row);
  while (buf.length > cap) buf.shift();
}

// ---------------------------------------------------------------------------
// DETERMINISTIC POINTER RESAMPLING  (criterion 3)
// ---------------------------------------------------------------------------

/**
 * Pointer motion arrives at DISPLAY rate and must not reach the simulation at
 * display rate. This resampler holds only the LATEST RESOLVED WORLD-SPACE target
 * and hands out AT MOST ONE sample per simulation tick, and none at all when the
 * target has not changed.
 *
 * So the recorded event stream depends only on the per-tick target values — never
 * on how many raw pointer events happened to land inside a tick (0, 1 or 20), and
 * never on the frame rate. Raw screen pixels, the drag plane and the camera live
 * on the far side of this boundary and cannot reach replay.
 */
export class PointerResampler {
  private latest: Vec3 | null = null;
  private lastSampled: Vec3 | null = null;

  /** Called from pointermove, at display rate. Stores; does not emit. */
  setRawTarget(p: Vec3): void { this.latest = { ...p }; }
  /** The pending, not-yet-sampled target, for drawing only. */
  get pending(): Vec3 | null { return this.latest ? { ...this.latest } : null; }

  /** Called once at the start of each simulation tick. Returns a target, or null. */
  sample(): Vec3 | null {
    if (!this.latest) return null;
    const l = this.lastSampled;
    if (l && l.x === this.latest.x && l.y === this.latest.y && l.z === this.latest.z) return null;
    this.lastSampled = { ...this.latest };
    return { ...this.lastSampled };
  }

  /** A new gesture: the first target is established by grabBegin, not by a move. */
  begin(target: Vec3): void { this.latest = { ...target }; this.lastSampled = { ...target }; }
  end(): void { this.latest = null; this.lastSampled = null; }
}

export { vadd, vsub, vscale, vlen, vdot, vcross };
