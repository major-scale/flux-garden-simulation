/**
 * THE SUPPORTED VIEW SUBSET — one list, shared by the bench page and the check command, so the two cannot disagree
 * about which composition kinds have a shared deck body on the bench. A kind absent here is refused BY NAME by both;
 * it is never drawn as something else. (The typed composition accepts more kinds than the bench draws; the rail
 * template has geometry rows for all of them but only the port patterns in its role table lay out.)
 */
import type { PartInstance } from '../model/conformance/composition';
import type { BranchSpec } from './potential-scene';

export const DRAWN_AS: Partial<Record<PartInstance['kind'], BranchSpec['kind']>> = { resistor: 'load', capacitor: 'capacitor', inductor: 'inductor', diode: 'diode', led: 'led', switch: 'switch' };
export const SUPPORTED_VIEW_KINDS: PartInstance['kind'][] = Object.keys(DRAWN_AS) as PartInstance['kind'][];

/** Which parts of a composition the bench cannot draw, by name and kind (empty = every part is supported). */
export function unsupportedViewParts(c: { parts: { name: string; kind: string }[] }): { name: string; kind: string }[] {
  return c.parts.filter((p) => !(p.kind in DRAWN_AS)).map((p) => ({ name: p.name, kind: p.kind }));
}
