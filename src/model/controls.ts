/**
 * READING THE CONTROLS BENCH from the solved snapshot; checking it against what the parts say.
 */
import { potLegs, ledBrightness, type LedSpec } from './spice/parts';
import type { ControlsDescription } from './spice/controls-netlist';
import type { ControlsSnapshot, ControlsTransient } from './spice/controls-transient';

export interface ControlsReading {
  switchClosed: boolean;
  /** The loaded divider's actual wiper voltage, and what the UNLOADED formula would have said. */
  wiperVolts: number;
  unloadedWiperVolts: number;
  legAwOhms: number; legWbOhms: number;
  ledVolts: number; ledAmps: number;
  /** Emission drive: max(I, 0) / I_max, linear input intensity — a rendering rule, not photometry. */
  brightness: number;
  ledWatts: number; potWatts: number; seriesWatts: number;
}

export function controlsReading(s: ControlsSnapshot, c: ControlsDescription): ControlsReading {
  const { aw, wb } = potLegs(c.pot);
  const unloaded = s.potAVolts * wb / (aw + wb);
  const ledVolts = s.ledAnodeVolts;   // cathode at ground
  return {
    switchClosed: s.switchClosed,
    wiperVolts: s.wiperVolts, unloadedWiperVolts: unloaded, legAwOhms: aw, legWbOhms: wb,
    ledVolts, ledAmps: s.ledAmps,
    brightness: ledBrightness(Math.max(s.ledAmps, 0), { ...c.led, referenceAmps: c.led.maxForwardAmps } as LedSpec),
    ledWatts: ledVolts * s.ledAmps + 0,
    potWatts: (s.potAVolts - s.wiperVolts) * s.potInAmps + s.wiperVolts * s.legBAmps + 0,
    seriesWatts: (s.wiperVolts - s.ledAnodeVolts) * s.wiperAmps + 0,
  };
}

export interface ControlsDomain { ok: boolean; reason: string | null; maxLedAmps: number; minLedVolts: number }
/** Supported domain against the trajectory: forward current within the LED's stated maximum, reverse never past −BV. */
export function controlsDomain(t: ControlsTransient): ControlsDomain {
  let maxI = -Infinity, minV = Infinity;
  for (let k = 0; k < t.times.length; k++) { if (t.ledAmps[k] > maxI) maxI = t.ledAmps[k]; if (t.ledAnodeVolts[k] < minV) minV = t.ledAnodeVolts[k]; }
  const l = t.description.led;
  if (maxI > l.maxForwardAmps * (1 + 1e-6))
    return { ok: false, maxLedAmps: maxI, minLedVolts: minV, reason: `Not supported: the LED current reached ${(maxI * 1e3).toFixed(1)} mA, above the ${(l.maxForwardAmps * 1e3).toFixed(0)} mA this demonstration covers. Raise the series resistor or turn the knob down.` };
  if (minV < -l.part.bv)
    return { ok: false, maxLedAmps: maxI, minLedVolts: minV, reason: `Not supported: the LED saw ${minV.toFixed(2)} V reverse, past its ${l.part.bv} V breakdown.` };
  return { ok: true, reason: null, maxLedAmps: maxI, minLedVolts: minV };
}
