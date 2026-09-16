import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { buildNetlist, type CircuitDescription } from './netlist';
import { toTransient } from './transient';
import { SolvedPlayback } from './playback';

const L = 1.8852603987e-5, C = 8.8541878128e-11, R = 297;
const PERIOD = 2 * Math.PI * Math.sqrt(L * C);
const d: CircuitDescription = {
  sourceVolts: 10, resistanceOhms: R, inductanceHenries: L, capacitanceFarads: C,
  initialCapacitorVolts: 0, initialInductorAmps: 0,
  stopSeconds: 5 * PERIOD, stepSeconds: PERIOD / 240,
};
async function solved(desc = d) {
  const sim = new Simulation(); await sim.start();
  sim.setNetList(buildNetlist(desc));
  return toTransient(await sim.runSim() as never, desc, 'test');
}

describe('playback cannot affect the physics', () => {
  it('THE SAME INSTANT gives a bit-identical state, however it was reached', async () => {
    // This is the exact claim: lookup is deterministic. Ask for one time by two routes — a
    // direct seek and an accumulated playback that is then seeked to the same value — and the
    // numbers are identical, not merely close.
    const t = await solved();
    const a = new SolvedPlayback(t, d.stopSeconds / 3);
    const b = new SolvedPlayback(t, d.stopSeconds / 3);
    b.paused = false;
    for (let k = 0; k < 90; k++) b.advance(1 / 60);
    const at = b.simulatedSeconds;
    a.seek(at);
    const fa = a.frame(), fb = b.frame();
    expect(fb.currentAmps).toBe(fa.currentAmps);
    expect(fb.capacitorVolts).toBe(fa.capacitorVolts);
    expect(fb.timeSeconds).toBe(fa.timeSeconds);
  }, 60000);

  it('different wall-clock routes agree to accumulation error, which is NOT physics', async () => {
    // 180 frames of 1/60 s and 30 frames of 1/10 s are the same total wall time in exact
    // arithmetic and NOT in floating point, so the cursors land a few ULP apart and the
    // interpolated values differ in the last digits. Claiming bit-identity here would be
    // wrong — I did claim it, and this is what the test found. The physics is untouched: the
    // trajectory is fixed and the difference is where the cursor stopped, not what it read.
    const t = await solved();
    const rate = d.stopSeconds / 3;
    const a = new SolvedPlayback(t, rate); a.paused = false;
    const b = new SolvedPlayback(t, rate); b.paused = false;
    for (let k = 0; k < 180; k++) a.advance(1 / 60);
    for (let k = 0; k < 30; k++) { b.advance(1 / 10); b.paused = true; b.paused = false; }
    const dt = Math.abs(b.simulatedSeconds - a.simulatedSeconds);
    expect(dt / a.simulatedSeconds).toBeLessThan(1e-12);
    const fa = a.frame(), fb = b.frame();
    const iPeak = Math.max(...[...t.currents].map(Math.abs));
    expect(Math.abs(fb.currentAmps - fa.currentAmps) / iPeak).toBeLessThan(1e-9);
  }, 60000);

  it('a pause changes nothing at all', async () => {
    const t = await solved();
    const p = new SolvedPlayback(t, d.stopSeconds / 3); p.paused = false;
    p.advance(0.5);
    const before = p.frame();
    p.paused = true;
    for (let k = 0; k < 50; k++) p.advance(1 / 60);   // ignored while paused
    const after = p.frame();
    expect(after.currentAmps).toBe(before.currentAmps);
    expect(after.timeSeconds).toBe(before.timeSeconds);
  }, 60000);

  it('stops AT the horizon rather than wrapping or restarting', async () => {
    const t = await solved();
    const p = new SolvedPlayback(t, d.stopSeconds); p.paused = false;
    for (let k = 0; k < 100; k++) p.advance(1);       // far past the end
    expect(p.simulatedSeconds).toBe(t.stopSeconds);
    expect(p.frame().state).toBe('at-horizon');
    expect(p.frame().progress).toBeCloseTo(1, 12);
  }, 60000);
});

describe('the start of a run is the authored state, not the first sample', () => {
  it('reports the charged start exactly, then moves onto the solved trajectory', async () => {
    const charged = { ...d, sourceVolts: 0, initialCapacitorVolts: 7.5, stopSeconds: 2 * PERIOD };
    const t = await solved(charged);
    const p = new SolvedPlayback(t, charged.stopSeconds / 3);
    const first = p.frame();
    expect(first.kind).toBe('authored-start');
    expect(first.timeSeconds).toBe(0);
    expect(first.capacitorVolts).toBe(7.5);          // authored, not t.capacitorVolts[0]
    expect(t.times[0]).toBeGreaterThan(0);           // the solver never gave us t = 0
    p.paused = false; p.advance(0.001);
    const moved = p.frame();
    expect(moved.kind).toBe('solved');
    expect(moved.timeSeconds).toBeGreaterThan(0);
  }, 60000);

  it('a new solve RESTARTS rather than continuing', async () => {
    const t = await solved();
    const p = new SolvedPlayback(t, d.stopSeconds / 3); p.paused = false;
    p.advance(1);
    expect(p.simulatedSeconds).toBeGreaterThan(0);
    p.adopt(await solved({ ...d, resistanceOhms: 500 }));
    expect(p.simulatedSeconds).toBe(0);
    expect(p.paused).toBe(true);
    expect(p.frame().kind).toBe('authored-start');
  }, 60000);

  it('refuses a non-finite seek', async () => {
    const p = new SolvedPlayback(await solved(), 1);
    expect(() => p.seek(NaN)).toThrow(/non-finite/);
  }, 60000);
});

/**
 * AN UNKNOWN MUST NEVER ARRIVE AS A ZERO. This is the fault this file had: the reset frame set
 * the inductor voltage to 0 "because unknown", which made di/dt zero and any pickup derived
 * from it read exactly 0 V — a confident, wrong number at the one instant a viewer is most
 * likely to be looking.
 */
describe('the reset frame reports what it knows and nothing else', () => {
  it('marks the algebraic quantities unavailable rather than zero', async () => {
    const t = await solved();                       // 10 V source, discharged, at rest
    const p = new SolvedPlayback(t, d.stopSeconds / 3);
    const f = p.frame();
    expect(f.kind).toBe('authored-start');
    if (f.kind !== 'authored-start') throw new Error('unreachable');
    expect(f.inductorVolts).toBeNull();
    expect(f.diDtAmpsPerSecond).toBeNull();
    expect(f.sourceVolts).toBeNull();
    expect(f.afterResistorVolts).toBeNull();
    // The truth at this instant is 10 V across the inductor, so zero would have been WRONG,
    // not merely unknown. The first solved sample shows what it really is.
    p.paused = false; p.advance(1e-6);
    const s = p.frame();
    if (s.kind !== 'solved') throw new Error('expected a solved frame');
    expect(s.inductorVolts).toBeGreaterThan(9);
    expect(s.diDtAmpsPerSecond).toBeGreaterThan(1e5);
  }, 60000);

  it('still reports the authored current, charge and energies exactly', async () => {
    const charged = { ...d, sourceVolts: 0, initialCapacitorVolts: 7.5,
      initialInductorAmps: 0.25, stopSeconds: PERIOD };
    const t = await solved(charged);
    const f = new SolvedPlayback(t, 1).frame();
    if (f.kind !== 'authored-start') throw new Error('unreachable');
    expect(f.capacitorVolts).toBe(7.5);
    expect(f.currentAmps).toBe(0.25);
    expect(f.capacitorJoules).toBeCloseTo(0.5 * C * 7.5 ** 2, 20);
    expect(f.inductorJoules).toBeCloseTo(0.5 * L * 0.25 ** 2, 20);
    // And with a non-zero start, the unknowns are still unknown — not back-filled from a sample.
    expect(f.inductorVolts).toBeNull();
  }, 60000);

  it('steps to an ACTUAL solver sample, not a median-spaced display interval', async () => {
    const t = await solved();
    const p = new SolvedPlayback(t, 1);
    p.stepOne();
    expect([...t.times]).toContain(p.simulatedSeconds);
    const before = p.simulatedSeconds;
    p.stepOne();
    expect([...t.times]).toContain(p.simulatedSeconds);
    expect(p.simulatedSeconds).toBeGreaterThan(before);
    // The grid is irregular, so stepping twice need not cover two median intervals.
    expect(p.frame().kind).toBe('solved');
  }, 60000);
});

describe('an alternating run RESTARTS from rest; a one-shot transient stops', () => {
  const make = async () => {
    const p = new SolvedPlayback(await solved(), 1);
    p.paused = false;
    return p;
  };

  it('stops dead at the horizon by default', async () => {
    const p = await make();
    p.advance(1000);
    expect(p.atHorizon).toBe(true);
    const before = p.frame().timeSeconds;
    p.advance(1000);
    expect(p.frame().timeSeconds).toBe(before);
  });

  it('returns to the start when the run replays, and is never "at horizon"', async () => {
    // A three-wall-second run that ends frozen was the whole of Peter's report. An alternating
    // drive is showing repeating behaviour, so replaying it shows what the circuit keeps doing.
    const p = await make();
    p.replayFromRest = true;
    const span = p.horizonSeconds;
    p.advance(span * 0.75);
    expect(p.frame().timeSeconds).toBeCloseTo(span * 0.75, 12);
    p.advance(span * 0.5);                    // past the end
    expect(p.atHorizon).toBe(false);
    // FROM REST, not wrapped by the remainder. Wrapping would imply the end state and the start
    // state were the same; measured, the capacitor ends these runs several volts away from zero.
    expect(p.simulatedSeconds).toBe(0);
    // The FRAME time is the engine's first sample, not 0 — ngspice never returns t = 0, so
    // asking the trajectory for the instant the cursor is at clamps to the earliest it has.
    expect(p.frame().timeSeconds).toBeLessThanOrEqual(p.source.times[0]);
    expect(p.replays).toBe(1);
  });

  it('counts the replays instead of pretending the run continued', async () => {
    const p = await make();
    p.replayFromRest = true;
    expect(p.replays).toBe(0);
    p.advance(p.horizonSeconds * 1.1);
    p.advance(p.horizonSeconds * 1.1);
    expect(p.replays).toBe(2);
  });

  it('still refuses to invent a sample: the wrapped cursor is inside the solved run', async () => {
    const p = await make();
    p.replayFromRest = true;
    for (let k = 0; k < 20; k++) {
      p.advance(p.horizonSeconds * 0.37);
      const f = p.frame();
      expect(f.timeSeconds).toBeGreaterThanOrEqual(0);
      expect(f.timeSeconds).toBeLessThanOrEqual(p.horizonSeconds);
    }
  });
});

describe('a restart really returns to the authored reset', () => {
  it('shows the AUTHORED start after replaying, not the solver’s first instant', async () => {
    // `advance` sets `started` at the top, so without clearing it the frame at cursor 0 sampled
    // the first solved sample — already moving — instead of the reset the viewer is told it went
    // back to.
    const p = new SolvedPlayback(await solved(), 1);
    p.paused = false;
    p.replayFromRest = true;
    p.advance(p.horizonSeconds * 1.01);
    const f = p.frame();
    expect(p.replays).toBe(1);
    expect(f.kind).toBe('authored-start');
    expect(f.currentAmps).toBe(0);
    expect(f.capacitorVolts).toBe(0);
  });

  it('clears the replay count on a manual restart, as adopt does', async () => {
    const p = new SolvedPlayback(await solved(), 1);
    p.paused = false;
    p.replayFromRest = true;
    // Two SEPARATE passes. One frame that overshoots by more than a whole horizon still counts
    // a single restart, because the viewer saw one — phantom runs nobody watched are not runs.
    p.advance(p.horizonSeconds * 1.01);
    p.advance(p.horizonSeconds * 1.01);
    expect(p.replays).toBe(2);
    p.reset();
    expect(p.replays).toBe(0);
  });
});
