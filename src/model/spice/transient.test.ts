import { describe, it, expect } from 'vitest';
import { buildNetlist, validateCircuit, assertAscii, type CircuitDescription } from './netlist';
import { toTransient, sampleAt, type RawResult } from './transient';

const L = 1.8852603987e-5, C = 8.8541878128e-11;
const base: CircuitDescription = {
  sourceVolts: 10, resistanceOhms: 297, inductanceHenries: L, capacitanceFarads: C,
  initialCapacitorVolts: 0, initialInductorAmps: 0, stopSeconds: 1e-6, stepSeconds: 1e-9,
};
const good = (n = 5): RawResult => ({
  variableNames: ['time', 'i(l1)', 'v(n1)', 'v(n2)', 'v(n3)'],
  numPoints: n,
  data: [
    { name: 'time', values: Array.from({ length: n }, (_, k) => (k * base.stopSeconds) / (n - 1)) },
    { name: 'i(l1)', values: Array.from({ length: n }, (_, k) => k * 1e-3) },
    { name: 'v(n1)', values: Array.from({ length: n }, () => 10) },
    { name: 'v(n2)', values: Array.from({ length: n }, (_, k) => 10 - k) },
    { name: 'v(n3)', values: Array.from({ length: n }, (_, k) => k) },
  ],
});

describe('a solved transient is validated, never trusted', () => {
  it('accepts a well-formed result', () => {
    const t = toTransient(good(), base, 'test');
    expect(t.times.length).toBe(5);
    expect(t.stopSeconds).toBeCloseTo(base.stopSeconds, 15);
  });

  it('REFUSES the shape a failed solve actually returns', () => {
    // Measured from the engine itself: a malformed netlist and an unknown device model both
    // RESOLVE, with one point and no variables. Trusting resolution would accept these.
    expect(() => toTransient({ numPoints: 1, variableNames: [], data: [] }, base, 'test'))
      .toThrow(/no variables/);
    // A one-point result WITH every channel present: the point count is the only thing wrong,
    // so this reaches the trajectory check rather than tripping the missing-channel one first.
    const onePoint = good(2);
    for (const d of onePoint.data!) d.values = [0];
    expect(() => toTransient(onePoint, base, 'test')).toThrow(/1 point/);
  });

  it('refuses a missing channel rather than substituting one', () => {
    const r = good();
    r.data = r.data!.filter((d) => d.name !== 'i(l1)');
    r.variableNames = r.variableNames!.filter((n) => n !== 'i(l1)');
    expect(() => toTransient(r, base, 'test')).toThrow(/did not return i\(l1\)/);
  });

  it('refuses non-monotonic or non-finite time', () => {
    const r = good();
    (r.data![0].values as number[])[3] = 0;
    expect(() => toTransient(r, base, 'test')).toThrow(/not strictly increasing/);
    const r2 = good();
    (r2.data![0].values as number[])[2] = NaN;
    expect(() => toTransient(r2, base, 'test')).toThrow(/Non-finite time/);
  });

  it('refuses non-finite values in any channel', () => {
    const r = good();
    (r.data![1].values as number[])[2] = Infinity;
    expect(() => toTransient(r, base, 'test')).toThrow(/Non-finite i\(l1\)/);
  });

  it('refuses a run that stopped short, instead of presenting it as complete', () => {
    const r = good();
    r.data![0].values = (r.data![0].values as number[]).map((v) => v * 0.5);
    expect(() => toTransient(r, base, 'test')).toThrow(/short of the requested/);
  });

  it('refuses a channel whose length disagrees with time', () => {
    const r = good();
    (r.data![1].values as number[]).push(1);
    expect(() => toTransient(r, base, 'test')).toThrow(/against 5 times/);
  });
});

describe('reading the transient', () => {
  const t = toTransient(good(9), base, 'test');
  it('derives di/dt from the inductor terminals, not from a topology formula', () => {
    const s = sampleAt(t, base.stopSeconds / 2);
    expect(s.diDtAmpsPerSecond).toBeCloseTo(s.inductorVolts / L, 6);
  });
  it('computes stored energies from the sample alone', () => {
    const s = sampleAt(t, base.stopSeconds / 2);
    expect(s.capacitorJoules).toBeCloseTo(0.5 * C * s.capacitorVolts ** 2, 20);
    expect(s.inductorJoules).toBeCloseTo(0.5 * L * s.currentAmps ** 2, 20);
  });
  it('says when a request was clamped to the horizon rather than silently clamping', () => {
    expect(sampleAt(t, base.stopSeconds * 2).clampedToHorizon).toBe(true);
    expect(sampleAt(t, base.stopSeconds / 2).clampedToHorizon).toBe(false);
  });
  it('flags a sample inside a scheduled ramp, and still interpolates there', () => {
    // Corrected contract. Interpolating across a FINITE ramp is legitimate — the source really
    // is moving smoothly between the PWL corners — so this no longer snaps to a sample. The
    // flag exists so a caller knows it is reading the fastest-turning part of the trajectory.
    const withEvent = toTransient(good(9),
      { ...base, event: { atSeconds: 5e-7, toVolts: 0, edgeSeconds: 1e-9 } }, 'test');
    const mid = sampleAt(withEvent, 5e-7 + 5e-10);
    expect(mid.onEventEdge).toBe(true);
    expect(mid.requestedTimeSeconds).toBe(5e-7 + 5e-10);
    expect(mid.timeSeconds).toBeCloseTo(mid.requestedTimeSeconds, 15);
  });

  it('surfaces requested and represented time at the ramp corners', () => {
    const ev = { atSeconds: 5e-7, toVolts: 0, edgeSeconds: 1e-9 };
    const withEvent = toTransient(good(9), { ...base, event: ev }, 'test');
    for (const [label, at] of [['start', ev.atSeconds], ['end', ev.atSeconds + ev.edgeSeconds]] as const) {
      const s = sampleAt(withEvent, at);
      expect(s.requestedTimeSeconds, label).toBe(at);
      expect(Math.abs(s.timeSeconds - at)).toBeLessThan(1e-15);
    }
  });

  it('refuses a non-finite sample time instead of searching with it', () => {
    const t = toTransient(good(9), base, 'test');
    for (const bad of [NaN, Infinity, -Infinity])
      expect(() => sampleAt(t, bad)).toThrow(/non-finite time/);
  });

  it('refuses a run that starts late, or before zero', () => {
    const late = good(5);
    late.data![0].values = (late.data![0].values as number[]).map((v) => v + base.stopSeconds * 0.2);
    expect(() => toTransient(late, base, 'test')).toThrow(/into a run that should begin at 0/);
    const early = good(5);
    early.data![0].values = (early.data![0].values as number[]).map((v) => v - 1);
    expect(() => toTransient(early, base, 'test')).toThrow(/before the start of the run/);
  });

  it('refuses a tail that is merely close, not reached', () => {
    const short = good(5);
    short.data![0].values = (short.data![0].values as number[]).map((v) => v * 0.99);
    expect(() => toTransient(short, base, 'test')).toThrow(/short of the requested/);
  });

  // THE ENGINE DOES NOT LAND ON tstop EXACTLY. Measured over nine coil geometries, the final
  // sample sits 0, +1, +2 or -1 ULP from the request, with the sign varying by geometry — so an
  // exact comparison faulted four of eight supported coils on rounding alone, while every one
  // of those runs had returned all 1211 points. These pin the tolerance from BOTH sides.
  const shiftLast = (r: RawResult, by: number) => {
    const v = r.data![0].values as number[];
    v[v.length - 1] = base.stopSeconds + by;
    return r;
  };
  it('accepts a horizon missed by ULPs, which is what the engine actually returns', () => {
    const ulp = base.stopSeconds * Number.EPSILON;   // ~2.2e-22 s at a 1 us horizon
    for (const by of [0, -ulp, -2 * ulp, ulp, 2 * ulp]) {
      const t = toTransient(shiftLast(good(5), by), base, 'test');
      // The horizon reported is the one REACHED, never the one requested.
      expect(t.stopSeconds).toBe(base.stopSeconds + by);
      expect(t.requestedStopSeconds).toBe(base.stopSeconds);
    }
  });
  // THE TOLERANCE IS ULP-SCALE AND MUST STAY THERE. An earlier fix allowed half an output step
  // on the argument that a real early stop must miss a whole output point — false, because
  // ngspice returns an adaptive grid, so a run that failed can stop a small fraction of a step
  // short. These pin a quarter-step miss as a FAULT in both directions: it sits comfortably
  // inside that discarded half-step gate and roughly 1e11 ULP outside this one.
  it('still refuses a quarter-step miss, which a step-scaled tolerance would have swallowed', () => {
    const q = 0.25 * base.stepSeconds;
    expect(q).toBeGreaterThan(1e10 * 8 * Number.EPSILON * base.stopSeconds);
    expect(() => toTransient(shiftLast(good(5), -q), base, 'test'))
      .toThrow(/short of the requested/);
    expect(() => toTransient(shiftLast(good(5), q), base, 'test'))
      .toThrow(/past the requested/);
  });
  it('draws the line at 8 ULP, the measured engine budget with headroom', () => {
    const ulp = base.stopSeconds * Number.EPSILON;
    expect(() => toTransient(shiftLast(good(5), -7 * ulp), base, 'test')).not.toThrow();
    expect(() => toTransient(shiftLast(good(5), 7 * ulp), base, 'test')).not.toThrow();
    expect(() => toTransient(shiftLast(good(5), -12 * ulp), base, 'test'))
      .toThrow(/ULP, tolerance 8/);
    expect(() => toTransient(shiftLast(good(5), 12 * ulp), base, 'test'))
      .toThrow(/ULP, tolerance 8/);
  });
});

describe('the netlist is generated, never authored', () => {
  it('places the diode by TERMINAL ORDER, which is what orientation is', () => {
    const d = { is: 1e-14, n: 1, rs: 0.1, cjo: 0, tt: 0, bv: 75, ibv: 1e-5 };
    const fwd = buildNetlist({ ...base, diode: { ...d, orientation: 'forward' } });
    const rev = buildNetlist({ ...base, diode: { ...d, orientation: 'reverse' } });
    expect(fwd).toContain('D1 na n2 DMOD');
    expect(rev).toContain('D1 n2 na DMOD');
  });
  it('omits the diode entirely when bypassed, rather than modelling a short', () => {
    const n = buildNetlist(base);
    expect(n).not.toContain('D1');
    expect(n).not.toContain('.model');
    expect(n).toContain('R1 n1 n2');
  });
  it('writes a finite PWL edge for a scheduled event, not an ideal step', () => {
    const n = buildNetlist({ ...base, event: { atSeconds: 5e-7, toVolts: 0, edgeSeconds: 1e-9 } });
    // The end corner is a floating-point SUM, so it serialises as 5.009999999999999e-7 rather
    // than the tidy 5.01e-7 I first assumed. Assert the structure, not a number I guessed.
    expect(n).toMatch(/PWL\(0 10 5e-7 10 5\.0099999999999\d*e-7 0\)/);
  });
  it('refuses a horizon that would need more points than the declared ceiling', () => {
    expect(() => validateCircuit({ ...base, stopSeconds: 1, stepSeconds: 1e-9 }))
      .toThrow(/above the 200000 limit/);
  });
  it('refuses parameters outside their stated ranges', () => {
    expect(() => validateCircuit({ ...base, resistanceOhms: 0 })).toThrow(/Resistance/);
    expect(() => validateCircuit({ ...base, inductanceHenries: NaN })).toThrow(/Inductance/);
  });
});

describe('non-ASCII in a netlist', () => {
  it('is refused before it can reach the solver', () => {
    // Not a style rule. Measured: this engine solves the identical deck in 29 ms with an ASCII
    // title and never returns at all with one em dash in it. It hangs rather than erroring.
    expect(() => assertAscii('* fine\nV1 1 0 DC 1\n.end\n')).not.toThrow();
    expect(() => assertAscii('* Flux Garden — dash\nV1 1 0 DC 1\n.end\n'))
      .toThrow(/non-ASCII.*U\+2014.*line 1/s);
    expect(() => assertAscii('* ok\nV1 1 0 DC 1\t\n.end\n')).toThrow(/U\+0009/);
  });

  it('the generator itself never produces one', () => {
    const n = buildNetlist({ ...base, event: { atSeconds: 5e-7, toVolts: 0, edgeSeconds: 1e-9 },
      diode: { is: 1e-14, n: 1, rs: 0.1, cjo: 0, tt: 0, bv: 75, ibv: 1e-5, orientation: 'forward' } });
    expect(() => assertAscii(n)).not.toThrow();
    expect([...n].every((ch) => ch.charCodeAt(0) <= 126)).toBe(true);
  });
});

describe('scope limits that are enforced, not merely documented', () => {
  it('refuses a diode with junction charge, which this slice does not verify', () => {
    const d = { is: 1e-14, n: 1, rs: 0.1, bv: 75, ibv: 1e-5, orientation: 'forward' as const };
    expect(() => validateCircuit({ ...base, diode: { ...d, cjo: 2e-12, tt: 0 } }))
      .toThrow(/quasi-static diode only/);
    expect(() => validateCircuit({ ...base, diode: { ...d, cjo: 0, tt: 1e-9 } }))
      .toThrow(/quasi-static diode only/);
    expect(() => validateCircuit({ ...base, diode: { ...d, cjo: 0, tt: 0 } })).not.toThrow();
  });

  it('refuses a source ramp that would still be moving at the horizon', () => {
    expect(() => validateCircuit({ ...base,
      event: { atSeconds: base.stopSeconds * 0.99, toVolts: 0, edgeSeconds: base.stopSeconds * 0.5 } }))
      .toThrow(/past the .* horizon/);
  });

  it('carries an initial inductor current, so a start state can be described at all', () => {
    expect(() => validateCircuit({ ...base, initialInductorAmps: 0.5 })).not.toThrow();
    expect(() => validateCircuit({ ...base, initialInductorAmps: NaN }))
      .toThrow(/Initial inductor current/);
  });
});

describe('the supported domain is refused up front, not discovered as a solver failure', () => {
  const PART = { is: 1e-14, n: 1, rs: 0.1, cjo: 0, tt: 0, bv: 75, ibv: 1e-5 };

  it('refuses a REVERSE diode with stored energy, in either store and either sign', () => {
    // The three configurations a nine-scenario matrix could not complete: the engine either
    // failed to allocate or drove its timestep to 1e-21. Refused as a TESTED LIMIT — the message
    // must not explain why, because the first version's explanation was wrong physics inferred
    // from an allocation failure.
    for (const over of [{ initialCapacitorVolts: 8 }, { initialCapacitorVolts: -6 },
                        { initialInductorAmps: 0.02 }, { initialInductorAmps: -0.02 }])
      expect(() => validateCircuit({ ...base, ...over,
        diode: { ...PART, orientation: 'reverse' } }))
        .toThrow(/Not supported: a reverse-placed diode together with stored initial energy/);
  });

  it('allows the SAME stored energy forward, where all nine scenarios passed', () => {
    // The boundary is the orientation, not the stored energy: forward conducts, so the energy has
    // somewhere to go. Refusing both would constrain the domain further than the measurement does.
    for (const over of [{ initialCapacitorVolts: 8 }, { initialCapacitorVolts: -6 },
                        { initialInductorAmps: 0.02 }])
      expect(() => validateCircuit({ ...base, ...over,
        diode: { ...PART, orientation: 'forward' } })).not.toThrow();
  });

  it('allows a reverse diode started from rest, which is six of the nine', () => {
    expect(() => validateCircuit({ ...base, sourceVolts: 40,
      diode: { ...PART, orientation: 'reverse' } })).not.toThrow();
  });

  it('does not constrain a circuit with NO diode, whose domain this says nothing about', () => {
    expect(() => validateCircuit({ ...base, initialCapacitorVolts: 8,
      initialInductorAmps: 0.02 })).not.toThrow();
  });
});
