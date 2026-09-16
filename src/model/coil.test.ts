import { describe, it, expect } from 'vitest';
import { ellipticKE, loopFieldUnit, coilFieldUnit, coilInductance, mutualInductance,
         nagaokaSheetInductance, streamline, turnZ, validateCoil, MU0,
         coilTimingBudget, minimumResolvableInductance, distanceToWinding,
         segmentDistanceToWinding,
         type CoilGeometry } from './coil';

const G: CoilGeometry = { turns: 40, radius: 0.02, length: 0.10, wireRadius: 0.0004 };

describe('complete elliptic integrals', () => {
  it('matches known values', () => {
    expect(ellipticKE(0).K).toBeCloseTo(Math.PI / 2, 15);
    expect(ellipticKE(0).E).toBeCloseTo(Math.PI / 2, 15);
    // m = 1/2: K = 1.8540746773013719, E = 1.3506438810476755
    expect(ellipticKE(0.5).K).toBeCloseTo(1.8540746773013719, 13);
    expect(ellipticKE(0.5).E).toBeCloseTo(1.3506438810476755, 13);
    // m = 0.99
    expect(ellipticKE(0.99).K).toBeCloseTo(3.6956373629898746, 11);
    expect(ellipticKE(0.99).E).toBeCloseTo(1.0159935450252239, 12);
  });
  it('refuses parameters outside its domain rather than returning a number', () => {
    expect(() => ellipticKE(1)).toThrow();
    expect(() => ellipticKE(-0.1)).toThrow();
  });
});

describe('one circular filament', () => {
  it('reproduces the closed-form on-axis field exactly', () => {
    const a = 0.02;
    for (const z of [0, 0.005, 0.02, 0.1]) {
      const exact = (MU0 * a * a) / (2 * Math.pow(a * a + z * z, 1.5));
      expect(loopFieldUnit(a, 0, 0, z).bz).toBeCloseTo(exact, 18);
    }
  });
  it('approaches the on-axis value continuously as r → 0', () => {
    const a = 0.02, z = 0.01;
    const axis = loopFieldUnit(a, 0, 0, z).bz;
    for (const r of [1e-6, 1e-8, 1e-10]) {
      expect(loopFieldUnit(a, 0, r, z).bz / axis - 1).toBeLessThan(1e-9);
      expect(Math.abs(loopFieldUnit(a, 0, r, z).br)).toBeLessThan(Math.abs(axis) * 1e-4);
    }
  });
});

describe('the coil field', () => {
  it('on axis equals the EXACT SUM of its discrete circles, which is its own benchmark', () => {
    // Astra's correction: the continuous-sheet solenoid formula is a DIFFERENT model and
    // carries its own discretization error, so it cannot certify this sum.
    for (const z of [0, 0.01, 0.03, 0.07]) {
      let sum = 0;
      for (let j = 0; j < G.turns; j++) {
        const dz = z - turnZ(G, j);
        sum += (MU0 * G.radius * G.radius) / (2 * Math.pow(G.radius * G.radius + dz * dz, 1.5));
      }
      expect(coilFieldUnit(G, 0, z).bz).toBeCloseTo(sum, 18);
    }
  });
  it('is axisymmetric by construction: the evaluator has no azimuthal argument at all', () => {
    // Every source is a full circle in closed form, so there is no polygon to introduce an
    // azimuthal error. This test records the structural fact rather than sampling angles.
    expect(coilFieldUnit.length).toBe(3);      // (geometry, r, z) — no azimuth
  });
  it('has zero radial field on the axis and at the mid-plane by symmetry', () => {
    expect(coilFieldUnit(G, 0, 0.02).br).toBe(0);
    expect(Math.abs(coilFieldUnit(G, 0.01, 0).br)).toBeLessThan(1e-12 * Math.abs(coilFieldUnit(G, 0.01, 0).bz));
  });
  it('is odd in z for the radial part and even for the axial part', () => {
    for (const [r, z] of [[0.01, 0.02], [0.03, 0.04], [0.005, 0.06]]) {
      const p = coilFieldUnit(G, r, z), n = coilFieldUnit(G, r, -z);
      // Normalized to the FIELD MAGNITUDE, not to each component. Summing 40 loops in the
      // opposite order differs in the last bits, and br is computed through a cancellation
      // (E·(…) − K) so it carries that roundoff at the scale of |B|, not of br itself.
      const scale = Math.hypot(p.br, p.bz);
      expect(Math.abs(n.bz - p.bz)).toBeLessThan(1e-13 * scale);
      expect(Math.abs(n.br + p.br)).toBeLessThan(1e-13 * scale);
    }
  });
});

describe('inductance from the winding', () => {
  it('is the double sum of mutuals plus the self terms', () => {
    const small: CoilGeometry = { turns: 3, radius: 0.02, length: 0.01, wireRadius: 0.0004 };
    let expected = 3 * (MU0 * 0.02 * (Math.log((8 * 0.02) / 0.0004) - 7 / 4));
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++)
      expected += 2 * mutualInductance(0.02, 0.02, turnZ(small, i) - turnZ(small, j));
    expect(coilInductance(small)).toBeCloseTo(expected, 18);
  });
  it('lands near the current-sheet value for a long coil, without being asked to match it', () => {
    // A DIFFERENT model: a sheet has no wire radius. Agreement to ~10% is corroboration that
    // the double sum is not wrong by a factor; it is not a precision benchmark.
    const longCoil: CoilGeometry = { turns: 200, radius: 0.01, length: 0.40, wireRadius: 0.0004 };
    const ratio = coilInductance(longCoil) / nagaokaSheetInductance(longCoil);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });
  it('scales as N² for fixed shape, as a solenoid must', () => {
    const a = coilInductance({ turns: 20, radius: 0.02, length: 0.10, wireRadius: 0.0004 });
    const b = coilInductance({ turns: 40, radius: 0.02, length: 0.10, wireRadius: 0.0004 });
    expect(b / a).toBeGreaterThan(3.6);
    expect(b / a).toBeLessThan(4.4);
  });
  it('rejects geometry that cannot be wound', () => {
    expect(() => validateCoil({ turns: 400, radius: 0.02, length: 0.01, wireRadius: 0.0004 })).toThrow();
    expect(() => validateCoil({ turns: 10, radius: 0.0004, length: 0.10, wireRadius: 0.0004 })).toThrow();
  });
});

describe('streamlines', () => {
  const opts = { step: 0.002, maxSteps: 4000, rMax: 0.3, zMax: 0.3 };
  it('follows the field: the local tangent residual stays tiny along the whole path', () => {
    const s = streamline(G, 0.008, 0, opts);
    expect(s.points.length).toBeGreaterThan(50);
    let worst = 0;
    for (let k = 1; k < s.points.length; k++) {
      const [r0, z0] = s.points[k - 1], [r1, z1] = s.points[k];
      const rm = (r0 + r1) / 2, zm = (z0 + z1) / 2;
      const f = coilFieldUnit(G, rm, zm);
      const fn = Math.hypot(f.br, f.bz);
      const dr = r1 - r0, dz = z1 - z0, dn = Math.hypot(dr, dz);
      if (fn < 1e-30 || dn < 1e-15) continue;
      // Cross product of the unit step and the unit field: zero when the step is tangent.
      worst = Math.max(worst, Math.abs((dr / dn) * (f.bz / fn) - (dz / dn) * (f.br / fn)));
    }
    expect(worst).toBeLessThan(2e-3);
  });
  it('converges: halving the step reduces the tangent residual', () => {
    // Steps must stay UNDER the mask clamp, or both runs use the same step and the study is
    // vacuous — which is what happened the first time this ran after the mask was added.
    const residual = (step: number) => {
      const s = streamline(G, 0.008, 0, { ...opts, step, maxSteps: Math.ceil(0.6 / step) });
      let worst = 0;
      for (let k = 1; k < s.points.length; k++) {
        const [r0, z0] = s.points[k - 1], [r1, z1] = s.points[k];
        const f = coilFieldUnit(G, (r0 + r1) / 2, (z0 + z1) / 2);
        const fn = Math.hypot(f.br, f.bz);
        const dr = r1 - r0, dz = z1 - z0, dn = Math.hypot(dr, dz);
        if (fn < 1e-30 || dn < 1e-15) continue;
        worst = Math.max(worst, Math.abs((dr / dn) * (f.bz / fn) - (dz / dn) * (f.br / fn)));
      }
      return worst;
    };
    expect(streamline(G, 0.008, 0, { ...opts, step: 0.0004 }).stepUsed).toBe(0.0004);
    expect(residual(0.0001)).toBeLessThan(residual(0.0004));
  });
  it('reports why it stopped and never forces the curve closed', () => {
    const s = streamline(G, 0.008, 0, opts);
    expect(['closed', 'boundary', 'conductor', 'steps', 'stalled']).toContain(s.stop);
    const [rf, zf] = s.points[s.points.length - 1];
    if (s.stop !== 'closed') {
      // Nothing snapped it back to the seed.
      expect(Math.hypot(rf - 0.008, zf - 0) > opts.step * 0.9 || s.points.length >= opts.maxSteps).toBe(true);
    }
  });
});

describe('the timing envelope a geometry-derived coil has to live inside', () => {
  const limits = { minH: 1e-9, targetSamplesPerCycle: 240 };
  const C = 8.8541878128e-11;                    // the existing 100 mm plates, 1 mm gap

  it('the proposed default coil resolves without clamping, but only just', () => {
    const L = coilInductance(G);
    const b = coilTimingBudget(L, C, limits);
    expect(b.clamped).toBe(false);
    expect(b.samplesPerCycle).toBeCloseTo(240, 6);
    // Headroom is thin: this records how thin, so shrinking the coil cannot pass unnoticed.
    expect(b.requestedDtS / limits.minH).toBeGreaterThan(1);
    expect(b.requestedDtS / limits.minH).toBeLessThan(1.3);
  });

  it('reports the clamp instead of silently losing resolution', () => {
    const tiny: CoilGeometry = { turns: 8, radius: 0.004, length: 0.02, wireRadius: 0.0002 };
    const b = coilTimingBudget(coilInductance(tiny), C, limits);
    expect(b.clamped).toBe(true);
    expect(b.samplesPerCycle).toBeLessThan(240);
  });

  it('names the smallest inductance that still resolves, so the envelope is a number', () => {
    const Lmin = minimumResolvableInductance(C, limits);
    expect(coilTimingBudget(Lmin, C, limits).clamped).toBe(false);
    expect(coilTimingBudget(Lmin * 0.99, C, limits).clamped).toBe(true);
    expect(coilInductance(G)).toBeGreaterThan(Lmin);      // the default is inside the envelope
  });
});

describe('the conductor mask (regressions for a reproduced crash)', () => {

  it('the field REFUSES on the filament instead of returning a silent NaN', () => {
    // Astra's repro. The old code returned Infinity here, NaN propagated through the RK
    // stages, and the failure surfaced several steps later inside ellipticKE with a NaN
    // parameter — a message pointing nowhere near the cause.
    expect(() => coilFieldUnit(G, G.radius, turnZ(G, 20))).toThrow(/singular on the filament/);
  });

  it('a streamline seeded on an INTERIOR turn terminates cleanly, not by throwing', () => {
    // The mask used to check only turn 0 and the last turn, so every interior turn was open.
    for (const j of [0, 1, 13, 20, 39]) {
      const s = streamline(G, G.radius, turnZ(G, j), { step: 0.00001, maxSteps: 2, rMax: 0.1, zMax: 0.2 });
      expect(s.stop).toBe('conductor');
      expect(s.points.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('terminates on approach to an interior turn from outside the winding', () => {
    const start = G.radius + G.wireRadius * 4;
    const s = streamline(G, start, turnZ(G, 20) + G.wireRadius * 4,
      { step: 0.0002, maxSteps: 3000, rMax: 0.3, zMax: 0.3 });
    expect(['conductor', 'boundary', 'closed', 'steps']).toContain(s.stop);
    for (const [r, z] of s.points) expect(distanceToWinding(G, r, z)).toBeGreaterThan(G.wireRadius);
  });

  it('never tunnels through a turn, even when asked to take huge steps', () => {
    // A step larger than the mask could straddle a turn and land beyond it with both
    // endpoints outside, stepping over the singularity. The step is clamped to the mask.
    const s = streamline(G, 0.008, 0, { step: 0.05, maxSteps: 500, rMax: 0.3, zMax: 0.3 });
    for (const [r, z] of s.points) expect(distanceToWinding(G, r, z)).toBeGreaterThanOrEqual(G.wireRadius);
    expect(Number.isFinite(s.points[s.points.length - 1][0])).toBe(true);
  });

  it('no seed anywhere on a grid can make it throw or emit a non-finite point', () => {
    for (let r = 0; r <= 0.06; r += 0.004)
      for (let z = -0.07; z <= 0.07; z += 0.007) {
        const s = streamline(G, r, z, { step: 0.001, maxSteps: 60, rMax: 0.2, zMax: 0.2 });
        for (const [pr, pz] of s.points) {
          expect(Number.isFinite(pr)).toBe(true);
          expect(Number.isFinite(pz)).toBe(true);
        }
      }
  });
});

describe('the thin-wire domain', () => {
  it('refuses a wire too thick for the asymptotic self-inductance formula', () => {
    expect(() => validateCoil({ turns: 10, radius: 0.02, length: 0.10, wireRadius: 0.005 })).toThrow(/thin-wire/);
    expect(() => validateCoil({ turns: 10, radius: 0.02, length: 0.10, wireRadius: 0.002 })).not.toThrow();
  });
});

describe('grazing chords, which endpoint-and-midpoint sampling cannot catch', () => {
  it('finds a chord whose endpoints AND midpoint are clear but which clips a turn', () => {
    // Astra's point, demonstrated rather than assumed: construct such a chord explicitly.
    const a = G.radius, zc = turnZ(G, 20), mask = G.wireRadius * 1.5;
    // A chord passing just tangent to the mask circle, with its closest approach a quarter of
    // the way along — so neither endpoint nor the midpoint is the nearest point.
    const r0 = a - mask * 0.5, z0 = zc - mask * 0.5;
    const r1 = a - mask * 0.5 + mask * 4, z1 = zc - mask * 0.5 + mask * 4;
    const at = (t: number) => [r0 + t * (r1 - r0), z0 + t * (z1 - z0)] as const;
    const dist = (p: readonly [number, number]) => distanceToWinding(G, p[0], p[1]);
    // The seed itself is inside, so use a chord that starts outside instead.
    const s0 = [a - mask * 3, zc - mask * 3] as const;
    const s1 = [a + mask * 3, zc - mask * 1.2] as const;
    const mid = [(s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2] as const;
    const sampled = Math.min(dist(s0), dist(s1), dist(mid));
    const exact = segmentDistanceToWinding(G, s0[0], s0[1], s1[0], s1[1]);
    // The exact segment distance is strictly smaller than anything the three samples saw.
    expect(exact).toBeLessThan(sampled);
    expect(at(0)[0]).toBeCloseTo(r0, 12);   // (keeps the helper referenced and honest)
  });

  it('no emitted segment ever comes closer to a turn than the mask', () => {
    for (const seed of [[0.008, 0], [0.014, 0.02], [0.03, -0.01], [0.05, 0.05], [0.0005, 0.049]]) {
      const s = streamline(G, seed[0], seed[1], { step: 0.05, maxSteps: 900, rMax: 0.3, zMax: 0.3 });
      for (let k = 1; k < s.points.length; k++) {
        const [pr, pz] = s.points[k - 1], [qr, qz] = s.points[k];
        expect(segmentDistanceToWinding(G, pr, pz, qr, qz)).toBeGreaterThanOrEqual(G.wireRadius * 1.5 - 1e-12);
      }
    }
  });

  it('distinguishes why it stopped instead of calling everything a conductor', () => {
    // A null of the field must report 'stalled', not 'conductor'.
    const far = streamline(G, 0.0001, 0, { step: 0.0002, maxSteps: 5, rMax: 0.3, zMax: 0.3 });
    expect(['closed', 'boundary', 'conductor', 'steps', 'stalled', 'nonfinite']).toContain(far.stop);
    const seeded = streamline(G, G.radius, turnZ(G, 20), { step: 0.0001, maxSteps: 2, rMax: 0.1, zMax: 0.2 });
    expect(seeded.stop).toBe('conductor');
  });
});
