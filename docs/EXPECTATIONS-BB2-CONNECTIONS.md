# Batch 2 — AUTHORABLE CONNECTIONS (ball, fixed). Pre-probe declaration

Against `bridge/BATCH2-ACCEPTANCE-v1.md`
(sha256 `f520d4fdab1a2c0ec29ce026a1e190e659cd936dfcbc09b73a5c79be008dd3e5`,
frozen by an independent reviewer BEFORE any implementation existed) and
`bridge/ACCEPTANCE-RULES-v1.md` (sha256 `c59d5dc0d8df99c5e5b9c632f600f93c9b449aa1644a1804b0cbddb866f4f46f`).

**WRITTEN AND STAMPED BEFORE ANY BALL OR FIXED IMPLEMENTATION EXISTED, BEFORE ANY
PROBE WAS RUN, AND BEFORE ANY DEPENDENT UI WAS WRITTEN.** Every fixture literal,
every formula, every tolerance, the duration and the profile-selection rule below
are fixed by this file. Nothing observed may be copied back into it.

**Nothing in `EXPECTATIONS.md`, `EXPECTATIONS-ADDENDUM.md`, `EXPECTATIONS-FP1R.md`,
`EXPECTATIONS-DM1*.md` or `EXPECTATIONS-BB1-*.md` is moved, weakened or reinterpreted
by this file. The retained pendulum red (C2.2/C2.3 at the legacy M = 4) stays red and
untouched: it is about a HINGE, and this batch establishes its own behaviour.
Agreement or disagreement in loss between the hinge and these new connections would
NOT alone identify a shared cause, and none is claimed.**

---

# PART 0 — ORDER OF WORK, DECLARED

1. This declaration is written and stamped. *(§1)*
2. Model + adapter for the two new variants is implemented.
3. **The §2 and §3 probes are written and run. PROBE FIRST.**
4. **Only if the §2 targets are met at some rung of the existing ladder** does the
   dependent authoring UI get written. A material miss of a §2 target at every
   rung **PAUSES** the dependent UI, is retained as a failure, and is reported —
   it is **not** answered by narrowing the promise, widening a tolerance, deleting
   a case or shrinking the fixture range.
5. Persistence witnesses (§5), then the UI (§4), then the on-screen drive (§6).

---

# PART 1 — WHAT A BALL AND A FIXED CONNECTION *ARE* IN THIS BUILD

## 1.1 Honest, variant-specific semantics — no dummy axis

`JointDesc` becomes a **discriminated union**. The `axis` field is **NOT** carried
by the new variants, because neither has an axis and a field that stood in for a
frame would be a lie in the file format:

| variant | fields, beyond `id`, `bodyA`, `bodyB` | Rapier constructor |
|---|---|---|
| `hinge`  | `anchorA`, `anchorB`, **`axis`** | `JointData.revolute(a1, a2, axis)` |
| `slider` | `anchorA`, `anchorB`, **`axis`** | `JointData.prismatic(a1, a2, axis)` |
| **`ball`**  | `anchorA`, `anchorB` — **no axis, no frame** | `JointData.spherical(a1, a2)` |
| **`fixed`** | `anchorA`, `anchorB`, **`frameA`**, **`frameB`** | `JointData.fixed(a1, f1, a2, f2)` |

An `axis` on a `ball` or a `fixed`, or a missing `axis` on a `hinge`/`slider`, or a
missing `frameA`/`frameB` on a `fixed`, is **REFUSED as an unknown/missing field**,
not ignored and not defaulted.

## 1.2 THE EXPLICITLY NAMED FRAMES

* **`anchorA`** is the attachment point **in body A's own local frame**, metres.
* **`anchorB`** is the attachment point **in body B's own local frame**, metres.
* **`frameA`** is a **unit quaternion** giving the orientation of **the connection
  frame expressed in body A's local frame**.
* **`frameB`** is a **unit quaternion** giving the orientation of **the connection
  frame expressed in body B's local frame**.

A `fixed` connection is satisfied exactly when **both** hold:

```
  world anchor A  ==  world anchor B
      p_A(t) = r_A(t) + R_A(t) · anchorA      [m, world]
      p_B(t) = r_B(t) + R_B(t) · anchorB      [m, world]

  world connection frame A  ==  world connection frame B
      Q_A(t) = R_A(t) ⊗ frameA               [unit quaternion, world]
      Q_B(t) = R_B(t) ⊗ frameB
```

A `ball` connection is satisfied exactly when the **first** holds only. A ball has
**no orientation constraint at all** and therefore **no relative-orientation error
is defined or reported for it**.

## 1.3 PRESERVING THE INTENDED INITIAL RELATIVE POSE (fixed)

The authoring operation that CREATES a fixed connection **derives the two frames
from the two bodies' authored rotations at that moment**, under one declared
convention:

```
  frameA = identity
  frameB = R_B(0)⁻¹ ⊗ R_A(0)
```

so that `R_A(0) ⊗ frameA = R_A(0) = R_B(0) ⊗ frameB` exactly. The **authored
initial relative pose** `q_rel(0) = R_A(0)⁻¹ ⊗ R_B(0)` is therefore held for all
time by the constraint, whatever it was — **including a non-identity one**. The
frames are then **stored explicitly in the authored document**; they are not
recomputed at build time and are not derived behind the author's back.

## 1.4 NO CONSTRAINT LOSS AS HEAT — restated, binding

Ball and fixed constraints are resolved inside Rapier's impulse solver. **No exact
decomposition of their constraint work is promised, none is estimated, none is
booked as owned dissipation, and none is added as a potential.** Every joule of it
stays in **UNATTRIBUTED**. `model/energy.ts`'s standing prohibition is unchanged:
**numerical constraint loss is never relabelled physical heat.** A witness below
asserts `D_owned == 0` exactly on every fixture in this file.

---

# PART 2 — THE MISALIGNMENT GATE (§4): REFUSED, NEVER SILENTLY SNAPPED

## 2.1 The measured residuals

At the **authored initial state** of any construction containing a `ball` or a
`fixed` connection:

```
  d0     = | p_A(0) − p_B(0) |                                   [m]
  theta0 = 2 · atan2( |vec(Q_A(0)⁻¹ ⊗ Q_B(0))| ,
                      |w  (Q_A(0)⁻¹ ⊗ Q_B(0))| )                 [rad, in [0, π]]
```

`theta0` is defined for `fixed` only.

## 2.2 The declared tolerance, and why it is what it is

```
  ALIGN_TOL_POS   = 1e-6 m
  ALIGN_TOL_ANG   = 1e-6 rad
```

**These are a numerical-representation noise band, not a snapping band.** They are
chosen so that a residual that could only have come from IEEE-754 round trips —
a quaternion re-normalisation, or the degrees↔quaternion round trip the existing
body-edit form performs — is not mistaken for an authored misalignment. One micron
is **three orders of magnitude below the 1e-3 m constraint-holding target of §2**,
so nothing inside the band can be confused with a solver correction of a real
misalignment. **The measured `d0` and `theta0` are displayed in the connection
panel whether or not they are inside the band**, so a residual is reported, never
hidden.

## 2.3 The behaviour

`d0 > ALIGN_TOL_POS`, or (for `fixed`) `theta0 > ALIGN_TOL_ANG`, is **REFUSED**:

* at `validateAuthored` — so a pasted or loaded document is refused **atomically**,
  with no partial state and no committed edit;
* at `SimWorld.build` — so it can never be reached by any other path;
* in the authoring UI — with the **measured separation in metres and the measured
  frame error in radians named in the message**.

It is **NEVER** handed to the solver to be pulled into place.

**Scope, declared and narrow.** The gate applies to `ball` and `fixed` **only**.
`hinge` and `slider` keep exactly the behaviour they have today, because
**legacy hinge/slider documents must keep loading** and a slider's anchors are
*legitimately* separated along its free travel axis (the shipped oscillator scene
has the cart at x = 0.30 m against a rail anchor at x = 0). Extending the gate to
them is out of scope for this batch and is not claimed.

## 2.4 The authored placement operation (the other permitted resolution)

A misalignment may **alternatively** be resolved by an explicit, authored placement
operation — never by the solver:

```
  placeToSatisfyConnection(c, connectionId)      moves BODY B only
    fixed:  R_B := R_A ⊗ frameA ⊗ frameB⁻¹     then   r_B := p_A − R_B · anchorB
    ball:                                              r_B := p_A − R_B · anchorB
```

It runs through the **existing** `AuthoringSession.edit(change, reason)` path, so it
appears in the **existing edit audit** with its own `deltaInitialEnergy` and its own
reason string, exactly like every other authored edit. It is **an edit to the
starting scene, not physical motion**, and the UI says so.

---

# PART 3 — §2 MECHANICAL WITNESSES: FIXTURES, FROZEN

All three fixtures: **`medium: 'vacuum'`, `gravity = (0, 0, 0)`, no ground body, no
springs, no hand, no drag, no owned damping of any kind, no contacts** (asserted, not
assumed: `contactPairsWith` over every collider every tick must return **0** for the
whole run). **Position and velocity constraints are satisfied at t = 0** by
construction, and the velocities are **derived independently from rigid-body
kinematics**, never read back from the adapter.

**Duration: 10.000 simulated seconds = 600 public ticks at the fixed 1/60 s public
tick. 601 samples, one at t = 0 and one after every tick.**

## 3.1 Bodies (shared by fixtures F-BALL-PAIR and F-FIXED-PAIR)

| id | shape | mass | analytic inertia (isotropic) |
|---|---|---|---|
| `sphA` | sphere, r = 0.10 m | 2.0 kg | `I_A = 0.4·m·r² = 0.008 kg·m²` |
| `sphB` | sphere, r = 0.10 m | 1.0 kg | `I_B = 0.4·m·r² = 0.004 kg·m²` |

Spheres are chosen so the inertia tensor is **isotropic and analytic**, so a body's
own orientation cannot enter the composite-inertia arithmetic.

## 3.2 Assembly layout, in the ASSEMBLY-LOCAL frame

The connection point is the assembly-local origin `(0, 0, 0)`.

```
  A's COM at local (−0.45, 0, 0)      => |anchorA| = 0.45 m
  B's COM at local (+0.15, 0, 0)      => |anchorB| = 0.15 m
```

`|anchorA| ≠ |anchorB|` deliberately: under a ball joint the two COMs can never be
closer than `0.45 − 0.15 = 0.30 m`, which exceeds the sum of the radii `0.20 m`, so
**the two bodies can never touch however they tumble.** That is what makes "no
contacts" a property of the fixture rather than a hope.

Composite (rigid) COM, from the authored masses:
```
  r_c_local = (2.0·(−0.45) + 1.0·(+0.15)) / 3.0 = (−0.75)/3.0 = −0.25
  offsets from the composite COM:  A: −0.20 m      B: +0.40 m
  check: 2.0·(−0.20) + 1.0·(+0.40) = 0            ✓
```

Composite inertia about that COM (spheres isotropic, offsets collinear along local x):
```
  I_xx = I_A + I_B                              = 0.008 + 0.004            = 0.012 kg·m²
  I_yy = I_zz = I_xx + m_A·0.20² + m_B·0.40²    = 0.012 + 0.080 + 0.160    = 0.252 kg·m²
```
`I_yy = I_zz` **exactly**, so the assembly-local **z** axis is a principal axis and
an initial `ω` along it is preserved for all time with no precession and no
intermediate-axis instability. **This is what makes an exact analytic reference
possible.**

## 3.3 Orientations and the assembly pose

```
  Q0    = quaternion( axis n̂ = (1,2,3)/√14 , angle = 0.7 rad )     — the assembly's world pose
  Qrel  = quaternion( axis (0,1,0)          , angle = 35° = 0.6108652381980153 rad )

  R_A(0) = Q0                     — NON-IDENTITY body rotation
  R_B(0) = Q0 ⊗ Qrel              — NON-IDENTITY body rotation, and a NON-IDENTITY
                                     relative pose q_rel(0) = Qrel, angle 35°
```

`anchorA` and `anchorB` are then, by definition of §1.2 and with the connection point
at assembly-local origin:
```
  anchorA = (+0.45, 0, 0)                     — off-centre
  anchorB = Qrel⁻¹ · (−0.15, 0, 0)            — off-centre, two nonzero components
```
`frameA = identity`, `frameB = Qrel⁻¹` (from §1.3), giving `theta0 = 0` exactly.

## 3.4 F-FIXED-PAIR — the moving, gravity-free, rigid dynamic pair

```
  r_c(0) = (0, 0, 0) m
  v_c    = (0.70, −0.30, 0.45) m/s
  ω0     = Q0 · (0, 0, 2.0)   rad/s          — along the composite principal z

  r_A(0) = r_c(0) + Q0·(−0.20, 0, 0)
  r_B(0) = r_c(0) + Q0·(+0.40, 0, 0)
  v_A(0) = v_c + ω0 × (r_A(0) − r_c(0))      — rigid-body kinematics, derived here
  v_B(0) = v_c + ω0 × (r_B(0) − r_c(0))
  ω_A(0) = ω_B(0) = ω0
```

### Independently computed initial kinetic energy
```
  KE_0 = ½·M·|v_c|² + ½·ω·I_composite·ω
       = ½·3.0·(0.70² + 0.30² + 0.45²) + ½·0.252·2.0²
       = ½·3.0·0.7825 + ½·0.252·4
       = 1.17375 + 0.504
       = 1.67775 J
```
**Predicted, stamped: `KE_0 = 1.67775 J`.** The witness recomputes it a second,
independent way — per body, `Σ ½ m|v_i|² + ½ I_i |ω_i|²` — and the two must agree to
**1e-12 relative**. The adapter's own `E_mech(0)` must agree with `1.67775 J` to
**1e-9 relative**; disagreement means the adapter's masses or inertias are not the
authored ones and everything downstream is void.

### The ANALYTIC RIGID-ASSEMBLY REFERENCE (§3's independent reference)

With no gravity, no contact and no external torque, a rigid assembly spinning about
a principal axis has an **exact closed-form** motion:

```
  R_ω(t)  = quaternion( axis ω̂0 , angle |ω0|·t )
  r_i(t)  = r_c(0) + v_c·t + R_ω(t) · ( r_i(0) − r_c(0) )       for i in {A, B}
  R_i(t)  = R_ω(t) ⊗ R_i(0)
```

This is computed **entirely from the stamped initial conditions above**, never from
anything the adapter reports.

**Declared analytic tolerances, with their derivation:**
```
  max_t | r_i^rapier(t) − r_i^analytic(t) |            ≤ 5e-3 m        [ANALYTIC-POS]
  max_t  angle( R_i^rapier(t) , R_i^analytic(t) )      ≤ 5e-3 rad      [ANALYTIC-ANG]
```
Derivation of 5e-3: the internal constraint is required by §2 to hold the connection
frames to `1e-3 rad`; each COM sits at most `R_max = 0.45 m` from the connection
point, contributing at most `R_max · 1e-3 = 4.5e-4 m` of position error from internal
error alone. The assembly turns `|ω0|·T = 2.0 · 10 = 20 rad` (≈ 3.18 revolutions), so
an accumulated integration phase error of `2e-4 rad` per radian turned contributes
`20 · 2e-4 = 4e-3 rad`, and `0.45 · 4e-3 = 1.8e-3 m`. Rounded up together: **5e-3**
for both. *These tolerances are requirements on the built thing, not predictions that
Rapier meets them.*

**Phase-free momentum references, which do not depend on the integration phase at all:**
```
  P(t) = Σ m_i · v_i(t)                                  predicted CONSTANT = M·v_c
  L(t) = Σ [ I_i · ω_i(t) + m_i·(r_i(t) − r_c(t)) × v_i(t) ]     about the system COM,
                                                         predicted CONSTANT

  |P(t) − P(0)| / |P(0)|                                ≤ 1e-3       [MOM-P]
  |L(t) − L(0)| / |L(0)|                                ≤ 1e-2       [MOM-L]
  |L(0)| predicted analytically = I_zz·|ω0| = 0.252·2.0 = 0.504 kg·m²/s
  | |L(0)|^measured / 0.504 − 1 |                       ≤ 1e-6       [MOM-L0]
```
`I_i` is the **analytic** `0.4·m·r²`, computed here from the authored sphere, not read
back from the engine. **Predicted, stamped: `|P(0)| = 3.0·|v_c| = 3.0·√0.7825 =
2.653912...` kg·m/s and `|L(0)| = 0.504 kg·m²/s`.**

## 3.5 F-BALL-PAIR — the moving, gravity-free, tumbling dynamic pair

Same bodies, same anchors, same `R_A(0)`, `R_B(0)`, `r_A(0)`, `r_B(0)` as F-FIXED-PAIR.
What changes is that **B is given a genuine relative spin**, which a ball permits:

```
  Δω     = Q0 · (0.9, −0.6, 1.3)   rad/s
  ω_A(0) = ω0
  ω_B(0) = ω0 + Δω
  v_A(0) = v_c + ω0 × (r_A(0) − r_c(0))                      [as F-FIXED-PAIR]

  the ball's VELOCITY constraint, derived independently:
      the world velocity of the shared connection point must agree,
      v_p    = v_A(0) + ω_A(0) × ( p_w − r_A(0) )
      v_B(0) = v_p    − ω_B(0) × ( p_w − r_B(0) )
  where p_w = r_c(0) + Q0·(0.25, 0, 0) is the connection point in world at t = 0.
```

`KE_0` for this fixture is computed per body from the values above:
`KE_0 = ½m_A|v_A|² + ½I_A|ω_A|² + ½m_B|v_B|² + ½I_B|ω_B|²`. It is **not** predicted
as a literal here because it depends on the derived `v_B`; the witness prints it, and
the adapter's `E_mech(0)` must agree with the independently computed value to
**1e-9 relative**.

## 3.6 F-FIXED-WORLD — the fixed-to-world case (§3 requires one)

```
  `anchorPost`  fixed kinematics, box 0.05 m half-extents, at world (0, 0, 0),
                rotation Q0
  `held`        sphere r = 0.10 m, mass 2.0 kg, dynamic,
                r_held(0) = Q0·(0.40, 0, 0),  R_held(0) = Q0 ⊗ Qrel
  fixed connection, connection point at world (0, 0, 0):
      anchorA = (0, 0, 0)                      [in the post's local frame]
      anchorB = Qrel⁻¹ · (−0.40, 0, 0)         [off-centre, in held's local frame]
      frameA  = identity,  frameB = Qrel⁻¹
  gravity 0, vacuum, both bodies start at rest.
  At tick 60 (t = 1.000 s) a recorded `push` intervention applies an impulse of
      J = (0.60, −0.50, 0.62) N·s   |J| = 1.0 N·s  (to 1e-9)
  at the body's centre of mass. The run continues to t = 10.000 s.
```

*(The impulse direction is `(0.60, −0.50, 0.62)`; its magnitude is
`√(0.36 + 0.25 + 0.3844) = √0.9944 = 0.99719...` N·s, which is within 0.3 % of
1 N·s and is used exactly as written — the literal is the fixture, the round number
is only its description.)*

**Requirements at the offered profile:**
```
  max_t | p_A(t) − p_B(t) |                            ≤ 1e-3 m      [FW-POS]
  max_t  theta(t)                                      ≤ 1e-3 rad    [FW-ANG]
```

**Non-vacuity control, mandatory:** the identical fixture with **the connection
removed** must, under the identical impulse, move
```
  | r_held(10 s) − r_held(0) |                         ≥ 0.5 m       [FW-CONTROL]
```
so "it did not move" is a result about the connection and not about the absence of
any cause.

## 3.7 §2 PRODUCT TARGETS — the requirements, restated exactly

At the **offered** profile, for F-BALL-PAIR, F-FIXED-PAIR and F-FIXED-WORLD:

```
  T1  max_t | p_A(t) − p_B(t) |                        ≤ 1e-3 m
  T2  max_t theta(t)          (FIXED variants only)    ≤ 1e-3 rad
  T3  max_t | E_mech(t) − E_mech(0) | / KE_0           ≤ 1 %
      (T3 applies to the two gravity-free MOVING fixtures, F-BALL-PAIR and
       F-FIXED-PAIR, whose KE_0 > 0 makes the denominator well defined. It is
       not applied to F-FIXED-WORLD, which starts at rest and is driven by a
       recorded external impulse — an intervention, so its energy identity is
       not a drift measurement.)
  T4  runtime cost, ms per public tick — REPORTED, no threshold set.
```

**These describe the tested fixtures above and nothing else. They are not a claim
about every assembly a user can build, and no existing construction is upgraded to
meet them.**

## 3.8 THE OFFERED PROFILE — SELECTION RULE, declared before any measurement

The ladder is the **existing, already-measured** supported set
`{4, 8, 16, 32, 64, 128}`. **No rung is added, no solver setting is changed, no
dependency is changed.**

> **THE OFFERED PROFILE IS THE LOWEST RUNG OF `SUPPORTED_SUBSTEPS` AT WHICH
> F-BALL-PAIR *AND* F-FIXED-PAIR BOTH MEET T1, T2 AND T3 OVER THE FULL 10.000 s.**
> If no rung meets them, **there is no offered profile**, §2 is a material miss,
> the dependent UI work is PAUSED, and the failure is retained and reported.

Every rung is measured and the whole ladder is reported, at minimum M = 4 (which
§2 requires be reported regardless) and the offered rung.

**Prediction, stamped: the offered profile will be M = 32.** This is a prediction
about the engine, not a criterion; a miss is recorded as a deviation and the offered
profile is whatever the ladder says. It is not asserted by any test.

---

# PART 4 — §3 DISCRIMINATING WITNESSES: A SUBSTITUTE MUST FAIL

## 4.1 The relative-rotation observable

```
  q_rel(t) = R_A(t)⁻¹ ⊗ R_B(t)
  u(t)     = logmap( q_rel(0)⁻¹ ⊗ q_rel(t) )  ∈ R³        [rad, the rotation vector
                                                            of the CHANGE in relative pose]
  M3       = Σ_t u(t) · u(t)ᵀ                              [3×3, symmetric PSD]
  λ1 ≥ λ2 ≥ λ3   the eigenvalues of M3
  SPREAD   = sqrt( λ2 / λ1 )                               [dimensionless, 0..1]
```

`SPREAD` is the second principal amplitude of the relative rotation as a fraction of
the first. A relative rotation confined to **one** axis has `λ2 ≈ 0`; one exploring
**two independent axes** does not.

## 4.2 BALL — allows rotation about at least two independent axes, anchors joined

```
  B1  max_t | u(t) |         ≥ 0.5 rad        the permitted motion is NONZERO
  B2  SPREAD                 ≥ 0.05           at least TWO independent axes
  B3  max_t | p_A − p_B |    ≤ 1e-3 m         while the anchors remain JOINED
```

**B1 is the anti-freeze guard: a build that froze everything fails it.**

## 4.3 THE HINGE SUBSTITUTE MUST FAIL B2

The substitute is built **under its own best conditions**, not sabotaged: the same
bodies, the same anchors, the same `Q0`/`Qrel`, but a `hinge` about the assembly-local
z axis (`axis = (0, 0, 1)` in both local frames — which, given `Qrel` is a rotation
about y, is NOT the same local direction in both bodies, so the substitute is built
with `Q0`-consistent local axes: `axisA = (0,0,1)`, `axisB = Qrel⁻¹·(0,0,1)`), and
with an initial relative spin **compatible with the hinge**: `Δω_hinge = Q0·(0,0,1.3)`,
i.e. along the hinge axis only, so the hinge's own position and velocity constraints
are satisfied at t = 0 exactly as the ball's are.

```
  H1  max_t | u(t) |         ≥ 0.5 rad        the substitute is NOT frozen either
  H2  SPREAD                 <  0.01          it CANNOT reach a second axis
```

**H2 is the failure of the ball criterion B2 by a factor of at least 5.** A witness
that a hinge could pass would not be discriminating and would be void.

## 4.4 FIXED — retains a non-identity relative pose while the assembly moves

```
  F1  angle( q_rel(0) ) = 35° = 0.610865... rad,  NON-IDENTITY          (by construction)
  F2  max_t theta(t)              ≤ 1e-3 rad     the pose is RETAINED
  F3  | r_c(10 s) − r_c(0) |      ≥ 5 m          the assembly really MOVES
      (predicted 10·|v_c| = 8.848... m)
  F4  total turn of body A        ≥ 6.28 rad     the assembly really ROTATES
      (predicted |ω0|·T = 20 rad)
  F5  max_t | p_A − p_B |         ≤ 1e-3 m
```

**F3 and F4 are the anti-freeze guard for the fixed case.**

## 4.5 THE BALL SUBSTITUTE MUST FAIL F2

The substitute is the **identical fixture** F-FIXED-PAIR with the connection's `kind`
changed to `ball` (dropping the frames, which a ball does not carry) and **nothing
else changed** — same bodies, same anchors, same initial positions, velocities and
angular velocities, all of which satisfy a ball's position and velocity constraints
exactly, so the substitute is not sabotaged.

```
  S1  max_t theta_substitute(t)   ≥ 1e-2 rad     FAILS F2 by at least a factor of 10
```

`theta` for the substitute is computed with **the same frames the fixed connection
declared**, since a ball declares none — it is the *relative pose* being measured,
which is defined for both.

## 4.6 The independent reference requirement

**§3 requires an analytic rigid-assembly reference or an independent
momentum/kinematic calculation for at least one moving case, and states explicitly
that reading the adapter's own fields back is insufficient.** F-FIXED-PAIR carries
BOTH: the closed-form `[ANALYTIC-POS]`/`[ANALYTIC-ANG]` of §3.4 and the phase-free
`[MOM-P]`/`[MOM-L]`/`[MOM-L0]` of §3.4. Both are computed from the stamped initial
conditions and the authored masses and radii alone.

## 4.7 No owned dissipation, on every fixture

```
  D1  budget.dissipatedDrag + budget.dissipatedSpringDamper  ==  0   exactly
  D2  registry.contributions.length                          ==  0   at every tick
  D3  foreignAccumulatorWrites                               ==  0
```
The whole energy deficit therefore lands in **UNATTRIBUTED**, and **not one joule of
it is called heat.**

---

# PART 5 — §5 PERSISTENCE: THE EXTENDED MUTATION MATRIX

The existing frozen inventory is **79**. It is extended, **not replaced**, and the
existing non-vacuity controls — the "valid complete schema and all variants
round-trip" test and the explicit unknown-field / nonfinite / dangling-id refusals —
stay in place and are extended to the new variants.

**Declared new obligations, enumerated before they were written:**

| # | group | count |
|---|---|---|
| a | `ball` connection: `id`, `kind`, `bodyA`, `bodyB` | 4 |
| b | `ball` connection: `anchorA.{x,y,z}`, `anchorB.{x,y,z}` | 6 |
| c | `fixed` connection: `id`, `kind`, `bodyA`, `bodyB` | 4 |
| d | `fixed` connection: `anchorA.{x,y,z}`, `anchorB.{x,y,z}` | 6 |
| e | `fixed` connection: `frameA.{x,y,z,w}`, `frameB.{x,y,z,w}` | 8 |
| f | `fixed`: a **norm-preserving, alignment-preserving** joint re-framing of `frameA` **and** `frameB` together — must be **DETECTED**, not refused | 1 |
| g | `ball` given an `axis` field — must be REFUSED | 1 |
| h | `fixed` given an `axis` field — must be REFUSED | 1 |
| i | `hinge` with `axis` removed — must be REFUSED | 1 |
| j | `fixed` with `frameB` removed — must be REFUSED | 1 |
| k | `ball` `kind` changed to `fixed` with no frames supplied — must be REFUSED | 1 |
| | **new total** | **34** |

**DECLARED TOTAL: 79 + 34 = 113 obligations, each detected or explicitly refused.**
Group (f) exists specifically so the frame fields cannot pass the matrix by being
refused for a broken norm: it must round-trip through the validator and come out as
a **different construction**, proving the frames are inside canonical identity.

**Other §5 obligations, each its own witness:**

* **P1** legacy compatibility: a **frozen literal JSON document** written in the
  pre-batch-2 schema (hinge + slider, `axis`, no frames, no `numerics`) loads,
  validates, builds, and yields the same joint descriptors it always did.
* **P2** save after evolution still saves the **starting** connection: build a
  connected scene, run it 60 ticks, save — the saved document's connection
  descriptors equal the authored ones exactly (canonical bytes).
* **P3** delete a connected body removes its live **and** saved connections, and
  there is **no ghost after reopen**: neither `sim.jointDescs()` nor the reloaded
  document names it.
* **P4** reopen, checkpoint and captured-base replay preserve **connection
  descriptors and numerical profile** through their existing separate boundaries:
  the joint line of `canonicalSimState` and `constructionSubsteps` agree before and
  after each boundary.
* **P5** **changing only a connection field appears in comparison provenance**: two
  captures of the same scene differing **only** in `joints[0].anchorB.y` are
  compatible for overlay, and `differences()` names
  `scene.joints.0.anchorB.y: <old> → <new>` and nothing else.
* **P6** no engine handle appears anywhere in an authored document carrying the new
  variants — the existing `parseConstruction` handle screen still fires.
* **P7** atomic refusal: an edit that would produce a nonfinite anchor, a
  non-unit frame quaternion, a dangling body id, or a misaligned connection leaves
  `AuthoringSession.identity` and the audit **unchanged**.

---

# PART 6 — §4/§6 UI, and what "drive the real controls" means here

The dependent UI, **written only after the §2 probes pass**, must let the author,
through the actual page:

1. select **two distinct bodies** and a **connection type** (ball / fixed);
2. give the attachment locations **in the explicitly named frame** of §1.2 —
   the label must name the frame, not merely say "local";
3. create, edit, delete and **cancel**, each through a real control;
4. see a **visible refusal** carrying the measured `d0` in metres (and `theta0` in
   radians for fixed) when the connection is misaligned, and see the alternative
   **authored placement operation** offered;
5. see, for a `fixed` connection, the **preserved intended initial relative pose**
   reported as an angle, and the derived frames.

The builder then, on screen: builds a **ball-connected experiment** and a **fixed
assembly**, runs both, edits, **saves after evolution**, reopens, deletes a
connected body, and captures/replays one comparison **whose named difference is a
connection field** — observing **geometry and motion**, not only DOM text.

---

# PART 7 — WHAT IS *NOT* CLAIMED

* Nothing here is a claim about **any** assembly a user can build. The §2 numbers
  are about the three stamped fixtures at the stamped profile.
* Nothing here establishes anything about **the hinge**, about Rapier in general, or
  about any future mechanism. The retained pendulum red is untouched and is not
  explained, excused or generalised by anything measured here.
* **No energy-conservation claim is made.** T3 is a bound on a measured drift over a
  finite 10.000 s window on three fixtures, and bounds nothing outside it.
* No thermal, circuit, pulley, gear or cradle behaviour is added or implied.
* No new hinge or slider authoring UI is added.
* No dependency, no solver setting and no existing tolerance is changed.
