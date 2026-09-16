/**
 * A MOTOR LIFTS A WEIGHT — the third circuit on the workstation, and the first that reaches into
 * the mechanical world. Same rules as the lamp page: no physics in this file; the trajectory is
 * ngspice's (one deck for the coupled electrical + mechanical system), read and checked in
 * `src/model/motor.ts`, played by the shared cursor. The rack on screen REPLAYS the solved θ(t)
 * and says so; the energy vessels are the balances the tool closes, drawn on one joule scale.
 */
import './rc.css';
import './style.css';
import { PotentialScene, type SceneSpec, type BranchSpec, type TerraceSpec, type StoreSpec, MAGNETIC_COLOUR, THERMAL_COLOUR } from './potential-scene';
import { SpiceClient, Superseded } from '../model/spice/client';
import { PlaybackCursor, type PlaybackState } from '../model/spice/cursor';
import { sampleMotorAt, type MotorSnapshot, type MotorTransient } from '../model/spice/motor-transient';
import { motorEnergy, motorDomain, type MotorEnergy } from '../model/motor';
import { MOTOR_PRESETS, motorPresetById, type MotorPreset } from '../model/motor-presets';
import { validateMotor, effectiveInertia, loadTorque, type MotorDescription } from '../model/spice/motor-netlist';
import { encodeMotorDoc, decodeMotorDoc } from '../model/motor-doc';
import { speedFromSlider, wallSecondsFor } from './transport';
import { fmt, siUnit } from './rc-flow';
import { frameSeconds } from '../model/rc-driver';

interface MotorFrame extends MotorSnapshot { kind: 'solved'; requestedTimeSeconds: number; clampedToHorizon: boolean; onEdge: boolean; state: PlaybackState; progress: number }
class MotorPlayback extends PlaybackCursor<MotorTransient> {
  frame(): MotorFrame {
    const s = sampleMotorAt(this.transient, this.cursor);
    const atStart = !this.started && this.cursor === 0;
    return { kind: 'solved', ...s, state: atStart ? 'before-start' : this.state, progress: atStart ? 0 : this.progress };
  }
}

const root = document.getElementById('rc-app')!;
root.innerHTML = `
<header><span><a href="/rc.html">← RLC</a> · <a href="/lamp.html">← A transistor and a lamp</a> · <a href="/controls.html">A knob, a switch and a light →</a></span><span>FLUX GARDEN / MOTOR</span></header>
<section class="intro"><p class="eyebrow">ELECTRICAL WORK BECOMES MECHANICAL WORK</p><h1>A motor lifts a weight, and every joule is accounted for.</h1>
<p>Current through the winding makes torque; the turning shaft makes a voltage back — inside the motor — that opposes the supply. What the supply delivers splits into heat in the winding, a little magnetic energy, the load's height and speed, and friction. The switch is an ideal switch; the rack replays the solved motion. <a href="#model-notes">The model, and what it does not claim &rarr;</a></p></section>
<div class="layout"><aside><h2>Your circuit</h2>
<form id="motor-form">
<label>Supply · V<input id="supply" type="number" value="6" step="any" min="0" max="100" required></label>
<label>Winding resistance · Ω<input id="r" type="number" value="2" step="any" min="0.001" max="10000" required></label>
<label>Winding inductance · H<input id="l" type="number" value="0.005" step="any" min="0.000001" max="10" required></label>
<label>Motor constant K · V·s/rad = N·m/A<input id="k" type="number" value="0.3" step="any" min="0.0001" max="10" required></label>
<label>Rotor inertia · kg·m²<input id="j" type="number" value="0.0005" step="any" min="0.0000001" max="100" required></label>
<label>Viscous friction · N·m·s/rad<input id="b" type="number" value="0.001" step="any" min="0" max="10" required></label>
<label>Load mass · kg<input id="m" type="number" value="0.1" step="any" min="0" max="1000" required></label>
<label>Pinion radius · mm<input id="rp" type="number" value="40" step="any" min="1" max="1000" required></label>
<button type="submit">Apply &amp; re-solve</button></form>
<p class="hint">Applying re-solves the whole run from its braked operating point and restarts it. The switch and brake programme stays as the demonstration set it.</p>
<div class="actions"><button id="save">Save circuit</button><label class="file">Load circuit<input id="load" type="file" accept=".json,application/json"></label></div>
<p id="notice" role="status"></p>
</aside><article>
<div class="transport"><button id="play">Run</button><button id="step">One tick</button><button id="restart">Restart</button><button id="replay" hidden>Replay ↻</button><span class="speed" aria-label="Playback speed"><label for="rate">Speed</label><input id="rate" type="range" min="0" max="1000" value="500" aria-describedby="rate-readout"><output id="rate-readout"></output></span><details class="timing-details"><summary>Timing</summary><span id="clock"></span></details></div>
<section class="instrument">
<div class="presets" aria-label="What does it do?"><span class="preset-lead">WHAT DOES IT DO?</span><span id="preset-buttons"></span></div>
<p class="hint" id="preset-blurb"></p>
<div id="circuit-world"><div id="stage"><button id="reset-view" title="Restore the starting view">Reset view</button><label class="labels-toggle"><input id="labels-on" type="checkbox" checked> Labels</label><span class="orbit-hint">Drag to look around · marker height = voltage · vessel fill = energy</span><div id="stage3d"></div><div id="stagelabels"></div></div></div>
<div id="stage-fault" class="stage-fault" hidden role="alert"></div>
<div id="headline"></div>
<div class="readouts">
<div class="warm">Winding current<output id="r-i">—</output></div>
<div>Back-EMF · K·ω, inside the motor<output id="r-bemf">—</output></div>
<div class="cool">Shaft speed<output id="r-w">—</output></div>
<div class="cool">Height of the load<output id="r-h">—</output></div>
<div>Torque on the shaft · K·i<output id="r-tau">—</output></div>
<div>Conversion K·i·ω · + motoring / − generating<output id="r-conv">—</output></div>
<div>Brake torque applied<output id="r-brake">—</output></div>
<div>Freewheel diode current<output id="r-id">—</output></div>
</div>
<details open><summary>Where the energy has gone so far</summary><div id="energy-table" class="hint"></div></details>
<p class="hint" id="solver-status"></p>
<p class="hint" id="scene-time"></p>
<p id="graphics-status" role="status" hidden></p>
<details id="model-notes"><summary>The model, and what it does not claim</summary>
<p class="hint">The motor is a <b>port model</b>: v = R·i + L·di/dt + K·ω at its terminals, τ = K·i at its shaft, with <b>one K for both</b> — the assumption of the reciprocal ideal SI model, stated, not derived (the Lean lemma <code>FluxW2.MotorPort.power_balance</code> proves the power split <i>given</i> it). Constants are illustrative: <span id="model-values"></span>. No commutation, saturation, cogging, thermal limits or gearing.</p>
<p class="hint">The whole coupled system is one ngspice deck: the shaft is an equivalent circuit (inertia as capacitance, friction as conductance, the load torque as a DC current, the motor torque as a behavioural source). The rack is <b>rigid</b> — it pushes and pulls — so no cable tension domain is claimed. The switch is ngspice's <b>ideal switch model</b> (R<sub>on</sub>, R<sub>off</sub>), not the MOSFET; the brake is a declared constraint whose reaction torque is a solver output. Every run starts braked and at rest.</p>
<p class="hint">The freewheel diode across the motor is the diode page's illustrative part. When the switch opens the winding current circulates through it and is gone in under a millisecond (the back-EMF is in that loop); after that the motor <b>coasts</b>, which has its own closed-form reference. The run ends before the shaft could turn back: <b>reverse rotation with the switch open, and reverse winding current, are refused</b> as outside this demonstration; whether the machine is motoring or generating at an instant is the sign of K·i·ω, printed above.</p>
<p class="hint">Verified in <code>tools/motor-spice-verify.mjs</code>: the analytic coupled 3-state solution inside its window (fixed voltage, brake released or held), the coasting closed form, KCL at the motor terminal at every sample, the port / load / source energy balances with residuals printed (heat is R·∫i²dt; stores as changes from t = 0), native ngspice-45.2 against the WASM build. The angle θ is the reader's trapezoid integral of the solved ω, checked against the reference. The rack on screen is a kinematic replay of that θ; drawn sizes are model metres × a stated scale.</p>
<p class="hint" id="scale-notes"></p>
</details>
</section>
</article></div>`;

const el = (id: string) => document.getElementById(id)!;

// ---------------------------------------------------------------- state
let circuit: MotorDescription = MOTOR_PRESETS[0].build();
let activePreset: MotorPreset | null = MOTOR_PRESETS[0];
let spice: SpiceClient | null = null;
let playback: MotorPlayback | null = null;
let presented: MotorDescription | null = null;
let energy: MotorEnergy | null = null;
let solverFrame: MotorFrame | null = null;
let fault: string | null = null;
let displayFault: string | null = null;
let busy = false;
let paused = true;
let generation = 0;
let stage: PotentialScene | null = null;
let bounds = { lo: 0, hi: 12, fullI: 1e-12, bemfFull: 1, travelM: 0.01, jouleFull: 1, torqueFull: 1 };
/**
 * ONE scale for the whole mechanism — pinion radius AND travel — so the rack rolls without slip
 * at the drawn scale. 8 units/m with a 40 mm pinion draws it 0.32 units across; a 0.4 m lift is
 * 3.2 units. Stated on the label and in the scale notes.
 */
const RACK_UNITS_PER_METRE = 8;

function speedMultiplier(): number { return speedFromSlider(Number((el('rate') as HTMLInputElement).value)); }

function captureBounds(t: MotorTransient, e: MotorEnergy): void {
  let lo = 0, hi = 0, fullI = 0, bemf = 0, travel = 0, torque = 0;
  for (let k = 0; k < t.times.length; k++) {
    for (const v of [t.supplyVolts[k], t.terminalVolts[k]]) { if (v < lo) lo = v; if (v > hi) hi = v; }
    fullI = Math.max(fullI, Math.abs(t.motorAmps[k]), Math.abs(t.sourceAmps[k]), Math.abs(t.diodeAmps[k]));
    bemf = Math.max(bemf, Math.abs(t.backEmfVolts[k]));
    travel = Math.max(travel, Math.abs(t.thetaRad[k] * t.description.load.pinionRadiusM));
    torque = Math.max(torque, Math.abs(t.brakeTorqueNm[k]), Math.abs(t.description.motor.kVsPerRad * t.motorAmps[k]));
  }
  const k = e.times.length - 1;
  const jouleFull = Math.max(e.sourceWork[k], e.heat[k], e.kinetic[k], e.potential[k], e.viscous[k], 1e-9);
  bounds = { lo, hi: Math.max(hi, lo + 1e-9), fullI: Math.max(fullI, 1e-12), bemfFull: Math.max(bemf, 1e-9),
    travelM: Math.max(travel, 1e-3), jouleFull, torqueFull: Math.max(torque, 1e-9) };
}

// ---------------------------------------------------------------- solving
async function resolveCircuit(why: string): Promise<void> {
  if (!spice) spice = new SpiceClient();
  const mine = ++generation;
  busy = true; fault = null; paintStatus(why);
  try {
    validateMotor(circuit);
    const transient = await spice.solveMotor(circuit, { timeoutMs: 30000 });
    if (mine !== generation) return;
    const domain = motorDomain(transient);
    if (!domain.ok) throw new Error(domain.reason!);
    energy = motorEnergy(transient);
    captureBounds(transient, energy);
    const rate = circuit.stopSeconds / wallSecondsFor(speedMultiplier());
    if (playback) playback.adopt(transient, rate); else playback = new MotorPlayback(transient, rate);
    playback.replayFromRest = false;
    presented = circuit; solverFrame = playback.frame(); paused = true; busy = false; displayFault = null;
    paintStatus(`Solved. ${transient.times.length} samples over ${siUnit(transient.stopSeconds, 's')}. Press Run.`);
  } catch (e) {
    if (mine !== generation) return;
    if (e instanceof Superseded) return;
    busy = false; playback = null; solverFrame = null; presented = null; energy = null;
    fault = String(e instanceof Error ? e.message : e);
    paintStatus(null);
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

// ---------------------------------------------------------------- the scene spec
const SUP = 'mt-supply', TERM = 'mt-terminal', GND = 'mt-gnd';
const ELECTRIC = 0xd8a657, KINETIC = 0x2f7bd0, POTENTIAL = 0x4f9d69, SOURCE = 0x5fd39a;

function energyAt(time: number): Record<string, number> | null {
  if (!energy) return null;
  const times = energy.times; let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= time) lo = mid; else hi = mid; }
  const f = times[hi] > times[lo] ? Math.min(1, Math.max(0, (time - times[lo]) / (times[hi] - times[lo]))) : 0;
  const at = (a: Float64Array) => a[lo] + (a[hi] - a[lo]) * f;
  return { source: at(energy.sourceWork), switch: at(energy.switchLoss), diode: at(energy.diodeLoss), heat: at(energy.heat),
    magnetic: at(energy.magnetic), converted: at(energy.converted), kinetic: at(energy.kinetic), potential: at(energy.potential),
    viscous: at(energy.viscous), brake: at(energy.brakeWork), portRes: at(energy.portResidual), loadRes: at(energy.loadResidual), sourceRes: at(energy.sourceResidual) };
}

function motorSpec(): SceneSpec {
  const f = solverFrame, c = presented ?? circuit, known = f !== null;
  const closed = known ? f!.switchClosed : null;
  const I = known ? f!.motorAmps : null, Isrc = known ? f!.sourceAmps : null, Id = known ? f!.diodeAmps : null;
  const bemf = known ? f!.backEmfVolts : null;
  const terraces: TerraceSpec[] = [
    // THE DECK: supply and switch at the left, the motor's lane on the deck, the shaft toward the
    // viewer to the rack in front, the vessels in a row BEHIND. Ground sits on the deck at the
    // motor's far post so the motor can be drawn face-on; the supply return is routed behind.
    { id: SUP, label: known ? 'supply +' : 'supply + · unsolved', volts: known ? f!.supplyVolts : c.supplyVolts, anchor: { x: -9.0, z: -1.2 } },
    { id: TERM, label: known ? 'motor terminal' : 'motor terminal · unsolved', volts: known ? f!.terminalVolts : 0, anchor: { x: -4.4, z: -1.2 } },
    { id: GND, label: 'ground', volts: 0, isRef: true, anchor: { x: 0.8, z: -1.2 } },
  ];
  const branches: BranchSpec[] = [
    { id: 'mt-V', label: `supply ${fmt(c.supplyVolts)} V`, kind: 'source', from: GND, to: SUP, current: Isrc },
    { id: 'mt-S', kind: 'switch', from: SUP, to: TERM, current: Isrc, closed,
      label: closed === null ? 'ideal switch' : `ideal switch · ${closed ? 'CLOSED' : 'OPEN'}` },
    { id: 'mt-M', kind: 'motor', from: TERM, to: GND, current: I, backEmfVolts: bemf, backEmfFullVolts: bounds.bemfFull,
      label: bemf === null ? 'motor · not yet solved' : `motor · back-EMF ${bemf.toFixed(2)} V inside` },
    // The freewheel diode: anode at ground, cathode at the terminal — it conducts only while the
    // winding drives the terminal below ground. Drawn in front of the motor as its own lane.
    { id: 'mt-D', kind: 'diode', from: GND, to: TERM, current: Id, label: Id === null ? 'freewheel diode' : `freewheel diode · ${Id > 1e-3 ? 'CONDUCTING' : 'blocking'}` },
  ];
  const E = known ? energyAt(f!.timeSeconds) : null;
  const gauge = (id: string, label: string, colour: number, value: number | null, ref: string, x: number): StoreSpec => ({
    id, label, labelMode: 'identifier', terrace: SUP, base: GND, colour, anchor: { x, z: 4.2 },
    quantity: { quantity: label, unit: 'J', value: value ?? 0, reference: ref, scale: { min: 0, max: bounds.jouleFull, mapping: 'linear' } },
    readout: value === null ? 'not yet solved' : `${value.toFixed(3)} J`,
  });
  // SECONDARY: one row behind the deck, one joule scale; the mechanism in front is the subject.
  const stores: StoreSpec[] = [
    gauge('mt-e-source', 'source work', SOURCE, E?.source ?? null, 'work delivered by the supply since t = 0', 2.6),
    gauge('mt-e-heat', 'winding heat', THERMAL_COLOUR, E?.heat ?? null, 'R·∫i²dt since t = 0', 3.6),
    gauge('mt-e-mag', 'magnetic', MAGNETIC_COLOUR, E?.magnetic ?? null, '½·L·i², absolute', 4.6),
    gauge('mt-e-kin', 'kinetic', KINETIC, E?.kinetic ?? null, '½·J_eff·ω², absolute', 5.6),
    gauge('mt-e-pot', 'lifted', POTENTIAL, E?.potential ?? null, 'm·g·h since t = 0', 6.6),
    gauge('mt-e-visc', 'friction', ELECTRIC, E?.viscous ?? null, 'b·∫ω²dt since t = 0', 7.6),
  ].map((g) => ({ ...g, anchor: { x: g.anchor!.x, z: -4.6 } }));
  return {
    deck: { rulerX: -11.6, viewDir: [0.05, 0.42, 1] },
    fixedSpan: { lo: bounds.lo, hi: bounds.hi }, fixedFullI: bounds.fullI,
    terraces, branches, stores, drawStores: true,
    // The pinion is on the motor's shaft: same x as the motor can (the lane's midpoint), in front.
    mechanism: { kind: 'rack', anchor: { x: -1.8, z: 2.6 }, pinionRadiusM: c.load.pinionRadiusM, sceneUnitsPerMetre: RACK_UNITS_PER_METRE,
      travelM: bounds.travelM, thetaRad: known ? f!.thetaRad : null, heightM: known ? f!.heightM : null, omegaRadPerS: known ? f!.omegaRadPerS : null,
      massKg: c.load.massKg,
      label: known ? `rack · ${fmt(c.load.massKg)} kg · h ${(f!.heightM * 1000).toFixed(1)} mm (replayed θ)` : 'rack · not yet solved' },
  };
}

// ---------------------------------------------------------------- painting
function paintPresets(): void {
  const host = el('preset-buttons');
  if (!host.children.length) for (const p of MOTOR_PRESETS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = p.label; b.dataset.preset = p.id; b.onclick = () => choosePreset(p); host.appendChild(b);
  }
  for (const b of host.children) (b as HTMLButtonElement).setAttribute('aria-pressed', String(activePreset?.id === (b as HTMLElement).dataset.preset));
  el('preset-blurb').textContent = activePreset ? activePreset.blurb : 'A circuit of your own numbers, on the programme of the last demonstration.';
}
function paintSpeed(): void { const m = speedMultiplier(); el('rate-readout').textContent = `${m.toFixed(2)}× · ${wallSecondsFor(m).toFixed(0)} s for the run`; }
function paintModelNotes(): void {
  const m = circuit.motor;
  el('model-values').textContent = `R ${fmt(m.resistanceOhms)} Ω, L ${siUnit(m.inductanceHenries, 'H')}, K ${fmt(m.kVsPerRad)} V·s/rad, J_rotor ${m.rotorInertiaKgM2.toExponential(2)} kg·m², b ${m.viscousNmS.toExponential(2)} N·m·s/rad, load ${fmt(circuit.load.massKg)} kg on a ${fmt(circuit.load.pinionRadiusM * 1000)} mm pinion (J_eff ${effectiveInertia(circuit).toExponential(3)} kg·m², τ_load ${loadTorque(circuit).toFixed(4)} N·m), switch R_on ${circuit.switch.rOnOhms} Ω`
    + (activePreset ? '' : ' (your values)');
}

function paint(): void {
  paintPresets(); paintSpeed(); paintModelNotes();
  const f = solverFrame, c = presented ?? circuit, K = c.motor.kVsPerRad;
  el('play').textContent = paused ? 'Run' : 'Pause';
  el('replay').hidden = !(playback && playback.atHorizon);
  const set = (id: string, text: string) => { el(id).textContent = text; };
  if (f) {
    const conv = K * f.motorAmps * f.omegaRadPerS;
    el('headline').innerHTML = `<div><small>LOAD</small><strong>${(f.heightM * 1000).toFixed(1)} mm · ${f.omegaRadPerS.toFixed(1)} rad/s</strong><em>height and shaft speed, from the solved trajectory</em></div>`
      + `<div><small>MACHINE</small><strong>${conv > 1e-6 ? 'MOTORING' : conv < -1e-6 ? 'GENERATING' : f.switchClosed ? 'ENERGISING' : 'COASTING'}</strong><em>${conv > 1e-6 ? `K·i·ω = ${conv.toFixed(3)} W into the shaft` : conv < -1e-6 ? `K·i·ω = ${conv.toFixed(3)} W out of the shaft (brief, reported)` : f.switchClosed ? 'current building, no motion yet' : 'no current; the load and friction slow the shaft'}</em></div>`;
    set('r-i', siUnit(f.motorAmps, 'A')); set('r-bemf', `${f.backEmfVolts.toFixed(3)} V`); set('r-w', `${f.omegaRadPerS.toFixed(2)} rad/s`);
    set('r-h', `${(f.heightM * 1000).toFixed(2)} mm`); set('r-tau', `${(K * f.motorAmps).toFixed(4)} N·m`); set('r-conv', `${conv.toFixed(3)} W`);
    set('r-brake', `${f.brakeTorqueNm.toFixed(4)} N·m`); set('r-id', siUnit(f.diodeAmps, 'A'));
    const E = energyAt(f.timeSeconds)!;
    el('energy-table').innerHTML = `<b>Source</b> ${E.source.toFixed(4)} J = switch ${E.switch.toFixed(4)} + diode ${E.diode.toFixed(4)} + <b>into the motor</b> ${(E.source - E.switch - E.diode - E.sourceRes).toFixed(4)} · residual ${E.sourceRes.toExponential(2)}<br>`
      + `<b>Into the motor</b> = winding heat ${E.heat.toFixed(4)} + Δmagnetic ${(E.magnetic - (energy!.magnetic[0])).toExponential(2)} + <b>converted K·i·ω</b> ${E.converted.toFixed(4)} · residual ${E.portRes.toExponential(2)}<br>`
      + `<b>Converted</b> = Δkinetic ${(E.kinetic - energy!.kinetic[0]).toFixed(4)} + lifted m·g·h ${E.potential.toFixed(4)} + friction ${E.viscous.toFixed(4)} − brake work ${E.brake.toFixed(4)} · residual ${E.loadRes.toExponential(2)}<br>`
      + `<span style="color:var(--ws-ink-3)">All in joules since t = 0, trapezoid on the solver's own grid. Heat is R·∫i²dt. Residuals are printed, never absorbed.</span>`;
    const state = f.state === 'before-start' ? 'Braked, at rest · 0 s' : f.state === 'at-horizon' ? 'End of solved run' : f.state === 'paused' ? 'Paused' : 'Playing';
    el('scene-time').textContent = `${state} · ${siUnit(f.timeSeconds, 's')} of ${siUnit(playback!.horizonSeconds, 's')}${f.onEdge ? ' · inside a switch/brake edge' : ''}${playback!.replays ? ` · run ${playback!.replays + 1}` : ''}`;
    el('clock').textContent = `Requested ${f.requestedTimeSeconds.toExponential(4)} s · represented ${f.timeSeconds.toExponential(4)} s · grid median ${siUnit(playback!.source.actualStepSeconds.median, 's')} · ${playback!.source.engine}`;
  } else {
    el('headline').innerHTML = `<div><small>LOAD</small><strong>—</strong><em>${fault ? 'not solved' : 'solving'}</em></div>`;
    for (const id of ['r-i', 'r-bemf', 'r-w', 'r-h', 'r-tau', 'r-conv', 'r-brake', 'r-id']) set(id, '—');
    el('energy-table').textContent = ''; el('scene-time').textContent = '';
  }
  el('scale-notes').textContent = `Scales are the extrema of THIS solved run: ruler ${fmt(bounds.lo)}…${fmt(bounds.hi)} V, shared current scale ${siUnit(bounds.fullI, 'A')}, back-EMF bar full at ${bounds.bemfFull.toFixed(2)} V, vessels share one joule scale 0–${bounds.jouleFull.toFixed(3)} J, the rack's guide is the run's travel ${(bounds.travelM * 1000).toFixed(1)} mm at ${RACK_UNITS_PER_METRE} scene units per metre. The pinion and rack teeth are an ILLUSTRATIVE mesh at one coherent pitch: the model is a rolling constraint and no tooth contact is solved. Marker height = voltage; vessel fill = energy; body positions are layout only; the rack is a kinematic replay.`;
  if (stage) stage.applySpec(motorSpec());
}

// ---------------------------------------------------------------- actions
function writeForm(): void {
  const v = (id: string, x: number) => { (el(id) as HTMLInputElement).value = String(x); };
  v('supply', circuit.supplyVolts); v('r', circuit.motor.resistanceOhms); v('l', circuit.motor.inductanceHenries); v('k', circuit.motor.kVsPerRad);
  v('j', circuit.motor.rotorInertiaKgM2); v('b', circuit.motor.viscousNmS); v('m', circuit.load.massKg); v('rp', circuit.load.pinionRadiusM * 1000);
}
function choosePreset(p: MotorPreset): void {
  activePreset = p; circuit = p.build(); writeForm(); el('notice').textContent = '';
  void resolveCircuit(`${p.label}: solving. `); paint();
}
el('motor-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  try {
    const n = (id: string) => Number((el(id) as HTMLInputElement).value);
    const next: MotorDescription = { ...circuit, supplyVolts: n('supply'),
      motor: { ...circuit.motor, resistanceOhms: n('r'), inductanceHenries: n('l'), kVsPerRad: n('k'), rotorInertiaKgM2: n('j'), viscousNmS: n('b') },
      load: { ...circuit.load, massKg: n('m'), pinionRadiusM: n('rp') / 1000 } };
    validateMotor(next);
    circuit = next; activePreset = null; el('notice').textContent = '';
    void resolveCircuit('Re-solving your circuit. ');
  } catch (e) { el('notice').textContent = String(e instanceof Error ? e.message : e); }
  paint();
});
const halted = (): boolean => !playback || !!fault || !!displayFault || busy;
el('play').onclick = () => { if (halted()) return; if (playback!.atHorizon) playback!.reset(); paused = !paused; paint(); };
el('step').onclick = () => { if (halted()) return; paused = true; playback!.paused = false; playback!.stepOne(); playback!.paused = true; solverFrame = playback!.frame(); paint(); };
el('restart').onclick = () => { if (halted()) return; paused = true; playback!.reset(); solverFrame = playback!.frame(); paint(); };
el('replay').onclick = () => { if (halted()) return; playback!.reset(); paused = false; paint(); };
el('rate').addEventListener('input', () => { if (playback && presented) playback.playbackRate = presented.stopSeconds / wallSecondsFor(speedMultiplier()); paintSpeed(); });
el('save').onclick = () => {
  const url = URL.createObjectURL(new Blob([encodeMotorDoc(circuit)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'flux-motor-circuit.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('notice').textContent = 'Saved the circuit description. The running state is not included.';
};
function adoptLoaded(text: string, name: string): void {
  try {
    circuit = decodeMotorDoc(text);
    activePreset = MOTOR_PRESETS.find((p) => JSON.stringify(p.build()) === JSON.stringify(circuit)) ?? null;
    writeForm(); el('notice').textContent = `Loaded ${name}.`;
    void resolveCircuit('Solving the loaded circuit. ');
  } catch (e) { el('notice').textContent = `Could not load: ${e instanceof Error ? e.message : e}`; }
  paint();
}
el('load').addEventListener('change', async () => { const input = el('load') as HTMLInputElement, file = input.files?.[0]; if (!file) return; adoptLoaded(await file.text(), file.name); input.value = ''; });
el('reset-view').onclick = () => stage?.refit();
el('labels-on').addEventListener('change', () => stage?.setLabelsVisible((el('labels-on') as HTMLInputElement).checked));

// ---------------------------------------------------------------- the stage and the loop
function startStage(): void {
  try {
    const built = new PotentialScene(el('stage3d'), el('stagelabels'));
    el('graphics-status').hidden = true; el('stage').hidden = false;
    built.resize(); built.refit(); stage = built;
    (window as unknown as Record<string, unknown>).__motorstage = stage;
  } catch (error) {
    console.error('Motor 3D initialization failed', error); stage = null; el('stage').hidden = true;
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
      w.__motorAnimSeconds = (w.__motorAnimSeconds ?? 0) + (animating ? showDt : 0);
      if ((window as unknown as Record<string, unknown>).__motorBreakDisplayOnce) { (window as unknown as Record<string, unknown>).__motorBreakDisplayOnce = false; throw new Error('injected display failure'); }
    }
    stage?.render(animating ? showDt : 0);
  } catch (e) {
    console.error('Motor display fault', e); paused = true;
    displayFault = e instanceof Error ? e.message : String(e);
    try { paintStatus(null); } catch { /* the banner itself failed; the console has the fault */ }
  }
}

if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.__motorSeek = (t: number) => { if (!playback) return false; paused = true; playback.seek(t); solverFrame = playback.frame(); paint(); return true; };
  w.__motorPaint = () => paint();
  w.__motorDescribe = () => ({ preset: activePreset?.id ?? null, circuit, presented, bounds, frame: solverFrame, fault, busy, energy: solverFrame ? energyAt(solverFrame.timeSeconds) : null });
  w.__motorChoose = (id: string) => { const p = motorPresetById(id); if (p) choosePreset(p); return !!p; };
  w.__motorSaveText = () => encodeMotorDoc(circuit);
  w.__motorLoadText = (text: string) => adoptLoaded(text, 'probe');
  w.__motorFailNext = (reason: string) => { if (!spice) spice = new SpiceClient(); spice.failNextForTesting(reason); };
  w.__motorResolve = () => { void resolveCircuit('Probe re-solve. '); };
  w.__motorRebuildStage = () => { stage?.buildFromSpec(motorSpec()); };
  w.__motorPaintStage = () => { if (stage) stage.applySpec(motorSpec()); };
  w.__motorBreakDisplay = () => { w.__motorBreakDisplayOnce = true; };
  w.__motorState = () => ({ paused, fault, displayFault, busy, banner: el('stage-fault').hidden ? null : el('stage-fault').textContent });
}

choosePreset(MOTOR_PRESETS[0]);
requestAnimationFrame(frame);
