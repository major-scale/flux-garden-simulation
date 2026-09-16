/**
 * A TRANSISTOR AND A LAMP — the second circuit on the same workstation.
 *
 * What is here is the page: a form, four demonstrations, a transport, the readouts, and the
 * scene spec. What is NOT here is any physics: the trajectory comes from ngspice through
 * `SpiceClient.solveLamp`, is validated in `lamp-transient.ts`, read by `lamp.ts` in the model,
 * and played by the same cursor the RLC page uses. Nothing in this file computes a current.
 *
 * It reuses the RLC page's stylesheet, scene, solver client, playback transport and speed
 * control on purpose: Peter asked for the same lit bench, stable bodies, shared voltage
 * markers and the slow slider, and Astra's condition was "no disconnected aesthetic or generic
 * editor". The root element keeps the id `rc-app` for that reason.
 */
import './rc.css';
import './style.css';
import { PotentialScene, type SceneSpec, type BranchSpec, type TerraceSpec } from './potential-scene';
import { SpiceClient, Superseded } from '../model/spice/client';
import { LampPlayback, type LampFrame } from '../model/spice/lamp-playback';
import type { LampTransient } from '../model/spice/lamp-transient';
import { lampReading, lampDomain, type LampReading } from '../model/lamp';
import { LAMP_PRESETS, lampPresetById, type LampPreset } from '../model/lamp-presets';
import { validateLamp, type LampDescription } from '../model/spice/lamp-netlist';
import { encodeLampDoc, decodeLampDoc } from '../model/lamp-doc';
import { speedFromSlider, wallSecondsFor } from './transport';
import { fmt, siUnit } from './rc-flow';
import { frameSeconds } from '../model/rc-driver';

const root = document.getElementById('rc-app')!;
root.innerHTML = `
<header><span><a href="/rc.html">← RLC · two ways to store, and what a diode decides</a> · <a href="/motor.html">A motor lifts a weight →</a> · <a href="/controls.html">A knob, a switch and a light →</a></span><span>FLUX GARDEN / TRANSISTOR</span></header>
<section class="intro"><p class="eyebrow">ONE CONTROL, ONE LOAD</p><h1>The supply powers the lamp. The gate only decides.</h1>
<p>A transistor lets a small voltage decide a large current. The gate is a capacitor: it takes a little charge while the voltages at its terminals change — its own, and the drain's — and none once they are still. The lamp's current comes from the supply, never from the gate. <a href="#model-notes">The model, and what it does not claim &rarr;</a></p></section>
<div class="layout"><aside><h2>Your circuit</h2>
<form id="lamp-form">
<label>Supply · V<input id="supply" type="number" value="12" step="any" min="0" max="100" required></label>
<label>Lamp resistance · Ω<input id="lamp-ohms" type="number" value="24" step="any" min="0.01" max="10000000" required></label>
<label>Gate resistor · Ω<input id="gate-ohms" type="number" value="1000" step="any" min="1" max="10000000" required></label>
<label>Threshold V<sub>TO</sub> · V<input id="vto" type="number" value="2" step="any" min="-10" max="10" required></label>
<label>Transconductance K<sub>P</sub> · A/V²<input id="kp" type="number" value="0.00002" step="any" min="0.000000001" max="10" required></label>
<button type="submit">Apply &amp; re-solve</button></form>
<p class="hint">Applying re-solves the whole run from its operating point and restarts it. The gate programme stays as the demonstration set it.</p>
<div class="actions"><button id="save">Save circuit</button><label class="file">Load circuit<input id="load" type="file" accept=".json,application/json"></label></div>
<p class="hint">Saved files contain the circuit description, not the running state.</p>
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
<div>Transistor region<output id="r-region">—</output></div>
<div class="warm">Lamp brightness · of ideal V²/R<output id="r-bright">—</output></div>
<div class="cool">V<sub>GS</sub> · gate to source<output id="r-vgs">—</output></div>
<div class="cool">V<sub>DS</sub> · drain to source<output id="r-vds">—</output></div>
<div class="warm">Lamp current · from the supply<output id="r-id">—</output></div>
<div>Gate current · into the gate<output id="r-ig">—</output></div>
<div class="warm">Lamp power<output id="r-plamp">—</output></div>
<div>Drain-terminal power · V<sub>DS</sub>·I<sub>D</sub><output id="r-pdrain">—</output></div>
</div>
<p class="hint" id="solver-status"></p>
<p class="hint" id="scene-time"></p>
<p id="graphics-status" role="status" hidden></p>
<details id="model-notes"><summary>The model, and what it does not claim</summary>
<p class="hint">The transistor is an <b>illustrative level-1 (Shichman–Hodges) n-channel MOSFET</b> — <span id="model-values"></span>, bulk tied to source — not a manufactured part. It has no subthreshold conduction, no velocity saturation and no temperature. Its body diode exists in the model but is never forward-biased here: the run is refused if the drain ever falls below the source by more than a millivolt, which scopes reverse conduction as <i>unsupported</i>, not impossible.</p>
<p class="hint">The gate current shown is the model's own gate-charging current through the gate resistor (<span id="model-rg"></span>), read from the solver. It flows whenever a terminal voltage at the gate's capacitances changes — the gate's own, and through C<sub>gd</sub> the drain's — not only when the gate voltage does. Those capacitances are ngspice's Meyer model, which is <b>not charge-conserving</b> (ngspice manual §11.2.1), so the picture makes no quantitative claim about gate energy or switching loss — only that the control path carries current while terminal voltages change, and none once they are still.</p>
<p class="hint">The lamp is a <b>constant-resistance indicator</b>: its brightness is its dissipation (V<sub>supply</sub>−V<sub>drain</sub>)·I<sub>D</sub> as a fraction of the <b>ideal zero-drop maximum</b> V<sub>supply</sub>²/R, mapped linearly to a rendering parameter (emissive intensity and a point light). That is a drawing rule: perceived brightness is not calibrated to it. No tungsten thermal dynamics, no LED behaviour, no lumens. "Drain-terminal power" is V<sub>DS</sub>·I<sub>D</sub> at the terminals; while charge is moving in the gate it is not guaranteed to be instantaneous heat, and no transistor temperature is invented.</p>
<p class="hint">Verified: Shichman–Hodges against the solved drain current on electrically settled plateaus, the gate current against (V<sub>control</sub>−V<sub>gate</sub>)/R<sub>G</sub> at every sample, three-terminal KCL at every sample, and native ngspice-45.2 against the WASM build the page runs — <code>tools/lamp-spice-verify.mjs</code>. Playback speed re-times the solved trajectory and touches no number in it.</p>
<p class="hint" id="scale-notes"></p>
</details>
</section>
</article></div>`;

const el = (id: string) => document.getElementById(id)!;

// ---------------------------------------------------------------- state
let circuit: LampDescription = LAMP_PRESETS[0].build();
let activePreset: LampPreset | null = LAMP_PRESETS[0];
let spice: SpiceClient | null = null;
let playback: LampPlayback | null = null;
let presented: LampDescription | null = null;
let solverFrame: LampFrame | null = null;
let fault: string | null = null;
let busy = false;
let paused = true;
let generation = 0;
let stage: PotentialScene | null = null;
/**
 * DISPLAY SCALES ARE THE EXTREMA OF THE RUN BEING PLAYED, captured once when it is adopted and
 * held for its life — as the RLC page does. Voltage span for the ruler; the drain current for
 * the shared current scale; the gate current for the gate path's OWN scale (microamps against
 * half an amp would otherwise be invisible); the drain-terminal power for the package tint.
 */
let bounds = { lo: 0, hi: 12, fullI: 1e-12, gateFull: 1e-12, heatFull: 1e-12 };

function speedMultiplier(): number { return speedFromSlider(Number((el('rate') as HTMLInputElement).value)); }

function captureBounds(t: LampTransient): void {
  let lo = 0, hi = 0, fullI = 0, gateFull = 0, heatFull = 0;
  for (let k = 0; k < t.times.length; k++) {
    for (const v of [t.supplyVolts[k], t.drainVolts[k], t.gateVolts[k], t.controlVolts[k]]) {
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    fullI = Math.max(fullI, Math.abs(t.drainAmps[k]), Math.abs(t.sourceAmps[k]));
    gateFull = Math.max(gateFull, Math.abs(t.gateAmps[k]));
    heatFull = Math.max(heatFull, t.drainVolts[k] * t.drainAmps[k]);
  }
  bounds = { lo, hi: Math.max(hi, lo + 1e-9), fullI: Math.max(fullI, 1e-12),
    gateFull: Math.max(gateFull, 1e-12), heatFull: Math.max(heatFull, 1e-12) };
}

// ---------------------------------------------------------------- solving
async function resolveCircuit(why: string): Promise<void> {
  if (!spice) spice = new SpiceClient();
  const mine = ++generation;
  busy = true; fault = null; paintStatus(why);
  try {
    validateLamp(circuit);
    const transient = await spice.solveLamp(circuit);
    if (mine !== generation) return;
    // THE SUPPORTED DOMAIN, checked against the trajectory, not the inputs.
    const domain = lampDomain(transient);
    if (!domain.ok) throw new Error(domain.reason!);
    const rate = circuit.stopSeconds / wallSecondsFor(speedMultiplier());
    captureBounds(transient);
    if (playback) playback.adopt(transient, rate); else playback = new LampPlayback(transient, rate);
    playback.replayFromRest = false;
    presented = circuit;
    solverFrame = playback.frame();
    paused = true;
    busy = false;
    displayFault = null;
    paintStatus(`Solved. ${transient.times.length} samples over ${siUnit(transient.stopSeconds, 's')}. Press Run.`);
  } catch (e) {
    if (mine !== generation) return;
    if (e instanceof Superseded) return;
    busy = false;
    playback = null; solverFrame = null; presented = null;
    fault = String(e instanceof Error ? e.message : e);
    paintStatus(null);
  }
  if (mine === generation) paint();
}

function paintStatus(message: string | null): void {
  const node = el('solver-status');
  // THE FAULT IS ON THE STAGE, not only in a status line. When the solve fails the picture that
  // remains is geometry with every value withdrawn — labels say "unsolved", the cues are hidden,
  // the readouts say "—" — and a banner over the scene says why, until a valid solve replaces it.
  const banner = el('stage-fault');
  banner.hidden = !fault && !displayFault;
  banner.textContent = fault ? `NOT DRIVEN — the solve failed: ${fault}` : displayFault ? `DISPLAY FAULT — the picture stopped: ${displayFault}` : '';
  if (fault) { node.textContent = `Solver fault — the scene is NOT being driven. ${fault}`; return; }
  node.textContent = (busy ? 'Solving… ' : '') + (message ?? '');
}
/** A render/paint exception, latched and SHOWN until the next successful paint after a re-solve. */
let displayFault: string | null = null;

// ---------------------------------------------------------------- the scene spec
const SUP = 'lp-supply', DRN = 'lp-drain', SRC = 'lp-src', GATE = 'lp-gate', CTRL = 'lp-ctrl', GND = 'lp-gnd';

function lampSpec(): SceneSpec {
  const f = solverFrame;
  const c = presented ?? circuit;
  const known = f !== null;
  const r: LampReading | null = f && playback
    ? lampReading(f, { lampOhms: playback.source.lampOhms, nominalSupplyVolts: playback.source.nominalSupplyVolts, mosfet: playback.source.mosfet })
    : null;
  const v = (x: number | undefined) => x ?? 0;
  // THE DECK. Positions are layout and encode nothing; the ground rail sits below and in front
  // as on the RLC page, so every return is a lane in front of the run rather than a crossing.
  const terraces: TerraceSpec[] = [
    { id: SUP, label: known ? 'supply +' : 'supply + · unsolved', volts: known ? f!.supplyVolts : c.supplyVolts, anchor: { x: -9.5, z: -1.2 } },
    { id: DRN, label: known ? 'lamp → drain' : 'lamp → drain · unsolved', volts: known ? f!.drainVolts : c.supplyVolts, anchor: { x: -1.5, z: -1.2 } },
    { id: SRC, label: 'source terminal · 0 V probe', volts: known ? f!.drainVolts * 0 : 0, anchor: { x: 6.0, z: -1.2 } },
    { id: GATE, label: known ? 'gate' : 'gate · unsolved', volts: known ? f!.gateVolts : v(0), anchor: { x: 3.2, z: 2.0 } },
    { id: CTRL, label: known ? 'gate drive' : 'gate drive · unsolved', volts: known ? f!.controlVolts : v(0), anchor: { x: -4.8, z: 2.0 } },
    { id: GND, label: 'ground', volts: 0, isRef: true, anchor: { x: -1.5, y: -2.1, z: 3.6 } },
  ];
  // A GATE CURRENT BELOW A MILLIONTH OF ITS OWN SCALE IS PRINTED AS ZERO. On a settled plateau
  // the solver returns ±1e-16 A of numerical residue; printing "-7.763e-16 A" on the label would
  // present solver noise as a reading. The value used for the cue is untouched (√(|i|/scale) of
  // 1e-12 is invisible anyway); only the printed figure is floored, and the floor is stated here.
  const Id = known ? f!.drainAmps : null, Is = known ? f!.sourceAmps : null;
  const IgRaw = known ? f!.gateAmps : null;
  const Ig = IgRaw === null ? null : Math.abs(IgRaw) < 1e-6 * bounds.gateFull ? 0 : IgRaw;
  const region = r ? r.region.toUpperCase() : '';
  void bounds.heatFull;
  const branches: BranchSpec[] = [
    { id: 'lp-Vdd', label: `supply ${fmt(c.supplyVolts)} V`, kind: 'source', from: GND, to: SUP, current: Id },
    { id: 'lp-lamp', kind: 'lamp', from: SUP, to: DRN, current: Id,
      // COMPACT, STABLE-WIDTH BODY LABELS; the detail lives in the readouts under the stage.
      label: r ? `lamp ${siUnit(c.lampOhms, 'Ω')} · ${(r.brightness * 100).toFixed(0).padStart(3, ' ')}%` : `lamp ${siUnit(c.lampOhms, 'Ω')}`,
      power: r ? r.lampWatts : null, fullPower: c.supplyVolts * c.supplyVolts / c.lampOhms },
    { id: 'lp-M', kind: 'mosfet', from: DRN, to: SRC, current: Id, sourceCurrent: Is,
      gateTerrace: GATE, gateCurrent: Ig, gateFullScaleA: bounds.gateFull,
      label: r ? `MOSFET · ${region}` : 'MOSFET · not yet solved' },
    { id: 'lp-ret', label: 'source return', kind: 'wire', from: SRC, to: GND, current: Is },
    { id: 'lp-RG', kind: 'gate', from: CTRL, to: GATE, current: Ig, fullScaleA: bounds.gateFull,
      label: `gate resistor ${siUnit(c.gateOhms, 'Ω')} · own scale` },
    { id: 'lp-Vg', label: 'gate drive', kind: 'source', from: GND, to: CTRL, current: Ig, fullScaleA: bounds.gateFull },
  ];
  return {
    deck: { rulerX: -12.2, viewDir: [0.04, 0.62, 1] },
    fixedSpan: { lo: bounds.lo, hi: bounds.hi },
    fixedFullI: bounds.fullI,
    terraces, branches, drawStores: false,
  };
}

// ---------------------------------------------------------------- painting
function paintPresets(): void {
  const host = el('preset-buttons');
  if (!host.children.length) {
    for (const p of LAMP_PRESETS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = p.label; b.dataset.preset = p.id;
      b.onclick = () => choosePreset(p);
      host.appendChild(b);
    }
  }
  for (const b of host.children) (b as HTMLButtonElement).setAttribute('aria-pressed', String(activePreset?.id === (b as HTMLElement).dataset.preset));
  el('preset-blurb').textContent = activePreset ? activePreset.blurb
    : 'A circuit of your own numbers, on the gate programme of the last demonstration.';
}

/**
 * WHAT THE REGION MEANS HERE, conditionally — from this snapshot's own numbers, not a slogan.
 * Triode is "Vds below the overdrive", which is a low-resistance channel only when Vgs is well
 * above threshold; saturation is "current set by Vgs", and how much of the supply the transistor
 * holds is whatever Vds says. Astra: no universal "fully on" / "holds the whole supply".
 */
function regionNote(r: LampReading): string {
  const vov = r.gateSourceVolts - (playback?.source.mosfet.vto ?? 0);
  if (r.region === 'off') return `Vgs ${r.gateSourceVolts.toFixed(2)} V is at or below threshold: no channel, no lamp current`;
  if (r.region === 'triode') return `Vds ${r.drainSourceVolts.toFixed(2)} V is below the overdrive ${vov.toFixed(2)} V: a channel of about ${(r.drainSourceVolts / Math.max(r.drainAmps, 1e-12)).toFixed(2)} Ω`;
  return `Vds ${r.drainSourceVolts.toFixed(2)} V is above the overdrive ${vov.toFixed(2)} V: the current is set by Vgs, and ${r.drainSourceVolts.toFixed(2)} V of the supply sits across the transistor`;
}

function paintModelNotes(): void {
  const m = circuit.mosfet;
  el('model-values').textContent = `VTO ${fmt(m.vto)} V, KP ${siUnit(m.kp, 'A/V²')}, λ ${fmt(m.lambda)}, W/L ${siUnit(m.widthM, 'm')} / ${siUnit(m.lengthM, 'm')}`
    + (activePreset ? '' : ' (your values)');
  el('model-rg').textContent = siUnit(circuit.gateOhms, 'Ω');
}

function paintSpeed(): void {
  const m = speedMultiplier(), wall = wallSecondsFor(m);
  el('rate-readout').textContent = `${m.toFixed(2)}× · ${wall.toFixed(0)} s for the run`;
}

function paint(): void {
  paintPresets(); paintSpeed(); paintModelNotes();
  const f = solverFrame;
  const r = f && playback
    ? lampReading(f, { lampOhms: playback.source.lampOhms, nominalSupplyVolts: playback.source.nominalSupplyVolts, mosfet: playback.source.mosfet })
    : null;
  el('play').textContent = paused ? 'Run' : 'Pause';
  el('replay').hidden = !(playback && playback.atHorizon);
  const head = el('headline');
  if (r) {
    head.innerHTML = `<div><small>LAMP</small><strong>${r.lampWatts.toFixed(3)} W · ${(r.brightness * 100).toFixed(1)}%</strong><em>of the ideal ${fmt(r.idealFullWatts)} W (V²/R, zero drop)</em></div>`
      + `<div><small>TRANSISTOR</small><strong>${r.region.toUpperCase()}</strong><em>${regionNote(r)}</em></div>`;
  } else head.innerHTML = `<div><small>LAMP</small><strong>—</strong><em>${fault ? 'not solved' : 'solving'}</em></div>`;
  const set = (id: string, text: string) => { el(id).textContent = text; };
  set('r-region', r ? r.region.toUpperCase() : '—');
  set('r-bright', r ? `${(r.brightness * 100).toFixed(1)}% · ${r.lampWatts.toFixed(3)} W of ${fmt(r.idealFullWatts)} W` : '—');
  set('r-vgs', r ? `${r.gateSourceVolts.toFixed(3)} V` : '—');
  set('r-vds', r ? `${r.drainSourceVolts.toFixed(3)} V` : '—');
  set('r-id', r ? siUnit(r.drainAmps, 'A') : '—');
  set('r-ig', r ? siUnit(r.gateAmps, 'A') : '—');
  set('r-plamp', r ? `${r.lampWatts.toFixed(4)} W` : '—');
  set('r-pdrain', r ? `${r.drainTerminalWatts.toFixed(4)} W` : '—');
  if (playback && f) {
    const state = f.state === 'before-start' ? 'At the operating point · 0 s' : f.state === 'at-horizon' ? 'End of solved run' : f.state === 'paused' ? 'Paused' : 'Playing';
    el('scene-time').textContent = `${state} · ${siUnit(f.timeSeconds, 's')} of ${siUnit(playback.horizonSeconds, 's')}`
      + (f.onEdge ? ' · inside the gate edge' : '') + (playback.replays ? ` · run ${playback.replays + 1}` : '');
    el('clock').textContent = `Requested ${f.requestedTimeSeconds.toExponential(4)} s · represented ${f.timeSeconds.toExponential(4)} s · grid median ${siUnit(playback.source.actualStepSeconds.median, 's')} · ${playback.source.engine}`;
  } else el('scene-time').textContent = '';
  el('scale-notes').textContent = `Scales are the extrema of THIS solved run: ruler ${fmt(bounds.lo)}…${fmt(bounds.hi)} V, shared current scale ${siUnit(bounds.fullI, 'A')}, gate path on its own ${siUnit(bounds.gateFull, 'A')} scale (printed on its label), package tint against the run's peak drain-terminal power ${fmt(bounds.heatFull)} W. Transport cues fade with √(|i|/scale), no floor. Marker height = voltage on one shared ruler; body positions are layout only.`;
  if (stage) stage.applySpec(lampSpec());
}

// ---------------------------------------------------------------- actions
function choosePreset(p: LampPreset): void {
  activePreset = p; circuit = p.build();
  (el('supply') as HTMLInputElement).value = String(circuit.supplyVolts);
  (el('lamp-ohms') as HTMLInputElement).value = String(circuit.lampOhms);
  (el('gate-ohms') as HTMLInputElement).value = String(circuit.gateOhms);
  (el('vto') as HTMLInputElement).value = String(circuit.mosfet.vto);
  (el('kp') as HTMLInputElement).value = String(circuit.mosfet.kp);
  el('notice').textContent = '';
  void resolveCircuit(`${p.label}: solving. `);
  paint();
}

el('lamp-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  try {
    const n = (id: string) => Number((el(id) as HTMLInputElement).value);
    const next: LampDescription = { ...circuit, supplyVolts: n('supply'), lampOhms: n('lamp-ohms'), gateOhms: n('gate-ohms'),
      mosfet: { ...circuit.mosfet, vto: n('vto'), kp: n('kp') } };
    validateLamp(next);
    circuit = next; activePreset = null;
    el('notice').textContent = '';
    void resolveCircuit('Re-solving your circuit. ');
  } catch (e) { el('notice').textContent = String(e instanceof Error ? e.message : e); }
  paint();
});
/**
 * NOTHING MOVES UNDER A FAULT BANNER. A solver fault drops the playback, so it cannot move; a
 * DISPLAY fault keeps the playback (the trajectory is fine, the picture is not) — so the guard
 * has to be explicit here, or Run would resume motion under a banner saying the picture stopped.
 * Astra's catch. Cleared only by a successful re-solve.
 */
const halted = (): boolean => !playback || !!fault || !!displayFault || busy;
el('play').onclick = () => { if (halted()) return; if (playback!.atHorizon) playback!.reset(); paused = !paused; paint(); };
el('step').onclick = () => { if (halted()) return; paused = true; playback!.paused = false; playback!.stepOne(); playback!.paused = true; solverFrame = playback!.frame(); paint(); };
el('restart').onclick = () => { if (halted()) return; paused = true; playback!.reset(); solverFrame = playback!.frame(); paint(); };
el('replay').onclick = () => { if (halted()) return; playback!.reset(); paused = false; paint(); };
el('rate').addEventListener('input', () => {
  if (playback && presented) playback.playbackRate = presented.stopSeconds / wallSecondsFor(speedMultiplier());
  paintSpeed();
});
el('save').onclick = () => {
  const url = URL.createObjectURL(new Blob([encodeLampDoc(circuit)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'flux-lamp-circuit.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('notice').textContent = 'Saved the circuit description. The running state is not included.';
};
/** The ONE load path: the file input and the DEV round-trip probe both go through here. */
function adoptLoaded(text: string, name: string): void {
  try {
    circuit = decodeLampDoc(text);
    activePreset = LAMP_PRESETS.find((p) => JSON.stringify(p.build()) === JSON.stringify(circuit)) ?? null;
    (el('supply') as HTMLInputElement).value = String(circuit.supplyVolts);
    (el('lamp-ohms') as HTMLInputElement).value = String(circuit.lampOhms);
    (el('gate-ohms') as HTMLInputElement).value = String(circuit.gateOhms);
    (el('vto') as HTMLInputElement).value = String(circuit.mosfet.vto);
    (el('kp') as HTMLInputElement).value = String(circuit.mosfet.kp);
    el('notice').textContent = `Loaded ${name}.`;
    void resolveCircuit('Solving the loaded circuit. ');
  } catch (e) { el('notice').textContent = `Could not load: ${e instanceof Error ? e.message : e}`; }
  paint();
}
el('load').addEventListener('change', async () => {
  const input = el('load') as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  adoptLoaded(await file.text(), file.name);
  input.value = '';
});
el('reset-view').onclick = () => stage?.refit();
el('labels-on').addEventListener('change', () => stage?.setLabelsVisible((el('labels-on') as HTMLInputElement).checked));

// ---------------------------------------------------------------- the stage and the loop
function startStage(): void {
  try {
    const built = new PotentialScene(el('stage3d'), el('stagelabels'));
    el('graphics-status').hidden = true; el('stage').hidden = false;
    built.resize(); built.refit();
    stage = built;
    (window as unknown as Record<string, unknown>).__lampstage = stage;
  } catch (error) {
    console.error('Lamp 3D initialization failed', error);
    stage = null;
    el('stage').hidden = true;
    const status = el('graphics-status'); status.hidden = false;
    status.textContent = `The 3D scene could not start (${error instanceof Error ? error.message : String(error)}). Every reading below is still live.`;
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
    const dt = frameSeconds(now, last);
    last = now;
    if (displayFault) { paused = true; }                 // latched: no advance, no motion
    const animating = !!playback && !paused && !playback.atHorizon && !busy && !fault && !displayFault;
    if (playback && !busy && !fault && !displayFault) {
      playback.paused = paused;
      playback.advance(dt);
      solverFrame = playback.frame();
      if (!paused && now - lastPaint > 80) { paint(); lastPaint = now; }
      if (playback.atHorizon && !paused) { paused = true; paint(); }
    }
    // The illustrative animation slows with the playback: time only, no amplitude.
    const showDt = dt * speedMultiplier();
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, number>;
      w.__lampAnimSeconds = (w.__lampAnimSeconds ?? 0) + (animating ? showDt : 0);
    }
    if (import.meta.env.DEV && (window as unknown as Record<string, unknown>).__lampBreakDisplayOnce) {
      (window as unknown as Record<string, unknown>).__lampBreakDisplayOnce = false;
      throw new Error('injected display failure');
    }
    stage?.render(animating ? showDt : 0);
  } catch (e) {
    // LATCHED AND VISIBLE. Console-and-pause alone left a viewer looking at a frozen picture with
    // no statement on it; the banner says the display stopped and why, and only a re-solve clears it.
    console.error('Lamp display fault', e);
    paused = true;
    displayFault = e instanceof Error ? e.message : String(e);
    try { paintStatus(null); } catch { /* the banner itself failed; the console has the fault */ }
  }
}

if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.__lampSeek = (t: number) => { if (!playback) return false; paused = true; playback.seek(t); solverFrame = playback.frame(); paint(); return true; };
  w.__lampPaint = () => paint();
  w.__lampDescribe = () => ({ preset: activePreset?.id ?? null, circuit, presented, bounds, frame: solverFrame, fault, busy });
  w.__lampChoose = (id: string) => { const p = lampPresetById(id); if (p) choosePreset(p); return !!p; };
  w.__lampSaveText = () => encodeLampDoc(circuit);
  w.__lampLoadText = (text: string) => adoptLoaded(text, 'probe');
  w.__lampFailNext = (reason: string) => { if (!spice) spice = new SpiceClient(); spice.failNextForTesting(reason); };
  w.__lampResolve = () => { void resolveCircuit('Probe re-solve. '); };
  w.__lampRebuildStage = () => { stage?.buildFromSpec(lampSpec()); };
  w.__lampBreakDisplay = () => { w.__lampBreakDisplayOnce = true; };
  w.__lampState = () => ({ paused, fault, displayFault, busy, banner: el('stage-fault').hidden ? null : el('stage-fault').textContent });
  w.__lampPaintStage = () => { if (stage) stage.applySpec(lampSpec()); };
}

choosePreset(LAMP_PRESETS[0]);
requestAnimationFrame(frame);
