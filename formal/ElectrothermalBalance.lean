import Mathlib

/-!
# Electrothermal balance — electrothermal v1 (bridge/ELECTROTHERMAL-V1-PLAN.md)

The thermal layer (`src/model/thermal-lumped.ts`) takes solved loss powers from the conformance kit's energy account and heats
lumped bodies obeying C·dT/dt = P − G·(T − T_a). This file proves the algebra that layer and its composite balance rely on:

* `interval_books_close`: for ONE update interval of the form the code uses — T₁ = T_eq + (T₀ − T_eq)·e and ambient transfer
  Q = C·(T₀ − T_eq)·(1 − e) + P·Δt — storage change plus ambient transfer equals the input P·Δt, for ANY decay factor e. So the
  thermal books close by construction; this says nothing about how accurately e = exp(−G·Δt/C) is computed or about the
  piecewise-constant reconstruction of sampled power.
* `steady_state` / `equilibrium_unique`: for G ≠ 0, the steady state is T = T_a + P/G, and it is the only one.
* `routed_loss_cancels`: GIVEN the electromechanical account (delivered = stores + routed loss + unrouted loss + external work
  + numerical residual) and the thermal books (routed loss = thermal storage + ambient transfer) as HYPOTHESES, the composite
  balance follows with the routed loss cancelled internally and only the ambient transfer left at the boundary.
  `duplicate_booking_breaks`: booking the routed loss again as outgoing is consistent only if nothing was routed.
* `joule_nonneg`, `viscous_nonneg`: R·i² ≥ 0 and b·ω² ≥ 0 under R ≥ 0, b ≥ 0 — parameter assumptions, not material facts.
* `ambient_flow_sign`: with G ≥ 0, a body hotter than ambient gives heat to it and a colder one receives heat.

No store is required to have non-negative power. SCOPE: algebra over rings/fields; no proof about ngspice, the integration
accuracy or any material. The executable side — production adapters with sign, unit and double-count negatives — is
`src/model/thermal-lumped.test.ts`: correspondence evidence, not a refinement proof.
-/

namespace FluxGarden.Electrothermal

theorem interval_books_close {R : Type*} [CommRing R] (C T0 T1 Teq e P dt Q : R)
    (update : T1 = Teq + (T0 - Teq) * e)
    (ambient : Q = C * (T0 - Teq) * (1 - e) + P * dt) :
    C * (T1 - T0) + Q = P * dt := by
  subst update ambient
  ring

theorem steady_state {F : Type*} [Field F] (G P T Ta : F) (hG : G ≠ 0) (h : T = Ta + P / G) :
    G * (T - Ta) = P := by
  rw [h]
  field_simp <;> ring

theorem equilibrium_unique {F : Type*} [Field F] (G P T Ta : F) (hG : G ≠ 0) (h : P = G * (T - Ta)) :
    T = Ta + P / G := by
  rw [h]
  field_simp <;> ring

theorem routed_loss_cancels {R : Type*} [CommRing R] (E S Lr Lu X res Qs Qa : R)
    (electromechanical : E = S + Lr + Lu + X + res)
    (thermalBooks : Lr = Qs + Qa) :
    E = S + Qs + Qa + Lu + X + res := by
  rw [electromechanical, thermalBooks]
  ring

theorem duplicate_booking_breaks (E S Lr Lu X res Qs Qa : ℝ)
    (electromechanical : E = S + Lr + Lu + X + res)
    (thermalBooks : Lr = Qs + Qa)
    (duplicated : E = S + Qs + Qa + Lr + Lu + X + res) :
    Lr = 0 := by
  linarith

theorem joule_nonneg (R i : ℝ) (hR : 0 ≤ R) : 0 ≤ R * i ^ 2 := by positivity

theorem viscous_nonneg (b ω : ℝ) (hb : 0 ≤ b) : 0 ≤ b * ω ^ 2 := by positivity

theorem ambient_flow_sign (G T Ta : ℝ) (hG : 0 ≤ G) :
    (Ta ≤ T → 0 ≤ G * (T - Ta)) ∧ (T ≤ Ta → G * (T - Ta) ≤ 0) := by
  constructor
  · intro h
    exact mul_nonneg hG (by linarith)
  · intro h
    nlinarith

end FluxGarden.Electrothermal

#print axioms FluxGarden.Electrothermal.interval_books_close
#print axioms FluxGarden.Electrothermal.steady_state
#print axioms FluxGarden.Electrothermal.equilibrium_unique
#print axioms FluxGarden.Electrothermal.routed_loss_cancels
#print axioms FluxGarden.Electrothermal.duplicate_booking_breaks
#print axioms FluxGarden.Electrothermal.joule_nonneg
#print axioms FluxGarden.Electrothermal.viscous_nonneg
#print axioms FluxGarden.Electrothermal.ambient_flow_sign
