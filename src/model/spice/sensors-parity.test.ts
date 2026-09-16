import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { buildSensorsNetlist, sensorOhms, comparatorThresholdVolts } from './sensors-netlist';
import { toSensorsTransient, sampleSensorsAt } from './sensors-transient';
import { SENSORS_PRESETS, sensorsPresetById } from '../sensors-presets';
import { sensorsDomain } from '../sensors';
import { emitLdr, emitNtc, emitComparator, emitPotentiometer, emitLed, DEFAULT_LED, ldrOhms } from './parts';
import { GL5528_SELECTED, NTC_10K_B3950, DEFAULT_COMPARATOR } from './sensors-netlist';
async function runDeck(deck: string) { const sim = new Simulation(); await sim.start(); sim.setNetList(deck); return sim.runSim() as Promise<{ variableNames?: string[]; data?: { name: string; values: number[] }[] }>; }

async function solve(id: string) { const d = sensorsPresetById(id)!.build(); const sim = new Simulation(); await sim.start(); sim.setNetList(buildSensorsNetlist(d)); return { d, t: toSensorsTransient(await sim.runSim() as never, d, 'eecircuit-engine (test)') }; }

describe('the sensing bench (WASM)', () => {
  it('Dusk: the solved sensor follows its law, the comparator decides where the solver says, both switches and the supply path agree', async () => {
    const { d, t } = await solve('dusk');
    const th = comparatorThresholdVolts(d.comparator);
    let worstLaw = 0, wrong = 0, worstKcl = 0, peakI = 0;
    for (let k = 0; k < t.times.length; k++) {
      // sensor law vs solved V/I (the LDR is in the lower leg: V = vin)
      const law = sensorOhms(t.environment[k], d.sensor), solved = t.vinVolts[k] / t.dividerAmps[k];
      worstLaw = Math.max(worstLaw, Math.abs(solved - law) / law);
      // decision: outside the band, the solved high-side state must equal the sign of vin − vref
      const diff = t.vinVolts[k] - t.vrefVolts[k];
      if (Math.abs(diff) > th && ((diff > 0) !== (t.high[k] === 1))) wrong++;
      // the output stage: high → the LED's current is the Vcc probe's current; low → both ≈ 0
      if (t.high[k] === 1) worstKcl = Math.max(worstKcl, Math.abs(t.outStageAmps[k] - t.ledAmps[k] - t.outVolts[k] / d.comparator.leakOhms) / Math.max(t.ledAmps[k], 1e-6));   // + the 1 MΩ leak
      else worstKcl = Math.max(worstKcl, Math.abs(t.outStageAmps[k]) + Math.abs(t.ledAmps[k]));
      // supply KCL: divider + reference + output stage
      worstKcl = Math.max(worstKcl, Math.abs(t.supplyAmps[k] - t.dividerAmps[k] - t.refInAmps[k] - t.outStageAmps[k]) / Math.max(t.supplyAmps[k], 1e-6));
      peakI = Math.max(peakI, t.ledAmps[k]);
    }
    expect(worstLaw).toBeLessThan(1e-3); expect(wrong).toBe(0); expect(worstKcl).toBeLessThan(1e-5);
    expect(peakI).toBeGreaterThan(5e-3); expect(peakI).toBeLessThan(d.led.maxForwardAmps);
    const dom = sensorsDomain(t); expect(dom.ok).toBe(true); expect(dom.crossings.length).toBe(1);
    // output load behaviour when high: V_out = Vcc − R_out·I (through the closed switch's R_on)
    const s = sampleSensorsAt(t, 1.8);
    expect(s.high).toBe(true);
    expect(Math.abs(s.outVolts - (s.supplyVolts - (d.comparator.rOutOhms + d.comparator.switch.rOnOhms) * s.outStageAmps))).toBeLessThan(1e-3);
    expect(sampleSensorsAt(t, 0.1).high).toBe(false);
  }, 60000);
  it('both directions, both sensors: one crossing each, on the ramp, and the states before/after are as the story says', async () => {
    for (const [id, onAtEnd] of [['dusk', true], ['dawn', false], ['warming', true], ['cooling', false]] as const) {
      const { t } = await solve(id);
      const dom = sensorsDomain(t); expect(dom.ok).toBe(true); expect(dom.crossings.length).toBe(1);
      expect(dom.crossings[0]).toBeGreaterThan(0.2); expect(dom.crossings[0]).toBeLessThan(1.2);
      expect(sampleSensorsAt(t, 1.9).high).toBe(onAtEnd); expect(sampleSensorsAt(t, 0.1).high).toBe(!onAtEnd);
      expect(t.stopSeconds).toBeCloseTo(2, 9);
    }
  }, 240000);
  it('NTC in the upper leg: the solved resistance follows the beta law', async () => {
    const { d, t } = await solve('warming');
    let worst = 0;
    for (let k = 0; k < t.times.length; k++) { const law = sensorOhms(t.environment[k], d.sensor), solved = (t.supplyVolts[k] - t.vinVolts[k]) / t.dividerAmps[k]; worst = Math.max(worst, Math.abs(solved - law) / law); }
    expect(worst).toBeLessThan(1e-3);
  }, 60000);
  it('INSIDE THE BAND THE PRIOR STATE IS RETAINED: hold vin exactly at vref from below, then from above', async () => {
    // E* is the illuminance at which the LDR equals the fixed resistor, so vin = vref exactly (the
    // reference legs are equal). The programme approaches E* from one side and HOLDS there; the deck
    // evaluates the same law with the same doubles, so |vin − vref| at the hold is nanovolts — deep
    // inside the ±10 µV band, where a dead zone would open both switches and hysteresis keeps the
    // state the ramp arrived with. Both starts are valid (outside the band).
    const eStar = 10 * Math.pow(GL5528_SELECTED.r10Ohms / 10000, 1 / GL5528_SELECTED.gamma);
    expect(ldrOhms(eStar, GL5528_SELECTED)).toBeCloseTo(10000, 6);
    for (const [from, expectHigh] of [[100, false], [2, true]] as const) {
      const d = sensorsPresetById('dusk')!.build();
      d.environment = [{ atSeconds: 0, value: from }, { atSeconds: 0.2, value: from }, { atSeconds: 1.2, value: eStar }, { atSeconds: 2, value: eStar }];
      const sim = new Simulation(); await sim.start(); sim.setNetList(buildSensorsNetlist(d));
      const t = toSensorsTransient(await sim.runSim() as never, d, 'eecircuit-engine (test)');
      const s = sampleSensorsAt(t, 1.8), th = comparatorThresholdVolts(d.comparator);
      expect(Math.abs(s.vinVolts - s.vrefVolts)).toBeLessThan(th);          // held inside the band
      expect(s.high).toBe(expectHigh);                                       // …with the arriving state retained
      expect(sensorsDomain(t).crossings.length).toBe(0);
      if (expectHigh) { expect(s.ledAmps).toBeGreaterThan(5e-3); expect(s.outStageAmps).toBeGreaterThan(5e-3); expect(s.outVolts).toBeGreaterThan(4); }
      else { expect(Math.abs(s.ledAmps)).toBeLessThan(1e-9); expect(Math.abs(s.outStageAmps)).toBeLessThan(2e-8); expect(Math.abs(s.outVolts)).toBeLessThan(1e-3); }
    }
  }, 120000);
  it('COMPOSITION: two independently named comparators and sensors in one deck decide independently — no collisions, no cross-wiring', async () => {
    // Bench 1: LDR (lower leg) held BRIGHT → v1 low → comparator c1 LOW. Bench 2: NTC (upper leg)
    // held WARM → v2 high → comparator c2 HIGH. Separate references, separate LEDs. Then the
    // environments swap roles and the decisions must swap with them.
    const deck = (lux: number, celsius: number) => ['* two-instance composition', 'Vcc vcc 0 DC 5', `Ve1 e1 0 DC ${lux}`, `Ve2 e2 0 DC ${celsius}`,
      'Rf1 vcc v1 10000', ...emitLdr('ldr1', 'v1', '0', 'e1', GL5528_SELECTED),
      ...emitNtc('ntc2', 'vcc', 'v2', 'e2', NTC_10K_B3950), 'Rf2 v2 0 10000',
      ...emitPotentiometer('p1', 'vcc', 'r1', '0', { totalOhms: 10000, wiperFraction: 0.5, endOhms: 0.1, contactOhms: 0.5 }),
      ...emitPotentiometer('p2', 'vcc', 'r2', '0', { totalOhms: 10000, wiperFraction: 0.5, endOhms: 0.1, contactOhms: 0.5 }),
      ...emitComparator('c1', { inp: 'v1', inn: 'r1', out: 'o1', vcc: 'vcc' }, DEFAULT_COMPARATOR),
      ...emitComparator('c2', { inp: 'v2', inn: 'r2', out: 'o2', vcc: 'vcc' }, DEFAULT_COMPARATOR),
      'Rs1 o1 a1 220', ...emitLed('l1', 'a1', '0', DEFAULT_LED), 'Rs2 o2 a2 220', ...emitLed('l2', 'a2', '0', DEFAULT_LED),
      '.options reltol=1e-4', '.tran 1m 0.05 0 1m', '.end'].join('\n') + '\n';
    for (const [lux, celsius, c1High, c2High] of [[100, 45, false, true], [2, 10, true, false]] as const) {
      const raw = await runDeck(deck(lux, celsius));
      const get = (n: string) => { const d = raw.data!.find((x) => x.name.toLowerCase() === n); if (!d) throw new Error('missing ' + n); return d.values; };
      const k = get('time').length - 1;
      expect(get('v(c1_ctl)')[k] > 0.6).toBe(c1High); expect(get('v(c2_ctl)')[k] > 0.6).toBe(c2High);
      expect(get('i(vdl1)')[k] > 5e-3).toBe(c1High); expect(get('i(vdl2)')[k] > 5e-3).toBe(c2High);
      // each stage's supply current is its own LED's (plus its own leak), never the other's
      expect(Math.abs(get('i(vcpc1)')[k] - get('i(vdl1)')[k] - get('v(o1)')[k] / 1e6)).toBeLessThan(1e-6);
      expect(Math.abs(get('i(vcpc2)')[k] - get('i(vdl2)')[k] - get('v(o2)')[k] / 1e6)).toBeLessThan(1e-6);
    }
    // and a bad instance name is refused before any deck is written
    expect(() => emitComparator('C-1', { inp: 'a', inn: 'b', out: 'c', vcc: 'd' }, DEFAULT_COMPARATOR)).toThrow(/instance name/);
  }, 120000);
  it('every preset stays within the LED maximum', async () => {
    for (const p of SENSORS_PRESETS) { const { t } = await solve(p.id); expect(Math.max(...Array.from(t.ledAmps))).toBeLessThan(0.03); }
  }, 240000);
});
