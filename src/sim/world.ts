/**
 * FP1 — the simulation world: the adapter between application-owned authored
 * content and Rapier, which provisionally owns body motion, contact and
 * constraints (plan §2).
 *
 * ===========================================================================
 * THE FORCE-ACCUMULATOR DISCIPLINE  (plan §2, the requirement most likely to be
 * got wrong)
 * ===========================================================================
 * RAPIER'S ADDED FORCES PERSIST BETWEEN STEPS. A force added once keeps acting
 * on every subsequent step until it is reset. So before EVERY INTERNAL SUB-STEP we
 * CLEAR AND REBUILD OUR OWN accumulators from the current state.
 *
 * ===========================================================================
 * THE PUBLIC TICK IS FIXED AT 1/60 s AND IS SUBDIVIDED INTERNALLY.
 * ===========================================================================
 * One public tick = SI.SUBSTEPS engine steps of dt/SUBSTEPS, with our force laws
 * re-evaluated before each. Rapier's own sub-division is pinned to 1 so that the
 * refresh lands on every integration sub-step. Holding a force constant across N
 * engine sub-steps injects w·h²·omega² into the one-step determinant, with
 * w = 1 − (N+1)/(2N); at the shipped N = 4 that cancelled roughly half the
 * physical damping (D-1). At N = 1, w = 0 exactly. See D-8 in DEVIATIONS.md.
 *
 * "Our own" is enforced, not assumed:
 *   - `ForceRegistry` is the single writer of Rapier's user-force accumulator in
 *     this build. Every contribution carries an owner tag.
 *   - Before clearing, we COMPARE the engine's `userForce()`/`userTorque()` to
 *     what the registry applied last tick. A mismatch means somebody else wrote
 *     into the accumulator. We do NOT silently delete it: we record it in
 *     `foreignAccumulatorWrites` and surface it. Adding a new force-producing
 *     subsystem therefore means registering it here, not calling addForce behind
 *     the registry's back.
 *
 * GRAVITY IS NOT DUPLICATED. Gravity is Rapier's world gravity and is applied by
 * the engine. We never add a gravity force. We compute m·g only for the display
 * label and for gravitational potential energy.
 *
 * ENGINE DAMPING IS DISABLED, EXPLICITLY. linearDamping = angularDamping = 0 is
 * set on every body at creation. Nothing is left implicit. All velocity-dependent
 * loss in this build comes from force laws we wrote and can therefore account for.
 *
 * THE HAND IS AN EXTERNAL POWERED COMPLIANT ACTUATOR, NOT A FORCE THE WORLD OWNS.
 * It is registered here like any other contribution so the single-writer discipline
 * still holds, but its work is booked as SIGNED EXTERNAL WORK crossing the energy
 * boundary - never as owned dissipation, never as a frozen-edit intervention, and
 * it adds no potential to E_mech. See sim/hand.ts for the whole argument.
 *
 * SLEEPING IS DISABLED, EXPLICITLY (setCanSleep(false)). A sleeping body has its
 * velocity zeroed by the engine, which would remove kinetic energy through a
 * channel we neither own nor can estimate. Disabling it keeps the energy report
 * honest, at a stated performance cost.
 */

import { validateThermalCheckpoint, validateThermal, newThermalState, routeDamperHeat, routeResistorHeat, removeThermalBody, type ThermalState } from '../model/thermal';
import {
  accumulateTick, mergeNodes, newElectricalState, solveCircuit, validateElectricalCheckpoint,
  CIRCUIT_LIMITS, resistorsOf, sourcesOf,
  type CircuitDesc, type CircuitSolution, type ElectricalState, type NodeMerge,
} from '../model/circuit';
import RAPIER from '@dimforge/rapier3d-compat';
import { lfoValueAt, newLfoSpec, type LfoSpec, type LfoTarget } from '../model/lfo';
import {
  LIMITS,
  SI, vcross, vdot, vlen, vscale, vsub, vadd,
  type Quat, type Vec3,
} from '../model/units';
import {
  cloneConstruction, constructionSubsteps, shapeVolume,
  type Construction, type EntityDesc, type NumericsDesc, type SpringDesc, type SpringEndpoint,
} from '../model/construction';
import { validateJoint, type BodyPose, type JointDesc } from '../model/joints';
import { DEFAULT_CD, dragForce, dragK, effectiveArea, mediumDensity, terminalSpeed } from '../model/drag';
import {
  HAND, applyInvInertia, cloneHandState, effectiveMassBound, gainsFor, handForce,
  inertiaFrame, inverseEffectiveMass, newHandState, pushBounded,
  type HandGestureRow, type HandState, type HandTickRow, type InertiaFrame,
} from './hand';
import {
  emptyMechanicalEnergy, gravitationalPotential, newEnergyBudget, recomputeUnattributed,
  rotationalKE, springPotential,
  type EnergyBudget, type MechanicalEnergy,
} from '../model/energy';

/**
 * `hand-actuator` is an EXTERNAL POWERED ACTUATOR outside the world's energy
 * boundary. It is NOT a dissipation channel and NOT a passive spring, and its
 * work is never summed into owned dissipation. See sim/hand.ts.
 */
export type ForceOwner = 'air-drag' | 'spring-elastic' | 'spring-damper' | 'hand-actuator';

export interface ForceContribution {
  owner: ForceOwner;
  entityId: string;
  /** N, world frame. */
  force: Vec3;
  /** World point of application; null means the centre of mass. */
  point: Vec3 | null;
  /** Free-text provenance, e.g. the spring id. */
  via: string;
}

/** The registry is the SINGLE WRITER of Rapier's user force/torque accumulator. */
export class ForceRegistry {
  contributions: ForceContribution[] = [];
  clear(): void { this.contributions.length = 0; }
  add(c: ForceContribution): void { this.contributions.push(c); }
  /** Net force this tick from a given owner on a given body, N. */
  netFor(entityId: string, owner?: ForceOwner): Vec3 {
    let x = 0, y = 0, z = 0;
    for (const c of this.contributions) {
      if (c.entityId !== entityId) continue;
      if (owner && c.owner !== owner) continue;
      x += c.force.x; y += c.force.y; z += c.force.z;
    }
    return { x, y, z };
  }
}

interface EntityRuntime {
  desc: EntityDesc;
  bodyHandle: number;
  colliderHandle: number;
  /** kg/m². Cached ½·rho·C_d·A_eff for the current environment. */
  kDrag: number;
  /** kg. Read back from the engine, not assumed. */
  mass: number;
}

/**
 * JOINT RUNTIME. The engine handle lives HERE and in the checkpoint's mapping,
 * never in the authored `JointDesc`.
 */
interface JointRuntime {
  desc: JointDesc;
  jointHandle: number;
}

export interface SpringDiagnostics {
  id: string;
  length: number;        // m
  extension: number;     // m, + = stretched
  elasticForce: number;  // N, signed along n (a -> b); + = pulls b toward a
  damperForce: number;   // N, signed along n
  relSpeed: number;      // m/s along n, + = separating
  potential: number;     // J, ½·k·x² (declared elastic potential only)
  pointA: Vec3;
  pointB: Vec3;
}

export interface TickDiagnostics {
  tick: number;
  /** J removed by our drag law this tick (positive = removed). */
  dragWorkThisTick: number;
  /** J removed by our spring damper this tick (positive = removed). */
  damperWorkThisTick: number;
  /** J of SIGNED EXTERNAL work the hand did this tick. + = hand added energy. */
  handWorkThisTick: number;
  /** N, largest |F_hand| over the sub-steps of this tick. */
  handForceThisTick: number;
  foreignAccumulatorWrites: number;
}

const NEAR_ZERO_LENGTH = 1e-9;

export class SimWorld {
  rapier!: RAPIER.World;
  construction!: Construction;
  /** Insertion order of entity ids. Determinism depends on this order. */
  order: string[] = [];
  entities = new Map<string, EntityRuntime>();
  springs: SpringDesc[] = [];
  /**
   * AUTHORED JOINTS, in insertion order. Rapier's determinism guarantee is
   * conditioned on the same insertion order, so this list is appended to and
   * never reordered, exactly like `order` for bodies.
   */
  jointOrder: string[] = [];
  joints = new Map<string, JointRuntime>();
  registry = new ForceRegistry();
  budget: EnergyBudget = newEnergyBudget();
  thermal: ThermalState = {bodies:[],routed:[],exportedHeat:0};
  /**
   * BATCH 4 — THE ELECTRICAL ACCOUNTS. Runtime state: cumulative supplied energy
   * from an ideal EXTERNAL source, per-resistor dissipation, the routing ledger and
   * the explicitly outgoing unrouted total. NEVER part of an authored Construction.
   */
  electrical: ElectricalState = newElectricalState(undefined);

  /**
   * BATCH 5 — THE SWEEP. RUNTIME DRIVE STATE, never part of the authored document.
   *
   * The LFO is an EXTERNAL EXPERIMENTER TURNING A KNOB, with exactly the boundary
   * status of the hand: an outside agent acting ON the world. No energy cost of
   * turning it is modelled, because nothing in this world turns it.
   *
   * It is applied as an OVERRIDE at solve time and on the runtime spring copy. It
   * never writes `construction`, so "Save authored scene" saves the scene that was
   * authored, not wherever the knob happened to be when you pressed the button.
   */
  lfo: LfoSpec = newLfoSpec();
  /** The swept value in force at the CURRENT tick, or null when nothing is sweeping. */
  lfoCurrentValue: number | null = null;
  /**
   * THE CACHED ALGEBRAIC SOLUTION of the static authored topology, solved ONCE at
   * build. A resistive network is algebraic, so nothing re-solves per tick. Null
   * means either no circuit or a REJECTED solve — and a rejected solve accumulates
   * nothing and NEVER falls back on a previous good solution.
   */
  circuitSolution: CircuitSolution | null = null;
  /** The DERIVED equipotential merge, for display. Recomputed from the authored graph. */
  circuitMerge: NodeMerge | null = null;

  tick = 0;
  nextSerial = 1;
  /**
   * Internal fixed sub-steps per public tick. Public ticks stay 1/60 s; this is
   * the fixed internal subdivision, and OUR forces are refreshed on every one.
   * The tests vary it to demonstrate first-order convergence in h; nothing in the
   * UI does.
   */
  private subStepCount: number = SI.SUBSTEPS;
  get subSteps(): number { return this.subStepCount; }
  /**
   * The DECLARED profile of the construction currently built, or null when the
   * construction declared none — in which case the world runs the legacy M = 4.
   * Carried into the canonical comparison so a construction whose declared
   * profile disagreed with the live sub-step count could not hide.
   */
  get declaredNumerics(): NumericsDesc | null { return this.construction?.numerics ?? null; }
  set subSteps(n: number) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`subSteps must be a positive integer, got ${String(n)}`);
    this.subStepCount = n;
    if (this.rapier) this.configureStep();
  }
  /** s. The fixed internal sub-step actually handed to the engine. */
  get hSub(): number { return SI.DT / this.subStepCount; }
  /** Total user force/torque the registry applied last tick, per entity. */
  private lastApplied = new Map<string, { f: Vec3; t: Vec3 }>();
  springDiag: SpringDiagnostics[] = [];
  lastTickDiag: TickDiagnostics = {
    tick: 0, dragWorkThisTick: 0, damperWorkThisTick: 0,
    handWorkThisTick: 0, handForceThisTick: 0, foreignAccumulatorWrites: 0,
  };
  foreignAccumulatorWrites = 0;

  /**
   * THE HAND — an EXTERNAL, POWERED COMPLIANT ACTUATOR. Transient solver-side
   * state: it belongs in a CHECKPOINT and in the declared replay state, and it is
   * NEVER part of an authored Construction.
   */
  hand: HandState = newHandState();
  /** BOUNDED diagnostic history, one row per PUBLIC TICK. Never per sub-step. */
  handTickHistory: HandTickRow[] = [];
  /** BOUNDED per-gesture totals. */
  handGestureHistory: HandGestureRow[] = [];

  static async initEngine(): Promise<void> { await RAPIER.init(); }
  static engineVersion(): string { return RAPIER.version(); }

  // -------------------------------------------------------------------------
  // Construction -> engine
  // -------------------------------------------------------------------------

  build(c: Construction): void {
    validateThermal(c);
    // THE DECLARED NUMERICAL PROFILE IS READ BEFORE ANYTHING IS ALLOCATED, so an
    // unsupported one is REFUSED with nothing half-built. Absent means the legacy
    // M = 4 — old constructions keep their old configuration.
    const substeps = constructionSubsteps(c);
    if (this.rapier) this.rapier.free();
    this.construction = cloneConstruction(c);
    this.subStepCount = substeps;
    this.rapier = new RAPIER.World(this.construction.environment.gravity);
    this.configureStep();

    this.order = [];
    this.entities.clear();
    this.springs = this.construction.springs.map((s) => ({ ...s }));
    this.jointOrder = [];
    this.joints.clear();
    this.registry.clear();
    this.lastApplied.clear();
    this.tick = 0;
    this.nextSerial = this.construction.nextSerial;
    this.foreignAccumulatorWrites = 0;
    // A NEW WORLD CLEARS THE GRAB. Nothing may keep hauling a body that no longer
    // exists, or the same id in a different construction.
    this.hand = newHandState();
    this.handTickHistory = [];
    this.handGestureHistory = [];

    for (const e of this.construction.entities) this.insertEntity(e);
    // Joints AFTER every body exists: a joint names two bodies by application id.
    for (const j of this.construction.joints ?? []) this.insertJoint(j);

    this.thermal = newThermalState(c);
    // THE STATIC DC SOLVE, DONE ONCE. A rejected result is REJECTED: no accumulation
    // happens at all, and no earlier solution is reused in its place.
    this.circuitSolution = null; this.circuitMerge = null;
    if (this.construction.circuit) {
      const r = solveCircuit(this.construction.circuit);
      this.electrical = newElectricalState(this.construction.circuit, r.ok ? null : r.reason);
      if (r.ok) { this.circuitSolution = r.solution; this.circuitMerge = mergeNodes(this.construction.circuit); }
    } else {
      this.electrical = newElectricalState(undefined);
    }
    this.budget = newEnergyBudget();
    this.refreshSpringDiagnostics();
    this.budget.current = this.computeMechanicalEnergy();
    this.budget.baselineTotal = this.budget.current.total;
    recomputeUnattributed(this.budget);
  }

  /**
   * THE STEP CONFIGURATION, in one place.
   *
   * timestep = dt/subSteps            — the fixed INTERNAL sub-step.
   * numSolverIterations = 1           — REQUIRED, not a tuning choice. Rapier
   *   advances one step() as `numSolverIterations` sub-steps with user forces
   *   held constant across them; anything above 1 re-freezes our spring force
   *   inside the step and re-injects w·h²·omega² into the determinant (D-1).
   * numInternalPgsIterations = 1      — unchanged.
   */
  private configureStep(): void {
    this.rapier.timestep = this.hSub;      // Rapier stores it as f32
    this.rapier.numSolverIterations = 1;
    this.rapier.numInternalPgsIterations = 1;
  }

  private colliderDesc(e: EntityDesc): RAPIER.ColliderDesc {
    const s = e.shape;
    let cd: RAPIER.ColliderDesc;
    switch (s.kind) {
      case 'box': cd = RAPIER.ColliderDesc.cuboid(s.hx, s.hy, s.hz); break;
      case 'sphere': cd = RAPIER.ColliderDesc.ball(s.radius); break;
      case 'capsule': cd = RAPIER.ColliderDesc.capsule(s.halfHeight, s.radius); break;
    }
    cd.setRestitution(e.material.restitution).setFriction(e.material.friction);
    if (e.kinematics === 'dynamic') {
      // Density derived from the AUTHORED mass so the mass is exactly what the
      // user asked for; inertia then follows from the shape consistently.
      cd.setDensity(e.material.mass / shapeVolume(s));
    }
    return cd;
  }

  private insertEntity(e: EntityDesc): EntityRuntime {
    const desc = e.kinematics === 'dynamic' ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
    desc.setTranslation(e.translation.x, e.translation.y, e.translation.z)
      .setRotation(e.rotation)
      .setLinvel(e.linvel.x, e.linvel.y, e.linvel.z)
      .setAngvel(e.angvel)
      // ENGINE DAMPING DISABLED EXPLICITLY. Never implicit.
      .setLinearDamping(0)
      .setAngularDamping(0)
      // SLEEPING DISABLED EXPLICITLY — see the header note on energy honesty.
      .setCanSleep(false);
    const body = this.rapier.createRigidBody(desc);
    const collider = this.rapier.createCollider(this.colliderDesc(e), body);
    const rho = mediumDensity(this.construction.environment);
    const rt: EntityRuntime = {
      desc: e,
      bodyHandle: body.handle,
      colliderHandle: collider.handle,
      kDrag: e.kinematics === 'dynamic' ? dragK(e.shape, e.material.dragCd, rho) : 0,
      mass: body.mass(),
    };
    this.entities.set(e.id, rt);
    this.order.push(e.id);
    return rt;
  }

  /**
   * Build one authored joint. HINGE -> Rapier revolute, SLIDER -> Rapier
   * prismatic. No motor, no limit, no joint spring is configured on either, so
   * nothing here can be confused with the passive spring model.
   *
   * A joint that does not validate is REFUSED and surfaced by throwing at build
   * time rather than silently dropped — a construction whose joints half-built
   * would be a different construction from the one that was authored.
   */
  private insertJoint(j: JointDesc): JointRuntime {
    // THE MISALIGNMENT GATE RUNS HERE TOO, against the poses the bodies were just
    // built with, so a misaligned ball or fixed connection can never reach the
    // solver by ANY path. It is refused, never pulled into place.
    const poseOf = (id: string): BodyPose | undefined => {
      const rt = this.entities.get(id);
      return rt ? { translation: rt.desc.translation, rotation: rt.desc.rotation } : undefined;
    };
    const issues = validateJoint(j, new Set(this.entities.keys()), poseOf);
    if (issues.length) throw new Error(`refusing construction: ${issues.map((i) => i.message).join('; ')}`);
    const a = this.body(j.bodyA), b = this.body(j.bodyB);
    // Each variant gets the constructor that MEANS what it says. A ball is a
    // spherical joint with no axis and no frame; a fixed connection is a fixed
    // joint carrying BOTH connection frames. Neither borrows the axis field.
    const params = j.kind === 'hinge' ? RAPIER.JointData.revolute(j.anchorA, j.anchorB, j.axis)
      : j.kind === 'slider' ? RAPIER.JointData.prismatic(j.anchorA, j.anchorB, j.axis)
      : j.kind === 'ball' ? RAPIER.JointData.spherical(j.anchorA, j.anchorB)
      : RAPIER.JointData.fixed(j.anchorA, j.frameA, j.anchorB, j.frameB);
    const joint = this.rapier.createImpulseJoint(params, a, b, true);
    const rt: JointRuntime = { desc: j, jointHandle: joint.handle };
    this.joints.set(j.id, rt);
    this.jointOrder.push(j.id);
    return rt;
  }

  /** The authored joints, in insertion order. */
  jointDescs(): JointDesc[] {
    return this.jointOrder.map((id) => this.joints.get(id)!.desc);
  }

  /**
   * Add an entity at runtime. INSERTION ORDER IS APPENDED TO, never reordered:
   * Rapier's determinism guarantee is conditioned on the same insertion/removal
   * order, and `this.order` is that order.
   */
  addEntity(e: EntityDesc): void {
    this.construction.entities.push(e);
    if(e.thermal) this.thermal.bodies.push({id:e.id,heat:0,backflowCount:0});
    this.insertEntity(e);
  }

  /** Remove an entity and every spring attached to it. */
  removeEntity(id: string): void {
    const rt = this.entities.get(id);
    if (!rt) return;
    removeThermalBody(this.thermal,id);
    for(const s of [...this.springs,...this.construction.springs]) if(s.heatReceiver===id) delete s.heatReceiver;
    // A DELETED RECEIVER CLEARS ELECTRICAL ROUTING TOO, not only the mechanical
    // kind. The heat already transferred is preserved as exported heat above.
    for(const x of this.construction.circuit?.components ?? []) if(x.kind==='resistor' && x.heatReceiver===id) delete x.heatReceiver;
    // DELETING THE GRABBED BODY MUST CLEAR THE GRAB, or the next sub-step would
    // look up a handle that is gone.
    if (this.hand.active && this.hand.entityId === id) this.endGrab();
    this.springs = this.springs.filter((s) =>
      !(s.a.kind === 'body' && s.a.entityId === id) && !(s.b.kind === 'body' && s.b.entityId === id));
    this.construction.springs = this.construction.springs.filter((s) =>
      !(s.a.kind === 'body' && s.a.entityId === id) && !(s.b.kind === 'body' && s.b.entityId === id));
    // Rapier removes the impulse joints attached to a removed body itself; our
    // own record of them has to go too, or `jointDescs()` would keep naming a
    // joint the engine no longer holds.
    for (const jid of [...this.jointOrder]) {
      const jrt = this.joints.get(jid)!;
      if (jrt.desc.bodyA !== id && jrt.desc.bodyB !== id) continue;
      this.joints.delete(jid);
      this.jointOrder = this.jointOrder.filter((x) => x !== jid);
    }
    if (this.construction.joints) {
      this.construction.joints = this.construction.joints.filter((j) => j.bodyA !== id && j.bodyB !== id);
    }
    this.rapier.removeRigidBody(this.rapier.getRigidBody(rt.bodyHandle));
    this.entities.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.construction.entities = this.construction.entities.filter((x) => x.id !== id);
    this.lastApplied.delete(id);
  }

  /**
   * RESTORE COVERS ENGINE STATE **AND** APPLICATION STATE.
   * The Rapier snapshot supplies the engine half; everything in `cp.app` supplies
   * the application half — ids and their handle mappings, the serial counter,
   * spring definitions, the environment, and the energy budget. Restoring only
   * the engine would leave the id counter, the budget and the mappings stale, and
   * the continuation would then diverge from the unbroken run.
   */
  adoptCheckpoint(cp: {
    solverSnapshotBase64: string;
    app: {
      tick: number; nextSerial: number; order: string[];
      handles: Array<{ id: string; bodyHandle: number; colliderHandle: number }>;
      /** AUTHORED joint identity -> ENGINE handle. The mapping lives here, never in a construction. */
      jointHandles?: Array<{ id: string; jointHandle: number }>;
      joints?: JointDesc[];
      entities: EntityDesc[]; springs: SpringDesc[];
      environment: Construction['environment'];
      budget: EnergyBudget; foreignAccumulatorWrites: number;
      thermal?: ThermalState;
      /** THE AUTHORED CIRCUIT, and its RUNTIME accounts. The accounts live here, never in a construction. */
      circuit?: Construction['circuit'];
      electrical?: ElectricalState;
      /** TRANSIENT HAND STATE. In the checkpoint; never in a construction. */
      hand?: HandState;
      handTickHistory?: HandTickRow[];
      handGestureHistory?: HandGestureRow[];
      /**
       * THE DECLARED NUMERICAL PROFILE OF THE RUN THIS CHECKPOINT CAME FROM.
       * ABSENT MEANS THE LEGACY M = 4: a checkpoint written before profiles
       * existed restores to the behaviour it was written under, which is the
       * whole point of recording it. Restoring without it would silently
       * reinterpret a finer run at the coarse step and diverge from the
       * unbroken run in a way no body-state comparison would explain — exactly
       * the class of defect D-9 and the gravity restore were about.
       */
      numerics?: NumericsDesc | null;
    };
  }, decode: (b64: string) => Uint8Array): void {
    validateThermalCheckpoint({format:'fp1-construction',formatVersion:1,name:'checkpoint',nextSerial:cp.app.nextSerial,entities:cp.app.entities,springs:cp.app.springs,environment:cp.app.environment},cp.app.thermal);
    validateElectricalCheckpoint(cp.app.circuit,cp.app.electrical);
    const restored = RAPIER.World.restoreSnapshot(decode(cp.solverSnapshotBase64));
    if (this.rapier) this.rapier.free();
    this.rapier = restored;
    // THE PROFILE IS RESTORED BEFORE configureStep(), because configureStep()
    // writes `timestep = dt/subSteps` into the engine. An unsupported profile in
    // a checkpoint is REFUSED here, not substituted.
    this.subStepCount = constructionSubsteps({ numerics: cp.app.numerics ?? undefined });
    this.configureStep();

    const base: Construction = this.construction ?? {
      format: 'fp1-construction', formatVersion: 1, name: 'restored',
      environment: cp.app.environment, entities: [], springs: [], nextSerial: 1,
    };
    this.construction = {
      ...base,
      environment: JSON.parse(JSON.stringify(cp.app.environment)) as Construction['environment'],
      entities: JSON.parse(JSON.stringify(cp.app.entities)) as EntityDesc[],
      springs: JSON.parse(JSON.stringify(cp.app.springs)) as SpringDesc[],
      joints: JSON.parse(JSON.stringify(cp.app.joints ?? [])) as JointDesc[],
      // The declared profile travels with the construction, so a world restored
      // into a fresh app reports the SAME declared profile it is running.
      numerics: cp.app.numerics ? { ...cp.app.numerics } : undefined,
      nextSerial: cp.app.nextSerial,
    };
    // AN ABSENT CIRCUIT MUST STAY ABSENT, not become a present-but-undefined key:
    // `canonical` refuses undefined at any depth, and a construction with no
    // circuit genuinely has no circuit field.
    if (cp.app.circuit) this.construction.circuit = structuredClone(cp.app.circuit);
    else delete this.construction.circuit;
    // GRAVITY IS RESTORED EXPLICITLY from the checkpoint's environment rather
    // than trusted to the snapshot blob. Gravity is now user-editable, so a
    // restore that silently kept the running world's g would diverge from the
    // unbroken run in a way no body-state comparison would explain.
    this.rapier.gravity = { ...cp.app.environment.gravity };
    this.order = [...cp.app.order];
    this.springs = JSON.parse(JSON.stringify(cp.app.springs)) as SpringDesc[];
    this.entities.clear();
    const byId = new Map(cp.app.entities.map((e) => [e.id, e]));
    for (const h of cp.app.handles) {
      const desc = byId.get(h.id)!;
      const b = this.rapier.getRigidBody(h.bodyHandle);
      this.entities.set(h.id, {
        desc, bodyHandle: h.bodyHandle, colliderHandle: h.colliderHandle,
        kDrag: 0, mass: b.mass(),
      });
    }
    // JOINTS: the engine's own snapshot carries the impulse joints; what it does
    // not carry is WHICH AUTHORED JOINT each handle is. That identity comes from
    // the checkpoint's mapping, exactly as body identity does.
    this.joints.clear();
    this.jointOrder = [];
    const jById = new Map((cp.app.joints ?? []).map((j) => [j.id, j]));
    for (const h of cp.app.jointHandles ?? []) {
      const desc = jById.get(h.id);
      if (!desc) continue;
      this.joints.set(h.id, { desc, jointHandle: h.jointHandle });
      this.jointOrder.push(h.id);
    }
    this.refreshDragCoefficients();
    this.tick = cp.app.tick;
    this.nextSerial = cp.app.nextSerial;
    this.thermal = cp.app.thermal ? structuredClone(cp.app.thermal) : newThermalState(this.construction);
    // THE CIRCUIT IS RE-SOLVED FROM THE RESTORED AUTHORED GRAPH — the solution is
    // derived, so it is never carried in the checkpoint — while the CUMULATIVE
    // ACCOUNTS are restored, so a checkpoint resumes accumulated energies rather
    // than silently restarting them at zero.
    this.circuitSolution = null; this.circuitMerge = null;
    this.electrical = cp.app.electrical ? structuredClone(cp.app.electrical) : newElectricalState(this.construction.circuit);
    if (this.construction.circuit) {
      const r = solveCircuit(this.construction.circuit);
      this.electrical.rejected = r.ok ? null : r.reason;
      if (r.ok) { this.circuitSolution = r.solution; this.circuitMerge = mergeNodes(this.construction.circuit); }
    }
    this.budget = JSON.parse(JSON.stringify(cp.app.budget)) as EnergyBudget;
    if (this.budget.handWorkExternal === undefined) this.budget.handWorkExternal = 0;
    this.foreignAccumulatorWrites = cp.app.foreignAccumulatorWrites;
    // THE CHECKPOINT INCLUDES THE TRANSIENT HAND. A mid-grab restore that dropped
    // it would silently release the body and diverge from the unbroken run.
    this.hand = cp.app.hand ? cloneHandState(cp.app.hand) : newHandState();
    this.handTickHistory = cp.app.handTickHistory ? cp.app.handTickHistory.map((r) => ({ ...r })) : [];
    this.handGestureHistory = cp.app.handGestureHistory ? cp.app.handGestureHistory.map((r) => ({ ...r })) : [];
    if (this.hand.active && !this.entities.has(this.hand.entityId)) this.hand = newHandState();

    // The user-force accumulator is cleared and our ownership record zeroed. This
    // is dynamically inert (every tick clears and rebuilds it anyway) and it makes
    // the first post-restore ownership check meaningful rather than a false alarm.
    this.lastApplied.clear();
    this.registry.clear();
    for (const id of this.dynamicIds()) {
      const b = this.body(id);
      b.resetForces(false);
      b.resetTorques(false);
    }
    this.refreshBudget();
  }

  body(id: string): RAPIER.RigidBody {
    const rt = this.entities.get(id);
    if (!rt) throw new Error(`no entity ${id}`);
    return this.rapier.getRigidBody(rt.bodyHandle);
  }
  runtime(id: string): EntityRuntime {
    const rt = this.entities.get(id);
    if (!rt) throw new Error(`no entity ${id}`);
    return rt;
  }
  dynamicIds(): string[] {
    return this.order.filter((id) => this.entities.get(id)!.desc.kinematics === 'dynamic');
  }
  mintId(prefix = 'b'): string { return `${prefix}${this.nextSerial++}`; }

  // -------------------------------------------------------------------------
  // THE HAND — external powered compliant actuator (sim/hand.ts)
  // -------------------------------------------------------------------------

  /** World position of a BODY-LOCAL point. The force acts here, not at the com. */
  grabPointWorld(id: string, local: Vec3): Vec3 {
    return rotateLocal(this.body(id), local);
  }

  /** Inertia data for our own I_world^-1 algebra. */
  inertiaFrameOf(id: string): InertiaFrame {
    const b = this.body(id);
    return inertiaFrame(this.runtime(id).mass, b.rotation(), b.principalInertiaLocalFrame(), b.principalInertia());
  }

  /**
   * kg. The effective response along `n` INCLUDING ROTATIONAL INERTIA:
   *     1/m_eff = 1/m + (r x n)^T . I_world^-1 . (r x n)
   * Exposed so the witness can test the formula rather than trust it.
   */
  effectiveMassAlong(id: string, local: Vec3, n: Vec3): number {
    const b = this.body(id);
    const r = vsub(this.grabPointWorld(id, local), b.worldCom());
    return 1 / inverseEffectiveMass(this.inertiaFrameOf(id), r, n);
  }

  /**
   * BEGIN A GESTURE. THIS MOVES NOTHING — no teleport, no impulse, no frozen-edit
   * energy. It only records what the hand is holding and which gains the declared
   * controller margin allows. It is therefore deliberately NOT routed through
   * `intervene`: its frozen ΔE is identically zero.
   */
  beginGrab(entityId: string, localPoint: Vec3, target: Vec3): string | null {
    const rt = this.entities.get(entityId);
    if (!rt) return `grab: no entity ${entityId}`;
    if (rt.desc.kinematics !== 'dynamic') return `grab refused: ${entityId} is ${rt.desc.kinematics}, not dynamic`;
    if (this.hand.active) this.endGrab();
    this.hand = {
      ...newHandState(),
      active: true,
      entityId,
      localPoint: { ...localPoint },
      target: { ...target },
      gestureId: this.hand.gestureId + 1,
    };
    // ONE implementation of the guard, shared with `refreshHandGains` below, so
    // the gains a gesture starts with and the gains it is re-evaluated to can
    // never drift apart.
    this.refreshHandGains();
    return null;
  }

  /**
   * RE-EVALUATE THE GAIN GUARD ON THE BODY CURRENTLY HELD.
   *
   * `gainsFor` depends on the held body's MASS AND INERTIA, and this build lets
   * the user change both, mid-gesture, through the supported `setMass`
   * intervention (and through a checkpoint restored mid-grab followed by one).
   * Evaluating the guard only at `beginGrab` therefore left it STALE-ABLE: the
   * body got lighter, `hand.kD/m` rose without limit, and every later sub-step
   * kept integrating the old gains. At h = 1/240 s, a 1.5 kg body taken to
   * 0.05 kg while held ran at gamma·h = 2.0 against a declared 0.5 — past
   * Jury's own boundary for this map. See EXPECTATIONS-DM1-STALE-GUARD.md P-0
   * and DEVIATIONS.md D-27.
   *
   * Of recompute / release / refuse, this build RECOMPUTES: refusing would newly
   * forbid an always-supported edit merely because something is held, and
   * releasing would drop a body the user is holding as a side effect of a
   * slider. Recomputing is what `beginGrab` already does, applied at the only
   * other moment the guard's inputs can change.
   *
   * It touches ONLY `kP/kD/fMax/gainScale/mEffBound` — all of them already
   * inside `REPLAY_STATE_SCOPE.simIn` and already in `canonicalSimState`, and it
   * runs inside the SAME intervention as the mass change, so replay (which
   * drives the identical `applyEvent` path) reproduces it and no sub-step can
   * ever see the new inertia against the old gains. It moves nothing and changes
   * no mechanical energy: the gesture, its id, its accumulated work and its
   * attachment point all survive untouched.
   *
   * Returns true when an active grab was re-evaluated.
   */
  refreshHandGains(): boolean {
    const h = this.hand;
    if (!h.active || !this.entities.has(h.entityId)) return false;
    const b = this.body(h.entityId);
    const r = vsub(rotateLocal(b, h.localPoint), b.worldCom());
    const mEffBound = effectiveMassBound(this.inertiaFrameOf(h.entityId), r);
    const g = gainsFor(mEffBound, this.hSub);
    h.mEffBound = mEffBound;
    h.kP = g.kP; h.kD = g.kD; h.fMax = g.fMax; h.gainScale = g.gainScale;
    return true;
  }

  /** Move the resolved WORLD-SPACE target. Never a screen coordinate. */
  moveGrab(target: Vec3): string | null {
    if (!this.hand.active) return 'grabMove: no active grab';
    this.hand.target = { ...target };
    return null;
  }

  /**
   * RELEASE. The hand force simply stops being added on the next sub-step.
   * NO IMPULSE IS APPLIED and no velocity is touched, so the body keeps exactly
   * the momentum it had.
   */
  endGrab(): void {
    const h = this.hand;
    if (h.active) {
      pushBounded(this.handGestureHistory, {
        gestureId: h.gestureId, entityId: h.entityId, ticks: h.gestureTicks,
        workJ: h.gestureWork, peakForceN: h.gesturePeakForce, gainScale: h.gainScale,
      }, HAND.GESTURE_HISTORY);
    }
    this.hand = {
      ...newHandState(),
      gestureId: h.gestureId,
      gestureWork: h.gestureWork,
      gestureTicks: h.gestureTicks,
      gesturePeakForce: h.gesturePeakForce,
      gestureResidualPrediction: h.gestureResidualPrediction,
    };
  }

  // -------------------------------------------------------------------------
  // Spring geometry
  // -------------------------------------------------------------------------

  private endpointWorld(ep: SpringEndpoint): { p: Vec3; v: Vec3; id: string | null } {
    if (ep.kind === 'world') return { p: ep.point, v: { x: 0, y: 0, z: 0 }, id: null };
    const b = this.body(ep.entityId);
    const p = rotateLocal(b, ep.localPoint);
    const v = b.velocityAtPoint(p);
    return { p, v, id: ep.entityId };
  }

  refreshSpringDiagnostics(): void {
    this.springDiag = this.springs.map((s) => this.springState(s));
  }

  springState(s: SpringDesc): SpringDiagnostics {
    const A = this.endpointWorld(s.a);
    const B = this.endpointWorld(s.b);
    const d = vsub(B.p, A.p);
    const L = vlen(d);
    if (L < NEAR_ZERO_LENGTH) {
      return {
        id: s.id, length: L, extension: -s.restLength, elasticForce: 0, damperForce: 0,
        relSpeed: 0, potential: springPotential(s.stiffness, -s.restLength), pointA: A.p, pointB: B.p,
      };
    }
    const n = vscale(d, 1 / L);
    const x = L - s.restLength;
    const relSpeed = vdot(vsub(B.v, A.v), n);
    return {
      id: s.id,
      length: L,
      extension: x,
      elasticForce: -s.stiffness * x,     // signed along n, acting on endpoint b
      damperForce: -s.damping * relSpeed, // signed along n, acting on endpoint b
      relSpeed,
      potential: springPotential(s.stiffness, x),
      pointA: A.p,
      pointB: B.p,
    };
  }

  // -------------------------------------------------------------------------
  // Energy
  // -------------------------------------------------------------------------

  computeMechanicalEnergy(): MechanicalEnergy {
    const out = emptyMechanicalEnergy();
    // U_grav = -m (g . r), datum at the world ORIGIN and fixed there. Written in
    // the general vector form because gravity is editable: see energy.ts.
    const g = this.construction.environment.gravity;
    for (const id of this.order) {
      const rt = this.entities.get(id)!;
      if (rt.desc.kinematics !== 'dynamic') continue;
      const b = this.rapier.getRigidBody(rt.bodyHandle);
      const v = b.linvel();
      const m = rt.mass;
      const kt = 0.5 * m * vdot(v, v);
      const kr = rotationalKE(b.angvel(), b.rotation(), b.principalInertiaLocalFrame(), b.principalInertia());
      const pe = gravitationalPotential(m, g, b.worldCom());
      out.keTranslational += kt;
      out.keRotational += kr;
      out.gravitationalPotential += pe;
      out.perBody.push({ id, kineticTranslational: kt, kineticRotational: kr, gravitationalPotential: pe });
    }
    for (const s of this.springs) out.springPotential += this.springState(s).potential;
    out.total = out.keTranslational + out.keRotational + out.gravitationalPotential + out.springPotential;
    return out;
  }

  /**
   * SET WORLD GRAVITY. The engine applies gravity, so this is the one place it
   * changes, and both the authored environment and the live engine world are
   * updated together.
   *
   * IT MOVES NOTHING AND CHANGES NO VELOCITY. What it does change, instantly, is
   * gravitational potential energy under the DECLARED, FIXED datum at the world
   * origin: dU = -sum_i m_i ((g_new - g_old) . r_i). The caller wraps this in
   * `intervene`, so that change is booked to the intervention that caused it and
   * can never be mistaken for solver drift or land in UNATTRIBUTED.
   */
  setGravity(g: Vec3): void {
    this.construction.environment.gravity = { x: g.x, y: g.y, z: g.z };
    this.rapier.gravity = { x: g.x, y: g.y, z: g.z };
  }

  /** Recompute E_mech and the UNATTRIBUTED remainder from the identity. */
  refreshBudget(): void {
    this.refreshSpringDiagnostics();
    this.budget.current = this.computeMechanicalEnergy();
    recomputeUnattributed(this.budget);
  }

  /**
   * Run `fn` with the world frozen and book the resulting change in resolved
   * mechanical energy as an EXPLICIT INTERVENTION, so it can never be mistaken
   * for solver drift.
   */
  intervene(kind: EnergyBudget['interventions'][number]['kind'], target: string, seq: number, detail: string, fn: () => void): void {
    const before = this.computeMechanicalEnergy().total;
    fn();
    this.refreshSpringDiagnostics();
    const after = this.computeMechanicalEnergy().total;
    const d = after - before;
    this.budget.interventionsTotal += d;
    this.budget.interventions.push({ tick: this.tick, seq, kind, target, deltaEmech: d, detail });
    this.refreshBudget();
  }

  // -------------------------------------------------------------------------
  // THE TICK
  // -------------------------------------------------------------------------

  /**
   * ONE PUBLIC FIXED TICK = `subSteps` INTERNAL FIXED SUB-STEPS OF dt/subSteps,
   * with our force accumulators cleared and REBUILT FROM THE CURRENT STATE before
   * every one of them.
   *
   * The public tick stays 1/60 s and inputs stay keyed by (tick, seq); a fixed
   * public tick does not forbid a fixed internal subdivision. Rapier's own
   * sub-division is pinned to 1 so that the refresh lands on every integration
   * sub-step: freezing a force across N engine sub-steps injects
   * w·h²·omega² into the one-step determinant with w = 1 − (N+1)/(2N), and only
   * N = 1 gives w = 0. See D-1/D-8 in DEVIATIONS.md.
   */
  /**
   * Every parameter this world will let a sweep drive, read from the LIVE scene.
   * Ranges are the model's own declared limits: a sweep outside them is REFUSED by
   * `validateLfo`, never clamped, so the printed bounds always mean what they say.
   */
  lfoTargets(): LfoTarget[] {
    const out: LfoTarget[] = [];
    const c = this.construction.circuit;
    if (c) {
      for (const r of resistorsOf(c)) {
        out.push({ key: `resistance:${r.id}`, kind: 'resistance', id: r.id,
          label: `${r.label} (${r.id}) — resistance`, unit: 'Ω', current: r.resistance,
          min: CIRCUIT_LIMITS.minResistance, max: CIRCUIT_LIMITS.maxResistance });
      }
      for (const v of sourcesOf(c)) {
        out.push({ key: `emf:${v.id}`, kind: 'emf', id: v.id,
          label: `${v.label} (${v.id}) — source EMF`, unit: 'V', current: v.voltage,
          min: -CIRCUIT_LIMITS.maxVoltage, max: CIRCUIT_LIMITS.maxVoltage });
      }
    }
    for (const sp of this.construction.springs) {
      out.push({ key: `stiffness:${sp.id}`, kind: 'stiffness', id: sp.id,
        label: `${sp.id} — spring stiffness`, unit: 'N/m', current: sp.stiffness,
        min: LIMITS.stiffnessMin, max: LIMITS.stiffnessMax });
      out.push({ key: `damping:${sp.id}`, kind: 'damping', id: sp.id,
        label: `${sp.id} — spring damping`, unit: 'N·s/m', current: sp.damping,
        min: LIMITS.dampingMin, max: LIMITS.dampingMax });
    }
    return out;
  }

  lfoTarget(): LfoTarget | null {
    return this.lfo.targetKey ? (this.lfoTargets().find((t) => t.key === this.lfo.targetKey) ?? null) : null;
  }

  /**
   * Put the swept value in force for THIS tick. Called at the top of `tickOnce`,
   * so the value that drives the tick is the value reported for the tick.
   *
   * A circuit parameter triggers a FRESH SOLVE of a circuit built with the one
   * value replaced. The authored circuit is not mutated. Every tick is therefore
   * an INDEPENDENT DC STEADY-STATE SOLVE: there is no capacitance, no inductance
   * and no transient here, so a fast sweep is a sequence of unrelated steady
   * states rather than a claim about a real circuit driven fast.
   *
   * A rejected solve is REJECTED: the previous solution is NOT reused, and no
   * Joule accumulation happens for that tick.
   */
  private applyLfoForTick(): void {
    const t = this.lfo.enabled ? this.lfoTarget() : null;
    if (!t) { this.lfoCurrentValue = null; return; }
    const v = lfoValueAt(this.lfo, this.tick);
    this.lfoCurrentValue = v;
    if (t.kind === 'stiffness' || t.kind === 'damping') {
      const sp = this.springs.find((x) => x.id === t.id);
      if (sp) { if (t.kind === 'stiffness') sp.stiffness = v; else sp.damping = v; }
      return;
    }
    const c = this.construction.circuit;
    if (!c) return;
    const swept: CircuitDesc = {
      nodes: c.nodes,
      components: c.components.map((k) => {
        if (k.id !== t.id) return k;
        if (t.kind === 'resistance' && k.kind === 'resistor') return { ...k, resistance: v };
        if (t.kind === 'emf' && k.kind === 'source') return { ...k, voltage: v };
        return k;
      }),
    };
    this.sweptCircuit = swept;
    const r = solveCircuit(swept);
    this.electrical.rejected = r.ok ? null : r.reason;
    if (r.ok) { this.circuitSolution = r.solution; this.circuitMerge = mergeNodes(swept); }
    else { this.circuitSolution = null; this.circuitMerge = null; }
  }

  /**
   * The circuit AS SOLVED this tick — the authored one, or the swept override when
   * a sweep is driving a circuit parameter. Accumulation and the drawing both read
   * this, so the numbers shown are the numbers used.
   */
  sweptCircuit: CircuitDesc | null = null;

  /**
   * Put the AUTHORED circuit back in force. Called when a sweep is switched off, so
   * the numbers on screen return to the authored ones immediately rather than
   * keeping whichever swept value happened to be current at the moment it stopped.
   */
  resolveAuthoredCircuit(): void {
    this.sweptCircuit = null;
    this.lfoCurrentValue = null;
    const c = this.construction.circuit;
    if (!c) { this.circuitSolution = null; this.circuitMerge = null; return; }
    const r = solveCircuit(c);
    this.electrical.rejected = r.ok ? null : r.reason;
    if (r.ok) { this.circuitSolution = r.solution; this.circuitMerge = mergeNodes(c); }
    else { this.circuitSolution = null; this.circuitMerge = null; }
  }

  solvedCircuit(): CircuitDesc | null {
    return (this.lfo.enabled && this.sweptCircuit) ? this.sweptCircuit : (this.construction.circuit ?? null);
  }

  tickOnce(): void {
    this.applyLfoForTick();
    let foreign = 0, dragW = 0, damperW = 0, handW = 0, handF = 0;
    const wasActive = this.hand.active;
    for (let i = 0; i < this.subSteps; i++) {
      const r = this.subStep();
      foreign += r.foreign; dragW += r.dragW; damperW += r.damperW;
      handW += r.handW; handF = Math.max(handF, r.handF);
    }
    this.tick++;

    if (dragW > 0 || damperW > 0) this.budget.nonDissipativeTicks++;
    this.budget.dissipatedDrag += -dragW;
    this.budget.dissipatedSpringDamper += -damperW;

    // SIGNED EXTERNAL WORK. NOT dissipation, NOT an intervention, NOT heat.
    // It is a source term crossing the world's energy boundary.
    this.budget.handWorkExternal += handW;
    if (wasActive) {
      this.hand.gestureWork += handW;
      this.hand.gestureTicks++;
      this.hand.gesturePeakForce = Math.max(this.hand.gesturePeakForce, handF);
      // BOUNDED history: ONE ROW PER PUBLIC TICK, ring buffer of HAND.TICK_HISTORY.
      pushBounded(this.handTickHistory,
        { tick: this.tick, forceN: handF, workJ: handW, saturated: this.hand.lastSaturated },
        HAND.TICK_HISTORY);
    }

    // ---------------------------------------------------------------------
    // BATCH 4 — JOULE ACCUMULATION, EXACTLY ONCE PER PUBLIC TICK, USING SI.DT.
    // Independent of `subSteps` and of the display rate. Pause runs none of this;
    // a single step runs it exactly once. A REJECTED solve accumulates NOTHING.
    // ---------------------------------------------------------------------
    const solvedC = this.solvedCircuit();
    if (solvedC && this.circuitSolution && !this.electrical.rejected) {
      for (const r of accumulateTick(this.electrical, solvedC, this.circuitSolution)) {
        routeResistorHeat(this.thermal, r.componentId, r.receiver, r.heat);
      }
    }

    this.lastTickDiag = {
      tick: this.tick, dragWorkThisTick: -dragW, damperWorkThisTick: -damperW,
      handWorkThisTick: handW, handForceThisTick: handF, foreignAccumulatorWrites: foreign,
    };
    this.refreshBudget();
  }

  /**
   * One internal sub-step: ownership check, clear, rebuild, apply, advance h, own
   * the work.
   *
   * PUBLIC ONLY SO THE DM1 WITNESS CAN USE THE CLOSED-FORM SINGLE-SUB-STEP MAP.
   * `tickOnce` is still the only thing the UI and the driver ever call, and it is
   * still the only path that books the budget. A caller that steps here directly
   * gets the raw per-sub-step work numbers back and owns its own accounting.
   */
  subStep(): { foreign: number; dragW: number; damperW: number; handW: number; handF: number } {
    const dyn = this.dynamicIds();

    // (1) OWNERSHIP CHECK, BEFORE CLEARING. Rapier's accumulator still holds what
    //     we put in last tick. Anything else in there is somebody else's and is
    //     REPORTED, not silently deleted.
    let foreign = 0;
    for (const id of dyn) {
      const b = this.body(id);
      const mine = this.lastApplied.get(id) ?? { f: { x: 0, y: 0, z: 0 }, t: { x: 0, y: 0, z: 0 } };
      const uf = b.userForce(), ut = b.userTorque();
      const scale = Math.max(1, vlen(mine.f), vlen(mine.t));
      if (vlen(vsub(uf, mine.f)) > 1e-3 * scale || vlen(vsub(ut, mine.t)) > 1e-3 * scale) foreign++;
    }
    this.foreignAccumulatorWrites += foreign;

    // (2) Snapshot the points our owned forces act at, BEFORE the step.
    const comBefore = new Map<string, Vec3>();
    for (const id of dyn) comBefore.set(id, { ...this.body(id).worldCom() });
    const springBefore = this.springs.map((s) => this.springState(s));
    const springPointBefore = springBefore.map((d) => ({ ...d.pointB }));
    // The MATERIAL POINT the hand acts at, BEFORE the sub-step. The work integral
    // uses this point's displacement — not the centre of mass, not the target.
    const handActive = this.hand.active && this.entities.has(this.hand.entityId);
    const handPointBefore = handActive ? this.grabPointWorld(this.hand.entityId, this.hand.localPoint) : null;

    // (3) CLEAR our accumulators, then REBUILD this tick's additions.
    for (const id of dyn) {
      const b = this.body(id);
      b.resetForces(false);
      b.resetTorques(false);
    }
    this.registry.clear();

    // (3a) Air drag — ours. Gravity is NOT added here; it is Rapier's.
    for (const id of dyn) {
      const rt = this.entities.get(id)!;
      if (rt.kDrag === 0) continue;
      const b = this.body(id);
      const F = dragForce(rt.kDrag, b.linvel());
      if (F.x || F.y || F.z) this.registry.add({ owner: 'air-drag', entityId: id, force: F, point: null, via: 'still-air quadratic law' });
    }

    // (3b) Springs — ours, split into the elastic and damper terms so the damper's
    //      (non-conservative) work can be accounted separately from the elastic
    //      term's (conservative) potential.
    for (let i = 0; i < this.springs.length; i++) {
      const s = this.springs[i];
      const d = springBefore[i];
      if (d.length < NEAR_ZERO_LENGTH) continue;
      const n = vscale(vsub(d.pointB, d.pointA), 1 / d.length);
      for (const [owner, mag] of [['spring-elastic', d.elasticForce], ['spring-damper', d.damperForce]] as const) {
        if (mag === 0) continue;
        const F = vscale(n, mag);
        if (s.b.kind === 'body') this.registry.add({ owner, entityId: s.b.entityId, force: F, point: d.pointB, via: s.id });
        if (s.a.kind === 'body') this.registry.add({ owner, entityId: s.a.entityId, force: vscale(F, -1), point: d.pointA, via: s.id });
      }
    }

    // (3b-hand) THE HAND — an EXTERNAL POWERED COMPLIANT ACTUATOR, re-evaluated
    //      HERE, on every internal sub-step, at the body-local grab point. It is
    //      not a spring in the world and it is not a dissipation channel.
    let handForceVec: Vec3 | null = null;
    if (handActive && handPointBefore) {
      const hb = this.body(this.hand.entityId);
      const v = hb.velocityAtPoint(handPointBefore);
      const hf = handForce(this.hand, handPointBefore, v, this.hand.target);
      handForceVec = hf.force;
      this.hand.lastForce = vlen(hf.force);
      this.hand.lastSaturated = hf.saturated;
      this.registry.add({
        owner: 'hand-actuator', entityId: this.hand.entityId, force: hf.force,
        point: handPointBefore, via: `gesture ${this.hand.gestureId}`,
      });
    }

    // (3c) Apply the registry — the only place addForce* is called in this build.
    const applied = new Map<string, { f: Vec3; t: Vec3 }>();
    for (const id of dyn) applied.set(id, { f: { x: 0, y: 0, z: 0 }, t: { x: 0, y: 0, z: 0 } });
    for (const c of this.registry.contributions) {
      const b = this.body(c.entityId);
      const acc = applied.get(c.entityId);
      if (!acc) continue;
      if (c.point) {
        b.addForceAtPoint(c.force, c.point, false);
        const r = vsub(c.point, b.worldCom());
        acc.t = vadd(acc.t, { x: r.y * c.force.z - r.z * c.force.y, y: r.z * c.force.x - r.x * c.force.z, z: r.x * c.force.y - r.y * c.force.x });
      } else {
        b.addForce(c.force, false);
      }
      acc.f = vadd(acc.f, c.force);
    }
    this.lastApplied = applied;

    // (4) Advance the engine by exactly one fixed INTERNAL sub-step of dt/subSteps.
    this.rapier.step();

    // (5) OWNED DISSIPATION. The force was constant over the sub-step, so its work
    //     is exactly F · (x_end - x_start) at its point of application. See energy.ts.
    let dragW = 0;
    for (const c of this.registry.contributions) {
      if (c.owner !== 'air-drag') continue;
      const before = comBefore.get(c.entityId);
      if (!before) continue;
      dragW += vdot(c.force, vsub(this.body(c.entityId).worldCom(), before));
    }
    // (5-hand) SIGNED EXTERNAL HAND WORK, by the same declared estimator:
    //     W = F . (x_grab_end - x_grab_start)   at the MATERIAL POINT.
    // Exact for a force held constant over the sub-step. NOT booked as owned
    // dissipation and NOT booked as a frozen-edit intervention.
    let handW = 0;
    const handF = handForceVec ? vlen(handForceVec) : 0;
    if (handActive && handPointBefore && handForceVec) {
      const after = this.grabPointWorld(this.hand.entityId, this.hand.localPoint);
      handW = vdot(handForceVec, vsub(after, handPointBefore));
      // The DERIVED first-order accounting residual of the scheme (a PREDICTION
      // of numerical residual, never a claim that it is heat):
      //     -1/2 . h^2 . ( |F|^2/m + tau^T I_world^-1 tau )
      const hb = this.body(this.hand.entityId);
      const r = vsub(handPointBefore, hb.worldCom());
      const tau = vcross(r, handForceVec);
      const fr = this.inertiaFrameOf(this.hand.entityId);
      const h = this.hSub;
      this.hand.gestureResidualPrediction +=
        -0.5 * h * h * (vdot(handForceVec, handForceVec) / fr.mass + vdot(tau, applyInvInertia(fr, tau)));
    }

    let damperW = 0;
    for (let i = 0; i < this.springs.length; i++) {
      const s = this.springs[i];
      if (s.b.kind !== 'body' || !this.entities.has(s.b.entityId)) continue;
      const d0 = springBefore[i];
      if (d0.length < NEAR_ZERO_LENGTH) continue;
      const n = vscale(vsub(d0.pointB, d0.pointA), 1 / d0.length);
      const F = vscale(n, d0.damperForce);
      const after = this.springState(s).pointB;
      const workB = vdot(F, vsub(after, springPointBefore[i]));
      damperW += workB;
      let pairWork = workB;
      // The world-anchor endpoint does no work (it does not move). A body-to-body
      // spring's other endpoint is handled by its own entry when both are bodies.
      if (s.a.kind === 'body' && this.entities.has(s.a.entityId)) {
        const afterA = this.springState(s).pointA;
        const workA = vdot(vscale(F, -1), vsub(afterA, d0.pointA));
        damperW += workA;
        pairWork += workA;
      }
      routeDamperHeat(this.thermal,s.id,s.heatReceiver,-pairWork);
    }

    return { foreign, dragW, damperW, handW, handF };
  }

  // -------------------------------------------------------------------------
  // Inspection — honestly labelled. See ui/inspect.ts for the wording.
  // -------------------------------------------------------------------------

  contactSummary(id: string): { normalImpulse: number; tangentImpulse: number; pairs: number } {
    const rt = this.entities.get(id);
    if (!rt) return { normalImpulse: 0, tangentImpulse: 0, pairs: 0 };
    const col = this.rapier.getCollider(rt.colliderHandle);
    let normalImpulse = 0, tangentImpulse = 0, pairs = 0;
    this.rapier.contactPairsWith(col, (other) => {
      pairs++;
      this.rapier.contactPair(col, other, (m) => {
        for (let i = 0; i < m.numContacts(); i++) {
          normalImpulse += m.contactImpulse(i);
          tangentImpulse += Math.hypot(m.contactTangentImpulseX(i), m.contactTangentImpulseY(i));
        }
      });
    });
    return { normalImpulse, tangentImpulse, pairs };
  }

  terminalSpeedOf(id: string): number {
    const rt = this.entities.get(id)!;
    return terminalSpeed(rt.mass, rt.kDrag, Math.abs(this.construction.environment.gravity.y));
  }

  effectiveAreaOf(id: string): number { return effectiveArea(this.entities.get(id)!.desc.shape); }
  dragCdOf(id: string): number {
    const rt = this.entities.get(id)!;
    return rt.desc.material.dragCd ?? DEFAULT_CD[rt.desc.shape.kind];
  }

  refreshDragCoefficients(): void {
    const rho = mediumDensity(this.construction.environment);
    for (const id of this.order) {
      const rt = this.entities.get(id)!;
      rt.kDrag = rt.desc.kinematics === 'dynamic' ? dragK(rt.desc.shape, rt.desc.material.dragCd, rho) : 0;
    }
  }

  // -------------------------------------------------------------------------
  // Determinism fingerprint
  // -------------------------------------------------------------------------

  /**
   * A SHORT DISPLAY FINGERPRINT. NOT AN EXACTNESS TEST.
   *
   * 32-bit FNV-1a over a SELECTION of numerical fields (pose, velocity, tick,
   * serial, spring scalars) plus the id list. It is a convenience for HUD lines
   * and log output. It OMITS environment, budget, pending input, recorder state
   * and much else, and 32 bits collide. Exactness is decided by
   * `canonicalSimState` / `canonicalAppState` below, which are compared byte for
   * byte over an explicitly declared scope. No claim of bit-identical whole
   * engine state is made from this hash.
   */
  stateHash(): string {
    const nums: number[] = [this.tick, this.nextSerial, this.order.length, this.springs.length];
    for (const id of this.order) {
      const b = this.body(id);
      const t = b.translation(), r = b.rotation(), v = b.linvel(), w = b.angvel();
      nums.push(t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z);
    }
    for (const s of this.springs) nums.push(s.stiffness, s.damping, s.restLength);
    const f = new Float64Array(nums);
    const bytes = new Uint8Array(f.buffer);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0') + ':' + this.order.join(',');
  }

  /** A coarse, human-readable state line for checkpoint diffing. */
  describeState(): string {
    return this.order.map((id) => {
      const b = this.body(id), t = b.translation();
      return `${id}=(${t.x.toFixed(6)},${t.y.toFixed(6)},${t.z.toFixed(6)})`;
    }).join(' ');
  }
}

// ---------------------------------------------------------------------------
// CANONICAL REPLAY STATE — the exactness comparison, with its scope declared.
//
// `stateHash` is a 32-bit fingerprint of SELECTED fields. It cannot support a
// claim that two runs are identical: it omits state, and 32 bits collide. What
// follows is a canonical serialisation of the DECLARED replay state in which
// every number appears as its IEEE-754 bit pattern, so two states are compared
// BYTE FOR BYTE, -0 is distinguished from 0, and no tolerance is involved.
//
// IN SCOPE — simulation half (`canonicalSimState`):
//   tick, nextSerial, insertion order, sub-step count;
//   per body, in insertion order: id, kinematics, mass, translation, rotation,
//     linear velocity, angular velocity;
//   per spring, in order: id, both endpoints, restLength, stiffness, damping;
//   environment medium and gravity;
//   foreignAccumulatorWrites;
//   the whole energy budget: baseline, every component of current mechanical
//     energy, interventionsTotal, both owned-dissipation totals,
//     nonDissipativeTicks, unattributed, and every intervention record.
//
// IN SCOPE — application half (`canonicalAppState`): pending events, recorded
//   events, the recording base construction's identity, recording flag, paused
//   flag, seq counter, selection.
//
// EXPLICITLY OUT OF SCOPE, and therefore never claimed:
//   - Rapier internals that its own snapshot does not round-trip through this
//     API (broad-phase structures, contact-manifold warm-start caches);
//   - engine HANDLE VALUES, an engine allocation detail, compared only through
//     the checkpoint's id -> handle mapping;
//   - render state (meshes, camera, interpolation buffers);
//   - wall-clock annotations on input events (`wallClockMs`), which are
//     non-authoritative by construction;
//   - performance counters;
//   - derived caches (kDrag), recomputed from what IS in scope.
// ---------------------------------------------------------------------------

const F64 = new DataView(new ArrayBuffer(8));

/** The exact IEEE-754 bit pattern of a f64, as 16 hex digits. */
export function f64hex(x: number): string {
  F64.setFloat64(0, x);
  return F64.getBigUint64(0).toString(16).padStart(16, '0');
}

const num = (x: number): string => f64hex(x);
const vec = (v: Vec3): string => `${num(v.x)},${num(v.y)},${num(v.z)}`;
const quat = (q: Quat): string => `${num(q.x)},${num(q.y)},${num(q.z)},${num(q.w)}`;

/** Canonical bytes of the declared SIMULATION half of replay state. */
export function canonicalSimState(sim: SimWorld): string {
  const L: string[] = [];
  L.push(`fp1-canonical-sim/2`);
  L.push(`tick ${num(sim.tick)}`);
  L.push(`nextSerial ${num(sim.nextSerial)}`);
  L.push(`subSteps ${num(sim.subSteps)}`);
  // THE DECLARED PROFILE, ALONGSIDE THE LIVE COUNT. They should agree; comparing
  // both means a construction whose declared profile disagreed with the step the
  // world is actually taking shows up as a difference instead of hiding.
  L.push(`numerics ${sim.declaredNumerics ? num(sim.declaredNumerics.substeps) : 'legacy4'}`);
  L.push(`order ${sim.order.join(',')}`);
  L.push(`foreignAccumulatorWrites ${num(sim.foreignAccumulatorWrites)}`);
  const env = sim.construction.environment;
  L.push(`env ${env.medium} ${vec(env.gravity)}`);
  for (const id of sim.order) {
    const rt = sim.runtime(id);
    const b = sim.body(id);
    L.push(`body ${id} ${rt.desc.kinematics} m=${num(rt.mass)} t=${vec(b.translation())} `
      + `r=${quat(b.rotation())} v=${vec(b.linvel())} w=${vec(b.angvel())}`);
  }
  for (const s of sim.springs) {
    const ep = (e: SpringEndpoint): string =>
      e.kind === 'world' ? `world:${vec(e.point)}` : `body:${e.entityId}:${vec(e.localPoint)}`;
    L.push(`spring ${s.id} a=${ep(s.a)} b=${ep(s.b)} L0=${num(s.restLength)} k=${num(s.stiffness)} c=${num(s.damping)}`);
  }
  // AUTHORED JOINT IDENTITY is in the declared replay scope: a comparison that
  // agreed on every body but not on which joint was which would be exactly the
  // "fingerprint agrees while relevant state is omitted" failure.
  for (const id of sim.jointOrder) {
    const j = sim.joints.get(id)!.desc;
    // VARIANT-SPECIFIC, because the fields ARE variant-specific: a ball carries no
    // axis and no frame, and a fixed connection's two frames are exactly what
    // distinguishes it from a ball. A canonical line that printed a placeholder
    // axis for a ball, or omitted a fixed connection's frames, would let a changed
    // connection hide inside a comparison that "agreed".
    const tail = j.kind === 'hinge' || j.kind === 'slider' ? `axis=${vec(j.axis)}`
      : j.kind === 'ball' ? 'ball: no axis, no frame'
      : `frameA=${quat(j.frameA)} frameB=${quat(j.frameB)}`;
    L.push(`joint ${j.id} ${j.kind} ${j.bodyA}->${j.bodyB} a=${vec(j.anchorA)} b=${vec(j.anchorB)} ${tail}`);
  }
  // Thermal optional metadata and evolved heat belong to deterministic replay state.
  if(sim.thermal.bodies.length || sim.thermal.routed.length || sim.thermal.exportedHeat!==0) {
    for(const id of sim.order) { const t=sim.runtime(id).desc.thermal;
      if(t)L.push(`thermal-body ${id} C=${num(t.heatCapacity)} T0=${num(t.initialTemperature)}`); }
    for(const s of sim.springs)if(s.heatReceiver!==undefined)L.push(`thermal-route ${s.id} -> ${s.heatReceiver}`);
    for(const b of sim.thermal.bodies)L.push(`thermal-state ${b.id} Q=${num(b.heat)} backflow=${num(b.backflowCount)}`);
    for(const s of sim.thermal.routed)L.push(`thermal-ledger ${s.springId} Q=${num(s.heat)}`);
    for(const s of sim.thermal.routedElectrical??[])L.push(`thermal-ledger-elec ${s.componentId} Q=${num(s.heat)}`);
    L.push(`thermal-export ${num(sim.thermal.exportedHeat)}`);
  }
  // BATCH 4 — the authored circuit and every future-relevant runtime electrical
  // value. Variant-specific, exactly like the joint lines: a source carries a
  // voltage and no resistance, a resistor carries a resistance and an optional
  // receiver, a wire carries neither. A canonical line that printed a placeholder
  // would let a changed component hide inside a comparison that "agreed".
  const circuit = sim.construction.circuit;
  if (circuit) {
    for (const n of circuit.nodes) L.push(`circuit-node ${n.id}`);
    for (const x of circuit.components) {
      L.push(`circuit-component ${x.id} ${x.kind} ${x.model} v${x.modelVersion} ` + (
        x.kind === 'source' ? `pos=${x.pos} neg=${x.neg} V=${num(x.voltage)}`
          : x.kind === 'resistor' ? `a=${x.a} b=${x.b} R=${num(x.resistance)} receiver=${x.heatReceiver ?? 'none'}`
            : `a=${x.a} b=${x.b} (ideal wire: merges nodes, carries no determined current)`));
    }
    const merge = mergeNodes(circuit);
    for (const rep of merge.representatives) L.push(`circuit-merged ${rep} <- ${merge.members(rep).join(',')}`);
    const e = sim.electrical;
    L.push(`electrical-state supplied=${num(e.suppliedEnergy)} unrouted=${num(e.unroutedEnergy)} ticks=${num(e.ticks)} rejected=${e.rejected === null ? 'no' : 'YES'}`);
    for (const r of e.resistors) L.push(`electrical-resistor ${r.id} E=${num(r.energy)}`);
    for (const r of e.routed) L.push(`electrical-routed ${r.componentId} Q=${num(r.heat)}`);
    const sol = sim.circuitSolution;
    if (sol) {
      for (const v of sol.nodeVoltages) L.push(`circuit-voltage ${v.rep} V=${num(v.voltage)}`);
      for (const r of sol.resistors) L.push(`circuit-branch ${r.id} V=${num(r.voltage)} I=${num(r.current)} P=${num(r.power)}`);
      L.push(`circuit-source I=${num(sol.sourceCurrent)} P=${num(sol.sourceDeliveredPower)}`);
    }
  }
  const bu = sim.budget;
  L.push(`budget base=${num(bu.baselineTotal)} keT=${num(bu.current.keTranslational)} keR=${num(bu.current.keRotational)} `
    + `pe=${num(bu.current.gravitationalPotential)} sp=${num(bu.current.springPotential)} tot=${num(bu.current.total)} `
    + `iv=${num(bu.interventionsTotal)} dDrag=${num(bu.dissipatedDrag)} dDamp=${num(bu.dissipatedSpringDamper)} `
    + `handW=${num(bu.handWorkExternal)} `
    + `nonDiss=${num(bu.nonDissipativeTicks)} unattributed=${num(bu.unattributed)}`);
  // THE TRANSIENT HAND IS PART OF THE DECLARED REPLAY STATE. A comparison that
  // agreed on every body but not on what the hand was holding would be exactly
  // the "fingerprint agrees while relevant state is omitted" failure.
  const hd = sim.hand;
  L.push(`hand active=${String(hd.active)} id=${hd.entityId} local=${vec(hd.localPoint)} target=${vec(hd.target)} `
    + `kP=${num(hd.kP)} kD=${num(hd.kD)} fMax=${num(hd.fMax)} gainScale=${num(hd.gainScale)} `
    + `mEffBound=${num(hd.mEffBound)} gestureId=${num(hd.gestureId)} gestureWork=${num(hd.gestureWork)} `
    + `gestureTicks=${num(hd.gestureTicks)} peakForce=${num(hd.gesturePeakForce)} `
    + `residualPred=${num(hd.gestureResidualPrediction)}`);
  for (const iv of bu.interventions) {
    L.push(`intervention ${num(iv.tick)} ${num(iv.seq)} ${iv.kind} ${iv.target} ${num(iv.deltaEmech)} ${iv.detail}`);
  }
  return L.join('\n');
}

/** The declared scope, as data, so the claim and the code cannot drift apart. */
export const REPLAY_STATE_SCOPE = {
  simIn: [
    'tick', 'nextSerial', 'subSteps', 'the construction DECLARED numerical profile (absent = legacy M=4)',
    'insertion order', 'environment.medium', 'environment.gravity',
    'per body: kinematics, mass, translation, rotation, linvel, angvel',
    'per spring: id, endpoints, restLength, stiffness, damping',
    'per joint, in insertion order: id, kind (hinge|slider|ball|fixed), both bodies, both anchors, and the '
    + 'VARIANT-SPECIFIC remainder: the axis for hinge/slider, nothing for ball, BOTH connection frames for fixed',
    'foreignAccumulatorWrites', 'energy budget (all totals + every intervention record)',
    'energy budget: handWorkExternal (signed external actuator work)',
    'hand: active, entityId, localPoint, target, kP, kD, fMax, gainScale, mEffBound,'
      + ' gestureId, gestureWork, gestureTicks, gesturePeakForce, gestureResidualPrediction',
    'thermal: the ELECTRICAL routing ledger, keyed by component id, separately from the damper ledger',
    'the authored circuit: every node, and every component with its VARIANT-SPECIFIC fields —'
      + ' a source\'s pos/neg/voltage, a resistor\'s a/b/resistance/receiver, a wire\'s a/b',
    'the DERIVED equipotential merge, so a wire that changed which nodes it joins cannot hide',
    'electrical runtime: cumulative supplied energy, per-resistor cumulative dissipation,'
      + ' the routing ledger, the outgoing unrouted total, the accumulated tick count and the'
      + ' solve acceptance state',
    'the solved node voltages, oriented branch currents and powers, and the source current and power',
  ],
  appIn: [
    'pendingEvents', 'recordedEvents', 'recordingBase identity', 'settings.recording',
    'settings.paused', 'seqCounter', 'selectedId',
  ],
  out: [
    'Rapier internals not round-tripped by its own snapshot (broad phase, contact warm-start caches)',
    'engine handle values, bodies AND joints (compared only via the checkpoint id->handle mapping)',
    'the joint constraint impulses Rapier computes: no exact decomposition of joint'
      + ' constraint work is promised, none is estimated, and none is turned into heat',
    'render state (meshes, camera, interpolation buffers)',
    'wallClockMs annotations on input events',
    'performance counters',
    'derived caches (kDrag), recomputed from in-scope state',
    'the BOUNDED hand diagnostic buffers (handTickHistory, handGestureHistory):'
      + ' display-only ring buffers. They ARE carried in a checkpoint so a restore'
      + ' looks right, but nothing is claimed about them and they are not compared.',
    'the raw, not-yet-sampled pointer target and the drag plane: display-side input'
      + ' that can only reach the simulation through a (tick, seq)-keyed grabMove',
  ],
} as const;

/** World position of a body-local point. */
function rotateLocal(b: RAPIER.RigidBody, local: Vec3): Vec3 {
  const q = b.rotation();
  const t = b.translation();
  const r = qrotate(q, local);
  return { x: t.x + r.x, y: t.y + r.y, z: t.z + r.z };
}

function qrotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export { RAPIER };
