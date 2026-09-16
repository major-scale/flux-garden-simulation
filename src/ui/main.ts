/**
 * FP1 — the playable. Three.js rendering over the fixed-step simulation.
 *
 * THE RENDERER NEVER DRIVES THE SIMULATION. `requestAnimationFrame` supplies a
 * wall-clock delta to `FixedStepDriver.advance`, which decides how many WHOLE
 * 1/60 s ticks to run under its declared catch-up policy, and the draw uses an
 * interpolated pose. Nothing computed here feeds back into physics.
 */

import { renderThermalPanel } from './thermal';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { SI, LIMITS, RESOLVABILITY, clamp, qinvrot, type Vec3 } from '../model/units';
import {
  defaultConstruction, maxDampingForSpring, maxStiffnessForSpring, 
  shapeExtent, SPRING_ANCHOR_Y,
  type EntityDesc,
} from '../model/construction';
import { SimWorld, canonicalSimState } from '../sim/world';
import {
  Meter, crossingLinear, crossingQuadratic, peaks, olsSlope, type MeasureRef,
} from '../model/measure';
import {
  COLLISION, FALL, INCLINE, OSCILLATOR, PENDULUM, PENDULUM_PROFILE, PROJECTILE, SCENES,
  collisionContactTime, collisionOutcome, collisionScene, discreteOscillator, fallScene,
  inclineAcceleration, inclineBlockStart, inclineDown, inclineIsStatic, inclineScene,
  launchImpulse, oscillatorScene, pendulumExactPeriod, pendulumSmallAnglePeriod, pendulumScene,
  projectileScene, sceneById,
} from '../model/scenes';
import { dragK, terminalSpeed } from '../model/drag';
import { renderPlot } from './plot';
import { HAND, PointerResampler, gainReductionNote, minEffectiveMass } from '../sim/hand';
import { FixedStepDriver, MAX_CATCHUP_TICKS_PER_FRAME } from '../sim/step';
import {
  Recorder, applyDue, applyEvent, replay, sortEvents,
  takeCheckpoint, restoreCheckpoint, extrasFrom, worldReplaced,
  type Checkpoint, type InputEvent, type InputRecord,
} from '../sim/record';
import { CONNECTION_DISCLOSURE_FULL, CONNECTION_DISCLOSURE_SHORT, hasExperimentalConnection, renderBodyPanel, renderEnergyPanel, renderHandPanel, renderJointPanel, renderSpringPanel, describeImpulse } from './inspect';
import { AuthoringSession, copy, deleteBody, deleteConnection, loadAuthored, makeConnection, nextConnectionId, placeToSatisfyConnection, requireRecordingBase } from '../model/authoring';
import { authorControls, circuitAuthorControls, connectionAuthorControls, NEW_NODE, readComponentForm, refreshCircuitFormLabels, readConnectionForm, refreshConnectionFrameLabels, springAuthorControls, readBodyEdit, escapeHtml } from './authoring';
import { renderCircuitPanel } from './circuit';
import { newElectricalViewState, pinScales, renderElectricalView, type ElectricalViewState } from './electrical-view';
import { deleteCircuitComponent, deleteCircuitNode } from '../model/authoring';
import type { ComponentDesc } from '../model/circuit';
import { ComparisonStore, captureRun, differences } from '../model/comparison';
import './style.css';

const LS = { construction: 'fp1.construction', checkpoint: 'fp1.checkpoint', record: 'fp1.record' };

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

// ---------------------------------------------------------------------------

class App {
  sim = new SimWorld();
  author = new AuthoringSession(defaultConstruction());
  editing = false;
  authoredScene = false;
  runEvents: InputEvent[] = [];
  comparisons = new ComparisonStore();
  comparisonMarkup = '';
  authorSpring: string | null = null;
  /** BB2 — the connection currently selected in the connection panel, or null for a new one. */
  authorConnection: string | null = null;
  /** BATCH 4 — the circuit node and component the authoring forms are pointed at. */
  authorNode: string | null = null;
  authorComponent: string | null = null;
  /**
   * BATCH 4 VISIBLE STAGE — PRESENTATION STATE ONLY. Which electrical element is
   * expanded, which node the drawing calls zero, and the pinned drawing scale.
   * None of it reaches the simulation, the recorder, a checkpoint or a document.
   */
  elecView: ElectricalViewState = newElectricalViewState();
  driver!: FixedStepDriver;
  recorder = new Recorder();
  /** Events scheduled for future ticks (replay queue / live recording tail). */
  pending: InputEvent[] = [];
  selectedId: string | null = 'platform';
  selectedSpring: string | null = 'spring0';

  // -- BB1 stage one: scene selector, measurement, demo parameters ----------
  sceneId = 'platform';
  /** The bounded meters of the current scene. Pure observers; never replay state. */
  meters: Meter[] = [];
  plotIndex = 0;
  /** Stated on the plot when a mid-run edit has invalidated the analytic reference. */
  refNote = '';
  demo: { angleDeg: number; amplitudeDeg: number; x0: number; restitution: number; inclineDeg: number; mu: number } = {
    angleDeg: PROJECTILE.angleDeg, amplitudeDeg: PENDULUM.amplitudeDeg, x0: OSCILLATOR.x0,
    restitution: COLLISION.restitution, inclineDeg: INCLINE.angleDeg, mu: 0,
  };

  scene = new THREE.Scene();
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  controls!: OrbitControls;
  meshes = new Map<string, THREE.Mesh>();
  springLines = new Map<string, THREE.Line>();
  /** RENDER-ONLY joint furniture: a hinge's arm, a slider's travel axis. */
  jointLines = new Map<string, THREE.Line>();
  jointMarks = new Map<string, THREE.Mesh>();
  outline: THREE.LineSegments | null = null;
  /** RENDER-ONLY flown path for demo 1. */
  trailLine: THREE.Line | null = null;
  raycaster = new THREE.Raycaster();

  // -- DM1: direct manipulation ---------------------------------------------
  /** Resolves pointer motion to ONE world-space sample per SIMULATION TICK. */
  resampler = new PointerResampler();
  /**
   * The CAMERA-PARALLEL DRAG PLANE through the initial hit, FIXED for the whole
   * gesture. It lives here, in the UI, and never reaches the simulation: the
   * pointer is resolved to a world point on this side of the boundary, so raw
   * screen pixels and the camera cannot drive replay physics.
   */
  dragPlane: { n: THREE.Vector3; p: THREE.Vector3 } | null = null;
  grabPointerId: number | null = null;
  handleLine: THREE.Line | null = null;
  targetMarker: THREE.Mesh | null = null;
  pendingMarker: THREE.Mesh | null = null;

  frameTimes: number[] = [];
  physicsTimes: number[] = [];
  lastFrame = performance.now();
  lastPanelPaint = 0;
  perfReport = '';

  async start(): Promise<void> {
    await SimWorld.initEngine();
    this.sim.build(this.author.authored);
    this.driver = new FixedStepDriver(this.sim, this.beforeTick, this.afterTick);
    this.configureMeters();
    this.initThree();
    this.initHandle();
    this.initPointer();
    this.initElectricalView();
    this.rebuildSceneGraph();
    this.buildControls();
    this.paintInstruction();
    this.paintPanels();
    window.addEventListener('resize', () => this.resize());
    // Engine init and first paint are not a simulation slowdown: start the
    // wall clock here so the load gap is not counted as dropped ticks.
    this.lastFrame = performance.now();
    this.loop();
  }

  // -- three -----------------------------------------------------------------

  private initThree(): void {
    const vp = $('viewport');
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    vp.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0d1218);
    this.scene.fog = new THREE.Fog(0x0d1218, 16, 48);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(4.6, 2.9, 5.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.15, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0x9fc2e0, 0x1a2129, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera as THREE.OrthographicCamera;
    c.left = -8; c.right = 8; c.top = 8; c.bottom = -8; c.near = 0.5; c.far = 30;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fb4d8, 0.5);
    fill.position.set(-4, 3, -5);
    this.scene.add(fill);

    const grid = new THREE.GridHelper(24, 24, 0x35424f, 0x222c36);
    grid.position.y = 0.002;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    this.scene.add(grid);

    this.resize();
  }

  private resize(): void {
    const vp = $('viewport');
    const w = Math.max(1, vp.clientWidth), h = Math.max(1, vp.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private geometryFor(e: EntityDesc): THREE.BufferGeometry {
    const s = e.shape;
    switch (s.kind) {
      case 'box': return new THREE.BoxGeometry(2 * s.hx, 2 * s.hy, 2 * s.hz);
      case 'sphere': return new THREE.SphereGeometry(s.radius, 28, 18);
      case 'capsule': return new THREE.CapsuleGeometry(s.radius, 2 * s.halfHeight, 8, 20);
    }
  }

  rebuildSceneGraph(): void {
    for (const m of this.meshes.values()) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.meshes.clear();
    for (const l of this.springLines.values()) { this.scene.remove(l); l.geometry.dispose(); }
    this.springLines.clear();
    for (const l of this.jointLines.values()) { this.scene.remove(l); l.geometry.dispose(); }
    this.jointLines.clear();
    for (const m of this.jointMarks.values()) { this.scene.remove(m); m.geometry.dispose(); }
    this.jointMarks.clear();

    for (const id of this.sim.order) {
      const e = this.sim.runtime(id).desc;
      const mat = new THREE.MeshStandardMaterial({
        color: e.colour, roughness: id === 'ground' ? 0.95 : 0.62, metalness: 0.03,
      });
      const mesh = new THREE.Mesh(this.geometryFor(e), mat);
      mesh.castShadow = e.kinematics === 'dynamic';
      mesh.receiveShadow = true;
      mesh.userData.id = id;
      this.scene.add(mesh);
      this.meshes.set(id, mesh);
    }
    for (const s of this.sim.springs) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * SPRING_SEGMENTS), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9fe8c0 }));
      this.scene.add(line);
      this.springLines.set(s.id, line);
    }
    // RENDER-ONLY JOINT FURNITURE. A hinge with nothing drawn between the pivot
    // and the bob reads as a ball floating in mid-air — which is what the first
    // on-screen look at demo 2 actually showed. These have no collider and no
    // rigid body; they exist so the constraint is visible.
    for (const j of this.sim.jointDescs()) {
      // BB2: each VARIANT is drawn differently, so a ball and a fixed connection are
      // told apart by LOOKING at the scene and not only by reading the panel.
      //   hinge / slider  amber, a small sphere        (unchanged)
      //   ball            teal, a larger sphere        — a joint that rotates freely
      //   fixed           violet, a CUBE               — a rigid weld, not a pivot
      const colour = j.kind === 'ball' ? 0x5ad9c8 : j.kind === 'fixed' ? 0xb07ad9 : 0xd9a05a;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: colour }));
      line.frustumCulled = false;
      this.scene.add(line);
      this.jointLines.set(j.id, line);
      const mark = new THREE.Mesh(
        j.kind === 'fixed' ? new THREE.BoxGeometry(0.07, 0.07, 0.07)
          : new THREE.SphereGeometry(j.kind === 'ball' ? 0.05 : 0.035, 14, 10),
        new THREE.MeshStandardMaterial({ color: colour, emissive: 0x201828, roughness: 0.4 }),
      );
      this.scene.add(mark);
      this.jointMarks.set(j.id, mark);
    }
    this.buildAnchorMarkers();
    this.updateOutline();
  }

  /**
   * RENDER-ONLY furniture: posts and caps marking the four fixed world anchors
   * the springs hang from. These have NO collider and NO rigid body — they exist
   * purely so the viewer can see what the springs are attached to.
   */
  private anchorGroup: THREE.Group | null = null;
  private buildAnchorMarkers(): void {
    if (this.anchorGroup) this.scene.remove(this.anchorGroup);
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x46545f, roughness: 0.8 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x9fe8c0, roughness: 0.35, emissive: 0x16332a });
    const anchors: Array<{ x: number; y: number; z: number }> = [];
    const seen = new Set<string>();
    for (const sp of this.sim.springs) {
      if (sp.a.kind !== 'world') continue;
      const key = `${sp.a.point.x},${sp.a.point.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push(sp.a.point);
    }
    if (!anchors.length) { this.anchorGroup = g; this.scene.add(g); return; }
    const zs = [...new Set(anchors.map((a) => a.z))];
    const xMax = Math.max(...anchors.map((a) => Math.abs(a.x)));
    const postX = xMax + 0.45;   // stand the posts CLEAR of the springs so the
    const beamY = SPRING_ANCHOR_Y + 0.07;   // springs are not occluded by them
    for (const z of zs) {
      for (const sx of [-postX, postX]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, beamY, 12), postMat);
        post.position.set(sx, beamY / 2, z);
        post.castShadow = true;
        g.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * postX + 0.1, 0.055, 0.075), postMat);
      beam.position.set(0, beamY, z);
      beam.castShadow = true;
      g.add(beam);
    }
    for (const a of anchors) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), capMat);
      cap.position.set(a.x, a.y, a.z);
      g.add(cap);
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, beamY - a.y, 8), postMat);
      hanger.position.set(a.x, (a.y + beamY) / 2, a.z);
      g.add(hanger);
    }
    this.anchorGroup = g;
    this.scene.add(g);
  }

  private updateOutline(): void {
    if (this.outline) { this.scene.remove(this.outline); this.outline.geometry.dispose(); this.outline = null; }
    if (!this.selectedId) return;
    const m = this.meshes.get(this.selectedId);
    if (!m) return;
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(m.geometry),
      new THREE.LineBasicMaterial({ color: 0xffe08a, depthTest: false }),
    );
    this.outline.renderOrder = 999;
    this.scene.add(this.outline);
  }

  // =========================================================================
  // DM1 — DIRECT MANIPULATION. GRAB, HAUL, RELEASE.
  //
  // THE HAND IS AN EXTERNAL, POWERED COMPLIANT ACTUATOR (sim/hand.ts). Nothing
  // here moves a body directly. The ONLY thing that reaches the simulation is a
  // (tick, seq)-keyed event carrying RESOLVED WORLD-SPACE geometry.
  // =========================================================================

  /** Render-only furniture: the visible handle, the target, and the pending target. */
  private initHandle(): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.handleLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xc692e8, depthTest: false }));
    this.handleLine.renderOrder = 998;
    this.handleLine.visible = false;
    this.scene.add(this.handleLine);

    this.trailLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x8fd4e0, transparent: true, opacity: 0.85 }),
    );
    this.trailLine.visible = false;
    this.trailLine.frustumCulled = false;
    this.scene.add(this.trailLine);

    this.targetMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xc692e8, depthTest: false }),
    );
    this.targetMarker.renderOrder = 998;
    this.targetMarker.visible = false;
    this.scene.add(this.targetMarker);

    // Where the pointer IS, when the simulation has not yet been allowed to see
    // it (paused). Hollow, so it reads as "not yet acted on".
    this.pendingMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xe0c46f, wireframe: true, depthTest: false }),
    );
    this.pendingMarker.renderOrder = 998;
    this.pendingMarker.visible = false;
    this.scene.add(this.pendingMarker);
  }

  /**
   * BATCH 4 VISIBLE STAGE — ONE delegated listener on the panels container.
   *
   * The panels are re-rendered wholesale every 120 ms, so per-element listeners
   * would not survive; the container does. EVERY BRANCH HERE IS PRESENTATION
   * ONLY: it writes UI-local view state and repaints. Nothing here touches the
   * simulation, the recorder, a checkpoint or an authored document, so no
   * selection, reference shift or pinned scale can change a simulated value.
   */
  private initElectricalView(): void {
    const panels = $('panels');
    const act = (target: EventTarget | null): boolean => {
      const el = target instanceof Element ? target : null;
      const pick = el?.closest('[data-elec-select]') as HTMLElement | null;
      if (pick) {
        const raw = pick.dataset.elecSelect ?? '';
        const kind = raw.slice(0, raw.indexOf(':')), id = raw.slice(raw.indexOf(':') + 1);
        if (kind === 'node' || kind === 'resistor' || kind === 'source') {
          this.elecView.selection = { kind, id };
          this.paintPanels();
          return true;
        }
        return false;
      }
      const cmd = (el?.closest('[data-elec]') as HTMLElement | null)?.dataset.elec;
      if (cmd === undefined) return false;
      if (cmd === 'clear') this.elecView.selection = null;
      else if (cmd === 'honesty') this.elecView.honestyOpen = !this.elecView.honestyOpen;
      else if (cmd === 'pin') {
        const p = pinScales(this.sim, this.elecView);
        this.elecView.pinned = p;
        this.toast(p
          ? 'Drawing scales PINNED. Both this run and the next are now drawn on ONE scale — a different voltage or current will look different, not renormalised to the same size. Nothing simulated changed.'
          : 'Nothing to pin: there is no accepted electrical solution to freeze a scale against.', !!p);
      } else if (cmd === 'unpin') {
        this.elecView.pinned = null;
        this.toast('Pinned scales released. The drawing auto-fits again — which is exactly why two runs must not be compared without pinning.', true);
      } else if (cmd.startsWith('ref:')) {
        this.elecView.displayRef = cmd.slice(4) || null;
        this.toast('Displayed reference changed. Every bar slid by one constant; NO voltage difference, NO current, NO power and NO heat changed. The drawing moved, the physics did not.', true);
      } else return false;
      this.paintPanels();
      return true;
    };
    panels.addEventListener('click', (ev) => { act(ev.target); });
    panels.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      if (act(ev.target)) ev.preventDefault();
    });
  }

  private initPointer(): void {
    const vp = $('viewport');
    // CAPTURE PHASE ON THE PARENT, so this runs BEFORE OrbitControls' own
    // listener on the canvas. If the press starts a grab we stop propagation and
    // OrbitControls never sees the gesture at all.
    // *** THE CAMERA CANNOT CONSUME THE SAME GESTURE. ***
    vp.addEventListener('pointerdown', (e) => this.onPointerDown(e), { capture: true });
    // Move/up on the WINDOW so a drag that leaves the canvas still tracks and
    // still releases. Together with pointercancel and lostpointercapture this is
    // why a grab cannot get stuck.
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.releaseIfMine(e, 'pointerup'));
    window.addEventListener('pointercancel', (e) => this.releaseIfMine(e, 'pointercancel'));
    this.renderer.domElement.addEventListener('lostpointercapture', (e) => this.releaseIfMine(e, 'lostpointercapture'));
    window.addEventListener('blur', () => this.releaseGrab('window blur'));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.releaseGrab('Escape'); });
  }

  private ndcOf(ev: PointerEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    );
  }

  private onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;                       // right/middle stay with the camera
    this.raycaster.setFromCamera(this.ndcOf(ev), this.camera);
    const hits = this.raycaster.intersectObjects([...this.meshes.values()], false);
    if (!hits.length) return;                          // empty space -> ORBIT

    const id = hits[0].object.userData.id as string;
    this.selectedId = id;
    this.updateOutline();
    this.buildControls();
    this.paintPanels();

    const rt = this.sim.entities.get(id);
    if (this.editing) return;
    // The ground is FIXED and cannot be grabbed: dragging it orbits the camera.
    if (!rt || rt.desc.kinematics !== 'dynamic') return;

    // ---- start a gesture -------------------------------------------------
    const hit = hits[0].point;
    const b = this.sim.body(id);
    const q = b.rotation();
    const t = b.translation();
    const local = qinvrot(q, { x: hit.x - t.x, y: hit.y - t.y, z: hit.z - t.z });

    // THE CAMERA-PARALLEL DRAG PLANE THROUGH THE INITIAL HIT, HELD FOR THE WHOLE
    // GESTURE. Recomputing it per frame would let camera drift move the target.
    const n = new THREE.Vector3();
    this.camera.getWorldDirection(n);
    this.dragPlane = { n: n.clone().normalize(), p: hit.clone() };

    const world = { x: hit.x, y: hit.y, z: hit.z };
    this.fireQuiet((tick, seq) => ({
      tick, seq, wallClockMs: Date.now(), kind: 'grabBegin',
      target: id, localPoint: local, worldTarget: world,
    }));
    if (!this.sim.hand.active) { this.dragPlane = null; return; }

    this.resampler.begin(world);
    this.grabPointerId = ev.pointerId;
    try { this.renderer.domElement.setPointerCapture(ev.pointerId); } catch { /* not fatal */ }
    this.controls.enabled = false;
    ev.stopPropagation();
    ev.preventDefault();

    const note = gainReductionNote(this.sim.hand);
    this.toast(`grabbed <b>${id}</b> at body-local (${local.x.toFixed(3)}, ${local.y.toFixed(3)}, ${local.z.toFixed(3)}) m`
      + ` — EXTERNAL POWERED COMPLIANT ACTUATOR, K ${this.sim.hand.kP.toFixed(0)} N/m, C ${this.sim.hand.kD.toFixed(1)} N·s/m,`
      + ` cap ${this.sim.hand.fMax.toFixed(0)} N. No teleport: the body has not moved.`
      + (note ? `<br><b>${note}</b>` : ''), true);
    this.paintPanels();
  }

  private onPointerMove(ev: PointerEvent): void {
    if (this.grabPointerId === null || ev.pointerId !== this.grabPointerId || !this.dragPlane) return;
    this.raycaster.setFromCamera(this.ndcOf(ev), this.camera);
    const ray = this.raycaster.ray;
    const denom = ray.direction.dot(this.dragPlane.n);
    if (Math.abs(denom) < 1e-6) return;                 // ray parallel to the plane
    const s = this.dragPlane.p.clone().sub(ray.origin).dot(this.dragPlane.n) / denom;
    if (!Number.isFinite(s)) return;
    const p = ray.origin.clone().addScaledVector(ray.direction, s);
    // STORED, NOT SENT. It becomes simulation input only when the tick driver
    // resamples it — at most once per tick, and never while paused.
    this.resampler.setRawTarget({ x: p.x, y: p.y, z: p.z });
  }

  private releaseIfMine(ev: PointerEvent, why: string): void {
    if (this.grabPointerId === null || ev.pointerId !== this.grabPointerId) return;
    this.releaseGrab(why);
  }

  /**
   * RELEASE PRESERVES THE BODY'S CURRENT VELOCITY. The hand force simply stops
   * being added on the next sub-step; NO impulse is applied and no velocity is
   * touched anywhere in this path.
   */
  private releaseGrab(why: string): void {
    const wasActive = this.sim.hand.active;
    const id = this.sim.hand.entityId;
    const work = this.sim.hand.gestureWork;
    if (wasActive) {
      this.fireQuiet((tick, seq) => ({ tick, seq, wallClockMs: Date.now(), kind: 'grabEnd', target: id }));
    }
    this.clearGrabUi();
    if (wasActive) {
      this.toast(`released <b>${id}</b> (${why}) — velocity preserved, no impulse applied. `
        + `Gesture ${this.sim.hand.gestureId}: signed external hand work <b>${work >= 0 ? '+' : ''}${work.toFixed(4)} J</b>.`, true);
      this.paintPanels();
      this.buildControls();
    }
  }

  /** The UI half of a release. Idempotent, and safe to call from any path. */
  private clearGrabUi(): void {
    if (this.grabPointerId !== null) {
      try { this.renderer.domElement.releasePointerCapture(this.grabPointerId); } catch { /* already gone */ }
    }
    this.grabPointerId = null;
    this.dragPlane = null;
    this.resampler.end();
    this.controls.enabled = true;
  }

  /**
   * THE TICK HOOK. Replay events due this tick are applied first, then the live
   * pointer is RESAMPLED — at most ONE grabMove per simulation tick, and none if
   * the target has not changed. This is the only path from pointer to physics,
   * and it runs at the fixed simulation cadence, never at the display cadence.
   */
  private beforeTick = (): void => {
    applyDue(this.sim, this.pending);
    if (!this.sim.hand.active || this.grabPointerId === null) return;
    const t = this.resampler.sample();
    if (!t) return;
    const id = this.sim.hand.entityId;
    this.fireQuiet((tick, seq) => ({ tick, seq, wallClockMs: Date.now(), kind: 'grabMove', target: id, worldTarget: t }));
  };

  /**
   * The quiet intervention path, for the three grab events. They move NOTHING,
   * so unlike `fire` this does not resync the interpolation buffers and does not
   * rebuild the panels — which is itself part of why there is no teleport.
   */
  private fireQuiet(make: (tick: number, seq: number) => InputEvent): void {
    const tick = this.sim.tick;
    const seq = this.recorder.nextSeq();
    const e = make(tick, seq);
    const refusal = applyEvent(this.sim, e);
    if (refusal) { this.toast(refusal, false); return; }
    this.recorder.record(e);
    this.runEvents.push(copy(e));
  }

  /** Draw the handle, the target, and the pending target. Render only. */
  private updateHandle(): void {
    const h = this.sim.hand;
    const line = this.handleLine, tm = this.targetMarker, pm = this.pendingMarker;
    if (!line || !tm || !pm) return;
    if (!h.active) { line.visible = false; tm.visible = false; pm.visible = false; return; }

    // Attach the handle to the INTERPOLATED mesh so it does not shimmer against
    // the drawn body. This is display only and feeds nothing back.
    const mesh = this.meshes.get(h.entityId);
    let gp: THREE.Vector3;
    if (mesh) gp = new THREE.Vector3(h.localPoint.x, h.localPoint.y, h.localPoint.z).applyMatrix4(mesh.matrixWorld);
    else { const w = this.sim.grabPointWorld(h.entityId, h.localPoint); gp = new THREE.Vector3(w.x, w.y, w.z); }

    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, gp.x, gp.y, gp.z);
    pos.setXYZ(1, h.target.x, h.target.y, h.target.z);
    pos.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    (line.material as THREE.LineBasicMaterial).color.setHex(h.lastSaturated ? 0xe0c46f : 0xc692e8);
    line.visible = true;

    tm.position.set(h.target.x, h.target.y, h.target.z);
    tm.visible = true;
    (tm.material as THREE.MeshBasicMaterial).color.setHex(h.lastSaturated ? 0xe0c46f : 0xc692e8);

    // PAUSED: the pointer has moved but the simulation has not been allowed to
    // see it. Show WHERE it is, and say so — the body itself has not moved.
    const pend = this.resampler.pending;
    const moved = pend && (pend.x !== h.target.x || pend.y !== h.target.y || pend.z !== h.target.z);
    if (pend && moved) { pm.position.set(pend.x, pend.y, pend.z); pm.visible = true; }
    else pm.visible = false;
  }

  /**
   * THE REQUIRED DISCLOSURE, as a viewport banner. It is emitted whenever a ball
   * or fixed connection is live and we are NOT in the editing form, which is the
   * "run mode while a connection is in use" the amendment requires. The panel
   * copy in `renderJointPanel` carries the same text with its attribution limits.
   */
  private connectionDisclosureBanner(): string {
    if (this.editing) return '';
    if (!hasExperimentalConnection(this.sim.jointDescs())) return '';
    return `<div class="disclosure" role="note">${CONNECTION_DISCLOSURE_SHORT}</div>`;
  }

  private paintInstruction(): void {
    if (this.editing) { $('instruct').textContent='Editing is paused. Select a body, set its position and rotation, then Apply. Run authored scene to try it.'; return; }
    const disclosure = this.connectionDisclosureBanner();
    if (this.authoredScene) { $('instruct').innerHTML = disclosure + 'Drag a body to pull it; release to let go. Drag empty space to orbit. Edit starting scene to change the saved experiment.'; return; }
    if (this.sceneId !== 'platform') { $('instruct').innerHTML = disclosure + this.preset.instruction; return; }
    $('instruct').innerHTML = disclosure +
      `<b>Drag a coloured body to grab and haul it.</b> The hand is an `
      + `<span class="actuator">EXTERNAL, POWERED COMPLIANT ACTUATOR</span> — not a spring inside the world. `
      + `It pulls at the exact point you grabbed, so a corner grab spins the body <b>much more</b> than a centre grab `
      + `(measured on the loose block: peak |omega| 3.73 vs 0.97 rad/s, and about the opposite axis).<br>`
      + `Drag empty space or the ground to <b>orbit the camera</b>. <b>Esc</b> releases. `
      + `<b>Nominal gains and cap are fixed</b> at K ${HAND.K} N/m, C ${HAND.C} N·s/m, cap ${HAND.F_MAX} N; they are `
      + `<b>reduced for numerical resolution when the effective mass is low</b> (below `
      + `${minEffectiveMass(this.sim.hSub).toFixed(3)} kg) and not otherwise — so in the supported regime heavier and more `
      + `strongly sprung bodies really do lag further behind. The <b>live effective</b> values are shown while you hold.`;
  }

  private paintGrabReadout(): void {
    const el = $('grab');
    const h = this.sim.hand;
    if (!h.active) { el.className = ''; return; }
    el.className = 'show';
    // A CHECKPOINT RESTORED MID-GRAB brings the hand back HOLDING, because the
    // hand is part of the declared replay state and dropping it would make the
    // continuation differ from the unbroken run. But there is no pointer down any
    // more, so releasing the mouse cannot end it. Say so, rather than leaving a
    // body apparently stuck to nothing.
    const detached = this.grabPointerId === null;
    const gp = this.sim.grabPointWorld(h.entityId, h.localPoint);
    const err = Math.hypot(h.target.x - gp.x, h.target.y - gp.y, h.target.z - gp.z);
    const spark = this.sim.handTickHistory.slice(-60);
    const peak = Math.max(1e-9, ...spark.map((r) => Math.abs(r.forceN)));
    const bars = spark.map((r) => `<i style="height:${Math.max(1, Math.round(26 * Math.abs(r.forceN) / peak))}px"></i>`).join('');
    const note = gainReductionNote(h);
    el.innerHTML =
      `<div class="gline"><span>hand force</span><b>${h.lastForce.toFixed(1)} N</b>`
      + `${h.lastSaturated ? ' <span class="sat">CAP</span>' : ''}</div>`
      + `<div class="gline"><span>hauling</span><span>${h.entityId} · gesture ${h.gestureId}</span></div>`
      + `<div class="gline"><span>lag |target − grab point|</span><span>${err.toFixed(3)} m</span></div>`
      // THE LIVE EFFECTIVE CONTROLLER, always — so no headline anywhere in this UI
      // can contradict what the sim is actually integrating. Equal to the nominal
      // K/C/cap unless the low-m_eff resolution reduction is in force.
      + `<div class="gline"><span>live effective K · C · cap</span><span>${h.kP.toFixed(1)} N/m · `
      + `${h.kD.toFixed(2)} N·s/m · ${h.fMax.toFixed(0)} N${h.gainScale < 1 ? '' : ' (nominal)'}</span></div>`
      + `<div class="gline"><span>work this gesture (external)</span><b>${h.gestureWork >= 0 ? '+' : ''}${h.gestureWork.toFixed(4)} J</b></div>`
      + `<div class="gline"><span>total external hand work</span><span>${this.sim.budget.handWorkExternal >= 0 ? '+' : ''}${this.sim.budget.handWorkExternal.toFixed(4)} J</span></div>`
      + `<div class="sparkwrap">${bars}</div>`
      + (detached
        ? `<div class="pausedtag">HELD BY A RESTORED CHECKPOINT — no pointer is attached, because the hand is part of the
           restored state. Releasing the mouse cannot end this gesture: press <b>Esc</b>, or grab something else.</div>`
        : '')
      + (this.driver.paused
        ? `<div class="pausedtag">PAUSED — the target you see is PENDING. The body has not moved and will not: physics responds on step or resume.</div>`
        : '')
      + (note ? `<div class="sat" style="font-size:11px;margin-top:4px">${note}</div>` : '');
  }

  // -- loop ------------------------------------------------------------------

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;

    this.driver.advance(dt);
    this.frameTimes.push((now - (this.frameTimes.length ? now - dt * 1000 : now)) || dt * 1000);
    this.frameTimes[this.frameTimes.length - 1] = dt * 1000;
    if (this.frameTimes.length > 600) this.frameTimes.shift();
    if (this.driver.stats.ticksThisFrame > 0) {
      this.physicsTimes.push(this.driver.stats.physicsMsThisFrame / this.driver.stats.ticksThisFrame);
      if (this.physicsTimes.length > 600) this.physicsTimes.shift();
    }

    const alpha = this.driver.stats.alpha;
    for (const [id, mesh] of this.meshes) {
      const p = this.driver.interpolated(id, alpha);
      if (!p) continue;
      mesh.position.set(p.t.x, p.t.y, p.t.z);
      mesh.quaternion.set(p.r.x, p.r.y, p.r.z, p.r.w);
    }
    if (this.outline && this.selectedId) {
      const m = this.meshes.get(this.selectedId);
      if (m) { this.outline.position.copy(m.position); this.outline.quaternion.copy(m.quaternion); }
    }
    this.updateSpringLines();
    this.updateJointLines();
    this.updateTrail();
    this.followFallingPair();
    // If anything cleared the grab from underneath the UI — the body was removed,
    // the world was rebuilt, a replay started — let go here too.
    if (!this.sim.hand.active && this.grabPointerId !== null) this.clearGrabUi();
    this.updateHandle();
    this.paintGrabReadout();

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.paintHud();
    if (now - this.lastPanelPaint > 120) { this.lastPanelPaint = now; this.paintPanels(); }
  };

  /**
   * RENDER ONLY. A HINGE draws its arm — the joint anchor to the constrained
   * body's centre. A SLIDER draws its travel axis through the anchor. Neither is
   * a body and neither feeds anything back into the simulation.
   */
  private updateJointLines(): void {
    for (const j of this.sim.jointDescs()) {
      const line = this.jointLines.get(j.id);
      const mark = this.jointMarks.get(j.id);
      if (!line || !mark || !this.sim.entities.has(j.bodyA) || !this.sim.entities.has(j.bodyB)) continue;
      const anchor = this.sim.grabPointWorld(j.bodyA, j.anchorA);
      mark.position.set(anchor.x, anchor.y, anchor.z);
      const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (j.kind === 'hinge' || j.kind === 'ball' || j.kind === 'fixed') {
        // HINGE / BALL / FIXED: draw the arm from the shared anchor to the
        // connected body's centre, so the connection is visible as geometry.
        const b = this.sim.body(j.bodyB).translation();
        pos.setXYZ(0, anchor.x, anchor.y, anchor.z);
        pos.setXYZ(1, b.x, b.y, b.z);
      } else {
        const tip = this.sim.grabPointWorld(j.bodyA, {
          x: j.anchorA.x + j.axis.x, y: j.anchorA.y + j.axis.y, z: j.anchorA.z + j.axis.z,
        });
        const d = { x: tip.x - anchor.x, y: tip.y - anchor.y, z: tip.z - anchor.z };
        const L = 1.55;
        pos.setXYZ(0, anchor.x - d.x * L, anchor.y - d.y * L, anchor.z - d.z * L);
        pos.setXYZ(1, anchor.x + d.x * L, anchor.y + d.y * L, anchor.z + d.z * L);
      }
      pos.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  }

  private updateSpringLines(): void {
    for (const d of this.sim.springDiag) {
      const line = this.springLines.get(d.id);
      if (!line) continue;
      const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const a = d.pointA, b = d.pointB;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      // a perpendicular for the coil wobble
      const ux = -dz / len, uz = dx / len;
      for (let i = 0; i < SPRING_SEGMENTS; i++) {
        const t = i / (SPRING_SEGMENTS - 1);
        const edge = t < 0.08 || t > 0.92 ? 0 : 1;
        const w = 0.055 * edge * Math.sin(t * Math.PI * 2 * 9);
        pos.setXYZ(i, a.x + dx * t + ux * w, a.y + dy * t, a.z + dz * t + uz * w);
      }
      pos.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  }


  // =========================================================================
  // BB1 STAGE ONE — MEASUREMENT, SCENES, GRAVITY.
  //
  // The meters are PURE OBSERVERS. They read the simulation once per public tick
  // and write nothing back, so they are not part of the declared replay state and
  // turning one on cannot change a recorded run.
  // =========================================================================

  /** Sampled after EVERY whole tick, so a catch-up frame does not skip samples. */
  private afterTick = (): void => {
    for (const m of this.meters) m.sample(this.sim);
    this.autoPauseWhenTheDemoIsOver();
  };

  /**
   * DECLARED AUTO-PAUSE, presentation only.
   *
   * FOUND BY LOOKING AT THE SCREEN. Demo 4's pair separates FOREVER — zero gravity
   * means nothing ever brings it back — and demo 5's block runs off the end of a
   * finite ramp and then, at mu = 0, slides along the ground without limit. Left
   * running, both demos end as an empty viewport, which is the same defect class as
   * the blank viewport and demo 1's off-screen shot.
   *
   * So each stops at a DECLARED time, AFTER its declared measurement window, and the
   * HUD says it has. This changes nothing about the physics or the measurement: the
   * ticks that were run are the ticks that were run, and pressing resume or fire
   * again continues normally. It is the fixed-step driver's ordinary pause.
   */
  private static readonly DECLARED_END_S: Record<string, number> = {
    // demo 4: outgoing state is declared at t = 1.00 s; stop at 2.00 s.
    collision: 2.0,
    // demo 5: the OLS window is [0.20, 0.80] s; stop at 1.20 s, before the block
    // reaches the end of the ramp.
    incline: 1.2,
  };

  private autoPausedAt: number | null = null;
  /**
   * What a demo does when it passes its DECLARED END. Peter asked for demos that
   * keep running with an easy restart, so LOOP is the default; PAUSE is the older
   * behaviour and is still one click away. Neither changes any physics: the ticks
   * that ran are the ticks that ran, and a loop is an ordinary rebuild at tick 0.
   */
  private demoEndMode: 'loop' | 'pause' = 'loop';
  private loopCount = 0;

  private autoPauseWhenTheDemoIsOver(): void {
    if (this.authoredScene) return;
    const at = App.DECLARED_END_S[this.sceneId];
    if (at === undefined || this.driver.paused) return;
    if (this.sim.tick / 60 < at) return;
    if (this.demoEndMode === 'loop') {
      this.loopCount++;
      const n = this.loopCount;
      this.restartScene(`looped at the declared t = ${at.toFixed(2)} s (pass ${n + 1})`);
      return;
    }
    this.driver.paused = true;
    this.autoPausedAt = at;
    this.buildControls();
    this.toast(`demo paused at the declared t = ${at.toFixed(2)} s — <b>after</b> its declared measurement window, `
      + `so the result stays on screen. This is presentation only: the physics and the measurement are unchanged, `
      + `and <b>resume</b> continues normally.`, true);
  }

  /**
   * Rebuild the CURRENT scene at tick 0 and run it. This is an ordinary world
   * replacement — the same path the scene picker uses — so the recording, the
   * meters and the energy books all reset together rather than half of them
   * carrying state across the restart.
   */
  restartScene(why = 'restarted at tick 0'): void {
    if (this.authoredScene) { this.startAuthoredRun(); return; }
    if (this.sceneId === 'projectile') { this.launchShot(); return; }
    this.replaceWorld(this.withLiveEnvironment(sceneById(this.sceneId).build()), why);
    this.driver.paused = false;
    this.buildControls();
  }

  private get preset(): ReturnType<typeof sceneById> { return sceneById(this.sceneId); }

  /** RENDER ONLY. A demo you cannot see is not a demo — see scenes.ts. */
  /**
   * RENDER ONLY — demo 6's camera follows the falling pair.
   *
   * Found by looking at the screen, not by any test: demo 6 drops from 50 m and
   * the two balls are 12.7 m apart by t = 2.5 s, so ANY fixed camera close enough
   * to see them at release loses them within a second. This is the same class of
   * defect as the blank viewport and as demo 1's off-screen shot. It tracks the
   * MIDPOINT of the two balls and widens to hold their separation.
   *
   * Presentation only: it reads two positions and writes the camera. Nothing here
   * is read by the simulation, recorded, or compared.
   */
  private followFallingPair(): void {
    if (this.authoredScene) return;
    if (this.sceneId !== 'fall') return;
    if (!this.sim.entities.has('airBall') || !this.sim.entities.has('freeBall')) return;
    const a = this.sim.body('airBall').translation();
    const f = this.sim.body('freeBall').translation();
    const midY = (a.y + f.y) / 2;
    const spread = Math.abs(a.y - f.y);
    // Vertical half-extent the camera must cover, plus margin for the two radii.
    const need = Math.max(6, spread * 0.62 + 2);
    const dist = need / Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.position.set(0, midY + need * 0.10, dist);
    this.controls.target.set(0, midY, 0);
  }

  private frameCamera(): void {
    if (this.authoredScene) {
      const bounds = new THREE.Box3();
      for (const id of this.sim.dynamicIds()) {const p=this.sim.body(id).translation();bounds.expandByPoint(new THREE.Vector3(p.x,p.y,p.z));}
      if (!bounds.isEmpty()) {const center=bounds.getCenter(new THREE.Vector3());const radius=Math.max(3,bounds.getSize(new THREE.Vector3()).length());this.controls.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(radius*1.3,radius, radius*1.5));this.controls.update();return;}
    }
    // Demo 1's framing has to follow the physics: gravity is editable, so the
    // same launch that flies 14 m on Earth flies ~87 m on the Moon. A fixed
    // camera would put the shot off-screen, which is the defect the first
    // on-screen look at this demo actually had.
    if (this.sceneId === 'projectile') {
      const g = Math.max(0.2, this.gMag);
      const a = (this.demo.angleDeg * Math.PI) / 180;
      const vx = PROJECTILE.speed * Math.cos(a), vy = PROJECTILE.speed * Math.sin(a);
      const R = vx * ((2 * vy) / g), Hh = (vy * vy) / (2 * g);
      const cx = PROJECTILE.launch.x + R / 2;
      const cy = PROJECTILE.launch.y + Hh / 2;
      this.camera.position.set(cx, cy + Hh * 0.55, Math.max(R, 4 * Hh) * 1.2 + 3);
      this.controls.target.set(cx, cy, 0);
      this.scene.fog = new THREE.Fog(0x0d1218, Math.max(16, R), Math.max(48, 4 * R));
      this.controls.update();
      return;
    }
    this.scene.fog = new THREE.Fog(0x0d1218, 16, 48);
    const c = this.preset.camera;
    this.camera.position.set(c.pos.x, c.pos.y, c.pos.z);
    this.controls.target.set(c.target.x, c.target.y, c.target.z);
    this.controls.update();
  }

  /**
   * RENDER ONLY: the flown path of demo 1's shot, drawn straight from the two
   * position meters the plot already fills. No second buffer, no simulation
   * coupling — if the measurement is reset the trail resets with it, which is
   * the honest behaviour.
   */
  private updateTrail(): void {
    if (this.authoredScene) { if (this.trailLine) this.trailLine.visible=false; return; }
    const line = this.trailLine;
    if (!line) return;
    if (this.sceneId !== 'projectile' || this.meters.length < 2) { line.visible = false; return; }
    const ys = this.meters[0].samples, xs = this.meters[1].samples;
    const n = Math.min(ys.length, xs.length);
    if (n < 2) { line.visible = false; return; }
    const arr = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { arr[3 * i] = xs[i].value; arr[3 * i + 1] = ys[i].value; arr[3 * i + 2] = 0; }
    line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    line.geometry.setDrawRange(0, n);
    line.geometry.computeBoundingSphere();
    line.visible = true;
  }

  /** g in m/s², magnitude of the current world gravity along -y. */
  private get gMag(): number { return vlenLocal(this.sim.construction.environment.gravity); }

  /**
   * Build the meters this scene needs, WITH the analytic reference each is meant
   * to be compared against. A plot alone is not guided inquiry, so a demo that
   * has a closed form supplies it here and one that does not — the air
   * projectile — supplies `null` and the plot says so on screen.
   */
  private configureMeters(): void {
    if (this.authoredScene) {
      this.refNote = 'Authored experiment; existing model limits apply.';
      const id = this.sim.dynamicIds().includes(this.selectedId ?? '') ? this.selectedId! : this.sim.dynamicIds()[0];
      this.meters = id ? [new Meter('pos.y', {kind:'body', entityId:id}), new Meter('E.total', {kind:'world'})] : [new Meter('E.total', {kind:'world'})];
      for(const e of this.sim.construction.entities)if(e.thermal){this.meters.push(new Meter('thermal.T',{kind:'body',entityId:e.id}),new Meter('thermal.Q',{kind:'body',entityId:e.id}));}
      // BATCH 4 — the two circuit observables, offered only when there IS a circuit.
      if(this.sim.construction.circuit){this.meters.push(new Meter('elec.supplied',{kind:'world'}),new Meter('elec.P',{kind:'world'}));}
      this.plotIndex = 0;
      for (const m of this.meters) m.sample(this.sim);
      return;
    }
    const g = this.gMag;
    const mk = (q: string, ref: MeasureRef): Meter => new Meter(q, ref);
    this.refNote = '';
    switch (this.sceneId) {
      case 'projectile': {
        const a = (this.demo.angleDeg * Math.PI) / 180;
        const vx = PROJECTILE.speed * Math.cos(a), vy = PROJECTILE.speed * Math.sin(a);
        const y = mk('pos.y', { kind: 'body', entityId: 'shot' });
        const x = mk('pos.x', { kind: 'body', entityId: 'shot' });
        const vacuum = this.sim.construction.environment.medium === 'vacuum';
        if (vacuum) {
          // THE REFERENCE IS DRAWN ONLY OVER THE DECLARED FLIGHT INTERVAL. The
          // closed form describes free flight between launch and the COM's return
          // to launch height; after that the shot is in contact with the ground and
          // the parabola describes nothing. Continuing to draw it — and to print a
          // residual against it — would assert a comparison that is not being made.
          const tLand = (2 * vy) / g;
          y.analytic = {
            label: `continuum vacuum parabola  y0 + v_y t − ½ g t²  (v_y = ${vy.toFixed(3)} m/s, g = ${g.toFixed(2)} m/s²),`
              + ` drawn only over the declared flight 0 ≤ t ≤ ${tLand.toFixed(4)} s`,
            at: (t) => (t <= tLand ? PROJECTILE.launch.y + vy * t - 0.5 * g * t * t : NaN),
          };
          x.analytic = {
            label: `x0 + v_x t  (v_x = ${vx.toFixed(3)} m/s), over the declared flight only`,
            at: (t) => (t <= tLand ? PROJECTILE.launch.x + vx * t : NaN),
          };
        }
        this.meters = [y, x, mk('speed', { kind: 'body', entityId: 'shot' })];
        break;
      }
      case 'pendulum': {
        const th0 = (this.demo.amplitudeDeg * Math.PI) / 180;
        const T0 = pendulumSmallAnglePeriod(PENDULUM.L, PENDULUM.r, g);
        const w0 = (2 * Math.PI) / T0;
        const ang = mk('angle', { kind: 'bodyRelativeToPoint', entityId: 'bob', point: PENDULUM.pivot });
        // THE REFERENCE IS THE APPROXIMATION ITSELF. That is the point of demo 2:
        // the residual drawn under the plot IS the failure of the small-angle model.
        ang.analytic = {
          label: `SMALL-ANGLE approximation θ0·cos(ω0 t), T0 = ${T0.toFixed(5)} s — this is the approximation, not the truth`,
          at: (t) => th0 * Math.cos(w0 * t),
        };
        this.meters = [ang, mk('E.total', { kind: 'world' }), mk('E.kinetic', { kind: 'world' })];
        break;
      }
      case 'oscillator': {
        const sp = this.sim.springs[0];
        const m = this.sim.entities.get('cart')?.mass ?? OSCILLATOR.mass;
        const wn = Math.sqrt((sp?.stiffness ?? OSCILLATOR.stiffness) / m);
        const gam = (sp?.damping ?? OSCILLATOR.damping) / m;
        const sig = gam / 2;
        const wd = Math.sqrt(Math.max(0, wn * wn - sig * sig));
        const x0 = this.demo.x0;
        const d = mk('disp.x', { kind: 'body', entityId: 'cart' });
        d.analytic = {
          label: `continuum underdamped x0·e^(−σt)(cos ω_d t + (σ/ω_d) sin ω_d t), σ = ${sig.toFixed(4)} s⁻¹, T_c = ${(2 * Math.PI / wd).toFixed(6)} s`,
          at: (t) => x0 * Math.exp(-sig * t) * (Math.cos(wd * t) + (sig / wd) * Math.sin(wd * t)),
        };
        this.meters = [d, mk('E.total', { kind: 'world' }), mk('E.spring', { kind: 'world' }), mk('E.unattributed', { kind: 'world' })];
        break;
      }
      case 'collision': {
        // The plot's THIRD and FOURTH consumers of the analytic-reference path,
        // and the FIRST of the axis-referenced measurement added for demo 5.
        const o = collisionOutcome(this.demo.restitution);
        const tc = collisionContactTime();
        const origin = { x: 0, y: 0, z: 0 };
        const ax = { x: 1, y: 0, z: 0 };
        const vA = mk('along.vel', { kind: 'bodyAlongAxis', entityId: 'ballA', point: origin, axis: ax });
        const vB = mk('along.vel', { kind: 'bodyAlongAxis', entityId: 'ballB', point: origin, axis: ax });
        const p = mk('p.along', { kind: 'worldAlongAxis', axis: ax });
        vA.analytic = {
          label: `ideal isolated pair at e = ${this.demo.restitution}: ${COLLISION.vA} m/s until the geometric contact `
            + `at t = ${tc.toFixed(4)} s, then ${o.vA1.toFixed(6)} m/s. The step is instantaneous in the model and takes `
            + `one internal sub-step in the engine.`,
          at: (t) => (t < tc ? COLLISION.vA : o.vA1),
        };
        vB.analytic = {
          label: `ideal isolated pair at e = ${this.demo.restitution}: ${COLLISION.vB} m/s until t = ${tc.toFixed(4)} s, `
            + `then ${o.vB1.toFixed(6)} m/s`,
          at: (t) => (t < tc ? COLLISION.vB : o.vB1),
        };
        p.analytic = {
          label: `total momentum is CONSERVED: p = ${o.p.toFixed(7)} kg·m/s, at every tick, because gravity is exactly `
            + `zero and nothing else touches the pair`,
          at: () => o.p,
        };
        this.meters = [p, vA, vB, mk('E.kinetic', { kind: 'world' }), mk('E.unattributed', { kind: 'world' })];
        break;
      }
      case 'incline': {
        // SECOND consumer of the axis-referenced measurement, on a TILTED axis
        // that no world axis could have read.
        const th = (this.demo.inclineDeg * Math.PI) / 180;
        const a = inclineAcceleration(this.demo.inclineDeg, this.demo.mu, g);
        const start = inclineBlockStart(this.demo.inclineDeg);
        const ref: MeasureRef = { kind: 'bodyAlongAxis', entityId: 'block', point: start, axis: inclineDown(th) };
        const sMet = mk('along.disp', ref);
        const vMet = mk('along.vel', ref);
        const model = this.demo.mu > 0
          ? `Coulomb MODEL a = g(sin θ − μ cos θ) = ${a.toFixed(6)} m/s²`
          : `FRICTIONLESS a = g sin θ = ${a.toFixed(6)} m/s²`;
        sMet.analytic = {
          label: `${model}; this scheme's exact map s = ½ a (t² + h·t)`,
          at: (t) => 0.5 * a * (t * t + this.sim.hSub * t),
        };
        vMet.analytic = { label: `${model}; v = a·t, EXACT in this scheme at sub-step boundaries`, at: (t) => a * t };
        this.meters = [sMet, vMet, mk('E.total', { kind: 'world' }), mk('E.unattributed', { kind: 'world' })];
        break;
      }
      case 'fall': {
        // REUSES the already-validated drag work. Nothing here revalidates it.
        const k = dragK({ kind: 'sphere', radius: FALL.radius }, undefined, this.sim.construction.environment.medium === 'air' ? SI.RHO_AIR : SI.RHO_VACUUM);
        const vT = terminalSpeed(FALL.mass, k, g);
        const tau = vT / g;
        const yA = mk('pos.y', { kind: 'body', entityId: 'airBall' });
        const yF = mk('pos.y', { kind: 'body', entityId: 'freeBall' });
        yF.analytic = {
          label: `DRAG-FREE (authored C_d = 0): y0 − ½ g (t² + h·t), this scheme's exact map`,
          at: (t) => FALL.releaseY - 0.5 * g * (t * t + this.sim.hSub * t),
        };
        yA.analytic = Number.isFinite(vT)
          ? {
            label: `quadratic drag, the ALREADY-VALIDATED closed form: y0 − (v_t²/g)·ln cosh(t/τ), `
              + `v_t = ${vT.toFixed(5)} m/s, τ = ${tau.toFixed(5)} s (EXPECTATIONS.md §A)`,
            at: (t) => FALL.releaseY - (vT * vT / g) * Math.log(Math.cosh(t / tau)),
          }
          : { label: 'vacuum: no drag on either body, so both follow the drag-free map', at: (t) => FALL.releaseY - 0.5 * g * (t * t + this.sim.hSub * t) };
        this.meters = [yA, yF, mk('vel.y', { kind: 'body', entityId: 'airBall' }), mk('vel.y', { kind: 'body', entityId: 'freeBall' })];
        break;
      }
      default:
        this.meters = [
          mk('pos.y', { kind: 'body', entityId: 'platform' }),
          mk('E.total', { kind: 'world' }),
          mk('E.unattributed', { kind: 'world' }),
        ];
    }
    this.plotIndex = Math.min(this.plotIndex, this.meters.length - 1);
    for (const m of this.meters) m.sample(this.sim);
  }

  /**
   * REPLACE THE WORLD WITH `c`, AND SETTLE THE RECORDING COHERENTLY.
   *
   * The mode is decided by comparing `c` against the construction the live
   * recording actually replays against: byte-identical is a `reset` (the history
   * rebases to tick 0 with the world), anything else is a `load` (the recording
   * is TERMINATED and says why). That is the existing `worldReplaced` boundary —
   * the selector does not get its own private lifecycle.
   */
  private replaceWorld(c: ReturnType<typeof defaultConstruction>, why: string): void {
    this.clearGrabUi();
    this.autoPausedAt = null;
    const same = this.recorder.base !== null
      && JSON.stringify(this.recorder.base) === JSON.stringify(c);
    this.sim.build(c);
    this.author.replace(c);
    this.runEvents = [];
    const lc = worldReplaced(this.recorder, same ? 'reset' : 'load', c);
    this.pending = lc.pending;
    this.driver = new FixedStepDriver(this.sim, this.beforeTick, this.afterTick);
    this.driver.paused = this.preset.startPaused;
    this.selectedId = this.sim.entities.has('platform') ? 'platform' : (this.sim.dynamicIds()[0] ?? null);
    this.selectedSpring = this.sim.springs[0]?.id ?? null;
    this.configureMeters();
    this.frameCamera();
    this.rebuildSceneGraph();
    this.paintInstruction();
    this.buildControls();
    this.paintPanels();
    this.toast(`${why} — ${lc.note}${this.driver.paused ? ' · <b>PAUSED at tick 0</b>: the declared initial condition is on screen, at rest' : ''}`, true);
  }

  /**
   * CARRY THE LIVE ENVIRONMENT ONTO A RE-ARMED SCENE.
   *
   * Found by looking at the screen, not by any test: setting gravity to the Moon
   * and then pressing LAUNCH silently put it back to 9.81, because launch rebuilds
   * the scene and the preset's authored environment is Earth. Re-arming the SAME
   * scene must keep what the user set; choosing a DIFFERENT scene from the
   * selector still resets to that preset's authored environment, which is what
   * picking a preset means.
   */
  private withLiveEnvironment(c: ReturnType<typeof defaultConstruction>): ReturnType<typeof defaultConstruction> {
    const env = this.sim.construction?.environment;
    if (env) c.environment = { medium: env.medium, gravity: { ...env.gravity } };
    return c;
  }

  /** The construction the current scene + its current parameters describe. */
  private currentSceneConstruction(): ReturnType<typeof defaultConstruction> {
    if (this.authoredScene) return this.author.authored;
    switch (this.sceneId) {
      case 'projectile': return this.withLiveEnvironment(projectileScene());
      case 'pendulum': return this.withLiveEnvironment(pendulumScene(this.demo.amplitudeDeg));
      case 'oscillator': return this.withLiveEnvironment(oscillatorScene(this.demo.x0));
      // DEMO 4 does NOT take the live gravity. Zero gravity is a DECLARED part of
      // its fixture, not a convenience: the exact-momentum claim is made for an
      // isolated pair, and carrying an edited g onto it would quietly break the
      // very condition the demo asserts.
      case 'collision': return collisionScene(this.demo.restitution);
      case 'incline': return this.withLiveEnvironment(inclineScene(this.demo.inclineDeg, this.demo.mu));
      case 'fall': return this.withLiveEnvironment(fallScene(this.sim.construction.environment.medium));
      default: return this.preset.build();
    }
  }

  selectScene(id: string): void {
    this.authoredScene = false; this.editing = false;
    this.sceneId = id;
    this.replaceWorld(sceneById(id).build(), `scene → ${sceneById(id).label}`);
  }

  /**
   * DEMO 1's launch. Rebuild at tick 0 so the declared initial condition is exact,
   * then apply the launch IMPULSE as an ordinary recorded intervention, then run.
   */
  private launchShot(): void {
    const medium = this.sim.construction.environment.medium;
    const g = vlenLocal(this.sim.construction.environment.gravity);
    this.replaceWorld(this.withLiveEnvironment(projectileScene()), `demo 1 armed at ${this.demo.angleDeg}° in g = ${g.toFixed(2)} m/s²`);
    const J = launchImpulse(this.demo.angleDeg);
    this.fire((t, s2) => ({ tick: t, seq: s2, wallClockMs: Date.now(), kind: 'push', target: 'shot', impulse: J }));
    for (const m of this.meters) { m.reset(); m.sample(this.sim); }
    this.driver.paused = false;
    this.buildControls();
    this.toast(`launched: impulse (${J.x.toFixed(3)}, ${J.y.toFixed(3)}, 0) N·s = m·v0 at ${this.demo.angleDeg}°, `
      + `${PROJECTILE.speed} m/s in <b>${medium}</b>, g = ${g.toFixed(2)} m/s². `
      + `Landing is declared as the COM returning to y = ${PROJECTILE.launch.y} m.`, true);
  }

  private releaseAt(): void {
    if (this.sceneId === 'pendulum') {
      this.replaceWorld(this.withLiveEnvironment(pendulumScene(this.demo.amplitudeDeg)),
        `demo 2 released from ${this.demo.amplitudeDeg}° in g = ${this.gMag.toFixed(2)} m/s²`);
    } else if (this.sceneId === 'oscillator') {
      this.replaceWorld(this.withLiveEnvironment(oscillatorScene(this.demo.x0)),
        `demo 3 released at x0 = ${this.demo.x0} m`);
    } else if (this.sceneId === 'collision') {
      this.replaceWorld(collisionScene(this.demo.restitution),
        `demo 4 fired at e = ${this.demo.restitution} in ZERO gravity (a declared part of the fixture)`);
      this.startAfterRebuild();
    } else if (this.sceneId === 'incline') {
      this.replaceWorld(this.withLiveEnvironment(inclineScene(this.demo.inclineDeg, this.demo.mu)),
        `demo 5 released at θ = ${this.demo.inclineDeg}°, μ = ${this.demo.mu}`);
      this.startAfterRebuild();
    } else if (this.sceneId === 'fall') {
      this.replaceWorld(this.withLiveEnvironment(fallScene(this.sim.construction.environment.medium)),
        `demo 6 released in ${this.sim.construction.environment.medium}`);
      this.startAfterRebuild();
    }
  }

  /**
   * Demos 4, 5 and 6 START PAUSED so the declared initial condition is what you
   * first see — the same reason demo 1 does. Their fire/release button therefore
   * has to let time run again after the rebuild, or pressing it would look broken.
   */
  private startAfterRebuild(): void {
    for (const m of this.meters) { m.reset(); m.sample(this.sim); }
    this.driver.paused = false;
    this.buildControls();
  }

  private setGravityUi(gy: number, label: string): void {
    this.fire((t, s2) => ({ tick: t, seq: s2, wallClockMs: Date.now(), kind: 'setGravity', target: 'world', gravity: { x: 0, y: -gy, z: 0 } }));
    // THE ANALYTIC REFERENCE WAS COMPUTED FOR THE OLD g. Dropping it and saying so
    // is the honest move; redrawing it would assert a comparison that no longer holds.
    if (this.sim.tick > 0) {
      for (const m of this.meters) m.analytic = null;
      this.refNote = `analytic reference withdrawn: gravity was edited at tick ${this.sim.tick}, mid-run. `
        + `Re-release the demo to get a reference computed for g = ${gy.toFixed(2)} m/s².`;
    } else {
      this.configureMeters();
    }
    this.buildControls();
    this.paintPanels();
    this.toast(`gravity → ${label} (g = ${gy.toFixed(2)} m/s²). The potential-energy datum is the world origin and `
      + `<b>does not move with g</b>, so ΔPE is booked to this intervention — see the energy panel.`, true);
  }

  /**
   * THE LIVE COMPARISON each demo exists to make. Measured against the analytic
   * reference, on screen, with the finite-step term named — not a bare plot.
   */
  private demoFacts(): string {
    if (this.authoredScene) {
      // THE REQUIRED DISCLOSURE also rides the run-mode readout, so it is present
      // beside the measurement a user would actually read a trajectory off.
      return '<div class="demofacts">Authored experiment: no new fidelity claim. Passive spring and hinge limits still apply.'
        + (hasExperimentalConnection(this.sim.jointDescs())
          ? `<div class="disclosure" role="note">${CONNECTION_DISCLOSURE_FULL}</div>` : '')
        + '</div>';
    }
    const g = this.gMag;
    // THE LIVE INTERNAL SUB-STEP, not the module constant: this scene may declare
    // a finer fixed profile, and a panel quoting 1/240 s while the world integrates
    // at 1/7680 s would be describing a different simulation from the one running.
    const h = this.sim.hSub;
    if (this.sceneId === 'projectile') {
      const y = this.meters[0], x = this.meters[1];
      const a = (this.demo.angleDeg * Math.PI) / 180;
      const vx = PROJECTILE.speed * Math.cos(a), vy = PROJECTILE.speed * Math.sin(a);
      const Tc = (2 * vy) / g, Rc = vx * Tc;
      const vac = this.sim.construction.environment.medium === 'vacuum';
      const t = crossingQuadratic(y.samples, PROJECTILE.launch.y, 0.1);
      let measured = '<b>in flight…</b> land it to compare.';
      if (t !== null) {
        const r = lerpAt(x.samples, t) - PROJECTILE.launch.x;
        measured = vac
          ? `flight <b>${t.toFixed(6)} s</b>, range <b>${r.toFixed(5)} m</b><br>`
            + `continuum R_c = ${Rc.toFixed(5)} m → <b>${(100 * (r / Rc - 1)).toFixed(4)} %</b>; `
            + `this scheme predicts R_c − v_x·h = ${(Rc - vx * h).toFixed(5)} m → ${(100 * (r / (Rc - vx * h) - 1)).toFixed(4)} %`
          : `flight <b>${t.toFixed(6)} s</b>, range <b>${r.toFixed(5)} m</b> in <b>AIR</b>. `
            + `<span class="bad">No closed form is claimed for this case.</span> The only comparison offered is `
            + `numerical: the vacuum range under the same launch is ${Rc.toFixed(5)} m (continuum), a deficit of `
            + `${(100 * (1 - r / Rc)).toFixed(2)} % against a reference that does <b>not</b> describe the air trajectory.`;
      }
      return `<div class="demofacts"><b>Demo 1 — declared conditions.</b> Launch: COM at y = ${PROJECTILE.launch.y} m, `
        + `|v0| = ${PROJECTILE.speed} m/s at ${this.demo.angleDeg}°. Landing: <b>COM returns to y = ${PROJECTILE.launch.y} m</b>, `
        + `not ground contact. Free flight, no contact.<br>${measured}<br>`
        + (vac
          ? `<span class="dim">The −v_x·h term is derived, not fitted: semi-implicit Euler puts the discrete trajectory at `
            + `y0 + v_y t − ½g(t² + h·t), so the flight is exactly one internal sub-step (h = ${(1000 * h).toFixed(3)} ms) short.</span>`
          : `<span class="dim">In air the trajectory comes from the build's <b>provisional</b> quadratic drag law — an `
            + `orientation-averaged effective area, no lift, no angular drag (drag.ts). There is no closed-form `
            + `trajectory for it and none is asserted; the plot draws <b>no reference line</b> in air.</span>`)
        + `</div>`;
    }
    if (this.sceneId === 'pendulum') {
      const ang = this.meters[0];
      const th0 = (this.demo.amplitudeDeg * Math.PI) / 180;
      const T0 = pendulumSmallAnglePeriod(PENDULUM.L, PENDULUM.r, g);
      const Tex = pendulumExactPeriod(th0, T0);
      const zeros: number[] = [];
      let after = -Infinity;
      for (;;) { const z = crossingLinear(ang.samples, 0, after); if (z === null || zeros.length > 13) break; zeros.push(z); after = z + 1e-6; }
      const n = Math.floor((zeros.length - 1) / 2);
      const Tm = n >= 1 ? (zeros[2 * n] - zeros[0]) / n : NaN;
      const pk = peaks(ang.samples, 1);
      const drift = pk.length >= 2 ? pk[pk.length - 1].value / pk[0].value - 1 : NaN;
      const meas = Number.isFinite(Tm)
        ? `measured period <b>${Tm.toFixed(6)} s</b> over ${n} whole period${n === 1 ? '' : 's'}<br>`
          + `vs small-angle T0 = ${T0.toFixed(6)} s → <b>${(100 * (Tm / T0 - 1)).toFixed(3)} %</b><br>`
          + `vs EXACT rigid-pendulum T(θ0) = ${Tex.toFixed(6)} s → <b>${(100 * (Tm / Tex - 1)).toFixed(3)} %</b><br>`
          + `amplitude drift so far ${(100 * drift).toFixed(3)} %`
        : 'swinging — the first period is still being measured.';
      const M = this.sim.subSteps;
      const profile = `<br><span class="good">DECLARED NUMERICAL PROFILE: ${M} internal sub-steps of `
        + `${(1000 * h).toFixed(4)} ms.</span> The public tick is still 1/60 s and inputs are still keyed by `
        + `(tick, seq); only this scene declares a finer fixed sub-division, and it is recorded in the `
        + `construction, in checkpoints and in the canonical replay comparison. A construction that declares `
        + `none means the legacy 4, so old recordings keep their old configuration.`;
      const retained = `<br><span class="bad">RETAINED RED (C2.2 / C2.3, DEVIATIONS D-29), at the LEGACY 4 `
        + `sub-steps.</span> At that profile the measured period was <b>not</b> within the predicted 1.0 % of the `
        + `exact reference: <b>−4.07 % at 90°, −11.73 % at 120°</b>. That case is still in the test suite and still `
        + `<b>failing</b>. <b>The tolerance was not widened, the amplitude range was not shrunk and no case was `
        + `deleted</b> — the implementation was corrected by declaring a finer fixed profile, and the `
        + `pre-correction result was kept.`;
      const energy = `<br><span class="unattr">AND PERIOD ACCURACY IS NOT ENERGY CONSERVATION.</span> `
        + `With <b>zero gravity and no torque of any kind</b> this same hinge still loses kinetic energy: `
        + `−59.7 % over 11 s at M = 4, <b>−4.42 % over 11 s at M = ${PENDULUM_PROFILE.substeps}</b>. `
        + `Refinement shrinks it but does <b>not</b> literally halve it — the successive log-decrement ratios `
        + `measured over M = 4→8→16→32→64→128 are 0.610, 0.569, 0.539, 0.521, 0.510, approaching ½ from above `
        + `rather than reaching it, so <b>no asymptotic rate is claimed</b>. The 11 s window is finite and bounds `
        + `nothing beyond itself. Every joule of that deficit sits in <b>UNATTRIBUTED</b>; none of it is called `
        + `heat. <b>This adapter is not energy-conserving and is not described as one.</b>`;
      return `<div class="demofacts"><b>Demo 2 — the approximation is the dashed line.</b> `
        + `Physical (not point-mass) pendulum: I_pivot = ⅖mr² + mL², T0 = 2π√((0.4r² + L²)/(gL)).<br>${meas}`
        + `<br><span class="dim">Exact T(θ0) = T0·(2/π)·K(sin(θ0/2)) — at ${this.demo.amplitudeDeg}° the small-angle `
        + `constant is off by ${(100 * (Tex / T0 - 1)).toFixed(3)} %. Push the amplitude up and watch the residual under `
        + `the plot grow: that residual IS the approximation failing.</span>${profile}${retained}${energy}</div>`;
    }
    if (this.sceneId === 'oscillator') {
      const d = this.meters[0];
      const sp = this.sim.springs[0];
      const m = this.sim.entities.get('cart')?.mass ?? OSCILLATOR.mass;
      const wn = Math.sqrt(sp.stiffness / m), gam = sp.damping / m;
      const dm = discreteOscillator(wn, gam, h);
      const Tc = (2 * Math.PI) / Math.sqrt(wn * wn - (gam / 2) ** 2);
      const pos = peaks(d.samples, 1);
      const gaps: number[] = [];
      for (let i = 1; i < pos.length; i++) gaps.push(pos[i].t - pos[i - 1].t);
      const Tm = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : NaN;
      const all = [...pos, ...peaks(d.samples, -1)].sort((a, b) => a.t - b.t);
      const sig = all.length >= 3 ? -olsSlope(all.map((q) => q.t), all.map((q) => Math.log(Math.abs(q.value)))) : NaN;
      const b = this.sim.budget;
      const owned = b.dissipatedDrag + b.dissipatedSpringDamper;
      const meas = Number.isFinite(Tm)
        ? `measured period <b>${Tm.toFixed(6)} s</b> over ${gaps.length} peak gap${gaps.length === 1 ? '' : 's'}; `
          + `continuum T_c = ${Tc.toFixed(6)} s → ${(100 * (Tm / Tc - 1)).toFixed(4)} %; `
          + `<b>this scheme's discrete map T_num = ${dm.period.toFixed(6)} s → ${(100 * (Tm / dm.period - 1)).toFixed(4)} %</b><br>`
          + `measured decay σ = <b>${sig.toFixed(6)} s⁻¹</b>; continuum ${(gam / 2).toFixed(6)}; derived σ_num = ${dm.sigma.toFixed(6)}`
        : 'oscillating — the first two peaks are still being measured.';
      return `<div class="demofacts"><b>Demo 3 — the CORRECTED spring model (D-8), on a slider.</b> `
        + `k = ${sp.stiffness} N/m, c = ${sp.damping} N·s/m, m = ${m.toFixed(3)} kg → ω_n = ${wn.toFixed(4)} rad/s, γ = ${gam.toFixed(4)} s⁻¹. `
        + `One sub-step determinant is exactly 1 − hγ = ${dm.det.toFixed(9)}, independent of stiffness.<br>${meas}<br>`
        + `<span class="good">owned dissipation ${owned.toFixed(5)} J</span> (our damper only; vacuum, so no drag) · `
        + `<span class="unattr">UNATTRIBUTED ${b.unattributed.toFixed(6)} J</span> = `
        + `${owned > 0 ? (100 * Math.abs(b.unattributed) / owned).toFixed(3) : '—'} % of owned.<br>`
        + `<span class="dim">The SLIDER's constraint work is <b>not decomposed</b> and <b>not turned into heat</b>: whatever it `
        + `does is inside UNATTRIBUTED with everything else this build cannot attribute.</span></div>`;
    }
    if (this.sceneId === 'collision') {
      const e = this.demo.restitution;
      const o = collisionOutcome(e);
      const p = this.meters[0], vA = this.meters[1], vB = this.meters[2];
      const tc = collisionContactTime();
      const last = <T,>(a: T[]): T | undefined => a[a.length - 1];
      let worstP = 0;
      for (const q of p.samples) worstP = Math.max(worstP, Math.abs(q.value - o.p));
      const t = this.sim.tick / 60;
      const a1 = last(vA.samples)?.value ?? NaN, b1 = last(vB.samples)?.value ?? NaN;
      const done = t > tc + 0.2;
      const eMeas = done ? -(b1 - a1) / (COLLISION.vB - COLLISION.vA) : NaN;
      const ke0 = 0.5 * COLLISION.massA * COLLISION.vA ** 2 + 0.5 * COLLISION.massB * COLLISION.vB ** 2;
      const ke1 = 0.5 * COLLISION.massA * a1 * a1 + 0.5 * COLLISION.massB * b1 * b1;
      const b = this.sim.budget;
      const meas = done
        ? `outgoing <b>${a1.toFixed(6)}</b> and <b>${b1.toFixed(6)}</b> m/s; reference `
          + `${o.vA1.toFixed(6)} and ${o.vB1.toFixed(6)} → ${(100 * (a1 / o.vA1 - 1)).toFixed(3)} % and `
          + `${(100 * (b1 / o.vB1 - 1)).toFixed(3)} %<br>`
          + `measured restitution <b>e = ${eMeas.toFixed(6)}</b> against the authored ${e}<br>`
          + `kinetic energy ${ke0.toFixed(5)} → <b>${ke1.toFixed(5)} J</b>, ratio ${(ke1 / ke0).toFixed(6)}; `
          + `reference ratio ${(o.ke1 / o.ke0).toFixed(7)}`
        : `<b>closing…</b> geometric contact at t = ${tc.toFixed(4)} s (gap ${(2 * COLLISION.x0 - 2 * COLLISION.radius).toFixed(2)} m `
          + `÷ closing speed ${(COLLISION.vA - COLLISION.vB).toFixed(1)} m/s).`;
      return `<div class="demofacts"><b>Demo 4 — a controlled ISOLATED PAIR, not a cradle.</b> `
        + `m = ${COLLISION.massA} and ${COLLISION.massB} kg, v = ${COLLISION.vA} and ${COLLISION.vB} m/s, `
        + `<b>gravity exactly zero</b> — declared, so total momentum is conserved at <b>every</b> tick and not merely `
        + `across the impact. Measurement times are declared: incoming at t = 0.25 s, outgoing at t = 1.00 s.<br>${meas}<br>`
        + `<span class="good">momentum p<sub>x</sub> = ${o.p.toFixed(7)} kg·m/s; worst deviation so far `
        + `${worstP.toExponential(3)} kg·m/s</span> (tolerance 1e-4, and it is a derivation: the solver applies equal `
        + `and opposite impulses, so only the f32 round trip of mass and velocity can move it)<br>`
        + `<span class="dim">Split of the energy: <b>${o.keCm.toFixed(5)} J</b> lives in the centre-of-mass frame and is `
        + `what restitution can destroy; <b>${o.keCom.toFixed(6)} J</b> rides with the centre of mass and is untouchable. `
        + `KE after = e²·${o.keCm.toFixed(4)} + ${o.keCom.toFixed(4)}.</span><br>`
        + `<span class="unattr">UNATTRIBUTED ${b.unattributed.toFixed(6)} J</span> · `
        + `<span class="good">owned dissipation ${(b.dissipatedDrag + b.dissipatedSpringDamper).toFixed(6)} J</span><br>`
        + `<span class="dim">At e &lt; 1 the loss is a <b>real, physical</b> inelastic loss — but this build owns no `
        + `contact-dissipation channel and does not estimate one, so it stays in UNATTRIBUTED. <b>It is not booked as `
        + `owned dissipation and it is not called heat.</b> Rapier's coefficient combine rule is Average and both `
        + `colliders are authored equal, so the pair coefficient is e under Average, Min and Max alike.</span></div>`;
    }
    if (this.sceneId === 'incline') {
      const deg = this.demo.inclineDeg, mu = this.demo.mu;
      const aModel = inclineAcceleration(deg, mu, g);
      const aFree = inclineAcceleration(deg, 0, g);
      const stat = inclineIsStatic(deg, mu);
      const sMet = this.meters[0], vMet = this.meters[1];
      const win = vMet.samples.filter((q) => q.t >= 0.20 && q.t <= 0.80);
      const aMeas = win.length >= 8 ? olsSlope(win.map((q) => q.t), win.map((q) => q.value)) : NaN;
      const sNow = sMet.samples[sMet.samples.length - 1]?.value ?? 0;
      const meas = stat
        ? `<b>tan θ = ${Math.tan((deg * Math.PI) / 180).toFixed(6)} ≤ μ = ${mu}</b>, so the model says it does not slide. `
          + `Displacement so far <b>${sNow.toExponential(3)} m</b>.`
        : Number.isFinite(aMeas)
          ? `measured along-slope acceleration <b>${aMeas.toFixed(6)} m/s²</b> by least squares on v(t) over `
            + `[0.20, 0.80] s; model <b>${aModel.toFixed(6)}</b> → <b>${(100 * (aMeas / aModel - 1)).toFixed(3)} %</b>. `
            + `Displacement ${sNow.toFixed(5)} m.`
          : `<b>sliding…</b> the [0.20, 0.80] s window is still filling.`;
      return `<div class="demofacts"><b>Demo 5 — the FRICTIONLESS reference comes first.</b> `
        + `θ = ${deg}°, so <b>a = g·sin θ = ${aFree.toFixed(6)} m/s²</b> with no friction at all. The dashed line is `
        + `this scheme's exact map s = ½a(t² + h·t); v = a·t is exact at sub-step boundaries, so the velocity `
        + `comparison is a <b>continuum</b> one with no discrete correction to apply.<br>${meas}<br>`
        + (mu > 0
          ? `<span class="dim"><b>Friction is the MODEL a = g(sin θ − μ cos θ), while sliding.</b> The ENGINE assumption, `
            + `stated: Rapier clamps the tangential impulse at each contact point to the cone |λ_t| ≤ μ·λ_n and solves it `
            + `by projected Gauss–Seidel at <b>one</b> velocity iteration; the pair coefficient is Rapier's default `
            + `<b>Average</b> combine of the two colliders', both authored equal. Rapier has <b>no separate static `
            + `coefficient</b>, so μ_s = μ_k here and no stick–slip distinction is claimed.</span><br>`
            + `<span class="bad">NOT CLAIMED: an angle of repose.</span> μ is a <b>generic mechanical coefficient</b>, not `
            + `a property of any named material. Friction depends on the <b>pair</b> and on conditions, and one generic `
            + `coefficient does not determine a material. The sliding/static transition here is only <b>bracketed</b> `
            + `(it slides at 25° and not at 15°, at the same μ = 0.30) and is deliberately <b>not resolved to an angle</b>.`
          : `<span class="dim">μ = 0 on <b>both</b> colliders, so the pair coefficient is zero under any combine rule. `
            + `Raise μ below to add friction — and read what is and is not claimed about it when you do.</span>`)
        + `</div>`;
    }
    if (this.sceneId === 'fall') {
      const air = this.sim.construction.environment.medium === 'air';
      const k = dragK({ kind: 'sphere', radius: FALL.radius }, undefined, air ? SI.RHO_AIR : SI.RHO_VACUUM);
      const vT = terminalSpeed(FALL.mass, k, g);
      const tau = vT / g;
      const yA = this.meters[0], yF = this.meters[1];
      const t = this.sim.tick / 60;
      const dA = FALL.releaseY - (yA.samples[yA.samples.length - 1]?.value ?? FALL.releaseY);
      const dF = FALL.releaseY - (yF.samples[yF.samples.length - 1]?.value ?? FALL.releaseY);
      const wantA = air ? (vT * vT / g) * Math.log(Math.cosh(t / tau)) : 0.5 * g * (t * t + h * t);
      const wantF = 0.5 * g * (t * t + h * t);
      const meas = t > 0.2
        ? `at t = ${t.toFixed(3)} s: air ball has fallen <b>${dA.toFixed(5)} m</b> (reference ${wantA.toFixed(5)}, `
          + `${(100 * (dA / wantA - 1)).toFixed(3)} %); drag-free ball <b>${dF.toFixed(5)} m</b> `
          + `(reference ${wantF.toFixed(5)}, ${(100 * (dF / wantF - 1)).toFixed(3)} %)<br>`
          + `<b>separation ${(dF - dA).toFixed(5)} m</b>, drop ratio ${dA > 0 ? (dF / dA).toFixed(4) : '—'}`
        : '<b>falling…</b>';
      return `<div class="demofacts"><b>Demo 6 — one authored number is the only difference.</b> `
        + `Two identical spheres, r = ${FALL.radius} m, m = ${FALL.mass} kg, released together from `
        + `y = ${FALL.releaseY} m. The right one carries an authored <b>C_d = 0</b>, so its drag force is identically `
        + `zero: a <b>drag-free body in ${air ? 'an air' : 'a vacuum'} world</b>, not a second vacuum.<br>${meas}<br>`
        + (air
          ? `<span class="dim">Air reference: v_t = √(mg/k) = <b>${vT.toFixed(5)} m/s</b>, τ = v_t/g = ${tau.toFixed(5)} s, `
            + `y = y0 − (v_t²/g)·ln cosh(t/τ). k = ½ρC_dA_eff = ${k.toExponential(4)} kg/m with the orientation-averaged `
            + `A_eff = πr² (Cauchy S/4). <b>This drag law is not revalidated here</b> — it is the already-accepted `
            + `A0–A5 work in EXPECTATIONS.md, reused unchanged. Demo 6 only exposes the comparison.</span><br>`
            + `<span class="good">owned dissipation booked as drag work: ${this.sim.budget.dissipatedDrag.toFixed(5)} J</span> `
            + `— by the existing accounting path, and nothing else is called heat.`
          : `<span class="good">In vacuum the two balls fall <b>identically</b>.</span> That is the discriminating check: `
            + `the drag term is the <b>only</b> difference between them, and with ρ = 0 there is no drag on either. `
            + `Switch back to air to separate them.`)
        + `</div>`;
    }
    return '';
  }

  /** The one control each demo actually needs. Deliberately per-scene, not generic. */
  private sceneControls(): string {
    if (this.authoredScene) return '<p>Your authored starting scene. Use Edit starting scene to change the experiment.</p>';
    if (this.sceneId === 'projectile') {
      return `<div class="grp"><label>demo 1 — launch</label>
        <label class="vh" for="i-angle">launch angle in degrees</label>
        <input type="number" id="i-angle" aria-label="launch angle in degrees" title="launch angle in degrees"
          step="5" min="1" max="89" value="${this.demo.angleDeg}" />
        <button id="b-launch">launch at ${PROJECTILE.speed} m/s</button>
        <div class="legend">Launch rebuilds the scene at tick 0 and applies an <b>impulse</b> J = m·v0 as an
          ordinary recorded intervention. Landing is declared as the <b>centre of mass returning to
          y = ${PROJECTILE.launch.y} m</b>, not ground contact. Switch <b>air</b> on below to see the
          <b>numerical</b> comparison — the closed form is <b>not</b> claimed for air.</div>
      </div>`;
    }
    if (this.sceneId === 'pendulum') {
      return `<div class="grp"><label>demo 2 — release amplitude</label>
        <label class="vh" for="i-amp">release amplitude in degrees</label>
        <input type="number" id="i-amp" aria-label="release amplitude in degrees" title="release amplitude in degrees"
          step="5" min="1" max="170" value="${this.demo.amplitudeDeg}" />
        <button id="b-release">release from ${this.demo.amplitudeDeg}°</button>
        <div class="legend">Try 3°, then 30°, then 90°. The dashed reference is the <b>small-angle</b>
          approximation; the residual printed under the plot is that approximation failing.
          <b>At 90° and above this build's own measured period is a RETAINED RED</b> — see the panel below.</div>
      </div>`;
    }
    if (this.sceneId === 'oscillator') {
      return `<div class="grp"><label>demo 3 — release displacement</label>
        <label class="vh" for="i-x0">release displacement in metres</label>
        <input type="number" id="i-x0" aria-label="release displacement in metres" title="release displacement in metres"
          step="0.05" min="-0.9" max="0.9" value="${this.demo.x0}" />
        <button id="b-release">release at x0</button>
        <div class="legend">The cart is confined to one axis by a <b>SLIDER</b>, so gravity is carried by the
          constraint and the only owned dissipation is our own spring damper. The spring is the
          <b>corrected</b> model of D-8, not a joint motor.</div>
      </div>`;
    }
    if (this.sceneId === 'collision') {
      return `<div class="grp"><label>demo 4 — restitution of the pair</label>
        <label class="vh" for="i-e">coefficient of restitution</label>
        <input type="number" id="i-e" aria-label="coefficient of restitution" title="coefficient of restitution"
          step="0.1" min="0" max="1" value="${this.demo.restitution}" />
        <button id="b-release">fire at e = ${this.demo.restitution}</button>
        <div class="legend">Try <b>e = 1</b> (kinetic energy comes back), then <b>0.6</b>, then <b>0</b> (they move off
          together at the centre-of-mass speed). Gravity is <b>exactly zero</b> and that is part of the fixture, not a
          convenience — firing always rebuilds at g = 0, so the isolated-pair momentum claim cannot be quietly broken
          by a gravity edit. Both colliders carry the <b>same</b> e, so Rapier's Average combine rule returns e.</div>
      </div>`;
    }
    if (this.sceneId === 'incline') {
      return `<div class="grp"><label>demo 5 — ramp angle and friction</label>
        <label class="vh" for="i-theta">ramp angle in degrees</label>
        <input type="number" id="i-theta" aria-label="ramp angle in degrees" title="ramp angle in degrees"
          step="5" min="5" max="60" value="${this.demo.inclineDeg}" />
        <label class="vh" for="i-mu">friction coefficient</label>
        <input type="number" id="i-mu" aria-label="friction coefficient" title="friction coefficient"
          step="0.05" min="0" max="1.5" value="${this.demo.mu}" />
        <button id="b-release">release at ${this.demo.inclineDeg}°, μ = ${this.demo.mu}</button>
        <div class="legend"><b>Start at μ = 0.</b> That is the reference this demo is built on: a = g·sin θ, with no
          contact model in the claim beyond "the plane holds it". Then add μ and read the panel: the Coulomb model and
          the <b>engine's</b> friction assumption are both named there, and <b>no angle of repose is claimed</b>.</div>
      </div>`;
    }
    if (this.sceneId === 'fall') {
      return `<div class="grp"><label>demo 6 — drop again</label>
        <button id="b-release">release both from ${FALL.releaseY} m</button>
        <div class="legend">Switch the medium below between <b>air</b> and <b>vacuum</b>. In vacuum the two balls fall
          together — that is the check that the authored <b>C_d = 0</b> on the right ball is the <b>only</b> difference
          between them. The drag law itself is the one already validated in <b>EXPECTATIONS.md §A</b>; this demo does
          not revalidate it, it makes it visible.</div>
      </div>`;
    }
    return '';
  }

  private renderMeasurement(): string {
    const m = this.meters[this.plotIndex];
    if (!m) return '';
    return `
      <h2>Measurement</h2>
      <div class="sub">One quantity, one reference, a bounded ring buffer, one plot, one reset.
        <b>No expression language, no ruler and protractor suite.</b></div>
      ${renderPlot(m, { title: `${m.label} — ${m.unit}`, note: this.refNote })}
      ${this.demoFacts()}`;
  }

  // -- interventions ---------------------------------------------------------

  /** The ONE path by which anything reaches the simulation from the UI. */
  private fire(make: (tick: number, seq: number) => InputEvent): void {
    const tick = this.sim.tick;
    const seq = this.recorder.nextSeq();
    const e = make(tick, seq);
    const refusal = applyEvent(this.sim, e);
    if (refusal) { this.toast(refusal, false); return; }
    this.recorder.record(e);
    this.runEvents.push(copy(e));
    this.toast(`${e.kind} · tick ${tick} seq ${seq}`, true);
    this.rebuildIfTopologyChanged(e);
    this.driver.resync();
    this.paintPanels();
    this.buildControls();
  }

  private rebuildIfTopologyChanged(e: InputEvent): void {
    if (e.kind === 'addBlock' || e.kind === 'removeBlock') {
      if (e.kind === 'removeBlock') {if (this.selectedId === e.target) this.selectedId = null; this.meters=this.meters.filter(m=>!('entityId' in m.ref)||m.ref.entityId!==e.target);this.plotIndex=0;}
      this.rebuildSceneGraph();
    }
  }

  private nextBlock(): EntityDesc {
    const id = this.sim.mintId();
    // DETERMINISTIC placement — no RNG anywhere, or replay could not be bit-exact.
    const n = this.sim.nextSerial - 1;
    const ring = [[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5], [0, 0.6], [0, -0.6]][n % 6];
    const h = 0.11 + 0.015 * (n % 4);
    return {
      id, label: `block ${id}`, kinematics: 'dynamic',
      shape: { kind: 'box', hx: h, hy: h, hz: h },
      material: { mass: 0.8 + 0.4 * (n % 3), restitution: 0.1, friction: 0.6 },
      translation: { x: ring[0], y: 1.85 + 0.28 * (n % 5), z: ring[1] },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 },
      colour: [0xd98a5a, 0xd9b45a, 0xa8d95a, 0x5ad9c0, 0x8a9ad9, 0xc86a9a][n % 6],
    };
  }

  // -- controls --------------------------------------------------------------

  buildControls(): void {
    const sel = this.selectedId;
    const selRt = sel && this.sim.entities.has(sel) ? this.sim.runtime(sel) : null;
    const spring = this.sim.springs.find((s) => s.id === this.selectedSpring) ?? this.sim.springs[0];
    this.selectedSpring = spring?.id ?? null;
    const massOf = (id: string): number | undefined => this.sim.entities.get(id)?.mass;
    // THE GUARD IS COMPUTED AT THE STEP THE WORLD IS ACTUALLY TAKING. A scene on a
    // declared finer profile resolves a proportionally stiffer regime, and offering
    // the M = 4 maxima there would be a limit that describes a different integrator.
    const hLive = this.sim.hSub;
    const kMax = spring ? maxStiffnessForSpring(this.sim.springs, spring.id, massOf, hLive) : LIMITS.stiffnessMax;
    const cMax = spring ? maxDampingForSpring(this.sim.springs, spring.id, massOf, hLive) : LIMITS.dampingMax;

    $('controls').innerHTML = `${authorControls(this.author.authored, this.selectedId, this.editing, this.author.audit.length)}${this.editing ? springAuthorControls(this.author.authored, this.authorSpring) + connectionAuthorControls(this.author.authored, this.authorConnection) + circuitAuthorControls(this.author.authored, this.authorNode, this.authorComponent) : ''}${this.comparisonControls()}<div ${this.editing ? 'hidden inert class="runtime-inert"' : ''}>` + `
      <h1>${this.authoredScene ? escapeHtml(this.author.authored.name) : this.preset.label}</h1>
      <div class="sub">Rapier ${SimWorld.engineVersion()} · fixed 1/60 s public tick = <b>${this.sim.subSteps}</b> internal sub-steps of ${(1000 * hLive).toFixed(4)} ms, forces refreshed on each${this.sim.declaredNumerics ? ' · <b>DECLARED PROFILE</b> (recorded, restored and compared; a construction that declares none means the legacy ' + SI.SUBSTEPS + ')' : ' · legacy profile (no profile declared)'} · three.js r${THREE.REVISION}</div>

      <div class="grp"><label>scene / preset — resets the world AND the recording</label>
        <label class="vh" for="s-scene">scene preset</label>
        <select id="s-scene" class="wide" aria-label="scene preset" title="scene preset">
          ${SCENES.map((p) => `<option value="${p.id}" ${p.id === this.sceneId ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
        <div class="sceneblurb">${this.authoredScene ? 'Your authored experiment. Selecting a preset replaces the live scene; captured comparisons stay separate.' : this.preset.blurb}</div>
        <div class="grp">
          <button id="b-restart" title="Rebuild this scene at tick 0 and run it again">Restart</button>
          ${App.DECLARED_END_S[this.sceneId] !== undefined ? `<button id="b-endmode" class="${this.demoEndMode === 'loop' ? 'on' : ''}"
            title="What happens when the demo passes its declared end time">${
              this.demoEndMode === 'loop' ? 'At declared end: LOOP' : 'At declared end: PAUSE'}</button>` : ''}
        </div>
        ${App.DECLARED_END_S[this.sceneId] !== undefined ? `<div class="sceneblurb">This demo has a
          <b>declared end at t = ${App.DECLARED_END_S[this.sceneId].toFixed(2)} s</b>, after its measurement window.
          Left running past it the viewport empties &mdash; demo 4's pair separates forever, demo 5's block leaves the
          ramp &mdash; so at that time it either loops back to tick 0 or pauses. Either way the ticks that ran are the
          ticks that ran: <b>the physics and the measurement are unchanged</b>.</div>` : ''}
      </div>

      ${this.sceneControls()}

      <div class="grp"><label>gravity — a recorded intervention, booked against a FIXED PE datum</label>
        <button id="b-g-earth" class="${Math.abs(this.gMag - 9.81) < 1e-6 ? 'on' : ''}">Earth 9.81</button>
        <button id="b-g-moon" class="${Math.abs(this.gMag - 1.62) < 1e-6 ? 'on' : ''}">Moon 1.62</button>
        <button id="b-g-mars" class="${Math.abs(this.gMag - 3.71) < 1e-6 ? 'on' : ''}">Mars 3.71</button>
        <button id="b-g-zero" class="${this.gMag < 1e-9 ? 'on' : ''}">free space 0</button>
        <label class="vh" for="i-g">gravity magnitude in metres per second squared</label>
        <input type="number" id="i-g" aria-label="gravity magnitude in metres per second squared"
          title="gravity magnitude in metres per second squared" step="0.5" min="0" max="${LIMITS.gravityMax}"
          value="${this.gMag.toFixed(2)}" />
        <button id="b-g-set">set g (m/s²)</button>
        <div class="legend">U_grav = −m(<b>g</b>·<b>r</b>) with the datum at the <b>world origin</b>, and the datum
          <b>does not move when g does</b>. Changing g therefore changes the potential instantly; that change is
          measured with the world frozen across the edit and booked to <b>this intervention</b>, so it never
          appears as drift and never reaches UNATTRIBUTED. Outside [0, ${LIMITS.gravityMax}] m/s² is REFUSED, not clamped.</div>
      </div>

      <div class="grp"><label>measurement</label>
        <label class="vh" for="s-meter">quantity to plot</label>
        <select id="s-meter" aria-label="quantity to plot" title="quantity to plot">
          ${this.meters.map((m, i) => `<option value="${i}" ${i === this.plotIndex ? 'selected' : ''}>${m.label} (${m.unit})</option>`).join('')}
        </select>
        <button id="b-meter-reset">reset measurement</button>
      </div>

      <div class="grp"><label>time</label>
        <button id="b-pause">${this.driver.paused ? '▶ resume' : '⏸ pause'}</button>
        <button id="b-step">⏭ single-step</button>
        <button id="b-reset" class="danger">⟲ reset</button>
      </div>

      <div class="grp"><label>blocks</label>
        <button id="b-add">+ add block</button>
        <button id="b-remove" ${selRt && sel !== 'ground' && sel !== 'platform' ? '' : 'disabled'}>− remove selected</button>
      </div>

      <div class="grp"><label>mass of selected ${sel ? `(${sel})` : ''}</label>
        <label class="vh" for="i-mass">mass of selected body in kg</label><input type="number" id="i-mass" aria-label="mass of selected body in kg" title="mass of selected body in kg" step="0.1" min="${LIMITS.massMin}" max="${LIMITS.massMax}"
          value="${selRt ? selRt.desc.material.mass : ''}" ${selRt && selRt.desc.kinematics === 'dynamic' ? '' : 'disabled'} />
        <button id="b-mass" ${selRt && selRt.desc.kinematics === 'dynamic' ? '' : 'disabled'}>set mass (kg)</button>
      </div>

      <div class="grp"><label>spring</label>
        <label class="vh" for="s-spring">spring to edit</label><select id="s-spring" aria-label="spring to edit" title="spring to edit">${this.sim.springs.map((s) => `<option value="${s.id}" ${s.id === this.selectedSpring ? 'selected' : ''}>${s.id}</option>`).join('')}</select>
        <label class="vh" for="i-k">spring stiffness k in newtons per metre</label><input type="number" id="i-k" aria-label="spring stiffness k in newtons per metre" title="spring stiffness k in newtons per metre" step="50" min="${LIMITS.stiffnessMin}" max="${kMax}" value="${spring?.stiffness ?? ''}" />
        <button id="b-k">set k (N/m)</button>
        <label class="vh" for="i-c">spring damping c in newton seconds per metre</label><input type="number" id="i-c" aria-label="spring damping c in newton seconds per metre" title="spring damping c in newton seconds per metre" step="1" min="${LIMITS.dampingMin}" max="${cMax}" value="${spring?.damping ?? ''}" />
        <button id="b-c">set c (N·s/m)</button>
        <button id="b-kall">apply k to all 4</button>
        <div class="legend">offered regime is the RESOLVED regime: k &le; ${kMax} N/m, c &le; ${cMax} N·s/m for this spring,
          from omega_n&middot;h &le; ${RESOLVABILITY.maxOmegaH} and gamma&middot;h &le; ${RESOLVABILITY.maxGammaH} at the
          <b>live</b> ${(1000 * hLive).toFixed(4)} ms internal sub-step. Values outside are REFUSED, not clamped.</div>
      </div>

      <div class="grp"><label>push the selected body — an IMPULSE in N·s, not a force</label>
        <label class="vh" for="s-dir">push direction</label><select id="s-dir" aria-label="push direction" title="push direction">
          <option value="x">+X</option><option value="-x">−X</option>
          <option value="y">+Y</option><option value="-y">−Y</option>
          <option value="z">+Z</option><option value="-z">−Z</option>
        </select>
        <label class="vh" for="i-J">impulse magnitude in newton seconds</label><input type="number" id="i-J" aria-label="impulse magnitude in newton seconds" title="impulse magnitude in newton seconds" step="0.5" min="0" max="${LIMITS.impulseMax}" value="2.5" />
        <label style="width:auto;text-transform:none;letter-spacing:0">
          <input type="checkbox" id="c-offcentre" aria-label="apply the impulse off centre" title="apply the impulse off centre" checked style="width:auto" /> off-centre (topples)</label>
        <button id="b-push" ${selRt && selRt.desc.kinematics === 'dynamic' ? '' : 'disabled'}>push</button>
      </div>

      <div class="grp"><label>environment</label>
        <button id="b-air" class="${this.sim.construction.environment.medium === 'air' ? 'on' : ''}">air (default)</button>
        <button id="b-vac" class="${this.sim.construction.environment.medium === 'vacuum' ? 'on' : ''}">vacuum</button>
      </div>

      <div class="grp"><label>authored content — a construction</label>
        <button id="b-save">save construction</button>
        <button id="b-load">restore construction</button>
        <button id="b-dl">download .json</button>
      </div>

      <div class="grp"><label>solver checkpoint — a different artifact</label>
        <button id="b-cp">take checkpoint</button>
        <button id="b-rcp">restore checkpoint</button>
        <button id="b-vrfy">verify restore ≡ unbroken</button>
      </div>

      <div class="grp"><label>record and replay</label>
        <button id="b-rec" class="${this.recorder.recording ? 'on' : ''}">${this.recorder.recording ? '● recording' : '○ record'}</button>
        <button id="b-replay" ${this.recorder.events.length ? '' : 'disabled'}>replay recording</button>
        <button id="b-rvrfy" ${this.recorder.events.length ? '' : 'disabled'}>replay ×2 &amp; verify</button>
      </div>

      <div class="grp"><label>the hand — an EXTERNAL, POWERED COMPLIANT ACTUATOR</label>
        <div class="legend"><b>Nominal gains and cap are fixed</b> at K = ${HAND.K} N/m, C = ${HAND.C} N·s/m,
          cap ${HAND.F_MAX} N; they are <b>reduced for numerical resolution when the effective mass is low</b>
          — below m_eff = ${minEffectiveMass(hLive).toFixed(3)} kg — and not otherwise. That reduction is
          CONTROLLER behaviour, not a change to the body's physics, and the <b>live effective</b> K, C and cap
          are shown in the grab readout while a body is held. Declared controller stability margin
          omega_n&middot;h &le; ${HAND.MAX_OMEGA_H} and gamma&middot;h &le; ${HAND.MAX_GAMMA_H} at the
          <b>live</b> ${(1000 * hLive).toFixed(4)} ms internal sub-step — this is the CONTROLLER's margin and is
          <b>not</b> the passive springs' resolvability limit, which is unchanged. The guard is
          <b>re-evaluated whenever the held body's mass changes</b>, not only when the grab begins.
          Supported: the preset bodies of this construction; no arbitrary-body stability is claimed.</div>
      </div>

      <div class="grp"><label>performance trial — 60 bodies, 120 s</label>
        <button id="b-perf">run trial</button>
      </div>
      <div class="legend">${this.perfReport}</div>
    `;

    $('controls').insertAdjacentHTML('beforeend', '</div>');
    this.bindAuthorControls();

    const on = (id: string, fn: () => void): void => { $(id).addEventListener('click', fn); };
    const num = (id: string): number => Number(($(id) as HTMLInputElement).value);

    $('s-scene').addEventListener('change', (e) => this.selectScene((e.target as HTMLSelectElement).value));
    document.getElementById('b-restart')?.addEventListener('click', () => { this.loopCount = 0; this.restartScene(); });
    document.getElementById('b-endmode')?.addEventListener('click', () => {
      this.demoEndMode = this.demoEndMode === 'loop' ? 'pause' : 'loop';
      this.buildControls();
      this.toast(this.demoEndMode === 'loop'
        ? 'At its declared end this demo now LOOPS back to tick 0, so the viewport never empties.'
        : 'At its declared end this demo now PAUSES, leaving the final measured state on screen.', true);
    });
    $('s-meter').addEventListener('change', (e) => {
      this.plotIndex = Number((e.target as HTMLSelectElement).value);
      this.paintPanels();
    });
    on('b-meter-reset', () => {
      for (const m of this.meters) { m.reset(); m.sample(this.sim); }
      this.paintPanels();
      this.toast('measurement reset — the bounded sample buffers are empty', true);
    });
    on('b-g-earth', () => this.setGravityUi(9.81, 'Earth'));
    on('b-g-moon', () => this.setGravityUi(1.62, 'the Moon'));
    on('b-g-mars', () => this.setGravityUi(3.71, 'Mars'));
    on('b-g-zero', () => this.setGravityUi(0, 'free space'));
    on('b-g-set', () => this.setGravityUi(num('i-g'), 'a custom value'));
    if (!this.authoredScene && this.sceneId === 'projectile') {
      $('i-angle').addEventListener('change', (e) => {
        this.demo.angleDeg = clamp(Number((e.target as HTMLInputElement).value), 1, 89);
        this.buildControls();
      });
      on('b-launch', () => this.launchShot());
    }
    if (!this.authoredScene && this.sceneId === 'pendulum') {
      $('i-amp').addEventListener('change', (e) => {
        this.demo.amplitudeDeg = clamp(Number((e.target as HTMLInputElement).value), 1, 170);
        this.buildControls();
      });
      on('b-release', () => this.releaseAt());
    }
    if (!this.authoredScene && this.sceneId === 'oscillator') {
      $('i-x0').addEventListener('change', (e) => {
        this.demo.x0 = clamp(Number((e.target as HTMLInputElement).value), -0.9, 0.9);
        this.buildControls();
      });
      on('b-release', () => this.releaseAt());
    }
    if (!this.authoredScene && this.sceneId === 'collision') {
      $('i-e').addEventListener('change', (e) => {
        this.demo.restitution = clamp(Number((e.target as HTMLInputElement).value), 0, 1);
        this.buildControls();
      });
      on('b-release', () => this.releaseAt());
    }
    if (!this.authoredScene && this.sceneId === 'incline') {
      $('i-theta').addEventListener('change', (e) => {
        this.demo.inclineDeg = clamp(Number((e.target as HTMLInputElement).value), 5, 60);
        this.buildControls();
      });
      $('i-mu').addEventListener('change', (e) => {
        this.demo.mu = clamp(Number((e.target as HTMLInputElement).value), 0, 1.5);
        this.buildControls();
      });
      on('b-release', () => this.releaseAt());
    }
    if (!this.authoredScene && this.sceneId === 'fall') {
      on('b-release', () => this.releaseAt());
    }

    on('b-pause', () => { if(this.editing){this.startAuthoredRun();return;} this.driver.paused = !this.driver.paused; this.buildControls(); });
    on('b-step', () => { this.driver.paused = true; this.driver.stepOnce(); this.buildControls(); this.paintPanels(); });
    on('b-reset', () => this.reset());

    on('b-add', () => { const e = this.nextBlock(); this.fire((t, s) => ({ tick: t, seq: s, wallClockMs: Date.now(), kind: 'addBlock', target: e.id, entity: e })); });
    on('b-remove', () => { if (sel) this.fire((t, s) => ({ tick: t, seq: s, wallClockMs: Date.now(), kind: 'removeBlock', target: sel })); });
    on('b-mass', () => { if (sel) this.fire((t, s) => ({ tick: t, seq: s, wallClockMs: Date.now(), kind: 'setMass', target: sel, mass: num('i-mass') })); });

    $('s-spring').addEventListener('change', (e) => { this.selectedSpring = (e.target as HTMLSelectElement).value; this.buildControls(); });
    on('b-k', () => { const id = this.selectedSpring; if (id) this.fire((t, s) => ({ tick: t, seq: s, wallClockMs: Date.now(), kind: 'setStiffness', target: id, stiffness: num('i-k') })); });
    on('b-c', () => { const id = this.selectedSpring; if (id) this.fire((t, s) => ({ tick: t, seq: s, wallClockMs: Date.now(), kind: 'setDamping', target: id, damping: num('i-c') })); });
    on('b-kall', () => { const k = num('i-k'); for (const sp of [...this.sim.springs]) this.fire((t, s) => ({ tick: t, seq: s, wallClockMs: Date.now(), kind: 'setStiffness', target: sp.id, stiffness: k })); });

    on('b-push', () => {
      if (!sel || !selRt) return;
      const mag = clamp(num('i-J'), 0, LIMITS.impulseMax);
      const dir = ($('s-dir') as HTMLSelectElement).value;
      const J: Vec3 = { x: 0, y: 0, z: 0 };
      const s = dir.startsWith('-') ? -mag : mag;
      if (dir.endsWith('x')) J.x = s; else if (dir.endsWith('y')) J.y = s; else J.z = s;
      const off = ($('c-offcentre') as HTMLInputElement).checked;
      const com = this.sim.body(sel).worldCom();
      const point = off ? { x: com.x, y: com.y + shapeExtent(selRt.desc.shape) / 2, z: com.z } : undefined;
      this.fire((t, sq) => point
        ? { tick: t, seq: sq, wallClockMs: Date.now(), kind: 'push', target: sel, impulse: J, point }
        : { tick: t, seq: sq, wallClockMs: Date.now(), kind: 'push', target: sel, impulse: J });
      this.toast(describeImpulse(J), true);
    });

    on('b-air', () => this.fire((t, s) => ({ tick: t, seq: s, wallClockMs: Date.now(), kind: 'setEnvironment', target: 'world', medium: 'air' })));
    on('b-vac', () => this.fire((t, s) => ({ tick: t, seq: s, wallClockMs: Date.now(), kind: 'setEnvironment', target: 'world', medium: 'vacuum' })));

    on('b-save', () => {
      const json = this.author.save();
      if (/"(handle|colliderHandle|bodyHandle)"\s*:/.test(json)) { this.toast('REFUSED: construction contained an engine handle', false); return; }
      localStorage.setItem(LS.construction, json);
      this.toast(`construction saved (${json.length} chars, 0 engine handles)`, true);
    });
    on('b-load', () => {
      const json = localStorage.getItem(LS.construction);
      if (!json) { this.toast('no saved construction', false); return; }
      try {
        this.loadAuthorDocument(json);
      } catch (err) { this.toast(`load refused: ${String(err)}`, false); }
    });
    on('b-dl', () => {
      const blob = new Blob([this.author.save()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'fp1-construction.json'; a.click();
      URL.revokeObjectURL(a.href);
    });

    on('b-cp', () => {
      const cp = takeCheckpoint(this.sim, extrasFrom(this.recorder, {
        pendingEvents: this.pending, selectedId: this.selectedId, paused: this.driver.paused,
      }));
      localStorage.setItem(LS.checkpoint, JSON.stringify({format:'fg-author-checkpoint', checkpoint:cp, authored:this.author.save(), authoredScene:this.authoredScene, runEvents:this.runEvents, editAudit:this.author.audit}));
      this.toast(`checkpoint at tick ${cp.app.tick}: ${cp.solverSnapshotBase64.length} b64 chars of solver state + ${cp.app.handles.length} handle mappings + app state`
        + ` (incl. ${cp.app.recordedEvents.length} recorded event${cp.app.recordedEvents.length === 1 ? '' : 's'} of history)`, true);
    });
    on('b-rcp', () => {
      const raw = localStorage.getItem(LS.checkpoint);
      if (!raw) { this.toast('no checkpoint saved', false); return; }
      try {
        const saved = JSON.parse(raw);
        if (saved.format !== 'fg-author-checkpoint') throw new Error('This legacy checkpoint has no separately retained authored base; use a new checkpoint.');
        const base = loadAuthored(saved.authored);
        this.clearGrabUi();
        const extras = restoreCheckpoint(this.sim, saved.checkpoint as Checkpoint);
        this.author.replace(base); this.author.audit = copy(saved.editAudit ?? []); this.authoredScene = saved.authoredScene; this.editing = false;
        this.runEvents = copy(saved.runEvents);
        this.pending = extras.pendingEvents;
        this.selectedId = extras.selectedId;
        this.configureMeters();
        this.driver.paused = extras.settings.paused;
        // THE RECORDED HISTORY IS REWOUND WITH THE WORLD. Restoring `recording`
        // and the seq counter while leaving `events` alone left events belonging
        // to a discarded future in the record and reused their sequence numbers.
        this.recorder.adopt(extras);
        this.driver.resync();
        this.rebuildSceneGraph(); this.buildControls(); this.paintPanels();
        this.toast(`restored to tick ${this.sim.tick} — engine AND application state, including ${extras.recordedEvents.length} recorded event${extras.recordedEvents.length === 1 ? '' : 's'} of history and the seq counter (${extras.seqCounter})`
          + (this.sim.hand.active
            ? `<br><b>The checkpoint was taken MID-GRAB, so the hand is holding ${this.sim.hand.entityId} again</b> — that is the point of including
               transient hand state in a checkpoint. No pointer is attached: press <b>Esc</b> to let go.`
            : ''), true);
      } catch (err) { this.toast(`restore failed: ${String(err)}`, false); }
    });
    on('b-vrfy', () => this.verifyRestore());

    on('b-rec', () => {
      if (this.recorder.recording) {
        this.recorder.stop();
        this.buildControls();
        this.toast(`recording stopped: ${this.recorder.events.length} events`, true);
        return;
      }
      // Start from a world at tick 0, and remember WHICH world: the base is part
      // of the recording, saved with it and restored with it.
      this.recorder.stop();
      this.reset();
      this.recorder.begin(this.sim.construction);
      this.buildControls();
      this.toast('recording — interventions are keyed by (tick, seq), never wall clock; base construction captured', true);
    });
    on('b-replay', () => this.doReplay());
    on('b-rvrfy', () => this.verifyReplay());
    on('b-perf', () => this.perfTrial());
  }

  /**
   * Reset returns the world to tick 0 of THE CURRENT SCENE, not always the FP1
   * default: the selector and the reset button have to mean the same thing or the
   * recording's base and the world would disagree. `replaceWorld` decides between
   * rebase and terminate by comparing against the recording's own base.
   */
  private startAuthoredRun(): void {
    this.editing = false;
    this.configureMeters();
    this.driver.paused = false;
    this.buildControls();
    this.paintInstruction();
  }

  private comparisonControls(): string {
    const a=this.comparisons.get(0), b=this.comparisons.get(1);
    return `<section class="author"><h2>Compare experiments</h2><p>Capture A, edit one parameter, run again and capture B using the same measurement. Captured runs keep their own starting scenes.</p><p id="comparison-status" role="status">${this.editing ? 'Capture is unavailable while editing the starting scene. Start a run below, then capture after it advances. Pausing a run does not prevent capture.' : 'Capture is available in run mode, whether running or paused. At least two measurement samples are needed.'}</p>${this.editing ? '<button id="a-comparison-start">Start run for comparison</button>' : ''}<button id="a-capture-0" aria-describedby="comparison-status" aria-disabled="${this.editing}" title="${this.editing ? 'Start run for comparison to leave editing mode' : 'Capture the current run, whether running or paused'}" ${this.editing?'disabled':''}>Capture run A</button><button id="a-capture-1" aria-describedby="comparison-status" aria-disabled="${this.editing}" title="${this.editing ? 'Start run for comparison to leave editing mode' : 'Capture the current run, whether running or paused'}" ${this.editing?'disabled':''}>Capture run B</button><p>A: ${a?`${a.samples.length} samples · ${escapeHtml(a.quantity)} (${escapeHtml(a.unit)}) · ${a.samples[0].t.toFixed(2)}–${a.samples.at(-1)!.t.toFixed(2)} s${a.truncated?' · earlier samples discarded':''}`:'empty'}<br>B: ${b?`${b.samples.length} samples · ${escapeHtml(b.quantity)} (${escapeHtml(b.unit)}) · ${b.samples[0].t.toFixed(2)}–${b.samples.at(-1)!.t.toFixed(2)} s${b.truncated?' · earlier samples discarded':''}`:'empty'}</p><button id="a-comparison-load">Reopen saved comparison</button><button id="a-comparison-clear">Clear comparison slots</button>${a?'<button id="a-replay-0">Replay captured A</button>':''}${b?'<button id="a-replay-1">Replay captured B</button>':''}${this.comparisonMarkup}</section>`;
  }
  private refreshComparison(): void {
    const a=this.comparisons.get(0),b=this.comparisons.get(1);
    if(!a||!b){this.comparisonMarkup='';return;}
    const meter=new Meter(a.quantity,a.ref);meter.samples=a.samples;
    const changed=differences(a.construction,b.construction);
    const physicalInputs=(events:InputEvent[])=>events.map(({wallClockMs: _wallClockMs,...event})=>event);
    const inputChanges=differences(physicalInputs(a.input.events),physicalInputs(b.input.events),'input');
    this.comparisonMarkup=`<section><h2>Run A / Run B</h2><p>Teal: A · Amber: B. ${escapeHtml(a.quantity)} (${escapeHtml(a.unit)}). Time is simulated seconds.</p><details open><summary>What changed</summary><ul>${(changed.length?changed:['No authored parameter changed']).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul><p>${inputChanges.length?'Recorded inputs also differ ('+inputChanges.length+' field differences).':'Same recorded inputs.'} Numerical profiles: A ${a.profile.substeps}, B ${b.profile.substeps} substeps per tick.</p></details>${renderPlot(meter,{title:'Captured runs · shared axes',comparison:{samples:b.samples,label:'B'},note:'Each capture is validated in its own saved scene; neither is rebound to the active scene.'})}</section>`;
  }

  private authorRebuild(): void {
    this.clearGrabUi(); this.autoPausedAt = null;
    this.author.start(this.sim, this.recorder);
    this.pending = []; this.runEvents = [];
    this.authoredScene = true;
    this.selectedId = this.sim.entities.has(this.selectedId ?? '') ? this.selectedId : (this.sim.dynamicIds()[0] ?? this.sim.order[0] ?? null);
    this.selectedSpring = this.sim.springs[0]?.id ?? null;
    this.driver = new FixedStepDriver(this.sim, this.beforeTick, this.afterTick);
    this.driver.paused = true;
    this.configureMeters(); this.rebuildSceneGraph(); this.frameCamera(); this.buildControls(); this.paintInstruction(); this.paintPanels();
  }
  private loadAuthorDocument(json: string): void {
    const c = loadAuthored(json); // validate before changing anything
    this.author.replace(c); this.editing = true; this.authorRebuild(); this.frameCamera();
    this.toast('Reopened authored starting scene at tick 0; prior live state cleared.', true);
  }
  private bindAuthorControls(): void {
    const on=(id:string, fn:()=>void) => document.getElementById(id)?.addEventListener('click',()=>{try{fn();}catch(e){this.toast(escapeHtml(String(e)),false);}});
    const apply=(fn:(c:ReturnType<typeof defaultConstruction>)=>void, reason:string)=>{this.author.edit(fn,reason);this.authorRebuild();this.toast(reason+' · new paused run base',true);};
    on('a-mode',()=>{if(this.editing){this.startAuthoredRun();}else{this.editing=true;this.authorRebuild();}});
    on('a-comparison-start',()=>this.startAuthoredRun());
    on('a-pause',()=>{this.driver.paused=!this.driver.paused;this.buildControls();this.paintHud();});
    on('a-step',()=>{this.driver.paused=true;this.driver.stepOnce();this.paintPanels();this.paintHud();});
    on('a-save',()=>{localStorage.setItem('fg.authored',this.author.save());this.toast('Saved authored starting scene (not the evolved world).',true);});
    on('a-load',()=>{const s=localStorage.getItem('fg.authored');if(!s)throw new Error('No authored scene saved yet');this.loadAuthorDocument(s);});
    on('a-export',()=>{($('a-document') as HTMLTextAreaElement).value=this.author.save();});
    on('a-import',()=>this.loadAuthorDocument(($('a-document') as HTMLTextAreaElement).value));
    document.getElementById('a-body')?.addEventListener('change',()=>{this.selectedId=($('a-body') as HTMLSelectElement).value;this.updateOutline();this.buildControls();this.paintPanels();});
    on('a-apply',()=>apply(c=>{const e=c.entities.find(e=>e.id===this.selectedId);if(e)readBodyEdit(e);},'Body edited'));
    on('a-cancel',()=>{this.buildControls();this.toast('Form changes discarded; authored scene unchanged.',true);});
    on('a-delete',()=>apply(c=>deleteBody(c,this.selectedId!),'Body and connections deleted'));
    on('a-add',()=>{
      const kind=($('a-shape') as HTMLSelectElement).value;
      apply(c=>{let id='';do{id=`auth${c.nextSerial++}`;}while(c.entities.some(e=>e.id===id));
        c.entities.push({id,label:`My ${kind}`,kinematics:'dynamic',shape:kind==='sphere'?{kind:'sphere',radius:0.25}:kind==='capsule'?{kind:'capsule',radius:0.2,halfHeight:0.3}:{kind:'box',hx:0.25,hy:0.25,hz:0.25},material:{mass:1,friction:0.5,restitution:0.2},translation:{x:2,y:3,z:0},rotation:{x:0,y:0,z:0,w:1},linvel:{x:0,y:0,z:0},angvel:{x:0,y:0,z:0},colour:0xeeb86a});this.selectedId=id;
      },'Body added');
    });
    document.getElementById('a-spring-choice')?.addEventListener('change',()=>{this.authorSpring=($('a-spring-choice') as HTMLSelectElement).value||null;this.buildControls();const d=document.querySelector('.spring-author') as HTMLDetailsElement;if(d)d.open=true;});
    const value=(id:string)=>{const v=Number(($(id) as HTMLInputElement).value);if(!Number.isFinite(v))throw new Error('Use finite spring values');return v;};
    on('a-thermal-apply',()=>apply(c=>{
      const e=c.entities.find(e=>e.id===this.selectedId);if(!e)throw new Error('Select a body');
      if(($('a-thermal-enable') as HTMLInputElement).checked) e.thermal={heatCapacity:value('a-heat-capacity'),initialTemperature:value('a-temperature0')};
      else {delete e.thermal;for(const s of c.springs)if(s.heatReceiver===e.id)delete s.heatReceiver;}
    },'Thermal starting state authored'));
    on('a-spring-apply',()=>apply(c=>{
      let spring=c.springs.find(s=>s.id===this.authorSpring);
      if(!spring){let id='';do{id=`spring-auth${c.nextSerial++}`;}while(c.springs.some(s=>s.id===id));spring={id,a:{kind:'body',entityId:'',localPoint:{x:0,y:0,z:0}},b:{kind:'body',entityId:'',localPoint:{x:0,y:0,z:0}},restLength:1,stiffness:100,damping:2};c.springs.push(spring);this.authorSpring=id;}
      for(const ep of ['a','b'] as const){const input=document.getElementById(`a-end-${ep}`) as HTMLSelectElement|null;if(input)spring[ep]={kind:'body',entityId:input.value,localPoint:{x:value(`a-${ep}x`),y:value(`a-${ep}y`),z:value(`a-${ep}z`)}};}
      if(spring.a.kind==='body'&&spring.b.kind==='body'&&spring.a.entityId===spring.b.entityId)throw new Error('Choose two different bodies');
      const receiver=($('a-heat-receiver') as HTMLSelectElement).value;if(receiver)spring.heatReceiver=receiver;else delete spring.heatReceiver;
      spring.restLength=value('a-rest');spring.stiffness=value('a-stiff');spring.damping=value('a-damp');
    },'Spring authored'));
    on('a-spring-delete',()=>apply(c=>{c.springs=c.springs.filter(s=>s.id!==this.authorSpring);this.authorSpring=null;},'Spring deleted'));
    on('a-spring-cancel',()=>this.buildControls());

    // -----------------------------------------------------------------------
    // BB2 — BALL AND FIXED CONNECTIONS. Create / edit / delete / cancel, plus the
    // authored PLACEMENT operation that is the only sanctioned alternative to a
    // refusal. Every one of these runs through `apply`, i.e. through the existing
    // AuthoringSession.edit audit; none of them touches the running solver.
    // -----------------------------------------------------------------------
    document.getElementById('c-choice')?.addEventListener('change',()=>{this.authorConnection=($('c-choice') as HTMLSelectElement).value||null;this.buildControls();const d=document.querySelector('.connection-author') as HTMLDetailsElement;if(d)d.open=true;});
    for(const id of ['c-bodyA','c-bodyB','c-kind']) document.getElementById(id)?.addEventListener('change',()=>{const d=document.querySelector('.connection-author') as HTMLDetailsElement;if(d)d.open=true;refreshConnectionFrameLabels();});
    refreshConnectionFrameLabels();
    /** Write the form into a construction, creating the connection if it is new. Returns its id. */
    const writeConnection=(c:ReturnType<typeof defaultConstruction>):string=>{
      const f=readConnectionForm();
      const existing=(c.joints??[]).find(x=>x.id===this.authorConnection);
      const id=existing?existing.id:nextConnectionId(c,f.kind);
      const rebuilt=makeConnection(c,f.kind,f.bodyA,f.bodyB,f.anchorA,f.anchorB,id);
      c.joints=[...(c.joints??[]).filter(x=>x.id!==id),rebuilt];
      this.authorConnection=id;
      return id;
    };
    on('c-apply',()=>apply(c=>{writeConnection(c);},'Connection authored'));
    on('c-place',()=>apply(c=>{
      const id=writeConnection(c);
      // THE AUTHORED PLACEMENT OPERATION. It moves BODY B only, in the authored
      // starting scene, so the connection is satisfied exactly. The solver is
      // never asked to pull anything into place.
      placeToSatisfyConnection(c,id);
    },'Body B placed to satisfy the connection'));
    on('c-delete',()=>apply(c=>{deleteConnection(c,this.authorConnection!);this.authorConnection=null;},'Connection deleted'));
    on('c-cancel',()=>{this.buildControls();this.toast('Connection form changes discarded; authored scene unchanged.',true);});
    // -----------------------------------------------------------------------
    // BATCH 4 — THE CIRCUIT CONTROLS. Nodes first, then components. Every commit
    // runs through `apply`, i.e. through the existing AuthoringSession edit audit,
    // and therefore starts a new paused run; none of them touches a running solver.
    // A refusal from the model is SURFACED as a toast, never worked around.
    // -----------------------------------------------------------------------
    const keepCircuitOpen=()=>{const d=document.querySelector('.circuit-author') as HTMLDetailsElement;if(d)d.open=true;};
    document.getElementById('a-cn-choice')?.addEventListener('change',()=>{this.authorNode=($('a-cn-choice') as HTMLSelectElement).value||null;this.buildControls();keepCircuitOpen();});
    document.getElementById('a-cc-choice')?.addEventListener('change',()=>{this.authorComponent=($('a-cc-choice') as HTMLSelectElement).value||null;this.buildControls();keepCircuitOpen();});
    // THE TYPE SELECT RETARGETS THE LABELS IN PLACE. It must NOT rebuild: a rebuild
    // reset the select to the stored component's kind and threw away what the author
    // had typed, so a wire was committed as a resistor. See DEVIATIONS D-41.
    document.getElementById('a-cc-kind')?.addEventListener('change',()=>{refreshCircuitFormLabels();keepCircuitOpen();});
    refreshCircuitFormLabels();
    on('a-cn-rename',()=>apply(c=>{
      const n=c.circuit?.nodes.find(n=>n.id===this.authorNode);if(!n)throw new Error('Select a node');
      n.label=($('a-cn-label') as HTMLInputElement).value||n.id;
    },'Circuit node renamed'));
    on('a-cn-delete',()=>apply(c=>{deleteCircuitNode(c,this.authorNode!);this.authorNode=c.circuit?.nodes[0]?.id??null;this.authorComponent=null;},'Circuit node and its components deleted'));
    on('a-cc-apply',()=>apply(c=>{
      if(!c.circuit)c.circuit={nodes:[],components:[]};
      const f=readComponentForm();
      const circuit=c.circuit;
      const free=(want:string)=>{let id=want;while(circuit.nodes.some(n=>n.id===id)||circuit.components.some(k=>k.id===id)
        ||c.entities.some(e=>e.id===id)||c.springs.some(x=>x.id===id)||(c.joints??[]).some(j=>j.id===id)){id=`${want}_${c.nextSerial++}`;}return id;};
      // A NODE IS CREATED WITH THE COMPONENT THAT CONNECTS IT. A node with nothing
      // attached has no determined potential, so this build refuses to author one —
      // and therefore never offers a way to make one. Found by driving the form.
      const nodeFor=(sel:string,name:string):string=>{
        if(sel!==NEW_NODE)return sel;
        const id=free(`n${c.nextSerial++}`);
        circuit.nodes.push({id,label:name||id});
        return id;
      };
      const a=nodeFor(f.a,f.aName), b=nodeFor(f.b,f.bName);
      if(a===b)throw new Error('A component needs two DIFFERENT nodes');
      const existing=circuit.components.find(k=>k.id===this.authorComponent);
      const id=existing?existing.id:free(`${f.kind==='source'?'V':f.kind==='resistor'?'R':'W'}${c.nextSerial++}`);
      this.authorNode=this.authorNode??circuit.nodes[0]?.id??null;
      // The descriptor is REBUILT for the chosen variant, so changing the type
      // rewrites the fields that variant actually carries rather than leaving a
      // stale voltage on a resistor or a stale resistance on a source.
      const built:ComponentDesc=f.kind==='source'
        ?{kind:'source',model:'ideal-dc-voltage',modelVersion:1,id,label:f.label,pos:a,neg:b,voltage:f.value}
        :f.kind==='resistor'
          ?{kind:'resistor',model:'linear-resistor',modelVersion:1,id,label:f.label,a,b,resistance:f.value,...(f.receiver?{heatReceiver:f.receiver}:{})}
          :{kind:'wire',model:'ideal-wire',modelVersion:1,id,label:f.label,a,b};
      circuit.components=[...circuit.components.filter(k=>k.id!==id),built];
      this.authorComponent=id;
    },'Circuit component authored'));
    on('a-cc-delete',()=>apply(c=>{deleteCircuitComponent(c,this.authorComponent!);this.authorComponent=null;},'Circuit component deleted'));
    on('a-cc-drop',()=>apply(c=>{delete c.circuit;this.authorNode=null;this.authorComponent=null;},'Circuit removed from the scene'));
    on('a-cc-cancel',()=>{this.buildControls();this.toast('Circuit form changes discarded; authored scene unchanged.',true);});

    for(const slot of [0,1] as const) on(`a-capture-${slot}`,()=>{
      const meter=this.meters[this.plotIndex];if(!meter)throw new Error('No live measurement to capture');
      const record=new Recorder().toRecord(this.author.authored); record.construction=this.author.authored;
      record.events=sortEvents(copy(this.runEvents.filter(e=>e.tick<=this.sim.tick)));
      const next=new ComparisonStore();next.load(this.comparisons.save());
      next.set(slot,captureRun(slot===0?'Run A':'Run B',this.author.authored,record,meter,this.sim.tick));
      localStorage.setItem('fg.comparisons',next.save());this.comparisons=next;this.driver.paused=true;this.refreshComparison();this.buildControls();this.paintPanels();this.toast(`Captured run ${slot===0?'A':'B'} with its own scene and input record.`,true);
    });
    on('a-comparison-load',()=>{const s=localStorage.getItem('fg.comparisons');if(!s)throw new Error('No saved comparison');this.comparisons.load(s);this.refreshComparison();this.buildControls();this.paintPanels();});
    on('a-comparison-clear',()=>{this.comparisons.clear();this.refreshComparison();this.buildControls();this.paintPanels();});
    for(const slot of [0,1] as const) on(`a-replay-${slot}`,()=>{
      const capture=this.comparisons.get(slot);if(!capture)return;
      this.author.replace(capture.construction);this.editing=false;this.authorRebuild();this.editing=false;
      requireRecordingBase(capture.input,this.author.authored);this.pending=sortEvents(copy(capture.input.events));this.runEvents=copy(capture.input.events);this.recorder.seq=Math.max(-1,...capture.input.events.map(e=>e.seq))+1;
      this.meters=[new Meter(capture.quantity,copy(capture.ref))];this.plotIndex=0;this.driver.paused=false;this.buildControls();this.paintInstruction();this.toast('Loaded captured base and numerical profile, then started its recorded input.',true);
    });
    const last=this.author.audit.at(-1);
    if(last) $('a-audit').textContent=`Latest edit: ${last.reason}; initial mechanical energy change ${last.deltaInitialEnergy.toPrecision(6)} J (separate audit, not work in this run).`;
  }

  private reset(): void {
    this.replaceWorld(this.currentSceneConstruction(), `reset to ${this.preset.label}`);
  }

  // -- acceptance helpers ----------------------------------------------------

  private currentRecord(ticks: number): InputRecord {
    // The record replays against the construction the recording STARTED from,
    // not against whatever the default happens to be.
    const r = this.recorder.toRecord(this.recorder.base ?? this.currentSceneConstruction(), 60);
    r.events = sortEvents(this.recorder.events).filter((e) => e.tick <= ticks);
    return r;
  }

  private doReplay(): void {
    const ticks = Math.max(60, ...this.recorder.events.map((e) => e.tick + 60));
    const rec = this.currentRecord(ticks);
    this.clearGrabUi();          // a replay drives the hand from the RECORD
    this.author.replace(rec.construction);
    this.sim.build(rec.construction);
    requireRecordingBase(rec, this.author.authored);
    this.runEvents = copy(rec.events);
    this.configureMeters();
    this.pending = sortEvents(rec.events);
    this.driver = new FixedStepDriver(this.sim, this.beforeTick);
    this.rebuildSceneGraph(); this.buildControls(); this.paintPanels();
    this.toast(`replaying ${rec.events.length} recorded interventions from tick 0 (live, ${ticks} ticks of input)`, true);
  }

  private verifyReplay(): void {
    const ticks = Math.max(120, ...this.recorder.events.map((e) => e.tick + 120));
    const rec = this.currentRecord(ticks);
    const a = replay(new SimWorld(), rec, ticks);
    const b = replay(new SimWorld(), rec, ticks);
    // Compared on the CANONICAL declared replay state, byte for byte — not on the
    // 32-bit fingerprint, which omits state and can collide.
    const same = a.length === b.length && a.every((c, i) => c.canonical === b[i].canonical && c.tick === b[i].tick);
    const bytes = a.reduce((n, c) => n + c.canonical.length, 0);
    console.log('[FP1] replay×2 checkpoints', a.map((c) => `${c.tick}:${c.hash.split(':')[0]}`).join(' '));
    this.reset();   // reset first: it raises its own toast, and the verdict must be the one left on screen
    this.toast(same
      ? `REPLAY PASS — ${a.length} checkpoints over ${ticks} ticks of recorded input, identical byte for byte over the declared replay state (${bytes} bytes compared, not a hash)`
      : `REPLAY FAIL — checkpoints diverged`, same);
  }

  private verifyRestore(): void {
    const ticks = 600, half = 300;
    const rec = this.currentRecord(ticks);
    const queue = sortEvents(rec.events);

    const unbroken = new SimWorld();
    unbroken.build(rec.construction);
    const want = new Map<number, string>();
    for (let i = 0; i < ticks; i++) { applyDue(unbroken, queue); unbroken.tickOnce(); if (unbroken.tick % 60 === 0) want.set(unbroken.tick, canonicalSimState(unbroken)); }

    const broken = new SimWorld();
    broken.build(rec.construction);
    for (let i = 0; i < half; i++) { applyDue(broken, queue); broken.tickOnce(); }
    const cp = takeCheckpoint(broken, {
      pendingEvents: queue.filter((e) => e.tick >= half), selectedId: null,
      settings: { paused: false, recording: this.recorder.recording }, seqCounter: this.recorder.seq,
      recordedEvents: this.recorder.events, recordingBase: this.recorder.base,
    });

    const fresh = new SimWorld();
    fresh.build(rec.construction);
    for (let i = 0; i < 13; i++) fresh.tickOnce();      // deliberately desynchronised
    const extras = restoreCheckpoint(fresh, cp);
    const q2 = sortEvents(extras.pendingEvents);
    let bad = 0;
    const lines: string[] = [];
    for (let i = 0; i < ticks - half; i++) {
      applyDue(fresh, q2); fresh.tickOnce();
      if (fresh.tick % 60 === 0) {
        const got = canonicalSimState(fresh), exp = want.get(fresh.tick)!;
        if (got !== exp) bad++;
        lines.push(`${fresh.tick} ${exp === got ? 'MATCH' : 'DIVERGED'} ${fresh.stateHash().split(':')[0]}`);
      }
    }
    console.log('[FP1] restore verification', lines.join(' | '));
    this.toast(bad === 0
      ? `RESTORE PASS — snapshot at tick ${half}, restored into a desynchronised world, continued to ${ticks}: identical byte for byte over the declared replay state at all ${lines.length} checkpoints (scope in README, not a whole-memory claim)`
      : `RESTORE FAIL — ${bad} checkpoints diverged`, bad === 0);
  }

  private perfTrial(): void {
    const c = defaultConstruction();
    // 60 dynamic bodies total: 5 already there (platform + 3 stack + 1 loose) + 55.
    const sim = new SimWorld();
    sim.build(c);
    for (let i = 0; i < 55; i++) {
      const e = { ...this.nextBlockFor(sim, i) };
      sim.addEntity(e);
    }
    const n = sim.dynamicIds().length;
    const ticks = 120 * 60;
    const t0 = performance.now();
    const per: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const a = performance.now();
      sim.tickOnce();
      per.push(performance.now() - a);
    }
    const total = performance.now() - t0;
    per.sort((x, y) => x - y);
    const mean = per.reduce((s, x) => s + x, 0) / per.length;
    const p = (q: number): number => per[Math.min(per.length - 1, Math.floor(q * per.length))];
    this.perfReport = `<b>Perf trial:</b> ${n} dynamic bodies, ${ticks} ticks (${ticks / 60} simulated s) in ${(total / 1000).toFixed(2)} s wall
      → real-time factor <b>${((ticks / 60) / (total / 1000)).toFixed(1)}×</b>.
      physics/tick: mean ${mean.toFixed(3)} ms, median ${p(0.5).toFixed(3)}, p95 ${p(0.95).toFixed(3)}, p99 ${p(0.99).toFixed(3)}, max ${per[per.length - 1].toFixed(3)} ms.
      Budget is 16.67 ms/tick.`;
    console.log('[FP1] perf', { bodies: n, ticks, totalMs: total, meanMs: mean, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: per[per.length - 1] });
    (window as unknown as Record<string, unknown>).__fp1perf = { bodies: n, ticks, totalMs: total, meanMs: mean, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: per[per.length - 1] };
    this.buildControls();
    this.toast('performance trial complete — see the panel below the buttons and the console', true);
  }

  private nextBlockFor(sim: SimWorld, i: number): EntityDesc {
    const id = sim.mintId();
    const ring = [[-0.8, -0.55], [0.8, -0.55], [-0.8, 0.55], [0.8, 0.55], [0, 0.62], [0, -0.62], [-0.4, 0], [0.4, 0]][i % 8];
    const h = 0.09 + 0.01 * (i % 3);
    return {
      id, label: `perf ${id}`, kinematics: 'dynamic',
      shape: { kind: 'box', hx: h, hy: h, hz: h },
      material: { mass: 0.5 + 0.2 * (i % 4), restitution: 0.1, friction: 0.6 },
      translation: { x: ring[0], y: 1.3 + 0.26 * Math.floor(i / 8), z: ring[1] },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 },
      colour: 0x6a8fb8,
    };
  }

  // -- painting --------------------------------------------------------------

  private paintHud(): void {
    const ft = this.frameTimes.slice(-120);
    const fps = ft.length ? 1000 / (ft.reduce((s, x) => s + x, 0) / ft.length) : 0;
    const pm = this.physicsTimes.slice(-120);
    const phys = pm.length ? pm.reduce((s, x) => s + x, 0) / pm.length : 0;
    const d = this.driver.stats;
    $('hud').innerHTML =
      `tick <b>${this.sim.tick}</b> · t = <b>${(this.sim.tick / 60).toFixed(2)} s</b> · ${this.driver.paused ? '<b>PAUSED</b>' : `${d.ticksThisFrame} tick/frame`}<br>` +
      `display <b>${fps.toFixed(0)} fps</b> · physics <b>${phys.toFixed(2)} ms/tick</b> (budget 16.67) · interp α ${d.alpha.toFixed(2)}<br>` +
      (this.autoPausedAt !== null && this.driver.paused
        ? `<b>paused at the declared t = ${this.autoPausedAt.toFixed(2)} s</b> (presentation only — press resume)<br>` : '') +
      `bodies <b>${this.sim.dynamicIds().length}</b> dynamic · medium <b>${this.sim.construction.environment.medium}</b>` +
      (this.driver.droppedTicks ? ` · <span class="warn">dropped ${this.driver.droppedTicks} ticks (${(this.driver.droppedTicks / 60).toFixed(2)} s of simulated time; cap ${MAX_CATCHUP_TICKS_PER_FRAME}/frame)</span>` : '') +
      (this.sim.foreignAccumulatorWrites ? `<br><span class="warn">foreign writes to the user-force accumulator: ${this.sim.foreignAccumulatorWrites}</span>` : '');
  }

  private paintPanels(): void {
    $('panels').innerHTML =
      this.renderMeasurement() +
      renderBodyPanel(this.sim, this.selectedId) +
      renderJointPanel(this.sim) +
      renderThermalPanel(this.sim) +
      renderCircuitPanel(this.sim) +
      renderElectricalView(this.sim, this.elecView) +
      renderHandPanel(this.sim) +
      renderSpringPanel(this.sim, this.selectedSpring) +
      renderEnergyPanel(this.sim.budget, this.sim.tick);
  }

  private toastTimer = 0;
  private toast(msg: string, ok: boolean): void {
    const t = $('toast');
    t.innerHTML = msg;
    t.className = `show${ok ? ' ok' : ''}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { t.className = ''; }, 6000);
  }
}

const SPRING_SEGMENTS = 40;

/** |v| for a plain {x,y,z}. Local so the UI does not reach into the sim helpers. */
function vlenLocal(v: Vec3): number { return Math.hypot(v.x, v.y, v.z); }

/** Linear interpolation of a uniformly sampled series at time t. */
function lerpAt(s: ReadonlyArray<{ t: number; value: number }>, t: number): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= t) {
      const f = (t - s[i - 1].t) / (s[i].t - s[i - 1].t);
      return s[i - 1].value + f * (s[i].value - s[i - 1].value);
    }
  }
  return s.length ? s[s.length - 1].value : NaN;
}

const app = new App();
(window as unknown as Record<string, unknown>).__fp1 = app;
app.start().catch((err) => {
  $('hud').textContent = `FAILED TO START: ${String(err)}`;
  console.error(err);
});

export { SI };
