/**
 * ELECTRONICS V1 (bridge/ELECTRONICS-V1-CLOSURE-PLAN.md, docs/ELECTRONICS-V1-MATRIX.md):
 *   1. the representative compositions pass every frozen, hand-derived check on the WASM engine;
 *   2. each has negative controls that fail the INTENDED check, by id;
 *   3. the public boundary refuses undeclared input by name (E1–E3), never as a raw TypeError or a silent ignore;
 *   4. the PRODUCTION terminal map (terminals.ts) meets, on solved trajectories, the hypotheses and the conclusion of
 *      formal/ElectronicsPortPower.lean — KCL at every non-ground node, zero total port power at every sample — and one
 *      flipped sign convention breaks both (a counterexample; this is correspondence evidence, not a refinement proof).
 */
import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { readFileSync } from 'node:fs';
import { runConformance, makePicker, neededVectors, type Engine, type ExpectationSet, type Report } from './kit';
import { buildStructure, REQUIRED_PORTS, type Composition, type PartInstance, type PartKind } from './composition';
import { terminalMap, partTerminals, ENERGY_ROLE, type Terminal } from './terminals';
import { checkCompositionShape } from './shape';
import { checkContract, type TaskContract } from './contract';
import { readGrid } from '../spice/grid';

const file = (path: string) => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const fx = (name: string) => file(`tools/conformance/fixtures/${name}.json`);
const wasm: Engine = { name: 'eecircuit-engine (test)', version: 'test', async run(netlist) { const sim = new Simulation(); await sim.start(); sim.setNetList(netlist); return sim.runSim() as never; } };
const scaled = (vector: string, factor: number): Engine => ({ name: 'scaled', version: '0', async run(netlist, vectors) {
  const raw = await wasm.run(netlist, vectors) as { variableNames: string[]; data: { name: string; values: number[] }[] };
  return { ...raw, data: raw.data.map((d) => d.name.toLowerCase() === vector ? { ...d, values: d.values.map((v) => v * factor) } : d) } as never;
} });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const statusOf = (r: Report, id: string) => r.results.find((x) => x.check === id)?.status;
const refusal = (fn: () => unknown): { cause: string; where: string; message: string } => {
  try { fn(); return { cause: 'no error', where: '', message: '' }; }
  catch (e) { const x = e as { cause_?: string; where?: string; message: string }; return { cause: x.cause_ ?? `other: ${x.message}`, where: x.where ?? '', message: x.message }; }
};
const part = (c: Composition, name: string) => c.parts.find((p) => p.name === name) as PartInstance & { ports: Record<string, string>; spec: Record<string, unknown> };

const REPRESENTATIVE = ['rc-charge-discharge', 'rlc-ring', 'coupled-load', 'nmos-load', 'ride-through'];

describe('representative compositions pass every frozen check (WASM)', () => {
  for (const name of REPRESENTATIVE) {
    it(`${name}: PASS with every check executed`, async () => {
      const x = fx(`${name}.expectations`) as ExpectationSet;
      const r = await runConformance(fx(`${name}.composition`), x, wasm);
      expect(r.results.filter((q) => q.status !== 'pass' && q.status !== 'warn').map((q) => `${q.check}: ${q.status} ${q.observed ?? q.message}`)).toEqual([]);
      expect(r.verdict).toBe('pass'); expect(r.results.length).toBe(x.checks.length);
    }, 120000);
  }
});

describe('negative controls fail the INTENDED check', () => {
  it('rc-charge-discharge: capacitor reversed → the charge reference FAILS (vplus is ground)', async () => {
    const c = clone(fx('rc-charge-discharge.composition')) as Composition; part(c, 'c').ports = { plus: '0', minus: 'vc' };
    expect(statusOf(await runConformance(c, fx('rc-charge-discharge.expectations'), wasm), 'charge-analytic')).toBe('fail');
  }, 120000);
  it('rlc-ring: capacitor reversed → the second-order reference FAILS', async () => {
    const c = clone(fx('rlc-ring.composition')) as Composition; part(c, 'c').ports = { plus: '0', minus: 'n2' };
    expect(statusOf(await runConformance(c, fx('rlc-ring.expectations'), wasm), 'ring-analytic')).toBe('fail');
  }, 120000);
  it('rlc-ring: R 200 Ω (critically damped, ζ = 1) → no reverse current: the trough FAILS', async () => {
    const c = clone(fx('rlc-ring.composition')) as Composition; part(c, 'r').spec.ohms = 200;
    expect(statusOf(await runConformance(c, fx('rlc-ring.expectations'), wasm), 'reverse-current')).toBe('fail');
  }, 120000);
  it('rlc-ring: inductor probe scaled by 1.02 → inductor storage-law AND the energy account FAIL (D-2 discriminating control)', async () => {
    const r = await runConformance(fx('rlc-ring.composition'), fx('rlc-ring.expectations'), scaled('i(vll)', 1.02));
    expect(statusOf(r, 'inductor-law-and-energy')).toBe('fail'); expect(statusOf(r, 'energy-account')).toBe('fail');
    expect(statusOf(r, 'capacitor-law-and-energy')).toBe('pass');
  }, 120000);
  it('rc-step: the 1.1 current scaling control still fails storage-law after D-2', async () => {
    const r = await runConformance(fx('rc-step.composition'), fx('rc-step.expectations'), scaled('i(vcc)', 1.1));
    expect(statusOf(r, 'capacitor-law-and-energy')).toBe('fail');
  }, 120000);
  it('coupled-load: secondary winding reversed → the dot-polarity check FAILS (the load voltage goes negative)', async () => {
    const c = clone(fx('coupled-load.composition')) as Composition; const t = part(c, 't'); t.ports = { ...t.ports, plus2: '0', minus2: 's' };
    const r = await runConformance(c, fx('coupled-load.expectations'), wasm);
    expect(statusOf(r, 'dot-polarity')).toBe('fail'); expect(statusOf(r, 'coupled-law-and-energy')).toBe('pass');
  }, 120000);
  it('coupled-load: secondary open (r2 1 GΩ) → the Lenz loading trough FAILS', async () => {
    const c = clone(fx('coupled-load.composition')) as Composition; part(c, 'r2').spec.ohms = 1e9;
    expect(statusOf(await runConformance(c, fx('coupled-load.expectations'), wasm), 'lenz-loading')).toBe('fail');
  }, 120000);
  it('coupled-load: the secondary scaled by 1.02 → the coupled storage-law FAILS', async () => {
    const r = await runConformance(fx('coupled-load.composition'), fx('coupled-load.expectations'), scaled('i(vktb)', 1.02));
    expect(statusOf(r, 'coupled-law-and-energy')).toBe('fail');
  }, 120000);
  it('nmos-load: gate drive 1.5 V (below VTO 2 V) → the on-state check FAILS', async () => {
    const c = clone(fx('nmos-load.composition')) as Composition;
    const vg = c.sources.find((s) => s.name === 'vg') as { points: { atSeconds: number; value: number }[] };
    vg.points = vg.points.map((q) => ({ ...q, value: q.value > 0 ? 1.5 : 0 }));
    expect(statusOf(await runConformance(c, fx('nmos-load.expectations'), wasm), 'on')).toBe('fail');
  }, 120000);
  it('ride-through: the diode removed (r1 straight to the store) → backfeed: the source-current check FAILS', async () => {
    const c = clone(fx('ride-through.composition')) as Composition;
    c.parts = c.parts.filter((p) => p.name !== 'd1'); part(c, 'r1').ports = { a: 'vin', b: 'out' };
    const x = clone(fx('ride-through.expectations')) as ExpectationSet; x.checks = x.checks.filter((q) => q.id !== 'diode-law');
    expect(statusOf(await runConformance(c, x, wasm), 'source-current-limit-and-no-backfeed')).toBe('fail');
  }, 120000);
});

describe('the public boundary refuses undeclared input by name (E1–E3)', () => {
  const rc = () => clone(fx('rc-step.composition')) as Composition;
  it('a source kind other than dc/pwl → named by the shape stage, with the pwl hint', () => {
    const c = rc(); (c.sources[0] as { kind: string }).kind = 'sine';
    const issue = checkCompositionShape(c).find((q) => q.where === 'sources[0].kind');
    expect(issue?.message).toMatch(/"dc" or "pwl".*pwl points/);
    expect(refusal(() => buildStructure(c)).cause).toBe('composition-shape');
  });
  it('an undeclared spec field (esr) → unsupported-spec-field, naming the part and the supported fields', () => {
    const c = rc(); part(c, 'c').spec.esr = 0.1;
    const r = refusal(() => buildStructure(c)); expect(r.cause).toBe('unsupported-spec-field'); expect(r.where).toBe('c'); expect(r.message).toMatch(/supported: farads/);
  });
  it('a forced initial state keeps its own cause (unsupported-initial-state)', () => {
    const c = rc(); part(c, 'c').spec.initialVolts = 1; expect(refusal(() => buildStructure(c)).cause).toBe('unsupported-initial-state');
  });
  it('an undeclared port → unknown-port', () => {
    const c = rc(); part(c, 'r').ports.c = 'vin'; const r = refusal(() => buildStructure(c)); expect(r.cause).toBe('unknown-port'); expect(r.message).toMatch(/supported: a, b/);
  });
  it('an undeclared top-level field → unsupported-field', () => {
    const c = rc() as Composition & { ground?: string }; c.ground = '0'; expect(refusal(() => buildStructure(c)).cause).toBe('unsupported-field');
  });
  it('a motor without its load → missing-spec-field (was a raw TypeError)', () => {
    const c = clone(fx('motor-switch-flyback.composition')) as Composition; delete (c.parts.find((p) => p.kind === 'motor')!.spec as { load?: unknown }).load;
    const r = refusal(() => buildStructure(c)); expect(r.cause).toBe('missing-spec-field'); expect(r.message).toMatch(/spec\.load/);
  });
  it('an LED without its nested diode part → missing-spec-field', () => {
    const c = clone(fx('controls-bench.composition')) as Composition; delete (c.parts.find((p) => p.kind === 'led')!.spec as { part?: unknown }).part;
    expect(refusal(() => buildStructure(c)).cause).toBe('missing-spec-field');
  });
  it('a switch without a programme → refused naming the programme (never a TypeError)', () => {
    const c = clone(fx('controls-bench.composition')) as Composition; delete (c.parts.find((p) => p.kind === 'switch') as { programme?: unknown }).programme;
    const r = refusal(() => buildStructure(c)); expect(['composition-shape', 'missing-programme']).toContain(r.cause); expect(`${r.where} ${r.message}`).toMatch(/programme/);
  });
  it('an environment without a name → named by the shape stage (it used to pass as the string "undefined")', () => {
    const c = clone(fx('sensing-ldr.composition')) as Composition; delete (c.environments![0] as { name?: string }).name;
    expect(checkCompositionShape(c).map((q) => q.where)).toContain('environments[0].name');
  });
  it('a sensor programme outside its declared domain → sensor-domain (E2)', () => {
    const c = clone(fx('sensing-ldr.composition')) as Composition; c.environments![0].points[c.environments![0].points.length - 1].value = 0.5;
    const r = refusal(() => buildStructure(c)); expect(r.cause).toBe('sensor-domain'); expect(r.message).toMatch(/0\.5 lux.*1…100 lux/);
  });
  it('a sensor reading a circuit node instead of a declared programme → sensor-env-undeclared (E2)', () => {
    const c = clone(fx('sensing-ldr.composition')) as Composition; const s = c.parts.find((p) => p.kind === 'ldr') as { ports: Record<string, string> };
    s.ports.env = c.sources[0].plus; expect(refusal(() => buildStructure(c)).cause).toBe('sensor-env-undeclared');
  });
  it('coupling k = 1 (the ideal transformer) is outside v1 → invalid-parameter naming k', () => {
    const c = clone(fx('coupled-load.composition')) as Composition; part(c, 't').spec.coupling = 1;
    const r = refusal(() => buildStructure(c)); expect(r.cause).toBe('invalid-parameter'); expect(r.message).toMatch(/coupling k/);
  });
  it('the task contract compares the source by content, not key order (E3)', () => {
    const c = rc(); const src = c.sources[0] as { kind: 'pwl'; name: string; plus: string; minus: string; points: { atSeconds: number; value: number }[] };
    const reordered = { points: src.points.map((q) => ({ value: q.value, atSeconds: q.atSeconds })), minus: src.minus, plus: src.plus, name: src.name, kind: src.kind };
    const k: TaskContract = { id: 'order', source: reordered as never, analysis: c.analysis, nodes: ['0', 'vin', 'vc'], maxParts: 2,
      parts: { r: { kind: 'resistor', spec: { ohms: [1, 1e6] } }, c: { kind: 'capacitor', spec: { farads: [1e-9, 1e-3] } } }, requiredParts: ['r', 'c'] };
    expect(checkContract(c, k)).toEqual([]);
  });
});

// ------------------------------------------------------------ the correspondence with formal/ElectronicsPortPower.lean
async function solve(c: Composition) {
  const s = buildStructure(c);
  // The kit's own vector list and lookup, so derived observables (a motor's θ, electromechanical v1) resolve here too.
  const wanted = ['time', ...neededVectors(s)];
  const g = readGrid(await wasm.run(s.netlist, wanted.slice(1)), wanted, c.analysis);
  const lookup = makePicker(s, g.times, g.pick);
  return { n: g.times.length, pick: (o: string) => { const v = s.observables[o]; if (!v) throw new Error(`no observable ${o}`); return lookup(v); } };
}
/** The Lean statement's two hypotheses and its conclusion, evaluated on a solved trajectory from a terminal list. */
function portPowerResiduals(terms: Terminal[], n: number, pick: (o: string) => Float64Array) {
  const perNode = new Map<string, Float64Array>(), total = new Float64Array(n), flow = new Float64Array(n);
  let peakI = 0;
  for (const t of terms) {
    const i = new Float64Array(n); for (const [o, k] of t.into) { const a = pick(o); for (let j = 0; j < n; j++) i[j] += k * a[j]; }
    const v = pick(`node:${t.node}`);
    if (t.node !== '0') { let acc = perNode.get(t.node); if (!acc) perNode.set(t.node, acc = new Float64Array(n)); for (let j = 0; j < n; j++) acc[j] += i[j]; }
    for (let j = 0; j < n; j++) { total[j] += v[j] * i[j]; flow[j] += Math.abs(v[j] * i[j]); peakI = Math.max(peakI, Math.abs(i[j])); }
  }
  let kcl = 0, power = 0, peakFlow = 0;
  for (const acc of perNode.values()) for (let j = 0; j < n; j++) kcl = Math.max(kcl, Math.abs(acc[j]));
  for (let j = 0; j < n; j++) { power = Math.max(power, Math.abs(total[j])); peakFlow = Math.max(peakFlow, flow[j] / 2); }
  return { kcl: kcl / peakI, power: power / peakFlow };
}
const CORRESPONDENCE = [...REPRESENTATIVE.map((n) => `tools/conformance/fixtures/${n}.composition.json`), 'tools/conformance/fixtures/controls-bench.composition.json',
  'tools/conformance/fixtures/motor-switch-flyback.composition.json', 'tools/conformance/fixtures/sensing-ldr.composition.json', 'tools/conformance/fixtures/rl-pair.composition.json',
  'tools/conformance/trial/fan.composition.json'];

describe('terminal map ↔ formal/ElectronicsPortPower.lean (E10 correspondence, not a refinement proof)', () => {
  it('every part kind has a terminal entry for each conducting port and an energy role', () => {
    for (const kind of Object.keys(REQUIRED_PORTS) as PartKind[]) {
      const ports = Object.fromEntries(REQUIRED_PORTS[kind].map((p) => [p, `n${p}`]));
      const terms = partTerminals({ kind, name: 'x', ports, spec: {} } as never);
      expect(terms.length, kind).toBeGreaterThan(0);
      for (const t of terms) expect(Object.values(ports)).toContain(t.node);
      expect(ENERGY_ROLE[kind], kind).toBeDefined();
    }
  });
  for (const path of CORRESPONDENCE) {
    it(`${path.split('/').pop()}: KCL at every non-ground node and Σ v·i = 0 at every sample, from the PRODUCTION map`, async () => {
      const c = file(path) as Composition; const { n, pick } = await solve(c);
      const r = portPowerResiduals(terminalMap(c), n, pick);
      expect(r.kcl).toBeLessThan(1e-6); expect(r.power).toBeLessThan(1e-6);
    }, 120000);
  }
  it('counterexample: ONE flipped convention (a capacitor current read as OUT of plus) breaks KCL and the power sum', async () => {
    const c = fx('rlc-ring.composition') as Composition; const { n, pick } = await solve(c);
    const flipped = terminalMap(c).map((t) => t.element === 'c' ? { ...t, into: t.into.map(([o, k]) => [o, -k] as [string, number]) } : t);
    const r = portPowerResiduals(flipped, n, pick);
    expect(r.kcl).toBeGreaterThan(0.1); expect(r.power).toBeGreaterThan(0.1);
  }, 120000);
});
