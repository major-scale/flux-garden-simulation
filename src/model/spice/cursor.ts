/**
 * THE PLAYBACK CURSOR, shared by every solved topology.
 *
 * Lifted out of `SolvedPlayback` unchanged when the lamp needed the same transport: pause, speed,
 * step-to-sample, seek, counted restart from rest. None of it touches a solver, so none of it can
 * affect the physics. What each topology owes on top is `frame()` — the RLC one reports an
 * AUTHORED start with nulls for the unsolved algebraic quantities (see playback.ts, kept
 * byte-identical); the lamp's start is the operating point ngspice solved at t = 0.
 */
export type PlaybackState = 'before-start' | 'playing' | 'paused' | 'at-horizon';

export abstract class PlaybackCursor<T extends { times: Float64Array; stopSeconds: number }> {
  /** Simulated seconds from the start of the solve. */
  protected cursor = 0;
  paused = true;
  /** Simulated seconds per wall second. */
  playbackRate: number;
  protected started = false;
  /**
   * RUN THE EXPERIMENT AGAIN FROM REST when it ends, rather than stopping on a frozen frame.
   *
   * THIS IS A RESTART, NOT A LOOP, and the difference is not pedantic. My first version wrapped
   * the cursor by the remainder and the comment claimed it "shows what the circuit would keep
   * doing" — because the source is periodic. Astra rejected that: a periodic SOURCE does not make
   * the TRAJECTORY periodic. The run begins from rest, so the state at the end is nothing like
   * the state at the beginning. Measured on the two alternating demonstrations:
   *
   *     one-way valve   t=0  Vc 0.0000 V   t=end  Vc  3.3648 V   jump = 36.1% of the Vc span
   *     turned around   t=0  Vc 0.0000 V   t=end  Vc -6.8159 V   jump = 73.1% of the Vc span
   *
   * Wrapping would have teleported the capacitor by several volts every few seconds and called it
   * continuity. So the cursor returns to zero, the replay is COUNTED, and the frame says which
   * replay it is — the viewer is told the experiment restarted, because it did.
   */
  replayFromRest = false;
  /** How many times the experiment has been restarted. Shown, never inferred. */
  replays = 0;

  constructor(protected transient: T, playbackRate: number) {
    this.playbackRate = playbackRate;
  }

  /** Replace the trajectory. ALWAYS a restart: a new solve is a different experiment. */
  adopt(transient: T, playbackRate = this.playbackRate): void {
    // A NEW TRAJECTORY IS A NEW EXPERIMENT: the replay count belongs to the run that was
    // replaying, not to whatever replaces it. Carrying it over labelled a freshly solved circuit
    // "run 4, restarted from rest" when it had never run at all.
    this.replays = 0;
    this.transient = transient;
    this.playbackRate = playbackRate;
    this.reset();
  }

  /** Back to the start. `replays` is cleared here as it is in `adopt`. */
  reset(): void {
    this.cursor = 0; this.started = false; this.paused = true; this.replays = 0;
  }

  get horizonSeconds(): number { return this.transient.stopSeconds; }
  get simulatedSeconds(): number { return this.cursor; }
  // A RUN SET TO REPLAY IS NEVER LEFT AT ITS HORIZON: it is still playing, and the frame loop
  // stops animating the current cues when this is true.
  get atHorizon(): boolean {
    return !this.replayFromRest && this.cursor >= this.transient.stopSeconds;
  }
  get source(): T { return this.transient; }

  /** Advance by wall-clock seconds. Returns the simulated seconds actually consumed. */
  advance(wallSeconds: number): number {
    if (this.paused || !Number.isFinite(wallSeconds) || wallSeconds <= 0) return 0;
    this.started = true;
    const before = this.cursor;
    const next = this.cursor + wallSeconds * this.playbackRate;
    // STOP AT THE HORIZON unless the experiment is set to run again. Never run against a clamped
    // sample: the run ends where the solve ends, and the frame says so.
    if (this.replayFromRest && next >= this.transient.stopSeconds) {
      this.replays++;
      this.cursor = 0;              // FROM REST. Not a wrap by remainder, which would imply the
                                    // end and the start were the same state. They are not.
      // AND BEFORE THE RUN STARTS AGAIN. `advance` sets `started` at the top, so without this the
      // frame at cursor 0 sampled the solver's FIRST INSTANT — already moving — instead of the
      // authored reset. The restart would have skipped the one state the viewer is told it is
      // returning to.
      this.started = false;
      return this.cursor - before;
    }
    this.cursor = Math.min(this.transient.stopSeconds, next);
    return this.cursor - before;
  }

  /**
   * Step to the NEXT ACTUAL SOLVER SAMPLE.
   *
   * It used to advance by the median grid spacing, which is a DISPLAY interval across an
   * irregular grid, not a solver step — so "one step" landed between samples and interpolated.
   * Now it moves to the next real sample, which is what stepping through a solution means.
   */
  stepOne(): void {
    const times = this.transient.times;
    this.started = true;
    let next = times[times.length - 1];
    for (let k = 0; k < times.length; k++)
      if (times[k] > this.cursor + 1e-18) { next = times[k]; break; }
    this.cursor = Math.min(this.transient.stopSeconds, next);
  }

  /** Move the cursor directly. Used by a scrubber, and by tests. */
  seek(timeSeconds: number): void {
    if (!Number.isFinite(timeSeconds))
      throw new Error(`Cannot seek to a non-finite time (${timeSeconds}).`);
    this.started = timeSeconds > 0;
    this.cursor = Math.min(Math.max(0, timeSeconds), this.transient.stopSeconds);
  }

  protected get state(): Exclude<PlaybackState, 'before-start'> {
    return this.atHorizon ? 'at-horizon' : this.paused ? 'paused' : 'playing';
  }
  protected get progress(): number {
    return this.transient.stopSeconds > 0 ? this.cursor / this.transient.stopSeconds : 1;
  }
}
