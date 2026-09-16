/** The saved sensing session, validated on load. */
import { validateSensors, type SensorsDescription, type SensorSpec } from './spice/sensors-netlist';
export const SENSORS_FORMAT = 'flux-sensors-1';
export const encodeSensorsDoc = (c: SensorsDescription): string => JSON.stringify({ format: SENSORS_FORMAT, circuit: c }, null, 2);
const num = (v: unknown, n: string): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${n} must be a finite number`); return v; };
const obj = (v: unknown, n: string): Record<string, unknown> => { if (!v || typeof v !== 'object') throw new Error(`The document has no ${n}.`); return v as Record<string, unknown>; };
const pair = (v: unknown, n: string): [number, number] => { if (!Array.isArray(v) || v.length !== 2) throw new Error(`${n} must be a pair`); return [num(v[0], n), num(v[1], n)]; };
export function decodeSensorsDoc(text: string): SensorsDescription {
  let doc: unknown; try { doc = JSON.parse(text); } catch { throw new Error('Not a JSON document.'); }
  const d = obj(doc, 'document');
  if (d.format !== SENSORS_FORMAT) throw new Error(`Not a sensors document (format ${JSON.stringify(d.format ?? 'missing')}; expected ${SENSORS_FORMAT}).`);
  const c = obj(d.circuit, 'circuit'), s = obj(c.sensor, 'sensor'), r = obj(c.reference, 'reference'), cm = obj(c.comparator, 'comparator'), sw = obj(cm.switch, 'comparator switch'), l = obj(c.led, 'LED'), lp = obj(l.part, 'LED part');
  let sensor: SensorSpec;
  if (s.kind === 'ldr') { const x = obj(s.ldr, 'ldr'); sensor = { kind: 'ldr', ldr: { r10Ohms: num(x.r10Ohms, 'r10Ohms'), gamma: num(x.gamma, 'gamma'), darkOhms: num(x.darkOhms, 'darkOhms'), luxDomain: pair(x.luxDomain, 'luxDomain') } }; }
  else if (s.kind === 'ntc') { const x = obj(s.ntc, 'ntc'); sensor = { kind: 'ntc', ntc: { r0Ohms: num(x.r0Ohms, 'r0Ohms'), t0Kelvin: num(x.t0Kelvin, 't0Kelvin'), betaKelvin: num(x.betaKelvin, 'betaKelvin'), celsiusDomain: pair(x.celsiusDomain, 'celsiusDomain') } }; }
  else throw new Error(`Unknown sensor kind ${JSON.stringify(s.kind)}.`);
  if (!Array.isArray(c.environment)) throw new Error('The document has no environment programme.');
  const circuit: SensorsDescription = {
    topology: 'sensors', supplyVolts: num(c.supplyVolts, 'supplyVolts'), sensor, fixedOhms: num(c.fixedOhms, 'fixedOhms'),
    environment: (c.environment as Record<string, unknown>[]).map((p, k) => ({ atSeconds: num(p.atSeconds, `environment[${k}].atSeconds`), value: num(p.value, `environment[${k}].value`) })),
    reference: { totalOhms: num(r.totalOhms, 'totalOhms'), wiperFraction: num(r.wiperFraction, 'wiperFraction'), endOhms: num(r.endOhms, 'endOhms'), contactOhms: num(r.contactOhms, 'contactOhms') },
    comparator: { gain: num(cm.gain, 'gain'), rOutOhms: num(cm.rOutOhms, 'rOutOhms'), leakOhms: num(cm.leakOhms, 'leakOhms'), switch: { rOnOhms: num(sw.rOnOhms, 'rOnOhms'), rOffOhms: num(sw.rOffOhms, 'rOffOhms') } },
    seriesOhms: num(c.seriesOhms, 'seriesOhms'),
    led: { part: { is: num(lp.is, 'is'), n: num(lp.n, 'n'), rs: num(lp.rs, 'rs'), cjo: num(lp.cjo, 'cjo'), tt: num(lp.tt, 'tt'), bv: num(lp.bv, 'bv'), ibv: num(lp.ibv, 'ibv') }, referenceAmps: num(l.referenceAmps, 'referenceAmps'), maxForwardAmps: num(l.maxForwardAmps, 'maxForwardAmps') },
    stopSeconds: num(c.stopSeconds, 'stopSeconds'), stepSeconds: num(c.stepSeconds, 'stepSeconds'),
  };
  validateSensors(circuit);
  return circuit;
}
