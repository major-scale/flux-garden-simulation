# FP1 — deviations, recorded rather than absorbed

Every item here is a place where reality departed from what was predicted, or
where the build had to make a judgement the plan did not settle. Nothing here has
been quietly folded back into the expectations.

Reference documents, unmodified and hashed:
- `EXPECTATIONS.md` — sha256 `d55e4ee08c39d13f3dd34bc6c70ce73ffd6eef00367203c7b3449be21b9aa9ba`,
  stamped 2026-09-06T01:35:30Z, written before any physics was run.
- `EXPECTATIONS-ADDENDUM.md` — sha256 `dfbbf201d5dba48d0237d9b2eacfdbc93444670e5d24ad71d3c81dd9f28a0d54`,
  written after D-1 below was observed but **before** its forward predictions were run.
- `EXPECTATIONS-FP1R.md` — sha256 `7816f0b6ea302ae0105e51b8662a621e59787acbcf68800951e5478bbceef353`,
  stamped 2026-09-06T02:17:49Z, written after FP1 was RETURNED by review and
  **before** any of the three fixes was implemented or run.

**D-1 through D-7 below are the ORIGINAL record and have not been edited.** FP1
was returned for three bounded fixes; what those fixes changed, and what they did
not, is recorded as D-8 onwards. Where a later entry supersedes an earlier one it
says so and points at it — nothing is rewritten.

---

## D-1 — FAILED PREDICTION. The continuum spring decay rate is wrong by ~2x

**Predicted (EXPECTATIONS.md B3):** successive-peak ratio within 5 % of
e^(−zeta·omega_n·T_d) = **0.607536**.
**Observed: 0.782975.** Deviation **+28.9 %**. The rig decays at roughly HALF the
continuum rate.

B1 (8 zero crossings) and B2 (period 0.494111 s vs 0.498288 s predicted, −0.84 %)
both passed, isolating the fault to the damping rate specifically.

**Cause, derived from the scheme and then tested forward.** Rapier 0.20 advances
one `step()` as 4 sub-steps of dt/4 with any user force held constant across all
four. Establishing that independently: a body released from rest fell 1.70326e-3 m
on its first step, against 0.625·dt²·g = 1.70313e-3 m, where 0.625 = 10/16 is the
velocity-then-position sub-step weight. The resulting one-tick linear map has

    det M = 1 − dt·gamma + **0.375·dt²·omega²**

The second term is a **numerical energy injection** created by freezing the elastic
force across the sub-steps, and it works against the physical damping. For the
tested rig it happens to equal exactly half of dt·gamma, hence the factor of ~2.
That coincidence is specific to these parameters; it is not a factor-2 bug.

**Forward test (the part that makes this an explanation rather than a fit).** A
second rig that had never been simulated — K = 1600 N/m, C = 20 N·s/m — was
predicted in the addendum, before running, to give period **0.700673 s** and
successive-peak ratio **0.838706**, against continuum values of 0.703581 and
0.703416. Measured: **period 0.700634 s** (3e-6 relative) and **ratio 0.838756**
(6e-5 relative). The discrete model is confirmed and the continuum one is refuted
by 19 %.

**Not fixed, deliberately.** Suppressing this would mean either abandoning the
fixed step or evaluating our force laws inside Rapier's sub-steps, neither of which
the plan authorises. The energy it injects is reported where it belongs — see D-2.

## D-2 — FAILED PREDICTION. UNATTRIBUTED is ~50 % of owned dissipation, not <10 %

**Predicted (EXPECTATIONS.md B5):** |UNATTRIBUTED| < 10 % of owned dissipation in
the clean vacuum spring case.
**Observed: +49.75 %** (rig 1) and **+50.12 %** (rig 2).

This follows directly from D-1: for lightly damped oscillation
UNATTRIBUTED/owned = 1 − 2·sigma_eff/gamma, predicted +0.4958 and +0.4979, measured
+0.4975 and +0.5012. The addendum committed to the band [0.44, 0.56] before running
and both landed inside it.

**This is the plan working, not failing.** In this one test the dominant contributor
to UNATTRIBUTED is genuinely identifiable as integration error. It is still reported
as UNATTRIBUTED and **not** relabelled "numerical error", because the label has to
be honest in the general case, where contact friction, restitution, constraint
stabilization and integration error are superposed and cannot be separated. Naming
it here would be a promise the general case cannot keep.

## D-3 — DESIGN DEFECT FOUND BY LOOKING AT THE SCREEN. Compression springs buckle

The first build read "spring-supported platform" as four compression springs
standing **under** the platform. It rendered, and then collapsed: within ~2 s the
platform sank onto the ground.

The vertical dynamics were correct throughout. The failure was lateral: the
horizontal component of the user-force accumulator grew
−0.3 → −1.1 → −6.4 → −24 → +189 N. A two-point axial spring computes its force
along the line joining its endpoints, so in **compression** a lateral offset tilts
that line and the force pushes the offset further out — negative lateral stiffness,
i.e. a buckling mode. Four vertical compression springs constrain heave and tilt
but supply no sway or yaw stiffness at all.

**Resolution:** the platform is now **hung in tension** from four springs anchored
above (lateral stiffness ~ F_axial/L ~ 185 N/m, restoring). The geometry was chosen
so that y_eq = 0.96 − m·g/K is the *same expression* as before, so every number in
EXPECTATIONS.md section B carries over unchanged and no prediction was invalidated.

**Note this was invisible to the test suite.** Expectation B passed both before and
after, because it runs the platform alone in perfect symmetry, which supplies no
lateral seed. Only adding the blocks and *watching the page* exposed it. This is
precisely the failure mode the "launch it and look at it" rule exists to catch.

**Declared residual limit:** the spring law is linear in both directions — it is not
a one-way tension-only element — so a large enough upward disturbance can drive the
rig back onto the unstable compressed branch. Static tension margin is
x_eq = m·g/K = 0.0613 m unloaded, 0.0751 m loaded.

## D-4 — UNEXPLAINED. Contact impulse normalisation vs. Rapier's sub-steps

A 0.5 kg box resting on the ground reports an accumulated normal impulse of
0.10218 N·s per step across its 4 contact points. The expected value for static
support is m·g·dt = 0.08175 N·s. The ratio is **1.24988**, suspiciously exactly 5/4,
which smells of the 4 sub-steps plus one, but I could not establish that from the
engine's documented behaviour.

**Not resolved, and therefore not relied on.** The inspector reports the figure as
the engine gives it, labelled as an accumulated impulse in N·s, with the derived
newton figure labelled step-averaged, and states in the UI that the normalisation
against the internal sub-steps is not independently verified in this slice. No
contact or friction dissipation is estimated from it; that stays in UNATTRIBUTED.

## D-5 — Owned-dissipation channels occasionally do positive work

The energy panel reports `ticks where an owned channel did positive work`
(typically ~3 % of ticks in normal play, e.g. 69 of 2278 in one session). This
happens when the first-order start-of-tick force evaluation lags a fast velocity
reversal. **The signed value is accumulated and the tick is counted; it is not
clamped to zero**, so the anomaly stays visible instead of being absorbed into a
tidier-looking dissipation figure.

## D-6 — TOOLING. Deviations from the declared environment, not the physics

1. **npm cache** — the user's `~/.npm/_cacache` contains root-owned files and every
   `npm` command failed with EPERM. Worked around with a session-local cache
   directory. **Nothing was changed under `~/.npm`** and no `sudo` was run.
2. **npm dependency resolution** — `npm install` crashed with
   `Cannot read properties of null (reading 'edgesOut')` (an arborist bug) while
   resolving vitest's optional peer set. Installed with `--legacy-peer-deps`.
3. **vitest engine warning** — vitest 4.1.11 declares
   `node ^20 || ^22 || >=24`; this machine runs node v23.10.0, so npm emits
   EBADENGINE. Vitest was verified to run correctly anyway (11/11 tests pass).
4. **Dev-server port** — port 5177, the natural default, is **already serving another
   project** ("Flux Garden V0"). That server was left completely alone and this build
   was moved to **port 5311**.
5. **Sandbox** — the dev server could not bind a socket under the tool sandbox
   (`listen EPERM ::1:5177`); it was started with the sandbox disabled for that one
   command.

## D-7 — Residual: a DevTools *Issues* entry I could not account for

A fresh page load reports **zero console errors and zero console warnings**, but the
DevTools **Issues** panel shows "No label associated with a form field (count: 10)".

Every form field in the DOM verifiably carries **both** a `<label for=…>` **and** an
`aria-label`, confirmed by querying `el.labels` for all 7 inputs/selects (result:
none unlabelled). I hypothesised the count tracked the 10 `<option>` elements and
tested it by cutting the direction `<select>` from 6 options to 2 — **the count
stayed at 10**, refuting the hypothesis. I could not determine what it counts.

Recorded as unresolved. It is an Issues-panel audit hint, **not** a console error,
so acceptance check 1 ("zero console errors") is met; I am flagging it rather than
claiming the page is clean in a sense I have not established.

---

# After the FP1 return — D-8 onwards

## D-8 — D-1 IS FIXED. The integration was wrong; the continuum model was not

**Review finding (verbatim in substance):** *"D1 explains a substantial
integration error; the successful discrete-map prediction does not validate the
intended physical spring/damper. The simulation has not refuted the continuum
model of that system. B3 originally misses by 28.9%; the green replacement
assertion protects the numerical artifact."*

That is correct, and D-1's closing claim — *"Not fixed, deliberately… neither of
which the plan authorises"* — was wrong on its own terms. A fixed public tick does
not forbid a fixed internal subdivision. The record of the failure stands above;
what follows is what changed.

**The defect, restated exactly.** Rapier advances one `step()` as
`numSolverIterations` sub-steps with user forces held constant across all of them.
For the 1-DOF heave mode that gives a one-step determinant

    det = 1 − h·gamma + w·h²·omega²,      w = 1 − (N+1)/(2N),  N = numSolverIterations

At the shipped `N = 4`, w = 0.375. That term is a **numerical energy injection**
created by freezing the elastic force, and it worked against the physical damping.
D-1 was right that the factor of ~2 was parameter-specific; it is the `w` term
that is the defect, not the factor.

**The fix.** The public tick stays **fixed at 1/60 s** and inputs stay keyed by
**(tick, seq)** — both unchanged. Inside one public tick the world is advanced by
**4 internal fixed sub-steps of h = dt/4 = 4.1667 ms**, and our force accumulators
are **cleared and rebuilt from the current state before every one of them**.
Rapier's own sub-division is pinned to **`numSolverIterations = 1`**, which is a
requirement and not a tuning choice: at N = 1, w = 0 and

    det_sub = 1 − h·gamma      exactly, and independent of stiffness.

Four internal steps of one engine sub-step each is the same four integration
sub-steps per tick the engine was already taking, so the cost is unchanged.
**Damping was not multiplied by anything.** No constant was introduced anywhere.

**Validated against the CONTINUUM model, not against the discrete map.** All
tolerances were written down in `EXPECTATIONS-FP1R.md` and hashed before the fix
was implemented. Rig 1 (K = 3200 N/m, C = 40 N·s/m, m = 20 kg), vacuum:

| quantity | continuum prediction | derived scheme error | MEASURED | deviation |
|---|---|---|---|---|
| period T_d | 0.49828901 s | −0.219 % | 0.497194 s | **−0.220 %** (tol 1.5 %) |
| decay rate sigma | 1.000000 s⁻¹ | +0.419 % | 1.004147 s⁻¹ | **+0.415 %** (tol 3 %) |
| peak ratio | 0.60756932 | −0.099 % | 0.606942 | **−0.103 %** (tol 2 %) |

Rig 2 (K = 1600, C = 20): period −0.109 % (derived −0.110 %), sigma +0.212 %
(derived +0.209 %), ratio −0.034 % (derived −0.035 %).

**The pre-fix values, 0.782975 (+28.9 %) and 0.838756 (+19.2 %), lie outside the
bands these tests now assert.** The tests cannot be passed by the artifact they
were written to catch, and the assertions that protected it are gone.

**Convergence and limit check (R-4), rig 1, sigma against the continuum 1.0 s⁻¹:**

| internal sub-steps M | h | measured sigma | error | error × M |
|---|---|---|---|---|
| 1 | 16.667 ms | 1.017046 | 1.7046 % | 1.7046 |
| 2 | 8.333 ms | 1.008428 | 0.8428 % | 1.6855 |
| 4 | 4.167 ms | 1.004188 | 0.4188 % | 1.6754 |
| 8 | 2.083 ms | 1.002094 | 0.2094 % | 1.6755 |
| 16 | 1.042 ms | 1.001041 | 0.1041 % | 1.6660 |

`error × M` is constant to 2 %: the scheme is **first order in h** and the error
goes to zero with the step, as it must. At every M the measured sigma agrees with
the derived map value `−ln(1−h·gamma)/(2h)` to better than 0.01 %.

**Coverage of the offered regime (R-5), not an unlimited sweep.** A declared
12-point grid, k ∈ {200, 800, 3200, 12800} N/m × c ∈ {2, 10, 40} N·s/m per spring,
every point inside the declared resolvability limit of D-10. Worst measured
errors: sigma +1.712 %, period −1.024 %, and **every point agrees with its own
derived a-priori bound to within 0.04 percentage points**. The regime is covered
by an understood bound, not by luck.

**What is NOT fixed, and is not claimed to be.** The scheme remains first order in
h: a residual +0.42 % in the decay rate at M = 4 is present, derived, bounded, and
reported. It is not zero and is not claimed to be.

## D-9 — D-2's remainder collapsed, and is still reported as UNATTRIBUTED

D-2 recorded |UNATTRIBUTED| ≈ +50 % of owned dissipation and derived it from D-1.
With w = 0 that term is gone. Measured over the same rigs, 3.0 s, vacuum:

| | pre-fix | post-fix | prediction R-6a |
|---|---|---|---|
| rig 1 | +49.75 % | **−0.07 %** | < 10 % |
| rig 2 | +50.12 % | **−0.01 %** | < 10 % |

**D-2's failure record stands; its cause was removed, and D-2's own diagnosis is
what identified it.** The reviewer explicitly did not impose exact closure, and
none is claimed: the remainder is still **UNATTRIBUTED** in code, in the UI and
here. It is not renamed "numerical error", it does not become heat, and contact,
restitution and constraint dissipation remain unallocated exactly as before. That
it is now small is an observation, not a promise, and it is small in a
contact-free vacuum rig — not in general play.

## D-10 — DEPARTURE FROM THE PLAN'S PROVISIONAL LIMITS. The offered spring regime is narrowed

The plan's UI limits (`stiffnessMax = 200 000 N/m`, `dampingMax = 5 000 N·s/m`)
were provisional and, as the plan says, never a claim that every combination
inside them was validated. They were also not resolvable: at c = 5 000 per spring
on the 20 kg platform, gamma·h = 4.2 and the sub-step determinant `1 − h·gamma`
is **negative**.

The review asked for the offered regime to be covered by an explicit limit. It now
is, in terms of the internal sub-step h = 1/240 s:

    omega_n·h <= 0.30   and   gamma·h <= 0.05
    => omega_n <= 72 rad/s, gamma <= 12 s⁻¹
    => for the 20 kg platform on four springs: k <= 25 920 N/m and c <= 60 N·s/m each

Derived worst-case error at that corner: sigma +2.59 %, period −1.64 %.

**This narrows what the UI offers** — for `spring0` in the default rig the input
maxima are now **k ≤ 101 280 N/m** (was 200 000) and **c ≤ 210 N·s/m** (was
5 000). The limit is **mass-dependent**, so it is enforced on `setStiffness`,
`setDamping` **and** `setMass`, and every violation is **REFUSED and surfaced,
never clamped**. Observed in the running UI:

    setStiffness refused: springs on platform would give omega_n = 100.6 rad/s,
    above the resolvable limit 72.0 rad/s at the 4.167 ms internal sub-step
    (K <= 103680 N/m for 20.000 kg)

Recording this as a deviation rather than absorbing it: the plan named wider
limits, and this build now offers narrower ones, on purpose, because the wider
ones were unresolvable.

## D-11 — D-4 GETS A SECOND DATA POINT, and still is not relied on

D-4 recorded an unexplained contact-impulse normalisation: a resting box reported
1.24988 × m·g·Δt, "suspiciously exactly 5/4, which smells of the 4 sub-steps plus
one, but I could not establish that."

Changing `numSolverIterations` from 4 to 1 tests that hypothesis without being
designed to. Measured in the running page, N = 1:

- `loose0`, 1.5 kg on the platform, 1 manifold: 0.122625 N·s = **2.000 × m·g·h**
- `stack0`, 1.0 kg carrying 2.0 kg, 2 manifolds: 0.408750 N·s, exactly
  2 × (3 kg)·g·h + 2 × (2 kg)·g·h — **2.000 ×** on each manifold.

So the accumulation is **(N+1) × the per-sub-step impulse**: 5 at N = 4 (the old
5/4 of m·g·Δt), 2 at N = 1. The hypothesis D-4 could not establish now has a
second, independent data point.

**It is still not established from documented engine behaviour, so it is still not
relied on.** Two consistent points are a pattern, not a specification. The
inspector reports the raw accumulated impulse in N·s as the engine gives it; the
derived newton figure is now divided by **h**, the interval the accumulation
actually spans, and is labelled sub-step-averaged; the UI states the factor of two
and says the normalisation is unverified. **No contact or friction dissipation is
estimated from it. It stays in UNATTRIBUTED.**

## D-12 — DEFECT FOUND BY SOURCE INSPECTION THAT EVERY TEST MISSED. Rewind did not rewind the record

**Review finding:** `src/ui/main.ts` restored `recording = true` and `seqCounter`
but never restored `recorder.events`; `Checkpoint`/`CheckpointExtras` omitted the
recorded history entirely.

**Confirmed, and it is a real defect.** Record A, checkpoint, record B, restore:
B remained in `recorder.events` although its future had just been discarded, and
the next event minted B's sequence number while B was still in the history. A
fresh app restoring the same checkpoint had no history at all.

**Fixed by saving and restoring what a rewind has to rewind**: the checkpoint now
carries `recordedEvents` **and** `recordingBase` — the construction the history
replays against — and `extrasFrom(recorder, …)` is the only way to build the
extras, so no caller can forget them again. Observed in the running UI:

    after event A : tick=42 history=1 [push@25.0] nextSeq=1
    after event B : tick=78 history=2 [push@25.0, addBlock@66.1] nextSeq=2
    after restore : tick=42 history=1 [push@25.0] nextSeq=1

B is gone with the future it belonged to, and seq 1 is free again because nothing
holds it. A fresh `Recorder` restoring the same checkpoint holds `[A]` and the
base, and replaying that restored record reproduces the checkpointed state
byte for byte (R-8c).

**The two related lifecycle holes named in the review are closed too**, through one
`worldReplaced()` function used by both paths, which states its consequence in the
UI instead of changing meaning silently:

- **construction load** — pending replay events are dropped and the recording is
  **terminated**, because the loaded construction is not the base the history
  replays against: *"RECORDING TERMINATED: the loaded construction is not the base
  this recording replays against (1 event dropped)"*.
- **reset while recording** — pending cleared and the history **rebased** to tick
  0 with the counter, since the new world *is* the recording's base: *"recording
  continues, history rebased to tick 0 (2 events discarded with the old run)"*.
  No recorded event can carry a tick the new world has not reached.

**Why the tests missed it, recorded rather than excused:** every checkpoint test
built its extras by hand and asserted the fields it had just written. None
exercised record → checkpoint → record → restore, which is the only ordering in
which the omission is visible. The focused test now exists (R-8a/b/c) and the
extras can no longer be assembled field by field at a call site.

## D-13 — EVIDENCE CLAIM OVERREACH. The hash could not support what was claimed

**Review finding:** `stateHash` is a 32-bit FNV fingerprint of selected numerical
fields plus ids, not a bit-exact comparison of complete solver/application state.

**Correct, and the word "BIT-EXACT" in the old tests was an overreach.** The hash
omits environment, budget, pending input, recorder state and settings, and 32 bits
collide.

**What the exactness comparison covers now.** A canonical serialisation of the
**declared replay state**, every number written as its **IEEE-754 bit pattern**,
compared **byte for byte** — 45 019 bytes over 11 checkpoints in the replay test,
where there used to be eleven 32-bit hashes. The scope is declared as data in
`REPLAY_STATE_SCOPE` and printed by the test suite. **In scope:** tick, nextSerial,
sub-step count, insertion order, environment medium and gravity, per body
kinematics/mass/translation/rotation/linvel/angvel, per spring
endpoints/restLength/stiffness/damping, foreignAccumulatorWrites, the whole energy
budget including every intervention record; and on the application side pending
events, recorded events, recording base, recording and paused flags, seq counter,
selection.

**What it explicitly does NOT cover, and is therefore not claimed:** Rapier
internals its own snapshot does not round-trip through this API (broad-phase
structures, contact-manifold warm-start caches); engine handle *values*, an engine
allocation detail, compared only through the checkpoint's id→handle mapping;
render state; `wallClockMs` annotations, which are non-authoritative by
construction; performance counters; and derived caches (`kDrag`), recomputed from
what is in scope.

**Targeted-mutation evidence (R-9b/c).** Eleven single-field mutations of state
inside the promised contract. The canonical comparison detected **11 of 11**. The
32-bit `stateHash` detected **1 of 11** — it missed environment.medium,
budget.dissipatedDrag, budget.unattributed, foreignAccumulatorWrites, a pending
event, a recorded event, seqCounter, selectedId, settings.recording and
recordingBase. That is the measured evidence that the old claim was an overreach,
and it is why the hash is now documented as a display fingerprint only.

**The strongest engine-level statement attempted, reported either way (R-9d):**
Rapier's own snapshot blob, byte for byte, between two identical replays to tick
120 — **14 162 vs 14 162 bytes, BYTE-IDENTICAL**. It is reported as an
observation. **No acceptance criterion depends on it and no bit-identical
whole-engine-memory claim is made anywhere**, because the API does not let us
establish what that blob does and does not contain.

## D-14 — METHOD NOTE. A second decay estimator, beyond what R-2b declared

`EXPECTATIONS-FP1R.md` R-2b declared the decay rate would be measured by a
least-squares fit of ln(peak) against peak time. That is what R-2/R-3 do. For the
sparsely-sampled stiff rigs of the R-4/R-5 grids (down to 7.5 samples per period)
parabolic peak interpolation is worth a couple of percent by itself, which would
have been reported as physics.

Those two tests therefore also identify the 3-term linear recurrence
`y[n+1] = a·y[n] + b·y[n−1] + c` that the samples satisfy, by ordinary least
squares, and read the decay and frequency from its roots — exact for a uniformly
sampled damped sinusoid at any sampling density above 2 samples per period, with
the constant term absorbing equilibrium offset. It embeds no physical model and no
scheme model.

**No tolerance was changed.** Both estimators agree where both are usable: rig 1
gives 1.004147 s⁻¹ from the declared peak fit and 1.004188 s⁻¹ from the
recurrence, against a derived map value of 1.004190. Recording the addition rather
than absorbing it.

## D-15 — Semantics note: `nonDissipativeTicks` is still per TICK

The counter of ticks in which an owned channel did net positive work (D-5) now
sums the four sub-steps of the tick before testing the sign, so a sub-step-level
reversal that cancels inside one tick is no longer counted. The label and the unit
are unchanged, and the signed value is still accumulated rather than clamped.
Noting it because the number is not comparable across the fix.

---

# DM1 — SLICE TWO. Direct manipulation (grab, haul, release)

Against `EXPECTATIONS-DM1.md` (sha256 `b2683f5987f6a305c2c844277a2c8f7b879e27db0b40147314d6134ce9e27c5d`,
stamped 2026-09-06T03:10:34Z) and `EXPECTATIONS-DM1-ADDENDUM.md`
(sha256 `a22c9292f091d9e13e2da10ff0abd9f823222ff2f8f015f0a9baddb2837d3ad1`,
stamped 2026-09-06T03:30:31Z), under `bridge/ACCEPTANCE-RULES-v1.md`.

**Eight predictions failed. None has been rewritten, and every failing number is
below.** Six were defects in my own predictions or fixtures, two of them in the
addendum I wrote to correct the first four. **No implementation defect was found
by the DM1 witnesses** — which is itself worth stating plainly rather than
presenting as a clean sweep.

## D-16 — FAILED PREDICTION. W1e mixed the start and end sub-step configurations

**Predicted (W1e):** `(Δv_grab · n)/h = |F|/m_eff(n)` within **2e-3 relative**,
and the engine-inertia route to `m_eff` within **0.5 %** of the analytic one.

**Measured, first run:** WB-O `m_eff` engine route **0.786485** vs analytic
**0.781250** — **+0.670 %, FAILED**; the physical comparison, had the test
reached it, was **76.543689 vs 76.800000 = −0.334 %**, also outside 2e-3.

**Independent evidence for the amendment** (not from the failing number): the
sub-step map evaluates the force, and hence `r`, at the **start** of the
sub-step — `v_grab = v_{n+1} + ω_{n+1} × r_n`. W1e's text did not say at which
configuration `v_grab` was to be read, and the fixture read `velocityAtPoint` at
the **end**-of-sub-step grab point while computing `m_eff` at the start. That is
a boundary-condition error in the fixture, derivable from the scheme alone.

**Discriminating test:** both configurations are now computed. Start
configuration: **+0.000001 % (WB-L), +0.000003 % (WB-H), +0.000001 % (WB-O),
+0.000013 % (WB-P)**. End configuration reproduces the original offset
**−0.333739 % for WB-O** with `|ω|·h = 3.984e-3` — and **−0.000001 % for WB-L /
WB-H, where `ω ≡ 0` and the two configurations coincide.** The correction is
therefore not a loosening: it changes nothing where there is no rotation and
recovers exactly the O(ω·h) offset where there is. Engine-vs-analytic `m_eff` at
the start configuration: **0.000000 %, 0.000000 %, 0.000006 %, −0.000001 %**.

## D-17 — FAILED PREDICTION. W2d normalised the residual by itself

**Predicted (W2d):** `|R(4)| / |W_hand(4)| < 1.5 %` and `< 0.4 %` at `M = 16`,
for every witness.

**Measured:** **100.000 %** (WB-L), **85.672 %** (WB-O), **9.455 %** (WB-P) at
`M = 4`. **FAILED for three of four.** WB-H passed at **0.582 %**.

**Independent evidence for the amendment:** §2.3.1 of the same file — written
before any run — gives `R = ΔE_mech − W_hand`. The gesture §2.3.2 declares
starts the body at rest and drives it to a **stationary** target with
`ζ ≈ 0.7–1.1`, so it also **ends at rest**, so `ΔE_mech = 0` **exactly**, so
`R ≡ −W_hand` and `|R|/|W| ≡ 1` **for every step size**. W2d was
**unsatisfiable by any correct implementation on its own fixture.** WB-P and
WB-H are the two witnesses that end with `ΔE_mech ≠ 0`, and they are exactly the
two that behaved sensibly.

**Discriminating test:** `A-3` demonstrates the identity directly — WB-L gives
`|R|/|W| = 1.00000000` at both `M = 4` and `M = 16`.

**The claim is WITHDRAWN, not re-banded.** No absolute bound on the residual's
size is asserted anywhere now. §2.3.1 supports **first order in h** and nothing
more; the 1.5 % figure was an unfounded guess. **The measured sizes are reported
as findings** (below), and they stay inside UNATTRIBUTED, never called heat.
Criterion 2 asks for **convergence**, which is demonstrated, not for smallness.

**Reported, not predicted — `|R|/|W_hand|` at the shipped `M = 4`:**

| witness | step-input gesture | smooth-haul gesture |
|---|---|---|
| WB-L light, COM | 100.000 % (rest-to-rest, ≡1 by identity) | — |
| WB-H heavy, COM | 0.582 % | — |
| WB-O offset corner | 85.672 % | **3.560 %** |
| WB-P loaded platform | 9.455 % | **2.507 %** |

**The step fixture is a 0.374 m instantaneous target jump — 224 N onto a 0.5 kg
body, 46 g.** It is not what a pointer does. On the **smooth haul**, which is
exactly what the UI's per-tick resampler produces, the same estimator on the same
bodies gives **3.56 % and 2.51 %** at `M = 4` — a **24× improvement for WB-O**.
That difference is a finding about the fixture, and it is why the on-screen
UNATTRIBUTED figure after a real grab is small.

## D-18 — FAILED PREDICTION. W2f's discriminator was ill-posed on a rest-to-rest fixture

**Predicted (W2f):** the deliberately mis-booked centre-of-mass estimator must
**not** converge — `|R_wrong(16)| > |R_wrong(1)|/4`.

**Measured:** `0.433` against a required `> 0.962`. **FAILED. The wrong
estimator converged too, so the guard guarded nothing.**

**Independent evidence:** the two estimators differ by `Σ τ·ω h → ∫ τ·ω dt`,
the **rotational work**. On a gesture that ends at rest `ΔKE_rot = 0`, so that
difference also tends to zero. A discriminator between two work estimators must
run where the quantity they disagree about is **non-zero at the end**.

**Discriminating test (A-4c), on a fixture that ends in motion:**

| | correct estimator `|R|` | wrong (COM) estimator `|R|` |
|---|---|---|
| WB-O, M=32 → M=64 | 2.074e-3 → 1.014e-3, **ratio 0.489** (halves) | 1.212e-2 → 1.296e-2, **ratio 1.070** (does not) |
| WB-P, M=8 → M=16 | 1.097e-1 → 5.471e-2, **ratio 0.499** (halves) | 1.466e+1 → 1.471e+1, **ratio 1.003** (does not) |

On WB-P the wrong estimator books **−5.99 J** where the correct one books
**+8.80 J** — it gets the **sign of the hand's work wrong** — and its residual
**grows** toward the rotational-work limit under refinement. The guard now
guards.

## D-19 — FAILED PREDICTION. DM-3g banned a key that is legitimate authored content

**Predicted (DM-3g):** the saved construction contains no `localPoint` key.

**Measured:** it does. **FAILED.**

**Independent evidence:** `model/construction.ts` has defined
`SpringEndpoint = { kind: 'body'; entityId; localPoint }` since slice one. A
spring endpoint's `localPoint` **is** authored content and has nothing to do with
the hand. My banned list was simply wrong.

**Discriminating test:** the banned set is now exactly the hand's own keys
(`hand`, `grab`, `gesture`, `gainScale`, `kP`, `kD`, `fMax`, `worldTarget`,
`mEffBound`), **and** the test now asserts `"localPoint"` **is** present — so the
exclusion is checked against a real artifact rather than an empty one.

## D-20 — FAILED PREDICTION. W1c/W1d assumed the hand was the only force on WB-P

**Predicted (W1c):** `Δv_com = F_hand·h/m` within **2e-4 relative**.

**Measured on WB-P:** `4.213283e-2` against `1.041667e-2` m/s — **+304.475 %.
FAILED.**

**Independent evidence:** §2.1 of the same file defines WB-P as carrying **four
springs**, and §2.2's own preamble says *"the only forces are the hand and, in
WB-P, four undamped springs"*. §2.2 then wrote the map with `F` = the **hand**
force. The file contradicted itself at the moment it was stamped.

**Discriminating test (A-1b):** the corrected prediction uses the **total**
applied force. WB-P now matches to **+0.000016 %** while the **hand-only**
prediction is still wrong by **+304.475 %** — and for the three hand-only
witnesses the two predictions are **bit-identical**, so the correction cannot
have loosened anything. Torque likewise: WB-P `|ω|` **3.494446e-2** vs predicted
**3.494460e-2**, **−0.00039 %**.

## D-21 — FAILED PREDICTION. The convergence grid included steps outside the declared margin

**Predicted (W2b):** `|R(M)|·M` constant within **±25 %** for
`M ∈ {1,2,4,8,16}`.

**Measured on WB-O:** spread **51.7 %**, driven entirely by `M = 1`
(`|R|·M = 4.375` against `9.067, 8.854, 8.758`). **FAILED.**

**Independent evidence:** §1.3 of the same file declares the controller margin
`h·γ <= 0.5` and §1.6 declares that **only** cases inside it are supported. At
`M = 1`, `h·γ = 0.80` for WB-L and **1.10** for WB-O — outside a limit this build
had already declined to claim, before anything ran. §2.3.2's grid contradicted
§1.3.

**Discriminating test (A-2b):** the excluded points are **still run and still
reported**, and the exclusion criterion is the pre-declared margin and nothing
else. Three points are excluded in total — WB-L M=1 (`h·γ = 0.80`), WB-O M=1
(`h·γ = 1.10`), WB-O M=2 (`h·γ = 0.55`) — of which **one breaks the band**
(WB-O M=1, **−51.75 %**) and two happen to satisfy it (**−19.87 %** and
**−4.54 %**). So the exclusion is neither vacuous nor result-driven.

## D-22 — FAILED PREDICTION, MINE, IN THE ADDENDUM. Anchoring |R|·M at the largest M

**Predicted (A-2a):** `|R(M)|·M` within **±25 %** of its value at the **largest**
admissible `M`.

**Measured on WB-L:** `M = 2` deviates **+26.73 %**. **FAILED.**

**Independent evidence:** `EXPECTATIONS-DM1.md` W2b, stamped first, anchored the
band at **`M = 4`**. A-2a moved the anchor — a **tightening I introduced**, not
one the reviewer's criteria asked for. Reverting to the **stamped** anchor is
therefore not a post-hoc loosening; it is undoing my own unstamped change.

**The band has never moved: it is ±25 %, as stamped.** Both anchors are now
printed for every row, so the M-max deviations are visible whatever the
assertion uses. At the stamped `M = 4` anchor the worst deviation across all four
witnesses is **+14.84 %** (WB-L, M=2).

## D-23 — FAILED PREDICTION, MINE, IN THE ADDENDUM. "Every excluded point must also violate"

**Predicted (A-2b):** every grid point excluded for being outside the controller
margin must **also** break the ±25 % band, so that the exclusion is demonstrably
not a convenience.

**Measured:** WB-L at `M = 1` deviates only **−19.87 %** — it satisfies the band.
**FAILED.**

**Independent evidence:** being outside a *stability* margin and failing an
*accuracy* band are different properties; nothing implies the first entails the
second. `h·γ = 0.80` at WB-L M=1 is only 1.6× the margin, whereas WB-O's 1.10 is
2.2×. The over-claim was mine.

**Amended to what is actually true and load-bearing:** a point is excluded **iff**
`h·γ > 0.5`, the pre-declared margin; every excluded point is reported with its
`h·γ` and its deviation; and **at least one** excluded point must break the band
so the exclusion is not vacuous. Measured: **3 excluded, 1 breaks the band.**

## D-24 — FINDING, not a deviation. The hand's residual is first order and it is REPORTED

Across the four witnesses the accounting residual `R = ΔE_mech − W_hand` is
**first order in h** with the derived coefficient of §2.3.1
`R_pred = −½ Σ h²(|F|²/m + τᵀI⁻¹τ)`:

- **WB-H** (hand is the only force): `R/R_pred` = **1.00000, 1.00001, 1.00005,
  1.00007, 1.00009** over `M = 1…16`, and `|R|·M` constant to **0.12 %**. The
  derived coefficient is exact to five figures.
- **WB-L**: `R/R_pred = 1.00000` at every `M`; `|R|·M` constant to **14.8 %**.
- **WB-O**: `R/R_pred` **0.970–0.972**; `|R|·M` constant to **4.2 %** over a
  **16×** refinement.
- **WB-P** (four springs also present): `R/R_pred` **0.652–0.654**, stable but
  **not 1** — reported, never asserted, because the springs contribute their own
  first-order residual and cross terms this coefficient does not model. Its
  `|R|·M` is constant to **1.9 %** and `|R|/|W|` falls **28.1 % → 2.58 %** across
  the same refinement.

**This residual is numerical. It is not heat.** It lands in UNATTRIBUTED and the
panel says so. The standing prohibition holds.

## D-25 — FAILED PREDICTIONS, MINE, FIVE OF THEM. Exact decimal literals for an f32 engine mass

**Predicted** (`EXPECTATIONS-DM1-STALE-GUARD.md`, sha256 `d5b5ab88…`, stamped
2026-09-06T03:54:18Z, P-1/P-3/P-4/P-7/P-8): after `setMass loose0 → 0.05` on the
held body, the recomputed guard would read **exactly** `mEffBound = 0.05`
(within 1e-12), `gainScale = 0.25`, `kP = 150`, `kD = 6`, `fMax = 100`, and at
the corner grab `mEffBound = 9.090909e-3` within 1e-9.

**Measured, first run after the fix:**

    P-1  mEffBound  0.05        -> 0.05000000447034836      (+8.9407e-8 rel)  FAILED
    P-3  gainScale  0.25        -> 0.2500000223517418       (+8.9407e-8 rel)  FAILED
    P-4  mEffBound  9.090909e-3 -> 9.090910457926643e-3     (+1.6035e-7 rel)  FAILED
    P-7  kP         150         -> 150.00001341104507       (+8.9407e-8 rel)  FAILED
    P-8  mEffBound  0.05        -> 0.05000000447034836      (+8.9407e-8 rel)  FAILED

**Every FUNCTIONAL clause of those same predictions passed** on the same run: the
guard was recomputed, the grab kept, the gesture id and accumulated work
untouched, the declared margin restored (P-2 exactly at `γ·h = 0.5`), the offset
grab guarded harder, a refused edit inert, and replay and both restore paths
identical. What failed is the exactness of five decimal literals.

**Independent evidence, predating every one of those five runs.** The **P-0**
run, executed against the **UNFIXED** build before the fix or these tests
existed, printed `loose0` mass = `1.500000238418579` for a body **authored** at
1.5 kg with `setMass` never called on it. And `record.ts` stores a **density**
(`setDensity(m / volume)`) and reads the mass back with `b.mass()`; Rapier's
`Real` is **f32** in this build. The assumption that `setMass(m)` makes the
engine report exactly `m` was false, and demonstrably false before any of this.

**Discriminating test (A-1b, A-1c, A-2a, A-2b — `EXPECTATIONS-DM1-STALE-GUARD-A1.md`
`85a7c0c8…` and `-A2.md` `caef733e…`, both stamped before running).** If the
error were the GUARD's, it would be the same relative size at every mass. If it
is a single-precision value round trip, it is a property of each value and must
differ. Measured:

    rel(1.5)  = +1.5895e-7      rel(0.05) = +8.9407e-8      |diff| = 6.9539e-8
    predicted before the run: |diff| > 5e-8                 PASSED

and with `r = 0` the guard adds **no** error of its own:
`f64hex(hand.mEffBound) === f64hex(runtime.mass)`, and `gainScale`, `kP`, `kD`,
`fMax` are **bitwise** `m/m_min`, `600·s`, `24·s`, `400·s`. **PASSED.**

**Amended to what is true and load-bearing (A-1d):** the guard is asserted
**bitwise against the engine-reported mass** — the only mass the simulation ever
integrates — and **relatively, within 1e-6**, against the declared literals.
1e-6 is ~8× the f32 machine epsilon `2^-23 = 1.1921e-7` and four orders below any
physically meaningful gain difference; it is set from the format's resolution,
not from the size of the failure. **No margin was relaxed:** P-2's
`γ·h ≤ HAND.MAX_GAMMA_H + 1e-9` and the Jury checks are unchanged and passed.

## D-26 — FAILED PREDICTION, MINE. A-1a's model of Rapier's density→mass pipeline

**Predicted (A-1a):** `engineMass(1.5) == Math.fround(1.5/0.027) * 0.027` within
1e-15 relative — i.e. one f32 rounding of the density, then f64 arithmetic.

**Measured:** engine `1.500000238418579`; `Math.fround(1.5/0.027)*0.027 =
1.5000000457763671`; relative difference **1.2843e-7. FAILED.**

Rapier computes the collider volume from its own f32 half-extents and multiplies
in f32 throughout, so there are several roundings and I do not have their order.
**I did not keep guessing until a guess turned green** — that would have been
fitting a model to an output. A-1a is withdrawn as a mechanism claim and stays
failed.

**What it was evidence FOR is unaffected.** A-1a was one of three arguments in
D-25; the other two — the pre-fix P-0 observation on the *authored* mass, and the
A-1c relative-size discriminator — do not depend on knowing the pipeline, were
stamped before running, and both passed. The replacement (**A-2a/A-2b**) asserts
only the format-level property `1e-9 < |engineMass(m)/m − 1| ≤ 1e-6` for
`m ∈ {1.5, 0.05}`, with both bounds taken from IEEE single precision rather than
from the observed failure. **Had A-2a or A-1c also failed, the correct conclusion
would have been that the guard is imprecise and the fix incomplete.**

## D-27 — DEFECT FOUND BY INDEPENDENT REVIEW. The gain guard was stale-able mid-gesture

**Not found by any of the 44 tests.** `gainsFor` was evaluated in exactly one
place, `SimWorld.beginGrab` (`world.ts:447`). `applyEvent`'s `setMass` case
changed the body's mass, collider density, recomputed rigid-body **inertia** and
drag coefficients — and left the active hand's `kP/kD/fMax/gainScale/mEffBound`
alone. Every subsequent sub-step kept integrating the gains chosen for the old
inertia.

**Demonstrated (P-0, on the unfixed build).** Grab `loose0` at its local origin at
the authored 1.5 kg, then `setMass → 0.05` while held — an edit the build
**accepts** (`applyEvent` returned `null`): mass ratio 400:1 is inside the
2000:1 bound, and `loose0` carries no spring so `resolvabilityIssues` cannot
fire. Afterwards:

    hand.kD = 24 (stale), hand.mEffBound = 1.5 (stale), hand.gainScale = 1 (stale)
    LIVE gamma*h = (24/0.05)/240 = 1.9999998   against a DECLARED margin of 0.5   (4x over)
    LIVE Jury    h^2w^2 + 2h*gamma = 4.2083    against the stability boundary 4   (OVER IT)

So it is worse than a margin violation: the sub-step map is outside Jury's own
condition for this scheme. This is not a demonstrated explosion, but it is a
demonstrable bypass of a declared guard through an ordinary supported
intervention, reachable in the UI and reachable through a mid-grab checkpoint
restore.

**Fix — RECOMPUTE, of the three options offered.** `SimWorld.refreshHandGains()`
re-evaluates the identical guard on the held body; `beginGrab` now calls it too,
so there is exactly **one** implementation and the initial and re-evaluated gains
cannot drift. It is called from inside the **same `sim.intervene` closure** as
the mass change, after `recomputeMassPropertiesFromColliders`, so no sub-step can
observe the new inertia against the old gains, and replay — which drives the
identical `applyEvent` path — reproduces it exactly.

**Why not the other two.** *Refusing* would newly forbid an edit FP1 has always
supported, purely because a transient hand happens to be attached, and would make
a restored mid-grab checkpoint refuse what the same construction accepts with
nothing held — a scope reduction, not a fix. *Releasing* would drop a body the
user is holding as a side effect of a slider, and would silently change the
replayed dynamics of any existing recording that edits mass mid-grab.

**Replay and checkpoint coherence.** The recomputation touches only
`kP/kD/fMax/gainScale/mEffBound`, all five of which were **already** inside
`REPLAY_STATE_SCOPE.simIn` and already in `canonicalSimState` (`world.ts:952-956`)
— so no scope, format or fingerprint changed. It moves nothing and changes no
mechanical energy, so the frozen-edit ΔE of `setMass` is unaffected. The gesture
id, attachment point, target and accumulated `gestureWork` all survive untouched.

**Regression: `DM-4`, 8 tests.** P-1/P-2 recompute + restored margin (`γ·h`
back to exactly 0.500000000); P-3 symmetry, mass raised back restores nominal
600/24/400 with `gainScale` exactly 1; P-4 corner grab guarded harder
(`m_eff = 9.09e-3` kg, `gainScale = 4.55e-2`); P-5 a refused edit changes neither
body nor guard; P-6 the mid-grab edit replays byte-identically at 1 and 7 ticks
per pump; P-7 a checkpoint taken **after** the edit round-trips all five fields
bitwise and continues byte-identically for 155 more ticks; P-8 the reviewer's own
path — checkpoint mid-grab at the original mass, restore into a desynchronised
fresh world, **then** edit — reaches the same state, `γ·h = 0.500000000`.
**44 existing tests stay green; 52 total.**

## D-28 — RULINGS RECORDED FROM INDEPENDENT REVIEW (not tasks, not amendments by me)

These are the reviewer's rulings on earlier entries, recorded verbatim in
substance. They narrow or correct the *reasoning* attached to those entries; the
entries themselves are unchanged and their red results stay red.

**On D-17 (W2d normalised the residual by itself).** The withdrawal is **ACCEPTED
for this slice**, but the reasoning is narrowed to exactly this: *"Near-rest-to-rest
net work is an ill-conditioned denominator… The identity explains the denominator
problem, not the acceptability of every other rig's error (including the 9.45 %
case). Convergence plus explicit reported error supports the current qualified
work-estimator contract; it does not establish arbitrary accuracy."* In
particular the 9.45 % case is **not** excused by the identity. **Note for later:**
if a relative-error criterion is ever needed, normalise by an independently
chosen **non-cancelling** scale such as **GROSS** work — never by net work near
zero.

**On D-22 / D-23 (my two addendum predictions).** *"Retaining the original
acceptance anchor is acceptable, but reverting a failed added prediction is still
an explicit amendment, not automatically vindicated by its being optional. Keep it
failed in the record."* They are kept failed. And: *"A sufficient stability margin
need not fail an accuracy test immediately outside it; do not require that
invented implication."* — the D-23 over-claim was an invented implication and is
not to be reinstated in any form.

**On ORDERING — recorded as an ACTUAL PROCESS DEVIATION, not an acceptable
reinterpretation.** Frozen criterion 2 says the witnesses run *"before dependent
UI work"*. *"'Before dependent UI work' did mean before that work."* Reading it as
"before the UI is finally accepted" was wrong. **No retrospective rebuild is
required** — the witnesses did run and did pass, and re-running them in a
different order would prove nothing. **The order is to be enforced on the next
slice**, not argued about on this one.

---

# BB1 STAGE ONE — breadth batch 1, shared capability + demos 1–3

Against `EXPECTATIONS-BB1-S1.md` (sha256
`db9311d04d3de08eb61da3474e3043df8ce43da77977ccb64592c6455fa1b54f`, stamped
2026-09-06T04:16:49Z, **before any of stage one was implemented or run**) and
`EXPECTATIONS-BB1-S1-A1.md` (sha256
`4df2364156ce6bdf3275161d422effed79385695caa869d215cefaa6e817fc54`, stamped
2026-09-06T04:30:36Z, after the first witness run and **before** the corrected
literals were re-run). Under `bridge/ACCEPTANCE-RULES-v1.md`.

**Ordering, as required this batch: the witnesses in `src/sim/mechanics.test.ts`
were WRITTEN AND RUN BEFORE ANY OF THE DEMO UI WAS WRITTEN.** No line of
`ui/plot.ts`, no scene control and no demo panel existed when the first run
happened. The reference cards were stamped before the physics layer existed.

**Three predictions failed on the first run. All three are below and none has been
rewritten. One of them is a genuine failure of demo 2 and it is still failing.**

## D-29 — FAILED PREDICTION, RETAINED AND STILL FAILING. Demo 2's large-amplitude period

**Predicted (C2.2):** the measured pendulum period is within **1.0 %** of the exact
rigid-pendulum period `T(θ0) = T0·(2/π)·K(sin(θ0/2))` at every declared amplitude.
**Predicted (C2.3):** `T(90°)/T0 − 1 > 15 %` and `T(120°)/T0 − 1 > 30 %`.

**Measured:**

| θ0 | T_measured | T_exact | vs exact | vs T0 | amplitude drift |
|---|---|---|---|---|---|
| 3° | 1.5572452 | 1.5572641 | −0.0012 % | +0.016 % | −0.032 % |
| 30° | 1.5831586 | 1.5841027 | −0.0596 % | +1.680 % | −3.081 % |
| 60° | 1.6562273 | 1.6709414 | −0.8806 % | +6.373 % | −10.715 % |
| 90° | 1.7629667 | 1.8377871 | **−4.0712 % FAILED** | +13.229 % (**< 15 %, FAILED**) | −19.845 % |
| 120° | 1.8868850 | 2.1375710 | **−11.7277 % FAILED** | +21.190 % (**< 30 %, FAILED**) | −30.832 % |

**C2.2 fails at 90° and 120°. C2.3 fails at both. The tolerance has NOT been
widened, the amplitude range has NOT been shrunk, no case has been deleted, and
the test remains in the suite, red.** `npm test` is 83 passing and **1 failing**,
and that one failure is this.

**Cause, established with evidence independent of the failing period numbers.**

1. **Not the constraint solve.** Raising `numInternalPgsIterations` from 1 to 4 and
   to 16 changes the measured period and the drift by **nothing**, to six decimals,
   at every amplitude.
2. **First order in the sub-step, and convergent.** Drift over six periods at 90°:
   −19.845 % (M=4), −12.130 % (M=8), −6.850 % (M=16). Halving `h` roughly halves it.

   > **CORRECTION, 2026-09-06 (see D-33). The sentence above overstates the rate,
   > and the original wording is left standing so the record is not rewritten.**
   > "Halving `h` roughly halves it" is not what the data show. Measured on the
   > free-spin witness across the full bounded ladder, the ratios of SUCCESSIVE
   > log-decrements are **0.610, 0.569, 0.539, 0.521, 0.510** for
   > M = 4→8→16→32→64→128. They approach ½ from above and do not reach it, so
   > the reduction from M = 4 to M = 8 is **39 %, not 50 %**. First order is
   > consistent with the trend; it is **not** demonstrated by it, and **no
   > asymptotic rate is claimed** anywhere. The same correction applies to the
   > drift figures quoted in `EXPECTATIONS-BB1-S1-A1.md` §3(b) — that file is
   > STAMPED and is deliberately NOT edited.
3. **The discriminating test — it is the HINGE, not the gravity torque.** With
   gravity set to **zero** and the bob spun about the hinge at ω = 5.7 rad/s there
   is **no torque of any kind** and kinetic energy must be conserved exactly.
   Measured over 11 s: **5.871593 J → 2.365071 J, −59.72 %** at M=4; −42.58 % at
   M=8; −27.05 % at M=16.

A hard rotational constraint advanced by semi-implicit Euler bleeds energy at
O((ωh)²) per sub-step. That is the whole of demo 2's large-amplitude error.

**In every one of those runs the deficit lands exactly in UNATTRIBUTED**, the
budget identity closes to the last digit, owned dissipation is identically zero
because the scene has no drag and no damper, and **not one joule is called heat**.
The standing prohibition held.

**No correction exists inside this build's declared invariants.**
`numSolverIterations` must stay at 1 or D-8's force-freezing artifact returns for
springs. `numInternalPgsIterations` does nothing. Reducing `h` globally would
change the whole validated FP1/DM1 regime **and would still fail** — at M=16 the
120° error is −4.87 %, nearly five times the declared tolerance. **Demo 2 is
reported as RETURNED.** The running UI states the failure, in red, with these
numbers, whenever the amplitude is 90° or more; it does not quietly present a
green demo.

**What demo 2 DOES deliver, stated separately so the red is not diluted:** the
small-amplitude claim (C2.1) passes — 1.5572452 s against T0 = 1.5569973 s,
**+0.0159 %**, inside the declared 0.5 %. Refinement converges (C2.4): the 3° error
falls from 1.888e-5 s at M=4 to 4.942e-6 s at M=8. And the approximation's limits
ARE visible: the measured period rises monotonically 0.016 % → 1.68 % → 6.37 %
→ 13.23 % → 21.19 % above the small-angle constant. It is the *quantitative*
agreement with the exact reference that failed, and that is what was predicted.

## D-30 — FAILED PREDICTIONS, MINE. Two card literals and one witness fixture

**C2.0, FAILED.** Card literal `T0 = 1.5569985 s`; derived value **1.5569973 s**;
|Δ| = 1.247e-6 against a 1e-6 tolerance. Card literal `T(120°) = 2.1375273 s`;
derived **2.1375710 s**; |Δ| = 4.4e-5 against 1e-5.

**C3.0, FAILED.** Card literal for the discrete peak ratio `0.5311114`; derived
**0.5311173**; |Δ| = 5.89e-6 against 1e-6.

Both are **my desk arithmetic when writing the card**, not implementation defects.
Both were corrected by **recomputing by hand** in `EXPECTATIONS-BB1-S1-A1.md` §2,
independently of the code, and the hand recomputation lands on the code's value
(1.5569972516 and 0.5311177) and refutes the card's. **No tolerance moved** — only
the literals, to the hand-recomputed values. **The physics assertions never
depended on those literals**: C2.1/C2.2/C2.4 assert against `pendulumExactPeriod`
and C3.1/C3.2/C3.3 against `discreteOscillator`, both of which recompute the
derivation; C3.3 measured 0.5311166 and would have passed against either literal.

**C2.6's first fixture was also wrong, and it failed.** The characterisation test
set gravity through an intervention and then wrote the spin velocity straight onto
the body **after** `build()` had already taken the energy baseline at rest, so the
identity clause `UNATTRIBUTED == ΔKE` failed by construction (it read +2.365071 J,
which is the *final* KE, not the change). Corrected by **authoring** the zero
gravity and the spin in the construction so the baseline is the real initial
state. That makes the assertion meaningful rather than trivially wrong; it is a
fixture correction, and the original failure is recorded here.

**C2.6 is a CHARACTERISATION test and is labelled as one in the source and in A1
§4.** Its numbers were observed before it was written, so it asserts only
derivation-backed properties — the loss is negative with no torque, all of it is
UNATTRIBUTED with owned dissipation identically zero, and it shrinks monotonically
under refinement. It does not turn D-29's red green.

## D-31 — THREE DEFECTS FOUND BY LOOKING AT THE SCREEN. None was caught by any test

All 83 passing assertions were green while every one of these was live.

1. **Demo 1 was an empty plane.** The camera was still framed on the FP1 platform
   rig (target `(0, 1.15, 0)`) while the shot flew 14 m away down +X. The first
   rendered look at demo 1 showed ground and nothing else. Fixed with a per-scene
   `camera` field, and for the projectile a framing **computed from the physics** —
   because gravity is editable, the same launch flies 14.4 m on Earth and 87.5 m on
   the Moon, and a fixed camera cannot cover both.
2. **The hinge rendered as a ball floating in mid-air.** There was no geometry
   between the pivot and the bob, because a joint is a constraint and has no body.
   Fixed with render-only joint furniture: a hinge draws its arm, a slider draws its
   travel axis. No collider, no rigid body, no feedback into the simulation.
3. **LAUNCH silently reverted a gravity edit.** Setting gravity to the Moon and then
   pressing launch put it back to 9.81, because launch rebuilds the scene from the
   preset and the preset's authored environment is Earth. Fixed by carrying the
   **live** environment onto a re-armed scene, while choosing a *different* preset
   from the selector still resets to that preset's authored environment — which is
   what choosing a preset means.

This is the third slice running in which the "launch it and look" rule caught
something the whole suite missed (D-3, D-12, and now these).

## D-32 — JUDGEMENT CALLS AND DEPARTURES, recorded rather than absorbed

1. **`Construction.joints` is OPTIONAL at formatVersion 1.** Making it required
   would have invalidated every construction saved before joints existed. Absent
   means "no joints", which is what those files meant. No version bump.
2. **A joint that does not validate is REFUSED by throwing at build time**, not
   silently dropped. A construction whose joints half-built would be a different
   construction from the one that was authored. A non-unit axis is refused rather
   than normalised, for the same reason.
3. **`numInternalPgsIterations` stays at 1.** It was tested at 4 and 16 during the
   D-29 investigation and changes nothing measurable, so nothing is claimed for it
   and it is not touched.
4. **`LIMITS.gravityMax = 50 m/s²` is a new PROVISIONAL UI limit**, of exactly the
   same status as the others: not a claim that every value inside it is validated,
   only that values outside are refused and surfaced rather than accepted.
5. **The reset button now resets the CURRENT SCENE**, not always the FP1 default.
   The selector and reset have to mean the same thing or the recording's base and
   the world would disagree. `replaceWorld` decides rebase-vs-terminate by
   comparing the new construction against the recording's own base, so re-arming
   the same scene rebases and switching scene terminates, both through the existing
   `worldReplaced` boundary.
6. **The projectile's ground is 200 m wide.** Editable gravity makes the range
   scene-dependent. It plays no part in the measured flight, which is declared to
   end when the COM returns to launch height, well clear of it.
7. **The analytic reference is withdrawn, and says so, after a mid-run gravity
   edit.** It was computed for the old g. Redrawing it would assert a comparison
   that no longer holds; the plot states the withdrawal and names the reason.
8. **The projectile's reference is drawn only over the declared flight interval.**
   After the COM returns to launch height the shot is in contact with the ground and
   the parabola describes nothing; the plot draws no line there and prints no
   residual, rather than showing a 230 m "error" against a curve that is not being
   compared with anything.
9. **No exact decomposition of joint constraint work is promised anywhere**, none
   is estimated, and none is turned into heat — in `model/joints.ts`, in
   `model/energy.ts`, in the joint panel, and in the demo-3 panel. D-29 is the
   measurement of how large that unattributed residual can be.


## D-33 — DEMO 2's HINGE: A DECLARED NUMERICAL PROFILE. The red is RETAINED

**Commissioned by the reviewer's ruling on D-29.** The ruling cut a false dilemma:
four internal sub-steps was a **selected configuration, not a permanent law of this
project**. Public tick and input semantics are unchanged — 1/60 s, `(tick, seq)`.
Replay promises the same result from the same initial state, the same input **and
the same numerical configuration**; it never promised that a coarse and a refined
solver walk the same trajectory.

### 1 · The fixture was ruled out FIRST

A fixture defect would have changed what every other number means, so it was
checked before the solver was blamed. Now a permanent witness, `F1` in
`sim/mechanics.test.ts`, at θ0 = 30°, 90° and 120° over 600 ticks each:

| checked | found |
|---|---|
| contacts involving bob, ground or pivot | **0** |
| `linearDamping`, `angularDamping` | **0**, both, explicitly set |
| `gravityScale`, CCD, sleeping, sensor | 1, off, off, no |
| bob mass | 1.0000000 kg (authored 1.0) |
| bob principal inertia | 1.4400000e-3 kg·m², against (2/5)mr² = 1.44e-3 |
| joint anchors at t = 0 | coincident to **5e-8 m** |
| max anchor violation over 10 s | 2.28e-5 / 1.66e-4 / **2.47e-4 m** |
| arm length range (L = 0.60) | 0.5999999 … **0.6002466 m** (drifts OUTWARD, +0.041 %) |
| user force from our registry | **0 N**, no contributions, no foreign writes |
| owned dissipation | **0 J** — the scene has no drag and no damper |
| bob spin vs arm rate | agree to 2.5e-3 rad/s at 120° (0.05 %) |

**VERDICT: NO FIXTURE DEFECT.** The mass, the inertia, the anchors and the
co-rotation are exactly what card 2 assumed. The large-amplitude period error is
not explained by the fixture.

### 2 · The bounded ladder. M = 4, 8, 16 retained; 32, 64, 128 added; STOPPED at 128

Original tolerances throughout: **1.0 %** against the exact elliptic period,
**> 15 %** and **> 30 %** against T0. Nothing was widened. Cost is measured
alongside accuracy, because a profile that bought accuracy outside the
responsiveness budget would not be an answer.

| M | h (ms) | 3° | 30° | 60° | 90° | 120° | drift@120° | ms/tick |
|---|---|---|---|---|---|---|---|---|
| 4 | 4.1667 | −0.0012 % | −0.0596 % | −0.8806 % | **−4.0712 %** | **−11.7276 %** | −30.83 % | 0.03 |
| 8 | 2.0833 | −0.0003 % | −0.0302 % | −0.4791 % | **−2.4360 %** | **−7.9209 %** | −21.30 % | 0.06 |
| 16 | 1.0417 | −0.0001 % | −0.0152 % | −0.2507 % | **−1.3563 %** | **−4.8706 %** | −11.82 % | 0.13 |
| 32 | 0.5208 | +0.0001 % | −0.0076 % | −0.1286 % | −0.7204 % | **−2.7709 %** | −6.75 % | 0.26 |
| 64 | 0.2604 | +0.0001 % | −0.0038 % | −0.0650 % | −0.3711 % | **−1.4910 %** | −3.64 % | 0.52 |
| **128** | **0.1302** | −0.0005 % | −0.0020 % | −0.0323 % | −0.1890 % | **−0.7754 %** | −1.89 % | **1.04** |

Bold marks a **failure** of the unmoved 1.0 % criterion. **M = 128 is the first
rung that meets it at every declared amplitude**, and C2.3 reads +17.811 % at 90°
and +36.224 % at 120°, against the required > 15 % and > 30 %.

**Cost.** Headless 1.04 ms/tick; **on the rendered scene in the browser, 1.78–1.81
ms/tick** against the existing budget of `EXPECTATIONS.md` §F — unacceptable above
16.67, warning line 8.00 — with **no dropped ticks**. Inside the budget and below
the warning line, at roughly 25× the legacy cost for this 3-body scene.

### 3 · What was built, and what "declared profile" is made to mean

`Construction.numerics = { substeps }`, refused unless it is one of the **measured**
set {4, 8, 16, 32, 64, 128}. Witnesses `P-A1`…`P-A6`:

- **absence is meaningful** — no `numerics` field means the legacy 4, and produces
  `canonicalSimState` **byte-identical** over 300 ticks to an explicit `{substeps: 4}`
  apart from the declared-profile line itself;
- **refused, never substituted** — 1, 3, 5, 6, 100, 256, 0, −4, 4.5 and NaN are
  rejected at `build()` **and** at `parseConstruction()`, with the offending value
  and the supported set named, and nothing is half-built;
- **in the canonical comparison** — both the live `subSteps` and the declared
  profile; `fp1-canonical-sim` is bumped to `/2`;
- **old-profile replay is unchanged** — a legacy record replays identically twice
  and is byte-identical to the pre-change manual path (`sim.subSteps = 4` by hand);
- **mid-run restore continues correctly** — a checkpoint at M = 128 restored into a
  **desynchronised** world (a different construction on the legacy profile, stepped
  a different number of ticks) continues byte-identically at every comparison tick;
  a checkpoint with **no** profile field restores to the legacy 4 rather than to
  whatever happened to be running;
- **guards use the ACTUAL h** — resolvability, the per-spring UI maxima and the
  hand's controller margin all take the live `h`. At M = 128 that is
  ω_n ≤ 2304 rad/s and γ ≤ 384 s⁻¹, exactly 32× the M = 4 limits.

### 4 · THE RED IS RETAINED. It is not repaired and not renegotiated

**C2.2 and C2.3 remain in the suite asserted at the LEGACY M = 4, and they remain
FAILING** — the same −4.0712 % and −11.7276 %. The tolerance was not widened, the
amplitude range was not shrunk, and no case was deleted. What changed is the
**implementation**: the scene declares a finer fixed profile, and the
pre-correction result is kept verbatim in the suite, in D-29 and in the running UI.
`npm test` is **102 passing and 1 failing**, and that one failure is still this.

### 5 · PERIOD ACCURACY IS NOT ENERGY PRESERVATION, and is not offered as it

The free-spin witness — **zero gravity, no torque of any kind, so kinetic energy
must be conserved exactly** — is retained and extended across the whole ladder:

| M | KE(0) → KE(11 s) | change | log-decrement |
|---|---|---|---|
| 4 | 5.871593 → 2.365071 J | −59.72 % | 0.909318 |
| 8 | 5.871593 → 3.371665 J | −42.58 % | 0.554719 |
| 16 | 5.871593 → 4.283519 J | −27.05 % | 0.315351 |
| 32 | 5.871593 → 4.953343 J | −15.64 % | 0.170063 |
| 64 | 5.871593 → 5.373643 J | −8.48 % | 0.088620 |
| **128** | 5.871593 → **5.612094 J** | **−4.42 %** | 0.045202 |

**At the declared profile the hinge still loses 4.42 % of its kinetic energy in 11 s
with no torque at all.** That is material and it is reported in the same panel and
the same line as the period result, never in a footnote. The window is **finite —
11.000 s — and bounds nothing beyond itself**. Every joule lands in
**UNATTRIBUTED**, owned dissipation is identically zero, and **not one joule is
called heat**. **This adapter is not energy-conserving and is described that way
nowhere.**

### 6 · NARROWNESS, binding

This evidence isolates a defect of **this configured hinge simulation** — this
adapter, this fixture, this solver configuration, this step. It does **not**
establish a universal Rapier limitation, does **not** rule out every other adapter
or fixture issue, and does **not** establish that any future hinged mechanism
behaves the same way.

## D-34 — THREE MORE DEFECTS FOUND BY LOOKING AT THE SCREEN. None was caught by a test

The witnesses for demos 4, 5 and 6 were all green, and all three demos were
nevertheless **an empty viewport** when actually launched and watched. Same class as
the blank viewport of D-31 and demo 1's off-screen shot: **no executed check ever
looked at what a user would see.**

1. **Demo 4** — in **zero gravity the pair separates forever**. Framed at 6.4 m the
   balls left the frame about a second after the impact, and by t = 9 s they were
   20 m apart. Fixed: camera widened to 11 m, the scene **starts paused** at its
   declared initial condition, and it **auto-pauses at a declared t = 2.00 s**,
   after the declared outgoing measurement at t = 1.00 s.
2. **Demo 5** — the block ran off the end of the **finite** ramp and then, at μ = 0,
   slid along the ground without limit; the camera also showed only part of the
   ramp. Fixed: camera framed on the whole ramp, starts paused, and auto-pauses at
   a declared **t = 1.20 s**, after the [0.20, 0.80] s measurement window and before
   the block reaches the ramp's end.
3. **Demo 6** — drops from 50 m and the two balls are 12.7 m apart by t = 2.5 s, so
   **no** fixed camera close enough to see the release can hold them. Fixed with a
   **render-only** follow camera that tracks the pair's midpoint and widens to their
   separation.

**The auto-pause is presentation only and says so on screen and in the HUD.** It
changes no physics and no measurement: the ticks that ran are the ticks that ran,
the pause is the fixed-step driver's ordinary one, and resume continues normally.

## D-35 — RECORDED CHANGE: `build()` is now AUTHORITATIVE over the sub-step count

Because the construction now declares the profile, `SimWorld.build()` sets the live
sub-step count from it (absent = the legacy 4) instead of leaving whatever was
there. Two **pre-existing** convergence helpers set `sim.subSteps = M` *before*
calling `build`, and now set it *after*: `R-4` in `sim/physics.test.ts` and `drive()`
in `sim/hand.test.ts`. **No assertion, tolerance or measured quantity changed** —
`build()` only creates bodies, and the setter reconfigures the step before the first
tick. Their existing numeric expectations still pass unchanged, which is the
evidence that nothing moved. The `subSteps` setter is retained for convergence
studies that sweep values outside the supported set; a **construction** may still
only declare a supported one.

## D-36 — BB2's SIX FAILED PREDICTIONS. All mine but one; that one STAYS RED

Batch 2 (authorable ball and fixed connections) against
`bridge/BATCH2-ACCEPTANCE-v1.md` (sha256 `f520d4fd…`, frozen by an independent
reviewer before any implementation existed) and the stamped
`EXPECTATIONS-BB2-CONNECTIONS.md` (sha256 `748227ef…`, 2026-09-06T06:30:37Z).

**The stamped declaration is NOT edited.** The corrections live in
`EXPECTATIONS-BB2-CONNECTIONS-A1.md` (sha256 `0b60bf0a…`) and
`EXPECTATIONS-BB2-CONNECTIONS-A2.md` (sha256 `51a87592…`), each written and
stamped **before** the corrected witness was run.

| # | witness | stamped criterion | measured | cause |
|---|---|---|---|---|
| 1 | C0d `\|P(0)\|` | `2.6539121` kg·m/s | `2.65377090194312` | my arithmetic slip |
| 2 | C0c `E_mech(0)` vs analytic `KE_0` | rel ≤ `1e-9` | `1.4576e-7` | tolerance below the engine's f32 floor |
| 3 | C4b `\|P(0)\|` vs analytic | rel ≤ `1e-9` | `8.6328e-9` | same f32 floor |
| 4 | C3b hinge-substitute SPREAD | `< 0.01` | `0.15444` | my fixture defect |
| 5 | C3d ball-substitute max θ | `≥ 1e-2` rad | `1.3993e-4` | my fixture defect |
| 6 | C0f hinge-axis misalignment | `≤ 1e-12` rad (A1.4) | `1.4901e-8` | my ill-conditioned measure |
| **7** | **C4a ANALYTIC-POS / ANALYTIC-ANG** | **`≤ 5e-3` m / `5e-3` rad** | **`8.378e-3` m / `2.121e-2` rad at M = 128** | **RETAINED RED** |

### 1 · The arithmetic slip
`|P(0)| = 3·√0.7825`. Recomputed by hand — `0.8846² = 0.78251716`, correction
`1.716e-5 / 1.7692 = 9.70e-6`, so `√0.7825 = 0.8845903006477066` and
`|P(0)| = 2.65377090194312`. The code was right; the declaration's literal was
wrong and stays on the record as wrong.

### 2, 3 · The f32 floor, identified WITHOUT reference to the failing outputs
A probe on a **different, trivial** construction read the engine's own mass
properties back:

```
  authored 2.0 kg -> 2.0000002384185791   rel 1.1921e-7  = EXACTLY 2^-23
  authored 1.0 kg -> 1.0000001192092896   rel 1.1921e-7
  analytic I = 0.4·m·r² = 0.008 -> 0.0080000013113021851  rel 1.6391e-7
```

Rapier's mass properties cross an **f32 boundary** — the same boundary this build
already documents for the timestep. `1e-9` was not reachable by any correct
implementation. The corrected bound is **4 ulps of f32 = 4.76837158203125e-7**,
derived from the mechanism, and a **discriminating control** (authoring 2.5 kg
where the reference says 2.0) is DETECTED at it — `rel 1.9824e-1`.

### 4 · The hinge substitute was not built under its own best conditions
`JointDesc` carries **one shared `axis`** for both bodies — the schema hinge and
slider have shipped with since BB1 and which legacy documents contain. The
declaration asked for independent per-body axes, which that schema cannot express,
so the substitute named world directions **35° apart at t = 0**, its own constraint
was violated at release, and the solver spent the run yanking it. The yank is what
produced the second rotation axis. Corrected by giving the substitute a relative
pose **about the hinge axis** (`R_z(35°)`), so the one shared local axis really is
the same world direction in both bodies. **No acceptance target moved;
initial-state representation tolerances were corrected** — A1 lists both, C0c and
C4b (§2/§3 above), and neither is an acceptance target. The corrected
witness asserts the initial misalignment is `≤ 1e-14` rad and prints what the
declaration's `Qrel` would have given — still `35.0000°`.

### 5 · The connection anchor was COLLINEAR, so the ball substitute felt NO torque
Provable from the stamped literals alone: the connection point, body B's centre of
mass and the composite centre of mass all lay on the assembly-local **x** axis while
the assembly spins about local **z**, so

```
  lever = (0.25,0,0) − (0.40,0,0) = (−0.15, 0, 0)
  F     = −m_B·ω²·(0.40,0,0)      = (−1.60, 0, 0) N
  τ     = lever × F               = (0, 0, 0)      IDENTICALLY ZERO
```

A ball transmits force but no torque, and **at zero torque a ball and a fixed
connection produce the same motion** — the fixture could not tell them apart. The
connection point moves to assembly-local `(0, 0.12, 0)` and **nothing else changes**;
the recomputed torque is `|τ| = 0.192 N·m` (`α = 48 rad/s²`), asserted directly so
the fixture's discriminating power is a stated property and not a hope. The two
bodies still can never touch: closest possible COM separation `0.2736315 m > 2r = 0.20 m`.
**No acceptance target moved; initial-state representation tolerances were
corrected** (A1 lists both, C0c and C4b). The ball substitute now fails the fixed
criterion by 1870×.

### 6 · An ill-conditioned measure
**`acos` is unreliable at the requested angular scale.** It has a
`√(machine epsilon) ≈ 2.1e-8` rad floor near zero angle (`d/dx acos = −1/√(1−x²)`
diverges at 1), and a dot product that rounds to exactly 1 yields zero — so the
measure carries no information at `1e-12`, in either direction.
Replaced by `atan2(|a×b|, a·b)`, which has no cancellation: the measure now reads
`5.562e-17` rad, and the **discriminating control** — the same corrected formula on
the defective fixture — still reads `35.0000°`.

### 7 · C4a IS RETAINED, RED, AND UNCHANGED

> **ANALYTIC-POS ≤ 5e-3 m and ANALYTIC-ANG ≤ 5e-3 rad are MISSED at every rung and
> the witness still asserts them.** The tolerance is **not** widened, the 10.000 s
> window is **not** shortened, the case is **not** deleted, and no passing rung is
> substituted.

The ladder, reported as evidence and not as a criterion:

| M | analytic position error | analytic orientation error | rad per rad turned |
|---|---|---|---|
| 4 | 2.8792e-1 m | 7.3625e-1 rad | 3.681e-2 |
| 8 | 1.5176e-1 m | 3.8165e-1 rad | 1.908e-2 |
| 16 | 7.7533e-2 m | 1.9424e-1 rad | 9.712e-3 |
| 32 | 3.9059e-2 m | 9.7676e-2 rad | 4.884e-3 |
| 64 | 1.9123e-2 m | 4.7753e-2 rad | 2.388e-3 |
| **128** | **8.3781e-3 m** | **2.1212e-2 rad** | **1.061e-3** |

Clean first-order convergence in `h`, and still short of the stamped line at the
offered profile. **No mechanism is established.** The measured orientation
discrepancy is **consistent with** accumulated angular-momentum drift,
`Δφ ≈ (|ΔL|/|L|)·|ω|·T/2`, **under the assumptions of approximately linear rate
drift, fixed relevant inertia and axis, and negligible other orientation error** —
a scalar consistency check, not an identified cause — and
**a consistent account does not license amending the prediction**
(`ACCEPTANCE-RULES` §1). My stamped allowance of `2e-4` rad per radian turned was
an unfounded guess, inconsistent with this project's own retained evidence
(D-29/D-33: 4.42 % of kinetic energy lost in 11 s at M = 128), and **the fix for a
guess is not to move the line after seeing where the ball landed.**

**§3's independent-reference requirement is met by a criterion that PASSES.** §3
asks for an analytic rigid-assembly reference **or** an independent
momentum/kinematic calculation; the phase-free momentum reference C4b meets every
stamped bound — `MOM-P 1.426e-5 ≤ 1e-3`, `MOM-L0 6.252e-10 ≤ 1e-6`,
`MOM-L 2.111e-3 ≤ 1e-2`. C4a is an **additional** reference this build imposed on
itself, and it is retained red.

**NARROW.** Everything above is about **these three fixtures at these profiles**. It
establishes nothing about Rapier in general, nothing about the hinge, and nothing
about any assembly a user builds. **This adapter is not energy-conserving and is
described that way nowhere.**

### 8 · The offered-profile prediction MISSED
The declaration predicted `M = 32`. The measured ladder, by the **unchanged**
selection rule of §3.8, gives **`M = 128`** — the lowest rung at which the ball pair
and the fixed pair both meet T1, T2 and T3. The prediction was never asserted by any
test; it is recorded here as missed. **The promise was not narrowed to fit: the
targets are the stamped ones and the profile is whatever the rule returns.**

## D-37 — TWO DEFECTS FOUND BY DRIVING THE REAL CONTROLS. Neither was caught by a test

Both witness files were green and both defects were nevertheless there, because
**no executed check ever touched the DOM.** Same class as D-31 and D-34.

1. **The connection form could not be read at all.** The shared `input()` helper
   prefixes every field id with `a-`, so the anchor fields render as `a-c-ax` …
   `a-c-bz`, and `readConnectionForm` looked them up **without** that prefix. Every
   create, edit and placement threw `Cannot set properties of null` on the first
   field. Fixed, and the lookup now throws a **named** error identifying the missing
   field rather than a null dereference.
2. **The attachment labels named the WRONG BODY.** §4 requires attachment locations
   in an *explicitly named frame*, and the labels were baked at render time while
   Body A / Body B could be changed afterwards without a rebuild — so with Body A =
   `platform` selected the label still read *"in ground's own local frame"*.
   **A label naming the wrong frame is worse than naming none.** Fixed by
   `refreshConnectionFrameLabels`, which retargets every label from the select's own
   chosen option on each change, without a rebuild that would discard typed values.

**Neither was visible in any of the 141 tests.** They were found by opening the page
and using the controls, which is the whole point of ACCEPTANCE-RULES §2.

## D-38 — RECORDED CHANGES, judgement calls rather than absorbed

1. **`JointDesc` became a discriminated union.** `AxisJointDesc` was split into
   `HingeJointDesc` and `SliderJointDesc` because TypeScript cannot fully narrow a
   union member whose own discriminant is a union — the split makes every
   variant-specific access checked at compile time. **No hinge or slider field,
   default or behaviour changed, and legacy documents are unaffected** (P1 asserts
   this against a frozen literal document).
2. **The misalignment gate is scoped to ball and fixed only.** Hinge and slider keep
   exactly the behaviour they have. A slider's anchors are *legitimately* separated
   along its free travel axis — the shipped oscillator scene has the cart at
   x = 0.30 m against a rail anchor at x = 0 — and legacy documents must keep
   loading. Extending the gate to them is out of scope and is **not claimed**.
3. **The alignment band is 1e-6 m / 1e-6 rad, and it is a numerical-representation
   band, not a snapping band.** One micron is three orders of magnitude below the
   1e-3 m constraint-holding target, so nothing inside it can be confused with the
   solver correcting a real misalignment. **The measured residual is displayed
   whether or not it is inside the band**, so a residual is reported, never hidden.
4. **The connection-frame convention is `frameA = identity`, `frameB = R_B⁻¹⊗R_A`.**
   Derived from the two bodies' authored rotations at creation and then **stored
   explicitly**; never recomputed at build time.
5. **A connection's variant may be changed in place, keeping its id.** This was
   initially disabled out of caution and then enabled, because §5 requires that
   changing only a connection field appear in comparison provenance and an in-place
   variant switch is the cleanest such change. It rewrites the descriptor to the
   fields that variant actually carries.
6. **No solver setting, no dependency and no existing tolerance changed.**
   `numSolverIterations = 1` and `numInternalPgsIterations = 1` are untouched; the
   profile ladder is the existing measured `{4, 8, 16, 32, 64, 128}` with no rung
   added.

## D-39 — ACCEPTANCE AMENDMENT A: the required disclosure, and three wording corrections

`bridge/BATCH2-ACCEPTANCE-AMENDMENT-A.md`
(sha256 `46934b59f9f0d4f8109f24bb84b256699162ee33b136e6bbd99c54591e20a3ca`)
appends to `bridge/BATCH2-ACCEPTANCE-v1.md` (`f520d4fd…`), **which is preserved
unchanged**. This entry records what was changed in this build to satisfy it.

**THE AMENDMENT IS A RELAXATION, NOT A REPAIR.** C4a is an **active failing
diagnostic**, still asserted and still failing, **explicitly excepted from this
batch's acceptance gate by joint reviewer decision**. Its bound is not widened, its
window is not shortened, the case is not deleted, and the exception **does not
excuse any future new failure**. Everything below is **prose and presentation
only**: no behaviour, no tolerance and no test assertion was changed, and both
retained reds (the pendulum C2.2/C2.3 and this C4a) are byte-identical in their
assertions.

**Also recorded, once and without expansion:** the original declaration gated
dependent UI work on §2 only and thereby missed the broader material-failure rule —
the C4a failure should have returned **before** dependent exposure. And **retaining
a failing assertion is evidence preservation, not acceptance authorization.**

### 1 · The required disclosure, and where it is

> **Experimental connections: holding an assembly together does not guarantee
> accurate motion.** In the fixed-assembly free-flight test over **10 simulated
> seconds at 128 substeps per tick**, maximum position error was **0.008378 m** and
> orientation error **0.02121 rad**; both exceeded the declared **0.005** limits (m
> and rad respectively). **Other assemblies and profiles are not validated by this
> test.**

Text lives once, in `src/ui/inspect.ts`, as `CONNECTION_DISCLOSURE_SHORT` and
`CONNECTION_DISCLOSURE_FULL`. It is rendered in **three** places, and the first two
are **run mode, with a connection in use** — the amendment requires that it not be
reachable only from an editing form:

1. **The `Joints and connections` panel** (`renderJointPanel`), as a bordered
   warning block above the connection rows, whenever a **ball or fixed** connection
   exists. This panel is painted by `paintPanels` in run mode, running or paused.
2. **The viewport banner** (`#instruct`, `connectionDisclosureBanner`), the short
   form, whenever a ball or fixed connection exists and we are not editing. It also
   rides the authored-scene run readout (`demoFacts`), beside the plot a user would
   read a trajectory off.
3. **The connection authoring form** (`connectionAuthorControls`) — kept, but it is
   no longer the only place.

**The attribution limits are part of the requirement and are carried in the text:**

- the two measured errors are the **fixed witness's own**; **no equivalent error is
  claimed, or has been measured, for a ball joint**;
- the **≤ 1 % energy result** belongs to the **declared witness fixtures at the
  declared profile**, not to every live assembly;
- captured-run overlays compare **two numerical runs** with each other — neither is
  a reference, and an overlay is **not** a claim of accurate comparison.

**Two framings the reviewer cut are not used anywhere in this build's prose:**
"trajectory is not what a user does with a welded assembly" (connection geometry and
trajectory fidelity are **distinct**, and the latter matters), and **"long-horizon"**
for this test — the tested interval is **named** as 10 simulated seconds.

### 2 · Three wording corrections

**Stamped `EXPECTATIONS*.md` files are NOT edited.** `EXPECTATIONS-BB2-CONNECTIONS-A1.md`
(§A1.6, lines 182–185) and `EXPECTATIONS-BB2-CONNECTIONS-A2.md` (§34) keep their
original wording and their stamps; **they are corrected only by this appended note**.

**(a) Causal.** Not *"the mechanism is identified"*, and not the orientation error
*"**is**"* the accumulated angular-momentum drift. Correct form, now used in
`README.md`, in **D-36 §7** above and in the C4a block comment of
`src/sim/connections.test.ts`:

> **No mechanism is established.** The measured orientation discrepancy is
> **consistent with** accumulated angular-momentum drift **under the assumptions of
> approximately linear rate drift, fixed relevant inertia and axis, and negligible
> other orientation error.**

It is a **scalar consistency check**, not an identified cause. **No additional causal
experiment was requested and none was run.**

**(b) Thresholds.** Not *"no threshold moved"*. Correct form, now used in **D-36 §4
and §5** above:

> **No acceptance target moved; initial-state representation tolerances were
> corrected** — **plural**: A1 lists **both**, `C0c` (A1.2) and `C4b` (A1.3), each a
> `1e-9` initial-state agreement below the engine's f32 floor.

**(c) `acos`.** Not *"no correct implementation could have met `1e-12` through
`acos`"*. Correct form, now used in **D-36 §6** above and in the C0f comment and log
line of `src/sim/connections.test.ts`:

> **`acos` is unreliable at the requested angular scale** — it has a
> `√eps ≈ 2.1e-8` rad floor near zero angle, and **a dot product rounded to exactly
> 1 yields zero**, so the measure carries no information at `1e-12` in either
> direction.

## D-40 — A FAILED §4 PREDICTION, RETAINED: the one-resistor wrong-resistance mutant

`bridge/BATCH4-ELECTRONICS-ACCEPTANCE-v1.md` §4 requires a **wrong-connectivity or
wrong-resistance mutant** executed against **independently assembled** KCL and
power checks. I predicted, in `src/model/circuit.test.ts` E7, that a wrong
resistance on a **single-resistor loop** would be caught by the independently
assembled power balance.

**IT WAS NOT. The original result is retained, not rewritten.** The executed
failure was:

```
FAIL  src/model/circuit.test.ts > E7 wrong-RESISTANCE mutant is caught by the
      independently assembled power balance
AssertionError: expected [Function] to throw an error
```

**The mistaken assumption, identified from evidence INDEPENDENT of that failing
output.** On a one-resistor loop the independent check *derives* the source
current from that same single branch, so

```
V_src · I_src  ==  V_src · (V_src/R)  ==  V_src²/R  ==  P_R
```

holds **identically for every R**. The evidence is not the one failing assertion
but a **family** sweep, run separately: with the correct voltages held fixed and
the resistance scaled by ×0.1, ×0.5, ×2, ×2.5, ×7 and ×1000, the power gap stayed
0 (worst 2.2e-16 W) and the KCL imbalance stayed exactly 0 at every factor. The
same sweep on a **series divider** — where the mutated resistance participates in
a node constraint — gave KCL imbalances of 0.2–0.4 A and power gaps of 1.6–3.2 W.
So the blind spot is a property of **that fixture's topology**, not of the
implementation or of the check.

**The discriminating case, and what is now asserted.** E7 keeps BOTH halves:
(a) the original one-resistor probe, now asserted as an **explicit degeneracy** —
`independentChecks` is asserted **not** to throw across the whole ×0.1…×1000
family, with the algebra stated in the test; and (b) the **series divider**, where
the same mutation IS rejected at ×0.5, ×2 and ×2.5, with an unmutated control that
passes. **The bound was not widened, no case was deleted, and the promised
behaviour is not weakened** — §4's requirement is met by (b), and (a) is preserved
as the record of a wrong prediction about a fixture.

**No scope or tolerance changed.** This is a test-fixture correction with its
evidence, not a relaxation of an acceptance criterion.

## D-41 — TWO CIRCUIT-AUTHORING DEFECTS FOUND BY DRIVING THE REAL CONTROLS

Neither was caught by any test. Both were found by opening the page, expanding the
disclosures and using the forms as a user would — the same way D-37 was found.

**1 · The circuit could not be authored at all.** The first click of *Add node* was
refused: `Circuit refused: a circuit that is present must have at least one
component; remove the circuit instead`. And even with that satisfied, a third node
could never be added, because a node with nothing attached is refused —
`node n7 carries no component, so its potential is not determined`.

**The refusals are CORRECT and were not weakened.** A node with nothing attached
genuinely has no determined potential, and inventing one would be exactly the
"repair into something easier to solve" the acceptance forbids. **The flow was
wrong, not the rule.** Nodes are no longer created on their own: each terminal
select offers **"+ create a new node here"**, and the node is minted **in the same
edit as the component that connects it**. The standalone *Add node* button is gone;
the panel says why. The first component is the source, which brings its two nodes —
including the 0 V reference — with it.

**2 · Changing the component TYPE silently committed the wrong component.**
Selecting *Ideal wire* and pressing *Create component* produced a **resistor**, and
selecting a second *source* also produced a resistor — both then accepted, because
a second parallel resistor is a perfectly legal graph. Cause: the type select's
change handler called `buildControls()`, which re-rendered the panel from the
**stored** component's kind and threw away both the chosen type and everything the
author had typed.

Fixed the way the connection panel already handles this: `refreshCircuitFormLabels`
retargets the terminal labels, the value label, and the enabled state of the value
and receiver controls **in place**, with no rebuild. The type change therefore
survives to the commit.

**This defect had real consequences for the acceptance evidence**: my first pass at
the §9 invalid-wiring drive reported "wire shorting the source" and "a second
source" as *accepted*. They were never authored. After the fix, driving the same
form gives, on screen:

```
ideal wire shorting the source  -> Circuit refused: a wire shorts the source V3 across its
                                   own terminals; no current is determined and no leakage is
                                   inserted to make one
zero / negative resistance      -> Circuit refused: resistor R5 resistance must be finite
                                   and strictly positive
floating island                 -> Circuit refused: node n5 is in a floating subnetwork with
                                   no resistive path to the 0 V reference; it is refused
                                   rather than grounded or given a leakage path
a second source                 -> Circuit refused: exactly one ideal DC voltage source is
                                   supported; this circuit has 2
both terminals on one node      -> A component needs two DIFFERENT nodes
delete the 0 V reference node   -> REFUSED: node n2 carries a terminal of the source V3.
                                   Delete or re-terminate the source first — the node is not
                                   removed and the source is not silently dropped.
```

and the authored circuit is **byte-identical before and after all seven attempts**.

## D-42 — TWO PRESENTATION DEFECTS FOUND BY LOOKING AT THE SCREEN

**1 · The old thermal panel called resistor heat "damper work".** `totalRouted` now
sums both ledgers, so the existing line rendered `Routed damper work: 127.4400 J`
when every joule of it had come from a resistor. That is precisely the kind of
mislabelling this project refuses. The panel is now headed **Heat received** and
prints the two ledgers **separately** — `routed damper work X J and routed resistor
Joule heat Y J — combined routed total Z J` — and, when a circuit exists, it also
prints the **separately derived extended-system balance** term by term, with its
source gap and routing gap, and says in the panel that it is **not** resistor heat
added to the damper-only remainder.

**2 · The resistor table was clipped at the panel edge.** Its client width was
450 px inside a 355 px panel, so the *Energy so far* and *Heat receiver* columns
were **unreachable** — values the acceptance requires to be shown. Wide tables in
the circuit panel now sit in a `.scroll-x` box that scrolls **inside itself**,
so the panel never scrolls horizontally and every column can be reached.

Both were visible on screen and invisible to the suite. Recorded rather than
absorbed.

## D-43 — A WRONG PHYSICS LABEL, FOUND BY REVERSING THE POLARITY ON SCREEN

The visible-electricity stage draws the source as an edge between its two rails
and captions it **the RISE**, to refute "current always flows downhill". The first
implementation drew that edge **always from the negative terminal to the positive
one**, and always captioned it `the RISE`.

That is correct only while the authored EMF is positive. Setting the source to
**−12 V** through the real form gave

```
node potentials   0 V reference   0 V     (top of the ladder)
                  divider midpt  -8 V
                  top rail      -12 V     (bottom of the ladder)
source current    -0.400000 A            (i.e. INTO the positive terminal)
```

so the drawn arrow ran from 0 V **down** to −12 V while the caption underneath it
said **RISE**. The picture and the words contradicted each other, and the picture
was the wrong one: with the current entering the positive terminal, conventional
current inside the source runs from the **top rail (−12 V) up to the 0 V
reference**, which is a genuine **+12 V rise**.

The edge is now drawn **along the conventional current inside the source** —
`sourceCurrent >= 0 ? neg → pos : pos → neg` — and its caption is **derived** from
the two potentials it actually connects (`rise = V(to) − V(from)` under the displayed
reference — a difference, hence reference-independent), reading `the RISE`, `a FALL`
or `no rise: 0 V` from the arithmetic rather than asserting one. The legend adds
that a negative EMF puts the positive terminal below the negative one, that the
arrow still follows the current, and that **the resistor heating is unchanged by
the reversal**.

Verified after the fix at EMF −12 V: arrow y1 = 158 → y2 = 26 (upward),
`the RISE +12.000000 V`, currents −0.400000 A on both resistors, powers
**1.600000 W and 3.200000 W — identical to the +12 V run**.

No test caught this. The suite has no assertion about arrow direction, and would
not have: the defect was a *caption* disagreeing with a *drawing*.

## D-44 — A CLAMPED PINNED SCALE DREW TWO DIFFERENT POTENTIALS AT ONE HEIGHT

Pinning was first implemented as freezing a **window** (a bottom volt value plus a
span), with out-of-window values clamped to the plot edge and an "exceeds the
pinned scale" caption. Pinning at 0 … 12 V and then shifting the displayed
reference to the top rail put the potentials at 0, −4 and −12 V, and the three
rails were drawn at y = 146, 153.2 and **153.2**: **−4 V and −12 V at the same
height, in a view whose first stated rule is that equal height means equal
potential.** A caption saying the values were clamped does not repair a picture
that is itself false.

The pinned quantity is now **volts per pixel**. The ladder's height follows the
data at a fixed scale, so **nothing is ever clamped** and two distinct potentials
can never share a height. Checked on screen: with the scale pinned at 12 V
(0.090909 V/px) the 12 V run drew a 132 px ladder with arrow widths 6.6 / 6.6 /
1.6 px, and the 6 V run drew a **66 px** ladder — exactly half — with arrow widths
**3.9** px, rather than being renormalised back to full size. Recorded in
`VISUAL-DECLARATION-CORRECTION-A.md`, which quotes the declaration clause it
tightens.

## D-45 — FOUR DRAWING DEFECTS THAT ONLY A SCREEN COULD SHOW

All four were invisible to the suite; all four were fixed.

1. **Arrowheads scaled with stroke width.** SVG markers default to
   `markerUnits="strokeWidth"`, so the widest (largest-current) arrow grew a head
   that swallowed the diagram and covered the labels next to it. Now
   `markerUnits="userSpaceOnUse"`: the head is a constant size and **only the
   shaft width encodes |I|**.
2. **Two nodes at equal potential collided.** The divider midpoint and the
   open-ended branch are both at 8 V, so their labels were drawn on top of each
   other (`divider mjdpoént`). Equal potential must stay equal height, so the
   **rail line** still sits at the true height and the **label blocks are nudged
   apart** with a thin leader joining each to its line. Distinct nodes sharing a
   height are listed separately; merged nodes remain one name joined by `=`.
3. **Component names ran off the right edge and into each other.** At every slot
   spacing that fitted a 380 px panel, names collided. The diagram now carries
   **numbered callouts** plus the reading, centred in its own slot with a dark
   halo, and the **legend below** carries the full name, R, ΔV, I, P and the
   named heat destination at full precision and readable size.
4. **The honesty block snapped shut a fraction of a second after being opened.**
   `#panels` is re-rendered wholesale every 120 ms, so a natively-toggled
   `<details>` lost its state on the next paint. Its open flag now lives in the
   UI view state and is re-rendered with it.

None of these changed a number. All of them changed whether a reader could see
one.

## D-46 — A DECLARED SI SCALE THAT DID NOT REPRODUCE ITS OWN DRAWING

Found by doing arithmetic on the numbers the view prints, against the widths it
actually renders, on a circuit authored through the real forms.

The current-arrow block declares: *"Scales, stated in SI and never hidden …
current: widest arrow = 1.500000 A → 0.250000 A per pixel of width."* That is a
**checkable claim**: measure an arrow, multiply by the printed A/px, recover the
printed current. It did not hold.

Two independent faults, one root cause — **two literals for one quantity**:

1. **Wrong divisor.** The geometry encoded current across `5.4` px of width
   (`1.2 + 5.4 * |I|/fullI`); the printed scale divided `fullI` by `6`. The
   comment beside the printed value already said "per pixel of *extra* width",
   so the intended definition was known and the constant still disagreed with it.
2. **An unnamed pedestal.** Every nonzero arrow carries a `1.2` px visibility
   baseline that is *not* part of the encoding, but the printed wording said
   "per pixel of width" — total stroke — so a reader had nothing to subtract.

Measured on the authored circuit (12 V; 10 Ω direct, 20 Ω + 20 Ω divider, 50 Ω
dead branch; `fullI` = 1.5 A):

| resistor | drawn width | true I | read back BEFORE | read back AFTER |
| --- | --- | --- | --- | --- |
| R1 | 5.52 px | 1.200000 A | 1.38 A — **15% high** | 1.200001 A |
| R_top | 2.28 px | 0.300000 A | 0.57 A — **90% high** | 0.300000 A |
| R_bot | 2.28 px | 0.300000 A | 0.57 A — **90% high** | 0.300000 A |
| R_dead | 1.60 px flat | 0 A | 0 A | 0 A |

The error was **worst on thin arrows**, because an unsubtracted fixed pedestal is
a larger fraction of a small width. The residual 8e-7 after the fix is the
six-significant-figure rounding of the printed `5/18`, not a model error.

**Repair.** `arrowWidthPx` and `ampsPerPixel` are now exported from one place and
used by both the renderer and the printed text, so the geometry and the declared
scale cannot restate each other and drift. The printed sentence now names the
baseline, says to subtract it, and says it cancels out of a width *difference*.

**What this did NOT change.** No simulated value, no solve, no current, no power
and no heat. The arrows were always drawn at widths consistent with each other;
only the *stated conversion* was wrong. Nothing was recomputed — this is a
labelling repair, and it is recorded as one.

**Controls, demonstrated red before counting** (`src/ui/electrical-view.test.ts`,
5 assertions):

| mutant | trips |
| --- | --- |
| A — restore the `/6` divisor (the shipped defect) | 3 of 5 |
| B — remove the pedestal from the geometry only | 4 of 5 |
| C — draw exact zero at the pedestal width (1.2 px) | 1 of 5, the zero-legibility one |

A **non-vacuity** assertion pins the pre-fix numbers (1.38 A and 0.57 A) and fails
if the round trip ever stops discriminating, so the suite cannot go quietly green
by ceasing to test anything.

**Limit.** This establishes that the printed A/px inverts the drawn width for the
currents exercised, and that exact zero stays visually distinct from a vanishing
current. It does not establish that any other printed scale in this view
reproduces its drawing; the potential axis (V/px) was not re-derived here.

## D-47 — TWO VISUAL-STAGE DEFECTS RETURNED BY ASTRA, BOTH REPRODUCED AND FIXED

Astra reviewed the visible stage, **declined the writer transfer** so the seat would not be held by
two people at once, and returned two findings. Both were real. Both were reproduced through the
visible controls before being touched.

### 1. A pinned comparison referred its two runs to two different zeros

`pinScales` stored node potentials as `n.voltage - off` — relative to whichever display reference
happened to be selected **when the pin was taken**. The ghost renderer then drew them with `y(p.v)`,
which interprets a value in the reference selected **now**. Shift the reference after pinning and
the live rails move while the ghosts do not.

Astra's measurement, on a 10 V / 10 Ω circuit: after pinning against the source negative and then
choosing the supply rail as the displayed zero, ghosts landed at `y = -106.0` and `26.0` against a
`viewBox` of height 190 — **one marker outside the drawing entirely**. Two identical circuits shown
as different, with the evidence for the difference clipped off-screen.

A second, independent half: `yAll` computed the visible extent from the **live** values and zero
only. Even with the reference untouched, a pinned run with a larger span could fall outside the
drawing.

This is D-44's failure wearing a different hat — *the drawing asserting a difference the model does
not have*. That it recurred in the comparison path after being fixed in the clamping path is the
part worth remembering.

**Repair.** Pinned potentials are now stored in the **model's own reference**, never display-
relative, together with `refRepAtPin`. At render they are re-expressed against the node the viewer
has chosen *now*. Both runs enter `yAll`, so neither can be clipped. If the chosen reference node
does **not exist in the pinned topology** there is no correct offset, so the comparison is
**explicitly invalidated on screen** — no ghosts, and a stated reason — rather than guessed at.

**Verified on screen, both of Astra's acceptance cases:**

| case | result |
| --- | --- |
| pin, then shift reference to `supply rail` | ghosts `26, 158` — **coincident with the live rails**, all inside `viewBox` 190 |
| pin at 10 V, then edit the source to 5 V | pinned span **132** units = 10.000056 V; live span **66** units = 5.000028 V, at one V/unit |

The 5 V run draws at exactly **half the height** instead of being renormalised back to full — which
is the entire reason to pin a scale.

### 2. "Per pixel" was not true of a responsive SVG

The `<svg>` is `width="100%"` over a 344-unit `viewBox`. Astra measured it rendering at **329 CSS
pixels** — a 0.956 factor. So every printed scale was correct in **drawing units** and wrong as
stated: a reader measuring the screen and applying the printed V/px would recover ~9.564 V from a
10 V drop.

This is the same fault as D-46 one layer further out. D-46 fixed the *number*; the *unit it was
denominated in* was still wrong. Fixed by naming the unit — "V per drawing unit", "A per drawing
unit of width", an "N-unit baseline" — and by stating plainly, where the scales are declared, that
**a drawing unit is not a screen pixel**, that the diagram is rescaled to the panel width, and that
this is precisely why every value is also printed as a number.

No physical calculation changed in either finding. No solve, no current, no power, no heat.

### An observation about the evidence itself, not about the code

While confirming the repair, the full suite reported **3 and then 4 failures** rather than the
expected 2 — including a `D1 replay twice -> identical at every checkpoint` failure, which would be
alarming if real. It is not a regression: the extra reds appear only under **parallel file
execution** on a loaded machine, vary run to run, and the affected files pass in isolation. Run with
`--fileParallelism=false` the suite is exactly **188 tests, 186 pass, and the 2 inherited reds at
their byte-identical values** (`0.008378073876637597`, `0.04071222797556051`).

Recorded because it matters for how this suite is quoted: **the headline count is only reproducible
serialised**, so a parallel run's number is not by itself evidence, and a future reader seeing a red
determinism test should serialise before concluding anything. Diagnosing the concurrency
interaction is not attempted here and is left open.

## D-48 — THE ELECTRONICS BENCH, THE SWEEP, AND A DEFECT THE LAYOUT ITSELF CAUSED

Peter asked for three things at once: demos that auto-run with a restart, electronics on its
own localhost, and the learning LFO with a real UI that can sweep the reasonable parameters.

### The bench is a separate page, not the same app on another port

The first attempt was `vite --port 5312` serving the identical page, which Peter correctly
rejected: *"thats th same devel as the normal physics i wanted to focus on electronics"*.
The bench is now its own entry (`electronics.html`, `src/ui/electronics.ts`) with its own
config serving it at the **root** of port 5312, so the URL is just the port.

It carries **no three.js, no WebGL context, no camera and no viewport**. Electrical
connection is by node id and never by position, so nothing is lost — and a page with no
renderer is far cheaper to leave open. It runs the **same `SimWorld`** at the same fixed
1/60 s tick, so the solve, the Joule accumulation and the thermal receivers are the ones
already verified rather than a second, easier implementation of the same physics.

Port 5312 is deliberate. **5177 belongs to a different project and is never touched**;
verified still serving on its own after every change here.

### A defect the layout caused, found by driving the real controls

The LFO panel was first rendered into `#panels` — which is re-rendered **wholesale every
120 ms**. Two consequences, both immediate:

1. Every listener attached to an LFO control was destroyed within one frame of being
   attached, so the target menu did nothing at all. Observed: selecting a target left
   `lfo.targetKey` null.
2. Any value being **typed** into the lo / hi / period inputs would be overwritten eight
   times a second.

This is the same failure class as the honesty `<details>` snapping shut (D-45 item 4). The
fix is structural rather than another patch: the module now exports **`renderLfoControls`**
(anything you type into or click — lives in the left column, rebuilt only on an event) and
**`renderLfoReadout`** (reads out only, no inputs, no listeners — safe on the 120 ms tick).

A second, smaller one: a **refused** sweep left the rejected number sitting in the input as
though it had been accepted. The form is now restored from stored state on refusal, so what
the form shows is always what is actually in force.

### Verified by driving the bench

12 V source, 10 Ω resistor heating the chassis, sine sweep 2.5 → 40 Ω over 240 ticks:

| R (Ω) | I (A) | 12/R | P (W) | 144/R |
| --- | --- | --- | --- | --- |
| 3.1389 | 3.82301 | 3.82301 | 45.87608 | 45.87608 |
| 13.1779 | 0.91061 | 0.91061 | 10.92737 | 10.92737 |
| 39.9936 | 0.30005 | 0.30005 | 3.60058 | 3.60058 |

Ohm's law and Joule heating moving together, live. Three refusals exercised on screen —
out-of-range bounds, `lo >= hi`, fractional period — each refusing rather than clamping and
each leaving the stored value untouched.

### Demos

`collision`, `incline` and `fall` no longer start paused. `projectile` still does: it is
**armed, not running**, and needs its launch impulse to mean anything. A **Restart** button
rebuilds the current scene at tick 0 and runs it.

The declared-end auto-pause is **kept but no longer a dead stop**: at its declared time a
demo now **loops** by default, with a `LOOP / PAUSE` toggle. Looping serves Peter's request
*and* the reason the auto-pause existed — demo 4's pair separates forever and demo 5's block
leaves the ramp, so left running both end as an empty viewport. Verified on `incline`: 3
loops, max tick 71 of the declared 72, never empty; PAUSE mode verified stopping at 72.

### The lag was not the app, and I could not measure it

Peter reported lag; I measured, then found the measurement worthless. An **empty**
`requestAnimationFrame` callback runs at **17 fps** in the automated tab — that is the CDP
connection pacing the browser, not the app. Inside that cap the app's own work is trivial:
panel rebuild 0.63 ms (0.4% of wall clock), `render()` ~0 ms CPU, 5 draw calls, 36 triangles,
still 18 fps **while paused with one body**.

Peter then said the whole machine was laggy, which was the real answer: **load average 25.7
on a 10-core box**, with Chrome holding **563% CPU across 90 renderer processes**. About 20
of those were FP1 tabs left open by this session, each running an independent Rapier loop and
WebGL context. Closing them: Chrome **563% → 299%**, load **25.7 → 18.7**.

Recorded because the lesson is not about this app: **an instrumented browser cannot measure
its own frame rate honestly**, and I nearly reported a rendering diagnosis built on a number
my own tooling produced. The remaining machine load is other applications, not this project.

**Still not investigated:** the shadow map is 2048×2048 re-rendered every frame for a
36-triangle scene, with `antialias: true` at devicePixelRatio 2. Plausibly wasteful, but
untouched — changing rendering on a hunch while unable to measure the result is how a "fix"
gets shipped that fixes nothing.

## D-49 — THE EMPTY BENCH CLAIMED THE SOLVE HAD BEEN REJECTED

Found by Peter, on a freshly loaded bench: a black panel with
**"NOTHING IS DRAWN: the electrical result was REJECTED. no accepted solution"**.

Nothing had been rejected. Confirmed on the live page: `hasCircuit: false`,
`rejected: null`, `hasSolution: false`. There was simply **no circuit authored yet**.

`PotentialScene.build` collapsed three different situations into one:

```ts
if (!c || !sol || !merge || sim.electrical.rejected) {
  this.info = { ...this.info, rejected: sim.electrical.rejected ?? 'no accepted solution', ... };
```

The `?? 'no accepted solution'` fabricated a refusal reason for a case where **no refusal
occurred**. This is mine, not Astra's — both files were byte-identical to my handoff hashes
(`electronics.ts` `f1a3a8e2ee25fa0d`, `potential-scene.ts` `dade7b5c42b23111`).

**Why this is worse than a cosmetic bug.** This project's whole discipline is that a refusal
is a real, meaningful event with a stated reason, and that the UI never asserts something the
model does not support. A false refusal is the same failure as a false number, and it is
worse in one respect: it teaches the reader to distrust or ignore the refusal message, which
is the one message that must always be believed. It is also the **worst possible empty
state** — a new user's first sight of the bench was a red error about a rejection that never
happened.

**Repair — three states, never collapsed:**

| state | condition | what is shown |
| --- | --- | --- |
| **empty** | no circuit, or a circuit with no components | "No circuit yet", how to start, and a **Build me an example** button |
| **rejected** | a circuit exists and the solve refused it | the refusal, with the model's own reason, unchanged |
| **anomaly** | a circuit exists, was not refused, yet has no solution | reported explicitly as a **defect**, and as neither of the above |

The third case should be unreachable. It is reported as an internal defect rather than
silently folded into a refusal, because that folding is exactly what caused this.

**Verified on the live bench, all three:**
- empty → `{empty: true, rejected: null}`, inviting copy, and the example button authors a
  working 12 V / 10 Ω / 20-20 divider through the ordinary edit path — 1.2 A and 14.4 W in
  the load, 0.3 A and 1.8 W in each divider leg, 1.5 A from the source.
- rejected → `{empty: false, rejected: "exactly one ideal DC voltage source is supported;
  this circuit has 2"}`, `branches: 0`, nothing drawn.
- anomaly → `{empty: false, rejected: "INTERNAL: ..."}`.

**A control worth recording separately.** The first attempt to force a rejection — adding an
ideal wire shorting the source — was **refused at authoring time**, before the document
changed: *"a wire shorts the source V4 across its own terminals; no current is determined and
no leakage is inserted to make one"*, and the authored circuit remained at 4 components. The
refusal discipline held whole; the display path had to be exercised directly instead.

**The example circuit has no privileges.** It is authored through the same `edit` path, the
same validation and the same refusals as anything typed by hand, and every value it creates
is visible and editable afterwards.

## D-50 — RC-1 REVIEW: the physics is right; the frame loop died on a 4.5 ms race

Independent acceptance review of Astra's RC-1 by Fable, under `LAYER-PRINCIPLE-v1`.
**Two verdicts, reported separately**, per Astra's own requirement.

### Model layer — PASS, and it passes on a theorem rather than on itself

The declared interval formulas were re-derived **symbolically and independently** rather
than checked against Astra's algebra:

| quantity | independently derived | as declared | match |
| --- | --- | --- | --- |
| source work | ∫₀ʰ V_s·i dt | `Vs·C·d·a` | exact |
| Joule heat | ∫₀ʰ i²R dt | `C·d²(1−e^{−2h/τ})/2` | exact |

and **`W − (ΔU + Q) = 0` symbolically**, not approximately. That is the payoff of Astra's
decision to integrate the interval analytically instead of using endpoint-power × dt.

**Corrected by Astra after I first wrote this:** the balance closes symbolically **in real
arithmetic**. Floating-point accumulation can still drift and remains subject to the declared
tolerance, so *"it cannot drift with step size"* overstated the numerical implementation. The
symbolic result is a statement about the formulas, not a guarantee about their evaluation.

Eleven independent checks in `src/model/rc-review.test.ts`, written from the closed form
rather than from the implementation. The strongest is the **half-energy theorem**: charging
through *any* R from zero stores `CV²/2` and dissipates exactly `CV²/2`, the source doing
`CV²`. Verified across **four decades of R** (1 Ω to 1 MΩ). An implementation that merely
balanced its own bookkeeping would satisfy the residual check and fail this one.

Also confirmed: signed source work is **retained, not clamped** — a genuinely absorbing
configuration gives −0.025 J; the residual stays inside tolerance at **every** tick, not only
at the end; equilibrium produces exactly zero drift, zero heat, zero work; and identical tick
counts give byte-identical state regardless of call grouping.

**The capacitance-edit trap Astra flagged before implementing is closed BY CONSTRUCTION.**
`inputs` is `Object.freeze`d and `readonly`, so an edit cannot mutate a running experiment
and must build a new one. That is stronger than remembering to reset.

### Three reviewer errors, recorded because the reviewer was wrong more often than the build

1. I asserted the capacitor reaches **exactly 0 V** after 20 τ. It does not — it sits at
   `V·e^{−20}`. My tolerance was *tighter than the physics*. The model produced
   `2.061153622438554e-8` against an analytic `2.061153622438558e-8`: agreement to **15
   significant figures**, which my "failure" was actually evidence of. Corrected to assert
   the analytic tail, which is the stronger test — it catches a wrong decay *rate*, not
   merely a large residue.
2. Same error on the reversal case.
3. I asserted a **reversed** source (Vs = −5, Vc0 = +10) would absorb. It supplies: heat is
   `C·d²/2` = 0.1125 J while the capacitor gives up only 0.0375 J, so the source must
   provide the remaining 0.075 J — driving +10 V down to −5 V is work. The genuinely
   absorbing case needs `0 < Vs < Vc0`, now tested separately.

### Presentation layer — ONE BLOCKING DEFECT, found by driving it

The page **loaded permanently dead**: status reading "Running", tick frozen at 0, while
"One tick" worked. Three compounding faults:

1. `last` was seeded with `performance.now()` **during module evaluation**, but the timestamp
   handed to a `requestAnimationFrame` callback is **the time the frame began**, which can
   precede it. Measured live: **−4.5 ms**. The UI therefore fed a **negative interval** to
   `RcClock.advance`, whose guard correctly threw. *The guard is right; handing it a negative
   was wrong.*
2. `requestAnimationFrame(frame)` was the **last** statement in the loop, so any throw above
   it ended the loop **forever**. A 4.5 ms timing race became a permanently dead page.
3. The status read `clock.paused` rather than whether the clock was advancing, so a dead loop
   still reported **"Running"** — the same class as D-49: a presentation misstating the
   model's state.

**This is a race, not carelessness**, which is exactly why it survived Astra's browser
exercise: whether the module finishes evaluating before or after the frame begins is timing
dependent.

**Repair:** `last` is seeded from the first frame and any residual negative is clamped; the
rAF is re-registered **first** so no single bad frame can kill the loop; frame errors are
surfaced in the notice rather than silently leaving a true-but-stopped page.

**Verified after repair** — 120 ticks in ~2 s (exactly 60 Hz), 0.00 s dropped, and the
displayed voltages match the closed form to the printed precision:

| tick | t (s) | closed form | displayed |
| --- | --- | --- | --- |
| 28 | 0.4667 | 3.729109 V | 3.729109 V |
| 59 | 0.9833 | 6.259379 V | 6.259379 V |
| 148 | 2.4667 | 9.151327 V | 9.151327 V |

**I cannot accept my own repair.** Per `COLLABORATION-v1.md`, the builder cannot supply the
independent acceptance, and I built this fix. It goes back to Astra for review.

### Experience verdict — separate, and NOT passed by the above

The physics slice passes; the experience is a static schematic plus a sampled trace. Astra
named this itself as a bounded first implementation rather than anything the physics forced.
Against Peter's stated goal — immersive, intuitive, "not static" — RC-1 is **not there yet**,
and passing the model layer does not make it so.

## D-51 — REVIEW OF ASTRA'S SHARED QUANTITY GAUGE, and a label-collision cause that was mine

Independent acceptance review by Fable, under `LAYER-PRINCIPLE-v1`. **Two verdicts, separate.**

### Model layer — PASS

The gauge is a display contract that **never touches the model value**: quantity, unit,
reference, value and an explicit linear range in, a clamped fill fraction and a text reading
out. Eleven independent checks in `src/ui/quantity-gauge-review.test.ts`, written from the
contract rather than from the implementation.

**The load-bearing property is that saturation is LABELLED, never silent.** A value at full
scale and one far above it both draw a full vessel — which is permitted — but their readings
differ, the over-scale one says `ABOVE DISPLAY SCALE`, and **the true value is still printed
rather than replaced by the clamped one**. Silent clamping is what the layer principle
forbids; labelled saturation is legitimate. Verified in both directions, with a non-vacuity
control confirming an in-range value carries no saturation wording at all.

It **refuses** rather than inventing a display: non-finite value or bound, an empty or
inverted range, and a `mapping` it does not implement. That last matters — a gauge that
silently treated an unknown mapping as linear would be a falsely-labelled scale.

Kelvin is a separate gauge from joules, so **J/K is never treated as a fill capacity** — the
error Astra warned about when it declined to bake one-way behaviour into a reservoir primitive.

**No physics changed.** 232 tests, 230 pass, the two inherited reds byte-identical.

**The books close through a full charge/discharge cycle, checked on screen.** After charging to
the switch point and discharging to ~0 V, the receiver read **0.917915 J**. Since the discharge
source is an ideal 0 V and does no work, total heat must equal the charging work alone,
`Vs·C·Vc`. That implies `Vc = 9.179150 V` at the switch — and `10(1 − e^{−2.5}) = 9.179150 V`,
which is exactly where the click landed at τ = 1 s. The accounting is right end to end.

### Presentation — one minor finding, and one defect that was mine

**Minor, not blocking: the readout's precision is not declared.** Readings print at six
significant figures via `toPrecision(6)`, so `0.4999992 J` and `0.4999993 J` render the
**identical** text while their fills differ. Rounding is explicitly permitted by the layer
principle *"when its precision is clear"* — and here it is not stated, while the RC headline
prints seven significant figures for the same kind of quantity. Two different precisions for
one quantity, neither labelled. Worth a line of text, not a redesign.

**The label collision Astra reported was real, and the cause was my code.** Labels are
bottom-anchored by `translate(-50%, -100%)`, so a label at `y` occupies `[y − h, y]`. My
avoidance compared **centre distances symmetrically**, which is simply the wrong test for
boxes anchored that way: with a 26 px and a 66 px label the symmetric threshold is 49 px while
the true spans reach 66 px on one side and 26 on the other. **It missed a genuine overlap by
0.9 px.** Replaced with the true asymmetric box test. Verified across five samples during
charging *and* through the discharge transition, where terraces cross: **zero overlaps, all
labels inside the stage.**

### Not claimed

Full browser fault-injection acceptance remains **unclaimed by both of us** — Astra declined to
claim it and I have not gathered it either. The dense-label usability concern Astra raised is
improved by the collision fix but has not had a design pass. Experience acceptance remains
Peter's.

## D-52 — TWO OPEN ITEMS CLOSED BY VERIFICATION, and one that stays open

Both had been left explicitly unclaimed by **both** of us. Closed by driving the real page —
no source changes.

### Full browser fault injection — VERIFIED

The unit tests exercise `RcDriver` directly. That establishes the policy, not the page. Astra
declined to claim browser acceptance and so had I.

The first injection attempt **failed as a method** and is recorded as such: rewinding
`performance.now` did nothing, because a `requestAnimationFrame` callback receives the
browser's own timestamp, not a value read from `performance.now`. **A failed injection is not
evidence the guard works**, and it would have been easy to report it as a pass.

The working seam: Vite serves ES modules and caches them, so `await import('/src/model/rc.ts')`
in page context returns the **same class object** the page imported. Patching
`RcClock.prototype.advance` to throw injects a fault into the running page rather than a copy.

| step | observed |
| --- | --- |
| before | `Running · tick 1393` |
| fault injected | `FAULTED — not advancing · tick 1394`, notice states the state may be **partially updated**, is **not trustworthy**, and was **not skipped safely** |
| 900 ms later, fault still injected | tick still **1394** — no retry |
| One tick pressed | tick still **1394** — blocked |
| Run pressed | tick still **1394** — blocked |
| restored, Restart, Run | `Running · tick 41` — only a reset clears the latch |

Every clause of the declared policy holds on the real page.

### Responsive card stacking below 760 px — VERIFIED

At a 700 px viewport both gauge cards sit at x = 41, y = 720 and y = 886: stacked vertically,
618 px wide, and `scrollWidth` equals the viewport, so **no horizontal overflow**.

### The parallel-run flakiness — STAYS OPEN

It has **not** reproduced in two consecutive full parallel runs, both landing exactly on the two
retained reds. Machine load is now **12.87** against **25.74** when it first appeared, after
roughly twenty stale browser tabs — mine — were closed.

That is **evidence for** a load-dependent cause and is **not proof**. Two clean runs do not
establish absence. Applying Astra's earlier correction to myself: isolated or intermittent
passes do not establish that a cause is understood. The row stays open with the hypothesis
recorded rather than being quietly closed because it stopped happening.
