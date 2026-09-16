# BB2 addendum A1 — five failed predictions, their causes, and FORWARD predictions

Addendum to `EXPECTATIONS-BB2-CONNECTIONS.md`
(sha256 `748227ef98ea752c4ab85a55bee9c5eb1ff94d67c5f1edbc3769c4e4242a9c8d`,
stamped 2026-09-06T06:30:37Z). Under `bridge/ACCEPTANCE-RULES-v1.md` §1.

**THE STAMPED FILE IS NOT EDITED. THE FIVE FAILURES BELOW ARE RETAINED VERBATIM
IN `DEVIATIONS.md` D-36. NOTHING OBSERVED HAS BEEN COPIED INTO A PREDICTION.**
**Written and stamped BEFORE the corrected fixtures were run.**

Three of the five are **mine** — two arithmetic/derivation slips and two fixture
design defects (one of which is a single defect with two symptoms). One is a
**property of the adapter** and is **NOT amended**: it stays red.

---

## The five failures, as they were measured

| # | witness | stamped criterion | measured | verdict |
|---|---|---|---|---|
| A1.1 | C0d `|P(0)|` | `2.6539121` kg·m/s | `2.65377090194312` | **my arithmetic slip** |
| A1.2 | C0c adapter `E_mech(0)` vs analytic `KE_0` | rel ≤ `1e-9` | `1.4576e-7` | **my tolerance was below the engine's f32 floor** |
| A1.3 | C4b `\|P(0)\|` vs analytic | rel ≤ `1e-9` | `8.6328e-9` | same cause as A1.2 |
| A1.4 | C3b hinge substitute SPREAD | `< 0.01` | `0.15444` | **my fixture defect** |
| A1.5 | C3d ball substitute max θ | `≥ 1e-2` rad | `1.3993e-4` | **my fixture defect** |
| A1.6 | C4a ANALYTIC-POS / ANALYTIC-ANG | `≤ 5e-3` m / `5e-3` rad | `1.9101e-2` m / `4.7807e-2` rad | **NOT AMENDED — RETAINED RED** |

---

## A1.1 — `|P(0)|`: an arithmetic slip, corrected by hand recomputation

The declaration derived `|P(0)| = M·|v_c| = 3.0·√(0.70² + 0.30² + 0.45²)` and then
wrote the wrong number for it. **Recomputed by hand, independently of any measured
output:**

```
  |v_c|² = 0.49 + 0.09 + 0.2025 = 0.7825
  √0.7825 :  0.8846²  = 0.78251716        (too big by 1.716e-5)
             d/dx x²  = 2·0.8846 = 1.7692
             correction = 1.716e-5 / 1.7692 = 9.70e-6
             √0.7825  = 0.884590 3        (check 0.8845903² = 0.78249999…)
  |P(0)| = 3 × 0.8845903006477066 = 2.65377090194312
```

**FORWARD PREDICTION A1.1: `|P(0)| = 2.65377090194312` kg·m/s.** The witness
asserts the *derivation* `M_TOT·|v_C|` and pins this recomputed literal beside it.
The stamped `2.6539121` is wrong and stays on the record as wrong.

## A1.2 / A1.3 — the `1e-9` tolerances were below the engine's f32 floor

**Evidence independent of the failing energy and momentum outputs.** A separate
probe read back the engine's own mass properties for a *different, trivial*
construction (two spheres, no connection, straight-line motion):

```
  authored 2.0 kg  ->  read back 2.0000002384185791   rel  1.1921e-7
  authored 1.0 kg  ->  read back 1.0000001192092896   rel  1.1921e-7
  analytic I = 0.4·m·r² = 0.008     -> read back 0.0080000013113021851  rel 1.6391e-7
  2^-23 (the f32 epsilon)                                              = 1.1921e-7
```

The read-back mass error is **exactly one f32 epsilon**. The engine's mass
properties cross an **f32 boundary** — the same boundary this build already
documents for the timestep (`sim/mechanics.test.ts`: *"the step Rapier actually
integrates with: it stores `timestep` as f32"*). A `1e-9` relative agreement is
therefore **not reachable by any correct implementation**, and the criterion was
mis-derived. This is a defect in my prediction, not in the build.

**FORWARD PREDICTION A1.2/A1.3, derived from the mechanism and not from the
observed values:** any quantity this build compares between an analytic value and
one read back through the engine's mass properties agrees to within

```
  F32_ULPS = 4 · 2⁻²³ = 4.76837158203125e-7   (relative)
```

four units in the last place of a single-precision float — an order of magnitude
tighter than the `1e-6` unit-quaternion tolerance this build already uses, and
four times the single-epsilon signature measured above.

**DISCRIMINATING TEST, committed before running:** the same comparison applied to
a construction authored with **2.5 kg** where the reference says 2.0 kg must be
**DETECTED** at `F32_ULPS`. A tolerance that let a 25 % mass error through would
not be a tolerance.

## A1.4 — the hinge substitute was not built under its own best conditions

The stamped declaration §4.3 said the substitute needs *"`Q0`-consistent local
axes: `axisA = (0,0,1)`, `axisB = Qrel⁻¹·(0,0,1)`"*. **`JointDesc` carries ONE
shared `axis` for both bodies** — that is the schema hinge and slider have shipped
with since BB1, it is what legacy documents contain, and this batch does not change
it. So the declaration asked for something the hinge schema cannot express, and the
fixture as built used `(0,0,1)` in *both* local frames while `Qrel` is a 35°
rotation **about y**. The two local axes therefore named **world directions 35°
apart at t = 0**, so the substitute's own constraint was **violated at release** and
the solver spent the run yanking it — which is exactly what produced a second
rotation axis.

**Evidence independent of the failing SPREAD:** the initial world-space angle
between `R_A(0)·axisA` and `R_B(0)·axisB` is `35°`, computable from the stamped
fixture alone and asserted directly by the corrected witness.

**THE FIXTURE IS CORRECTED, THE CRITERION IS NOT.** The substitute keeps the same
bodies, the same anchors, the same `Q0`, the same relative-spin magnitude and the
same `H1`/`H2` thresholds; only its **relative pose** changes to

```
  QREL_HINGE = R_z(35°)      a rotation ABOUT THE HINGE AXIS
```

so that the one shared local axis `(0,0,1)` **is** the same world direction in both
bodies and the hinge's position, orientation and velocity constraints all hold
exactly at `t = 0`. That is "its own best conditions" as the declaration intended.

**FORWARD PREDICTIONS A1.4:**
* initial world-space hinge-axis misalignment `≤ 1e-12` rad *(it was 35°)*;
* `H1` unchanged: `max|u| ≥ 0.5` rad — the substitute is not frozen;
* `H2` unchanged: `SPREAD < 0.01`, failing the ball's `≥ 0.05` by ≥ 5×.

## A1.5 — the connection anchor was COLLINEAR, so the ball substitute felt no torque

**Evidence independent of the failing θ:** in the stamped fixture the connection
point, body B's centre of mass and the composite COM all lie **on the assembly-local
x axis**, and the assembly spins about the local **z** axis through the composite
COM. The centripetal force the connection must supply to body B is therefore
**parallel to the lever arm from B's COM to the anchor**, and

```
  lever = anchor − r_B = (0.25, 0, 0) − (0.40, 0, 0) = (−0.15, 0, 0)
  F     = −m_B·ω²·(0.40, 0, 0)                      = (−1.60, 0, 0) N
  τ     = lever × F                                  = (0, 0, 0) N·m      IDENTICALLY ZERO
```

A ball joint transmits force but no torque — and at zero torque **a ball and a fixed
connection produce the same motion**, so the fixture could not discriminate between
them. That is a **fixture design defect**, provable from the stamped literals with
no reference to any measured output.

**THE FIXTURE IS CORRECTED, THE CRITERION IS NOT.** The connection point moves off
the axis of collinearity, from assembly-local `(0, 0, 0)` to

```
  JOINT_LOCAL = (0, 0.12, 0)
```

and nothing else changes — same bodies, same masses, same radii, same body
positions, same `Q0`, same `Qrel`, same `v_c`, same `ω0`, same `Δω`, same duration,
same profiles, same thresholds. The recomputed torque on the ball substitute is

```
  lever = (0.25, 0.12, 0) − (0.40, 0, 0) = (−0.15, 0.12, 0)
  τ     = lever × (−1.60, 0, 0)          = (0, 0, 0.192) N·m
  |τ|   = 0.192 N·m,  I_B = 0.004 kg·m²  =>  α = 48 rad/s²
```

The derived anchors follow from the stamped construction rule and are, exactly:

```
  anchorA = (0.45, 0.12, 0)          |anchorA| = 0.4657252408878007 m
  anchorB = Qrel⁻¹·(−0.15, 0.12, 0)  |anchorB| = 0.19209372712298547 m
  closest possible COM separation under a ball tumble
        = 0.4657252408878007 − 0.19209372712298547 = 0.2736315137648152 m
        > 2r = 0.20 m,  so the two bodies STILL can never touch.
```

**FORWARD PREDICTIONS A1.5:**
* the analytic initial torque on body B about its own COM is `|τ| = 0.192` N·m,
  asserted directly, so the fixture's discriminating power is a **stated property
  of the fixture** and not a hope;
* `S1` unchanged: the ball substitute's `max θ ≥ 1e-2` rad, failing `F2`'s `1e-3`;
* every §2 target `T1`, `T2`, `T3` unchanged, and the no-contact property of the
  fixture is re-asserted, not assumed.

## A1.6 — C4a's analytic tolerances are **NOT AMENDED**. THEY STAY RED

`ANALYTIC-POS ≤ 5e-3 m` and `ANALYTIC-ANG ≤ 5e-3 rad` were **missed**, at
`1.9101e-2 m` and `4.7807e-2 rad`. **The tolerance is not widened, the fixture is
not changed for this criterion, the duration is not shortened and the case is not
deleted. The witness still asserts the original stamped numbers against the
original 10.000 s window, and it still fails.**

The mechanism is identified and reported, but **identifying it does not license
amending the prediction** (`ACCEPTANCE-RULES` §1: *"Explaining the implementation's
discrepancy does not itself justify that amendment."*). The mechanism is that the
orientation error is the **accumulated angular-momentum drift**, not an independent
error:

```
  measured max |ΔL|/|L(0)|          = 4.760e-3
  phase from a relative rate drift ε over T:  Δφ ≈ ε·|ω|·T/2
                                     = 4.760e-3 · 2.0 · 10 / 2 = 4.76e-2 rad
  measured ANALYTIC-ANG              = 4.7807e-2 rad             <- the same number
  and ANALYTIC-POS ≈ 0.45 m · 4.78e-2 = 2.15e-2 m,  measured 1.91e-2 m
```

so **the assembly's shape is held; its orbital phase drifts**, at the same
percent-scale this adapter's already-retained hinge result (D-29 / D-33: 4.42 % of
kinetic energy in 11 s at M = 128) established long before this batch. My stamped
allowance of `2e-4 rad per radian turned` was an unfounded guess and is inconsistent
with the project's own retained evidence — **but the fix for that is not to move the
line after seeing where the ball landed.**

**§3's independent-reference requirement is nevertheless MET, by a criterion that
PASSES:** §3 asks for *"an analytic rigid-assembly reference **or** an independent
momentum/kinematic calculation"*, and the phase-free momentum reference C4b —
`MOM-P ≤ 1e-3`, `MOM-L0 ≤ 1e-6`, `MOM-L ≤ 1e-2`, all computed from the stamped
initial conditions and the authored masses and radii alone — meets every one of its
stamped bounds. C4a is an **additional** reference this build imposed on itself, and
it is **retained red**.

**The whole C4a ladder is reported at every rung**, as evidence, **not** as a new
criterion and **not** as a route to a rung that would pass.

## A1.7 — the offered-profile prediction

The declaration predicted the offered profile would be `M = 32`. On the **defective**
fixture it resolved to `M = 64`. That prediction is **not a criterion** and was never
asserted; it is recorded as missed in `DEVIATIONS.md` D-36. The offered profile is
re-measured on the corrected fixture by the **unchanged** selection rule of §3.8, and
whatever the rule returns is what is offered.
