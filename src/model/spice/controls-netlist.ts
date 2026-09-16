/**
 * THE CONTROLS BENCH: supply → toggle → potentiometer (A) … wiper (W) → series resistor → LED →
 * ground, with the pot's end B at ground. A fixed topology composed from the shared parts
 * library (`parts.ts`); only its parameters vary.
 *
 * THE RUN. These parts have no dynamics, so a "run" is the toggle CLOSING at a programmed finite
 * edge inside a short transient — the operating point at t = 0 has the switch open and the LED
 * dark, and the closure is what the viewer watches. The wiper fraction and the toggle's chosen
 * state are BETWEEN-RUN controls: every change is a new solve and a new run; nothing continues
 * stored state, because there is none. A toggle left open never closes.
 *
 * Wiper fraction f: 0 = at end A (the supply side, full), 1 = at end B (ground, low).
 * `totalOhms` is the NOMINAL TRACK resistance; each leg carries an extra `endOhms` and the wiper
 * lead a `contactOhms`, disclosed on the page, so end-to-end reads R + 2·R_end.
 */
import { assertAscii } from './netlist';
import { pulseControl, emitSwitch, emitPotentiometer, emitLed, validateSwitch, validatePot, validateLed,
  type SwitchSpec, type PotSpec, type LedSpec } from './parts';

export interface ControlsDescription {
  topology: 'controls';
  supplyVolts: number;
  toggle: { closed: boolean; closeAtSeconds: number; edgeSeconds: number; spec: SwitchSpec };
  pot: PotSpec;
  seriesOhms: number;
  led: LedSpec;
  stopSeconds: number;
  stepSeconds: number;
}

export const CONTROLS_NODES = { supply: 'nd', control: 'ctl', potA: 'na', wiper: 'nw', ledAnode: 'nl' } as const;
export const CONTROLS_LIMITS = { maxVolts: 60, series: [1, 1e6], minStep: 1e-7, maxStop: 1, maxPoints: 200_000 } as const;

function finite(name: string, v: number, lo: number, hi: number): void {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} must be a finite number in ${lo}…${hi} (got ${v})`);
}

export function validateControls(c: ControlsDescription): void {
  if (c.topology !== 'controls') throw new Error(`Not a controls description (topology ${String(c.topology)})`);
  finite('Supply voltage', c.supplyVolts, 0, CONTROLS_LIMITS.maxVolts);
  validateSwitch(c.toggle.spec, 'Toggle');
  validatePot(c.pot);
  finite('Series resistance', c.seriesOhms, CONTROLS_LIMITS.series[0], CONTROLS_LIMITS.series[1]);
  validateLed(c.led);
  finite('Output step', c.stepSeconds, CONTROLS_LIMITS.minStep, CONTROLS_LIMITS.maxStop);
  finite('Stop time', c.stopSeconds, c.stepSeconds, CONTROLS_LIMITS.maxStop);
  if (c.stopSeconds / c.stepSeconds > CONTROLS_LIMITS.maxPoints)
    throw new Error(`That horizon needs ${Math.round(c.stopSeconds / c.stepSeconds)} output points, above the ${CONTROLS_LIMITS.maxPoints} limit.`);
  finite('Toggle edge', c.toggle.edgeSeconds, c.stepSeconds, c.stopSeconds);
  finite('Toggle closing time', c.toggle.closeAtSeconds, c.toggle.edgeSeconds, c.stopSeconds - c.toggle.edgeSeconds);
}

export function buildControlsNetlist(c: ControlsDescription): string {
  validateControls(c);
  const N = CONTROLS_NODES;
  const lines = ['* Flux Garden: controls bench (toggle, potentiometer, LED), composed from the parts library'];
  lines.push(`Vdd ${N.supply} 0 DC ${c.supplyVolts}`);
  lines.push(`Vsw ${N.control} 0 ${pulseControl(c.toggle.closed ? c.toggle.closeAtSeconds : null, null, c.toggle.edgeSeconds, c.stopSeconds)}`);
  lines.push(...emitSwitch('t', N.supply, N.potA, N.control, c.toggle.spec));
  lines.push(...emitPotentiometer('p', N.potA, N.wiper, '0', c.pot));
  lines.push(`Rs ${N.wiper} ${N.ledAnode} ${c.seriesOhms}`);
  lines.push(...emitLed('l', N.ledAnode, '0', c.led));
  lines.push('.options reltol=1e-4');
  lines.push(`.tran ${c.stepSeconds} ${c.stopSeconds} 0 ${c.stepSeconds}`);
  lines.push('.end');
  const netlist = lines.join('\n') + '\n';
  assertAscii(netlist);
  return netlist;
}
