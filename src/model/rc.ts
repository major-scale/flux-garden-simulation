/** RC-1: analytic held-input intervals. See RC-DECLARATION.md. */
import { routeResistorHeat, type ThermalState } from './thermal';

export interface RcInputs { voltage: number; resistance: number; capacitance: number; initialVoltage: number; }
/**
 * THE DECLARED INPUT DOMAIN.
 *
 * The capacitance floor was 1e-6 F. GC1 lowers it to 1e-13 F because REAL PLATE
 * GEOMETRY LANDS THERE: 1 cm² plates across a 1 mm vacuum gap is 0.885 pF — which
 * a 1e-12 floor would still have refused — and
 * 10 cm² of foil across 10 µm of film is 2.7 nF. Refusing those would have meant
 * either abandoning real geometry or inventing a permittivity to reach 1 µF, and
 * inventing a permittivity is a model-layer lie.
 *
 * The resistance ceiling rises to 1e9 Ω for the same reason: with C in nanofarads a
 * watchable time constant needs megohms, which is an ordinary real resistor.
 *
 * This is a DECLARED DOMAIN EXTENSION, made deliberately and tested, not a limit
 * quietly relaxed to make a new feature fit. RC-1's existing behaviour, defaults and
 * saved documents are unaffected: every previously valid input is still valid.
 */
export const RC_LIMITS = {
  minR: 1, maxR: 1e9,
  minC: 1e-13, maxC: 1,
} as const;

export const RC_DEFAULT: RcInputs = { voltage: 10, resistance: 100, capacitance: 0.01, initialVoltage: 0 };
/**
 * The DEFAULT simulated interval, in seconds. RC-1 runs at 1/60 s and is unchanged.
 *
 * SIMULATED INTERVAL IS NOT PLAYBACK SPEED. Astra's correction, and it is the one
 * that makes millisecond transients possible at all: slowing playback does NOT
 * resolve a fast transient, because at a 16.7 ms interval a capacitor with
 * tau = 2.7 ms completes essentially its whole charge INSIDE THE FIRST INTERVAL.
 * Slower playback merely spaces the same coarse samples further apart in wall time.
 *
 * So an experiment may DECLARE a finer interval. The analytic exponential update is
 * exact per interval, so a finer h costs resolution only, never correctness.
 */
export const RC_DT = 1 / 60;
export function validateRc(value: unknown): asserts value is RcInputs {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'capacitance,initialVoltage,resistance,voltage')
    throw new Error('RC inputs require exactly voltage, resistance, capacitance and initialVoltage.');
  const p = value as RcInputs;
  if (![p.voltage, p.initialVoltage, p.resistance, p.capacitance].every(Number.isFinite)
    || Math.abs(p.voltage) > 100 || Math.abs(p.initialVoltage) > 100
    || p.resistance < RC_LIMITS.minR || p.resistance > RC_LIMITS.maxR
    || p.capacitance < RC_LIMITS.minC || p.capacitance > RC_LIMITS.maxC)
    throw new Error(`RC refused: voltages −100…100 V, resistance ${RC_LIMITS.minR}…${RC_LIMITS.maxR} Ω, `
      + `capacitance ${RC_LIMITS.minC}…${RC_LIMITS.maxC} F; finite numbers only.`);
}
export function encodeRc(p: RcInputs): string {
  validateRc(p);
  return JSON.stringify({ format: 'flux-rc-1', inputs: p }, null, 2);
}
export function decodeRc(text: string): RcInputs {
  const doc = JSON.parse(text);
  if (!doc || Object.keys(doc).sort().join(',') !== 'format,inputs' || doc.format !== 'flux-rc-1')
    throw new Error('Expected an authored flux-rc-1 experiment, not a live checkpoint.');
  validateRc(doc.inputs);
  return { ...doc.inputs };
}

export class RcExperiment {
  readonly inputs: Readonly<RcInputs>;
  /**
   * s. The simulated interval this experiment advances by. Declared with the run.
   * Defaults to RC_DT so every existing run, save and test is untouched.
   */
  readonly dt: number;
  voltage: number;
  tick = 0;
  sourceWork = 0;
  jouleHeat = 0;
  connected = true;
  readonly thermal: ThermalState = { bodies: [{ id: 'rc-chassis', heat: 0, backflowCount: 0 }], routed: [], exportedHeat: 0 };
  constructor(p: RcInputs, dt: number = RC_DT) {
    validateRc(p);
    if (!Number.isFinite(dt) || dt <= 0) throw new Error('Simulated interval must be finite and positive');
    this.inputs = Object.freeze({ ...p });
    this.dt = dt;
    this.voltage = p.initialVoltage;
  }
  /** s. Actual SIMULATED time, never a tick count scaled by a playback factor. */
  get simulatedSeconds(): number { return this.tick * this.dt; }
  get sourceVoltage(): number { return this.connected ? this.inputs.voltage : 0; }
  get current(): number { return (this.sourceVoltage - this.voltage) / this.inputs.resistance; }
  get initialEnergy(): number { return this.inputs.capacitance * this.inputs.initialVoltage ** 2 / 2; }
  get storedEnergy(): number { return this.inputs.capacitance * this.voltage ** 2 / 2; }
  get receiverHeat(): number { return this.thermal.bodies[0].heat; }
  get temperature(): number { return 300 + this.receiverHeat / 2; }
  get residual(): number { return this.initialEnergy + this.sourceWork - this.storedEnergy - this.receiverHeat; }
  get tolerance(): number {
    return Math.max(1e-10, 1e-9 * Math.max(this.initialEnergy, Math.abs(this.sourceWork), this.storedEnergy, this.receiverHeat));
  }
  step(): void {
    const { resistance: r, capacitance: c } = this.inputs;
    const d = this.sourceVoltage - this.voltage;
    const x = this.dt / (r * c);
    const delta = d * -Math.expm1(-x);
    const work = this.sourceVoltage * c * delta;
    const heat = c * d * d * -Math.expm1(-2 * x) / 2;
    this.voltage += delta;
    this.sourceWork += work;
    this.jouleHeat += heat;
    routeResistorHeat(this.thermal, 'rc-resistor', 'rc-chassis', heat);
    this.tick++;
  }
}

/**
 * What the clock actually needs from an experiment: a declared interval and a way to
 * advance one. Widened from `RcExperiment` so the same clock drives the RLC experiment
 * too — the circuit grows, the timing contract does not change. `tick` is included
 * because existing tests read it through the clock.
 */
export interface SteppableExperiment {
  readonly dt: number;
  readonly tick: number;
  step(): void;
}

/** Wall time only chooses whole fixed ticks. The model never consumes frame dt. */
export class RcClock<E extends SteppableExperiment = RcExperiment> {
  paused = true;
  accumulator = 0;
  droppedSeconds = 0;
  /**
   * `playback` scales WALL-CLOCK time into simulated time. It is presentation: it
   * changes how fast the declared interval is consumed and changes NO value. A
   * playback of 0.001 advances one simulated millisecond per wall-clock second.
   * `maxStepsPerFrame` bounds catch-up; the excess is REPORTED as dropped.
   */
  private playbackValue = 1;
  private maxStepsValue = 5;
  /** Wall-clock to simulated scaling. Presentation only; changes no value. */
  get playback(): number { return this.playbackValue; }
  set playback(v: number) {
    if (!Number.isFinite(v) || v < 0) throw new Error('Playback must be finite and not negative');
    this.playbackValue = v;
  }
  /** Catch-up bound. Excess elapsed time is REPORTED as dropped, never folded into a bigger step. */
  get maxStepsPerFrame(): number { return this.maxStepsValue; }
  set maxStepsPerFrame(v: number) {
    if (!Number.isInteger(v) || v < 1) throw new Error('Steps per frame must be a positive whole number');
    this.maxStepsValue = v;
  }
  constructor(readonly experiment: E, private sample: () => void = () => {}) {}
  step(): void { this.experiment.step(); this.sample(); }
  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid frame interval');
    if (this.paused) return;
    const accepted = Math.min(seconds, 0.25);
    this.droppedSeconds += (seconds - accepted) * this.playbackValue;
    this.accumulator += accepted * this.playbackValue;
    let count = 0;
    // The clock consumes the EXPERIMENT'S declared interval. Wall-clock seconds in,
    // simulated intervals out — the two are deliberately different quantities.
    const h = this.experiment.dt;
    // THE TOLERANCE MUST SCALE WITH h. It was an absolute 1e-12 s, which was fine at
    // a 1/60 s interval and became a defect the moment GC1 admitted picofarad
    // geometry: at h = 5e-15 s the epsilon is TWO HUNDRED TIMES LARGER THAN ONE
    // INTERVAL, so `advance(0)` advanced five ticks and booked 1e-12 s of dropped
    // time out of ZERO elapsed time. Astra found it by executing the real clock.
    // An absolute tolerance cannot serve a domain spanning many decades of h.
    const eps = h * 1e-9;
    while (this.accumulator + eps >= h && count < this.maxStepsValue) {
      this.step(); this.accumulator = Math.max(0, this.accumulator - h); count++;
    }
    const dropped = Math.floor((this.accumulator + eps) / h);
    if (dropped > 0) {
      this.droppedSeconds += dropped * h;
      this.accumulator = Math.max(0, this.accumulator - dropped * h);
    }
  }
}
