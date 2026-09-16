/** The sensing demonstrations: a 1 s prescribed ramp inside a 2 s run, both directions for each sensor. */
import { DEFAULT_LED } from './spice/parts';
import { GL5528_SELECTED, NTC_10K_B3950, DEFAULT_COMPARATOR, type SensorsDescription, type SensorSpec } from './spice/sensors-netlist';

export interface SensorsPreset { id: string; label: string; blurb: string; build: () => SensorsDescription }
const STOP = 2, STEP = 1e-3;
const ramp = (a: number, b: number) => [{ atSeconds: 0, value: a }, { atSeconds: 0.2, value: a }, { atSeconds: 1.2, value: b }, { atSeconds: STOP, value: b }];
const base = (sensor: SensorSpec, env: SensorsDescription['environment'], f = 0.5): SensorsDescription => ({
  topology: 'sensors', supplyVolts: 5, sensor, fixedOhms: 10000, environment: env,
  reference: { totalOhms: 10000, wiperFraction: f, endOhms: 0.1, contactOhms: 0.5 },
  comparator: { ...DEFAULT_COMPARATOR, switch: { ...DEFAULT_COMPARATOR.switch } },
  seriesOhms: 220, led: { ...DEFAULT_LED, part: { ...DEFAULT_LED.part } }, stopSeconds: STOP, stepSeconds: STEP,
});
const LDR: SensorSpec = { kind: 'ldr', ldr: { ...GL5528_SELECTED, luxDomain: [...GL5528_SELECTED.luxDomain] as [number, number] } };
const NTC: SensorSpec = { kind: 'ntc', ntc: { ...NTC_10K_B3950, celsiusDomain: [...NTC_10K_B3950.celsiusDomain] as [number, number] } };

export const SENSORS_PRESETS: SensorsPreset[] = [
  { id: 'dusk', label: 'Dusk', blurb: 'Bright (100 lux) to dim (2 lux) over one second. As the light fades the photoresistor\'s resistance climbs, the divider\'s voltage rises past the reference, and the comparator switches the LED on — an automatic light.', build: () => base(LDR, ramp(100, 2)) },
  { id: 'dawn', label: 'Dawn', blurb: 'The reverse: 2 lux to 100 lux. The same threshold, crossed the other way; the light goes out.', build: () => base(LDR, ramp(2, 100)) },
  { id: 'warming', label: 'Warming', blurb: '20 °C to 45 °C over one second. The thermistor sits in the upper leg, so as it warms and its resistance falls the divider voltage rises past the reference: a temperature indicator.', build: () => base(NTC, ramp(20, 45)) },
  { id: 'cooling', label: 'Cooling', blurb: '45 °C back to 20 °C. The indicator goes out where it came on.', build: () => base(NTC, ramp(45, 20)) },
];
export const sensorsPresetById = (id: string): SensorsPreset | undefined => SENSORS_PRESETS.find((p) => p.id === id);
