import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStructure } from '../conformance/composition';
import { importSpiceSubset, SpiceImportError } from './spice-subset';

const original = readFileSync(resolve('tools/circuit-import/upstream/ngspice-rc/rc.cir'), 'utf8');
const fail = (text: string, cause: string, line?: number) => {
  try { importSpiceSubset(text); throw new Error('expected import to fail'); }
  catch (e) {
    expect(e).toBeInstanceOf(SpiceImportError);
    expect((e as SpiceImportError).cause_).toBe(cause);
    if (line !== undefined) expect((e as SpiceImportError).line).toBe(line);
  }
};

describe('bounded SPICE subset importer', () => {
  it('imports the preserved ngspice RC deck into the public composition surface', () => {
    const a = importSpiceSubset(original, 'ngspice-rc'), b = importSpiceSubset(original, 'ngspice-rc');
    expect(a).toEqual(b);
    expect(a.manifest.identities).toEqual([
      { spiceName: 'r', stableId: 'r', kind: 'resistor', line: 2 },
      { spiceName: 'c', stableId: 'c', kind: 'capacitor', line: 4 },
      { spiceName: 'vin', stableId: 'vin', kind: 'source', line: 5 },
    ]);
    expect(a.manifest.nodes).toEqual({ '0': '0', '1': 'n1', '2': 'n2' });
    expect(a.composition.sources[0]).toEqual({ kind: 'pwl', name: 'vin', plus: 'n1', minus: '0', points: [
      { atSeconds: 0, value: 0 }, { atSeconds: 0.1, value: 1 }, { atSeconds: 7, value: 1 },
    ] });
    expect(a.composition.parts.map((p) => [p.kind, p.name])).toEqual([['resistor', 'r'], ['capacitor', 'c']]);
    const structure = buildStructure(a.composition);
    expect(structure.netlist).toContain('Vvin n1 0 PWL(0 0 0.1 1 7 1)');
    expect(structure.netlist).toContain('.tran 0.1 7 0 0.1');
  });

  it('keeps identity stable across whitespace and keyword case', () => {
    const variant = original.replace('r 1 2 1.0', 'R   1   2   1.0').replace('.tran  0.1 7.0', '.TRAN 0.1 7.0');
    expect(importSpiceSubset(variant).manifest.identities.map((x) => x.stableId)).toEqual(['r', 'c', 'vin']);
  });

  it('rejects unsupported syntax and models with named line diagnostics', () => {
    fail('title\nq1 1 2 0 npn\n.tran 1u 1m\n.end\n', 'unsupported-device', 2);
    fail('title\n.model npn npn\nv1 1 0 1\nr1 1 0 1k\n.tran 1u 1m\n.end\n', 'unsupported-directive', 2);
    fail('title\nr1 1 0 1k\n+ tc=1\nv1 1 0 1\n.tran 1u 1m\n.end\n', 'continuation', 3);
    fail('title\nr1 1 0 1k\nv1 1 0 sin(0 1 1k)\n.tran 1u 1m\n.end\n', 'unsupported-source', 3);
    fail('title\nr1 1 0 1k\nv1 1 0 1\n.options method=gear\n.tran 1u 1m\n.end\n', 'unsupported-option', 4);
  });

  it('rejects case-insensitive duplicate identities rather than renaming them', () => {
    fail('title\nr1 1 0 1k\nR1 1 0 2k\nv1 1 0 1\n.tran 1u 1m\n.end\n', 'duplicate-identity', 3);
  });

  it('refuses distinct SPICE nodes that would normalize to one Flux node', () => {
    fail('title\nv1 1 0 1\nr1 1 n1 1000\nr2 n1 0 1000\n.tran .1 1\n.end\n', 'node-identity-collision', 3);
  });

  it('treats the physical first line as title even when it begins with a comment marker', () => {
    const result = importSpiceSubset('* title\nr1 1 2 1000\nv1 1 0 1\nc1 2 0 1u\n.tran .1 1\n.end\n');
    expect(result.manifest.title).toBe('* title');
    expect(result.manifest.identities.map((x) => x.stableId)).toEqual(['r1', 'v1', 'c1']);
  });

  it('treats a blank physical first line as title without dropping the first element', () => {
    const result = importSpiceSubset('\nr1 1 0 1k\nv1 1 0 1\n.tran .1 1\n.end\n');
    expect(result.manifest.title).toBe('');
    expect(result.manifest.identities.map((x) => x.stableId)).toEqual(['r1', 'v1']);
  });

  it('stores prototype-like node names as ordinary own mappings and preserves case aliases', () => {
    const result = importSpiceSubset('title\nv1 constructor 0 1\nr1 constructor toString 1k\nr2 TOSTRING 0 1k\n.tran .1 1\n.end\n');
    expect(result.manifest.nodes).toEqual({ '0': '0', constructor: 'constructor', tostring: 'tostring' });
    expect(result.composition.sources[0]).toMatchObject({ plus: 'constructor' });
    expect(result.composition.parts[0].ports).toEqual({ a: 'constructor', b: 'tostring' });
    expect(result.composition.parts[1].ports).toEqual({ a: 'tostring', b: '0' });
    expect(buildStructure(result.composition).externalNodes).toEqual(new Set(['0', 'constructor', 'tostring']));
  });
});
