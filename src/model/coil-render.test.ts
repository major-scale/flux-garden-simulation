import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCoilPackage, DEFAULT_COIL, displayPolyline } from './coil-package';
import { streamline, segmentDistanceToWinding } from './coil';

/**
 * WHAT THE RENDERER ACTUALLY DRAWS, checked against the solved polyline.
 *
 * The renderer decimates and then splines, and both steps change the curve. It also used to
 * pass closed = true for EVERY line, which joined the two ends of traces that stopped at the
 * domain boundary or on the conductor — inventing a segment the field never produced. These
 * build the display curve exactly as potential-scene does and check it.
 */
const G = DEFAULT_COIL;
const curveFor = (points: [number, number][], closed: boolean) => {
  const pts = displayPolyline(points, 160).map(([r, z]) => new THREE.Vector3(r, z, 0));
  return new THREE.CatmullRomCurve3(pts, closed);
};

describe('the drawn field curve', () => {
  const pkg = buildCoilPackage(G);

  it('keeps the final point, so a trace is not drawn ending early', () => {
    for (const l of pkg.fieldLines) {
      const d = displayPolyline(l.points, 160);
      expect(d[d.length - 1]).toEqual(l.points[l.points.length - 1]);
      expect(d[0]).toEqual(l.points[0]);
    }
  });

  it('NEGATIVE CONTROL: a non-closed trace is drawn OPEN, not joined end to end', () => {
    // A seed near the axis leaves the domain rather than closing. Drawing it closed would
    // add a straight jump from its far end back to its start.
    const open = streamline(G, 0.12 * G.radius, 0,
      { step: G.wireRadius * 0.5, maxSteps: 4000, rMax: 3 * G.radius, zMax: 3 * G.radius });
    expect(open.stop).not.toBe('closed');
    const asOpen = curveFor(open.points, false);
    const asClosed = curveFor(open.points, true);
    const gap = new THREE.Vector3(...[open.points[0][0], open.points[0][1], 0])
      .distanceTo(new THREE.Vector3(open.points[open.points.length - 1][0],
                                    open.points[open.points.length - 1][1], 0));
    expect(gap).toBeGreaterThan(0.01);                       // the ends really are far apart
    // Closing it makes the curve materially longer: that extra length is the invented segment.
    expect(asClosed.getLength()).toBeGreaterThan(asOpen.getLength() * 1.05);
  });

  it('closed traces close within a bounded gap rather than being snapped shut', () => {
    for (const l of pkg.fieldLines) {
      expect(l.stop).toBe('closed');
      const a = l.points[0], b = l.points[l.points.length - 1];
      // The integrator stops when it returns within 0.9 of a step of its seed, so the join
      // the spline makes is that short — not a long invented chord.
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(G.wireRadius * 2);
    }
  });

  it('the drawn curve never overshoots into the conductor', () => {
    for (const l of pkg.fieldLines) {
      const c = curveFor(l.points, l.stop === 'closed');
      const sampled = c.getPoints(600);
      for (let k = 1; k < sampled.length; k++)
        expect(segmentDistanceToWinding(G, sampled[k - 1].x, sampled[k - 1].y, sampled[k].x, sampled[k].y))
          .toBeGreaterThan(G.wireRadius);
    }
  });

  it('deviates from the solved polyline by a stated amount, measured BOTH ways', () => {
    // One direction only would miss the case that matters most: a rendered point that
    // wanders somewhere the solved curve never goes. Solved→rendered asks whether every
    // solved point is represented; rendered→solved asks whether the drawing invents any
    // excursion. Both are reported.
    let worstSolvedToDrawn = 0, worstDrawnToSolved = 0;
    for (const l of pkg.fieldLines) {
      const c = curveFor(l.points, l.stop === 'closed');
      const sampled = c.getPoints(1200);
      for (const [r, z] of l.points) {
        let best = Infinity;
        for (const q of sampled) best = Math.min(best, Math.hypot(q.x - r, q.y - z));
        worstSolvedToDrawn = Math.max(worstSolvedToDrawn, best);
      }
      for (const q of sampled) {
        let best = Infinity;
        for (const [r, z] of l.points) best = Math.min(best, Math.hypot(q.x - r, q.y - z));
        worstDrawnToSolved = Math.max(worstDrawnToSolved, best);
      }
    }
    console.log(`  solved→drawn ${(worstSolvedToDrawn * 1000).toFixed(4)} mm, `
      + `drawn→solved ${(worstDrawnToSolved * 1000).toFixed(4)} mm `
      + `(${(Math.max(worstSolvedToDrawn, worstDrawnToSolved) / G.radius * 100).toFixed(3)}% of coil radius)`);
    expect(worstSolvedToDrawn).toBeLessThan(G.wireRadius);
    expect(worstDrawnToSolved).toBeLessThan(G.wireRadius);
  });
});

describe('the package is immutable', () => {
  it('cannot be edited after it is built', () => {
    const pkg = buildCoilPackage(DEFAULT_COIL);
    expect(Object.isFrozen(pkg)).toBe(true);
    expect(Object.isFrozen(pkg.geometry)).toBe(true);
    expect(Object.isFrozen(pkg.fieldLines)).toBe(true);
    expect(() => { (pkg.geometry as { turns: number }).turns = 999; }).toThrow();
  });
  it('does not hand back the caller\'s own geometry object', () => {
    const mine = { ...DEFAULT_COIL };
    const pkg = buildCoilPackage(mine);
    expect(pkg.geometry).not.toBe(mine);
    mine.turns = 7;                                   // mutating mine must not touch the package
    expect(pkg.geometry.turns).toBe(DEFAULT_COIL.turns);
  });
});
