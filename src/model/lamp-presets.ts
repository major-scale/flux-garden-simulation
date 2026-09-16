/**
 * THE LAMP DEMONSTRATIONS. One click each; each says what it is FOR and what to watch.
 * Names are agreed with Astra: "Near threshold", not "Half on" — that state lights the lamp to
 * under one percent of its ideal brightness, and a name must not promise otherwise.
 */
import { DEFAULT_MOSFET_PART, type LampDescription } from './spice/lamp-netlist';

export interface LampPreset {
  id: string;
  label: string;
  blurb: string;
  build: () => LampDescription;
}

const STOP = 60e-6, STEP = 20e-9;
const base = (): Omit<LampDescription, 'gate'> => ({
  topology: 'lamp', supplyVolts: 12, lampOhms: 24, gateOhms: 1000,
  mosfet: { ...DEFAULT_MOSFET_PART }, stopSeconds: STOP, stepSeconds: STEP,
});
const pwl = (...pts: [number, number][]) =>
  ({ kind: 'pwl' as const, points: pts.map(([atSeconds, volts]) => ({ atSeconds, volts })) });

export const LAMP_PRESETS: LampPreset[] = [
  {
    id: 'switch-on', label: 'Switch it on',
    blurb: 'The gate goes from 0 to 10 V over 2 µs. Watch the control current flow only while '
      + 'the voltages at the gate\'s terminals are changing — then stop — while the lamp current, '
      + 'half an amp, comes from the supply.',
    build: () => ({ ...base(), gate: pwl([0, 0], [10e-6, 0], [12e-6, 10], [STOP, 10]) }),
  },
  {
    id: 'near-threshold', label: 'Near threshold',
    blurb: 'The gate is taken just above the threshold and held there. The lamp barely glows — '
      + 'and the transistor, holding most of the supply across itself, takes ten times the power.',
    build: () => ({ ...base(), gate: pwl([0, 0], [10e-6, 0], [12e-6, 2.6], [STOP, 2.6]) }),
  },
  {
    id: 'dimmer', label: 'Dimmer sweep',
    blurb: 'The gate swings slowly between 0 and 10 V. Brightness follows the transfer curve: '
      + 'nothing below threshold, then a steep rise, then the lamp brightness levels off as the '
      + 'transistor drops almost nothing.',
    build: () => ({ ...base(), gate: { kind: 'sine', offsetVolts: 5, amplitudeVolts: 5,
      frequencyHz: 2 / STOP } }),
  },
  {
    id: 'switch-off', label: 'Switch it off',
    blurb: 'The mirror of switching on: the gate falls from 10 V to 0 over 2 µs and the control '
      + 'current flows the other way, out of the gate, while it discharges.',
    build: () => ({ ...base(), gate: pwl([0, 10], [10e-6, 10], [12e-6, 0], [STOP, 0]) }),
  },
];

export const lampPresetById = (id: string): LampPreset | undefined =>
  LAMP_PRESETS.find((p) => p.id === id);
