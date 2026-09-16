import { describe, it, expect } from 'vitest';
import { encodeLampDoc, decodeLampDoc } from './lamp-doc';
import { LAMP_PRESETS } from './lamp-presets';

describe('the lamp document', () => {
  it('round-trips every preset exactly', () => {
    for (const p of LAMP_PRESETS) {
      const c = p.build();
      expect(decodeLampDoc(encodeLampDoc(c))).toEqual(c);
    }
  });
  it('refuses another format by name rather than misreading it', () => {
    expect(() => decodeLampDoc(JSON.stringify({ format: 'flux-rlc-1', inputs: {} })))
      .toThrow(/Not a lamp document \(format "flux-rlc-1"/);
    expect(() => decodeLampDoc('nope')).toThrow(/Not a JSON document/);
  });
  it('validates the loaded circuit as the solver would', () => {
    const c = LAMP_PRESETS[0].build();
    const bad = JSON.parse(encodeLampDoc(c));
    bad.circuit.lampOhms = -5;
    expect(() => decodeLampDoc(JSON.stringify(bad))).toThrow(/Lamp resistance/);
  });
});
