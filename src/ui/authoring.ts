import { Euler, Quaternion } from 'three';
import type { Construction, EntityDesc } from '../model/construction';
import { CONNECTION_KINDS, connectionAlignment, isConnectionKind, relativePoseAngle, type ConnectionKind } from '../model/joints';
import { ALIGN_TOL_ANG, ALIGN_TOL_POS, poseLookup } from '../model/authoring';
import { CONNECTION_DISCLOSURE_FULL } from './inspect';
import { CIRCUIT_SCOPE } from './circuit';
export const escapeHtml = (s: unknown): string => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const input = (id:string,label:string,value:number|string,type='number') => `<label for="a-${id}">${label}</label><input id="a-${id}" type="${type}" ${type==='number'?'step="any"':''} value="${escapeHtml(value)}">`;
export function authorControls(c:Construction, selected:string|null, editing:boolean, auditCount:number):string {
 const e=c.entities.find(e=>e.id===selected); const r=e?new Euler().setFromQuaternion(new Quaternion(e.rotation.x,e.rotation.y,e.rotation.z,e.rotation.w)):new Euler();
 return `<section class="author"><h2>Your experiment</h2><p>${editing?'Editing the starting scene · paused at tick 0':'Run mode · changes made during the run do not rewrite the saved starting scene'}</p>
 <button id="a-mode">${editing?'Run authored scene':'Edit starting scene'}</button><button id="a-save">Save authored scene</button><button id="a-load">Reopen authored scene</button>
 ${!editing?'<button id="a-pause">Pause / resume</button><button id="a-step">Advance one tick</button>':''}<details><summary>Scene file · inspect or paste to reopen</summary><textarea id="a-document" aria-label="Authored scene document" rows="5"></textarea><button id="a-export">Show saved JSON</button><button id="a-import">Open pasted scene</button></details>
 ${editing?`<label for="a-body">Body to author</label><select id="a-body">${c.entities.map(b=>`<option value="${escapeHtml(b.id)}" ${b.id===selected?'selected':''}>${escapeHtml(b.label)} (${escapeHtml(b.id)})</option>`).join('')}</select>
 <label for="a-shape">New body shape</label><select id="a-shape"><option value="box">Box</option><option value="sphere">Sphere</option><option value="capsule">Capsule</option></select><button id="a-add">Add body</button>
 ${e?`<div class="author-grid">${input('label','Body label',e.label,'text')}${input('x','Position X (m)',e.translation.x)}${input('y','Position Y (m)',e.translation.y)}${input('z','Position Z (m)',e.translation.z)}${input('rx','Rotation X (degrees)',r.x*180/Math.PI)}${input('ry','Rotation Y (degrees)',r.y*180/Math.PI)}${input('rz','Rotation Z (degrees)',r.z*180/Math.PI)}${input('mass','Authored mass (kg)',e.material.mass)}${input('friction','Friction coefficient',e.material.friction)}${input('restitution','Restitution coefficient',e.material.restitution)}</div><button id="a-apply">Apply body edit</button><button id="a-cancel">Cancel form changes</button><button id="a-delete">Delete authored body</button>
 <details><summary>Model this body as a damper housing</summary><p>Explicit idealized heat receiver, not a material lookup. Capacity is total J/K, independent of mass. No conduction, radiation or equilibration.</p>
 <label><input id="a-thermal-enable" type="checkbox" ${e.thermal?'checked':''}>Enable thermal account for this body</label>
 ${input('heat-capacity','Total heat capacity (J/K)',e.thermal?.heatCapacity??2)}${input('temperature0','Starting temperature (K)',e.thermal?.initialTemperature??300)}
 <button id="a-thermal-apply">Apply thermal settings</button><p>Applying starts a new run. Disabling clears springs routed here.</p></details>`:''}
 <p>Placement is an edit, not physical motion. Each applied edit starts a new run and ends any previous recording.</p>`:''}
 <p class="dim">${auditCount} authoring edits in this session · edit energy is recorded separately from run work.</p><div id="a-audit"></div></section>`;
}
export function readBodyEdit(e:EntityDesc):void {
 const n=(id:string)=>{const value=Number((document.getElementById(`a-${id}`) as HTMLInputElement).value);if(!Number.isFinite(value))throw new Error('Enter finite numbers');return value;};
 e.label=(document.getElementById('a-label') as HTMLInputElement).value;
 e.translation={x:n('x'),y:n('y'),z:n('z')};
 const q=new Quaternion().setFromEuler(new Euler(n('rx')*Math.PI/180,n('ry')*Math.PI/180,n('rz')*Math.PI/180));e.rotation={x:q.x,y:q.y,z:q.z,w:q.w};
 e.material.mass=n('mass');e.material.friction=n('friction');e.material.restitution=n('restitution');
 if(e.material.friction<0||e.material.restitution<0||e.material.restitution>1)throw new Error('Friction must be nonnegative; restitution must be between 0 and 1');
}

export function springAuthorControls(c:Construction, selected:string|null):string {
 const s=c.springs.find(s=>s.id===selected);
 const options=(chosen:string)=>c.entities.map(e=>`<option value="${escapeHtml(e.id)}" ${e.id===chosen?'selected':''}>${escapeHtml(e.label)} (${escapeHtml(e.id)})</option>`).join('');
 const ep=(side:'a'|'b')=>{
  const old=s?.[side], chosen=old?.kind==='body'?old.entityId:c.entities[side==='a'?0:1]?.id??'';
  const point=old?.kind==='body'?old.localPoint:{x:0,y:0,z:0};
  return `<label for="a-end-${side}">Endpoint ${side.toUpperCase()} body</label><select id="a-end-${side}">${options(chosen)}</select><div class="author-grid">${(['x','y','z'] as const).map(k=>input(`${side}${k}`,`${side.toUpperCase()} local ${k} (m)`,point[k])).join('')}</div>`;
 };
 // Existing world endpoints remain unchanged unless explicitly replaced through New spring.
 const worldEndpoint=s&&[s.a,s.b].some(e=>e.kind==='world');
 return `<details class="spring-author"><summary>Connect bodies with a spring</summary><p>Attachment coordinates are local to each body. Choose a fixed body for an immovable attachment. Existing fidelity limits apply; arbitrary constructions are not validated.</p>
 <label for="a-spring-choice">Authored spring</label><select id="a-spring-choice"><option value="">New spring</option>${c.springs.map(x=>`<option value="${escapeHtml(x.id)}" ${x.id===s?.id?'selected':''}>${escapeHtml(x.id)}</option>`).join('')}</select>
 ${worldEndpoint?'<p>Existing world-anchored endpoints are preserved. These controls edit their spring parameters.</p>':ep('a')+ep('b')}
 <div class="author-grid">${input('rest','Rest length (m)',s?.restLength??1)}${input('stiff','Stiffness (N/m)',s?.stiffness??100)}${input('damp','Damping (N·s/m)',s?.damping??2)}</div>
 <label for="a-heat-receiver">Damper heat receiver (100% of signed damper work)</label><select id="a-heat-receiver"><option value="">No modelled destination</option>${c.entities.filter(e=>e.thermal).map(e=>`<option value="${escapeHtml(e.id)}" ${s?.heatReceiver===e.id?'selected':''}>${escapeHtml(e.label)} (${escapeHtml(e.id)})</option>`).join('')}</select>
 <p>First enable a body's thermal account to select it here. Elastic spring energy is storage; it does not heat the receiver.</p>
 <button id="a-spring-apply">${s?'Apply spring edit':'Create spring'}</button>${s?'<button id="a-spring-delete">Delete spring</button>':''}<button id="a-spring-cancel">Cancel spring changes</button></details>`;
}

// ===========================================================================
// BB2 — AUTHORED CONNECTIONS: ball and fixed. The real controls.
// Against EXPECTATIONS-BB2-CONNECTIONS.md PART 6.
// ===========================================================================

/**
 * THE CONNECTION PANEL.
 *
 * Two DISTINCT bodies, a connection TYPE, and attachment locations in an
 * EXPLICITLY NAMED FRAME — the labels name the frame, they do not merely say
 * "local". A fixed connection reports the INTENDED INITIAL RELATIVE POSE it
 * preserves, as an angle, together with the two derived connection frames, so the
 * author can see what is being held. A misalignment is REPORTED HERE with its
 * measured separation in metres and, for a fixed connection, its measured frame
 * error in radians — and the AUTHORED PLACEMENT OPERATION is offered next to it.
 */
export function connectionAuthorControls(c: Construction, selected: string | null): string {
  const joints = c.joints ?? [];
  const j = joints.find((x) => x.id === selected && (x.kind === 'ball' || x.kind === 'fixed'));
  const bodies = c.entities;
  const options = (chosen: string) => bodies.map((e) =>
    `<option value="${escapeHtml(e.id)}" ${e.id === chosen ? 'selected' : ''}>${escapeHtml(e.label)} (${escapeHtml(e.id)})</option>`).join('');
  const kind = j?.kind ?? 'ball';
  const bodyA = j?.bodyA ?? bodies[0]?.id ?? '';
  const bodyB = j?.bodyB ?? bodies.find((e) => e.id !== bodyA)?.id ?? '';
  const aA = j?.anchorA ?? { x: 0, y: 0, z: 0 };
  const aB = j?.anchorB ?? { x: 0, y: 0, z: 0 };

  // The MEASURED residual of the currently selected connection, always shown.
  let status = '';
  if (j) {
    const al = connectionAlignment(j, poseLookup(c));
    if (al) {
      const ok = al.aligned;
      status = `<p class="${ok ? 'dim' : 'refusal'}"><b>${ok ? 'Aligned' : 'MISALIGNED — REFUSED'}</b>: `
        + `measured anchor separation <b>${al.separation.toExponential(3)} m</b>`
        + (al.frameError === null
          ? ' · a ball has no orientation constraint, so no frame error is defined'
          : ` · measured connection-frame error <b>${al.frameError.toExponential(3)} rad</b>`)
        + ` · authoring band ${ALIGN_TOL_POS.toExponential(0)} m / ${ALIGN_TOL_ANG.toExponential(0)} rad. `
        + (ok ? 'This residual is numerical representation noise and is shown whether or not it is inside the band.'
          : `<b>It is not snapped into place by the solver.</b> Either author the two bodies so the connection `
            + `is satisfied, or use the placement operation below — an authored edit, recorded in the edit audit.`)
        + '</p>';
    }
  }
  if (j?.kind === 'fixed') {
    const q = (x: { x: number; y: number; z: number; w: number }) =>
      `(${x.x.toFixed(6)}, ${x.y.toFixed(6)}, ${x.z.toFixed(6)}, ${x.w.toFixed(6)})`;
    status += `<p class="dim"><b>Intended initial relative pose preserved: `
      + `${((180 / Math.PI) * relativePoseAngle(j)).toFixed(3)}°.</b> `
      + `Connection frame in ${escapeHtml(j.bodyA)}'s local frame <code>frameA = ${q(j.frameA)}</code>; `
      + `in ${escapeHtml(j.bodyB)}'s local frame <code>frameB = ${q(j.frameB)}</code>. `
      + 'These are unit quaternions derived from the two bodies’ authored rotations when the connection was '
      + 'created, and stored explicitly. <b>A ball carries neither; an axis could not stand in for a frame.</b></p>';
  }

  // The label NAMES THE FRAME, and the name must follow the body actually selected —
  // a label naming the wrong body would be worse than naming none. `data-frame-side`
  // lets `refreshConnectionFrameLabels` retarget it the instant the select changes,
  // without a rebuild that would discard what the author has typed. The stale label
  // was found by LOOKING AT THE SCREEN, not by a test (DEVIATIONS D-37).
  const anchorRow = (side: 'A' | 'B', v: { x: number; y: number; z: number }) =>
    (['x', 'y', 'z'] as const).map((k) => {
      const id = `a-c-${side.toLowerCase()}${k}`;
      return `<label for="${id}" data-frame-side="${side}" data-frame-axis="${k}"></label>`
        + `<input id="${id}" type="number" step="any" value="${escapeHtml(v[k])}">`;
    }).join('');

  return `<details class="connection-author"><summary>Connect two bodies with a ball joint or a fixed connection</summary>
 <div class="disclosure" role="note">${CONNECTION_DISCLOSURE_FULL}</div>
 <p>A <b>ball</b> holds the two attachment points together and leaves <b>three rotational degrees of freedom</b>: no axis, no frame.
 A <b>fixed</b> connection also holds the two connection frames together, leaving <b>none</b>, and preserves the relative pose the two bodies have when you create it.
 Attachment locations are given in <b>each body’s own local frame</b> — origin at that body’s centre of mass, axes fixed in that body.
 A connection whose two attachment points do not already coincide is <b>refused, never snapped into place</b>.
 Changing the type of an existing connection <b>keeps its id</b> and rewrites its fields to the ones that variant actually
 carries — a ball loses the frames, a fixed gains them — so the change shows up in comparison provenance as a
 connection field and not as a new object.</p>
 <label for="c-choice">Authored connection</label><select id="c-choice"><option value="">New connection</option>${
   joints.filter((x) => x.kind === 'ball' || x.kind === 'fixed').map((x) =>
     `<option value="${escapeHtml(x.id)}" ${x.id === j?.id ? 'selected' : ''}>${escapeHtml(x.id)} · ${x.kind}</option>`).join('')}</select>
 <label for="c-kind">Connection type</label><select id="c-kind">${
   CONNECTION_KINDS.map((k) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${k === 'ball' ? 'Ball joint — three rotational DOF' : 'Fixed connection — zero DOF'}</option>`).join('')}</select>
 <label for="c-bodyA">Body A</label><select id="c-bodyA">${options(bodyA)}</select>
 <label for="c-bodyB">Body B</label><select id="c-bodyB">${options(bodyB)}</select>
 <div class="author-grid">${anchorRow('A', aA)}${anchorRow('B', aB)}</div>
 <button id="c-apply">${j ? 'Apply connection edit' : 'Create connection'}</button>
 <button id="c-place">${j ? 'Place Body B to satisfy this connection' : 'Place Body B, then connect'}</button>
 ${j ? '<button id="c-delete">Delete connection</button>' : ''}<button id="c-cancel">Cancel connection changes</button>
 ${status}
 <p class="dim">Placement is an <b>authored edit to the starting scene</b>, not physical motion: it moves Body B so the
 connection is satisfied exactly, and it is recorded in the edit audit with its own initial-energy change.</p></details>`;
}

/** Read the connection form. Throws on anything nonfinite, so a bad form is refused whole. */
export function readConnectionForm(): {
  kind: ConnectionKind; bodyA: string; bodyB: string;
  anchorA: { x: number; y: number; z: number }; anchorB: { x: number; y: number; z: number };
} {
  // The shared `input()` helper prefixes every field id with `a-`, so the anchor
  // fields are `a-c-ax` .. `a-c-bz`. Reading them without that prefix found nothing
  // and threw on null — a defect found by DRIVING THE REAL CONTROLS, not by a test
  // (DEVIATIONS D-37). The lookup is asserted below so it cannot regress silently.
  const n = (id: string): number => {
    const el = document.getElementById(`a-${id}`) as HTMLInputElement | null;
    if (!el) throw new Error(`Connection form field a-${id} is missing`);
    const v = Number(el.value);
    if (!Number.isFinite(v)) throw new Error('Enter finite attachment coordinates');
    return v;
  };
  const sel = (id: string): string => (document.getElementById(id) as HTMLSelectElement).value;
  const kind = sel('c-kind');
  if (!isConnectionKind(kind)) throw new Error(`Unknown connection type ${kind}`);
  const bodyA = sel('c-bodyA'), bodyB = sel('c-bodyB');
  if (bodyA === bodyB) throw new Error('A connection needs two DISTINCT bodies');
  return {
    kind, bodyA, bodyB,
    anchorA: { x: n('c-ax'), y: n('c-ay'), z: n('c-az') },
    anchorB: { x: n('c-bx'), y: n('c-by'), z: n('c-bz') },
  };
}


/**
 * Retarget every attachment label at the body that is ACTUALLY selected. Called on
 * first render and on every change of Body A / Body B, so the named frame can never
 * disagree with the select beside it.
 */
export function refreshConnectionFrameLabels(): void {
  const name = (side: 'A' | 'B'): string => {
    const sel = document.getElementById(`c-body${side}`) as HTMLSelectElement | null;
    const opt = sel?.selectedOptions[0];
    return opt ? opt.textContent!.replace(/\s*\([^)]*\)\s*$/, '') : `body ${side}`;
  };
  const a = name('A'), b = name('B');
  for (const el of document.querySelectorAll<HTMLLabelElement>('label[data-frame-side]')) {
    const side = el.dataset.frameSide as 'A' | 'B';
    el.textContent = `Attachment ${side} \u00b7 ${el.dataset.frameAxis} (m), in ${side === 'A' ? a : b}\u2019s own local frame`;
  }
}

// ===========================================================================
// BATCH 4 — THE AUTHORED DC CIRCUIT. The real controls: node selection and
// commit actions live in their OWN VISIBLE SECTION, not hidden behind a field.
// Against BATCH4-ELECTRONICS-ACCEPTANCE-v1 §9.
// ===========================================================================

/**
 * THE CIRCUIT PANEL. Two visible subsections: NODES (the things components attach
 * to) and COMPONENTS (a source, resistors and ideal wires between two named nodes).
 *
 * Terminal orientation is NAMED in every label, because it is what the sign of a
 * current means: a resistor's current is positive from A to B. A wire's two nodes
 * are just merged, and the form says so rather than implying a direction.
 */
export function circuitAuthorControls(c: Construction, selectedNode: string | null, selectedComponent: string | null): string {
  const circuit = c.circuit;
  const nodes = circuit?.nodes ?? [];
  const components = circuit?.components ?? [];
  const x = components.find((k) => k.id === selectedComponent);
  const hasSource = components.some((k) => k.kind === 'source');
  const kind = x?.kind ?? (hasSource ? 'resistor' : 'source');
  const NEW = '__new__';
  const nodeOptions = (chosen: string | undefined) =>
    `<option value="${NEW}" ${chosen === undefined ? 'selected' : ''}>+ create a new node here</option>`
    + nodes.map((n) => `<option value="${escapeHtml(n.id)}" ${n.id === chosen ? 'selected' : ''}>${escapeHtml(n.label)} (${escapeHtml(n.id)})</option>`).join('');
  const termA = x ? (x.kind === 'source' ? x.pos : x.a) : nodes[0]?.id;
  const termB = x ? (x.kind === 'source' ? x.neg : x.b) : nodes[1]?.id;
  const receivers = c.entities.filter((e) => e.thermal);

  return `<details class="circuit-author"><summary>Build a DC circuit — nodes, one source, resistors and ideal wires</summary>
 <div class="disclosure" role="note">${CIRCUIT_SCOPE}</div>

 <h3>1 &middot; Nodes</h3>
 <p>A <b>node</b> is a connection point. Components attach to nodes <b>by name</b> — bodies touching in the scene,
 or lines crossing on screen, are <b>not</b> electrical connections. The source's <b>negative</b> node is the
 <b>0 V reference</b> for the whole circuit.</p>
 <p class="dim"><b>A node is created together with the component that connects it</b> — choose
 <b>&ldquo;+ create a new node here&rdquo;</b> in a terminal below. A node with nothing attached has <b>no determined
 potential</b>, so this build refuses to author one rather than inventing a value for it.</p>
 ${nodes.length ? `<label for="a-cn-choice">Node</label><select id="a-cn-choice">${nodes.map((n) =>
   `<option value="${escapeHtml(n.id)}" ${n.id === selectedNode ? 'selected' : ''}>${escapeHtml(n.label)} (${escapeHtml(n.id)})</option>`).join('')}</select>
 <label for="a-cn-label">Node name</label><input id="a-cn-label" type="text" value="${escapeHtml(nodes.find((n) => n.id === selectedNode)?.label ?? nodes[0]?.label ?? '')}">
 <button id="a-cn-rename">Rename node</button><button id="a-cn-delete">Delete node</button>
 <p class="dim">Deleting a node removes every component attached to it <b>in one edit</b>. A node carrying a terminal
 of the source is <b>refused</b> with a message rather than leaving a dangling source behind.</p>`
   : '<p class="dim">This scene has no circuit yet. Create the <b>source</b> below and its two nodes come with it.</p>'}

 <h3>2 &middot; Components</h3>
 ${hasSource ? '' : '<p class="dim"><b>The first component must be the source</b>: a circuit has exactly one ideal DC voltage source, and its negative terminal defines the 0 V reference every other potential is measured against.</p>'}
 <label for="a-cc-choice">Authored component</label><select id="a-cc-choice"><option value="">New component</option>${
   components.map((k) => `<option value="${escapeHtml(k.id)}" ${k.id === x?.id ? 'selected' : ''}>${escapeHtml(k.id)} &middot; ${k.kind}</option>`).join('')}</select>
 <label for="a-cc-kind">Component type</label><select id="a-cc-kind">
   <option value="source" ${kind === 'source' ? 'selected' : ''}>Ideal DC voltage source &mdash; exactly one per circuit</option>
   <option value="resistor" ${kind === 'resistor' ? 'selected' : ''}>Resistor &mdash; dissipates V&sup2;/R</option>
   <option value="wire" ${kind === 'wire' ? 'selected' : ''}>Ideal wire &mdash; merges two nodes into one potential</option>
 </select>
 <label for="a-cc-label">Component name</label><input id="a-cc-label" type="text" value="${escapeHtml(x?.label ?? (kind === 'source' ? 'supply' : kind === 'wire' ? 'link' : 'heater'))}">
 <label for="a-cc-a" id="a-cc-a-label"></label>
 <select id="a-cc-a">${nodeOptions(termA)}</select>
 <label for="a-cc-a-name" id="a-cc-a-name-label"></label><input id="a-cc-a-name" type="text" value="${escapeHtml(kind === 'source' ? 'supply rail' : 'node')}">
 <label for="a-cc-b" id="a-cc-b-label"></label>
 <select id="a-cc-b">${nodeOptions(termB)}</select>
 <label for="a-cc-b-name" id="a-cc-b-name-label"></label><input id="a-cc-b-name" type="text" value="${escapeHtml(kind === 'source' ? '0 V reference' : 'node')}">
 <label for="a-cc-value" id="a-cc-value-label"></label>
 <input id="a-cc-value" type="number" step="any" value="${escapeHtml(x && x.kind === 'source' ? x.voltage : x && x.kind === 'resistor' ? x.resistance : 10)}">
 <label for="a-cc-receiver">Resistor heat receiver (100% of its Joule power)</label>
 <select id="a-cc-receiver"><option value="">No modelled destination &mdash; dissipation leaves the model</option>${
   receivers.map((e) => `<option value="${escapeHtml(e.id)}" ${x && x.kind === 'resistor' && x.heatReceiver === e.id ? 'selected' : ''}>${escapeHtml(e.label)} (${escapeHtml(e.id)})</option>`).join('')}</select>
 <p class="dim">First enable a body's thermal account under <b>Model this body as a damper housing</b> to offer it here.
 A resistor with no receiver still dissipates; that energy is reported as <b>explicitly outgoing</b>, not given to a body.</p>
 <button id="a-cc-apply">${x ? 'Apply component edit' : 'Create component'}</button>
 ${x ? '<button id="a-cc-delete">Delete component</button>' : ''}<button id="a-cc-cancel">Cancel circuit changes</button>
 ${circuit ? '<button id="a-cc-drop">Delete the whole circuit</button>' : ''}
 <p class="dim">Every commit here is an <b>authored edit</b>: it goes through the edit audit and <b>starts a new
 paused run</b>. There is no live electrical intervention in this slice. An invalid graph &mdash; a wire shorting the
 source, a floating subnetwork, a duplicate id, a non-positive resistance &mdash; is <b>REFUSED and the message shown</b>;
 nothing is grounded, dropped or repaired to make it solvable.</p></details>`;
}

/** Read the component form. Throws on anything the model would refuse, so a bad form is refused whole. */
export const NEW_NODE = '__new__';
export function readComponentForm(): {
  kind: 'source' | 'resistor' | 'wire'; label: string; a: string; b: string; value: number;
  aName: string; bName: string; receiver: string;
} {
  const el = (id: string): HTMLInputElement | HTMLSelectElement => {
    const e = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!e) throw new Error(`Circuit form field ${id} is missing`);
    return e;
  };
  const kind = el('a-cc-kind').value as 'source' | 'resistor' | 'wire';
  if (!['source', 'resistor', 'wire'].includes(kind)) throw new Error(`Unknown component type ${kind}`);
  const a = el('a-cc-a').value, b = el('a-cc-b').value;
  if (a === b && a !== NEW_NODE) throw new Error('A component needs two DIFFERENT nodes');
  const value = kind === 'wire' ? 0 : Number(el('a-cc-value').value);
  if (kind !== 'wire' && !Number.isFinite(value)) throw new Error('Enter a finite value');
  return { kind, label: el('a-cc-label').value, a, b, value,
    aName: el('a-cc-a-name').value, bName: el('a-cc-b-name').value,
    receiver: kind === 'resistor' ? el('a-cc-receiver').value : '' };
}

/**
 * Retarget the component form's labels and enabled state at the type that is
 * ACTUALLY selected — IN PLACE, without rebuilding the panel.
 *
 * Rebuilding on a type change RESET the type select back to the stored component's
 * kind and discarded everything the author had typed, so a wire and a second source
 * were both silently committed as resistors. Found by DRIVING THE REAL CONTROLS,
 * not by a test — the same class of defect as D-37. Called on first render and on
 * every change of the type select.
 */
export function refreshCircuitFormLabels(): void {
  const kindEl = document.getElementById('a-cc-kind') as HTMLSelectElement | null;
  if (!kindEl) return;
  const kind = kindEl.value as 'source' | 'resistor' | 'wire';
  const text = (id: string, v: string): void => { const el = document.getElementById(id); if (el) el.textContent = v; };
  text('a-cc-a-label', kind === 'source' ? 'POSITIVE terminal node'
    : kind === 'wire' ? 'First node to merge' : 'Terminal A node (current is positive A \u2192 B)');
  text('a-cc-b-label', kind === 'source' ? 'NEGATIVE terminal node \u2014 this becomes the 0 V reference'
    : kind === 'wire' ? 'Second node to merge' : 'Terminal B node');
  text('a-cc-a-name-label', 'Name for a new node A');
  text('a-cc-b-name-label', 'Name for a new node B');
  text('a-cc-value-label', kind === 'source' ? 'Source EMF (V)'
    : kind === 'wire' ? 'An ideal wire has no value \u2014 it merges the two nodes' : 'Resistance (\u03a9)');
  const value = document.getElementById('a-cc-value') as HTMLInputElement | null;
  if (value) value.disabled = kind === 'wire';
  const receiver = document.getElementById('a-cc-receiver') as HTMLSelectElement | null;
  if (receiver) { receiver.disabled = kind !== 'resistor'; if (kind !== 'resistor') receiver.value = ''; }
}
