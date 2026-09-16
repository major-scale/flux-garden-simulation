#!/usr/bin/env node
/**
 * flux conformance kit — one command, concrete failures, SEPARATE STAGES.
 *   node tools/conform.mjs <composition.json> <expectations.json> [--out report.json] [--engine wasm|native]
 *                          [--layout] [--contract contract.json]
 * Bundles the kit from source, solves with the WASM engine the pages run (or native ngspice on PATH),
 * writes a machine-readable report and prints a summary. Stages, each with its OWN verdict:
 *   contract    (with --contract) the candidate is inside the frozen task contract — source, analysis, names, kinds, ranges, count
 *   electrical  structure → solve → the frozen checks (the kit report)
 *   layout      (with --layout) the rail template lays the composition out (one group) and its validator passes
 *   view        (with --layout) every part has a shared bench body (the SUPPORTED VIEW subset, shared with the bench)
 *   render      always PENDING here: the browser check is not run by this command (open bench.html?src=… and read
 *               __benchRailReport()); an exit code of 0 means the AUTOMATED stages passed, never end-to-end acceptance.
 * The report carries a MANIFEST: sha256 of this entrypoint, the kit sources it bundles and their imported helpers,
 * the shared view module, the bench and scene sources, plus the engine and lock versions — so the tools are frozen
 * separately from the candidate, whose own hash is recorded per run.
 * Exit 0 only when every automated stage that ran passed; 1 otherwise; 2 on usage.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const args = process.argv.slice(2);
const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const outPath = opt('--out'), engineName = opt('--engine') ?? 'wasm', contractPath = opt('--contract'), withLayout = args.includes('--layout');
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (engineName !== 'wasm' && engineName !== 'native') { console.error('--engine must be wasm or native'); process.exit(2); }
if (positional.length < 2) { console.error('usage: node tools/conform.mjs <composition.json> <expectations.json> [--out report.json]'); process.exit(2); }
const BUNDLE_DIR = mkdtempSync(join(tmpdir(), 'conform-bundle-')), ENTRY = join(BUNDLE_DIR, 'entry.ts');
writeFileSync(ENTRY, [
  `export { runConformance } from ${JSON.stringify(resolve('src/model/conformance/kit.ts'))};`,
  `export { checkContract } from ${JSON.stringify(resolve('src/model/conformance/contract.ts'))};`,
  `export { checkCompositionShape } from ${JSON.stringify(resolve('src/model/conformance/shape.ts'))};`,
  `export { railLayout, railInputFrom, validateRailLayout, structuralHash, RailLayoutError } from ${JSON.stringify(resolve('src/ui/rail-layout.ts'))};`,
  `export { SUPPORTED_VIEW_KINDS, unsupportedViewParts } from ${JSON.stringify(resolve('src/ui/view-support.ts'))};`,
].join('\n') + '\n');
const BUNDLE = join(BUNDLE_DIR, 'bundle.mjs');
execFileSync('npx', ['esbuild', ENTRY, '--bundle', '--format=esm', '--log-level=error', `--outfile=${BUNDLE}`], { encoding: 'utf8', timeout: 300000 });
const { runConformance, checkContract, checkCompositionShape, railLayout, railInputFrom, validateRailLayout, structuralHash, RailLayoutError, SUPPORTED_VIEW_KINDS, unsupportedViewParts } = await import(BUNDLE);
import { createHash } from 'node:crypto';
const sha = (path) => { try { return createHash('sha256').update(readFileSync(path)).digest('hex'); } catch { return null; } };
/** The tools this run depends on, hashed: the entrypoint, the bundled sources and their helpers, the bench/scene sources, and the lock. */
const MANIFEST_FILES = ['tools/conform.mjs', 'tools/conformance/engines.mjs', 'src/model/conformance/kit.ts', 'src/model/conformance/terminals.ts', 'src/model/conformance/composition.ts', 'src/model/conformance/contract.ts', 'src/model/spice/parts.ts', 'src/model/spice/netlist.ts', 'src/model/spice/grid.ts', 'src/model/spice/controls-transient.ts', 'src/model/diode.ts',
  'src/model/conformance/shape.ts', 'src/ui/rail-layout.ts', 'src/ui/view-support.ts', 'src/ui/deck-layout.ts', 'src/ui/bench.ts', 'src/ui/potential-scene.ts', 'bench.html', 'package.json', 'package-lock.json'];
const manifest = { files: Object.fromEntries(MANIFEST_FILES.map((f) => [f, sha(resolve(f))])), eecircuitEngine: JSON.parse(readFileSync(resolve('node_modules/eecircuit-engine/package.json'), 'utf8')).version, node: process.version };
const compositionText = readFileSync(positional[0], 'utf8');
let composition, shapeIssues;
try { composition = JSON.parse(compositionText); shapeIssues = checkCompositionShape(composition); }
catch (e) { shapeIssues = [{ cause: 'composition-json', where: '$', message: `Invalid JSON: ${e.message}` }]; }
if (shapeIssues.length) {
  const skipped = { verdict: 'skipped', message: 'Composition shape must be corrected first; not evaluated.' };
  const stages = { shape: { verdict: 'fail', diagnostics: shapeIssues }, ...(contractPath ? { contract: skipped } : {}), electrical: skipped,
    ...(withLayout ? { layout: skipped, view: skipped } : {}), render: skipped };
  const report = { kit: 'flux-conformance-1', composition: { id: composition?.id ?? '?', sha256: sha(positional[0]) }, stages, manifest,
    verdict: 'fail', automatedVerdict: 'fail', overall: 'COMPOSITION SHAPE FAIL · downstream stages SKIPPED' };
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`shape: FAIL\n${shapeIssues.map(x => `  ${x.cause} [${x.where}] ${x.message}`).join('\n')}\n${report.overall}`);
  process.exit(1);
}
const expectations = JSON.parse(readFileSync(positional[1], 'utf8'));
// The engines are shared with tools/electronics-v1-verify.mjs (tools/conformance/engines.mjs): one implementation.
const stages = { shape: { verdict: 'pass', diagnostics: [] } };
// CONTRACT: the candidate inside the frozen task (names, kinds, ranges, source, analysis, count) — before anything is solved.
if (contractPath) {
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const violations = checkContract(composition, contract);
  stages.contract = { verdict: violations.length ? 'fail' : 'pass', contract: { id: contract.id, sha256: sha(contractPath) }, violations };
}
const { wasmEngine, nativeEngine } = await import(new URL('./conformance/engines.mjs', import.meta.url));
const engine = engineName === 'native' ? nativeEngine(BUNDLE_DIR) : await wasmEngine();
const report = await runConformance(composition, expectations, engine);
stages.electrical = { verdict: report.verdict, summary: report.summary };
// LAYOUT and VIEW: the rail template on the composition (one group), then the shared supported-view subset.
if (withLayout) {
  try {
    const layout = railLayout(railInputFrom(composition, () => 'all', ['all']), structuralHash(composition));
    const r = validateRailLayout(layout, composition);
    stages.layout = { verdict: r.ok ? 'pass' : 'fail', diagnostics: r.diagnostics, checked: r.checked, parts: Object.keys(layout.poses).length };
  } catch (e) {
    stages.layout = { verdict: 'fail', diagnostics: [{ cause: e instanceof RailLayoutError ? e.cause_ : 'layout-error', where: e instanceof RailLayoutError ? e.where : '?', message: e.message, severity: 'error' }], checked: null, parts: 0 };
  }
  const unsupported = unsupportedViewParts(composition);
  stages.view = { verdict: unsupported.length ? 'unsupported' : 'pass', supportedKinds: SUPPORTED_VIEW_KINDS, unsupported };
}
stages.render = { verdict: 'pending', message: 'browser check not run by this command: open bench.html?src=<same-origin path under tools/conformance/> and read __benchRailReport() (rendered geometry, terminal correspondence); a stronger-model or human visual review is reviewer evidence, not automated proof' };
const automated = Object.entries(stages).filter(([k]) => k !== 'render');
const allPass = automated.every(([, s]) => s.verdict === 'pass');
const full = { ...report, stages, manifest, automatedVerdict: allPass ? 'pass' : 'fail', overall: allPass ? 'AUTOMATED STAGES PASS · render PENDING' : 'AUTOMATED STAGES FAIL · render PENDING' };
if (outPath) writeFileSync(outPath, JSON.stringify(full, null, 2));
console.log(`${report.kit} · composition ${report.composition.id} (${report.composition.sha256.slice(0, 12)}) · expectations ${report.expectations.id} (${report.expectations.sha256.slice(0, 12)}) · ${report.engine.name} ${report.engine.version} reltol ${report.engine.options.reltol}`);
for (const r of report.results) console.log(`  ${r.status.toUpperCase().padEnd(11)} ${r.check.padEnd(28)} ${r.kind.padEnd(12)} ${r.component ? '[' + r.component + '] ' : ''}${r.message}${r.expected ? ` · expected ${r.expected}` : ''}${r.observed ? ` · observed ${r.observed}` : ''}${r.tolerance ? ` · tol ${r.tolerance}` : ''}`);
console.log(`electrical: ${report.summary}`);
if (stages.contract) console.log(`contract: ${stages.contract.verdict.toUpperCase()} (${stages.contract.contract.id})${stages.contract.violations.map((x) => `\n  FAIL        ${x.cause.padEnd(28)} [${x.where}] ${x.message}`).join('')}`);
if (stages.layout) console.log(`layout: ${stages.layout.verdict.toUpperCase()} (${stages.layout.parts} parts laid out; ${stages.layout.diagnostics.length} diagnostics)${stages.layout.diagnostics.map((d) => `\n  ${d.severity === 'error' ? 'FAIL' : 'INFO'}        ${d.cause.padEnd(28)} [${d.where}] ${d.message}`).join('')}`);
if (stages.view) console.log(`view: ${stages.view.verdict.toUpperCase()}${stages.view.unsupported.length ? ` — no shared bench body for: ${stages.view.unsupported.map((p) => `${p.name} (${p.kind})`).join(', ')}; supported kinds: ${stages.view.supportedKinds.join(', ')}` : ` (every part has a shared bench body)`}`);
console.log(`render: PENDING — ${stages.render.message}`);
console.log(full.overall);
process.exit(allPass ? 0 : 1);
