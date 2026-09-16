# DM1 — RETURN FIX. Predictions written BEFORE the implementation and BEFORE any run.

Scope: the ONE functional gap and the ONE wording correction returned by independent review.
`EXPECTATIONS-DM1.md` (sha256 `b2683f59…`) and `EXPECTATIONS-DM1-ADDENDUM.md` are **unmodified**.
No prediction in either is amended here. Nothing below weakens a promise; it closes a hole in one.

---

## 0 · The defect, stated as the reviewer stated it

`gainsFor` is evaluated **once**, in `SimWorld.beginGrab` (`src/sim/world.ts:447`).
`applyEvent`'s `setMass` case (`src/sim/record.ts:273-295`) changes `rt.desc.material.mass`,
the collider density and the recomputed rigid-body mass **and inertia**, and refreshes drag —
but it neither recomputes the ACTIVE hand's gains from the new inertia frame, nor releases,
nor refuses. Every later sub-step keeps using the stale `hand.kP / hand.kD / hand.fMax`.

The guard is therefore **stale-able through an ordinary supported intervention**. This is not
a demonstrated explosion; it is a demonstrable bypass of the declared margin.

---

## 1 · Constants, derived from the shipped code, not measured

    h_sub          = SI.DT / SI.SUBSTEPS = (1/60)/4 = 1/240 s
    HAND.K         = 600   N/m
    HAND.C         = 24    N·s/m
    HAND.F_MAX     = 400   N
    HAND.MAX_GAMMA_H = HAND.MAX_OMEGA_H = 0.5

    gamma_max = 0.5 / h_sub = 120  s^-1
    omega_max = 0.5 / h_sub = 120  rad/s
    minEffectiveMass(h_sub) = max( C/gamma_max , K/omega_max^2 )
                            = max( 24/120 , 600/14400 )
                            = max( 0.2 , 0.0416667 ) = 0.2 kg      (the damping term binds)

Fixture body: `loose0` — a 0.30 m cube, default mass **1.5 kg**, no springs attached
(`src/model/construction.ts:336-345`). Heaviest dynamic body is the platform at **20 kg**, so a
0.05 kg `loose0` gives a mass ratio 20/0.05 = **400 : 1**, inside `LIMITS.maxMassRatio = 2000`,
and `loose0` carries no spring so `resolvabilityIssues` cannot fire. The edit is therefore
**admissible** and reaches the `intervene` block. Grab point is taken at the body-local origin,
so `r = 0` and `effectiveMassBound = m` exactly.

## 2 · P-0 — the bypass, to be demonstrated on the UNFIXED code and RETAINED

**P-0.** With the current (unfixed) build: grab `loose0` at local `(0,0,0)`; then apply
`setMass loose0 → 0.05 kg` while held. The event is **accepted** (`applyEvent` returns `null`),
and afterwards

    hand.kP    = 600      (unchanged)
    hand.kD    = 24       (unchanged)
    hand.fMax  = 400      (unchanged)
    hand.mEffBound = 1.5  (stale)
    hand.gainScale = 1    (stale)

so the live damping rate the sub-step map actually integrates is

    gamma * h_sub = (hand.kD / m_new) * h_sub = (24 / 0.05) / 240 = 2.0

against a **declared** margin of `HAND.MAX_GAMMA_H = 0.5` — exceeded by **4×**, and also past
Jury's own stability boundary `h*gamma < 2` for this map. P-0 is the RED result this fix exists
to remove; it is recorded, not explained away.

## 3 · The chosen remedy — RECOMPUTE

Of the three options the reviewer allowed (recompute / release / refuse) this build takes
**recompute**, and only recompute:

- **Refusing** would newly forbid an edit FP1 has always supported, purely because a transient
  hand happens to be attached; it would also make a restored mid-grab checkpoint refuse an edit
  that the same construction accepts when nothing is held. That is a scope reduction, not a fix.
- **Releasing** would drop a body the user is holding as a side effect of a slider, and would
  silently change replayed dynamics of every existing recording that edits mass mid-grab.
- **Recomputing** is exactly what `beginGrab` already does, evaluated at the only other moment
  the inputs to `gainsFor` can change. It keeps the declared margin true **at every sub-step**,
  which is what the guard claims, and it changes only state that is already inside the declared
  replay scope (`hand.kP/kD/fMax/gainScale/mEffBound` — `REPLAY_STATE_SCOPE.simIn`, and already
  in the canonical fingerprint at `world.ts:952-956`).

The recomputation is performed **inside the same `sim.intervene` closure** as the mass change,
after `recomputeMassPropertiesFromColliders`, so no tick can ever observe the new inertia with
the old gains, and so replay — which drives the identical `applyEvent` path — reproduces it.

## 4 · Forward predictions. Written before the code that satisfies them exists.

**P-1 (freshness).** After the P-0 sequence on the FIXED build, with `r = 0` and `m = 0.05`:

    hand.active     = true          (still held — no release)
    hand.entityId   = 'loose0'      (unchanged)
    hand.gestureId  = unchanged     (this is not a new gesture)
    hand.localPoint, hand.target    unchanged
    hand.mEffBound  = 0.05          (|err| <= 1e-12)
    hand.gainScale  = 0.05 / 0.2 = 0.25
    hand.kP         = 600 * 0.25 = 150    N/m
    hand.kD         = 24  * 0.25 = 6      N·s/m
    hand.fMax       = 400 * 0.25 = 100    N

**P-2 (the margin is restored).** With those values,

    gamma * h_sub = (6 / 0.05) / 240        = 0.5      <= HAND.MAX_GAMMA_H   (at the limit)
    omega * h_sub = sqrt(150/0.05) / 240    = 0.228218 <= HAND.MAX_OMEGA_H   (inside)

and Jury's two conditions hold with margin: `h*gamma = 0.5 < 2`, and
`h²omega² + 2h*gamma = 0.0520833 + 1.0 = 1.052083 < 4`.

**P-3 (symmetry — the guard is not a ratchet).** Raising the mass back while still held,
`setMass loose0 → 1.5`, must restore `gainScale = 1`, `kP = 600`, `kD = 24`, `fMax = 400`,
`mEffBound = 1.5`. A guard that only ever tightens would be a different, undeclared controller.

**P-4 (offset grabs are stricter, not looser).** Grabbing the same 0.05 kg body at the local
corner `(0.15, 0.15, 0.15)` and setting the mass while held must give
`hand.mEffBound < 0.05` and hence `hand.gainScale < 0.25`, because the rotational term
`|r|²/I_min` is strictly positive. Numerically, for a 0.30 m cube of mass m the principal
inertia is isotropic, `I = m(hy²+hz²)/3 · ... = m·(0.15²+0.15²)/3 = 0.015 m`, so with
`|r|² = 3·0.15² = 0.0675`:

    1/m_eff = 1/0.05 + 0.0675 / (0.015 * 0.05) = 20 + 90 = 110
    m_eff   = 1/110 = 9.090909e-3 kg
    gainScale = 9.090909e-3 / 0.2 = 4.545455e-2

(|err| <= 1e-9 on `m_eff`; the inertia value used is whatever the engine reports, so if the
engine's cuboid inertia differs from this hand derivation the DERIVATION is what is wrong and
the discrepancy is reported, not hidden.)

**P-5 (a refused edit changes nothing).** An inadmissible `setMass` while held — e.g.
`loose0 → 0.005 kg`, below `LIMITS.massMin = 0.01` — must return a refusal string and leave
`hand.kP/kD/fMax/gainScale/mEffBound` **and** the body's mass exactly as they were.

**P-6 (replay, at a different cadence).** A recorded stream containing `grabBegin`, several
`grabMove`s, the mid-grab `setMass`, and further ticks, replayed against a fresh world driven
in a DIFFERENT tick batching (1 tick per pump vs 7 ticks per pump), must produce a
**byte-identical `canonicalState` string** to the original run — including the `hand …` line
that carries `kP`, `kD`, `fMax`, `gainScale` and `mEffBound`.

**P-7 (restore AFTER the edit).** A checkpoint taken while still holding the now-0.05 kg body
must round-trip `kP=150, kD=6, fMax=100, gainScale=0.25, mEffBound=0.05`, and continuing N
ticks from the restored world must give a `canonicalState` byte-identical to the unbroken run.

**P-8 (restore BEFORE the edit — the reviewer's exact scenario).** A checkpoint taken mid-grab
at the ORIGINAL 1.5 kg, restored into a fresh world, and only THEN sent the `setMass → 0.05`
event, must reach exactly the P-1 state. This is the "after restoring a mid-grab checkpoint"
path and it must not be a hole of its own.

**P-9 (no regression).** The existing 44 tests stay green, and the build typechecks.

## 5 · The wording correction

`src/ui/main.ts:488` and `:709` currently assert the gains are **"never scaled to mass"**.
That sentence is FALSE as written: `gainsFor` scales BOTH gains AND the force cap by the
effective-mass ratio whenever `m_eff < 0.2 kg`. An absolute headline followed by an exception
elsewhere in the same UI is a contradiction, not a nuance. The same false absolute appears on
the `HAND.K` field comment in `src/sim/hand.ts` and in the `hand.ts` header block.

Replacement claim, in the reviewer's words: **the nominal gains and cap are fixed and
mass-independent; they are reduced for numerical resolution when the effective mass is low.**
The physical/controller distinction is retained — the reduction is controller behaviour, not a
change to the body's physics — and the UI must additionally show the **live effective**
`K`, `C` and cap while a body is held, so the displayed numbers cannot contradict the state.

## 6 · What is still NOT claimed

- No claim that the reduced controller feels the same as the full one. It is gentler; that is
  said out loud.
- No claim of arbitrary-body stability. The supported set is unchanged.
- No claim about `gamma·h` for the PASSIVE springs; `RESOLVABILITY` is untouched.
