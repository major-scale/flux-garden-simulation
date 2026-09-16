# A2 — A-1a FAILED. Retained. Replacement written BEFORE the next run.

`EXPECTATIONS-DM1-STALE-GUARD.md` (`d5b5ab88…`) and `EXPECTATIONS-DM1-STALE-GUARD-A1.md`
(`85a7c0c8…`) are **unmodified**.

## 1 · The retained red

**A-1a, as stamped in A1, FAILED.**

    predicted: engineMass(1.5) == Math.fround(1.5 / 0.027) * 0.027   within 1e-15 relative
    observed:  engine 1.500000238418579
               Math.fround(1.5/0.027)*0.027 = 1.5000000457763671
               relative difference 1.2843e-7   -- FAILED against 1e-15

A-1a asserted a *specific arithmetic model* of Rapier's density→mass pipeline: one f32 rounding
of the density, then an f64 multiply by an f64 volume. That model is **wrong**. Rapier computes
the collider's volume from its own f32 half-extents and multiplies in f32 throughout, so there
are several roundings, not one, and I do not have their exact order. **I am not going to keep
guessing at it until a guess turns green** — that would be fitting a model to an output.

## 2 · What A-1a was evidence FOR is unaffected

A-1a was one of three arguments that the residual offset in the five D-25 reds comes from the
**engine's single-precision mass**, not from the guard. Its failure removes the exact-pipeline
argument. The other two do not depend on knowing the pipeline at all, and neither was written
after seeing any of the numbers it concerns:

- **P-0's output**, produced against the **UNFIXED** build before the fix or DM-4 existed:
  `loose0`, **authored** at 1.5 kg in `construction.ts` with `setMass` never called, reads back
  from the engine as `1.500000238418579`. The offset is present with no mid-grab edit and no
  recomputation anywhere near it.
- **A-1c** (stamped in A1, not yet run): a guard error would be the same *relative* size at
  every mass; a single-precision value round trip is a property of each value and must differ.

## 3 · A-2a — the replacement, written before running

Instead of predicting Rapier's exact rounding sequence, predict only the property that
distinguishes single precision from the guard, using the **f32 machine epsilon** `2^-23 =
1.1921e-7` as the scale — a property of the IEEE format, not of any observed output:

**A-2a.** For each declared mass `m ∈ {1.5, 0.05}` on `loose0`, the engine-reported mass
satisfies

    1e-9  <  | engineMass(m)/m − 1 |  <=  1e-6

The lower bound excludes f64 arithmetic (which would give <= ~1e-15). The upper bound is
~8 × f32 eps, allowing for several roundings through half-extents, volume and density, and is
far below any physically meaningful mass difference. Both bounds are set from the format's
resolution, not from the size of the failure.

**A-2b.** That offset is present at the **authored** mass with **no `setMass` and no grab**:
immediately after `build(defaultConstruction())`, `runtime('loose0').mass !== 1.5`.

**A-1b and A-1c stand exactly as stamped in A1** and are not restated here.

## 4 · Standing

Nothing about the guard, the margin, the fix or any promised behaviour depends on this section.
It exists only to say **where** the 1e-7 residual in D-25 comes from. If A-2a or A-1c had also
failed, the correct conclusion would have been that the guard itself is imprecise and the fix
incomplete — which is exactly why they are worth running.
