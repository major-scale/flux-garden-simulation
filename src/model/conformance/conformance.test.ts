import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { readFileSync } from 'node:fs';
import { runConformance, type Engine, type ExpectationSet, type Report } from './kit';
import { buildStructure, parseEmittedLine, type Composition } from './composition';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`../../../tools/conformance/fixtures/${name}.json`, import.meta.url), 'utf8'));
const wasm: Engine = { name: 'eecircuit-engine (test)', version: 'test', async run(netlist) { const sim = new Simulation(); await sim.start(); sim.setNetList(netlist); return sim.runSim() as never; } };
const broken: Engine = { name: 'broken-runner', version: '0', async run() { return { variableNames: [], data: [] }; } };
const statusOf = (r: Report, id: string) => r.results.find((x) => x.check === id)?.status;
/** Finite ZEROS for every requested vector on a valid time grid — Astra's injected-runner reproduction: exposes checker logic, not solver behaviour. */
const zeros: Engine = { name: 'zeros', version: '0', async run(netlist, vectors) {
  const stop = Number(/^\.tran \S+ (\S+)/m.exec(netlist)![1]), n = 2001, t = Array.from({ length: n }, (_, k) => (k * stop) / (n - 1));
  return { variableNames: ['time', ...vectors], data: [{ name: 'time', values: t }, ...vectors.map((v) => ({ name: v, values: new Array(n).fill(0) }))] } as never;
} };
/** The real solve, then one vector scaled — a wrong-law control for sensor-law. */
const scaled = (vector: string, factor: number): Engine => ({ name: 'scaled', version: '0', async run(netlist, vectors) {
  const raw = await wasm.run(netlist, vectors) as { variableNames: string[]; data: { name: string; values: number[] }[] };
  return { ...raw, data: raw.data.map((d) => d.name.toLowerCase() === vector ? { ...d, values: d.values.map((v) => v * factor) } : d) } as never;
} });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('good controls pass every frozen check', () => {
  for (const name of ['controls-bench', 'sensing-ldr', 'motor-switch-flyback', 'sensing-ldr-parallel']) {
    it(`${name}: PASS with every check executed`, async () => {
      const r = await runConformance(fx(`${name}.composition`), fx(`${name}.expectations`), wasm);
      expect(r.summary).toMatch(/^PASS/);
      expect(r.verdict).toBe('pass');
      expect(r.results.length).toBe((fx(`${name}.expectations`) as ExpectationSet).checks.length);
      expect(r.results.every((x) => x.status === 'pass' || x.status === 'warn')).toBe(true);
      expect(r.engine.samples).toBeGreaterThan(100);
      expect(r.composition.sha256).toMatch(/^[0-9a-f]{64}$/);
    }, 120000);
  }
});

describe('the checker catches mistakes BY NAME, not by any exception', () => {
  const base = () => clone(fx('controls-bench.composition')) as Composition;
  const exp = () => clone(fx('controls-bench.expectations')) as ExpectationSet;
  it('omitted required port → missing-port', () => {
    const c = base(); delete (c.parts[3].ports as Record<string, unknown>).cathode;
    expect(() => buildStructure(c)).toThrow(expect.objectContaining({ cause_: 'missing-port', where: 'l' }));
  });
  it('instance-name collision (a part named like the source) → symbol-collision', () => {
    const c = base(); (c.parts[2] as { name: string }).name = 'vdd';
    expect(() => buildStructure(c)).toThrow(expect.objectContaining({ cause_: 'symbol-collision' }));
  });
  it('an external node that aliases a private node → symbol-collision', () => {
    const c = base(); (c.parts[2].ports as Record<string, string>).b = 'p_t';
    expect(() => buildStructure(c)).toThrow(expect.objectContaining({ cause_: 'invalid-node-name' }));   // rejected even earlier: no underscore in external names
  });
  it('invalid resistance → invalid-parameter naming the part', () => {
    const c = base(); (c.parts[2] as { spec: { ohms: number } }).spec.ohms = -5;
    expect(() => buildStructure(c)).toThrow(expect.objectContaining({ cause_: 'invalid-parameter', where: 'rs' }));
  });
  it('excessive LED current → the led-limit bounds check FAILS (structure is fine)', async () => {
    const c = base(); (c.parts[2] as { spec: { ohms: number } }).spec.ohms = 20; (c.parts[1] as { spec: { wiperFraction: number } }).spec.wiperFraction = 0;   // pot full, 20 Ω series
    const r = await runConformance(c, exp(), wasm);
    expect(r.verdict).toBe('fail'); expect(statusOf(r, 'led-limit')).toBe('fail'); expect(statusOf(r, 'ohm-series')).toBe('pass');
  }, 60000);
  it('missing required reference (comparator input left on a node nothing drives) → unreachable-node FAIL', async () => {
    const c = clone(fx('sensing-ldr.composition')) as Composition; (c.parts[3].ports as Record<string, string>).inn = 'nowhere';
    const r = await runConformance(c, fx('sensing-ldr.expectations'), wasm);
    expect(statusOf(r, 'connected')).toBe('fail'); expect(r.results.find((x) => x.check === 'connected')?.node).toBe('nowhere');
    expect(r.verdict).toBe('fail'); expect(r.engine.samples).toBeNull();                      // never sent to the engine
    expect(r.results.filter((x) => x.kind !== 'connectivity').every((x) => x.status === 'error' && /not solved/.test(x.message))).toBe(true);
  }, 60000);
  it('wrong expected switching direction → the switching check FAILS with the observed transition named', async () => {
    const x = exp(); const sw = x.checks.find((k) => k.id === 'closes-once')!; (sw as { direction: string }).direction = 'high->low';
    const r = await runConformance(base(), x, wasm);
    expect(statusOf(r, 'closes-once')).toBe('fail'); expect(r.results.find((k) => k.check === 'closes-once')?.observed).toMatch(/low->high at 0\.005/);
  }, 60000);
  it('comparator that STARTS inside its band → UNSUPPORTED, never pass', async () => {
    const c = clone(fx('sensing-ldr.composition')) as Composition;
    const eStar = 10 * Math.pow(12000 / 10000, 1 / 0.7);
    c.environments![0].points = [{ atSeconds: 0, value: eStar }, { atSeconds: 2, value: eStar }];
    const r = await runConformance(c, fx('sensing-ldr.expectations'), wasm);
    expect(statusOf(r, 'comparator-decides')).toBe('unsupported'); expect(r.verdict).not.toBe('pass');
  }, 60000);
  it('a window outside the solved horizon → ERROR, not a clamped pass', async () => {
    const x = exp(); x.checks.push({ id: 'too-late', kind: 'state', at: 5, observable: 'l.current', op: 'gt', value: 0 });
    const r = await runConformance(base(), x, wasm);
    expect(statusOf(r, 'too-late')).toBe('error'); expect(r.verdict).toBe('error');
  }, 60000);
  it('an empty expectation set, an unknown check kind and a missing observable cannot pass', async () => {
    expect((await runConformance(base(), { id: 'empty', checks: [] }, wasm)).verdict).toBe('error');
    const r = await runConformance(base(), { id: 'x', checks: [{ id: 'what', kind: 'levitation' } as never] }, wasm);
    expect(statusOf(r, 'what')).toBe('error'); expect(r.results[0].message).toMatch(/unknown-check/);
    const r2 = await runConformance(base(), { id: 'y', checks: [{ id: 'ghost', kind: 'bounds', observable: 'zz.current', min: 0 }] }, wasm);
    expect(statusOf(r2, 'ghost')).toBe('error'); expect(r2.results[0].message).toMatch(/missing-observable/);
  }, 60000);
  it('a BROKEN RUNNER produces ERROR on every solved check — infrastructure failure never masquerades as fault detection or success', async () => {
    const r = await runConformance(base(), exp(), broken);
    expect(r.verdict).toBe('error');
    expect(r.results.filter((x) => x.kind !== 'connectivity').every((x) => x.status === 'error')).toBe(true);
    expect(r.engine.samples).toBeNull();
  }, 60000);
  // ---- Astra's return (conformance-kit-4780ec39): three false-PASS paths, each now a named non-pass.
  it('(1) a connectivity-only set on a dead engine is an ERROR, never a PASS', async () => {
    const r = await runConformance(base(), { id: 'conn-only', checks: [{ id: 'connected', kind: 'connectivity' }] }, broken);
    expect(statusOf(r, 'connected')).toBe('pass');
    expect(r.results.find((x) => x.check === '(solve)')?.status).toBe('error');
    expect(r.verdict).toBe('error'); expect(r.summary).toMatch(/^ERROR.*SOLVE FAILED/);
  });
  it('(2a) finite ZERO vectors: every law and balance check is UNSUPPORTED (no excitation), never pass', async () => {
    const r = await runConformance(clone(fx('sensing-ldr.composition')), fx('sensing-ldr.expectations'), zeros);
    for (const id of ['ldr-law', 'kcl-output', 'led-law']) expect(statusOf(r, id), id).toBe('unsupported');
    expect(r.verdict).not.toBe('pass');
    const r2 = await runConformance(base(), exp(), zeros);
    for (const id of ['kcl-wiper', 'kcl-led', 'kcl-switch', 'ohm-series', 'ohm-pot-legs', 'led-law']) expect(statusOf(r2, id), id).toBe('unsupported');
    expect(r2.verdict).not.toBe('pass');
  });
  it('(2b) a REAL unexcited circuit (0 V supply) is UNSUPPORTED on the law checks', async () => {
    const c = clone(fx('sensing-ldr.composition')) as Composition; (c.sources[0] as { volts: number }).volts = 0;
    const r = await runConformance(c, fx('sensing-ldr.expectations'), wasm);
    expect(statusOf(r, 'ldr-law')).toBe('unsupported'); expect(statusOf(r, 'kcl-output')).toBe('unsupported'); expect(r.verdict).not.toBe('pass');
  }, 60000);
  it('(2c) malformed checks are named invalid-check ERRORS, and the rest still evaluate', async () => {
    const x: ExpectationSet = { id: 'bad', checks: [
      { id: 'dup', kind: 'bounds', observable: 'l.current', max: 1 }, { id: 'dup', kind: 'bounds', observable: 'l.current', max: 1 },
      { id: 'kcl-empty', kind: 'kcl', into: [], out: [] },
      { id: 'kcl-self', kind: 'kcl', into: ['rs.current'], out: ['rs.current'] },
      { id: 'bounds-none', kind: 'bounds', observable: 'l.current' },
      { id: 'neg-tol', kind: 'ohm', part: 'rs', tolRel: -1 },
      { id: 'bad-op', kind: 'state', at: 0.01, observable: 'l.current', op: 'maybe' as never, value: 0 },
      { id: 'bad-window', kind: 'switching', part: 't', direction: 'low->high', window: [0.01, 0.005] },
      { id: 'ok', kind: 'ohm', part: 'rs' } ] };
    const r = await runConformance(base(), x, wasm);
    for (const id of ['kcl-empty', 'kcl-self', 'bounds-none', 'neg-tol', 'bad-op', 'bad-window']) {
      const res = r.results.find((k) => k.check === id)!; expect(res.status, id).toBe('error'); expect(res.message, id).toMatch(/^invalid-check/);
    }
    expect(r.results.filter((k) => k.check === 'dup').map((k) => k.status)).toEqual(['pass', 'error']);
    expect(statusOf(r, 'ok')).toBe('pass'); expect(r.verdict).toBe('error');
  }, 60000);
  it('(3) the sensor is measured on ITS OWN probe: in a branched circuit the shared-node resistor carries a different current, and a wrong law FAILS', async () => {
    const c = fx('sensing-ldr-parallel.composition') as Composition, x = fx('sensing-ldr-parallel.expectations') as ExpectationSet;
    const r = await runConformance(c, x, wasm);
    expect(statusOf(r, 'ldr-law-own-probe')).toBe('pass');
    // The old inference (first resistor sharing any terminal → rf, or rb, which shares BOTH) would have used a current
    // that is not the sensor's: rb's differs from s's by the bleeder ratio, and rf's is their sum.
    const s = buildStructure(c); expect(s.observables['s.current']).toBe('i(vsns)'); expect(s.elements.has('vsns')).toBe(true);
    const wrong = await runConformance(c, { id: 'inferred', checks: [{ id: 'law-with-rb-current', kind: 'kcl', into: ['s.current'], out: ['rb.current'] }] }, wasm);
    expect(statusOf(wrong, 'law-with-rb-current')).toBe('fail');            // s and rb do NOT share a current
    const bad = await runConformance(c, x, scaled('i(vsns)', 2));
    expect(statusOf(bad, 'ldr-law-own-probe')).toBe('fail'); expect(statusOf(bad, 'kcl-branch')).toBe('fail');
  }, 120000);
  it('the grammar parser fails closed on a line the emitters never write', () => {
    expect(() => parseEmittedLine('X1 a b c mysub')).toThrow(expect.objectContaining({ cause_: 'unrecognised-line' }));
    expect(parseEmittedLine("Rs vin 0 r = 'min(1e6, 12000*pow(max(v(env),1e-9)/10, -0.7))'").nodes).toEqual(['vin', '0']);
    expect(parseEmittedLine('.model SWCH SW(RON=0.001 ROFF=1e9 VT=0.5 VH=0.1)').model).toBe('swch');
    expect(() => buildStructure({ ...base(), parts: [{ kind: 'resistor', name: 'r', ports: { a: 'v(x); Rbad 0 0 1', b: '0' }, spec: { ohms: 1 } }] } as Composition))
      .toThrow(expect.objectContaining({ cause_: 'invalid-node-name' }));
  });
  it('the structure report reserves every generated symbol', () => {
    const s = buildStructure(base());
    expect([...s.privateNodes]).toEqual(expect.arrayContaining(['t_ctl', 't_p', 'p_t', 'p_a', 'p_w', 'rs_p', '0_lk']));
    expect(s.elements.has('st')).toBe(true); expect(s.models.has('swt')).toBe(true); expect(s.elements.has('vswt')).toBe(true);
    expect(s.observables['p.currentW']).toBe('i(vwp)');
    expect(s.findings).toEqual([]);
    expect(s.danglingPorts).toEqual([]);
  });
});
