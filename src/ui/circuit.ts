import type { SimWorld } from '../sim/world';
import { CIRCUIT_LIMITS, resistorsOf, sourcesOf, wiresOf } from '../model/circuit';
import { temperature, supportedTemperature } from '../model/thermal';
import { escapeHtml } from './authoring';

const f = (x: number): string => (Number.isFinite(x) ? (Math.abs(x) >= 1e-4 || x === 0 ? x.toFixed(6) : x.toExponential(3)) : String(x));

/** The scope limits, in one place, so the panel and the authoring form agree. */
export const CIRCUIT_SCOPE = 'This is an <b>ideal</b> DC model: one <b>ideal independent voltage source</b>, positive '
  + 'finite resistors, and <b>ideal wires that merge equipotential nodes</b>. <b>Ideal wires and the ideal source model '
  + 'no heating, no internal resistance and no battery depletion</b> — the source has no finite stored charge, and the '
  + 'energy shown as supplied crosses the boundary from an <b>ideal external source</b>. It is never energy created '
  + 'inside the world. <b>This view does not compute individual wire currents. Ideal-wire loops can make their '
  + 'allocation nonunique; connected nodes share one potential.</b> '
  + 'Resistance and voltage are <b>authored inputs</b>, not material properties. There is no capacitance, inductance, '
  + 'switching, AC, semiconductor or temperature feedback here, and <b>ideal ground is a voltage reference — not earth, '
  + 'and not the mechanical ground body</b>. Electrical connection is by <b>node</b>: touching bodies and crossing lines '
  + 'on screen are not connections.';

/** THE RUN-MODE ELECTRICAL PANEL. Observed on screen, not only in a test. */
export function renderCircuitPanel(sim: SimWorld): string {
  const c = sim.construction?.circuit;
  if (!c) return '';
  const e = sim.electrical;
  const head = `<section><h2>DC circuit</h2><div class="disclosure" role="note">${CIRCUIT_SCOPE}</div>`;
  if (e.rejected || !sim.circuitSolution) {
    return `${head}<p class="refusal"><b>ELECTRICAL RESULT REJECTED — no heating is accumulated and no earlier
      solution is reused.</b> ${escapeHtml(e.rejected ?? 'no accepted solution')}</p></section>`;
  }
  const sol = sim.circuitSolution;
  const source = sourcesOf(c)[0];
  const resistors = resistorsOf(c);
  const wires = wiresOf(c);
  const label = (id: string): string => {
    const n = c.nodes.find((x) => x.id === id);
    return n ? `${escapeHtml(n.label)} (${escapeHtml(n.id)})` : escapeHtml(id);
  };

  const nodeRows = sol.nodeVoltages.map((v) => `<tr><td>${v.members.map(label).join(' = ')}</td><td>${f(v.voltage)}</td>
    <td>${v.members.length > 1 ? `merged by ideal wire${v.members.length > 2 ? 's' : ''}` : ''}</td></tr>`).join('');

  const resistorRows = resistors.map((r) => {
    const s = sol.resistors.find((x) => x.id === r.id)!;
    const acc = e.resistors.find((x) => x.id === r.id);
    return `<tr><td>${escapeHtml(r.label)} (${escapeHtml(r.id)})</td><td>${f(r.resistance)}</td>
      <td>${f(s.voltage)}</td><td>${f(s.current)}</td><td>${f(s.power)}</td><td>${f(acc?.energy ?? 0)}</td>
      <td>${r.heatReceiver ? escapeHtml(r.heatReceiver) : '<b>none — dissipation leaves the model, explicitly unmodelled</b>'}</td></tr>`;
  }).join('');

  const receiverRows = sim.thermal.bodies.map((b) => {
    const desc = sim.runtime(b.id).desc, t = desc.thermal!;
    const value = temperature(t, b.heat);
    const fromResistors = (sim.thermal.routedElectrical ?? []).filter((x) =>
      resistors.some((r) => r.id === x.componentId && r.heatReceiver === b.id)).reduce((a, x) => a + x.heat, 0);
    return `<tr><td>${escapeHtml(desc.label)} (${escapeHtml(b.id)})</td>
      <td>${f(value)}${supportedTemperature(value) ? '' : ' — UNSUPPORTED temperature; no clamping'}</td>
      <td>${f(b.heat)}</td><td>${f(fromResistors)}</td><td>${f(t.heatCapacity)}</td></tr>`;
  }).join('');

  return `${head}
  <p><b>Node potentials</b>, with the source's negative terminal as the <b>0 V reference</b>. An ideal wire
    <b>merges</b> the nodes it joins into one potential; it is not a small resistor.</p>
  <div class="scroll-x"><table><thead><tr><th>Node</th><th>Potential (V)</th><th></th></tr></thead><tbody>${nodeRows}</tbody></table></div>
  <p><b>Resistors.</b> Current is <b>positive from terminal A to terminal B</b> and the voltage shown is
    <b>V(A) &minus; V(B)</b>, so a negative current means it flows B&nbsp;&rarr;&nbsp;A. Dissipated power is
    <b>V&sup2;/R and is never negative</b>.</p>
  <div class="scroll-x"><table><thead><tr><th>Resistor (A &rarr; B)</th><th>R (&#8486;)</th><th>V = V<sub>A</sub>&minus;V<sub>B</sub> (V)</th>
    <th>I, A&rarr;B (A)</th><th>P (W)</th><th>Energy so far (J)</th><th>Heat receiver</th></tr></thead>
    <tbody>${resistorRows}</tbody></table></div>
  ${resistors.map((r) => `<p class="dim">${escapeHtml(r.id)}: A = ${label(r.a)} &rarr; B = ${label(r.b)}.</p>`).join('')}
  ${wires.length ? `<p class="dim"><b>Ideal wires:</b> ${wires.map((w) => `${escapeHtml(w.id)} joins ${label(w.a)} and ${label(w.b)}`).join('; ')}.
    <b>This view does not compute individual wire currents. Ideal-wire loops can make their allocation nonunique;
    connected nodes share one potential.</b> A wire bridge in a tree <i>can</i> have a current fixed by KCL &mdash; that
    is why the earlier blanket claim was wrong &mdash; but this scope displays the merged potential and no wire current
    at all, and builds no wire-current solver.</p>` : ''}
  <p><b>Source ${escapeHtml(source.label)} (${escapeHtml(source.id)}).</b> EMF <b>${f(source.voltage)} V</b> from
    ${label(source.neg)} (0 V reference) to ${label(source.pos)}. Current out of the positive terminal
    <b>${f(sol.sourceCurrent)} A</b>, delivered power <b>${f(sol.sourceDeliveredPower)} W</b>.
    <b>Energy supplied from the ideal external source so far: ${f(e.suppliedEnergy)} J</b> over ${e.ticks} public ticks
    (${f(e.ticks / 60)} simulated seconds). <b>This is not a battery discharging — nothing is stored and nothing depletes.</b></p>
  <p>Resistor dissipation routed to receivers: <b>${f((sim.thermal.routedElectrical ?? []).reduce((a, x) => a + x.heat, 0))} J</b>.
    Dissipation with <b>no</b> named receiver: <b>${f(e.unroutedEnergy)} J</b>, which is
    <b>explicitly outgoing and unmodelled — it is not given to any body and it is not silently discarded</b>.</p>
  ${receiverRows ? `<p><b>Receivers.</b> A resistor delivers <b>100%</b> of its Joule power to the one body it names.
    There is no default receiver and no split. Damper heat and resistor heat are kept in separate ledgers, so a body
    can receive both without either overwriting the other.</p>
  <div class="scroll-x"><table><thead><tr><th>Receiver</th><th>Temperature (K)</th><th>Total Q (J)</th><th>of which from resistors (J)</th>
    <th>Total C (J/K)</th></tr></thead><tbody>${receiverRows}</tbody></table></div>` : ''}
  <p class="dim">Declared limits: ${CIRCUIT_LIMITS.maxNodes} nodes, ${CIRCUIT_LIMITS.maxComponents} components,
    ${CIRCUIT_LIMITS.maxResistors} resistors, ${CIRCUIT_LIMITS.maxWires} wires, exactly one source;
    R in [${CIRCUIT_LIMITS.minResistance}, ${CIRCUIT_LIMITS.maxResistance}] &#8486;; |V| &le; ${CIRCUIT_LIMITS.maxVoltage} V.
    Values and topologies outside these are <b>REFUSED and surfaced, never clamped and never repaired</b>.
    The solve is <b>algebraic and done once</b>; heat accumulates <b>P&middot;&Delta;t once per 1/60 s public tick</b>,
    independent of the internal sub-step count and of the display rate.</p></section>`;
}
