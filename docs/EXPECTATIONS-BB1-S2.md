# Breadth batch 1, STAGE TWO — pre-run reference cards

Against `bridge/BREADTH-BATCH-1.md` and `bridge/ACCEPTANCE-RULES-v1.md`, and the
reviewer's ruling on demo 2's returned hinge fidelity.

**Written and stamped BEFORE any stage-two code was written and BEFORE any
stage-two witness was run.** Two things were already measured before this file
existed and are named as measurements, never as predictions: the FIXTURE SCAN of
the pendulum scene, and the bounded M-ladder the reviewer commissioned (M = 4, 8,
16 retained; 32, 64, 128 added; stopped at 128). Those are *diagnostics against
criteria that were stamped on 2026-09-06*, not new expectations. **No tolerance
anywhere in `EXPECTATIONS-BB1-S1.md` is moved by this file, no amplitude case is
deleted, and no amplitude range is shrunk.**

---

# PART A — DEMO 2's HINGE: A DECLARED NUMERICAL PROFILE

## A.0 What is and is not being claimed

The ruling cut a false dilemma: four internal sub-steps was a **selected
configuration**, not a law of this project. Public tick and input semantics stay
exactly as they are — 1/60 s, `(tick, seq)`-keyed. What changes is that a
construction may **declare** its fixed internal sub-division, and that the
declaration is **recorded, restored, compared and refused-when-unsupported** like
any other authored content.

Replay promises the same result from the same initial state, the same input **and
the same numerical configuration**. It does not promise that a coarse and a
refined solver walk the same trajectory. **Old recordings keep their old
configuration**: a construction with no declared profile means M = 4, forever.

**The M = 4 result is not repaired by this and is not withdrawn.** C2.2 and C2.3
stay in the suite asserted at M = 4, still red, still reported as RETURNED. What
is offered is a corrected implementation for the *scene*, with the pre-correction
failure retained verbatim.

**Period accuracy does not validate energy preservation and is not offered as
evidence of it.** See A.4.

## A.1 The profile as authored content

- **P-A1 default is legacy.** A `Construction` with no `numerics` field builds at
  `SI.SUBSTEPS = 4`. A construction that explicitly declares `{ substeps: 4 }`
  produces **byte-identical** `canonicalSimState` to the same construction with
  the field absent, over 300 ticks — so the default is not merely "about the
  same" as the old behaviour, it is that behaviour.
- **P-A2 refusal, never substitution.** A construction naming a sub-step count
  outside the declared supported set is **REFUSED at build**, with a message
  naming the offending value and the supported set. The world is not built at
  some other M and no fallback is applied. Supported set, declared here:
  **{4, 8, 16, 32, 64, 128}** — the ladder actually measured, and nothing else.
- **P-A3 canonical comparison.** `canonicalSimState` carries the live sub-step
  count **and** the construction's declared profile. Two runs of the same scene
  that differ only in declared profile produce **different** canonical bytes.
- **P-A4 old-profile replay is unchanged.** A legacy pendulum record (no
  `numerics`) replayed twice is byte-identical to itself, runs at `subSteps = 4`,
  and is byte-identical to the pre-change manual path (`sim.subSteps = 4` set by
  hand on a legacy construction). The 52 pre-existing tests and the whole
  stage-one suite stay green, which is the independent evidence that no old
  behaviour moved.
- **P-A5 mid-run restore at the new profile continues correctly.** A checkpoint
  taken mid-run of a scene whose declared profile is not 4, restored into a
  **desynchronised** world (a different construction, stepped a different number
  of ticks), continues **byte-identically** to the unbroken run at every
  comparison tick. Without the profile in the checkpoint this fails, because the
  restored world would silently continue at 4.
- **P-A6 guards use the ACTUAL internal h.** The spring resolvability guard, the
  per-spring UI maxima and the hand's controller margin are computed from the
  live `h = 1/(60·M)`, not from the module constant. At M = 128,
  `h = 1/7680 s`, so `omega_n <= 0.30/h = 2304 rad/s` and
  `gamma <= 0.05/h = 384 s^-1`, against 72 rad/s and 12 s^-1 at M = 4. A regime
  refused at M = 4 and admissible at M = 128 is refused and admitted accordingly.

## A.2 The period criteria — THE STAMPED ONES, UNMOVED

- **P-A7.** With the pendulum scene's declared profile, the **original** C2.2 and
  C2.3 hold: the measured period is within **1.0 %** of the exact rigid-pendulum
  period `T0·(2/π)·K(sin(θ0/2))` at θ0 = 3°, 30°, 60°, 90° and 120°, and
  `T(90°)/T0 − 1 > 15 %`, `T(120°)/T0 − 1 > 30 %`. Same measurement method as
  card 2: linear-interpolated zero crossings of θ sampled once per public tick,
  mean over the first 6 whole periods.
- **P-A8 continuum evidence is retained, not replaced.** The measured period is
  reported against the **exact continuum reference** at every amplitude and at
  every rung of the M ladder, with the refinement trend. Agreement with a
  discrete map is diagnostic; it is not a substitute for the continuum
  comparison, and the continuum comparison is what C2.2 asserts.

## A.3 Cost

- **P-A9.** On the **rendered** pendulum scene in the browser at the declared
  profile: mean physics **< 16.67 ms/tick** (the existing budget from
  `EXPECTATIONS.md` §F), reported against the **8 ms warning line**, with the
  count of dropped ticks reported. Reported, not predicted: display fps.

## A.4 Energy — retained, qualified, and NOT converted into a claim

- **P-A10.** The free-spin witness stays. With zero gravity and no torque of any
  kind, the hinge's kinetic-energy change is still **negative** at every rung
  including the declared profile, the whole of it still lands in
  **UNATTRIBUTED**, owned dissipation is still identically **zero**, and **not
  one joule is called heat**.
- **P-A11.** The measurement is over a **finite 11 s window** and says so. It
  bounds nothing beyond that window and is not evidence of long-term behaviour.
  **The adapter is not described as energy-conserving anywhere.** If the declared
  profile still shows a material loss it is reported **alongside** the period
  result, in the same panel and the same report line, not in a footnote.
- **P-A12 the refinement rate is stated no more precisely than the data show.**
  `EXPECTATIONS-BB1-S1-A1.md` §3(b) said "halving `h` roughly halves the loss".
  The ratios of successive log-decrements are to be reported explicitly, and
  `DEVIATIONS.md` D-29 is to be corrected wherever it states a rate the data do
  not support. **A1 itself is stamped and is NOT edited.**

## A.5 Narrowness of the conclusion — binding on the report

This evidence isolates a defect of **this configured hinge simulation**: this
adapter, this fixture, this solver configuration, this step. It does **not**
establish a universal Rapier limitation, does **not** rule out every other
adapter or fixture issue, and does **not** establish that any future hinged
mechanism behaves the same way.

---

# PART B — DEMOS 4, 5, 6

## The scheme, unchanged

Public tick 1/60 s; internal fixed sub-step `h = 1/(60·M)`, engine `timestep`
stored as **f32**, `numSolverIterations = 1`, `numInternalPgsIterations = 1`, our
forces cleared and rebuilt before every sub-step. **Demos 4, 5 and 6 all declare
M = 4** — the profile under which contact and drag were validated. Only the
pendulum declares a finer one. Semi-implicit (symplectic) Euler per sub-step:
`v <- v + h a`, then `x <- x + h v`, so a constant-acceleration body satisfies
**exactly** at sub-step boundaries

    v(t) = v0 + a t          s(t) = v0 t + ½ a (t² + h t)

**Engine assumption, declared once, and probed rather than assumed:** Rapier's
default coefficient combine rule for **both** friction and restitution is
**Average** (`CoefficientCombineRule.Average = 0`, read back from the engine). All
fixtures below give **both** colliders of a pair the **same** coefficient, so the
effective pair coefficient equals that coefficient under Average, Min and Max
alike, and any observed value of `e²` or `μ²` would falsify the assumption rather
than hide inside it.

**Nothing below is a material claim.** `μ` and `e` are parameters of a **generic
mechanical preset**. They are not properties of any named material, and no
real-material behaviour is promised from them.

---

## CARD 4 — TWO-BODY COLLISION, a controlled ISOLATED PAIR

**Fixture (`scene: collision`).** Vacuum. **`g = (0, 0, 0)`** — declared, so the
pair is genuinely isolated and total momentum is conserved *exactly*, for all
time, not just across the impact. A ground slab exists **for visual reference
only** at y ∈ [−1, 0]; with zero gravity nothing ever reaches it, and the witness
asserts **zero contacts with anything but the two balls**.

Two spheres, both r = 0.25 m, in the XY plane at y = 1.0, z = 0:

| body | m (kg) | x0 (m) | v0 (m/s) | restitution |
|---|---|---|---|---|
| `ballA` | 1.0 | −1.20 | +3.0 | e |
| `ballB` | 2.0 | +1.20 | −1.0 | e |

Gap at t = 0 is `2.40 − 0.50 = 1.90 m`; closing speed `u = 4.0 m/s`; **geometric
contact at t = 1.90/4.0 = 0.4750 s**. This is NOT a many-body cradle: two bodies,
one impact, one line of motion.

**Analytic reference — 1-D isolated pair, coefficient of restitution e.**

    v_A' = [ (m_A − e m_B) v_A + m_B (1+e) v_B ] / (m_A + m_B)
    v_B' = [ (m_B − e m_A) v_B + m_A (1+e) v_A ] / (m_A + m_B)

    p      = m_A v_A + m_B v_B          = **+1.0000000 kg·m/s**   (conserved, always)
    v_cm   = p / (m_A + m_B)            = **+0.3333333 m/s**
    mu     = m_A m_B / (m_A + m_B)      = 0.6666667 kg
    u      = v_A − v_B                  = 4.0 m/s
    KE_0   = ½ m_A v_A² + ½ m_B v_B²    = **5.5000000 J**
    KE_cm  = ½ mu u²                    = **5.3333333 J**   (the destructible part)
    KE_com = ½ (m_A+m_B) v_cm²          = **0.1666667 J**   (untouchable)
    KE_1   = e² KE_cm + KE_com          (so KE_1/KE_0 depends on e alone)

**Derived before running:**

| e | v_A' (m/s) | v_B' (m/s) | KE_1 (J) | KE_1/KE_0 | loss (J) |
|---|---|---|---|---|---|
| 0.6 | **−1.2666667** | **+1.1333333** | **2.0866667** | **0.3793939** | 3.4133333 |
| 1.0 | **−2.3333333** | **+1.6666667** | **5.5000000** | **1.0000000** | 0 |

**Declared measurement times.** Incoming state at **t = 0.25 s** (tick 15), well
before contact. Outgoing state at **t = 1.00 s** (tick 60), well after: the pair
separates at `|v_B' − v_A'| = e·u`, so at e = 0.6 they are 1.26 m further apart
by t = 1.0 s and cannot re-contact. Total run **120 ticks = 2.0 s**.

**Tolerances.** The momentum bound is a **derivation**: the solver applies equal
and opposite impulses, so the only error is the f32 round trip of mass and
velocity. The restitution bounds are **declared engineering judgement, stated as
such in advance**: the impulse solver's realised restitution at one velocity
iteration is not derivable a priori.

**Pass/fail.**

- **C4.1** `|p(t) − 1.0000000|` ≤ **1e-4 kg·m/s** at **every** tick of the run,
  and `|p_y|`, `|p_z|` ≤ 1e-4 likewise. Momentum, not just "momentum after".
- **C4.2** measured effective restitution
  `e_meas = −(v_B' − v_A')/(v_B − v_A)` is within **±0.05** of the authored e,
  at e = 0.6 **and** at e = 1.0.
- **C4.3** at e = 0.6, `v_A'` and `v_B'` are each within **5 %** of the table.
- **C4.4** at e = 0.6, `KE_1/KE_0` is within **±0.05 absolute** of 0.3793939 and
  is **strictly less than 1**. At e = 1.0 it is within **±0.05** of 1.0.
- **C4.5 the isolated-pair condition is asserted, not assumed:** over the whole
  run, contacts involving anything other than the two balls = **0**, world
  gravity is exactly zero, owned dissipation (drag + spring damper) is
  identically **0 J**, and the registry applies **no** user force.
- **C4.6 the inelastic loss is NOT relabelled.** At e = 0.6 the 3.41 J is a real
  physical loss of a real inelastic collision, but this build has no owned
  contact-dissipation channel and does not estimate one: the deficit lands in
  **UNATTRIBUTED**, which the panel already labels an observation limit. **It is
  not booked as owned dissipation and it is not called heat.**

## CARD 5 — INCLINED-PLANE SLIDE

**Fixture (`scene: incline`).** Vacuum, `g = 9.81 m/s²` down. A **fixed** ramp
box, half-extents (2.0, 0.08, 0.8), centre (0, 1.0, 0), rotation `R_z(−θ)`. A
**dynamic** block, half-extent 0.12 m, **m = 2.0 kg**, restitution 0, rotation
`R_z(−θ)`, started **at rest, flush on the surface** at ramp-local
`u0 = −1.5 m`, i.e. centre `= C + R_z(−θ)·(u0, 0.08, 0) + 0.12·n`.

    n = R_z(−θ)·(0,1,0) = ( sin θ,  cos θ, 0)      surface normal
    d = R_z(−θ)·(1,0,0) = ( cos θ, −sin θ, 0)      DOWN-slope unit vector

At θ = 25°: `sin θ = 0.42261826`, `cos θ = 0.90630779`, `tan θ = 0.46630766`;
block centre = **(−1.27493804, 1.81518894, 0) m**.

### The FRICTIONLESS reference comes first

Both colliders carry **friction 0**, so the pair coefficient is 0 under any
combine rule. Along-slope acceleration is then `a = g sin θ`, and the block's
motion along `d` is constant-acceleration, so the discrete map above applies
exactly.

    theta = 25 deg:  a = 9.81 · 0.42261826 = **4.14588513 m/s²**
    theta = 15 deg:  a = 9.81 · 0.25881905 = **2.53901488 m/s²**

At θ = 25°, with `h = fround(1/240) s`:

| t (s) | v = a t (m/s) | s continuum ½at² (m) | s this scheme ½a(t²+ht) (m) |
|---|---|---|---|
| 0.5 | **2.0729426** | 0.5182356 | **0.5225543** |
| 0.8 | **3.3167081** | 1.3266832 | **1.3335930** |

- **C5.1** along-slope displacement at t = 0.5 s and t = 0.8 s within **3 %** of
  the **this-scheme** column, with the continuum column reported alongside and
  the `−½ a h t` offset named.
- **C5.2** along-slope acceleration by ordinary least squares on `v(t)` over
  **[0.20, 0.80] s** is within **2 %** of `g sin θ`, at **θ = 25° and θ = 15°**.
  The continuum value is the reference; the scheme's own `v(t) = a t` is exact,
  so C5.2 is a continuum comparison with no discrete correction to apply.
- **C5.3 the block stays on the plane:** `|(r(t) − r(0))·n|` ≤ **0.010 m** over
  the run, reported. Rapier's own `normalizedAllowedLinearError` is 0.005 m and
  is quoted in the panel, so the reader can see what the number is against.
- Duration 54 ticks (0.9 s); the ramp is long enough that the block travels
  1.33 m of an available ~3.3 m and never leaves it.

### Friction, added ONLY with the engine/model assumption stated

**Model:** Coulomb, `a = g (sin θ − μ cos θ)` **while sliding**, and no motion at
all while `tan θ ≤ μ`. **Engine assumption:** Rapier resolves friction as a
per-contact-point impulse clamped to the cone `|λ_t| ≤ μ λ_n`, by projected
Gauss–Seidel at one velocity iteration; the pair coefficient is the **Average**
combine of the two colliders', and both are authored equal. Rapier does not
implement a distinct static coefficient, so **`μ_s = μ_k` in this build** and no
stick–slip distinction is claimed.

    theta = 25 deg, mu = 0.30:
      a = 9.81 (0.42261826 − 0.30 · 0.90630779) = 9.81 · 0.15072592 = **1.47862128 m/s²**

- **C5.4** with μ = 0.30 at θ = 25° the OLS along-slope acceleration over
  [0.20, 0.80] s is within **5 %** of 1.47862128 m/s². **The wider band is a
  declared judgement, not a derivation**: a discrete impulse cone at one
  iteration has an error this card cannot derive in advance.
- **C5.5 the discriminating pair, at ONE coefficient.** With the **same**
  μ = 0.30, the block **slides** at θ = 25° (`tan θ = 0.4663 > μ`) and **does not
  slide** at θ = 15° (`tan θ = 0.2679 < μ`): along-slope displacement over 2.0 s
  stays below **0.02 m**. A third case, μ = 0.60 at θ = 25°
  (`tan θ = 0.4663 < μ`), likewise stays below 0.02 m.
- **NOT PROMISED, stated in the panel as well as here:** no angle of repose of
  any real material is measured or claimed. The transition is bracketed between
  15° and 25° at μ = 0.30 and **is not resolved to an angle**; friction depends
  on the pair and on conditions, and one generic coefficient does not determine
  a material.

## CARD 6 — AIR / DRAG-FREE FALL COMPARISON

**This card spends no fresh validation cycle on drag.** The drag law, its
orientation-averaged area convention, `k = ½ρ C_d A_eff`, and the terminal-speed
result are **already validated** as A0–A5 of `EXPECTATIONS.md` and are reused
unchanged. Demo 6's job is to **expose the comparison interactively**, and its
new assertions are only about the comparison.

**Fixture (`scene: fall`).** Medium **air** (ρ = 1.225 kg/m³), `g = 9.81 m/s²`.
Two **identical** spheres, r = 0.12 m, m = 0.15 kg, released from rest at
**y = 50 m**, at x = −0.9 and x = +0.9 so both are visible and neither can touch
the other.

- `airBall` — default sphere `C_d = 0.47`.
- `freeBall` — **authored `C_d = 0`**, which makes its drag force identically
  zero. That is the **same equation of motion as vacuum for this body**, and the
  UI says exactly that: it is a drag-free body in an air world, **not** a second
  vacuum world.

    A_eff = pi r²                         = **0.045238934 m²**
    k     = ½ · 1.225 · 0.47 · A_eff      = **0.013023158 kg/m**
    v_t   = sqrt(m g / k)                 = **10.629724 m/s**
    tau   = v_t / g                       = **1.0835600 s**

**Closed forms (continuum), the already-validated ones:**

    v_air(t) = v_t tanh(t/tau)            y_air(t)  = y0 − (v_t²/g) ln cosh(t/tau)
    v_free(t) = g t                       y_free(t) = y0 − ½ g (t² + h t)   (this scheme, exact)

**At t = 2.5 s (150 ticks), derived before running:**

| quantity | drag-free | air |
|---|---|---|
| speed (m/s) | **24.525000** (exact) | **10.421184** (continuum) |
| drop (m) | **30.707344** (this scheme) | **18.704834** (continuum) |
| | 30.656250 (continuum) | 18.726545 (+½ h v, leading discrete correction) |
| y (m) | 19.292656 | 31.273455 |

Ratio of drops **1.6417**, ratio of speeds **2.3532**. Neither ball reaches the
ground, by 19 m.

**Pass/fail.**

- **C6.1** the drag-free ball matches `y_free(t)` at every per-tick sample to
  **1e-2 m** and `v_free(t)` to **1e-3 m/s**. Those bounds are f32 accumulation
  over 600 sub-steps at |y| up to 50 m, declared as such, not a physics claim.
- **C6.2** the air ball's speed at 2.5 s is within **1.0 %** of 10.421184 m/s and
  its drop within **1.0 %** of 18.726545 m. Same tolerance class as the already
  validated A1; the finite-step correction for quadratic drag has no closed form
  and none is asserted.
- **C6.3 the discriminator: the two bodies differ ONLY by the drag term.**
  Rebuild the identical scene with `medium = vacuum` and run 150 ticks; the two
  balls' `y` and `v_y` then agree to **1e-9 m** and **1e-9 m/s**, and whether
  they are bit-identical is **reported**. In air they must differ by more than
  10 m at 2.5 s. One knob, two behaviours.
- **C6.4** owned dissipation in air is **positive and equal to the drag work
  booked by the existing accounting**, and the drag-free ball contributes
  **exactly 0 J** of it. Nothing is called heat that was not booked as drag work
  by the existing path.

---

# Shared capability — what is REUSED and what is ADDED

**Reused unchanged:** `SimWorld` and its force-registry discipline, the energy
budget and UNATTRIBUTED, the joint adapters, `Recorder`/checkpoint/replay, the
scene selector and its `worldReplaced` boundary, the `Meter` ring buffer and its
one plot, `drag.ts` in full, and demo 1's discrete free-fall map.

**Added, each with a named consumer, and a SECOND consumer before reuse is
claimed:**

- **S2-1 an axis-referenced measurement.** One new reference kind
  `bodyAlongAxis { entityId, point, axis }` and one new world kind
  `worldAlongAxis { axis }`, with three catalogue rows: `along.disp` (m),
  `along.vel` (m/s) and `p.along` (kg·m/s, summed over dynamic bodies).
  **Consumer 1: demo 5** (down-slope displacement and speed on a tilted axis).
  **Consumer 2: demo 4** (`along.vel` per ball and `p.along` for the pair, on the
  +X axis). Still a **closed enumerated catalogue** — three rows, no expression
  language, no ruler-and-protractor suite.
- **S2-2 the declared numerical profile.** `Construction.numerics`, carried
  through build, checkpoint, restore and canonical comparison, refused when
  unsupported. **Consumer 1: demo 2's pendulum scene.** **Consumer 2: the
  witnesses**, which drive the M ladder through the same declared field instead
  of poking `sim.subSteps` behind the construction's back.

- **S2-3** the plot gains **no** new machinery. Demos 4, 5 and 6 supply an
  `AnalyticReference` exactly as demos 1–3 do.

# What is NOT in stage two

Ball and fixed joint wrappers. Named material presets. Any decomposition of joint
or contact constraint work. Any angle-of-repose claim. Any energy-conservation
claim for the hinge. Any change to the public tick, to input keying, or to
`numSolverIterations`.
