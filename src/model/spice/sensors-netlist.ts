/**
 * THE SENSING BENCH: a prescribed environment → a resistive sensor in a divider → a comparator
 * against the pot's wiper → 220 Ω → the LED. Composed from the parts library plus three new parts
 * whose models are declared here with their domains.
 *
 * ENVIRONMENT AND CIRCUIT SHARE THE SOLVER'S TIME. The illuminance or temperature programme is a
 * PWL voltage node in the deck (1 V ≡ 1 lux or 1 °C) and the sensor is a behavioural resistor of
 * that node, so the light cue on screen and the electrical trajectory are the same instant of the
 * same solve. No thermal lag, no self-heating, no light from the LED reaching the sensor: none of
 * that is modelled, and the drawing does not suggest it.
 *
 * LDR — GL5528-class CdS cell. Source: the "CdS PHOTOCONDUCTIVE CELLS GL5528" datasheet as hosted
 * by SparkFun (SEN-09088, https://cdn.sparkfun.com/datasheets/Sensors/LightImaging/SEN-09088.pdf);
 * the page read gives light resistance at 10 lux 8–20 kΩ, dark resistance 1.0 MΩ min (10 s after
 * 10 lux), γ 0.7 between 10 and 100 lux with a stated error of ±0.1, ambient −30…+70 °C, and a
 * resistance–illuminance chart spanning 1…100 lux. The manufacturer's name is not printed on that
 * page; "GL5528" is a family label. Selected: R10 = 12 kΩ (inside the range), γ = 0.7. Model
 * R(E) = min(R_dark, R10·(E/10)^−γ) on the DECLARED domain 1…100 lux — the chart's range; γ is an
 * approximation with the datasheet's own ±0.1, not a claim that every part follows it. The dark
 * clamp is a policy for the low end; inside the demonstrated range it never engages, so darkness
 * below 1 lux is OUTSIDE the demonstrated range, not a tested state.
 *
 * NTC — beta law R = R0·exp(B·(1/T − 1/T0)), R0 10 kΩ at 25 °C, B 3950 K, declared −20…+80 °C.
 * The beta form is the application-note approximation over a limited range; tabulated beta-law
 * values test THIS implementation, not the accuracy of any real thermistor across that range.
 *
 * COMPARATOR — explicitly illustrative, built in the deck: u = clip(0.5 + G·(vin − vref), 0, 1)
 * with G = 1e4 drives the HIGH-side ideal switch (Vcc → out), and 1 − u drives the LOW-side
 * switch (out → ground); both are the project's SW model (VT 0.5, VH 0.1), so the high side closes
 * at u > 0.6 ⇔ vin − vref > +10 µV and opens at u < 0.4 ⇔ vin − vref < −10 µV, the low side the
 * mirror: thresholds ±10 µV. INSIDE that 20 µV band the PRIOR state is RETAINED — hysteresis, not
 * a dead zone — after a valid start outside it (a first version of this text said both switches
 * were open inside the band; the standard ramps never sample it, and Astra caught the claim; the
 * band-hold test now does). Only a start inside the band leaves both open with the output
 * floating through the 1 MΩ leak, and such a start is refused as ambiguous. ONE output
 * resistance R_out = 50 Ω serves both sides. The output current is drawn from Vcc through a 0 V
 * probe, so the supply KCL closes with a real path. The decision is ngspice's.
 */
import { assertAscii } from './netlist';
import { emitPotentiometer, emitLed, emitLdr, emitNtc, emitComparator, validatePot, validateLed, validateLdr, validateNtc, validateComparator,
  ldrOhms, ntcOhms, comparatorThresholdVolts, type PotSpec, type LedSpec, type LdrSpec, type NtcSpec, type ComparatorSpec } from './parts';
export { ldrOhms, ntcOhms, comparatorThresholdVolts };
export type { LdrSpec, NtcSpec, ComparatorSpec };
export type SensorSpec = { kind: 'ldr'; ldr: LdrSpec } | { kind: 'ntc'; ntc: NtcSpec };

export interface SensorsDescription {
  topology: 'sensors';
  supplyVolts: number;
  sensor: SensorSpec;
  /** The divider's fixed resistor. LDR sits in the LOWER leg, NTC in the UPPER leg (fixed by kind). */
  fixedOhms: number;
  /** The prescribed environment: lux or °C over time, finite ramps only. First point at 0 s. */
  environment: { atSeconds: number; value: number }[];
  reference: PotSpec;
  comparator: ComparatorSpec;
  seriesOhms: number;
  led: LedSpec;
  stopSeconds: number;
  stepSeconds: number;
}

export const GL5528_SELECTED: LdrSpec = { r10Ohms: 12000, gamma: 0.7, darkOhms: 1e6, luxDomain: [1, 100] };
export const NTC_10K_B3950: NtcSpec = { r0Ohms: 10000, t0Kelvin: 298.15, betaKelvin: 3950, celsiusDomain: [-20, 80] };
export const DEFAULT_COMPARATOR: ComparatorSpec = { gain: 1e4, rOutOhms: 50, leakOhms: 1e6, switch: { rOnOhms: 1e-3, rOffOhms: 1e9 } };

/** The bench's instance names: sensor `s`, reference pot `p`, comparator `c`, LED `l`. */
export const SENSORS_NODES = { vcc: 'vcc', env: 'env', divTop: 'vd', vin: 'vin', vref: 'vref', out: 'out', ledAnode: 'nl',
  ctl: 'c_ctl', op: 'c_op', comparatorProbe: 'vcpc' } as const;
export const SENSORS_LIMITS = { maxVolts: 30, fixed: [100, 1e6], series: [10, 1e5], minStep: 1e-6, maxStop: 20, maxPoints: 200_000, maxEnvPoints: 32 } as const;

function finite(name: string, v: number, lo: number, hi: number): void {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} must be a finite number in ${lo}…${hi} (got ${v})`);
}

export const sensorOhms = (env: number, s: SensorSpec): number => (s.kind === 'ldr' ? ldrOhms(env, s.ldr) : ntcOhms(env, s.ntc));
export const sensorDomain = (s: SensorSpec): [number, number] => (s.kind === 'ldr' ? s.ldr.luxDomain : s.ntc.celsiusDomain);

export function validateSensors(c: SensorsDescription): void {
  if (c.topology !== 'sensors') throw new Error(`Not a sensors description (topology ${String(c.topology)})`);
  const L = SENSORS_LIMITS;
  finite('Supply voltage', c.supplyVolts, 0.5, L.maxVolts);
  finite('Fixed resistor', c.fixedOhms, L.fixed[0], L.fixed[1]);
  if (c.sensor.kind === 'ldr') validateLdr(c.sensor.ldr); else validateNtc(c.sensor.ntc);
  validatePot(c.reference, 'Reference potentiometer');
  validateComparator(c.comparator);
  finite('Series resistance', c.seriesOhms, L.series[0], L.series[1]);
  validateLed(c.led);
  finite('Output step', c.stepSeconds, L.minStep, L.maxStop); finite('Stop time', c.stopSeconds, c.stepSeconds, L.maxStop);
  if (c.stopSeconds / c.stepSeconds > L.maxPoints) throw new Error(`That horizon needs ${Math.round(c.stopSeconds / c.stepSeconds)} output points, above the ${L.maxPoints} limit.`);
  const e = c.environment, [lo, hi] = sensorDomain(c.sensor);
  if (e.length < 2 || e.length > L.maxEnvPoints) throw new Error(`The environment programme needs 2…${L.maxEnvPoints} corners (got ${e.length}).`);
  if (e[0].atSeconds !== 0) throw new Error('The environment programme must state its value at 0 s.');
  e.forEach((p, k) => {
    finite(`Environment corner ${k} time`, p.atSeconds, 0, c.stopSeconds);
    // EVERY CORNER INSIDE THE DECLARED SENSOR DOMAIN: a programme that leaves it is refused here,
    // before the solve, with the domain named.
    if (!Number.isFinite(p.value) || p.value < lo || p.value > hi)
      throw new Error(`Environment corner ${k} (${p.value}) is outside the ${c.sensor.kind.toUpperCase()}'s declared domain ${lo}…${hi} ${c.sensor.kind === 'ldr' ? 'lux' : '°C'}.`);
    if (k > 0 && !(p.atSeconds > e[k - 1].atSeconds)) throw new Error(`Environment corners must be strictly increasing in time (corner ${k}).`);
  });
  // The LED's worst case: comparator fully high through R_out and R_s into the LED at its knee.
  const worst = (c.supplyVolts - 1.5) / (c.comparator.rOutOhms + c.seriesOhms);
  if (worst > c.led.maxForwardAmps)
    throw new Error(`With the output high the LED could see about ${(worst * 1e3).toFixed(1)} mA, above its ${(c.led.maxForwardAmps * 1e3).toFixed(0)} mA maximum; raise the series resistor.`);
}

export function buildSensorsNetlist(c: SensorsDescription): string {
  validateSensors(c);
  const N = SENSORS_NODES;
  const lines = ['* Flux Garden: sensing bench (prescribed environment, resistive sensor, comparator, LED)'];
  lines.push(`Vcc ${N.vcc} 0 DC ${c.supplyVolts}`);
  lines.push(`Venv ${N.env} 0 PWL(${c.environment.map((p) => `${p.atSeconds} ${p.value}`).join(' ')})`);
  // The divider, with a 0 V probe at its top so the divider current is a solver output.
  lines.push(`Vdiv ${N.vcc} ${N.divTop} DC 0`);
  // THE PARTS LIBRARY EMITS THE SENSOR AND THE COMPARATOR (parts.ts), each under its instance name.
  if (c.sensor.kind === 'ldr') { lines.push(`Rfix ${N.divTop} ${N.vin} ${c.fixedOhms}`); lines.push(...emitLdr('s', N.vin, '0', N.env, c.sensor.ldr)); }
  else { lines.push(...emitNtc('s', N.divTop, N.vin, N.env, c.sensor.ntc)); lines.push(`Rfix ${N.vin} 0 ${c.fixedOhms}`); }
  lines.push(...emitPotentiometer('p', N.vcc, N.vref, '0', c.reference));
  lines.push(...emitComparator('c', { inp: N.vin, inn: N.vref, out: N.out, vcc: N.vcc }, c.comparator));
  lines.push(`Rs ${N.out} ${N.ledAnode} ${c.seriesOhms}`);
  lines.push(...emitLed('l', N.ledAnode, '0', c.led));
  lines.push('.options reltol=1e-4');
  lines.push(`.tran ${c.stepSeconds} ${c.stopSeconds} 0 ${c.stepSeconds}`);
  lines.push('.end');
  const netlist = lines.join('\n') + '\n';
  assertAscii(netlist);
  return netlist;
}
