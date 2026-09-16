# BB1 stage one — A1. Three reds retained. Two arithmetic literals corrected.

`EXPECTATIONS-BB1-S1.md` (sha256 `db9311d04d3de08eb61da3474e3043df8ce43da77977ccb64592c6455fa1b54f`,
stamped 2026-09-06T04:16:49Z) is **UNMODIFIED**. This file is written **after** the
first witness run and **before** the corrected literals are re-run.

## 1 · The retained reds, verbatim

    C2.0  T0 derived 1.5569973 s   vs card literal 1.5569985 s   |Δ| = 1.247e-6   FAILED (tol 1e-6)
          pendulumExactPeriod(120°) 2.137571 s vs card 2.1375273  |Δ| = 4.4e-5    FAILED (tol 1e-5)

    C3.0  discrete peak ratio derived 0.5311173 vs card 0.5311114 |Δ| = 5.890e-6  FAILED (tol 1e-6)

    C2.2  measured pendulum period vs the EXACT elliptic reference, tolerance 1.0 %:
              3°   −0.0012 %   PASS
             30°   −0.0596 %   PASS
             60°   −0.8806 %   PASS
             90°   −4.0712 %   **FAILED**
            120°  −11.7277 %   **FAILED**

    C2.3  discriminator, T(θ0)/T0 − 1:
             90°   measured +13.229 %   required > 15 %   **FAILED**
            120°   measured +21.190 %   required > 30 %   **FAILED**

**C2.2 and C2.3 are NOT amended. Their tolerances are NOT widened, their amplitude
range is NOT shrunk, and no case is deleted.** They stay in the suite, failing, and
demo 2 is reported as a failed demo. What follows about their cause is an
explanation, and an explanation is not a justification.

## 2 · C2.0 and C3.0 — ordinary arithmetic corrections, recomputed by hand

Both are slips in **my** desk arithmetic when writing the card. Neither is a defect in
the implementation, and neither is corrected by copying the code's output: each is
recomputed here by hand, and the hand recomputation lands on the code's value and
refutes the card's.

**C2.0.** `T0 = 2π √((0.4 r² + L²)/(g L))` with `r = 0.06`, `L = 0.60`, `g = 9.81`:

    0.4 r² = 0.00144 ;  L² = 0.36 ;  sum = 0.36144 ;  gL = 5.886
    0.36144 / 5.886 = 0.06 + 0.0014 + 0.0000067278 = 0.0614067278
    √0.0614067278 : 0.2478² = 0.06140484 ; (0.0614067278 − 0.06140484)/(2·0.2478)
                  = 0.0000018878 / 0.4956 = 3.8090e-6  ->  0.2478038090
    T0 = 6.283185307 × 0.2478038090 = 1.5569972516 s

The card wrote **1.5569985**; I had carried `0.2478040` instead of `0.2478038`. The
correct value is **1.5569972516 s**, which is what the code computes. Every entry of
the card's `T(θ0)` column scales with `T0`, so each is low by the same 8.0e-7
relative; the `(2/π)K(k)` factors themselves are unaffected and the 45° check passed.
Corrected: `T(120°) = 1.5569972516 × 1.3728805 = 2.1375710 s`.

**C3.0.** `peak ratio = exp(−σ_num · T_num)` with `σ_num = 1.00418998 s⁻¹`,
`T_num = 0.6301322 s`:

    σ_num · T_num = 0.6301322 + 0.6301322 × 0.00418998 = 0.632772436
    e^(−0.632772436) = e^(−0.63) · e^(−0.002772436)
                     = 0.532592236 × 0.997231407 = 0.5311177

The card wrote **0.5311114**. The hand recomputation gives **0.5311177**, agreeing
with the code to 4e-7 and disagreeing with the card by 6e-6. My card value came from a
lower-precision `e^(−0.6)` route.

**No tolerance moves.** C2.0 keeps 1e-6 / 1e-5 and C3.0 keeps 1e-6; only the literals
change, to the independently recomputed values. **The physics assertions were never
against these literals** — C2.1/C2.2/C2.4 assert against `pendulumExactPeriod`, and
C3.1/C3.2/C3.3 against `discreteOscillator`, both of which recompute the derivation.
C3.3 measured 0.5311166 and would have passed against either literal.

## 3 · C2.2 / C2.3 — what the cause is, established independently

This section exists so the failure is understood, **not** so it is excused. Three
pieces of evidence, none of them the failing period numbers themselves:

**(a) It is not the constraint solve.** Raising Rapier's `numInternalPgsIterations`
from 1 to 4 and to 16 changes the measured period and the amplitude drift by **nothing
at all** — identical to six decimal places at every amplitude.

**(b) It is first order in the sub-step, and it converges to zero.** Amplitude drift
over six periods:

| θ0 | M = 4 | M = 8 | M = 16 |
|---|---|---|---|
| 3° | −0.0322 % | −0.0159 % | −0.0071 % |
| 30° | −3.081 % | −1.585 % | −0.805 % |
| 60° | −10.715 % | −5.938 % | −3.141 % |
| 90° | −19.845 % | −12.130 % | −6.850 % |
| 120° | −30.832 % | −21.300 % | −11.820 % |

Halving `h` roughly halves the loss. It is a **fixed-step integration error**, of the
same first order as everything else this scheme does, and it goes to zero with the
step as it must.

**(c) The discriminating test: it is the HINGE, not the gravity torque.** Set gravity
to **zero** and spin the bob about the hinge at ω = 5.7 rad/s. There is then **no
torque of any kind** and kinetic energy must be exactly conserved. Measured over 11 s:

| M | KE(0) | KE(11 s) | change |
|---|---|---|---|
| 4 | 5.871593 J | 2.365071 J | **−59.72 %** |
| 8 | 5.871593 J | 3.371665 J | −42.58 % |
| 16 | 5.871593 J | 4.283519 J | −27.05 % |

A hard rotational constraint advanced by semi-implicit Euler bleeds energy at
O((ωh)²) per sub-step; here ωh = 0.0238 rad. **This is the whole of demo 2's
large-amplitude error, and it belongs to the joint's fixed-step integration.**

**In every one of those runs the deficit lands exactly in UNATTRIBUTED** — the budget
identity closes to the last digit, owned dissipation is identically zero because the
scene has no drag and no damper, and **not one joule of it is called heat**. That part
of the contract held.

**No correction is available inside this build's declared invariants.**
`numSolverIterations` must stay at 1 or D-8's force-freezing artifact returns for
springs; `numInternalPgsIterations` does nothing; and reducing `h` globally would
change the whole validated FP1/DM1 regime and **still would not pass** — at M = 16 the
120° error is −4.87 %, four times the declared tolerance. So C2.2 and C2.3 are
reported as **RETURNED**, not repaired and not renegotiated.

## 4 · Added as a CHARACTERISATION test, and labelled as one

The free-spin measurement above is added to the suite as `C2.6`. **It is not presented
as a prediction**: its numbers were observed before it was written, and copying an
observed value into an expectation is exactly what the rules forbid. It therefore
asserts only two properties that follow from the derivation and not from the observed
magnitudes:

- with zero gravity and no torque, the hinge's kinetic-energy change is **negative**
  and the whole of it appears in **UNATTRIBUTED**, with owned dissipation identically
  zero;
- the loss **shrinks monotonically** as the internal sub-step is refined
  (M = 4 → 8 → 16).

Its purpose is to stop this becoming invisible later, not to turn a red into a green.
