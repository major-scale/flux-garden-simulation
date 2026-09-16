import { describe, it, expect } from 'vitest';
import { buildLampNetlist, validateLamp, gateEdges, gateAtStart, DEFAULT_MOSFET_PART,
  type LampDescription } from './lamp-netlist';
import { toLampTransient, sampleLampAt, type LampTransient } from './lamp-transient';
import type { RawResult } from './grid';

const base: LampDescription = {
  topology: 'lamp', supplyVolts: 12, lampOhms: 24, gateOhms: 1000, mosfet: { ...DEFAULT_MOSFET_PART },
  gate: { kind: 'pwl', points: [{ atSeconds: 0, volts: 0 }, { atSeconds: 10e-6, volts: 0 },
    { atSeconds: 12e-6, volts: 10 }, { atSeconds: 60e-6, volts: 10 }] },
  stopSeconds: 60e-6, stepSeconds: 20e-9,
};

describe('the lamp netlist is generated, never authored', () => {
  it('writes the agreed topology: low-side NMOS, bulk to source, a 0 V source probe, gate through RG', () => {
    const n = buildLampNetlist(base);
    expect(n).toContain('Vdd nd 0 DC 12');
    expect(n).toContain('RLAMP nd d 24');
    expect(n).toContain('M1 d g s s MMOD W=0.01 L=0.000001');
    expect(n).toContain('Vsrc s 0 DC 0');
    expect(n).toContain('RG c g 1000');
    expect(n).toContain('Vg c 0 PWL(0 0 0.00001 0 0.000012 10 0.00006 10)');
    expect(n).toContain('.model MMOD NMOS(LEVEL=1 VTO=2 KP=0.00002 LAMBDA=0.01 TOX=1e-7 CGSO=1e-9 CGDO=1e-9)');
    // NO uic: the run starts from the operating point, so its first sample is t = 0.
    expect(n).toMatch(/\.tran 2e-8 0\.00006 0 2e-8\n/);
    expect(n).not.toContain('uic');
  });
  it('writes a sine programme in ngspice argument order', () => {
    const n = buildLampNetlist({ ...base, gate: { kind: 'sine', offsetVolts: 5, amplitudeVolts: 5, frequencyHz: 33333 } });
    expect(n).toContain('Vg c 0 SIN(5 5 33333)');
  });
  it('refuses a programme that does not state its value at 0 s, or runs backwards', () => {
    expect(() => validateLamp({ ...base, gate: { kind: 'pwl', points: [{ atSeconds: 1e-6, volts: 0 }, { atSeconds: 2e-6, volts: 1 }] } }))
      .toThrow(/value at 0 s/);
    expect(() => validateLamp({ ...base, gate: { kind: 'pwl', points: [{ atSeconds: 0, volts: 0 }, { atSeconds: 2e-6, volts: 1 }, { atSeconds: 1e-6, volts: 1 }] } }))
      .toThrow(/strictly increasing/);
  });
  it('refuses parameters outside their stated ranges', () => {
    expect(() => validateLamp({ ...base, supplyVolts: -1 })).toThrow(/Supply voltage/);
    expect(() => validateLamp({ ...base, lampOhms: 0 })).toThrow(/Lamp resistance/);
    expect(() => validateLamp({ ...base, mosfet: { ...base.mosfet, kp: 0 } })).toThrow(/Transconductance/);
    expect(() => validateLamp({ ...base, stepSeconds: 1e-12 })).toThrow(/output points/);
    expect(() => validateLamp({ ...base, gate: { kind: 'sine', offsetVolts: 5, amplitudeVolts: 5, frequencyHz: 1e7 } }))
      .toThrow(/Gate sine frequency/);
  });
  it('lists the finite edges of a programme and its start value', () => {
    const edges = gateEdges(base.gate);
    expect(edges.length).toBe(1);
    expect(edges[0].atSeconds).toBe(10e-6);
    expect(edges[0].edgeSeconds).toBeCloseTo(2e-6, 18);   // 12e-6 − 10e-6 is not exactly 2e-6
    expect(gateAtStart(base.gate)).toBe(0);
    expect(gateAtStart({ kind: 'sine', offsetVolts: 5, amplitudeVolts: 5, frequencyHz: 1 })).toBe(5);
  });
});

const raw = (n = 5, t0 = 0): RawResult => {
  const times = Array.from({ length: n }, (_, k) => t0 + ((base.stopSeconds - t0) * k) / (n - 1));
  const mk = (name: string, f: (k: number) => number) => ({ name, values: times.map((_, k) => f(k)) });
  return {
    variableNames: ['time', 'v(nd)', 'v(d)', 'v(g)', 'v(c)', 'i(vdd)', 'i(vg)', 'i(vsrc)'],
    data: [{ name: 'time', values: times }, mk('v(nd)', () => 12), mk('v(d)', (k) => 12 - k),
      mk('v(g)', (k) => k), mk('v(c)', (k) => k + 0.001), mk('i(vdd)', (k) => -k * 0.1),
      mk('i(vg)', () => -1e-6), mk('i(vsrc)', (k) => k * 0.1 + 1e-6)],
  };
};

describe('the lamp transient states every current INTO the terminal it names', () => {
  it('negates the supply and gate probe currents and keeps the source probe as-is', () => {
    const t = toLampTransient(raw(), base, 'test');
    expect(t.drainAmps[2]).toBeCloseTo(0.2, 15);        // −i(vdd)
    expect(t.gateAmps[2]).toBeCloseTo(1e-6, 18);        // −i(vg): into the gate
    expect(t.sourceAmps[2]).toBeCloseTo(0.2 + 1e-6, 15);
    // KCL for the whole device: in at drain + in at gate = out at source.
    expect(t.drainAmps[2] + t.gateAmps[2] - t.sourceAmps[2]).toBeCloseTo(0, 15);
  });
  it('requires the first sample AT zero — the operating point — not merely near it', () => {
    expect(() => toLampTransient(raw(5, 1e-9), base, 'test')).toThrow(/exactly 0 s/);
  });
  it('flags a sample inside the programmed edge and still interpolates there', () => {
    const t: LampTransient = toLampTransient(raw(61), base, 'test');   // 1 µs grid
    const s = sampleLampAt(t, 11e-6);
    expect(s.onEdge).toBe(true);
    expect(sampleLampAt(t, 30e-6).onEdge).toBe(false);
    expect(sampleLampAt(t, 30.5e-6).gateVolts).toBeCloseTo(30.5, 12);
  });
});
