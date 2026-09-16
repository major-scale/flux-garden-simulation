/** The saved controls session, validated on load. */
import { validateControls, type ControlsDescription } from './spice/controls-netlist';
export const CONTROLS_FORMAT = 'flux-controls-1';
export const encodeControlsDoc = (c: ControlsDescription): string => JSON.stringify({ format: CONTROLS_FORMAT, circuit: c }, null, 2);
const num = (v: unknown, n: string): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${n} must be a finite number`); return v; };
const obj = (v: unknown, n: string): Record<string, unknown> => { if (!v || typeof v !== 'object') throw new Error(`The document has no ${n}.`); return v as Record<string, unknown>; };
export function decodeControlsDoc(text: string): ControlsDescription {
  let doc: unknown; try { doc = JSON.parse(text); } catch { throw new Error('Not a JSON document.'); }
  const d = obj(doc, 'document');
  if (d.format !== CONTROLS_FORMAT) throw new Error(`Not a controls document (format ${JSON.stringify(d.format ?? 'missing')}; expected ${CONTROLS_FORMAT}).`);
  const c = obj(d.circuit, 'circuit'), t = obj(c.toggle, 'toggle'), ts = obj(t.spec, 'toggle spec'), p = obj(c.pot, 'potentiometer'), l = obj(c.led, 'LED'), lp = obj(l.part, 'LED part');
  const circuit: ControlsDescription = {
    topology: 'controls', supplyVolts: num(c.supplyVolts, 'supplyVolts'),
    toggle: { closed: t.closed === true, closeAtSeconds: num(t.closeAtSeconds, 'closeAtSeconds'), edgeSeconds: num(t.edgeSeconds, 'edgeSeconds'),
      spec: { rOnOhms: num(ts.rOnOhms, 'rOnOhms'), rOffOhms: num(ts.rOffOhms, 'rOffOhms') } },
    pot: { totalOhms: num(p.totalOhms, 'totalOhms'), wiperFraction: num(p.wiperFraction, 'wiperFraction'), endOhms: num(p.endOhms, 'endOhms'), contactOhms: num(p.contactOhms, 'contactOhms') },
    seriesOhms: num(c.seriesOhms, 'seriesOhms'),
    led: { part: { is: num(lp.is, 'is'), n: num(lp.n, 'n'), rs: num(lp.rs, 'rs'), cjo: num(lp.cjo, 'cjo'), tt: num(lp.tt, 'tt'), bv: num(lp.bv, 'bv'), ibv: num(lp.ibv, 'ibv') },
      referenceAmps: num(l.referenceAmps, 'referenceAmps'), maxForwardAmps: num(l.maxForwardAmps, 'maxForwardAmps') },
    stopSeconds: num(c.stopSeconds, 'stopSeconds'), stepSeconds: num(c.stepSeconds, 'stepSeconds'),
  };
  validateControls(circuit);
  return circuit;
}
