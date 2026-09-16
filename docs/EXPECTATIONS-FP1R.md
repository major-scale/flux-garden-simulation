# FP1 — RETURN-FIX EXPECTATIONS (R-series)

Written **before** the fixes were implemented and **before** anything was run.
`EXPECTATIONS.md` (sha256 `d55e4ee0…`) and `EXPECTATIONS-ADDENDUM.md`
(sha256 `dfbbf201…`) are **unmodified**; the D-1/D-2 failure record in
`DEVIATIONS.md` stands. This file adds the predictions for the three returned
items and nothing else.

Nothing below is copied from an observation. Every number is either a closed-form
continuum value or an a-priori error bound derived from the scheme algebra.

---

## R-0 THE SCHEME CHANGE (item 1), stated before it was measured

D-1 established that Rapier 0.20 advances one `step()` as `numSolverIterations`
sub-steps with **our user forces frozen across all of them**, so the one-tick
1-DOF map is

    det M = 1 − dt·gamma + w·dt²·omega²,     w = 1 − (N+1)/(2N),  N = numSolverIterations

`w` is a **numerical energy injection** created by freezing the elastic force. At
the shipped N = 4, w = 0.375 — the defect.

**The fix**: the public tick stays fixed at 1/60 s and inputs stay keyed by
(tick, seq). Inside one public tick the world is advanced by **M internal fixed
sub-steps of h = dt/M**, and *our force accumulators are cleared and rebuilt from
the current state before every one of them*. Rapier's own sub-division is set to
**N = 1** so that our refresh happens at every integration sub-step; then w = 0
and

    det M_sub = 1 − h·gamma        exactly, independent of omega.

**A-priori error of the corrected scheme** (first order in h, derived, not fitted):

    sigma_num / sigma  − 1  ≈ + h·gamma / 2
    T_num / T_d       − 1  ≈ − ( h·gamma/4 + (h·omega_d)²/24 )

**M = 4 is the intended default** (h = 1/240 s; the same four integration
sub-steps per tick the engine was already taking, so no cost is added). If
contact quality demands a different M, M may change — **the tolerances below may
not.**

## R-1 DECLARED RESOLVABILITY LIMIT — the offered spring regime

The UI must offer only a regime this scheme resolves. Declared, in terms of the
internal sub-step h and the heave mode of the body a spring pulls on
(K = sum of stiffnesses on that body, C = sum of dampings, m its mass):

    omega_n·h <= 0.30      and      gamma·h <= 0.05,     gamma = C/m, omega_n = sqrt(K/m)

At h = 1/240 s: **omega_n <= 72 rad/s**, **gamma <= 12 s⁻¹**. For the 20 kg
platform on four springs that is **k <= 25 920 N/m per spring** and
**c <= 60 N·s/m per spring**.

- **R-1a** An edit (`setStiffness`, `setDamping`, `setMass`) that would leave the
  regime is **REFUSED and surfaced**, never clamped, and the UI's own input
  maxima are set from this limit rather than from the old unvalidated
  `LIMITS.stiffnessMax = 200 000` / `dampingMax = 5 000`.
- **R-1b** At the corner of the admitted regime the derived error bounds are
  **sigma +2.59 %, T −1.64 %, peak ratio −0.47 %**. Those are the a-priori worst
  cases the tolerances below are sized against.

## R-2 SPRING FIDELITY — validated against the CONTINUUM, rig 1

Platform alone, vacuum, m = 20 kg, K = 4×800 = 3200 N/m, C = 4×10 = 40 N·s/m,
released from rest 0.15 m above y_eq. **Continuum predictions** (independent
physical model, not the discrete map):

    omega_n = 12.6491106 rad/s   zeta = 0.07905694   omega_d = 12.6095202 rad/s
    T_d     = 0.49828901 s       sigma = C/(2m) = 1.00000000 s⁻¹
    successive-peak ratio = e^(−sigma·T_d) = 0.60756932

Derived a-priori scheme error at M = 4: sigma **+0.419 %**, T **−0.219 %**,
ratio **−0.099 %**.

- **R-2a** measured damped period within **1.5 %** of 0.49828901 s.
- **R-2b** decay rate sigma, from a least-squares fit of ln(peak) against peak
  time over **at least 3 parabolically-interpolated positive peaks**, within
  **3 %** of **1.000000 s⁻¹**.
- **R-2c** successive-peak ratio within **2 %** of **0.60756932**.
  The pre-fix observation was 0.782975 (+28.9 %); a 2 % band **excludes it**, so
  this test cannot be passed by the artifact it was written to catch.
- **R-2d** still underdamped: >= 7 zero crossings in 2.0 s, ratio in (0, 1).

## R-3 SPRING FIDELITY — rig 2 (K = 1600, C = 20), same continuum test

    T_d = 0.70358168 s     sigma = 0.50000000 s⁻¹     ratio = 0.70342724

Derived a-priori error at M = 4: sigma +0.209 %, T −0.110 %, ratio −0.035 %.

- **R-3a** period within **1.5 %** of 0.70358168 s.
- **R-3b** sigma within **3 %** of 0.500000 s⁻¹.
- **R-3c** ratio within **2 %** of 0.70342724.
  (The pre-fix observation was 0.838756, +19 % — excluded by this band.)

## R-4 CONVERGENCE / LIMIT CHECK IN THE STEP (rig 1)

Run rig 1 at M = 1, 2, 4, 8, 16 internal sub-steps.

- **R-4a** |sigma_meas/1.0 − 1| is **strictly decreasing** in M.
- **R-4b** the scheme is **first order in h**: err(M)·M is constant across
  M = 1…16 to within **±20 %** of its value at M = 4, i.e. halving M's step
  halves the error.
- **R-4c** err(sigma) at M = 16 is **< 0.35 %** — the limit is approached, the
  error does not stall on a floor.
- **R-4d** at every M the measured sigma agrees with the **derived** map value
  `−ln(1−h·gamma)/(2h)` to within **1 %**, so the residual is the declared
  first-order term and not something unmodelled.

## R-5 CONVERGENCE ACROSS THE OFFERED REGIME (grid, not a sweep)

The declared grid, all inside R-1 and all underdamped, per spring:
k ∈ {200, 800, 3200, 12800} N/m × c ∈ {2, 10, 40} N·s/m — 12 rigs.
(k = 12800 per spring is K = 51 200, omega_n = 50.6 rad/s, omega_n·h = 0.211;
c = 40 per spring is C = 160, gamma = 8, gamma·h = 0.033: both inside R-1.)

- **R-5a** for **every** rig, |sigma_meas/sigma_cont − 1| <= **5 %**.
- **R-5b** for **every** rig, |T_meas/T_cont − 1| <= **3 %**.
- **R-5c** for every rig the measured error is **within 2 percentage points of
  the derived a-priori bound** for that rig, so the regime is covered by an
  understood bound and not by luck.

## R-6 ENERGY — the D-2 remainder is still reported as UNATTRIBUTED

D-2 recorded |UNATTRIBUTED| ≈ +50 % of owned dissipation, which followed directly
from the D-1 injection. With w = 0 that term is gone; what remains is the
first-order force-evaluation lag, which cancels to second order over whole
cycles.

- **R-6a** rig 1 and rig 2, vacuum: **|UNATTRIBUTED| < 10 %** of owned
  dissipation. (This is the ORIGINAL B5 threshold, which D-2 recorded as failed.
  It is re-predicted here, not weakened.)
- **R-6b** the remainder is still **labelled UNATTRIBUTED** in code and UI. No
  closure is claimed, nothing is renamed "numerical error", nothing becomes heat.

## R-7 REGRESSION — the returned items must not damage what passed

Unchanged thresholds from `EXPECTATIONS.md`:
- **R-7a** A1–A5 (terminal velocity in air, none in vacuum) still pass.
- **R-7b** C1–C5 (the stack topples) still pass — this is the contact-quality
  check on N = 1, and it is the one that decides whether M = 4 is enough.
- **R-7c** D1–D4 (replay ×2, snapshot/restore/continue) still pass.

## R-8 CHECKPOINT / RECORD LIFECYCLE (item 2)

The defect: `Checkpoint` carried `recording` and `seqCounter` but **not**
`recorder.events`, so a restore rewound the world without rewinding the history.

- **R-8a** record A at tick tA; checkpoint at tC > tA; record B at tB > tC;
  restore. Then: `recorder.events == [A]` **exactly** — B is gone with the future
  it belonged to — and the next minted seq equals the seq B had used.
- **R-8b** a **fresh** `Recorder` restoring the same checkpoint also holds
  exactly `[A]`, and the same **recording base construction**, so its record
  replays against the world the history was taken in.
- **R-8c** replaying the restored record reproduces the checkpointed
  continuation: the canonical state (R-9) at the checkpoint tick equals the
  unbroken run's.
- **R-8d** loading a construction clears pending replay events and terminates
  recording, with the reason surfaced. Asserted as: after a world replacement,
  `pending == []` and (`recording == false` **or** the history and base have been
  rebased to the new world at tick 0) — no stale event can reach the new world.
- **R-8e** reset while recording leaves history, seq counter and base coherent
  with a tick-0 world: no recorded event may carry a tick >= the new tick count.

## R-9 EXACTNESS SCOPE (item 3)

`stateHash` is a **32-bit FNV fingerprint of selected fields**. It is demoted to
a display convenience. Exactness is decided by a **canonical serialisation of the
declared replay state**, every number written as its IEEE-754 bit pattern, and
compared **byte for byte**.

**Declared IN scope**: tick; nextSerial; insertion order; per body — kinematics,
mass, translation, rotation, linear and angular velocity; per spring — id,
endpoints, restLength, stiffness, damping; environment medium and gravity;
foreign-accumulator-write count; the whole energy budget including every
intervention record; and, for the application half — pending events, recorded
events, recording base identity, recording flag, paused flag, seq counter,
selection.

**Declared OUT of scope, explicitly**: Rapier internals not round-tripped through
its own snapshot (broad-phase structures, contact-manifold warm-start caches);
engine handle *values*, which are an engine allocation detail and are compared
only through the checkpoint's id→handle mapping; render state (meshes, camera,
interpolation buffers); wall-clock annotations; performance counters; derived
caches (kDrag), which are recomputed from what is in scope.

- **R-9a** replay ×2 and snapshot/restore/continue are decided on the **canonical
  bytes**, not the hash.
- **R-9b** **mutation detection**: for each of environment.medium, a budget
  field, a pending event, a recorded event, the seq counter, the selection, the
  recording flag, foreignAccumulatorWrites, and a spring's damping — mutating it
  alone **must** make the canonical comparison fail.
- **R-9c** at least one of those mutations is **NOT** detected by the 32-bit
  `stateHash`, demonstrated in the test, which is the evidence that the old claim
  was an overreach.
- **R-9d** no claim of bit-identical *whole engine memory* is made anywhere. The
  strongest engine-level statement attempted is a direct byte comparison of
  Rapier's own snapshot blob between two replays; whether it holds is **reported
  either way** and is not required by any acceptance criterion.

## R-10 ON SCREEN

- **R-10a** the scene renders, zero console errors.
- **R-10b** the platform hangs, loaded, near **y = 0.884 m**
  (0.96 − 24.5·9.81/3200 = 0.88489) — required within **±0.01 m** at rest.
