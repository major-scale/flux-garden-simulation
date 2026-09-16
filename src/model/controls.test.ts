import { describe, it, expect } from 'vitest';
import { potLegs, emitPotentiometer, emitSwitch, emitLed, pulseControl, validatePot, DEFAULT_LED, ledBrightness } from './spice/parts';
import { switchStates } from './spice/controls-transient';
import { buildControlsNetlist, validateControls } from './spice/controls-netlist';
import { CONTROLS_PRESETS } from './controls-presets';
import { controlsReading, controlsDomain } from './controls';
import type { ControlsSnapshot, ControlsTransient } from './spice/controls-transient';
import { encodeControlsDoc, decodeControlsDoc } from './controls-doc';

describe('the parts library emits what it says', () => {
  it('potentiometer: f = 0 puts the wiper at A (full), f = 1 at B; legs carry the end floor', () => {
    const p = { totalOhms: 1000, wiperFraction: 0, endOhms: 0.1, contactOhms: 0.5 };
    expect(potLegs(p)).toEqual({ aw: 0.1, wb: 1000.1 });
    expect(potLegs({ ...p, wiperFraction: 1 })).toEqual({ aw: 1000.1, wb: 0.1 });
    const lines = emitPotentiometer('p', 'na', 'nw', '0', { ...p, wiperFraction: 0.25 });
    expect(lines).toEqual(['Vap na p_a DC 0', 'Rap p_a p_t 250.1', 'Rbp p_t 0 750.1', 'Rcp p_t p_w 0.5', 'Vwp p_w nw DC 0']);
    expect(() => validatePot({ ...p, wiperFraction: 1.2 })).toThrow(/wiper fraction/);
    expect(() => validatePot({ ...p, contactOhms: 0 })).toThrow(/contact resistance/);   // no silent substitution
  });
  it('switch and LED emitters name their probes and models', () => {
    expect(emitSwitch('t', 'nd', 'na', 'ctl', { rOnOhms: 0.05, rOffOhms: 1e9 })).toEqual(['St nd na ctl 0 SWT', '.model SWT SW(RON=0.05 ROFF=1000000000 VT=0.5 VH=0.1)']);
    expect(emitLed('l', 'nl', '0', DEFAULT_LED)[0]).toBe('Dl nl 0_lk DL');
    expect(emitLed('l', 'nl', '0', DEFAULT_LED)[1]).toBe('Vdl 0_lk 0 DC 0');
    expect(pulseControl(null, null, 1e-3, 1)).toBe('DC 0');
    expect(pulseControl(5e-3, null, 0.5e-3, 0.02)).toBe('PWL(0 0 0.005 0 0.0055 1 0.02 1)');
  });
  it('LED brightness is linear in current with no floor and clamps at the reference', () => {
    expect(ledBrightness(0, DEFAULT_LED)).toBe(0);
    expect(ledBrightness(10e-3, DEFAULT_LED)).toBeCloseTo(0.5, 12);
    expect(ledBrightness(50e-3, DEFAULT_LED)).toBe(1);
    expect(ledBrightness(-1e-3, DEFAULT_LED)).toBe(0);
  });
});

describe('the controls netlist', () => {
  it('composes the bench from the library, closes the toggle at a finite edge, and leaves it open when asked', () => {
    const on = buildControlsNetlist(CONTROLS_PRESETS[0].build());
    expect(on).toContain('Vsw ctl 0 PWL(0 0 0.005 0 0.0055 1 0.02 1)');
    expect(on).toContain('St nd na ctl 0 SWT');
    expect(on).toContain('Rap p_a p_t 500.1');
    expect(on).toContain('Rs nw nl 270');
    expect(on).toContain('Dl nl 0_lk DL');
    expect(on).not.toContain('uic');
    const off = buildControlsNetlist(CONTROLS_PRESETS[3].build());
    expect(off).toContain('Vsw ctl 0 DC 0');
  });
  it('refuses out-of-range parts', () => {
    const c = CONTROLS_PRESETS[0].build();
    expect(() => validateControls({ ...c, seriesOhms: 0 })).toThrow(/Series resistance/);
    expect(() => validateControls({ ...c, led: { ...c.led, maxForwardAmps: 1e-3 } })).toThrow(/maximum forward current/);
  });
});

const snap = (o: Partial<ControlsSnapshot>): ControlsSnapshot => ({ timeSeconds: 0.01, switchClosed: true, supplyVolts: 9, potAVolts: 9, wiperVolts: 4, ledAnodeVolts: 1.8,
  controlVolts: 1, trackVolts: 4.004, sourceAmps: 0.01, potInAmps: 0.01, wiperAmps: 0.008, legBAmps: 0.002, ledAmps: 0.008, ...o } as ControlsSnapshot);

describe('the reading', () => {
  it('reports the loaded wiper voltage beside the unloaded formula, and a floor-free brightness', () => {
    const c = CONTROLS_PRESETS[0].build();
    const r = controlsReading(snap({}), c);
    expect(r.unloadedWiperVolts).toBeCloseTo(9 * 500.1 / 1000.2, 12);
    expect(r.wiperVolts).toBe(4);
    expect(r.brightness).toBeCloseTo(0.008 / 0.03, 12);
    expect(controlsReading(snap({ ledAmps: 0 }), c).brightness).toBe(0);
    expect(controlsReading(snap({ ledAmps: -1e-9 }), c).brightness).toBe(0);
    expect(controlsReading(snap({ ledAmps: -1e-9 }), c).ledAmps).toBe(-1e-9);   // signed for the electrical display
  });
  it('refuses a run that exceeds the LED demonstration range', () => {
    const c = CONTROLS_PRESETS[0].build();
    const n = 5, z = () => new Float64Array(n);
    const t: ControlsTransient = { topology: 'controls', times: Float64Array.from([0, 1, 2, 3, 4]), supplyVolts: z(), potAVolts: z(), wiperVolts: z(),
      ledAnodeVolts: z(), controlVolts: z(), sourceAmps: z(), potInAmps: z(), wiperAmps: z(), legBAmps: z(), ledAmps: Float64Array.from([0, 0.01, 0.04, 0.01, 0]),
      trackVolts: z(), switchClosed: new Uint8Array(n),
      description: c, stopSeconds: 4, requestedStopSeconds: 4, requestedStepSeconds: 1, actualStepSeconds: { min: 1, median: 1, max: 1 }, edges: [], engine: 'test' };
    expect(controlsDomain(t).reason).toMatch(/40\.0 mA, above the 30 mA/);
    t.ledAmps[2] = 0.02; expect(controlsDomain(t).ok).toBe(true);
  });
  it('documents round-trip and refuse other formats', () => {
    for (const p of CONTROLS_PRESETS) { const c = p.build(); expect(decodeControlsDoc(encodeControlsDoc(c))).toEqual(c); }
    expect(() => decodeControlsDoc(JSON.stringify({ format: 'flux-motor-1' }))).toThrow(/Not a controls document/);
  });
});

describe('the switch state follows the solved model, with hysteresis', () => {
  it('closes only past 0.6 and opens only below 0.4, per sample, never at 0.5', () => {
    const ctl = Float64Array.from([0, 0.3, 0.5, 0.55, 0.61, 1, 0.55, 0.45, 0.39, 0]);
    expect(Array.from(switchStates(ctl))).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 0, 0]);
  });
});
