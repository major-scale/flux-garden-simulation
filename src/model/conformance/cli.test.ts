/**
 * THE ONE COMMAND (`tools/conform.mjs`) end to end: the valid path exits 0 with every automated stage PASS and render
 * PENDING; each intended failure exits 1 with its stage named — the unchanged starter against the pilot task (contract
 * violations by name), an unsupported view kind, an unsupported layout topology. Spawns node; needs the WASM engine.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;
const run = (args: string[]) => { const out = join(mkdtempSync(join(tmpdir(), 'conform-')), 'report.json'); const r = spawnSync('node', ['tools/conform.mjs', ...args, '--out', out], { cwd: ROOT, encoding: 'utf8', timeout: 180000 }); return { code: r.status, stdout: r.stdout + r.stderr, report: JSON.parse(readFileSync(out, 'utf8')) }; };
const FX = 'tools/conformance/fixtures', PILOT = 'tools/conformance/pilot';

describe('tools/conform.mjs stages', () => {
  it('rejects contract-shaped input and invalid JSON before solver/layout with a machine-readable shape report', () => {
    const malformed = run([`${PILOT}/run-005-deepseek/attempt-1.composition.json`, `${FX}/rc-step.expectations.json`, '--layout', '--contract', `${PILOT}/rc-design.contract.json`]);
    expect(malformed.code).toBe(1);
    expect(malformed.report.stages.shape.diagnostics.map((d: {where: string}) => d.where)).toEqual(expect.arrayContaining(['sources', 'parts', 'parts.c1.spec.farads']));
    for (const stage of ['contract', 'electrical', 'layout', 'view', 'render']) expect(malformed.report.stages[stage].verdict).toBe('skipped');
    expect(malformed.stdout).not.toContain('contract-part-missing');
    const path = join(mkdtempSync(join(tmpdir(), 'bad-json-')), 'bad.json'); writeFileSync(path, '{');
    const badJson = run([path, `${FX}/rc-step.expectations.json`, '--layout']);
    expect(badJson.code).toBe(1); expect(badJson.report.stages.shape.diagnostics[0].cause).toBe('composition-json');
  }, 200000);
  it('valid path: rc-step with --layout → exit 0, contract absent, electrical/layout/view PASS, render PENDING, manifest complete', () => {
    const r = run([`${FX}/rc-step.composition.json`, `${FX}/rc-step.expectations.json`, '--layout']);
    expect(r.code).toBe(0); expect(r.stdout).toMatch(/AUTOMATED STAGES PASS · render PENDING/);
    expect(r.report.stages.electrical.verdict).toBe('pass'); expect(r.report.stages.layout.verdict).toBe('pass'); expect(r.report.stages.view.verdict).toBe('pass'); expect(r.report.stages.render.verdict).toBe('pending'); expect(r.report.stages.contract).toBeUndefined();
    for (const [f, h] of Object.entries(r.report.manifest.files as Record<string, string | null>)) expect(h, f).toMatch(/^[0-9a-f]{64}$/);
    expect(r.report.manifest.eecircuitEngine).toBe('1.8.0');
  }, 200000);
  it('the pilot task: the UNCHANGED starter fails the contract by name (source, analysis, range) and the checks; a reference solution passes every automated stage', () => {
    const bad = run([`${FX}/rc-step.composition.json`, `${PILOT}/rc-design.expectations.json`, '--layout', '--contract', `${PILOT}/rc-design.contract.json`]);
    expect(bad.code).toBe(1); expect(bad.report.stages.contract.verdict).toBe('fail');
    expect(bad.report.stages.contract.violations.map((v: { cause: string }) => v.cause)).toEqual(expect.arrayContaining(['contract-source', 'contract-analysis', 'contract-spec-range']));
    expect(bad.report.stages.electrical.verdict).not.toBe('pass'); expect(bad.stdout).toMatch(/AUTOMATED STAGES FAIL · render PENDING/);
    // the reference solution lives HERE, not in the builder-readable task bundle
    const contract = JSON.parse(readFileSync(join(ROOT, PILOT, 'rc-design.contract.json'), 'utf8'));
    const ref = { id: 'reference-solution', sources: [contract.source], parts: [{ kind: 'resistor', name: 'r', ports: { a: 'vin', b: 'vc' }, spec: { ohms: 4000 } }, { kind: 'capacitor', name: 'c', ports: { plus: 'vc', minus: '0' }, spec: { farads: 5e-7 } }], analysis: contract.analysis };
    const path = join(mkdtempSync(join(tmpdir(), 'ref-')), 'ref.json'); writeFileSync(path, JSON.stringify(ref));
    const good = run([path, `${PILOT}/rc-design.expectations.json`, '--layout', '--contract', `${PILOT}/rc-design.contract.json`]);
    expect(good.code).toBe(0); expect(good.report.stages.contract.verdict).toBe('pass'); expect(good.report.stages.electrical.verdict).toBe('pass'); expect(good.report.stages.layout.verdict).toBe('pass'); expect(good.report.stages.view.verdict).toBe('pass'); expect(good.report.stages.render.verdict).toBe('pending');
  }, 400000);
  it('an unsupported view kind (the controls bench has a pot) → view UNSUPPORTED by name, exit 1, electrical still PASS', () => {
    const r = run([`${FX}/controls-bench.composition.json`, `${FX}/controls-bench.expectations.json`, '--layout']);
    expect(r.code).toBe(1); expect(r.report.stages.electrical.verdict).toBe('pass'); expect(r.report.stages.view.verdict).toBe('unsupported'); expect(r.report.stages.view.unsupported).toEqual([{ name: 'p', kind: 'pot' }]);
  }, 200000);
  it('an unsupported layout topology (inductor rail → ground) → layout FAIL unsupported-topology naming the part, exit 1', () => {
    const c = JSON.parse(readFileSync(join(ROOT, FX, 'rl-step.composition.json'), 'utf8')); c.parts[1].ports = { plus: 'vin', minus: '0' };
    const path = join(mkdtempSync(join(tmpdir(), 'rl-')), 'rl.json'); writeFileSync(path, JSON.stringify(c));
    const r = run([path, `${FX}/rl-step.expectations.json`, '--layout']);
    expect(r.code).toBe(1); expect(r.report.stages.layout.verdict).toBe('fail'); expect(r.report.stages.layout.diagnostics[0].cause).toBe('unsupported-topology'); expect(r.report.stages.layout.diagnostics[0].where).toBe('l');
  }, 200000);
});
