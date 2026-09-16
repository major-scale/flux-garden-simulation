/**
 * THE MOTOR DEMONSTRATIONS. Each states its control programme, and therefore which authority
 * checks it: the analytic 3-state reference applies where the switch is closed at a fixed
 * voltage (Lift it, Locked shaft); the freewheel run is checked by parity, KCL and energy.
 */
import { DEFAULT_DIODE_PART } from './presets';
import type { MotorDescription } from './spice/motor-netlist';

export interface MotorPreset { id: string; label: string; blurb: string; build: () => MotorDescription }

const STOP = 0.6, STEP = 1e-4, EDGE = 1e-3, CLOSE = 0.02, OPEN = 0.40;
/**
 * A small illustrative motor and a 100 g mass on a 40 mm pinion — not a catalogue part. The
 * geometry was chosen so ONE drawing scale serves the pinion and the lift (Astra's condition:
 * no radius floor, no invented gearing): K = 0.3 V·s/rad keeps the shaft near 19 rad/s, so the
 * pinion turns about 1.6 times over the run and the rack rises about 0.4 m.
 */
const base = (): Omit<MotorDescription, 'programme'> => ({
  topology: 'motor', supplyVolts: 6,
  motor: { resistanceOhms: 2, inductanceHenries: 5e-3, kVsPerRad: 0.3, rotorInertiaKgM2: 5e-4, viscousNmS: 1e-3 },
  load: { massKg: 0.1, pinionRadiusM: 0.04, gravity: 9.80665 },
  switch: { rOnOhms: 0.05, rOffOhms: 1e9 },
  freewheel: { ...DEFAULT_DIODE_PART },
  stopSeconds: STOP, stepSeconds: STEP,
});

export const MOTOR_PRESETS: MotorPreset[] = [
  {
    id: 'lift-it', label: 'Lift it',
    blurb: 'The brake releases and the switch closes together. Watch the current spike, then fall '
      + 'as the shaft speeds up and the back-EMF rises inside the winding; the rack climbs.',
    build: () => ({ ...base(), programme: { closeAtSeconds: CLOSE, openAtSeconds: null, releaseBrakeAtSeconds: CLOSE, edgeSeconds: EDGE } }),
  },
  {
    id: 'locked-shaft', label: 'Locked shaft',
    blurb: 'The switch closes but the brake holds the shaft. No back-EMF, so the current settles '
      + 'to V/R — after the magnetic build-up — and every watt after that is heat in the winding.',
    build: () => ({ ...base(), programme: { closeAtSeconds: CLOSE, openAtSeconds: null, releaseBrakeAtSeconds: null, edgeSeconds: EDGE } }),
  },
  {
    id: 'switch-off', label: 'Switch it off',
    blurb: 'Lifting, then the switch opens. The winding current has to go somewhere: it circulates '
      + 'through the freewheel diode and is gone in under a millisecond — the back-EMF is in that loop '
      + 'too. Then the motor COASTS: no current, the load and friction slow the shaft, and the run '
      + 'ends before it turns back.',
    build: () => ({ ...base(), programme: { closeAtSeconds: CLOSE, openAtSeconds: OPEN, releaseBrakeAtSeconds: CLOSE, edgeSeconds: EDGE } }),
  },
];

export const motorPresetById = (id: string): MotorPreset | undefined => MOTOR_PRESETS.find((p) => p.id === id);
