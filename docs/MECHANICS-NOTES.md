# FP1 — the first playable, + DM1 direct manipulation

A spring-supported platform carrying movable blocks, with gravity, contact with
friction, spring/damper, quadratic air drag and dissipation **all live at once**
— and, since slice two, **grab, haul and release** with the pointer.

Built to `bridge/FIRST-PLAYABLE-PLAN-v2.md`
(sha256 `676f56eb62a7d38b9dbb72ccc28fce34368a247f641ad82369321720fc85f089`).

## Run it

```
npm install --legacy-peer-deps     # see DEVIATIONS.md D-6 for why the flag is needed
npm run dev                        # http://127.0.0.1:5311/
npm test                           # 148 tests: 146 pass, 2 RED AND KEPT RED (see below)
npm run typecheck
```

## Read these first

| file | what it is |
|---|---|
| `EXPECTATIONS.md` | every expected value, **written and hashed before anything was run** |
| `EXPECTATIONS-ADDENDUM.md` | one failed prediction, its derivation, and new **forward** predictions committed before running |
| `EXPECTATIONS-FP1R.md` | the R-series: predictions for the three returned fixes, **written and hashed before any of them was implemented** |
| `DEVIATIONS.md` | everything that departed from prediction, recorded not absorbed. D-1..D-7 are the original record and are unedited; D-8..D-15 is the return; **D-16..D-24 is DM1** |
| `EXPECTATIONS-DM1.md` | slice two: the hand model, the gains and cap **chosen before any test was run**, and every DM1 prediction, **written and hashed before the implementation existed** |
| `EXPECTATIONS-DM1-ADDENDUM.md` | four DM1 predictions failed; this is their derivation and the **forward** predictions committed before the new fixtures were run |
| `EXPECTATIONS-BB1-S1.md` | breadth batch 1, stage one: the three demo reference cards, **stamped before the physics layer existed and before anything was run** |
| `EXPECTATIONS-BB1-S1-A1.md` | two card literals were my arithmetic slips; retained as red, corrected by independent hand recomputation. **Demo 2's C2.2/C2.3 are NOT amended** |
| `EXPECTATIONS-BB2-CONNECTIONS.md` | batch two: ball and fixed connections — every fixture, formula, tolerance, duration and the profile-selection rule, **stamped before any ball/fixed code existed and before any probe ran** |
| `EXPECTATIONS-BB2-CONNECTIONS-A1.md` | five of my batch-two predictions failed — two arithmetic/tolerance slips and two fixture defects — with their causes and **forward** predictions committed before rerunning. **C4a is NOT amended** |
| `EXPECTATIONS-BB2-CONNECTIONS-A2.md` | one more: an ill-conditioned `acos` measure with a `√eps` floor, replaced by `atan2(\|a×b\|, a·b)` |

## Breadth batch 1 — and the one test that is red on purpose

At the time of batch 1 `npm test` reported **102 passing and 1 failing** (it now
reports 148 tests, 146 passing and 2 failing — the second red is batch two's C4a,
below). That failure is deliberate and it must not be "fixed":

> **C2.2/C2.3 — the pendulum's large-amplitude period, at the LEGACY 4 sub-steps.**
> Predicted within 1.0 % of the exact rigid-pendulum period at every amplitude;
> measured **−4.07 % at 90°** and **−11.73 % at 120°**. **The tolerance was not
> widened, the amplitude range was not shrunk and no case was deleted** — the test
> still asserts the original criteria against the original configuration, and it
> still fails. See `DEVIATIONS.md` D-29 and D-33. The running UI states this in red
> on demo 2.

**What was corrected is the implementation, not the criterion.** Four internal
sub-steps was a *selected configuration*, not a law of this project. The pendulum
scene now **declares** a finer fixed numerical profile — `numerics: {substeps: 128}`
— chosen from a bounded ladder (M = 4, 8, 16, 32, 64, 128, stopped at 128) measured
against the **unmoved** stamped tolerances. At M = 128 the original C2.2 and C2.3
pass at every declared amplitude, at 1.78–1.81 ms/tick on the rendered scene
against a 16.67 ms budget. The profile is authored content: recorded in the
construction and in checkpoints, restored on checkpoint restore, compared in
`canonicalSimState`, and **refused rather than substituted** when unsupported. **A
construction that declares no profile means the legacy 4, so old recordings keep
their old configuration.**

**And period accuracy is not energy preservation.** With zero gravity and no torque
at all, this hinge still loses **59.7 %** of its kinetic energy in 11 s at M = 4 and
**4.42 % at M = 128**. Refinement shrinks that but does **not** halve it per halving
of `h` — the successive log-decrement ratios are 0.610, 0.569, 0.539, 0.521, 0.510,
approaching ½ from above — so **no asymptotic rate is claimed**. The 11 s window is
finite and bounds nothing beyond it. All of the deficit sits in **UNATTRIBUTED** and
**none of it is called heat**. **This adapter is not energy-conserving.** The
conclusion is narrow: it is about *this configured hinge simulation*, and it
establishes nothing about Rapier in general or about any future mechanism.

The six demos are scene presets in the selector at the top of the panel:

| demo | what it compares | result |
|---|---|---|
| 1 · vacuum projectile | trajectory and range against the analytic reference under declared launch/landing conditions; air is an **explicitly numerical** comparison with **no closed form claimed** | PASSED |
| 2 · pendulum on a HINGE | small-amplitude period, and where that approximation stops being true | PASSED at the declared profile; **the legacy M = 4 case is RETAINED, RED and RETURNED** |
| 3 · spring oscillator on a SLIDER | displacement and energy against the continuum reference **and** the corrected spring model's discrete map | PASSED |
| 4 · two-body collision | momentum and restitution/energy for a controlled **isolated pair** in zero gravity, tolerances and measurement times declared. Not a cradle | PASSED |
| 5 · inclined-plane slide | the **frictionless** `g sin θ` reference first; friction only with the Coulomb model **and the engine's own assumption** named. **No angle of repose is claimed** | PASSED |
| 6 · air vs drag-free fall | the **already-validated** drag law of §A, exposed as a side-by-side comparison. One ball carries an authored `C_d = 0` | PASSED |

Demos 1 and 3 still carry their **continuum** comparisons, on screen and in the
suite, alongside the discrete-map ones: demo 1 reports the range against the
continuum `R_c` as well as against `R_c − v_x h`, and demo 3 reports the period and
decay against the continuum values as well as the discrete map. Agreement with a
discrete map is diagnostic evidence; it is not stronger physical validation, and
the projectile's 30°/60° asymmetry proves the scheme was understood, not that the
asymmetry is physical.

Shared capability extracted **through** them, not designed in advance:
`model/measure.ts` (a named SI quantity + a body/world reference + a bounded ring
buffer + one reset, with the analytic reference it is meant to be compared
against), `ui/plot.ts` (**one** plot — demo 1 is its first consumer, demo 3 its
second), `model/joints.ts` (HINGE and SLIDER at that point — **batch two added BALL
and FIXED**; authored identity, **no exact
decomposition of constraint work and no constraint error turned into heat**),
`setGravity` as a recorded intervention booked against a **fixed** potential-energy
datum at the world origin, and `model/scenes.ts` + the selector, which resets the
world **and** the recording through the existing `worldReplaced` boundary.

## Batch two — AUTHORABLE CONNECTIONS: ball and fixed

`npm test` reports **148 tests, 146 passing and 2 failing.** Both failures are
deliberate, retained and must not be "fixed": demo 2's pendulum red above, and
**C4a**, described below.

**Peter can connect two authored bodies with a ball joint or a fixed connection,
save/reopen the assembly, and run and compare it without losing its connection
geometry or silently changing its numerical profile.**

### Honest, variant-specific semantics — no dummy axis standing in for a frame

`JointDesc` is a **discriminated union**, and each variant carries the fields it
actually has:

| variant | fields beyond `id`, `bodyA`, `bodyB` | Rapier |
|---|---|---|
| `hinge` / `slider` | `anchorA`, `anchorB`, **`axis`** | revolute / prismatic |
| **`ball`** | `anchorA`, `anchorB` — **no axis, no frame** | `spherical` |
| **`fixed`** | `anchorA`, `anchorB`, **`frameA`**, **`frameB`** | `fixed` |

A ball has three rotational degrees of freedom and no preferred direction, so it
carries **no field pretending it has one**. A fixed connection's two **unit
quaternions** are the connection frame **in each body's own local frame** — a frame
is three-dimensional and **an axis could not stand in for it**. An `axis` on a
ball or a fixed, a missing `axis` on a hinge, and a missing frame on a fixed are all
**REFUSED as unknown/missing fields** — never ignored, never defaulted.

Creating a fixed connection derives its frames from the two bodies' **authored
rotations at that moment** (`frameA = identity`, `frameB = R_B⁻¹⊗R_A`) and stores
both **explicitly**, so the **intended initial relative pose is preserved** —
including a non-identity one. The panel reports it as an angle.

### A misaligned connection is REFUSED, never silently snapped

Measured at the authored state, and **refused at both the document boundary and the
engine boundary**, so no path reaches the solver:

```
  d0     = |p_A − p_B|                          band 1e-6 m
  theta0 = angle(Q_A⁻¹ ⊗ Q_B)   (fixed only)    band 1e-6 rad
```

The band is a **numerical-representation band, not a snapping band**: one micron is
three orders of magnitude below the 1e-3 m constraint-holding target, and the
**measured residual is displayed whether or not it is inside the band**. The refusal
names the measured separation in metres, the frame error in radians, and the
alternative: an **authored placement operation** that moves body B through the
**existing edit audit**, with its own reason and initial-energy change. *Placement is
an edit to the starting scene, not physical motion.* The solver is never asked to
pull anything into place — and `G6` in `model/connections.test.ts` demonstrates the
counterfactual: a 4 mm violation introduced into a **live** world **is** pulled
0.002 m by the solver in 30 ticks, which is exactly what the gate refuses to let
happen to an authored document.

**Scope, declared and narrow:** the gate applies to **ball and fixed only**. Hinge
and slider are unchanged — a slider's anchors are *legitimately* separated along its
free travel axis, and **legacy hinge/slider documents keep loading** (asserted
against a **frozen literal** pre-batch-2 document in `P1`).

### The measured witnesses — 10.000 s, vacuum, gravity-free, no contacts

Three fixtures with **non-identity body rotations, off-centre anchors, independently
derived compatible initial velocities**, a **dynamic pair** and a **fixed-to-world**
case. Contacts, owned dissipation and our own force contributions are all asserted
**zero**, not assumed. The offered profile was chosen by a rule **declared before
any measurement**: the lowest rung of the existing `{4, 8, 16, 32, 64, 128}` ladder
at which both moving fixtures meet all three targets.

| at **M = 128**, the offered profile | max anchor sep | max frame err | max \|ΔE\|/KE₀ | cost |
|---|---|---|---|---|
| ball pair | 7.791e-7 m | — | **0.6198 %** | 2.23 ms/tick |
| fixed pair | 9.708e-7 m | 2.852e-7 rad | **0.1269 %** | 1.41 ms/tick |
| fixed-to-world (under a 1 N·s impulse) | 1.048e-7 m | 1.284e-8 rad | — | — |
| *the LEGACY M = 4, reported alongside* | *1.225e-4 / 2.084e-5 m* | *3.159e-7 rad* | *10.36 % / 4.11 %* | *0.24 / 0.08 ms/tick* |

Targets: anchor ≤ 1e-3 m, frame ≤ 1e-3 rad, energy ≤ 1 %. **These describe the
tested fixtures only, not every user-built assembly, and no existing construction is
upgraded to meet them.** The declaration predicted M = 32; the ladder said M = 128,
and **the promise was not narrowed to fit** (D-36 §8).

### The substitutes FAIL, and nothing can pass by freezing

| witness | result |
|---|---|
| **ball** rotates about ≥ 2 independent axes, anchors joined | SPREAD **0.472** ≥ 0.05, max\|u\| **3.14 rad**, anchor 7.79e-7 m |
| **a hinge substitute**, under its own best conditions | SPREAD **5.49e-8** — fails the ball criterion by 6 orders of magnitude, while still rotating **1.91 rad** so it is *not* frozen |
| **fixed** retains a non-identity relative pose while moving | pose **35°** held to **2.85e-7 rad**, COM travelled **8.846 m**, assembly turned **20 rad** |
| **a ball substitute**, on the identical fixture | max pose error **1.869 rad** — fails the fixed criterion by **1870×** |
| fixed-to-world non-vacuity control | the same impulse with the connection removed moves the body **4.488 m** |

The **independent reference** §3 demands — reading the adapter's own fields back is
explicitly insufficient — is the **phase-free momentum reference**, computed from the
stamped initial conditions and the **authored** masses and radii alone:
`MOM-P 1.426e-5 ≤ 1e-3`, `MOM-L0 6.252e-10 ≤ 1e-6` (the measured composite angular
momentum against the analytic `I_zz·ω = 0.504 kg·m²/s`), `MOM-L 2.111e-3 ≤ 1e-2`.
**All pass.**

### C4a — the second test that is RED ON PURPOSE

> **The closed-form rigid-assembly reference. Predicted within 5e-3 m and 5e-3 rad
> over 10.000 s; measured 8.378e-3 m and 2.121e-2 rad at M = 128.**
> **The tolerance was not widened, the window was not shortened, the case was not
> deleted and no passing rung was substituted.**

The ladder converges cleanly at first order — 2.879e-1 → 1.518e-1 → 7.753e-2 →
3.906e-2 → 1.912e-2 → 8.378e-3 m — and is still short of the stamped line. **No
mechanism is established.** The measured orientation discrepancy is **consistent
with** accumulated angular-momentum drift — `Δφ ≈ (|ΔL|/|L|)·|ω|·T/2 = 4.76e-2 rad`
— **under the assumptions of approximately linear rate drift, fixed relevant inertia
and axis, and negligible other orientation error**. It is a scalar consistency
check, not an identified cause, and **explaining a
discrepancy does not license amending a prediction**. My stamped allowance of 2e-4
rad per radian turned was an unfounded guess; the fix for a guess is not to move the
line after seeing where the ball landed. See **D-36 §7**.

**ACCEPTANCE AMENDMENT A — a RELAXATION, not a repair.**
`bridge/BATCH2-ACCEPTANCE-AMENDMENT-A.md` excepts C4a from this batch's acceptance
gate **by joint reviewer decision**, while it **remains an active failing
diagnostic**, still asserted and still failing. No bound is widened and no future
failure is excused. The amendment's condition is a **visible disclosure**, carried
in **run mode while a connection is in use**:

> **Experimental connections: holding an assembly together does not guarantee
> accurate motion.** In the fixed-assembly free-flight test over **10 simulated
> seconds at 128 substeps per tick**, maximum position error was **0.008378 m** and
> orientation error **0.02121 rad**; both exceeded the declared **0.005** limits (m
> and rad respectively). **Other assemblies and profiles are not validated by this
> test.**

Those two numbers are the **fixed witness's own**; **no equivalent error is claimed
for a ball joint**. The **≤ 1 % energy result** belongs to the **declared fixtures
and profile, not every live assembly**. Captured-run overlays compare **two
numerical runs**, so nothing here implies an accurate comparison. **Connection
geometry and trajectory fidelity are distinct, and the trajectory result above is
the one that failed.** See **D-39** for where the disclosure appears and for the
three wording corrections that accompany it.

**No constraint loss is booked as heat or as owned dissipation.** On every fixture
`D_owned = 0` exactly, interventions and `W_hand` are zero, and the **whole** deficit
is the UNATTRIBUTED remainder to the last bit of the identity. **This adapter is not
energy-conserving and is described that way nowhere.**

### Persistence — 113 of 113

The frozen mutation inventory is **extended, not replaced**: 79 + **34** new
obligations (both new variants' identity fields, both anchors, both connection
frames, an alignment-preserving re-framing that must be **detected** rather than
refused, and five variant-honesty refusals). **113/113 detected or refused —
58 compared, 55 validation refusals** — with the existing non-vacuity controls
intact. Save-after-evolution still saves the starting connection; deleting a
connected body leaves **no ghost** live, saved or after reopen; reopen, checkpoint
and captured-base replay all preserve the descriptors **and** the numerical profile;
and **changing only a connection field appears in comparison provenance** — on
screen, `scene.joints.0.kind: "ball" → "fixed"`, `frameA: added`, `frameB: added`,
and nothing else.

## Layout

```
src/model/units.ts          SI units, declared UI limits, vector/quaternion helpers
src/model/construction.ts   authored content — versioned JSON, NO engine handles ever
src/model/drag.ts           quadratic still-air drag; the effective-area convention
src/model/energy.ts         the deliberately INCOMPLETE energy account
src/sim/world.ts            Rapier adapter; the force-accumulator ownership discipline
src/sim/step.ts             fixed 1/60 s public-tick driver; the declared catch-up/slowdown policy
src/sim/record.ts           (tick, seq) input records; the recording lifecycle; checkpoints; replay
src/ui/main.ts              three.js rendering and all controls
src/sim/hand.ts             DM1: THE HAND — an external, powered compliant actuator
src/ui/inspect.ts           the panels — the honest force labelling lives here
```

## The four things most easily got wrong, and where they are handled

1. **Rapier's forces persist across steps, and it sub-steps inside one `step()`.**
   The public tick is fixed at 1/60 s and is advanced as **4 internal fixed
   sub-steps of 4.1667 ms**, with our accumulators cleared and rebuilt **before
   every one of them**; the engine's own sub-division is pinned to 1 so the
   refresh lands on every integration sub-step. Freezing a force across N engine
   sub-steps injects `(1 − (N+1)/2N)·h²·omega²` into the one-step determinant and
   cancelled about half the spring damping — see **D-1 and D-8**. `ForceRegistry`
   is the single writer; before clearing we compare the engine's
   `userForce()`/`userTorque()` to what we applied, and any mismatch is **counted
   and surfaced** (`foreignAccumulatorWrites`) rather than silently deleted.
   **Gravity is never added by us** — it is Rapier's world gravity.
2. **Engine damping is disabled explicitly**, not implicitly: `setLinearDamping(0)`,
   `setAngularDamping(0)` on every body. Sleeping is disabled too, because a
   sleeping body loses kinetic energy through a channel we cannot account for.
3. **One spring representation**: a passive linear spring + viscous damper we
   evaluate ourselves. **It is not a Rapier joint and not a motor controller**, and
   there is no motor controller anywhere in this build.
4. **The energy account is deliberately incomplete.** It reports resolved mechanical
   energy, explicit interventions, the dissipation we own, and an **UNATTRIBUTED**
   remainder that is *neither numerical error nor physical heat*. Do not close it.

## The hand is an EXTERNAL, POWERED COMPLIANT ACTUATOR (slice two)

**Not another passive spring inside the world's energy boundary.** That single
decision settles the accounting, and `src/sim/hand.ts` is the whole argument:

- Its force acts at the **body-local grab point** and is **re-evaluated before
  every internal sub-step**, like every other force this build owns.
- Its work is booked as **signed external work** `W_hand`, a **fourth term** in
  the energy identity, by the same declared estimator the drag and damper
  channels use — `W = F · Δx` at the **material point of application**, exact for
  a force held constant over a sub-step:

      UNATTRIBUTED = E_mech(t) − E_mech(0) − interventions − W_hand + D_owned

- `W_hand` is **not** a frozen-edit intervention ΔE (grab begin/move/end move
  nothing, so they are routed around `intervene`), **not** owned dissipation, and
  **no hand-spring potential is added to `E_mech`**. The damping term in the force
  law is **external hand work, not heat in the body.**
- Diagnostic history is **bounded**: one row per **public tick**, 180-tick ring
  buffer, plus the last 8 gesture totals. **Never one row per sub-step.**
- **One point attachment, no angular controller.** Every torque is `r × F`.

**Nominal gains and cap are fixed: K = 600 N/m, C = 24 N·s/m, cap 400 N; they
are reduced for numerical resolution when the effective mass is low — below
`m_eff = 0.2 kg` — and not otherwise.** That reduction is *controller* behaviour,
not a mass-proportional gain schedule: in the supported regime the nominal values
are used unchanged, so this build **does** claim a heavier or more strongly sprung
body lags further behind the pointer, and **does not** claim the hand feels the
same on every body. The **live effective** K, C and cap are shown in the grab
readout whenever a body is held, so no headline can contradict the state.
Measured on screen: for the same pointer travel the 20 kg spring-loaded platform
lagged **0.591 m** and moved **0.118 m**, the 1.5 kg loose block lagged
**0.418 m** and moved **0.341 m**.

The **controller** stability margin (`omega_n·h <= 0.5`, `gamma·h <= 0.5`, from
Jury's conditions on the sub-step map, with a 3.2× margin) is the **controller's**
and is **not** the passive springs' resolvability limit below, **which is
unchanged**. Below `m_eff = 0.2 kg` the gains are reduced and the reduction is
surfaced as **controller behaviour**, never as a change of the body's physics.
The guard is **re-evaluated whenever the held body's mass or inertia changes**
(`SimWorld.refreshHandGains`), not only when the gesture begins — evaluating it
only at `beginGrab` left it stale-able through the supported `setMass` edit, which
is D-27 in `DEVIATIONS.md` and is covered by the `DM-4` regression.
**Only the preset bodies of this construction are claimed; no arbitrary-body
stability is.**

Transient hand state is in the **solver checkpoint** and in the **declared replay
state**; it is **never** in an authored construction. Pointer motion is
**resampled to at most one world-space sample per simulation tick**, so raw screen
pixels, the drag plane and the camera cannot reach replay physics.

## The spring regime the UI offers is the regime the step resolves

`omega_n·h <= 0.30` and `gamma·h <= 0.05` at the 4.1667 ms internal sub-step, i.e.
`omega_n <= 72 rad/s` and `gamma <= 12 s⁻¹`, evaluated per body from the springs
pulling on it and **its mass**. Stiffness, damping and mass edits outside it are
**refused and surfaced, never clamped**. This is narrower than the plan's
provisional maxima, deliberately — see **D-10**.

## Determinism, and what is *not* claimed

Claimed only for: the same pinned engine build, the same initialized state, the
same insertion/removal order, the same input record, on the one named test machine
and browser. **No visual-determinism claim. No cross-version claim.**

**Exactness is decided on canonical bytes, not on a hash.** `stateHash` is a
32-bit FNV fingerprint of *selected* fields and is a display convenience only — in
the targeted-mutation test it misses 10 of 11 single-field mutations of state
inside the promised contract. Replay and restore are compared with
`canonicalSimState` / `canonicalAppState`: the **declared** replay state, every
number as its IEEE-754 bit pattern, compared byte for byte. The scope, including
what is **explicitly out** of it, is declared in `REPLAY_STATE_SCOPE` in
`src/sim/world.ts`, printed by the test suite, and written up in **D-13**. **No
bit-identical whole-engine-memory claim is made anywhere.**
