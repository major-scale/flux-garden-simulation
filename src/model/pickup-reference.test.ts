import { describe, it, expect } from 'vitest';
import reference from './pickup-reference.json';
import { mutualToPickup } from './pickup';
import type { CoilGeometry } from './coil';

/**
 * The mutual inductance against magpylib — a field implementation written by other people,
 * integrated over the pickup disc. Our closed form and our own quadrature share a field
 * evaluator, so neither can validate the other; this can.
 *
 * Tolerance 1e-6 relative, declared in PICKUP-PLAN.md before this file existed. magpylib's side
 * is a polar quadrature, so its own discretization dominates the difference.
 */
describe('mutual inductance against magpylib', () => {
  const coil = reference.coil as CoilGeometry;
  it('matches the independent quadrature at every sampled pose', () => {
    let worst = 0;
    for (const s of reference.samples) {
      const ours = mutualToPickup(coil, {
        radius: s.pickupRadius, separation: s.separation, orientation: 0,
      });
      worst = Math.max(worst, Math.abs(ours / s.mutualH - 1));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('covers the SHIPPING default pose, not only a pose the product no longer uses', () => {
    // The default moved from a 15 mm loop at the coil centre to 30 mm at 60 mm out; a
    // reference that only validated the old one would validate nothing the user sees.
    const shipped = reference.samples.filter(s => s.pickupRadius === reference.shippingDefaultRadius);
    expect(shipped.length).toBeGreaterThanOrEqual(8);
    const atDefault = shipped.find(s => Math.abs(s.separation - 0.06) < 1e-12)!;
    expect(atDefault).toBeDefined();
    const ours = mutualToPickup(coil, { radius: atDefault.pickupRadius, separation: 0.06, orientation: 0 });
    expect(Math.abs(ours / atDefault.mutualH - 1)).toBeLessThan(1e-6);
  });
  it('covers a range wide enough to be a real test, not one lucky pose', () => {
    const ms = reference.samples.map(s => Math.abs(s.mutualH));
    expect(reference.samples.length).toBeGreaterThanOrEqual(16);
    expect(Math.max(...ms) / Math.min(...ms)).toBeGreaterThan(50);
  });
});
