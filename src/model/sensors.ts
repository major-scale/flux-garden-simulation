/** Reading the sensing bench from the solved snapshot; its supported domain against the trajectory. */
import { sensorOhms, comparatorThresholdVolts, type SensorsDescription } from './spice/sensors-netlist';
import { ledBrightness } from './spice/parts';
import type { SensorsSnapshot, SensorsTransient } from './spice/sensors-transient';

export interface SensorsReading {
  /** The law's value for the prescribed input, beside the solver's V/I — they should agree; both are shown. */
  sensorOhmsLaw: number; sensorOhmsSolved: number;
  differenceVolts: number;        // vin − vref, the comparator's input
  thresholdVolts: number;         // ±10 µV for the default: inside it the decision is the band's, not a sign
  insideBand: boolean;
  high: boolean;
  outVolts: number; ledAmps: number; brightness: number;
  outStageWatts: number;          // (Vcc − out)·I through the comparator's output stage when high
}
export function sensorsReading(s: SensorsSnapshot, c: SensorsDescription): SensorsReading {
  const th = comparatorThresholdVolts(c.comparator), diff = s.vinVolts - s.vrefVolts;
  return {
    sensorOhmsLaw: sensorOhms(s.environment, c.sensor), sensorOhmsSolved: s.sensorOhmsSolved,
    differenceVolts: diff, thresholdVolts: th, insideBand: Math.abs(diff) <= th, high: s.high,
    outVolts: s.outVolts, ledAmps: s.ledAmps,
    brightness: ledBrightness(Math.max(s.ledAmps, 0), { ...c.led, referenceAmps: c.led.maxForwardAmps }),
    outStageWatts: (s.supplyVolts - s.outVolts) * s.outStageAmps + 0,
  };
}

export interface SensorsDomain { ok: boolean; reason: string | null; maxLedAmps: number; startDifferenceVolts: number; crossings: number[] }
/**
 * Supported domain against the trajectory: the run must START outside the comparator's band (an
 * operating point inside ±10 µV is AMBIGUOUS — which switch the solver picked is not the physics
 * — so it is refused, stated); the LED stays within its maximum; the environment corners were
 * already checked against the sensor's declared domain. Reports every band crossing instant.
 */
export function sensorsDomain(t: SensorsTransient): SensorsDomain {
  const th = comparatorThresholdVolts(t.description.comparator);
  const start = t.vinVolts[0] - t.vrefVolts[0];
  let maxI = -Infinity; const crossings: number[] = [];
  for (let k = 0; k < t.times.length; k++) {
    if (t.ledAmps[k] > maxI) maxI = t.ledAmps[k];
    if (k > 0 && t.high[k] !== t.high[k - 1]) crossings.push(t.times[k]);
  }
  const base = { maxLedAmps: maxI, startDifferenceVolts: start, crossings };
  if (Math.abs(start) <= th)
    return { ...base, ok: false, reason: `Not supported: the run starts with vin − vref = ${(start * 1e6).toFixed(1)} µV, inside the comparator's ±${(th * 1e6).toFixed(0)} µV band — the starting decision would be the solver's, not the circuit's. Move the reference.` };
  if (maxI > t.description.led.maxForwardAmps * (1 + 1e-6))
    return { ...base, ok: false, reason: `Not supported: the LED current reached ${(maxI * 1e3).toFixed(1)} mA, above its ${(t.description.led.maxForwardAmps * 1e3).toFixed(0)} mA maximum.` };
  return { ...base, ok: true, reason: null };
}
