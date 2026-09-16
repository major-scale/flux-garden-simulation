/**
 * PLAYING BACK A SOLVED TRANSIENT.
 *
 * The whole transient is solved once, so playing it is pure lookup. That is not merely simple —
 * it makes a guarantee structural that the analytic kernel had to earn by care: pause, step and
 * speed CANNOT affect the physics, because none of them touches a solver. There is exactly one
 * trajectory per configuration, so a "replayed transient presented as continuous state" is not
 * a hazard to guard against; it cannot arise.
 *
 * What playback owes the viewer in exchange is honesty about three things, all surfaced rather
 * than hidden: the time it actually represents (the solver's grid is not the requested one), the
 * fact that it has reached the end of the solved horizon rather than settled, and that changing
 * the circuit RESTARTS rather than continues.
 */
import { sampleAt, type Snapshot, type Transient } from './transient';

export type { PlaybackState } from './cursor';
import { PlaybackCursor, type PlaybackState } from './cursor';

/**
 * A FRAME IS ONE OF TWO KINDS, and they are different in nature, not merely in values.
 *
 * A SOLVED frame carries everything, all from one instant of the trajectory.
 *
 * An AUTHORED-START frame is the reset state, before any solving. The initial current and
 * charge are known exactly — they were authored, and the solver was told to start from them —
 * but the algebraic quantities are NOT: the voltage across the inductor at t = 0 depends on the
 * rest of the loop, and with a diode in it there is no way to know the drop without solving.
 *
 * MY FIRST VERSION FILLED THOSE IN ANYWAY. It set vL = 0 "because unknown", which made di/dt
 * zero and the pickup read exactly zero volts — when the true answer for a 10 V source into a
 * discharged capacitor at rest is 10 V across the inductor and a large induced voltage. Worse,
 * it took the node voltages from the FIRST SOLVED SAMPLE while taking current and charge from
 * t = 0, producing precisely the mixed-time snapshot this design exists to prevent.
 *
 * So the unknown fields are `null`. A renderer must suppress or label anything derived from
 * them until the first solved sample, and cannot mistake absence for zero.
 */
export interface AuthoredStartFrame {
  kind: 'authored-start';
  timeSeconds: 0;
  requestedTimeSeconds: number;
  /** Known exactly: these were authored and the solver starts from them. */
  currentAmps: number;
  capacitorVolts: number;
  capacitorJoules: number;
  inductorJoules: number;
  /** NOT known without solving. Null, never zero. */
  sourceVolts: null;
  afterResistorVolts: null;
  inductorInVolts: null;
  inductorVolts: null;
  diDtAmpsPerSecond: null;
  clampedToHorizon: false;
  onEventEdge: false;
  state: 'before-start';
  progress: 0;
}

export interface SolvedFrame extends Snapshot {
  kind: 'solved';
  requestedTimeSeconds: number;
  clampedToHorizon: boolean;
  onEventEdge: boolean;
  state: Exclude<PlaybackState, 'before-start'>;
  progress: number;
}

export type PlaybackFrame = AuthoredStartFrame | SolvedFrame;

/**
 * THE RLC PLAYBACK. Its transport lives in `PlaybackCursor` (shared with the lamp); what is kept
 * here is the one thing that is RLC's own — the authored-start frame with its nulls.
 */
export class SolvedPlayback extends PlaybackCursor<Transient> {
  /**
   * The current frame.
   *
   * AT THE VERY START it reports the AUTHORED initial state, not the first solved sample. The
   * solver's first sample is at a small positive time, so with a charged capacitor or a moving
   * inductor, showing that sample as t = 0 would display a state the experiment never started
   * from. Once playback has moved, every value comes from the solved trajectory.
   */
  frame(): PlaybackFrame {
    const t = this.transient;
    if (!this.started && this.cursor === 0) {
      const init = t.initialState;
      return {
        kind: 'authored-start',
        timeSeconds: 0, requestedTimeSeconds: 0,
        currentAmps: init.currentAmps, capacitorVolts: init.capacitorVolts,
        capacitorJoules: 0.5 * t.capacitanceFarads * init.capacitorVolts ** 2,
        inductorJoules: 0.5 * t.inductanceHenries * init.currentAmps ** 2,
        // Unknown without solving, and therefore absent. Not zero.
        sourceVolts: null, afterResistorVolts: null, inductorInVolts: null, inductorVolts: null,
        diDtAmpsPerSecond: null,
        clampedToHorizon: false, onEventEdge: false, state: 'before-start', progress: 0,
      };
    }
    const s = sampleAt(t, this.cursor);
    return {
      kind: 'solved', ...s,
      state: this.state,
      progress: this.progress,
    };
  }
}
