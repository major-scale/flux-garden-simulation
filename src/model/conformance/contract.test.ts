/** THE TASK CONTRACT: the pilot's frozen contract admits the intended candidates and refuses each way of cheating, by NAME. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkContract, type TaskContract } from './contract';
import type { Composition } from './composition';

const contract = JSON.parse(readFileSync(new URL('../../../tools/conformance/pilot/rc-design.contract.json', import.meta.url), 'utf8')) as TaskContract;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const candidate = (R: number, C: number): Composition => ({ id: 'cand', sources: [clone(contract.source)], parts: [
  { kind: 'resistor', name: 'r', ports: { a: 'vin', b: 'vc' }, spec: { ohms: R } },
  { kind: 'capacitor', name: 'c', ports: { plus: 'vc', minus: '0' }, spec: { farads: C } }], analysis: clone(contract.analysis) });
const causes = (c: Composition) => checkContract(c, contract).map((v) => v.cause);

describe('rc-design contract', () => {
  it('admits a candidate inside the ranges', () => { expect(causes(candidate(4000, 5e-7))).toEqual([]); expect(causes(candidate(20000, 1e-7))).toEqual([]); });
  it('refuses a changed source, a shortened run, an extra part, a renamed part, a wrong kind, an out-of-range value, an extra spec field, a foreign node, a missing part', () => {
    const src = candidate(4000, 5e-7); (src.sources[0] as { points: { value: number }[] }).points[2].value = 4; expect(causes(src)).toContain('contract-source');
    const two = candidate(4000, 5e-7); two.sources.push(clone(contract.source)); expect(causes(two)).toContain('contract-source');
    const run = candidate(4000, 5e-7); run.analysis.stopSeconds = 0.006; expect(causes(run)).toContain('contract-analysis');
    const extra = candidate(4000, 5e-7); extra.parts.push({ kind: 'resistor', name: 'r2', ports: { a: 'vc', b: '0' }, spec: { ohms: 1e5 } }); expect(causes(extra)).toEqual(expect.arrayContaining(['contract-part-count', 'contract-part-name']));
    const renamed = candidate(4000, 5e-7); (renamed.parts[1] as { name: string }).name = 'cap'; expect(causes(renamed)).toEqual(expect.arrayContaining(['contract-part-name', 'contract-part-missing']));
    const kind = candidate(4000, 5e-7); (kind.parts[1] as { kind: string }).kind = 'inductor'; expect(causes(kind)).toContain('contract-part-kind');
    expect(causes(candidate(1000, 5e-7))).toContain('contract-spec-range'); expect(causes(candidate(4000, 2e-6))).toContain('contract-spec-range');
    const field = candidate(4000, 5e-7); (field.parts[1].spec as { initialVolts?: number }).initialVolts = 1; expect(causes(field)).toContain('contract-spec-field');
    const node = candidate(4000, 5e-7); (node.parts[1] as { ports: { plus: string; minus: string } }).ports = { plus: 'vc', minus: 'gnd' }; expect(causes(node)).toContain('contract-node');
    const missing = candidate(4000, 5e-7); missing.parts.pop(); expect(causes(missing)).toContain('contract-part-missing');
  });
  it('does not freeze the wiring: a reversed capacitor passes the contract (the electrical checks judge it)', () => {
    const rev = candidate(4000, 5e-7); (rev.parts[1] as { ports: { plus: string; minus: string } }).ports = { plus: '0', minus: 'vc' }; expect(causes(rev)).toEqual([]);
  });
});
