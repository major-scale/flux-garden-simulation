import Mathlib

/-!
# Electromechanical coupling — electromechanical v1 (bridge/ELECTROMECHANICAL-V1-PLAN.md)

The public composition motor (`src/model/spice/parts.ts`, `emitDcMotorPort`) and the motor page deck
(`src/model/spice/motor-netlist.ts`) share one shaft load (`src/model/spice/shaft-load.ts`): an ideal rigid rack on a pinion of
fixed radius r, reduced EXACTLY to the shaft coordinate (x = r·θ, v = r·ω, J_load = m·r², τ_g = m·g·r). This file proves
the algebra those model equations and the energy account rely on:

1. `conversion_power`: with τ = K_t·i, emf = K_e·ω and the ASSUMPTION K_e = K_t (the reciprocal ideal SI model, not a
   property of real motor materials), the electrical power the back-EMF absorbs equals the mechanical power the torque
   delivers: emf·i = τ·ω.
2. The rack port: `rack_port_power` (F·v = τ·ω when v = r·ω and F·r = τ), `reflected_kinetic` (the reflected inertia's
   kinetic energy IS the rack mass's), `kinetic_once` (J_eff = J + m·r² counts the rack's kinetic energy exactly once; adding
   ½·m·v² again would double count it) and `gravity_work` (the weight torque times θ is m·g times the height).
3. `balance_composition`: GIVEN an electrical balance and a mechanical balance whose transfer terms are equal (each an
   ASSUMED element balance, not derived here), the combined balance follows with the transfer cancelled. No sign condition
   is placed on any store: a discharging inductor or a slowing shaft may deliver power. `reversed_transfer_breaks`: if one
   side books the transfer with the opposite sign, the combined balance can only hold when nothing was transferred.

SCOPE. Algebra over reals (or any commutative ring / field where stated): no solver, no integration scheme, no proof that
ngspice realises these equations. The executable side — production functions and solved trajectories checked against these
identities, with a reversed-transfer deck and a wrong-radius / double-counted-mass account as counterexamples — is
`src/model/conformance/electromechanical-v1.test.ts`: correspondence evidence, not a refinement proof.

Compiled with the Lean worktree's existing toolchain (Lean 4.31.0, Mathlib v4.31.0) via `lake env lean`; no downloads.
-/

namespace FluxGarden.Electromechanical

/-- The conversion term seen from both ports is one quantity, under the reciprocal assumption K_e = K_t. -/
theorem conversion_power {R : Type*} [CommRing R] (Kt Ke i ω τ emf : R)
    (torque : τ = Kt * i) (backEmf : emf = Ke * ω) (reciprocal : Ke = Kt) :
    emf * i = τ * ω := by
  subst torque backEmf reciprocal
  ring

/-- The rack port: with the no-slip speed map v = r·ω and the force/torque relation F·r = τ, force times speed at the
rack equals torque times speed at the shaft. -/
theorem rack_port_power {R : Type*} [CommRing R] (r τ ω force v : R)
    (speed : v = r * ω) (lever : force * r = τ) :
    force * v = τ * ω := by
  subst speed
  rw [← lever]
  ring

/-- The kinetic energy of the reflected inertia m·r² at shaft speed ω is the rack mass's kinetic energy at v = r·ω. -/
theorem reflected_kinetic {F : Type*} [Field F] (m r ω v : F) (speed : v = r * ω) :
    (m * r ^ 2) * ω ^ 2 / 2 = m * v ^ 2 / 2 := by
  subst speed
  ring

/-- With J_eff = J + m·r², ½·J_eff·ω² is the rotor's plus the rack's kinetic energy — once. Adding ½·m·v² to it as well
would count the rack twice. -/
theorem kinetic_once {F : Type*} [Field F] (J m r ω v : F) (speed : v = r * ω) :
    (J + m * r ^ 2) * ω ^ 2 / 2 = J * ω ^ 2 / 2 + m * v ^ 2 / 2 := by
  subst speed
  ring

/-- The weight torque τ_g = m·g·r acting through θ does the work m·g·x, x = r·θ: the gravitational potential change. -/
theorem gravity_work {R : Type*} [CommRing R] (m g r θ x τg : R)
    (torque : τg = m * g * r) (height : x = r * θ) :
    τg * θ = m * g * x := by
  subst torque height
  ring

/-- Composition over an interval. Electrical element balance: input = winding heat + magnetic-store change + transfer.
Mechanical element balance: transfer = kinetic change + potential change + viscous loss + external load work − brake work.
Both are HYPOTHESES (assumed element balances); with equal transfer terms the combined balance follows. -/
theorem balance_composition {R : Type*} [CommRing R] (Ein QR dEL We Wm dK dU Qb Wext Wbrake : R)
    (electrical : Ein = QR + dEL + We)
    (mechanical : Wm = dK + dU + Qb + Wext - Wbrake)
    (transfer : We = Wm) :
    Ein = QR + dEL + dK + dU + Qb + Wext - Wbrake := by
  rw [electrical, transfer, mechanical]
  ring

/-- The counterexample: book the transfer with the opposite sign on one side, and the combined balance holds only if no
energy was transferred at all. -/
theorem reversed_transfer_breaks (Ein QR dEL We Wm dK dU Qb Wext Wbrake : ℝ)
    (electrical : Ein = QR + dEL + We)
    (mechanical : Wm = dK + dU + Qb + Wext - Wbrake)
    (reversed : We = -Wm)
    (combined : Ein = QR + dEL + dK + dU + Qb + Wext - Wbrake) :
    We = 0 := by
  linarith

end FluxGarden.Electromechanical

#print axioms FluxGarden.Electromechanical.conversion_power
#print axioms FluxGarden.Electromechanical.rack_port_power
#print axioms FluxGarden.Electromechanical.reflected_kinetic
#print axioms FluxGarden.Electromechanical.kinetic_once
#print axioms FluxGarden.Electromechanical.gravity_work
#print axioms FluxGarden.Electromechanical.balance_composition
#print axioms FluxGarden.Electromechanical.reversed_transfer_breaks
