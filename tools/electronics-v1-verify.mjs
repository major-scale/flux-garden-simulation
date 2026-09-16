#!/usr/bin/env node
/**
 * ELECTRONICS V1 — the one local verification entry point (bridge/ELECTRONICS-V1-CLOSURE-PLAN.md §3).
 *   node tools/electronics-v1-verify.mjs [--out <dir>]        (npm run verify:electronics)
 * Stages, each with its OWN verdict — a SKIPPED stage is named and is never counted as a pass:
 *   fixturesWasm    every fixture in tools/conformance/fixtures plus the fan trial, frozen expectations, ngspice WASM
 *   fixturesNative  the same on native ngspice when it is on PATH (else SKIPPED); an execution-path comparison, not physics
 *   tests           vitest on the electronics / conformance / parity test files (negative controls, boundary refusals,
 *                   the terminal-map ↔ Lean correspondence and its counterexample)
 *   lean            formal/ElectronicsPortPower.lean through the Lean worktree's existing `lake env lean` (no downloads;
 *                   FLUX_LEAN_DIR overrides the path) — else SKIPPED; clean = exit 0, no sorry, standard axioms only
 *   coverage        computed, per part kind: the fixtures that include it, whether they pass, and the check kinds exercised on it
 * Every fixture record carries its inputs' SHA-256, engine and version, reltol, horizon and step, samples, the initial-state
 * policy, units and per-check verdicts. Report: <out>/verify-report.json (default tools/evidence/electronics-v1/).
 * Exit 0 only when every stage ran and passed; 3 when everything that ran passed but a stage was SKIPPED; 1 otherwise.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { wasmEngine, nativeEngine, nativeAvailable } from './conformance/engines.mjs';

const args = process.argv.slice(2);
const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const OUT = resolve(opt('--out') ?? 'tools/evidence/electronics-v1');
const LEAN_DIR = process.env.FLUX_LEAN_DIR ?? resolve('formal');
const LEAN_FILE = resolve('formal/ElectronicsPortPower.lean');
mkdirSync(OUT, { recursive: true });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const started = new Date().toISOString();

// ---------------------------------------------------------------- bundle the kit once, from source
const B = mkdtempSync(join(tmpdir(), 'ev1-')), ENTRY = join(B, 'entry.ts');
writeFileSync(ENTRY, [
  `export { runConformance, makePicker, neededVectors } from ${JSON.stringify(resolve('src/model/conformance/kit.ts'))};`,
  `export { INITIAL_STATE_POLICY, REQUIRED_PORTS, buildStructure } from ${JSON.stringify(resolve('src/model/conformance/composition.ts'))};`,
  `export { readGrid } from ${JSON.stringify(resolve('src/model/spice/grid.ts'))};`,
  `export { thermalFromComposition, networkAudit } from ${JSON.stringify(resolve('src/model/thermal-lumped.ts'))};`,
  `export { expm } from ${JSON.stringify(resolve('src/model/motor.ts'))};`,
  `export { runFeedback, feedbackAudit, FEEDBACK_SOLVE_WINDOW } from ${JSON.stringify(resolve('src/model/thermal-feedback.ts'))};`,
  `export { ENERGY_ROLE } from ${JSON.stringify(resolve('src/model/conformance/terminals.ts'))};`,
  `export { summarizeVitest } from ${JSON.stringify(resolve('src/model/conformance/verify-summary.ts'))};`,
].join('\n') + '\n');
execFileSync('npx', ['esbuild', ENTRY, '--bundle', '--format=esm', '--log-level=error', `--outfile=${join(B, 'kit.mjs')}`], { timeout: 300000 });
const { runConformance, INITIAL_STATE_POLICY, REQUIRED_PORTS, ENERGY_ROLE, summarizeVitest, makePicker, neededVectors, buildStructure, readGrid, thermalFromComposition, networkAudit, expm, runFeedback, feedbackAudit, FEEDBACK_SOLVE_WINDOW } = await import(join(B, 'kit.mjs'));
const KIT_FILES = ['tools/electronics-v1-verify.mjs', 'tools/conformance/engines.mjs', 'src/model/conformance/kit.ts', 'src/model/conformance/composition.ts',
  'src/model/conformance/terminals.ts', 'src/model/conformance/shape.ts', 'src/model/conformance/contract.ts', 'src/model/conformance/verify-summary.ts',
  'src/model/spice/parts.ts', 'src/model/spice/grid.ts', 'src/model/spice/netlist.ts', 'src/model/diode.ts',
  // electromechanical v1: the shared shaft load, the page deck that now uses it, the shared analytic reference
  'src/model/spice/shaft-load.ts', 'src/model/spice/motor-netlist.ts', 'src/model/motor.ts',
  // electrothermal v1: the lumped thermal layer over the kit's solved runs (the legacy thermal.ts is unchanged)
  'src/model/thermal-lumped.ts', 'src/model/thermal.ts',
  'formal/ElectronicsPortPower.lean', 'formal/ElectromechanicalCoupling.lean', 'formal/ElectrothermalBalance.lean',
  // thermal network v1: links between lumped bodies (same module), and its finite-network algebra
  'formal/ThermalNetwork.lean',
  // thermal feedback v1: the closed loop (memoryless circuit ↔ thermal state) and its algebra
  'src/model/thermal-feedback.ts', 'formal/ThermalFeedback.lean', 'package-lock.json'];
const manifest = { files: Object.fromEntries(KIT_FILES.map((f) => [f, existsSync(f) ? sha(f) : null])), node: process.version };

// ---------------------------------------------------------------- the fixture set
const FIX = 'tools/conformance/fixtures';
const pairs = readdirSync(FIX).filter((f) => f.endsWith('.expectations.json')).map((f) => f.replace('.expectations.json', ''))
  .filter((n) => existsSync(join(FIX, `${n}.composition.json`))).sort()
  .map((n) => ({ name: n, composition: join(FIX, `${n}.composition.json`), expectations: join(FIX, `${n}.expectations.json`) }));
pairs.push({ name: 'fan-trial', composition: 'tools/conformance/trial/fan.composition.json', expectations: 'tools/conformance/trial/fan.expectations.json' });

async function runFixtures(engine, label) {
  const rows = [];
  for (const p of pairs) {
    const c = JSON.parse(readFileSync(p.composition, 'utf8')), x = JSON.parse(readFileSync(p.expectations, 'utf8'));
    const t0 = Date.now(); const r = await runConformance(c, x, engine);
    rows.push({ fixture: p.name, composition: { path: p.composition, sha256: sha(p.composition) }, expectations: { path: p.expectations, sha256: sha(p.expectations) },
      engine: r.engine, initialState: INITIAL_STATE_POLICY, verdict: r.verdict, summary: r.summary, wallMs: Date.now() - t0,
      results: r.results.map((q) => ({ check: q.check, kind: q.kind, status: q.status, component: q.component, unit: q.unit, expected: q.expected, observed: q.observed, tolerance: q.tolerance })) });
    console.log(`  ${label.padEnd(7)} ${r.verdict.toUpperCase().padEnd(11)} ${p.name.padEnd(22)} ${r.summary}`);
  }
  return { verdict: rows.every((r) => r.verdict === 'pass') ? 'pass' : 'fail', rows };
}

const stages = {};
console.log('fixtures (frozen expectations):');
stages.fixturesWasm = await runFixtures(await wasmEngine(), 'wasm');
if (nativeAvailable()) {
  stages.fixturesNative = await runFixtures(nativeEngine(B), 'native');
  stages.fixturesNative.agreement = stages.fixturesWasm.rows.map((w) => ({ fixture: w.fixture, wasm: w.verdict, native: stages.fixturesNative.rows.find((n) => n.fixture === w.fixture)?.verdict }));
} else {
  stages.fixturesNative = { verdict: 'skipped', reason: 'ngspice is not on PATH: the native execution-path comparison did not run' };
  console.log('  native  SKIPPED     (ngspice is not on PATH)');
}

// ---------------------------------------------------------------- the thermal layer on BOTH solver paths (electrothermal v1)
// Astra's return (electrothermal-v1-db85ae2a): the native fixture stage never invoked the thermal adapter. Each thermal fixture is
// solved on WASM and on native ngspice and passed through `thermalFromComposition`; it passes when the composite residual equals
// the electromechanical one (≤ 1e-9 × throughput), the thermal books close, the electromechanical residual is within 1e-3, and the
// heater follows its closed form (≤ 1e-6 of the rise). The descriptor and composition are hashed per row.
const THERMAL = [
  { name: 'thermal-heater', analytic: { P: 14.4, C: 2, G: 0.5, T0: 293.15, body: 'heater-body' } },
  { name: 'hoist-lift' }, { name: 'hoist-locked' },
  // thermal network v1 (docs/THERMAL-NETWORK-V1-DECLARATION.md): linked bodies on the same solved runs. Extra checks: every linked
  // body's solve residual ≤ 1e-9 of its scale, its books ≤ 1e-12, Σ link outflow ≤ 1e-12 of Σ|transfer|, and the heater network
  // against the independent expm reference (absolute temperatures, motor.ts) within 1e-6 of the rise.
  { name: 'thermal-heater', descriptor: 'thermal-heater.network.thermal.json', reference: { resistor: 14.4 } },
  { name: 'hoist-locked', descriptor: 'hoist-locked.network.thermal.json' },
];
/** dT/dt = C⁻¹(P + G_amb·T_a − (G_amb + L)·T) on ABSOLUTE temperatures, exactly, by motor.ts's `expm` — independent of the solver. */
function networkReference(d, P, t) {
  const n = d.bodies.length, idx = new Map(d.bodies.map((b, i) => [b.id, i]));
  const K = d.bodies.map((b, i) => d.bodies.map((_, j) => (i === j ? b.conductanceWPerK : 0)));
  for (const l of d.links) { const a = idx.get(l.a), b = idx.get(l.b), G = l.conductanceWPerK; K[a][a] += G; K[b][b] += G; K[a][b] -= G; K[b][a] -= G; }
  const M = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  d.bodies.forEach((b, i) => { for (let j = 0; j < n; j++) M[i][j] = -K[i][j] / b.heatCapacityJPerK * t; M[i][n] = ((P[b.id] ?? 0) + b.conductanceWPerK * b.ambientTemperatureK) / b.heatCapacityJPerK * t; });
  const E = expm(M);
  return d.bodies.map((_, i) => E[i].slice(0, n).reduce((s, v, j) => s + v * d.bodies[j].initialTemperatureK, 0) + E[i][n]);
}
async function runThermal(engine, label) {
  const rows = [];
  for (const t of THERMAL) {
    const cp = join(FIX, `${t.name}.composition.json`), dp = join(FIX, t.descriptor ?? `${t.name}.thermal.json`), label_ = t.descriptor ? `${t.name} network` : t.name;
    let row;
    try {
      const c = JSON.parse(readFileSync(cp, 'utf8')), d = JSON.parse(readFileSync(dp, 'utf8'));
      const s = buildStructure(c), wanted = ['time', ...neededVectors(s)];
      const g = readGrid(await engine.run(s.netlist, wanted.slice(1)), wanted, c.analysis);
      const { run, account, composite } = thermalFromComposition(c, s, g.times, makePicker(s, g.times, g.pick), d);
      const gap = Math.abs(composite.compositeResidualJ - composite.electromechanicalResidualJ);
      let analyticRelError = null;
      if (t.analytic) {
        const a = t.analytic, Teq = a.T0 + a.P / a.G, tau = a.C / a.G, T = run.temperatureK[a.body];
        let w = 0; for (let k = 0; k < T.length; k++) w = Math.max(w, Math.abs(T[k] - (Teq + (a.T0 - Teq) * Math.exp(-g.times[k] / tau))));
        analyticRelError = w / (T[T.length - 1] - a.T0);
      }
      let ok = gap <= 1e-9 * account.throughput && Math.abs(composite.thermalBooksGapJ) <= 1e-9 * Math.max(1, run.routedJ)
        && Math.abs(account.residual) <= 1e-3 * account.throughput && (analyticRelError === null || analyticRelError <= 1e-6);
      let network = null;
      if (d.links?.length) {
        const audit = networkAudit(run), e = g.times.length - 1, linked = run.network.components.flatMap((c) => c.bodies);
        const ratio = (num, den, id) => Math.abs(num[id]) / Math.max(den[id], 1e-300);
        const worstSolve = Math.max(...linked.map((id) => ratio(run.network.bodySolveResidualJ, run.network.bodySolveScaleJ, id)));
        const worstBooks = Math.max(...linked.map((id) => ratio(run.network.bodyBooksGapJ, run.network.bodyBooksScaleJ, id)));
        let referenceRelError = null;
        if (t.reference) {
          let w = 0; const T = d.bodies.map((b) => run.temperatureK[b.id]);
          for (let k = 0; k < g.times.length; k += 5) { const ref = networkReference(d, t.reference, g.times[k]); ref.forEach((v, i) => { w = Math.max(w, Math.abs(T[i][k] - v)); }); }
          referenceRelError = w / (T[0][e] - d.bodies[0].initialTemperatureK);
        }
        network = { linkJ: Object.fromEntries(d.links.map((l) => [l.id, run.linkJ[l.id][e]])), linkCancellationJ: audit.linkCancellationJ, transferMagnitudeJ: audit.transferMagnitudeJ,
          worstSolveResidualRatio: worstSolve, worstBooksRatio: worstBooks, referenceRelError, blocksComputed: run.network.blocksComputed,
          worstForwardBoundK: Math.max(...linked.map((id) => run.network.bodyForwardBoundK[id])) };
        ok = ok && worstSolve <= 1e-9 && worstBooks <= 1e-12 && Math.abs(audit.linkCancellationJ) <= 1e-12 * audit.transferMagnitudeJ
          && (referenceRelError === null || referenceRelError <= 1e-6);
      }
      row = { fixture: label_, engine: `${engine.name} ${engine.version}`, verdict: ok ? 'pass' : 'fail', network,
        composition: { path: cp, sha256: sha(cp) }, descriptor: { path: dp, sha256: sha(dp) }, samples: g.times.length,
        compositeMinusElectromechanicalJ: gap, thermalBooksGapJ: composite.thermalBooksGapJ, electromechanicalResidualJ: account.residual,
        throughputJ: account.throughput, analyticRelError, routedJ: run.routedJ, outgoingJ: run.outgoingJ, ambientJ: composite.routedAmbientJ,
        endTemperaturesK: Object.fromEntries(Object.entries(run.temperatureK).map(([b, T]) => [b, T[T.length - 1]])), negativeSamples: run.negativeSamples };
    } catch (e) { row = { fixture: label_, engine: `${engine.name} ${engine.version}`, verdict: 'error', reason: String(e?.message ?? e).slice(0, 300) }; }
    rows.push(row);
    console.log(`  ${label.padEnd(7)} ${row.verdict.toUpperCase().padEnd(11)} thermal ${label_.padEnd(22)} ${row.verdict === 'error' ? row.reason
      : `composite − electromechanical ${row.compositeMinusElectromechanicalJ.toExponential(2)} J; books ${row.thermalBooksGapJ.toExponential(2)} J${row.analyticRelError !== null ? `; analytic ${row.analyticRelError.toExponential(2)}` : ''}${row.network ? `; solve residual ≤ ${row.network.worstSolveResidualRatio.toExponential(2)} of scale; forward bound ≤ ${row.network.worstForwardBoundK.toExponential(2)} K; Σ link outflow ${row.network.linkCancellationJ.toExponential(2)} J${row.network.referenceRelError !== null ? `; expm reference ${row.network.referenceRelError.toExponential(2)}` : ''}` : ''}`}`);
  }
  return { verdict: rows.every((r) => r.verdict === 'pass') ? 'pass' : rows.some((r) => r.verdict === 'error') ? 'error' : 'fail', rows };
}
console.log('thermal layer on both solver paths:');
stages.thermalWasm = await runThermal(await wasmEngine(), 'wasm');
if (nativeAvailable()) stages.thermalNative = await runThermal(nativeEngine(B), 'native');
else { stages.thermalNative = { verdict: 'skipped', reason: 'ngspice is not on PATH: the native thermal path did not run' }; console.log('  native  SKIPPED     (ngspice is not on PATH)'); }

// ---------------------------------------------------------------- thermal feedback v1: the closed loop on BOTH solver paths
// docs/THERMAL-FEEDBACK-V1-DECLARATION.md. The production adapter `runFeedback` drives repeated operating-point solves of a memoryless
// circuit against the thermal state. WASM uses ONE reused ngspice instance (the same build the kit uses; a fresh instance per solve
// would cost ~0.3 s each — the test file checks reuse gives identical solves); native spawns ngspice per solve. Each row: the audit
// (mapping exact, no stale temperature), energy closure (composite and electrical residual ≤ 1e-9 of source work), the heater against
// its implicit analytic trajectory (a first-order hold: ≤ 1e-2 of the rise at 1 s steps; the test file shows the order), the
// thermostat's switch temperatures within their resolution (rate × event tolerance + comparator band) and the two engines' switch times.
const FEEDBACK = [{ name: 'feedback-heater', analytic: { V: 12, C: 5, Rref: 24, alpha: 0.004, T0: 293.15 } }, { name: 'thermostat' }];
async function reusedWasm() {
  const { Simulation } = await import('eecircuit-engine'), w = await wasmEngine(), sim = new Simulation(); await sim.start();
  return { name: `${w.name}, one reused instance`, version: w.version, async run(netlist) { sim.setNetList(netlist); return sim.runSim(); } };
}
async function runFeedbackStage(engine, label) {
  const rows = [];
  for (const f of FEEDBACK) {
    const cp = join(FIX, `${f.name}.composition.json`), dp = join(FIX, `${f.name}.feedback.json`);
    let row;
    try {
      const c = JSON.parse(readFileSync(cp, 'utf8')), d = JSON.parse(readFileSync(dp, 'utf8'));
      const r = await runFeedback(c, d, engine), a = r.account, T = r.trajectory.temperatureK.plate, audit = feedbackAudit(r, c);
      let analyticRelError = null, worstSwitchK = null, resolutionK = null;
      if (f.analytic) {
        const { V, C, Rref, alpha, T0 } = f.analytic, tEnd = r.trajectory.times[r.trajectory.times.length - 1];
        const rise = (Math.sqrt(1 + 2 * alpha * V * V * tEnd / (C * Rref)) - 1) / alpha;
        analyticRelError = Math.abs(T[T.length - 1] - T0 - rise) / rise;
      }
      if (d.controller) {
        const tt = r.trajectory.times; let rate = 0; for (let i = 1; i < tt.length; i++) if (tt[i] > tt[i - 1]) rate = Math.max(rate, Math.abs(T[i] - T[i - 1]) / (tt[i] - tt[i - 1]));
        const cmp = c.parts.find((p) => p.name === d.controller.comparator);
        resolutionK = rate * d.clock.eventToleranceSeconds + (0.1 / cmp.spec.gain) / Math.abs((r.calibration.highVolts - r.calibration.lowVolts) / (d.controller.highK - d.controller.lowK));
        worstSwitchK = Math.max(...r.events.filter((e) => e.located).map((e) => Math.abs(e.temperatureK - (e.to ? d.controller.lowK : d.controller.highK))));
      }
      const ok = audit.mappingErr <= 1e-12 && audit.staleErr === 0 && audit.missing === 0
        && Math.abs(a.compositeResidualJ) <= 1e-9 * a.sourceWorkJ && Math.abs(a.electricalResidualJ) <= 1e-9 * a.sourceWorkJ
        && (analyticRelError === null || analyticRelError <= 1e-2) && (worstSwitchK === null || (r.events.length >= 6 && worstSwitchK <= resolutionK));
      row = { fixture: f.name, engine: `${engine.name} ${engine.version}`, verdict: ok ? 'pass' : 'fail',
        composition: { path: cp, sha256: sha(cp) }, descriptor: { path: dp, sha256: sha(dp) }, solveWindow: FEEDBACK_SOLVE_WINDOW,
        solves: r.solveCount, bisectionSolves: r.bisectionSolves, wallMs: r.wallMs, events: r.events.map((e) => ({ t: e.t, from: e.from, to: e.to, temperatureK: e.temperatureK })),
        endTemperatureK: T[T.length - 1], analyticRelError, worstSwitchK, resolutionK, audit, account: a };
    } catch (e) { row = { fixture: f.name, engine: `${engine.name} ${engine.version}`, verdict: 'error', reason: String(e?.message ?? e).slice(0, 300) }; }
    rows.push(row);
    console.log(`  ${label.padEnd(7)} ${row.verdict.toUpperCase().padEnd(11)} feedback ${f.name.padEnd(16)} ${row.verdict === 'error' ? row.reason
      : `${row.solves} solves (${row.bisectionSolves} event), ${row.wallMs} ms; composite ${row.account.compositeResidualJ.toExponential(2)} J of ${row.account.sourceWorkJ.toExponential(3)} J${row.analyticRelError !== null ? `; analytic ${row.analyticRelError.toExponential(2)} of the rise` : ''}${row.worstSwitchK !== null ? `; ${row.events.length} switches, worst ${row.worstSwitchK.toExponential(2)} K ≤ ${row.resolutionK.toExponential(2)} K` : ''}`}`);
  }
  return { verdict: rows.every((r) => r.verdict === 'pass') ? 'pass' : rows.some((r) => r.verdict === 'error') ? 'error' : 'fail', rows };
}
console.log('thermal feedback loop on both solver paths:');
stages.feedbackWasm = await runFeedbackStage(await reusedWasm(), 'wasm');
if (nativeAvailable()) {
  stages.feedbackNative = await runFeedbackStage(nativeEngine(B), 'native');
  const tw = stages.feedbackWasm.rows.find((r) => r.fixture === 'thermostat'), tn = stages.feedbackNative.rows.find((r) => r.fixture === 'thermostat');
  if (tw?.events && tn?.events) {
    const n = Math.min(tw.events.length, tn.events.length), worst = Math.max(...Array.from({ length: n }, (_, i) => Math.abs(tw.events[i].t - tn.events[i].t)));
    stages.feedbackNative.agreement = { switches: [tw.events.length, tn.events.length], worstSwitchTimeDifferenceSeconds: worst };
    console.log(`  engines  switch times: ${tw.events.length} vs ${tn.events.length} switches, worst difference ${worst.toExponential(2)} s`);
  }
} else { stages.feedbackNative = { verdict: 'skipped', reason: 'ngspice is not on PATH: the native feedback path did not run' }; console.log('  native  SKIPPED     (ngspice is not on PATH)'); }

// ---------------------------------------------------------------- the test files
const TEST_FILES = ['src/model/conformance/electronics-v1.test.ts', 'src/model/conformance/electromechanical-v1.test.ts', 'src/model/motor.test.ts',
  'src/model/thermal-lumped.test.ts', 'src/model/thermal.test.ts', 'src/model/thermal-network.test.ts', 'src/model/thermal-feedback.test.ts',
  'src/model/conformance/verify-summary.test.ts', 'src/model/conformance/conformance.test.ts',
  'src/model/conformance/storage.test.ts', 'src/model/conformance/shape.test.ts', 'src/model/conformance/contract.test.ts', 'src/model/conformance/cli.test.ts',
  'src/model/spice/controls-parity.test.ts', 'src/model/spice/sensors-parity.test.ts', 'src/model/spice/lamp-parity.test.ts', 'src/model/spice/motor-parity.test.ts',
  'src/model/sensors.test.ts',
  // the fan page solves a composition through the generic page path (composition-transient.ts): electromechanical v1's derived
  // observables broke it once while every file above stayed green, so the page path is part of this entry point now
  'src/model/fan.test.ts'];
console.log(`tests: vitest on ${TEST_FILES.length} files …`);
const vjson = join(B, 'vitest.json');
const v = spawnSync('npx', ['vitest', 'run', ...TEST_FILES, '--reporter=json', `--outputFile=${vjson}`], { encoding: 'utf8', timeout: 900000 });
// The verdict needs the PROCESS outcome and the report's own success flags, not only per-assertion statuses (Astra 7bc1b6c0):
// `summarizeVitest` (src/model/conformance/verify-summary.ts, controls in verify-summary.test.ts) decides it.
let reportText = null; try { reportText = readFileSync(vjson, 'utf8'); } catch { /* no report: an ERROR, decided below */ }
stages.tests = { ...summarizeVitest({ status: v.status, signal: v.signal, error: v.error ? v.error.message : null, stderrTail: (v.stderr ?? '').slice(-800) },
  reportText, resolve('.') + '/'), files: TEST_FILES };
console.log(`  ${stages.tests.verdict.toUpperCase().padEnd(11)} ${stages.tests.passed}/${stages.tests.total} tests (process exit ${v.status}${v.signal ? `, signal ${v.signal}` : ''})`
  + (stages.tests.problems.length ? `\n              ${stages.tests.problems.join('\n              ')}` : ''));

// ---------------------------------------------------------------- Lean
// Probe lake INSIDE the Lean project: elan resolves the toolchain from its lean-toolchain file; run elsewhere, `lake --version`
// fails for want of a default toolchain even though lake is installed (the first run reported that as "not on PATH").
const leanProject = existsSync(join(LEAN_DIR, 'lakefile.toml')) && existsSync(join(LEAN_DIR, '.lake'));
let lake = false, lakeProbe = '';
if (leanProject) { try { execFileSync('lake', ['--version'], { cwd: LEAN_DIR, stdio: 'ignore' }); lake = true; } catch (e) { lakeProbe = String(e.message ?? e).slice(0, 200); } }
if (!leanProject || !lake) {
  stages.lean = { verdict: 'skipped', reason: !leanProject ? `no built Lean project at ${LEAN_DIR} (set FLUX_LEAN_DIR)` : `lake did not run in ${LEAN_DIR}: ${lakeProbe}` };
  console.log(`lean: SKIPPED (${stages.lean.reason})`);
} else {
  // Every Lean file: exit 0, no signal, no sorry, the EXPECTED number of `#print axioms` lines, standard axioms only.
  const LEAN_FILES = [
    { file: 'formal/ElectronicsPortPower.lean', theorems: 3, scope: 'network algebra: Tellegen port-power cancellation over the terminal shape (electronics v1)' },
    { file: 'formal/ElectromechanicalCoupling.lean', theorems: 7, scope: 'motor conversion power, rack mapping / reflected inertia / gravity work, balance composition, reversed-transfer counterexample (electromechanical v1)' },
    { file: 'formal/ElectrothermalBalance.lean', theorems: 8, scope: 'thermal interval books, equilibrium algebra, routed-loss cancellation, duplicate-booking counterexample, passive-loss and ambient-flow signs (electrothermal v1)' },
    { file: 'formal/ThermalFeedback.lean', theorems: 10, scope: 'positivity of the linear R(T) on its domain, Joule forms, the discrete hysteresis transition (off only at ≥ T_high, on only below T_low, equality = off, a flip pair spans the band), zero-order-hold step balance (thermal feedback v1)' },
    { file: 'formal/ThermalNetwork.lean', theorems: 11, scope: 'link-power antisymmetry, hot → cold sign, two-body conservation, positive-link steady state, orientation reversal, swapped booking, finite-network cancellation, network books and composite, double / one-sided booking counterexamples (thermal network v1)' },
  ];
  const STANDARD = new Set(['propext', 'Classical.choice', 'Quot.sound']);
  const files = LEAN_FILES.map(({ file, theorems, scope }) => {
    console.log(`lean: compiling ${file} …`);
    const r = spawnSync('lake', ['env', 'lean', resolve(file)], { cwd: LEAN_DIR, encoding: 'utf8', timeout: 900000 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const axioms = [...out.matchAll(/'([^']+)' depends on axioms: \[([^\]]*)\]/g)].map((m) => ({ theorem: m[1], axioms: m[2].split(',').map((s) => s.trim()).filter(Boolean) }));
    const clean = r.status === 0 && r.signal === null && !/sorry/.test(out) && axioms.length === theorems && axioms.every((a) => a.axioms.every((x) => STANDARD.has(x)));
    console.log(`  ${(clean ? 'PASS' : 'FAIL').padEnd(11)} exit ${r.status}; ${axioms.length}/${theorems} theorems; ${axioms.map((a) => `${a.theorem.split('.').pop()} [${a.axioms.join(', ')}]`).join('; ')}`);
    return { file, verdict: clean ? 'pass' : 'fail', sha256: sha(resolve(file)), exit: r.status, signal: r.signal, expectedTheorems: theorems, axioms, output: out.slice(-2000), scope };
  });
  stages.lean = { verdict: files.every((f) => f.verdict === 'pass') ? 'pass' : 'fail', leanProject: LEAN_DIR,
    toolchain: readFileSync(join(LEAN_DIR, 'lean-toolchain'), 'utf8').trim(), files,
    boundary: 'algebra only; the link to production is executable correspondence tests, not refinement proofs' };
}

// ---------------------------------------------------------------- coverage, computed from the fixtures that ran
const partsOf = (q, c) => {
  if (q.part) return [q.part];
  if (q.kind === 'energy-balance' || q.kind === 'connectivity') return c.parts.map((p) => p.name);
  return [q.observable, ...(q.into ?? []), ...(q.out ?? [])].filter(Boolean).map((o) => o.split('.')[0]).filter((n) => c.parts.some((p) => p.name === n));
};
const coverage = Object.fromEntries(Object.keys(REQUIRED_PORTS).map((k) => [k, { energyRole: ENERGY_ROLE[k], fixtures: new Set(), passingEverywhere: true, checkKinds: new Set() }]));
for (const p of pairs) {
  const c = JSON.parse(readFileSync(p.composition, 'utf8')), x = JSON.parse(readFileSync(p.expectations, 'utf8'));
  const pass = [stages.fixturesWasm, stages.fixturesNative].every((s) => s.verdict === 'skipped' || s.rows.find((r) => r.fixture === p.name)?.verdict === 'pass');
  for (const part of c.parts) { coverage[part.kind].fixtures.add(p.name); if (!pass) coverage[part.kind].passingEverywhere = false; }
  for (const q of x.checks) for (const name of partsOf(q, c)) { const k = c.parts.find((pp) => pp.name === name)?.kind; if (k) coverage[k].checkKinds.add(q.kind); }
}
const coverageOut = Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, { energyRole: v.energyRole, fixtures: [...v.fixtures], passing: v.fixtures.size > 0 && v.passingEverywhere, checkKinds: [...v.checkKinds].sort() }]));
const uncovered = Object.entries(coverageOut).filter(([, v]) => !v.passing).map(([k]) => k);
stages.coverage = { verdict: uncovered.length ? 'fail' : 'pass', uncovered };
console.log('coverage (part kind → fixtures · check kinds exercised on it):');
for (const [k, v] of Object.entries(coverageOut)) console.log(`  ${(v.passing ? 'ok' : 'MISSING').padEnd(8)} ${k.padEnd(11)} ${v.fixtures.length} fixture(s): ${v.fixtures.join(', ') || '—'} · ${v.checkKinds.join(', ') || '—'}`);

// ---------------------------------------------------------------- verdict
const all = Object.values(stages);
const failed = all.some((s) => s.verdict === 'fail' || s.verdict === 'error'), skipped = all.some((s) => s.verdict === 'skipped');
const overall = failed ? 'FAIL' : skipped ? 'PASS WITH SKIPPED STAGES — not a full pass' : 'PASS';
const report = { kit: 'electronics-v1-verify', started, finished: new Date().toISOString(), manifest, stages, coverage: coverageOut, overall,
  limits: ['Two ngspice builds give an execution-path comparison of the same netlist, not independent physical evidence.',
    'The render stage (browser, bench.html) is not run here; geometry checks are not visual quality.',
    'Lean covers the network algebra only; element laws are illustrative models checked numerically, not proved.',
    'No fresh-model authoring trial runs here: the held-out portfolio is prepared and pending a budget.'] };
writeFileSync(join(OUT, 'verify-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nelectronics v1: ${overall}  (report: ${join(OUT, 'verify-report.json').replace(resolve('.') + '/', '')})`);
process.exit(failed ? 1 : skipped ? 3 : 0);
