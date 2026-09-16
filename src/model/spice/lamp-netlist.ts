/**
 * A TRANSISTOR-CONTROLLED LAMP, as a typed description that becomes a netlist.
 *
 * The second fixed topology this page can solve, beside the series RLC. Same rule as
 * `netlist.ts`: the solver never receives an authored command; every field is validated before a
 * line of SPICE is written, and the topology itself cannot vary — a low-side n-channel MOSFET
 * switching a resistive lamp from a DC supply, with the gate driven through a resistor by a
 * programmed control source.
 *
 *     Vdd   nd  0   DC <supply>          the supply, whose current is the LOAD current
 *     RLAMP nd  d   <lampOhms>           the lamp: a constant-resistance indicator, by name
 *     M1    d   g   s  s  MMOD           drain, gate, source, bulk — bulk tied to source
 *     Vsrc  s   0   DC 0                 a 0 V probe, so the SOURCE terminal current is read
 *     RG    c   g   <gateOhms>           the gate resistor: the control current flows here
 *     Vg    c   0   PWL|SIN              the gate programme, the thing the viewer changes
 *
 * THE MODEL IS ILLUSTRATIVE AND SAYS SO. Level-1 (Shichman–Hodges) NMOS with stated VTO, KP,
 * LAMBDA, TOX and overlap capacitances — not a datasheet part. Its limits, agreed with Astra
 * before the build (docs/TRANSISTOR-LAMP-PLAN.md): no subthreshold conduction, no velocity
 * saturation, no temperature; the body diode is present in the model but never forward-biased
 * in the supported domain (drain never below source — checked against the trajectory, as a
 * tolerance, in `lamp.ts`); the gate capacitances are the model's own Meyer capacitances, which
 * the ngspice manual (§11.2.1) states are NOT charge-conserving — so the gate charging current
 * is shown as what the model produced, and no gate-energy or switching-loss lesson is drawn
 * from it.
 *
 * NO `uic`. The RLC run starts from an AUTHORED state and must skip the operating point. This
 * circuit has no authored stored state: it starts from the operating point the programme's t = 0
 * value produces, and ngspice's first sample is then AT t = 0. `toLampTransient` requires it.
 */
import { assertAscii } from './netlist';

export interface MosfetSpec {
  /** Threshold voltage, V. */
  vto: number;
  /** Transconductance parameter, A/V². */
  kp: number;
  /** Channel-length modulation, 1/V. */
  lambda: number;
  /** Oxide thickness, m — sets the model's gate capacitance. */
  tox: number;
  /** Gate–source and gate–drain overlap capacitance per metre of width, F/m. */
  cgso: number;
  cgdo: number;
  /** Channel width and length, m. */
  widthM: number;
  lengthM: number;
}

/** The page's own transistor: illustrative, not a manufactured part. */
export const DEFAULT_MOSFET_PART: MosfetSpec = {
  vto: 2, kp: 20e-6, lambda: 0.01, tox: 1e-7, cgso: 1e-9, cgdo: 1e-9, widthM: 10e-3, lengthM: 1e-6,
};

export type GateProgramme =
  /** Piecewise-linear: a finite edge between corners, never an ideal step. First point at 0 s. */
  | { kind: 'pwl'; points: { atSeconds: number; volts: number }[] }
  | { kind: 'sine'; offsetVolts: number; amplitudeVolts: number; frequencyHz: number };

export interface LampDescription {
  topology: 'lamp';
  supplyVolts: number;
  lampOhms: number;
  gateOhms: number;
  mosfet: MosfetSpec;
  gate: GateProgramme;
  stopSeconds: number;
  stepSeconds: number;
}

export const LAMP_NODES = {
  supply: 'nd', drain: 'd', gate: 'g', control: 'c', source: 's',
} as const;

export const LAMP_LIMITS = {
  maxVolts: 100,
  minR: 1e-2, maxR: 1e7,
  minGateR: 1, maxGateR: 1e7,
  vto: [-10, 10], kp: [1e-9, 10], lambda: [0, 1], tox: [1e-9, 1e-5], overlap: [0, 1e-6],
  dimension: [1e-7, 1],
  minStep: 1e-15, maxStop: 1,
  maxPoints: 200_000,
  maxPwlPoints: 64,
} as const;

function finite(name: string, v: number, lo: number, hi: number): void {
  if (!Number.isFinite(v) || v < lo || v > hi)
    throw new Error(`${name} must be a finite number in ${lo}…${hi} (got ${v})`);
}

export function validateLamp(c: LampDescription): void {
  if (c.topology !== 'lamp') throw new Error(`Not a lamp description (topology ${String(c.topology)})`);
  const L = LAMP_LIMITS;
  finite('Supply voltage', c.supplyVolts, 0, L.maxVolts);
  finite('Lamp resistance', c.lampOhms, L.minR, L.maxR);
  finite('Gate resistance', c.gateOhms, L.minGateR, L.maxGateR);
  const m = c.mosfet;
  finite('Threshold voltage', m.vto, L.vto[0], L.vto[1]);
  finite('Transconductance parameter', m.kp, L.kp[0], L.kp[1]);
  finite('Channel-length modulation', m.lambda, L.lambda[0], L.lambda[1]);
  finite('Oxide thickness', m.tox, L.tox[0], L.tox[1]);
  finite('Gate-source overlap capacitance', m.cgso, L.overlap[0], L.overlap[1]);
  finite('Gate-drain overlap capacitance', m.cgdo, L.overlap[0], L.overlap[1]);
  finite('Channel width', m.widthM, L.dimension[0], L.dimension[1]);
  finite('Channel length', m.lengthM, L.dimension[0], L.dimension[1]);
  finite('Output step', c.stepSeconds, L.minStep, L.maxStop);
  finite('Stop time', c.stopSeconds, c.stepSeconds, L.maxStop);
  const points = c.stopSeconds / c.stepSeconds;
  if (points > L.maxPoints)
    throw new Error(`That horizon needs ${Math.round(points)} output points, above the `
      + `${L.maxPoints} limit. Shorten the run or coarsen the step.`);
  const g = c.gate;
  if (g.kind === 'pwl') {
    if (g.points.length < 2 || g.points.length > L.maxPwlPoints)
      throw new Error(`A gate programme needs 2…${L.maxPwlPoints} corners (got ${g.points.length}).`);
    if (g.points[0].atSeconds !== 0)
      throw new Error('The gate programme must state its value at 0 s: the run starts from the '
        + 'operating point that value produces.');
    g.points.forEach((p, k) => {
      finite(`Gate corner ${k} time`, p.atSeconds, 0, c.stopSeconds);
      // Every corner voltage stays within the supply: a gate driven above the rail is outside
      // what this slice shows, and a negative gate is a different experiment.
      finite(`Gate corner ${k} voltage`, p.volts, -L.maxVolts, L.maxVolts);
      if (k > 0 && !(p.atSeconds > g.points[k - 1].atSeconds))
        throw new Error(`Gate corners must be strictly increasing in time (corner ${k}).`);
    });
    // THE LAST CORNER MUST BE INSIDE THE RUN, so the programme is fully described by what is
    // shown. (ngspice holds the last value after it, which is fine; a corner past the horizon
    // would be an instruction nobody watched.)
  } else {
    finite('Gate sine amplitude', g.amplitudeVolts, 0, L.maxVolts);
    finite('Gate sine offset', g.offsetVolts, -L.maxVolts, L.maxVolts);
    // At least eight output steps per cycle, or the programme is aliased into nonsense.
    finite('Gate sine frequency', g.frequencyHz, 1e-3, 1 / (8 * c.stepSeconds));
  }
}

/** The gate programme's value at t = 0: the operating point the run starts from. */
export function gateAtStart(g: GateProgramme): number {
  return g.kind === 'pwl' ? g.points[0].volts : g.offsetVolts;
}

/** Every finite transition in a PWL programme, so lookup can say when it is inside one. */
export function gateEdges(g: GateProgramme): { atSeconds: number; edgeSeconds: number }[] {
  if (g.kind !== 'pwl') return [];
  const edges: { atSeconds: number; edgeSeconds: number }[] = [];
  for (let k = 1; k < g.points.length; k++) {
    const a = g.points[k - 1], b = g.points[k];
    if (a.volts !== b.volts) edges.push({ atSeconds: a.atSeconds, edgeSeconds: b.atSeconds - a.atSeconds });
  }
  return edges;
}

export function buildLampNetlist(c: LampDescription): string {
  validateLamp(c);
  const N = LAMP_NODES;
  const m = c.mosfet;
  const lines: string[] = ['* Flux Garden: transistor lamp, generated from a validated description'];
  lines.push(`Vdd ${N.supply} 0 DC ${c.supplyVolts}`);
  lines.push(`RLAMP ${N.supply} ${N.drain} ${c.lampOhms}`);
  // BULK TIED TO SOURCE, and the source through a 0 V probe so its terminal current is a
  // solver output. That is what lets the three terminal currents be checked against each other.
  lines.push(`M1 ${N.drain} ${N.gate} ${N.source} ${N.source} MMOD W=${m.widthM} L=${m.lengthM}`);
  lines.push(`Vsrc ${N.source} 0 DC 0`);
  lines.push(`RG ${N.control} ${N.gate} ${c.gateOhms}`);
  if (c.gate.kind === 'pwl') {
    lines.push(`Vg ${N.control} 0 PWL(${c.gate.points.map((p) => `${p.atSeconds} ${p.volts}`).join(' ')})`);
  } else {
    lines.push(`Vg ${N.control} 0 SIN(${c.gate.offsetVolts} ${c.gate.amplitudeVolts} ${c.gate.frequencyHz})`);
  }
  lines.push(`.model MMOD NMOS(LEVEL=1 VTO=${m.vto} KP=${m.kp} LAMBDA=${m.lambda} TOX=${m.tox} `
    + `CGSO=${m.cgso} CGDO=${m.cgdo})`);
  // TOLERANCE, measured rather than copied. reltol 1e-4 on a 0.5 A load is 50 µA — invisible
  // on the lamp and a fraction of a percent of the near-threshold current. Tighter settings are
  // not needed and the diode work showed that copying a tight option can hang a solve.
  lines.push('.options reltol=1e-4');
  lines.push(`.tran ${c.stepSeconds} ${c.stopSeconds} 0 ${c.stepSeconds}`);
  lines.push('.end');
  const netlist = lines.join('\n') + '\n';
  assertAscii(netlist);
  return netlist;
}
