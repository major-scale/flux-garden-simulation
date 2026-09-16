import { describe, it, expect } from 'vitest';
import { RlcExperiment } from './rlc';
import { flowExplanation } from '../ui/rc-flow';

/**
 * These pin what the READOUT CLAIMS, not only what the model does. Two earlier versions of
 * this text were false — "voltages nearly equal" (RC reasoning in an RLC loop) and "the
 * inductor is reversing it" (reversal inferred from a ratio that does not imply it) — and a
 * test of the model alone would have caught neither.
 */
const C = 8.8541878128e-11, L = 1, Vs = 10;
const R = 0.3 * 2 * Math.sqrt(L / C);            // zeta = 0.3
const h = 1e-8;

function run(steps: number) {
  const x = new RlcExperiment({ voltage: Vs, resistance: R, capacitance: C, inductance: L,
    initialVoltage: 0, initialCurrent: 0 }, h);
  const trace = [];
  for (let n = 1; n <= steps; n++) {
    x.step();
    const driving = x.sourceVoltage - x.voltage;
    trace.push({ t: n * h, i: x.current, v: x.voltage, driving,
      didt: (driving - x.current * x.resistance) / L });
  }
  return { trace, full: x.bounds().current };
}

describe('the small-current readout', () => {
  const { trace, full } = run(4000);
  const say = (p: typeof trace[number]) => flowExplanation(p.i, p.driving, p.didt, full, Vs);

  it('never claims the voltages are nearly equal when they are not', () => {
    for (const p of trace) {
      const s = say(p);
      if (s.includes('little voltage difference')) expect(Math.abs(p.driving)).toBeLessThan(0.02 * Vs);
    }
  });

  it('at the turning point reports the real difference, and does not call it settled', () => {
    const turn = trace.filter(p => Math.abs(p.driving) > 1)
      .reduce((a, b) => Math.abs(b.i) < Math.abs(a.i) ? b : a);
    const s = say(turn);
    expect(Math.abs(turn.i)).toBeLessThan(0.1 * full);     // the old RC test would have fired
    expect(s).toContain('Small current');
    expect(s).not.toContain('nearly equal');
    expect(s).not.toContain('little voltage difference');
  });

  it('does not call the first rise a reversal: small, positive and INCREASING current', () => {
    const early = trace.find(p => p.i > 0 && Math.abs(p.i) < 0.1 * full && p.didt > 0)!;
    expect(early).toBeDefined();
    expect(say(early)).toContain('current rising');        // the wording I had said 'reversing'
  });

  it('says nothing at all once the current is not small', () => {
    const big = trace.find(p => Math.abs(p.i) > 0.5 * full)!;
    expect(say(big)).toBe('');
  });
});
