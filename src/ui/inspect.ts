/**
 * FP1 — inspection panels.
 *
 * ===========================================================================
 * HONEST FORCE LABELS. THE WORDING HERE IS PART OF THE CONTRACT.  (plan §3)
 * ===========================================================================
 * Rapier exposes user forces and contact events, NOT a complete decomposition of
 * every force and work channel. Therefore:
 *   - a user force is NEVER called the total force;
 *   - an impulse is NEVER called an instantaneous force;
 *   - a contact impulse divided by dt is ALWAYS labelled step-averaged;
 *   - the energy remainder is ALWAYS shown as UNATTRIBUTED, and never as
 *     numerical error and never as physical heat.
 */

import { H_SUB, SI, qangle, qconj, qmul, vlen, vsub, type Vec3 } from '../model/units';
import {
  anchorWorld, frameWorld, relativePoseAngle,
  type BodyPose, type JointDesc,
} from '../model/joints';
import { HAND, gainReductionNote, minEffectiveMass } from '../sim/hand';
import type { SimWorld } from '../sim/world';
import type { EnergyBudget } from '../model/energy';

const f = (x: number, n = 3): string => (Number.isFinite(x) ? x.toFixed(n) : '∞');
const vec = (v: Vec3, n = 3): string => `(${f(v.x, n)}, ${f(v.y, n)}, ${f(v.z, n)})`;

function row(label: string, value: string, cls = ''): string {
  return `<div class="row ${cls}"><span class="k">${label}</span><span class="v">${value}</span></div>`;
}
function note(text: string): string { return `<div class="note">${text}</div>`; }

// ---------------------------------------------------------------------------

export function renderEnergyPanel(b: EnergyBudget, tick: number): string {
  const owned = b.dissipatedDrag + b.dissipatedSpringDamper;
  const delta = b.current.total - b.baselineTotal;
  return `
  <h2>Energy — deliberately incomplete</h2>
  <div class="sub">t = ${f(tick / 60, 2)} s (tick ${tick})</div>

  <h3>1 · Resolved mechanical energy</h3>
  ${row('translational KE', `${f(b.current.keTranslational)} J`)}
  ${row('rotational KE', `${f(b.current.keRotational)} J`)}
  ${row('gravitational PE', `${f(b.current.gravitationalPotential)} J`, 'dim')}
  ${row('spring potential (declared, ½kx² elastic only)', `${f(b.current.springPotential)} J`)}
  ${row('E_mech total', `${f(b.current.total)} J`, 'strong')}
  ${row('E_mech at baseline', `${f(b.baselineTotal)} J`, 'dim')}
  ${row('change since baseline', `${delta >= 0 ? '+' : ''}${f(delta)} J`, 'strong')}
  ${note('Gravitational PE uses datum y = 0 m. Spring potential is the elastic term only; the damper is non-conservative and has no potential.')}

  <h3>2 · Explicit intervention changes</h3>
  ${row('total booked to interventions', `${b.interventionsTotal >= 0 ? '+' : ''}${f(b.interventionsTotal)} J`, 'strong')}
  ${row('interventions recorded', String(b.interventions.length))}
  <div class="scroll">
    ${b.interventions.slice(-8).reverse().map((i) =>
      `<div class="iv"><span class="t">t${i.tick}.${i.seq}</span> <b>${i.kind}</b> ${i.target}
       <span class="d">${i.detail}</span> <span class="e">${i.deltaEmech >= 0 ? '+' : ''}${f(i.deltaEmech)} J</span></div>`).join('') || '<div class="iv dim">none yet</div>'}
  </div>
  ${note('Every push, mass edit, stiffness edit, add and remove is measured with the world frozen across the edit, so its energy effect can never be mistaken for solver drift.')}

  <h3>3 · Dissipation we own (estimated)</h3>
  ${row('air drag', `${f(b.dissipatedDrag)} J`)}
  ${row('spring damper', `${f(b.dissipatedSpringDamper)} J`)}
  ${row('owned total', `${f(owned)} J`, 'strong')}
  ${row('ticks where an owned channel did positive work', String(b.nonDissipativeTicks), b.nonDissipativeTicks ? 'warn' : 'dim')}
  ${note('Estimated as W = F · Δx at the point of application, summed over the 4 internal sub-steps of each tick, which is EXACT for a force held constant over a sub-step. The approximation is entirely in the first-order (start-of-sub-step) force evaluation, not in the work integral. Anomalous positive-work ticks are counted, not clamped away.')}

  <h3>4 · Signed EXTERNAL work — the hand actuator</h3>
  ${row('hand work W_hand <span class="tag hand">EXTERNAL</span>', `${b.handWorkExternal >= 0 ? '+' : ''}${f(b.handWorkExternal, 4)} J`, 'hand strong')}
  ${note('The hand is an <b>external, powered compliant actuator</b> that sits <b>outside</b> the world\'s energy boundary — it is <b>not</b> another passive spring inside it. Its work therefore crosses the boundary and enters the identity as a <b>signed source term</b>. Positive means the hand <b>added</b> energy to the world. It is <b>not</b> dissipation, <b>not</b> a frozen-edit intervention, and <b>not</b> heat. The damping term in its force law is <b>external hand work, not heat in the body</b>. <b>No hand-spring potential is added to E_mech</b>: under this boundary there is none to add. Estimated by the same declared estimator as the drag and damper channels — W = F · Δx at the <b>material point of the body</b> the force acts at, summed over the internal sub-steps, exact for a force held constant over a sub-step.')}

  <h3>5 · <span class="unattr">UNATTRIBUTED</span></h3>
  ${row('remainder', `${b.unattributed >= 0 ? '+' : ''}${f(b.unattributed)} J`, 'unattr strong')}
  ${note('<b>This is NOT numerical error and NOT physical heat.</b> It is the observation limit of this slice. It contains, undifferentiated: contact friction work, restitution loss, constraint and penetration stabilization work done by the solver, integration error of the fixed-step scheme, and the error in our own owned-dissipation estimators. Contact, restitution and joint dissipation remain <b>unallocated</b>: no sound estimator for them is claimed here, so none is asserted.')}
  ${note('Identity: UNATTRIBUTED = E_mech(t) − E_mech(0) − interventions − W_hand + owned dissipation.')}
  `;
}

// ---------------------------------------------------------------------------

export function renderBodyPanel(sim: SimWorld, id: string | null): string {
  if (!id || !sim.entities.has(id)) {
    return `<h2>Inspector</h2><div class="sub">Click a body in the viewport to select it.</div>`;
  }
  const rt = sim.runtime(id);
  const b = sim.body(id);
  const dyn = rt.desc.kinematics === 'dynamic';
  const v = b.linvel(), w = b.angvel(), t = b.translation();
  const g = Math.abs(sim.construction.environment.gravity.y);

  const drag = sim.registry.netFor(id, 'air-drag');
  const sprE = sim.registry.netFor(id, 'spring-elastic');
  const sprD = sim.registry.netFor(id, 'spring-damper');
  const handF = sim.registry.netFor(id, 'hand-actuator');
  const userF = dyn ? b.userForce() : { x: 0, y: 0, z: 0 };
  const userT = dyn ? b.userTorque() : { x: 0, y: 0, z: 0 };
  const contact = sim.contactSummary(id);
  const weight = { x: 0, y: -rt.mass * g, z: 0 };

  return `
  <h2>Inspector — ${rt.desc.label}</h2>
  <div class="sub">id <code>${id}</code> · ${rt.desc.kinematics} · ${rt.desc.shape.kind}</div>

  <h3>State</h3>
  ${row('position', `${vec(t)} m`)}
  ${row('linear velocity', `${vec(v)} m/s &nbsp; |v| = ${f(vlen(v))}`)}
  ${row('angular velocity', `${vec(w)} rad/s`)}
  ${row('mass (read back from the engine)', `${f(rt.mass, 4)} kg`)}

  <h3>Forces acting this tick</h3>
  ${row('weight m·g <span class="tag engine">ENGINE</span>', `${vec(weight)} N`)}
  ${note('Gravity is applied by Rapier as world gravity. We never add a gravity force — that would double it. The figure above is computed by us for display only.')}
  ${row('air drag <span class="tag ours">OURS</span>', `${vec(drag)} N`)}
  ${row('spring, elastic <span class="tag ours">OURS</span>', `${vec(sprE)} N`)}
  ${row('spring, damper <span class="tag ours">OURS</span>', `${vec(sprD)} N`)}
  ${row('hand <span class="tag hand">EXTERNAL ACTUATOR</span>', `${vec(handF)} N &nbsp; |F| = ${f(vlen(handF), 2)}`, 'hand')}
  ${row('user-force accumulator, engine readout', `${vec(userF)} N`, 'strong')}
  ${row('user-torque accumulator, engine readout', `${vec(userT)} N·m`)}
  ${note('<b>This accumulator is the sum of APPLICATION-APPLIED forces only. It is NOT the total force on this body.</b> It excludes gravity (applied by the engine) and every contact and constraint force (resolved inside the solver and never exposed as a force). Rapier persists these across steps, so we clear and rebuild them before <b>every internal sub-step</b>, not once per tick — freezing them across the engine\'s sub-steps injected numerical energy that cancelled half the spring damping (D-1/D-8 in DEVIATIONS.md).')}

  <h3>Contact</h3>
  ${row('contact manifolds', String(contact.pairs))}
  ${row('accumulated normal impulse', `${f(contact.normalImpulse, 5)} N·s`)}
  ${row('accumulated tangential impulse', `${f(contact.tangentImpulse, 5)} N·s`)}
  ${row('sub-step-averaged normal force', `${f(contact.normalImpulse / H_SUB, 2)} N`, 'dim')}
  ${note('These are <b>impulses in N·s</b> reported by the solver, not forces. The manifold accumulates over the engine\'s last internal sub-step, so the N figure is <b>impulse ÷ h = ' + (1000 * H_SUB).toFixed(3) + ' ms: an average over one sub-step, not an instantaneous force.</b> It does NOT come out at the static m·g: for a resting body it measures <b>twice</b> it, and before the sub-step change (4 engine sub-steps) it measured 5/4 of m·g·Δt — i.e. a factor (N+1)/N in the engine\'s own sub-step count N. Two data points are a pattern, not documented behaviour, so <b>the normalisation remains unverified</b> and nothing is derived from it. See D-4/D-11 in DEVIATIONS.md.')}
  ${note('Contact and friction dissipation is <b>not</b> estimated from these. A contact force alone does not supply frictional work, so it stays in UNATTRIBUTED.')}

  <h3>Drag model</h3>
  ${row('medium', sim.construction.environment.medium)}
  ${row('C_d (this build\'s convention)', f(sim.dragCdOf(id), 2))}
  ${row('A_eff (orientation-averaged, S/4)', `${f(sim.effectiveAreaOf(id), 4)} m²`)}
  ${row('analytic terminal speed', `${f(sim.terminalSpeedOf(id), 3)} m/s`)}
  ${note('Quadratic, still air, subsonic and incompressible. No turbulence, no wind, no lift, <b>no orientation dependence and no angular drag.</b>')}
  `;
}

export function renderSpringPanel(sim: SimWorld, selectedSpring: string | null): string {
  return `
  <h2>Springs — one representation</h2>
  ${note('A <b>passive linear spring + viscous damper</b> whose force law this application evaluates and applies through the engine\'s user-force accumulator. <b>It is not a Rapier joint and not a motor controller.</b> There is no motor controller anywhere in this build, so nothing can be silently mistaken for a passive spring. F_on_b = −(k·x + c·v_rel)·n, with k in N/m, c in N·s/m, x = L − L₀ in m.')}
  <table class="springs">
    <tr><th>id</th><th>k (N/m)</th><th>c (N·s/m)</th><th>L (m)</th><th>x (m)</th><th>F_elastic (N)</th><th>F_damper (N)</th><th>U = ½kx² (J)</th></tr>
    ${sim.springs.map((s) => {
      const d = sim.springDiag.find((x) => x.id === s.id);
      const sel = s.id === selectedSpring ? ' class="sel"' : '';
      return `<tr${sel}><td>${s.id}</td><td>${f(s.stiffness, 0)}</td><td>${f(s.damping, 1)}</td>
        <td>${d ? f(d.length, 4) : '—'}</td><td>${d ? f(d.extension, 4) : '—'}</td>
        <td>${d ? f(d.elasticForce, 1) : '—'}</td><td>${d ? f(d.damperForce, 2) : '—'}</td>
        <td>${d ? f(d.potential, 3) : '—'}</td></tr>`;
    }).join('')}
  </table>`;
}

// ---------------------------------------------------------------------------
// THE REQUIRED DISCLOSURE for ball and fixed connections.
//
// bridge/BATCH2-ACCEPTANCE-AMENDMENT-A.md makes this text a condition of the
// amendment, and requires it to be ACCESSIBLE IN RUN MODE WHILE A CONNECTION IS
// IN USE — not only inside the editing form. It is therefore rendered by the
// joints panel (visible in run mode whenever a connection exists) and echoed as
// a viewport banner, as well as in the connection authoring form.
//
// THE ATTRIBUTION LIMITS ARE PART OF THE REQUIREMENT, not decoration:
//   - the two measured errors are the FIXED witness's, and no equivalent error
//     is claimed for a ball joint;
//   - the 1 % energy result belongs to the DECLARED FIXTURES AND PROFILE, not to
//     every live assembly;
//   - overlays compare NUMERICAL RUNS, so nothing here implies an accurate
//     comparison.
// ---------------------------------------------------------------------------

/** Is a ball or fixed connection present? The disclosure is scoped to those variants. */
export function hasExperimentalConnection(js: ReadonlyArray<JointDesc>): boolean {
  return js.some((j) => j.kind === 'ball' || j.kind === 'fixed');
}

/** The one-line form, for the viewport banner. */
export const CONNECTION_DISCLOSURE_SHORT =
  '<b>EXPERIMENTAL CONNECTIONS: holding an assembly together does not guarantee accurate motion.</b> '
  + 'In the fixed-assembly free-flight test over <b>10 simulated seconds at 128 substeps per tick</b>, maximum '
  + 'position error was <b>0.008378 m</b> and orientation error <b>0.02121 rad</b>; both exceeded the declared '
  + '<b>0.005</b> limits (m and rad respectively). <b>Other assemblies and profiles are not validated by this test.</b>';

/** The full form, with the attribution limits, for the panels. */
export const CONNECTION_DISCLOSURE_FULL =
  CONNECTION_DISCLOSURE_SHORT
  + ' Those two numbers are the <b>FIXED witness\'s own measurements</b> — <b>no equivalent error is claimed, or '
  + 'has been measured, for a ball joint</b>. The <b>≤ 1 % energy result</b> likewise belongs to the <b>declared '
  + 'witness fixtures at the declared profile</b>, not to every live assembly. Captured-run overlays compare '
  + '<b>two numerical runs</b> with each other; neither is a reference, and an overlay is <b>not</b> a claim of '
  + 'accurate comparison. Connection geometry and trajectory fidelity are <b>distinct</b>, and the trajectory '
  + 'result above is the one that failed. See bridge/BATCH2-ACCEPTANCE-AMENDMENT-A.md and DEVIATIONS.md D-36 §7 / D-39.';

/**
 * JOINTS — hinge and slider, plus BB2's ball and fixed. The wording here is part
 * of the contract, like the force labels above.
 */
export function renderJointPanel(sim: SimWorld): string {
  const js = sim.jointDescs();
  if (!js.length) return '';
  return `
  <h2>Joints and connections</h2>
  ${hasExperimentalConnection(js) ? `<div class="disclosure" role="note">${CONNECTION_DISCLOSURE_FULL}</div>` : ''}
  ${js.map((j) => row(`<span class="tag joint">${j.kind.toUpperCase()}</span> ${j.id}`,
    `${j.bodyA} ↔ ${j.bodyB}, ${jointDetail(j, sim)}`, 'joint')).join('')}
  ${note('A joint is a <b>constraint resolved inside the engine\'s impulse solver</b>, not one of our force laws. '
    + 'Its constraint force is never exposed as a force, so it does not appear in the user-force accumulator above '
    + 'and the single-writer discipline is untouched. Neither wrapper configures a motor, a limit or a joint spring, '
    + 'so nothing here can be mistaken for the passive spring model.')}
  ${note('<b>NO EXACT DECOMPOSITION OF JOINT CONSTRAINT WORK IS PROMISED.</b> An ideal holonomic constraint does no '
    + 'work; one solved by impulses at a finite step does a little. This build does <b>not</b> estimate it, does '
    + '<b>not</b> book it as owned dissipation, and does <b>not</b> turn it into heat. It stays inside '
    + '<span class="unattr">UNATTRIBUTED</span> with everything else that cannot be attributed. '
    + 'That residual is <b>not small</b> for a fast hinge: with zero gravity and no torque at all, the demo-2 hinge '
    + 'loses 59.7 % of its kinetic energy in 11 s at the shipped sub-step, halving each time h is halved. '
    + 'See DEVIATIONS.md D-29.')}
  ${note('Each variant carries the fields it actually has, and no others. A <b>HINGE</b> and a <b>SLIDER</b> carry '
    + 'one axis. A <b>BALL</b> carries <b>no axis and no frame</b> — it has three rotational degrees of freedom and '
    + 'no preferred direction, so there is no field pretending it has one. A <b>FIXED</b> connection carries '
    + '<b>two connection frames</b>, one unit quaternion per body, which is what holds its relative pose: '
    + '<b>an axis could not stand in for a frame.</b> The separation and frame error shown above are '
    + '<b>measured live</b>, and are shown whether or not they are inside the 1e-6 m / 1e-6 rad authoring band.')}
  ${note('Authored joint identity — id, kind, both bodies, both anchors and the <b>variant-specific</b> remainder '
    + '(the axis for hinge and slider, nothing for ball, both connection frames for fixed) — is <b>application-owned</b> '
    + 'and is part of the declared replay scope. <b>No engine handle appears in a construction</b>; the id → handle '
    + 'mapping lives in the checkpoint, exactly as it does for bodies.')}`;
}

/** An impulse is never called a force. */
export function describeImpulse(J: Vec3): string {
  return `impulse ${vec(J, 2)} N·s (|J| = ${f(vlen(J), 2)} N·s) — <b>an instantaneous change of momentum, NOT a force.</b>
    Its step-averaged equivalent over one 1/60 s tick would be ${f(vlen(J) / SI.DT, 1)} N; that number is shown for scale only and is <b>not</b> an instantaneous force.`;
}

// ---------------------------------------------------------------------------
// THE HAND. The wording here is part of the contract, exactly as the force
// labels above are.
// ---------------------------------------------------------------------------

export function renderHandPanel(sim: SimWorld): string {
  const h = sim.hand;
  const mMin = minEffectiveMass(H_SUB);
  const note1 = note('The hand is an <b>EXTERNAL, POWERED COMPLIANT ACTUATOR</b>. It is deliberately modelled '
    + '<b>outside</b> the world\'s energy boundary and is <b>not another passive spring inside it</b>. '
    + 'F = K·(target − grab point) − C·v(grab point), clamped to the cap, applied at the '
    + '<b>body-local grab point</b> and <b>re-evaluated before every internal sub-step</b>. '
    + '<b>One point attachment, no angular controller</b> — every torque you see is r × F and nothing else.');
  const note2 = note(`<b>Nominal gains and cap are fixed</b>: K = ${HAND.K} N/m, C = ${HAND.C} N·s/m, `
    + `cap = ${HAND.F_MAX} N; they are <b>reduced for numerical resolution when the effective mass is low</b> `
    + `(below m_eff = ${mMin.toFixed(3)} kg) and not otherwise. That reduction is CONTROLLER behaviour, not a `
    + `mass-proportional gain schedule: in the supported regime the nominal values are used unchanged, so this `
    + `build <b>does</b> claim that a heavier or more strongly sprung body lags further behind the pointer and `
    + `needs more force — and <b>does not</b> claim the hand feels the same on every body. The <b>live effective</b> `
    + `values are shown below whenever a body is held.`);
  const note3 = note(`Declared <b>controller</b> stability margin: omega_n·h &le; ${HAND.MAX_OMEGA_H}, gamma·h &le; ${HAND.MAX_GAMMA_H} `
    + `at the ${(1000 * H_SUB).toFixed(3)} ms internal sub-step, i.e. m_eff &ge; ${mMin.toFixed(3)} kg at full gain. `
    + `This is the <b>controller's</b> margin, derived from Jury's conditions on the sub-step map `
    + `(h&gamma; &lt; 2 and h²&omega;² + 2h&gamma; &lt; 4, here with a 3.2× margin). It is <b>not</b> the passive springs' `
    + `resolvability limit, which is unchanged. Effective response uses the full offset form `
    + `1/m_eff = 1/m + (r × n)ᵀ·I_world⁻¹·(r × n); the guard uses its direction-independent bound, evaluated at grab `
    + `time <b>and re-evaluated whenever the held body's mass or inertia changes</b> — so a mid-grab mass edit `
    + `cannot leave it stale. `
    + `<b>Supported: the preset bodies of this construction. No arbitrary-body stability is claimed.</b>`);

  const gestures = sim.handGestureHistory.slice().reverse();
  const hist = sim.handTickHistory.slice(-8).reverse();

  const live = h.active
    ? row('state', `<b>HOLDING ${h.entityId}</b>, gesture ${h.gestureId}`, 'hand strong')
      + row('body-local attachment point', `${vec(h.localPoint)} m`)
      + row('resolved world target', `${vec(h.target)} m`)
      + row('force applied last sub-step', `${f(h.lastForce, 2)} N${h.lastSaturated ? ' <b class="unattr">AT CAP</b>' : ''}`, 'hand strong')
      + row('controller K / C / cap', `${f(h.kP, 1)} N/m · ${f(h.kD, 2)} N·s/m · ${f(h.fMax, 0)} N`)
      + row('m_eff bound used by the guard', `${f(h.mEffBound, 4)} kg`)
      + row('gain scale', `×${f(h.gainScale, 4)}`, h.gainScale < 1 ? 'warn' : 'dim')
      + row('work this gesture (signed, external)', `${h.gestureWork >= 0 ? '+' : ''}${f(h.gestureWork, 5)} J`, 'hand strong')
    : row('state', 'not holding anything', 'dim');

  const reduction = gainReductionNote(h);

  return `
  <h2>The hand — external powered compliant actuator</h2>
  ${note1}
  ${live}
  ${reduction ? note(`<b class="unattr">${reduction}</b>`) : ''}
  ${row('total signed external hand work', `${sim.budget.handWorkExternal >= 0 ? '+' : ''}${f(sim.budget.handWorkExternal, 5)} J`, 'hand strong')}

  <h3>Bounded diagnostic history</h3>
  ${note(`One row per <b>public tick</b>, ring buffer of ${HAND.TICK_HISTORY} ticks (${(HAND.TICK_HISTORY / 60).toFixed(0)} s), plus per-gesture totals for the last ${HAND.GESTURE_HISTORY} gestures. <b>There is deliberately no ledger row per sub-step.</b>`)}
  <table class="springs">
    <tr><th>tick</th><th>|F| (N)</th><th>W (J)</th><th>cap</th></tr>
    ${hist.map((r) => `<tr><td>${r.tick}</td><td>${f(r.forceN, 2)}</td><td>${r.workJ >= 0 ? '+' : ''}${f(r.workJ, 5)}</td><td>${r.saturated ? 'yes' : ''}</td></tr>`).join('')
      || '<tr><td colspan="4" class="dim">no ticks recorded</td></tr>'}
  </table>
  <table class="springs">
    <tr><th>gesture</th><th>body</th><th>ticks</th><th>work (J)</th><th>peak F (N)</th><th>gain</th></tr>
    ${gestures.map((g) => `<tr><td>${g.gestureId}</td><td>${g.entityId}</td><td>${g.ticks}</td>
      <td>${g.workJ >= 0 ? '+' : ''}${f(g.workJ, 5)}</td><td>${f(g.peakForceN, 1)}</td><td>×${f(g.gainScale, 3)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="dim">no completed gestures</td></tr>'}
  </table>
  ${note2}
  ${note3}
  `;
}

/**
 * BB2 — the VARIANT-SPECIFIC detail line for one joint or connection, with the
 * LIVE measured constraint residuals for the two fully-anchored variants.
 * Reporting the residual is the point: it is shown whether or not it is inside
 * the authoring alignment band, so a solver correction can never be hidden.
 */
function jointDetail(j: JointDesc, sim: SimWorld): string {
  if (j.kind === 'hinge' || j.kind === 'slider') return `axis ${vec(j.axis, 0)}`;
  const a = sim.entities.get(j.bodyA), b = sim.entities.get(j.bodyB);
  if (!a || !b) return 'body missing';
  const pose = (id: string): BodyPose => {
    const body = sim.body(id);
    return { translation: body.translation(), rotation: body.rotation() };
  };
  const pa = pose(j.bodyA), pb = pose(j.bodyB);
  const sep = vlen(vsub(anchorWorld(j, 'A', pa), anchorWorld(j, 'B', pb)));
  if (j.kind === 'ball') {
    return `anchors held coincident (separation ${sep.toExponential(2)} m), `
      + '<b>three rotational DOF</b>, no axis and no frame';
  }
  const err = qangle(qmul(qconj(frameWorld(j, 'A', pa)), frameWorld(j, 'B', pb)));
  return `anchors held coincident (separation ${sep.toExponential(2)} m), connection frames held coincident `
    + `(frame error ${err.toExponential(2)} rad), <b>zero DOF</b>, relative pose held at `
    + `${((180 / Math.PI) * relativePoseAngle(j)).toFixed(2)}°`;
}
