import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { buildControlsNetlist } from './controls-netlist';
import { toControlsTransient, sampleControlsAt } from './controls-transient';
import { CONTROLS_PRESETS, controlsPresetById } from '../controls-presets';
import { controlsReading, controlsDomain } from '../controls';
import { shockleyCurrent } from '../diode';
import { emitPotentiometer, emitLed, emitSwitch, pulseControl, DEFAULT_LED } from './parts';
import { potLegs } from './parts';

async function run(netlist: string) { const sim = new Simulation(); await sim.start(); sim.setNetList(netlist); return sim.runSim() as Promise<never>; }
async function solve(id: string) { const d = controlsPresetById(id)!.build(); return { d, t: toControlsTransient(await run(buildControlsNetlist(d)), d, 'eecircuit-engine (test)') }; }

describe('the controls bench (WASM)', () => {
  it('Off: the toggle stays open and nothing conducts', async () => {
    const { t } = await solve('off');
    for (let k = 0; k < t.times.length; k++) { expect(Math.abs(t.sourceAmps[k])).toBeLessThan(1e-7); expect(Math.abs(t.ledAmps[k])).toBeLessThan(1e-9); }
  }, 60000);
  it('Switch it on: dark before the edge, lit after; KCL at the wiper; the LOADED divider, not the unloaded one', async () => {
    const { d, t } = await solve('switch-on');
    expect(sampleControlsAt(t, 0.002).ledAmps).toBeLessThan(1e-9);
    const s = sampleControlsAt(t, 0.015);
    expect(s.ledAmps).toBeGreaterThan(1e-3);
    let worst = 0, peak = 0;
    for (let k = 0; k < t.times.length; k++) { peak = Math.max(peak, Math.abs(t.wiperAmps[k])); worst = Math.max(worst, Math.abs(t.wiperAmps[k] - t.ledAmps[k]), Math.abs(t.potInAmps[k] - t.wiperAmps[k] - t.legBAmps[k])); }
    expect(worst / peak).toBeLessThan(1e-6);
    const r = controlsReading(s, d);
    expect(r.wiperVolts).toBeLessThan(r.unloadedWiperVolts - 0.2);   // the load pulls the wiper down, measurably
    // THE SWITCH STATE FOLLOWS THE SOLVED MODEL'S HYSTERESIS, not a 0.5 threshold: on the 0.5 ms
    // edge the control passes 0.5 at 5.25 ms and 0.6 at 5.30 ms; the state must be OPEN at 5.275
    // and CLOSED just after 5.30 — and the source current must agree with that state.
    const before = sampleControlsAt(t, 0.005275), after = sampleControlsAt(t, 0.005325);
    expect(before.controlVolts).toBeGreaterThan(0.5); expect(before.controlVolts).toBeLessThan(0.6);
    expect(before.switchClosed).toBe(false); expect(Math.abs(before.sourceAmps)).toBeLessThan(1e-6);
    expect(after.switchClosed).toBe(true); expect(after.sourceAmps).toBeGreaterThan(1e-4);
    // INDEPENDENT leg checks from the track-node voltage and the EMITTED resistances (legB is
    // defined from KCL, so KCL alone would be true by construction).
    const { aw, wb } = potLegs(d.pot);
    expect(Math.abs((s.potAVolts - s.trackVolts) / aw - s.potInAmps) / s.potInAmps).toBeLessThan(1e-4);
    expect(Math.abs(s.trackVolts / wb - s.legBAmps) / s.potInAmps).toBeLessThan(1e-4);
    expect(Math.abs((s.trackVolts - s.wiperVolts) / d.pot.contactOhms - s.wiperAmps) / s.potInAmps).toBeLessThan(1e-4);
    // The LED obeys its own law: I = shockley(V_anode − V_cathode) with RS included.
    const sh = shockleyCurrent(s.ledAnodeVolts, { ...d.led.part, orientation: 'forward' });
    expect(Math.abs(s.ledAmps - sh) / s.ledAmps).toBeLessThan(2e-3);
    // And the series resistor: (V_w − V_anode) / R_s = I_led.
    expect(Math.abs((s.wiperVolts - s.ledAnodeVolts) / d.seriesOhms - s.ledAmps) / s.ledAmps).toBeLessThan(1e-4);
    expect(controlsDomain(t).ok).toBe(true);
  }, 60000);
  it('endpoints: Full puts the wiper at the supply less the end drop; Barely is dark despite a finite wiper voltage', async () => {
    const full = await solve('full'); const sf = sampleControlsAt(full.t, 0.015);
    expect(sf.wiperVolts).toBeGreaterThan(8.5);
    expect(sf.ledAmps).toBeLessThan(full.d.led.maxForwardAmps);
    const barely = await solve('barely'); const sb = sampleControlsAt(barely.t, 0.015);
    expect(sb.wiperVolts).toBeGreaterThan(0.5);
    expect(sb.ledAmps).toBeLessThan(2e-4);
    for (const p of CONTROLS_PRESETS) { const { t } = await solve(p.id); expect(controlsDomain(t).ok).toBe(true); expect(t.stopSeconds).toBeCloseTo(0.02, 9); }
  }, 120000);
  it('COMPOSITION: the same emitters build pot → MOSFET gate → lamp, and it solves and closes KCL', async () => {
    // Reuse, proved on a second circuit rather than a second page: the pot feeds the gate of the
    // lamp page's transistor; the lamp is its resistor; the toggle gates the pot's supply.
    const pot = { totalOhms: 10000, wiperFraction: 0.35, endOhms: 0.1, contactOhms: 0.5 };
    const deck = ['* composition test', 'Vdd nd 0 DC 12', `Vsw ctl 0 ${pulseControl(2e-3, null, 0.5e-3, 0.02)}`,
      ...emitSwitch('t', 'nd', 'na', 'ctl', { rOnOhms: 0.05, rOffOhms: 1e9 }),
      ...emitPotentiometer('p', 'na', 'g', '0', pot),
      'RLAMP nd d 24', 'M1 d g s s MMOD W=0.01 L=0.000001', 'Vsrc s 0 DC 0',
      '.model MMOD NMOS(LEVEL=1 VTO=2 KP=0.00002 LAMBDA=0.01 TOX=1e-7 CGSO=1e-9 CGDO=1e-9)',
      ...emitLed('i', 'na', 'nk', DEFAULT_LED), 'Rk nk 0 680',            // and an indicator LED off the switched rail
      '.options reltol=1e-4', '.tran 2e-5 0.02 0 2e-5', '.end'].join('\n') + '\n';
    const raw = await run(deck) as { variableNames?: string[]; data?: { name: string; values: number[] }[] };
    const get = (n: string) => raw.data!.find((d) => d.name.toLowerCase() === n)!.values;
    const time = get('time'), vg = get('v(g)'), ivdd = get('i(vdd)'), ivap = get('i(vap)'), ivwp = get('i(vwp)'), ivsrc = get('i(vsrc)'), ivdi = get('i(vdi)');
    const k = time.findIndex((x) => x > 0.015);
    const { aw, wb } = potLegs(pot);
    expect(vg[k]).toBeGreaterThan(2);                                   // above threshold: the lamp is on
    expect(ivsrc[k]).toBeGreaterThan(0.05);                             // i(vsrc) = current OUT of the source terminal to ground — lamp conducting
    expect(Math.abs(ivwp[k])).toBeLessThan(1e-6);                       // the gate draws nothing at DC: the wiper is unloaded
    expect(Math.abs(vg[k] - 12 * wb / (aw + wb))).toBeLessThan(0.05);   // so here the UNLOADED formula holds
    expect(ivdi[k]).toBeGreaterThan(1e-3);                              // the indicator LED lit off the switched rail
    // KCL at the switched rail: supply current = pot in + LED indicator + lamp current
    const lampI = ivsrc[k];
    expect(Math.abs(-ivdd[k] - (ivap[k] + ivdi[k] + lampI)) / Math.abs(ivdd[k])).toBeLessThan(1e-4);
  }, 60000);
});
