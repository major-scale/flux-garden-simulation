/**
 * RC-1 — the CLOCK's failure paths, deterministically.
 *
 * These cover the startup race and the fault policy that Astra returned. They test
 * `RcClock` directly with controlled timestamps rather than a browser, so they are
 * repeatable: the original defect was a ~4.5 ms race and a race cannot be a test.
 */
import { describe, it, expect } from 'vitest';
import { RcClock, RcExperiment, RC_DEFAULT } from './rc';
// THE PRODUCTION driver, not a copy. Astra's finding: the previous version of this
// file re-implemented the policy, so deleting the guards from the real page would
// have left these tests green. They now import what the page actually runs.
import { RcDriver, frameSeconds } from './rc-driver';

const mk = () => new RcClock(new RcExperiment(RC_DEFAULT));

describe('the startup race that killed the loop', () => {
  it('a NEGATIVE interval is what the guard exists to reject', () => {
    const c = mk(); c.paused = false;
    expect(() => c.advance(-0.0045)).toThrow(/Invalid frame interval/);
  });

  it('the UI contract — seed from the first frame, clamp — never produces one', () => {
    // Reproduces the real cause: the first rAF timestamp can PRECEDE the
    // performance.now() taken during module evaluation. Measured at -4.5 ms.
    const stamps = [100, 116, 115, 132];      // note the third is EARLIER than the second
    let last: number | null = null;
    const intervals: number[] = [];
    for (const now of stamps) { intervals.push(frameSeconds(now, last)); last = now; }
    expect(intervals[0]).toBe(0);             // first frame contributes nothing
    expect(intervals.every((d) => d >= 0)).toBe(true);
    const c = mk(); c.paused = false;
    for (const d of intervals) expect(() => c.advance(d)).not.toThrow();
  });

  it('a zero interval is legal and advances nothing', () => {
    const c = mk(); c.paused = false;
    c.advance(0);
    expect(c.experiment.tick).toBe(0);
  });
});

describe('a fault must LATCH, not retry — Astra`s returned policy', () => {
  const makeDriver = (clock: RcClock) => new RcDriver(clock);

  it('one throwing interval latches, pauses, and does NOT advance again', () => {
    const c = mk(); c.paused = false;
    const d = makeDriver(c);
    d.frame(-1);                                  // throws
    expect(d.faulted).toMatch(/Invalid frame interval/);
    expect(c.paused).toBe(true);
    const at = c.experiment.tick;
    for (let i = 0; i < 50; i++) d.frame(1 / 60); // would be 50 ticks if it retried
    expect(c.experiment.tick).toBe(at);           // nothing advanced while latched
  });

  it('the frame guard is LOAD-BEARING, not covered for free by the pause', () => {
    // My first version of the test above passed even with the frame() guard DELETED,
    // because latching also sets paused and `advance` returns early when paused. It
    // was passing for the wrong reason. Found by mutating the driver and watching
    // the suite stay green.
    //
    // This forces `paused` back to false while the fault is latched, so ONLY the
    // guard can stop it. Deleting the guard makes this test go red, as it must.
    const c = mk(); c.paused = false;
    const d = makeDriver(c);
    d.frame(-1);                                   // latch
    expect(d.faulted).not.toBeNull();
    c.paused = false;                              // something else clears the pause
    const at = c.experiment.tick;
    for (let i = 0; i < 50; i++) d.frame(1 / 60);
    expect(c.experiment.tick).toBe(at);            // the GUARD held, not the pause
    expect(d.advancing).toBe(false);               // and it never claims to be running
  });

  it('ONE TICK is blocked while latched — it advances the same operation', () => {
    const c = mk(); c.paused = false;
    const d = makeDriver(c);
    d.frame(-1);
    const at = c.experiment.tick;
    expect(d.step()).toBe(false);
    expect(c.experiment.tick).toBe(at);
  });

  it('only a reset clears the latch, and advancing resumes after it', () => {
    const c = mk(); c.paused = false;
    const d = makeDriver(c);
    d.frame(-1);
    expect(d.faulted).not.toBeNull();
    d.reset(c);
    expect(d.faulted).toBeNull();
    c.paused = false;
    d.frame(1 / 60);
    expect(c.experiment.tick).toBe(1);
  });

  it('NON-VACUITY: without a fault the same driver advances normally', () => {
    const c = mk(); c.paused = false;
    const d = makeDriver(c);
    for (let i = 0; i < 10; i++) d.frame(1 / 60);
    expect(d.faulted).toBeNull();
    expect(c.experiment.tick).toBe(10);
  });
});

describe('catch-up is bounded and the excess is REPORTED as dropped', () => {
  it('never folds excess elapsed time into a bigger physics step', () => {
    const c = mk(); c.paused = false;
    c.advance(1.0);                                // 60 ticks' worth of wall time
    expect(c.experiment.tick).toBeLessThanOrEqual(5);   // capped at 5 per frame
    expect(c.droppedSeconds).toBeGreaterThan(0);        // and the rest is declared
  });
});
