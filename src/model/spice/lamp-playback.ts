/**
 * PLAYING BACK THE SOLVED LAMP. The transport is the shared cursor; the frame is the sampled
 * trajectory. THERE IS NO AUTHORED-START FRAME HERE, and that is a statement about the circuit,
 * not a shortcut: the lamp run has no authored stored state, it starts from the operating point
 * ngspice solved at t = 0, and that sample is the start. Every quantity is known at the reset.
 */
import { PlaybackCursor, type PlaybackState } from './cursor';
import { sampleLampAt, type LampSnapshot, type LampTransient } from './lamp-transient';

export interface LampFrame extends LampSnapshot {
  kind: 'solved';
  requestedTimeSeconds: number;
  clampedToHorizon: boolean;
  onEdge: boolean;
  state: PlaybackState;
  progress: number;
}

export class LampPlayback extends PlaybackCursor<LampTransient> {
  frame(): LampFrame {
    const s = sampleLampAt(this.transient, this.cursor);
    const atStart = !this.started && this.cursor === 0;
    return { kind: 'solved', ...s, state: atStart ? 'before-start' : this.state,
      progress: atStart ? 0 : this.progress };
  }
}
