/**
 * A SENSOR DECIDES — the sensing bench: a prescribed environment, a resistive sensor, a comparator
 * against the pot's wiper, and the LED. No physics here; one ngspice trajectory carries the
 * environment AND the circuit, read in `src/model/sensors.ts`, played by the shared cursor.
 */
import './rc.css';
import './style.css';
import { PotentialScene, type SceneSpec, type BranchSpec, type TerraceSpec } from './potential-scene';
import { SpiceClient, Superseded } from '../model/spice/client';
import { PlaybackCursor, type PlaybackState } from '../model/spice/cursor';
import { sampleSensorsAt, type SensorsSnapshot, type SensorsTransient } from '../model/spice/sensors-transient';
import { sensorsReading, sensorsDomain, type SensorsReading } from '../model/sensors';
import { SENSORS_PRESETS, sensorsPresetById, type SensorsPreset } from '../model/sensors-presets';
import { validateSensors, sensorDomain, type SensorsDescription } from '../model/spice/sensors-netlist';
import { potLegs } from '../model/spice/parts';
import { encodeSensorsDoc, decodeSensorsDoc } from '../model/sensors-doc';
import { speedFromSlider, wallSecondsFor } from './transport';
import { fmt, siUnit } from './rc-flow';
import { frameSeconds } from '../model/rc-driver';

interface SensorsFrame extends SensorsSnapshot { kind: 'solved'; requestedTimeSeconds: number; clampedToHorizon: boolean; onEdge: boolean; state: PlaybackState; progress: number }
class SensorsPlayback extends PlaybackCursor<SensorsTransient> {
  frame(): SensorsFrame { const s = sampleSensorsAt(this.transient, this.cursor); const atStart = !this.started && this.cursor === 0; return { kind: 'solved', ...s, state: atStart ? 'before-start' : this.state, progress: atStart ? 0 : this.progress }; }
}

const root = document.getElementById('rc-app')!;
root.innerHTML = `
<header><span><a href="/rc.html">← RLC</a> · <a href="/lamp.html">← Transistor</a> · <a href="/motor.html">← Motor</a> · <a href="/controls.html">← Controls</a> · <a href="/fan.html">A thermistor runs a motor →</a></span><span>FLUX GARDEN / SENSORS</span></header>
<section class="intro"><p class="eyebrow">THE ENVIRONMENT, A SENSOR, A DECISION</p><h1>A sensor decides: darkness switches a light on, warmth an indicator.</h1>
<p>A photoresistor or a thermistor turns the world into a resistance; a divider turns that into a voltage; a comparator holds it against the knob's reference and drives the LED. The environment here is <b>prescribed</b> — a programmed ramp that the solver carries alongside the circuit — and the sun or thermometer on the bench shows that same input at the same instant. Nothing on the bench senses the LED. <a href="#model-notes">The models, and what they do not claim &rarr;</a></p></section>
<div class="layout"><aside><h2>Your circuit</h2>
<p class="hint"><b>Reference</b> · the knob sets the comparator's threshold</p>
<input id="knob" type="range" min="0" max="1000" value="500" aria-label="Reference wiper"><output id="knob-readout" class="hint"></output>
<form id="sensors-form">
<label>Supply · V<input id="supply" type="number" value="5" step="any" min="0.5" max="30" required></label>
<label>Divider fixed resistor · Ω<input id="rfix" type="number" value="10000" step="any" min="100" max="1000000" required></label>
<label>Series resistor · Ω<input id="rs" type="number" value="220" step="any" min="10" max="100000" required></label>
<label>Environment at the end of the ramp · <span id="env-unit">lux</span><input id="env-end" type="number" value="2" step="any" required></label>
<button type="submit">Apply &amp; re-solve</button></form>
<p class="hint">Every change re-solves the whole run and restarts it; the previous picture stays until the new solve is adopted.</p>
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
<div>Environment · prescribed<output id="r-env">—</output></div>
<div>Sensor · solved V/I · law<output id="r-rs">—</output></div>
<div class="cool">v<sub>in</sub> · divider<output id="r-vin">—</output></div>
<div class="cool">v<sub>ref</sub> · knob<output id="r-vref">—</output></div>
<div>v<sub>in</sub> − v<sub>ref</sub> · band ±10 µV<output id="r-diff">—</output></div>
<div>Comparator output<output id="r-out">—</output></div>
<div class="warm">LED current · drive of 30 mA<output id="r-il">—</output></div>
<div>Supply current · divider + ref + output<output id="r-icc">—</output></div>
</div>
<p class="hint" id="solver-status"></p>
<p class="hint" id="scene-time"></p>
<p id="graphics-status" role="status" hidden></p>
<details id="model-notes"><summary>The models, and what they do not claim</summary>
<p class="hint"><b>Photoresistor</b>: GL5528-class CdS cell. From the datasheet page read (the "CdS PHOTOCONDUCTIVE CELLS GL5528" sheet hosted by SparkFun as SEN-09088; the manufacturer's name is not printed on that page, and GL5528 is a family label): light resistance at 10 lux 8–20 kΩ, dark resistance 1.0 MΩ min (10 s after 10 lux), γ 0.7 ± 0.1 between 10 and 100 lux, chart 1–100 lux. Selected R<sub>10</sub> = 12 kΩ, γ = 0.7: R(E) = min(1 MΩ, 12 kΩ·(E/10)<sup>−0.7</sup>) on the <b>declared domain 1…100 lux</b>. The dark clamp never engages inside it — darkness below 1 lux is outside the demonstrated range, not a tested state. γ is the datasheet's approximation; no claim that every part follows it.</p>
<p class="hint"><b>Thermistor</b>: NTC beta law R = R<sub>0</sub>·exp(B·(1/T − 1/T<sub>0</sub>)), R<sub>0</sub> 10 kΩ at 25 °C, B 3950 K, declared −20…+80 °C, kelvin inside. The sensor temperature is the prescribed programme — no thermal lag, no self-heating. Tabulated beta-law values check this implementation, not any real thermistor's accuracy over that range.</p>
<p class="hint"><b>Comparator</b>: an explicitly illustrative push-pull comparator built inside the ngspice deck — a limited-gain stage u = clip(0.5 + 10<sup>4</sup>·(v<sub>in</sub> − v<sub>ref</sub>), 0, 1) drives a high-side ideal switch from the supply and, with 1 − u, a low-side switch to ground, through one 50 Ω output resistance. So it goes high when v<sub>in</sub> − v<sub>ref</sub> exceeds +10 µV and low below −10 µV; <b>inside that 20 µV band the previous state is kept</b> — it is hysteresis, not a dead zone (tested by holding the input exactly at the reference from below and from above). The decision is the solver's; the page reads it as the solved high-side switch state at the nearest sample. Only a run that <i>starts</i> inside the band would leave both switches open with the output floating through a 1 MΩ leak, so such a start is refused as ambiguous. No hysteresis beyond that band, no catalogue part, no op-amp fidelity. The output current comes from the supply through the comparator, so the supply's current includes the LED's.</p>
<p class="hint"><b>LED</b> and <b>reference potentiometer</b> are the controls bench's parts (the comparator's inputs are declared high-impedance, so the reference divider is unloaded). Verified in <code>tools/sensors-spice-verify.mjs</code>: the solved sensor resistance (V/I from probes) against its law at every sample; the decision against sign(v<sub>in</sub> − v<sub>ref</sub>) outside the band; the output stage and supply currents through both crossings; native ngspice-45.2 against the WASM build. Playback speed re-times the run and touches no number.</p>
<p class="hint" id="scale-notes"></p>
</details>
</section>
</article></div>`;

const el = (id: string) => document.getElementById(id)!;
let circuit: SensorsDescription = SENSORS_PRESETS[0].build();
let activePreset: SensorsPreset | null = SENSORS_PRESETS[0];
let spice: SpiceClient | null = null;
let playback: SensorsPlayback | null = null;
let presented: SensorsDescription | null = null;
let solverFrame: SensorsFrame | null = null;
let fault: string | null = null, displayFault: string | null = null;
let busy = false, paused = true, generation = 0;
let stage: PotentialScene | null = null;
let bounds = { lo: 0, hi: 5, fullI: 1e-12 };

function speedMultiplier(): number { return speedFromSlider(Number((el('rate') as HTMLInputElement).value)); }
function captureBounds(t: SensorsTransient): void {
  let lo = 0, hi = 0, fullI = 0;
  for (let k = 0; k < t.times.length; k++) { for (const v of [t.supplyVolts[k], t.vinVolts[k], t.vrefVolts[k], t.outVolts[k], t.ledAnodeVolts[k]]) { if (v < lo) lo = v; if (v > hi) hi = v; } fullI = Math.max(fullI, Math.abs(t.supplyAmps[k]), Math.abs(t.ledAmps[k])); }
  bounds = { lo, hi: Math.max(hi, lo + 1e-9), fullI: Math.max(fullI, 1e-12) };
}
async function resolveCircuit(why: string): Promise<void> {
  if (!spice) spice = new SpiceClient();
  const mine = ++generation; busy = true; fault = null; paintStatus(why);
  try {
    validateSensors(circuit);
    const transient = await spice.solveSensors(circuit);
    if (mine !== generation) return;
    const domain = sensorsDomain(transient); if (!domain.ok) throw new Error(domain.reason!);
    captureBounds(transient);
    const rate = circuit.stopSeconds / wallSecondsFor(speedMultiplier());
    if (playback) playback.adopt(transient, rate); else playback = new SensorsPlayback(transient, rate);
    playback.replayFromRest = false; presented = circuit; solverFrame = playback.frame(); paused = true; busy = false; displayFault = null;
    paintStatus(`Solved. ${transient.times.length} samples over ${siUnit(transient.stopSeconds, 's')}; the comparator switches at ${domain.crossings.map((x) => x.toFixed(3) + ' s').join(', ') || 'no point'}. Press Run.`);
  } catch (e) {
    if (mine !== generation) return; if (e instanceof Superseded) return;
    busy = false; playback = null; solverFrame = null; presented = null; fault = String(e instanceof Error ? e.message : e); paintStatus(null);
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

const VCC = 'sn-vcc', DIV = 'sn-div', VIN = 'sn-vin', VREF = 'sn-vref', OUT = 'sn-out', ANODE = 'sn-anode', GND = 'sn-gnd';
function sensorsSpec(): SceneSpec {
  const f = solverFrame, c = presented ?? circuit, known = f !== null;
  const r: SensorsReading | null = f ? sensorsReading(f, c) : null;
  const ldr = c.sensor.kind === 'ldr', [dlo, dhi] = sensorDomain(c.sensor);
  const envFrac = known ? (ldr ? Math.log(f!.environment / dlo) / Math.log(dhi / dlo) : (f!.environment - dlo) / (dhi - dlo)) : null;
  const envText = known ? (ldr ? `${f!.environment.toFixed(1)} lux` : `${f!.environment.toFixed(1)} °C`) : 'not yet solved';
  const terraces: TerraceSpec[] = [
    { id: VCC, label: known ? 'supply +' : 'supply + · unsolved', volts: known ? f!.supplyVolts : c.supplyVolts, anchor: { x: -10.0, z: -1.2 } },
    { id: DIV, label: ldr ? 'fixed resistor → sensor' : 'sensor → fixed resistor', volts: known ? f!.supplyVolts : c.supplyVolts, anchor: { x: -6.2, z: -1.2 } },
    { id: VIN, label: known ? 'v_in · divider' : 'v_in · unsolved', volts: known ? f!.vinVolts : 0, anchor: { x: -1.2, z: -1.2 } },
    { id: VREF, label: known ? 'v_ref · knob' : 'v_ref · unsolved', volts: known ? f!.vrefVolts : 0, anchor: { x: -5.2, z: 4.0 } },
    { id: OUT, label: known ? 'comparator out' : 'out · unsolved', volts: known ? f!.outVolts : 0, anchor: { x: 4.4, z: -1.2 } },
    { id: ANODE, label: known ? 'LED anode' : 'LED anode · unsolved', volts: known ? f!.ledAnodeVolts : 0, anchor: { x: 8.0, z: 2.2 } },
    { id: GND, label: 'ground', volts: 0, isRef: true, anchor: { x: 2.0, z: 4.0 } },
  ];
  const Iled = known ? f!.ledAmps : null, Idiv = known ? f!.dividerAmps : null;
  // The divider: fixed resistor and sensor in series between the supply and ground; the LDR is the
  // LOWER leg (v_in above it), the NTC the UPPER leg (v_in below it) — as in the deck.
  const upper: BranchSpec = ldr
    ? { id: 'sn-Rfix', kind: 'load', from: DIV, to: VIN, current: Idiv, label: `fixed ${siUnit(c.fixedOhms, 'Ω')}` }
    : { id: 'sn-sensor', kind: 'sensor', from: DIV, to: VIN, current: Idiv, label: r ? `thermistor · ${fmt(Number(r.sensorOhmsSolved.toPrecision(4)))} Ω` : 'thermistor',
        sensor: { kind: 'ntc', environmentFraction: envFrac, environmentText: envText, resistanceOhms: r ? r.sensorOhmsSolved : null } };
  const lower: BranchSpec = ldr
    ? { id: 'sn-sensor', kind: 'sensor', from: VIN, to: GND, current: Idiv, label: r ? `photoresistor · ${fmt(Number(r.sensorOhmsSolved.toPrecision(4)))} Ω` : 'photoresistor',
        sensor: { kind: 'ldr', environmentFraction: envFrac, environmentText: envText, resistanceOhms: r ? r.sensorOhmsSolved : null } }
    : { id: 'sn-Rfix', kind: 'load', from: VIN, to: GND, current: Idiv, label: `fixed ${siUnit(c.fixedOhms, 'Ω')}` };
  const branches: BranchSpec[] = [
    { id: 'sn-V', label: `supply ${fmt(c.supplyVolts)} V`, kind: 'source', from: GND, to: VCC, current: known ? f!.supplyAmps : null },
    { id: 'sn-top', label: '', kind: 'wire', from: VCC, to: DIV, current: Idiv },
    upper, lower,
    { id: 'sn-P', kind: 'pot', from: VCC, to: GND, current: known ? f!.refInAmps : null, legBCurrent: known ? f!.refInAmps : null, wiperTerrace: VREF, wiperFraction: c.reference.wiperFraction, wiperCurrent: 0,
      label: `reference ${siUnit(c.reference.totalOhms, 'Ω')} · f ${c.reference.wiperFraction.toFixed(2)}` },
    { id: 'sn-C', kind: 'comparator', from: VIN, to: OUT, refTerrace: VREF, supplyTerrace: VCC, current: known ? f!.outStageAmps : null, high: known ? f!.high : null,
      label: r ? `comparator · ${r.insideBand ? 'IN BAND' : r.high ? 'HIGH' : 'low'}` : 'comparator' },
    { id: 'sn-R', kind: 'load', from: OUT, to: ANODE, current: Iled, label: `series ${siUnit(c.seriesOhms, 'Ω')}` },
    { id: 'sn-L', kind: 'led', from: ANODE, to: GND, current: Iled, emission: r ? r.brightness : null, label: r ? `LED · ${(r.brightness * 100).toFixed(0)}% drive` : 'LED' },
  ];
  return { deck: { rulerX: -12.4, viewDir: [0.04, 0.5, 1] }, fixedSpan: { lo: bounds.lo, hi: bounds.hi }, fixedFullI: bounds.fullI, terraces, branches, drawStores: false };
}

function paintPresets(): void {
  const host = el('preset-buttons');
  if (!host.children.length) for (const p of SENSORS_PRESETS) { const b = document.createElement('button'); b.type = 'button'; b.textContent = p.label; b.dataset.preset = p.id; b.onclick = () => choosePreset(p); host.appendChild(b); }
  for (const b of host.children) (b as HTMLButtonElement).setAttribute('aria-pressed', String(activePreset?.id === (b as HTMLElement).dataset.preset));
  el('preset-blurb').textContent = activePreset ? activePreset.blurb : 'Your own reference, numbers or ramp end, solved as a new run.';
}
function paintControls(): void {
  (el('knob') as HTMLInputElement).value = String(Math.round(circuit.reference.wiperFraction * 1000));
  const { aw, wb } = potLegs(circuit.reference);
  el('knob-readout').textContent = `f = ${circuit.reference.wiperFraction.toFixed(3)} · v_ref ≈ ${(circuit.supplyVolts * wb / (aw + wb)).toFixed(3)} V (unloaded: the comparator input draws nothing)`;
  (el('supply') as HTMLInputElement).value = String(circuit.supplyVolts); (el('rfix') as HTMLInputElement).value = String(circuit.fixedOhms); (el('rs') as HTMLInputElement).value = String(circuit.seriesOhms);
  (el('env-end') as HTMLInputElement).value = String(circuit.environment[2].value); el('env-unit').textContent = circuit.sensor.kind === 'ldr' ? 'lux (1…100)' : '°C (−20…80)';
}
function paint(): void {
  paintPresets(); paintControls();
  const m = speedMultiplier(); el('rate-readout').textContent = `${m.toFixed(2)}× · ${wallSecondsFor(m).toFixed(0)} s for the run`;
  const f = solverFrame, c = presented ?? circuit, r = f ? sensorsReading(f, c) : null;
  el('play').textContent = paused ? 'Run' : 'Pause'; el('replay').hidden = !(playback && playback.atHorizon);
  const set = (id: string, text: string) => { el(id).textContent = text; };
  if (f && r) {
    const unit = c.sensor.kind === 'ldr' ? 'lux' : '°C';
    el('headline').innerHTML = `<div><small>${c.sensor.kind === 'ldr' ? 'LIGHT' : 'TEMPERATURE'}</small><strong>${f.environment.toFixed(1)} ${unit} → ${fmt(Number(r.sensorOhmsSolved.toPrecision(4)))} Ω</strong><em>prescribed input, and the sensor's solved resistance</em></div>`
      + `<div><small>DECISION</small><strong>${r.insideBand ? 'IN THE BAND' : r.high ? 'HIGH · LED ON' : 'LOW · LED OFF'}</strong><em>v_in − v_ref = ${(r.differenceVolts * 1e3).toFixed(2)} mV against a ±${(r.thresholdVolts * 1e6).toFixed(0)} µV band</em></div>`;
    set('r-env', `${f.environment.toFixed(2)} ${unit}`); set('r-rs', `${fmt(Number(r.sensorOhmsSolved.toPrecision(5)))} · ${fmt(Number(r.sensorOhmsLaw.toPrecision(5)))} Ω`);
    set('r-vin', `${f.vinVolts.toFixed(4)} V`); set('r-vref', `${f.vrefVolts.toFixed(4)} V`); set('r-diff', `${(r.differenceVolts * 1e3).toFixed(3)} mV`);
    set('r-out', `${r.high ? 'HIGH' : 'low'} · ${f.outVolts.toFixed(3)} V`); set('r-il', `${(f.ledAmps * 1e3).toFixed(2)} mA · ${(r.brightness * 100).toFixed(0)}%`); set('r-icc', `${(f.supplyAmps * 1e3).toFixed(2)} mA`);
    const state = f.state === 'before-start' ? 'Operating point · 0 s' : f.state === 'at-horizon' ? 'End of solved run' : f.state === 'paused' ? 'Paused' : 'Playing';
    el('scene-time').textContent = `${state} · ${siUnit(f.timeSeconds, 's')} of ${siUnit(playback!.horizonSeconds, 's')}${f.onEdge ? ' · environment ramping' : ''}`;
    el('clock').textContent = `Requested ${f.requestedTimeSeconds.toExponential(4)} s · represented ${f.timeSeconds.toExponential(4)} s · grid median ${siUnit(playback!.source.actualStepSeconds.median, 's')} · ${playback!.source.engine}`;
  } else {
    el('headline').innerHTML = `<div><small>SENSOR</small><strong>—</strong><em>${fault ? 'not solved' : 'solving'}</em></div>`;
    for (const id of ['r-env', 'r-rs', 'r-vin', 'r-vref', 'r-diff', 'r-out', 'r-il', 'r-icc']) set(id, '—');
    el('scene-time').textContent = '';
  }
  el('scale-notes').textContent = `Scales are the extrema of THIS solved run: ruler ${fmt(bounds.lo)}…${fmt(bounds.hi)} V, shared current scale ${siUnit(bounds.fullI, 'A')}. The sun's brightness / the thermometer's height is the prescribed input's position in the sensor's declared domain (log for lux), at the playback instant; it is not light or heat rendered onto the sensor. Marker height = voltage; body positions are layout only.`;
  if (stage) stage.applySpec(sensorsSpec());
}
let knobTimer: ReturnType<typeof setTimeout> | null = null;
function setCircuit(next: SensorsDescription, why: string): void {
  try { validateSensors(next); circuit = next; activePreset = null; el('notice').textContent = ''; void resolveCircuit(why); }
  catch (e) { el('notice').textContent = String(e instanceof Error ? e.message : e); }
  paint();
}
function choosePreset(p: SensorsPreset): void { activePreset = p; circuit = p.build(); el('notice').textContent = ''; void resolveCircuit(`${p.label}: solving. `); paint(); }
el('knob').addEventListener('input', () => {
  const f = Math.min(1, Math.max(0, Number((el('knob') as HTMLInputElement).value) / 1000));
  circuit = { ...circuit, reference: { ...circuit.reference, wiperFraction: f } }; activePreset = null; paintControls();
  if (knobTimer) clearTimeout(knobTimer);
  knobTimer = setTimeout(() => { knobTimer = null; setCircuit(circuit, `Reference at f = ${f.toFixed(2)}: new solve, new run. `); }, 120);
});
el('sensors-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const n = (id: string) => Number((el(id) as HTMLInputElement).value);
  const env = circuit.environment.map((p, k) => (k >= 2 ? { ...p, value: n('env-end') } : { ...p }));
  setCircuit({ ...circuit, supplyVolts: n('supply'), fixedOhms: n('rfix'), seriesOhms: n('rs'), environment: env }, 'Re-solving your circuit. ');
});
const halted = (): boolean => !playback || !!fault || !!displayFault || busy;
el('play').onclick = () => { if (halted()) return; if (playback!.atHorizon) playback!.reset(); paused = !paused; paint(); };
el('step').onclick = () => { if (halted()) return; paused = true; playback!.paused = false; playback!.stepOne(); playback!.paused = true; solverFrame = playback!.frame(); paint(); };
el('restart').onclick = () => { if (halted()) return; paused = true; playback!.reset(); solverFrame = playback!.frame(); paint(); };
el('replay').onclick = () => { if (halted()) return; playback!.reset(); paused = false; paint(); };
el('rate').addEventListener('input', () => { if (playback && presented) playback.playbackRate = presented.stopSeconds / wallSecondsFor(speedMultiplier()); paint(); });
el('save').onclick = () => { const url = URL.createObjectURL(new Blob([encodeSensorsDoc(circuit)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'flux-sensors-circuit.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); el('notice').textContent = 'Saved the circuit description. The running state is not included.'; };
function adoptLoaded(text: string, name: string): void {
  try { circuit = decodeSensorsDoc(text); activePreset = SENSORS_PRESETS.find((p) => JSON.stringify(p.build()) === JSON.stringify(circuit)) ?? null; el('notice').textContent = `Loaded ${name}.`; void resolveCircuit('Solving the loaded circuit. '); }
  catch (e) { el('notice').textContent = `Could not load: ${e instanceof Error ? e.message : e}`; }
  paint();
}
el('load').addEventListener('change', async () => { const input = el('load') as HTMLInputElement, file = input.files?.[0]; if (!file) return; adoptLoaded(await file.text(), file.name); input.value = ''; });
el('reset-view').onclick = () => stage?.refit();
el('labels-on').addEventListener('change', () => stage?.setLabelsVisible((el('labels-on') as HTMLInputElement).checked));
function startStage(): void {
  try { const built = new PotentialScene(el('stage3d'), el('stagelabels')); el('graphics-status').hidden = true; el('stage').hidden = false; built.resize(); built.refit(); stage = built; (window as unknown as Record<string, unknown>).__sensorsstage = stage; }
  catch (error) { console.error('Sensors 3D initialization failed', error); stage = null; el('stage').hidden = true; const status = el('graphics-status'); status.hidden = false; status.textContent = `The 3D scene could not start (${error instanceof Error ? error.message : String(error)}). Every reading below is still live.`; }
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
    if (import.meta.env.DEV) { const w = window as unknown as Record<string, number>; w.__sensorsAnimSeconds = (w.__sensorsAnimSeconds ?? 0) + (animating ? showDt : 0); if ((window as unknown as Record<string, unknown>).__sensorsBreakDisplayOnce) { (window as unknown as Record<string, unknown>).__sensorsBreakDisplayOnce = false; throw new Error('injected display failure'); } }
    stage?.render(animating ? showDt : 0);
  } catch (e) { console.error('Sensors display fault', e); paused = true; displayFault = e instanceof Error ? e.message : String(e); try { paintStatus(null); } catch { /* the banner itself failed */ } }
}
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.__sensorsSeek = (t: number) => { if (!playback) return false; paused = true; playback.seek(t); solverFrame = playback.frame(); paint(); return true; };
  w.__sensorsPaint = () => paint();
  w.__sensorsDescribe = () => ({ preset: activePreset?.id ?? null, circuit, presented, bounds, frame: solverFrame, fault, busy });
  w.__sensorsChoose = (id: string) => { const p = sensorsPresetById(id); if (p) choosePreset(p); return !!p; };
  w.__sensorsKnob = (f: number) => { (el('knob') as HTMLInputElement).value = String(Math.round(f * 1000)); el('knob').dispatchEvent(new Event('input')); };
  w.__sensorsSaveText = () => encodeSensorsDoc(circuit);
  w.__sensorsLoadText = (text: string) => adoptLoaded(text, 'probe');
  w.__sensorsFailNext = (reason: string) => { if (!spice) spice = new SpiceClient(); spice.failNextForTesting(reason); };
  w.__sensorsResolve = () => { void resolveCircuit('Probe re-solve. '); };
  w.__sensorsRebuildStage = () => { stage?.buildFromSpec(sensorsSpec()); };
  w.__sensorsPaintStage = () => { if (stage) stage.applySpec(sensorsSpec()); };
  w.__sensorsBreakDisplay = () => { w.__sensorsBreakDisplayOnce = true; };
  w.__sensorsState = () => ({ paused, fault, displayFault, busy, banner: el('stage-fault').hidden ? null : el('stage-fault').textContent, labels: stage?.labelsVisible });
}
choosePreset(SENSORS_PRESETS[0]);
requestAnimationFrame(frame);
