/**
 * THE RC FRAME DRIVER — the production fault policy, extracted so it can be tested.
 *
 * It used to live inline in `src/ui/rc.ts`, and the tests re-implemented a copy of
 * it. Astra's finding, and it is a vacuity problem rather than a style one:
 * **removing the guards from the real page would have left those tests green.**
 * A test that exercises a copy of the logic establishes nothing about the logic.
 *
 * So the policy lives here, the page uses THIS, and the tests import THIS.
 *
 * The policy itself, per Astra's earlier return: a throw from an advancing call is
 * LATCHED. `advance` may have partially updated the model before throwing, so the
 * interval is NOT a safely skipped transaction and must never be reported as one.
 * Nothing advances again until a reset.
 */
import type { RcClock, SteppableExperiment } from './rc';

export class RcDriver {
  private fault: string | null = null;
  constructor(private clock: RcClock<SteppableExperiment>) {}

  /** Non-null when an advancing call threw and the model may be partially updated. */
  get faulted(): string | null { return this.fault; }

  /** True only when the clock is genuinely advancing — never asserted, always derived. */
  get advancing(): boolean { return this.fault === null && !this.clock.paused; }

  /** One display frame. `seconds` must already be non-negative. */
  frame(seconds: number): void {
    if (this.fault !== null) return;
    try { this.clock.advance(seconds); }
    catch (e) { this.latch(e); }
  }

  /** One tick. The SAME advancing operation, so it is guarded identically. */
  step(): boolean {
    if (this.fault !== null) return false;
    this.clock.paused = true;
    try { this.clock.step(); return true; }
    catch (e) { this.latch(e); return false; }
  }

  /** Run / pause. Refused while faulted. */
  togglePaused(): void {
    if (this.fault !== null) return;
    this.clock.paused = !this.clock.paused;
  }

  /** Adopt a fresh clock. The ONLY thing that clears a latched fault. */
  reset(clock: RcClock<SteppableExperiment>): void { this.clock = clock; this.fault = null; }

  private latch(e: unknown): void {
    this.fault = String(e);
    this.clock.paused = true;
  }
}

/**
 * The frame-interval contract. A rAF timestamp is the time the frame BEGAN and can
 * PRECEDE a `performance.now()` taken during module evaluation — measured at -4.5 ms
 * — so the first interval is seeded from the first frame and any residual negative
 * is clamped rather than passed to the model's guard.
 */
export function frameSeconds(now: number, last: number | null): number {
  return last === null ? 0 : Math.max(0, (now - last) / 1000);
}
