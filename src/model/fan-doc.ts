/** The saved fan experiment: the whole composition under its own format tag, accepted ONLY if it is the trial's circuit with a supported supply and programme. */
import type { Composition } from './conformance/composition';
import { assertSupportedFan } from './fan';

export const FAN_FORMAT = 'flux-fan-1';
export const encodeFanDoc = (c: Composition): string => JSON.stringify({ format: FAN_FORMAT, composition: c }, null, 2);

export function decodeFanDoc(text: string): Composition {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { throw new Error('Not a JSON document.'); }
  if (!doc || typeof doc !== 'object') throw new Error('The document is not an object.');
  const d = doc as Record<string, unknown>;
  if (d.format !== FAN_FORMAT) throw new Error(`Not a fan document (format ${JSON.stringify(d.format ?? 'missing')}; expected ${FAN_FORMAT}).`);
  if (!d.composition || typeof d.composition !== 'object') throw new Error('The document has no composition.');
  const c = d.composition as Composition;
  assertSupportedFan(c);           // the base circuit with supported edits only — everything else is refused by name
  return c;
}
