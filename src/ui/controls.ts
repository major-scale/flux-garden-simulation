/**
 * A KNOB, A SWITCH AND A LIGHT — the controls bench: reusable parts (toggle, potentiometer, LED)
 * on the same workstation. No physics here; the trajectory is ngspice's through
 * `SpiceClient.solveControls`, read in `src/model/controls.ts`, played by the shared cursor.
 *
 * THE CONTROLS ARE BETWEEN-RUN CONTROLS. These parts have no dynamics, so turning the knob or
 * choosing the toggle's state submits a NEW SOLVE and starts a NEW RUN — the page says so, keeps
 * the previous accepted scene until the new one is adopted, and never pretends to continue a
 * state it does not have. Inside a run the only event is the toggle closing at a programmed,
 * finite edge, which is what the viewer watches.
 */
import './rc.css';
import './style.css';
import { PotentialScene, type SceneSpec, type BranchSpec, type TerraceSpec } from './potential-scene';
import { SpiceClient, Superseded } from '../model/spice/client';
import { PlaybackCursor, type PlaybackState } from '../model/spice/cursor';
import { sampleControlsAt, type ControlsSnapshot, type ControlsTransient } from '../model/spice/controls-transient';
import { controlsReading, controlsDomain, type ControlsReading } from '../model/controls';
import { CONTROLS_PRESETS, controlsPresetById, type ControlsPreset } from '../model/controls-presets';
import { validateControls, type ControlsDescription } from '../model/spice/controls-netlist';
import { potLegs } from '../model/spice/parts';
import { encodeControlsDoc, decodeControlsDoc } from '../model/controls-doc';
import { speedFromSlider, wallSecondsFor } from './transport';
import { fmt, siUnit } from './rc-flow';
import { frameSeconds } from '../model/rc-driver';

interface ControlsFrame extends ControlsSnapshot { kind: 'solved'; requestedTimeSeconds: number; clampedToHorizon: boolean; onEdge: boolean; state: PlaybackState; progress: number }
class ControlsPlayback extends PlaybackCursor<ControlsTransient> {
  frame(): ControlsFrame {
    const s = sampleControlsAt(this.transient, this.cursor);
    const atStart = !this.started && this.cursor === 0;
    return { kind: 'solved', ...s, state: atStart ? 'before-start' : this.state, progress: atStart ? 0 : this.progress };
  }
}

const root = document.getElementById('rc-app')!;
root.innerHTML = `
<header><span><a href="/rc.html">← RLC</a> · <a href="/lamp.html">← Transistor and lamp</a> · <a href="/motor.html">← Motor lifts a weight</a> · <a href="/sensors.html">A sensor decides →</a></span><span>FLUX GARDEN / CONTROLS</span></header>
<section class="intro"><p class="eyebrow">THREE PARTS YOU CAN REUSE</p><h1>A knob, a switch and a light — and what the load does to the knob.</h1>
<p>A potentiometer is a resistive track with a moving contact. Its wiper voltage is the divider's <i>loaded</i> answer — the LED and its resistor draw current from the wiper, so the textbook formula overstates it, and this bench shows both. Turning the knob or changing the switch is a new experiment: the whole run is re-solved and starts again. <a href="#model-notes">The model, and what it does not claim &rarr;</a></p></section>
<div class="layout"><aside><h2>Your circuit</h2>
<p class="hint"><b>Turn the knob</b> · wiper from end A (supply side) to end B (ground)</p>
<input id="knob" type="range" min="0" max="1000" value="500" aria-label="Wiper position"><output id="knob-readout" class="hint"></output>
<p class="hint" style="margin-top:12px"><b>Toggle</b> · the state the run is solved with</p>
<div class="mode scene-switch" aria-label="Toggle state"><button id="tog-closed" aria-pressed="true">Closed (closes 5 ms in)</button><button id="tog-open" aria-pressed="false">Open</button></div>
<form id="controls-form">
<label>Supply · V<input id="supply" type="number" value="9" step="any" min="0" max="60" required></label>
<label>Track resistance (nominal) · Ω<input id="rtot" type="number" value="1000" step="any" min="1" max="10000000" required></label>
<label>Series resistor · Ω<input id="rs" type="number" value="270" step="any" min="1" max="1000000" required></label>
<button type="submit">Apply &amp; re-solve</button></form>
<p class="hint">Every change re-solves the whole run and restarts it; nothing continues. The previous picture stays until the new solve is adopted.</p>
<div class="actions"><button id="save">Save circuit</button><label class="file">Load circuit<input id="load" type="file" accept=".json,application/json"></label></div>
<p id="notice" role="status"></p>
</aside><article>
<div class="transport"><button id="play">Run</button><button id="step">One tick</button><button id="restart">Restart</button><button id="replay" hidden>Replay ↻</button><span class="speed" aria-label="Playback speed"><label for="rate">Speed</label><input id="rate" type="range" min="0" max="1000" value="500" aria-describedby="rate-readout"><output id="rate-readout"></output></span><details class="timing-details"><summary>Timing</summary><span id="clock"></span></details></div>
<section class="instrument">
<div class="presets" aria-label="What does it do?"><span class="preset-lead">WHAT DOES IT DO?</span><span id="preset-buttons"></span></div>
<p class="hint" id="preset-blurb"></p>
<div id="circuit-world"><div id="stage"><button id="reset-view" title="Restore the starting view">Reset view</button><label class="labels-toggle"><input id="labels-on" type="checkbox" checked> Labels</label><span class="orbit-hint">Drag to look around · marker height = voltage</span><div id="stage3d"></div><div id="stagelabels"></div></div></div>
<div id="stage-fault" class="stage-fault" hidden role="alert"></div>
<div id="headline"></div>
<div class="readouts">
<div>Toggle<output id="r-sw">—</output></div>
<div class="cool">Wiper · LOADED (solved)<output id="r-vw">—</output></div>
<div>Wiper · unloaded formula<output id="r-vu">—</output></div>
<div>Pot legs A–W / W–B<output id="r-legs">—</output></div>
<div class="warm">LED current<output id="r-il">—</output></div>
<div class="warm">LED voltage<output id="r-vl">—</output></div>
<div>Emission drive · max(I,0)/30 mA<output id="r-em">—</output></div>
<div>Power · pot / series / LED<output id="r-p">—</output></div>
</div>
<p class="hint" id="solver-status"></p>
<p class="hint" id="scene-time"></p>
<p id="graphics-status" role="status" hidden></p>
<details id="model-notes"><summary>The model, and what it does not claim</summary>
<p class="hint"><b>Potentiometer</b>: ends A and B, wiper W. Legs R<sub>AW</sub> = f·R + R<sub>end</sub>, R<sub>WB</sub> = (1−f)·R + R<sub>end</sub>, where R is the <b>nominal track resistance</b> and R<sub>end</sub> = 0.1 Ω is a floor so no leg is a zero resistor — end-to-end reads R + 0.2 Ω; the wiper lead carries R<sub>contact</sub> = 0.5 Ω. f = 0 is the wiper at A (full), f = 1 at B. Both legs, the wiper and the load are solved together — the unloaded formula is printed only for comparison.</p>
<p class="hint"><b>Toggle</b>: ngspice's ideal switch model (R<sub>on</sub> 0.05 Ω, R<sub>off</sub> 1 GΩ), closed at a programmed 0.5 ms edge 5 ms into the run when "Closed" is chosen; never closes when "Open" is chosen. Not a transistor. Bounce, changeover and momentary variants are not this batch.</p>
<p class="hint"><b>LED</b>: an illustrative quasi-static diode (IS 1e-20, N 2, RS 1 Ω, BV 5 V — the model gives about 2.15 V at 10 mA), not a catalogue part. The solver gives its current and voltage; its <b>light is a rendering rule</b>: emission drive = max(I, 0) / 30 mA, linear as an INPUT intensity to the material and a point light, zero at zero current, no floor. No optical output, colour or photometry is calculated; the on-screen brightness passes through tone mapping and is not linear in what you see. Supported demonstration range: forward current ≤ 30 mA, reverse ≥ −5 V; runs outside it are refused. The series resistor is real and in the netlist.</p>
<p class="hint">Verified in <code>tools/controls-spice-verify.mjs</code>: KCL at the wiper, the track node and end A at every sample; the LED against its own equation with RS; the series resistor's Ohm's law; the domain; native ngspice-45.2 against the WASM build. Reuse of the same emitters is proved by a test that builds pot → MOSFET gate → lamp and closes KCL. Playback speed re-times the run and touches no number.</p>
<p class="hint" id="scale-notes"></p>
</details>
</section>
</article></div>`;

const el = (id: string) => document.getElementById(id)!;
let circuit: ControlsDescription = CONTROLS_PRESETS[0].build();
let activePreset: ControlsPreset | null = CONTROLS_PRESETS[0];
let spice: SpiceClient | null = null;
let playback: ControlsPlayback | null = null;
let presented: ControlsDescription | null = null;
let solverFrame: ControlsFrame | null = null;
let fault: string | null = null, displayFault: string | null = null;
let busy = false, paused = true, generation = 0;
let stage: PotentialScene | null = null;
let bounds = { lo: 0, hi: 9, fullI: 1e-12 };

function speedMultiplier(): number { return speedFromSlider(Number((el('rate') as HTMLInputElement).value)); }
function captureBounds(t: ControlsTransient): void {
  let lo = 0, hi = 0, fullI = 0;
  for (let k = 0; k < t.times.length; k++) {
    for (const v of [t.supplyVolts[k], t.potAVolts[k], t.wiperVolts[k], t.ledAnodeVolts[k]]) { if (v < lo) lo = v; if (v > hi) hi = v; }
    fullI = Math.max(fullI, Math.abs(t.sourceAmps[k]), Math.abs(t.potInAmps[k]), Math.abs(t.ledAmps[k]));
  }
  bounds = { lo, hi: Math.max(hi, lo + 1e-9), fullI: Math.max(fullI, 1e-12) };
}

async function resolveCircuit(why: string): Promise<void> {
  if (!spice) spice = new SpiceClient();
  const mine = ++generation;
  busy = true; fault = null; paintStatus(why);
  try {
    validateControls(circuit);
    const transient = await spice.solveControls(circuit);
    if (mine !== generation) return;
    const domain = controlsDomain(transient);
    if (!domain.ok) throw new Error(domain.reason!);
    captureBounds(transient);
    const rate = circuit.stopSeconds / wallSecondsFor(speedMultiplier());
    if (playback) playback.adopt(transient, rate); else playback = new ControlsPlayback(transient, rate);
    playback.replayFromRest = false;
    presented = circuit; solverFrame = playback.frame(); paused = true; busy = false; displayFault = null;
    paintStatus(`Solved. ${transient.times.length} samples over ${siUnit(transient.stopSeconds, 's')}. Press Run.`);
  } catch (e) {
    if (mine !== generation) return;
    if (e instanceof Superseded) return;
    busy = false; playback = null; solverFrame = null; presented = null;
    fault = String(e instanceof Error ? e.message : e); paintStatus(null);
  }
  if (mine === generation) paint();
}
function paintStatus(message: string | null): void {
  const node = el('solver-status'), banner = el('stage-fault');
  banner.hidden = !fault && !displayFault;
  banner.textContent = fault ? `NOT DRIVEN — the solve failed: ${fault}` : displayFault ? `DISPLAY FAULT — the picture stopped: ${displayFault}` : '';
  if (fault) { node.textContent = `Solver fault — the scene is NOT being driven. ${fault}`; return; }
  node.textContent = (busy ? 'Solving… ' : '') + (message ?? '');
}

const SUP = 'ct-supply', POTA = 'ct-a', WIP = 'ct-w', ANODE = 'ct-anode', GND = 'ct-gnd';
function controlsSpec(): SceneSpec {
  const f = solverFrame, c = presented ?? circuit, known = f !== null;
  const r: ControlsReading | null = f ? controlsReading(f, c) : null;
  const terraces: TerraceSpec[] = [
    { id: SUP, label: known ? 'supply +' : 'supply + · unsolved', volts: known ? f!.supplyVolts : c.supplyVolts, anchor: { x: -10.0, z: -1.2 } },
    { id: POTA, label: known ? 'pot end A' : 'pot end A · unsolved', volts: known ? f!.potAVolts : 0, anchor: { x: -3.6, z: -1.2 } },
    { id: WIP, label: known ? 'wiper W' : 'wiper W · unsolved', volts: known ? f!.wiperVolts : 0, anchor: { x: 0.2, z: 3.4 } },
    { id: ANODE, label: known ? 'LED anode' : 'LED anode · unsolved', volts: known ? f!.ledAnodeVolts : 0, anchor: { x: 6.0, z: 3.4 } },
    { id: GND, label: 'ground', volts: 0, isRef: true, anchor: { x: 3.4, z: -1.2 } },
  ];
  const branches: BranchSpec[] = [
    { id: 'ct-V', label: `supply ${fmt(c.supplyVolts)} V`, kind: 'source', from: GND, to: SUP, current: known ? f!.sourceAmps : null },
    { id: 'ct-S', kind: 'switch', from: SUP, to: POTA, current: known ? f!.sourceAmps : null, closed: known ? f!.switchClosed : null,
      label: !known ? 'toggle' : `toggle · ${f!.switchClosed ? 'CLOSED' : 'OPEN'}` },
    { id: 'ct-P', kind: 'pot', from: POTA, to: GND, current: known ? f!.potInAmps : null, legBCurrent: known ? f!.legBAmps : null,
      wiperTerrace: WIP, wiperFraction: c.pot.wiperFraction, wiperCurrent: known ? f!.wiperAmps : null,
      label: `pot ${siUnit(c.pot.totalOhms, 'Ω')} · f ${c.pot.wiperFraction.toFixed(2)}` },
    { id: 'ct-R', kind: 'load', from: WIP, to: ANODE, current: known ? f!.wiperAmps : null, label: `series ${siUnit(c.seriesOhms, 'Ω')}` },
    { id: 'ct-L', kind: 'led', from: ANODE, to: GND, current: known ? f!.ledAmps : null, emission: r ? r.brightness : null,
      label: r ? `LED · ${(r.brightness * 100).toFixed(0)}% drive` : 'LED' },
  ];
  return { deck: { rulerX: -12.4, viewDir: [0.04, 0.5, 1] }, fixedSpan: { lo: bounds.lo, hi: bounds.hi }, fixedFullI: bounds.fullI, terraces, branches, drawStores: false };
}

function paintPresets(): void {
  const host = el('preset-buttons');
  if (!host.children.length) for (const p of CONTROLS_PRESETS) { const b = document.createElement('button'); b.type = 'button'; b.textContent = p.label; b.dataset.preset = p.id; b.onclick = () => choosePreset(p); host.appendChild(b); }
  for (const b of host.children) (b as HTMLButtonElement).setAttribute('aria-pressed', String(activePreset?.id === (b as HTMLElement).dataset.preset));
  el('preset-blurb').textContent = activePreset ? activePreset.blurb : 'Your own knob position, switch state or numbers, solved as a new run.';
}
function paintControls(): void {
  (el('knob') as HTMLInputElement).value = String(Math.round(circuit.pot.wiperFraction * 1000));
  const { aw, wb } = potLegs(circuit.pot);
  el('knob-readout').textContent = `f = ${circuit.pot.wiperFraction.toFixed(3)} · A–W ${fmt(Number(aw.toPrecision(5)))} Ω · W–B ${fmt(Number(wb.toPrecision(5)))} Ω (each includes 0.1 Ω end)`;
  el('tog-closed').setAttribute('aria-pressed', String(circuit.toggle.closed)); el('tog-open').setAttribute('aria-pressed', String(!circuit.toggle.closed));
  (el('supply') as HTMLInputElement).value = String(circuit.supplyVolts); (el('rtot') as HTMLInputElement).value = String(circuit.pot.totalOhms); (el('rs') as HTMLInputElement).value = String(circuit.seriesOhms);
}
function paint(): void {
  paintPresets(); paintControls();
  const m = speedMultiplier(); el('rate-readout').textContent = `${m.toFixed(2)}× · ${wallSecondsFor(m).toFixed(0)} s for the run`;
  const f = solverFrame, c = presented ?? circuit, r = f ? controlsReading(f, c) : null;
  el('play').textContent = paused ? 'Run' : 'Pause'; el('replay').hidden = !(playback && playback.atHorizon);
  const set = (id: string, text: string) => { el(id).textContent = text; };
  if (f && r) {
    el('headline').innerHTML = `<div><small>LED</small><strong>${(f.ledAmps * 1e3).toFixed(2)} mA · ${(r.brightness * 100).toFixed(0)}%</strong><em>current, and emission drive of 30 mA</em></div>`
      + `<div><small>WIPER</small><strong>${f.wiperVolts.toFixed(2)} V</strong><em>loaded; the unloaded formula would say ${r.unloadedWiperVolts.toFixed(2)} V</em></div>`;
    set('r-sw', r.switchClosed ? 'CLOSED' : 'OPEN'); set('r-vw', `${f.wiperVolts.toFixed(3)} V`); set('r-vu', `${r.unloadedWiperVolts.toFixed(3)} V`);
    set('r-legs', `${fmt(Number(r.legAwOhms.toPrecision(5)))} / ${fmt(Number(r.legWbOhms.toPrecision(5)))} Ω`);
    set('r-il', siUnit(f.ledAmps, 'A')); set('r-vl', `${r.ledVolts.toFixed(3)} V`); set('r-em', `${(r.brightness * 100).toFixed(1)}%`);
    set('r-p', `${(r.potWatts * 1e3).toFixed(1)} / ${(r.seriesWatts * 1e3).toFixed(1)} / ${(r.ledWatts * 1e3).toFixed(1)} mW`);
    const state = f.state === 'before-start' ? 'Operating point · 0 s' : f.state === 'at-horizon' ? 'End of solved run' : f.state === 'paused' ? 'Paused' : 'Playing';
    el('scene-time').textContent = `${state} · ${siUnit(f.timeSeconds, 's')} of ${siUnit(playback!.horizonSeconds, 's')}${f.onEdge ? ' · inside the toggle edge' : ''}`;
    el('clock').textContent = `Requested ${f.requestedTimeSeconds.toExponential(4)} s · represented ${f.timeSeconds.toExponential(4)} s · grid median ${siUnit(playback!.source.actualStepSeconds.median, 's')} · ${playback!.source.engine}`;
  } else {
    el('headline').innerHTML = `<div><small>LED</small><strong>—</strong><em>${fault ? 'not solved' : 'solving'}</em></div>`;
    for (const id of ['r-sw', 'r-vw', 'r-vu', 'r-legs', 'r-il', 'r-vl', 'r-em', 'r-p']) set(id, '—');
    el('scene-time').textContent = '';
  }
  el('scale-notes').textContent = `Scales are the extrema of THIS solved run: ruler ${fmt(bounds.lo)}…${fmt(bounds.hi)} V, shared current scale ${siUnit(bounds.fullI, 'A')}. Marker height = voltage; the knob's angle and the wiper's place on the track are f; body positions are layout only.`;
  if (stage) stage.applySpec(controlsSpec());
}

let knobTimer: ReturnType<typeof setTimeout> | null = null;
function setCircuit(next: ControlsDescription, why: string): void {
  try { validateControls(next); circuit = next; activePreset = null; el('notice').textContent = ''; void resolveCircuit(why); }
  catch (e) { el('notice').textContent = String(e instanceof Error ? e.message : e); }
  paint();
}
function choosePreset(p: ControlsPreset): void { activePreset = p; circuit = p.build(); el('notice').textContent = ''; void resolveCircuit(`${p.label}: solving. `); paint(); }
el('knob').addEventListener('input', () => {
  const f = Math.min(1, Math.max(0, Number((el('knob') as HTMLInputElement).value) / 1000));
  circuit = { ...circuit, pot: { ...circuit.pot, wiperFraction: f } }; activePreset = null; paintControls();
  // A NEW SOLVE PER KNOB POSITION, debounced so a drag submits the position it settles on; the
  // client supersedes anything still pending. The old picture stays until the new run is adopted.
  if (knobTimer) clearTimeout(knobTimer);
  knobTimer = setTimeout(() => { knobTimer = null; setCircuit(circuit, `Knob at f = ${f.toFixed(2)}: new solve, new run. `); }, 120);
});
el('tog-closed').onclick = () => setCircuit({ ...circuit, toggle: { ...circuit.toggle, closed: true } }, 'Toggle closed: new solve, new run. ');
el('tog-open').onclick = () => setCircuit({ ...circuit, toggle: { ...circuit.toggle, closed: false } }, 'Toggle open: new solve, new run. ');
el('controls-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const n = (id: string) => Number((el(id) as HTMLInputElement).value);
  setCircuit({ ...circuit, supplyVolts: n('supply'), pot: { ...circuit.pot, totalOhms: n('rtot') }, seriesOhms: n('rs') }, 'Re-solving your circuit. ');
});
const halted = (): boolean => !playback || !!fault || !!displayFault || busy;
el('play').onclick = () => { if (halted()) return; if (playback!.atHorizon) playback!.reset(); paused = !paused; paint(); };
el('step').onclick = () => { if (halted()) return; paused = true; playback!.paused = false; playback!.stepOne(); playback!.paused = true; solverFrame = playback!.frame(); paint(); };
el('restart').onclick = () => { if (halted()) return; paused = true; playback!.reset(); solverFrame = playback!.frame(); paint(); };
el('replay').onclick = () => { if (halted()) return; playback!.reset(); paused = false; paint(); };
el('rate').addEventListener('input', () => { if (playback && presented) playback.playbackRate = presented.stopSeconds / wallSecondsFor(speedMultiplier()); paint(); });
el('save').onclick = () => {
  const url = URL.createObjectURL(new Blob([encodeControlsDoc(circuit)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'flux-controls-circuit.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('notice').textContent = 'Saved the circuit description. The running state is not included.';
};
function adoptLoaded(text: string, name: string): void {
  try { circuit = decodeControlsDoc(text); activePreset = CONTROLS_PRESETS.find((p) => JSON.stringify(p.build()) === JSON.stringify(circuit)) ?? null; el('notice').textContent = `Loaded ${name}.`; void resolveCircuit('Solving the loaded circuit. '); }
  catch (e) { el('notice').textContent = `Could not load: ${e instanceof Error ? e.message : e}`; }
  paint();
}
el('load').addEventListener('change', async () => { const input = el('load') as HTMLInputElement, file = input.files?.[0]; if (!file) return; adoptLoaded(await file.text(), file.name); input.value = ''; });
el('reset-view').onclick = () => stage?.refit();
el('labels-on').addEventListener('change', () => stage?.setLabelsVisible((el('labels-on') as HTMLInputElement).checked));

function startStage(): void {
  try {
    const built = new PotentialScene(el('stage3d'), el('stagelabels'));
    el('graphics-status').hidden = true; el('stage').hidden = false; built.resize(); built.refit(); stage = built;
    (window as unknown as Record<string, unknown>).__controlsstage = stage;
  } catch (error) {
    console.error('Controls 3D initialization failed', error); stage = null; el('stage').hidden = true;
    const status = el('graphics-status'); status.hidden = false; status.textContent = `The 3D scene could not start (${error instanceof Error ? error.message : String(error)}). Every reading below is still live.`;
  }
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
    if (playback && !busy && !fault && !displayFault) {
      playback.paused = paused; playback.advance(dt); solverFrame = playback.frame();
      if (!paused && now - lastPaint > 80) { paint(); lastPaint = now; }
      if (playback.atHorizon && !paused) { paused = true; paint(); }
    }
    const showDt = dt * speedMultiplier();
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, number>;
      w.__controlsAnimSeconds = (w.__controlsAnimSeconds ?? 0) + (animating ? showDt : 0);
      if ((window as unknown as Record<string, unknown>).__controlsBreakDisplayOnce) { (window as unknown as Record<string, unknown>).__controlsBreakDisplayOnce = false; throw new Error('injected display failure'); }
    }
    stage?.render(animating ? showDt : 0);
  } catch (e) {
    console.error('Controls display fault', e); paused = true; displayFault = e instanceof Error ? e.message : String(e);
    try { paintStatus(null); } catch { /* the banner itself failed; the console has the fault */ }
  }
}
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.__controlsSeek = (t: number) => { if (!playback) return false; paused = true; playback.seek(t); solverFrame = playback.frame(); paint(); return true; };
  w.__controlsPaint = () => paint();
  w.__controlsDescribe = () => ({ preset: activePreset?.id ?? null, circuit, presented, bounds, frame: solverFrame, fault, busy });
  w.__controlsChoose = (id: string) => { const p = controlsPresetById(id); if (p) choosePreset(p); return !!p; };
  w.__controlsKnob = (f: number) => { (el('knob') as HTMLInputElement).value = String(Math.round(f * 1000)); el('knob').dispatchEvent(new Event('input')); };
  w.__controlsSaveText = () => encodeControlsDoc(circuit);
  w.__controlsLoadText = (text: string) => adoptLoaded(text, 'probe');
  w.__controlsFailNext = (reason: string) => { if (!spice) spice = new SpiceClient(); spice.failNextForTesting(reason); };
  w.__controlsResolve = () => { void resolveCircuit('Probe re-solve. '); };
  w.__controlsRebuildStage = () => { stage?.buildFromSpec(controlsSpec()); };
  w.__controlsPaintStage = () => { if (stage) stage.applySpec(controlsSpec()); };
  w.__controlsBreakDisplay = () => { w.__controlsBreakDisplayOnce = true; };
  w.__controlsState = () => ({ paused, fault, displayFault, busy, banner: el('stage-fault').hidden ? null : el('stage-fault').textContent, labels: stage?.labelsVisible });
}
choosePreset(CONTROLS_PRESETS[0]);
requestAnimationFrame(frame);
