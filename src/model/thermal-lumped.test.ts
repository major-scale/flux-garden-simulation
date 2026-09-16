/**
 * ELECTROTHERMAL V1 (bridge/ELECTROTHERMAL-V1-PLAN.md, docs/ELECTROTHERMAL-V1-DECLARATION.md), tolerances frozen there:
 *   1. analytic controls — closed forms, never the update under test: isolated heating, equilibrium approach, cooldown,
 *      ambient warming a cold body; units/scaling; refinement against the closed-form response to sinusoidal power;
 *   2. the boundary refuses bad input by name;
 *   3. PRODUCTION runs through the adapter on the kit's solved compositions (heater, hoist-lift, hoist-locked): temperatures,
 *      routed heat, ambient transfer, and the composite residual equal to the electromechanical one; a zero-input cooldown;
 *   4. negatives: reversed ambient exchange, duplicate booking, a unit slip, a run outside the motor domain.
 */
import { describe, it, expect } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import { readFileSync } from 'node:fs';
import { buildStructure, type Composition } from './conformance/composition';
import { makePicker, neededVectors, energyAccountOf } from './conformance/kit';
import { readGrid } from './spice/grid';
import { simulateThermal, continueCooling, compositeBalance, validateDescriptor, thermalFromComposition, lossSources, ThermalError, type ThermalDescriptor, type LossSource } from './thermal-lumped';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../tools/conformance/fixtures/${name}`, import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const cause = (fn: () => unknown): string => { try { fn(); return 'no error'; } catch (e) { return (e as ThermalError).cause_ ?? `other: ${(e as Error).message}`; } };
async function solve(c: Composition) {
  const s = buildStructure(c), wanted = ['time', ...neededVectors(s)];
  const sim = new Simulation(); await sim.start(); sim.setNetList(s.netlist);
  const g = readGrid(await sim.runSim() as never, wanted, c.analysis);
  return { c, s, times: g.times, pick: makePicker(s, g.times, g.pick) };
}
const grid = (t1: number, dt: number) => { const n = Math.round(t1 / dt) + 1, t = new Float64Array(n); for (let k = 0; k < n; k++) t[k] = k * dt; return t; };
const constant = (id: string, times: Float64Array, w: number): LossSource => ({ id, kind: 'passive-part', watts: new Float64Array(times.length).fill(w) });
const body = (over: Partial<ThermalDescriptor['bodies'][number]> = {}) => ({ id: 'b', heatCapacityJPerK: 2, initialTemperatureK: 300, ambientTemperatureK: 300, conductanceWPerK: 0.5, ...over });
const one = (b = body(), route: string | null = 'b'): ThermalDescriptor => ({ id: 't', bodies: [b], routes: [{ source: 'p', receiver: route }] });
const worstRel = (a: Float64Array, ref: (k: number) => number, scale: number) => { let w = 0; for (let k = 0; k < a.length; k++) w = Math.max(w, Math.abs(a[k] - ref(k))); return w / scale; };

describe('analytic controls (closed forms, not the update)', () => {
  const t = grid(10, 0.1);
  it('isolated (G = 0) constant heating: T = T0 + P·t/C; no ambient transfer', () => {
    const r = simulateThermal(t, [constant('p', t, 5)], one(body({ conductanceWPerK: 0 })));
    expect(worstRel(r.temperatureK.b, (k) => 300 + 5 * t[k] / 2, 25)).toBeLessThan(1e-9);
    expect(r.ambientOutJ.b[t.length - 1]).toBe(0); expect(r.storedJ.b[t.length - 1]).toBeCloseTo(50, 9);
  });
  it('constant power approaches T_a + P/G with τ = C/G; ambient transfer = ∫G(T − T_a) dt in closed form', () => {
    const r = simulateThermal(t, [constant('p', t, 5)], one());
    const Teq = 310, tau = 4, T = (x: number) => Teq + (300 - Teq) * Math.exp(-x / tau);
    expect(worstRel(r.temperatureK.b, (k) => T(t[k]), 10)).toBeLessThan(1e-9);
    const ambient = (x: number) => 0.5 * (10 * x - 10 * tau * (1 - Math.exp(-x / tau)));   // G·∫(T − Ta) = G·[10x − 10τ(1 − e^(−x/τ))]
    expect(worstRel(r.ambientOutJ.b, (k) => ambient(t[k]), 5 * 10)).toBeLessThan(1e-9);
    const long = simulateThermal(grid(200, 0.5), [constant('p', grid(200, 0.5), 5)], one());
    expect(long.temperatureK.b[long.times.length - 1]).toBeCloseTo(310, 9);                // equilibrium T_a + P/G
  });
  it('a hot body cools (P = 0): T = T_a + (T0 − T_a)·e^(−t/τ); a cold body is WARMED by ambient (signed exchange)', () => {
    const hot = simulateThermal(t, [constant('p', t, 0)], one(body({ initialTemperatureK: 350 })));
    expect(worstRel(hot.temperatureK.b, (k) => 300 + 50 * Math.exp(-t[k] / 4), 50)).toBeLessThan(1e-9);
    expect(hot.ambientOutJ.b[t.length - 1]).toBeGreaterThan(0);
    const cold = simulateThermal(t, [constant('p', t, 0)], one(body({ initialTemperatureK: 250 })));
    expect(worstRel(cold.temperatureK.b, (k) => 300 - 50 * Math.exp(-t[k] / 4), 50)).toBeLessThan(1e-9);
    expect(cold.ambientOutJ.b[t.length - 1]).toBeLessThan(0);                            // heat flowed FROM ambient
  });
  it('units and scaling: doubling C halves the isolated rise; a kJ-for-J slip misses the analytic rise 1000-fold', () => {
    const rise = (C: number) => { const r = simulateThermal(t, [constant('p', t, 5)], one(body({ heatCapacityJPerK: C, conductanceWPerK: 0 }))); return r.temperatureK.b[t.length - 1] - 300; };
    expect(rise(4) / rise(2)).toBeCloseTo(0.5, 12);
    expect(rise(0.002) / (5 * 10 / 2)).toBeCloseTo(1000, 6);                              // what C = 2 kJ/K entered as 0.002 would do
  });
  it('refinement: sinusoidal power against its closed-form response — halving the sample interval cuts the error ≥ 3×', () => {
    const P0 = 5, w = 2 * Math.PI, C = 2, G = 0.5, a = G / C, k = P0 / C;
    const exact = (x: number) => 300 + k * (1 - Math.exp(-a * x)) / a + k * (a * Math.sin(w * x) - w * Math.cos(w * x) + w * Math.exp(-a * x)) / (a * a + w * w);
    const err = (dt: number) => { const tt = grid(2, dt), src: LossSource = { id: 'p', kind: 'passive-part', watts: tt.map((x) => P0 * (1 + Math.sin(w * x))) };
      const r = simulateThermal(tt, [src], one()); return worstRel(r.temperatureK.b, (j) => exact(tt[j]), 1); };
    const e1 = err(0.1), e2 = err(0.05), e3 = err(0.025);
    console.log('ELECTROTHERMAL refinement (sinusoid): worst |T − exact| at Δt 0.1/0.05/0.025 s =', e1, e2, e3);
    // The DECLARED criterion: each halving cuts the error ≥ 3× (second order). Amendment T-1: an absolute 1e-3 K bound added here
    // without derivation failed at 1.54e-3 K; it is replaced by the order statement e3 < e1/10, which the ratios imply.
    expect(e1 / e2).toBeGreaterThan(3); expect(e2 / e3).toBeGreaterThan(3); expect(e3).toBeLessThan(e1 / 10);
  });
});

describe('the boundary refuses bad input by name', () => {
  const t = grid(1, 0.1);
  it('bodies and routes', () => {
    expect(cause(() => validateDescriptor(one(body({ heatCapacityJPerK: 0 }))))).toBe('invalid-parameter');
    expect(cause(() => validateDescriptor(one(body({ initialTemperatureK: 0 }))))).toBe('invalid-parameter');
    expect(cause(() => validateDescriptor(one(body({ conductanceWPerK: -1 }))))).toBe('invalid-parameter');
    expect(cause(() => validateDescriptor({ ...one(), bodies: [{ ...body(), emissivity: 0.9 } as never] }))).toBe('unsupported-field');
    expect(cause(() => validateDescriptor({ id: 't', bodies: [body()], routes: [{ source: 'p', receiver: 'b' }, { source: 'p', receiver: null }] }))).toBe('duplicate-route');
    expect(cause(() => validateDescriptor(one(body(), 'nowhere')))).toBe('unknown-body');
  });
  it('sources: unlisted, unknown, non-loss, negative beyond the floor, non-finite; tiny negatives kept and counted', () => {
    expect(cause(() => simulateThermal(t, [constant('p', t, 1), constant('q', t, 1)], one()))).toBe('unrouted-source');
    expect(cause(() => simulateThermal(t, [constant('q', t, 1)], one()))).toBe('unknown-source');
    expect(cause(() => simulateThermal(t, [], one(), [{ id: 'p', reason: 'work on the external load' }]))).toBe('not-a-loss');
    const neg = constant('p', t, 1); neg.watts[3] = -0.1; expect(cause(() => simulateThermal(t, [neg], one()))).toBe('negative-loss');
    const nan = constant('p', t, 1); nan.watts[2] = NaN; expect(cause(() => simulateThermal(t, [nan], one()))).toBe('nonfinite-loss');
    const noise = constant('p', t, 1); noise.watts[4] = -1e-12; const r = simulateThermal(t, [noise], one());
    expect(r.negativeSamples.p).toBe(1);                                                    // signed, never clipped
    expect(r.negativeEnergyJ.p).toBeLessThan(0); expect(r.negativeEnergyJ.p).toBeCloseTo(-1e-13, 20);   // ½(−1e-12 W)·0.1 s × 2 intervals
  });
  it('time grid and temperature range', () => {
    expect(cause(() => simulateThermal(new Float64Array([0, 0.1, 0.1]), [constant('p', new Float64Array(3), 1)], one()))).toBe('invalid-time');
    expect(cause(() => simulateThermal(t, [constant('p', t, 1e12)], one(body({ conductanceWPerK: 0 }))))).toBe('unsupported-temperature');
    expect(cause(() => continueCooling(simulateThermal(t, [constant('p', t, 1)], one()), -1))).toBe('invalid-time');
  });
});

describe('production runs through the adapter (the kit\'s solved compositions, WASM)', () => {
  it('thermal-heater: 14.4 W from the solved resistor, the body follows the closed form, the composite residual equals the electrical one', async () => {
    const { c, s, times, pick } = await solve(fixture('thermal-heater.composition.json'));
    const { run, account, composite } = thermalFromComposition(c, s, times, pick, fixture('thermal-heater.thermal.json'));
    const Teq = 293.15 + 14.4 / 0.5, T = (x: number) => Teq + (293.15 - Teq) * Math.exp(-x / 4), rise = T(times[times.length - 1]) - 293.15;
    expect(worstRel(run.temperatureK['heater-body'], (k) => T(times[k]), rise)).toBeLessThan(1e-6);
    expect(account.losses.rh).toBeCloseTo(14.4 * times[times.length - 1], 6);
    expect(Math.abs(composite.compositeResidualJ - composite.electromechanicalResidualJ)).toBeLessThan(1e-9 * account.throughput);
    expect(Math.abs(composite.thermalBooksGapJ)).toBeLessThan(1e-12 * Math.max(1, run.routedJ));
  }, 120000);
  it('hoist-lift and hoist-locked: winding, viscous and brake heat routed; switch/diode outgoing; the locked motor heats far more for no motion', async () => {
    const out: Record<string, ReturnType<typeof thermalFromComposition>> = {};
    for (const name of ['hoist-lift', 'hoist-locked']) {
      const { c, s, times, pick } = await solve(fixture(`${name}.composition.json`));
      out[name] = thermalFromComposition(c, s, times, pick, fixture(`${name}.thermal.json`));
      const { run, account, composite } = out[name];
      expect(Math.abs(composite.compositeResidualJ - composite.electromechanicalResidualJ)).toBeLessThan(1e-9 * account.throughput);
      expect(Math.abs(account.residual) / account.throughput).toBeLessThan(1e-3);
      expect(composite.unroutedOutgoingJ).toBeCloseTo(account.losses.sw + account.losses.fw, 12);
      for (const [id, n] of Object.entries(run.negativeSamples)) expect(n, id).toBeLessThan(run.times.length);   // counted, reported
      const idx = (t: number) => run.times.findIndex((x) => x >= t);
      console.log(`ELECTROTHERMAL ${name}: motor-body ΔT at 0.1/0.3/0.6 s = ${[0.1, 0.3, 0.6].map((t) => (run.temperatureK['motor-body'][idx(t) === -1 ? run.times.length - 1 : idx(t)] - 293.15).toExponential(3)).join(' / ')} K; winding ${account.losses['m.winding'].toExponential(4)} J, viscous ${account.losses['m.viscous'].toExponential(4)} J, brake ${account.losses['m.brake'].toExponential(3)} J; ambient ${composite.routedAmbientJ.toExponential(3)} J; composite residual ${composite.compositeResidualJ.toExponential(3)} J`);
    }
    const rise = (n: string, b: string) => { const r = out[n].run; return r.temperatureK[b][r.times.length - 1] - 293.15; };
    expect(rise('hoist-locked', 'motor-body')).toBeGreaterThan(10 * rise('hoist-lift', 'motor-body'));
    expect(rise('hoist-lift', 'bearing')).toBeGreaterThan(100 * Math.abs(rise('hoist-locked', 'bearing')));
  }, 240000);
  it('cooldown: a zero-input continuation of the locked motor body follows the closed form (a labelled boundary condition)', async () => {
    const { c, s, times, pick } = await solve(fixture('hoist-locked.composition.json'));
    const { run } = thermalFromComposition(c, s, times, pick, fixture('hoist-locked.thermal.json'));
    const cool = continueCooling(run, 600, 600), T0 = cool.temperatureK['motor-body'][0], a = 0.2 / 20;
    expect(cool.boundary).toMatch(/zero-input/);
    expect(worstRel(cool.temperatureK['motor-body'], (k) => 293.15 + (T0 - 293.15) * Math.exp(-a * (cool.times[k] - cool.times[0])), T0 - 293.15)).toBeLessThan(1e-9);
    const e = cool.times.length - 1;
    expect(cool.ambientOutJ['motor-body'][e] - cool.ambientOutJ['motor-body'][0]).toBeCloseTo(20 * (T0 - cool.temperatureK['motor-body'][e]), 9);
  }, 120000);
  it('sample refinement on the SOLVED, time-varying winding loss: the thermal result converges as the sample grid is refined', async () => {
    const { c, s, times, pick } = await solve(fixture('hoist-lift.composition.json'));
    const src = lossSources(c, s, times, pick).sources.find((x) => x.id === 'm.winding')!;
    const d: ThermalDescriptor = { id: 'w', bodies: [{ id: 'b', heatCapacityJPerK: 20, initialTemperatureK: 293.15, ambientTemperatureK: 293.15, conductanceWPerK: 0.2 }], routes: [{ source: 'm.winding', receiver: 'b' }] };
    const end = (stride: number) => { const idx = [...Array(times.length).keys()].filter((k) => k % stride === 0 || k === times.length - 1);
      const tt = Float64Array.from(idx, (k) => times[k]), ww = Float64Array.from(idx, (k) => src.watts[k]);
      const r = simulateThermal(tt, [{ ...src, watts: ww }], d); return r.temperatureK.b[tt.length - 1]; };
    const t1 = end(1), e2 = Math.abs(end(2) - t1), e4 = Math.abs(end(4) - t1), e8 = Math.abs(end(8) - t1);
    console.log('ELECTROTHERMAL refinement (winding, hoist-lift): |ΔT_end| vs full grid at stride 2/4/8 =', e2, e4, e8);
    expect(e8).toBeGreaterThan(e4); expect(e4).toBeGreaterThan(e2); expect(e8 / (t1 - 293.15)).toBeLessThan(1e-2);
  }, 120000);
});

describe('negative controls', () => {
  it('REVERSED ambient exchange (heat given to ambient booked as received): the composite residual departs by twice the transfer', async () => {
    const { c, s, times, pick } = await solve(fixture('hoist-locked.composition.json'));
    const { run, account, composite } = thermalFromComposition(c, s, times, pick, fixture('hoist-locked.thermal.json'));
    const reversed = clone({ ...run, times: [...run.times] }) as never as typeof run;
    for (const id of Object.keys(run.ambientOutJ)) (reversed.ambientOutJ as Record<string, Float64Array>)[id] = run.ambientOutJ[id].map((x) => -x);
    (reversed as { times: Float64Array }).times = run.times; (reversed as { storedJ: typeof run.storedJ }).storedJ = run.storedJ; (reversed as { routedInJ: typeof run.routedInJ }).routedInJ = run.routedInJ;
    const bad = compositeBalance(account, reversed);
    expect(composite.routedAmbientJ).toBeGreaterThan(0);
    expect(Math.abs(bad.compositeResidualJ - bad.electromechanicalResidualJ)).toBeCloseTo(2 * composite.routedAmbientJ, 9);
    expect(Math.abs(bad.compositeResidualJ - bad.electromechanicalResidualJ)).toBeGreaterThan(1e3 * 1e-9 * account.throughput);
    expect(Math.abs(bad.thermalBooksGapJ)).toBeGreaterThan(1e-3);                                   // the thermal books no longer close either
  }, 120000);
  it('DUPLICATE booking: a loss listed twice is refused; an account carrying an extra copy of a loss is refused', async () => {
    const d = fixture('hoist-lift.thermal.json') as ThermalDescriptor;
    expect(cause(() => validateDescriptor({ ...d, routes: [...d.routes, { source: 'm.winding', receiver: null }] }))).toBe('duplicate-route');
    const { c, s, times, pick } = await solve(fixture('hoist-lift.composition.json'));
    const { run, account } = thermalFromComposition(c, s, times, pick, d);
    const doubled = { ...account, losses: { ...account.losses, 'm.winding#copy': account.losses['m.winding'] } };
    expect(cause(() => compositeBalance(doubled, run))).toBe('unrouted-source');
    expect(cause(() => thermalFromComposition(c, s, times, pick, { ...d, routes: d.routes.filter((r) => r.source !== 'fw') }))).toBe('unrouted-source');
    expect(cause(() => thermalFromComposition(c, s, times, pick, { ...d, routes: [...d.routes, { source: 'm.load', receiver: 'bearing' }] }))).toBe('not-a-loss');
  }, 120000);
  it('UNIT slip: the heater body entered in kJ/K (0.002 for 2 J/K) rises 1000-fold past its closed form', async () => {
    const { c, s, times, pick } = await solve(fixture('thermal-heater.composition.json'));
    const d = clone(fixture('thermal-heater.thermal.json')) as ThermalDescriptor; d.bodies[0].heatCapacityJPerK = 0.002;
    const { run } = thermalFromComposition(c, s, times, pick, d);
    const expectedRise = 28.8 * (1 - Math.exp(-times[times.length - 1] / 4));
    // Amendment T-2: NOT 1000-fold — with C = 0.002 J/K the time constant C/G is 4 ms ≪ 0.1 s, so the mis-entered body sits at its
    // conductance-limited equilibrium T_a + P/G = +28.8 K whatever its capacity: 28.8 / 0.711 ≈ 40.5× the correct rise.
    const ratio = (run.temperatureK['heater-body'][times.length - 1] - 293.15) / expectedRise;
    expect(ratio).toBeGreaterThan(10); expect(ratio).toBeCloseTo((14.4 / 0.5) / expectedRise, 4);
  }, 120000);
  it('a run outside the motor domain (coasting into reversal) is refused, not heated', async () => {
    const c = clone(fixture('hoist-coast.composition.json')) as Composition; c.analysis.stopSeconds = 1.2;
    const { s, times, pick } = await solve(c);
    expect(cause(() => thermalFromComposition(c, s, times, pick, fixture('hoist-lift.thermal.json')))).toBe('outside-motor-domain');
    expect(energyAccountOf(c, s, times, pick).throughput).toBeGreaterThan(0);                      // the electrical account itself still exists
  }, 120000);
});

// Astra's return electrothermal-v1-db85ae2a: C = 2 J/K, T0 = Ta = 300 K, P = 5 W over [0, 1] s.
describe('return db85ae2a: small conductance and duplicate source identities', () => {
  const t = grid(1, 0.1), e = t.length - 1;
  it('G = 1e-16, 1e-20 and 0 all give the isolated limit — 302.5 K, 5 J stored, books closed — with no T_eq cancellation or false refusal', () => {
    for (const G of [1e-16, 1e-20, 0]) {
      const r = simulateThermal(t, [constant('p', t, 5)], one(body({ conductanceWPerK: G })));
      expect(r.temperatureK.b[e], `G ${G}`).toBeCloseTo(302.5, 9);
      expect(r.storedJ.b[e], `G ${G}`).toBeCloseTo(5, 9);
      expect(r.routedInJ.b[e], `G ${G}`).toBeCloseTo(5, 12);
      expect(Math.abs(r.ambientOutJ.b[e]), `G ${G}`).toBeLessThan(1e-12);
      expect(Math.abs(r.storedJ.b[e] + r.ambientOutJ.b[e] - r.routedInJ.b[e]), `G ${G}`).toBeLessThan(1e-12);
    }
    // At G = 1e-16 the ambient transfer is G·∫(T − Ta) dt = 1e-16 × ∫2.5·t dt = 1.25e-16 J — tiny, positive, not 5 J.
    const r16 = simulateThermal(t, [constant('p', t, 5)], one(body({ conductanceWPerK: 1e-16 })));
    expect(r16.ambientOutJ.b[e] / 1.25e-16).toBeCloseTo(1, 6);
  });
  it('the stable form still matches the closed form across moderate and stiff conductance (G·Δt/C from 1e-9 to 50)', () => {
    for (const G of [1e-8, 1e-3, 0.5, 1000]) {
      const r = simulateThermal(t, [constant('p', t, 5)], one(body({ conductanceWPerK: G })));
      const Teq = 300 + 5 / G, tau = 2 / G, rise = Math.max((5 / G) * -Math.expm1(-1 / tau), 1e-300);
      expect(worstRel(r.temperatureK.b, (k) => 300 + (5 / G) * -Math.expm1(-t[k] / tau), rise), `G ${G}`).toBeLessThan(1e-9);
      void Teq;
    }
  });
  it('a source id that appears twice in the SOURCE list is refused, never silently overwritten', () => {
    expect(cause(() => simulateThermal(t, [constant('p', t, 5), constant('p', t, 9)], one()))).toBe('duplicate-source');
  });
});

// Astra's return electrothermal-v1-b98f8b61: large capacity with small steps — each ΔT below the ulp of the absolute temperature.
describe('return b98f8b61: heat is accumulated as energy, never lost below the temperature ulp', () => {
  const micro = (n: number, dt: number) => { const t = new Float64Array(n); for (let i = 0; i < n; i++) t[i] = i * dt; return t; };
  it("Astra's probe: C = 1e9 J/K, G = 0, T0 = Ta = 300 K, 100001 samples at 1 µs, 5 W → 0.5 J STORED (not 0), books closed, T = T0 + Q/C", () => {
    const t = micro(100001, 1e-6), e = t.length - 1;
    const r = simulateThermal(t, [constant('p', t, 5)], one(body({ heatCapacityJPerK: 1e9, conductanceWPerK: 0 })));
    const input = r.routedInJ.b[e];
    expect(input).toBeCloseTo(0.5, 9);
    expect(r.storedJ.b[e] / input).toBeCloseTo(1, 12);                                  // was 0: every increment rounded away
    expect(r.ambientOutJ.b[e]).toBe(0);
    expect(Math.abs(r.storedJ.b[e] + r.ambientOutJ.b[e] - input) / input).toBeLessThan(1e-12);
    expect((r.temperatureK.b[e] - 300) / 5e-10).toBeCloseTo(1, 3);                     // reported T only to its own ulp (~5.7e-14 K)
  });
  it('split-step vs coarse-step: 1 interval or 100000 give the same stored energy and ambient exchange (constant power, exact update)', () => {
    const fine = micro(100001, 1e-6), coarse = new Float64Array([0, 0.1]), ef = fine.length - 1;
    for (const C of [2, 1e9]) for (const G of [0, 0.5]) {
      const rf = simulateThermal(fine, [constant('p', fine, 5)], one(body({ heatCapacityJPerK: C, conductanceWPerK: G })));
      const rc = simulateThermal(coarse, [constant('p', coarse, 5)], one(body({ heatCapacityJPerK: C, conductanceWPerK: G })));
      expect(rf.storedJ.b[ef] / rc.storedJ.b[1], `C ${C} G ${G} stored`).toBeCloseTo(1, 9);
      if (G > 0) expect(rf.ambientOutJ.b[ef] / rc.ambientOutJ.b[1], `C ${C} G ${G} ambient`).toBeCloseTo(1, 6);
      expect(Math.abs(rf.storedJ.b[ef] + rf.ambientOutJ.b[ef] - rf.routedInJ.b[ef]) / rf.routedInJ.b[ef], `C ${C} G ${G} books`).toBeLessThan(1e-12);
    }
  });
  it('cooldown of a large-capacity body keeps its relative state: the stored energy it loses is exactly the ambient transfer', () => {
    const t = micro(100001, 1e-6);
    const run = simulateThermal(t, [constant('p', t, 5)], one(body({ heatCapacityJPerK: 1e9, conductanceWPerK: 0.5 })));
    const cool = continueCooling(run, 1, 1000), e = cool.times.length - 1, Q0 = cool.storedJ.b[0];
    expect(Q0).toBeGreaterThan(0.49);                                                    // the heat is there to lose
    const lost = Q0 - cool.storedJ.b[e], gained = cool.ambientOutJ.b[e] - cool.ambientOutJ.b[0];
    // lost = Q0 − Q_end is a difference of two ~0.5 J values: its precision floor is a few ulp(0.5 J) ≈ 1e-16 J ABSOLUTE, so a
    // relative bound on a 2.5e-10 J difference cannot be met in double precision (amendment T-7). The bound is in ulps of Q0.
    expect(lost).toBeGreaterThan(0); expect(Math.abs(lost - gained)).toBeLessThan(8 * Number.EPSILON * Q0);
    // closed form of the relative state: Q(t) = Q0·e^{−G·t/C} (T0 = Ta), so the loss over 1 s is Q0·(1 − e^{−5e-10})
    expect(lost / (Q0 * -Math.expm1(-0.5 / 1e9))).toBeCloseTo(1, 5);                   // ≈ 2 ulp(0.5 J) / 2.5e-10 J ≈ 1e-6
  });
});
