/**
 * THE PRIMITIVES BENCH — a small isolated fixture on the workstation, drawn GENERICALLY from a composition
 * (core-primitives first batch: capacitor and inductor). No page-owned circuit numbers: the fixture JSON is the
 * kit's own (`tools/conformance/fixtures/*.composition.json`), laid out by the rail template from its parts and
 * nets, solved through the same structure the conformance kit checks, and read by observable name. Every part
 * is mapped to the shared scene body of its kind; a kind this bench cannot draw is refused by name, never
 * drawn as something else.
 */
import './rc.css';
import './style.css';
import { PotentialScene, type SceneSpec, type BranchSpec, type TerraceSpec } from './potential-scene';
import { SpiceClient } from '../model/spice/client';
import { PlaybackCursor, type PlaybackState } from '../model/spice/cursor';
import { sampleComposition, type CompositionTransient } from '../model/spice/composition-transient';
import { buildStructure, INITIAL_STATE_POLICY, type Composition, type PartInstance } from '../model/conformance/composition';
import { sha256Json } from '../model/conformance/kit';
import { railLayout, railInputFrom, validateRailLayout, structuralHash, terminalAt, checkGeometry3D, layoutTerminals, layoutNets, BODY_GEOMETRY, RailLayoutError, type RailLayout, type RailReport, type Wire3, type BodyShape, type DeckKind } from './rail-layout';
import { busThrough } from './deck-layout';
import { speedFromSlider, wallSecondsFor } from './transport';
import { siUnit } from './rc-flow';
import { frameSeconds } from '../model/rc-driver';
import rcStep from '../../tools/conformance/fixtures/rc-step.composition.json';
import rlStep from '../../tools/conformance/fixtures/rl-step.composition.json';
import rcLadder from '../../tools/conformance/fixtures/rc-ladder.composition.json';
import rlPair from '../../tools/conformance/fixtures/rl-pair.composition.json';

/** The fixtures this bench offers, verbatim from the kit's fixture directory (bundled at build time). */
const FIXTURES: Record<string, Composition> = { 'rc-step': rcStep as unknown as Composition, 'rl-step': rlStep as unknown as Composition, 'rc-ladder': rcLadder as unknown as Composition, 'rl-pair': rlPair as unknown as Composition };
import { DRAWN_AS, unsupportedViewParts } from './view-support';
const FLOW_CUE = { fullUnitsPerSecond: 1.8, floorUnitsPerSecond: 0.6, visibilityPower: 0.3 };

interface BenchFrame { kind: 'solved'; timeSeconds: number; requestedTimeSeconds: number; at: (name: string) => number; state: PlaybackState; progress: number }
class BenchPlayback extends PlaybackCursor<CompositionTransient> {
  frame(): BenchFrame {
    const s = sampleComposition(this.transient, this.cursor); const atStart = !this.started && this.cursor === 0;
    return { kind: 'solved', timeSeconds: s.timeSeconds, requestedTimeSeconds: s.requestedTimeSeconds, at: s.at, state: atStart ? 'before-start' : this.state, progress: this.progress };
  }
}

const root = document.getElementById('rc-app')!;
root.innerHTML = `
<header><span><a href="/rc.html">← RLC</a> · <a href="/fan.html">← Fan</a> · <a href="/controls.html">← Controls</a></span><span class="crumb">FLUX GARDEN / PRIMITIVES BENCH</span></header>
<section class="intro"><p class="eyebrow">A FIXTURE, DRAWN FROM ITS COMPOSITION</p><h1>One storing element at a time: a step charges it, the picture follows the solver.</h1>
<p>Each fixture is the conformance kit's own JSON — a resistor and a capacitor or inductor stepped by a source at 1 ms, solved from its <b>operating point</b> (the declared initial-state policy: no forced initial state). The rail template lays it out from the parts and nets alone, the shared bodies are posed on the deck, and every current drawn is a solved observable. <a href="#model-notes">What is checked and what is not claimed →</a></p></section>
<div class="layout"><article>
<div class="transport fan-controls">
  <span class="presets" aria-label="Fixture"><span class="preset-lead">FIXTURE</span><span id="fixture-buttons"></span></span>
</div>
<p class="hint" id="fixture-blurb"></p>
<p id="notice" role="status"></p>
<div class="transport"><button id="play">Run</button><button id="step">One tick</button><button id="restart">Restart</button><button id="replay" hidden>Replay ↻</button><span class="speed" aria-label="Playback speed"><label for="rate">Playback speed</label><input id="rate" type="range" min="0" max="1000" value="700"><output id="rate-readout"></output></span></div>
<section class="instrument">
<div id="circuit-world"><div id="stage"><button id="reset-view" title="Restore the starting view">Reset view</button><label class="labels-toggle"><input id="labels-on" type="checkbox" checked> Labels</label><label class="labels-toggle values-toggle"><input id="labels-values" type="checkbox" checked> Values in labels</label><span class="orbit-hint">Drag to look around · marker height = voltage</span><div id="stage3d"></div><div id="stagelabels"></div></div></div>
<div id="stage-fault" class="stage-fault" hidden role="alert"></div>
<div id="headline"></div>
<div class="readouts" id="readouts"></div>
<p class="hint" id="solver-status"></p>
<p class="hint" id="scene-time"></p>
<p id="graphics-status" role="status" hidden></p>
<details id="model-notes"><summary>The fixture, the checks, and what is not claimed</summary>
<p class="hint"><b>Initial state.</b> Policy <code>${INITIAL_STATE_POLICY}</code>: the run starts from the DC solution at 0 s; the capacitor's voltage and the inductor's current are what the operating point gives (zero here, the source is at 0 V until 1 ms). A forced initial state in a part is refused by name (<code>unsupported-initial-state</code>); a node reachable only through capacitors is refused before solving (<code>dc-floating-node</code>).</p>
<p class="hint"><b>What the kit checks on these fixtures</b> (<code>tools/conform.mjs</code>, PASS on native ngspice and on this page's WASM engine): connectivity; KCL between the probed currents; Ohm on the resistor; the storing element's own law (i = C·dv/dt, v = L·di/dt) and its energy bookkeeping (∫v·i dt against Δ½Cv² / Δ½Li² over a window); the analytic first-order step written by hand from R, C and L (τ = RC, τ = L/R) as an independent reference; named end states and bounds. The probe current and the element's own <code>i(L)</code> are compared as a sign/mapping check, not as two solvers.</p>
<p class="hint"><b>What is drawn.</b> The capacitor is two plates whose tint follows the solved charge q = C·(v+ − v−) against the run's peak (the + plate warms, the − plate cools); nothing conducts across the gap. The inductor is a winding with one carrier overlay. Both are ILLUSTRATIVE sizes — the composition gives farads and henries only — unlike the RC page's geometry-derived plates and coil, which are not duplicated here. Leads and drops are the rail template's; the drawn terminals and the template's predictions are compared in the browser (<code>__benchRailReport()</code>), and the drawn conductors are validated against the drawn bodies with the same geometry core.</p>
<p class="hint"><b>Not claimed.</b> No ESR, no leakage, no saturation, no parasitics; no user initial states; no migration of the RC page; the bench draws resistor, capacitor, inductor, diode, LED and switch bodies only and refuses any other kind by name.</p>
<details><summary>The composition now solved, verbatim</summary><pre class="hint" id="composition-json" style="white-space:pre-wrap;font-size:11px"></pre></details>
<p class="hint" id="composition-identity"></p>
</details>
</section>
</article></div>`;

const el = (id: string) => document.getElementById(id)!;
const query = new URLSearchParams(location.search);
let fixtureName = FIXTURES[query.get('fixture') ?? ''] ? (query.get('fixture') as string) : 'rc-step';
let circuit: Composition = FIXTURES[fixtureName];
/**
 * A CANDIDATE FROM THE PROJECT'S TRIAL PATH (`?src=tools/conformance/<...>.json`): same-origin only, under that one
 * directory, no `..`, `.json` only — fetched, parsed, structurally validated (the kit's own `buildStructure`) and
 * checked against the shared supported-view subset before it is adopted. Every failure is named in the notice; the
 * latest request wins (an earlier fetch that lands later is dropped). No arbitrary remote loader.
 */
const SRC_RULE = /^tools\/conformance\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.json$/;
let loadGeneration = 0;
async function loadCandidate(src: string): Promise<void> {
  const mine = ++loadGeneration;
  const fail = (m: string) => { if (mine !== loadGeneration) return; el('notice').textContent = `Could not load ${src}: ${m}`; paint(); };
  if (!SRC_RULE.test(src) || src.includes('..')) return fail('only same-origin paths under tools/conformance/ ending in .json are accepted');
  let text: string;
  try { const res = await fetch(`/${src}`, { cache: 'no-store' }); if (!res.ok) return fail(`fetch failed (${res.status})`); text = await res.text(); } catch (e) { return fail(`fetch failed (${e instanceof Error ? e.message : e})`); }
  if (mine !== loadGeneration) return;
  let c: Composition;
  try { c = JSON.parse(text) as Composition; } catch (e) { return fail(`not JSON (${e instanceof Error ? e.message : e})`); }
  try { const st = buildStructure(c); if (st.findings.length) return fail(`structural finding(s): ${st.findings.map((f) => `${f.cause} at ${f.where}`).join('; ')}`); }
  catch (e) { return fail(`refused: ${(e as { cause_?: string }).cause_ ?? 'invalid'} at ${(e as { where?: string }).where ?? '?'} — ${e instanceof Error ? e.message : e}`); }
  const unsupported = unsupportedViewParts(c); if (unsupported.length) return fail(`no shared bench body for: ${unsupported.map((p) => `${p.name} (${p.kind})`).join(', ')}`);
  if (mine !== loadGeneration) return;
  fixtureName = `src:${src}`; circuit = c; laid = layOut(circuit); el('notice').textContent = laid.refused ?? `Loaded ${src}.`;
  history.replaceState(null, '', `?src=${encodeURIComponent(src)}`);
  void sha256Json(circuit).then((h) => { el('composition-identity').textContent = `Composition ${circuit.id} · SHA-256 ${h.slice(0, 16)}… · structure ${structuralHash(circuit).slice(0, 12)}… · from ${src}`; });
  playback = null; transient = null; solverFrame = null;
  void resolveCircuit(`Solving ${c.id} from ${src}. `); paint(); stage?.refit();
}
let spice: SpiceClient | null = null;
let stage: PotentialScene | null = null;
let playback: BenchPlayback | null = null;
let transient: CompositionTransient | null = null;
let solverFrame: BenchFrame | null = null;
let paused = true, busy = false, fault: string | null = null, displayFault: string | null = null, labelValues = true;
let generation = 0;
let bounds = { lo: -0.1, hi: 1, fullI: 1e-3, charge: new Map<string, number>() };

// ---------------------------------------------------------------- the layout, from the composition alone
interface Laid { layout: RailLayout; report: RailReport; refused: string | null }
function layOut(c: Composition): Laid {
  const unsupported = unsupportedViewParts(c).map((p) => `${p.name} (${p.kind})`);
  if (unsupported.length) return { layout: null as unknown as RailLayout, report: null as unknown as RailReport, refused: `this bench cannot draw: ${unsupported.join(', ')}` };
  try {
    const layout = railLayout(railInputFrom(c, () => 'all', ['all']), structuralHash(c));
    const report = validateRailLayout(layout, c);
    return { layout, report, refused: report.ok ? null : `the rail layout did not validate: ${report.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.cause} at ${d.where}`).join('; ')}` };
  } catch (e) { return { layout: null as unknown as RailLayout, report: null as unknown as RailReport, refused: e instanceof RailLayoutError ? `${e.cause_} at ${e.where}: ${e.message}` : String(e instanceof Error ? e.message : e) }; }
}
let laid: Laid = layOut(circuit);

// ---------------------------------------------------------------- solving
function speedMultiplier(): number { return speedFromSlider(Number((el('rate') as HTMLInputElement).value)); }
function captureBounds(t: CompositionTransient): void {
  let lo = 0, hi = 0, fullI = 0; const charge = new Map<string, number>();
  for (const node of t.structure.externalNodes) { const s = t.series[`node:${node}`]; if (!s) continue; for (const v of s) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  for (const p of t.composition.parts) {
    const s = t.series[`${p.name}.current`]; if (s) for (const v of s) fullI = Math.max(fullI, Math.abs(v));
    if (p.kind === 'capacitor') { const vp = t.series[`${p.name}.vplus`], vm = t.series[`${p.name}.vminus`]; let q = 0; for (let k = 0; k < vp.length; k++) q = Math.max(q, Math.abs(p.spec.farads * (vp[k] - vm[k]))); charge.set(p.name, q); }
  }
  bounds = { lo: Math.min(lo, -0.05 * (hi - lo || 1)), hi: Math.max(hi, lo + 1e-9), fullI: Math.max(fullI, 1e-12), charge };
}
async function resolveCircuit(why: string): Promise<void> {
  if (!spice) spice = new SpiceClient();
  const mine = ++generation; busy = true; fault = null; paintStatus(why);
  try {
    if (laid.refused) throw new Error(laid.refused);
    const solved = await spice.solveComposition(circuit, { timeoutMs: 60000 });
    if (mine !== generation) return;
    captureBounds(solved);
    const rate = solved.stopSeconds / wallSecondsFor(speedMultiplier());
    if (playback) playback.adopt(solved, rate); else playback = new BenchPlayback(solved, rate);
    playback.replayFromRest = false; transient = solved; solverFrame = playback.frame(); paused = true; busy = false; displayFault = null;
    paintStatus(`Solved ${circuit.id}: ${solved.times.length} samples over ${siUnit(solved.stopSeconds, 's')} on ${solved.engine}; ${INITIAL_STATE_POLICY} start.`);
  } catch (e) {
    if (mine !== generation) return;
    busy = false; playback = null; solverFrame = null; transient = null; fault = String(e instanceof Error ? e.message : e); paintStatus(null);
  }
  if (mine === generation) paint();
}
function paintStatus(message: string | null): void {
  const node = el('solver-status'), banner = el('stage-fault');
  banner.hidden = !fault && !displayFault;
  banner.textContent = fault ? `NOT DRIVEN — ${fault}` : displayFault ? `DISPLAY FAULT — the picture stopped: ${displayFault}` : '';
  if (fault) { node.textContent = `Not solved — the scene is NOT being driven. ${fault}`; return; }
  node.textContent = (busy ? 'Solving… ' : '') + (message ?? '');
}

// ---------------------------------------------------------------- the scene spec, generic over the composition
const PART_IDS = (c: Composition): Record<string, string> => Object.fromEntries(c.parts.map((p) => [`bn-${p.name}`, p.name]));
function valueLabel(p: PartInstance): string {
  switch (p.kind) {
    case 'resistor': return `${p.name} ${siUnit(p.spec.ohms, 'Ω')}`;
    case 'capacitor': return `${p.name} ${siUnit(p.spec.farads, 'F')}`;
    case 'inductor': return `${p.name} ${siUnit(p.spec.henries, 'H')}`;
    default: return `${p.name} (${p.kind})`;
  }
}
function benchSpec(): SceneSpec {
  const c = circuit, L = laid.layout, f = solverFrame, known = f !== null && transient !== null;
  const gnd = c.sources[0]?.minus ?? '0', rail = c.sources[0]?.plus ?? 'vdd';
  const nodes = [...buildStructure(c).externalNodes];
  const volts = (net: string): number => known ? (net === '0' ? 0 : f!.at(`node:${net}`)) : 0;
  const cur = (name: string): number | null => known ? f!.at(`${name}.current`) : null;
  const terraces: TerraceSpec[] = nodes.map((net) => ({ id: net, label: net === gnd ? 'ground' : net === rail ? `+ ${net}` : net, volts: volts(net), isRef: net === gnd, anchor: L.anchors[net] ?? { x: 0, z: 0 }, showValue: labelValues }));
  const branches: BranchSpec[] = [];
  const src = c.sources[0];
  // The source: `i(V)` enters its + terminal, so the current it DELIVERS to the rail is the negative.
  branches.push({ id: 'bn-V', label: src ? (src.kind === 'dc' ? `${src.name} ${src.volts} V` : `${src.name} programme`) : 'source', kind: 'source', from: gnd, to: rail, current: known && src ? -f!.at(`${src.name}.current`) : null });
  for (const p of c.parts) {
    const kind = DRAWN_AS[p.kind]!; const q = L.poses[p.name], leads = L.leads[p.name]; const [m0, m1] = BODY_GEOMETRY[p.kind as DeckKind].main; const ports = p.ports as Record<string, string>;
    const b: BranchSpec = { id: `bn-${p.name}`, label: labelValues ? valueLabel(p) : p.name, kind, from: ports[m0], to: ports[m1], current: cur(p.name), fullScaleA: bounds.fullI,
      bodyAt: { x: q.x, z: q.z }, bodyDir: q.dir, bodyLen: q.len, leadFrom: leads.leadFrom, leadTo: leads.leadTo, leadRoutes: leads.leadRoutes };
    if (p.kind === 'capacitor') { b.charge = known ? p.spec.farads * (f!.at(`${p.name}.vplus`) - f!.at(`${p.name}.vminus`)) : null; b.chargeFull = bounds.charge.get(p.name) ?? 1e-30; }
    if (p.kind === 'switch') b.closed = known ? f!.at(`${p.name}.control`) > 0.5 : false;
    branches.push(b);
  }
  // Bus currents: the signed sum of the members' solved currents beyond each drop (KCL by construction, not a probe).
  const taken = (part: string, port: string): number | null => { const p = c.parts.find((x) => x.name === part); if (!p || !known) return null; const i = f!.at(`${part}.current`); return port === BODY_GEOMETRY[p.kind as DeckKind].main[0] ? i : -i; };
  const buses = [
    busThrough('bn-rail', L.rail.z, L.rail.feedX, L.busMembers.rail.map((m) => ({ x: m.x, taken: taken(m.part, m.port) })), [L.rail.x0, L.rail.x1]),
    busThrough('bn-ground', L.ground.z, L.ground.feedX, L.busMembers.ground.map((m) => ({ x: m.x, taken: taken(m.part, m.port) })), [L.ground.x0, L.ground.x1]),
  ];
  return { deck: { rulerX: L.rail.feedX - 2.0, viewDir: [0.04, 0.66, 1], tightFit: true }, fixedSpan: { lo: bounds.lo, hi: bounds.hi }, fixedFullI: bounds.fullI, terraces, branches, flowCue: FLOW_CUE, buses };
}

// ---------------------------------------------------------------- painting
function paintFixtures(): void {
  const host = el('fixture-buttons');
  if (!host.children.length) for (const name of Object.keys(FIXTURES)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.dataset.fixture = name; b.onclick = () => setFixture(name); host.appendChild(b); }
  for (const b of host.children) (b as HTMLButtonElement).setAttribute('aria-pressed', String(fixtureName === (b as HTMLElement).dataset.fixture));
  const src = fixtureName.startsWith('src:') ? fixtureName.slice(4) : null;
  el('fixture-blurb').textContent = src ? `candidate ${circuit.id} from ${src}` : '';
  const parts = circuit.parts.map(valueLabel).join(', ');
  el('fixture-blurb').textContent = `${src ? `candidate from ${src} — ` : ''}${circuit.id}: ${parts}; source ${circuit.sources[0]?.name}; ${siUnit(circuit.analysis.stopSeconds, 's')} horizon.${laid.refused ? ` REFUSED — ${laid.refused}` : ''}`;
  el('composition-json').textContent = JSON.stringify(circuit, null, 1);
}
function paint(): void {
  paintFixtures();
  const m = speedMultiplier(); el('rate-readout').textContent = `${m.toFixed(2)}× · ${wallSecondsFor(m).toFixed(0)} s for the run`;
  const f = solverFrame, t = transient;
  el('play').textContent = paused ? 'Run' : 'Pause'; el('replay').hidden = !(playback && playback.atHorizon);
  const ro = el('readouts');
  if (f && t) {
    const rows: string[] = [];
    for (const p of circuit.parts) {
      const i = f.at(`${p.name}.current`);
      if (p.kind === 'capacitor') { const v = f.at(`${p.name}.vplus`) - f.at(`${p.name}.vminus`); rows.push(`<div class="cool">${p.name} · capacitor ${siUnit(p.spec.farads, 'F')}<output>${v.toFixed(4)} V · ${siUnit(i, 'A')} · q ${siUnit(p.spec.farads * v, 'C')} · ½CV² ${siUnit(0.5 * p.spec.farads * v * v, 'J')}</output></div>`); }
      else if (p.kind === 'inductor') { const v = f.at(`${p.name}.vplus`) - f.at(`${p.name}.vminus`); rows.push(`<div class="warm">${p.name} · inductor ${siUnit(p.spec.henries, 'H')}<output>${siUnit(i, 'A')} · ${v.toFixed(4)} V · ½LI² ${siUnit(0.5 * p.spec.henries * i * i, 'J')} · i(L) ${siUnit(f.at(`${p.name}.windingCurrent`), 'A')}</output></div>`); }
      else if (p.kind === 'resistor') { const v = f.at(`${p.name}.va`) - f.at(`${p.name}.vb`); rows.push(`<div>${p.name} · resistor ${siUnit(p.spec.ohms, 'Ω')}<output>${v.toFixed(4)} V · ${siUnit(i, 'A')} · ${siUnit(v * i, 'W')}</output></div>`); }
      else rows.push(`<div>${p.name} · ${p.kind}<output>${siUnit(i, 'A')}</output></div>`);
    }
    const src = circuit.sources[0]; if (src) rows.push(`<div>${src.name} · source<output>${f.at(`node:${src.plus}`).toFixed(4)} V · delivers ${siUnit(-f.at(`${src.name}.current`), 'A')}</output></div>`);
    ro.innerHTML = rows.join('');
    el('headline').innerHTML = `<div><small>FIXTURE</small><strong>${circuit.id}</strong><em>${circuit.parts.length} parts, ${t.structure.externalNodes.size} nodes, ${t.times.length} samples</em></div>`
      + `<div><small>TIME</small><strong>${siUnit(f.timeSeconds, 's')}</strong><em>of ${siUnit(t.stopSeconds, 's')} · ${f.state === 'before-start' ? 'operating point' : f.state}</em></div>`;
    el('scene-time').textContent = `Requested ${f.requestedTimeSeconds.toExponential(4)} s · represented ${f.timeSeconds.toExponential(4)} s · grid median ${siUnit(t.actualStepSeconds.median, 's')} · ${t.engine}`;
  } else { ro.innerHTML = ''; el('headline').innerHTML = `<div><small>FIXTURE</small><strong>${circuit.id}</strong><em>${fault ? 'not solved' : 'solving'}</em></div>`; el('scene-time').textContent = ''; }
  if (stage && !laid.refused) stage.applySpec(benchSpec());
}
const halted = (): boolean => !playback || !!fault || !!displayFault || busy;
el('play').onclick = () => { if (halted()) return; if (playback!.atHorizon) playback!.reset(); paused = !paused; paint(); };
el('step').onclick = () => { if (halted()) return; paused = true; playback!.paused = false; playback!.stepOne(); playback!.paused = true; solverFrame = playback!.frame(); paint(); };
el('restart').onclick = () => { if (halted()) return; paused = true; playback!.reset(); solverFrame = playback!.frame(); paint(); };
el('replay').onclick = () => { if (halted()) return; playback!.reset(); paused = false; paint(); };
el('rate').addEventListener('input', () => { if (playback && transient) playback.playbackRate = transient.stopSeconds / wallSecondsFor(speedMultiplier()); paint(); });
el('reset-view').onclick = () => stage?.refit();
el('labels-on').addEventListener('change', () => stage?.setLabelsVisible((el('labels-on') as HTMLInputElement).checked));
el('labels-values').addEventListener('change', () => { labelValues = (el('labels-values') as HTMLInputElement).checked; paint(); });
function setFixture(name: string): void {
  if (!FIXTURES[name]) { el('notice').textContent = `No fixture ${name}`; return; }
  fixtureName = name; circuit = FIXTURES[name]; laid = layOut(circuit); el('notice').textContent = laid.refused ?? '';
  history.replaceState(null, '', `?fixture=${name}`);
  void sha256Json(circuit).then((h) => { el('composition-identity').textContent = `Composition ${circuit.id} · SHA-256 ${h.slice(0, 16)}… · structure ${structuralHash(circuit).slice(0, 12)}…`; });
  playback = null; transient = null; solverFrame = null;
  void resolveCircuit(`Solving ${name}. `); paint(); stage?.refit();
}
function startStage(): void {
  try { const built = new PotentialScene(el('stage3d'), el('stagelabels')); el('graphics-status').hidden = true; el('stage').hidden = false; built.resize(); built.refit(); stage = built; (window as unknown as Record<string, unknown>).__benchstage = built; }
  catch (error) { console.error('Bench 3D initialization failed', error); stage = null; el('stage').hidden = true; const status = el('graphics-status'); status.hidden = false; status.textContent = `The 3D scene could not start: ${error instanceof Error ? error.message : String(error)}`; }
}
startStage();
window.addEventListener('resize', () => stage?.resize());
let last: number | null = null, lastPaint = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  try {
    if (document.hidden) { last = null; return; }
    if (last !== null && now - last < 1000 / 30) return;
    const dt = frameSeconds(now, last); last = now;
    if (displayFault) paused = true;
    const animating = !!playback && !paused && !playback.atHorizon && !busy && !fault && !displayFault;
    if (playback && !busy && !fault && !displayFault) { playback.paused = paused; playback.advance(dt); solverFrame = playback.frame(); if (!paused && now - lastPaint > 80) { paint(); lastPaint = now; } if (playback.atHorizon && !paused) { paused = true; paint(); } }
    const showDt = dt * speedMultiplier();
    stage?.render(animating ? showDt : 0, animating ? dt : 0);
  } catch (e) { console.error('Bench display fault', e); paused = true; displayFault = e instanceof Error ? e.message : String(e); try { paintStatus(null); } catch { /* the banner itself failed */ } }
}
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.__benchSeek = (t: number) => { if (!playback) return false; paused = true; playback.seek(t); solverFrame = playback.frame(); paint(); return true; };
  w.__benchPaint = () => paint();
  w.__benchFixture = (name: string) => setFixture(name);
  w.__benchLoad = (src: string) => { void loadCandidate(src); };
  w.__benchDescribe = () => ({ fixture: fixtureName, solved: !!transient, samples: transient?.times.length ?? 0, fault, refused: laid.refused, bounds: { lo: bounds.lo, hi: bounds.hi, fullI: bounds.fullI } });
  w.__benchDrawn = () => (stage as unknown as { terminals?: () => unknown } | null)?.terminals?.() ?? null;
  w.__benchRebuildStage = () => { if (stage && !laid.refused) stage.buildFromSpec(benchSpec()); };
  w.__benchPaintStage = () => { if (stage && !laid.refused) stage.applySpec(benchSpec()); };
  /** The rail-kit report on THIS fixture: the template's own validation, the drawn terminals against the predictions, and the geometry core on what the renderer drew. */
  w.__benchRailReport = () => {
    if (laid.refused) return { refused: laid.refused };
    const L = laid.layout, c = circuit, ids = PART_IDS(c);
    const drawn = (stage as unknown as { terminals?: () => Record<string, Record<string, [number, number, number]>> } | null)?.terminals?.() ?? {};
    const errors: { part: string; port: string; predicted: [number, number]; drawn: [number, number, number] | null; error: number | null }[] = [];
    for (const [branchId, part] of Object.entries(ids)) {
      const q = L.poses[part]; if (!q) continue;
      for (const port of Object.keys(BODY_GEOMETRY[q.kind].terminals)) { const t = terminalAt(q, port); const d = drawn[branchId]?.[port] ?? null; errors.push({ part, port, predicted: [+t.x.toFixed(3), +t.z.toFixed(3)], drawn: d, error: d ? +Math.hypot(d[0] - t.x, d[2] - t.z).toFixed(3) : null }); }
    }
    let rendered: unknown = null;
    const geo = (stage as unknown as { geometry?: () => { bodies: Record<string, { min: [number, number, number]; max: [number, number, number] }[]>; wires: Record<string, [number, number, number][]>; rotor: { hub: [number, number, number]; radius: number } | null } } | null)?.geometry?.();
    if (geo) {
      const spec = benchSpec(); const byId = new Map(spec.branches.map((b) => [b.id, b]));
      const wires: Wire3[] = [];
      const gnd = c.sources[0]?.minus ?? '0', rail = c.sources[0]?.plus ?? 'vdd';
      for (const [id, pts] of Object.entries(geo.wires)) {
        const m = /^(bn-[A-Za-z0-9]+)(-in|-out|-flow|-\d+)?$/.exec(id); if (!m) continue;
        const base = m[1], suf = m[2] ?? ''; const b = byId.get(base);
        let net: string | null = null;
        if (base === 'bn-rail') net = rail; else if (base === 'bn-ground') net = gnd; else if (base === 'bn-V') net = `${gnd}|${rail}`;
        else if (b) { if (suf === '-in') net = b.from; else if (suf === '-out') net = b.to; else continue; }
        if (!net) continue;
        wires.push({ id, net, owner: base, kind: suf === '-in' || suf === '-out' ? 'lead' : base === 'bn-rail' || base === 'bn-ground' ? 'bus' : 'cable', points: pts });
      }
      const bodies: BodyShape[] = Object.entries(geo.bodies).filter(([id]) => ids[id]).flatMap(([id, boxes]) => boxes.map((bx) => ({ id: ids[id], kind: 'box' as const, min: bx.min, max: bx.max })));
      const terminals = layoutTerminals(L, c).map((t) => { const dr = drawn[`bn-${t.part}`]?.[t.port]; return dr ? { ...t, at: dr } : t; });
      const core = checkGeometry3D(wires, bodies, terminals, null, layoutNets(L, c), { endEps: 0.15 });
      rendered = { ok: !core.diagnostics.some((d) => d.severity === 'error'), wires: wires.length, bodies: bodies.length, pairs: core.pairs, errors: core.diagnostics.filter((d) => d.severity === 'error'), infos: core.diagnostics.filter((d) => d.severity !== 'error').map((d) => `${d.cause} ${d.where}`) };
    }
    return { fixture: fixtureName, template: laid.report, rendered, correspondence: { terminals: errors, worst: Math.max(...errors.map((e) => e.error ?? -1)), missing: errors.filter((e) => e.error === null).map((e) => `${e.part}.${e.port}`) } };
  };
}
setFixture(fixtureName);
if (query.get('src')) void loadCandidate(query.get('src')!);
requestAnimationFrame(frame);
