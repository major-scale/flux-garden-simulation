/**
 * REUSABLE PARTS: typed definitions, terminal/sign/unit conventions, validation and netlist
 * emission — the library the pages compose their fixed topologies from.
 *
 * Every emitter writes SPICE lines from a validated spec and NAMED NODES. Conventions:
 *   - node names are lower-case ASCII, ground is `0`;
 *   - a part that must report a current gets a 0 V probe source named `v<part>` so `i(v<part>)`
 *     is a solver output; SPICE's `i(V)` is the current entering the source's + terminal, and
 *     each emitter states which physical current that is;
 *   - a switch is ngspice's own `SW` model (RON, ROFF, VT 0.5, VH 0.1) driven by a 0/1 control
 *     source — an explicitly ideal switch, never a transistor;
 *   - a diode is the project's quasi-static model string (CJO = TT = 0 enforced by the caller's
 *     validation), orientation by terminal order.
 */
import type { DiodeSpec } from './netlist';
import { reflectedInertia, gravityTorque, emitShaftBrake, validateRack, type RackLoad, type BrakeNames } from './shaft-load';

function finite(name: string, v: number, lo: number, hi: number): void {
  if (!Number.isFinite(v) || v < lo || v > hi)
    throw new Error(`${name} must be a finite number in ${lo}…${hi} (got ${v})`);
}

// ---------------------------------------------------------------- control pulses
/**
 * A 0/1 PWL control voltage: 0 before `at`, 1 after `at + edge`, optionally back to 0 at `off`.
 * `at === null` means never (DC 0). Every transition is a FINITE edge, never an ideal step.
 */
export function pulseControl(at: number | null, off: number | null, edge: number, stop: number): string {
  if (at === null) return 'DC 0';
  const pts: [number, number][] = [[0, 0], [at, 0], [at + edge, 1]];
  if (off !== null) pts.push([off, 1], [off + edge, 0]);
  pts.push([stop, off !== null ? 0 : 1]);
  return `PWL(${pts.map(([t, v]) => `${t} ${v}`).join(' ')})`;
}

// ---------------------------------------------------------------- ideal switch
export interface SwitchSpec { rOnOhms: number; rOffOhms: number }
export const SWITCH_LIMITS = { rOn: [1e-4, 10], rOff: [1e3, 1e12] } as const;
export function validateSwitch(s: SwitchSpec, name = 'Switch'): void {
  finite(`${name} on-resistance`, s.rOnOhms, SWITCH_LIMITS.rOn[0], SWITCH_LIMITS.rOn[1]);
  finite(`${name} off-resistance`, s.rOffOhms, SWITCH_LIMITS.rOff[0], SWITCH_LIMITS.rOff[1]);
}
/**
 * `S<name> a b ctrl 0 SW<name>` with its model. The control node carries 0/1 from `pulseControl`;
 * the switch is closed when the control is above VT + VH = 0.6 and open below VT − VH = 0.4.
 */
export function emitSwitch(name: string, a: string, b: string, ctrl: string, s: SwitchSpec): string[] {
  const model = `SW${name.toUpperCase()}`;
  return [`S${name} ${a} ${b} ${ctrl} 0 ${model}`, `.model ${model} SW(RON=${s.rOnOhms} ROFF=${s.rOffOhms} VT=0.5 VH=0.1)`];
}

// ---------------------------------------------------------------- diode
export type DiodePart = Omit<DiodeSpec, 'orientation'>;
export function validateDiodePart(d: DiodePart, name = 'Diode'): void {
  finite(`${name} IS`, d.is, 1e-24, 1); finite(`${name} N`, d.n, 0.5, 5); finite(`${name} RS`, d.rs, 0, 100);
  if (d.cjo !== 0 || d.tt !== 0) throw new Error(`${name} is quasi-static in this slice: CJO and TT must be 0.`);
  finite(`${name} BV`, d.bv, 1, 1e4); finite(`${name} IBV`, d.ibv, 1e-12, 1);
}
/** `D<name> anode cathode` with its model, and a 0 V probe in the CATHODE lead so `i(vd<name>)` is the anode→cathode current. */
export function emitDiode(name: string, anode: string, cathode: string, d: DiodePart): string[] {
  const model = `D${name.toUpperCase()}`, probe = `${cathode}_${name}k`;
  return [`D${name} ${anode} ${probe} ${model}`, `Vd${name} ${probe} ${cathode} DC 0`,
    `.model ${model} D(IS=${d.is} N=${d.n} RS=${d.rs} CJO=${d.cjo} TT=${d.tt} BV=${d.bv} IBV=${d.ibv})`];
}

// ---------------------------------------------------------------- potentiometer
export interface PotSpec {
  totalOhms: number;
  /** 0 = wiper at end A, 1 = at end B. */
  wiperFraction: number;
  /** Floor on each leg, so neither section is a zero resistor; and the wiper's contact resistance. */
  endOhms: number;
  contactOhms: number;
}
export const POT_LIMITS = { total: [1, 1e7], end: [1e-3, 100], contact: [1e-3, 100] } as const;   // contact has a floor too: the emitted value IS the spec's
export function validatePot(p: PotSpec, name = 'Potentiometer'): void {
  finite(`${name} total resistance`, p.totalOhms, POT_LIMITS.total[0], POT_LIMITS.total[1]);
  finite(`${name} wiper fraction`, p.wiperFraction, 0, 1);
  finite(`${name} end resistance`, p.endOhms, POT_LIMITS.end[0], POT_LIMITS.end[1]);
  finite(`${name} contact resistance`, p.contactOhms, POT_LIMITS.contact[0], POT_LIMITS.contact[1]);
}
/** The two leg resistances the policy produces: R_AW = f·R + R_end, R_WB = (1 − f)·R + R_end. */
export const potLegs = (p: PotSpec): { aw: number; wb: number } =>
  ({ aw: p.wiperFraction * p.totalOhms + p.endOhms, wb: (1 - p.wiperFraction) * p.totalOhms + p.endOhms });
/**
 * Three terminals A, W (wiper), B. Internal node `<name>_t` is the track's wiper point; the wiper
 * lead carries the contact resistance and a 0 V probe: `i(vw<name>)` is the current OUT of the
 * wiper toward W. Leg currents come from `i(rleg)`-free probes: `Va<name>` at A (current INTO A).
 */
export function emitPotentiometer(name: string, a: string, w: string, b: string, p: PotSpec): string[] {
  const { aw, wb } = potLegs(p), t = `${name}_t`, ap = `${name}_a`;
  return [
    `Va${name} ${a} ${ap} DC 0`,                 // i(Va) = current into end A from the circuit
    `Ra${name} ${ap} ${t} ${aw}`,
    `Rb${name} ${t} ${b} ${wb}`,
    `Rc${name} ${t} ${name}_w ${p.contactOhms}`,
    `Vw${name} ${name}_w ${w} DC 0`,             // i(Vw) = current out of the wiper toward W
  ];
}

// ---------------------------------------------------------------- LED
export interface LedSpec { part: DiodePart; referenceAmps: number; maxForwardAmps: number }
export function validateLed(l: LedSpec, name = 'LED'): void {
  validateDiodePart(l.part, name);
  finite(`${name} brightness reference current`, l.referenceAmps, 1e-6, 10);
  finite(`${name} maximum forward current`, l.maxForwardAmps, l.referenceAmps, 10);
}
/** An LED is the diode emitter under a different model name; its light is the page's mapping, not the model's. */
export const emitLed = (name: string, anode: string, cathode: string, l: LedSpec): string[] => emitDiode(name, anode, cathode, l.part);
/** Brightness: current / reference, clamped to 0…1, LINEAR, no floor. A stated rendering rule. */
export const ledBrightness = (amps: number, l: LedSpec): number => Math.min(1, Math.max(0, amps / l.referenceAmps));

// ---------------------------------------------------------------- environment-driven sensors
/** An instance name: letters and digits only, so every internal node, probe and model it derives is a legal, unique SPICE name. */
export function assertInstanceName(name: unknown): asserts name is string {
  // typeof first: RegExp.test coerces, so a missing name would otherwise pass as the string "undefined".
  if (typeof name !== 'string' || !/^[a-z][a-z0-9]*$/.test(name)) throw new Error(`Part instance name must be lower-case letters and digits (got ${JSON.stringify(name)})`);
}
export interface LdrSpec { r10Ohms: number; gamma: number; darkOhms: number; luxDomain: [number, number] }
export interface NtcSpec { r0Ohms: number; t0Kelvin: number; betaKelvin: number; celsiusDomain: [number, number] }
export function validateLdr(s: LdrSpec, name = 'LDR'): void {
  finite(`${name} R10`, s.r10Ohms, 100, 1e7); finite(`${name} gamma`, s.gamma, 0.1, 2); finite(`${name} dark resistance`, s.darkOhms, s.r10Ohms, 1e9);
  finite(`${name} lux domain low`, s.luxDomain[0], 0.1, 1e5); finite(`${name} lux domain high`, s.luxDomain[1], s.luxDomain[0], 1e5);
}
export function validateNtc(s: NtcSpec, name = 'NTC'): void {
  finite(`${name} R0`, s.r0Ohms, 1, 1e7); finite(`${name} T0`, s.t0Kelvin, 200, 400); finite(`${name} beta`, s.betaKelvin, 500, 10000);
  finite(`${name} domain low`, s.celsiusDomain[0], -100, 200); finite(`${name} domain high`, s.celsiusDomain[1], s.celsiusDomain[0], 200);
}
/** The laws in JS, for reference and display — the emitters carry the same expressions. */
export const ldrOhms = (lux: number, s: LdrSpec): number => Math.min(s.darkOhms, s.r10Ohms * Math.pow(Math.max(lux, 1e-9) / 10, -s.gamma));
export const ntcOhms = (celsius: number, s: NtcSpec): number => s.r0Ohms * Math.exp(s.betaKelvin * (1 / (celsius + 273.15) - 1 / s.t0Kelvin));
/**
 * A photoresistor between `a` and `b` whose resistance follows the ILLUMINANCE NODE `env` (1 V ≡ 1 lux):
 * R = min(R_dark, R10·(E/10)^−γ). The clamp is a low-end policy; the caller declares the domain.
 */
export function emitLdr(name: string, a: string, b: string, env: string, s: LdrSpec): string[] {
  assertInstanceName(name); validateLdr(s, `LDR ${name}`);
  return [`R${name} ${a} ${b} r = 'min(${s.darkOhms}, ${s.r10Ohms}*pow(max(v(${env}),1e-9)/10, -${s.gamma}))'`];
}
/** An NTC between `a` and `b` whose resistance follows the TEMPERATURE NODE `env` (1 V ≡ 1 °C): beta law, kelvin inside. */
export function emitNtc(name: string, a: string, b: string, env: string, s: NtcSpec): string[] {
  assertInstanceName(name); validateNtc(s, `NTC ${name}`);
  return [`R${name} ${a} ${b} r = '${s.r0Ohms}*exp(${s.betaKelvin}*(1/(v(${env})+273.15) - 1/${s.t0Kelvin}))'`];
}

// ---------------------------------------------------------------- comparator (illustrative, push-pull)
export interface ComparatorSpec { gain: number; rOutOhms: number; leakOhms: number; switch: SwitchSpec }
export function validateComparator(c: ComparatorSpec, name = 'Comparator'): void {
  finite(`${name} gain`, c.gain, 10, 1e7); finite(`${name} output resistance`, c.rOutOhms, 0.1, 1e4); finite(`${name} leak`, c.leakOhms, 1e3, 1e9);
  validateSwitch(c.switch, `${name} output switch`);
}
/** ±threshold of the decision, from the gain and the switch model's VT/VH: 0.1 / G. */
export const comparatorThresholdVolts = (c: ComparatorSpec): number => 0.1 / c.gain;
/**
 * Ports: inp (+), inn (−), out, vcc. Internals are namespaced by the instance: controls
 * `${name}_ctl` / `${name}_ctln`, output-stage node `${name}_op`, probe `Vcp${name}` (its current is
 * what the stage draws from vcc), switches `S${name}h` / `S${name}l` with models `SW${NAME}H/L`, and an
 * output probe `Vco${name}` after the output resistor (`i(Vco<name>)` = current OUT of the out terminal
 * into the circuit), so every conducting terminal's current is a solver output (electronics v1, E4).
 * The internal ground returns (low-side switch, leak) sit on node 0, where they carry no port power.
 *   u = clip(0.5 + G·(v(inp) − v(inn)), 0, 1) → high-side switch;  1 − u → low-side switch.
 * With the SW model's hysteresis (VT 0.5, VH 0.1) the high side closes at u > 0.6, i.e. Δ > +0.1/G,
 * and opens at u < 0.4, Δ < −0.1/G; the low side mirrors it. INSIDE the band (|Δ| ≤ 0.1/G) the
 * PRIOR state is RETAINED — it is hysteresis, not a dead zone — after a valid start outside it.
 * Only a start inside the band leaves both switches open with the output floating through the
 * leak, which is why callers refuse such a start as ambiguous. Inputs draw nothing (behavioural).
 */
export function emitComparator(name: string, ports: { inp: string; inn: string; out: string; vcc: string }, c: ComparatorSpec): string[] {
  assertInstanceName(name); validateComparator(c, `Comparator ${name}`);
  const N = name.toUpperCase(), ctl = `${name}_ctl`, ctln = `${name}_ctln`, op = `${name}_op`, vp = `${name}_vp`;
  return [
    `B${name}u ${ctl} 0 V = 'max(0, min(1, 0.5 + ${c.gain}*(v(${ports.inp}) - v(${ports.inn}))))'`,
    `B${name}d ${ctln} 0 V = '1 - v(${ctl})'`,
    `Vcp${name} ${ports.vcc} ${vp} DC 0`,
    `S${name}h ${vp} ${op} ${ctl} 0 SW${N}H`, `.model SW${N}H SW(RON=${c.switch.rOnOhms} ROFF=${c.switch.rOffOhms} VT=0.5 VH=0.1)`,
    `S${name}l ${op} 0 ${ctln} 0 SW${N}L`, `.model SW${N}L SW(RON=${c.switch.rOnOhms} ROFF=${c.switch.rOffOhms} VT=0.5 VH=0.1)`,
    // Leak on the inner side of the output probe (the same node electrically, through 0 V), so i(Vco) is the whole output-terminal current.
    `Rout${name} ${op} ${name}_o ${c.rOutOhms}`,
    `Rleak${name} ${name}_o 0 ${c.leakOhms}`,
    `Vco${name} ${name}_o ${ports.out} DC 0`,
  ];
}

/** The page's illustrative LED: with IS 1e-20, N 2, RS 1 Ω the model gives ≈ 2.15 V at 10 mA (2·V_T·ln(I/IS) + RS·I at 300 K). Not a catalogue part. */
export const DEFAULT_LED: LedSpec = {
  part: { is: 1e-20, n: 2, rs: 1, cjo: 0, tt: 0, bv: 5, ibv: 1e-6 },
  referenceAmps: 20e-3, maxForwardAmps: 30e-3,
};

// ---------------------------------------------------------------- plain elements and sources, so a composition needs no inline SPICE
export function emitResistor(name: string, a: string, b: string, ohms: number): string[] {
  assertInstanceName(name); finite(`Resistor ${name}`, ohms, 1e-3, 1e12);
  return [`R${name} ${a} ${b} ${ohms}`];
}
/** A DC source: `plus` is its + terminal. `i(V<name>)` is the current entering the + terminal, i.e. MINUS the current the source delivers. */
export function emitDcSource(name: string, plus: string, minus: string, volts: number): string[] {
  assertInstanceName(name); finite(`Source ${name}`, volts, -1e4, 1e4);
  return [`V${name} ${plus} ${minus} DC ${volts}`];
}
/** A piecewise-linear source (finite ramps): points strictly increasing in time, the first at 0 s. */
export function emitPwlSource(name: string, plus: string, minus: string, points: { atSeconds: number; value: number }[]): string[] {
  assertInstanceName(name);
  if (points.length < 2 || points[0].atSeconds !== 0) throw new Error(`Source ${name}: a PWL programme needs at least two points and must start at 0 s`);
  points.forEach((q, k) => { finite(`Source ${name} point ${k} time`, q.atSeconds, 0, 1e6); finite(`Source ${name} point ${k} value`, q.value, -1e6, 1e6);
    if (k > 0 && !(q.atSeconds > points[k - 1].atSeconds)) throw new Error(`Source ${name}: points must be strictly increasing in time (point ${k})`); });
  return [`V${name} ${plus} ${minus} PWL(${points.map((q) => `${q.atSeconds} ${q.value}`).join(' ')})`];
}

// ---------------------------------------------------------------- energy-storing elements: capacitor and inductor
export interface CapacitorSpec { farads: number }
export interface InductorSpec { henries: number }
/** Value ranges shared with the RC/RLC deck (`NETLIST_LIMITS`), restated here so the emitters need no page import. */
export const STORAGE_LIMITS = { minC: 1e-15, maxC: 1, minL: 1e-12, maxL: 1e3 } as const;
export function validateCapacitor(c: CapacitorSpec, name = 'Capacitor'): void { finite(`${name} C`, c.farads, STORAGE_LIMITS.minC, STORAGE_LIMITS.maxC); }
export function validateInductor(l: InductorSpec, name = 'Inductor'): void { finite(`${name} L`, l.henries, STORAGE_LIMITS.minL, STORAGE_LIMITS.maxL); }
/**
 * An ideal capacitor with a 0 V probe in its + lead: `i(Vc<name>)` is the current INTO the + terminal — positive while
 * the + plate is charging positive relative to −. Stored energy is ½·C·(v+ − v−)². NO `ic=`: a composition starts from its
 * operating point (the declared initial-state policy, see composition.ts); a forced initial state is refused by name there.
 * Private node `<name>_p`.
 */
export function emitCapacitor(name: string, plus: string, minus: string, c: CapacitorSpec): string[] {
  assertInstanceName(name); validateCapacitor(c, `Capacitor ${name}`);
  return [`Vc${name} ${plus} ${name}_p DC 0`, `C${name} ${name}_p ${minus} ${c.farads}`];
}
/**
 * An ideal inductor with a 0 V probe in its + lead: `i(Vl<name>)` is the current INTO the + terminal (through the winding
 * from + to −); `i(L<name>)` is the same current read from the element — the pair is a mapping/sign check, not two solvers.
 * Stored energy is ½·L·i². No `ic=` (operating-point start). Private node `<name>_p`.
 */
export function emitInductor(name: string, plus: string, minus: string, l: InductorSpec): string[] {
  assertInstanceName(name); validateInductor(l, `Inductor ${name}`);
  return [`Vl${name} ${plus} ${name}_p DC 0`, `L${name} ${name}_p ${minus} ${l.henries}`];
}

// ---------------------------------------------------------------- MOSFET (level 1), extracted from the lamp bench
export interface MosfetSpec { vto: number; kp: number; lambda: number; tox: number; cgso: number; cgdo: number; widthM: number; lengthM: number }
export function validateMosfet(m: MosfetSpec, name = 'MOSFET'): void {
  finite(`${name} VTO`, m.vto, -10, 10); finite(`${name} KP`, m.kp, 1e-9, 10); finite(`${name} LAMBDA`, m.lambda, 0, 1); finite(`${name} TOX`, m.tox, 1e-9, 1e-5);
  finite(`${name} CGSO`, m.cgso, 0, 1e-6); finite(`${name} CGDO`, m.cgdo, 0, 1e-6); finite(`${name} W`, m.widthM, 1e-7, 1); finite(`${name} L`, m.lengthM, 1e-7, 1);
}
/**
 * An n-channel level-1 MOSFET, bulk tied to source, with 0 V probes in the SOURCE and GATE leads so both are
 * observables: `i(Vs<name>)` = current OUT of the source terminal, `i(Vg<name>)` = current INTO the gate terminal
 * (the gate capacitances' charging current); the drain current is their difference (KCL on the device).
 * The same illustrative model as the lamp page; its limits are the lamp page's (no subthreshold,
 * no velocity saturation, Meyer capacitances not charge-conserving). PMOS and BJT are not modelled.
 */
export function emitMosfet(name: string, ports: { drain: string; gate: string; source: string }, m: MosfetSpec): string[] {
  assertInstanceName(name); validateMosfet(m, `MOSFET ${name}`);
  const N = name.toUpperCase(), sp = `${name}_s`, gp = `${name}_g`;
  return [`M${name} ${ports.drain} ${gp} ${sp} ${sp} MOS${N} W=${m.widthM} L=${m.lengthM}`, `Vg${name} ${ports.gate} ${gp} DC 0`, `Vs${name} ${sp} ${ports.source} DC 0`,
    `.model MOS${N} NMOS(LEVEL=1 VTO=${m.vto} KP=${m.kp} LAMBDA=${m.lambda} TOX=${m.tox} CGSO=${m.cgso} CGDO=${m.cgdo})`];
}

// ---------------------------------------------------------------- DC motor port with a DECLARED rotational load
export interface DcMotorSpec { resistanceOhms: number; inductanceHenries: number; kVsPerRad: number }
/** The load the shaft sees, DECLARED: total inertia, viscous coefficient and a constant opposing torque. Not a fan (τ ∝ ω²), not a rack. */
export interface RotationalLoadSpec { inertiaKgM2: number; viscousNmS: number; constantTorqueNm: number }
export function validateDcMotor(m: DcMotorSpec, l: RotationalLoadSpec, name = 'Motor', rack?: RackLoad): void {
  finite(`${name} R`, m.resistanceOhms, 1e-3, 1e4); finite(`${name} L`, m.inductanceHenries, 1e-6, 10); finite(`${name} K`, m.kVsPerRad, 1e-4, 10);
  finite(`${name} load inertia`, l.inertiaKgM2, 1e-7, 100); finite(`${name} load viscous`, l.viscousNmS, 0, 10); finite(`${name} load torque`, l.constantTorqueNm, 0, 100);
  if (rack) validateRack(rack, `${name} rack`);
  if (l.viscousNmS === 0 && l.constantTorqueNm === 0 && !(rack && rack.massKg > 0)) throw new Error(`${name}: a load with neither friction nor torque has nothing to settle against`);
}
/** The brake/release protocol of the motor page: engaged from t = 0, released by a finite edge at `releaseAtSeconds`, or never (null). */
export interface MotorBrakeSpec { releaseAtSeconds: number | null; edgeSeconds: number }
export function validateMotorBrake(b: MotorBrakeSpec, stopSeconds: number, name = 'Motor'): void {
  finite(`${name} brake edge (s)`, b.edgeSeconds, 1e-9, stopSeconds);
  if (b.releaseAtSeconds !== null) finite(`${name} brake release time (s)`, b.releaseAtSeconds, b.edgeSeconds, stopSeconds - b.edgeSeconds);
}
/** What the shaft sees: J_eff = J + m·r² and τ = τ_const + m·g·r (the rack's reflected inertia and weight, shaft-load.ts). */
export const shaftInertia = (l: RotationalLoadSpec, rack?: RackLoad): number => rack ? l.inertiaKgM2 + reflectedInertia(rack) : l.inertiaKgM2;
export const shaftLoadTorque = (l: RotationalLoadSpec, rack?: RackLoad): number => rack ? l.constantTorqueNm + gravityTorque(rack) : l.constantTorqueNm;
/** A composition motor's brake symbols, all under its instance name. */
export function motorBrakeNames(name: string): BrakeNames {
  assertInstanceName(name);
  return { control: `Vbk${name}`, controlNode: `${name}_bc`, probe: `Vbr${name}`, probeNode: `${name}_bp`, switchName: `Sb${name}`, model: `SWBRK${name.toUpperCase()}` };
}
/**
 * The motor page's port model (v = R·i + L·di/dt + K·ω, τ = K·i, K_e = K_t assumed) with its
 * mechanics as the equivalent circuit, extracted: `${name}_w` is the SHAFT SPEED node (1 V ≡ 1 rad/s,
 * an observable), `i(L<name>)` the winding current, `Vm<name>` a 0 V probe at the + terminal
 * (`i(Vm<name>)` = current INTO the + terminal). Internal: `${name}_r`, `${name}_e`.
 * Electromechanical v1: an optional RIGID RACK (the page's exact 1-DOF reduction, shaft-load.ts) adds its reflected inertia
 * to the shaft capacitor and its weight to the load torque — the same equations the page deck uses; an optional BRAKE is the
 * page's brake/release constraint under this part's names (its reaction is `i(Vbr<name>)`, LEAVING the ω node). θ, the rack's
 * height and speed are not deck nodes: the reader derives them from ω (the page's reasoning, motor-netlist.ts). Without a
 * rack or brake the emitted lines are exactly the pre-v1 ones.
 */
export function emitDcMotorPort(name: string, plus: string, minus: string, m: DcMotorSpec, load: RotationalLoadSpec,
  rack?: RackLoad, brake?: MotorBrakeSpec, stopSeconds = 0): string[] {
  assertInstanceName(name); validateDcMotor(m, load, `Motor ${name}`, rack);
  if (brake) validateMotorBrake(brake, stopSeconds, `Motor ${name}`);
  const r = `${name}_r`, e = `${name}_e`, w = `${name}_w`, p = `${name}_p`;
  const tau = shaftLoadTorque(load, rack);
  const lines = [`Vm${name} ${plus} ${p} DC 0`, `R${name} ${p} ${r} ${m.resistanceOhms}`, `L${name} ${r} ${e} ${m.inductanceHenries}`,
    `Eb${name} ${e} ${minus} ${w} 0 ${m.kVsPerRad}`, `Bt${name} 0 ${w} I=${m.kVsPerRad}*i(L${name})`, `Cj${name} ${w} 0 ${shaftInertia(load, rack)}`];
  if (load.viscousNmS > 0) lines.push(`Rb${name} ${w} 0 ${1 / load.viscousNmS}`);
  if (tau > 0) lines.push(`Il${name} ${w} 0 DC ${tau}`);
  if (brake) lines.push(...emitShaftBrake(motorBrakeNames(name), w, brake.releaseAtSeconds, brake.edgeSeconds, stopSeconds));
  return lines;
}

// ---------------------------------------------------------------- coupled inductors (linear, two windings) — supported extension
export interface CoupledSpec { primaryHenries: number; secondaryHenries: number; coupling: number }
/** k strictly inside (0, 1): k → 1 is the ideal transformer, which this linear model does not represent (and its K matrix turns singular). */
export const COUPLING_LIMITS = { k: [1e-3, 0.999] } as const;
export function validateCoupled(s: CoupledSpec, name = 'Coupled inductors'): void {
  finite(`${name} primary L`, s.primaryHenries, STORAGE_LIMITS.minL, STORAGE_LIMITS.maxL);
  finite(`${name} secondary L`, s.secondaryHenries, STORAGE_LIMITS.minL, STORAGE_LIMITS.maxL);
  finite(`${name} coupling k`, s.coupling, COUPLING_LIMITS.k[0], COUPLING_LIMITS.k[1]);
}
/** M = k·√(L₁·L₂). */
export const mutualHenries = (s: CoupledSpec): number => s.coupling * Math.sqrt(s.primaryHenries * s.secondaryHenries);
/**
 * Two windings with a 0 V probe in each + lead: `i(Vk<name>a)` / `i(Vk<name>b)` are the currents INTO plus1 / plus2 (through
 * each winding from + to −). DOT CONVENTION: the dotted ends are plus1 and plus2 — a current rising into plus1 induces a
 * positive v(plus2) − v(minus2) of M·di₁/dt. Laws: v₁ = L₁·di₁/dt + M·di₂/dt, v₂ = M·di₁/dt + L₂·di₂/dt; stored energy
 * ½L₁i₁² + ½L₂i₂² + M·i₁i₂. No core loss, saturation, winding resistance or capacitance; no `ic=` (operating-point start).
 * Each winding needs a conduction path to ground (an isolated secondary with no reference is `unreachable-node`).
 * Private nodes `<name>_p1`, `<name>_p2`.
 */
export function emitCoupled(name: string, ports: { plus1: string; minus1: string; plus2: string; minus2: string }, s: CoupledSpec): string[] {
  assertInstanceName(name); validateCoupled(s, `Coupled inductors ${name}`);
  return [`Vk${name}a ${ports.plus1} ${name}_p1 DC 0`, `Lk${name}a ${name}_p1 ${ports.minus1} ${s.primaryHenries}`,
    `Vk${name}b ${ports.plus2} ${name}_p2 DC 0`, `Lk${name}b ${name}_p2 ${ports.minus2} ${s.secondaryHenries}`,
    `Kk${name} Lk${name}a Lk${name}b ${s.coupling}`];
}
