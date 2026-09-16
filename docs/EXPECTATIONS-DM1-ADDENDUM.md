# DM1 — ADDENDUM. Four failed predictions, their derivations, and new FORWARD predictions

`EXPECTATIONS-DM1.md` (sha256 `b2683f5987f6a305c2c844277a2c8f7b879e27db0b40147314d6134ce9e27c5d`,
stamped 2026-09-06T03:10:34Z) is **unmodified**. The four red results below are
**retained as failures** in `DEVIATIONS.md` D-16…D-19 and are not rewritten.
Written **before** any of the new fixtures below were run, and before the
implementation of them existed.

Under `bridge/ACCEPTANCE-RULES-v1.md` §1, amending a prediction requires
(1) retaining the original failing result, (2) identifying the mistaken
assumption **using evidence independent of the failing output**, and (3) a
**discriminating** test. Each item below supplies all three, and the independent
evidence in every case is a **document-internal contradiction that predates any
run** — not an explanation of the observed number.

**Nothing here weakens a promise made to the reviewer.** Criterion 2 requires
that mechanical-energy change minus signed hand work **converge under fixed-step
refinement**. It does not require that residual to be small at any particular
step. Where a size claim of mine turned out to be unfounded, it is **withdrawn
and the measurement reported**, not re-banded.

---

## A-1 · W1c/W1d assumed the hand was the only force. WB-P has four springs.

**Original result, retained (D-16):** W1c on **WB-P** predicted
`Δv = F_hand·h/m` and measured `4.213283e-2` against `1.041667e-2` m/s —
**+304.5 %. FAILED.**

**The mistaken assumption, from the documents alone.**
`EXPECTATIONS-DM1.md` §2.1 defines WB-P as *"box …, **4 springs k=800 c=0** to the
world anchors"*, and §2.2's own preamble says *"the only forces are the hand
**and, in WB-P, four undamped springs**"*. §2.2 then writes the one-sub-step map
as `Δv = F·h/m` with `F` the **hand** force. Those two statements contradict each
other for WB-P, and they did so **the moment the file was stamped**. The
one-sub-step map is `Δv = (Σ F_applied)·h/m`; with the springs present, `F_hand`
is not `Σ F_applied`.

**A-1a (forward).** For every witness, with `F_tot` the **total** force this
build applied to the body on that sub-step (the registry's sum, our own numbers,
not the engine's):

    Δv_com = F_tot · h / m          relative tolerance 2e-4   (unchanged from W1c)
    Δω     = I_world⁻¹ (Σ r_i × F_i) h   relative tolerance 2e-3 (unchanged from W1d)

**A-1b (discriminating).** The corrected prediction must **accept** where the
original **rejects**: for WB-P the hand-only prediction must be wrong by more
than **100 %** while the total-force prediction is right to **2e-4**. For the
three hand-only witnesses the two predictions must be **identical**, because
`F_tot ≡ F_hand` there. A correction that made every case pass would not be a
correction, it would be a loosening.

---

## A-2 · The convergence grid included M values OUTSIDE the declared controller margin

**Original result, retained (D-17):** W2b on **WB-O** — `|R|·M` spread
**51.7 %** against a ±25 % band, driven entirely by the `M = 1` point
(`4.37` against `8.65, 9.07, 8.85, 8.76`). **FAILED.**

**The mistaken assumption, from the documents alone.**
`EXPECTATIONS-DM1.md` §1.3 declares the controller margin `h·γ <= 0.5` and §1.6
declares that **only** cases inside it are supported. §2.3.2 then declared the
grid `M ∈ {1,2,4,8,16}` for **every** witness without checking it against that
margin. With `γ = C_hand/m_eff_min`:

| witness | m_eff_min (kg) | γ = 24/m_eff | h·γ <= 0.5 needs | smallest admissible M |
|---|---|---|---|---|
| WB-L | 0.5000 | 48.0 | h <= 1/96 s | **2** |
| WB-H | 200.0 | 0.12 | h <= 4.17 s | **1** |
| WB-O | 0.3636 | 66.0 | h <= 1/132 s | **3** → 4 on powers of two |
| WB-P | 2.5779 | 9.31 | h <= 1/18.6 s | **1** |

`M = 1` gives `h·γ = 0.80` for WB-L and `1.10` for WB-O — **outside the margin
this build declares it supports.** Asserting a convergence band there asserts
something §1.3 explicitly declines to claim. This is arithmetic on numbers that
were all fixed before the run.

**A-2a (forward).** The **band is unchanged at ±25 %**. The grid becomes the
**declared-admissible** one, and the anchor becomes the **largest M**, which is
the correct anchor for a limit that is claimed as `M → ∞`:

    WB-L  M ∈ {2, 4, 8, 16, 32}
    WB-H  M ∈ {1, 2, 4, 8, 16}
    WB-O  M ∈ {4, 8, 16, 32, 64}
    WB-P  M ∈ {1, 2, 4, 8, 16}

    for every admissible M:   | |R(M)|·M − |R(M_max)|·M_max | / (|R(M_max)|·M_max) <= 0.25

**A-2b (discriminating).** `M = 1` must still be **run and reported** for WB-L
and WB-O, and it must still **violate** the band — otherwise dropping it from
the assertion grid would be deleting an inconvenient case rather than respecting
a declared limit.

**A-2c.** The shipped configuration is `M = 4`. Every **preset** of §1.6 must be
admissible there after the gain guard: `h·γ <= 0.5` at `h = 1/240`. This is
already asserted by DM-1b and is the reason the guard exists.

---

## A-3 · W2d normalised by a quantity that is identically equal to the residual

**Original results, retained (D-18):** `|R(4)|/|W(4)|` was **100.0 %** (WB-L),
**85.7 %** (WB-O) and **9.45 %** (WB-P) against a declared **1.5 %**. **FAILED**
for three of the four witnesses. (WB-H **passed**.)

**The mistaken assumption, from the derivation in §2.3.1 itself.**
§2.3.1 — written before any run — establishes `R = ΔE_mech − W_hand`. The
declared gesture of §2.3.2 starts the body **at rest** and, for a hand-only
witness with `ζ ≈ 0.7–1.1`, drives it to a **stationary target**, so it also
**ends at rest**. Then `ΔE_mech = 0` **exactly**, hence

    R ≡ −W_hand      and      |R| / |W_hand| ≡ 1     for every h.

So W2d, as written, is **unsatisfiable by any correct implementation** on its own
fixture. It measured nothing. This follows from §2.3.1 and §2.3.2 alone; no
observation is needed to see it. WB-P and WB-H pass because they alone end with
`ΔE_mech ≠ 0` — WB-P through its spring potential, WB-H because a 200 kg body has
not finished moving after 1 s.

**A-3a (forward).** `|R|` is normalised by an energy scale that is **not** `R`:

    rho(M) = |R(M)| / max_t | E_mech(t) − E_mech(start) |      (peak excursion over the gesture)

Predicted: `rho(M)` is **O(h)**, i.e. `rho(M)·M` is constant within **±30 %** of
its value at the largest admissible `M`.

**A-3b — a size claim is WITHDRAWN, not re-banded.** No absolute bound on
`rho(4)` or `|R(4)|/|W(4)|` is asserted anywhere in this addendum. The declared
estimator's residual is **first order in h** and that is the whole of what §2.3.1
supports; the 1.5 % figure in W2d was **an unfounded guess** and it is withdrawn
rather than widened. **The measured values are reported as a finding, whatever
they are**, including at the shipped `M = 4`, and they remain inside
UNATTRIBUTED, where they are never called heat.

---

## A-4 · W2f's discriminator was ill-posed on a rest-to-rest fixture

**Original result, retained (D-19):** the deliberately mis-booked
centre-of-mass estimator was required not to converge
(`|R_wrong(16)| > |R_wrong(1)|/4`); it measured `0.433` against `0.962`.
**FAILED — the wrong estimator converged too**, so the guard did not guard.

**The mistaken assumption, from the derivation alone.** The two estimators differ
by `Σ τ·ω h → ∫ τ·ω dt`, which is the **rotational work**. On a gesture that
starts and ends at rest, `ΔKE_rot = 0`, so that difference **also** tends to zero
and the wrong estimator is indistinguishable from the right one in the limit. A
discriminator between two work estimators must be run on a fixture where the
quantity they disagree about is **non-zero at the end**. Again: derivable from
§2.3.1 plus the fixture definition, with no observation involved.

**A-4a (forward) — the fixture.** A new **smooth-haul** gesture **SH**, which is
also what the UI actually produces (one resampled target per tick, never a step):
the target leaves the grab point at **constant speed 0.5 m/s** along the unit
direction `(0.6, 0.8, 0)`, one `grabMove` per tick for **120 ticks**, and the
gesture **ends while still moving**. Run on WB-O (offset corner grab) and WB-P.

**A-4b (forward) — non-degeneracy.** At the end of SH the rotational kinetic
energy must satisfy `KE_rot > 1e-3 J` for WB-O and WB-P, so the quantity the two
estimators disagree about is actually present.

**A-4c (forward) — the discriminator.** On SH, under refinement:

    the CORRECT (grab-point) estimator:   |R(16)| <= 0.60 · |R(8)|     (it halves)
    the WRONG (centre-of-mass) estimator: |R_wrong(16)| >= 0.50 · |R_wrong(8)|   (it does NOT)

because `R_wrong → −ΔKE_rot ≠ 0` while `R → 0`.

**A-4d (forward).** On SH the correct estimator must still show first-order
convergence under A-3a's normalisation, on the admissible grid of A-2a.

---

## A-5 · What is still NOT claimed

- **No** absolute size claim for the accounting residual at any step. It is
  first order and it is reported.
- **No** claim that the residual is heat. It is numerical, it stays inside
  UNATTRIBUTED, and it is labelled there.
- Everything in `EXPECTATIONS-DM1.md` §6 stands unchanged.
