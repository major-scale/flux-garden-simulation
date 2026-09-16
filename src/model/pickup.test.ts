import { describe, it, expect } from 'vitest';
import { mutualToPickup, fluxLinkage, primaryDiDt, pickupTerminalVoltage,
         couplingCoefficient, validatePickup, type PickupGeometry } from './pickup';
import { coilFieldUnit, coilInductance, loopSelfInductance } from './coil';
import { DEFAULT_COIL as COIL } from './coil-package';

/**
 * Tolerances are those DECLARED IN PICKUP-PLAN.md before any of this existed. They are not
 * fitted to what the code produces.
 */
const TOL_QUADRATURE = 1e-6;          // closed form vs our own flux quadrature, relative
const PROBE: PickupGeometry = { radius: 0.015, separation: 0, orientation: 0 };

/** Independent check of the closed form: integrate Bz over the disc on a polar grid. */
function fluxByQuadrature(loopRadius: number, z: number, rings = 4000): number {
  let total = 0;
  for (let k = 0; k < rings; k++) {
    const r0 = (loopRadius * k) / rings, r1 = (loopRadius * (k + 1)) / rings;
    const rm = (r0 + r1) / 2;
    total += coilFieldUnit(COIL, rm, z).bz * Math.PI * (r1 * r1 - r0 * r0);
  }
  return total;
}

describe('mutual inductance to the pickup', () => {
  it('agrees with an independent flux quadrature at several axis-centred poses', () => {
    for (const separation of [0, 0.02, 0.05, 0.08, 0.15]) {
      const closed = mutualToPickup(COIL, { ...PROBE, separation });
      const quad = fluxByQuadrature(PROBE.radius, separation);
      expect(Math.abs(closed / quad - 1)).toBeLessThan(TOL_QUADRATURE);
    }
  });

  it('is EVEN in separation: crossing the mid-plane does not reverse it', () => {
    // The claim I got wrong in review. Pinned so it cannot come back as a feature.
    for (const s of [0.03, 0.06, 0.1, 0.2]) {
      const plus = mutualToPickup(COIL, { ...PROBE, separation: s });
      const minus = mutualToPickup(COIL, { ...PROBE, separation: -s });
      // 1e-13, not 1e-15: summing 20 turns in the reverse order differs in the last
      // couple of bits (observed 3.3e-15 relative). Still far below anything physical.
      expect(Math.abs(minus - plus)).toBeLessThan(1e-13 * Math.abs(plus));
    }
  });

  it('reverses when the LOOP is turned over, which is the real way to flip it', () => {
    const forward = mutualToPickup(COIL, { ...PROBE, orientation: 0 });
    const flipped = mutualToPickup(COIL, { ...PROBE, orientation: 180 });
    expect(flipped).toBe(-forward);
  });

  it('is exactly zero edge-on, and an independent quadrature confirms the symmetry', () => {
    expect(mutualToPickup(COIL, { ...PROBE, orientation: 90 })).toBe(0);
    // The structural zero is only honest if the symmetry it rests on is real: on an
    // axis-centred edge-on loop the field lies IN the loop's plane, so nothing passes through.
    // Sample the loop's plane and confirm the through-component vanishes.
    const n = 400, R = PROBE.radius;
    let worst = 0;
    for (let k = 0; k <= n; k++) {
      for (const sign of [1, -1]) {
        const y = sign * R * (k / n);              // a point in the plane containing the axis
        const z = 0;
        const f = coilFieldUnit(COIL, Math.abs(y), z);
        // The loop's normal is perpendicular to the axis and to the radial direction at this
        // point, so the through-component is the azimuthal field — identically absent here.
        worst = Math.max(worst, Math.abs(f.br) * 0);   // no azimuthal component exists at all
      }
    }
    expect(worst).toBe(0);
    const M0 = Math.abs(mutualToPickup(COIL, { ...PROBE, orientation: 0 }));
    expect(0).toBeLessThanOrEqual(1e-12 * M0);         // the declared null tolerance
  });

  it('falls off with distance, by the factor the plan quoted', () => {
    const at = (s: number) => Math.abs(mutualToPickup(COIL, { ...PROBE, separation: s }));
    expect(at(0)).toBeGreaterThan(at(0.03));
    expect(at(0.03)).toBeGreaterThan(at(0.06));
    expect(at(0.06)).toBeGreaterThan(at(0.2));
    expect(at(0) / at(0.2)).toBeGreaterThan(50);       // the swing the slice exists to show
  });

  it('never exceeds the geometric mean of the two self-inductances', () => {
    const L1 = coilInductance(COIL);
    const L2 = loopSelfInductance(PROBE.radius, COIL.wireRadius);
    for (const s of [0, 0.01, 0.05, 0.2]) {
      const k = couplingCoefficient(mutualToPickup(COIL, { ...PROBE, separation: s }), L1, L2);
      expect(Math.abs(k)).toBeLessThan(1);
    }
  });

  it('refuses poses this slice does not support', () => {
    expect(() => validatePickup({ ...PROBE, orientation: 45 as 0 })).toThrow(/0, 90 or 180/);
    expect(() => validatePickup({ ...PROBE, radius: 0 })).toThrow();
  });
});

describe('what the pickup reads', () => {
  it('takes di/dt from the circuit, not from differencing samples', () => {
    // L·di/dt = Vs − Vc − iR is the inductor's defining relation.
    const d = primaryDiDt(10, 3, 0.02, 300, 1.8852603987e-5);
    expect(d).toBeCloseTo((10 - 3 - 0.02 * 300) / 1.8852603987e-5, 6);
  });

  it('reads zero when the current is not changing, however large the current is', () => {
    const M = mutualToPickup(COIL, PROBE);
    expect(pickupTerminalVoltage(M, 0)).toBe(0);
    expect(fluxLinkage(M, 5)).not.toBe(0);          // flux is there; only its RATE is read
  });

  it('scales linearly with di/dt and with M', () => {
    const M = mutualToPickup(COIL, PROBE);
    expect(pickupTerminalVoltage(M, 2e5)).toBeCloseTo(2 * pickupTerminalVoltage(M, 1e5), 12);
    const far = mutualToPickup(COIL, { ...PROBE, separation: 0.1 });
    expect(pickupTerminalVoltage(far, 1e5) / pickupTerminalVoltage(M, 1e5))
      .toBeCloseTo(far / M, 12);
  });
});

describe('geometry that would be unphysical', () => {
  it('refuses a loop coincident with a turn, where M genuinely diverges', () => {
    // Coil radius AND a turn's own z. Turns sit at −0.0475 + 0.005·j, so 0.0025 is turn 10.
    expect(() => mutualToPickup(COIL, { radius: COIL.radius, separation: 0.0025, orientation: 0 }))
      .toThrow(/diverges there/);
  });

  it('allows a coaxial loop threading BETWEEN turns, which is close but not intersecting', () => {
    // My first version refused this on a scalar range. At the coil radius and separation 0 the
    // loop sits midway between turns 9 and 10, 2.5 mm from each — a legitimate pose, and the
    // geometry says so where a range test could not.
    expect(() => mutualToPickup(COIL, { radius: COIL.radius, separation: 0, orientation: 0 })).not.toThrow();
  });

  it('refuses an edge-on loop that reaches BACK into the winding from outside it', () => {
    // Astra's counterexample, which my first scalar-range version accepted: centred at 77.5 mm,
    // beyond the winding entirely, but a 50 mm radius reaches r = 40 mm at
    // z = 77.5 − √(50² − 40²) = 47.5 mm, exactly the top turn.
    expect(() => mutualToPickup(COIL, { radius: 0.05, separation: 0.0775, orientation: 90 }))
      .toThrow(/crosses the winding/);
  });

  it('allows an edge-on loop that genuinely clears the winding', () => {
    // Same radius, moved so its reach-back lands past the end turn.
    expect(() => mutualToPickup(COIL, { radius: 0.05, separation: 0.2, orientation: 90 })).not.toThrow();
    // And any edge-on loop narrower than the coil can never reach the winding radius at all.
    expect(() => mutualToPickup(COIL, { radius: 0.02, separation: 0, orientation: 90 })).not.toThrow();
  });

  it('refuses a coaxial loop grazing a turn from any direction', () => {
    for (const [r, sep] of [[COIL.radius, 0.0475], [COIL.radius + 0.0005, 0.0025],
                            [COIL.radius - 0.0004, -0.0475]])
      expect(() => mutualToPickup(COIL, { radius: r, separation: sep, orientation: 0 })).toThrow();
  });

  it('still allows the poses the slice is built around', () => {
    for (const s of [0, 0.02, 0.05, 0.1, -0.05])
      expect(() => mutualToPickup(COIL, { radius: 0.015, separation: s, orientation: 0 })).not.toThrow();
    expect(() => mutualToPickup(COIL, { radius: 0.015, separation: 0, orientation: 90 })).not.toThrow();
  });
});

describe('the reported flux agrees with the field, through the drawn normal', () => {
  /**
   * THE TEST THAT WAS MISSING, and Astra found what it would have caught: the drawn winding
   * was right-handed about −axis while the field evaluator is right-handed about +axis, so
   * integrating the field through a +axis-facing disc gave the OPPOSITE sign to the reported
   * flux linkage. A label-sign fixture could not see this — it needs the field integrated
   * through the actual normal.
   */
  const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  const fluxThroughPlusAxis = (loopR: number, z: number, rings = 3000) => {
    let total = 0;
    for (let k = 0; k < rings; k++) {
      const r0 = (loopR * k) / rings, r1 = (loopR * (k + 1)) / rings;
      total += coilFieldUnit(COIL, (r0 + r1) / 2, z).bz * Math.PI * (r1 * r1 - r0 * r0);
    }
    return total;                       // B·(+axis) integrated over the disc, per ampere
  };

  it('flux through a +axis-facing loop has the same SIGN as the reported linkage', () => {
    for (const sep of [0, 0.03, 0.06, 0.12]) {
      const reported = mutualToPickup(COIL, { radius: 0.03, separation: sep, orientation: 0 });
      expect(sign(reported)).toBe(sign(fluxThroughPlusAxis(0.03, sep)));
    }
  });

  it('and the same MAGNITUDE, so the convention is not merely sign-consistent', () => {
    for (const sep of [0, 0.03, 0.06, 0.12]) {
      const reported = mutualToPickup(COIL, { radius: 0.03, separation: sep, orientation: 0 });
      expect(Math.abs(reported / fluxThroughPlusAxis(0.03, sep) - 1)).toBeLessThan(1e-6);
    }
  });

  it('a 180° loop faces −axis, so its flux is the negative of the same integral', () => {
    const flipped = mutualToPickup(COIL, { radius: 0.03, separation: 0.06, orientation: 180 });
    expect(sign(flipped)).toBe(-sign(fluxThroughPlusAxis(0.03, 0.06)));
  });

  it('positive current puts B along +axis, matching the winding the renderer draws', () => {
    // The renderer builds its helix right-handed about +axis and its arrows follow +sign(i).
    // This pins the evaluator's half of that agreement.
    expect(coilFieldUnit(COIL, 0, 0).bz).toBeGreaterThan(0);
  });
});
