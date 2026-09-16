/**
 * FP1 — the fixed-step driver.
 *
 * ===========================================================================
 * FIXED 1/60 s PHYSICS STEP, DECOUPLED FROM DISPLAY CADENCE.  (plan §2)
 * RENDERING INTERPOLATES; IT NEVER DRIVES THE SIMULATION.
 * ===========================================================================
 *
 * dt is a constant. It is never scaled by frame time, never varied, and never
 * derived from `requestAnimationFrame`. Wall-clock time enters exactly one place:
 * it decides HOW MANY whole fixed ticks to run, never how long one is.
 *
 * THE DECLARED CATCH-UP / SLOWDOWN POLICY
 * ---------------------------------------
 *   accumulator += min(frameDeltaWallClock, MAX_FRAME_DELTA)
 *   run whole ticks while accumulator >= dt, up to MAX_CATCHUP_TICKS_PER_FRAME
 *   if the accumulator is still >= dt after that cap:
 *       DROP the excess (accumulator := accumulator mod dt) and count it.
 *
 * That is: WHEN THE MACHINE CANNOT KEEP UP, SIMULATED TIME RUNS SLOWER THAN WALL
 * CLOCK. We do not take bigger steps and we do not spiral. The amount of dropped
 * simulated time is COUNTED (`droppedTicks`, `droppedSimSeconds`) and shown in
 * the HUD, so a slowdown is visible rather than silently absorbed.
 *
 * MAX_FRAME_DELTA guards the tab-was-backgrounded case: a 30 s frame delta must
 * not become 1800 catch-up ticks.
 *
 * INTERPOLATION
 * -------------
 * `alpha = accumulator / dt` in [0,1). The renderer draws
 *   pose = lerp(poseAtTickN-1, poseAtTickN, alpha)
 * so display smoothness is independent of the physics cadence, and nothing the
 * renderer does can feed back into the simulation.
 */

import { SI } from '../model/units';
import type { SimWorld } from './world';
import type { Quat, Vec3 } from '../model/units';

export const MAX_CATCHUP_TICKS_PER_FRAME = 5;      // ticks
export const MAX_FRAME_DELTA = 0.25;               // s

export interface PoseSample { t: Vec3; r: Quat; }

export interface DriverStats {
  ticksThisFrame: number;
  droppedTicks: number;
  droppedSimSeconds: number;
  accumulator: number;
  alpha: number;
  /** ms, wall clock spent inside world.step() and our force build, this frame. */
  physicsMsThisFrame: number;
}

export class FixedStepDriver {
  readonly dt = SI.DT;
  accumulator = 0;
  paused = false;
  droppedTicks = 0;
  stats: DriverStats = {
    ticksThisFrame: 0, droppedTicks: 0, droppedSimSeconds: 0,
    accumulator: 0, alpha: 0, physicsMsThisFrame: 0,
  };

  /** Pose at the end of tick N-1 and tick N, for render interpolation only. */
  prev = new Map<string, PoseSample>();
  curr = new Map<string, PoseSample>();

  constructor(
    private sim: SimWorld,
    private onBeforeTick?: (tick: number) => void,
    /**
     * Called AFTER each whole public tick has advanced. The measurement path
     * hangs off this so that a frame which runs several catch-up ticks samples
     * every one of them, rather than only the last.
     */
    private onAfterTick?: (tick: number) => void,
  ) {
    this.capture(this.prev);
    this.capture(this.curr);
  }

  private capture(into: Map<string, PoseSample>): void {
    into.clear();
    for (const id of this.sim.order) {
      const b = this.sim.body(id);
      const t = b.translation(), r = b.rotation();
      into.set(id, { t: { x: t.x, y: t.y, z: t.z }, r: { x: r.x, y: r.y, z: r.z, w: r.w } });
    }
  }

  /** Resync both interpolation buffers, e.g. after reset/restore. */
  resync(): void { this.accumulator = 0; this.capture(this.prev); this.capture(this.curr); }

  /** One whole fixed tick. The only entry point that advances the simulation. */
  stepOnce(): void {
    const t0 = performance.now();
    this.onBeforeTick?.(this.sim.tick);
    const tmp = this.prev; this.prev = this.curr; this.curr = tmp;
    this.sim.tickOnce();
    this.capture(this.curr);
    this.stats.physicsMsThisFrame += performance.now() - t0;
    this.onAfterTick?.(this.sim.tick);
  }

  /** Advance by wall-clock frame delta under the declared policy above. */
  advance(frameDeltaSeconds: number): void {
    this.stats.ticksThisFrame = 0;
    this.stats.physicsMsThisFrame = 0;
    if (this.paused) { this.stats.alpha = 0; this.stats.accumulator = this.accumulator; return; }

    this.accumulator += Math.min(frameDeltaSeconds, MAX_FRAME_DELTA);
    let n = 0;
    while (this.accumulator >= this.dt && n < MAX_CATCHUP_TICKS_PER_FRAME) {
      this.accumulator -= this.dt;
      this.stepOnce();
      n++;
    }
    if (this.accumulator >= this.dt) {
      // SLOWDOWN, not a bigger step. Drop the excess and count it.
      const dropped = Math.floor(this.accumulator / this.dt);
      this.droppedTicks += dropped;
      this.accumulator -= dropped * this.dt;
      this.stats.droppedTicks = this.droppedTicks;
      this.stats.droppedSimSeconds = this.droppedTicks * this.dt;
    }
    this.stats.ticksThisFrame = n;
    this.stats.accumulator = this.accumulator;
    this.stats.alpha = this.accumulator / this.dt;
  }

  /** Interpolated pose for rendering. Never fed back into the simulation. */
  interpolated(id: string, alpha: number): PoseSample | null {
    const a = this.prev.get(id), b = this.curr.get(id);
    if (!b) return null;
    if (!a) return b;
    const s = alpha;
    let dot = a.r.x * b.r.x + a.r.y * b.r.y + a.r.z * b.r.z + a.r.w * b.r.w;
    const sign = dot < 0 ? -1 : 1;
    const r = {
      x: a.r.x + (b.r.x * sign - a.r.x) * s,
      y: a.r.y + (b.r.y * sign - a.r.y) * s,
      z: a.r.z + (b.r.z * sign - a.r.z) * s,
      w: a.r.w + (b.r.w * sign - a.r.w) * s,
    };
    const n = Math.hypot(r.x, r.y, r.z, r.w) || 1;
    return {
      t: { x: a.t.x + (b.t.x - a.t.x) * s, y: a.t.y + (b.t.y - a.t.y) * s, z: a.t.z + (b.t.z - a.t.z) * s },
      r: { x: r.x / n, y: r.y / n, z: r.z / n, w: r.w / n },
    };
  }
}

/** Headless helper: run exactly n whole fixed ticks. Used by the tests. */
export function runTicks(sim: SimWorld, n: number, onBeforeTick?: (tick: number) => void): void {
  for (let i = 0; i < n; i++) {
    onBeforeTick?.(sim.tick);
    sim.tickOnce();
  }
}
