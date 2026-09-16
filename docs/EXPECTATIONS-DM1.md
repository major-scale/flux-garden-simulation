# DM1 — DIRECT MANIPULATION EXPECTATIONS (grab, haul, release)

Written **before** the DM1 implementation existed and **before** anything was run.
`EXPECTATIONS.md` (sha256 `d55e4ee0…`), `EXPECTATIONS-ADDENDUM.md`
(sha256 `dfbbf201…`) and `EXPECTATIONS-FP1R.md` (sha256 `7816f0b6…`) are
**unmodified**, and the D-1…D-15 record in `DEVIATIONS.md` stands. This file adds
the predictions for slice two and nothing else.

Ticket: `bridge/DM1-builder-ticket.md`
(sha256 `f52d75a8e735dd44af0dcda50a40d47184630c996eeaa6f888d1f6270bb98fe2`).
Binding: `bridge/ACCEPTANCE-RULES-v1.md` (sha256 `c59d5dc0…`) —
**a failed prediction stays failed.**

Nothing below is copied from an observation. Every number is either a closed-form
value, a control-law constant **chosen here before any test was run**, or an
a-priori error bound derived from the scheme algebra.

---

# 0 · THE MODEL. The hand is an EXTERNAL, POWERED COMPLIANT ACTUATOR

**It is not another passive spring inside the world's energy boundary.** The
boundary of "the world" is the set of rigid bodies, their contacts, and the four
passive springs. The hand sits **outside** that boundary and injects or removes
energy across it, exactly as a motor on a workbench would.

Consequences, all binding:

- **H-0a** The hand force is applied at the **body-local grab point**, converted
  to world coordinates and **re-evaluated before every internal sub-step**
  (h = 1/240 s), like every other force this build owns.
- **H-0b** The hand's work is booked as **signed external work**
  `W_hand`, positive when the hand adds energy to the world. It is a **new,
  fourth term** in the energy identity:

      UNATTRIBUTED = E_mech(t) − E_mech(0) − E_interventions − W_hand + D_owned

- **H-0c** `W_hand` is **NOT** an intervention (no frozen-edit ΔE is booked for
  grab begin / target / end — none of them moves anything, so their frozen ΔE is
  identically 0 and they are deliberately routed outside `intervene`).
- **H-0d** `W_hand` is **NOT** owned dissipation. The damping term `−C·v_grab`
  in the force law is **external hand work**, not heat in the body. It is never
  added to `dissipatedDrag` or `dissipatedSpringDamper`.
- **H-0e** **No virtual hand-spring potential is added to mechanical energy.**
  `E_mech` gains no term from an active grab. Under this boundary a moving
  anchor does no bookkeeping work and attachment/removal changes no potential,
  which is precisely why this boundary was chosen.
- **H-0f** The declared numerical estimator for `W_hand` is the same one this
  build already uses for drag and the spring damper, and for the same reason:
  the force is **constant over a sub-step**, so

      W_sub = F_hand · ( x_grab(end of sub-step) − x_grab(start of sub-step) )

  is **exact given that force**, and the entire approximation is the first-order
  (start-of-sub-step) evaluation of a state-dependent force. `x_grab` is the
  world position of the **material point of the body** the force acts at — not
  the centre of mass, and not the target.
- **H-0g** Diagnostic history is **bounded**: one row per **public tick**, ring
  buffer of **180 ticks (3 s)**, plus per-gesture totals for the **last 8
  gestures**. There is never one UI ledger row per sub-step.

---

# 1 · GAINS AND FORCE CAP — CHOSEN NOW, BEFORE ANY TEST WAS RUN

## 1.1 The trap, and the side of it this build takes

The ticket forbids scaling gain to mass **and** claiming heavier objects visibly
resist more. **This build does not scale gain to mass.** The gains are fixed
constants in N/m and N·s/m, identical for every body. Therefore:

> **CLAIMED:** a heavier or more strongly spring-loaded body genuinely lags
> further behind the pointer, needs more hand force for the same motion, and can
> drive the hand into its force cap. That is a real, visible mass effect.
>
> **NOT CLAIMED:** that the hand feels the same on every body. It does not, on
> purpose.

## 1.2 The chosen constants

    K_hand = 600 N/m        positional gain      (fixed, mass-independent)
    C_hand =  24 N·s/m      velocity gain        (fixed, mass-independent)
    F_max  = 400 N          hard cap on |F_hand|

Force law, evaluated per internal sub-step, `p` = world grab point,
`v` = body velocity **at that point**, `p*` = world target:

    F_raw  = K_hand·(p* − p) − C_hand·v
    F_hand = F_raw                       if |F_raw| <= F_max
           = F_max · F_raw/|F_raw|        otherwise

**No angular controller.** Torque is whatever `r × F_hand` supplies.
The velocity term damps the **absolute** grab-point velocity (target velocity is
taken as zero); this is declared, not derived.

Derived scales, from those three numbers alone:

- Saturation distance: `|e| = F_max/K_hand = 0.6667 m`.
- Hand deflection to hold 1 kg against gravity: `9.81/600 = 0.0163 m`;
  to hold 20 kg: `0.3270 m`.
- Largest static displacement the cap can force on the 4×800 N/m platform rig:
  `400/3200 = 0.1250 m`.

## 1.3 The numerical margin, and why it is NOT the spring limit

The hand is a **controller**, not a material whose damping rate this build
reports as physics. The slice-one limit `gamma·h <= 0.05` is an **accuracy**
bound on a *reported physical decay rate* (`sigma_num/sigma − 1 ≈ h·gamma/2`).
Nothing about the hand is reported as a physical decay rate, so that bound does
not apply to it, and **the spring limit is not weakened by one digit.**

What does apply is stability of the same sub-step map. For
`m ẍ = K(x*−x) − C ẋ` under this build's semi-implicit sub-step,

    v' = v + h·(K(x*−x) − C·v)/m ,   x' = x + h·v'

the characteristic polynomial is `λ² − (2 − hγ − h²ω²)λ + (1 − hγ)`, with
`ω² = K/m_eff`, `γ = C/m_eff`. Jury's conditions give the **exact** stability
region

    hγ < 2      and      h²ω² + 2hγ < 4 .

**Declared controller margin (new, and separate from `RESOLVABILITY`):**

    h·ω_n <= 0.5    and    h·γ <= 0.5      at h = 1/240 s
    i.e.  ω_n <= 120 rad/s   and   γ <= 120 s⁻¹

which puts `h²ω² + 2hγ <= 1.25` against a boundary of 4 — a **3.2× margin**, and
a **4× margin** on `hγ < 2`.

## 1.4 The effective mass, including rotational inertia

Along a direction `n`, with `r` the grab point relative to the centre of mass:

    1/m_eff(n) = 1/m + (r × n)ᵀ · I_world⁻¹ · (r × n)

`n` changes during a gesture, so the guard uses the **direction-independent
conservative bound** (`|r×n| <= |r|`, `qᵀI⁻¹q <= |q|²/I_min`):

    1/m_eff_min = 1/m + |r|² / I_min        (I_min = smallest principal moment)

evaluated **once, at grab time**, from the body-local grab point.

**Binding threshold**, from §1.3: `γ = C/m_eff <= 120` needs
`m_eff_min >= C/120 = 0.2000 kg`. (The stiffness condition needs only
`m_eff_min >= K/120² = 0.0417 kg` and is therefore never binding.)

## 1.5 Gain reduction — surfaced as CONTROLLER BEHAVIOUR, never as physics

If `m_eff_min < 0.2 kg` at grab time, **both** gains are scaled by

    s = m_eff_min / 0.2 kg          (0 < s < 1)

so `K' = s·K`, `C' = s·C`, `F_max' = s·F_max`. Scaling both preserves
`ζ = C/(2√(K m))·1 = 1.0954` and pins `γ' = C'/m_eff = 120` exactly at the
declared limit while `ω_n' = √(K/0.2) = 54.77 rad/s` stays well inside it.

**DM-1a** When `s < 1` the UI states, verbatim in substance: *"controller gains
reduced ×s for numerical resolution — a controller behaviour, not a change of
this body's physics."* It is **never** described as the body being heavier,
softer or harder to move.

## 1.6 The DECLARED SUPPORTED PRESET CASES

**No claim of arbitrary-body stability is made.** The supported set is exactly
the bodies of the default construction and the blocks the UI's *add block*
button mints, grabbed at any point on their surface:

| preset | m (kg) | worst-case m_eff_min (kg) | ω_n (rad/s) | h·ω_n | γ (s⁻¹) | h·γ | ζ | h²ω²+2hγ | gain scale s |
|---|---|---|---|---|---|---|---|---|---|
| platform | 20 | 2.1483 | 16.712 | 0.0696 | 11.172 | 0.0465 | 0.334 | 0.0979 | 1 |
| stack block | 1.0 | 0.1818 | 57.446 | 0.2394 | 132.00 | 0.5500 | 1.149 | 1.1573 | **0.909** |
| loose block | 1.5 | 0.2727 | 46.904 | 0.1954 | 88.00 | 0.3667 | 0.938 | 0.7715 | 1 |
| added block, lightest (0.8 kg, he 0.110 m) | 0.8 | 0.1455 | 64.226 | 0.2676 | 165.00 | 0.6875 | 1.284 | 1.4466 | **0.727** |
| added block, heaviest (1.6 kg, he 0.155 m) | 1.6 | 0.2909 | 45.415 | 0.1892 | 82.50 | 0.3437 | 0.908 | 0.7233 | 1 |

**DM-1b** Every row's post-guard `h·ω_n <= 0.5`, `h·γ <= 0.5` and
`h²ω²+2hγ <= 1.25`. Two of the five rows trip the guard, at `s = 0.909` and
`s = 0.727`; both are reported as controller behaviour under DM-1a.

**DM-1c** `ground` is fixed and **cannot be grabbed**; a pointer-drag on it
orbits the camera instead.

---

# 2 · CRITERION 2 — ISOLATED WITNESSES, RUN BEFORE ANY DEPENDENT UI WORK

All witnesses run **headless**, in **vacuum**, with **gravity = 0**, **no
contact** (a single free body, or the platform with its springs and nothing
else), and **spring damping c = 0** where springs are present. The only forces
are the hand and, in WB-P, four undamped springs.

## 2.1 The four witness bodies (declared here, before running)

| id | body | grab point (body local) | m (kg) | m_eff_min (kg) | s |
|---|---|---|---|---|---|
| **WB-L** light | cube, half-extent 0.15 m | (0,0,0) centre of mass | 0.5 | 0.5000 | 1 |
| **WB-H** heavy | cube, half-extent 0.50 m | (0,0,0) centre of mass | 200 | 200.0 | 1 |
| **WB-O** offset | cube, half-extent 0.20 m | (0.2, 0.2, 0.2) **corner** | 2.0 | 0.3636 | 1 |
| **WB-P** loaded platform | box 2.4×0.12×1.8 m, 4 springs k=800 c=0 to the world anchors | (1.2, 0.06, 0.9) **corner** | 24 | 2.5779 | 1 |

Analytic inertias used by the witnesses, computed **independently of Rapier**
from the uniform-cuboid formula `I_xx = m(hy²+hz²)/3`:

- WB-O: `I = diag(0.05333333, 0.05333333, 0.05333333)` kg·m², `|r|² = 0.12`,
  `1/m_eff_min = 2.750000`.
- WB-P: `I = diag(6.508800, 18.000000, 11.548800)` kg·m², `I_min = 6.508800`,
  `|r|² = 2.253600`, `1/m_eff_min = 0.387906`.

No witness body trips the gain guard, deliberately, so the witnesses measure the
force law and not the guard.

## 2.2 W1 — ISOLATED FORCE AND TORQUE WITNESS

Body at rest, identity rotation, target placed at `p_grab + d`. Because
`v = 0` at the first sub-step evaluation, the damping term is exactly zero, so
the first sub-step's force is closed-form. Predictions, all for **one internal
sub-step of h = 1/240 s from rest**:

- **W1a — the force law.** With `|d| = 0.1 m`: `|F| = K·|d| = 60.000 N` exactly,
  direction `d/|d|`. **Tolerance 1e-9 relative** (both sides are our own f64
  arithmetic on the same engine-supplied positions).
- **W1b — saturation.** With `|d| = 2.0 m`: `K·|d| = 1200 N > F_max`, so
  `|F| = 400.000 N` **exactly**, direction still `d/|d|`.
  **Tolerance 1e-9 relative.** The cap is a hard clamp, never a soft blend.
- **W1c — translation.** `Δv_com = F·h/m` after one sub-step.
  **Tolerance 2e-4 relative** on the vector's components and magnitude.
  (`@dimforge/rapier3d-compat` is the **f32** Rapier build and stores the
  timestep as f32; ~1e-7 relative noise is expected, and 2e-4 leaves three
  orders of margin while still excluding any factor-of-2, wrong-point or
  missing-term error.)
- **W1d — torque.** `Δω = I_world⁻¹ (r × F) h` after one sub-step, with
  `I_world` the **analytic** cuboid inertia of §2.1 and `r` the grab point
  relative to the centre of mass. **Tolerance 2e-3 relative.**
  For WB-L and WB-H (`r = 0`) the prediction is `Δω = 0`: **|Δω| < 1e-9 rad/s.**
- **W1e — the effective mass, with rotational inertia.**
  `(Δv_grab · n)/h = |F|/m_eff(n)` after one sub-step, where
  `1/m_eff(n) = 1/m + (r×n)ᵀI_world⁻¹(r×n)` and `v_grab` is the body's velocity
  **at the grab point**. **Tolerance 2e-3 relative.**
  For WB-O with `n = d/|d|` this is a **direct test of the formula the ticket
  names**, and it must be satisfied by the observed grab-point motion, not by
  construction.
- **W1f — no teleport.** `grabBegin` changes no position, orientation, linear or
  angular velocity: **byte-identical** `canonicalSimState` body rows before and
  after the event.
- **W1g — release adds no impulse.** `grabEnd` changes no velocity:
  **byte-identical** velocities across the event; and the tick after release the
  body's user-force accumulator contains **no** hand contribution.

## 2.3 W2 — ENERGY / WORK WITNESS, AND THE CONVERGENCE CHECK

Define the residual, over a whole gesture of `T = 1.0 s` (60 public ticks):

    R(M) = [ E_mech(end) − E_mech(start) ] − W_hand

with `M` the number of internal fixed sub-steps per public tick
(`h = 1/(60M)`), all other losses disabled so `D_owned = 0` and no intervention
occurs. `R(M)` **is** the UNATTRIBUTED remainder of §0 H-0b in this setting.

**This is not closure by construction.** `E_mech` is computed from engine-read
velocities and the inertia tensor; `W_hand` is computed from our applied force
and the engine-read displacement of the grab point. They share no term.

### 2.3.1 The a-priori residual, derived from the scheme algebra

For a sub-step from state `(x, v, ω)` with the force frozen at its start value,
semi-implicit Euler gives, per sub-step,

    ΔKE_trans = F·v h + ½ h²|F|²/m ,     W_sub,trans = F·(v + a h) h = F·v h + h²|F|²/m
    ΔKE_rot   = τ·ω h + ½ h² τᵀI⁻¹τ ,    W_sub,rot   = τ·ω h + h² τᵀI⁻¹τ

so the residual is **exactly first order in h** with a **derivable coefficient**:

    R_pred = − ½ Σ_substeps h² ( |F|²/m + τᵀ I_world⁻¹ τ )

This is a **prediction of the numerical accounting residual, not a claim that it
is heat.** It stays inside UNATTRIBUTED and is never relabelled.

### 2.3.2 The predictions

Gesture used for every case: `grabBegin` at the point of §2.1, then the target is
**hauled** — held for 6 ticks at `p_grab`, then moved to `p_grab + (0.30, 0.20,
0.10) m` for the remaining 54 ticks — then `grabEnd`. `M ∈ {1, 2, 4, 8, 16}`.

- **W2a — sign.** `R(M) < 0` for every case and every `M`: the world gains
  slightly **less** than the hand books, because the work integral uses the
  end-of-sub-step displacement while the kinetic energy uses the mid-point.
- **W2b — first order in h.** `|R(M)|·M` is constant to within **±25 %** of its
  value at `M = 4`, for `M ∈ {1,2,4,8,16}`, in every one of the four cases; and
  `|R(M)|` is **strictly decreasing** in `M`.
- **W2c — it converges to zero.** `|R(16)| <= |R(1)|/8` in every case.
- **W2d — relative size.** `|R(4)| / max(|W_hand|, 1e-6 J) < 1.5 %` in every
  case, and `< 0.4 %` at `M = 16`.
- **W2e — the derived coefficient is the right one.** For the three cases whose
  **only** force is the hand (WB-L, WB-H, WB-O),
  `R(M)/R_pred(M) ∈ [0.80, 1.20]` for `M ∈ {8, 16}`. Reported, not asserted, for
  `M ∈ {1,2,4}` and for WB-P, where four springs contribute their own
  first-order residual and cross terms that this coefficient does not model.
- **W2f — the witness can fail.** A deliberately mis-booked estimator that uses
  the **centre-of-mass** displacement instead of the **grab-point** displacement
  is computed alongside for WB-O. Its residual `R_wrong` must
  (i) exceed **10 %** of `|W_hand|` at `M = 4`, and (ii) **not** converge:
  `|R_wrong(16)| > |R_wrong(1)|/4`. If a wrong estimator passed the same bands,
  the bands would be measuring nothing.

## 2.4 W3 — THE BOUNDARY IS RESPECTED

- **W3a** Across a whole grab-haul-release gesture on the **default
  construction**, `budget.interventionsTotal` changes by **exactly 0**
  (`f64` bit-identical) — the hand books no frozen-edit ΔE.
- **W3b** `budget.dissipatedDrag` and `budget.dissipatedSpringDamper` receive
  **exactly 0** from the hand: in the isolated vacuum witnesses both remain
  bit-identically 0 J for the whole gesture, while `|W_hand| > 0.01 J`.
- **W3c** `E_mech` gains **no** hand-spring potential term: with the body
  clamped motionless (target 0.5 m away, one tick, body pinned by making it
  `fixed`), `E_mech` is bit-identical with and without an active grab.
- **W3d** The hand contribution appears in the engine's user-force accumulator
  and is labelled **EXTERNAL ACTUATOR** — never "spring", never "ours" in the
  dissipative sense — and `foreignAccumulatorWrites` stays **0** across a
  gesture (the registry is still the single writer).

---

# 3 · CRITERION 3 — DETERMINISTIC INPUT, REPLAY AND MID-GRAB RESTORE

## 3.1 The recorded form

Three new event kinds, keyed by `(tick, seq)` exactly as every existing event is,
with `wallClockMs` remaining a **non-authoritative annotation**:

    grabBegin { target: entityId, localPoint: Vec3 (body frame), worldTarget: Vec3, gestureId }
    grabMove  { worldTarget: Vec3 }
    grabEnd   { }

**DM-3a** All three carry **resolved world-space** (or body-local) geometry. No
screen coordinate, NDC value, ray, drag-plane normal or camera parameter is ever
recorded or replayed. Grep evidence: the `InputEvent` union contains no field of
screen or camera type.

**DM-3b — deterministic resampling.** Pointer motion is resampled to **exactly
one sample per simulation tick**: the UI stores the latest resolved world target,
and the tick driver emits **at most one** `grabMove` per tick, and **none** when
the target is unchanged. The number of raw pointer events in a tick — 0, 1 or 20
— cannot change the recorded event stream given the same per-tick values.

## 3.2 The predictions

- **DM-3c** Replay a record containing a full grab gesture **twice** →
  `canonicalSimState` identical **byte for byte** at every checkpoint.
- **DM-3d — cadence independence.** The same record driven through
  `FixedStepDriver` at synthetic frame deltas of **1/144 s, 1/60 s and 1/30 s**
  (all inside the 5-ticks-per-frame catch-up cap, so no tick is dropped) reaches
  tick 300 with `canonicalSimState` **identical byte for byte** to the plain
  `replay()` tick loop and to each other.
- **DM-3e — mid-grab snapshot / restore / continue.** Checkpoint taken at tick
  150 **during an active grab**, restored into a deliberately desynchronised
  fresh world, continued to tick 300: `canonicalSimState` identical byte for byte
  to the unbroken run at every 60-tick checkpoint. In addition, each of these is
  compared **field by field** and must match exactly:
  `active`, `entityId`, `localPoint` (x,y,z), `target` (x,y,z), `kP`, `kD`,
  `fMax`, `gainScale`, `gestureId`, `gestureWork`, and `budget.handWorkExternal`.
- **DM-3f — the comparison can detect hand state.** Eleven targeted single-field
  mutations of hand state (the eleven fields listed in DM-3e) must be detected by
  `canonicalSimState`: **11 of 11**. Reported alongside: how many the 32-bit
  `stateHash` catches — expected to be **fewer**, and it remains a display
  fingerprint with no claim made on it.
- **DM-3g — save excludes, checkpoint includes.** The saved **construction** JSON
  contains **no** `hand`, `grab`, `localPoint`-of-grab, `gesture` or `target`
  key: transient hand state is not authored content. The **checkpoint** JSON
  contains all of them. Both asserted by parsing the serialised artifacts.
- **DM-3h — the grab is cleared by every world replacement.** `build`, `reset`,
  construction `load`, and `removeEntity` of the grabbed body each leave
  `hand.active === false`, and no hand force is applied on the following tick.

---

# 4 · CRITERION 1 — WHAT MUST BE TRUE ON SCREEN

Recorded here **before** the page was driven. Each is a pass/fail I must observe
myself in the browser at `http://127.0.0.1:5311/`.

- **S-1** Grab, haul and release the **platform**: it follows the pointer with a
  visible lag, and returns to its springs on release without a jump.
- **S-2** Grab, haul and release a **loose block**: it follows much more closely
  than the platform did — the mass and spring-load difference is visible, and it
  is not cancelled by any mass scaling, because there is none.
- **S-3** **Centre versus corner grab rotate differently.** Grabbing a block at
  its centre and hauling sideways produces **|Δω| ≈ 0**; grabbing the same block
  at a corner and hauling the same way produces **clearly visible rotation**. I
  will read `angular velocity` from the inspector for both and record the two
  numbers.
- **S-4** **No position teleport** at grab: the body does not jump to the
  pointer on `pointerdown`.
- **S-5** **No stuck grab**: `pointerup` outside the canvas, `pointercancel`,
  lost pointer capture and `Escape` all release.
- **S-6** **No camera conflict**: dragging a body never orbits; dragging empty
  space or the ground always orbits.
- **S-7** **Readouts respond**: hand force in **N**, gesture work in **J** and
  the total both update live and are non-zero while hauling.
- **S-8** **Pause/resume**: while paused, moving the pointer with a body grabbed
  **does not move the body at all**; the target marker moves and is labelled
  pending. A single-step or resume then makes the body respond **through force**.
- **S-9** **Zero console errors** for the whole session.

---

# 5 · CRITERION 4 — WHAT MUST NOT REGRESS

- **DM-4a** The existing **19 tests stay green**, unmodified in substance.
- **DM-4b** The declared **catch-up / slowdown policy** in `sim/step.ts` is
  unchanged: same `MAX_CATCHUP_TICKS_PER_FRAME = 5`, same `MAX_FRAME_DELTA`, same
  drop-and-count behaviour. Grabbing must not add a second time source.
- **DM-4c** The **energy remainder stays honest**: UNATTRIBUTED is still shown as
  UNATTRIBUTED, `W_hand` is shown as a **separate, signed, external** line, and
  no part of the hand's damping is presented as heat.
- **DM-4d** Responsiveness measured **on the actual rendered scene** while
  grabbing and hauling, in the browser, on the named machine: report display fps
  and physics ms/tick during a live gesture. Predeclared acceptable: **physics
  mean < 16.67 ms/tick** (the existing budget) and **no dropped ticks** caused by
  grabbing on the default construction.

---

# 6 · WHAT IS NOT CLAIMED

- No stability claim for **arbitrary** bodies — only the preset set of §1.6.
- No claim that the hand feels mass-independent. It does not.
- No claim that the residual `R` is physical heat. It is numerical, it stays
  inside UNATTRIBUTED, and it is reported as such.
- No thermal model, no new physics domain, no engine change, no new proof work.
- No visual-determinism and no cross-version determinism claim, unchanged from
  slice one.
