/**
 * THE DEMONSTRATIONS: one click each, and each one shows a component doing its job.
 *
 * WHY THIS EXISTS. The page shipped a default that was a still picture. Measured on the run it
 * actually played: current dead after 10.3% of the span, and a capacitor voltage identical to
 * four decimal places at 20, 40, 60, 80 and 100% of it. Peter said "the circuit isn't doing
 * anything", which was exactly right. The cause was not a bug — it was a configuration chosen for
 * its physics result, by me, with no thought for what it looks like while you watch it.
 *
 * It was also structural rather than a matter of tuning. A series diode feeding a series
 * capacitor with no discharge path is a PEAK DETECTOR: it charges once and stops. Driving it with
 * a sine does not help — measured, that freezes at 4.4% of the run instead of 10.3%. What the
 * diode needs in order to keep working is somewhere for the charge to go between peaks, which is
 * what `loadResistanceOhms` provides. With it, the same run has current flowing at 92.1% of its
 * span and the diode switching on eight separate times.
 *
 * So each preset states what it is FOR, and whether it is meant to move. `still: true` is a
 * deliberate choice for the one demonstration whose whole point is that nothing flows —
 * declared, so that a static scene can never again be an accident. `tools/preset-liveness.mjs`
 * checks every preset against its own declaration.
 */
import type { CircuitDescription, DiodeSpec } from './spice/netlist';

/** The page's own diode: an illustrative quasi-static silicon device, not a manufactured part. */
export const DEFAULT_DIODE_PART =
  { is: 1e-14, n: 1, rs: 0.1, cjo: 0, tt: 0, bv: 75, ibv: 1e-5 } as const;

export interface Preset {
  id: string;
  /** The button. Says what it DOES, not which components are in it. */
  label: string;
  /** One sentence, shown beside the scene: what to watch for. */
  blurb: string;
  /** True when this demonstration is meant to be still, and the stillness IS the lesson. */
  still?: boolean;
  build: (base: PresetInputs) => Partial<CircuitDescription>;
}

/** What the page contributes: the parts the viewer has already chosen. */
export interface PresetInputs {
  resistanceOhms: number;
  inductanceHenries: number;
  capacitanceFarads: number;
}

const diode = (orientation: 'forward' | 'reverse'): DiodeSpec =>
  ({ ...DEFAULT_DIODE_PART, orientation });

/**
 * The drive frequency for the alternating presets.
 *
 * Deliberately FAR BELOW the LC resonance (~3.9 MHz at the default parts) so what you watch is
 * the diode switching, not the tank ringing. At 400 kHz there are roughly ten source cycles in a
 * run, which is enough to see the pattern repeat rather than infer it from one event.
 */
const DRIVE_HZ = 4e5;
const CYCLES = 8;
/** Sized so the capacitor discharges appreciably between peaks — visible ripple, not a flat line. */
const LOAD_OHMS = 20000;

export const PRESETS: Preset[] = [
  {
    id: 'one-way-valve',
    label: 'One-way valve',
    blurb: 'The source swings both ways; the diode only lets current through one of them. Watch '
      + 'the capacitor stay on one side of zero while the source crosses it every cycle.',
    build: () => ({
      sourceSine: { amplitudeVolts: 10, frequencyHz: DRIVE_HZ, offsetVolts: 0 },
      diode: diode('forward'),
      loadResistanceOhms: LOAD_OHMS,
      stopSeconds: CYCLES / DRIVE_HZ,
      stepSeconds: 1 / (DRIVE_HZ * 240),
    }),
  },
  {
    id: 'turned-around',
    label: 'Turned around',
    blurb: 'The same alternating source with the diode reversed. It still passes one direction '
      + 'only — the other one. Which way a diode faces is the whole of what it decides.',
    build: () => ({
      sourceSine: { amplitudeVolts: 10, frequencyHz: DRIVE_HZ, offsetVolts: 0 },
      diode: diode('reverse'),
      loadResistanceOhms: LOAD_OHMS,
      stopSeconds: CYCLES / DRIVE_HZ,
      stepSeconds: 1 / (DRIVE_HZ * 240),
    }),
  },
  {
    id: 'forward-drop',
    label: 'Forward drop',
    blurb: 'A steady source, the diode conducting. Current flows continuously and the diode holds '
      + 'a small voltage across itself while it does — that drop is the price of passage.',
    build: () => ({
      sourceVolts: 10,
      diode: diode('forward'),
      loadResistanceOhms: LOAD_OHMS,
      stopSeconds: 20 / DRIVE_HZ,
      stepSeconds: 1 / (DRIVE_HZ * 240),
    }),
  },
  {
    id: 'blocking',
    label: 'Blocking',
    // THE ONE PRESET THAT IS MEANT TO BE STILL. Its blurb says so, because a viewer who has just
    // watched three moving scenes needs to be told that this one is not broken.
    still: true,
    blurb: 'The same steady source with the diode reversed. Nothing flows — and that is the '
      + 'point: the whole source voltage stands across the device and no current passes. This '
      + 'scene is meant to be still.',
    build: () => ({
      sourceVolts: 10,
      diode: diode('reverse'),
      loadResistanceOhms: LOAD_OHMS,
      stopSeconds: 20 / DRIVE_HZ,
      stepSeconds: 1 / (DRIVE_HZ * 240),
    }),
  },
  {
    id: 'lc-ring',
    label: 'LC ring',
    blurb: 'No diode. Energy sloshes between the coil’s magnetic field and the capacitor’s '
      + 'electric one, and the resistor takes a share as heat each time round.',
    build: (b) => {
      const period = 2 * Math.PI * Math.sqrt(b.inductanceHenries * b.capacitanceFarads);
      // TWO AND A HALF PERIODS, not five. A ring DECAYS — that is the honest behaviour and the
      // demonstration would be a lie without it — but at the default damping the five-period run
      // this preset inherited was already dead for 60% of its length, which is the very thing
      // Peter reported. The horizon now ends about when the motion does. Turning the damping
      // down extends both.
      return {
        sourceVolts: 10,
        stopSeconds: 2.5 * period,
        stepSeconds: period / 240,
      };
    },
  },
];

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);

/** The parts the presets are described against when nothing else is stated. */
export const PRESET_BASE: PresetInputs = {
  resistanceOhms: 277,
  inductanceHenries: 1.8852603987e-5,
  capacitanceFarads: 8.8541878128e-11,
};

/**
 * A preset plus the viewer's parts, as one complete description.
 *
 * The preset supplies the DRIVE and the TOPOLOGY — what makes the demonstration what it is — and
 * never the component values, which belong to the viewer. Starting from rest is part of every
 * demonstration: a preset that began mid-transient would be showing a state nobody set up.
 */
export function presetDescription(
  preset: Preset, inputs: PresetInputs = PRESET_BASE,
): CircuitDescription {
  return {
    sourceVolts: 0,
    resistanceOhms: inputs.resistanceOhms,
    inductanceHenries: inputs.inductanceHenries,
    capacitanceFarads: inputs.capacitanceFarads,
    initialCapacitorVolts: 0,
    initialInductorAmps: 0,
    stopSeconds: 1e-6,
    stepSeconds: 1e-9,
    ...preset.build(inputs),
  };
}
