import Mathlib

/-!
# Thermal feedback — thermal feedback v1 (bridge/THERMAL-FEEDBACK-V1-PLAN.md)

`src/model/thermal-feedback.ts` closes a loop between a lumped body's temperature and a memoryless circuit: a body temperature sets
a resistor R(T) = R_ref·(1 + α·(T − T_ref)) or an NTC's temperature node, the circuit is solved, and the solved losses are held over a
thermal step (a zero-order hold). A discrete controller state — outside the solve — selects the comparator's reference. This file
proves the algebra those choices rely on:

* `affine_pos`, `linear_resistance_pos`: an affine law positive at both ends of its declared domain is positive throughout it.
* `joule_forms`, `joule_voltage_form`: with V = I·R, the terminal power V·I equals I²·R and V²/R.
* `turn_off_only_at_or_above_hi`, `turn_on_only_below_lo`, `equality_is_off`, `idle_holds_in_band`, `hysteresis_traverses`: the
  controller's transition (heating continues while T < T_high; idle turns on only when T < T_low): it switches off only at or
  above T_high, on only below T_low, a threshold reached exactly reads "off", idle holds at or above T_low, and a switch-off
  followed by a switch-on spans more than T_high − T_low.
* `zoh_step_balance`: over a held step, source work = routed + outgoing losses + the electrical residual, times the step.

SCOPE: algebra only. Closed-loop stability, sampling accuracy and event-location accuracy are NOT proved; the executable side
(`src/model/thermal-feedback.test.ts`) is correspondence evidence, not a refinement proof.
-/

namespace FluxGarden.ThermalFeedback

theorem affine_pos (a b lo hi T : ℝ) (h1 : lo ≤ T) (h2 : T ≤ hi)
    (plo : 0 < a + b * lo) (phi : 0 < a + b * hi) : 0 < a + b * T := by
  by_cases hb : 0 ≤ b
  · nlinarith [mul_le_mul_of_nonneg_left h1 hb]
  · nlinarith [mul_le_mul_of_nonpos_left h2 (le_of_lt (not_le.mp hb))]

/-- The declared linear resistance law. -/
def linR (Rref α Tref T : ℝ) : ℝ := Rref * (1 + α * (T - Tref))

theorem linear_resistance_pos (Rref α Tref lo hi T : ℝ) (h1 : lo ≤ T) (h2 : T ≤ hi)
    (plo : 0 < linR Rref α Tref lo) (phi : 0 < linR Rref α Tref hi) : 0 < linR Rref α Tref T := by
  have e : ∀ x, linR Rref α Tref x = (Rref - Rref * α * Tref) + (Rref * α) * x := fun x => by unfold linR; ring
  rw [e] at plo phi ⊢
  exact affine_pos _ _ lo hi T h1 h2 plo phi

theorem joule_forms (V I R : ℝ) (ohm : V = I * R) : V * I = I ^ 2 * R := by
  rw [ohm]; ring

theorem joule_voltage_form (V I R : ℝ) (hR : R ≠ 0) (ohm : V = I * R) : V * I = V ^ 2 / R := by
  rw [ohm]; field_simp

/-- The controller's next state: heating continues while T < hi; idle turns heating on only below lo. -/
noncomputable def next (heating : Bool) (lo hi T : ℝ) : Bool := if heating then decide (T < hi) else decide (T < lo)

theorem turn_off_only_at_or_above_hi (lo hi T : ℝ) (h : next true lo hi T = false) : hi ≤ T := by
  simpa [next] using h

theorem turn_on_only_below_lo (lo hi T : ℝ) (h : next false lo hi T = true) : T < lo := by
  simpa [next] using h

theorem equality_is_off (lo hi : ℝ) : next true lo hi hi = false ∧ next false lo hi lo = false := by
  simp [next]

theorem idle_holds_in_band (lo hi T : ℝ) (h : lo ≤ T) : next false lo hi T = false := by
  simp [next, not_lt.mpr h]

theorem hysteresis_traverses (lo hi T1 T2 : ℝ)
    (off : next true lo hi T1 = false) (on : next false lo hi T2 = true) : hi - lo < T1 - T2 := by
  have a := turn_off_only_at_or_above_hi lo hi T1 off
  have b := turn_on_only_below_lo lo hi T2 on
  linarith

theorem zoh_step_balance {R : Type*} [CommRing R] (h Ps L Lr Lo res : R)
    (tellegen : Ps = L + res) (routing : L = Lr + Lo) :
    Ps * h = Lr * h + Lo * h + res * h := by
  rw [tellegen, routing]; ring

end FluxGarden.ThermalFeedback

#print axioms FluxGarden.ThermalFeedback.affine_pos
#print axioms FluxGarden.ThermalFeedback.linear_resistance_pos
#print axioms FluxGarden.ThermalFeedback.joule_forms
#print axioms FluxGarden.ThermalFeedback.joule_voltage_form
#print axioms FluxGarden.ThermalFeedback.turn_off_only_at_or_above_hi
#print axioms FluxGarden.ThermalFeedback.turn_on_only_below_lo
#print axioms FluxGarden.ThermalFeedback.equality_is_off
#print axioms FluxGarden.ThermalFeedback.idle_holds_in_band
#print axioms FluxGarden.ThermalFeedback.hysteresis_traverses
#print axioms FluxGarden.ThermalFeedback.zoh_step_balance
