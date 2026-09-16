/**
 * THE SAVED DOCUMENT, when the coil has geometry.
 *
 * A geometry-mode session is not described by its lumped inputs alone: the same inductance can
 * come from many windings, and the field drawn is that winding's. Saving only the inputs meant
 * a geometry session reloaded as an authored-L session — the number survived and the object
 * that produced it did not.
 *
 * So the document carries the geometry as an OPTIONAL extra field. Files written before this
 * existed have no `coil` key, load exactly as they always did, and are never rewritten.
 */
import { encodeRlc, decodeRlc, type RlcInputs } from './rlc';
import { coilInductance, validateCoil, type CoilGeometry } from './coil';
import { mutualToPickup, validatePickup, type PickupGeometry } from './pickup';
import { validateCircuit, type DiodeSpec } from './spice/netlist';

export interface RlcDocument {
  inputs: RlcInputs;
  /** Absent for a phenomenological session: an authored inductance with no winding behind it. */
  coil?: CoilGeometry;
  /**
   * The pickup's pose, when one is placed. Its POSE is the whole of its identity — the same
   * loop at a different separation is a different experiment — so saving the session without
   * it would restore a different one. Requires a coil: there is nothing to couple to otherwise.
   */
  pickup?: PickupGeometry;
  /**
   * THE SOLVED-PLAYBACK SESSION, when one was running.
   *
   * A diode exists only under the nonlinear solver, so saving the lumped inputs alone reloaded a
   * DIFFERENT CIRCUIT — the same R, L and C with the device quietly gone. That is the same
   * failure the `coil` field exists to prevent, and it is worse here: forward and reverse differ
   * by nine orders of magnitude in current, so the reloaded run would not resemble the saved one.
   *
   * The whole `DiodeSpec` is stored, not just the orientation, because the part's parameters are
   * part of the circuit: restoring "forward" against a different IS or RS would be a different
   * device wearing the saved label.
   *
   * Files written before this existed have no `solver` key and load as they always did — solver
   * off, no diode — which is exactly what they described.
   */
  solver?: SolverSession;
}

export interface SolverSession {
  /**
   * True when the ngspice solver was driving. It is not optional: the analytic kernel solves a
   * linear RLC and cannot carry a diode, so a saved diode with this false would describe a
   * circuit no mode of this page can produce.
   */
  required: boolean;
  /** Absent means the device was bypassed — not in the netlist at all, as distinct from shorted. */
  diode?: DiodeSpec;
  /**
   * THE DRIVE AND THE TOPOLOGY, saved as values rather than as the name of a demonstration.
   *
   * These decide what the circuit IS: an alternating source makes the diode switch, and a load
   * across the capacitor is the reason it can keep switching. Recording only the diode meant a
   * saved rectifier reloaded as a series circuit with a diode in it — which is a different
   * experiment, and one that goes still. Saving a preset ID instead would tie every file to a
   * list of demonstrations that will change.
   *
   * Absent in files written before this, which describe a DC source and no load, and load that
   * way.
   */
  sourceSine?: { amplitudeVolts: number; frequencyHz: number; offsetVolts: number };
  loadResistanceOhms?: number;
  /** The solved horizon, so a reloaded run covers the same span rather than a re-derived one. */
  stopSeconds?: number;
  stepSeconds?: number;
}

/**
 * Check a solver section, or refuse it with the reason.
 *
 * The diode is validated through `validateCircuit` — the SAME gate the netlist uses — rather
 * than by a second copy of the rules here. A saved file that would not build a netlist must not
 * load; two independent validators would drift, and the quasi-static CJO = TT = 0 constraint is
 * exactly the kind of rule that would be dropped from the copy.
 */
function checkSolver(session: SolverSession): void {
  if (typeof session.required !== 'boolean')
    throw new Error('The solver section must say whether the solver was required.');
  if (!session.diode) return;
  if (!session.required)
    throw new Error('A diode cannot be saved with the solver off: the analytic kernel solves a '
      + 'linear RLC and has no diode to restore it into.');
  // Placeholder linear values: only the diode fields are under test here, and validateCircuit
  // needs a whole description to check one.
  validateCircuit({
    sourceVolts: 0, resistanceOhms: 1, inductanceHenries: 1, capacitanceFarads: 1,
    initialCapacitorVolts: 0, initialInductorAmps: 0, stopSeconds: 1, stepSeconds: 1,
    diode: session.diode,
  });
}

/**
 * The drive and topology, checked through the netlist's own gate.
 *
 * Split from the diode check because these apply whether or not a diode is present: a saved
 * alternating source with no device is a legitimate session, and must still be a buildable one.
 */
function checkDrive(session: SolverSession): void {
  const stop = session.stopSeconds ?? 1e-6;
  const step = session.stepSeconds ?? 1e-9;
  validateCircuit({
    sourceVolts: 0, resistanceOhms: 1, inductanceHenries: 1, capacitanceFarads: 1,
    initialCapacitorVolts: 0, initialInductorAmps: 0,
    stopSeconds: stop, stepSeconds: step,
    sourceSine: session.sourceSine, loadResistanceOhms: session.loadResistanceOhms,
  });
}

export function encodeRlcDoc(doc: RlcDocument): string {
  const base = JSON.parse(encodeRlc(doc.inputs));      // validates the inputs
  if (doc.solver) { checkSolver(doc.solver); checkDrive(doc.solver); }
  const solver = doc.solver
    ? { solver: {
        required: doc.solver.required,
        ...(doc.solver.diode ? { diode: { ...doc.solver.diode } } : {}),
        ...(doc.solver.sourceSine ? { sourceSine: { ...doc.solver.sourceSine } } : {}),
        ...(doc.solver.loadResistanceOhms !== undefined
          ? { loadResistanceOhms: doc.solver.loadResistanceOhms } : {}),
        ...(doc.solver.stopSeconds !== undefined ? { stopSeconds: doc.solver.stopSeconds } : {}),
        ...(doc.solver.stepSeconds !== undefined ? { stepSeconds: doc.solver.stepSeconds } : {}),
      } }
    : {};
  if (!doc.coil) {
    if (doc.pickup) throw new Error('A pickup cannot be saved without the coil it couples to');
    return JSON.stringify({ ...base, ...solver }, null, 2);
  }
  validateCoil(doc.coil);
  if (!doc.pickup)
    return JSON.stringify({ ...base, coil: { ...doc.coil }, ...solver }, null, 2);
  validatePickup(doc.pickup);
  mutualToPickup(doc.coil, doc.pickup);                // refuses an intersecting pose
  return JSON.stringify(
    { ...base, coil: { ...doc.coil }, pickup: { ...doc.pickup }, ...solver }, null, 2);
}

/**
 * Read a document. A stored geometry must still produce the stored inductance: if it does not,
 * the file has been edited into a state where the coil and the circuit disagree, and there is
 * no honest way to pick a winner — so it is refused with both numbers named rather than one
 * being silently preferred.
 */
export function decodeRlcDoc(text: string): RlcDocument {
  const raw = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  // STRIP THE KNOWN EXTENSIONS, then require the remainder to be exactly the plain document.
  //
  // This used to compare the whole key set against a list of accepted combinations, which meant
  // every new optional field had to be added to every combination — and a file carrying one that
  // had been missed fell through to `decodeRlc`, which silently returned the inputs alone. For
  // the coil that lost a winding; for a diode it would load a visibly different circuit while
  // reporting success. Removing the extensions and checking what is left scales without that.
  const { coil, pickup, solver, ...rest } = raw;
  if (Object.keys(rest).sort().join(',') !== 'format,inputs')
    return { inputs: decodeRlc(text) };          // the ORIGINAL text, so its rules and messages apply
  const inputs = decodeRlc(JSON.stringify(rest));

  const doc: RlcDocument = { inputs };
  if (solver !== undefined) {
    const session = solver as SolverSession;
    checkSolver(session);
    checkDrive(session);
    doc.solver = {
      required: session.required,
      ...(session.diode ? { diode: { ...session.diode } } : {}),
      ...(session.sourceSine ? { sourceSine: { ...session.sourceSine } } : {}),
      ...(session.loadResistanceOhms !== undefined
        ? { loadResistanceOhms: session.loadResistanceOhms } : {}),
      ...(session.stopSeconds !== undefined ? { stopSeconds: session.stopSeconds } : {}),
      ...(session.stepSeconds !== undefined ? { stepSeconds: session.stepSeconds } : {}),
    };
  }
  if (coil === undefined) {
    if (pickup !== undefined)
      throw new Error('This file has a pickup but no coil for it to couple to.');
    return doc;
  }
  const geometry = coil as CoilGeometry;
  validateCoil(geometry);
  const derived = coilInductance(geometry);
  const drift = Math.abs(derived / inputs.inductance - 1);
  if (!(drift < 1e-9))
    throw new Error(`This file's coil and its inductance disagree: the winding gives `
      + `${derived.toExponential(6)} H but the file stores ${inputs.inductance.toExponential(6)} H. `
      + `Refusing rather than choosing one for you.`);
  doc.coil = { ...geometry };
  if (pickup === undefined) return doc;
  const pose = pickup as PickupGeometry;
  validatePickup(pose);
  mutualToPickup(geometry, pose);                      // refuses a saved intersecting pose
  doc.pickup = { ...pose };
  return doc;
}
