/**
 * A TYPED CIRCUIT DESCRIPTION, AND THE ONLY THING THAT BECOMES A NETLIST.
 *
 * The solver never receives a user-authored command. It receives a netlist generated here from
 * a validated description, so there is no command channel to abuse and no arbitrary ngspice
 * control to allow-list. Every field is checked before a line of SPICE is written.
 *
 * WHAT THIS IS NOT: a circuit editor. The topology is fixed — source, resistor, optional diode,
 * inductor, capacitor in series — and only its parameters, the diode's presence and orientation,
 * and a scheduled source event can vary.
 */

export type DiodeOrientation = 'forward' | 'reverse';

export interface DiodeSpec {
  /** Saturation current, amperes. */
  is: number;
  /** Emission coefficient. */
  n: number;
  /** Ohmic series resistance. */
  rs: number;
  /**
   * Zero-bias junction capacitance and transit time. BOTH ZERO in the first slice, which makes
   * the diode QUASI-STATIC: no charge storage, no reverse recovery, and therefore no claim about
   * high-frequency or switching behaviour. With either non-zero, terminal power is no longer all
   * heat and the current can reverse while stored charge comes back out.
   */
  cjo: number;
  tt: number;
  /** Reverse breakdown voltage and the current at which it is specified. */
  bv: number;
  ibv: number;
  orientation: DiodeOrientation;
}

export interface SourceEvent {
  /** Seconds. The source steps to `toVolts` here, over `edgeSeconds`. */
  atSeconds: number;
  toVolts: number;
  /**
   * A FINITE transition, never a true step. A PWL corner also forces a solver breakpoint at the
   * event, and the finite edge is what makes "which side of the event" a real question rather
   * than an artefact — snapshot lookup must never interpolate across it.
   */
  edgeSeconds: number;
}

export interface CircuitDescription {
  sourceVolts: number;
  resistanceOhms: number;
  inductanceHenries: number;
  capacitanceFarads: number;
  initialCapacitorVolts: number;
  /**
   * Initial inductor current. Present so a saved session round-trips a real starting state
   * rather than silently assuming rest — it was absent from the first version, which meant a
   * non-zero start could not be described at all.
   */
  initialInductorAmps: number;
  /** Absent means no diode in the loop at all — the bypass. */
  diode?: DiodeSpec;
  /**
   * A SINE SOURCE INSTEAD OF A CONSTANT ONE.
   *
   * Without this the source is a step that settles, and a settled circuit is a still picture. A
   * diode's actual function — passing one direction and not the other — cannot be shown at all by
   * a source that only ever goes one way.
   */
  sourceSine?: { amplitudeVolts: number; frequencyHz: number; offsetVolts: number };
  /**
   * A LOAD ACROSS THE CAPACITOR, and the reason the diode can keep working.
   *
   * MEASURED: with the series topology alone, a forward diode charges the capacitor once and the
   * scene is frozen for 89.7% of the run — Vc identical to four decimals at 20, 40, 60, 80 and
   * 100% of it. Driving the source with a sine does NOT fix that; it freezes at 4.4% instead,
   * because a series diode feeding a series capacitor with no discharge path is a peak detector.
   * It charges to the peak and stops, and that is structural, not a tuning problem.
   *
   * A load gives the charge somewhere to go between peaks, so the diode conducts again on the
   * next one. Same run, with 20 kΩ across the capacitor: current still flowing at 92.1% of the
   * run, the diode turning on 8 separate times, and 1.81 V of ripple still present in the final
   * quarter. That is a half-wave rectifier, and it is the diode's basic function.
   */
  loadResistanceOhms?: number;
  /** At most one scheduled source change, solved INSIDE the single transient. */
  event?: SourceEvent;
  /** Simulated horizon and the requested output step. */
  stopSeconds: number;
  stepSeconds: number;
  /**
   * An opaque marker for everything that is DRAWN but not electrical — the winding's turn
   * count and dimensions, the pickup's pose. It changes nothing in the netlist, and that is
   * precisely why it is needed: without it a coil edit leaves the electrical description equal
   * while the scene would draw a different object beside the same trajectory.
   */
  coilSignature?: string;
}

export const NETLIST_LIMITS = {
  minR: 1e-3, maxR: 1e9,
  minL: 1e-12, maxL: 1e3,
  minC: 1e-15, maxC: 1,
  maxVolts: 1e4,
  minStep: 1e-15, maxStop: 1,
  /** A hard ceiling on output points, so a horizon cannot silently become unbounded work. */
  maxPoints: 200_000,
} as const;

function finite(name: string, v: number, lo: number, hi: number): void {
  if (!Number.isFinite(v) || v < lo || v > hi)
    throw new Error(`${name} must be a finite number in ${lo}…${hi} (got ${v})`);
}

export function validateCircuit(c: CircuitDescription): void {
  finite('Source voltage', c.sourceVolts, -NETLIST_LIMITS.maxVolts, NETLIST_LIMITS.maxVolts);
  finite('Resistance', c.resistanceOhms, NETLIST_LIMITS.minR, NETLIST_LIMITS.maxR);
  finite('Inductance', c.inductanceHenries, NETLIST_LIMITS.minL, NETLIST_LIMITS.maxL);
  finite('Capacitance', c.capacitanceFarads, NETLIST_LIMITS.minC, NETLIST_LIMITS.maxC);
  finite('Initial capacitor voltage', c.initialCapacitorVolts,
    -NETLIST_LIMITS.maxVolts, NETLIST_LIMITS.maxVolts);
  finite('Initial inductor current', c.initialInductorAmps, -1e6, 1e6);
  finite('Output step', c.stepSeconds, NETLIST_LIMITS.minStep, NETLIST_LIMITS.maxStop);
  finite('Stop time', c.stopSeconds, c.stepSeconds, NETLIST_LIMITS.maxStop);
  const points = c.stopSeconds / c.stepSeconds;
  if (points > NETLIST_LIMITS.maxPoints)
    throw new Error(`That horizon needs ${Math.round(points)} output points, above the `
      + `${NETLIST_LIMITS.maxPoints} limit. Shorten the run or coarsen the step.`);
  if (c.sourceSine) {
    if (c.event)
      throw new Error('A sine source and a scheduled step are two different experiments; '
        + 'describe one or the other, not both.');
    finite('Sine amplitude', c.sourceSine.amplitudeVolts, 0, NETLIST_LIMITS.maxVolts);
    finite('Sine offset', c.sourceSine.offsetVolts,
      -NETLIST_LIMITS.maxVolts, NETLIST_LIMITS.maxVolts);
    // At least a few output steps per source cycle, or the drive is aliased into nonsense and
    // the picture would show a frequency nobody asked for.
    finite('Sine frequency', c.sourceSine.frequencyHz, 1e-3, 1 / (8 * c.stepSeconds));
  }
  if (c.loadResistanceOhms !== undefined)
    finite('Load resistance', c.loadResistanceOhms, NETLIST_LIMITS.minR, NETLIST_LIMITS.maxR);
  if (c.event) {
    finite('Event time', c.event.atSeconds, 0, c.stopSeconds);
    finite('Event voltage', c.event.toVolts, -NETLIST_LIMITS.maxVolts, NETLIST_LIMITS.maxVolts);
    finite('Event edge', c.event.edgeSeconds, NETLIST_LIMITS.minStep, c.stopSeconds);
    // The ramp must FINISH inside the run. An edge that runs past the horizon leaves the
    // source mid-transition at the end, which is not the experiment anyone described.
    if (c.event.atSeconds + c.event.edgeSeconds > c.stopSeconds)
      throw new Error(`The source event ends at `
        + `${(c.event.atSeconds + c.event.edgeSeconds).toExponential(4)} s, past the `
        + `${c.stopSeconds.toExponential(4)} s horizon.`);
  }
  if (c.diode) {
    const d = c.diode;
    finite('Diode IS', d.is, 1e-20, 1e-3);
    finite('Diode N', d.n, 0.1, 10);
    finite('Diode RS', d.rs, 0, 1e6);
    // THIS SLICE IS QUASI-STATIC, and the limit enforces it rather than merely documenting it.
    // With junction capacitance or transit time, charge is stored in the junction: terminal
    // power stops being all heat and the current can reverse while that charge comes back out.
    // Nothing here is verified for that, so it is refused rather than silently allowed.
    if (d.cjo !== 0 || d.tt !== 0)
      throw new Error('This slice supports a quasi-static diode only: CJO and TT must be 0. '
        + 'Junction charge storage changes what the power and current readings mean, and none '
        + 'of that is verified here.');
    finite('Diode CJO', d.cjo, 0, 0);
    finite('Diode TT', d.tt, 0, 0);
    finite('Diode BV', d.bv, 0.1, 1e4);
    finite('Diode IBV', d.ibv, 1e-15, 1);
    if (d.orientation !== 'forward' && d.orientation !== 'reverse')
      throw new Error(`Diode orientation must be forward or reverse (got ${d.orientation})`);
    // THREE CONFIGURATIONS THE SOLVER COULD NOT COMPLETE. A TESTED LIMIT, not physics.
    //
    // A nine-scenario matrix (tools/diode-domain-matrix.mjs) ran every corner the controls reach,
    // in both orientations, against a solver tightened a thousand times beyond what ships.
    // Forward completed all nine. Reverse completed six, and these three did not:
    //
    //   reverse + capacitor charged to  8 V   engine failed to allocate 340 MB
    //   reverse + capacitor charged to -6 V   engine failed to allocate 340 MB
    //   reverse + 20 mA initial current       ngspice: "timestep too small ... node vs#branch"
    //
    // MY FIRST VERSION EXPLAINED WHY, AND THE EXPLANATION WAS WRONG. It said a reverse diode
    // "blocks the loop" so stored energy "has no path". A reverse-PLACED diode is not a
    // permanently blocking one — whether it conducts depends on the applied bias; a charged
    // capacitor sitting behind a non-conducting device is not a contradiction; and a forward
    // placement blocks one polarity of initial current just the same. I had diagnosed a mechanism
    // from an allocation failure and put it in a user-facing message. Astra caught it.
    //
    // What is known: with THIS engine, THIS diode model and THESE three configurations, the solve
    // did not complete. Refused with that stated as such — better than a run that dies mid-solve,
    // and better than a confident account of why.
    if (d.orientation === 'reverse'
        && (c.initialCapacitorVolts !== 0 || c.initialInductorAmps !== 0))
      throw new Error('Not supported: a reverse-placed diode together with stored initial energy '
        + `(capacitor ${c.initialCapacitorVolts} V, inductor ${c.initialInductorAmps} A). `
        + 'In testing, runs of this shape did not complete — the solver either exhausted memory '
        + 'or drove its timestep to zero — so it is refused rather than started. That is a limit '
        + 'of what has been verified here, not a claim about what the circuit would do. Start '
        + 'this run from rest, or turn the diode around.');
  }
}

/** The node names the snapshot channels are read from. Fixed, because the topology is fixed. */
export const NODES = {
  sourcePlus: 'n1',
  afterResistor: 'na',      // diode anode side when a diode is present
  inductorIn: 'n2',
  capacitorPlus: 'n3',
} as const;

export function buildNetlist(c: CircuitDescription): string {
  validateCircuit(c);
  const lines: string[] = ['* Flux Garden: generated from a validated description, not authored'];

  if (c.event) {
    // A finite PWL edge, so the transition is a real ramp with a solver breakpoint at each
    // corner rather than an idealised discontinuity the integrator has to guess at.
    const t0 = c.event.atSeconds, t1 = c.event.atSeconds + c.event.edgeSeconds;
    lines.push(`Vs ${NODES.sourcePlus} 0 PWL(0 ${c.sourceVolts} ${t0} ${c.sourceVolts} `
      + `${t1} ${c.event.toVolts})`);
  } else if (c.sourceSine) {
    // OFFSET, AMPLITUDE, FREQUENCY — ngspice's own argument order. `uic` still applies: the run
    // starts from the authored state, not from a steady state the viewer never saw.
    lines.push(`Vs ${NODES.sourcePlus} 0 SIN(${c.sourceSine.offsetVolts} `
      + `${c.sourceSine.amplitudeVolts} ${c.sourceSine.frequencyHz})`);
  } else {
    lines.push(`Vs ${NODES.sourcePlus} 0 DC ${c.sourceVolts}`);
  }

  if (c.diode) {
    lines.push(`R1 ${NODES.sourcePlus} ${NODES.afterResistor} ${c.resistanceOhms}`);
    // Orientation is the ORDER OF THE TERMINALS, which is what orientation physically is.
    lines.push(c.diode.orientation === 'forward'
      ? `D1 ${NODES.afterResistor} ${NODES.inductorIn} DMOD`
      : `D1 ${NODES.inductorIn} ${NODES.afterResistor} DMOD`);
    lines.push(`.model DMOD D(IS=${c.diode.is} N=${c.diode.n} RS=${c.diode.rs} `
      + `CJO=${c.diode.cjo} TT=${c.diode.tt} BV=${c.diode.bv} IBV=${c.diode.ibv})`);
    // TIGHTER TOLERANCES, AND ONLY WITH A DIODE.
    //
    // WHY TIGHTEN. ngspice's convergence test on a node is `reltol·|v| + vntol`, default reltol
    // 1e-3. Both diode nodes sit near the 10 V rail, so each is allowed about 10 mV of slop — but
    // the diode's terminal voltage is the small DIFFERENCE of those two large numbers, so the
    // whole slop lands on it, and through the exponential a few mV is tens of percent of current.
    // A DC sweep of the same model agrees with the device law to 1e-5 at the defaults, because
    // there the diode's node sits at 0.4-0.75 V and the same reltol allows only ~0.7 mV. The
    // error is not in the model; it is what an exponential device riding on a rail does.
    //
    //     ngspice defaults   1.17e-2 of peak
    //     reltol=1e-4        1.64e-3
    //     reltol=1e-5        5.30e-4
    //     reltol=1e-6        4.93e-5      <- taken
    //
    // AND NO `chgtol`. The first version of this line carried `chgtol=1e-17`, which I copied from
    // the pickup verification deck — where it existed to resolve microvolt-scale signals — and
    // never justified here. It buys nothing: 4.50e-5 of peak with it against 4.93e-5 without,
    // on the very circuit the tolerances were tuned for. What it costs is whole classes of
    // circuit. ngspice's default is 1e-14, and at 88.5 pF and 10 V the charge in play is ~8.9e-10
    // C, so 1e-17 demands convergence to a ten-millionth of the stored charge; when the diode
    // switches, the timestep collapses and the run never finishes. Measured, a sine-driven
    // circuit with the diode reversed:
    //
    //     reltol=1e-6, chgtol=1e-17   HANGS (>60 s native, and hangs the WASM engine outright)
    //     reltol=1e-6, no chgtol      completes in 0.03 s
    //     reltol=1e-5, chgtol=1e-17   HANGS
    //     reltol=1e-5, no chgtol      completes in 0.02 s
    //
    // On the page that hang is a scene stuck on "Solving…" forever, which is what Peter hit the
    // moment an alternating drive existed. This is the third time I have added a solver setting
    // that was not needed and then had to deal with the damage it caused — the 1 GΩ terminator
    // and the missing `numdgt` were the same shape. The setting is gone, not compensated for.
    lines.push('.options reltol=1e-6 vntol=1e-9 abstol=1e-15');
  } else {
    lines.push(`R1 ${NODES.sourcePlus} ${NODES.inductorIn} ${c.resistanceOhms}`);
  }

  // The inductor's OWN initial condition. `.ic` sets node voltages; it does not set a branch
  // current, so without this the description could carry a starting current that the solver
  // never applied — recorded in the snapshot, absent from the physics.
  lines.push(`L1 ${NODES.inductorIn} ${NODES.capacitorPlus} ${c.inductanceHenries} `
    + `ic=${c.initialInductorAmps}`);
  lines.push(`C1 ${NODES.capacitorPlus} 0 ${c.capacitanceFarads} ic=${c.initialCapacitorVolts}`);
  // ACROSS THE CAPACITOR, not in series with it: the point is a path the capacitor can discharge
  // through while the diode is blocking. In series it would be one more thing the diode blocks.
  if (c.loadResistanceOhms !== undefined)
    lines.push(`RL ${NODES.capacitorPlus} 0 ${c.loadResistanceOhms}`);
  lines.push(`.ic V(${NODES.capacitorPlus})=${c.initialCapacitorVolts}`);
  lines.push(`.tran ${c.stepSeconds} ${c.stopSeconds} 0 ${c.stepSeconds} uic`);
  lines.push('.end');
  const netlist = lines.join('\n') + '\n';
  assertAscii(netlist);
  return netlist;
}

/**
 * A NETLIST MUST BE PURE ASCII, and this is not pedantry.
 *
 * Measured against this engine: the identical deck solves in 29 ms with an ASCII title and
 * HANGS FOREVER with a single em dash in the comment line. It does not error, it does not
 * refuse — it never returns. My own generated title contained one, which is how it was found.
 *
 * So the check is here, before anything reaches the solver, and it names the character. The
 * worker timeout is the net beneath it, not the plan.
 */
export function assertAscii(netlist: string): void {
  for (let k = 0; k < netlist.length; k++) {
    const code = netlist.charCodeAt(k);
    if (code > 126 || (code < 32 && code !== 10)) {
      const line = netlist.slice(0, k).split('\n').length;
      throw new Error(`Netlist contains a non-ASCII or control character `
        + `(U+${code.toString(16).toUpperCase().padStart(4, '0')}) on line ${line}. `
        + `This engine HANGS on such a deck rather than refusing it, so it is rejected here.`);
    }
  }
}
