import { describe, it, expect } from 'vitest';
import { ldrOhms, ntcOhms, comparatorThresholdVolts, buildSensorsNetlist, validateSensors, GL5528_SELECTED, NTC_10K_B3950, DEFAULT_COMPARATOR } from './spice/sensors-netlist';
import { SENSORS_PRESETS } from './sensors-presets';
import { sensorsReading, sensorsDomain } from './sensors';
import { encodeSensorsDoc, decodeSensorsDoc } from './sensors-doc';
import type { SensorsSnapshot, SensorsTransient } from './spice/sensors-transient';

describe('the sensor laws, as implemented (not as any real part behaves)', () => {
  it('LDR: R10 at 10 lux, the γ slope between 10 and 100 lux, and the dark clamp outside the demonstrated range', () => {
    const s = GL5528_SELECTED;
    expect(ldrOhms(10, s)).toBeCloseTo(12000, 9);
    expect(Math.log10(ldrOhms(10, s) / ldrOhms(100, s))).toBeCloseTo(0.7, 12);   // the datasheet's own definition of γ
    expect(ldrOhms(1, s)).toBeCloseTo(12000 * Math.pow(10, 0.7), 6);            // 60.1 kΩ: still far below the 1 MΩ clamp
    expect(ldrOhms(1e-6, s)).toBe(1e6);                                           // the clamp engages only far outside the domain
  });
  it('NTC: R0 at T0 and tabulated beta-law values — implementation checks, not thermistor accuracy', () => {
    const s = NTC_10K_B3950;
    expect(ntcOhms(25, s)).toBeCloseTo(10000, 6);
    expect(ntcOhms(45, s)).toBeCloseTo(10000 * Math.exp(3950 * (1 / 318.15 - 1 / 298.15)), 6);   // ≈ 4348 Ω
    expect(ntcOhms(0, s)).toBeGreaterThan(30000);
  });
  it('the comparator threshold follows the gain and the switch model: ±10 µV at G = 1e4', () => {
    expect(comparatorThresholdVolts(DEFAULT_COMPARATOR)).toBeCloseTo(1e-5, 15);
  });
});

describe('the sensing netlist', () => {
  it('composes the LDR bench with the environment as a deck node and the sensor as a behavioural resistor of it', () => {
    const n = buildSensorsNetlist(SENSORS_PRESETS[0].build());
    expect(n).toContain('Venv env 0 PWL(0 100 0.2 100 1.2 2 2 2)');
    expect(n).toContain("Rs vin 0 r = 'min(1000000, 12000*pow(max(v(env),1e-9)/10, -0.7))'");
    expect(n).toContain("Bcu c_ctl 0 V = 'max(0, min(1, 0.5 + 10000*(v(vin) - v(vref))))'");
    expect(n).toContain("Bcd c_ctln 0 V = '1 - v(c_ctl)'");
    expect(n).toContain('Sch c_vp c_op c_ctl 0 SWCH'); expect(n).toContain('Scl c_op 0 c_ctln 0 SWCL');
    expect(n).toContain('Vcpc vcc c_vp DC 0'); expect(n).toContain('Routc c_op c_o 50');
    // Electronics v1 (E4): the leak sits inside a 0 V output probe, so the output-terminal current is a solver output. Same node electrically.
    expect(n).toMatch(/^Rleakc c_o 0 /m); expect(n).toContain('Vcoc c_o out DC 0');
  });
  it('puts the NTC in the UPPER leg', () => {
    const n = buildSensorsNetlist(SENSORS_PRESETS[2].build());
    expect(n).toContain("Rs vd vin r = '10000*exp(3950*(1/(v(env)+273.15) - 1/298.15))'");
    expect(n).toContain('Rfix vin 0 10000');
  });
  it('refuses an environment outside the declared domain, and an LED that could exceed its maximum', () => {
    const c = SENSORS_PRESETS[0].build();
    expect(() => validateSensors({ ...c, environment: [{ atSeconds: 0, value: 100 }, { atSeconds: 1, value: 0.5 }] })).toThrow(/outside the LDR's declared domain 1…100 lux/);
    expect(() => validateSensors({ ...c, seriesOhms: 20 })).toThrow(/above its 30 mA maximum/);
  });
});

const snap = (o: Partial<SensorsSnapshot>): SensorsSnapshot => ({ timeSeconds: 1.5, environment: 2, supplyVolts: 5, vinVolts: 3.1, vrefVolts: 2.5, opVolts: 4.5, outVolts: 4.47,
  ledAnodeVolts: 2.1, controlVolts: 1, supplyAmps: 0.0116, dividerAmps: 1e-4, refInAmps: 5e-4, outStageAmps: 0.0105, ledAmps: 0.0105, high: true, sensorOhmsSolved: 31000, ...o } as SensorsSnapshot);

describe('the reading and the domain', () => {
  it('shows the law and the solved resistance side by side, and knows when it is inside the band', () => {
    const c = SENSORS_PRESETS[0].build();
    const r = sensorsReading(snap({}), c);
    expect(r.sensorOhmsLaw).toBeCloseTo(ldrOhms(2, GL5528_SELECTED), 6);
    expect(r.insideBand).toBe(false); expect(r.high).toBe(true);
    expect(sensorsReading(snap({ vinVolts: 2.500005 }), c).insideBand).toBe(true);
  });
  it('refuses a run that STARTS inside the comparator band, and reports crossings', () => {
    const c = SENSORS_PRESETS[0].build(), n = 6, z = () => new Float64Array(n);
    const t: SensorsTransient = { topology: 'sensors', times: Float64Array.from([0, 1, 2, 3, 4, 5]), environment: z(), supplyVolts: z(), vinVolts: Float64Array.from([2.500004, 2.6, 2.7, 2.8, 2.9, 3]),
      vrefVolts: new Float64Array(n).fill(2.5), opVolts: z(), outVolts: z(), ledAnodeVolts: z(), controlVolts: z(), supplyAmps: z(), dividerAmps: z(), refInAmps: z(), outStageAmps: z(),
      ledAmps: z(), high: Uint8Array.from([0, 1, 1, 1, 1, 1]), description: c, stopSeconds: 5, requestedStopSeconds: 5, requestedStepSeconds: 1, actualStepSeconds: { min: 1, median: 1, max: 1 }, edges: [], engine: 'test' };
    expect(sensorsDomain(t).reason).toMatch(/inside the comparator's ±10 µV band/);
    t.vinVolts[0] = 2.4;
    const d = sensorsDomain(t); expect(d.ok).toBe(true); expect(d.crossings).toEqual([1]);
  });
  it('documents round-trip and refuse other formats', () => {
    for (const p of SENSORS_PRESETS) { const c = p.build(); expect(decodeSensorsDoc(encodeSensorsDoc(c))).toEqual(c); }
    expect(() => decodeSensorsDoc(JSON.stringify({ format: 'flux-controls-1' }))).toThrow(/Not a sensors document/);
  });
});
