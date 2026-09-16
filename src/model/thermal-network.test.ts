/**
 * THERMAL NETWORK V1 (bridge/THERMAL-NETWORK-V1-PLAN.md, docs/THERMAL-NETWORK-V1-DECLARATION.md), criteria frozen there:
 *   1. two bodies isolated from ambient, unequal capacities: closed forms, direction, conservation, common offset;
 *   2. zero conductance, equal temperatures, orientation reversal, reordering, `links: []`, parallel links;
 *   3. three-body chain with a bottleneck (independent reference, limiting case, refinement), the maximum principle including a
 *      stiff case, and an over-diffusion negative;
 *   4. production: resistor → heatsink and winding → casing ← bearing on the kit's solved runs, and a network continuation;
 *   5. regressions (small G, large C with µs steps) and faults (reversed / one-sided / doubled booking, bad links, a scale error).
 * References are INDEPENDENT of the production solver: closed forms, `expm` from motor.ts on the affine system in ABSOLUTE
 * temperature (a different formulation and a different routine), and RK4 on the continuous forcing.
 */
import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { readFileSync } from 'node:fs';
import { buildStructure, type Composition } from './conformance/composition';
import { makePicker, neededVectors } from './conformance/kit';
import { readGrid } from './spice/grid';
import { expm } from './motor';
import { simulateThermal, continueCooling, compositeBalance, validateDescriptor, thermalFromComposition, networkAudit, ThermalError, NETWORK_FAULT_INJECTION,
  type ThermalDescriptor, type ThermalRoute, type LossSource, type LumpedBody, type ThermalLink, type ThermalRun } from './thermal-lumped';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../tools/conformance/fixtures/${name}`, import.meta.url), 'utf8'));
const cause = (fn: () => unknown): string => { try { fn(); return 'no error'; } catch (e) { return (e as ThermalError).cause_ ?? `other: ${(e as Error).message}`; } };
async function solve(c: Composition) {
  const s = buildStructure(c), wanted = ['time', ...neededVectors(s)];
  const sim = new Simulation(); await sim.start(); sim.setNetList(s.netlist);
  const g = readGrid(await sim.runSim() as never, wanted, c.analysis);
  return { c, s, times: g.times, pick: makePicker(s, g.times, g.pick) };
}
const grid = (t1: number, dt: number) => { const n = Math.round(t1 / dt) + 1, t = new Float64Array(n); for (let k = 0; k < n; k++) t[k] = k * dt; return t; };
const constant = (id: string, times: Float64Array, w: number): LossSource => ({ id, kind: 'passive-part', watts: new Float64Array(times.length).fill(w) });
const body = (id: string, over: Partial<LumpedBody> = {}): LumpedBody => ({ id, heatCapacityJPerK: 1, initialTemperatureK: 300, ambientTemperatureK: 300, conductanceWPerK: 0, ...over });
const link = (id: string, a: string, b: string, G: number): ThermalLink => ({ id, a, b, conductanceWPerK: G });
const desc = (bodies: LumpedBody[], links: ThermalLink[] | undefined, routes: ThermalRoute[] = []): ThermalDescriptor =>
  (links === undefined ? { id: 't', bodies, routes } : { id: 't', bodies, routes, links });
type Net = { network: { bodyBooksGapJ: Record<string, number>; bodyBooksScaleJ: Record<string, number>; bodySolveResidualJ: Record<string, number>; bodySolveScaleJ: Record<string, number> } };
/** The per-body criteria: the books close (by construction, to compensated rounding) and the solve residual is within its bound. */
const bodyBoundsHold = (r: Net) => Object.keys(r.network.bodyBooksGapJ).every((id) =>
  Math.abs(r.network.bodyBooksGapJ[id]) <= 1e-12 * r.network.bodyBooksScaleJ[id] && Math.abs(r.network.bodySolveResidualJ[id]) <= 1e-9 * r.network.bodySolveScaleJ[id]);
const worstRatio = (r: Net) =>
  Math.max(...Object.keys(r.network.bodySolveResidualJ).map((id) => Math.abs(r.network.bodySolveResidualJ[id]) / Math.max(r.network.bodySolveScaleJ[id], 1e-300)));

/** Two bodies, no ambient, one link: T̄ = (C1T1 + C2T2)/(C1 + C2) is fixed; D = T1 − T2 decays with rate G·(1/C1 + 1/C2). */
function twoBody(C1: number, C2: number, G: number, T10: number, T20: number, t: number): [number, number] {
  const k = G * (1 / C1 + 1 / C2), Tbar = (C1 * T10 + C2 * T20) / (C1 + C2), D = (T10 - T20) * Math.exp(-k * t);
  return [Tbar + C2 / (C1 + C2) * D, Tbar - C1 / (C1 + C2) * D];
}
/** The INDEPENDENT reference: dT/dt = C⁻¹(P + G_amb·T_a − (G_amb + L)·T) on ABSOLUTE temperatures, exactly, by motor.ts's `expm`. */
function reference(bodies: LumpedBody[], links: ThermalLink[], P: number[], t: number, T0 = bodies.map((b) => b.initialTemperatureK)): number[] {
  const n = bodies.length, idx = new Map(bodies.map((b, i) => [b.id, i] as const));
  const K = bodies.map((b, i) => bodies.map((_, j) => (i === j ? b.conductanceWPerK : 0)));
  for (const l of links) { const a = idx.get(l.a)!, b = idx.get(l.b)!, G = l.conductanceWPerK; K[a][a] += G; K[b][b] += G; K[a][b] -= G; K[b][a] -= G; }
  const M = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = -K[i][j] / bodies[i].heatCapacityJPerK * t;
    M[i][n] = (P[i] + bodies[i].conductanceWPerK * bodies[i].ambientTemperatureK) / bodies[i].heatCapacityJPerK * t;
  }
  const E = expm(M);
  return bodies.map((_, i) => E[i].slice(0, n).reduce((s, v, j) => s + v * T0[j], 0) + E[i][n]);
}
/** RK4 on the CONTINUOUS forcing (an independent integrator for the refinement check). */
function rk4(bodies: LumpedBody[], links: ThermalLink[], P: (t: number) => number[], t1: number, h: number, every: number): number[][] {
  const idx = new Map(bodies.map((b, i) => [b.id, i] as const));
  const f = (t: number, T: number[]) => {
    const p = P(t), d = bodies.map((b, i) => p[i] - b.conductanceWPerK * (T[i] - b.ambientTemperatureK));
    for (const l of links) { const a = idx.get(l.a)!, b = idx.get(l.b)!, q = l.conductanceWPerK * (T[a] - T[b]); d[a] -= q; d[b] += q; }
    return d.map((v, i) => v / bodies[i].heatCapacityJPerK);
  };
  let T = bodies.map((b) => b.initialTemperatureK); const out = [T.slice()], steps = Math.round(t1 / h), stride = Math.round(every / h);
  for (let k = 0; k < steps; k++) {
    const t = k * h, k1 = f(t, T), k2 = f(t + h / 2, T.map((v, i) => v + h / 2 * k1[i])), k3 = f(t + h / 2, T.map((v, i) => v + h / 2 * k2[i])), k4 = f(t + h, T.map((v, i) => v + h * k3[i]));
    T = T.map((v, i) => v + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    if ((k + 1) % stride === 0) out.push(T.slice());
  }
  return out;
}
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

// ---------------------------------------------------------------- 1
describe('1 · two bodies isolated from ambient, unequal capacities: closed forms', () => {
  const C1 = 2, C2 = 6, G = 0.8, t = grid(10, 0.5), e = t.length - 1;
  const d = desc([body('h', { heatCapacityJPerK: C1, initialTemperatureK: 350 }), body('c', { heatCapacityJPerK: C2 })], [link('l', 'h', 'c', G)]);
  it('temperatures follow T̄ and D0·e^{−G(1/C1+1/C2)t}; heat flows hot → cold; Σ stored change = 0; transfer = C1·(T1(0) − T1(t))', () => {
    for (const tt of [t, new Float64Array([0, 10])]) {                                   // 20 intervals, or one: the update is exact
      const r = simulateThermal(tt, [], d), k1 = tt.length - 1;
      let w = 0;
      for (let k = 0; k < tt.length; k++) { const [a, b] = twoBody(C1, C2, G, 350, 300, tt[k]); w = Math.max(w, Math.abs(r.temperatureK.h[k] - a), Math.abs(r.temperatureK.c[k] - b)); }
      expect(w / 50).toBeLessThan(1e-9);
      for (let k = 1; k < tt.length; k++) expect(r.linkJ.l[k]).toBeGreaterThan(r.linkJ.l[k - 1]);   // hot → cold in every interval
      expect(Math.abs(r.storedJ.h[k1] + r.storedJ.c[k1])).toBeLessThan(1e-12 * (C1 + C2) * 50);
      const expected = C1 * (350 - twoBody(C1, C2, G, 350, 300, tt[k1])[0]);
      expect(Math.abs(r.linkJ.l[k1] - expected) / expected).toBeLessThan(1e-9);
      expect(bodyBoundsHold(r)).toBe(true);
    }
    const r = simulateThermal(t, [], d);
    console.log(`NETWORK two-body: T_h/T_c at 0/2/10 s = ${[0, 4, e].map((k) => `${r.temperatureK.h[k].toFixed(6)}/${r.temperatureK.c[k].toFixed(6)}`).join(', ')} K; transfer ${r.linkJ.l[e].toExponential(6)} J; worst solve-residual ratio ${worstRatio(r).toExponential(2)}`);
  });
  it('a common +100 K offset on every T0 and T_a changes no transfer', () => {
    const base = simulateThermal(t, [], d);
    const shifted = simulateThermal(t, [], desc([body('h', { heatCapacityJPerK: C1, initialTemperatureK: 450, ambientTemperatureK: 400 }), body('c', { heatCapacityJPerK: C2, initialTemperatureK: 400, ambientTemperatureK: 400 })], [link('l', 'h', 'c', G)]));
    let w = 0; for (let k = 0; k < t.length; k++) w = Math.max(w, Math.abs(shifted.linkJ.l[k] - base.linkJ.l[k]));
    expect(w / base.linkJ.l[e]).toBeLessThan(1e-12);
    // also with ambient exchange: an offset of every temperature, ambient included, changes neither transfers nor stored energy
    const amb = (off: number) => simulateThermal(t, [], desc([body('h', { heatCapacityJPerK: C1, initialTemperatureK: 350 + off, ambientTemperatureK: 300 + off, conductanceWPerK: 0.3 }), body('c', { heatCapacityJPerK: C2, initialTemperatureK: 300 + off, ambientTemperatureK: 300 + off, conductanceWPerK: 0.1 })], [link('l', 'h', 'c', G)]));
    const a0 = amb(0), a1 = amb(100);
    expect(Math.abs(a1.linkJ.l[e] - a0.linkJ.l[e]) / a0.linkJ.l[e]).toBeLessThan(1e-12);
    expect(Math.abs(a1.ambientOutJ.h[e] - a0.ambientOutJ.h[e]) / a0.ambientOutJ.h[e]).toBeLessThan(1e-12);
  });
});

// ---------------------------------------------------------------- 2
describe('2 · zero conductance, equal temperatures, orientation, order, empty and parallel links', () => {
  const t = grid(10, 0.25), e = t.length - 1;
  const heated = (links: ThermalLink[] | undefined) => simulateThermal(t, [constant('p', t, 5), constant('q', t, 2)],
    desc([body('a', { heatCapacityJPerK: 2, conductanceWPerK: 0.5 }), body('b', { heatCapacityJPerK: 3, conductanceWPerK: 0.1, initialTemperatureK: 310 })], links,
      [{ source: 'p', receiver: 'a' }, { source: 'q', receiver: 'b' }]));
  it('a G = 0 link is insulation: its bodies stay on the one-body (v1) path, bit-identical, and it reports zero transfer (N-5)', () => {
    const net = heated([link('l', 'a', 'b', 0)]), v1 = heated(undefined);
    for (const id of ['a', 'b']) { expect(Array.from(net.temperatureK[id])).toEqual(Array.from(v1.temperatureK[id])); expect(Array.from(net.storedJ[id])).toEqual(Array.from(v1.storedJ[id])); }
    expect(net.linkJ.l.every((x) => x === 0)).toBe(true);
    expect(net.network.components.length).toBe(0);
    // riding along a conducting link between the same bodies, it transfers exactly nothing and changes nothing
    const both = heated([link('g', 'a', 'b', 1.5), link('z', 'a', 'b', 0)]), one = heated([link('g', 'a', 'b', 1.5)]);
    expect(both.linkJ.z.every((x) => x === 0)).toBe(true);
    expect(Array.from(both.temperatureK.a)).toEqual(Array.from(one.temperatureK.a));
  });
  it('equal temperatures carry no heat (exactly none when T0 = T_a)', () => {
    const r = simulateThermal(t, [], desc([body('a', { heatCapacityJPerK: 2, initialTemperatureK: 350 }), body('b', { heatCapacityJPerK: 5, initialTemperatureK: 350 })], [link('l', 'a', 'b', 3)]));
    expect(Math.abs(r.linkJ.l[e])).toBeLessThan(1e-12 * 3 * 10 * 50);
    const z = simulateThermal(t, [], desc([body('a', { heatCapacityJPerK: 2 }), body('b', { heatCapacityJPerK: 5 })], [link('l', 'a', 'b', 3)]));
    expect(z.linkJ.l.every((x) => x === 0)).toBe(true);
  });
  it('reversing a link\'s orientation changes the reported sign only: trajectories bit-identical, transfer exactly negated', () => {
    const f = heated([link('l', 'a', 'b', 1.5)]), r = heated([link('l', 'b', 'a', 1.5)]);
    for (const id of ['a', 'b']) {
      expect(Array.from(r.temperatureK[id])).toEqual(Array.from(f.temperatureK[id]));
      expect(Array.from(r.storedJ[id])).toEqual(Array.from(f.storedJ[id]));
      expect(Array.from(r.ambientOutJ[id])).toEqual(Array.from(f.ambientOutJ[id]));
    }
    for (let k = 0; k < t.length; k++) expect(r.linkJ.l[k] === -f.linkJ.l[k]).toBe(true);
    expect(f.linkJ.l[e]).not.toBe(0);
  });
  it('reordering bodies, links and routes gives the same result within 1e-12 (a three-body cycle with ambient and input)', () => {
    const B = [body('x', { conductanceWPerK: 0.1, initialTemperatureK: 310 }), body('y', { heatCapacityJPerK: 2, conductanceWPerK: 0.2 }), body('z', { heatCapacityJPerK: 3, conductanceWPerK: 0.05, initialTemperatureK: 290 })];
    const L = [link('xy', 'x', 'y', 1), link('yz', 'y', 'z', 0.5), link('zx', 'z', 'x', 2)];
    const routes = [{ source: 'p', receiver: 'x' }, { source: 'q', receiver: 'z' }];
    const src = [constant('p', t, 4), constant('q', t, 1)];
    const a = simulateThermal(t, src, desc(B, L, routes)), b = simulateThermal(t, [...src].reverse(), desc([...B].reverse(), [...L].reverse(), [...routes].reverse()));
    const rise = Math.max(...['x', 'y', 'z'].flatMap((id) => Array.from(a.temperatureK[id], (v) => Math.abs(v - a.temperatureK[id][0]))));
    let wt = 0, wf = 0, mag = 0;
    for (const id of ['x', 'y', 'z']) for (let k = 0; k < t.length; k++) wt = Math.max(wt, Math.abs(a.temperatureK[id][k] - b.temperatureK[id][k]));
    for (const l of L) { mag += Math.abs(a.linkJ[l.id][e]); for (let k = 0; k < t.length; k++) wf = Math.max(wf, Math.abs(a.linkJ[l.id][k] - b.linkJ[l.id][k])); }
    expect(wt / rise).toBeLessThan(1e-12); expect(wf / mag).toBeLessThan(1e-12);
    expect(bodyBoundsHold(a)).toBe(true);
  });
  it('`links: []` is bit-identical to no links (the accepted one-body path)', () => {
    const a = heated([]), b = heated(undefined);
    for (const id of ['a', 'b']) { expect(Array.from(a.temperatureK[id])).toEqual(Array.from(b.temperatureK[id])); expect(Array.from(a.storedJ[id])).toEqual(Array.from(b.storedJ[id])); }
  });
  it('parallel links add as conductances and are reported separately (G1 : G2), nothing overwritten', () => {
    const two = heated([link('l1', 'a', 'b', 0.4), link('l2', 'a', 'b', 1.2)]), one = heated([link('l', 'a', 'b', 1.6)]);
    const rise = Math.max(...one.temperatureK.a.map((x) => Math.abs(x - 300)));
    let w = 0; for (let k = 0; k < t.length; k++) w = Math.max(w, Math.abs(two.temperatureK.a[k] - one.temperatureK.a[k]), Math.abs(two.temperatureK.b[k] - one.temperatureK.b[k]));
    expect(w / rise).toBeLessThan(1e-12);
    expect(two.linkJ.l2[e] / two.linkJ.l1[e]).toBeCloseTo(3, 12);
    expect(Math.abs(two.linkJ.l1[e] + two.linkJ.l2[e] - one.linkJ.l[e]) / Math.abs(one.linkJ.l[e])).toBeLessThan(1e-12);
  });
});

// ---------------------------------------------------------------- 3
describe('3 · a three-body chain with a bottleneck, the maximum principle, and an over-diffusion negative', () => {
  const B = [body('A'), body('B', { heatCapacityJPerK: 2 }), body('C', { heatCapacityJPerK: 4, conductanceWPerK: 0.2 })];
  const L = [link('AB', 'A', 'B', 5), link('BC', 'B', 'C', 0.05)];
  it('heat into A reaches C late, through the bottleneck; the run matches the independent expm reference within 1e-9', () => {
    const t = grid(40, 0.1), r = simulateThermal(t, [constant('p', t, 10)], desc(B, L, [{ source: 'p', receiver: 'A' }]));
    let w = 0, maxRise = 0;
    for (let k = 0; k < t.length; k += 10) {
      const ref = reference(B, L, [10, 0, 0], t[k]);
      B.forEach((b, i) => { w = Math.max(w, Math.abs(r.temperatureK[b.id][k] - ref[i])); maxRise = Math.max(maxRise, Math.abs(ref[i] - 300)); });
    }
    expect(w / maxRise).toBeLessThan(1e-9);
    const at = (id: string, s: number) => r.temperatureK[id][Math.round(s / 0.1)] - 300;
    // Amendment N-1: an undeclared "C < 1% of B at 2 s" I wrote here failed at 1.13%. The declared criterion is that C LAGS B:
    // C's share of B's rise grows with time, and — derived — from rest, heat entering A raises A, B and C as t, t² and t³ at
    // early times (each link integrates once more), read on the exact stored energy at 1 and 2 ms (corrections O(k·t) ≈ 1.5%).
    expect(at('C', 2) / at('B', 2)).toBeLessThan(at('C', 40) / at('B', 40));
    expect(at('C', 40)).toBeGreaterThan(10 * at('C', 2));
    const early = simulateThermal(grid(0.002, 1e-4), [constant('p', grid(0.002, 1e-4), 10)], desc(B, L, [{ source: 'p', receiver: 'A' }]));
    const order = (id: string) => Math.log2(early.storedJ[id][20] / early.storedJ[id][10]);
    console.log(`NETWORK chain early-time orders (log2 of Q(2 ms)/Q(1 ms)): A ${order('A').toFixed(4)}, B ${order('B').toFixed(4)}, C ${order('C').toFixed(4)}`);
    expect(Math.abs(order('A') - 1)).toBeLessThan(0.05); expect(Math.abs(order('B') - 2)).toBeLessThan(0.05); expect(Math.abs(order('C') - 3)).toBeLessThan(0.05);
    expect(bodyBoundsHold(r)).toBe(true);
    console.log(`NETWORK chain: rise A/B/C at 2 s = ${['A', 'B', 'C'].map((id) => at(id, 2).toExponential(3)).join(' / ')} K, at 40 s = ${['A', 'B', 'C'].map((id) => at(id, 40).toExponential(3)).join(' / ')} K; transfer AB ${r.linkJ.AB[t.length - 1].toExponential(4)} J, BC ${r.linkJ.BC[t.length - 1].toExponential(4)} J; vs expm ${(w / maxRise).toExponential(2)} of the largest rise`);
  });
  it('limiting case: with the bottleneck at G = 0, C is unchanged EXACTLY and A–B follow the two-body closed form', () => {
    const Bl = [body('A'), body('B', { heatCapacityJPerK: 2 }), body('C', { heatCapacityJPerK: 4, initialTemperatureK: 320 })];
    const t = grid(10, 0.1), P = 10, r = simulateThermal(t, [constant('p', t, P)], desc(Bl, [link('AB', 'A', 'B', 5), link('BC', 'B', 'C', 0)], [{ source: 'p', receiver: 'A' }]));
    expect(r.temperatureK.C.every((x) => x === 320)).toBe(true);
    const CA = 1, CB = 2, k = 5 * (1 / CA + 1 / CB), Dinf = (P / CA) / k;
    let w = 0, rise = 0;
    for (let j = 0; j < t.length; j++) {
      const Tbar = 300 + P * t[j] / (CA + CB), D = Dinf * (1 - Math.exp(-k * t[j]));
      w = Math.max(w, Math.abs(r.temperatureK.A[j] - (Tbar + CB / (CA + CB) * D)), Math.abs(r.temperatureK.B[j] - (Tbar - CA / (CA + CB) * D)));
      rise = Math.max(rise, Tbar + CB / (CA + CB) * D - 300);
    }
    expect(w / rise).toBeLessThan(1e-9);
  });
  it('refinement on sinusoidal power against a fine RK4 reference: each halving of the sample interval cuts the error ≥ 3×', () => {
    const P = (s: number) => [5 * (1 + Math.sin(2 * Math.PI * s / 4)), 0, 0], T1 = 8;
    const ref = rk4(B, L, P, T1, 1e-3, 0.1);
    const err = (dt: number) => {
      const t = grid(T1, dt), w = new Float64Array(t.length).map((_, k) => P(t[k])[0]);
      const r = simulateThermal(t, [{ id: 'p', kind: 'passive-part', watts: w }], desc(B, L, [{ source: 'p', receiver: 'A' }]));
      let m = 0; const stride = Math.round(0.1 / dt);
      for (let j = 0; j < ref.length; j++) B.forEach((b, i) => { m = Math.max(m, Math.abs(r.temperatureK[b.id][j * stride] - ref[j][i])); });
      return m;
    };
    const e1 = err(0.1), e2 = err(0.05), e3 = err(0.025);
    console.log('NETWORK refinement (chain, sinusoidal P): worst error vs RK4 at Δt = 0.1/0.05/0.025 s =', e1, e2, e3);
    expect(e2).toBeLessThan(e1 / 3); expect(e3).toBeLessThan(e2 / 3);
  });
  it('maximum principle: unforced insulated networks (random, parallel links included) stay within the initial extrema; a stiff one (G·h/C ≈ 1e9) lands on the weighted mean', () => {
    for (const stiff of [false, true]) for (let seed = 1; seed <= 12; seed++) {
      const rnd = lcg(seed * 7919 + (stiff ? 1 : 0)), n = 6;
      const bodies = Array.from({ length: n }, (_, i) => body(`n${i}`, { heatCapacityJPerK: stiff ? 1e-3 * (1 + 9 * rnd()) : 0.5 + 4.5 * rnd(), initialTemperatureK: 280 + 100 * rnd() }));
      const G = () => (stiff ? 1e5 * (1 + 9 * rnd()) : 0.1 + 9.9 * rnd());
      const links = bodies.slice(1).map((b, i) => link(`c${i}`, bodies[i].id, b.id, G()));
      for (let x = 0; x < 3; x++) { const i = Math.floor(rnd() * n), j = (i + 1 + Math.floor(rnd() * (n - 1))) % n; links.push(link(`x${x}`, bodies[i].id, bodies[j].id, G())); }
      links.push(link('par', links[0].a, links[0].b, G()));                                 // a parallel path
      const t = stiff ? new Float64Array([0, 1, 2, 3]) : grid(20, 0.25), r = simulateThermal(t, [], desc(bodies, links));
      const T0 = bodies.map((b) => b.initialTemperatureK), lo = Math.min(...T0), hi = Math.max(...T0), R = hi - lo;
      for (const b of bodies) for (const v of r.temperatureK[b.id]) { expect(v).toBeGreaterThanOrEqual(lo - 1e-12 * R); expect(v).toBeLessThanOrEqual(hi + 1e-12 * R); }
      const Csum = bodies.reduce((s, b) => s + b.heatCapacityJPerK, 0), e = t.length - 1;
      expect(Math.abs(bodies.reduce((s, b) => s + r.storedJ[b.id][e], 0))).toBeLessThan(1e-12 * Csum * R);
      if (stiff) {
        const mean = bodies.reduce((s, b) => s + b.heatCapacityJPerK * b.initialTemperatureK, 0) / Csum;
        for (const b of bodies) expect(Math.abs(r.temperatureK[b.id][e] - mean) / R, `seed ${seed} ${b.id}`).toBeLessThan(1e-12);
      }
      expect(bodyBoundsHold(r), `seed ${seed} stiff ${stiff}`).toBe(true);
    }
  });
  it('over-diffusion negative: one backward-Euler step closes the energy books yet misses the closed form — closure alone does not pass', () => {
    const C1 = 2, C2 = 6, G = 0.8, h = 5, d = desc([body('h', { heatCapacityJPerK: C1, initialTemperatureK: 350 }), body('c', { heatCapacityJPerK: C2 })], [link('l', 'h', 'c', G)]);
    const a11 = C1 + h * G, a12 = -h * G, a22 = C2 + h * G, r1 = C1 * 350, r2 = C2 * 300, det = a11 * a22 - a12 * a12;
    const T1 = (r1 * a22 - a12 * r2) / det, T2 = (a11 * r2 - a12 * r1) / det;
    expect(Math.abs(C1 * (T1 - 350) + C2 * (T2 - 300))).toBeLessThan(1e-12 * (C1 + C2) * 50);   // the books close…
    const [a, b] = twoBody(C1, C2, G, 350, 300, h);
    expect(Math.max(Math.abs(T1 - a), Math.abs(T2 - b)) / 50).toBeGreaterThan(1e-3);          // …and the trajectory is wrong
    const exact = simulateThermal(new Float64Array([0, h]), [], d);
    expect(Math.max(Math.abs(exact.temperatureK.h[1] - a), Math.abs(exact.temperatureK.c[1] - b)) / 50).toBeLessThan(1e-9);
  });
});

// ---------------------------------------------------------------- 4
describe('4 · production networks on the kit\'s solved runs (WASM)', () => {
  it('thermal-heater: the solved 14.4 W heats a resistor body that sheds into a heatsink — the expm reference, the composite and the books', async () => {
    const { c, s, times, pick } = await solve(fixture('thermal-heater.composition.json'));
    const d = fixture('thermal-heater.network.thermal.json') as ThermalDescriptor;
    const { run, account, composite } = thermalFromComposition(c, s, times, pick, d);
    const e = times.length - 1, rise = run.temperatureK.resistor[e] - 293.15;
    let w = 0;
    for (let k = 0; k < times.length; k += 5) { const ref = reference(d.bodies, d.links!, [14.4, 0], times[k]); w = Math.max(w, Math.abs(run.temperatureK.resistor[k] - ref[0]), Math.abs(run.temperatureK.heatsink[k] - ref[1])); }
    expect(w / rise).toBeLessThan(1e-6);
    expect(Math.abs(composite.compositeResidualJ - composite.electromechanicalResidualJ)).toBeLessThan(1e-9 * account.throughput);
    expect(Math.abs(composite.thermalBooksGapJ)).toBeLessThan(1e-9 * Math.max(1, run.routedJ));
    const audit = networkAudit(run);
    expect(Math.abs(audit.linkCancellationJ)).toBeLessThanOrEqual(1e-12 * audit.transferMagnitudeJ);
    expect(bodyBoundsHold(run)).toBe(true);
    expect(run.linkJ.pad[e]).toBeGreaterThan(0);                                         // resistor → heatsink
    const idx = (x: number) => times.findIndex((v) => v >= x - 1e-12);
    console.log(`NETWORK heater: at 0.025/0.05/0.1 s resistor ΔT ${[0.025, 0.05, 0.1].map((x) => (run.temperatureK.resistor[idx(x)] - 293.15).toExponential(4)).join(' / ')} K, heatsink ΔT ${[0.025, 0.05, 0.1].map((x) => (run.temperatureK.heatsink[idx(x)] - 293.15).toExponential(4)).join(' / ')} K; pad ${[0.025, 0.05, 0.1].map((x) => run.linkJ.pad[idx(x)].toExponential(4)).join(' / ')} J; ambient ${composite.routedAmbientJ.toExponential(3)} J; vs expm ${(w / rise).toExponential(2)}; composite − electrical ${(composite.compositeResidualJ - composite.electromechanicalResidualJ).toExponential(2)} J`);

    // the SAME network continues with its links intact (zero input): expm reference from the end state, energy lost = ambient export
    const cool = continueCooling(run, 3600, 720), k1 = cool.times.length - 1, T0 = [cool.temperatureK.resistor[0], cool.temperatureK.heatsink[0]];
    const range = Math.max(...T0.map((v) => v - 293.15));
    let wc = 0;
    for (let k = 0; k <= k1; k += 24) { const ref = reference(d.bodies, d.links!, [0, 0], cool.times[k] - cool.times[0], T0); wc = Math.max(wc, Math.abs(cool.temperatureK.resistor[k] - ref[0]), Math.abs(cool.temperatureK.heatsink[k] - ref[1])); }
    expect(wc / range).toBeLessThan(1e-9);
    const lost = (cool.storedJ.resistor[0] - cool.storedJ.resistor[k1]) + (cool.storedJ.heatsink[0] - cool.storedJ.heatsink[k1]);
    const gained = (cool.ambientOutJ.resistor[k1] - cool.ambientOutJ.resistor[0]) + (cool.ambientOutJ.heatsink[k1] - cool.ambientOutJ.heatsink[0]);
    expect(Math.abs(lost - gained)).toBeLessThan(1e-12 * cool.network.energyScaleJ);
    expect(cool.linkJ.pad[k1]).toBeGreaterThan(cool.linkJ.pad[0]);                          // the link keeps carrying heat
    console.log(`NETWORK heater continuation 3600 s: resistor/heatsink ΔT at 0/60/3600 s = ${[0, 12, k1].map((k) => `${(cool.temperatureK.resistor[k] - 293.15).toExponential(3)}/${(cool.temperatureK.heatsink[k] - 293.15).toExponential(3)}`).join(', ')} K; vs expm ${(wc / range).toExponential(2)}; lost − ambient ${(lost - gained).toExponential(2)} J`);
  }, 120000);
  it('hoist-locked: winding → casing ← bearing, the brake body a singleton (bit-identical to its v1 result), composite and books', async () => {
    const { c, s, times, pick } = await solve(fixture('hoist-locked.composition.json'));
    const d = fixture('hoist-locked.network.thermal.json') as ThermalDescriptor;
    const { run, account, composite } = thermalFromComposition(c, s, times, pick, d), v1 = thermalFromComposition(c, s, times, pick, fixture('hoist-locked.thermal.json'));
    const e = times.length - 1;
    expect(Math.abs(composite.compositeResidualJ - composite.electromechanicalResidualJ)).toBeLessThan(1e-9 * account.throughput);
    expect(Math.abs(account.residual) / account.throughput).toBeLessThan(1e-3);
    expect(composite.unroutedOutgoingJ).toBeCloseTo(account.losses.sw + account.losses.fw, 12);
    expect(Math.abs(composite.thermalBooksGapJ)).toBeLessThan(1e-9 * Math.max(1, run.routedJ));
    const audit = networkAudit(run);
    expect(Math.abs(audit.linkCancellationJ)).toBeLessThanOrEqual(1e-12 * audit.transferMagnitudeJ);
    expect(bodyBoundsHold(run)).toBe(true);
    expect(Array.from(run.temperatureK['brake-body'])).toEqual(Array.from(v1.run.temperatureK['brake-body']));
    expect(run.temperatureK.winding[e]).toBeGreaterThan(run.temperatureK.casing[e]);
    for (let k = 1; k < times.length; k++) expect(run.linkJ['winding-casing'][k]).toBeGreaterThanOrEqual(run.linkJ['winding-casing'][k - 1]);
    // the winding body is the same heat as v1's motor body, but it now sheds into a casing: its rise is the winding energy over C,
    // less what the link carried (it has no ambient path of its own)
    expect((run.temperatureK.winding[e] - 293.15) * 5 + run.linkJ['winding-casing'][e]).toBeCloseTo(account.losses['m.winding'], 9);
    const idx = (x: number) => { const k = times.findIndex((v) => v >= x - 1e-12); return k === -1 ? e : k; };
    console.log(`NETWORK hoist-locked: at 0.1/0.3/0.6 s ΔT winding ${[0.1, 0.3, 0.6].map((x) => (run.temperatureK.winding[idx(x)] - 293.15).toExponential(3)).join(' / ')} K, casing ${[0.1, 0.3, 0.6].map((x) => (run.temperatureK.casing[idx(x)] - 293.15).toExponential(3)).join(' / ')} K, bearing ${[0.1, 0.3, 0.6].map((x) => (run.temperatureK.bearing[idx(x)] - 293.15).toExponential(3)).join(' / ')} K; winding→casing ${[0.1, 0.3, 0.6].map((x) => run.linkJ['winding-casing'][idx(x)].toExponential(3)).join(' / ')} J, bearing→casing ${run.linkJ['bearing-casing'][e].toExponential(3)} J; ambient ${composite.routedAmbientJ.toExponential(3)} J; composite − electromechanical ${(composite.compositeResidualJ - composite.electromechanicalResidualJ).toExponential(2)} J`);
    const cool = continueCooling(run, 600, 600), k1 = cool.times.length - 1;
    const peak = Math.max(...cool.temperatureK.casing);
    expect(peak).toBeGreaterThan(cool.temperatureK.casing[0]);                            // the casing keeps warming from the winding…
    expect(cool.temperatureK.winding[k1]).toBeLessThan(cool.temperatureK.winding[0]);    // …while the winding cools through it
    console.log(`NETWORK hoist-locked continuation 600 s: winding ΔT ${(cool.temperatureK.winding[0] - 293.15).toExponential(3)} → ${(cool.temperatureK.winding[k1] - 293.15).toExponential(3)} K; casing peak ΔT ${(peak - 293.15).toExponential(3)} K; winding→casing ${(cool.linkJ['winding-casing'][k1] - cool.linkJ['winding-casing'][0]).toExponential(3)} J more`);
  }, 240000);
});

// ---------------------------------------------------------------- 5
describe('5 · regressions and faults', () => {
  it('small link conductance (1e-16, 1e-20): the near-independent limit, no cancellation, no false refusal', () => {
    const t = grid(1, 0.1), e = t.length - 1;
    for (const G of [1e-16, 1e-20]) {
      const r = simulateThermal(t, [constant('p', t, 5)], desc([body('a', { heatCapacityJPerK: 2 }), body('b', { heatCapacityJPerK: 2 })], [link('l', 'a', 'b', G)], [{ source: 'p', receiver: 'a' }]));
      expect(r.temperatureK.a[e]).toBeCloseTo(302.5, 12);
      expect(r.temperatureK.b[e]).toBeCloseTo(300, 12);
      const expected = G * 5 / 2 * 1 / 2;                                                  // G·∫(T_a − T_b) dt = G·(P/C)·t²/2
      expect(r.linkJ.l[e] / expected).toBeCloseTo(1, 9);
      expect(bodyBoundsHold(r)).toBe(true);
    }
  });
  it('large capacity with 1 µs steps inside a network: 0.5 J stored across the pair, books closed (the b98f8b61 lesson holds for links)', () => {
    const t = new Float64Array(100001); for (let i = 0; i < t.length; i++) t[i] = i * 1e-6;
    const r = simulateThermal(t, [constant('p', t, 5)], desc([body('a', { heatCapacityJPerK: 1e9 }), body('b', { heatCapacityJPerK: 1e9 })], [link('l', 'a', 'b', 0.5)], [{ source: 'p', receiver: 'a' }]));
    const e = t.length - 1, stored = r.storedJ.a[e] + r.storedJ.b[e], input = r.routedInJ.a[e];
    expect(input).toBeCloseTo(0.5, 12);
    expect(Math.abs(stored - input) / input).toBeLessThan(1e-12);
    expect(r.storedJ.b[e]).toBeGreaterThan(0);                                            // the link moved a sub-ulp trickle, kept
    expect(Math.abs(r.linkJ.l[e] - r.storedJ.b[e]) / r.storedJ.b[e]).toBeLessThan(1e-9);
  });
  it('a duplicate source id is still refused with links present', () => {
    const t = grid(1, 0.1);
    expect(cause(() => simulateThermal(t, [constant('p', t, 5), constant('p', t, 9)], desc([body('a'), body('b')], [link('l', 'a', 'b', 1)], [{ source: 'p', receiver: 'a' }])))).toBe('duplicate-source');
  });
  it('bad links are refused by name', () => {
    const B = [body('a'), body('b')];
    expect(cause(() => validateDescriptor(desc(B, [link('l', 'a', 'zz', 1)])))).toBe('unknown-body');
    expect(cause(() => validateDescriptor(desc(B, [link('l', 'a', 'a', 1)])))).toBe('self-link');
    expect(cause(() => validateDescriptor(desc(B, [link('l', 'a', 'b', 1), link('l', 'b', 'a', 2)])))).toBe('duplicate-link');
    expect(cause(() => validateDescriptor(desc(B, [{ ...link('l', 'a', 'b', 1), areaM2: 1 } as never])))).toBe('unsupported-field');
    expect(cause(() => validateDescriptor({ id: 't', bodies: B, routes: [], link: [link('l', 'a', 'b', 1)] } as never))).toBe('unsupported-field');
    for (const g of [-1, Number.NaN, Infinity, 2e6]) expect(cause(() => validateDescriptor(desc(B, [link('l', 'a', 'b', g)])))).toBe('invalid-parameter');
    const many = Array.from({ length: 17 }, (_, i) => body(`n${i}`));
    expect(cause(() => validateDescriptor(desc(many, many.slice(1).map((b, i) => link(`c${i}`, many[i].id, b.id, 1)))))).toBe('network-too-large');
    expect(cause(() => validateDescriptor(desc(B, Array.from({ length: 65 }, (_, i) => link(`p${i}`, 'a', 'b', 1)))))).toBe('network-too-large');
  });
  it('booking faults: swapped ends (the per-body audit catches what the sum cannot), a one-sided sign error and a doubled transfer', async () => {
    const { c, s, times, pick } = await solve(fixture('thermal-heater.composition.json'));
    const { run, account, composite } = thermalFromComposition(c, s, times, pick, fixture('thermal-heater.network.thermal.json'));
    const e = times.length - 1, F = run.linkJ.pad[e], base = composite.compositeResidualJ;
    const tampered = (out: Record<string, Float64Array>): ThermalRun => ({ ...run, linkOutJ: out });
    // swapped ends: the resistor books −F, the heatsink +F — the network SUM is still zero…
    const swapped = tampered({ resistor: run.linkOutJ.resistor.map((x) => -x), heatsink: run.linkOutJ.heatsink.map((x) => -x) });
    expect(Math.abs(compositeBalance(account, swapped).compositeResidualJ - base)).toBeLessThan(1e-12 * account.throughput);
    const a = networkAudit(swapped);                                                      // …but each endpoint's books are off by 2F
    expect(Math.abs(a.bodyBooksGapJ.resistor) / (2 * F)).toBeCloseTo(1, 9);
    expect(Math.abs(a.bodyBooksGapJ.heatsink) / (2 * F)).toBeCloseTo(1, 9);
    expect(Math.abs(a.orientationGapJ.resistor) / (2 * F)).toBeCloseTo(1, 9);
    // one-sided: the heatsink books +F as well — Σ linkOut = 2F, the composite departs by 2F
    const oneSided = tampered({ ...run.linkOutJ, heatsink: run.linkOutJ.heatsink.map((x) => -x) });
    expect(networkAudit(oneSided).linkCancellationJ / (2 * F)).toBeCloseTo(1, 9);
    expect((base - compositeBalance(account, oneSided).compositeResidualJ) / (2 * F)).toBeCloseTo(1, 9);
    // doubled: the resistor books the transfer twice — the composite departs by F
    const doubled = tampered({ ...run.linkOutJ, resistor: run.linkOutJ.resistor.map((x) => 2 * x) });
    expect((base - compositeBalance(account, doubled).compositeResidualJ) / F).toBeCloseTo(1, 9);
    expect(Math.abs(base - composite.electromechanicalResidualJ)).toBeLessThan(1e-9 * account.throughput);   // the true run passes
  }, 120000);
  it('extreme stiffness across the domain: every configuration passes its bounds or is refused BY NAME — never silently wrong', () => {
    // Amendment N-4: after N-2 and N-3 no in-domain configuration was found that trips `network-residual`; the guard stays, and this
    // sweep (stiff ambient, stiff link with a 1e15 capacity spread, stiff link behind a bottleneck, different ambients across a
    // stiff link; steps 1e-4 … 1e3 s) asserts the contract that matters: pass all bounds, or refuse by name.
    const fam = (h: number): [string, ThermalDescriptor][] => [
      ['stiff ambient', desc([body('a', { heatCapacityJPerK: 1e-6, conductanceWPerK: 1e6, initialTemperatureK: 400 }), body('b')], [link('l', 'a', 'b', 1e6)], [{ source: 'p', receiver: 'a' }])],
      ['capacity spread', desc([body('a', { heatCapacityJPerK: 1e-6, initialTemperatureK: 400 }), body('b', { heatCapacityJPerK: 1e9, conductanceWPerK: 1e-3 })], [link('l', 'a', 'b', 1e6)], [{ source: 'p', receiver: 'a' }])],
      ['stiff behind bottleneck', desc([body('a', { heatCapacityJPerK: 1e-6, initialTemperatureK: 400 }), body('b', { heatCapacityJPerK: 1e-6 }), body('c', { heatCapacityJPerK: 1e3, conductanceWPerK: 1 })], [link('ab', 'a', 'b', 1e6), link('bc', 'b', 'c', 1e-6)], [{ source: 'p', receiver: 'a' }])],
      ['different ambients', desc([body('a', { heatCapacityJPerK: 1e-6, ambientTemperatureK: 400, conductanceWPerK: 1 }), body('b', { heatCapacityJPerK: 1e-6, ambientTemperatureK: 200, conductanceWPerK: 1 })], [link('l', 'a', 'b', 1e6)], [{ source: 'p', receiver: 'a' }])],
    ].map(([n, d]) => [`${n} h=${h}`, d as ThermalDescriptor] as [string, ThermalDescriptor]);
    const outcome: string[] = [];
    for (const h of [1e-4, 1e-2, 1, 1e3]) for (const [name, d] of fam(h)) {
      const t = new Float64Array([0, h, 2 * h, 3 * h]);
      try {
        const r = simulateThermal(t, [constant('p', t, 5)], d), e = t.length - 1;
        expect(bodyBoundsHold(r), name).toBe(true);
        const stored = d.bodies.reduce((s, b) => s + r.storedJ[b.id][e] + r.ambientOutJ[b.id][e], 0);
        expect(Math.abs(stored - r.routedInJ.a[e]), name).toBeLessThanOrEqual(1e-12 * r.network.energyScaleJ);
        outcome.push(`${name}: pass (worst residual ratio ${worstRatio(r).toExponential(1)})`);
      } catch (err) {
        const why = (err as ThermalError).cause_;
        expect(['network-residual', 'network-conditioning', 'unsupported-temperature'], `${name}: ${(err as Error).message}`).toContain(why);
        outcome.push(`${name}: refused ${why}`);
      }
    }
    console.log('NETWORK extreme sweep —', outcome.join('; '));
    expect(outcome.filter((o) => o.includes('pass')).length).toBeGreaterThan(8);
  });
  it('a conductance scale error (1000× G, kW/K read as W/K) misses the two-body closed form by far more than its tolerance', () => {
    const t = grid(10, 0.5), e = t.length - 1;
    const bad = simulateThermal(t, [], desc([body('h', { heatCapacityJPerK: 2, initialTemperatureK: 350 }), body('c', { heatCapacityJPerK: 6 })], [link('l', 'h', 'c', 800)]));
    let w = 0; for (let k = 0; k <= e; k++) w = Math.max(w, Math.abs(bad.temperatureK.h[k] - twoBody(2, 6, 0.8, 350, 300, t[k])[0]));
    expect(w / 50).toBeGreaterThan(0.1);                                                  // tolerance 1e-9
  });
});

// ---------------------------------------------------------------- Astra's return thermal-network-v1-021b10f3 (amendment N-5)
describe('return 021b10f3: one common reference, inactive ambients, active ambients across a stiff link, and the gate', () => {
  const pair = (C: number, T0: [number, number], Ta: [number, number], Gamb: [number, number] = [0, 0], G = 1e6) =>
    desc([body('a', { heatCapacityJPerK: C, initialTemperatureK: T0[0], ambientTemperatureK: Ta[0], conductanceWPerK: Gamb[0] }),
      body('b', { heatCapacityJPerK: C, initialTemperatureK: T0[1], ambientTemperatureK: Ta[1], conductanceWPerK: Gamb[1] })], [link('l', 'a', 'b', G)]);
  it("Astra's probe: equal temperatures with INACTIVE ambients 200/400 K stay exactly 300/300 with exactly zero transfer", () => {
    for (const h of [1000, 1, 1e-3]) for (const C of [1e-6, 1]) {
      const r = simulateThermal(new Float64Array([0, h]), [], pair(C, [300, 300], [200, 400]));
      expect([r.temperatureK.a[1], r.temperatureK.b[1], r.linkJ.l[1]], `h ${h} C ${C}`).toEqual([300, 300, 0]);   // was 329.10 / 270.90 K
    }
  });
  it('unequal temperatures, inactive ambients 200/400 K: the two-body closed form, bit-identical to ambients 300/300 K', () => {
    const t = grid(10, 0.5), d = (Ta: [number, number]) => desc([body('h', { heatCapacityJPerK: 2, initialTemperatureK: 350, ambientTemperatureK: Ta[0] }), body('c', { heatCapacityJPerK: 6, ambientTemperatureK: Ta[1] })], [link('l', 'h', 'c', 0.8)]);
    const r = simulateThermal(t, [], d([200, 400])), same = simulateThermal(t, [], d([300, 300]));
    let w = 0; for (let k = 0; k < t.length; k++) { const [a, b] = twoBody(2, 6, 0.8, 350, 300, t[k]); w = Math.max(w, Math.abs(r.temperatureK.h[k] - a), Math.abs(r.temperatureK.c[k] - b)); }
    expect(w / 50).toBeLessThan(1e-9);
    expect(Array.from(r.temperatureK.h)).toEqual(Array.from(same.temperatureK.h)); expect(Array.from(r.linkJ.l)).toEqual(Array.from(same.linkJ.l));
    const stiff = simulateThermal(new Float64Array([0, 1000]), [], pair(1e-6, [350, 250], [200, 400]));   // stiff: the mean, exactly split-free
    expect(Math.abs(stiff.temperatureK.a[1] - 300)).toBeLessThan(1e-12 * 50); expect(Math.abs(stiff.temperatureK.b[1] - 300)).toBeLessThan(1e-12 * 50);
  });
  it('an inactive ambient elsewhere in a network cannot enter: changing it is bit-identical', () => {
    const t = grid(5, 0.25), d = (TaB: number) => desc([body('a', { heatCapacityJPerK: 2, conductanceWPerK: 0.3 }), body('b', { heatCapacityJPerK: 3, ambientTemperatureK: TaB }), body('c', { conductanceWPerK: 0.1, ambientTemperatureK: 310 })],
      [link('ab', 'a', 'b', 1), link('bc', 'b', 'c', 0.4)], [{ source: 'p', receiver: 'b' }]);
    const r1 = simulateThermal(t, [constant('p', t, 3)], d(300)), r2 = simulateThermal(t, [constant('p', t, 3)], d(1e5));
    for (const id of ['a', 'b', 'c']) expect(Array.from(r2.temperatureK[id])).toEqual(Array.from(r1.temperatureK[id]));
  });
  it('a weak (1e-20 W/K) link: changing the other body\'s parameters leaves this body unchanged within 1e-12 of its rise', () => {
    const t = grid(10, 0.25), d = (Cb: number, Tb: number, Tab: number) => desc([body('a', { heatCapacityJPerK: 2, conductanceWPerK: 0.5 }), body('b', { heatCapacityJPerK: Cb, initialTemperatureK: Tb, ambientTemperatureK: Tab, conductanceWPerK: 0.2 })],
      [link('l', 'a', 'b', 1e-20)], [{ source: 'p', receiver: 'a' }]);
    const base = simulateThermal(t, [constant('p', t, 5)], d(3, 300, 300)), rise = Math.max(...base.temperatureK.a.map((x) => x - 300));
    for (const [Cb, Tb, Tab] of [[1e6, 300, 300], [3, 900, 300], [3, 300, 50], [1e-6, 1000, 2000]]) {
      const r = simulateThermal(t, [constant('p', t, 5)], d(Cb, Tb, Tab));
      let w = 0; for (let k = 0; k < t.length; k++) w = Math.max(w, Math.abs(r.temperatureK.a[k] - base.temperatureK.a[k]));
      expect(w / rise, `b = ${Cb} J/K, ${Tb} K, ambient ${Tab} K`).toBeLessThan(1e-12);
    }
  });
  it('ACTIVE ambients 400/200 K across a stiff link: the exact steady split, and a stiffer step refused by name (network-conditioning)', () => {
    // G_amb(T_a − 400) + G(T_a − T_b) = 0 and G_amb(T_b − 200) + G(T_b − T_a) = 0  ⇒  T_a,b = 300 ± 100·G_amb/(G_amb + 2G)
    const Gamb = 1, G = 1e6, split = 100 * Gamb / (Gamb + 2 * G);
    for (const h of [1e-4, 1e-2]) {
      const t = new Float64Array([0, h, 2 * h, 3 * h]), r = simulateThermal(t, [], pair(1e-6, [300, 300], [400, 200], [Gamb, Gamb], G)), e = t.length - 1;
      expect(Math.abs(r.temperatureK.a[e] - (300 + split)), `h ${h}`).toBeLessThan(1e-9 * 100);
      // the split (2e-4 K) is resolved to the declared forward bound 8ε·max(1, x)·|o| of N-5, x = G_amb·h/C, |o| = 200 K — an
      // undeclared "1e-6 relative" I first wrote failed at 3.9e-6 (3.9e-10 K, the predicted ε·x·|o| ≈ 4.4e-10 K at x = 1e4)
      const x = Gamb * h / 1e-6, bound = 8 * Number.EPSILON * Math.max(1, x) * 200;
      expect(Math.abs((r.temperatureK.a[e] - r.temperatureK.b[e]) - 2 * split), `h ${h}`).toBeLessThan(bound);
      expect(bodyBoundsHold(r)).toBe(true);
      // the reported FORWARD bound really bounds the forward error (against the exact steady state)
      expect(Math.abs(r.temperatureK.a[e] - (300 + split)), `h ${h}`).toBeLessThanOrEqual(r.network.bodyForwardBoundK.a);
      expect(Math.abs(r.temperatureK.b[e] - (300 - split)), `h ${h}`).toBeLessThanOrEqual(r.network.bodyForwardBoundK.b);
    }
    expect(cause(() => simulateThermal(new Float64Array([0, 1]), [], pair(1e-6, [300, 300], [400, 200], [Gamb, Gamb], G)))).toBe('network-conditioning');
  });
  it('heat through too little capacity per step: the forward error stays within the reported bound, and beyond 1e-9 of scale it is refused', () => {
    // a (1e-6 J/K, starting 400 K) is tied to ambient 300 K and to b (1 J/K) by 1e6 W/K each, 5 W into a: the steady state is
    // T_a = T_b = 300 + 5e-6 K. The booked increment of a is a difference of ≈ 5·h J flows through 1e-6 J/K (N-5).
    const d = desc([body('a', { heatCapacityJPerK: 1e-6, conductanceWPerK: 1e6, initialTemperatureK: 400 }), body('b')], [link('l', 'a', 'b', 1e6)], [{ source: 'p', receiver: 'a' }]);
    for (const h of [1e-4, 1e-2, 1]) {
      const t = new Float64Array([0, h, 2 * h, 3 * h]), r = simulateThermal(t, [constant('p', t, 5)], d), e = t.length - 1;
      const err = Math.abs(r.temperatureK.a[e] - (300 + 5e-6));
      console.log(`NETWORK flow-through h=${h}: |T_a − steady| ${err.toExponential(2)} K ≤ reported forward bound ${r.network.bodyForwardBoundK.a.toExponential(2)} K`);
      expect(err, `h ${h}`).toBeLessThanOrEqual(r.network.bodyForwardBoundK.a);
      expect(r.network.bodyForwardBoundK.a, `h ${h}`).toBeLessThanOrEqual(1e-9 * 100);
    }
    const t = new Float64Array([0, 1000, 2000, 3000]);
    expect(cause(() => simulateThermal(t, [constant('p', t, 5)], d))).toBe('network-conditioning');
  });
  it('the solve-residual gate FIRES on a wrong transfer (bounded test-only fault injection) and stays quiet without it', () => {
    const t = grid(10, 0.25), d = desc([body('h', { heatCapacityJPerK: 2, initialTemperatureK: 350 }), body('c', { heatCapacityJPerK: 6, conductanceWPerK: 0.2 })], [link('l', 'h', 'c', 0.8)]);
    try {
      NETWORK_FAULT_INJECTION.transferRelError = 1e-6;
      expect(cause(() => simulateThermal(t, [], d))).toBe('network-residual');
      NETWORK_FAULT_INJECTION.transferRelError = 1e-14;                                   // below the modal rounding scale
      expect(cause(() => simulateThermal(t, [], d))).toBe('no error');
    } finally { NETWORK_FAULT_INJECTION.transferRelError = 0; }
    expect(cause(() => simulateThermal(t, [], d))).toBe('no error');
  });
});
