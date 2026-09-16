# A1 — amendment to EXPECTATIONS-DM1-STALE-GUARD.md. Written BEFORE the discriminating run.

`EXPECTATIONS-DM1-STALE-GUARD.md` (sha256
`d5b5ab88fd5c503d283c3111edeef7f0b181e85fe11d063a6be52414dec7533e`, stamped
2026-09-06T03:54:18Z) is **unmodified**. The five red results below are **retained as failures**
in `DEVIATIONS.md` D-25 and are not rewritten.

## 1 · The retained red

Run of `DM-4`, immediately after the fix, against the predictions exactly as stamped:

    P-1  mEffBound  expected 0.05        got 0.05000000447034836   (+8.9407e-8 rel)  FAILED
    P-3  gainScale  expected 0.25        got 0.2500000223517418    (+8.9407e-8 rel)  FAILED
    P-4  mEffBound  expected 9.090909e-3 got 9.090910457926643e-3  (+1.6035e-7 rel)  FAILED
    P-7  kP         expected 150         got 150.00001341104507    (+8.9407e-8 rel)  FAILED
    P-8  mEffBound  expected 0.05        got 0.05000000447034836   (+8.9407e-8 rel)  FAILED

    P-0, P-2, P-5, P-6 PASSED as stamped.

**The FUNCTIONAL content of every failing prediction passed.** The guard was recomputed, the
grab was kept, the gesture id and accumulated work were untouched, the margin was restored, the
offset grab was guarded harder, a refused edit changed nothing, and replay and both restore
paths were identical. What failed is the **exactness of five decimal literals**.

## 2 · The mistaken assumption — evidence that PREDATES every failing run

The assumption was: *`setMass(m)` makes the engine report exactly `m`, so `effectiveMassBound`
on a centre grab is exactly the number typed into the event.* Two pieces of evidence, both
independent of the five outputs above:

1. **The P-0 run, executed against the UNFIXED build before this fix or these five tests
   existed**, printed `m=1.500000238418579` for `loose0` — a body **authored** at 1.5 kg in
   `construction.ts`, with `setMass` never called on it. The quantisation is already there at
   build time; it is a property of the engine, not of anything DM-4 added.
2. **The shipped code, which predates all of it.** `record.ts` does not store a mass. It stores
   a *density*, `col.setDensity(e.mass / volumeOf(shape))`, and then reads the mass back with
   `b.mass()`. Rapier's `Real` is **f32** in this build, so a declared mass round-trips through
   a single-precision density. `1.5 → 1.500000238418579` is `Math.fround` behaviour and nothing
   else.

Neither fact is an explanation of the observed discrepancy; both are statements about the
engine and about code written before the discrepancy existed.

## 3 · Forward predictions — the DISCRIMINATOR

The competing hypothesis is that **the guard itself** is imprecise. It is discriminated against
as follows. Written before running.

**A-1a (the f32 density round trip reproduces it).** For `loose0`, a 0.30 m cube,
`V = 0.027 m³`. For each declared mass `m`, the engine-reported mass must equal

    Math.fround(m / 0.027) * 0.027

to within **1e-15 relative**, for `m ∈ {1.5, 0.05}`. If this hypothesis is wrong the two will
differ by far more than that.

**A-1b (the guard consumes the engine mass EXACTLY).** For a centre grab (`r = 0`), the guard's
own arithmetic must introduce **zero** further error:

    hand.mEffBound === runtime('loose0').mass          (BITWISE identical, f64hex)
    hand.gainScale === runtime.mass / minEffectiveMass(H_SUB)   (BITWISE identical)
    hand.kP === HAND.K * hand.gainScale,  kD === HAND.C * hand.gainScale,
    hand.fMax === HAND.F_MAX * hand.gainScale                   (all BITWISE identical)

**A-1c (the discriminator).** If the error came from the GUARD, its relative size would be the
same whatever the mass. If it comes from the f32 density round trip, the relative error is a
property of each individual mass value and must **differ between them**. Predicted:

    rel(1.5)  = 1.500000238418579/1.5   − 1  ≈ 1.5894e-7
    rel(0.05) = engineMass(0.05)/0.05   − 1  ≈ 8.9407e-8

    |rel(1.5) − rel(0.05)| > 5e-8   — they are NOT the same number.

and, at the original 1.5 kg grab with no `setMass` at all, `hand.mEffBound` must already carry
`rel(1.5)`, proving the offset exists **before** any mid-grab edit and therefore cannot have
been introduced by the recomputation.

**A-1d (the corrected form of the five literals).** The predictions are re-stated against the
**engine-reported mass**, which is the only mass the simulation ever integrates:

    P-1' / P-8'  mEffBound === m_engine (bitwise);  gainScale === m_engine/0.2 (bitwise);
                 kP === 600*gainScale, kD === 24*gainScale, fMax === 400*gainScale (bitwise);
                 and the DECLARED-VALUE checks kept as relative tolerances:
                 |mEffBound/0.05 − 1| <= 1e-6, |gainScale/0.25 − 1| <= 1e-6,
                 |kP/150 − 1| <= 1e-6, |kD/6 − 1| <= 1e-6, |fMax/100 − 1| <= 1e-6.
    P-3'         |gainScale − 1| = 0 exactly at 1.5 kg (the guard does not fire at all there,
                 so `gainsFor` returns s = 1 with no arithmetic), kP/kD/fMax exactly nominal,
                 |mEffBound/1.5 − 1| <= 1e-6.
    P-4'         |mEffBound/9.090909e-3 − 1| <= 1e-6 and |gainScale/4.545455e-2 − 1| <= 1e-6,
                 with the strict inequalities `mEffBound < m_engine` and `gainScale < 0.25·(1+1e-6)`
                 retained unchanged.
    P-7'         the same relative form for kP/kD/fMax/gainScale.

1e-6 is chosen as **two orders of magnitude above** the 1.6e-7 f32 quantisation floor and
**four orders below** any physically meaningful gain difference — not by looking at how big the
failure was.

**Nothing about the margin is relaxed.** P-2's `gamma·h <= HAND.MAX_GAMMA_H + 1e-9` and the
Jury checks are unchanged and already passed. The guard is evaluated on the engine's mass, so
if the engine's mass is what is integrated, the margin holds on the number that matters.
