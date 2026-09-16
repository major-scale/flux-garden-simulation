import Mathlib

/-!
# Thermal network — thermal network v1 (bridge/THERMAL-NETWORK-V1-PLAN.md)

`src/model/thermal-lumped.ts` joins lumped bodies through links: link `l` from body `a l` to body `b l` carries power
G·(T_a − T_b), positive from a to b, and its integrated transfer `F l` is booked ONCE — `+F l` into a's net outflow and `−F l`
into b's. This file proves the algebra that booking and the network balance rely on:

* `link_power_antisymm`, `hot_to_cold`: the reporting orientation only changes the sign; with G ≥ 0 heat goes hot → cold.
* `two_body_capacity_weighted`: an equal-and-opposite transfer leaves C1·T1 + C2·T2 unchanged; `positive_link_steady`: a
  positive link carries nothing only between equal temperatures.
* `orientation_reversal`: reversing a link AND negating its transfer leaves every body's booking unchanged;
  `swapped_booking_negates`: booking the ends the wrong way round negates each body's booking (the sum cannot see it).
* `internal_transfers_cancel`: over a finite network whose every link endpoint is a body, the net link outflows sum to zero.
* `network_books_sum`, `network_composite`: GIVEN per-body books (input = storage change + ambient + net link outflow) and the
  electromechanical account as HYPOTHESES, internal transfers cancel and only storage and ambient exchange remain (the
  electrothermal `routed_loss_cancels` form, restated because the formal files compile standalone).
* `double_count_breaks`, `one_sided_sign_breaks`: an extra copy of a transfer is consistent only if it is zero; booking +F at
  both ends sums to 2F per link, not 0.

SCOPE: algebra over rings/groups and ordered fields; no proof about the exponential integrator, rounding, ngspice or materials.
The executable side is `src/model/thermal-network.test.ts`: correspondence evidence, not a refinement proof.
-/

namespace FluxGarden.ThermalNetwork

open Finset

theorem link_power_antisymm {R : Type*} [CommRing R] (G Ta Tb : R) :
    G * (Tb - Ta) = -(G * (Ta - Tb)) := by
  ring

theorem hot_to_cold (G Ta Tb : ℝ) (hG : 0 ≤ G) :
    (Tb ≤ Ta → 0 ≤ G * (Ta - Tb)) ∧ (Ta ≤ Tb → G * (Ta - Tb) ≤ 0) := by
  constructor
  · intro h
    exact mul_nonneg hG (by linarith)
  · intro h
    nlinarith

theorem two_body_capacity_weighted {R : Type*} [CommRing R] (C1 C2 T1 T2 T1' T2' Q : R)
    (h1 : C1 * (T1' - T1) = -Q) (h2 : C2 * (T2' - T2) = Q) :
    C1 * T1' + C2 * T2' = C1 * T1 + C2 * T2 := by
  linear_combination h1 + h2

theorem positive_link_steady (G T1 T2 : ℝ) (hG : 0 < G) (h : G * (T1 - T2) = 0) : T1 = T2 := by
  have h' := (mul_eq_zero.mp h).resolve_left (ne_of_gt hG)
  linarith

section Network

variable {ι κ R : Type*} [DecidableEq ι] [AddCommGroup R]

/-- The net link outflow of body `i`: link `l` books `+F l` at `a l` and `−F l` at `b l`. -/
def netOut (links : Finset κ) (a b : κ → ι) (F : κ → R) (i : ι) : R :=
  ∑ l ∈ links, ((if a l = i then F l else 0) - (if b l = i then F l else 0))

theorem orientation_reversal (links : Finset κ) (a b : κ → ι) (F : κ → R) (i : ι) :
    netOut links b a (fun l => -F l) i = netOut links a b F i := by
  unfold netOut
  apply Finset.sum_congr rfl
  intro l _
  split_ifs <;> simp

theorem swapped_booking_negates (links : Finset κ) (a b : κ → ι) (F : κ → R) (i : ι) :
    netOut links b a F i = -netOut links a b F i := by
  unfold netOut
  rw [← Finset.sum_neg_distrib]
  apply Finset.sum_congr rfl
  intro l _
  abel

theorem internal_transfers_cancel (bodies : Finset ι) (links : Finset κ) (a b : κ → ι) (F : κ → R)
    (ha : ∀ l ∈ links, a l ∈ bodies) (hb : ∀ l ∈ links, b l ∈ bodies) :
    ∑ i ∈ bodies, netOut links a b F i = 0 := by
  unfold netOut
  rw [Finset.sum_comm]
  apply Finset.sum_eq_zero
  intro l hl
  rw [Finset.sum_sub_distrib]
  simp [Finset.sum_ite_eq, ha l hl, hb l hl]

theorem network_books_sum (bodies : Finset ι) (links : Finset κ) (a b : κ → ι) (F : κ → R) (In dQ A : ι → R)
    (ha : ∀ l ∈ links, a l ∈ bodies) (hb : ∀ l ∈ links, b l ∈ bodies)
    (books : ∀ i ∈ bodies, In i = dQ i + A i + netOut links a b F i) :
    ∑ i ∈ bodies, In i = ∑ i ∈ bodies, dQ i + ∑ i ∈ bodies, A i := by
  rw [Finset.sum_congr rfl books, Finset.sum_add_distrib, Finset.sum_add_distrib,
    internal_transfers_cancel bodies links a b F ha hb, add_zero]

theorem network_composite (bodies : Finset ι) (links : Finset κ) (a b : κ → ι) (F : κ → R) (In dQ A : ι → R)
    (E S Lu X res : R)
    (ha : ∀ l ∈ links, a l ∈ bodies) (hb : ∀ l ∈ links, b l ∈ bodies)
    (books : ∀ i ∈ bodies, In i = dQ i + A i + netOut links a b F i)
    (electromechanical : E = S + ∑ i ∈ bodies, In i + Lu + X + res) :
    E = S + ∑ i ∈ bodies, dQ i + ∑ i ∈ bodies, A i + Lu + X + res := by
  rw [electromechanical, network_books_sum bodies links a b F In dQ A ha hb books]
  abel

theorem double_count_breaks (bodies : Finset ι) (links : Finset κ) (a b : κ → ι) (F : κ → R) (In dQ A : ι → R)
    (extra : R)
    (ha : ∀ l ∈ links, a l ∈ bodies) (hb : ∀ l ∈ links, b l ∈ bodies)
    (books : ∀ i ∈ bodies, In i = dQ i + A i + netOut links a b F i)
    (duplicated : ∑ i ∈ bodies, In i = ∑ i ∈ bodies, dQ i + ∑ i ∈ bodies, A i + extra) :
    extra = 0 := by
  rw [network_books_sum bodies links a b F In dQ A ha hb books] at duplicated
  simpa using duplicated

theorem one_sided_sign_breaks (bodies : Finset ι) (links : Finset κ) (a b : κ → ι) (F : κ → R)
    (ha : ∀ l ∈ links, a l ∈ bodies) (hb : ∀ l ∈ links, b l ∈ bodies) :
    ∑ i ∈ bodies, ∑ l ∈ links, ((if a l = i then F l else 0) + (if b l = i then F l else 0))
      = ∑ l ∈ links, (F l + F l) := by
  rw [Finset.sum_comm]
  apply Finset.sum_congr rfl
  intro l hl
  rw [Finset.sum_add_distrib]
  simp [Finset.sum_ite_eq, ha l hl, hb l hl]

end Network

end FluxGarden.ThermalNetwork

#print axioms FluxGarden.ThermalNetwork.link_power_antisymm
#print axioms FluxGarden.ThermalNetwork.hot_to_cold
#print axioms FluxGarden.ThermalNetwork.two_body_capacity_weighted
#print axioms FluxGarden.ThermalNetwork.positive_link_steady
#print axioms FluxGarden.ThermalNetwork.orientation_reversal
#print axioms FluxGarden.ThermalNetwork.swapped_booking_negates
#print axioms FluxGarden.ThermalNetwork.internal_transfers_cancel
#print axioms FluxGarden.ThermalNetwork.network_books_sum
#print axioms FluxGarden.ThermalNetwork.network_composite
#print axioms FluxGarden.ThermalNetwork.double_count_breaks
#print axioms FluxGarden.ThermalNetwork.one_sided_sign_breaks
