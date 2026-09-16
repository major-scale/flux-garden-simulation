import { describe, it, expect } from 'vitest';
import { encodeRlcDoc, decodeRlcDoc, type RlcDocument } from './rlc-doc';
import { buildNetlist } from './spice/netlist';
import { coilInductance } from './coil';
import { DEFAULT_COIL } from './coil-package';
import { encodeRlc } from './rlc';

const inputs = { voltage: 10, resistance: 300, capacitance: 8.8541878128e-11,
  inductance: coilInductance(DEFAULT_COIL), initialVoltage: 0, initialCurrent: 0 };

describe('saving and loading a coil session', () => {
  it('round-trips the geometry, so the winding survives the save', () => {
    const back = decodeRlcDoc(encodeRlcDoc({ inputs, coil: DEFAULT_COIL }));
    expect(back.coil).toEqual({ ...DEFAULT_COIL });
    expect(back.inputs.inductance).toBe(inputs.inductance);
  });

  it('still reads a file written before coils existed, without inventing a winding', () => {
    const legacy = encodeRlc({ ...inputs, inductance: 1 });
    const back = decodeRlcDoc(legacy);
    expect(back.coil).toBeUndefined();
    expect(back.inputs.inductance).toBe(1);          // not rewritten, not rejected
  });

  it('refuses a file whose coil and inductance disagree, naming both', () => {
    const doc = JSON.parse(encodeRlcDoc({ inputs, coil: DEFAULT_COIL }));
    doc.inputs.inductance = inputs.inductance * 1.5;  // hand-edited into incoherence
    expect(() => decodeRlcDoc(JSON.stringify(doc))).toThrow(/coil and its inductance disagree/);
  });

  it('refuses a stored geometry that is not physically wound', () => {
    const doc = JSON.parse(encodeRlcDoc({ inputs, coil: DEFAULT_COIL }));
    doc.coil.wireRadius = 0.02;                       // thicker than the thin-wire domain allows
    expect(() => decodeRlcDoc(JSON.stringify(doc))).toThrow();
  });

  it('a phenomenological session saves with no coil key at all', () => {
    const text = encodeRlcDoc({ inputs: { ...inputs, inductance: 1 } });
    expect(JSON.parse(text).coil).toBeUndefined();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['format', 'inputs']);
  });
});

describe('saving and loading a pickup pose', () => {
  const pickup = { radius: 0.03, separation: 0.06, orientation: 0 as const };

  it('round-trips the pose, since the same loop elsewhere is a different experiment', () => {
    const back = decodeRlcDoc(encodeRlcDoc({ inputs, coil: DEFAULT_COIL, pickup }));
    expect(back.pickup).toEqual(pickup);
    expect(back.coil).toEqual({ ...DEFAULT_COIL });
  });

  it('a session with no pickup saves no pickup key, and loads back with none', () => {
    const text = encodeRlcDoc({ inputs, coil: DEFAULT_COIL });
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['coil', 'format', 'inputs']);
    expect(decodeRlcDoc(text).pickup).toBeUndefined();
  });

  it('refuses to save a pickup with no coil to couple to', () => {
    expect(() => encodeRlcDoc({ inputs, pickup })).toThrow(/without the coil/);
  });

  it('refuses a saved pose that intersects the winding', () => {
    const doc = JSON.parse(encodeRlcDoc({ inputs, coil: DEFAULT_COIL, pickup }));
    doc.pickup = { radius: 0.05, separation: 0.0775, orientation: 90 };
    expect(() => decodeRlcDoc(JSON.stringify(doc))).toThrow(/crosses the winding/);
  });

  it('still reads a coil-only file written before pickups existed', () => {
    const older = JSON.stringify({ format: 'flux-rlc-1', inputs, coil: DEFAULT_COIL });
    expect(decodeRlcDoc(older).pickup).toBeUndefined();
  });
});

describe('the solver session travels with the document', () => {
  const inputs = { voltage: 10, resistance: 297, capacitance: 8.8541878128e-11,
    inductance: coilInductance(DEFAULT_COIL), initialVoltage: 0, initialCurrent: 0 };
  const PART = { is: 1e-14, n: 1, rs: 0.1, cjo: 0, tt: 0, bv: 75, ibv: 1e-5 };

  it('round-trips BOTH orientations, parameters and all', () => {
    // The whole spec, not just the orientation: restoring "forward" against a different IS or
    // RS would be a different device wearing the saved label.
    for (const orientation of ['forward', 'reverse'] as const) {
      const doc = { inputs, solver: { required: true, diode: { ...PART, orientation } } };
      const back = decodeRlcDoc(encodeRlcDoc(doc));
      expect(back.solver).toEqual({ required: true, diode: { ...PART, orientation } });
    }
  });

  it('round-trips a bypassed solver session, which is not the same as no session', () => {
    // Solver ON with the device absent is a real state, and distinct from a kernel session:
    // reloading it must not silently switch the authority driving the scene.
    const back = decodeRlcDoc(encodeRlcDoc({ inputs, solver: { required: true } }));
    expect(back.solver).toEqual({ required: true });
    expect(back.solver?.diode).toBeUndefined();
  });

  it('loads a pre-diode file as the kernel session it describes', () => {
    // BACKWARD COMPATIBILITY, checked against a file with no solver key at all rather than one
    // this version wrote. Such a file predates the solver and describes a kernel run.
    const legacy = encodeRlcDoc({ inputs });
    expect(legacy).not.toContain('solver');
    expect(decodeRlcDoc(legacy).solver).toBeUndefined();
  });

  it('keeps the winding AND the solver session in one file', () => {
    const coil = DEFAULT_COIL;
    const doc = { inputs, coil,
      solver: { required: true, diode: { ...PART, orientation: 'forward' as const } } };
    const back = decodeRlcDoc(encodeRlcDoc(doc));
    expect(back.coil).toEqual(coil);
    expect(back.solver?.diode?.orientation).toBe('forward');
  });

  it('refuses a diode saved with the solver off, rather than dropping one of the two', () => {
    // The analytic kernel solves a linear RLC. A file claiming both describes a circuit no mode
    // of this page can produce, and choosing which half to honour would be inventing intent.
    expect(() => encodeRlcDoc({ inputs,
      solver: { required: false, diode: { ...PART, orientation: 'forward' } } }))
      .toThrow(/cannot be saved with the solver off/);
  });

  it('refuses a saved diode that would not build a netlist, through the SAME gate', () => {
    // Validated by validateCircuit, not by a second copy of the rules here — a copy would drift,
    // and the quasi-static constraint is exactly what a copy would lose.
    for (const bad of [{ ...PART, cjo: 1e-12 }, { ...PART, tt: 1e-9 }])
      expect(() => encodeRlcDoc({ inputs,
        solver: { required: true, diode: { ...bad, orientation: 'forward' } } }))
        .toThrow(/quasi-static/);
    expect(() => decodeRlcDoc(JSON.stringify({ format: 'flux-rlc-1', inputs,
      solver: { required: true, diode: { ...PART, orientation: 'sideways' } } })))
      .toThrow(/orientation must be forward or reverse/);
  });

  it('does not silently drop an extension it does not recognise', () => {
    // The old key-set check compared against a list of accepted combinations, so a file with a
    // field that had been missed fell through and returned the inputs alone — reporting success
    // while loading a different circuit. An unknown key must not take that path.
    const text = JSON.stringify({ format: 'flux-rlc-1', inputs, somethingElse: { a: 1 } });
    expect(() => decodeRlcDoc(text)).toThrow();
  });
});

describe('the saved session is a CONFIGURATION, not the name of a demonstration', () => {
  const inputs = { voltage: 10, resistance: 277, capacitance: 8.8541878128e-11,
    inductance: coilInductance(DEFAULT_COIL), initialVoltage: 0, initialCurrent: 0 };
  const PART = { is: 1e-14, n: 1, rs: 0.1, cjo: 0, tt: 0, bv: 75, ibv: 1e-5 };
  const rectifier = {
    required: true,
    diode: { ...PART, orientation: 'forward' as const },
    sourceSine: { amplitudeVolts: 10, frequencyHz: 4e5, offsetVolts: 0 },
    loadResistanceOhms: 20000,
    stopSeconds: 2e-5,
    stepSeconds: 1 / (4e5 * 240),
  };

  it('round-trips the drive and the load, not just the device', () => {
    // Recording only the diode meant a saved rectifier reloaded as a series circuit with a diode
    // in it — a different experiment, and one that goes still. The source and the load ARE the
    // circuit; a preset id would tie the file to a list of demonstrations that will change.
    const back = decodeRlcDoc(encodeRlcDoc({ inputs, solver: rectifier }));
    expect(back.solver).toEqual(rectifier);
  });

  it('rebuilds the SAME netlist after a round trip', () => {
    const asDescription = (s: NonNullable<RlcDocument['solver']>) => ({
      sourceVolts: 10, resistanceOhms: inputs.resistance,
      inductanceHenries: inputs.inductance, capacitanceFarads: inputs.capacitance,
      initialCapacitorVolts: 0, initialInductorAmps: 0,
      stopSeconds: s.stopSeconds!, stepSeconds: s.stepSeconds!,
      sourceSine: s.sourceSine, loadResistanceOhms: s.loadResistanceOhms, diode: s.diode,
    });
    const back = decodeRlcDoc(encodeRlcDoc({ inputs, solver: rectifier }));
    expect(buildNetlist(asDescription(back.solver!)))
      .toBe(buildNetlist(asDescription(rectifier)));
  });

  it('loads a file with a drive but NO diode, which is a legitimate session', () => {
    const { diode: _d, ...noDiode } = rectifier;
    const back = decodeRlcDoc(encodeRlcDoc({ inputs, solver: noDiode }));
    expect(back.solver?.sourceSine).toEqual(rectifier.sourceSine);
    expect(back.solver?.diode).toBeUndefined();
  });

  it('treats a pre-drive file as the DC session it describes', () => {
    const legacy = encodeRlcDoc({ inputs,
      solver: { required: true, diode: { ...PART, orientation: 'forward' } } });
    expect(legacy).not.toContain('sourceSine');
    expect(legacy).not.toContain('loadResistanceOhms');
    const back = decodeRlcDoc(legacy);
    expect(back.solver?.sourceSine).toBeUndefined();
    expect(back.solver?.loadResistanceOhms).toBeUndefined();
  });

  it('refuses a drive that would not build a netlist, through the SAME gate', () => {
    // An aliased source is not a circuit anyone described: fewer than eight output steps per
    // cycle and the picture shows a frequency nobody asked for.
    expect(() => encodeRlcDoc({ inputs, solver: { ...rectifier,
      sourceSine: { amplitudeVolts: 10, frequencyHz: 5e8, offsetVolts: 0 } } }))
      .toThrow(/Sine frequency/);
    expect(() => encodeRlcDoc({ inputs, solver: { ...rectifier, loadResistanceOhms: -5 } }))
      .toThrow(/Load resistance/);
  });
});
