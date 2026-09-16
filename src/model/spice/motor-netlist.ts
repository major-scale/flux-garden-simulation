/**
 * A DC MOTOR LIFTING A RIGID LOAD, as a typed description that becomes ONE ngspice deck.
 *
 * The third fixed topology. The whole coupled system — electrical winding, ideal switch,
 * freewheel diode, and the mechanical shaft with its rigid rack load — is solved by ngspice as
 * ONE trajectory, which keeps the architecture Peter chose: one solved run, the page plays it.
 * The mechanical side is written into the deck as its equivalent circuit, and the map is stated:
 *
 *     node vw   : shaft angular velocity ω        (1 V  ≡ 1 rad/s)
 *     current   : torque into the ω node           (1 A  ≡ 1 N·m)
 *     Cj        : J_eff = J_motor + m·r²            (1 F  ≡ 1 kg·m²)
 *     Rb        : 1 / b, the viscous coefficient    (1 Ω  ≡ 1 s/(kg·m²))
 *     Il        : m·g·r, the load torque of the rack (DC current OUT of the node)
 *     Bt        : K·i(LM), the motor torque IN       (behavioural current source)
 *     θ = ∫ω dt : integrated by the READER (trapezoid on the solver's grid), not by the deck.
 *                 A θ node (Bth/Cth) needs a DC path to be solvable, and that path multiplies
 *                 the brake's 5e-8 V residual by its resistance: measured −4.9e4 rad at rest
 *                 with a 1e12 Ω path. θ is a definition, not a state the solver knows better.
 *     h = r·θ   : the rack's height, computed by the reader
 *
 * THE MOTOR IS A PORT MODEL: v = R·i + L·di/dt + K·ω at its terminals, τ = K·i at its shaft,
 * with K_e = K_t = K — an ASSUMPTION of the reciprocal ideal SI model, stated, not derived.
 * The back-EMF node `nc` is INTERNAL to the model (the top of the E source); it is not a
 * terminal anyone could probe on a real motor, and the page draws it inside the winding.
 *
 * THE LOAD IS A RIGID RACK, which can push as well as pull, so no tension domain is claimed.
 * A cable would need τ_load ≥ 0 checked against the trajectory and a stop before slack; it is
 * not this batch. The rack's mapping and the brake's lines are the SHARED definitions in
 * `shaft-load.ts` (electromechanical v1): the public composition motor uses the same ones, and
 * this deck's bytes are unchanged by the move (checked against a recorded baseline).
 *
 * THE SWITCH IS AN IDEAL SWITCH MODEL, ngspice's own `SW` (RON, ROFF, VT, VH), named as such.
 * It is not the MOSFET: that device's conduction depends on its gate, and one operating point
 * of it is not a switch. The MOSFET is outside this validation, and the page says so.
 *
 * THE BRAKE IS A DECLARED CONSTRAINT: a second SW element shorting the ω node through a 0 V
 * probe, so ω is held at zero while it is engaged AND its reaction torque is a solver output
 * (`i(vbr)`), booked rather than assumed. Every run starts braked and at rest, which is why
 * the operating point at t = 0 is exact and no `uic` is needed; the switch closes and the brake
 * releases at declared instants (finite PWL edges, as everywhere else in this project).
 *
 * THE FREEWHEEL DIODE across the motor terminals is the illustrative part from the diode page,
 * with a 0 V probe in series so ITS current is a solver output. It is the declared energy path
 * for the winding current when the switch opens: without it an inductor current would have
 * nowhere to go and the deck would be asking the solver for an impossible state.
 */
import { assertAscii } from './netlist';
import type { DiodeSpec } from './netlist';
import { pulseControl, emitSwitch } from './parts';
import { reflectedInertia, gravityTorque, emitShaftBrake, RACK_LIMITS, type RackLoad } from './shaft-load';

export type { RackLoad } from './shaft-load';

export interface MotorSpec {
  /** Winding resistance, Ω, and inductance, H. */
  resistanceOhms: number;
  inductanceHenries: number;
  /** K, the motor constant: V·s/rad and N·m/A, ONE number by the reciprocal-ideal assumption. */
  kVsPerRad: number;
  /** Rotor inertia, kg·m². */
  rotorInertiaKgM2: number;
  /** Viscous friction, N·m·s/rad. Zero allowed. */
  viscousNmS: number;
}

export interface SwitchSpec {
  rOnOhms: number;
  rOffOhms: number;
}

export interface MotorProgramme {
  /** The switch closes here (finite edge), or never. */
  closeAtSeconds: number | null;
  /** The switch opens here, or never. Must follow the close. */
  openAtSeconds: number | null;
  /** The brake releases here, or never (Locked shaft). */
  releaseBrakeAtSeconds: number | null;
  edgeSeconds: number;
}

export interface MotorDescription {
  topology: 'motor';
  supplyVolts: number;
  motor: MotorSpec;
  load: RackLoad;
  switch: SwitchSpec;
  freewheel: Omit<DiodeSpec, 'orientation'>;
  programme: MotorProgramme;
  stopSeconds: number;
  stepSeconds: number;
}

export const MOTOR_NODES = {
  supply: 'nd', control: 'ctl', terminal: 'na', afterR: 'nb', backEmf: 'nc',
  diodeProbe: 'dk', omega: 'vw', brakeProbe: 'bk', brakeControl: 'brk',
} as const;

export const MOTOR_LIMITS = {
  maxVolts: 100, minR: 1e-3, maxR: 1e4, minL: 1e-6, maxL: 10, k: [1e-4, 10], j: [1e-7, 100],
  b: [0, 10], mass: RACK_LIMITS.mass, radius: RACK_LIMITS.radius, gravity: RACK_LIMITS.gravity,
  rOn: [1e-4, 10], rOff: [1e3, 1e12], minStep: 1e-9, maxStop: 60, maxPoints: 200_000,
} as const;

function finite(name: string, v: number, lo: number, hi: number): void {
  if (!Number.isFinite(v) || v < lo || v > hi)
    throw new Error(`${name} must be a finite number in ${lo}…${hi} (got ${v})`);
}

export const effectiveInertia = (c: MotorDescription): number =>
  c.motor.rotorInertiaKgM2 + reflectedInertia(c.load);
export const loadTorque = (c: MotorDescription): number => gravityTorque(c.load);

export function validateMotor(c: MotorDescription): void {
  if (c.topology !== 'motor') throw new Error(`Not a motor description (topology ${String(c.topology)})`);
  const L = MOTOR_LIMITS;
  finite('Supply voltage', c.supplyVolts, 0, L.maxVolts);
  finite('Winding resistance', c.motor.resistanceOhms, L.minR, L.maxR);
  finite('Winding inductance', c.motor.inductanceHenries, L.minL, L.maxL);
  finite('Motor constant K', c.motor.kVsPerRad, L.k[0], L.k[1]);
  finite('Rotor inertia', c.motor.rotorInertiaKgM2, L.j[0], L.j[1]);
  finite('Viscous friction', c.motor.viscousNmS, L.b[0], L.b[1]);
  finite('Load mass', c.load.massKg, L.mass[0], L.mass[1]);
  finite('Pinion radius', c.load.pinionRadiusM, L.radius[0], L.radius[1]);
  finite('Gravity', c.load.gravity, L.gravity[0], L.gravity[1]);
  finite('Switch on-resistance', c.switch.rOnOhms, L.rOn[0], L.rOn[1]);
  finite('Switch off-resistance', c.switch.rOffOhms, L.rOff[0], L.rOff[1]);
  const d = c.freewheel;
  finite('Diode IS', d.is, 1e-20, 1); finite('Diode N', d.n, 0.5, 5); finite('Diode RS', d.rs, 0, 100);
  if (d.cjo !== 0 || d.tt !== 0) throw new Error('The freewheel diode is quasi-static in this slice: CJO and TT must be 0.');
  finite('Diode BV', d.bv, 1, 1e4); finite('Diode IBV', d.ibv, 1e-12, 1);
  finite('Output step', c.stepSeconds, L.minStep, L.maxStop);
  finite('Stop time', c.stopSeconds, c.stepSeconds, L.maxStop);
  if (c.stopSeconds / c.stepSeconds > L.maxPoints)
    throw new Error(`That horizon needs ${Math.round(c.stopSeconds / c.stepSeconds)} output points, above the ${L.maxPoints} limit.`);
  const p = c.programme;
  finite('Edge', p.edgeSeconds, c.stepSeconds, c.stopSeconds);
  for (const [name, t] of [['Switch close', p.closeAtSeconds], ['Switch open', p.openAtSeconds], ['Brake release', p.releaseBrakeAtSeconds]] as const)
    if (t !== null) {
      // STRICTLY AFTER ZERO, so the operating point at t = 0 is the braked, open, resting circuit
      // and every event is a finite edge inside the run.
      finite(`${name} time`, t, p.edgeSeconds, c.stopSeconds - p.edgeSeconds);
    }
  if (p.openAtSeconds !== null && (p.closeAtSeconds === null || p.openAtSeconds < p.closeAtSeconds + p.edgeSeconds))
    throw new Error('The switch can only open after it has closed.');
  if (c.motor.viscousNmS === 0 && c.load.massKg === 0)
    throw new Error('With no friction and no load the shaft has nothing to settle against; add one.');
}


export function buildMotorNetlist(c: MotorDescription): string {
  validateMotor(c);
  const N = MOTOR_NODES, m = c.motor, p = c.programme;
  const lines = ['* Flux Garden: DC motor lifting a rigid rack load, generated from a validated description'];
  lines.push(`Vdd ${N.supply} 0 DC ${c.supplyVolts}`);
  // THE SHARED IDEAL-SWITCH EMITTER (parts.ts): the same lines this file wrote before, now the
  // library's. `S1`/`SWMAIN` names are kept so the decoder's vectors and the tool are unchanged.
  lines.push(`Vsw ${N.control} 0 ${pulseControl(p.closeAtSeconds, p.openAtSeconds, p.edgeSeconds, c.stopSeconds)}`);
  lines.push(...emitSwitch('1', N.supply, N.terminal, N.control, c.switch).map((l) => l.replace('SW1', 'SWMAIN')));
  lines.push(`RM ${N.terminal} ${N.afterR} ${m.resistanceOhms}`);
  lines.push(`LM ${N.afterR} ${N.backEmf} ${m.inductanceHenries}`);
  lines.push(`EB ${N.backEmf} 0 ${N.omega} 0 ${m.kVsPerRad}`);
  lines.push(`Vdp 0 ${N.diodeProbe} DC 0`);
  lines.push(`D1 ${N.diodeProbe} ${N.terminal} DFW`);
  const d = c.freewheel;
  lines.push(`.model DFW D(IS=${d.is} N=${d.n} RS=${d.rs} CJO=${d.cjo} TT=${d.tt} BV=${d.bv} IBV=${d.ibv})`);
  // ---- the mechanical side, as its equivalent circuit (map in the header)
  lines.push(`Bt 0 ${N.omega} I=${m.kVsPerRad}*i(LM)`);
  lines.push(`Cj ${N.omega} 0 ${effectiveInertia(c)}`);
  if (m.viscousNmS > 0) lines.push(`Rb ${N.omega} 0 ${1 / m.viscousNmS}`);
  if (c.load.massKg > 0) lines.push(`Il ${N.omega} 0 DC ${loadTorque(c)}`);
  // THE BRAKE: the shared emitter (shaft-load.ts) with this deck's historical names, so ω ≡ 0
  // while engaged and the reaction torque is `i(vbr)`. Released by its own control edge, or never.
  lines.push(...emitShaftBrake({ control: 'Vbrk', controlNode: N.brakeControl, probe: 'Vbr', probeNode: N.brakeProbe, switchName: 'Sb', model: 'SWBRAKE' },
    N.omega, p.releaseBrakeAtSeconds, p.edgeSeconds, c.stopSeconds));
  lines.push('.options reltol=1e-4');
  lines.push(`.tran ${c.stepSeconds} ${c.stopSeconds} 0 ${c.stepSeconds}`);
  lines.push('.end');
  const netlist = lines.join('\n') + '\n';
  assertAscii(netlist);
  return netlist;
}
