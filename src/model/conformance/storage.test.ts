/**
 * CAPACITOR AND INDUCTOR in the generic composition path (core-primitives first batch): the three fixtures pass every
 * frozen check on the WASM engine; then the controls — a wrong analytic reference, a scaled current, a reversed part,
 * a forced initial state, a DC-floating node, namespace collisions and two-instance privacy — each by NAME.
 */
import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { readFileSync } from 'node:fs';
import { runConformance, type Engine, type ExpectationSet, type Report } from './kit';
import { buildStructure, INITIAL_STATE_POLICY, type Composition } from './composition';
import { emitCapacitor, emitInductor } from '../spice/parts';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`../../../tools/conformance/fixtures/${name}.json`, import.meta.url), 'utf8'));
const wasm: Engine = { name: 'eecircuit-engine (test)', version: 'test', async run(netlist) { const sim = new Simulation(); await sim.start(); sim.setNetList(netlist); return sim.runSim() as never; } };
const scaled = (vector: string, factor: number): Engine => ({ name: 'scaled', version: '0', async run(netlist, vectors) {
  const raw = await wasm.run(netlist, vectors) as { variableNames: string[]; data: { name: string; values: number[] }[] };
  return { ...raw, data: raw.data.map((d) => d.name.toLowerCase() === vector ? { ...d, values: d.values.map((v) => v * factor) } : d) } as never;
} });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const statusOf = (r: Report, id: string) => r.results.find((x) => x.check === id)?.status;
const cause = (fn: () => unknown): string => { try { fn(); return 'no error'; } catch (e) { return (e as { cause_?: string }).cause_ ?? `other: ${e}`; } };

describe('capacitor and inductor fixtures pass every frozen check (WASM)', () => {
  for (const name of ['rc-step', 'rl-step', 'rc-ladder', 'rl-pair']) {
    it(`${name}: PASS with every check executed`, async () => {
      const r = await runConformance(fx(`${name}.composition`), fx(`${name}.expectations`), wasm);
      expect(r.summary).toMatch(/^PASS/); expect(r.verdict).toBe('pass');
      expect(r.results.length).toBe((fx(`${name}.expectations`) as ExpectationSet).checks.length);
      expect(r.engine.samples).toBeGreaterThan(100);
    }, 120000);
  }
  it('the emitters: a 0 V probe in the + lead, the element to −, no ic=, private node <name>_p', () => {
    expect(emitCapacitor('c', 'vc', '0', { farads: 1e-6 })).toEqual(['Vcc vc c_p DC 0', 'Cc c_p 0 0.000001']);
    expect(emitInductor('l', 'vl', '0', { henries: 0.01 })).toEqual(['Vll vl l_p DC 0', 'Ll l_p 0 0.01']);
    const s = buildStructure(fx('rc-step.composition'));
    expect(s.netlist).not.toMatch(/uic|ic=|\.ic/); expect(INITIAL_STATE_POLICY).toBe('operating-point');
    expect(s.observables['c.current']).toBe('i(vcc)'); expect(s.observables['c.vplus']).toBe('v(vc)'); expect(s.findings).toEqual([]);
  });
});

describe('controls: each mistake fails by NAME', () => {
  it('a wrong analytic reference (τ × 1.3) → the reference check FAILS while the element law still passes', async () => {
    const x = clone(fx('rc-step.expectations')) as ExpectationSet; const ref = x.checks.find((c) => c.kind === 'reference') as { tauSeconds: number }; ref.tauSeconds *= 1.3;
    const r = await runConformance(fx('rc-step.composition'), x, wasm);
    expect(statusOf(r, 'rc-step-analytic')).toBe('fail'); expect(statusOf(r, 'capacitor-law-and-energy')).toBe('pass'); expect(r.verdict).toBe('fail');
  }, 120000);
  it('a current vector scaled by 1.1 → storage-law and KCL FAIL (the law is checked against the probe, not assumed)', async () => {
    const r = await runConformance(fx('rc-step.composition'), fx('rc-step.expectations'), scaled('i(vcc)', 1.1));
    expect(statusOf(r, 'capacitor-law-and-energy')).toBe('fail'); expect(statusOf(r, 'kcl-series')).toBe('fail');
    const l = await runConformance(fx('rl-step.composition'), fx('rl-step.expectations'), scaled('v(vl)', 1.1));
    expect(statusOf(l, 'inductor-law-and-energy')).toBe('fail');
  }, 120000);
  it('orientation: the capacitor reversed (plus at ground) → its current is NEGATIVE while charging and the bounds check FAILS; vplus stays 0', async () => {
    const c = clone(fx('rc-step.composition')) as Composition; const cap = c.parts[1] as { ports: { plus: string; minus: string } }; cap.ports = { plus: '0', minus: 'vc' };
    const r = await runConformance(c, fx('rc-step.expectations'), wasm);
    expect(statusOf(r, 'current-bounds')).toBe('fail'); expect(statusOf(r, 'capacitor-law-and-energy')).toBe('pass');   // the law holds in either orientation
    expect(statusOf(r, 'rc-step-analytic')).toBe('fail');   // c.vplus is ground now
  }, 120000);
  it('a forced initial state → unsupported-initial-state (one declared policy: the operating point)', () => {
    const c = clone(fx('rc-step.composition')) as Composition; (c.parts[1].spec as { initialVolts?: number }).initialVolts = 1;
    expect(cause(() => buildStructure(c))).toBe('unsupported-initial-state');
    const l = clone(fx('rl-step.composition')) as Composition; (l.parts[1].spec as { initialAmps?: number }).initialAmps = 0.1;
    expect(cause(() => buildStructure(l))).toBe('unsupported-initial-state');
  });
  it('a node that reaches ground only through capacitors → dc-floating-node finding, and the kit does not solve it', async () => {
    const c = clone(fx('rc-step.composition')) as Composition;
    (c.parts[0] as unknown as { kind: string; ports: { plus: string; minus: string }; spec: { farads: number } }) = { kind: 'capacitor', ports: { plus: 'vin', minus: 'vc' }, spec: { farads: 1e-6 } } as never;
    (c.parts[0] as { name: string }).name = 'cs';
    const s = buildStructure(c); expect(s.findings.map((f) => f.cause)).toEqual(['dc-floating-node']); expect(s.findings[0].where).toBe('vc');
    const r = await runConformance(c, fx('rc-step.expectations'), wasm); expect(r.verdict).not.toBe('pass'); expect(r.results.some((x) => x.check === '(solve)' && x.status === 'error')).toBe(true);
  }, 120000);
  it('out-of-range values → invalid-parameter; a second part with the same name → symbol-collision; two instances keep private nodes apart', () => {
    const c = clone(fx('rc-step.composition')) as Composition; (c.parts[1].spec as { farads: number }).farads = 10; expect(cause(() => buildStructure(c))).toBe('invalid-parameter');
    const l = clone(fx('rl-step.composition')) as Composition; (l.parts[1].spec as { henries: number }).henries = -1; expect(cause(() => buildStructure(l))).toBe('invalid-parameter');
    const d = clone(fx('rc-ladder.composition')) as Composition; (d.parts[3] as { name: string }).name = 'c1'; expect(cause(() => buildStructure(d))).toBe('symbol-collision');
    const s = buildStructure(fx('rc-ladder.composition')); expect([...s.privateNodes].sort()).toEqual(['c1_p', 'c2_p', 'r1_p', 'r2_p']); expect(s.observables['c1.current']).toBe('i(vcc1)'); expect(s.observables['c2.current']).toBe('i(vcc2)');
    // two INDUCTORS (rl-pair, 4 mH + 6 mH in series = the rl-step's 10 mH): their own private nodes, probes and element currents
    const t = buildStructure(fx('rl-pair.composition')); expect([...t.privateNodes].sort()).toEqual(['l1_p', 'l2_p', 'r_p']);
    expect(t.observables['l1.current']).toBe('i(vll1)'); expect(t.observables['l2.current']).toBe('i(vll2)'); expect(t.observables['l1.windingCurrent']).toBe('i(ll1)'); expect(t.observables['l2.windingCurrent']).toBe('i(ll2)');
    const e = clone(fx('rl-pair.composition')) as Composition; (e.parts[2] as { name: string }).name = 'l1'; expect(cause(() => buildStructure(e))).toBe('symbol-collision');
  });
  it('a malformed storage-law / reference check is a named invalid-check, never a pass', async () => {
    const x = clone(fx('rc-step.expectations')) as ExpectationSet;
    x.checks.push({ id: 'flat', kind: 'reference', observable: 'c.vplus', model: 'first-order-step', startAtSeconds: 0.001, from: 5, to: 5, tauSeconds: 1e-3, window: [0.002, 0.006] });
    x.checks.push({ id: 'early', kind: 'reference', observable: 'c.vplus', model: 'first-order-step', startAtSeconds: 0.002, from: 0, to: 5, tauSeconds: 1e-3, window: [0.001, 0.006] });
    x.checks.push({ id: 'not-storage', kind: 'storage-law', part: 'r' });
    const r = await runConformance(fx('rc-step.composition'), x, wasm);
    expect(statusOf(r, 'flat')).toBe('error'); expect(statusOf(r, 'early')).toBe('error'); expect(statusOf(r, 'not-storage')).toBe('unsupported'); expect(r.verdict).not.toBe('pass');
  }, 120000);
});
