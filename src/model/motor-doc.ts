/** The saved motor session: the whole description under its own format tag, validated on load. */
import { validateMotor, type MotorDescription } from './spice/motor-netlist';

export const MOTOR_FORMAT = 'flux-motor-1';
export const encodeMotorDoc = (circuit: MotorDescription): string => JSON.stringify({ format: MOTOR_FORMAT, circuit }, null, 2);

const num = (v: unknown, name: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
  return v;
};
const numOrNull = (v: unknown, name: string): number | null => (v === null ? null : num(v, name));
const obj = (v: unknown, name: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object') throw new Error(`The document has no ${name}.`);
  return v as Record<string, unknown>;
};

export function decodeMotorDoc(text: string): MotorDescription {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { throw new Error('Not a JSON document.'); }
  const d = obj(doc, 'document');
  if (d.format !== MOTOR_FORMAT)
    throw new Error(`Not a motor document (format ${JSON.stringify(d.format ?? 'missing')}; expected ${MOTOR_FORMAT}).`);
  const c = obj(d.circuit, 'circuit'), m = obj(c.motor, 'motor'), l = obj(c.load, 'load'), s = obj(c.switch, 'switch'),
    f = obj(c.freewheel, 'freewheel diode'), p = obj(c.programme, 'programme');
  const circuit: MotorDescription = {
    topology: 'motor', supplyVolts: num(c.supplyVolts, 'supplyVolts'),
    motor: { resistanceOhms: num(m.resistanceOhms, 'resistanceOhms'), inductanceHenries: num(m.inductanceHenries, 'inductanceHenries'),
      kVsPerRad: num(m.kVsPerRad, 'kVsPerRad'), rotorInertiaKgM2: num(m.rotorInertiaKgM2, 'rotorInertiaKgM2'), viscousNmS: num(m.viscousNmS, 'viscousNmS') },
    load: { massKg: num(l.massKg, 'massKg'), pinionRadiusM: num(l.pinionRadiusM, 'pinionRadiusM'), gravity: num(l.gravity, 'gravity') },
    switch: { rOnOhms: num(s.rOnOhms, 'rOnOhms'), rOffOhms: num(s.rOffOhms, 'rOffOhms') },
    freewheel: { is: num(f.is, 'is'), n: num(f.n, 'n'), rs: num(f.rs, 'rs'), cjo: num(f.cjo, 'cjo'), tt: num(f.tt, 'tt'), bv: num(f.bv, 'bv'), ibv: num(f.ibv, 'ibv') },
    programme: { closeAtSeconds: numOrNull(p.closeAtSeconds, 'closeAtSeconds'), openAtSeconds: numOrNull(p.openAtSeconds, 'openAtSeconds'),
      releaseBrakeAtSeconds: numOrNull(p.releaseBrakeAtSeconds, 'releaseBrakeAtSeconds'), edgeSeconds: num(p.edgeSeconds, 'edgeSeconds') },
    stopSeconds: num(c.stopSeconds, 'stopSeconds'), stepSeconds: num(c.stepSeconds, 'stepSeconds'),
  };
  validateMotor(circuit);
  return circuit;
}
