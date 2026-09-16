/**
 * A THERMISTOR RUNS A MOTOR — the smaller-model trial's composition on the workstation. The circuit
 * is the trial's JSON (`tools/conformance/trial/fan.composition.json`), solved through the same
 * structure the conformance kit checks and read by observable name in `src/model/fan.ts`; this
 * page owns no circuit numbers. The rotor replays θ = ∫ω dt of the DECLARED inertia + linear-drag
 * load; the thermometer shows the PRESCRIBED temperature at the same instant. No air, no heat flow.
 */
import './rc.css';
import './style.css';
import { PotentialScene, type SceneSpec, type BranchSpec, type TerraceSpec } from './potential-scene';
import { SpiceClient, Superseded } from '../model/spice/client';
import { PlaybackCursor, type PlaybackState } from '../model/spice/cursor';
import { FAN_COMPOSITION, FAN_SUPPLY_VOLTS, FAN_SUPPLY_SETTINGS, FAN_DOMAIN, FAN_PROGRAMMES, toFanTransient, sampleFanAt, fanReading, fanEnergy, fanDomain, gateCurrentSeries, supplyVoltsOf, programmeOf, withSupplyVolts, withProgramme, assertSupportedFan, type FanTransient, type FanSnapshot, type FanEnergy, type FanProgramme } from '../model/fan';
import { encodeFanDoc, decodeFanDoc } from '../model/fan-doc';
import type { Composition } from '../model/conformance/composition';
import { sha256Json } from '../model/conformance/kit';
import elkLayoutFile from './fan-layout.elk.json';
import { placementFrom, structuralSha256, busThrough, type ElkLayoutFile, type DeckPlacement } from './deck-layout';
import { railLayout, railInputFrom, validateRailLayout, structuralHash, terminalAt, checkGeometry3D, layoutTerminals, layoutNets, type RailLayout, type Wire3, type BodyShape } from './rail-layout';
import type { PartInstance } from '../model/conformance/composition';
import { speedFromSlider, wallSecondsFor } from './transport';
import { fmt, siUnit } from './rc-flow';
import { frameSeconds } from '../model/rc-driver';

interface FanFrame extends FanSnapshot { kind: 'solved'; state: PlaybackState; progress: number }
class FanPlayback extends PlaybackCursor<FanTransient> {
  frame(): FanFrame { const s = sampleFanAt(this.transient, this.cursor); const atStart = !this.started && this.cursor === 0; return { kind: 'solved', ...s, state: atStart ? 'before-start' : this.state, progress: atStart ? 0 : this.progress }; }
}

/** The flow-cue readability calibration (declared on the page; see the model notes). */
const FLOW_CUE = { fullUnitsPerSecond: 1.8, floorUnitsPerSecond: 0.6, visibilityPower: 0.3 };
const ELK_FILE = elkLayoutFile as unknown as ElkLayoutFile;
const ELK_CHORDS: Record<string, [string, string]> = { ntc: ['a', 'b'], rb: ['a', 'b'], pot: ['a', 'b'], comparator: ['inp', 'out'], mosfet: ['drain', 'source'], motor: ['plus', 'minus'], flyback: ['anode', 'cathode'] };
const root = document.getElementById('rc-app')!;
root.innerHTML = `
<header><span><a href="/rc.html">← RLC</a> · <a href="/lamp.html">← Transistor</a> · <a href="/motor.html">← Motor</a> · <a href="/controls.html">← Controls</a> · <a href="/sensors.html">← Sensors</a></span><span>FLUX GARDEN / THERMISTOR → MOTOR</span></header>
<section class="intro"><p class="eyebrow">A COMPOSITION, BUILT BY A SMALLER MODEL, CHECKED BY THE KIT</p><h1>Warmth switches a motor on; more volts spin it faster.</h1>
<p>A thermistor and a fixed resistor turn the <b>prescribed</b> temperature into a voltage; a comparator holds it against the pot's reference and drives a MOSFET; the MOSFET grounds the motor's low side; a freewheel diode carries the winding current back to the rail when the MOSFET turns off. The one <b>circuit supply</b> feeds the sensing divider, the reference, the comparator and the motor: turn it up and the solver delivers more power to the same declared load. The rotor replays the solved angle — drawn like a fan, but no air is moved and nothing warms or cools the thermistor. <a href="#model-notes">The circuit, the checks, and what is not claimed &rarr;</a></p></section>
<div class="layout"><article>
<div class="transport fan-controls">
  <span class="speed" aria-label="Motor supply"><label for="supply"><b>Motor supply</b> · the circuit's one rail</label><input id="supply" type="range" min="0" max="${FAN_SUPPLY_SETTINGS.length - 1}" step="1" value="${FAN_SUPPLY_SETTINGS.indexOf(FAN_SUPPLY_VOLTS.default)}" aria-describedby="supply-readout" title="Verified settings only: 0.25 V steps from 3 to 9 V, except 7.50 V"><output id="supply-readout"></output></span>
  <span class="presets" aria-label="Temperature programme"><span class="preset-lead">TEMPERATURE</span><span id="preset-buttons"></span></span>
  <span class="actions"><button id="save">Save experiment</button><label class="file">Load experiment<input id="load" type="file" accept=".json,application/json"></label></span>
  <span class="presets" aria-label="Layout"><span class="preset-lead">LAYOUT</span><span id="layout-buttons"><button type="button" data-layout="rails" aria-pressed="true">Rails</button><button type="button" data-layout="hand" aria-pressed="false">Hand</button><button type="button" data-layout="elk" aria-pressed="false" disabled>ELK prototype</button></span></span>
</div>
<p class="hint" id="preset-blurb"></p>
<p id="notice" role="status"></p>
<div class="transport"><button id="play">Run</button><button id="step">One tick</button><button id="restart">Restart</button><button id="replay" hidden>Replay ↻</button><span class="speed" aria-label="Playback speed"><label for="rate">Playback speed</label><input id="rate" type="range" min="0" max="1000" value="350" aria-describedby="rate-readout"><output id="rate-readout"></output></span><details class="timing-details"><summary>Timing</summary><span id="clock"></span></details></div>
<section class="instrument">
<div id="circuit-world"><div id="stage"><button id="reset-view" title="Restore the starting view">Reset view</button><label class="labels-toggle"><input id="labels-on" type="checkbox" checked> Labels</label><label class="labels-toggle values-toggle"><input id="labels-values" type="checkbox"> Values in labels</label><span class="orbit-hint">Drag to look around · marker height = voltage</span><div id="pending-badge" class="pending-badge" hidden></div><div id="stage3d"></div><div id="stagelabels"></div></div></div>
<div id="stage-fault" class="stage-fault" hidden role="alert"></div>
<div id="headline"></div>
<div class="readouts">
<div>Temperature · prescribed<output id="r-temp">—</output></div>
<div>Thermistor · solved V/I · law<output id="r-rs">—</output></div>
<div class="cool">v<sub>sense</sub> · v<sub>ref</sub><output id="r-vin">—</output></div>
<div>Comparator · v<sub>sense</sub> − v<sub>ref</sub><output id="r-cmp">—</output></div>
<div class="cool">Gate · V<sub>GS</sub> · region<output id="r-gate">—</output></div>
<div>MOSFET · I<sub>D</sub> · I<sub>G</sub> · I<sub>S</sub><output id="r-iq">—</output></div>
<div>Comparator · I<sub>Vcc</sub> · I<sub>out</sub> · I<sub>gnd</sub><output id="r-ic">—</output></div>
<div class="warm">Motor terminal · V · I · W<output id="r-im">—</output></div>
<div class="warm">Shaft speed · RPM<output id="r-rpm">—</output></div>
<div>Back-EMF K·ω · torque K·i<output id="r-bemf">—</output></div>
<div class="warm">Shaft · ω · θ<output id="r-w">—</output></div>
<div>Freewheel diode<output id="r-id">—</output></div>
<div>Supply current<output id="r-icc">—</output></div>
<div>Motor port energy since 0 s<output id="r-e">—</output></div>
<div>Port balance residual<output id="r-res">—</output></div>
</div>
<p class="hint" id="solver-status"></p>
<p class="hint" id="scene-time"></p>
<p id="graphics-status" role="status" hidden></p>
<details id="model-notes"><summary>The circuit, the checks, and what is not claimed</summary>
<p class="hint"><b>The base composition.</b> The circuit is the trial's <code>fan.composition.json</code>, authored by the builder model against a frozen expectation set (18 checks, PASS on native ngspice and on the WASM engine this page runs). This page edits a deep copy in exactly two places — the supply voltage of its one source, and the prescribed temperature programme — and refuses anything else on load. The frozen trial files are untouched. Runs at other voltages are solved by the same engine and checked by this page's own domain and tests; <b>the 6 V warm-then-cool cycle is the run that passed the trial's 18 declared checks</b>; the other settings have not been put through them. <span id="composition-identity"></span></p>
<details><summary>The experiment now solved, verbatim</summary><pre class="hint" id="composition-json" style="white-space:pre-wrap;font-size:11px"></pre></details>
<p class="hint"><b>One rail, two effects.</b> Because the thermistor divider and the reference pot both hang on the same rail, their ratio does not depend on it: the <i>nominal</i> switching temperature stays the same at every supply (a tiny supply-dependent band remains from the comparator's fixed ±10 µV hysteresis, plus numerical timing — the crossing instants are read from each run, never assumed equal). What the supply changes is the gate drive (the comparator's high level is the rail) and the power the motor can draw: the readouts print the terminal voltage, current and V·I actually delivered to the declared load, and the shaft speed in RPM. Voltage is the setting; watts and RPM are consequences the solver reports.</p>
<p class="hint"><b>How the current is drawn.</b> Tube thickness encodes |I| against the printed scale; the cues' opacity and streak length are (|I|/scale)<sup>${FLOW_CUE.visibilityPower}</sup> — a declared contrast curve that goes continuously to nothing as the current does, with no floor and no cutoff (a cue you can barely see is a current that is barely there); their DIRECTION is the solved sign at the playback instant. The cues' travel SPEED is a readability calibration per wall second — ${FLOW_CUE.floorUnitsPerSecond} scene units/s for any nonzero current rising to ${FLOW_CUE.fullUnitsPerSecond} at full scale on a √ curve — so it is not electron drift and not proportional to the current, and it does not change with the playback speed; zero draws and moves nothing, and pausing stops it. Electrical state, current magnitude, rotor angle and every event stay on the solved time.</p>
<p class="hint"><b>Layouts.</b> <b>Rails</b> (default): the + rail along the back and ground along the front, each body with a short straight drop to its rail; the current on each bar segment is the signed sum of the members' solved currents beyond it (KCL by construction — a sum, not a probe); the signal chain runs sense → comparator → gate → MOSFET; the reference cable hops over the thermistor's drop (the one unavoidable crossing). <b>Hand</b>: the earlier posed layout, kept for comparison. <b>ELK prototype</b>: bodies placed by the ELK layered algorithm offline (elkjs ${ELK_FILE.elkjs}, seed 7, committed JSON re-checked against this circuit's structure) with its orthogonal routes — deterministic placement, but its wiring detours around whole groups and crosses itself; kept as a comparison, not a recommendation. All three draw the same nets and the same solved numbers; layout is presentation only.</p>
<p class="hint"><b>Supported settings and domain.</b> The control offers ${FAN_SUPPLY_SETTINGS.length} verified settings — 0.25 V steps from ${FAN_SUPPLY_VOLTS.min} to ${FAN_SUPPLY_VOLTS.max} V, <b>except 7.50 V</b>: every step was solved in both programmes on this page's WASM engine and checked against the domain below; at 7.50 V the warm-then-cool turn-off transient reaches −1.095 mA, past the −1 mA floor, so that setting is withheld rather than the floor widened (an observed solver transient at turn-off on this engine, not monotone in voltage — 7.25 V gives −0.996 mA, 7.75 V −0.729 mA — and not independently established as a numerical artefact). Every run must keep the motor current within ${FAN_DOMAIN.minAmps}…${FAN_DOMAIN.maxAmps} A and the shaft within ${FAN_DOMAIN.minOmega}…${FAN_DOMAIN.maxOmega} rad/s — bounds adopted from the trial's frozen expectations, not a certification by them — and a run that leaves them is refused, not drawn. Every electrical change is a NEW solve and a new run from rest; while it solves the previous accepted run stays on the bench and is marked pending.</p>
<p class="hint"><b>Where the circuit comes from.</b> The composition was written by a smaller model (the trial in <code>docs/CONFORMANCE-KIT.md</code>) as typed JSON — no SPICE — against a frozen expectation set: connectivity, the thermistor's law on its own probe, the reference divider's Ohm law, the comparator's decision, the temperature domain, rest at t = 0, gate low/high/low at named instants, one switching each way inside named windows, spin-up, rotational and winding limits, a freewheel peak, and the diode blocking before it. Astra reviewed the topology and ran an independent motor-port energy balance (relative residual 6.3e-6). This page solves the SAME structure the kit built from that JSON and reads its observables by name; it does not re-describe the circuit.</p>
<p class="hint"><b>Parts.</b> The thermistor is the sensing bench's beta-law NTC (R<sub>0</sub> 10 kΩ at 25 °C, B 3950 K, declared −20…80 °C) on a prescribed temperature programme; the comparator is the illustrative switch-built stage (±10 µV band, previous state kept inside it); the MOSFET is the lamp page's level-1 NMOS, namespaced (V<sub>TO</sub> 2 V); the motor is the motor page's port model — R, L, one K for back-EMF and torque — with a <b>declared</b> rotational load J = 0.66 mg·m², b = 2 mN·m·s/rad, zero constant torque. The freewheel diode sits from the motor's low side to the supply rail: it conducts only while the winding drives that node above the rail.</p>
<p class="hint"><b>What is read, what is drawn.</b> θ on the rotor is the reader's trapezoid integral of the solved ω — the model has no angle. The MOSFET's three terminals carry three currents: the source leg its probed current, the gate pin the current the comparator's output stage delivers (through its 50 Ω output resistor less the 1 MΩ leak, both in the deck — it peaks near 34 mA while the gate charges, on the pin's own scale), and the drain leg the difference, by KCL at the device. The comparator's terminals are separated the same way: its output lead carries that same gate current, its Vcc cable the probed stage current, and a visible return lead to ground carries supply minus output — the leak while it sources, the gate's discharge while it sinks. That return figure is KCL at the stage, not a probe. The sensing branches (thermistor, bleeder, reference, comparator stage) are drawn against their <b>own</b> current scale, stated in the scale notes, because a fraction of a milliampere is invisible on the motor's ampere ruler. The back-EMF is a bar inside the can against the run's maximum. The energy readouts are the motor PORT only: input, winding heat, viscous drag, magnetic and kinetic stores; the residual is printed, never absorbed, and it is numerical error of the declared model, not a physical term.</p>
<p class="hint"><b>Not claimed.</b> No aerodynamic torque, airflow, cooling or thermal feedback: the temperature is prescribed and the rotor is an illustration of a linear-drag load. No claim that the motor current is exactly unidirectional — the WASM solve shows a short negative excursion of about −0.2 mA at the turn-off transient, inside the frozen tolerance, and the readouts print it. Passing eighteen checks is conformance to those checks, not universal correctness. Playback speed re-times the run and touches no number.</p>
<p class="hint" id="scale-notes"></p>
</details>
</section>
</article></div>`;

const el = (id: string) => document.getElementById(id)!;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** THE EXPERIMENT: a deep copy of the accepted composition; only its supply and programme ever change. */
let circuit: Composition = clone(FAN_COMPOSITION);
/** The composition the bench currently SHOWS (the last adopted solve); differs from `circuit` while a solve is pending. */
let presented: Composition | null = null;
let labelValues = false;
/**
 * TWO LAYOUTS OF THE SAME CIRCUIT, for comparison: the hand-authored poses below, and the ELK prototype's
 * placement committed in `fan-layout.elk.json` (generated offline by `tools/fan-elk-layout.mjs`, deterministic).
 * The ELK option is only offered when the file's structural identity matches this composition.
 */
type LayoutMode = 'hand' | 'elk' | 'rails';
/**
 * THE RAIL LAYOUT is GENERATED by the rail template (`rail-layout.ts`) from the composition's parts, nets and a
 * group order — no coordinate table — and validated fail-closed; the layout is bound to the accepted composition's
 * frozen structure. `RAIL_GROUPS` and `railGroupOf` are the whole authoring input.
 */
const RAIL_GROUPS = ['sensing', 'control', 'power'];
const railGroupOf = (p: PartInstance): string => ({ s: 'sensing', rb: 'sensing', p: 'sensing', c: 'control', q: 'control', m: 'power', fw: 'power' } as Record<string, string>)[p.name] ?? 'control';
const FAN_FROZEN = { structureSha256: structuralHash(FAN_COMPOSITION), label: 'fan.composition.json' };
const RAIL_LAYOUT: RailLayout = railLayout(railInputFrom(FAN_COMPOSITION, railGroupOf, RAIL_GROUPS), structuralHash(FAN_COMPOSITION), FAN_FROZEN);
const RAIL_REPORT = validateRailLayout(RAIL_LAYOUT, FAN_COMPOSITION);
if (!RAIL_REPORT.ok) console.error('The generated rail layout did not validate; the page refuses to draw it:', RAIL_REPORT.diagnostics);
let layoutMode: LayoutMode = 'rails';
/**
 * THE RAIL LAYOUT: the + rail along the back (z −6), ground along the front (z +5), the supply at the far left where
 * its cable crosses nothing; bodies stand between the rails in three zones and each takes a short straight drop to
 * its rail; the signal chain runs along z −0.9 from the sense node to the gate; the flyback stands beside the motor
 * node with an L-route back to the rail; the rotor sits in front of the can with nothing in front of it. One
 * crossing remains and is drawn as a lifted hop: the reference cable over the thermistor's rail drop. Positions
 * are authored; every drop, bus segment and summed bus current is derived by `busThrough` / `chordEnd`.
 */
const RAIL_PART_OF: Record<string, string> = { 'fn-S': 's', 'fn-Rb': 'rb', 'fn-P': 'p', 'fn-C': 'c', 'fn-Q': 'q', 'fn-M': 'm', 'fn-D': 'fw' };
const BODY_MAIN: Record<string, [string, string]> = { resistor: ['a', 'b'], ntc: ['a', 'b'], ldr: ['a', 'b'], diode: ['anode', 'cathode'], led: ['anode', 'cathode'], switch: ['a', 'b'], pot: ['a', 'b'], comparator: ['inp', 'out'], mosfet: ['drain', 'source'], motor: ['plus', 'minus'] };
let elkPlacement: DeckPlacement | null = null, elkStatus = 'checking the layout file against the circuit';
let spice: SpiceClient | null = null;
let playback: FanPlayback | null = null;
let transient: FanTransient | null = null;
let energy: FanEnergy | null = null;
let solverFrame: FanFrame | null = null;
let fault: string | null = null, displayFault: string | null = null;
let busy = false, paused = true, generation = 0;
let stage: PotentialScene | null = null;
let bounds = { lo: 0, hi: 6, fullI: 1e-12, signalFull: 1e-12, gateFull: 1e-12, bemfFull: 1, thetaFull: 1 };
const ROTOR_UNITS_PER_METRE = 10, BLADE_RADIUS_M = 0.13, BLADES = 5;   // the declared scale; the rail template raises the motor so this disc clears the deck

function speedMultiplier(): number { return speedFromSlider(Number((el('rate') as HTMLInputElement).value)); }
function captureBounds(t: FanTransient): void {
  const P = t.parts, S = t.series;
  let lo = 0, hi = 0, fullI = 0, signal = 0, bemf = 0, theta = 0, gateFull = 0;
  const ig = gateCurrentSeries(t);
  const volts = [S[`${P.motor.name}.vplus`], S[`${P.ntc.name}.vb`], S[`${P.pot.name}.vw`], S[`${P.mosfet.name}.vgate`], S[`${P.motor.name}.vminus`]];
  const amps = [S[`${P.supply.name}.current`], S[`${P.motor.name}.current`], S[`${P.diode.name}.current`], S[`${P.mosfet.name}.sourceCurrent`]];
  const small = [S[`${P.ntc.name}.current`], S[`${P.bleeder.name}.current`], S[`${P.pot.name}.currentA`], S[`${P.comparator.name}.supplyCurrent`]];
  const omega = S[`${P.motor.name}.omega`];
  for (let k = 0; k < t.times.length; k++) {
    for (const v of volts) { if (v[k] < lo) lo = v[k]; if (v[k] > hi) hi = v[k]; }
    for (const a of amps) fullI = Math.max(fullI, Math.abs(a[k]));
    for (const a of small) signal = Math.max(signal, Math.abs(a[k]));
    bemf = Math.max(bemf, Math.abs(P.motor.motor.kVsPerRad * omega[k])); theta = Math.max(theta, Math.abs(t.thetaRad[k])); gateFull = Math.max(gateFull, Math.abs(ig[k]));
  }
  bounds = { lo, hi: Math.max(hi, lo + 1e-9), fullI: Math.max(fullI, 1e-12), signalFull: Math.max(signal, 1e-12), gateFull: Math.max(gateFull, 1e-12), bemfFull: Math.max(bemf, 1e-9), thetaFull: Math.max(theta, 1e-9) };
}
async function resolveCircuit(why: string): Promise<void> {
  if (!spice) spice = new SpiceClient();
  const mine = ++generation; busy = true; fault = null; paintStatus(why);
  try {
    assertSupportedFan(circuit);
    const solved = toFanTransient(await spice.solveComposition(circuit, { timeoutMs: 60000 }));
    if (mine !== generation) return;
    const domain = fanDomain(solved); if (!domain.ok) throw new Error(domain.reason!);
    captureBounds(solved); energy = fanEnergy(solved);
    const rate = solved.stopSeconds / wallSecondsFor(speedMultiplier());
    if (playback) playback.adopt(solved, rate); else playback = new FanPlayback(solved, rate);
    playback.replayFromRest = false; transient = solved; presented = solved.composition; solverFrame = playback.frame(); paused = true; busy = false; displayFault = null;
    paintStatus(`Solved ${supplyVoltsOf(solved.composition).toFixed(2)} V · ${FAN_PROGRAMMES[programmeOf(solved.composition) ?? 'cycle'].label}: ${solved.times.length} samples over ${siUnit(solved.stopSeconds, 's')}; the comparator switches ${domain.crossings.map((x) => `${x.to} at ${x.atSeconds.toFixed(4)} s`).join(', ') || 'at no point'}; motor current ${(domain.minMotorAmps * 1e3).toFixed(3)}…${domain.maxMotorAmps.toFixed(3)} A, shaft up to ${domain.maxOmega.toFixed(2)} rad/s; port balance residual ${energy.relativeAtEnd.toExponential(2)} relative. Press Run.`);
  } catch (e) {
    if (mine !== generation) return; if (e instanceof Superseded) return;
    busy = false; playback = null; solverFrame = null; transient = null; presented = null; energy = null; fault = String(e instanceof Error ? e.message : e); paintStatus(null);
  }
  if (mine === generation) paint();
}
function paintStatus(message: string | null): void {
  const node = el('solver-status'), banner = el('stage-fault');
  banner.hidden = !fault && !displayFault;
  banner.textContent = fault ? `NOT DRIVEN — the solve failed: ${fault}` : displayFault ? `DISPLAY FAULT — the picture stopped: ${displayFault}` : '';
  if (fault) { node.textContent = `Solver fault — the scene is NOT being driven. ${fault}`; return; }
  node.textContent = (busy ? 'Solving… ' : '') + (message ?? '');
  // PENDING: an electrical change is being solved while the previous accepted run stays on the bench.
  const badge = el('pending-badge');
  const pendingRun = busy && presented !== null;
  badge.hidden = !pendingRun;
  if (pendingRun) badge.textContent = `PENDING · solving ${supplyVoltsOf(circuit).toFixed(2)} V · ${FAN_PROGRAMMES[programmeOf(circuit) ?? 'cycle'].label} — showing the accepted ${supplyVoltsOf(presented!).toFixed(2)} V run`;
}
function energyAt(time: number): { input: number; heat: number; drag: number; magnetic: number; kinetic: number; residual: number } | null {
  if (!energy) return null;
  const times = energy.times; let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= time) lo = mid; else hi = mid; }
  const f = times[hi] > times[lo] ? Math.min(1, Math.max(0, (time - times[lo]) / (times[hi] - times[lo]))) : 0;
  const at = (a: Float64Array) => a[lo] + (a[hi] - a[lo]) * f;
  return { input: at(energy.input), heat: at(energy.heat), drag: at(energy.drag), magnetic: at(energy.magnetic) - energy.magnetic[0], kinetic: at(energy.kinetic) - energy.kinetic[0], residual: at(energy.residual) };
}

// ---------------------------------------------------------------- the scene spec
const VDD = 'fn-vdd', SENSE = 'fn-sense', REF = 'fn-ref', GATE = 'fn-gate', MLOW = 'fn-mlow', GND = 'fn-gnd';
function fanSpec(): SceneSpec {
  const f = solverFrame, t = transient, known = f !== null && t !== null;
  const P = (t ?? { parts: null }).parts;
  const r = known ? fanReading(f!, P!) : null;
  const [dlo, dhi] = P ? P.ntc.spec.celsiusDomain : [-20, 80];
  const envFrac = known ? (f!.temperatureC - dlo) / (dhi - dlo) : null;
  const envText = known ? `${f!.temperatureC.toFixed(1)} °C` : 'not yet solved';
  const supplyV = known ? f!.supplyVolts : 6;
  const E = layoutMode === 'elk' ? elkPlacement : null, RL = layoutMode === 'rails' && RAIL_REPORT.ok;
  // Net names in the template are the composition's node names (vdd, sense, reference, gate, motorlow, 0).
  const RAIL_NET: Record<string, string> = { vdd: 'vdd', sense: 'sense', reference: 'reference', gate: 'gate', motorlow: 'motorlow', gnd: '0' };
  const at = (hand: { x: number; z: number }, net: string) => RL ? RAIL_LAYOUT.anchors[RAIL_NET[net]] : (E && E.anchors[net]) ? E.anchors[net] : hand;
  const railPose = (id: string): Partial<BranchSpec> => {
    const part = ({ ntc: 's', rb: 'rb', pot: 'p', comparator: 'c', mosfet: 'q', motor: 'm', flyback: 'fw' } as Record<string, string>)[id];
    const q = RAIL_LAYOUT.poses[part], L = RAIL_LAYOUT.leads[part];
    return { bodyAt: { x: q.x, z: q.z }, bodyDir: q.dir, bodyLen: q.len, ...(q.mount ? { mountHeight: q.mount } : {}), leadFrom: L.leadFrom, leadTo: L.leadTo, leadRoutes: L.leadRoutes, supplyFrom: L.supplyFrom, groundTo: L.groundTo, refLift: L.refLift, wiperSide: L.wiperSide, gateLift: L.gateLift, supplyLift: L.supplyLift, groundLift: L.groundLift };
  };
  const pose = (hand: { bodyAt: { x: number; z: number }; bodyDir: [number, number]; bodyLen?: number }, id: string) => RL ? railPose(id) : (E && E.poses[id]) ? { ...E.poses[id], leadRoutes: E.leadRoutes[id] } : hand;
  // The buses: summed member currents along each bar (KCL by construction), null until solved.
  // The member currents each bus drop takes (positive = taken from the bar), by part and port — the page's solved figures.
  const taken = (part: string, port: string): number | null => {
    if (!known) return null;
    const t: Record<string, number> = { 'p.a': f!.potAmps, 's.a': f!.sensorAmps, 'c.vcc': f!.comparatorStageAmps, 'fw.cathode': -f!.diodeAmps, 'm.plus': f!.motorAmps,
      'p.b': -f!.potAmps, 'rb.b': -f!.bleederAmps, 'c.gnd': -f!.comparatorGroundAmps, 'q.source': -f!.mosfetSourceAmps };
    const v = t[`${part}.${port}`]; return v === undefined ? null : v;
  };
  const buses = RL ? [
    busThrough('fn-rail', RAIL_LAYOUT.rail.z, RAIL_LAYOUT.rail.feedX, RAIL_LAYOUT.busMembers.rail.map((m) => ({ x: m.x, taken: taken(m.part, m.port) })), [RAIL_LAYOUT.rail.x0, RAIL_LAYOUT.rail.x1]),
    busThrough('fn-ground', RAIL_LAYOUT.ground.z, RAIL_LAYOUT.ground.feedX, RAIL_LAYOUT.busMembers.ground.map((m) => ({ x: m.x, taken: taken(m.part, m.port) })), [RAIL_LAYOUT.ground.x0, RAIL_LAYOUT.ground.x1]),
  ] : undefined;
  const terraces: TerraceSpec[] = [
    // THE DECK: the supply rail at the back-centre; sensing at the left, the motor at the right so the
    // signal reads left to right; ground at the front-centre; the rotor in front of the motor's can.
    // THE DECK, in THREE ZONES read left to right from the default camera: SENSING (x < −4: the NTC over the
    // divider resistor, the reference pot beside them), CONTROL (−3…5: the comparator, its output node, the
    // MOSFET), POWER (x > 6: the motor can with the rotor in front of it, the flyback diode on its own lane
    // on the back row beside the can, between the rail and the motor). Bodies are POSED explicitly (`bodyAt`), so a shared node — the + rail at the back,
    // ground at the front — stays one anchor while its wires fan out to each body. Every node keeps its
    // voltage-height marker; only the pills are sparse by default.
    { id: VDD, label: known ? '+ rail' : '+ rail · unsolved', volts: supplyV, anchor: at({ x: 2.0, z: -6.4 }, 'vdd'), showValue: labelValues },
    { id: MLOW, label: known ? 'motor −' : 'motor − · unsolved', volts: known ? f!.motorLowVolts : 0, anchor: at({ x: 5.5, z: -3.0 }, 'motorlow'), showValue: labelValues },
    { id: SENSE, label: known ? 'v_sense' : 'v_sense · unsolved', volts: known ? f!.senseVolts : 0, anchor: at({ x: -9.5, z: 0.0 }, 'sense'), showValue: labelValues },
    { id: GATE, label: known ? 'gate' : 'gate · unsolved', volts: known ? f!.gateVolts : 0, anchor: at({ x: 1.5, z: 0.2 }, 'gate'), showValue: labelValues },
    { id: REF, label: known ? 'v_ref' : 'v_ref · unsolved', volts: known ? f!.referenceVolts : 0, anchor: at({ x: -4.0, z: 1.5 }, 'reference'), showValue: labelValues },
    { id: GND, label: 'ground', volts: 0, isRef: true, anchor: at({ x: 0.0, z: 3.4 }, 'gnd'), showValue: labelValues },
  ];
  const I = known ? f!.motorAmps : null, Is = known ? f!.mosfetSourceAmps : null, Id = known ? f!.diodeAmps : null;
  const own = bounds.signalFull;
  const branches: BranchSpec[] = [
    { id: 'fn-V', label: P && labelValues ? `${fmt(P.supply.volts)} V supply` : 'supply', kind: 'source', from: GND, to: VDD, current: known ? f!.supplyAmps : null },
    { id: 'fn-S', kind: 'sensor', from: VDD, to: SENSE, current: known ? f!.sensorAmps : null, fullScaleA: own, ...pose({ bodyAt: { x: -9.5, z: -3.0 }, bodyDir: [0, 1] }, 'ntc'),
      label: r && labelValues ? `NTC ${fmt(Number(r.sensorOhmsSolved.toPrecision(4)))} Ω` : 'NTC',
      sensor: { kind: 'ntc', environmentFraction: envFrac, environmentText: envText, resistanceOhms: r ? r.sensorOhmsSolved : null } },
    { id: 'fn-Rb', kind: 'load', from: SENSE, to: GND, current: known ? f!.bleederAmps : null, fullScaleA: own, ...pose({ bodyAt: { x: -9.5, z: 2.2 }, bodyDir: [0, 1] }, 'rb'), label: labelValues ? 'divider 10 kΩ' : 'divider' },
    { id: 'fn-P', kind: 'pot', from: VDD, to: GND, current: known ? f!.potAmps : null, legBCurrent: known ? f!.potAmps : null, wiperTerrace: REF, wiperFraction: P ? P.pot.wiperFraction : 0.5, wiperCurrent: 0, fullScaleA: own, ...pose({ bodyAt: { x: -5.5, z: -3.0 }, bodyDir: [0, 1] }, 'pot'),
      label: P && labelValues ? `ref pot f ${P.pot.wiperFraction.toFixed(2)}` : 'reference' },
    // The comparator's three terminals carry three currents: the output lead I_G (the same figure the MOSFET's
    // gate pin draws), the Vcc cable the probed stage current, the visible ground return supply − output
    // (the leak while sourcing, the gate's discharge while sinking).
    { id: 'fn-C', kind: 'comparator', from: SENSE, to: GATE, refTerrace: REF, supplyTerrace: VDD, groundTerrace: GND, current: known ? f!.comparatorStageAmps : null, ...pose({ bodyAt: { x: -1.5, z: 0.2 }, bodyDir: [1, 0] }, 'comparator'),
      outputCurrent: known ? f!.mosfetGateAmps : null, supplyCurrent: known ? f!.comparatorStageAmps : null, groundCurrent: known ? f!.comparatorGroundAmps : null,
      high: known ? f!.high : null, fullScaleA: own,
      label: r && labelValues ? `comparator ${r.insideBand ? 'IN BAND' : f!.high ? 'HIGH' : 'low'}` : 'comparator' },
    // The MOSFET: drain at the motor's low side, source to ground, gate pin from the comparator's output node.
    // THREE DISTINCT CURRENTS: the drain leg carries I_S − I_G, the source leg the probed I_S, the gate pin I_G
    // read from the comparator's output stage (34 mA peak while the gate charges) on its own scale.
    { id: 'fn-Q', kind: 'mosfet', from: MLOW, to: GND, current: known ? f!.mosfetDrainAmps : null, sourceCurrent: Is, gateTerrace: GATE, gateCurrent: known ? f!.mosfetGateAmps : null, gateFullScaleA: bounds.gateFull, ...pose({ bodyAt: { x: 4.5, z: 0.0 }, bodyDir: [0, 1] }, 'mosfet'),
      label: r ? (labelValues ? `MOSFET ${r.region.toUpperCase()}` : 'MOSFET') : 'MOSFET · not yet solved' },
    { id: 'fn-M', kind: 'motor', from: VDD, to: MLOW, current: I, backEmfVolts: r ? r.backEmfVolts : null, backEmfFullVolts: bounds.bemfFull, ...pose({ bodyAt: { x: 9.0, z: -4.5 }, bodyDir: [-1, 0], bodyLen: 5 }, 'motor'),
      label: r ? (labelValues ? `motor · K·ω ${r.backEmfVolts.toFixed(2)} V` : 'motor') : 'motor · not yet solved' },
    // The freewheel diode, anode at the motor's low side, cathode at the rail — its own lane behind the motor.
    { id: 'fn-D', kind: 'diode', from: MLOW, to: VDD, current: Id, ...pose({ bodyAt: { x: 5.5, z: -7.2 }, bodyDir: [-1, 0] }, 'flyback'), label: Id === null || !labelValues ? 'flyback' : `flyback ${Id > 1e-3 ? 'CONDUCTING' : 'blocking'}` },
  ];
  const turns = known ? f!.thetaRad / (2 * Math.PI) : null;
  return {
    deck: { rulerX: RL ? RAIL_LAYOUT.rail.feedX - 2.0 : E ? Math.min(...Object.values(E.anchors).map((a) => a.x), ...Object.values(E.poses).map((q) => q.bodyAt.x)) - 2.2 : -12.4, viewDir: [0.04, 0.66, 1], tightFit: true }, fixedSpan: { lo: bounds.lo, hi: bounds.hi }, fixedFullI: bounds.fullI, terraces, branches, drawStores: false,
    // Transport cues travel per WALL second on a declared readability curve (see the model notes): a qualitative
    // cue, not electron drift; sign, zero and pause are the solver's.
    flowCue: FLOW_CUE,
    buses,
    mechanism: { kind: 'rotor', anchor: RL ? { x: RAIL_LAYOUT.rotor!.x, z: RAIL_LAYOUT.rotor!.z } : E && E.poses.motor ? { x: E.poses.motor.bodyAt.x, z: E.poses.motor.bodyAt.z + 3.4 } : { x: 9.0, z: -1.1 }, bladeRadiusM: BLADE_RADIUS_M, sceneUnitsPerMetre: ROTOR_UNITS_PER_METRE, blades: BLADES,
      thetaRad: known ? f!.thetaRad : null, omegaRadPerS: known ? f!.omegaRadPerS : null,
      label: known ? (labelValues ? `rotor ${turns!.toFixed(2)} turns (∫ω)` : 'rotor') : 'rotor · not yet solved' },
  };
}

function paintControls(): void {
  const v = supplyVoltsOf(circuit), pid = programmeOf(circuit) ?? 'cycle';
  (el('supply') as HTMLInputElement).value = String(FAN_SUPPLY_SETTINGS.findIndex((x) => Math.abs(x - v) < 1e-9));
  el('supply-readout').textContent = `${v.toFixed(2)} V${presented && supplyVoltsOf(presented) !== v ? ` (pending — showing ${supplyVoltsOf(presented).toFixed(2)} V)` : ''}`;
  const host = el('preset-buttons');
  if (!host.children.length) for (const [id, p] of Object.entries(FAN_PROGRAMMES)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = p.label; b.dataset.programme = id; b.onclick = () => setProgramme(id as FanProgramme); host.appendChild(b); }
  for (const b of host.children) (b as HTMLButtonElement).setAttribute('aria-pressed', String(pid === (b as HTMLElement).dataset.programme));
  el('preset-blurb').textContent = FAN_PROGRAMMES[pid].blurb;
  el('composition-json').textContent = JSON.stringify(presented ?? circuit, null, 1);
}
function paint(): void {
  paintControls();
  const m = speedMultiplier(); el('rate-readout').textContent = `${m.toFixed(2)}× · ${wallSecondsFor(m).toFixed(0)} s for the run`;
  const f = solverFrame, t = transient, r = f && t ? fanReading(f, t.parts) : null;
  el('play').textContent = paused ? 'Run' : 'Pause'; el('replay').hidden = !(playback && playback.atHorizon);
  const set = (id: string, text: string) => { el(id).textContent = text; };
  if (f && t && r) {
    const E = energyAt(f.timeSeconds);
    el('headline').innerHTML = `<div><small>TEMPERATURE</small><strong>${f.temperatureC.toFixed(1)} °C → ${fmt(Number(r.sensorOhmsSolved.toPrecision(4)))} Ω</strong><em>prescribed input, and the thermistor's solved resistance</em></div>`
      + `<div><small>DECISION</small><strong>${r.insideBand ? 'IN THE BAND' : f.high ? 'HIGH · MOTOR DRIVEN' : 'LOW · MOTOR OFF'}</strong><em>v_sense − v_ref = ${(r.differenceVolts * 1e3).toFixed(1)} mV against a ±${(r.thresholdVolts * 1e6).toFixed(0)} µV band</em></div>`
      + `<div><small>SHAFT</small><strong>${f.omegaRadPerS.toFixed(2)} rad/s</strong><em>${(f.thetaRad / (2 * Math.PI)).toFixed(2)} turns since 0 s · ${r.region === 'off' ? 'coasting or at rest' : 'driven'}</em></div>`;
    set('r-temp', `${f.temperatureC.toFixed(2)} °C`); set('r-rs', `${fmt(Number(r.sensorOhmsSolved.toPrecision(5)))} · ${fmt(Number(r.sensorOhmsLaw.toPrecision(5)))} Ω`);
    set('r-vin', `${f.senseVolts.toFixed(4)} · ${f.referenceVolts.toFixed(4)} V`); set('r-cmp', `${f.high ? 'HIGH' : 'low'} · ${(r.differenceVolts * 1e3).toFixed(2)} mV`);
    set('r-gate', `${f.gateVolts.toFixed(3)} V · ${r.region}`); set('r-im', `${r.terminalVolts.toFixed(3)} V · ${(f.motorAmps * 1e3).toFixed(1)} mA · ${r.terminalWatts.toFixed(3)} W`);
    set('r-rpm', `${r.rpm.toFixed(1)} RPM · ${f.omegaRadPerS.toFixed(2)} rad/s`);
    set('r-iq', `${(f.mosfetDrainAmps * 1e3).toFixed(2)} · ${(f.mosfetGateAmps * 1e3).toFixed(2)} · ${(f.mosfetSourceAmps * 1e3).toFixed(2)} mA`);
    set('r-ic', `${(f.comparatorStageAmps * 1e3).toFixed(2)} · ${(f.mosfetGateAmps * 1e3).toFixed(2)} · ${(f.comparatorGroundAmps * 1e3).toFixed(3)} mA`);
    set('r-bemf', `${r.backEmfVolts.toFixed(3)} V · ${(r.torqueNm * 1e3).toFixed(2)} mN·m`); set('r-w', `${f.omegaRadPerS.toFixed(2)} rad/s · ${f.thetaRad.toFixed(2)} rad`);
    set('r-id', `${(f.diodeAmps * 1e3).toFixed(3)} mA · ${f.diodeAmps > 1e-3 ? 'conducting' : 'blocking'}`); set('r-icc', `${(f.supplyAmps * 1e3).toFixed(1)} mA`);
    set('r-e', E ? `in ${E.input.toFixed(4)} J · heat ${E.heat.toFixed(4)} · drag ${E.drag.toFixed(4)} · kin ${E.kinetic.toFixed(4)} · mag ${E.magnetic.toExponential(1)}` : '—');
    set('r-res', E ? `${E.residual.toExponential(2)} J (numerical)` : '—');
    const state = f.state === 'before-start' ? 'Operating point · 0 s' : f.state === 'at-horizon' ? 'End of solved run' : f.state === 'paused' ? 'Paused' : 'Playing';
    el('scene-time').textContent = `${state} · ${siUnit(f.timeSeconds, 's')} of ${siUnit(playback!.horizonSeconds, 's')}${f.onEdge ? ' · temperature ramping' : ''}`;
    el('clock').textContent = `Requested ${f.requestedTimeSeconds.toExponential(4)} s · represented ${f.timeSeconds.toExponential(4)} s · grid median ${siUnit(t.actualStepSeconds.median, 's')} · ${t.engine}`;
  } else {
    el('headline').innerHTML = `<div><small>CIRCUIT</small><strong>—</strong><em>${fault ? 'not solved' : 'solving'}</em></div>`;
    for (const id of ['r-temp', 'r-rs', 'r-vin', 'r-cmp', 'r-gate', 'r-iq', 'r-ic', 'r-im', 'r-rpm', 'r-bemf', 'r-w', 'r-id', 'r-icc', 'r-e', 'r-res']) set(id, '—');
    el('scene-time').textContent = '';
  }
  el('scale-notes').textContent = `The rotor replays a DECLARED load: J ${transient ? (transient.parts.motor.load.inertiaKgM2 * 1e6).toFixed(0) : '—'} µkg·m², b ${transient ? (transient.parts.motor.load.viscousNmS * 1e3).toFixed(1) : '—'} mN·m·s/rad, no constant torque. Scales are the extrema of THIS solved run: ruler ${fmt(bounds.lo)}…${fmt(bounds.hi)} V; the power lanes (supply, motor, MOSFET, diode) share ${siUnit(bounds.fullI, 'A')} full scale; the sensing lanes (thermistor, divider, reference, comparator stage) use their OWN ${siUnit(bounds.signalFull, 'A')}; the gate pin its own ${siUnit(bounds.gateFull, 'A')}; back-EMF bar full at ${bounds.bemfFull.toFixed(2)} V. The rotor is ${BLADES} blades of ${(BLADE_RADIUS_M * 1000).toFixed(0)} mm at ${ROTOR_UNITS_PER_METRE} scene units per metre, turned by the replayed ∫ω; the thermometer's height is the prescribed temperature's position in the thermistor's declared domain at the playback instant. Marker height = voltage; body positions are layout only.`;
  if (stage) stage.applySpec(fanSpec());
}
const halted = (): boolean => !playback || !!fault || !!displayFault || busy;
el('play').onclick = () => { if (halted()) return; if (playback!.atHorizon) playback!.reset(); paused = !paused; paint(); };
el('step').onclick = () => { if (halted()) return; paused = true; playback!.paused = false; playback!.stepOne(); playback!.paused = true; solverFrame = playback!.frame(); paint(); };
el('restart').onclick = () => { if (halted()) return; paused = true; playback!.reset(); solverFrame = playback!.frame(); paint(); };
el('replay').onclick = () => { if (halted()) return; playback!.reset(); paused = false; paint(); };
el('rate').addEventListener('input', () => { if (playback && transient) playback.playbackRate = transient.stopSeconds / wallSecondsFor(speedMultiplier()); paint(); });
el('reset-view').onclick = () => stage?.refit();
el('labels-on').addEventListener('change', () => stage?.setLabelsVisible((el('labels-on') as HTMLInputElement).checked));
void sha256Json(FAN_COMPOSITION).then((h) => { el('composition-identity').textContent = `Base composition ${FAN_COMPOSITION.id} · SHA-256 ${h.slice(0, 16)}… (the kit's report carries the full hash).`; });
// ---- the experiment's controls: every electrical change is a NEW solve; the slider is debounced and the latest request wins.
let supplyTimer: ReturnType<typeof setTimeout> | null = null;
function setSupply(volts: number): void {
  try { circuit = withSupplyVolts(circuit, volts); assertSupportedFan(circuit); el('notice').textContent = ''; }
  catch (e) { el('notice').textContent = String(e instanceof Error ? e.message : e); return; }
  if (supplyTimer) clearTimeout(supplyTimer);
  supplyTimer = setTimeout(() => { supplyTimer = null; void resolveCircuit(`Supply ${volts.toFixed(2)} V: new solve, new run from rest. `); }, 150);
  paint();
}
function setProgramme(id: FanProgramme): void {
  circuit = withProgramme(circuit, id); el('notice').textContent = '';
  void resolveCircuit(`${FAN_PROGRAMMES[id].label}: new solve, new run from rest. `); paint();
}
el('supply').addEventListener('input', () => setSupply(FAN_SUPPLY_SETTINGS[Number((el('supply') as HTMLInputElement).value)] ?? FAN_SUPPLY_VOLTS.default));
el('save').onclick = () => { const url = URL.createObjectURL(new Blob([encodeFanDoc(circuit)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'flux-fan-experiment.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); el('notice').textContent = 'Saved the experiment (the base circuit with your supply and programme). The running state is not included.'; };
function adoptLoaded(text: string, name: string): void {
  try { circuit = decodeFanDoc(text); el('notice').textContent = `Loaded ${name}.`; void resolveCircuit('Solving the loaded experiment. '); }
  catch (e) { el('notice').textContent = `Could not load: ${e instanceof Error ? e.message : e}`; }
  paint();
}
el('load').addEventListener('change', async () => { const input = el('load') as HTMLInputElement, file = input.files?.[0]; if (!file) return; adoptLoaded(await file.text(), file.name); input.value = ''; });
el('labels-values').addEventListener('change', () => { labelValues = (el('labels-values') as HTMLInputElement).checked; paint(); });
function setLayout(mode: LayoutMode): void {
  if (mode === 'elk' && !elkPlacement) { el('notice').textContent = `The ELK layout is not available: ${elkStatus}`; return; }
  if (mode === 'rails' && !RAIL_REPORT.ok) { el('notice').textContent = `The rail layout did not validate: ${RAIL_REPORT.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.cause} at ${d.where}`).join('; ')}`; return; }
  layoutMode = mode;
  for (const b of el('layout-buttons').children) (b as HTMLButtonElement).setAttribute('aria-pressed', String((b as HTMLElement).dataset.layout === mode));
  paint(); stage?.refit();
}
for (const b of el('layout-buttons').children) (b as HTMLButtonElement).onclick = () => setLayout((b as HTMLElement).dataset.layout as LayoutMode);
// The committed placement is only offered when its STRUCTURAL identity matches this composition (kinds, names, wiring).
void structuralSha256(FAN_COMPOSITION).then((h) => {
  if (h === ELK_FILE.structureSha256) { elkPlacement = placementFrom(ELK_FILE, ELK_CHORDS); elkStatus = `matches (structure ${h.slice(0, 12)}…, elkjs ${ELK_FILE.elkjs})`; const btn = el('layout-buttons').querySelector<HTMLButtonElement>('button[data-layout="elk"]'); if (btn) btn.disabled = false; }
  else elkStatus = `stale: the layout file was generated for structure ${ELK_FILE.structureSha256.slice(0, 12)}…, this circuit is ${h.slice(0, 12)}… — re-run tools/fan-elk-layout.mjs`;
}).catch((e) => { elkStatus = String(e instanceof Error ? e.message : e); });
function startStage(): void {
  try { const built = new PotentialScene(el('stage3d'), el('stagelabels')); el('graphics-status').hidden = true; el('stage').hidden = false; built.resize(); built.refit(); stage = built; (window as unknown as Record<string, unknown>).__fanstage = stage; }
  catch (error) { console.error('Fan 3D initialization failed', error); stage = null; el('stage').hidden = true; const status = el('graphics-status'); status.hidden = false; status.textContent = `The 3D scene could not start (${error instanceof Error ? error.message : String(error)}). Every reading below is still live.`; }
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
    if (import.meta.env.DEV) { const w = window as unknown as Record<string, number>; w.__fanAnimSeconds = (w.__fanAnimSeconds ?? 0) + (animating ? showDt : 0); if ((window as unknown as Record<string, unknown>).__fanBreakDisplayOnce) { (window as unknown as Record<string, unknown>).__fanBreakDisplayOnce = false; throw new Error('injected display failure'); } }
    stage?.render(animating ? showDt : 0, animating ? dt : 0);
  } catch (e) { console.error('Fan display fault', e); paused = true; displayFault = e instanceof Error ? e.message : String(e); try { paintStatus(null); } catch { /* the banner itself failed */ } }
}
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.__fanSeek = (t: number) => { if (!playback) return false; paused = true; playback.seek(t); solverFrame = playback.frame(); paint(); return true; };
  w.__fanPaint = () => paint();
  w.__fanDescribe = () => ({ composition: FAN_COMPOSITION.id, supply: supplyVoltsOf(circuit), programme: programmeOf(circuit), presentedSupply: presented ? supplyVoltsOf(presented) : null, presentedProgramme: presented ? programmeOf(presented) : null, pending: !el('pending-badge').hidden, pendingText: el('pending-badge').textContent, labelValues, bounds, frame: solverFrame, reading: solverFrame && transient ? fanReading(solverFrame, transient.parts) : null, energy: solverFrame ? energyAt(solverFrame.timeSeconds) : null, domain: transient ? fanDomain(transient) : null, fault, busy, samples: transient?.times.length ?? null, engine: transient?.engine ?? null });
  w.__fanFailNext = (reason: string) => { if (!spice) spice = new SpiceClient(); spice.failNextForTesting(reason); };
  w.__fanResolve = () => { void resolveCircuit('Probe re-solve. '); };
  w.__fanRebuildStage = () => { stage?.buildFromSpec(fanSpec()); };
  w.__fanPaintStage = () => { if (stage) stage.applySpec(fanSpec()); };
  w.__fanBreakDisplay = () => { w.__fanBreakDisplayOnce = true; };
  w.__fanSupply = (v: number) => { const k = FAN_SUPPLY_SETTINGS.findIndex((x) => Math.abs(x - v) < 1e-9); if (k < 0) { setSupply(v); return false; } (el('supply') as HTMLInputElement).value = String(k); el('supply').dispatchEvent(new Event('input')); return true; };
  w.__fanProgramme = (id: FanProgramme) => setProgramme(id);
  w.__fanSaveText = () => encodeFanDoc(circuit);
  w.__fanLoadText = (text: string) => adoptLoaded(text, 'probe');
  w.__fanLabelValues = (on: boolean) => { (el('labels-values') as HTMLInputElement).checked = on; el('labels-values').dispatchEvent(new Event('change')); };
  w.__fanLayout = (mode: LayoutMode) => { setLayout(mode); return { mode: layoutMode, elkStatus }; };
  /** The rail template's own validation, plus RENDERER CORRESPONDENCE: the kit's predicted terminal positions against the drawn ones. */
  w.__fanRailReport = () => {
    const drawn = (stage as unknown as { terminals?: () => Record<string, Record<string, [number, number, number]>> } | null)?.terminals?.() ?? {};
    const errors: { part: string; port: string; predicted: [number, number]; drawn: [number, number, number] | null; error: number | null }[] = [];
    for (const [branchId, part] of Object.entries(RAIL_PART_OF)) {
      const q = RAIL_LAYOUT.poses[part]; if (!q) continue;
      const ports = Object.keys(q.kind === 'pot' ? { a: 1, b: 1, w: 1 } : q.kind === 'comparator' ? { inp: 1, inn: 1, out: 1, vcc: 1, gnd: 1 } : q.kind === 'mosfet' ? { drain: 1, source: 1, gate: 1 } : q.kind === 'motor' ? { plus: 1, minus: 1, shaft: 1 } : { [BODY_MAIN[q.kind][0]]: 1, [BODY_MAIN[q.kind][1]]: 1 });
      for (const port of ports) { const t = terminalAt(q, port); const d = drawn[branchId]?.[port] ?? null; errors.push({ part, port, predicted: [+t.x.toFixed(3), +t.z.toFixed(3)], drawn: d, error: d ? +Math.hypot(d[0] - t.x, d[2] - t.z).toFixed(3) : null }); }
    }
    const rotorDrawn = drawn['mechanism']?.hub ?? null;
    // RENDERED-GEOMETRY VALIDATION: the same geometry core run on what the renderer actually drew — its body bounds, its
    // sampled conductor centrelines (routed leads and cables follow their curves), its rotor — with nets from the spec.
    // Reported separately from the template's own (mirrored) validation; neither claims the other.
    let rendered: unknown = null;
    const geo = (stage as unknown as { geometry?: () => { bodies: Record<string, { min: [number, number, number]; max: [number, number, number] }[]>; wires: Record<string, [number, number, number][]>; rotor: { hub: [number, number, number]; radius: number } | null } } | null)?.geometry?.();
    if (geo && layoutMode === 'rails') {
      const spec = fanSpec(); const byId = new Map(spec.branches.map((b) => [b.id, b]));
      const NET: Record<string, string> = { [VDD]: 'vdd', [MLOW]: 'motorlow', [SENSE]: 'sense', [GATE]: 'gate', [REF]: 'reference', [GND]: '0' };
      const wires: Wire3[] = [];
      for (const [id, pts] of Object.entries(geo.wires)) {
        const m = /^(fn-[A-Za-z]+)(-in|-out|-vcc|-gnd|-ref|-gate|-wiper|-flow|-legA|-legB|-\d+)?$/.exec(id); if (!m) continue;
        const base = m[1], suf = m[2] ?? ''; const b = byId.get(base);
        let net: string | null = null;
        if (base === 'fn-rail') net = 'vdd'; else if (base === 'fn-ground') net = '0'; else if (base === 'fn-V') net = '0|vdd';
        else if (b) { if (suf === '-in') net = NET[b.from]; else if (suf === '-out') net = NET[b.to]; else if (suf === '-vcc') net = 'vdd'; else if (suf === '-gnd') net = '0'; else if (suf === '-ref' || suf === '-wiper') net = 'reference'; else if (suf === '-gate') net = 'gate'; else continue; }   // -flow / -legA / -legB are carrier overlays, not conductors
        if (!net) continue;
        wires.push({ id, net, owner: base, kind: suf === '-in' || suf === '-out' ? 'lead' : base === 'fn-rail' || base === 'fn-ground' ? 'bus' : 'cable', points: pts });
      }
      const bodies: BodyShape[] = Object.entries(geo.bodies).filter(([id]) => RAIL_PART_OF[id]).flatMap(([id, boxes]) => boxes.map((bx) => ({ id: RAIL_PART_OF[id], kind: 'box' as const, min: bx.min, max: bx.max })));
      const terminals = layoutTerminals(RAIL_LAYOUT, FAN_COMPOSITION).map((t) => { const dr = drawn[Object.entries(RAIL_PART_OF).find(([, p]) => p === t.part)?.[0] ?? '']?.[t.port]; return dr ? { ...t, at: dr } : t; });   // the DRAWN terminal positions
      const rotor = geo.rotor ? { hub: geo.rotor.hub, radius: geo.rotor.radius, thickness: 0.3 } : null;
      const core = checkGeometry3D(wires, bodies, terminals, rotor, layoutNets(RAIL_LAYOUT, FAN_COMPOSITION), { endEps: 0.15 });   // conductors are drawn 0.06 above the deck; cables leave pins by their own offsets
      rendered = { ok: !core.diagnostics.some((d) => d.severity === 'error'), wires: wires.length, bodies: bodies.length, pairs: core.pairs, errors: core.diagnostics.filter((d) => d.severity === 'error'), infos: core.diagnostics.filter((d) => d.severity !== 'error').map((d) => `${d.cause} ${d.where}`), bodyBoxes: bodies.map((b) => [b.id, b.kind === 'box' ? [b.min, b.max] : null]) };
    }
    return { mode: layoutMode, template: RAIL_REPORT, rendered, correspondence: { terminals: errors, worst: Math.max(...errors.map((e) => e.error ?? -1)), missing: errors.filter((e) => e.error === null).map((e) => `${e.part}.${e.port}`), rotor: rotorDrawn ? { predicted: [RAIL_LAYOUT.rotor!.x, RAIL_LAYOUT.rotor!.hubY, RAIL_LAYOUT.rotor!.z], drawn: rotorDrawn, error: +Math.hypot(rotorDrawn[0] - RAIL_LAYOUT.rotor!.x, rotorDrawn[1] - RAIL_LAYOUT.rotor!.hubY, rotorDrawn[2] - RAIL_LAYOUT.rotor!.z).toFixed(3) } : null } };
  };
  /**
   * A GEOMETRY REPORT of the current layout in deck coordinates: every lead (net anchor → body end) against every
   * other body's footprint (a capsule of half-width 0.7 around its chord), lead–lead crossings, and the rotor
   * disc against every lead — so a placement can be judged by numbers before screenshots. Layout only.
   */
  w.__fanLayoutReport = () => {
    const spec = fanSpec(); const anchors = new Map(spec.terraces.map((t) => [t.id, { x: t.anchor!.x, z: t.anchor!.z }]));
    type P = { x: number; z: number }; type Seg = { a: P; b: P; owner: string; kind: string };
    const bodies: Seg[] = [], leads: Seg[] = [];
    for (const b of spec.branches) {
      if (!b.bodyAt) continue;
      const L = (b.bodyLen ?? 3.6) / 2, d = b.bodyDir!; const ends = { a: { x: b.bodyAt.x - d[0] * L, z: b.bodyAt.z - d[1] * L }, b: { x: b.bodyAt.x + d[0] * L, z: b.bodyAt.z + d[1] * L } };
      bodies.push({ ...ends, owner: b.id, kind: 'body' });
      const poly = (from: P, via: [number, number][] | undefined, to: P, kind: string) => { const pts = [from, ...(via ?? []).map(([x, z]) => ({ x, z })), to]; for (let k = 1; k < pts.length; k++) leads.push({ a: pts[k - 1], b: pts[k], owner: b.id, kind }); };
      const pt = (o: [number, number] | undefined, fallback: P): P => o ? { x: o[0], z: o[1] } : fallback;
      poly(pt(b.leadFrom, anchors.get(b.from)!), b.leadRoutes?.in, ends.a, 'lead-in'); poly(ends.b, b.leadRoutes?.out, pt(b.leadTo, anchors.get(b.to)!), 'lead-out');
      if (b.kind === 'comparator') {
        if (b.refTerrace) leads.push({ a: pt(b.refFrom, anchors.get(b.refTerrace)!), b: b.bodyAt, owner: b.id, kind: b.refLift ? 'cable-ref(lifted)' : 'cable-ref' });
        if (b.supplyTerrace) leads.push({ a: pt(b.supplyFrom, anchors.get(b.supplyTerrace)!), b: b.bodyAt, owner: b.id, kind: 'cable-vcc' });
        if (b.groundTerrace) leads.push({ a: b.bodyAt, b: pt(b.groundTo, anchors.get(b.groundTerrace)!), owner: b.id, kind: 'cable-gnd' });
      }
      if (b.kind === 'mosfet' && b.gateTerrace) leads.push({ a: pt(b.gateFrom, anchors.get(b.gateTerrace)!), b: b.bodyAt, owner: b.id, kind: 'cable-gate' });
    }
    for (const bus of spec.buses ?? []) for (let k = 1; k < bus.points.length; k++) leads.push({ a: { x: bus.points[k - 1][0], z: bus.points[k - 1][1] }, b: { x: bus.points[k][0], z: bus.points[k][1] }, owner: bus.id, kind: 'bus' });
    const rotor = spec.mechanism && spec.mechanism.kind === 'rotor' ? { c: spec.mechanism.anchor, r: spec.mechanism.bladeRadiusM * spec.mechanism.sceneUnitsPerMetre + 0.2 } : null;
    const segDist = (p: P, q: P, r: P, t: P): number => {
      const pt = (u: P, a: P, b: P) => { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz; const s = l2 ? Math.max(0, Math.min(1, ((u.x - a.x) * dx + (u.z - a.z) * dz) / l2)) : 0; return Math.hypot(u.x - (a.x + dx * s), u.z - (a.z + dz * s)); };
      const cr = (o: P, a: P, b: P) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
      if (cr(p, q, r) * cr(p, q, t) < 0 && cr(r, t, p) * cr(r, t, q) < 0) return 0;
      return Math.min(pt(p, r, t), pt(q, r, t), pt(r, p, q), pt(t, p, q));
    };
    const clearances: { lead: string; body: string; distance: number }[] = [];
    for (const l of leads) for (const bd of bodies) if (bd.owner !== l.owner) clearances.push({ lead: `${l.owner}${l.kind.startsWith('cable') ? ':' + l.kind : l.kind === 'lead-in' ? '/in' : '/out'}`, body: bd.owner, distance: +segDist(l.a, l.b, bd.a, bd.b).toFixed(2) });
    let crossings = 0; const crossed: string[] = [];
    const touchesEnd = (A: Seg, B: Seg) => [A.a, A.b].some((p) => [B.a, B.b].some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 1e-6)) || [A.a, A.b].some((p) => segDist(p, p, B.a, B.b) < 1e-6) || [B.a, B.b].some((p) => segDist(p, p, A.a, A.b) < 1e-6);
    for (let i = 0; i < leads.length; i++) for (let j = i + 1; j < leads.length; j++) { const A = leads[i], B = leads[j]; if (A.owner === B.owner) continue; if (segDist(A.a, A.b, B.a, B.b) === 0 && !touchesEnd(A, B)) { crossings++; crossed.push(`${A.owner}${A.kind}×${B.owner}${B.kind}`); } }
    const rotorHits = rotor ? leads.filter((l) => segDist(l.a, l.b, rotor.c, rotor.c) < rotor.r).map((l) => `${l.owner}${l.kind}`) : [];
    const tight = clearances.filter((c) => c.distance < 0.7).sort((x, y) => x.distance - y.distance);
    return { mode: layoutMode, leadSegments: leads.length, bodies: bodies.length, minClearance: Math.min(...clearances.map((c) => c.distance)), tight: tight.slice(0, 12), crossings, crossed: crossed.slice(0, 16), rotorHits, extent: E_extent(spec) };
    function E_extent(sp: SceneSpec) { const xs = sp.terraces.map((t) => t.anchor!.x), zs = sp.terraces.map((t) => t.anchor!.z); for (const b of sp.branches) if (b.bodyAt) { xs.push(b.bodyAt.x); zs.push(b.bodyAt.z); } return { x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] }; }
  };
  w.__fanGateExtremes = () => { if (!transient) return null; const ig = gateCurrentSeries(transient); let hi = 0, lo = 0, off = -1; for (let k = 0; k < ig.length; k++) { if (ig[k] > ig[hi]) hi = k; if (ig[k] < ig[lo]) lo = k; if (transient.times[k] > 0.5 && (off < 0 || ig[k] < ig[off])) off = k; } return { max: { t: transient.times[hi], ig: ig[hi] }, min: { t: transient.times[lo], ig: ig[lo] }, discharge: { t: transient.times[off], ig: ig[off] } }; };
  w.__fanDrawn = (ids: string[]) => { const br = (stage as unknown as { branches?: { id: string; current: number | null }[] } | null)?.branches ?? []; return Object.fromEntries(ids.map((id) => [id, br.find((b) => b.id === id)?.current ?? 'absent'])); };
  w.__fanState = () => ({ paused, fault, displayFault, busy, banner: el('stage-fault').hidden ? null : el('stage-fault').textContent, labels: stage?.labelsVisible });
}
void resolveCircuit('Solving the trial composition. ');
requestAnimationFrame(frame);
