/**
 * THE CONFORMANCE KIT — compositions: what a builder writes, how it becomes a deck, and what is
 * checked BEFORE any solve.
 *
 * A composition is typed JSON: sources, environment programmes, part instances with named ports
 * and specs, and analysis settings. Every line of SPICE is produced by `parts.ts` emitters; a
 * builder never writes SPICE. Node identifiers are validated before emission (so no external
 * node string can smuggle SPICE into a behavioural expression), and every generated symbol is
 * RESERVED: each wrapper declares the private nodes, elements and models its emitter produces,
 * and a grammar parser over the emitted lines — restricted to this project's emitter grammar,
 * failing closed on anything else — cross-checks them and finds case-insensitive collisions.
 *
 * Connectivity is checked as REACHABILITY OVER CONDUCTION EDGES for the element types this kit
 * emits (R, L, C, V, I, S, D, M drain–source, E output, B current source). Control dependencies
 * — a switch's control nodes, a behavioural source's referenced nodes, an E source's inputs — are
 * NOT conduction edges: a comparator input draws nothing and is deliberately unreachable through
 * it. A degree-one external node is reported only as the optional `dangling-port` HEURISTIC,
 * never as a floating-node verdict (a whole island can have degree ≥ 2). Astra's conditions.
 */
import {
  emitResistor, emitDcSource, emitPwlSource, emitSwitch, pulseControl, emitDiode, emitLed, emitPotentiometer, emitLdr, emitNtc,
  emitComparator, emitMosfet, emitDcMotorPort, emitCapacitor, emitInductor, emitCoupled, assertInstanceName,
  validateSwitch, validateDiodePart, validateLed, validatePot, validateLdr, validateNtc, validateComparator, validateMosfet, validateDcMotor, validateCapacitor, validateInductor, validateCoupled,
  type SwitchSpec, type DiodePart, type LedSpec, type PotSpec, type LdrSpec, type NtcSpec, type ComparatorSpec, type MosfetSpec, type DcMotorSpec, type RotationalLoadSpec, type CapacitorSpec, type InductorSpec, type CoupledSpec,
  motorBrakeNames, type MotorBrakeSpec,
} from '../spice/parts';
import type { RackLoad } from '../spice/shaft-load';
import { assertAscii } from '../spice/netlist';
import { checkCompositionShape } from './shape';

export type PartKind = 'resistor' | 'switch' | 'diode' | 'led' | 'pot' | 'ldr' | 'ntc' | 'comparator' | 'mosfet' | 'motor' | 'capacitor' | 'inductor' | 'coupled';

/**
 * INITIAL-STATE POLICY (one, declared): a composition starts from its OPERATING POINT at t = 0 — no `uic`, no `ic=`, no
 * `.ic`. Every stored state (a capacitor's voltage, an inductor's current, a motor's winding current and shaft speed, a
 * MOSFET's gate charge) is whatever the DC solution gives; a transient is excited by the sources' programmes (a PWL step).
 * A part carrying a forced initial state (`initialVolts`, `initialAmps`) is refused by name (`unsupported-initial-state`)
 * rather than silently mixed with the operating point. The RC/RLC page deck keeps its own `uic` policy; it is not this path.
 */
export const INITIAL_STATE_POLICY = 'operating-point' as const;

/** A control programme for a switch: closes at `closeAtSeconds` (or never), may open later; finite edges. */
export interface SwitchProgramme { closeAtSeconds: number | null; openAtSeconds: number | null; edgeSeconds: number }

export type PartInstance =
  | { kind: 'resistor'; name: string; ports: { a: string; b: string }; spec: { ohms: number } }
  | { kind: 'switch'; name: string; ports: { a: string; b: string }; spec: SwitchSpec; programme: SwitchProgramme }
  | { kind: 'diode'; name: string; ports: { anode: string; cathode: string }; spec: DiodePart }
  | { kind: 'led'; name: string; ports: { anode: string; cathode: string }; spec: LedSpec }
  | { kind: 'pot'; name: string; ports: { a: string; w: string; b: string }; spec: PotSpec }
  | { kind: 'ldr'; name: string; ports: { a: string; b: string; env: string }; spec: LdrSpec }
  | { kind: 'ntc'; name: string; ports: { a: string; b: string; env: string }; spec: NtcSpec }
  | { kind: 'comparator'; name: string; ports: { inp: string; inn: string; out: string; vcc: string }; spec: ComparatorSpec }
  | { kind: 'mosfet'; name: string; ports: { drain: string; gate: string; source: string }; spec: MosfetSpec }
  /** Electromechanical v1: an optional rigid `rack` (exact 1-DOF reduction, shaft-load.ts) and the page's `brake`/release protocol, required with a rack. */
  | { kind: 'motor'; name: string; ports: { plus: string; minus: string }; spec: { motor: DcMotorSpec; load: RotationalLoadSpec; rack?: RackLoad; brake?: MotorBrakeSpec } }
  | { kind: 'capacitor'; name: string; ports: { plus: string; minus: string }; spec: CapacitorSpec }
  | { kind: 'inductor'; name: string; ports: { plus: string; minus: string }; spec: InductorSpec }
  /** Two linear magnetically coupled windings (supported extension): dots at `plus1` and `plus2`; 0 < k < 1; no core loss or saturation. */
  | { kind: 'coupled'; name: string; ports: { plus1: string; minus1: string; plus2: string; minus2: string }; spec: CoupledSpec };

export type SourceInstance =
  | { kind: 'dc'; name: string; plus: string; minus: string; volts: number }
  | { kind: 'pwl'; name: string; plus: string; minus: string; points: { atSeconds: number; value: number }[] };

export interface Composition {
  id: string;
  sources: SourceInstance[];
  /** Environment programmes: a node carrying lux or °C over time, for sensors to read. */
  environments?: { name: string; node: string; points: { atSeconds: number; value: number }[] }[];
  parts: PartInstance[];
  analysis: { stopSeconds: number; stepSeconds: number; reltol?: number };
}

/** Required ports per kind: a composition missing one is refused by name before emission. */
export const REQUIRED_PORTS: Record<PartKind, string[]> = {
  resistor: ['a', 'b'], switch: ['a', 'b'], diode: ['anode', 'cathode'], led: ['anode', 'cathode'], pot: ['a', 'w', 'b'],
  ldr: ['a', 'b', 'env'], ntc: ['a', 'b', 'env'], comparator: ['inp', 'inn', 'out', 'vcc'], mosfet: ['drain', 'gate', 'source'], motor: ['plus', 'minus'],
  capacitor: ['plus', 'minus'], inductor: ['plus', 'minus'], coupled: ['plus1', 'minus1', 'plus2', 'minus2'],
};

/**
 * THE DECLARED FIELDS of the public boundary. Anything a composition carries that is not declared here is REFUSED by name
 * (component, rule, what is supported) rather than silently ignored — an ignored `esr` or `ic` would be unsupported
 * behaviour that looks supported (electronics v1, E1).
 */
export const SPEC_FIELDS: Record<PartKind, string[]> = {
  resistor: ['ohms'], switch: ['rOnOhms', 'rOffOhms'], diode: ['is', 'n', 'rs', 'cjo', 'tt', 'bv', 'ibv'], led: ['part', 'referenceAmps', 'maxForwardAmps'],
  pot: ['totalOhms', 'wiperFraction', 'endOhms', 'contactOhms'], ldr: ['r10Ohms', 'gamma', 'darkOhms', 'luxDomain'], ntc: ['r0Ohms', 't0Kelvin', 'betaKelvin', 'celsiusDomain'],
  comparator: ['gain', 'rOutOhms', 'leakOhms', 'switch'], mosfet: ['vto', 'kp', 'lambda', 'tox', 'cgso', 'cgdo', 'widthM', 'lengthM'], motor: ['motor', 'load'],
  capacitor: ['farads'], inductor: ['henries'], coupled: ['primaryHenries', 'secondaryHenries', 'coupling'],
};
export const NESTED_SPEC_FIELDS: Partial<Record<PartKind, Record<string, string[]>>> = {
  led: { part: ['is', 'n', 'rs', 'cjo', 'tt', 'bv', 'ibv'] }, comparator: { switch: ['rOnOhms', 'rOffOhms'] },
  motor: { motor: ['resistanceOhms', 'inductanceHenries', 'kVsPerRad'], load: ['inertiaKgM2', 'viscousNmS', 'constantTorqueNm'],
    rack: ['massKg', 'pinionRadiusM', 'gravity'], brake: ['releaseAtSeconds', 'edgeSeconds'] },
};
/** Spec fields a kind MAY carry (electromechanical v1): the motor's rigid rack load and its brake/release protocol. */
export const OPTIONAL_SPEC_FIELDS: Partial<Record<PartKind, string[]>> = { motor: ['rack', 'brake'] };
export const PROGRAMME_FIELDS = ['closeAtSeconds', 'openAtSeconds', 'edgeSeconds'];
export const COMPOSITION_FIELDS = ['id', 'sources', 'environments', 'parts', 'analysis'];
export const SOURCE_FIELDS: Record<'dc' | 'pwl', string[]> = { dc: ['kind', 'name', 'plus', 'minus', 'volts'], pwl: ['kind', 'name', 'plus', 'minus', 'points'] };
export const ENVIRONMENT_FIELDS = ['name', 'node', 'points'];
export const ANALYSIS_FIELDS = ['stopSeconds', 'stepSeconds', 'reltol'];
const INITIAL_STATE_FIELDS = ['initialVolts', 'initialAmps'];
const list = (xs: string[]) => xs.join(', ');

/** Refuse every undeclared key of an object, naming where it is and what is supported. */
function refuseUnknown(obj: Record<string, unknown>, allowed: string[], cause: string, where: string, label: string, hint = ''): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new ConformanceError(cause, where, `${label}${k} is not supported (supported: ${list(allowed)}).${hint}`);
}

/** One part against the declared fields: keys, ports, spec, nested specs and a switch's programme. Called before emission. */
function checkDeclaredFields(p: PartInstance): void {
  const where = p.name, label = `Part ${p.name} (${p.kind}): `;
  refuseUnknown(p as unknown as Record<string, unknown>, p.kind === 'switch' ? ['kind', 'name', 'ports', 'spec', 'programme'] : ['kind', 'name', 'ports', 'spec'],
    'unsupported-field', where, label, p.kind !== 'switch' && 'programme' in p ? ' Only a switch carries a programme.' : '');
  refuseUnknown(p.ports as unknown as Record<string, unknown>, REQUIRED_PORTS[p.kind], 'unknown-port', where, `${label}port `);
  const spec = p.spec as unknown as Record<string, unknown>;
  for (const k of Object.keys(spec)) if (INITIAL_STATE_FIELDS.includes(k))
    throw new ConformanceError('unsupported-initial-state', where, `${label}compositions start from the operating point; a forced ${k} is not supported (INITIAL_STATE_POLICY)`);
  const optional = OPTIONAL_SPEC_FIELDS[p.kind] ?? [];
  refuseUnknown(spec, [...SPEC_FIELDS[p.kind], ...optional], 'unsupported-spec-field', where, `${label}spec.`, ' Properties v1 does not model (ESR, leakage, saturation, tolerance, temperature drift) cannot be declared.');
  for (const f of SPEC_FIELDS[p.kind]) if (spec[f] === undefined) throw new ConformanceError('missing-spec-field', where, `${label}needs spec.${f} (its spec fields are ${list(SPEC_FIELDS[p.kind])})`);
  // ELECTROMECHANICAL V1: a rigid rack's weight acts from t = 0, so a free shaft has no rest operating point — the solver
  // would start it running backward at ω = −τ/b (or find no DC solution at b = 0). The page's protocol is the supported one.
  if (p.kind === 'motor' && spec.rack !== undefined && spec.brake === undefined)
    throw new ConformanceError('unsupported-initial-state', where, `${label}a rack load needs spec.brake {releaseAtSeconds, edgeSeconds}: with the shaft free at t = 0 a loaded rack has no rest operating point (it would start running backward). Engage the brake from t = 0 and release it once the drive is on, or null to hold it.`);
  for (const [f, fields] of Object.entries(NESTED_SPEC_FIELDS[p.kind] ?? {})) {
    const inner = spec[f];
    if (inner === undefined && optional.includes(f)) continue;
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) throw new ConformanceError('missing-spec-field', where, `${label}spec.${f} must be an object with ${list(fields)}`);
    refuseUnknown(inner as Record<string, unknown>, fields, 'unsupported-spec-field', where, `${label}spec.${f}.`);
    for (const g of fields) if ((inner as Record<string, unknown>)[g] === undefined) throw new ConformanceError('missing-spec-field', where, `${label}needs spec.${f}.${g} (fields: ${list(fields)})`);
  }
  if (p.kind === 'switch') {
    const pr = (p as { programme?: unknown }).programme;
    if (!pr || typeof pr !== 'object' || Array.isArray(pr)) throw new ConformanceError('missing-programme', where, `${label}needs a programme {${list(PROGRAMME_FIELDS)}} (null close/open = never)`);
    refuseUnknown(pr as Record<string, unknown>, PROGRAMME_FIELDS, 'unsupported-field', where, `${label}programme.`);
    for (const f of PROGRAMME_FIELDS) if ((pr as Record<string, unknown>)[f] === undefined) throw new ConformanceError('missing-programme', where, `${label}needs programme.${f} (null close/open = never)`);
  }
}

/** An external node name: ground `0`, or lower-case letters and digits. No underscore — that marks generated private nodes. */
export function assertNodeName(node: unknown, where: string): string {
  if (typeof node !== 'string' || !/^(0|[a-z][a-z0-9]*)$/.test(node))
    throw new ConformanceError('invalid-node-name', where, `Node names are "0" or lower-case letters and digits (got ${JSON.stringify(node)})`);
  return node;
}

/** A named structural failure. `cause` is the machine-readable cause; `where` names the component or node. */
export class ConformanceError extends Error {
  constructor(public readonly cause_: string, public readonly where: string, message: string) { super(message); }
}

/**
 * A DERIVED observable (electromechanical v1): Σ coefficient·vector at each sample, integrated from t = 0 by the trapezoid
 * rule on the solver's grid when `integrate` is set — θ = ∫ω dt with θ(0) = 0, the motor page's definition, and x = r·θ.
 * Not a deck node (a θ node would need a DC path that corrupts it; motor-netlist.ts). Evaluated by the kit's `makePicker`.
 */
export interface DerivedVector { terms: [vector: string, coefficient: number][]; integrate?: boolean }

/** What one part contributes to the deck, with every generated symbol declared. */
export interface Emitted {
  /** Derived observables by semantic name (see DerivedVector); they appear as `<part>.<name>` like any other. */
  derived?: Record<string, DerivedVector>;
  lines: string[];
  /** Nodes this emitter created (its private namespace). */
  privateNodes: string[];
  /** Observables the checks may reference, by semantic name → SPICE vector. */
  observables: Record<string, string>;
  /** Conduction edges the part adds, as node pairs (external or private). */
  conduction: [string, string][];
  /** External nodes the part only READS (a comparator input, a sensor's environment): no conduction, but a consumer. */
  controlReads?: string[];
  /** Conduction edges that carry NO DC current (a capacitor): counted for reachability, excluded from the DC-path check. */
  dcOpen?: [string, string][];
}

const priv = (name: string, suffix: string) => `${name}_${suffix}`;

/** Emit one part with its symbol declaration. Node names have been validated by the caller. */
export function emitPart(p: PartInstance, stop: number): Emitted {
  assertInstanceName(p.name);
  const n = p.name;
  switch (p.kind) {
    case 'resistor': {
      // A 0 V probe at `a`, so the resistor's current is an observable independent of any law.
      const pn = priv(n, 'p');
      return { lines: [`Vr${n} ${p.ports.a} ${pn} DC 0`, ...emitResistor(n, pn, p.ports.b, p.spec.ohms)], privateNodes: [pn],
        observables: { current: `i(vr${n})`, va: `v(${p.ports.a})`, vb: `v(${p.ports.b})` }, conduction: [[p.ports.a, pn], [pn, p.ports.b]] };
    }
    case 'switch': {
      validateSwitch(p.spec, `Switch ${n}`);
      const ctl = priv(n, 'ctl'), pr = p.programme;
      if (!Number.isFinite(pr.edgeSeconds) || pr.edgeSeconds <= 0) throw new ConformanceError('invalid-parameter', n, `Switch ${n}: edge must be positive`);
      for (const [what, t] of [['close', pr.closeAtSeconds], ['open', pr.openAtSeconds]] as const)
        if (t !== null && (!Number.isFinite(t) || t < pr.edgeSeconds || t > stop - pr.edgeSeconds)) throw new ConformanceError('invalid-parameter', n, `Switch ${n}: ${what} time must lie inside the run with room for its edge`);
      if (pr.openAtSeconds !== null && (pr.closeAtSeconds === null || pr.openAtSeconds < pr.closeAtSeconds + pr.edgeSeconds)) throw new ConformanceError('invalid-parameter', n, `Switch ${n} can only open after it has closed`);
      // A 0 V probe at `a` so the switch current is observable; control on a private node.
      const pn = priv(n, 'p');
      return { lines: [`Vc${n} ${ctl} 0 ${pulseControl(pr.closeAtSeconds, pr.openAtSeconds, pr.edgeSeconds, stop)}`, `Vsw${n} ${p.ports.a} ${pn} DC 0`, ...emitSwitch(n, pn, p.ports.b, ctl, p.spec)],
        privateNodes: [ctl, pn], observables: { current: `i(vsw${n})`, control: `v(${ctl})` }, conduction: [[p.ports.a, pn], [pn, p.ports.b], [ctl, '0']] };
    }
    case 'diode': case 'led': {
      if (p.kind === 'diode') validateDiodePart(p.spec, `Diode ${n}`); else validateLed(p.spec, `LED ${n}`);
      const probe = `${p.ports.cathode}_${n}k`;
      const lines = p.kind === 'diode' ? emitDiode(n, p.ports.anode, p.ports.cathode, p.spec) : emitLed(n, p.ports.anode, p.ports.cathode, p.spec);
      return { lines, privateNodes: [probe], observables: { current: `i(vd${n})`, vanode: `v(${p.ports.anode})`, vcathode: `v(${p.ports.cathode})` },
        conduction: [[p.ports.anode, probe], [probe, p.ports.cathode]] };
    }
    case 'pot': {
      validatePot(p.spec, `Potentiometer ${n}`);
      const t = priv(n, 't'), ap = priv(n, 'a'), wp = priv(n, 'w');
      return { lines: emitPotentiometer(n, p.ports.a, p.ports.w, p.ports.b, p.spec), privateNodes: [t, ap, wp],
        observables: { currentA: `i(va${n})`, currentW: `i(vw${n})`, vtrack: `v(${t})`, va: `v(${p.ports.a})`, vw: `v(${p.ports.w})`, vb: `v(${p.ports.b})` },
        conduction: [[p.ports.a, ap], [ap, t], [t, p.ports.b], [t, wp], [wp, p.ports.w]] };
    }
    case 'ldr': case 'ntc': {
      if (p.kind === 'ldr') validateLdr(p.spec, `LDR ${n}`); else validateNtc(p.spec, `NTC ${n}`);
      // The sensor gets ITS OWN 0 V probe (a → name_p): its current is an observable in its own right, never inferred
      // from a neighbour that happens to share a node (a shared ground or supply node shares no current).
      const pn = priv(n, 'p');
      const lines = [`Vsn${n} ${p.ports.a} ${pn} DC 0`, ...(p.kind === 'ldr' ? emitLdr(n, pn, p.ports.b, p.ports.env, p.spec) : emitNtc(n, pn, p.ports.b, p.ports.env, p.spec))];
      return { lines, privateNodes: [pn], observables: { current: `i(vsn${n})`, va: `v(${p.ports.a})`, vb: `v(${p.ports.b})`, env: `v(${p.ports.env})` }, conduction: [[p.ports.a, pn], [pn, p.ports.b]], controlReads: [p.ports.env] };
    }
    case 'comparator': {
      validateComparator(p.spec, `Comparator ${n}`);
      const ctl = priv(n, 'ctl'), ctln = priv(n, 'ctln'), op = priv(n, 'op'), vp = priv(n, 'vp'), o = priv(n, 'o');
      return { lines: emitComparator(n, p.ports, p.spec), privateNodes: [ctl, ctln, op, vp, o],
        observables: { control: `v(${ctl})`, supplyCurrent: `i(vcp${n})`, outputCurrent: `i(vco${n})`, vout: `v(${p.ports.out})`, vinp: `v(${p.ports.inp})`, vinn: `v(${p.ports.inn})`, vop: `v(${op})` },
        // conduction: the output stage (vcc→vp→op→o→out, op→0, o→0 leak) and the control sources to ground; inputs draw nothing
        conduction: [[p.ports.vcc, vp], [vp, op], [op, '0'], [op, o], [o, '0'], [o, p.ports.out], [ctl, '0'], [ctln, '0']], controlReads: [p.ports.inp, p.ports.inn] };
    }
    case 'mosfet': {
      validateMosfet(p.spec, `MOSFET ${n}`);
      const sp = priv(n, 's'), gp = priv(n, 'g');
      // The gate probe's private node ends at the insulated gate: no conduction edge (the gate gives its node no DC path).
      return { lines: emitMosfet(n, p.ports, p.spec), privateNodes: [sp, gp],
        observables: { sourceCurrent: `i(vs${n})`, gateCurrent: `i(vg${n})`, vdrain: `v(${p.ports.drain})`, vgate: `v(${p.ports.gate})`, vsource: `v(${p.ports.source})` },
        conduction: [[p.ports.drain, sp], [sp, p.ports.source]], controlReads: [p.ports.gate] };
    }
    case 'coupled': {
      validateCoupled(p.spec, `Coupled inductors ${n}`);
      const p1 = priv(n, 'p1'), p2 = priv(n, 'p2');
      return { lines: emitCoupled(n, p.ports, p.spec), privateNodes: [p1, p2],
        observables: { current1: `i(vk${n}a)`, current2: `i(vk${n}b)`, windingCurrent1: `i(lk${n}a)`, windingCurrent2: `i(lk${n}b)`,
          vplus1: `v(${p.ports.plus1})`, vminus1: `v(${p.ports.minus1})`, vplus2: `v(${p.ports.plus2})`, vminus2: `v(${p.ports.minus2})` },
        conduction: [[p.ports.plus1, p1], [p1, p.ports.minus1], [p.ports.plus2, p2], [p2, p.ports.minus2]] };
    }
    case 'motor': {
      const { motor, load, rack, brake } = p.spec;
      validateDcMotor(motor, load, `Motor ${n}`, rack);
      const r = priv(n, 'r'), e = priv(n, 'e'), w = priv(n, 'w'), pp = priv(n, 'p');
      const privateNodes = [r, e, w, pp];
      const conduction: [string, string][] = [[p.ports.plus, pp], [pp, r], [r, e], [e, p.ports.minus], [w, '0']];
      // θ, the back-EMF and — with a rack — its height and speed are DERIVED from solver vectors, never deck nodes
      // (electromechanical v1; θ(0) = 0 by definition, the page's reader convention).
      const derived: Record<string, DerivedVector> = {
        theta: { terms: [[`v(${w})`, 1]], integrate: true },
        backEmf: { terms: [[`v(${e})`, 1], [`v(${p.ports.minus})`, -1]] },
      };
      if (rack) {
        derived.height = { terms: [[`v(${w})`, rack.pinionRadiusM]], integrate: true };
        derived.velocity = { terms: [[`v(${w})`, rack.pinionRadiusM]] };
      }
      if (brake) {
        const b = motorBrakeNames(n);
        privateNodes.push(b.controlNode, b.probeNode);
        conduction.push([w, b.probeNode], [b.probeNode, '0'], [b.controlNode, '0']);
        // i(probe) LEAVES the ω node — the resisting torque — so the torque the brake APPLIES to the shaft is its negative.
        derived.brakeTorque = { terms: [[`i(${b.probe.toLowerCase()})`, -1]] };
      }
      return { lines: emitDcMotorPort(n, p.ports.plus, p.ports.minus, motor, load, rack, brake, stop), privateNodes,
        observables: { current: `i(vm${n})`, windingCurrent: `i(l${n})`, omega: `v(${w})`, vplus: `v(${p.ports.plus})`, vminus: `v(${p.ports.minus})` },
        conduction, derived };
    }
    case 'capacitor': {
      if ((p.spec as { initialVolts?: unknown }).initialVolts !== undefined) throw new ConformanceError('unsupported-initial-state', n, `Capacitor ${n}: compositions start from the operating point; a forced initialVolts is not supported (INITIAL_STATE_POLICY)`);
      validateCapacitor(p.spec, `Capacitor ${n}`);
      const pn = priv(n, 'p');
      return { lines: emitCapacitor(n, p.ports.plus, p.ports.minus, p.spec), privateNodes: [pn],
        observables: { current: `i(vc${n})`, vplus: `v(${p.ports.plus})`, vminus: `v(${p.ports.minus})` },
        conduction: [[p.ports.plus, pn], [pn, p.ports.minus]], dcOpen: [[pn, p.ports.minus]] };
    }
    case 'inductor': {
      if ((p.spec as { initialAmps?: unknown }).initialAmps !== undefined) throw new ConformanceError('unsupported-initial-state', n, `Inductor ${n}: compositions start from the operating point; a forced initialAmps is not supported (INITIAL_STATE_POLICY)`);
      validateInductor(p.spec, `Inductor ${n}`);
      const pn = priv(n, 'p');
      return { lines: emitInductor(n, p.ports.plus, p.ports.minus, p.spec), privateNodes: [pn],
        observables: { current: `i(vl${n})`, windingCurrent: `i(l${n})`, vplus: `v(${p.ports.plus})`, vminus: `v(${p.ports.minus})` },
        conduction: [[p.ports.plus, pn], [pn, p.ports.minus]] };
    }
  }
}

// ---------------------------------------------------------------- the emitter grammar, parsed fail-closed
export interface ParsedLine { element: string | null; model: string | null; nodes: string[] }
/**
 * Only the lines this project's emitters write are accepted. Anything else is an
 * `unrecognised-line` error: the kit will not guess what an unknown line connects.
 */
export function parseEmittedLine(line: string): ParsedLine {
  const s = line.trim();
  if (s === '' || s.startsWith('*') || /^\.(options|tran|end)\b/i.test(s)) return { element: null, model: null, nodes: [] };
  const m = s.match(/^\.model\s+(\S+)\s+(SW|D|NMOS)\(/i);
  if (m) return { element: null, model: m[1].toLowerCase(), nodes: [] };
  const tok = s.split(/\s+/);
  const el = tok[0], first = el[0].toUpperCase();
  // A coupling line names two inductors and a coefficient and connects no node: `K<name> L<a> L<b> k`.
  if (first === 'K') {
    if (tok.length !== 4 || !/^l/i.test(tok[1]) || !/^l/i.test(tok[2])) throw new ConformanceError('unrecognised-line', el, `Not a line this kit's emitters write: ${JSON.stringify(s.slice(0, 60))}`);
    return { element: el.toLowerCase(), model: null, nodes: [] };
  }
  const nodeCount: Record<string, number> = { R: 2, C: 2, L: 2, V: 2, I: 2, D: 2, B: 2, S: 4, E: 4, M: 4 };
  const count = nodeCount[first];
  if (!count || tok.length < count + 2) throw new ConformanceError('unrecognised-line', el, `Not a line this kit's emitters write: ${JSON.stringify(s.slice(0, 60))}`);
  // M lines carry the model as the 5th token after 4 nodes; S the model after 4; D after 2 — validated loosely here, exactly by ngspice.
  return { element: el.toLowerCase(), model: null, nodes: tok.slice(1, 1 + count).map((x) => x.toLowerCase()) };
}

export interface Structure {
  netlist: string;
  externalNodes: Set<string>;
  privateNodes: Set<string>;
  elements: Set<string>;
  models: Set<string>;
  observables: Record<string, string>;     // "part.quantity" and "node:x" → vector (or a `derived:` id)
  /** Derived observables by id `derived:<part>.<name>` (electromechanical v1); evaluated by the kit's `makePicker`. */
  derived: Record<string, DerivedVector>;
  conduction: [string, string][];
  /** Structural findings, each with a named cause. Empty means the structure is clean. */
  findings: { cause: string; where: string; message: string }[];
  danglingPorts: string[];
}

/** Validate ports, names and parameters; emit; reserve symbols; build the conduction graph. Throws ConformanceError on the first hard structural fault. */
export function buildStructure(c: Composition): Structure {
  const shape = checkCompositionShape(c);
  if (shape.length) throw new ConformanceError(shape[0].cause, shape[0].where, shape.map(x => `${x.where}: ${x.message}`).join('\n'));
  const findings: Structure['findings'] = [];
  refuseUnknown(c as unknown as Record<string, unknown>, COMPOSITION_FIELDS, 'unsupported-field', '$', 'Composition field ', ' Initial conditions, ground declarations and free-form notes are not composition fields.');
  if (!c.id || typeof c.id !== 'string') throw new ConformanceError('invalid-composition', 'id', 'A composition needs an id');
  const a = c.analysis;
  if (a && typeof a === 'object') refuseUnknown(a as unknown as Record<string, unknown>, ANALYSIS_FIELDS, 'unsupported-field', 'analysis', 'Analysis field ');
  if (!a || !Number.isFinite(a.stopSeconds) || !Number.isFinite(a.stepSeconds) || a.stepSeconds <= 0 || a.stopSeconds < a.stepSeconds)
    throw new ConformanceError('invalid-analysis', 'analysis', 'stopSeconds and stepSeconds must be finite with 0 < step ≤ stop');
  if (a.stopSeconds / a.stepSeconds > 200_000) throw new ConformanceError('invalid-analysis', 'analysis', 'more than 200000 output points requested');
  const external = new Set<string>(['0']);
  const declare = (node: unknown, where: string) => { external.add(assertNodeName(node, where)); };
  const lines: string[] = [`* Flux Garden conformance kit: composition ${c.id}`];
  const privateNodes = new Set<string>(), elements = new Set<string>(), models = new Set<string>();
  const observables: Record<string, string> = {};
  const derived: Record<string, DerivedVector> = {};
  const conduction: [string, string][] = [];
  const dcOpen = new Set<string>();
  const controlReads = new Set<string>();
  const names = new Set<string>();
  const claim = (name: string, where: string) => {
    const k = name.toLowerCase();
    if (names.has(k)) throw new ConformanceError('symbol-collision', where, `Instance name ${JSON.stringify(name)} is used twice (names are compared case-insensitively)`);
    names.add(k);
  };
  if (!Array.isArray(c.sources) || c.sources.length === 0) throw new ConformanceError('invalid-composition', 'sources', 'A composition needs at least one source');
  for (const s of c.sources) {
    if (s.kind !== 'dc' && s.kind !== 'pwl') throw new ConformanceError('unknown-source-kind', String((s as { name?: unknown }).name ?? '?'), `Source kind ${JSON.stringify((s as { kind?: unknown }).kind)} is not supported (supported: dc, pwl). A sine or pulse programme can be written as pwl points.`);
    refuseUnknown(s as unknown as Record<string, unknown>, SOURCE_FIELDS[s.kind], 'unsupported-field', String(s.name), `Source ${s.name} (${s.kind}) field `);
    assertInstanceName(s.name); claim(s.name, `source ${s.name}`); declare(s.plus, `source ${s.name}`); declare(s.minus, `source ${s.name}`);
    lines.push(...(s.kind === 'dc' ? emitDcSource(s.name, s.plus, s.minus, s.volts) : emitPwlSource(s.name, s.plus, s.minus, s.points)));
    observables[`${s.name}.current`] = `i(v${s.name})`;          // SPICE sign: into the + terminal
    conduction.push([s.plus, s.minus]);
  }
  for (const e of c.environments ?? []) {
    refuseUnknown(e as unknown as Record<string, unknown>, ENVIRONMENT_FIELDS, 'unsupported-field', String(e.name), `Environment ${e.name} field `);
    assertInstanceName(e.name); claim(e.name, `environment ${e.name}`); declare(e.node, `environment ${e.name}`);
    lines.push(...emitPwlSource(e.name, e.node, '0', e.points));
    observables[`${e.name}.value`] = `v(${e.node})`;
    observables[`${e.name}.current`] = `i(v${e.name})`;          // zero unless a part conducts from the environment node (then it is port power)
    conduction.push([e.node, '0']);
  }
  if (!Array.isArray(c.parts) || c.parts.length === 0) throw new ConformanceError('invalid-composition', 'parts', 'A composition needs at least one part');
  for (const p of c.parts) {
    if (!REQUIRED_PORTS[p.kind]) throw new ConformanceError('unknown-part-kind', String((p as { name?: string }).name ?? '?'), `Unknown part kind ${JSON.stringify((p as { kind: string }).kind)}`);
    assertInstanceName(p.name); claim(p.name, `part ${p.name}`);
    for (const port of REQUIRED_PORTS[p.kind]) {
      const node = (p.ports as Record<string, unknown>)[port];
      if (node === undefined) throw new ConformanceError('missing-port', p.name, `Part ${p.name} (${p.kind}) has no port ${JSON.stringify(port)}`);
      declare(node, `${p.name}.${port}`);
    }
    checkDeclaredFields(p);
    let em: Emitted;
    try { em = emitPart(p, a.stopSeconds); }
    catch (err) { if (err instanceof ConformanceError) throw err; throw new ConformanceError('invalid-parameter', p.name, err instanceof Error ? err.message : String(err)); }
    for (const pn of em.privateNodes) {
      const k = pn.toLowerCase();
      if (privateNodes.has(k)) throw new ConformanceError('symbol-collision', p.name, `Generated node ${pn} already exists`);
      privateNodes.add(k);
    }
    for (const [q, vec] of Object.entries(em.observables)) observables[`${p.name}.${q}`] = vec;
    for (const [q, d] of Object.entries(em.derived ?? {})) { const id = `derived:${p.name}.${q}`; observables[`${p.name}.${q}`] = id; derived[id] = d; }
    conduction.push(...em.conduction);
    for (const e of em.dcOpen ?? []) dcOpen.add(`${e[0].toLowerCase()}|${e[1].toLowerCase()}`);
    for (const x of em.controlReads ?? []) controlReads.add(x.toLowerCase());
    lines.push(...em.lines);
  }
  // SENSOR DOMAINS (electronics v1, E2): a sensor reads a DECLARED environment programme (1 V ≡ 1 lux or 1 °C), and every
  // programme point lies inside the sensor's declared domain — programmes are linear between points, so the points bound it.
  const envByNode = new Map((c.environments ?? []).map((e) => [e.node.toLowerCase(), e]));
  for (const p of c.parts) if (p.kind === 'ldr' || p.kind === 'ntc') {
    const unit = p.kind === 'ldr' ? 'lux' : '°C', [lo, hi] = p.kind === 'ldr' ? p.spec.luxDomain : p.spec.celsiusDomain, label = `${p.kind.toUpperCase()} ${p.name}`;
    const e = envByNode.get(p.ports.env.toLowerCase());
    if (!e) throw new ConformanceError('sensor-env-undeclared', p.name, `${label} reads node "${p.ports.env}", which no environments[] programme drives. A sensor reads a declared ${unit} programme (1 V ≡ 1 ${unit}), not a circuit node: add an environment {name, node, points} on that node.`);
    const out = e.points.find((q) => q.value < lo || q.value > hi);
    if (out) throw new ConformanceError('sensor-domain', p.name, `${label}: environment ${e.name} reaches ${out.value} ${unit} at ${out.atSeconds} s, outside the sensor's declared domain ${lo}…${hi} ${unit}. Keep the programme inside the domain; the law is not claimed beyond it.`);
  }
  // Reserve: private nodes vs declared externals, case-insensitively.
  for (const pn of privateNodes) if (new Set([...external].map((x) => x.toLowerCase())).has(pn))
    throw new ConformanceError('symbol-collision', pn, `External node ${JSON.stringify(pn)} aliases a generated private node`);
  // Parse every emitted line against the grammar; reserve elements and models; every node must be declared.
  for (const line of lines) {
    const parsed = parseEmittedLine(line);
    if (parsed.element) { if (elements.has(parsed.element)) throw new ConformanceError('symbol-collision', parsed.element, `Element ${parsed.element} is emitted twice`); elements.add(parsed.element); }
    if (parsed.model) { if (models.has(parsed.model)) throw new ConformanceError('symbol-collision', parsed.model, `Model ${parsed.model} is emitted twice`); models.add(parsed.model); }
    for (const node of parsed.nodes) if (!external.has(node) && !privateNodes.has(node))
      throw new ConformanceError('undeclared-node', node, `Emitted line references node ${JSON.stringify(node)} which is neither a declared external node nor a reserved private node: ${line}`);
  }
  for (const node of external) observables[`node:${node}`] = `v(${node})`;
  lines.push(`.options reltol=${a.reltol ?? 1e-4}`, `.tran ${a.stepSeconds} ${a.stopSeconds} 0 ${a.stepSeconds}`, '.end');
  const netlist = lines.join('\n') + '\n';
  assertAscii(netlist);
  // Reachability over conduction edges: every external node must reach ground.
  const adj = new Map<string, Set<string>>();
  const add = (x: string, y: string) => { const kx = x.toLowerCase(), ky = y.toLowerCase(); (adj.get(kx) ?? adj.set(kx, new Set()).get(kx)!).add(ky); (adj.get(ky) ?? adj.set(ky, new Set()).get(ky)!).add(kx); };
  for (const [x, y] of conduction) add(x, y);
  const seen = new Set<string>(['0']); const stack = ['0'];
  while (stack.length) { const x = stack.pop()!; for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); } }
  for (const node of external) if (!seen.has(node.toLowerCase()))
    findings.push({ cause: 'unreachable-node', where: node, message: `External node ${JSON.stringify(node)} has no conduction path to ground (control dependencies do not count)` });
  // DC PATH: reachability again WITHOUT the edges that carry no DC current (capacitors). A node that reaches ground only
  // through capacitors has no operating point (ngspice: singular matrix or a gmin-fixed float) — refused by name here.
  const adjDc = new Map<string, Set<string>>();
  const addDc = (x: string, y: string) => { const kx = x.toLowerCase(), ky = y.toLowerCase(); (adjDc.get(kx) ?? adjDc.set(kx, new Set()).get(kx)!).add(ky); (adjDc.get(ky) ?? adjDc.set(ky, new Set()).get(ky)!).add(kx); };
  for (const [x, y] of conduction) if (!dcOpen.has(`${x.toLowerCase()}|${y.toLowerCase()}`)) addDc(x, y);
  const seenDc = new Set<string>(['0']); const stackDc = ['0'];
  while (stackDc.length) { const x = stackDc.pop()!; for (const y of adjDc.get(x) ?? []) if (!seenDc.has(y)) { seenDc.add(y); stackDc.push(y); } }
  for (const node of external) if (seen.has(node.toLowerCase()) && !seenDc.has(node.toLowerCase()))
    findings.push({ cause: 'dc-floating-node', where: node, message: `External node ${JSON.stringify(node)} reaches ground only through capacitors: it has no DC operating point (INITIAL_STATE_POLICY starts from the operating point)` });
  // HEURISTIC: an external node with at most one conduction edge and no consumer reading it. A node a comparator
  // or sensor reads is consumed (it is a port, not a loose end), so it is not reported; a node that is only ever
  // a source's terminal or a single part's end may be a typo. Reported, never a verdict.
  const danglingPorts = [...external].filter((node) => node !== '0' && (adj.get(node.toLowerCase())?.size ?? 0) <= 1 && !controlReads.has(node.toLowerCase()));
  return { netlist, externalNodes: external, privateNodes, elements, models, observables, derived, conduction, findings, danglingPorts };
}
