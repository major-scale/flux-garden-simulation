/**
 * FP1 — energy reporting. DELIBERATELY INCOMPLETE. Do not "fix" it.
 *
 * ===========================================================================
 * WE DO NOT PROMISE A CLOSED HEAT ACCOUNT IN THIS SLICE.  (plan §3)
 * ===========================================================================
 *
 * A net mechanical-energy difference does not identify friction, restitution,
 * spring damping, constraint stabilization and integration error separately, and
 * a contact force alone does not supply frictional work. So we report four
 * things and leave the rest explicitly unallocated:
 *
 *  1. RESOLVED MECHANICAL ENERGY  E_mech
 *        translational KE + ROTATIONAL KE + gravitational PE + DECLARED spring
 *        potential (½·k·x², elastic term only).
 *
 *  2. EXPLICIT INTERVENTION CHANGES  E_interventions
 *        every push, mass edit, stiffness edit, add and remove, measured as
 *        E_mech(immediately after) - E_mech(immediately before) with the world
 *        frozen across the edit, and attributed to that intervention by id.
 *
 *  3. OWNED DISSIPATION  D_owned
 *        independently computed estimates of the dissipative mechanisms THIS
 *        APPLICATION OWNS, i.e. the ones whose force law we ourselves evaluate
 *        and hand to the engine:
 *          D_drag         from the still-air quadratic drag law
 *          D_springDamper from the linear damper term of our own spring law
 *        Both under the STATED APPROXIMATION below.
 *
 *  4. SIGNED EXTERNAL HAND WORK  W_hand                       (DM1, slice two)
 *        The hand is an EXTERNAL, POWERED COMPLIANT ACTUATOR sitting OUTSIDE
 *        the world's energy boundary — not another passive spring inside it.
 *        Its work therefore crosses the boundary and is a SOURCE TERM, not a
 *        dissipation channel and not a frozen-edit intervention. Positive means
 *        the hand ADDED energy to the world. The damping term in its force law
 *        is EXTERNAL HAND WORK, NOT heat in the body. No hand-spring potential
 *        is added to E_mech: under this boundary there is none. See sim/hand.ts.
 *
 *  5. UNATTRIBUTED  = E_mech(t) - E_mech(0) - E_interventions - W_hand + D_owned
 *
 *     UNATTRIBUTED IS NOT NUMERICAL ERROR AND IS NOT PHYSICAL HEAT.
 *     It is an OBSERVATION LIMIT of this slice. It contains, undifferentiated:
 *       - contact friction work
 *       - restitution loss
 *       - JOINT CONSTRAINT WORK. Hinge and slider constraints are resolved by
 *         Rapier's impulse solver. An ideal holonomic constraint does no work;
 *         a solved-by-impulses one does a little, from position stabilization
 *         and the finite step. NO EXACT DECOMPOSITION OF IT IS PROMISED, it is
 *         not estimated, and it is NEVER turned into heat. It stays here.
 *       - constraint / penetration stabilization work done by the solver
 *       - integration error of the fixed-step scheme
 *       - the error in our own owned-dissipation estimators
 *       - the first-order accounting residual of the hand's own work estimator
 *         (derived in EXPECTATIONS-DM1.md 2.3.1; predicted, still NOT heat)
 *     Contact, restitution and joint dissipation REMAIN UNALLOCATED. No estimator
 *     for them is claimed here. The standing prohibition holds: numerical loss is
 *     never relabelled physical heat.
 *
 * ---------------------------------------------------------------------------
 * THE STATED INTEGRATION APPROXIMATION FOR OWNED DISSIPATION
 * ---------------------------------------------------------------------------
 * Our force laws are evaluated ONCE PER INTERNAL SUB-STEP, from the state at the
 * START of that sub-step, and the resulting force is held CONSTANT across it. One
 * public 1/60 s tick is SI.SUBSTEPS such sub-steps, and the engine's own
 * sub-division is pinned to 1, so the engine sees exactly that constant force for
 * exactly the interval we assumed.
 *
 * (Before the FP1 return this evaluation happened once per TICK and Rapier then
 * held it across four internal sub-steps of its own. That froze the elastic term
 * across the sub-steps and injected 0.375·dt²·omega² into the one-tick
 * determinant, cancelling about half the physical damping — D-1 in DEVIATIONS.md.
 * The record of that failure stands; the integration is what changed.)
 *
 * Given that the force is constant over the sub-step, the work it does is EXACT:
 *        W = F · (x_end - x_start)
 * where x is the world position of the material point the force is applied at
 * (the centre of mass for drag; the spring's attachment point for the damper).
 * We read x_start and x_end from the engine and take that dot product, and sum
 * over the sub-steps of the tick.
 *
 * So the approximation is ENTIRELY IN THE FORCE EVALUATION — a first-order
 * explicit (start-of-sub-step) evaluation of a velocity-dependent force — and NOT
 * in the work integral. The residual error of that evaluation is O(h) per
 * sub-step and lands in UNATTRIBUTED, where it belongs, rather than being hidden
 * inside the dissipation figure it would corrupt.
 *
 * Dissipation is reported as a POSITIVE number equal to -W for W <= 0. If a tick
 * ever yields W > 0 for a dissipative channel (possible when the explicit force
 * evaluation lags a fast reversal), we do NOT clamp it to zero: the signed value
 * is accumulated, and the count of such ticks is reported as
 * `nonDissipativeTicks` so the anomaly is visible instead of swallowed.
 */

import type { Quat, Vec3 } from './units';
import { qconj, qmul, qinvrot, vdot } from './units';

export interface BodyEnergy {
  id: string;
  kineticTranslational: number;  // J
  kineticRotational: number;     // J
  gravitationalPotential: number; // J
}

export interface MechanicalEnergy {
  /** J. Sum over dynamic bodies of ½m|v|². */
  keTranslational: number;
  /** J. Sum over dynamic bodies of ½·omega·I_world·omega. */
  keRotational: number;
  /** J. Sum over dynamic bodies of m·g·(y_com - datum). */
  gravitationalPotential: number;
  /** J. Sum over springs of ½·k·x². The DECLARED spring potential (elastic only). */
  springPotential: number;
  /** J. The sum of the four above. */
  total: number;
  perBody: BodyEnergy[];
}

export function emptyMechanicalEnergy(): MechanicalEnergy {
  return {
    keTranslational: 0, keRotational: 0, gravitationalPotential: 0,
    springPotential: 0, total: 0, perBody: [],
  };
}

/**
 * ½·omega·I_world·omega, computed in the body's PRINCIPAL frame so that the
 * diagonal principal inertia can be used directly.
 *   q_worldFromPrincipal = q_body * q_principalInLocal
 *   omega_principal      = q_worldFromPrincipal^-1 * omega_world
 *   KE                   = ½ · sum_i I_i · omega_principal_i²
 */
export function rotationalKE(
  omegaWorld: Vec3,
  bodyRotation: Quat,
  principalInertiaLocalFrame: Quat,
  principalInertia: Vec3,
): number {
  const qWP = qmul(bodyRotation, principalInertiaLocalFrame);
  const w = qinvrot(qWP, omegaWorld);
  return 0.5 * (principalInertia.x * w.x * w.x + principalInertia.y * w.y * w.y + principalInertia.z * w.z * w.z);
}

/** Declared elastic potential of one spring: ½·k·x², x = L - restLength. */
export function springPotential(stiffness: number, extension: number): number {
  return 0.5 * stiffness * extension * extension;
}

/**
 * GRAVITATIONAL POTENTIAL ENERGY, WITH ITS REFERENCE STATED IN THE FORMULA.
 *
 *      U_grav = -m (g . r)      with the DATUM at the world origin
 *
 * For the usual g = (0, -9.81, 0) this is the familiar m*9.81*y with datum
 * y = 0 (`GRAVITY_PE_DATUM_Y`, units.ts). It is written in this general form
 * because THE BUILD NOW LETS THE USER EDIT GRAVITY, and the whole point of an
 * explicit reference is that it must not move when g does:
 *
 *   - THE DATUM IS THE WORLD ORIGIN AND IT DOES NOT CHANGE WHEN g CHANGES.
 *     A datum that followed g would make the energy books unfalsifiable.
 *   - Changing g therefore CHANGES U_grav INSTANTANEOUSLY, by
 *     -m ((g_new - g_old) . r) summed over dynamic bodies. That change is real
 *     under this declared reference and it is booked as the EXPLICIT
 *     INTERVENTION that caused it (`SimWorld.intervene`), with the world frozen
 *     across the edit — exactly like a mass or stiffness edit. It is NOT drift,
 *     NOT dissipation, and it does NOT land in UNATTRIBUTED.
 *   - U is not "re-zeroed" after a gravity edit. Re-zeroing would hide the
 *     change instead of accounting for it.
 */
export function gravitationalPotential(mass: number, g: Vec3, comWorld: Vec3): number {
  return -mass * vdot(g, comWorld);
}

export interface InterventionRecord {
  /** Simulation tick at which it was applied. */
  tick: number;
  /** Deterministic within-tick sequence number. */
  seq: number;
  kind: 'push' | 'setMass' | 'setStiffness' | 'addBlock' | 'removeBlock' | 'setEnvironment'
    | 'setDamping' | 'setGravity';
  target: string;
  /** J. E_mech(after) - E_mech(before), the world frozen across the edit. */
  deltaEmech: number;
  detail: string;
}

/** The running, deliberately incomplete budget. */
export interface EnergyBudget {
  /** J. E_mech at the reference instant (tick 0, or the last explicit reset). */
  baselineTotal: number;
  /** J. Current resolved mechanical energy. */
  current: MechanicalEnergy;
  /** J. Sum of deltaEmech over all interventions since the baseline. */
  interventionsTotal: number;
  /** J. Positive = energy removed by our own drag law. */
  dissipatedDrag: number;
  /** J. Positive = energy removed by our own spring damper term. */
  dissipatedSpringDamper: number;
  /**
   * J. SIGNED external work done on the world by the hand actuator since the
   * baseline. POSITIVE = the hand added energy. This is NOT dissipation, NOT an
   * intervention ΔE, and NOT heat. It is work crossing the energy boundary from
   * a powered actuator that is deliberately modelled OUTSIDE it.
   */
  handWorkExternal: number;
  /** Ticks in which an owned dissipation channel did net POSITIVE work. Reported, not hidden. */
  nonDissipativeTicks: number;
  /**
   * J. E_mech(t) - E_mech(0) - interventions - handWorkExternal + ownedDissipation.
   * NOT numerical error. NOT physical heat. See the header.
   */
  unattributed: number;
  interventions: InterventionRecord[];
}

export function newEnergyBudget(): EnergyBudget {
  return {
    baselineTotal: 0,
    current: emptyMechanicalEnergy(),
    interventionsTotal: 0,
    dissipatedDrag: 0,
    dissipatedSpringDamper: 0,
    handWorkExternal: 0,
    nonDissipativeTicks: 0,
    unattributed: 0,
    interventions: [],
  };
}

/** The one place the identity is evaluated. */
export function recomputeUnattributed(b: EnergyBudget): void {
  const owned = b.dissipatedDrag + b.dissipatedSpringDamper;
  b.unattributed = b.current.total - b.baselineTotal - b.interventionsTotal
    - b.handWorkExternal + owned;
}

/** Work done by a constant force F over a displacement d of its point of application. */
export function constantForceWork(F: Vec3, d: Vec3): number {
  return vdot(F, d);
}

export { qconj };
