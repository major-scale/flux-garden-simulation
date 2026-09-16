/**
 * THE SAVED LAMP SESSION: the circuit description, whole, under its own format tag.
 *
 * A lamp file and an RLC file are different documents and say so in their first field, so the
 * RC page's loader can refuse one with a format message rather than misread it, and this loader
 * likewise. Only known fields are kept on load; the description is then validated exactly as it
 * would be before a solve, so a hand-edited file that cannot be solved is refused at load with
 * the solver's own reason.
 */
import { validateLamp, type GateProgramme, type LampDescription, type MosfetSpec } from './spice/lamp-netlist';

export const LAMP_FORMAT = 'flux-lamp-1';

export function encodeLampDoc(circuit: LampDescription): string {
  return JSON.stringify({ format: LAMP_FORMAT, circuit }, null, 2);
}

const num = (v: unknown, name: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
  return v;
};

export function decodeLampDoc(text: string): LampDescription {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { throw new Error('Not a JSON document.'); }
  if (!doc || typeof doc !== 'object') throw new Error('Not a lamp document.');
  const d = doc as Record<string, unknown>;
  if (d.format !== LAMP_FORMAT)
    throw new Error(`Not a lamp document (format ${JSON.stringify(d.format ?? 'missing')}; expected ${LAMP_FORMAT}).`);
  const c = d.circuit as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') throw new Error('The document has no circuit.');
  const m = c.mosfet as Record<string, unknown> | undefined;
  if (!m || typeof m !== 'object') throw new Error('The document has no transistor.');
  const mosfet: MosfetSpec = {
    vto: num(m.vto, 'vto'), kp: num(m.kp, 'kp'), lambda: num(m.lambda, 'lambda'), tox: num(m.tox, 'tox'),
    cgso: num(m.cgso, 'cgso'), cgdo: num(m.cgdo, 'cgdo'), widthM: num(m.widthM, 'widthM'), lengthM: num(m.lengthM, 'lengthM'),
  };
  const g = c.gate as Record<string, unknown> | undefined;
  if (!g || typeof g !== 'object') throw new Error('The document has no gate programme.');
  let gate: GateProgramme;
  if (g.kind === 'pwl') {
    if (!Array.isArray(g.points)) throw new Error('A PWL gate programme needs points.');
    gate = { kind: 'pwl', points: (g.points as Record<string, unknown>[]).map((p, k) =>
      ({ atSeconds: num(p.atSeconds, `points[${k}].atSeconds`), volts: num(p.volts, `points[${k}].volts`) })) };
  } else if (g.kind === 'sine') {
    gate = { kind: 'sine', offsetVolts: num(g.offsetVolts, 'offsetVolts'),
      amplitudeVolts: num(g.amplitudeVolts, 'amplitudeVolts'), frequencyHz: num(g.frequencyHz, 'frequencyHz') };
  } else throw new Error(`Unknown gate programme kind ${JSON.stringify(g.kind)}.`);
  const circuit: LampDescription = {
    topology: 'lamp', supplyVolts: num(c.supplyVolts, 'supplyVolts'), lampOhms: num(c.lampOhms, 'lampOhms'),
    gateOhms: num(c.gateOhms, 'gateOhms'), mosfet, gate,
    stopSeconds: num(c.stopSeconds, 'stopSeconds'), stepSeconds: num(c.stepSeconds, 'stepSeconds'),
  };
  validateLamp(circuit);
  return circuit;
}
