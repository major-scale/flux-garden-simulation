/** The controls demonstrations. f: 0 = wiper at A (supply side, full), 1 = at B (ground, low). */
import { DEFAULT_LED } from './spice/parts';
import type { ControlsDescription } from './spice/controls-netlist';

export interface ControlsPreset { id: string; label: string; blurb: string; build: () => ControlsDescription }

const STOP = 20e-3, STEP = 20e-6, CLOSE = 5e-3, EDGE = 0.5e-3;
const base = (closed: boolean, f: number): ControlsDescription => ({
  topology: 'controls', supplyVolts: 9,
  toggle: { closed, closeAtSeconds: CLOSE, edgeSeconds: EDGE, spec: { rOnOhms: 0.05, rOffOhms: 1e9 } },
  pot: { totalOhms: 1000, wiperFraction: f, endOhms: 0.1, contactOhms: 0.5 },
  seriesOhms: 270,
  led: { ...DEFAULT_LED, part: { ...DEFAULT_LED.part } },
  stopSeconds: STOP, stepSeconds: STEP,
});

export const CONTROLS_PRESETS: ControlsPreset[] = [
  { id: 'switch-on', label: 'Switch it on', blurb: 'Knob at the middle; the toggle closes 5 ms into the run and the LED lights. The wiper voltage is what the LOADED divider gives — the LED and its resistor draw current from the wiper, so it is lower than the unloaded formula says.',
    build: () => base(true, 0.5) },
  { id: 'full', label: 'Full', blurb: 'Knob at end A: the wiper sits at the supply and the LED gets the most this bench allows (the series resistor sets it).', build: () => base(true, 0) },
  { id: 'barely', label: 'Barely', blurb: 'Knob near end B: the wiper is close to ground. This LED needs about 2 V before it conducts at all, so the light does not fade smoothly to nothing — it goes out.', build: () => base(true, 0.86) },
  { id: 'off', label: 'Off', blurb: 'The toggle stays open for the whole run: no current anywhere, no light. A run in which nothing happens, by choice.', build: () => base(false, 0.5) },
];
export const controlsPresetById = (id: string): ControlsPreset | undefined => CONTROLS_PRESETS.find((p) => p.id === id);
