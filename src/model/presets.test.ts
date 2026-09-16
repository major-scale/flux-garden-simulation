import { describe, it, expect } from 'vitest';
import { PRESETS, presetById, presetDescription, PRESET_BASE, DEFAULT_DIODE_PART } from './presets';
import { buildNetlist, validateCircuit } from './spice/netlist';

describe('every demonstration is a circuit the solver will actually accept', () => {
  it('builds a valid netlist for each preset', () => {
    for (const p of PRESETS) {
      const d = presetDescription(p);
      expect(() => validateCircuit(d)).not.toThrow();
      expect(() => buildNetlist(d)).not.toThrow();
    }
  });

  it('gives the viewer’s parts to every preset, and takes the drive from the preset', () => {
    // The preset supplies the DRIVE and the TOPOLOGY; the component values belong to the viewer.
    // A preset that overrode R, L or C would be quietly rebuilding the circuit under them.
    const mine = { resistanceOhms: 1234, inductanceHenries: 5e-5, capacitanceFarads: 2e-10 };
    for (const p of PRESETS) {
      const d = presetDescription(p, mine);
      expect(d.resistanceOhms).toBe(1234);
      expect(d.inductanceHenries).toBe(5e-5);
      expect(d.capacitanceFarads).toBe(2e-10);
    }
  });

  it('starts every demonstration from rest', () => {
    // A preset that began mid-transient would be showing a state nobody set up.
    for (const p of PRESETS) {
      const d = presetDescription(p);
      expect(d.initialCapacitorVolts).toBe(0);
      expect(d.initialInductorAmps).toBe(0);
    }
  });
});

describe('the demonstrations show what they claim to show', () => {
  it('gives every alternating preset a LOAD, without which the diode cannot keep working', () => {
    // Measured: a series diode into a series capacitor with no discharge path is a peak
    // detector — it charges once and stops, and the scene is frozen for the rest of the run.
    // Any preset driven by a sine therefore needs somewhere for the charge to go between peaks.
    for (const p of PRESETS) {
      const d = presetDescription(p);
      if (d.sourceSine) expect(d.loadResistanceOhms).toBeGreaterThan(0);
    }
  });

  it('drives well below the LC resonance, so the diode is what you watch', () => {
    // At the default parts the tank rings near 3.9 MHz. A drive up near that would show the
    // resonance rather than the switching, which is not what these presets are for.
    const f0 = 1 / (2 * Math.PI * Math.sqrt(
      PRESET_BASE.inductanceHenries * PRESET_BASE.capacitanceFarads));
    for (const p of PRESETS) {
      const d = presetDescription(p);
      if (d.sourceSine) expect(d.sourceSine.frequencyHz).toBeLessThan(f0 / 5);
    }
  });

  it('covers several source cycles, so the pattern repeats rather than being inferred', () => {
    for (const p of PRESETS) {
      const d = presetDescription(p);
      if (d.sourceSine) {
        const cycles = d.stopSeconds * d.sourceSine.frequencyHz;
        expect(cycles).toBeGreaterThanOrEqual(4);
        // And resolved: at least 100 output steps per source cycle.
        expect(1 / (d.sourceSine.frequencyHz * d.stepSeconds)).toBeGreaterThan(100);
      }
    }
  });

  it('declares exactly one still demonstration, and it is the blocking one', () => {
    // A static scene must never again be an accident. `still` is the declaration that
    // tools/preset-liveness.mjs checks each preset against.
    const still = PRESETS.filter((p) => p.still);
    expect(still.map((p) => p.id)).toEqual(['blocking']);
    // And it must SAY it is still, because a viewer who has just watched three moving scenes
    // will otherwise read it as broken — which is exactly the report that prompted all of this.
    expect(still[0].blurb).toMatch(/meant to be still/);
  });

  it('turns the SAME circuit around rather than changing anything else', () => {
    // "Turned around" only means something if it is the one-way valve with the device reversed.
    const a = presetDescription(presetById('one-way-valve')!);
    const b = presetDescription(presetById('turned-around')!);
    expect(a.diode!.orientation).toBe('forward');
    expect(b.diode!.orientation).toBe('reverse');
    const strip = (d: typeof a) => ({ ...d, diode: undefined });
    expect(strip(b)).toEqual(strip(a));
  });

  it('uses the page’s own part in every diode preset', () => {
    for (const p of PRESETS) {
      const d = presetDescription(p);
      if (d.diode) {
        const { orientation: _o, ...part } = d.diode;
        expect(part).toEqual({ ...DEFAULT_DIODE_PART });
      }
    }
  });

  it('has a distinct id, a label and a blurb for each', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(30);
    }
    expect(presetById('nope')).toBeUndefined();
  });
});
