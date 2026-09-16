# FP1 — expectations, DERIVED AND WRITTEN DOWN BEFORE ANY PHYSICS WAS RUN

This file is written *before* the corresponding tests are executed. Every number
below is derived analytically from the model as specified, not observed. Where a
prediction later turns out wrong, the deviation is RECORDED in the final report,
not absorbed by editing this file.

Engine: `@dimforge/rapier3d-compat@0.20.0`, fixed dt = 1/60 s, gravity g = 9.81 m/s²,
engine linear/angular damping = 0, sleeping disabled.

---

## A. A dropped block approaches TERMINAL VELOCITY in air, and not in vacuum

**Test body chosen so that terminal speed is actually approached before ground
contact** — this is a designed case, not an arbitrary preset.

- box, half-extents 0.25 m (a 0.5 m cube), mass **0.5 kg**
- C_d = 1.05 (box default), still air rho = 1.225 kg/m³
- A_eff (Cauchy orientation-averaged, = S/4) = 2(0.25·0.25 × 3) = **0.375 m²**
- k_drag = ½·rho·C_d·A_eff = 0.5 × 1.225 × 1.05 × 0.375 = **0.241171875 kg/m**
- **v_t = sqrt(m·g / k_drag) = sqrt(4.905 / 0.241171875) = sqrt(20.338207) = 4.50978 m/s**
- time constant tau = v_t/g = **0.459712 s**
- released from rest at y = 60 m, run **180 ticks = 3.000 s**
  - t/tau = 6.52584, so v/v_t = tanh(6.52584) = 0.9999957 — terminal speed is
    approached to within 4.3e-6 relative, i.e. genuinely reached
  - distance fallen in air = (v_t²/g)·ln cosh(t/tau) = 2.07321 × 5.8331 = **12.09 m**
    -> the block is at y ~= 47.9 m, far above the ground. **No contact.**
  - distance fallen in vacuum = ½g t² = **44.15 m** -> y ~= 15.9 m. **No contact.**

**Predictions:**

- **A1** air, after 180 ticks: |v| within **1.0 %** of 4.50978 m/s, i.e. in
  **[4.46468, 4.55488] m/s**.
  *Justification of the tight band:* the discrete update
  v_{n+1} = v_n + dt·(g − (k/m)v_n²) has the SAME fixed point as the continuum,
  so the asymptote should not shift; only f32 arithmetic and holding the drag
  force constant across Rapier's 4 internal sub-steps can perturb it.
- **A2** vacuum, after 180 ticks: |v| within **0.1 %** of g·t = **29.430 m/s**.
- **A3** vacuum speed / air speed > **5** (predicted **6.526**).
- **A4** in air, speed increases monotonically, and the increase over the LAST 30
  ticks (0.5 s) is **< 0.1 % of v_t** — i.e. terminal speed is actually
  *approached*, not merely *trending toward*.
- **A5** in air the final speed is **below** v_t (approach from below, never overshoot).

## B. An UNDERDAMPED spring oscillates and decays

Platform alone (all blocks removed), **vacuum** so the only dissipation is our own
spring damper and the analytic prediction is clean. 4 springs, all exactly
vertical by construction, so the motion is 1-DOF.

- m = **20 kg**, K = 4 × 800 = **3200 N/m**, C = 4 × 10 = **40 N·s/m**
- omega_n = sqrt(K/m) = sqrt(160) = **12.649111 rad/s**
- **zeta = C / (2·sqrt(K·m)) = 40 / 505.96442 = 0.0790569  <  1  => UNDERDAMPED**
- omega_d = omega_n·sqrt(1−zeta²) = **12.609548 rad/s**;  **T_d = 0.498288 s**
- decay rate sigma = zeta·omega_n = C/(2m) = **1.000000 s⁻¹** exactly
- equilibrium y_eq = 0.96 − m·g/K = 0.96 − 0.0613125 = **0.8986875 m**
- released from rest at y0 = y_eq + **0.15 m** = 1.0486875 m; run **120 ticks = 2.0 s**

**Predictions:**

- **B1** at least **7** zero crossings of (y − y_eq) in 2.0 s (predicted 8: first at
  T_d/4 = 0.1246 s, then every T_d/2 = 0.24914 s).
- **B2** period measured across 3 full periods within **3 %** of **0.498288 s**.
- **B3** ratio of the 2nd positive peak amplitude to the 1st within **5 %** of
  e^(−sigma·T_d) = **0.607536**. (Strictly between 0 and 1 => decaying;
  oscillation present => not overdamped. Together: underdamped.)
- **B4** initial stored excess energy ½·K·(0.15)² = **36.0 J**; at t = 2.0 s the
  amplitude should be 0.15·e^(−2) = 0.0203 m, so ~**35.3 J** has left the
  mechanical account.
- **B5 (accounting)** the OWNED spring-damper dissipation estimate accounts for
  **more than 80 %** of the total decrease in resolved mechanical energy, and
  |UNATTRIBUTED| at t = 2.0 s is **< 10 %** of that owned dissipation.
  *This is a prediction about the estimator, not a requirement that the account
  close.* UNATTRIBUTED is expected to be small but NON-ZERO here, and it is not
  numerical error and not physical heat: it is the residual of a first-order
  explicit force evaluation plus the engine's own integration error.

## C. A stack TOPPLES given suitable geometry and impulse

Default construction, air. 3 stacked 0.24 m cubes of 1 kg on the platform, centres
at y = 1.08, 1.32, 1.56. Settle for 120 ticks (2.0 s), then apply a push to the
**middle** block (`stack1`) **at a point 0.12 m above its centre of mass** —
off-centre, which is how a stack is actually toppled — with impulse
**J = (2.5, 0, 0) N·s**. Then run 180 more ticks (3.0 s).

- immediate Delta v_x of stack1 = J/m = **2.5 m/s**
- moment arm r = (0, 0.12, 0); angular impulse r × J = (0, 0, **−0.30**) kg·m²/s
- I_zz of a 0.24 m cube of 1 kg = m·a²/6 = 0.0576/6 = **0.0096 kg·m²**
- immediate Delta omega_z = −0.30 / 0.0096 = **−31.25 rad/s**

**Predictions:**

- **C1** max horizontal displacement over the 3 stack blocks, 3.0 s after the
  impulse, **> 0.30 m** (more than one block width, so it has definitively left
  the stack).
- **C2** max tilt of any stack block from its pre-impulse orientation **> 45°** —
  a stack that merely slid intact is not a topple.
- **C3** the highest stack-block centre drops by **> 0.20 m** from its pre-impulse
  value (the stack is no longer 3 high).
- **C4** **at least 2** of the 3 stack blocks displaced horizontally **> 0.10 m**
  (the stack came apart; a single block flying off is not a topple).
- **C5 (intervention accounting)** the recorded intervention Delta E_mech for that
  push lies in **[7.0, 8.7] J**. (Predicted ~½·1·2.5² + ½·0.0096·31.25² =
  3.125 + 4.688 = **7.81 J**, plus a small cross term from the platform's residual
  motion.) It must be booked as an INTERVENTION, never as drift.

## D. Replay and restore — SEPARATE criteria from physical drift

Bit-exact FNV-1a hash over every body's f32 pose and velocity, in insertion order.

- **D1 (replay twice -> identical at every checkpoint)** a recorded 600-tick (10 s)
  session containing add, remove, mass edit, stiffness edit and push interventions,
  replayed twice from tick 0, produces **identical hashes at every one of the 11
  checkpoints** (ticks 0, 60, ..., 600). Any single mismatch is a failure.
- **D2 (snapshot / restore / continue -> identical to the unbroken run)** the same
  session run unbroken to tick 600, versus run to tick 300, checkpointed,
  restored into a fresh world, and continued to tick 600, produces **identical
  hashes at ticks 360, 420, ..., 600**, and an identical final hash.
- **D3** the saved construction JSON contains **no engine handle** (asserted by
  scanning the serialised text for handle fields).
- **D4** the checkpoint restores APPLICATION state too: `nextSerial`, the id->handle
  map, the pending event queue and the energy budget all come back equal.

## E. It opens

- **E1** the dev server serves the page and the browser console logs **zero errors**.
- **E2** the WebGL canvas is non-zero in size and the renderer reports a non-zero
  number of drawn triangles — i.e. **something is actually on screen**, which is
  the specific failure GP1 was returned for.
- **E3** the platform, the 4 springs, the 3-block stack, the loose block and the
  ground are all visible.

## F. Performance — a MEASURED TARGET, not a per-frame pass/fail

Trial budget: **60 dynamic bodies, 120 simulated seconds, dt = 1/60** (7200 ticks).

**Declared in advance, what slowdown I would call unacceptable:**

- **UNACCEPTABLE:** mean physics time per tick **> 16.67 ms** (the tick's own
  budget) — the simulation then cannot run in real time at all and the driver
  is permanently dropping ticks.
- **UNACCEPTABLE:** more than **1 %** of rendered frames exceed **33 ms** (sustained
  visible stutter below 30 fps).
- **WARNING LINE (acceptable but reported):** mean physics per tick > **8 ms**, i.e.
  over half the tick budget spent in physics.
- **Predicted:** mean physics per tick **< 2 ms** for 60 dynamic bodies on an Apple
  Silicon Mac; frame time dominated by rendering, not physics.

## G. Force labelling honesty (checked by reading the UI, not by a numeric test)

- **G1** the user-force accumulator readout is labelled as the sum of
  APPLICATION-APPLIED forces only, and explicitly states that it EXCLUDES gravity
  (engine) and all contact/constraint forces, i.e. it is **not** the total force.
- **G2** an impulse is labelled in **N·s** and explicitly stated **not** to be an
  instantaneous force; any N-valued equivalent shown alongside is labelled a
  **step-averaged** force over one tick.
- **G3** contact is reported as an engine-accumulated **impulse**, with any force
  figure labelled **step-averaged over the tick**.
- **G4** the energy panel shows **UNATTRIBUTED** under that name, with the standing
  caveat that it is neither numerical error nor physical heat.
