# FP1 — expectations ADDENDUM

The original `EXPECTATIONS.md` (sha256 `d55e4ee08c39d13f3dd34bc6c70ce73ffd6eef00367203c7b3449be21b9aa9ba`,
stamped 2026-09-06T01:35:30Z) is **unmodified**. Prediction **B3 in it FAILED**. This
addendum records the failure, derives an explanation, and — importantly — commits
to a **NEW FORWARD PREDICTION, written before it was run**, that the explanation
must pass if it is right. Nothing observed has been copied into a prediction.

## The recorded failure

> **B3** ratio of the 2nd positive peak amplitude to the 1st within 5 % of
> e^(−sigma·T_d) = 0.607536.

**OBSERVED: 0.782975.** Deviation +28.9 %. The decay is roughly **half** as fast as
the continuum model predicts. B1 (8 zero crossings) and B2 (period 0.494112 s vs
0.498288 s predicted, −0.84 %) both passed, so the stiffness and mass are right and
it is specifically the **damping rate** that is off.

## Derivation of the cause (done from the scheme, not fitted to the number)

Rapier 0.20 advances one `step()` as **4 equal sub-steps of dt/4**, and a user force
added before the step is **held constant across all four**. This was established
independently, before any of the spring work, by the free-fall probe: a body
released from rest fell 1.70326e-3 m on its first step, and

    0.625 · dt² · g = 0.625 · (1/60)² · 9.81 = 1.70313e-3 m

where the 0.625 comes from a velocity-then-position sub-step update with the force
frozen:

    dx = SUM_{i=1..4} (dt/4)·(v_n + i·(dt/4)·a) = dt·v_n + 10·(dt/4)²·a
       = dt·v_n + 0.625·dt²·a

(Note 0.625 ≠ 0.5. Leapfrog's 0.5 is the energy-neutral value.)

For the 1-DOF spring with x measured from equilibrium, omega² = K/m, gamma = C/m,
and the force frozen at the start-of-tick state, one whole tick is the linear map

    v_{n+1} = −dt·omega²·x_n + (1 − dt·gamma)·v_n
    x_{n+1} = (1 − 0.625·dt²·omega²)·x_n + (dt − 0.625·dt²·gamma)·v_n

whose determinant is exactly

    **det M = 1 − dt·gamma + 0.375·dt²·omega²**

The `+0.375·dt²·omega²` term is a **NUMERICAL ENERGY INJECTION** produced by freezing
the elastic force across the sub-steps. It works against the physical damping. The
per-tick contraction is sqrt(det M), so the observed decay rate is

    **sigma_eff = −60·ln( sqrt(1 − dt·gamma + 0.375·dt²·omega²) )**

For the tested rig (m = 20, K = 3200, C = 40, dt = 1/60): omega² = 160, gamma = 2,

    det M   = 1 − 0.03333333 + 0.01666667 = 0.98333333
    sigma_eff = 0.504204 s⁻¹      (the continuum value is gamma/2 = 1.000000 s⁻¹)

The factor of almost exactly 2 is a **coincidence of these parameters**: the injection
0.375·dt²·omega² happens to be half of dt·gamma here. It is not a factor-2 bug.

The discrete damped frequency follows from the same matrix:
    cos(phi) = trace/(2·sqrt(det)),  omega_d,disc = 60·phi
For this rig: trace = 1.93888889, phi = 0.211923, omega_d,disc = 12.7154 rad/s,
**T_disc = 0.494143 s** (observed 0.494112 s, agreement 6e-5 relative).

**This is a property of the scheme, not a defect to be papered over, and the energy
it injects is precisely why UNATTRIBUTED must NOT be relabelled "numerical error"
and then discarded — here it is a first-class, sign-carrying term.**

## NEW FORWARD PREDICTIONS — written down before being run

### B3' — retro-prediction for the rig already measured
The discrete model implies a successive-peak ratio of
    e^(−sigma_eff · T_disc) = e^(−0.504204 × 0.494143) = **0.779455**
Required: within **2 %** of 0.779455. (Continuum said 0.607536.)

### B6 — a DIFFERENT rig, never yet simulated, to test the model forward
Same platform, m = 20 kg, **vacuum**, but **K_total = 1600 N/m** (400 N/m per spring)
and **C_total = 20 N·s/m** (5 N·s/m per spring). Released from rest at
y_eq + 0.15 m, where y_eq = 0.96 − 20·9.81/1600 = **0.837375 m**. Run 180 ticks (3.0 s).

    omega² = 80,  gamma = 1
    det M   = 1 − 0.01666667 + 0.00833333 = 0.99166667
    **sigma_eff = 0.2510466 s⁻¹**            (continuum gamma/2 = 0.500000 s⁻¹)
    trace = 1.96944444, phi = 0.149467
    **T_disc = 0.700673 s**                  (continuum T_d = 0.703581 s)
    **successive-peak ratio = e^(−0.2510466 × 0.700673) = 0.838706**
                                             (continuum would give **0.703416**)

- **B6a** measured period within **2 %** of **0.700673 s**.
- **B6b** measured successive-peak ratio within **3 %** of **0.838706**, and
  **more than 0.75** — which the continuum prediction of 0.703416 is not. This is a
  genuine discriminating test: the two models are 19 % apart.

### B7 — what the ENERGY ACCOUNT must therefore show
For lightly-damped oscillation, equipartition gives damper power = gamma·E, so
    owned_damper_dissipation / actual_E_mech_loss = gamma / (2·sigma_eff)
and since UNATTRIBUTED = owned − loss (no interventions in this test),

    **UNATTRIBUTED / owned = 1 − 2·sigma_eff/gamma**

- rig 1 (gamma = 2, sigma_eff = 0.504204): predicted **+0.495796**
- rig 2 (gamma = 1, sigma_eff = 0.2510466): predicted **+0.497909**

- **B7a** for BOTH rigs, UNATTRIBUTED/owned lies in **[0.44, 0.56]** and is **POSITIVE**.
  Positive means the account shows energy APPEARING that we cannot attribute.
- **B7b** the sign and magnitude are reported under the label **UNATTRIBUTED**.
  It is **NOT** relabelled numerical error and **NOT** relabelled physical heat, even
  though this particular test is one of the rare cases where its dominant
  contributor actually IS identifiable as integration error. **Naming it would be
  a promise the general case cannot keep**, which is exactly why the plan forbids it.

## Consequence for the original B5

> **B5** |UNATTRIBUTED| at t = 2.0 s is < 10 % of the owned dissipation.

This is now **predicted to FAIL**, at roughly +50 %, for the reason derived above.
It is recorded as a failed prediction. The correct response is NOT to close the
account: the remainder stays UNATTRIBUTED.
