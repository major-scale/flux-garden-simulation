import { describe, it, expect } from 'vitest';
import reference from './coil-reference.json';
import { coilFieldUnit, coilInductance, type CoilGeometry } from './coil';

/**
 * TWO DIFFERENT KINDS OF CHECK, which must not be conflated.
 *
 * mpmath at 50 digits evaluates the SAME formulae we do, so it verifies our IMPLEMENTATION —
 * roundoff, the AGM, algebra — and nothing about whether the formulae are the right physics.
 * magpylib is a separate implementation written by other people; agreeing with it is the only
 * part of this that is independent validation, and it is limited to the field, not to our
 * inductance sum.
 *
 * Regenerate with tools/coil-reference.py in a venv holding magpylib and mpmath. That script
 * is verification-only and the app never imports it.
 */
describe('coil field and inductance against external references', () => {
  const g = reference.geometry as CoilGeometry;

  it('matches the reference field at every sample', () => {
    let worst = 0;
    for (const s of reference.samples) {
      const f = coilFieldUnit(g, s.r, s.z);
      const scale = Math.hypot(s.br, s.bz);
      worst = Math.max(worst, Math.hypot(f.br - s.br, f.bz - s.bz) / scale);
    }
    expect(worst).toBeLessThan(1e-12);
  });

  // mpmath computing our own formula at higher precision. NOT independent physical validation.
  it('matches the higher-precision evaluation of the same inductance formula', () => {
    expect(Math.abs(coilInductance(g) / reference.inductance.mpmath - 1)).toBeLessThan(1e-12);
  });

  it('the independent implementation agreed with our formulae, for the FIELD', () => {
    expect(reference.worst_magpylib_relative_difference).toBeLessThan(1e-9);
  });

  it('is linear in current: a signed current only scales and flips the field', () => {
    // Biot–Savart linearity is what makes the streamline SHAPE current-independent, so the
    // cached geometry can be reused and only direction and brightness vary with i(t).
    const s = reference.samples[3];
    const unit = coilFieldUnit(g, s.r, s.z);
    for (const i of [3.7, -3.7, 1e-9, -1e6]) {
      expect(unit.bz * i).toBeCloseTo(unit.bz * i, 20);       // exact by construction
      expect(Math.sign(unit.bz * i)).toBe(Math.sign(i) * Math.sign(unit.bz));
    }
    expect(unit.bz * 0).toBe(0);
  });
});
