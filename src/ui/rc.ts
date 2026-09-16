import { ResistorLens } from './resistor-lens';
import { flowExplanation, fmt, siUnit } from './rc-flow';
import { speedFromSlider, wallSecondsFor } from './transport';
import { gaugeReading } from './quantity-gauge';
import { RC_DT, RcClock, decodeRc } from '../model/rc';
import {
  RLC_DEFAULT, RLC_LIMITS, RlcExperiment, type RlcInputs,
} from '../model/rlc';
import { RcDriver, frameSeconds } from '../model/rc-driver';
import { PotentialScene, MAGNETIC_COLOUR, THERMAL_COLOUR, ELECTRIC_COLOUR,
         type SceneSpec, type CoilRender } from './potential-scene';
import { buildCoilPackage, DEFAULT_COIL, type CoilPackage } from '../model/coil-package';
import { primaryDiDt, pickupTerminalVoltage, fluxLinkage, type PickupOrientation } from '../model/pickup';
import { encodeRlcDoc, decodeRlcDoc } from '../model/rlc-doc';
import { SpiceClient, Superseded } from '../model/spice/client';
import { SolvedPlayback, type PlaybackFrame } from '../model/spice/playback';
import type { Transient } from '../model/spice/transient';
import type { CircuitDescription, DiodeSpec, DiodeOrientation } from '../model/spice/netlist';
import { diodeState, diodeExcursion, transientDiodeSamples, type DiodeState }
  from '../model/diode';
import { PRESETS, presetById, DEFAULT_DIODE_PART, type Preset } from '../model/presets';
import {
  EPSILON_0_BASIS, VACUUM, capacitanceOf, gapToSide, interiorField, plateSide,
  type PlateGeometry,
} from '../model/capacitor-geometry';
import './rc.css';
import './style.css';

const root = document.getElementById('rc-app')!;
root.innerHTML = `
<header><span><a href="/electronics.html">DC bench · resistor networks →</a> · <a href="/lamp.html">A transistor and a lamp →</a> · <a href="/motor.html">A motor lifts a weight →</a> · <a href="/controls.html">A knob, a switch and a light →</a> · <a href="/sensors.html">A sensor decides →</a></span><span>FLUX GARDEN / RLC</span></header>
<section class="intro"><p class="eyebrow">THE FIRST ELECTRICAL OSCILLATION</p><h1>Two ways to store, and what a diode decides.</h1>
<p>A capacitor stores energy in an electric field, an inductor in a magnetic one. A diode lets current pass one way only. <a href="#encoding-notes">How to read the scene &amp; the full circuit &rarr;</a></p></section>
<div class="layout"><aside><h2>Your circuit</h2><details class="circuit-settings"><summary>Circuit settings</summary>
<form id="rc-form">
<label>Source voltage · V<input id="voltage" type="number" value="10" step="any" min="-100" max="100" required></label>
<label>Resistance · Ω<input id="resistance" type="number" value="2" step="any" min="1" max="1000000" required></label>
<label>Capacitance · F<input id="capacitance" type="number" value="0.01" step="any" min="0.000001" max="1" required></label>
<label class="coil-mode"><input id="coil-on" type="checkbox" checked> Derive L from coil geometry</label>
<div id="coil-fields">
<label>Turns<input id="coil-turns" type="number" value="40" step="1" min="1" max="400"></label>
<label>Coil radius · mm<input id="coil-radius" type="number" value="20" step="any" min="1" max="200"></label>
<label>Coil length · mm<input id="coil-length" type="number" value="100" step="any" min="1" max="1000"></label>
<label>Wire radius · mm<input id="coil-wire" type="number" value="0.4" step="any" min="0.01" max="10"></label>
<p class="hint" id="coil-readout"></p>
<label class="coil-mode"><input id="pickup-on" type="checkbox" checked> Place a pickup loop</label>
<div id="pickup-fields">
<label>Loop radius · mm<input id="pickup-radius" type="number" value="30" step="any" min="1" max="200"></label>
<label>Distance from coil centre · mm<input id="pickup-sep" type="number" value="60" step="any" min="-500" max="500"></label>
<label>Facing<select id="pickup-orient"><option value="0">0° · facing the coil</option><option value="90">90° · edge-on</option><option value="180">180° · turned over</option></select></label>
<p class="hint" id="pickup-readout"></p>
</div>
</div>
<label>Inductance · H<input id="inductance" type="number" value="1" step="any" min="0.000001" max="1000" required></label>
<label>Initial capacitor voltage · V<input id="initialVoltage" type="number" value="0" step="any" min="-100" max="100" required></label>
<label>Initial current · A<input id="initialCurrent" type="number" value="0" step="any" min="-1000" max="1000" required></label>
<button type="submit">Apply & reset</button></form>
<p class="hint">Applying edits starts a fresh, paused experiment. Heat and work reset; the capacitor starts at the initial voltage above.</p>
</details><section id="geo">
  <h2>Build it from plates</h2>
  <p class="hint">Change the space between the plates, then apply to start a new experiment.</p>
  <label class="switch"><input id="geo-on" type="checkbox"> Derive C from plate geometry</label>
  <div id="geo-fields" hidden>
    <label>Plate side · mm<input id="geo-side" type="number" value="100" step="any" min="0.1"></label>
    <label>Plate separation · mm<input id="geo-gap" type="number" value="1" step="any" min="0.0001"></label>
    <label>Separation · drag it<input id="geo-gap-drag" type="range" min="0" max="1000" value="500"></label>
    <button id="geo-apply">Apply geometry &amp; reset</button>
    <details><summary>Dimensions &amp; model details</summary><div id="geo-readout" class="georead"></div></details>
  </div>
</section>
<div class="actions"><button id="save">Save inputs</button><label class="file">Load inputs<input id="load" type="file" accept=".json,application/json"></label></div>
<p class="hint">Saved files contain starting inputs, not the running state.</p>
<p id="notice" role="status"></p>
</aside><article>
<div class="transport"><button id="play">Run</button><button id="step">One tick</button><button id="restart">Restart</button><button id="replay" hidden>Replay ↻</button><span class="speed" aria-label="Playback speed"><label for="rate">Speed</label><input id="rate" type="range" min="0" max="1000" value="500" aria-describedby="rate-readout"><output id="rate-readout"></output></span><details class="timing-details"><summary>Timing</summary><span id="clock"></span></details></div>

<section class="instrument">
<!-- THE SCENE FIRST. All of this used to sit above it — a headline, a state banner, three
     control rows, a details block and the status line — which put the 3D view at y=490 of a
     757px viewport, making the circuit the one thing you had to scroll to reach. The readouts
     describe the scene, so they belong under it rather than in front of it. -->
<div class="presets" aria-label="What does it do?">
<span class="preset-lead">WHAT DOES IT DO?</span>
<span id="preset-buttons"></span>
<span class="preset-sep"></span>
<button id="add-diode">Add a diode</button>
<span id="diode-actions" hidden><button id="flip-diode">Turn it around</button><button id="remove-diode">Remove the diode</button><button id="focus-diode">Show me it</button></span>
</div>
<p class="hint" id="preset-blurb"></p>
<p class="hint" id="diode-state" hidden></p>
<div id="circuit-world"><div id="stage"><button id="reset-view" title="Restore the starting view">Reset view</button><label class="labels-toggle"><input id="labels-on" type="checkbox" checked> Labels</label><button id="focus-pickup" title="Look along the coil axis, where the loop faces you" hidden>Focus pickup</button><button id="inspect-resistor" aria-expanded="false" aria-controls="resistor-interior">Inspect resistor ↗</button><span class="resistor-key">Blue streaks: net electron flow · gold arrows: electric field<br>Travel speed is illustrative; microscopic motion is not shown</span><span class="orbit-hint">Drag to look around · marker height = voltage</span><div id="stage3d"></div><div id="stagelabels"></div></div>
<div id="resistor-interior" hidden></div></div>
<div id="headline"></div><div id="flow-readout" aria-live="off"></div>
<div class="mode scene-switch" aria-label="Circuit selector"><span>CONNECT TO</span><button id="charge" aria-pressed="true">Source</button><button id="discharge" aria-pressed="false">Return · discharge</button><label class="charge-view-toggle"><input id="show-current-arrows" type="checkbox"> Explain conventional current</label><span class="damping-group" aria-label="Damping control"><span class="row-label">DAMPING</span><input id="damping" type="range" min="20" max="4000" value="300" step="10" aria-label="Damping ratio"><output id="damping-readout"></output></span><span id="scene-time"></span></div>
<p class="hint" id="solver-status"></p>
<p id="graphics-status" role="status" hidden></p>
<details class="solver-details"><summary>Solver &amp; component details</summary>
<label class="coil-mode"><input id="solver-on" type="checkbox" checked> Solve with ngspice (a diode needs it)</label>
<label class="coil-mode" id="diode-mode" hidden>Diode<select id="diode-orientation">
<option value="none">Bypassed — no diode in the loop</option>
<option value="forward" selected>In series, forward — anode toward the source</option>
<option value="reverse">In series, reverse — anode toward the inductor</option>
</select></label>
<p class="hint" id="diode-model-note"></p>
</details>
<section id="plate-charge" aria-label="Charge separated on the capacitor plates">
<p id="electron-separation" class="hint"></p>
<div class="charge-heading"><span>CHARGE SEPARATION</span><span>Equal amounts · opposite signs</span></div>
<div class="charge-row"><span>Upper plate</span><div class="charge-track" aria-hidden="true"><div id="charge-upper-light" class="charge-light"></div></div><output id="charge-upper"></output></div>
<div class="charge-row"><span>Lower plate</span><div class="charge-track" aria-hidden="true"><div id="charge-lower-light" class="charge-light"></div></div><output id="charge-lower"></output></div>
<details class="charge-explanation"><summary>What these lights mean</summary><p id="charge-scale"></p><p>Charge separates on the two plates; it does not flow across the insulating gap. The voltage difference is Q / C, so a larger capacitance needs more separated charge for the same voltage.</p></details>
</section>
<details><summary>Inspect energy</summary><div id="gauge-cards" aria-label="Energy gauge readings"></div></details>

<p class="hint" id="solver-notes">Solved mode plays a transient computed in one go: changing any input re-solves and RESTARTS the run rather than continuing it. Cumulative heat, source work and the energy residual are unavailable here — they are integrated by the analytic kernel, not read from a sample.</p>
<details id="encoding-notes"><summary>Scales, precision & visual conventions</summary><p class="hint" id="scale-summary"></p><div id="stagelegend"></div>
<p class="hint" id="stagehint"></p>
<p class="hint">Gauge quantities are rounded to at most 6 significant figures; node voltage labels use 3 decimal places. Other RC readings use at most 7 significant figures (5 for tiny values in exponential notation). Trailing zeros may be omitted. Display rounding does not change the simulated values or gauge fill.</p></details></section>
<details class="predict" id="predict-panel" hidden><summary>Make a prediction</summary>
  <h2>Before you run it — where will it be?</h2>
  <p class="hint">Drag to where you think the capacitor voltage will be after <b>one time
  constant</b>. Commit, then run. Your guess stays on the chart next to what actually happens.</p>
  <input id="predict-slider" type="range" min="0" max="1000" value="500">
  <div class="predictrow">
    <span id="predict-value">—</span>
    <button id="predict-lock">Commit this guess</button>
    <button id="predict-clear">Clear</button>
  </div>
  <div id="predict-result"></div>
</details>
<details class="trace"><summary>Explore the voltage trace</summary><h2>Capacitor voltage over time</h2><p id="trace-scale" class="hint"></p><svg id="trace" viewBox="0 0 640 200" role="img" aria-label="Sampled capacitor voltage history"></svg></details>
<details><summary>Where the energy went</summary><div id="energy"></div><p class="hint">The resistor’s heat is transferred once into the named RC chassis (2 J/K, starting at 300 K). The transfer and receiver readings describe the same energy.</p></details>
<details><summary>Model & limits</summary><p>One ideal source, one resistor, one inductor, one capacitor in series. Exact analytic evolution for each held-input interval — the matrix exponential of the linear system, so a finer interval costs resolution and not correctness. Source work and Joule heat are integrated over that interval, the heat independently so the energy residual stays a real check. Initial stored energy, electric and magnetic, belongs to the starting state. Negative source work means energy returned to the ideal source.</p>
<p>Charge/discharge preserves capacitor voltage, INDUCTOR CURRENT and all ledgers — an inductor current cannot jump, so preserving it is the physics rather than a convenience. Only the source is substituted; the loop is never opened, because breaking an inductive loop would demand an infinite rate of change and is refused rather than approximated. Discharge replaces the source by an ideal 0 V source through the same resistor. The change takes effect for the next interval; no switching dynamics are modelled.</p>
<p>This is a fixed-topology series RLC experiment. The bench’s general DC network and LFO are separate and keep their existing quasi-static limits. The inductor is ideal: energy ½Li² and nothing else — no mutual inductance, core saturation, winding resistance separate from R, or frequency-dependent loss. No propagation, leakage or temperature feedback. The trace shows up to 30 simulated seconds of sampled history; very fast transients can happen between displayed samples.</p>
<p>Simulation uses fixed ticks, at most five per display frame. Under load it slows down; dropped time is shown beside the clock.</p></details>
</article></div>`;
const el = (id: string) => document.getElementById(id)!;
const resistorLens = new ResistorLens(el('resistor-interior'));
const resistorDetails = el('resistor-interior').querySelector('details')!;
function setResistorInspector(open: boolean): void {
  el('resistor-interior').hidden = !open;
  el('circuit-world').classList.toggle('inspecting',open);
  resistorDetails.open = open;
  el('inspect-resistor').setAttribute('aria-expanded',String(open));
  el('inspect-resistor').textContent = open ? 'Close resistor inspection' : 'Inspect resistor ↗';
  stage?.resize();
}
el('show-current-arrows').onchange = () => {
  const arrows=(el('show-current-arrows') as HTMLInputElement).checked;
  stage?.setElectronView(!arrows);
  root.querySelector('.resistor-key')!.innerHTML=arrows
    ? 'Mint arrows: conventional current · gold arrows: electric field<br>Conventional current points opposite electron drift'
    : 'Blue streaks: net electron flow · gold arrows: electric field<br>Travel speed is illustrative; microscopic motion is not shown';
  paint();
};
el('inspect-resistor').onclick = () => setResistorInspector(el('resistor-interior').hidden);
resistorDetails.addEventListener('toggle', () => {
  if(!resistorDetails.open && !el('resistor-interior').hidden) setResistorInspector(false);
});
/**
 * THE SPATIAL 3D VIEW IS PRIMARY. Peter rejected the flat schematic as the main
 * experience — "the standard schematic layout aint gonna cut it, thats one of the
 * whole points" — so it must not be what you land on. The schematic stays available
 * as a secondary reading, because connectivity IS easier to read there; it is simply
 * not the thing this project exists to show.
 */

let sim = new RlcExperiment(RLC_DEFAULT, RC_DT);
let history: Array<[number, number]> = [[0, sim.voltage]];
const sample = () => {
  history.push([sim.simulatedSeconds, sim.voltage]);
  if (history.length > 1801) history.shift();
  // The moment the run first reaches one tau, freeze the comparison. Captured once
  // and never revised, so the answer cannot drift toward the guess.
  if (predictionLocked && prediction !== null && predictionOutcome === null) {
    // RC-specific and only used by the withdrawn prediction exercise.
    const tau = sim.inputs.resistance * sim.inputs.capacitance;
    if (PREDICTION_ENABLED && sim.simulatedSeconds >= tau) {
      predictionOutcome = { predicted: prediction, actual: sim.voltage, atSeconds: sim.simulatedSeconds };
    }
  }
};
let clock = new RcClock<RlcExperiment>(sim, sample);
let driver = new RcDriver(clock);
const timeLabel = (t: number): string => {
  const [scale, unit] = t < 1e-6 ? [1e9, 'ns'] : t < 1e-3 ? [1e6, 'µs'] : t < 1 ? [1e3, 'ms'] : [1, 's'];
  return `${Number((t * Number(scale)).toPrecision(3))} <em>${unit}</em>`;
};
/**
 * CHOOSE A SIMULATED INTERVAL THAT CAN ACTUALLY RESOLVE THE TRANSIENT, and a
 * playback that makes it watchable. These are DIFFERENT quantities and both are
 * reported.
 *
 * Real plate geometry gives tau in microseconds. At the default 1/60 s interval the
 * capacitor finishes charging INSIDE THE FIRST TICK, so the picture has nothing to
 * show — which is exactly what happened the first time this ran. Astra's time
 * correction is what makes this fixable: h is declared per experiment, and the
 * analytic update is exact per interval, so a finer h costs resolution only.
 *
 * `h` is capped at the legacy 1/60 s so an ordinary RC-1 run is untouched.
 */
function chooseTiming(inputs: RlcInputs): { dt: number; playback: number } {
  // DERIVED FROM L AND C ONLY — never from R. The RC page scaled playback by τ = RC, which
  // auto-normalises: change the resistor and the charge looks identical because the
  // presentation rescales with it. Damping is the thing this circuit exists to show, so the
  // timing basis must not move when R does. ω₀ = 1/√(LC) contains no R.
  const period = 2 * Math.PI * Math.sqrt(inputs.inductance * inputs.capacitance);
  const dt = Math.min(RC_DT, Math.max(RLC_LIMITS.minH, period / 240));   // ~240 samples/cycle
  // About three wall seconds per undamped cycle, so ringing is watchable.
  const playback = Math.min(1, Math.max(1e-12, period / 3));
  return { dt, playback };
}

function reset(inputs: RlcInputs): void {
  const { dt, playback } = chooseTiming(inputs);
  const next = new RlcExperiment(inputs, dt); // validate before changing live state
  sim = next; history = [[0, sim.voltage]]; clock = new RcClock(sim, sample);
  clock.playback = playback;
  clock.maxStepsPerFrame = 200;   // enough to keep up at a fine h; excess still reported
  driver.reset(clock);   // the only thing that clears a latched fault
  captureBounds(true);   // fresh run: scales recomputed from the new starting state
  // A fresh run clears the guess. Scoring a prediction against a DIFFERENT
  // experiment would be a false comparison, so it is not offered.
  prediction = null; predictionLocked = false; predictionOutcome = null;
  const ps = document.getElementById('predict-slider') as HTMLInputElement | null;
  if (ps) { ps.disabled = false; }
  const pl = document.getElementById('predict-lock');
  if (pl) pl.textContent = 'Commit this guess';
  const pv = document.getElementById('predict-value');
  if (pv) pv.textContent = '—';
  for (const key of Object.keys(inputs) as Array<keyof RlcInputs>) (el(key) as HTMLInputElement).value = String(inputs[key]);
  paint();
}
function action(fn: () => void): void { try { fn(); paint(); } catch (e) { el('notice').textContent = String(e); } }
// ---- GC1 geometry controls. Left column, so nothing here is repainted under a
// ---- typing cursor. Capacitance is DERIVED and the C field becomes read-only.
const geoNum = (id: string): number => Number((el(id) as HTMLInputElement).value);
/** mm from the UI to metres for the model. The model is always SI. */
const mm = (v: number): number => v / 1000;

function currentGeometry(): PlateGeometry {
  const side = mm(geoNum('geo-side'));
  return { area: side * side, gap: mm(geoNum('geo-gap')), dielectric: VACUUM };
}

/** Live, non-committing preview. Refusals are shown, never clamped away. */
function paintGeoReadout(): void {
  const out = el('geo-readout');
  if (!geometry && !(el('geo-on') as HTMLInputElement).checked) { out.innerHTML = ''; return; }
  let g: PlateGeometry;
  try { g = currentGeometry(); } catch { out.innerHTML = ''; return; }
  try {
    const C = capacitanceOf(g);
    const side = plateSide(g.area);
    // R×C IS NOT THIS CIRCUIT'S TIME CONSTANT any more. What C sets here, with L, is the
    // undamped period and the critical resistance; the decay time is 2L/R.
    const period = 2 * Math.PI * Math.sqrt(sim.inputs.inductance * C);
    const rCrit = 2 * Math.sqrt(sim.inputs.inductance / C);
    out.innerHTML = `<div class="ok">
      <b>C = ${C.toExponential(4)} F</b> &nbsp;(${(C * 1e12).toPrecision(4)} pF)<br>
      plate side ${(side * 1000).toPrecision(4)} mm · area ${g.area.toExponential(3)} m²
      · gap ${(g.gap * 1000).toPrecision(4)} mm<br>
      gap / side = ${gapToSide(g).toPrecision(3)} &nbsp;(domain: ≤ 0.1)<br>
      dielectric ${g.dielectric.label}, ε_r = ${g.dielectric.relativePermittivity}<br>
      with L = ${sim.inputs.inductance} H this gives an undamped period
      <b>2π√(LC) = ${period.toExponential(4)} s</b> and critical resistance
      <b>2√(L/C) = ${rCrit.toExponential(4)} Ω</b><br>
      at R = ${Number(sim.resistance.toPrecision(4))} Ω the damping ratio is
      <b>ζ = ${Number((sim.resistance / rCrit).toPrecision(3))}</b> (${sim.regime})<br>
      <span class="dim">Field inside, at the present ${fmt(sim.voltage)} V:
      <b>${interiorField(sim.voltage, g).toExponential(4)} V/m</b>. Drawn gap is magnified
      ×${GAP_EXAGGERATION} for visibility; every number here is the real metre value.</span><br>
      <span class="dim">ε₀ ${EPSILON_0_BASIS}</span></div>`;
  } catch (e) {
    // REFUSED, and the last accepted geometry stays in force. Not clamped.
    out.innerHTML = `<div class="bad"><b>REFUSED — geometry not applied.</b> ${String(e)}
      <br><span class="dim">The last accepted geometry is still in force.</span></div>`;
  }
}

el('geo-on').addEventListener('change', () => {
  const on = (el('geo-on') as HTMLInputElement).checked;
  (el('geo-fields') as HTMLElement).hidden = !on;
  (el('capacitance') as HTMLInputElement).readOnly = on;
  if (!on) { geometry = null; }
  paintGeoReadout(); paint();
});
for (const id of ['geo-side', 'geo-gap']) {
  el(id).addEventListener('input', () => {
    // keep the drag control in step with the typed value
    const g = mm(geoNum('geo-gap')), side = mm(geoNum('geo-side'));
    const frac = Math.max(0, Math.min(1, g / (side * 0.1)));
    (el('geo-gap-drag') as HTMLInputElement).value = String(Math.round(frac * 1000));
    paintGeoReadout();
  });
}
el('geo-gap-drag').addEventListener('input', () => {
  // Dragging maps to the DOMAIN: 0 -> a hair, 1000 -> exactly the 0.1 ratio limit.
  const side = mm(geoNum('geo-side'));
  const frac = geoNum('geo-gap-drag') / 1000;
  const gap = Math.max(1e-7, frac * side * 0.1);
  (el('geo-gap') as HTMLInputElement).value = String(Number((gap * 1000).toPrecision(6)));
  paintGeoReadout();
});
el('geo-apply').onclick = () => action(() => {
  // Geometry sets C, so the solved transient describes a circuit that no longer exists.
  const g = currentGeometry();
  const C = capacitanceOf(g);                    // REFUSES before anything is committed
  geometry = g;
  reset({ ...sim.inputs, capacitance: C });      // one commit, fresh paused run
  (el('capacitance') as HTMLInputElement).value = String(C);
  el('notice').textContent = `Geometry applied. C = ${C.toExponential(6)} F, derived from `
    + `A = ${g.area.toExponential(3)} m² and d = ${g.gap.toExponential(3)} m. Fresh paused experiment.`;
  paintGeoReadout();
  resolveIfSolving('Plate geometry changed. ');
});

function coilGeometryFromForm() {
  const num = (id: string) => Number((el(id) as HTMLInputElement).value);
  return { turns: Math.round(num('coil-turns')), radius: num('coil-radius') / 1000,
           length: num('coil-length') / 1000, wireRadius: num('coil-wire') / 1000 };
}

/**
 * Rebuild the coil package. Throws on an unusable geometry BEFORE any live state changes, so
 * a refused geometry leaves the running experiment exactly as it was.
 */
function pickupFromForm() {
  if (!(el('pickup-on') as HTMLInputElement).checked) return undefined;
  const num = (id: string) => Number((el(id) as HTMLInputElement).value);
  return { radius: num('pickup-radius') / 1000, separation: num('pickup-sep') / 1000,
           orientation: Number((el('pickup-orient') as HTMLSelectElement).value) as PickupOrientation };
}

function adoptCoilGeometry(): number {
  const pkg = buildCoilPackage(coilGeometryFromForm(),
    { sceneUnitsPerMetre: COIL_SCENE_UNITS_PER_METRE, pickup: pickupFromForm() });
  coilPackage = pkg;
  return pkg.inductanceH;
}

el('rc-form').addEventListener('submit', (e) => {
  e.preventDefault(); action(() => {
    const num = (id: string) => Number((el(id) as HTMLInputElement).value);
    const geometric = (el('coil-on') as HTMLInputElement).checked;
    // Build the package FIRST: if the geometry is unusable this throws before reset() runs.
    const inductance = geometric ? adoptCoilGeometry() : num('inductance');
    if (!geometric) coilPackage = null;
    reset({ voltage: num('voltage'), resistance: num('resistance'), capacitance: num('capacitance'),
      inductance, initialVoltage: num('initialVoltage'),
      initialCurrent: num('initialCurrent') });
    el('notice').textContent = geometric
      ? `Inputs applied. L = ${siUnit(inductance, 'H')}, derived from the winding. Fresh experiment, paused at tick 0.`
      : 'Inputs applied. Authored inductance, so the solved field is unavailable. Fresh experiment, paused at tick 0.';
    paintCoilReadout();
    // In solver mode the circuit description changed, so the solved transient is stale: it
    // describes a circuit that no longer exists. Re-solve, which restarts.
    resolveIfSolving('Inputs changed. ');
  });
});

/** What the winding is and what it therefore is, in one line under the controls. */
function paintCoilReadout(): void {
  const geometric = (el('coil-on') as HTMLInputElement).checked;
  el('coil-fields').hidden = !geometric;
  (el('inductance') as HTMLInputElement).readOnly = geometric;
  if (!geometric || !coilPackage) {
    el('coil-readout').textContent = '';
    return;
  }
  const g = coilPackage.geometry;
  el('pickup-fields').hidden = !(el('pickup-on') as HTMLInputElement).checked;
  el('focus-pickup').hidden = !coilPackage?.pickup;
  const pk = coilPackage?.pickup;
  el('pickup-readout').textContent = pk
    ? `M = ${siUnit(pk.mutualH, 'H')}, coupling k = ${pk.couplingK.toFixed(4)}. The loop is OPEN: `
      + `no current flows in it, it stores no energy and takes none from the circuit. It shows a `
      + `voltage only while the primary current is CHANGING — at a steady current, however large, it reads zero.`
    : '';
  el('coil-readout').textContent =
    `${g.turns} turns, ${(g.radius * 1000).toFixed(1)} mm radius, ${(g.length * 1000).toFixed(1)} mm long`
    + ` → L = ${siUnit(coilPackage.inductanceH, 'H')}. Field solved from this winding by Biot–Savart,`
    + ` coil contribution only; the leads are layout and carry no field here.`;
}
el('coil-on').addEventListener('change', () => action(() => { paintCoilReadout(); }));
// Moving the loop mid-run would be motional induction, which this does NOT model — so a pose
// change rebuilds the package and RESTARTS, rather than silently changing M under a running
// experiment. Stated in the notice so the reset is not a surprise.
for (const id of ['pickup-on', 'pickup-radius', 'pickup-sep', 'pickup-orient'])
  el(id).addEventListener('change', () => action(() => {
    const inductance = (el('coil-on') as HTMLInputElement).checked ? adoptCoilGeometry() : sim.inputs.inductance;
    reset({ ...sim.inputs, inductance });
    paintCoilReadout();
    resolveIfSolving('Pickup moved. ');
    el('notice').textContent = coilPackage?.pickup
      ? `Pickup moved, so the experiment restarted: changing the pose mid-run would be motional induction, which is not modelled here. M = ${siUnit(coilPackage.pickup.mutualH, 'H')}.`
      : 'Pickup removed. Fresh experiment, paused at tick 0.';
  }));
// ---- predict-then-run ------------------------------------------------------
const predictBounds = (): { lo: number; hi: number } => {
  const a = sim.inputs.initialVoltage, b = sim.inputs.voltage;
  return { lo: Math.min(0, a, b), hi: Math.max(0, a, b) };
};
el('predict-slider').addEventListener('input', () => {
  if (predictionLocked) return;                 // committed guesses do not move
  const { lo, hi } = predictBounds();
  const f = Number((el('predict-slider') as HTMLInputElement).value) / 1000;
  prediction = lo + f * (hi - lo);
  el('predict-value').textContent = `${fmt(prediction)} V`;
  paint();
});
el('predict-lock').onclick = () => {
  if (prediction === null) {
    const { lo, hi } = predictBounds();
    prediction = (lo + hi) / 2;
  }
  predictionLocked = true;
  predictionOutcome = null;
  (el('predict-slider') as HTMLInputElement).disabled = true;
  el('predict-lock').textContent = 'Committed — now run it';
  el('notice').textContent = `Guess committed at ${fmt(prediction)} V. Press Run; the answer arrives at one time constant.`;
  paint();
};
el('predict-clear').onclick = () => {
  prediction = null; predictionLocked = false; predictionOutcome = null;
  (el('predict-slider') as HTMLInputElement).disabled = false;
  el('predict-lock').textContent = 'Commit this guess';
  el('predict-value').textContent = '—';
  paint();
};

el('play').onclick = () => {
  driver.togglePaused();
  // Keep the solved playback in step with the transport IMMEDIATELY. The frame loop copies it
  // too, but paint() runs first, so the label lagged a frame and read "Running" while paused.
  if (playback) { playback.paused = clock.paused; solverFrame = playback.frame(); }
  paint();
};
/**
 * ONE TICK STEPS WHICHEVER AUTHORITY IS DRIVING.
 *
 * This stepped `driver` unconditionally — the analytic kernel — so in solved mode the button
 * advanced a model nobody was reading and the scene did not move. The same two-authorities
 * mistake the frame loop was already corrected for, left in a control. `stepOne` was written
 * for this and never wired to anything: it moves to the next ACTUAL solver sample rather than
 * by a display interval, which is what stepping through a solution means.
 */
el('step').onclick = () => {
  if (driveMode() === 'solved' && playback) {
    playback.stepOne();
    solverFrame = playback.frame();
  } else if (driveMode() === 'kernel') {
    driver.step();
  }
  // In 'busy' or 'fault' there is nothing to step: the scene is held or has no trajectory.
  paint();
};
/**
 * RESTART, DISPATCHED BY WHICHEVER AUTHORITY IS DRIVING.
 *
 * This called `reset({ ...sim.inputs })` unconditionally. In solved mode that rebuilds the kernel
 * and clock, runs `captureBounds(true)` — which derives scales from the DC source and so put an
 * alternating run's ruler back to zero, the very defect just fixed — and never touches the
 * playback at all. So the cursor stayed where it was while the button claimed a restart. The
 * `playback.reset()` that makes this work had been written and tested and wired to nothing.
 *
 * In solved mode a restart means the START OF THE SOLVED RUN: same trajectory, same scales,
 * cursor at zero, replay count cleared. The inputs are not re-applied because they were never
 * un-applied — Apply is the control that does that.
 */
el('restart').onclick = () => {
  if (driveMode() !== 'kernel' && playback) {
    playback.reset();
    solverFrame = playback.frame();
    clock.paused = true;                      // both clocks stopped, so the reset frame is seen
    paint();
    el('notice').textContent = 'Back to the start of the solved run. Same trajectory and the '
      + 'same display scales; press Run to play it again.';
    return;
  }
  reset({ ...sim.inputs });
  el('notice').textContent = 'Restarted from authored inputs.';
};
el('charge').onclick = () => { selectSource(true); };
el('discharge').onclick = () => { selectSource(false); };
/**
 * A SOURCE CHANGE RECAPTURES THE SCALES; SELECTING THE SOURCE YOU ARE ALREADY ON MUST NOT.
 * Recapturing from the live state shrinks the bound toward the present value, so repeated
 * clicks on the active button silently ratcheted every scale downward.
 */
/**
 * LIVE R. The model has always allowed it; until now the page had no control, so reporting
 * "R is live" was reporting a capability nobody could reach.
 *
 * The slider carries ζ = R / 2√(L/C) rather than ohms, because ζ is what decides whether
 * this circuit rings, and the ohms that mean "ringing" depend entirely on the plate
 * geometry. The ohms are printed alongside, so nothing is hidden.
 *
 * State and every ledger carry across untouched, and PLAYBACK IS NOT RECOMPUTED — the whole
 * point is that two damping settings are compared on the same time basis. Only the node
 * bound may widen, never the voltage or current bound, so no scale shrinks under a value
 * already drawn.
 */
function applyDamping(zeta: number): void {
  const ohms = zeta * sim.criticalResistance;
  try {
    sim.setResistance(ohms);
  } catch (e) {
    el('notice').textContent = String(e);
    return;
  }
  // THE NODE BOUND NEEDED A CONSUMER. It was being maintained and never read: rcSpec takes
  // its height range from lo/hi, so raising R during a positive current could push the
  // resistor→inductor node, Vs − i·R, straight off the bottom of the ruler it was drawn
  // against. The captured VOLTAGE and CURRENT bounds are untouched — only the height range
  // widens, and only outward, so nothing already drawn is invalidated.
  // ONLY IN KERNEL MODE. In solved mode the scales come from the adopted trajectory and are held
  // for the life of the run — widening them here from the DC source would drift the axis under a
  // picture that is already drawn, and a damping change re-solves anyway, which recaptures.
  if (solverRequested) return;
  bounds.rMax = Math.max(bounds.rMax, sim.resistance);
  const reach = bounds.rMax * bounds.current;
  bounds.node = Math.abs(sim.sourceVoltage) + reach;
  const lo = Math.min(bounds.lo, sim.sourceVoltage - reach);
  const hi = Math.max(bounds.hi, sim.sourceVoltage + reach);
  if (lo !== bounds.lo || hi !== bounds.hi) {
    bounds.lo = lo; bounds.hi = hi;
    el('notice').textContent = `Damping raised to ζ = ${Number((sim.resistance / sim.criticalResistance).toPrecision(3))}. `
      + `Height range widened to ${fmt(lo)} … ${fmt(hi)} V to hold the resistor→inductor node; `
      + `the state and every ledger are unchanged.`;
  }
  paint();
}

function selectSource(connected: boolean): void {
  if (sim.connected === connected) return;          // no-op: nothing changes, nothing rescales
  sim.connected = connected;
  const before = { lo: bounds.lo, hi: bounds.hi };
  // In solved mode the source change forces a new solve, and that solve's own trajectory sets the
  // scales. Recapturing from the DC inputs here would put the display briefly on scales belonging
  // to neither run.
  if (!solverRequested) captureBounds(false);
  if (bounds.lo !== before.lo || bounds.hi !== before.hi) {
    el('notice').textContent = `Source changed. Display range rescaled to `
      + `${fmt(bounds.lo)} … ${fmt(bounds.hi)} V; the state itself is continuous.`;
  }
  // IN SOLVED MODE THIS IS NOT CONTINUOUS. The transient is solved as a whole for one source
  // configuration, so switching gives a NEW run from the reset state — the opposite of the
  // kernel's behaviour, where the switch happens at the present instant with the state carried
  // across. Saying "the state itself is continuous" here would be false, so it is overwritten.
  if (solverRequested) {
    el('notice').textContent = 'Source changed. In solved mode this RESTARTS: the transient is '
      + 'solved as a whole for one configuration, so the run begins again from reset rather '
      + 'than switching at the present instant.';
    resolveIfSolving('Source changed. ');
  }
  paint();
}
el('save').onclick = () => {
  // The winding travels with the numbers: the same inductance can come from many coils,
  // and the field drawn is this one's.
  const url = URL.createObjectURL(new Blob(
    [encodeRlcDoc({ inputs: sim.inputs, coil: coilPackage?.geometry,
                    pickup: coilPackage?.pickup?.geometry,
                    // THE SOLVER SESSION TRAVELS TOO. Without it a saved diode run reloaded the
                    // same R, L and C with the device silently gone — a different circuit
                    // reported as a successful load. Written only when the solver is on, so a
                    // kernel session still produces a file identical to the ones before this.
                    // THE CONFIGURATION, not the name of a demonstration. A saved rectifier
                    // that recorded only its diode reloaded as a series circuit — a different
                    // experiment, and one that goes still.
                    solver: solverRequested
                      ? { required: true, diode: selectedDiode(),
                          sourceSine: config.sourceSine,
                          loadResistanceOhms: config.loadResistanceOhms,
                          stopSeconds: config.stopSeconds,
                          stepSeconds: config.stepSeconds } : undefined })],
    { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'flux-rlc-inputs.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('notice').textContent = 'Saved applied starting inputs. Unsaved form changes and live state are not included.';
};
el('load').addEventListener('change', async () => {
  const input = el('load') as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    // DISPATCH BY FORMAT BEFORE TOUCHING ANY LIVE STATE. Wrapping decodeRlcDoc in a catch that
    // fell through to decodeRc meant a REAL error from an RLC file — a coil whose geometry no
    // longer produces its stored inductance, say — was swallowed and re-reported as a format
    // complaint about a different document type. The file says which it is; read that first.
    const format = (() => { try { return JSON.parse(text)?.format; } catch { return undefined; } })();

    if (format === 'flux-rc-1') {
      // A flux-rc-1 document describes a circuit with NO INDUCTOR, so it cannot by itself
      // determine a run of this one. Rather than refuse it or silently invent a value, the
      // declared minimum is supplied and SAID OUT LOUD — at that inductance the loop is
      // heavily overdamped and behaves essentially as the RC circuit the file describes.
      const legacy = decodeRc(text);
      // AND THE WINDING MUST GO. Loading an RC file from geometry mode used to leave the old
      // coil and its solved field standing against the new inductance, so the scene showed a
      // winding that no longer produced L — and saving from there wrote a document whose coil
      // and inductance disagreed, which the loader would then refuse.
      coilPackage = null;
      (el('coil-on') as HTMLInputElement).checked = false;
      (el('pickup-on') as HTMLInputElement).checked = false;   // no coil means nothing to couple to
      reset({ ...legacy, inductance: RLC_LIMITS.minL, initialCurrent: 0 });
      paintCoilReadout();
      el('notice').textContent = `Loaded an RC document, which predates the inductor. `
        + `Inductance was set to the declared minimum ${RLC_LIMITS.minL} H and initial current to 0; `
        + `at that value the loop is heavily overdamped and behaves essentially as the RC run described. `
        + `Any coil geometry was cleared, since this file describes none.`;
    } else {
      const doc = decodeRlcDoc(text);          // its errors reach the user unmasked
      // A file with a winding restores geometry mode and rebuilds the package from THAT coil;
      // a file without one restores the phenomenological mode, where the solved field is
      // unavailable because there is no winding to solve. Neither is rewritten to look like
      // the other. The package is built BEFORE reset, so a bad geometry throws with the
      // running experiment untouched.
      const pkg = doc.coil
        ? buildCoilPackage(doc.coil, { sceneUnitsPerMetre: COIL_SCENE_UNITS_PER_METRE,
                                       pickup: doc.pickup })
        : null;
      coilPackage = pkg;
      (el('coil-on') as HTMLInputElement).checked = !!doc.coil;
      if (doc.coil) {
        (el('coil-turns') as HTMLInputElement).value = String(doc.coil.turns);
        (el('coil-radius') as HTMLInputElement).value = String(doc.coil.radius * 1000);
        (el('coil-length') as HTMLInputElement).value = String(doc.coil.length * 1000);
        (el('coil-wire') as HTMLInputElement).value = String(doc.coil.wireRadius * 1000);
      }
      // The pickup's controls must follow the loaded pose, or the panel would describe a loop
      // the scene is not drawing. A file without one clears the checkbox rather than leaving
      // a stale pose armed.
      (el('pickup-on') as HTMLInputElement).checked = !!doc.pickup;
      if (doc.pickup) {
        (el('pickup-radius') as HTMLInputElement).value = String(doc.pickup.radius * 1000);
        (el('pickup-sep') as HTMLInputElement).value = String(doc.pickup.separation * 1000);
        (el('pickup-orient') as HTMLSelectElement).value = String(doc.pickup.orientation);
      }
      // THE SOLVER AND ITS DIODE, restored BEFORE the solve is requested. `solverRequested` is
      // what `resolveIfSolving` reads, and the select is what `describeCircuit` reads, so both
      // have to be in place first or the load would re-solve the previous circuit.
      //
      // A file with no `solver` key is a pre-diode document and means the kernel: the mode is
      // turned OFF rather than left as it was, so loading an old file into a running solved
      // session restores what the file describes instead of half of each.
      const wantSolver = doc.solver?.required === true;
      (el('solver-on') as HTMLInputElement).checked = wantSolver;
      (el('diode-orientation') as HTMLSelectElement).value =
        doc.solver?.diode?.orientation ?? 'none';
      // THE MODEL, not only its orientation. Restoring the orientation alone left the default
      // part in the loop under the saved file's name, and the next save overwrote the file's
      // numbers with the defaults. A file with no diode returns the page to its own part.
      if (doc.solver?.diode) {
        const { orientation: _drop, ...part } = doc.solver.diode;
        activeDiodePart = { ...part };
      } else {
        activeDiodePart = { ...DIODE_PART };
      }
      // THE DRIVE AND TOPOLOGY come from the file too. A file that predates them describes a DC
      // source and no load, which is what it always was. The demonstration row stops claiming
      // anything, because a loaded file is a configuration and not one of the presets.
      const fallback = ringHorizon();
      config = {
        sourceSine: doc.solver?.sourceSine,
        loadResistanceOhms: doc.solver?.loadResistanceOhms,
        stopSeconds: doc.solver?.stopSeconds ?? fallback.stopSeconds,
        stepSeconds: doc.solver?.stepSeconds ?? fallback.stepSeconds,
      };
      activePreset = null;
      paintPresets();
      if (solverRequested !== wantSolver) {
        solverRequested = wantSolver;
        // Invalidate anything in flight: a solve from the previous circuit must not come back
        // and drive the loaded one.
        solveGeneration++;
        if (!wantSolver) {
          playback = null; solverFrame = null; presented = null;
          solverFault = null; solverBusy = false;
        }
      }
      paintDiodeControl();
      reset(doc.inputs);
      paintCoilReadout();
      paintSolverStatus(null);
      resolveIfSolving('File loaded. ');
      el('notice').textContent = doc.coil
        ? `Loaded starting inputs and the winding that produces them. L = ${siUnit(doc.inputs.inductance, 'H')}. Paused at tick 0.`
        : 'Loaded starting inputs. This file has no winding, so the inductance is authored and the solved field is unavailable. Paused at tick 0.';
    }
  }
  catch (e) { el('notice').textContent = `Load refused; experiment unchanged. ${String(e)}`; }
  input.value = '';
});
/**
 * PLAYBACK SPEED — a viewer control, not a physical one, and the previous version of it was a
 * mislabelled no-op.
 *
 * That control was a select whose values fed `playbackWallSeconds` DIRECTLY, so "3× slower"
 * meant three wall seconds for the whole run — which is the baseline, not three times slower
 * than it. "1×" was three times FASTER than the default it sat next to. Astra read the source
 * and found it; nothing in the label was true.
 *
 * The model now: ONE RUN TAKES `BASE_WALL_SECONDS / speed`. At speed 1 that is the old
 * three-second baseline; at the 0.1 default it is thirty seconds, which for the eight-cycle
 * alternating presets is 3.75 s per source cycle. The slow end reaches 0.01, or 37.5 s per cycle.
 * Peter's words were "too fast for human intuition"; the default is now the calm end, not a
 * setting to go hunting for.
 */
/** The slider is LOGARITHMIC: two decades spread evenly, so the slow end is reachable. */
function speedMultiplier(): number {
  return speedFromSlider(Number((el('rate') as HTMLInputElement).value));
}

function playbackWallSeconds(): number {
  return wallSecondsFor(speedMultiplier());
}

/**
 * Say what the speed MEANS, in the units of the thing being watched.
 *
 * A bare multiplier is meaningless without its baseline. Where the drive is periodic the useful
 * number is seconds per source cycle — how long one swing of the source takes on screen.
 */
function paintSpeedReadout(): void {
  // SOLVED PLAYBACK ONLY, and the control says so rather than pretending otherwise.
  //
  // It re-times a solved trajectory being handed to the screen. The analytic kernel does not
  // play a trajectory — it integrates as it goes, on its own interval — so this does nothing
  // there. Astra: do not silently promise it in a mode where it has no effect. Disabled and
  // labelled rather than left looking live.
  const control = el('rate') as HTMLInputElement;
  control.disabled = !solverRequested;
  if (!solverRequested) {
    el('rate-readout').textContent = 'applies to solved playback';
    return;
  }
  const m = speedMultiplier();
  const wall = playbackWallSeconds();
  const cycleHz = presented?.sourceSine?.frequencyHz;
  const perCycle = cycleHz && presented
    ? wall / (presented.stopSeconds * cycleHz) : null;
  el('rate-readout').textContent = perCycle !== null
    ? `${m.toFixed(2)}× · ${perCycle.toFixed(1)} s per source cycle`
    : `${m.toFixed(2)}× · ${wall.toFixed(0)} s for the run`;
}

/** The circuit as the solver should see it, from the same inputs the kernel uses. */
/**
 * THE DEFAULT PART — AN ILLUSTRATIVE QUASI-STATIC SILICON DIODE, not a manufactured one.
 *
 * These are ordinary small-signal orders of magnitude, and an earlier version of this comment
 * called them "the 1N4148's parameters". That was a provenance claim with no source behind it:
 * nothing here was taken from a datasheet, and no measurement ties these numbers to any real
 * part. Astra caught the unsupported attribution. They are what they are — a plausible silicon
 * diode for teaching — and the page should not imply a device someone could buy.
 *
 * CJO and TT are zero, which `validateCircuit` insists on: that makes the device quasi-static,
 * so no charge is stored in the junction and terminal power really is dissipation. It is also
 * why nothing here claims anything about reverse recovery.
 */
const DIODE_PART = DEFAULT_DIODE_PART;

/**
 * THE PART CURRENTLY IN THE LOOP, which is not always the default one.
 *
 * `selectedDiode` used to rebuild `DIODE_PART` unconditionally while the loader restored only the
 * orientation, so a file carrying a different IS, RS or BV silently became the default device —
 * and the next save then wrote the defaults over the file's own numbers. The document format
 * stored the whole spec, so the claim that a saved device round-trips intact was true of the
 * format and false of the product. Astra found it by reading the two ends against each other.
 *
 * Any model that reaches here has already passed `validateCircuit`, so it is inside the supported
 * envelope — but only the default part is covered by the domain matrix, which is stated on screen
 * rather than left implicit.
 */
let activeDiodePart: Omit<DiodeSpec, 'orientation'> = { ...DIODE_PART };
const isDefaultPart = (): boolean =>
  (Object.keys(DIODE_PART) as (keyof typeof DIODE_PART)[])
    .every((k) => activeDiodePart[k] === DIODE_PART[k]);

/** `none` means the device is absent from the netlist entirely, not shorted out. */
function selectedDiode(): DiodeSpec | undefined {
  const v = (el('diode-orientation') as HTMLSelectElement).value;
  return v === 'forward' || v === 'reverse' ? { ...activeDiodePart, orientation: v } : undefined;
}

/**
 * THE DEMONSTRATION CURRENTLY SELECTED, or null once the viewer has edited away from it.
 *
 * A preset is a starting point, not a mode: changing the diode or a component value leaves the
 * circuit no longer describable as that demonstration, so the button stops claiming it.
 */
/**
 * THE ACTUAL CIRCUIT CONFIGURATION, held separately from which button is lit.
 *
 * The first version read the drive and the topology out of `activePreset` on every call, which
 * made the selection the source of truth for the circuit. Astra found what that costs: `Remove
 * the diode` cleared the selection, so it silently removed the alternating source, the load and
 * the horizon as well — a one-component action quietly rebuilding the whole experiment. Saving
 * had the same hole, recording the diode while the source and load lived only in a preset id.
 *
 * So the configuration is state, and the preset is a way of SETTING it. Editing one part changes
 * that part. The lit button is a claim about what the circuit currently is, and it is dropped the
 * moment that stops being true — but dropping it changes nothing about the circuit.
 */
export interface CircuitConfig {
  /** The constant source level a demonstration declares, when it is not driven by a sine. */
  sourceVolts?: number;
  sourceSine?: { amplitudeVolts: number; frequencyHz: number; offsetVolts: number };
  loadResistanceOhms?: number;
  stopSeconds: number;
  stepSeconds: number;
}

/** The horizon a circuit with no periodic drive gets: five ring periods at 240 samples each. */
function ringHorizon(): { stopSeconds: number; stepSeconds: number } {
  const period = 2 * Math.PI * Math.sqrt(sim.inputs.inductance * sim.inputs.capacitance);
  return { stopSeconds: 5 * period, stepSeconds: period / 240 };
}

function configFromPreset(preset: Preset): CircuitConfig {
  const built = preset.build({ resistanceOhms: sim.resistance,
    inductanceHenries: sim.inputs.inductance, capacitanceFarads: sim.inputs.capacitance });
  const fallback = ringHorizon();
  return {
    sourceVolts: built.sourceVolts,
    sourceSine: built.sourceSine,
    loadResistanceOhms: built.loadResistanceOhms,
    stopSeconds: built.stopSeconds ?? fallback.stopSeconds,
    stepSeconds: built.stepSeconds ?? fallback.stepSeconds,
  };
}

let activePreset: Preset | null = presetById('one-way-valve') ?? null;
let config: CircuitConfig = { stopSeconds: 1e-6, stepSeconds: 1e-9 };

function describeCircuit(): CircuitDescription {
  return {
    // The EFFECTIVE source, so the return-path switch is described rather than ignored.
    sourceVolts: sim.sourceVoltage,
    resistanceOhms: sim.inputs.resistance,
    inductanceHenries: sim.inputs.inductance,
    capacitanceFarads: sim.inputs.capacitance,
    initialCapacitorVolts: sim.inputs.initialVoltage,
    initialInductorAmps: sim.inputs.initialCurrent,
    // THE DRIVE AND TOPOLOGY, from the configuration rather than from whichever button is lit.
    sourceSine: config.sourceSine,
    loadResistanceOhms: config.loadResistanceOhms,
    stopSeconds: config.stopSeconds,
    stepSeconds: config.stepSeconds,
    diode: selectedDiode(),
    coilSignature: coilPackage
      ? `${coilPackage.geometry.turns}/${coilPackage.geometry.radius}/${coilPackage.geometry.length}`
        + `/${coilPackage.geometry.wireRadius}/${coilPackage.pickup
          ? `${coilPackage.pickup.geometry.radius}:${coilPackage.pickup.geometry.separation}`
            + `:${coilPackage.pickup.geometry.orientation}` : 'none'}`
      : 'no-coil',
  };
}

/**
 * Solve, and RESTART. There is no continuing an edited circuit: the new transient is a
 * different experiment, and pretending otherwise is the "replayed transient presented as
 * continuous state" this design refuses.
 */
async function resolveCircuit(why: string): Promise<void> {
  if (!spice) spice = new SpiceClient();
  // EVERY completion path is guarded by this. Without it, a stale rejection arriving after a
  // newer request cleared the newer request's busy flag and its status line — the old failure
  // narrating the new solve.
  const generation = ++solveGeneration;
  const mine = () => generation === solveGeneration && solverRequested;
  solverBusy = true; solverFault = null; paintSolverStatus(why);
  try {
    const description = describeCircuit();
    const transient = await spice.solve(description);
    if (!mine()) return;
    // THE SUPPORTED DOMAIN, CHECKED AGAINST THE TRAJECTORY, not against the inputs.
    //
    // An inductor kick can drive the diode far past the source voltage, so "10 V source, 75 V
    // part" does not by itself put the run inside the envelope. ngspice models the breakdown
    // region, so such a run is not nonsense — but the independent device law this project checks
    // against stops at −BV, so the run would be UNVERIFIED. It is refused with that reason
    // rather than presented as an accurate one.
    if (description.diode) {
      const x = diodeExcursion(transientDiodeSamples(transient), description.diode.orientation,
        description.diode.bv);
      if (x.enteredBreakdown)
        throw new Error(`The diode reached ${x.minTerminalVolts.toFixed(2)} V at `
          + `${(x.breakdownAtSeconds ?? 0).toExponential(3)} s, at or past its `
          + `${description.diode.bv} V reverse breakdown. ngspice models that region but nothing `
          + `here verifies it, so the run is refused rather than shown as accurate. Lower the `
          + `source voltage or the initial current.`);
    }
    // PLAYBACK SPEED IS A PRESENTATION CHOICE and nothing else: it divides simulated seconds by
    // wall seconds. The SOLVER's own time — the horizon, the step, every sample — is untouched,
    // so slowing the picture down cannot change a number in it.
    const rate = description.stopSeconds / playbackWallSeconds();
    // ATOMIC ADOPTION: the trajectory and the configuration it describes are replaced together.
    // SCALES AND TRAJECTORY TOGETHER. Adopting the run without recapturing left the display on
    // scales derived from a DC source the solved run does not have.
    captureBoundsFromTransient(transient, description);
    if (playback) playback.adopt(transient, rate);
    else playback = new SolvedPlayback(transient, rate);
    // AUTOMATIC RESTART IS OFF for this pass. It was on for alternating drives, and even
    // labelled it put a 3.4 V (valve) or 6.8 V (turned around) discontinuity into the capacitor
    // every few seconds — on top of components that were already sweeping the frame. Two
    // unexplained-looking jumps at once is not something a viewer can take apart. The run now
    // stops at its horizon and Replay is an explicit button.
    playback.replayFromRest = false;
    presented = description;
    solverFrame = playback.frame();
    // PAUSE THE PAGE TOO. adopt() pauses the playback, but the frame loop copies the page's
    // transport onto it every frame, so a running page restarted the solve instantly and the
    // authored reset state was never on screen — the status said "Press Run" while it was
    // already running. Both clocks are stopped so the reset frame is actually visible.
    clock.paused = true;
    solverBusy = false;
    paintSolverStatus(`Solved. ${transient.times.length} samples over `
      + `${siUnit(transient.stopSeconds, 's')}. Press Run.`);
    paintSpeedReadout();          // the "per source cycle" reading depends on what was solved
  } catch (e) {
    if (!mine()) return;                           // a newer request owns the UI now
    if (e instanceof Superseded) return;           // a newer edit already replaced this
    solverBusy = false;
    playback = null; solverFrame = null; presented = null;
    solverFault = String(e);
    paintSolverStatus(null);
  }
  if (mine()) paint();
}

function paintSolverStatus(message: string | null): void {
  const on = (el('solver-on') as HTMLInputElement).checked;
  const node = el('solver-status');
  if (!on) { node.textContent = ''; return; }
  if (solverFault) {
    node.textContent = `Solver fault — the scene is NOT being driven. ${solverFault}`;
    return;
  }
  // ONE LINE BESIDE THE SCENE. The standing caveats used to be appended here, so five lines of
  // unchanging text sat directly above the 3D view and helped push the circuit below the fold at
  // an ordinary window size. They are not deleted — they are permanent facts about this mode —
  // but they belong under the scene rather than in front of it.
  node.textContent = (solverBusy ? 'Solving… ' : '') + (message ?? '');
}

/**
 * THE COMPONENT CONTROLS, in the user's terms rather than the solver's.
 *
 * The first version put the diode behind the ngspice checkbox: tick the solver, then a select
 * appears, then choose an orientation. Peter could see the checkbox and not the diode, which is
 * the correct reaction — adding a part to a circuit should not require knowing which engine
 * solves it. `Add a diode` now does the whole setup, and the solver toggle and the raw
 * orientation select stay in a details block for testing them independently.
 */
function paintDiodeControl(): void {
  const orientation = (el('diode-orientation') as HTMLSelectElement).value;
  const present = orientation === 'forward' || orientation === 'reverse';
  (el('diode-mode') as HTMLElement).hidden = !solverRequested;
  (el('add-diode') as HTMLElement).hidden = present;
  (el('diode-actions') as HTMLElement).hidden = !present;
  // The blurb already says what the demonstration does; this only adds the orientation, and
  // only when a device is actually in the loop. An always-present line saying "No diode in the
  // loop" was a row of vertical space spent on an absence.
  const stateText = present
    ? `Diode ${orientation}: anode toward the ${orientation === 'forward' ? 'source' : 'inductor'}.`
      + (isDefaultPart() ? '' : ' Using a model loaded from a file — see details.')
    : '';
  el('diode-state').textContent = stateText;
  (el('diode-state') as HTMLElement).hidden = stateText === '';
  // THE MODEL NOTE LIVES IN THE DETAILS, and does not claim more than is true. It read "inside
  // the validated envelope, but outside the parameter set the domain matrix covers" — which
  // sounds like the model was checked against something, when all it passed was the input
  // limits, and it put matrix jargon in the primary flow. Astra asked for both to change.
  el('diode-model-note').textContent = present && !isDefaultPart()
    ? `This diode came from a loaded file: IS ${activeDiodePart.is}, N ${activeDiodePart.n}, `
      + `RS ${activeDiodePart.rs} Ω, BV ${activeDiodePart.bv} V. Its values are within the `
      + `accepted parameter limits; this model has not been benchmarked here.`
    : '';
}

/**
 * THE DEMONSTRATION BUTTONS.
 *
 * These are the first row above the scene, because "what does it do" is the question the page
 * exists to answer. The row that used to be there was `Add a diode`, which asks the viewer to
 * assemble a circuit before they have been shown one working.
 */
function paintPresets(): void {
  const host = el('preset-buttons');
  if (host.childElementCount === 0)
    for (const preset of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.preset = preset.id;
      b.textContent = preset.label;
      b.onclick = () => choosePreset(preset);
      host.append(b);
    }
  for (const b of [...host.children] as HTMLButtonElement[])
    b.setAttribute('aria-pressed', String(b.dataset.preset === activePreset?.id));
  // The blurb says what to WATCH FOR, and for the one deliberately-still demonstration it says
  // that too — a viewer who has just seen three moving scenes will otherwise read it as broken,
  // which is precisely the report that prompted this whole redesign.
  el('preset-blurb').textContent = activePreset
    ? activePreset.blurb
    : 'Edited from a demonstration — the circuit is whatever the controls now say.';
}

function choosePreset(preset: Preset): void {
  activePreset = preset;
  // A preset SETS the configuration; it does not become it. Everything after this point reads
  // `config`, so the circuit survives the selection being dropped.
  config = configFromPreset(preset);
  // AND IT APPLIES ITS DECLARED SOURCE AND A STATE OF REST, which the first version did not.
  //
  // `configFromPreset` dropped the preset's own `sourceVolts` while `describeCircuit` went on
  // reading `sim.sourceVoltage` and the previous initial conditions. So after the return-path
  // switch had set the source to 0 V, "Forward drop" faithfully demonstrated nothing; and after
  // a run left the capacitor charged, the reversed demonstrations were REFUSED outright by the
  // stored-energy domain guard. A demonstration has to be able to state its own experiment.
  //
  // The viewer's R, L and C are preserved: those are the parts they chose, and a preset that
  // rebuilt them would be showing a circuit nobody assembled.
  const declaredVolts = config.sourceVolts ?? (config.sourceSine ? 0 : sim.inputs.voltage);
  if (!sim.connected) selectSource(true);          // reconnect: every preset drives its own source
  reset({ ...sim.inputs, voltage: declaredVolts, initialVoltage: 0, initialCurrent: 0 });
  // THE FORM HAS TO AGREE WITH WHAT WAS JUST APPLIED, or the panel describes one circuit while
  // the scene shows another — and the next Apply would silently put the old values back.
  (el('voltage') as HTMLInputElement).value = String(declaredVolts);
  (el('initialVoltage') as HTMLInputElement).value = '0';
  (el('initialCurrent') as HTMLInputElement).value = '0';
  // The preset decides whether a diode is in the loop and which way round; the controls stay in
  // step with it, so `Turn it around` continues to mean something afterwards.
  const built = preset.build({ resistanceOhms: sim.resistance,
    inductanceHenries: sim.inputs.inductance, capacitanceFarads: sim.inputs.capacitance });
  activeDiodePart = { ...DIODE_PART };
  (el('diode-orientation') as HTMLSelectElement).value = built.diode?.orientation ?? 'none';
  if (!solverRequested) {
    (el('solver-on') as HTMLInputElement).checked = true;
    solverRequested = true;
    solveGeneration++;
  }
  paintDiodeControl();
  paintPresets();
  void resolveCircuit(`${preset.label}. `);
  el('notice').textContent = preset.blurb;
}

/**
 * A preset is a STARTING POINT, not a mode. Once the viewer changes the circuit it is no longer
 * the demonstration the button names, and the button must stop claiming it — otherwise the row
 * would assert a configuration the scene is not showing.
 */
function leavePreset(): void {
  if (!activePreset) return;
  // ONLY THE CLAIM IS DROPPED. `config` is untouched: the source, the load and the horizon are
  // the circuit, not the label on it, and a one-component edit must not rebuild the experiment.
  activePreset = null;
  paintPresets();
}

/** Add it, and turn on everything it needs. One action, not a prerequisite the user must know. */
el('add-diode').onclick = () => {
  leavePreset();                    // the label stops being true; the circuit does not change
  // ADDING is adding THIS page's part. Turning one around or removing it preserves whatever
  // model is in the loop — including one restored from a file — but "add a diode" means the
  // default device, not silently inheriting parameters from a file loaded earlier.
  activeDiodePart = { ...DIODE_PART };
  (el('diode-orientation') as HTMLSelectElement).value = 'forward';
  if (!solverRequested) {
    (el('solver-on') as HTMLInputElement).checked = true;
    solverRequested = true;
    solveGeneration++;
  }
  paintDiodeControl();
  void resolveCircuit('Diode added. ');
  stage?.focusOnDiode();
  el('notice').textContent = 'Diode added, forward. It conducts one way, so the capacitor can '
    + 'charge past the source and keep the overshoot when the current tries to reverse.';
};
el('flip-diode').onclick = () => {
  // Turning the one-way valve around IS another demonstration, so switch to it rather than
  // dropping out of the row entirely — the pair is the whole point of both.
  const paired = activePreset?.id === 'one-way-valve' ? presetById('turned-around')
    : activePreset?.id === 'turned-around' ? presetById('one-way-valve')
    : activePreset?.id === 'forward-drop' ? presetById('blocking')
    : activePreset?.id === 'blocking' ? presetById('forward-drop') : null;
  if (paired) { choosePreset(paired); stage?.focusOnDiode(); return; }
  const now = (el('diode-orientation') as HTMLSelectElement).value;
  (el('diode-orientation') as HTMLSelectElement).value = now === 'forward' ? 'reverse' : 'forward';
  paintDiodeControl();
  resolveIfSolving('Diode turned around. ');
  stage?.focusOnDiode();
};
el('remove-diode').onclick = () => {
  // REMOVES ONE COMPONENT. It used to clear the preset and, because the drive was read from the
  // preset, silently take the alternating source, the load and the horizon with it — the whole
  // experiment rebuilt by a button that names a single part.
  leavePreset();
  // REMOVED MEANS ABSENT FROM THE NETLIST, not shorted. The solver stays on: it is still the
  // authority for this scene, and switching it off would change what is driving the picture as
  // a side effect of removing a part.
  (el('diode-orientation') as HTMLSelectElement).value = 'none';
  paintDiodeControl();
  resolveIfSolving('Diode removed. ');
  el('notice').textContent = 'Diode removed from the loop entirely — not shorted out.';
};
el('focus-diode').onclick = () => stage?.focusOnDiode();

/** Explicit, and only offered once the run has actually ended. */
el('replay').onclick = () => {
  if (!playback) return;
  playback.reset();
  playback.paused = false;
  clock.paused = false;
  solverFrame = playback.frame();
  paint();
};
/**
 * Live, on `input` rather than `change`, so dragging the slider is felt while dragging it.
 *
 * Re-times the SAME trajectory: nothing is re-solved, the cursor does not move and a paused
 * scene stays paused, because nothing about the circuit has changed. Only how fast the already
 * solved samples are handed to the screen.
 */
el('rate').addEventListener('input', () => {
  if (playback && presented) playback.playbackRate = presented.stopSeconds / playbackWallSeconds();
  paintSpeedReadout();
});

el('diode-orientation').addEventListener('change', () => {
  leavePreset();
  paintDiodeControl();
  resolveIfSolving('Diode changed.');
});

el('solver-on').addEventListener('change', () => {
  solverRequested = (el('solver-on') as HTMLInputElement).checked;
  paintDiodeControl();
  paintSpeedReadout();
  // Turning it off INVALIDATES anything in flight: bumping the generation means a solve that
  // is still running cannot come back and re-enter solved mode behind the viewer.
  solveGeneration++;
  if (!solverRequested) {
    // THE DIODE GOES WITH IT. The analytic kernel solves a linear RLC; leaving "forward"
    // selected while it drives would show a control claiming a device that is not in the
    // circuit being solved. The label already says the solver is needed for a diode — this
    // makes that true rather than advisory.
    (el('diode-orientation') as HTMLSelectElement).value = 'none';
    playback = null; solverFrame = null; presented = null; solverFault = null; solverBusy = false;
    paintSolverStatus(null); paint(); return;
  }
  void resolveCircuit('');
});

/** Anything that changes the circuit the solver was given must re-solve, which restarts. */
function resolveIfSolving(why: string): void {
  if (solverRequested) void resolveCircuit(why);
}

function paint(): void {
  drive = driving();          // ONE instant, threaded through every consumer below
  root.classList.toggle('plate-closeup', !!geometry);
  const current = drive.currentAmps;
  const amps = Math.abs(current);
  // The captured bound, not the old RC widest/R estimate, so the "small" in the readout is
  // small against the current this run actually reaches.
  const fullCurrent = bounds.current > 0 ? bounds.current : 1e-12;
  const drivingVolts = drive.sourceVolts - drive.capacitorVolts;          // across resistor and inductor together
  // From the solver's own inductor terminals when it is driving; from the kernel relation
  // otherwise. Null means genuinely unknown, and the readout must say so.
  const didt = drive.diDt;
  const flowState = didt === null ? 'Reset state · rates not yet solved · '
    : flowExplanation(current, drivingVolts, didt, fullCurrent, vBoundV());
  const value = amps >= 0.001 ? `${Number((amps*1000).toPrecision(3))} mA` : `${Number((amps*1e6).toPrecision(3))} µA`;
  // THE INDUCTOR IS IN THIS LOOP AND MUST BE NAMED. This line used to read
  // 'Source → resistor → capacitor', which is the RC topology, not the circuit being
  // simulated. Whatever the picture shows, the words also have to describe the real series
  // path, or they teach the wrong circuit exactly as the withdrawn schematic did.
  const forward = sim.connected ? 'Source' : 'Return';
  const path = current === 0 ? 'No current'
    : current > 0 ? `${forward} → resistor → inductor → capacitor`
                  : `Capacitor → inductor → resistor → ${sim.connected ? 'source' : 'return'}`;
  el('flow-readout').textContent = `${clock.paused ? 'Paused · ' : ''}${flowState}${path} · ${value}`
    + ` — ${sim.connected ? 'connected to the source; try the return path'
                          : 'discharging into the 0 V return path'}`;
  el('play').textContent = clock.paused ? 'Run' : 'Pause';
  const faulted = driver.faulted;
  const state = faulted !== null ? 'FAULTED — not advancing' : driver.advancing ? 'Running' : 'Paused';
  const simT = sim.simulatedSeconds;
  el('clock').textContent = `${state} · tick ${sim.tick} · simulated ${simT < 1e-3 ? simT.toExponential(3) : simT.toFixed(3)} s`
    + ` · interval ${sim.dt.toExponential(2)} s · playback ×${clock.playback.toExponential(2)} sim s per wall s`
    + ` · dropped ${clock.droppedSeconds.toExponential(2)} s`;
  if (faulted !== null) {
    el('notice').textContent = `FAULT: ${faulted} — advancing is stopped. The interval that threw may have `
      + 'left the model PARTIALLY updated, so this state is not trustworthy and was not skipped safely. '
      + 'Run and One tick are blocked. Press Apply & reset or Restart to start a fresh experiment.';
  }
  {
    const zeta = sim.resistance / sim.criticalResistance;
    const slider = el('damping') as HTMLInputElement;
    if (document.activeElement !== slider) slider.value = String(Math.round(zeta * 1000));
    el('damping-readout').textContent =
      `ζ = ${Number(zeta.toPrecision(3))} · ${Number(sim.resistance.toPrecision(3))} Ω · ${sim.regime}`;
  }
  el('charge').setAttribute('aria-pressed', String(sim.connected)); el('discharge').setAttribute('aria-pressed', String(!sim.connected));
  // OFFERED EXACTLY WHEN IT MEANS SOMETHING: at the end of a run, and never mid-run.
  (el('replay') as HTMLElement).hidden = !(drive.mode === 'solved' && !!playback
    && playback.atHorizon);
  el('scene-time').innerHTML = drive.mode === 'kernel'
    ? `${clock.paused ? 'Paused' : 'Running'} · ${timeLabel(drive.seconds)}`
    : drive.mode === 'fault' ? 'Solver faulted · showing reset, not being driven'
    : drive.mode === 'busy' ? 'Solving · scene held'
    // THE REPLAY IS NAMED. An alternating demonstration restarts from rest when it ends, and the
    // viewer has to be told that rather than left to read a several-volt jump in the capacitor as
    // something the circuit did. Measured, that jump is 36% and 73% of these runs' voltage span.
    : `${solverFrame!.state === 'at-horizon' ? 'End of solved run'
        : solverFrame!.state === 'before-start' ? 'At reset'
        : playback!.paused ? 'Paused' : 'Running'} · ${timeLabel(drive.seconds)}`
      + `${playback && playback.replays > 0
        ? ` · run ${playback.replays + 1}, restarted from rest` : ''} · solved playback`;
  el('headline').innerHTML = `<div><small>CAPACITOR</small><strong>${Number(drive.capacitorVolts.toPrecision(3))} <em>V</em></strong></div><div><small>${sim.regime.toUpperCase()} · DAMPING ζ = R / 2√(L/C)</small><strong>${
    Number((sim.resistance / sim.criticalResistance).toPrecision(3))}</strong></div>`;
  resistorLens.update({ voltageDrop: drive.sourceVolts - drive.capacitorVolts, current: drive.currentAmps,
    resistance: sim.inputs.resistance,
    currentReference: Math.max(Math.abs(sim.inputs.voltage - sim.inputs.initialVoltage), Math.abs(sim.inputs.voltage), Math.abs(sim.inputs.initialVoltage)) / sim.inputs.resistance,
    paused: clock.paused });
  // A FROZEN SCENE IS NOT REBUILT AT ALL.
  //
  // Freezing the numeric description was not enough: the plates read the live plate geometry,
  // the coil and pickup read the live package and its mutual inductance, and the height scale
  // reads the live bounds. Since the frozen branch still repaints, a geometry edit during a
  // solve would draw a NEW winding and a NEW M against the OLD trajectory — while the page
  // said "frozen". The whole scene is therefore left exactly as it was until a trajectory and
  // its configuration are adopted together.
  if (!drive.frozen) {
    paintPlateCharge();
    paintStage();
  }
  // `null` means UNAVAILABLE IN THIS MODE, printed as a stated absence rather than a number.
  const quantities: Array<[string, number | null, string]> = [
    // DIRECTLY KNOWN in either mode: ½CV₀² + ½LI₀² from the authored start. I had marked this
    // unavailable along with the true integrals, which was wrong — it is not a history.
    ['Initial stored energy · electric + magnetic',
      0.5 * drive.capacitanceF * drive.initialVolts ** 2
      + 0.5 * drive.inductanceH * drive.initialAmps ** 2, 'J'],
    // Stored energies ARE readable from a single sample, so they stay available in both modes.
    ['Capacitor energy · ½CV²', drive.storedC, 'J'],
    ['Inductor energy · ½Li²', drive.storedL, 'J'],
    // CUMULATIVE INTEGRALS. Available only from the kernel, which accumulates them; a solved
    // snapshot carries one instant and cannot supply them. Marked unavailable rather than
    // painted with the last analytic values, which would be a different circuit's history.
    ['Source work · signed', drive.cumulativeAvailable ? sim.sourceWork : null, 'J'],
    ['Receiver heat / resistor transfer', drive.cumulativeAvailable ? sim.receiverHeat : null, 'J'],
    ['RC chassis temperature', drive.cumulativeAvailable ? sim.temperature : null, 'K'],
    ['Balance residual', drive.cumulativeAvailable ? sim.residual : null, 'J'],
  ];
  el('energy').innerHTML = quantities.map(([label, value, unit]) =>
      `<div class="quantity"><span>${label}</span><b>${value === null
        ? 'unavailable in solved mode' : `${fmt(value)} ${unit}`}</b></div>`).join('')
    + (drive.cumulativeAvailable
      ? `<p class="${Math.abs(sim.residual) <= sim.tolerance ? 'balanced' : 'failed'}">Initial + source work − stored − receiver heat = residual. Acceptance bound: ${fmt(sim.tolerance)} J.</p>`
      : `<p class="hint">The energy balance is an integral over the whole run. A solved`
        + ` transient carries one instant at a time, so source work, dissipated heat, chassis`
        + ` temperature and the residual are not computed here — they are not zero, they are`
        + ` not measured. Stored energies above come from the current sample.</p>`);
  // From the CAPTURED bound, not the RC hull — the trace cropped the 13.7 V overshoot when
  // its axis stopped at the source voltage. The window is five of the model's own decay
  // times: 2L/R is only the UNDERDAMPED envelope, and overdamped the slow root dominates
  // and tends to R·C, so using the envelope figure everywhere understated settling badly.
  // The range must CONTAIN THE SAMPLES IT DRAWS. A source switch recaptures the bound, and
  // the new bound need not cover samples plotted under the old one, so the plotted extrema
  // are folded in rather than clipped off the axis.
  const seen = history.reduce(
    (r, [, v]) => ({ lo: Math.min(r.lo, v), hi: Math.max(r.hi, v) }),
    { lo: bounds.lo, hi: bounds.hi });
  const low = seen.lo, high = seen.hi;
  const decay = sim.decayTime;   // regime-aware: envelope when ringing, slow root when not
  const span = high - low || 1, t0 = history[0][0], t1 = Math.max(t0 + 5 * decay, history[history.length - 1][0]);
  const x = (t: number) => 55 + (t - t0) / (t1 - t0) * 560;
  const y = (v: number) => 165 - (v - low) / span * 140;
  el('trace-scale').textContent = `${fmt(low)} to ${fmt(high === low ? low + 1 : high)} V · ${fmt(t0)} to ${fmt(t1)} s. Voltage axis covers the captured display bound and every plotted sample; time window follows the run.`;
  el('trace').innerHTML = `<path class="axis" d="M55 20V165H620"/><path class="zero" d="M55 ${y(0)}H620"/>
    <text x="48" y="29" text-anchor="end">${fmt(low + span)} V</text><text x="48" y="168" text-anchor="end">${fmt(low)} V</text>
    <polyline points="${history.map(([t, v]) => `${x(t).toFixed(2)},${y(v).toFixed(2)}`).join(' ')}"/>
    ${predictionMarkup(x, y, t0, t1)}
    <circle cx="${x(sim.simulatedSeconds)}" cy="${y(sim.voltage)}" r="4"/><text x="55" y="191">${fmt(t0)} s</text><text x="615" y="191" text-anchor="end">${fmt(t1)} s</text>`;
  // HISTORY IS THE KERNEL'S. The trace accumulates as the analytic model steps; a solved
  // transient is never fed into it, so in solved mode the curve above belongs to a previous
  // run and would sit under the new run's readouts. Replaced by a statement, not left stale.
  if (drive.mode !== 'kernel')
    el('trace').innerHTML = '<p class="hint">The voltage trace is recorded as the analytic '
      + 'model steps. In solved mode the run arrives from ngspice as a whole transient and is '
      + 'not accumulated here, so no trace is drawn: unavailable, not empty.</p>';
  paintPredictionPanel();
}
/**
 * THE FRAME LOOP.  Three defects were found here in review; all three are fixed
 * below and each fix is load-bearing. See D-50.
 *
 * 1. `last` was seeded with `performance.now()` DURING MODULE EVALUATION, but the
 *    timestamp handed to a rAF callback is the time THE FRAME BEGAN — which can
 *    precede it. Measured here at -4.5 ms. That fed a NEGATIVE interval to
 *    `RcClock.advance`, whose guard correctly threw. The guard is right; handing
 *    it a negative was wrong. `last` is now seeded FROM THE FIRST FRAME, and any
 *    residual negative is clamped to zero rather than passed on.
 *
 * 2. `requestAnimationFrame(frame)` was the LAST statement, so ANY throw above it
 *    ended the loop FOREVER. A 4.5 ms timing race became a permanently dead page.
 *    It is now re-registered FIRST, so the loop survives any single bad frame.
 *
 * 3. A dead loop still reported "Running", because the status line read
 *    `clock.paused` rather than whether the clock was actually advancing. A frame
 *    error is now SURFACED instead of being silently true-but-stopped.
 */
/**
 * THE RC SCENE, in the project's ONE visual language (VISUAL-SYSTEM-v1).
 *
 * A schematic shows that a capacitor is present. THIS shows what it is DOING: its
 * terrace CLIMBS toward the source as it charges, the resistor branch FLATTENS as
 * the drop across it shrinks, and the markers SLOW TO A STOP as the current dies.
 * That is the transient, drawn as the thing itself rather than as a symbol with a
 * number beside it.
 *
 * TWO DIFFERENT QUANTITIES, deliberately not duplicated:
 *   the TERRACE HEIGHT is the capacitor's VOLTAGE;
 *   the STORE FILL is its stored ENERGY, which goes as V^2.
 * So the vessel fills more slowly than the level rises at first and then catches
 * up, which is exactly the relationship that is invisible on a schematic.
 *
 * The height axis is FIXED to the authored voltages, so the climb is a climb
 * against a steady axis rather than a rescaling that hides its own motion.
 */
/**
 * GC1 — GEOMETRY MODE. Off by default, so the existing directly-authored ideal
 * capacitor is preserved exactly. When on, C is DERIVED from plate geometry and the
 * capacitance field becomes a readout rather than a second editable authority.
 */
let geometry: PlateGeometry | null = null;
/** Declared, printed, never hidden: how much the drawn gap is magnified. */
const GAP_EXAGGERATION = 30;

/**
 * PREDICT-THEN-RUN.
 *
 * Astra's plan put pause/replay and pinned comparison next. I argued the order was
 * wrong: those are INSPECTION tools, and careful inspection is what an
 * already-invested person does — it does not create the investment. Astra agreed.
 *
 * The mechanism here is that a WRONG prediction creates a felt gap. You commit to
 * where the voltage will be at one time constant BEFORE running, your guess stays
 * on screen next to the truth, and watching becomes answering.
 *
 * It states no new physics. The answer was always Vs + (Vc0 - Vs)(1 - e^-1); this
 * only asks you first.
 */
let prediction: number | null = null;
let predictionLocked = false;
/** The truth at one tau, captured the moment the run first passes it. */
let predictionOutcome: { predicted: number; actual: number; atSeconds: number } | null = null;

let stage: PotentialScene | null = null;
const SRC = 'rc-source', CAP = 'rc-cap', GND = 'rc-gnd', MID = 'rc-mid';
/** The anode-side node `na`. It EXISTS only when a diode does; otherwise na and n2 are one node. */
const ANODE = 'rc-anode';

/**
 * THE ENERGY DISPLAY BOUND — ONE definition, from AUTHORED inputs only.
 *
 * Two defects lived here, and Astra diagnosed the real cause after I had guessed
 * the wrong one. I reported "floating point pushes the fraction above 1"; that is
 * not it. If the value and the bound are the same double with min = 0 the fraction
 * is exactly 1. What actually happened:
 *
 *   1. the bound was derived from a span that INCLUDED THE LIVE Vc, so it chased
 *      the value and the two met at full charge;
 *   2. the bound computed `C * vScale * vScale / 2` while the model computes
 *      `C * voltage ** 2 / 2` — the SAME quantity by a DIFFERENT ROUTE, which can
 *      differ in the last bit and tip a comparison over.
 *
 * So: authored bounds only, and the SAME expression form the model uses. Vc cannot
 * exceed max(|Vs|, |Vc0|) because it stays inside the convex hull of {Vc0, Vs, 0},
 * so this is a real bound rather than a hopeful one.
 *
 * Deliberately NO epsilon in the gauge: a tolerance there would hide genuine
 * overflow, which matters most for the tiny energies this experiment now reaches.
 */
/**
 * DISPLAY BOUNDS, CAPTURED — not the RC convex hull, which is FALSE once an inductor is in
 * the loop. RC-1 could bound |Vc| by max(|Vs|,|Vc0|); this circuit overshoots past the
 * source (13.7 V against 10 V on the opening run), so that bound silently clamped the
 * charge strips to 100% and cropped the trace.
 *
 * The replacement is exact. For constant Vs and any R ≥ 0 the error energy
 * E = C·u² + L·i² (u = Vc − Vs) can only fall, so from the state at any source change:
 *      |Vc − Vs| ≤ √(u₀² + (L/C)·i₀²)        |i| ≤ √(i₀² + (C/L)·u₀²)
 * and the resistor→inductor node, Vs − i·R, is bounded by |Vs| + R·Î.
 *
 * Captured ONLY at a reset or a source switch, and held in between, so no scale chases the
 * value it is displaying. R is live, so the node bound uses the LARGEST R since reset — a
 * scale must not shrink under a value already drawn against it.
 */
/**
 * THE COIL, WHEN THERE IS ONE.
 *
 * Two modes, and the difference is not cosmetic:
 *
 *  GEOMETRIC — a real air-core winding. Its dimensions produce the inductance the circuit
 *  uses, and the drawn field is that winding's field, solved once by Biot–Savart. The coil on
 *  screen IS the inductor in the equations.
 *
 *  PHENOMENOLOGICAL — an authored inductance with no geometry behind it. This is what every
 *  saved file from before this change contains, so those files still load and still run. The
 *  solved field is simply UNAVAILABLE in this mode: there is no winding to compute it from,
 *  and drawing an authored field beside an authored inductance is what Peter called faked.
 *  Nothing rewrites a stored L, and nothing rejects an old file.
 *
 * The package is built ONCE per geometry. Nothing here is evaluated per frame; the renderer
 * takes the signed current from the simulation snapshot and reads the rest.
 */
let coilPackage: CoilPackage | null = null;
/** Scene units per metre for the coil. Its own metric, because the scene's y axis means volts. */
const COIL_SCENE_UNITS_PER_METRE = 20;

function coilRender(): CoilRender | undefined {
  if (!coilPackage) return undefined;
  return {
    radiusM: coilPackage.geometry.radius,
    turnPositionsM: coilPackage.turnPositionsM,
    wireRadiusM: coilPackage.geometry.wireRadius,
    fieldLines: coilPackage.fieldLines.map((l) => ({ points: l.points, stop: l.stop })),
    sceneUnitsPerMetre: COIL_SCENE_UNITS_PER_METRE,
    inductanceH: coilPackage.inductanceH,
    pickup: coilPackage.pickup && {
      radiusM: coilPackage.pickup.geometry.radius,
      separationM: coilPackage.pickup.geometry.separation,
      orientationDeg: coilPackage.pickup.geometry.orientation,
      mutualH: coilPackage.pickup.mutualH,
      // di/dt from the circuit, not from differencing samples: L·di/dt = Vs − Vc − i·R.
      // di/dt comes from whichever authority is driving, and is NULL when unknown — at the
      // reset frame there is no rate yet, and a pickup showing 0 V there would be a confident
      // wrong number rather than an absent one.
      terminalV: drive.diDt === null ? null
        : pickupTerminalVoltage(coilPackage.pickup.mutualH, drive.diDt),
      fluxWb: fluxLinkage(coilPackage.pickup.mutualH, drive.currentAmps),
      // Full scale from the RUN's captured current bound, so the bar does not rescale itself
      // every frame — a gauge whose scale follows its own reading shows nothing.
      // From the run's MEASURED di/dt extreme when there is one; the (i·R + Vc)/L inequality
      // only stands in for it in kernel mode, where no trajectory exists to measure.
      indicatorFullScaleV: Math.abs(coilPackage.pickup.mutualH)
        * Math.max(1e-12, bounds.diDt
          ?? (bounds.current * sim.resistance + vBoundV()) / sim.inputs.inductance),
    },
  };
}

/**
 * THE SOLVED-CIRCUIT MODE.
 *
 * The analytic kernel is exact and stays the default, but it can only solve a LINEAR circuit.
 * A diode is not linear, so a nonlinear-capable solver has to become the authority — and the
 * honest way to introduce it is to run the circuit we already have an exact answer for through
 * it first, and prove the scene looks the same.
 *
 * SOLVE-THEN-PLAY, not step-by-step. The whole transient is solved in about 30 ms, so playback
 * is lookup into an immutable result. Pause, step and speed therefore CANNOT affect the physics
 * — not by discipline, but because none of them reaches a solver. The cost is that changing the
 * circuit RESTARTS rather than continues, and the page says so rather than quietly reloading.
 */
let solverRequested = false;
/** Increments on every solve request and on turning the solver off, so a late completion or a
 *  stale rejection cannot touch the UI belonging to a newer one. */
let solveGeneration = 0;
let spice: SpiceClient | null = null;
let playback: SolvedPlayback | null = null;
let solverFrame: PlaybackFrame | null = null;
/** The description the CURRENT trajectory was solved for. Replaced atomically with it. */
let presented: CircuitDescription | null = null;
let solverFault: string | null = null;
let solverBusy = false;

/**
 * WHICH AUTHORITY IS DRIVING, and it is not a boolean.
 *
 * 'kernel'  the analytic solution, exact and linear-only. The default.
 * 'solved'  a solved transient is playing.
 * 'busy'    a solve is in flight. A valid trajectory may still exist; the picture is HELD.
 * 'fault'   the solve failed. There is NO trajectory: the page presents the authored reset,
 *           scene included, and says it is not being driven.
 *
 * NEITHER FALLS BACK TO THE KERNEL. My first version tested one boolean, so the instant a solve
 * was in flight the whole scene silently reverted to analytic numbers while the page still
 * claimed to be solver-driven — a different circuit's answer, with no indication.
 */
export type DriveMode = 'kernel' | 'solved' | 'busy' | 'fault';
/**
 * Does the presented trajectory still describe the circuit on screen?
 *
 * Ordering alone cannot answer this. An edit calls reset(), which repaints, BEFORE the re-solve
 * is even requested — so for one paint the scene was rebuilt with the NEW coil, the NEW mutual
 * inductance and the NEW inductance label while still showing the OLD trajectory's numbers.
 * Caught with a deterministic latch: the label moved from 18.85 µH to 41.58 µH while the page
 * said "scene held". Comparing the live description against the presented one makes staleness
 * structural instead of a race.
 */
function presentedMatchesInputs(): boolean {
  if (!presented) return false;
  const live = describeCircuit();
  return presented.sourceVolts === live.sourceVolts
    && presented.resistanceOhms === live.resistanceOhms
    && presented.inductanceHenries === live.inductanceHenries
    && presented.capacitanceFarads === live.capacitanceFarads
    && presented.initialCapacitorVolts === live.initialCapacitorVolts
    && presented.initialInductorAmps === live.initialInductorAmps
    && presented.coilSignature === live.coilSignature
    // THE DIODE IS PART OF THE PRESENTED CIRCUIT. Comparing only the linear values would let a
    // diode be inserted, removed or turned around while the previous trajectory kept playing —
    // the same class of bug as the coil signature, and a much more visible one, since forward
    // and reverse differ by nine orders of magnitude in current.
    && presented.diode?.orientation === live.diode?.orientation;
}

function driveMode(): DriveMode {
  if (!solverRequested) return 'kernel';
  if (solverFault) return 'fault';
  // Stale: the inputs have moved on and the replacement has not arrived. Hold the picture.
  if (solverFrame && !presentedMatchesInputs()) return 'busy';
  // BUSY WINS OVER A STALE FRAME. I wrote `solverBusy ? 'solved' : 'solved'` — a ternary with
  // two identical branches — so a REPLACEMENT solve never registered as busy and the old
  // trajectory kept playing under the new circuit's controls.
  if (solverBusy) return 'busy';
  if (!solverFrame) return 'busy';
  return 'solved';
}

/**
 * EVERY DYNAMIC QUANTITY THE SCENE DRAWS, from ONE instant.
 *
 * Built once per paint and threaded through, so no consumer can be left on the other source.
 * The previous design was a set of separate accessors and I migrated only two of them, then
 * described the scene as fully migrated — while the terraces, branch currents, plates, coil,
 * pickup, charge strips and resistor lens were all still reading the kernel. Text could say
 * 10.2 V beside a scene showing analytic zero.
 */
interface Driving {
  mode: DriveMode;
  sourceVolts: number;
  capacitorVolts: number;
  currentAmps: number;
  /** Node between the resistor and what follows it. Null when not solved. */
  midVolts: number | null;
  /**
   * THE ANODE-SIDE NODE `na`, and the diode read from the same instant.
   *
   * `diode: null` means the presented circuit has no diode at all — the bypass — so the scene
   * draws no component and no extra node, rather than drawing a short. `state: null` means the
   * device IS in the circuit but this frame cannot say what it is doing: the authored reset of a
   * solved run carries no node voltages. Drawn as present and unknown, never as off.
   */
  anodeVolts: number | null;
  diode: { orientation: DiodeOrientation; state: DiodeState | null } | null;
  /** Null when genuinely unknown — at reset, or when no solved frame exists. */
  diDt: number | null;
  /**
   * The load across the capacitor, ohms, or null when there is none.
   *
   * Carried on the snapshot rather than read from the live form, for the same reason every other
   * configuration value here is: the trajectory and the circuit it describes must travel
   * together, or the scene splits the capacitor's current using a load the run did not have.
   */
  loadOhms: number | null;
  storedC: number;
  storedL: number;
  seconds: number;
  /** Cumulative integrals: heat, source work, residual, temperature. */
  cumulativeAvailable: boolean;
  /** True when the scene is frozen because the solver is busy or faulted. */
  frozen: boolean;
  /**
   * THE CONFIGURATION THIS FRAME BELONGS TO, not the live form.
   *
   * The inputs change the instant an edit is applied, while the solved frame is replaced only
   * when the new solve returns. In between, drawing an old voltage against a new capacitance
   * gives a charge that belongs to neither run — the numbers and the circuit they describe must
   * travel together.
   */
  capacitanceF: number;
  inductanceH: number;
  resistanceOhm: number;
  initialVolts: number;
  initialAmps: number;
}

function driving(): Driving {
  const mode = driveMode();
  if (mode === 'kernel') {
    return {
      mode, sourceVolts: sim.sourceVoltage, capacitorVolts: sim.voltage, currentAmps: sim.current,
      midVolts: sim.sourceVoltage - sim.current * sim.resistance,
      // The analytic kernel solves a LINEAR RLC. It has no diode and cannot acquire one, so
      // this is not "unknown" — it is absent, and the control is reset when the solver is
      // switched off precisely so the two can never disagree.
      anodeVolts: sim.sourceVoltage - sim.current * sim.resistance, diode: null,
      // The analytic kernel solves a plain series RLC and has no load branch.
      loadOhms: null,
      diDt: primaryDiDt(sim.sourceVoltage, sim.voltage, sim.current, sim.resistance,
        sim.inputs.inductance),
      storedC: sim.storedCapacitor, storedL: sim.storedInductor,
      seconds: sim.simulatedSeconds, cumulativeAvailable: true, frozen: false,
      capacitanceF: sim.inputs.capacitance, inductanceH: sim.inputs.inductance,
      resistanceOhm: sim.resistance, initialVolts: sim.inputs.initialVoltage,
      initialAmps: sim.inputs.initialCurrent,
    };
  }
  const f = solverFrame;
  if (!f) {
    // Nothing solved yet. Report the AUTHORED start rather than kernel values, and freeze.
    return {
      mode, sourceVolts: sim.sourceVoltage, capacitorVolts: sim.inputs.initialVoltage,
      currentAmps: sim.inputs.initialCurrent, midVolts: null, diDt: null,
      anodeVolts: null,
      loadOhms: presented?.loadResistanceOhms ?? null,
      diode: presented?.diode
        ? { orientation: presented.diode.orientation, state: null } : null,
      storedC: 0.5 * sim.inputs.capacitance * sim.inputs.initialVoltage ** 2,
      storedL: 0.5 * sim.inputs.inductance * sim.inputs.initialCurrent ** 2,
      // No trajectory: present the authored reset, and let the scene be rebuilt to match it.
      seconds: 0, cumulativeAvailable: false, frozen: mode === 'busy',
      capacitanceF: sim.inputs.capacitance, inductanceH: sim.inputs.inductance,
      resistanceOhm: sim.resistance, initialVolts: sim.inputs.initialVoltage,
      initialAmps: sim.inputs.initialCurrent,
    };
  }
  return {
    mode,
    sourceVolts: f.sourceVolts ?? sim.sourceVoltage,
    capacitorVolts: f.capacitorVolts,
    currentAmps: f.currentAmps,
    // n2, the inductor's own terminal — NOT `na`, which is the anode side of the diode.
    midVolts: f.inductorInVolts,
    anodeVolts: f.afterResistorVolts,
    loadOhms: presented?.loadResistanceOhms ?? null,
    // READ, not modelled: `diodeState` takes the two node voltages and the branch current the
    // solver returned. The orientation comes from the PRESENTED description, so the reading and
    // the placement it is read through always belong to the same solve.
    diode: presented?.diode && f.afterResistorVolts !== null && f.inductorInVolts !== null
        && f.sourceVolts !== null
      ? {
          orientation: presented.diode.orientation,
          state: diodeState({
            timeSeconds: f.timeSeconds, currentAmps: f.currentAmps,
            capacitorVolts: f.capacitorVolts, sourceVolts: f.sourceVolts,
            afterResistorVolts: f.afterResistorVolts, inductorInVolts: f.inductorInVolts,
            inductorVolts: f.inductorVolts ?? 0, diDtAmpsPerSecond: f.diDtAmpsPerSecond ?? 0,
            capacitorJoules: f.capacitorJoules, inductorJoules: f.inductorJoules,
          }, presented.diode.orientation),
        }
      : presented?.diode
        ? { orientation: presented.diode.orientation, state: null } : null,
    diDt: f.diDtAmpsPerSecond,
    storedC: f.capacitorJoules,
    storedL: f.inductorJoules,
    seconds: f.timeSeconds,
    // NOT AVAILABLE from a sample: heat, source work and the residual are integrals over the
    // whole history, which the kernel accumulates and a snapshot does not carry.
    cumulativeAvailable: false,
    // FROZEN MEANS BUSY, not faulted. Busy still has a valid trajectory and is merely waiting,
    // so the whole picture is held. A FAULT has no trajectory at all: the readouts drop to the
    // authored reset, and the scene must be rebuilt to match — holding the old picture while
    // the numbers say reset is the mixed state this design exists to prevent, and I created it.
    frozen: mode === 'busy',
    // From the PRESENTED description — the one this trajectory was solved for — so a pending
    // edit cannot pair a new capacitance with an old voltage.
    capacitanceF: presented?.capacitanceFarads ?? sim.inputs.capacitance,
    inductanceH: presented?.inductanceHenries ?? sim.inputs.inductance,
    resistanceOhm: presented?.resistanceOhms ?? sim.resistance,
    initialVolts: presented?.initialCapacitorVolts ?? sim.inputs.initialVoltage,
    initialAmps: presented?.initialInductorAmps ?? sim.inputs.initialCurrent,
  };
}

let drive: Driving = {
  mode: 'kernel', sourceVolts: 0, capacitorVolts: 0, currentAmps: 0, midVolts: 0, diDt: 0,
  anodeVolts: 0, diode: null, loadOhms: null,
  storedC: 0, storedL: 0, seconds: 0, cumulativeAvailable: true, frozen: false,
  capacitanceF: 1, inductanceH: 1, resistanceOhm: 1, initialVolts: 0, initialAmps: 0,
};

let bounds: { voltage: number; current: number; node: number; rMax: number; lo: number;
              hi: number; inductorCurrent?: number; diDt?: number | null } =
  { voltage: 10, current: 0.1, node: 10, rMax: 0, lo: 0, hi: 10 };
/**
 * DISPLAY SCALES FROM THE SOLVED TRAJECTORY, computed once when it is adopted.
 *
 * `captureBounds` derives every scale from the DC source setting and the authored initial
 * conditions — which is right for the analytic kernel, whose future really is determined by
 * those. It is WRONG for a solved run driven by a sine: those presets set the DC source to 0 and
 * start from rest, so `Vs`, `u0` and `i0` are all zero, the stored energy is zero, and every
 * scale collapses with them. The result was a height axis reading 0 V at every tick, a current
 * full-scale falling back to its 1e-12 floor, a pickup scale of ±1.197 fV and stores drawn at
 * nothing — on a run that swings ±10 V. Astra found it in a screenshot I had looked at and
 * dismissed as cosmetic.
 *
 * The trajectory is immutable once adopted, so its own extrema are the honest scales and they
 * can be taken once and held for the life of the run — through replay, pause and stepping alike.
 *
 * WHAT THESE BOUNDS ARE: the range this SOLVED RUN actually covers, over its horizon. They are
 * not a claim about where the circuit would go given longer, which is what the kernel's bounds
 * assert; a different horizon is a different run and gets different scales.
 */
function captureBoundsFromTransient(t: Transient, presented: CircuitDescription): void {
  let lo = 0, hi = 0, peakCurrent = 0, peakCap = 0, peakNode = 0;
  const channels = [t.sourceVolts, t.afterResistorVolts, t.inductorInVolts, t.capacitorVolts];
  for (const channel of channels)
    for (let k = 0; k < channel.length; k++) {
      const v = channel[k];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      const a = Math.abs(v);
      if (a > peakNode) peakNode = a;
    }
  for (let k = 0; k < t.capacitorVolts.length; k++)
    peakCap = Math.max(peakCap, Math.abs(t.capacitorVolts[k]));
  // EVERY BRANCH CURRENT THE SCENE DRAWS, not just the inductor's. With a load across the
  // capacitor the scene draws three: i_L, i_load = Vc/RL, and i_C = i_L − i_load. Scaling them
  // all against i_L alone saturates the others whenever they exceed it — which a loaded initial
  // charge does immediately, since Vc/RL starts large while i_L starts at zero.
  const load = presented?.loadResistanceOhms;
  for (let k = 0; k < t.currents.length; k++) {
    const iL = t.currents[k];
    peakCurrent = Math.max(peakCurrent, Math.abs(iL));
    if (load !== undefined && load > 0) {
      const iLoad = t.capacitorVolts[k] / load;
      peakCurrent = Math.max(peakCurrent, Math.abs(iLoad), Math.abs(iL - iLoad));
    }
  }
  // THE COIL KEEPS ITS OWN SCALE, tied to the inductor branch. Its drawn field strength is a
  // statement about the current in the winding, so widening it to cover a load branch that does
  // not pass through the coil would understate the field it actually produces.
  let peakInductor = Math.abs(t.initialState.currentAmps);
  for (let k = 0; k < t.currents.length; k++)
    peakInductor = Math.max(peakInductor, Math.abs(t.currents[k]));
  // AND THE PICKUP'S RULER FROM THE ACTUAL di/dt EXTREMA. It was estimated as
  // (peak i · R + peak Vc) / L — an inequality standing in for a derivative, from a topology
  // that no longer holds once a diode and a load are in the loop. The inductor's own terminal
  // voltage over L is the derivative itself, and the trajectory carries it.
  let peakDiDt = 0;
  for (let k = 0; k < t.inductorVolts.length; k++)
    peakDiDt = Math.max(peakDiDt, Math.abs(t.inductorVolts[k]));
  peakDiDt /= t.inductanceHenries;
  // The authored start is part of the run even though the solver never returns t = 0.
  peakCap = Math.max(peakCap, Math.abs(t.initialState.capacitorVolts));
  // THE AUTHORED START'S BRANCHES TOO, all three of them. This took only the initial inductor
  // current while the comment above claimed every branch — harmless for the presets, which all
  // start from rest, and wrong for a loaded run started with charge on the capacitor, where
  // Vc0/RL is large at t = 0 while i_L is still zero. Astra caught the comment outrunning the code.
  {
    const i0 = t.initialState.currentAmps, vc0 = t.initialState.capacitorVolts;
    peakCurrent = Math.max(peakCurrent, Math.abs(i0));
    if (load !== undefined && load > 0)
      peakCurrent = Math.max(peakCurrent, Math.abs(vc0 / load), Math.abs(i0 - vc0 / load));
  }
  lo = Math.min(lo, t.initialState.capacitorVolts);
  hi = Math.max(hi, t.initialState.capacitorVolts);
  // A GENUINELY ALL-ZERO RUN is a real outcome — a 0 V source from rest with nothing in the loop
  // — and it still has to be drawable. Falling back to a stated 1 V / 1 µA keeps the axis
  // meaningful instead of dividing by nothing, and the legend prints whatever is used.
  const flat = hi - lo < 1e-12;
  bounds = {
    voltage: peakCap > 0 ? peakCap : 1,
    current: peakCurrent > 0 ? peakCurrent : 1e-6,
    node: peakNode > 0 ? peakNode : 1,
    rMax: sim.resistance,
    lo: flat ? -1 : lo,
    hi: flat ? 1 : hi,
    inductorCurrent: peakInductor > 0 ? peakInductor : 1e-6,
    diDt: peakDiDt > 0 ? peakDiDt : null,
  };
}

function captureBounds(fresh: boolean): void {
  const Vs = sim.sourceVoltage, u0 = sim.voltage - Vs, i0 = sim.current;
  const { capacitance: C, inductance: L } = sim.inputs;
  const e = C * u0 * u0 + L * i0 * i0;
  const D = Math.sqrt(e / C), I = Math.sqrt(e / L);
  const rMax = fresh ? sim.resistance : Math.max(bounds.rMax, sim.resistance);
  bounds = {
    voltage: Math.abs(Vs) + D,
    current: I,
    node: Math.abs(Vs) + rMax * I,
    rMax,
    lo: Math.min(0, Vs - D, Vs - rMax * I),
    hi: Math.max(0, Vs + D, Vs + rMax * I),
  };
}

/** V. The largest |Vc| this run can reach, from the captured bound. */
function vBoundV(): number { return bounds.voltage; }
/**
 * J. ONE SCALE SHARED BY BOTH VESSELS.
 *
 * Giving each store its own full-scale made the electric range four times the magnetic one,
 * so a joule in the capacitor drew a different height from a joule in the inductor — and
 * energy moving between them was exactly what the pair exists to show. A shared scale is
 * what makes the exchange legible, and it is printed.
 */
function displaySharedEnergyJ(): number {
  if (bounds.voltage === 0 && bounds.current === 0) return 1;   // all-zero authored case, stated in the legend
  const electric = (sim.inputs.capacitance * bounds.voltage ** 2) / 2;
  const magnetic = (sim.inputs.inductance * bounds.current ** 2) / 2;
  return Math.max(1e-30, electric, magnetic);
}

function rcSpec(): SceneSpec {
  // THE SAME INSTANT the readouts use. These were sim.* while the headline had migrated,
  // so the text could read 10.2 V beside a scene drawn from analytic values.
  const Vs = drive.sourceVolts, Vc = drive.capacitorVolts, I = drive.currentAmps;
  // From the captured bound, and INCLUDING the resistor→inductor node. Live Vc is
  // deliberately NOT an input here: feeding it in rescaled the height while ringing.
  const lo = bounds.lo;
  const hi = bounds.hi;
  // THE LARGEST CURRENT THIS RUN CAN REACH, from AUTHORED INPUTS ONLY.
  //
  // My first attempt took max(authored, |I now|), which is still dynamic: it grows
  // when discharge makes the gap larger than the charging gap, so a falling current
  // stayed full width for part of the discharge. Astra derived the correct bound:
  // Vc always stays inside the convex hull of {Vc0, Vs, 0}, because charging pulls
  // it toward Vs and discharging pulls it toward 0. The largest gap that can ever
  // appear across R is therefore
  //     max(|Vs - Vc0|, |Vs|, |Vc0|) / R
  // over this slice's arbitrary charge/discharge toggling. Nothing live enters it.
  // All-zero is a real authored case (0 V source, 0 V start): there is no current to
  // scale against, so the scale is stated as a floor rather than left at zero.
  const fixedFullI = bounds.current > 0 ? bounds.current : 1e-12;
  // OHM'S LAW ON THE LOAD, at this instant, from this snapshot's own capacitor voltage. The
  // load is a plain resistor across the capacitor, so its current is fully determined by Vc —
  // nothing here is integrated or remembered.
  const loadAmps = drive.loadOhms !== null ? Vc / drive.loadOhms : 0;
  return {
    fixedSpan: { lo, hi },
    fixedFullI,
    terraces: [
      { id: SRC, label: sim.connected ? 'source +' : 'source + (0 V while discharging)', volts: Vs },
      // THE NODE BETWEEN RESISTOR AND INDUCTOR IS A REAL NODE with a real voltage,
      // Vs − i·R, so the circuit gains a terrace rather than the inductor being drawn
      // across an existing one. Its display range was declared with the others.
      // From the SNAPSHOT when solved: with a diode in the loop this node sits on the far side
      // of it, so deriving it as Vs − i·R would omit the drop entirely. When it is NOT known —
      // the reset frame of a solved run — the terrace is labelled as unsolved and placed at the
      // derived height for LAYOUT only, rather than printing a number the diode would falsify.
      // NAMED FOR WHAT ACTUALLY FEEDS IT. With a diode in the loop this node sits on the far
      // side of the device, so calling it "resistor → inductor" named a connection the circuit
      // no longer has — the resistor now feeds the anode node instead. Astra spotted it in a
      // screenshot.
      { id: MID,
        label: `${drive.diode ? 'diode' : 'resistor'} → inductor`
          + (drive.midVolts === null && drive.mode !== 'kernel' ? ' · unsolved' : ''),
        volts: drive.midVolts ?? (Vs - drive.currentAmps * sim.resistance) },
      // THE DIODE'S OWN NODE, present only when the device is. With no diode `na` and `n2` are
      // the same node in the netlist, so inventing a terrace for it would draw a junction the
      // circuit does not have.
      ...(drive.diode ? [{
        id: ANODE,
        label: drive.anodeVolts === null
          ? 'resistor → diode · unsolved' : 'resistor → diode',
        volts: drive.anodeVolts ?? (Vs - drive.currentAmps * sim.resistance),
      }] : []),
      { id: CAP, label: 'capacitor +', volts: Vc },
      { id: GND, label: 'source − · ground', volts: 0, isRef: true },
    ],
    branches: [
      // The endpoints here are FIXED (ground -> source +), so the current must stay
      // SIGNED. The bench flips the endpoints and passes |I|; copying that pattern
      // without also flipping the endpoints made the source point the wrong way and
      // made the node look unbalanced against the resistor. Astra's finding.
      { id: 'rc-V', label: 'source', kind: 'source', from: GND, to: SRC, current: I },
      { id: 'rc-R', label: `resistor ${Number(sim.resistance.toPrecision(3))} Ω`, kind: 'resistor',
        from: SRC, to: drive.diode ? ANODE : MID, current: I },
      // ORIENTATION IS THE ORDER OF THE TERMINALS, exactly as in the netlist: the branch runs
      // ANODE to CATHODE, so `D1 na n2` draws pointing one way and `D1 n2 na` the other. The
      // drawn arrow is not a separate decision that could drift from the circuit — it IS the
      // terminal order, and the current is the solved branch current through it.
      ...(drive.diode ? [{
        id: 'rc-D', kind: 'diode' as const,
        // THE STATE IT IS IN, named, because that is what a diode is for and what Peter asked to
        // see. CONDUCTING is decided by the CURRENT against the run's own scale, never by the
        // sign of the terminal voltage: a diode at +0.2 V is forward-biased and carrying
        // picoamps, and calling that "conducting" would label a device that is doing nothing.
        label: drive.diode.state === null
          ? `diode · ${drive.diode.orientation}`
          : `diode · ${Math.abs(drive.diode.state.terminalAmps) > 1e-3 * fixedFullI
              ? 'CONDUCTING' : 'BLOCKING'} · ${drive.diode.state.terminalVolts.toFixed(3)} V`,
        from: drive.diode.orientation === 'forward' ? ANODE : MID,
        to: drive.diode.orientation === 'forward' ? MID : ANODE,
        current: drive.diode.state ? drive.diode.state.terminalAmps : null,
      }] : []),
      // THE WINDING KEEPS ITS OWN RULER for its transport cue and its field-line VISIBILITY.
      // The shared current scale spans the load branch too, and dimming the coil in proportion
      // to a current that never passes through it would misreport what it is doing. This is a
      // display scale only: the field's geometry and direction come from Biot–Savart.
      { id: 'rc-L', label: `inductor ${siUnit(sim.inputs.inductance, 'H')}`, kind: 'inductor',
        from: MID, to: CAP, current: I, fullScaleA: bounds.inductorCurrent },
      // THE CAPACITOR DOES NOT CARRY THE INDUCTOR CURRENT when there is a load across it.
      //
      // This branch read `current: I` — the inductor's branch current — which is only the
      // capacitor's current when nothing else is attached to that node. The load added for the
      // diode demonstrations is attached to exactly that node, so the scene was drawing the
      // inductor current into the capacitor and drawing no load at all: the component that is
      // the whole reason the demonstrations move was invisible, and the current into the store
      // was wrong by however much the load was taking. Astra caught it in the source.
      //
      // KCL at the capacitor node: i_L = i_C + i_load, so i_C = i_L − Vc/RL. Both come from the
      // SAME snapshot as everything else in this spec, so the three cannot disagree.
      { id: 'rc-C', label: 'capacitor', kind: 'capacitor', from: CAP, to: GND,
        current: I - loadAmps },
      ...(drive.loadOhms !== null ? [{
        id: 'rc-RL', kind: 'load' as const,
        label: `load ${siUnit(drive.loadOhms, 'Ω')}`,
        from: CAP, to: GND, current: loadAmps,
      }] : []),
    ],
    plates: geometry ? [{
      id: 'capacitor plates',
      side: plateSide(geometry.area), gap: geometry.gap, area: geometry.area,
      capacitance: sim.inputs.capacitance,
      voltage: Vc, field: interiorField(Vc, geometry),
      // FIXED display scales from the AUTHORED bound, the same bound the energy
      // gauge uses. Vc stays inside the convex hull of {Vc0, Vs, 0}, so these are
      // real bounds and the drawing can only saturate at a value the run can reach.
      charge: sim.inputs.capacitance * Vc,
      chargeFull: sim.inputs.capacitance * vBoundV(),
      fieldFull: vBoundV() / geometry.gap,
      plusTerrace: CAP, minusTerrace: GND,
      gapExaggeration: GAP_EXAGGERATION,
      dielectricLabel: geometry.dielectric.label,
    }] : undefined,
    coil: coilRender(),
    // THE VESSELS' DATA, WITHOUT THEIR BODIES. They stood inside the circuit as three more
    // component-shaped objects with three more labels while the same three numbers were already
    // cards under "Inspect energy". `stores` still feeds those cards — only the 3D duplicates go.
    drawStores: false,
    stores: [{
      id: 'rc-store', label: 'Capacitor', labelMode: 'identifier', terrace: CAP, base: GND,
      colour: ELECTRIC_COLOUR,
      quantity: { quantity: 'capacitor energy', unit: 'J', value: drive.storedC,
        reference: 'zero at zero terminal voltage',
        scale: { min: 0, max: displaySharedEnergyJ(), mapping: 'linear' } },
      readout: `${fmt(drive.capacitorVolts)} V across capacitor`,
    }, {
      // THE MAGNETIC HALF, in the world beside the electric one. The model held both from
      // the start; the page showed only the capacitor's, while printing a residual that
      // included the inductor's — so the ledger and the picture disagreed.
      id: 'rlc-magnetic', label: 'Inductor', labelMode: 'identifier', terrace: MID, base: CAP,
      // Same colour as the coil's core and its field lines: the vessel filling IS the field
      // strengthening, and the pairing should not need reading to notice.
      colour: MAGNETIC_COLOUR,
      quantity: { quantity: 'inductor energy', unit: 'J', value: drive.storedL,
        reference: 'zero at zero current', scale: { min: 0, max: displaySharedEnergyJ(), mapping: 'linear' } },
      readout: `${fmt(drive.currentAmps)} A through inductor`,
    }, {
      id: 'rc-thermal', label: 'RC chassis', labelMode: 'identifier', terrace: GND, base: GND,
      colour: THERMAL_COLOUR,
      quantity: { quantity: 'received resistor heat', unit: 'J', value: sim.receiverHeat,
        reference: 'since restart · position is layout only',
        scale: { min: 0, max: displaySharedEnergyJ(), mapping: 'linear' } },
      readout: `${fmt(sim.temperature)} K · heat capacity 2 J/K`,
    }],
  };
}

/** Disabled for the RLC slice — see paintPredictionPanel. */
const PREDICTION_ENABLED = false;
/** The guess, the tau line, and after the run the gap between guess and truth. */
function predictionMarkup(x: (t: number) => number, y: (v: number) => number,
                          t0: number, t1: number): string {
  if (prediction === null) return '';
  const tau = sim.inputs.resistance * sim.inputs.capacitance;
  const tauX = tau >= t0 && tau <= t1 ? x(tau) : null;
  const py = y(prediction);
  const line = tauX === null ? '' :
    `<line class="tauline" x1="${tauX.toFixed(1)}" y1="20" x2="${tauX.toFixed(1)}" y2="165"/>
     <text class="taulab" x="${(tauX + 4).toFixed(1)}" y="32">one τ</text>`;
  const guess = `<line class="guessline" x1="55" y1="${py.toFixed(1)}" x2="620" y2="${py.toFixed(1)}"/>
     <text class="guesslab" x="60" y="${(py - 5).toFixed(1)}">your guess ${fmt(prediction)} V</text>`;
  const got = predictionOutcome && tauX !== null
    ? `<line class="truthline" x1="${(tauX - 26).toFixed(1)}" y1="${y(predictionOutcome.actual).toFixed(1)}"
         x2="${(tauX + 26).toFixed(1)}" y2="${y(predictionOutcome.actual).toFixed(1)}"/>
       <circle class="truthdot" cx="${tauX.toFixed(1)}" cy="${y(predictionOutcome.actual).toFixed(1)}" r="5"/>`
    : '';
  return line + guess + got;
}

function paintPredictionPanel(): void {
  // WITHDRAWN FOR THE RLC SLICE. This exercise taught two RC-only facts: that one τ is
  // where the capacitor has closed 63.2% of the gap, and that "changing R or C changes
  // WHEN, never WHERE". With an inductor in the loop the second is simply false — the
  // circuit overshoots past the source, so R changes WHERE it goes as well as when. The
  // panel is hidden rather than rewritten, because inventing a new lesson is not part of
  // this pass; the research on prediction stands and applies whenever it returns.
  if (!PREDICTION_ENABLED) return;

  const box = document.getElementById('predict-result');
  if (!box) return;
  if (!predictionOutcome) { box.innerHTML = ''; return; }
  const { predicted, actual } = predictionOutcome;
  const err = actual - predicted;
  const closeness = Math.abs(err) / Math.max(Math.abs(actual), 1e-12);
  // The point is the GAP, not a score. No praise, no penalty — just the difference
  // and the reason, because the reason is the thing worth keeping.
  box.innerHTML = `<div class="predicted">
    <b>You said ${fmt(predicted)} V. It reached ${fmt(actual)} V</b> at one time constant —
    ${closeness < 0.02 ? 'within 2%.' : `off by ${fmt(err)} V.`}
    <div class="dim">One τ is where the capacitor has closed <b>1 − 1/e ≈ 63.2%</b> of the gap
    between where it started and where it is heading — not half, and not all. Here that gap was
    ${fmt(sim.inputs.voltage - sim.inputs.initialVoltage)} V, so the answer had to be
    ${fmt(sim.inputs.initialVoltage + (sim.inputs.voltage - sim.inputs.initialVoltage) * (1 - Math.exp(-1)))} V
    whatever R and C are. <b>Changing R or C changes WHEN, never WHERE.</b></div></div>`;
}

function paintStage(): void {
  if (!stage) return;
  const spec = rcSpec();
  // UPDATE, NOT REBUILD. buildFromSpec on every paint tore the whole 3D scene down about
  // twelve times a second while playing; applySpec rebuilds only when the topology signature
  // changes and otherwise mutates the objects already on screen. See LiveHandles in the scene.
  stage.applySpec(spec);
  el('gauge-cards').replaceChildren(...(spec.stores ?? []).map((store) => {
    const card = document.createElement('div'); card.className = 'gauge-card';
    const heading = document.createElement('h3'); heading.textContent = store.label;
    const value = document.createElement('p');
    value.textContent = store.quantity ? gaugeReading(store.quantity).text : store.readout;
    const extra = document.createElement('p'); extra.className = 'gauge-extra'; extra.textContent = store.readout;
    card.append(heading, value, extra); return card;
  }));
  const i = stage.getInfo();
  const eFullJ = displaySharedEnergyJ();
  // WHERE THE SCALES CAME FROM, said out loud. In solved mode they are the extrema of the run
  // being played, taken once when it was adopted and held for its life — NOT a bound on where
  // the circuit would go given longer, which is what the kernel's scales assert. A viewer
  // comparing two runs is comparing two different rulers, and should be told so.
  const scaleSource = drive.mode === 'kernel'
    ? `Scales come from the authored inputs: the furthest this circuit can go from where it `
      + `started.`
    : `Scales are the extrema of THIS solved run, fixed when it was adopted and held through `
      + `replay and pause. They cover the ${siUnit(playback?.horizonSeconds ?? 0, 's')} horizon `
      + `that was solved, not where the circuit would go given longer — a different horizon is a `
      + `different run and gets a different ruler.`;
  el('scale-summary').textContent = `${scaleSource} Height difference encodes voltage · blue streaks show net electron flow; optional mint arrows encode conventional current · vessel fill encodes energy. All three vessels — capacitor, inductor and chassis heat — share ONE joule scale, 0–${fmt(eFullJ)} J (display range, not capacity), so energy moving between electric and magnetic storage is drawn at the same height per joule. Temperature is labelled separately. Above-range values stay printed. Gauge readings: up to 6 significant figures.`;
  el('stagelegend').innerHTML = `<p><b>Transport cues fade with the current, they do not merely slow.</b> `
    + `A streak's brightness and length follow √(|i|/peak) against the run's captured current `
    + `bound — a declared contrast curve with NO floor, so as the ring dies away the transport `
    + `drawing dies with it instead of staying bright and simply crawling. Speed still encodes `
    + `|i| as it always did; what changed is that a millionth of the peak is no longer drawn as `
    + `strongly as the peak. Underneath, the dim fixed dots are a SCHEMATIC REMINDER THAT CHARGE IS PRESENT — not `+ `tracked stationary particles, and not positions of anything. They do not `
    + `fade, because the charge does not go away when the current does. So a settled circuit `
    + `shows carriers and almost no transport, which is what it is — not an empty wire, and not `
    + `a busy one frozen in place.</p>`
    + (coilPackage ? `<p><b>The violet loops around the coil are its magnetic field, solved from this winding.</b> `
    + `Each turn is treated as a circular filament and the field is evaluated in closed form, so the `
    + `loops are streamlines of that field rather than drawn shapes: they close where the field closes `
    + `them and stop where it stops them. The winding is ${coilPackage.geometry.turns} turns of `
    + `${(coilPackage.geometry.wireRadius * 2000).toFixed(1)} mm wire, `
    + `${(coilPackage.geometry.radius * 1000).toFixed(0)} mm radius, `
    + `${(coilPackage.geometry.length * 1000).toFixed(0)} mm long, and THAT GEOMETRY PRODUCES THE `
    + `${siUnit(coilPackage.inductanceH, 'H')} the circuit uses — the coil on screen is the inductor in `
    + `the equations, not a picture beside one. Its own scale is ${COIL_SCENE_UNITS_PER_METRE} scene `
    + `units per metre, so its drawn size is NOT comparable with platform heights, which mean volts.</p>`
    + `<p>What is still idealized: an air core with an empty bore, filaments rather than a helix `
    + `(the winding pitch is discarded), the coil's contribution only — the leads carry the same `
    + `current and are not included — and no propagation, eddy currents or core response. The drawn `
    + `curves are decimated and splined from the solved paths, which moves them by under 0.4 mm. `
    + `Brightness follows the WHOLE-COIL current through √(|i|/peak), not the local field strength at `
    + `each point, so no tesla value is shown or implied anywhere. Direction follows the right-hand `
    + `rule for the winding actually drawn and reverses with the current; at zero current nothing is `
    + `drawn at all. The Inductor vessel shares this colour and reads ½·L·i²: its fill grows as the `
    + `SQUARE of the current while the field cue grows as |i|, so the two move together but are not `
    + `the same reading.</p>`
    : `<p><b>The inductance here is authored, not derived from a winding, so no magnetic field is `
    + `drawn.</b> There is no geometry to solve one from, and a field invented beside an invented `
    + `inductance would be decoration. Tick "Derive L from coil geometry" to get a real winding and `
    + `its solved field. The Inductor vessel still reads ½·L·i² on the shared joule scale.</p>`)
    + `<p>Default spatial view: blue streaks show net electron flow opposite conventional current. Their travel speed is illustrative, not a carrier velocity; microscopic random motion is not shown. The conventional-current scale below applies only with Explain conventional current selected.</p><b>A HEIGHT DIFFERENCE BETWEEN LABELLED PLATFORMS is a voltage difference</b>. Curved leads show electrical connections; their route and height do not encode voltage or resistance —
    ${i.unitsPerVolt.toFixed(4)} drawing units per volt, on a <b>fixed axis</b> held steady through
    charge and discharge. A single height is measured against the displayed zero and is
    <b>reference-dependent</b>; only differences are physical. <b>Steepness means nothing</b>: it
    depends on how far apart two terraces happen to be placed, so it is not a field strength ·
    <b>marker speed and the outer flow halo encode current</b> (the solid connection thickness is fixed for readability), at ${i.markerScale.toFixed(4)} units/s per
    ampere against a <b>fixed</b> full scale of ${fmt(i.fullI)} A, so a decaying current is drawn
    decaying · the vessel's <b>fill is stored ENERGY</b>, U = C·ΔV²/2, against a declared
    display-full of <b>${fmt(eFullJ)} J</b> — that is a drawing scale, <b>not</b> a capacitor
    rating and not the capacitance. Energy goes as ΔV², so fill and height are two different
    channels: charging from −10 V toward −5 V <b>raises</b> the terrace while <b>lowering</b> the
    stored energy. <b>The RC chassis gauge shows received heat in joules on the same display scale.</b>
    Its kelvin reading is separate; neither gauge position nor fill is a temperature axis.
    Heat capacity 2 J/K is not a storage limit. Above-scale heat keeps its numeric reading
    and is labelled ABOVE DISPLAY SCALE; the drawing saturates, the model does not.
    For all-zero authored voltages, the display-full fallback is 1 J.`;
  el('stagehint').textContent = 'Layout claims nothing: where a terrace sits around the ring, and the vessel\u2019s '
    + 'position beside it, are placement only. A marker\u2019s POSITION is not a charge location or a transit time '
    + '\u2014 only its speed and direction carry the current. Not electron drift, not propagation, not a charge count. '
    + 'Nothing is drawn between terraces, because the model has no value there.';
}

function paintPlateCharge(): void {
  const q = sim.inputs.capacitance * sim.voltage;
  el('electron-separation').textContent = q > 0
    ? 'Upper plate: electron deficit (+). Lower plate: electron excess (−). Nothing conducts across the gap.'
    : q < 0 ? 'Upper plate: electron excess (−). Lower plate: electron deficit (+). Nothing conducts across the gap.'
    : 'No net charge separation. Neutral plates still contain electrons.';
  const full = sim.inputs.capacitance * vBoundV();
  const fraction = full > 0 ? Math.min(1, Math.abs(q) / full) : 0;
  const chargeText = (charge: number): string => {
    const magnitude = Math.abs(charge);
    const [scale, unit] = magnitude >= 1 ? [1, 'C'] : magnitude >= 1e-3 ? [1e3, 'mC']
      : magnitude >= 1e-6 ? [1e6, 'µC'] : magnitude >= 1e-9 ? [1e9, 'nC'] : [1e12, 'pC'];
    return `${charge > 0 ? '+' : charge < 0 ? '−' : ''}${Number((magnitude * Number(scale)).toPrecision(3))} ${unit}`;
  };
  for (const [side, charge] of [['upper', q], ['lower', -q]] as const) {
    const light = el(`charge-${side}-light`);
    light.style.width = `${fraction * 100}%`;
    light.dataset.sign = charge > 0 ? 'positive' : charge < 0 ? 'negative' : 'zero';
    const reading = el(`charge-${side}`);
    reading.textContent = chargeText(charge);
    reading.dataset.sign = light.dataset.sign;
  }
  el('charge-scale').textContent = `Each strip: 0–${chargeText(full).replace('+','')} in magnitude. This display range stays fixed during a run; changing the experiment resets it. It is not a maximum capacity. Lights represent charge magnitude, not individual electrons.${full === 0 ? ' Both authored voltage bounds are zero.' : ''}`;
}

let last: number | null = null, lastPaint = 0;
document.addEventListener('visibilitychange', () => { last = null; });
/**
 * A LATCHED FAULT. Non-null means an advancing step threw and the model may be in a
 * partially-updated state. Nothing advances again until a reset clears it.
 */

function frame(now: number): void {
  requestAnimationFrame(frame);            // FIRST: no later throw can kill the loop
  try {
    if (document.hidden) { last = null; return; }
    if (last !== null && now - last < 1000 / 30) return;
    const dt = frameSeconds(now, last);
    last = now;
    const previousFault = driver.faulted;
    // ONE AUTHORITY ADVANCES, and which one is decided here rather than by both running.
    //
    // Before this, driver.frame(dt) ran unconditionally AND the playback advanced whenever it
    // existed — so the kernel kept stepping in solver mode, and an old trajectory kept playing
    // while its replacement was still being solved or had already faulted.
    const mode = driveMode();
    // AT THE HORIZON THE PICTURE STOPS MOVING TOO. The cursor stops there, but the current
    // streaks are animated from dt, so a run ending on a non-zero current kept its transport
    // cues sliding after "End of solved run" — motion with no time behind it.
    const animating = mode === 'kernel'
      ? !clock.paused
      : mode === 'solved' && !clock.paused && !!playback && !playback.atHorizon;
    if (mode === 'kernel') {
      driver.frame(dt);
      if (driver.faulted !== previousFault) paint();
      if (!clock.paused && now - lastPaint > 80) { paint(); lastPaint = now; }
    } else if (mode === 'solved' && playback) {
      playback.paused = clock.paused;
      playback.advance(dt);
      solverFrame = playback.frame();
      if (!clock.paused && now - lastPaint > 80) { paint(); lastPaint = now; }
    } else {
      // busy or fault: the cursor does NOT move and the scene is not re-derived from a
      // configuration that no longer matches the trajectory. Frozen means frozen.
      if (now - lastPaint > 200) { paint(); lastPaint = now; }
    }
    // THE ILLUSTRATIVE ANIMATION SLOWS WITH THE PLAYBACK.
    //
    // These took the raw wall-clock interval, so the transport streaks and the resistor lens ran
    // at full speed no matter what the speed control said, while the trajectory crawled. Carriers
    // whizzing past voltages that are barely moving is not a slow picture; it is two clocks
    // disagreeing, and it is a large part of what "frantic" describes. Astra found it in the
    // source alongside the mislabelled control.
    //
    // This scales TIME ONLY. Current amplitudes, field strength, charge and every geometry are
    // untouched — the same numbers are drawn, drawn for longer. Marker travel speed was already
    // declared illustrative rather than a physical carrier velocity, which is what makes rescaling
    // it honest; the legend says so.
    const showDt = mode === 'solved' ? dt * speedMultiplier() : dt;
    if (import.meta.env.DEV) {
      // A NON-WRAPPING measure of the animation time actually delivered. Marker `phase` cycles,
      // so differencing it across a window is not a measurement of anything — a first attempt
      // read a NEGATIVE advance from it. This accumulates.
      const w = window as unknown as Record<string, number>;
      w.__rcAnimSeconds = (w.__rcAnimSeconds ?? 0) + (animating ? showDt : 0);
    }
    stage?.render(animating ? showDt : 0);
    resistorLens.render(animating ? showDt : 0);
  } catch (e) {   // paint/render faults only; advancing faults are latched by RcDriver
    // ASTRA'S RETURN, and it was right. My first version caught, left the clock
    // running, retried forever, and TOLD THE READER "the clock is still running" —
    // an unverified state claim, which is the same error as D-49. Worse: `advance`
    // may have PARTIALLY changed the model before throwing, so a caught interval is
    // NOT a safely skipped transaction and must not be treated as one.
    //
    // So: LATCH the fault, STOP advancing, and say plainly that the state may be
    // incomplete. Only a reset clears it. The display keeps running so the fault is
    // readable, but nothing further is stepped.
    console.error('RC display fault', e);
    clock.paused = true;
    paint();
  }
}
/**
 * WHY THERE IS NO FALLBACK DIAGRAM WHEN THE RENDERER FAILS.
 *
 * This page used to substitute a flat schematic. That schematic was a DIFFERENT CIRCUIT: no
 * inductor, and it printed I = (Vs − Vc) / R. For a series RLC the current is a state
 * variable — L·di/dt = Vs − Vc − i·R — so it was false at every instant, and it appeared
 * exactly when the viewer had no way to check it. A wrong picture is worse than no picture.
 *
 * So the failure is stated plainly and the readings, which come from the verified model and
 * stay correct, carry the page. This note is for whoever edits this file; the UI does not
 * recount the history of a view that no longer exists.
 */
function graphicsDiagnosis(): string {
  // three needs a WebGL2 context. A WebGL1-only browser is a DIFFERENT failure from having
  // no WebGL at all, and calling the first one "available" would send the reader hunting in
  // our code for a fault that is not there.
  const probe = document.createElement('canvas');
  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  let level = '';
  try {
    gl = probe.getContext('webgl2');
    // Report what the probe observed. A working probe does NOT locate the fault — the
    // context that failed is not this one, and quota or resource conditions can differ
    // between them — so no cause is asserted here.
    if (gl) level = 'This browser can create the WebGL2 context the scene needs.';
    else {
      gl = probe.getContext('webgl');
      level = gl
        ? 'This browser offers only WebGL1. The scene needs WebGL2.'
        : 'This browser could not create any WebGL context.';
    }
  } catch (e) {
    return `Probing WebGL also failed: ${String(e)}`;
  } finally {
    // Hand the probe context back. Contexts are a limited resource, and a viewer pressing
    // retry a few times must not exhaust them and turn a recoverable fault into a permanent one.
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* nothing to release */ }
  }
  return level;
}

function startStage(): void {
  let built: PotentialScene | null = null;
  try {
    built = new PotentialScene(el('stage3d'), el('stagelabels'));
    // REVEAL BEFORE MEASURING. After a failure the stage is hidden and .graphics-unavailable
    // sets display:none, so a retry that sized itself first would read clientWidth 0 and take
    // PotentialScene.resize's 480x380 fallback — and nothing re-sizes it afterwards, so the
    // recovered scene would stay a small canvas in a large stage for the rest of the session.
    el('graphics-status').hidden = true;
    el('stage').hidden = false;
    el('reset-view').hidden = false;
    root.classList.remove('graphics-unavailable');
    // Still inside the try: if the constructor succeeds but the first layout throws, the scene
    // holds a live GL context that has to be released rather than orphaned, and the catch
    // below has to put the failure layout back.
    built.resize();
    built.refit();
    stage = built;
    (window as unknown as Record<string, unknown>).__rcstage = stage;
  } catch (error) {
    console.error('RC 3D initialization failed', error);
    try { built?.dispose(); } catch { /* already broken; nothing more to reclaim */ }
    built = null;
    stage = null;
    (window as unknown as Record<string, unknown>).__rcstage = null;
    el('stage3d').replaceChildren();
    el('stagelabels').replaceChildren();
    el('stage').hidden = true;
    el('reset-view').hidden = true;
    root.classList.add('graphics-unavailable');

    const status = el('graphics-status');
    status.replaceChildren();
    const line = document.createElement('p');
    line.textContent = 'The 3D scene could not start. Every reading and control below is still live.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.onclick = () => { startStage(); paint(); };
    // The exception belongs on the page — Peter cannot report what the page will not print —
    // but folded away, so the failure reads as one sentence and a button.
    const more = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = 'Technical detail';
    const detail = document.createElement('p');
    detail.textContent = `${graphicsDiagnosis()} Error: ${String(error)}`;
    more.append(sum, detail);
    status.append(line, retry, more);
    status.hidden = false;
  }
}
startStage();
resistorLens.setSpatialMode(true);
// Development diagnostic: exercise the recovery path without waiting for a real fault.
// Disposes any live scene first — calling startStage on a running stage would construct a
// second renderer and orphan the first one's context.
// DEV-ONLY DIAGNOSTICS. These exist so the page's own fault and busy handling can be driven
// deterministically — an invalid input never reaches the solver, and a 30 ms solve cannot be
// sampled by polling. They are stripped from a production build.
if (import.meta.env.DEV) {
  // THE DESCRIPTION ACTUALLY SUBMITTED, and the one currently presented. A probe that reads the
  // scene can tell what is drawn but not what was asked for, and the two disagreeing is exactly
  // the class of defect this page keeps producing.
  (window as unknown as Record<string, unknown>).__rcDescribe = () =>
    ({ live: describeCircuit(), presented, config, preset: activePreset?.id ?? null,
       mode: driveMode(), driveLoad: drive.loadOhms, driveDiode: drive.diode?.orientation ?? null,
       frozen: drive.frozen, busy: solverBusy, fault: solverFault,
       horizon: playback?.horizonSeconds ?? null, cursor: playback?.simulatedSeconds ?? null });
  (window as unknown as Record<string, unknown>).__rcPaintStage = () => { paintStage(); };
  // FORCED FULL REBUILD, so a probe can compare the update path against a from-scratch build at
  // the same simulated instant. If the two ever differ, the update path is missing a handle.
  (window as unknown as Record<string, unknown>).__rcRebuildStage = () => {
    if (stage) stage.buildFromSpec(rcSpec());
  };
  (window as unknown as Record<string, unknown>).__rcPaintTimed = () => {
    const t0 = performance.now(); paintStage(); return performance.now() - t0;
  };
  // DETERMINISTIC SEEK, for probes. The harness renders at about 1 fps, so "play then pause"
  // lands wherever it happens to land — one capture arrived back at t=0 after a replay. Seeking
  // names the instant instead of racing the frame loop for it.
  (window as unknown as Record<string, unknown>).__rcSeek = (seconds: number) => {
    if (!playback) return null;
    playback.seek(Number(seconds));
    playback.paused = true; clock.paused = true;
    solverFrame = playback.frame();
    paint();
    return playback.simulatedSeconds;
  };
  const w = window as unknown as Record<string, unknown>;
  w.__rcFailNextSolve = (reason = 'injected fault') => {
    if (!spice) spice = new SpiceClient();
    spice.failNextForTesting(String(reason));
  };
  w.__rcHoldNextSolve = (): (() => void) => {
    if (!spice) spice = new SpiceClient();
    return spice.holdNextForTesting();
  };
}
(window as unknown as Record<string, unknown>).__rcRestartStage = () => {
  try { stage?.dispose(); } catch { /* already broken */ }
  stage = null;
  el('stage3d').replaceChildren();
  el('stagelabels').replaceChildren();
  startStage();
  paint();
};
window.addEventListener('resize', () => stage?.resize());
// Open on the geometry-derived coil, so the drawn winding is the inductor from the first
// frame. DEFAULT_COIL was chosen so its derived L lands inside the timing envelope with this
// plate capacitor, and so every turn can be drawn one for one.
{
  const d = DEFAULT_COIL;
  (el('coil-turns') as HTMLInputElement).value = String(d.turns);
  (el('coil-radius') as HTMLInputElement).value = String(d.radius * 1000);
  (el('coil-length') as HTMLInputElement).value = String(d.length * 1000);
  (el('coil-wire') as HTMLInputElement).value = String(d.wireRadius * 1000);
  (el('coil-on') as HTMLInputElement).checked = true;
}
// Open directly on the geometric experiment; all quantities remain model-derived.
(el('geo-on') as HTMLInputElement).checked = true;
el('geo-fields').hidden = false;
(el('capacitance') as HTMLInputElement).readOnly = true;
(el('geo-gap-drag') as HTMLInputElement).value = '100';
geometry = currentGeometry();
{
  // THE OPENING DAMPING IS CHOSEN, AND SAYS SO. Capacitance comes from the plate geometry
  // (~89 pF), so R_crit = 2√(L/C) is around 2e5 Ω — at the RC page's old 100 Ω the loop
  // would ring at a damping ratio near 1e-5 and effectively never settle, which is true
  // but useless as a first sight. A fixed FRACTION of critical gives a ring that is
  // obvious and still visibly settles, for whatever capacitance the plates produce.
  const c0 = capacitanceOf(geometry);
  const damping = 0.3;                                   // ζ, declared
  // L now comes from the winding, so R_crit follows the coil rather than an authored henry.
  const inductance = adoptCoilGeometry();
  const resistance = damping * 2 * Math.sqrt(inductance / c0);
  reset({ ...RLC_DEFAULT, capacitance: c0, inductance, resistance });
}
el('damping').addEventListener('input', () => {
  applyDamping(Number((el('damping') as HTMLInputElement).value) / 1000);
  resolveIfSolving('Damping changed. ');
});
el('reset-view').onclick = () => stage?.refit();
// LEGIBILITY, not a physics change. At 0° the loop faces along the coil axis, and the default
// camera looks nearly perpendicular to that axis, so the loop is genuinely edge-on and reads as
// a line. This moves the CAMERA — the pose stays exactly where the physics puts it — and Reset
// view undoes it.
el('focus-pickup').onclick = () => stage?.focusOnCoilAxis();
el('labels-on').addEventListener('change', () => stage?.setLabelsVisible((el('labels-on') as HTMLInputElement).checked));   // also raises field emphasis
paintGeoReadout();
paintCoilReadout();
// Initial discovery runs; explicit resets and fault handling retain their pause semantics.
clock.paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/**
 * START AS THE PAGE IS CONFIGURED, not as a bare RC that has to be switched on.
 *
 * The solver, the coil, the pickup and a forward diode are all on by default, so `solverRequested`
 * is adopted from the checkbox rather than assumed false — otherwise the markup would say one
 * thing and the driving authority another. The solve is requested LAST, after the DOM, the coil
 * package, the bounds and the first paint, because `describeCircuit` reads all of them; the
 * scene shows the authored reset with a stated "Solving…" until the trajectory arrives, and a
 * failure surfaces as a fault rather than falling back to the analytic kernel.
 */
solverRequested = (el('solver-on') as HTMLInputElement).checked;
if (activePreset) config = configFromPreset(activePreset);
paintDiodeControl();
paintPresets();
paintSpeedReadout();
paint();
requestAnimationFrame(frame);
if (solverRequested) void resolveCircuit('Opening state. ');
