/**
 * THE TRIAL COMPOSITION, PLAYED: the page's reader against the same WASM solve the kit runs. Nothing here
 * re-checks the frozen 18 (the kit does); this checks what the PAGE adds — θ, the decision, the region,
 * the port balance — and that the generic composition path refuses what it should.
 */
import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { FAN_COMPOSITION, fanParts, toFanTransient, sampleFanAt, fanReading, fanEnergy, fanDomain, gateCurrentSeries } from './fan';
import { prepareComposition, toCompositionTransient } from './spice/composition-transient';
import type { Composition } from './conformance/composition';

async function solve(c: Composition) {
  const structure = prepareComposition(c);
  const sim = new Simulation(); await sim.start(); sim.setNetList(structure.netlist);
  return toFanTransient(toCompositionTransient(await sim.runSim() as never, c, structure, 'wasm-test'));
}
describe('the trial composition on the page path', () => {
  it('resolves its parts by name and kind, and refuses a renamed one', () => {
    const P = fanParts(); expect(P.motor.motor.kVsPerRad).toBe(0.3); expect(P.ntc.spec.betaKelvin).toBe(3950); expect(P.environment.points.length).toBe(6);
    const c = JSON.parse(JSON.stringify(FAN_COMPOSITION)) as Composition; (c.parts[0] as { name: string }).name = 'ntc1';
    expect(() => fanParts(c)).toThrow(/no ntc named "s"/);
  });
  it('θ = ∫ω dt, the decision, the region and the port balance agree with the kit and the reviewer', async () => {
    const t = await solve(FAN_COMPOSITION);
    const d = fanDomain(t); expect(d.ok).toBe(true);
    expect(d.crossings.map((x) => x.to)).toEqual(['high', 'low']);
    expect(d.crossings[0].atSeconds).toBeCloseTo(0.1857, 2); expect(d.crossings[1].atSeconds).toBeCloseTo(0.8143, 2);
    expect(d.minMotorAmps).toBeGreaterThan(-1e-3); expect(d.minMotorAmps).toBeLessThan(0);            // the short reverse excursion is REAL and reported, not hidden
    const cold = sampleFanAt(t, 0.05), warm = sampleFanAt(t, 0.5), coast = sampleFanAt(t, 1.1);
    expect(fanReading(cold, t.parts).region).toBe('off'); expect(cold.gateVolts).toBeLessThan(0.1); expect(cold.omegaRadPerS).toBeCloseTo(0, 3);
    expect(fanReading(warm, t.parts).region).not.toBe('off'); expect(warm.gateVolts).toBeGreaterThan(4); expect(warm.omegaRadPerS).toBeGreaterThan(15);
    expect(fanReading(coast, t.parts).region).toBe('off'); expect(coast.omegaRadPerS).toBeGreaterThan(0); expect(coast.omegaRadPerS).toBeLessThan(warm.omegaRadPerS);
    expect(coast.thetaRad).toBeGreaterThan(warm.thetaRad);                                             // θ keeps growing while it coasts
    // θ is the trapezoid of ω: check it against a coarse independent Riemann sum
    let acc = 0; for (let k = 1; k < t.times.length; k++) acc += t.series['m.omega'][k] * (t.times[k] - t.times[k - 1]);
    expect(Math.abs(t.thetaRad[t.times.length - 1] - acc) / acc).toBeLessThan(1e-3);
    const e = fanEnergy(t); expect(e.relativeAtEnd).toBeLessThan(0.005); expect(e.relativeAtEnd).toBeLessThan(1e-4);
    const r = fanReading(warm, t.parts); expect(Math.abs(r.sensorOhmsSolved - r.sensorOhmsLaw) / r.sensorOhmsLaw).toBeLessThan(1e-3);
    // The freewheel pulse: the back-EMF extinguishes the winding current within a few hundred microseconds of the
    // gate dropping, so it is a PEAK inside a window, never a single instant (the motor batch's lesson).
    let peak = 0, when = 0; for (let k = 0; k < t.times.length; k++) if (t.times[k] >= 0.81 && t.times[k] <= 0.82 && t.series['fw.current'][k] > peak) { peak = t.series['fw.current'][k]; when = t.times[k]; }
    expect(peak).toBeGreaterThan(0.05); expect(when).toBeGreaterThan(d.crossings[1].atSeconds - 1e-4); expect(when).toBeLessThan(d.crossings[1].atSeconds + 2e-3);
    expect(sampleFanAt(t, 0.5).diodeAmps).toBeLessThan(1e-6);                                         // blocking while driven
    // THE GATE CURRENT IS NOT PICOAMPS (Astra): read from the comparator's output stage it peaks near 34 mA at the on
    // crossing. I_S = I_D + I_G holds BY CONSTRUCTION (I_D is defined as I_S − I_G) and is not an independent device-KCL
    // proof (Astra's qualification); what is observational is that the PROBED source current carries the derived gate
    // charge at the peak: I_S ≈ I_G while the drain is off.
    const ig = gateCurrentSeries(t); let igPeak = 0, igWhen = 0; for (let k = 0; k < ig.length; k++) if (Math.abs(ig[k]) > igPeak) { igPeak = Math.abs(ig[k]); igWhen = t.times[k]; }
    expect(igPeak).toBeCloseTo(0.0341, 3); expect(igWhen).toBeCloseTo(0.1857, 3);
    const on = sampleFanAt(t, igWhen); expect(on.mosfetGateAmps).toBeCloseTo(ig[t.times.indexOf(igWhen)], 6);
    expect(Math.abs(on.mosfetSourceAmps - on.mosfetGateAmps - on.mosfetDrainAmps)).toBeLessThan(1e-12);
    expect(Math.abs(on.mosfetSourceAmps - on.mosfetGateAmps) / on.mosfetGateAmps).toBeLessThan(0.05);   // at the peak the source carries the gate charge
    expect(Math.abs(warm.mosfetGateAmps)).toBeLessThan(1e-4); expect(warm.mosfetDrainAmps).toBeCloseTo(warm.mosfetSourceAmps, 4);
    // COMPARATOR TERMINALS (Astra fan-trial-09311c3e): while CHARGING the stage sources the gate current from Vcc and its
    // ground pin carries only the leak; while DISCHARGING the supply current is ~0 and the gate's charge returns through
    // the ground pin. supply − output − ground = 0 holds BY CONSTRUCTION (ground is defined as the difference); the
    // observational content is that the probed supply current matches the derived output current while sourcing.
    expect(on.comparatorStageAmps).toBeCloseTo(on.mosfetGateAmps, 4);                 // sourcing: probed Vcc ≈ derived output (leak 4 µA apart)
    expect(on.comparatorGroundAmps).toBeGreaterThan(0); expect(on.comparatorGroundAmps).toBeLessThan(1e-5);
    let lo = -1; for (let k = 0; k < ig.length; k++) if (t.times[k] > 0.5 && (lo < 0 || ig[k] < ig[lo])) lo = k;   // the DISCHARGE: the most negative I_G after the driven phase
    const off = sampleFanAt(t, t.times[lo]);
    expect(ig[lo]).toBeLessThan(-5e-5); expect(t.times[lo]).toBeCloseTo(0.8143, 2);   // brief and small (tiny gate capacitance, ~−94 µA) at the grid's resolution
    expect(Math.abs(off.comparatorStageAmps)).toBeLessThan(1e-5);                     // sinking: nothing from Vcc
    expect(off.comparatorGroundAmps).toBeCloseTo(-off.mosfetGateAmps, 6);              // the discharge returns to ground
  }, 120000);
  it('the generic path refuses a composition with a structural finding before any engine sees it', () => {
    const c = JSON.parse(JSON.stringify(FAN_COMPOSITION)) as Composition; (c.parts[3].ports as Record<string, string>).inn = 'nowhere';
    expect(() => prepareComposition(c)).toThrow(/unreachable-node at nowhere/);
  });
});

// ---------------------------------------------------------------- the editable experiment (2026-09-10 batch)
import { FAN_SUPPLY_VOLTS, FAN_SUPPLY_SETTINGS, FAN_DOMAIN, supplyVoltsOf, programmeOf, withSupplyVolts, withProgramme, assertSupportedFan } from './fan';
import { encodeFanDoc, decodeFanDoc } from './fan-doc';

describe('the experiment: the base circuit with a supply and a programme, nothing else', () => {
  it('edits touch only the source voltage and the temperature points; everything else is refused by name', () => {
    const a = withSupplyVolts(FAN_COMPOSITION, 7.5); expect(supplyVoltsOf(a)).toBe(7.5); expect(programmeOf(a)).toBe('cycle');
    const diff = (x: Composition, y: Composition) => JSON.stringify(x) === JSON.stringify(y);
    expect(diff(withSupplyVolts(a, 6), FAN_COMPOSITION)).toBe(true);
    const h = withProgramme(FAN_COMPOSITION, 'hold-warm'); expect(programmeOf(h)).toBe('hold-warm'); expect(diff(withProgramme(h, 'cycle'), FAN_COMPOSITION)).toBe(true);
    expect(assertSupportedFan(withProgramme(withSupplyVolts(FAN_COMPOSITION, 3), 'hold-warm'))).toEqual({ volts: 3, programme: 'hold-warm' });
    expect(() => assertSupportedFan(withSupplyVolts(FAN_COMPOSITION, 12))).toThrow(/outside the supported/);
    expect(() => assertSupportedFan(withSupplyVolts(FAN_COMPOSITION, 2))).toThrow(/outside the supported/);
    expect(FAN_SUPPLY_SETTINGS.length).toBe(24); expect(FAN_SUPPLY_SETTINGS).not.toContain(7.5); expect(FAN_SUPPLY_SETTINGS).toContain(7.25); expect(FAN_SUPPLY_SETTINGS).toContain(7.75);
    expect(() => assertSupportedFan(withSupplyVolts(FAN_COMPOSITION, 7.5))).toThrow(/not one of the verified settings/);
    expect(() => assertSupportedFan(withSupplyVolts(FAN_COMPOSITION, 6.1))).toThrow(/not one of the verified settings/);
    const rewired = JSON.parse(JSON.stringify(FAN_COMPOSITION)) as Composition; (rewired.parts[6].ports as Record<string, string>).cathode = 'motorlow'; (rewired.parts[6].ports as Record<string, string>).anode = 'vdd';
    expect(() => assertSupportedFan(rewired)).toThrow(/differs elsewhere/);
    const retuned = JSON.parse(JSON.stringify(FAN_COMPOSITION)) as Composition; (retuned.parts[5] as { spec: { load: { constantTorqueNm: number } } }).spec.load.constantTorqueNm = 0.01;
    expect(() => assertSupportedFan(retuned)).toThrow(/differs elsewhere/);
    const odd = JSON.parse(JSON.stringify(FAN_COMPOSITION)) as Composition; odd.environments![0].points[2].value = 40;
    expect(() => assertSupportedFan(odd)).toThrow(/not one of the page/);
  });
  it('the fan document round-trips and refuses foreign or edited documents', () => {
    const c = withProgramme(withSupplyVolts(FAN_COMPOSITION, 8.25), 'hold-warm');
    expect(JSON.stringify(decodeFanDoc(encodeFanDoc(c)))).toBe(JSON.stringify(c));
    expect(() => decodeFanDoc('{"format":"flux-motor-1"}')).toThrow(/Not a fan document/);
    expect(() => decodeFanDoc(encodeFanDoc(withSupplyVolts(FAN_COMPOSITION, 11)))).toThrow(/outside the supported/);
    expect(() => decodeFanDoc('nope')).toThrow(/Not a JSON/);
  });
  for (const volts of [FAN_SUPPLY_VOLTS.min, FAN_SUPPLY_VOLTS.default, FAN_SUPPLY_VOLTS.max]) {
    it(`${volts} V hold-warm: cold off, spins up from rest, steady driven speed inside the declared domain, port balance`, async () => {
      const t = await solve(withProgramme(withSupplyVolts(FAN_COMPOSITION, volts), 'hold-warm'));
      const d = fanDomain(t); expect(d.reason).toBeNull(); expect(d.ok).toBe(true);
      expect(d.crossings.map((x) => x.to)).toEqual(['high']); expect(d.crossings[0].atSeconds).toBeGreaterThan(0.1); expect(d.crossings[0].atSeconds).toBeLessThan(0.3);
      const cold = sampleFanAt(t, 0.05), end = sampleFanAt(t, 1.2), late = sampleFanAt(t, 1.0);
      expect(cold.gateVolts).toBeLessThan(0.1); expect(cold.omegaRadPerS).toBeCloseTo(0, 3); expect(Math.abs(cold.motorAmps)).toBeLessThan(1e-6);
      expect(end.gateVolts).toBeGreaterThan(volts - 0.2); expect(fanReading(end, t.parts).region).not.toBe('off');
      expect(Math.abs(end.omegaRadPerS - late.omegaRadPerS) / end.omegaRadPerS).toBeLessThan(1e-3);       // a plateau, not still rising
      expect(fanReading(end, t.parts).terminalWatts).toBeGreaterThan(0); expect(fanReading(end, t.parts).rpm).toBeGreaterThan(50);
      expect(d.maxMotorAmps).toBeLessThanOrEqual(FAN_DOMAIN.maxAmps); expect(d.maxOmega).toBeLessThanOrEqual(FAN_DOMAIN.maxOmega);
      expect(fanEnergy(t).relativeAtEnd).toBeLessThan(0.005);
    }, 120000);
    it(`${volts} V cycle: turn-off, freewheel and coast; the nominal switching instants sit near the 6 V ones`, async () => {
      const t = await solve(withSupplyVolts(FAN_COMPOSITION, volts));
      const d = fanDomain(t); expect(d.reason).toBeNull();
      expect(d.crossings.map((x) => x.to)).toEqual(['high', 'low']);
      expect(Math.abs(d.crossings[0].atSeconds - 0.1857)).toBeLessThan(0.005); expect(Math.abs(d.crossings[1].atSeconds - 0.8143)).toBeLessThan(0.005);   // ratiometric, up to the ±10 µV band
      let peak = 0; for (let k = 0; k < t.times.length; k++) if (t.times[k] >= 0.81 && t.times[k] <= 0.82) peak = Math.max(peak, t.series['fw.current'][k]);
      expect(peak).toBeGreaterThan(0.02);
      const coast = sampleFanAt(t, 1.1); expect(fanReading(coast, t.parts).region).toBe('off'); expect(coast.omegaRadPerS).toBeGreaterThan(0); expect(coast.omegaRadPerS).toBeLessThan(sampleFanAt(t, 0.7).omegaRadPerS);
      expect(fanEnergy(t).relativeAtEnd).toBeLessThan(0.005);
    }, 120000);
  }
  it('7.50 V is withheld for a reason the solver shows: its warm-then-cool turn-off transient leaves the declared current floor', async () => {
    const t = await solve(withSupplyVolts(FAN_COMPOSITION, 7.5));
    const d = fanDomain(t); expect(d.ok).toBe(false); expect(d.reason).toMatch(/motor current -0.001[01]/); expect(d.minMotorAmps).toBeLessThan(FAN_DOMAIN.minAmps); expect(d.minMotorAmps).toBeGreaterThan(-0.0015);
    const t2 = await solve(withSupplyVolts(FAN_COMPOSITION, 7.25)); expect(fanDomain(t2).ok).toBe(true);
  }, 120000);
  it('more volts, more delivered power and a faster steady shaft for the same declared load (hold-warm plateau)', async () => {
    const rows: { volts: number; rpm: number; watts: number; amps: number; terminalV: number }[] = [];
    for (const volts of [3, 6, 9]) {
      const t = await solve(withProgramme(withSupplyVolts(FAN_COMPOSITION, volts), 'hold-warm'));
      const f = sampleFanAt(t, 1.2), r = fanReading(f, t.parts);
      rows.push({ volts, rpm: r.rpm, watts: r.terminalWatts, amps: f.motorAmps, terminalV: r.terminalVolts });
    }
    for (let k = 1; k < rows.length; k++) { expect(rows[k].rpm).toBeGreaterThan(rows[k - 1].rpm * 1.2); expect(rows[k].watts).toBeGreaterThan(rows[k - 1].watts * 1.2); }
    console.log('hold-warm plateau at 1.2 s:', rows.map((r) => `${r.volts} V → ${r.terminalV.toFixed(3)} V·${(r.amps * 1e3).toFixed(1)} mA = ${r.watts.toFixed(3)} W, ${r.rpm.toFixed(1)} RPM`).join(' | '));
  }, 240000);
});
