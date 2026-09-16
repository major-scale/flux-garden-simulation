import Mathlib

/-!
# Oriented port-power cancellation (Tellegen) for Flux Garden compositions — electronics v1, E10

The conformance kit's `energy-balance` check sums, over every terminal of every element of a composition, the node
potential times the current INTO that terminal (`src/model/conformance/terminals.ts`, `terminalMap`). This file proves the
network result that sum relies on, over exactly that shape:

* a finite set of terminals `T`, each sitting on a node (`node : T → N`) and carrying a current `i t` into its element;
* node potentials `v : N → R`, with the ground node `g` at `v g = 0`;
* KCL at every NON-ground node: the currents into elements at that node sum to zero. (Ground is exempt: the kit's parts
  return current to node 0 internally — a comparator's low side, a motor's shaft node — and `v g = 0` makes that harmless.)

Then the total port power is zero (`port_power_cancels`), the element port powers cancel (`element_powers_cancel`), and —
ONLY under the separate COMPONENT hypothesis that every non-source element absorbs non-negative power AT THAT INSTANT —
the power the sources deliver equals what those elements absorb and is non-negative
(`sources_deliver_what_passive_parts_absorb`). That hypothesis is stronger than passivity for an energy-storing element
(a discharging capacitor or inductor delivers power while passive), so it does not apply to a network with a discharging
store; the two cancellation theorems need no such hypothesis.

SCOPE. This is algebra about finite sums. It does not prove that ngspice satisfies KCL (it does so to its tolerance; the
kit reports the residual), that any element law is correct, or that the TypeScript terminal map is right. The executable
side of the correspondence is `src/model/conformance/electronics-v1.test.ts`: on solved compositions it checks, from the
PRODUCTION terminal map, KCL at every non-ground node and the vanishing total port power at every sample, and shows a
single flipped sign convention breaking it (a counterexample, not a refinement proof). The instantaneous hypothesis is an
assumption, never derived here; the kit's `energy-balance` checks something different and weaker — that each DISSIPATIVE
part's work integrated over the window is non-negative — and applies no sign condition to storing parts.

Built with the Lean worktree's existing toolchain (Lean 4.31.0, Mathlib v4.31.0) via `lake env lean`, no downloads.
-/

namespace FluxGarden.Electronics

open Finset

variable {R : Type*} [CommRing R]
variable {T N : Type*} [Fintype T] [Fintype N] [DecidableEq N]

/-- Tellegen's cancellation over the kit's terminal shape: ground at zero potential and KCL at every other node make the
total port power `Σ_t v(node t)·i t` vanish. -/
theorem port_power_cancels (node : T → N) (v : N → R) (i : T → R) (g : N)
    (ground : v g = 0)
    (kcl : ∀ n, n ≠ g → ∑ t ∈ univ.filter (fun t => node t = n), i t = 0) :
    ∑ t, v (node t) * i t = 0 := by
  rw [← Finset.sum_fiberwise univ node (fun t => v (node t) * i t)]
  apply Finset.sum_eq_zero
  intro n _
  have h : ∑ t ∈ univ.filter (fun t => node t = n), v (node t) * i t
      = v n * ∑ t ∈ univ.filter (fun t => node t = n), i t := by
    rw [Finset.mul_sum]
    apply Finset.sum_congr rfl
    intro t ht
    rw [(Finset.mem_filter.mp ht).2]
  rw [h]
  by_cases hn : n = g
  · rw [hn, ground, zero_mul]
  · rw [kcl n hn, mul_zero]

/-- The same cancellation read element by element (`elem : T → E` assigns each terminal to its element): the element
port powers `P e = Σ_{t of e} v(node t)·i t` sum to zero. -/
theorem element_powers_cancel {E : Type*} [Fintype E] [DecidableEq E]
    (elem : T → E) (node : T → N) (v : N → R) (i : T → R) (g : N)
    (ground : v g = 0)
    (kcl : ∀ n, n ≠ g → ∑ t ∈ univ.filter (fun t => node t = n), i t = 0) :
    ∑ e, ∑ t ∈ univ.filter (fun t => elem t = e), v (node t) * i t = 0 := by
  rw [Finset.sum_fiberwise univ elem (fun t => v (node t) * i t)]
  exact port_power_cancels node v i g ground kcl

/-- The port power of element `e`: the sum over its own terminals of potential times current into the terminal. -/
def elementPower {E : Type*} [DecidableEq E] (elem : T → E) (node : T → N) (v : N → R) (i : T → R) (e : E) : R :=
  ∑ t ∈ univ.filter (fun t => elem t = e), v (node t) * i t

/-- With the COMPONENT hypothesis that every non-source element absorbs non-negative power (stated, not derived), the
network result gives: the power the sources deliver, `−Σ_{sources} P`, equals the power the other elements absorb, and it
is non-negative. Over ℝ, the physical scalar field.

The hypothesis is INSTANTANEOUS non-negative power, which is STRONGER than passivity of an energy-storing element: a
discharging capacitor or inductor delivers power (P < 0) while being perfectly passive. So this theorem applies only
where every non-source element is absorbing at that instant (a purely dissipative network, or an instant where it holds);
it must not be applied to a discharging store. The two cancellation theorems above need no such hypothesis. -/
theorem sources_deliver_what_passive_parts_absorb {E : Type*} [Fintype E] [DecidableEq E]
    (elem : T → E) (node : T → N) (v : N → ℝ) (i : T → ℝ) (g : N)
    (ground : v g = 0)
    (kcl : ∀ n, n ≠ g → ∑ t ∈ univ.filter (fun t => node t = n), i t = 0)
    (isSource : E → Prop) [DecidablePred isSource]
    (passive : ∀ e, ¬ isSource e → 0 ≤ elementPower elem node v i e) :
    -(∑ e ∈ univ.filter isSource, elementPower elem node v i e)
        = ∑ e ∈ univ.filter (fun e => ¬ isSource e), elementPower elem node v i e ∧
      0 ≤ -(∑ e ∈ univ.filter isSource, elementPower elem node v i e) := by
  have total : ∑ e, elementPower elem node v i e = 0 := element_powers_cancel elem node v i g ground kcl
  have split := Finset.sum_filter_add_sum_filter_not univ isSource (elementPower elem node v i)
  have eq : -(∑ e ∈ univ.filter isSource, elementPower elem node v i e)
      = ∑ e ∈ univ.filter (fun e => ¬ isSource e), elementPower elem node v i e := by
    linarith
  refine ⟨eq, ?_⟩
  rw [eq]
  apply Finset.sum_nonneg
  intro e he
  exact passive e (Finset.mem_filter.mp he).2

end FluxGarden.Electronics

#print axioms FluxGarden.Electronics.port_power_cancels
#print axioms FluxGarden.Electronics.element_powers_cancel
#print axioms FluxGarden.Electronics.sources_deliver_what_passive_parts_absorb
