import { describe, it, expect } from 'vitest';
import { diodeState, shockleyCurrent, diodeExcursion, THERMAL_VOLTS } from './diode';
import type { DiodeSpec } from './spice/netlist';
import type { Snapshot } from './spice/transient';

const D: DiodeSpec = { is: 1e-14, n: 1, rs: 0.1, cjo: 0, tt: 0, bv: 75, ibv: 1e-5,
  orientation: 'forward' };

/** A snapshot with the two diode nodes set explicitly; everything else is scenery. */
const snap = (na: number, n2: number, i: number): Snapshot => ({
  timeSeconds: 1e-7, currentAmps: i, capacitorVolts: 3, sourceVolts: 10,
  afterResistorVolts: na, inductorInVolts: n2, inductorVolts: n2 - 3,
  diDtAmpsPerSecond: 0, capacitorJoules: 0, inductorJoules: 0,
});

describe('the diode is READ from the solved snapshot, not modelled in the render path', () => {
  it('states every quantity anode-to-cathode, so orientation is not silently encoded', () => {
    // The SAME solved sample, read through both placements. Forward: anode is na, and the loop
    // current runs anode-to-cathode. Reverse: the anode is n2, so both signs flip together.
    const s = snap(9.3, 8.6, 0.02);
    const f = diodeState(s, 'forward');
    expect(f.terminalVolts).toBeCloseTo(0.7, 12);
    expect(f.terminalAmps).toBe(0.02);
    const r = diodeState(s, 'reverse');
    expect(r.terminalVolts).toBeCloseTo(-0.7, 12);
    expect(r.terminalAmps).toBe(-0.02);
    // Power is orientation-INDEPENDENT: it is the same device dissipating the same watts.
    expect(f.watts).toBeCloseTo(r.watts, 15);
  });

  it('gives exactly zero across a bypassed diode, because the nodes are the same node', () => {
    // toTransient aliases afterResistorVolts to inductorInVolts when no diode is in the netlist,
    // so the bypass needs no special case anywhere — it falls out of the topology.
    const s = snap(8.6, 8.6, 0.02);
    for (const o of ['forward', 'reverse'] as const) {
      expect(diodeState(s, o).terminalVolts).toBe(0);
      expect(diodeState(s, o).watts).toBe(0);
    }
  });

  it('reports forward bias from the VOLTAGE alone, without claiming the current matters', () => {
    // A diode at +0.2 V is forward-biased and carrying about 24 pA. Treating "biased" and
    // "conducting" as the same word is how a renderer ends up lighting a dark component.
    const s = diodeState(snap(8.8, 8.6, 2.4e-11), 'forward');
    expect(s.forwardBiased).toBe(true);
    expect(s.terminalAmps).toBeLessThan(1e-9);
    expect(diodeState(snap(8.4, 8.6, -1e-14), 'forward').forwardBiased).toBe(false);
  });

  it('never reports a diode generating power at a physical operating point', () => {
    // Both quadrants a real quasi-static diode occupies: forward conduction, and reverse
    // leakage. v and i share a sign in each, so the product cannot be negative.
    for (const [na, n2, i] of [[9.3, 8.6, 0.02], [8.0, 8.6, -1e-14]] as const)
      expect(diodeState(snap(na, n2, i), 'forward').watts).toBeGreaterThanOrEqual(0);
  });
});

describe('the device law is a PREDICTION, kept out of the render path', () => {
  it('is the plain Shockley form when there is no series resistance', () => {
    const ideal = { ...D, rs: 0 };
    for (const v of [-0.3, 0, 0.4, 0.65]) {
      const expected = ideal.is * Math.expm1(v / (ideal.n * THERMAL_VOLTS));
      expect(shockleyCurrent(v, ideal)).toBeCloseTo(expected, 20);
    }
  });

  it('SOLVES the implicit relation when RS is present, rather than ignoring the drop', () => {
    // With RS the terminal voltage is v_j + i·RS, so the answer is not the ideal one. Checked by
    // reconstructing the terminal voltage from the returned current and asking whether it comes
    // back — a residual test, not a comparison against a second implementation of my own.
    for (const v of [0.5, 0.7, 0.9]) {
      const i = shockleyCurrent(v, D);
      const vj = D.n * THERMAL_VOLTS * Math.log1p(i / D.is);
      expect(vj + i * D.rs).toBeCloseTo(v, 9);
    }
    // And it must actually DIFFER from the ideal form, or the test proves nothing about RS —
    // but only where RS can bite. At 0.7 V the current is ~5.5 mA and the drop across 0.1 ohm
    // is 0.55 mV, a 2% effect; my first version of this assertion demanded a factor of two
    // there, which was a number I wrote without doing the arithmetic. At 0.9 V the ideal form
    // asks for ~13 A and RS is the only thing holding it back.
    expect(shockleyCurrent(0.7, D)).toBeCloseTo(0.978 * shockleyCurrent(0.7, { ...D, rs: 0 }), 4);
    expect(shockleyCurrent(0.9, D)).toBeLessThan(0.2 * shockleyCurrent(0.9, { ...D, rs: 0 }));
  });

  it('refuses breakdown and non-finite input instead of extrapolating through them', () => {
    expect(() => shockleyCurrent(-75, D)).toThrow(/breakdown/);
    expect(() => shockleyCurrent(-100, D)).toThrow(/breakdown/);
    expect(() => shockleyCurrent(NaN, D)).toThrow(/not finite/);
  });
});

describe('the supported domain is checked against the TRAJECTORY, not the inputs', () => {
  // The run matters, not the starting values: an inductor kick can drive the diode far past the
  // source voltage, so "10 V source, 75 V part" does not put a run inside the envelope. The
  // earlier claim that breakdown was "refused" was true only of shockleyCurrent, which runs in
  // tests — nothing looked at the trajectory at all.
  const run = (pairs: [number, number][]) => pairs.map(([na, n2], k) =>
    ({ timeSeconds: k * 1e-9, afterResistorVolts: na, inductorInVolts: n2, currentAmps: 1e-3 }));

  it('finds an excursion that only happens mid-run, well after the start', () => {
    const x = diodeExcursion(run([[10, 10], [10, 9.4], [10, 90], [10, 12]]), 'forward', 75);
    expect(x.enteredBreakdown).toBe(true);
    expect(x.breakdownAtSeconds).toBe(2e-9);         // the third sample, not the first
    expect(x.minTerminalVolts).toBe(-80);
    expect(x.maxTerminalVolts).toBeCloseTo(0.6, 12);
  });

  it('passes a run that stays inside, including one that goes deep but not past −BV', () => {
    const x = diodeExcursion(run([[10, 10], [10, 80], [10, 9.4]]), 'forward', 75);
    expect(x.enteredBreakdown).toBe(false);          // −70 V is inside a 75 V part
    expect(x.breakdownAtSeconds).toBeNull();
  });

  it('reads the excursion through the ORIENTATION, so a reverse part is judged correctly', () => {
    // The same node voltages: forward this is −80 V and out of domain; reverse it is +80 V, which
    // is a forward-biased diode, not a breakdown. Reading without the orientation would refuse
    // a perfectly ordinary run.
    const samples = run([[10, 90]]);
    expect(diodeExcursion(samples, 'forward', 75).enteredBreakdown).toBe(true);
    expect(diodeExcursion(samples, 'reverse', 75).enteredBreakdown).toBe(false);
    expect(diodeExcursion(samples, 'reverse', 75).maxTerminalVolts).toBe(80);
  });

  it('reports the peak current as a magnitude through the device', () => {
    const samples = [
      { timeSeconds: 0, afterResistorVolts: 10, inductorInVolts: 9.4, currentAmps: 2e-3 },
      { timeSeconds: 1e-9, afterResistorVolts: 10, inductorInVolts: 9.4, currentAmps: -5e-3 },
    ];
    expect(diodeExcursion(samples, 'forward', 75).peakAmps).toBe(5e-3);
  });
});
