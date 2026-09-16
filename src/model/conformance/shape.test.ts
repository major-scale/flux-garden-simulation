import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkCompositionShape } from './shape';
import { checkContract, type TaskContract } from './contract';
import { buildStructure, type Composition } from './composition';
import { runConformance } from './kit';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../../tools/conformance/${path}`, import.meta.url), 'utf8'));
const contract = read('pilot/rc-design.contract.json') as TaskContract;
describe('composition shape boundary', () => {
  it('reports actual pilot mistakes together, without claiming a present load is missing', () => {
    const c = read('pilot/run-005-deepseek/attempt-1.composition.json');
    const before = JSON.stringify(c);
    const issues = checkCompositionShape(c);
    expect(issues.map(i => i.where)).toEqual(expect.arrayContaining(['sources', 'parts', 'parts.c1.spec.farads']));
    expect(issues.find(i => i.where === 'parts')?.message).toContain('array');
    expect(issues.find(i => i.where === 'parts.c1.spec.farads')?.message).toContain('allowed range or fixed value');
    expect(checkContract(c, contract)).toEqual(issues);
    expect(JSON.stringify(c)).toBe(before);
  });
  it('preserves valid nested models, sensor domains and switch programmes', () => {
    for (const name of ['rc-step', 'rl-step', 'controls-bench', 'motor-switch-flyback', 'sensing-ldr']) {
      const c = read(`fixtures/${name}.composition.json`);
      expect(checkCompositionShape(c), name).toEqual([]);
      expect(() => buildStructure(c)).not.toThrow();
    }
  });
  it('handles null roots, array roots, null entries and malformed points without TypeErrors', () => {
    for (const value of [null, [], 3, {sources: [null], parts: [null], analysis: null},
      {sources: [{kind: 'pwl', points: [null]}], parts: [], analysis: {}}]) {
      expect(checkCompositionShape(value).length).toBeGreaterThan(0);
      expect(() => buildStructure(value as unknown as Composition)).toThrow(/Expected/);
    }
  });
  it('never invokes the solver on shape failures, including a null root', async () => {
    let calls = 0;
    const engine = {name: 'must-not-run', version: 'test', async run() { calls++; throw new Error('solver invoked'); }};
    for (const c of [null, read('pilot/run-005-deepseek/attempt-3.composition.json')]) {
      const report = await runConformance(c as Composition, read('fixtures/rc-step.expectations.json'), engine);
      expect(report.verdict).toBe('fail');
      expect(report.results[0].message).toContain('composition-shape');
    }
    expect(calls).toBe(0);
  });
});
