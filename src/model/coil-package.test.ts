import { describe, it, expect } from 'vitest';
import { buildCoilPackage, DEFAULT_COIL } from './coil-package';
import { coilInductance, segmentDistanceToWinding } from './coil';

describe('the coil package', () => {
  const pkg = buildCoilPackage(DEFAULT_COIL);
  it('carries the inductance the circuit uses, from the geometry', () => {
    expect(pkg.inductanceH).toBe(coilInductance(DEFAULT_COIL));
  });
  it('draws every turn one for one', () => {
    expect(pkg.turnPositionsM.length).toBe(DEFAULT_COIL.turns);
  });
  it('integrates field lines that never touch the conductor', () => {
    expect(pkg.fieldLines.length).toBeGreaterThan(0);
    for (const l of pkg.fieldLines) {
      expect(l.points.length).toBeGreaterThan(20);
      for (let k = 1; k < l.points.length; k++) {
        const [a, b] = [l.points[k - 1], l.points[k]];
        expect(segmentDistanceToWinding(DEFAULT_COIL, a[0], a[1], b[0], b[1]))
          .toBeGreaterThanOrEqual(DEFAULT_COIL.wireRadius);
      }
    }
  });
  it('is deterministic: the same geometry gives the same lines', () => {
    const again = buildCoilPackage(DEFAULT_COIL);
    expect(again.fieldLines.map(l => l.points.length)).toEqual(pkg.fieldLines.map(l => l.points.length));
    expect(again.inductanceH).toBe(pkg.inductanceH);
  });
  it('builds fast enough to be done on a geometry change, not per frame', () => {
    console.log(`  coil package build: ${pkg.buildMs.toFixed(1)} ms, `
      + `lines ${pkg.fieldLines.map(l => `${l.points.length}(${l.stop})`).join(' ')}`);
    expect(pkg.buildMs).toBeLessThan(4000);
  });
});

describe('the default field lines', () => {
  const pkg = buildCoilPackage(DEFAULT_COIL);
  it('all close, so none is drawn running off to nowhere', () => {
    for (const l of pkg.fieldLines) expect(l.stop).toBe('closed');
  });
  it('nest: each seed gives a strictly smaller loop than the one inside it', () => {
    const extents = pkg.fieldLines.map(l => Math.max(...l.points.map(p => p[0])));
    for (let k = 1; k < extents.length; k++) expect(extents[k]).toBeLessThan(extents[k - 1]);
  });
  it('stay inside a drawable region', () => {
    for (const l of pkg.fieldLines)
      for (const [r, z] of l.points) {
        expect(r).toBeLessThan(12 * DEFAULT_COIL.radius);
        expect(Math.abs(z)).toBeLessThan(6 * DEFAULT_COIL.radius);
      }
  });
});

describe('the pickup inside the package', () => {
  it('refuses a loop too small for the thin-wire formula that values it', () => {
    // Every individual input is legal; only the RATIO is not, which a per-field check misses.
    expect(() => buildCoilPackage(DEFAULT_COIL,
      { pickup: { radius: 0.002, separation: 0.06, orientation: 0 } }))
      .toThrow(/thin-wire self-inductance formula is not valid/);
  });
  it('carries a finite, admissible coupling for the shipping default pose', () => {
    const pkg = buildCoilPackage(DEFAULT_COIL,
      { pickup: { radius: 0.03, separation: 0.06, orientation: 0 } });
    expect(pkg.pickup).toBeDefined();
    expect(Number.isFinite(pkg.pickup!.couplingK)).toBe(true);
    expect(Math.abs(pkg.pickup!.couplingK)).toBeLessThan(1);
    expect(Object.isFrozen(pkg.pickup!.geometry)).toBe(true);
  });
  it('a package with no pickup has none, rather than a zeroed one', () => {
    expect(buildCoilPackage(DEFAULT_COIL).pickup).toBeUndefined();
  });
});
