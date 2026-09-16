import type { SimWorld } from '../sim/world';
import { temperature, supportedTemperature, extendedResidual, extendedSystemBalance, totalDamperRouted, totalHeat, totalResistorRouted, totalRouted } from '../model/thermal';
import { escapeHtml } from './authoring';
const f=(n:number)=>Number.isFinite(n)?n.toPrecision(7):String(n);
export function renderThermalPanel(sim:SimWorld):string {
 if(!sim.thermal.bodies.length&&!sim.thermal.routed.length&&!(sim.thermal.routedElectrical?.length))return '';
 const hasCircuit=!!sim.construction?.circuit;
 return `<section><h2>Heat received</h2><p>Explicit lumped receivers. Only <b>configured spring dampers</b> and <b>resistors that name this body</b> feed these accounts. Elastic energy stays stored. Drag, contact, friction and constraint loss do not heat these bodies. No conduction, radiation, convection, equilibration or temperature feedback is modelled.</p>
 <table><thead><tr><th>Receiver</th><th>Temperature (K)</th><th>Heat change Q (J)</th><th>Total C (J/K)</th></tr></thead><tbody>${sim.thermal.bodies.map(b=>{
 const e=sim.runtime(b.id).desc,t=e.thermal!,T=temperature(t,b.heat);
 return `<tr><td>${escapeHtml(e.label)} (${escapeHtml(b.id)})</td><td>${f(T)}${supportedTemperature(T)?'':' — UNSUPPORTED temperature; no clamping'}</td><td>${f(b.heat)}</td><td>${f(t.heatCapacity)}</td></tr>${b.backflowCount?`<tr><td colspan="4">Numerical backflow: ${b.backflowCount} negative heat increments. These are signed estimator anomalies, not physical cooling.</td></tr>`:''}`;
 }).join('')}</tbody></table><p>Q = C(T − T0), measured change from the authored starting temperature; not absolute internal energy. Disabling routing leaves that damper's destination unmodelled.</p>
 <p>Transferred heat including removed receivers: ${f(totalHeat(sim.thermal))} J. Exported with removed receivers: ${f(sim.thermal.exportedHeat)} J.
 <b>The two domains are kept in separate ledgers and neither overwrites the other:</b> routed <b>damper work ${f(totalDamperRouted(sim.thermal))} J</b>${hasCircuit?` and routed <b>resistor Joule heat ${f(totalResistorRouted(sim.thermal))} J</b>`:''} — combined routed total ${f(totalRouted(sim.thermal))} J.</p>
 <p>Damper-only extended remainder: ${f(extendedResidual(sim.budget,sim.thermal))} J. Routed work is counted once. Mechanical UNATTRIBUTED remains ${f(sim.budget.unattributed)} J; this remainder is not heat.</p>
 ${hasCircuit?(()=>{const b=extendedSystemBalance(sim.budget,sim.thermal,sim.electrical);
 return `<p><b>Extended system balance, derived separately over the boundary enclosing the mechanical world and the receivers</b> — <b>not</b> resistor heat added to the damper-only remainder above. Joule energy appears <b>once</b>: the routed part inside STORED, the unrouted part inside OUT.<br>
 IN = E_mech(0) ${f(b.inBaseline)} + interventions ${f(b.inInterventions)} + external hand work ${f(b.inHandWork)} + <b>electrical supplied ${f(b.inElectricalSupplied)}</b> J<br>
 STORED = E_mech(now) ${f(b.storedMechanical)} + receiver Q ${f(b.storedReceiverHeat)} J<br>
 OUT = mechanical unrouted ${f(b.outMechanicalUnrouted)} + <b>electrical unrouted ${f(b.outElectricalUnrouted)}</b> J<br>
 <b>residual = IN − STORED − OUT = ${f(b.residual)} J</b>. Source gap (supplied − resistor dissipation) ${f(b.sourceGap)} J; routing gap (receiver Q − both ledgers) ${f(b.routingGap)} J. <b>This remainder is not heat</b>, and the electrical supply is energy crossing the boundary from an <b>ideal external source</b>, never energy created inside the world.</p>`;})():''}</section>`;
}
