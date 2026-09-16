/**
 * BATCH 5 — THE LEARNING LFO.  A SWEEP YOU CAN WATCH.
 *
 * Peter's idea, borrowed from EDM: hook a low-frequency oscillator to a parameter
 * and watch the world respond over time, instead of reading one frozen solve.
 *
 * ===========================================================================
 * WHAT THIS IS, STATED BEFORE ANYTHING USES IT
 * ===========================================================================
 *
 * 1. THE LFO IS AN EXTERNAL EXPERIMENTER TURNING A KNOB. It is NOT a physical
 *    process inside the energy boundary. Nothing in this world spends energy to
 *    move a resistance or an EMF, and no such cost is modelled or booked. It has
 *    exactly the boundary status of the hand: an outside agent acting ON the
 *    world. A reader must never take a swept parameter for a thing the world did
 *    to itself.
 *
 * 2. THE CIRCUIT RESPONSE IS QUASI-STATIC, AND THAT IS A REAL LIMITATION.
 *    Every tick is an INDEPENDENT DC steady-state solve at the parameter's value
 *    for that tick. There is no capacitance, no inductance, no transient and no
 *    propagation, so sweeping fast does NOT model what a real circuit does when
 *    driven fast — it models a sequence of unrelated steady states. Sweeping
 *    SLOWLY, where a real circuit would settle far faster than the sweep moves,
 *    is the regime in which this is honest. Sweeping fast is a picture, not a
 *    prediction, and the UI says so at the point of use.
 *
 * 3. VALUE IS A PURE FUNCTION OF THE PUBLIC TICK. Not of wall-clock time, not of
 *    frame rate, not of an accumulated phase that could drift. `lfoValueAt` is
 *    total and deterministic, so a replay of the same ticks reproduces the same
 *    sweep exactly. The period is stored as an INTEGER COUNT OF PUBLIC TICKS for
 *    the same reason: a float Hz would make phase depend on accumulated rounding.
 *    Hz is DERIVED for display and never stored.
 *
 * 4. IT NEVER WRITES THE AUTHORED DOCUMENT. The sweep is applied as an override
 *    at solve time and on the runtime spring copy. "Save authored scene" saves
 *    the scene you authored, not wherever the knob happened to be.
 */

/** The unipolar shapes. Each maps phase p in [0,1) to a value in [0,1]. */
export type LfoWaveform = 'sine' | 'triangle' | 'square' | 'saw' | 'ramp-down';

export const LFO_WAVEFORMS: ReadonlyArray<{ id: LfoWaveform; label: string; note: string }> = [
  { id: 'sine', label: 'Sine', note: 'smooth, no corners — nothing is ever stationary except the two turning points' },
  { id: 'triangle', label: 'Triangle', note: 'constant rate of change, reversing — equal time at every value' },
  { id: 'square', label: 'Square', note: 'two values only, switched instantly — the step response you cannot see, because this model has none' },
  { id: 'saw', label: 'Saw (rising)', note: 'rises, then jumps back — the jump is instantaneous and unphysical' },
  { id: 'ramp-down', label: 'Ramp (falling)', note: 'falls, then jumps back' },
];

/** What a sweep can be attached to. `kind` picks how the world applies it. */
export type LfoTargetKind = 'resistance' | 'emf' | 'stiffness' | 'damping';

export interface LfoTarget {
  /** Stable key, e.g. `resistance:R4`. The UI round-trips this, not an index. */
  key: string;
  kind: LfoTargetKind;
  /** Component or spring id the sweep drives. */
  id: string;
  /** Human label for the menu. */
  label: string;
  /** SI unit symbol, printed everywhere the value is. */
  unit: string;
  /** Authored value at the time the menu was built, offered as the sweep centre. */
  current: number;
  /** Hard model limits. A sweep is REFUSED outside these, never silently clamped. */
  min: number;
  max: number;
}

export interface LfoSpec {
  enabled: boolean;
  /** `LfoTarget.key`, or null when nothing is selected. */
  targetKey: string | null;
  waveform: LfoWaveform;
  /** Integer public ticks per full cycle. >= 2. */
  periodTicks: number;
  /** Integer public ticks of phase offset. Kept integral so phase cannot drift. */
  phaseTicks: number;
  /** SI. The sweep runs between these two, inclusive. lo < hi. */
  lo: number;
  hi: number;
  /** Public tick at which the sweep started, so phase is measured from a fact. */
  startTick: number;
}

export const newLfoSpec = (): LfoSpec => ({
  enabled: false, targetKey: null, waveform: 'sine',
  periodTicks: 240, phaseTicks: 0, lo: 0, hi: 0, startTick: 0,
});

/** Public ticks per second. The world's public tick is fixed at 1/60 s. */
export const LFO_TICKS_PER_SECOND = 60;
/** Below this many ticks per cycle the quasi-static reading stops being defensible. */
export const LFO_QUASISTATIC_MIN_TICKS = 60;
export const LFO_LIMITS = { minPeriodTicks: 2, maxPeriodTicks: 60 * 600 } as const;

const bad = (s: string): never => { throw new Error(`LFO refused: ${s}`); };

/**
 * Validate a spec against the target it names. REFUSES rather than clamping: a
 * silently clamped sweep would show a range the reader did not ask for and would
 * make the printed bounds a lie.
 */
export function validateLfo(spec: LfoSpec, target: LfoTarget | null): void {
  if (!spec.enabled) return;
  if (!target) bad('no target selected');
  const t = target!;
  if (!Number.isInteger(spec.periodTicks)) bad(`period ${spec.periodTicks} must be a whole number of public ticks`);
  if (spec.periodTicks < LFO_LIMITS.minPeriodTicks) {
    bad(`period ${spec.periodTicks} ticks is below the minimum of ${LFO_LIMITS.minPeriodTicks}`);
  }
  if (spec.periodTicks > LFO_LIMITS.maxPeriodTicks) {
    bad(`period ${spec.periodTicks} ticks exceeds the maximum of ${LFO_LIMITS.maxPeriodTicks}`);
  }
  if (!Number.isInteger(spec.phaseTicks) || spec.phaseTicks < 0) bad(`phase ${spec.phaseTicks} must be a whole number of ticks, zero or more`);
  if (!Number.isFinite(spec.lo) || !Number.isFinite(spec.hi)) bad('sweep bounds must both be finite');
  if (!(spec.lo < spec.hi)) bad(`sweep bounds must satisfy lo < hi; got lo=${spec.lo}, hi=${spec.hi}`);
  if (spec.lo < t.min || spec.hi > t.max) {
    bad(`sweep [${spec.lo}, ${spec.hi}] ${t.unit} leaves the model range [${t.min}, ${t.max}] ${t.unit} for ${t.label}. `
      + 'The sweep is refused rather than clamped, so the printed bounds always mean what they say.');
  }
}

/** Unipolar shape in [0,1]. Exported so a test can pin each waveform on its own. */
export function lfoShape(w: LfoWaveform, p: number): number {
  switch (w) {
    case 'sine': return 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
    case 'triangle': return p < 0.5 ? 2 * p : 2 - 2 * p;
    case 'square': return p < 0.5 ? 0 : 1;
    case 'saw': return p;
    case 'ramp-down': return 1 - p;
  }
}

/**
 * The swept value at a public tick. TOTAL and DETERMINISTIC: same tick and spec
 * always give the same number, with no dependence on when or how often it is
 * called. Phase is integer tick arithmetic, so it cannot accumulate error.
 */
export function lfoValueAt(spec: LfoSpec, tick: number): number {
  const per = spec.periodTicks;
  const k = (((tick - spec.startTick + spec.phaseTicks) % per) + per) % per;
  return spec.lo + (spec.hi - spec.lo) * lfoShape(spec.waveform, k / per);
}

/** Phase in [0,1) at a tick — for drawing the position marker. */
export function lfoPhaseAt(spec: LfoSpec, tick: number): number {
  const per = spec.periodTicks;
  return ((((tick - spec.startTick + spec.phaseTicks) % per) + per) % per) / per;
}

export const lfoPeriodSeconds = (spec: LfoSpec): number => spec.periodTicks / LFO_TICKS_PER_SECOND;
export const lfoHz = (spec: LfoSpec): number => LFO_TICKS_PER_SECOND / spec.periodTicks;

/**
 * Whether the sweep is slow enough that reading each tick as a settled steady
 * state is defensible. This is a HONESTY FLAG FOR THE READER, not a refusal:
 * a fast sweep is still drawn, still labelled, and still exactly what the model
 * computed — it just is not a claim about a real circuit driven that fast.
 */
export const lfoIsQuasiStatic = (spec: LfoSpec): boolean => spec.periodTicks >= LFO_QUASISTATIC_MIN_TICKS;
