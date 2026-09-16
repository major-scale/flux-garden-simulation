# Breadth batch 1, STAGE ONE — pre-run reference cards

Against `bridge/BREADTH-BATCH-1.md` (sha256 `7b17a133…`) under
`bridge/ACCEPTANCE-RULES-v1.md` (sha256 `c59d5dc0…`).

**Written and stamped BEFORE any of stage one was implemented and BEFORE anything
was run.** Every number below is derived here from the engine's integration scheme
and from textbook mechanics. Nothing is copied from an output. Where a quantity
cannot be derived a priori (the impulse solver's own constraint error) that is said,
and the tolerance is declared as an engineering judgement rather than dressed up as
a derivation.

---

## 0 · The scheme, once, since all three cards use it

One public tick is 1/60 s and is advanced as `SUBSTEPS = 4` internal fixed sub-steps
of `h = 1/240 s`, with Rapier's own sub-division pinned to `numSolverIterations = 1`
and our force laws rebuilt from the current state before every sub-step
(`world.ts`, D-8). For a body with no user force the engine's per-sub-step update is
therefore **semi-implicit (symplectic) Euler**:

    v <- v + h a        then       x <- x + h v

Rapier stores `timestep` as **f32**, so the effective step is `Math.fround(1/240)`;
that differs from 1/240 by 2.2e-10 s and is negligible against every tolerance below,
but the witnesses use the f32 value where a discrete prediction is asserted exactly.

Positions, velocities and masses round-trip the engine in **f32**, so no prediction
below is asserted tighter than ~1e-6 relative.

**Gravitational potential energy reference, declared:** `U_grav = -m (g · r)` with the
**datum at the world origin** (`GRAVITY_PE_DATUM_Y = 0`, `units.ts`), for whatever the
current gravity vector is. This is the reference against which the gravity-edit
accounting below is stated.

---

## CARD 1 — Vacuum projectile

**Fixture (`scene: projectile`).** Vacuum. `g = (0, -9.81, 0) m/s²`. One dynamic
sphere `shot`, r = 0.09 m, m = 0.4 kg, launched with its **centre of mass** at
`(-4.00, 1.20, 0)` and velocity `v0 = 12 m/s` at `theta` above +X in the XY plane.
Ground top face at y = 0, far below the measured flight.

**Declared launch/landing conditions.** Launch = the instant the launch velocity is
applied, COM at y0 = 1.20 m. **Landing = the COM's return to y = y0**, NOT ground
contact. The body is in free flight over the whole measured interval: no contact, no
drag, no user force. Range is measured along X between those two instants.

**Analytic reference (continuum).**

    T_c = 2 v0 sin(theta) / g          R_c = v0² sin(2 theta) / g
    H_c = (v0 sin theta)² / (2 g)      (apex above launch)

**Analytic reference (this scheme, derived).** With semi-implicit Euler and constant
a = g, after n sub-steps `v_y = v_y0 - g n h` and

    y(t) = y0 + v_y0 t - ½ g (t² + h t)          x(t) = x0 + v_x t     (exact at t = n h)

so the discrete trajectory is the continuum parabola plus `-½ g h t`, and

    T_d = T_c - h          R_d = R_c - v_x h          H_d = (v_y0 - g h / 2)² / (2 g)

**These are the numbers, at theta = 40 deg, h = 1/240 s:**

| quantity | continuum | this scheme (derived) | scheme error |
|---|---|---|---|
| flight time | 1.5725691 s | **1.5684024 s** | −0.2650 % |
| range | 14.455894 m | **14.417591 m** | −0.2650 % |
| apex above launch | 3.0324837 m | **3.0164353 m** | −0.5292 % |

**Range vs launch angle, derived before running** (`R_d = R_c − v_x h`):

| theta | R_c (m) | R_d (m) |
|---|---|---|
| 15 | 7.336427 | 7.288129 |
| 30 | 12.711835 | 12.668533 |
| 40 | 14.455894 | 14.417591 |
| 45 | 14.678899 | 14.643544 |
| 60 | 12.711835 | 12.686835 |
| 75 | 7.336427 | 7.323903 |

**Discriminating consequence, asserted:** the textbook 30°/60° range equality is
**broken** by this scheme by exactly `(v_x(30) - v_x(60)) h = 0.0183013 m`, with the
**60° shot going further**. A build that silently used the continuum formula, or an
exactly energy-conserving integrator, would not show this.

**Measurement.** The trajectory is sampled once per **public tick** (t = n/60, always
a sub-step boundary). The landing crossing is located by **quadratic interpolation
through the three samples bracketing it** — exact for a function that is quadratic in
t, which the discrete trajectory provably is; the linearly-interpolated crossing is
also reported, with its derived bias `|y''| Δt² / (8 |v_y|) = 4.4e-5 s`.

**Pass/fail.**

- **C1.1** every per-tick sample over the flight matches `x(t), y(t)` above within
  **1e-4 m** absolute.
- **C1.2** quadratic-interpolated flight time = **1.5684024 s ± 1e-4 s**; range =
  **14.417591 m ± 1e-3 m**.
- **C1.3** every row of the angle table matches within **1e-3 m**, and
  `R(60°) − R(30°) = +0.0183013 m ± 2e-4 m`.
- **C1.4** apex above launch = **3.0164353 m ± 1e-3 m** (sampled maximum refined by
  quadratic interpolation).

**AIR — an explicitly NUMERICAL comparison, no closed form claimed.** The same launch
with `medium = air` uses the build's provisional quadratic-drag effective law
(`drag.ts`), which has an orientation-averaged area convention and no closed-form
trajectory. **No analytic range is predicted for it and none will be asserted.** Only
two qualitative, falsifiable statements are made, plus reported numbers:

- **C1.5** air range < vacuum range, by more than 5 %.
- **C1.6** the flight is **asymmetric**: time from launch to apex is strictly less
  than time from apex to landing (quadratic drag decelerates the ascent and retards
  the descent).
- reported, not predicted: the air range, the deficit, the two leg times.

**Duration.** 100 public ticks (1.667 s) per shot; 6 shots for the angle sweep.

---

## CARD 2 — Simple pendulum on a HINGE

**Fixture (`scene: pendulum`).** Vacuum, `g = 9.81 m/s²`. A fixed `pivot` body at
`(0, 2.00, 0)`. A dynamic sphere `bob`, **r = 0.06 m, m = 1.0 kg**. A **HINGE**
(Rapier revolute impulse joint) with axis `(0,0,1)`, anchor `(0,0,0)` on the pivot and
`(0, +0.60, 0)` on the bob, so **L = 0.60 m** and the bob swings in the XY plane.
Released from rest at angle `theta0` from the downward vertical, with the bob's pose
set to `pivot + L (sin theta0, -cos theta0, 0)` and its rotation `R_z(theta0)`, so the
joint is satisfied exactly at t = 0.

**This is a PHYSICAL pendulum, not a point mass, and is treated as one.** The revolute
joint ties the bob's orientation to the arm angle, so the sphere co-rotates and

    I_pivot = (2/5) m r² + m L²
    T0 = 2 pi sqrt( (0.4 r² + L²) / (g L) )

    0.4 r² = 0.00144 m²,  L² = 0.36 m²,  g L = 5.886 m²/s²
    **T0 = 1.5569985 s**,  omega_0 = 4.0354430 rad/s

**The approximation's limits are the point of this demo.** The exact period of a rigid
pendulum released from rest at `theta0` is

    T(theta0) = T0 · (2/pi) K(k),      k = sin(theta0 / 2)

with K the complete elliptic integral of the first kind. Derived before running:

| theta0 | k | (2/pi)K(k) | T (s) | error of the small-angle constant T0 |
|---|---|---|---|---|
| 3° | 0.0261769 | 1.0001713 | 1.5572652 | +0.0171 % |
| 30° | 0.2588190 | 1.0174087 | 1.5841009 | +1.7409 % |
| 60° | 0.5000000 | 1.0731820 | 1.6709417 | +7.3182 % |
| 90° | 0.7071068 | 1.1803406 | 1.8377879 | +18.0341 % |
| 120° | 0.8660254 | 1.3728805 | 2.1375273 | +37.2880 % |

The witness recomputes `K` by the arithmetic–geometric mean, so it asserts against the
**derivation**, not against these literals; the literals are here so the derivation can
be checked against something written down first.

**Finite-step error.** For the linearised motion this scheme's period error is
`T_num/T_c − 1 ≈ −(omega h)²/24 = −1.18e-5` (−0.0012 %) at `omega_0 h = 0.0168`:
negligible at this tolerance. **The revolute joint's own constraint error is solved by
the impulse solver and is NOT derivable a priori.** No prediction below pretends
otherwise, and the tolerances are declared as engineering judgement in advance.

**Measurement.** `theta(t) = atan2(bx − px, −(by − py))` sampled once per public tick.
Half-periods are taken between successive **linearly interpolated zero crossings of
theta**, and the period is the mean over the first **6 whole periods** after release.
Amplitude drift over that window is **reported, never converted to heat**.

**Pass/fail.**

- **C2.1** at `theta0 = 3°`, measured period is within **0.5 %** of `T0 = 1.5569985 s`.
- **C2.2** at every `theta0` in the table, measured period is within **1.0 %** of the
  **exact elliptic** `T(theta0)`.
- **C2.3, the discriminator the demo exists for:** measured period at `theta0 = 90°`
  exceeds `T0` by **more than 15 %**, and at `theta0 = 120°` by **more than 30 %**.
  Passing C2.3 refutes "every amplitude has the small-angle period".
- **C2.4, convergence:** at 8 internal sub-steps instead of 4, the 3° period moves no
  further from the exact value: `|T(M=8) − T_exact| <= |T(M=4) − T_exact|`.
- **C2.5** amplitude drift over the 6-period window is **reported** with its sign and
  size. **No bound is asserted and no part of it is called heat**; joint constraint
  work stays in UNATTRIBUTED and is not decomposed.

**Duration.** 10 s (600 ticks) per amplitude; 5 amplitudes + one convergence run.

---

## CARD 3 — Guided spring oscillator on a SLIDER

**Fixture (`scene: oscillator`).** Vacuum. A fixed `rail` at `(0, 1.00, 0)`. A dynamic
box `cart`, half-extents 0.12 m, **m = 2.0 kg**. A **SLIDER** (Rapier prismatic
impulse joint) along `(1,0,0)`, anchors `(0,0,0)` on both, so the cart's COM is
confined to the line `y = 1.00, z = 0`. One spring of the build's **corrected** model
(`construction.ts`, D-8) from world anchor `(-1.50, 1.00, 0)` to the cart's local
origin, `restLength = 1.50 m`, **k = 200 N/m, c = 4 N·s/m**. Released from rest at
`x0 = +0.30 m`.

Gravity is carried entirely by the slider constraint (the cart never moves in y), so
gravitational PE is constant and the only owned dissipation is the spring damper.

**Continuum reference.**

    omega_n = sqrt(k/m) = 10 rad/s      gamma = c/m = 2 s^-1      zeta = 0.1
    omega_d = 9.9498744 rad/s           **T_c = 0.6314838 s**
    sigma = zeta omega_n = **1.0 s^-1** peak ratio e^(-sigma T_c) = **0.5317966**

Resolvability: `omega_n h = 0.041667 <= 0.30`, `gamma h = 0.008333 <= 0.05`. **Inside
the declared regime** of `units.ts RESOLVABILITY`.

**Discrete reference for this scheme, derived.** Our spring force is evaluated at the
start of each sub-step and held across it; the engine then does semi-implicit Euler.
The one-sub-step map is

    M = [[1 - h² w², h(1 - h gamma)], [-h w², 1 - h gamma]]
    det M = 1 - h gamma        (exactly, independent of stiffness — this is D-8's result)
    tr  M = 2 - h² w² - h gamma

so `|lambda| = sqrt(det)` and `cos phi = tr / (2 sqrt(det))`, giving

    sigma_num = -ln(1 - h gamma) / (2h) = **1.0041902 s^-1**      (+0.4190 % vs continuum)
    T_num     = 2 pi h / phi            = **0.6301330 s**         (−0.2139 % vs continuum)
    peak ratio over one T_num           = **0.5311114**           (−0.1288 % vs continuum)

**Measurement.** Displacement `x(t)` sampled once per public tick; peaks located by
quadratic interpolation; the period from successive same-sign peaks, and the decay
rate by least-squares of `ln|peak|` against peak time **and** by the 3-term linear
recurrence estimator of D-14. Energy sampled per tick from the existing budget.

**Pass/fail.**

- **C3.1** `|T_meas / T_num − 1| <= 0.10 %`, and `T_meas / T_c − 1` lies in
  **[−0.40 %, −0.10 %]** — i.e. it undershoots the continuum by the derived amount and
  not by an undetermined one.
- **C3.2** `sigma_meas` in **[1.000, 1.010] s^-1** (derived value 1.0041902), by both
  estimators, and **strictly greater than the continuum 1.0** as derived.
- **C3.3** measured successive-peak ratio within **0.5 %** of **0.5311114**.
- **C3.4 energy.** Over 3.0 s from release, `|UNATTRIBUTED| <= 2 %` of owned
  dissipation. **The joint's constraint work is NOT decomposed and NOT called heat**;
  whatever the slider contributes stays inside UNATTRIBUTED, which the panel already
  labels as an observation limit.
- **C3.5** the plot's **second consumer**: the same measurement path that plotted
  demo 1's trajectory plots this run's displacement and energy, with no new plotting
  code and no expression language.

**Duration.** 180 ticks (3.0 s) for the energy claim; 600 ticks (10 s) for period and
decay.

---

## Shared capability — what must hold, declared here too

- **S1 measurement path.** A named SI quantity + a body/world reference + tick/time,
  a **bounded** ring buffer, and a reset. Over 3000 ticks the buffer never exceeds its
  declared cap; reset empties it; every sample carries its unit string. **No universal
  expression language and no ruler/protractor suite.**
- **S2 gravity as a recorded intervention.** `setGravity` is an ordinary
  `(tick, seq)`-keyed event booked through `SimWorld.intervene`, so the PE change it
  causes is attributed to it and can never be mistaken for drift. On a single-body
  fixture (m = 0.4 kg at y = 1.20 m, datum y = 0) taking `g_y` from −9.81 to −1.62:

      predicted deltaEmech = m y (1.62 - 9.81) = **-3.9312000 J**, within 1e-4 J
      predicted change in UNATTRIBUTED across the edit = **0**, within 1e-9 J

  and the engine's gravity really changes: the next 60 ticks of free fall match the
  semi-implicit-Euler map at the **new** g to 1e-4 m.
- **S3 joints.** HINGE and SLIDER only. Authored joint identity (`id`, endpoints,
  axis) lives in the construction; **no engine handle ever appears in one**. A scene
  with a joint replays byte-identically twice over the declared replay state, and a
  mid-run checkpoint restored into a desynchronised world continues byte-identically.
  **No exact decomposition of joint constraint work is promised, and constraint error
  is not turned into heat.**
- **S4 scene selector.** Selecting a preset rebuilds the world **and** settles the
  recording coherently through the existing `worldReplaced` path — a different
  construction is a `load`, so a live recording is **terminated** with its reason
  stated, pending replay events are dropped, and the tick returns to 0.

## What is NOT in stage one

Demos 4–6 (collision, incline, air/vacuum fall). Ball and fixed joint wrappers.
Named material presets. Anything that would need an exact decomposition of constraint
work.
