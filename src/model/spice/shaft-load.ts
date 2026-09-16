/**
 * THE SHAFT'S MECHANICAL LOAD — one definition shared by the motor page deck (`motor-netlist.ts`) and the public
 * composition motor (`parts.emitDcMotorPort`). Electromechanical v1 (bridge/ELECTROMECHANICAL-V1-PLAN.md).
 *
 * THE RIGID RACK, an exact reduced one-degree-of-freedom model: an ideal rack on a pinion of fixed radius r, rigid and
 * without slip, has no coordinate of its own — x = r·θ and v = r·ω EXACTLY — so its mass enters the shaft equation as
 * reflected inertia m·r² and its weight as the torque m·g·r. These are MODEL EQUATIONS, not renderer transforms: the
 * reported height and speed are computed from them, and the kinetic energy of the rack is ½·m·v² = ½·(m·r²)·ω², which is
 * already inside ½·J_eff·ω² — never added a second time. A rigid rack can push as well as pull, so no tension domain is
 * claimed; a cable (tension ≥ 0, slack) is not this model.
 *
 * THE BRAKE, a declared constraint: a switch shorting the ω node to ground through a 0 V probe, so ω is held at zero while
 * it is engaged and its reaction torque is a SOLVER OUTPUT (the probe current), booked rather than assumed. Released by its
 * own finite PWL edge, or never. The same lines the page deck has always written, from one emitter.
 * This module imports nothing: `parts.ts` and `motor-netlist.ts` both depend on it, never the reverse.
 */

export interface RackLoad {
  massKg: number;
  /** Pinion radius, m: h = r·θ, τ_load = m·g·r, J_load = m·r². */
  pinionRadiusM: number;
  gravity: number;
}

export const RACK_LIMITS = { mass: [0, 1000], radius: [1e-3, 1], gravity: [0, 100] } as const;

export function validateRack(l: RackLoad, name = 'Rack'): void {
  const f = (what: string, v: number, lo: number, hi: number) => {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} ${what} must be a finite number in ${lo}…${hi} (got ${v})`);
  };
  f('mass (kg)', l.massKg, RACK_LIMITS.mass[0], RACK_LIMITS.mass[1]);
  f('pinion radius (m)', l.pinionRadiusM, RACK_LIMITS.radius[0], RACK_LIMITS.radius[1]);
  f('gravity (m/s²)', l.gravity, RACK_LIMITS.gravity[0], RACK_LIMITS.gravity[1]);
}

/** J_load = m·r², the rack's inertia seen at the shaft. */
export const reflectedInertia = (l: RackLoad): number => l.massKg * l.pinionRadiusM ** 2;
/** τ_g = m·g·r, the rack's weight as a torque opposing lift. */
export const gravityTorque = (l: RackLoad): number => l.massKg * l.gravity * l.pinionRadiusM;
/** x = r·θ and v = r·ω: the rack's height and speed from the shaft state (positive = lifting). */
export const rackHeight = (l: RackLoad, thetaRad: number): number => l.pinionRadiusM * thetaRad;
export const rackVelocity = (l: RackLoad, omegaRadPerS: number): number => l.pinionRadiusM * omegaRadPerS;

/** The brake's symbol names, so the page deck keeps its historical names and a composition part gets its own namespace. */
export interface BrakeNames { control: string; controlNode: string; probe: string; probeNode: string; switchName: string; model: string }

/**
 * The brake lines: control source (1 = engaged; released by a finite edge at `releaseAtSeconds`, or never when null),
 * the 0 V probe from the ω node, the switch to ground and its model. `i(probe)` LEAVES the ω node — the resisting torque —
 * so the torque the brake APPLIES to the shaft is −i(probe).
 */
export function emitShaftBrake(n: BrakeNames, omegaNode: string, releaseAtSeconds: number | null, edgeSeconds: number, stopSeconds: number): string[] {
  return [
    `${n.control} ${n.controlNode} 0 ${releaseAtSeconds === null ? 'DC 1' : `PWL(0 1 ${releaseAtSeconds} 1 ${releaseAtSeconds + edgeSeconds} 0 ${stopSeconds} 0)`}`,
    `${n.probe} ${omegaNode} ${n.probeNode} DC 0`,
    `${n.switchName} ${n.probeNode} 0 ${n.controlNode} 0 ${n.model}`,
    `.model ${n.model} SW(RON=1e-6 ROFF=1e12 VT=0.5 VH=0.1)`,
  ];
}

