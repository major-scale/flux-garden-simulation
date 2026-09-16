# BB2 addendum A2 — one more failed prediction of mine: an ILL-CONDITIONED measure

Addendum to `EXPECTATIONS-BB2-CONNECTIONS.md` (sha256 `748227ef…`) and
`EXPECTATIONS-BB2-CONNECTIONS-A1.md` (sha256 `0b60bf0a…`).
Under `bridge/ACCEPTANCE-RULES-v1.md` §1. **Neither stamped file is edited.**
**Written and stamped BEFORE the corrected measure was run.**

## A2.1 — the failure

| witness | criterion | measured | verdict |
|---|---|---|---|
| C0f hinge-substitute initial axis misalignment | `≤ 1e-12` rad (A1.4's forward prediction) | `1.4901e-8` rad | **my measurement formula was ill-conditioned** |

Retained in `DEVIATIONS.md` D-36 alongside the other five.

## A2.2 — the cause, from numerical conditioning alone

The witness measured the angle between two unit vectors as

```
  theta = acos( a · b )
```

`acos` is **ill-conditioned near an argument of 1**: `d/dx acos(x) = −1/√(1−x²)`,
which diverges as `x → 1`. Near zero angle, `a·b = 1 − θ²/2`, so a rounding error
`ε` in the dot product becomes an angle error `√(2ε)`. With IEEE-754 double
`ε ≈ 2.22e-16`,

```
  smallest angle this formula can resolve  ≈ √(2 · 2.22e-16)  =  2.1e-8 rad
```

**and the measured value was 1.4901e-8 rad — below that floor.** No correct
implementation could have met `1e-12` through `acos`. This argument uses only the
conditioning of `acos` and the value of the double-precision epsilon; it does not
refer to the failing output.

## A2.3 — the corrected measure, and its FORWARD PREDICTION

The **well-conditioned** angle between two unit vectors, with no cancellation near
zero, is

```
  theta = atan2( |a × b| , a · b )
```

The cross product is `O(θ)` and is computed without subtracting nearly equal
quantities, so the formula resolves angles all the way down to the rounding of the
inputs themselves.

**FORWARD PREDICTION A2.3:** measured with `atan2(|a × b|, a · b)`, the hinge
substitute's initial world-space axis misalignment is `≤ 1e-14` rad.

**DISCRIMINATING TEST, committed before running:** the *same* corrected formula
applied to the **defective** fixture of A1.4 — where the two local axes really were
35° apart — must return `0.6108652381980153` rad to within `1e-12`. A measure that
returned a tiny number for both would not be measuring anything, and the
correction would be worthless.

**The ill-conditioned `acos` value stays printed alongside the corrected one**, so
the record shows both.
