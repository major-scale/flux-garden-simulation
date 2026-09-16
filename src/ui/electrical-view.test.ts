/**
 * BATCH 4 — the CURRENT-ARROW SCALE CONTRACT.
 *
 * The view prints "widest arrow = F A → X A per pixel of width above a B px
 * baseline". That sentence is a CHECKABLE CLAIM, not decoration: a reader who
 * measures an arrow, subtracts the baseline and multiplies by X must recover the
 * current the view also prints in SI.
 *
 * It did not hold. The geometry used 5.4 px of encoded width while the printed
 * scale divided by 6, and the printed wording said "per pixel of width" without
 * naming the 1.2 px pedestal — so reading a width back gave a current 15% too
 * high on a full-width arrow and 90% too high on a thin one. Two literals for
 * one quantity. Recorded as D-46.
 *
 * These tests go through the SAME exported definitions the renderer uses, so the
 * two cannot drift apart again silently.
 *
 * UNITS: every width here is an SVG DRAWING UNIT, not a screen pixel. The <svg>
 * is width="100%", so the rendered image is rescaled by the panel width and a
 * screen ruler will not reproduce these numbers. Astra found the printed wording
 * claiming screen pixels; the geometry was always in drawing units. See D-47.
 */
import { describe, it, expect } from 'vitest';
import { ARROW_BASE, ARROW_ZERO, ampsPerPixel, arrowWidthPx } from './electrical-view';

/** Currents from the circuit actually authored through the real forms during review. */
const OBSERVED = { fullI: 1.5, currents: [1.2, 0.3, 0.3, 0] };

describe('current-arrow width is readable back through the PRINTED scale', () => {
  it('the printed A/px recovers |I| from the drawn width, for the circuit built on screen', () => {
    const { fullI, currents } = OBSERVED;
    const app = ampsPerPixel(fullI);
    for (const I of currents.filter((x) => x !== 0)) {
      const readBack = (arrowWidthPx(I, fullI) - ARROW_BASE) * app;
      expect(readBack).toBeCloseTo(Math.abs(I), 12);
    }
  });

  it('holds across magnitudes and both signs, up to the clamp', () => {
    for (const fullI of [1e-6, 0.25, 1.5, 40, 1e5]) {
      const app = ampsPerPixel(fullI);
      for (const frac of [1e-6, 0.01, 0.25, 0.5, 0.999, 1]) {
        for (const sgn of [1, -1]) {
          const I = sgn * frac * fullI;
          const readBack = (arrowWidthPx(I, fullI) - ARROW_BASE) * app;
          expect(readBack / Math.abs(I)).toBeCloseTo(1, 10);
        }
      }
    }
  });

  it('NON-VACUITY: the pre-fix formula fails this same round trip', () => {
    // The exact code that shipped before D-46: divide by 6, and do not subtract
    // the baseline ("per pixel of width", full stroke). If this ever passes, the
    // assertions above have stopped discriminating and are no longer evidence.
    const { fullI } = OBSERVED;
    const oldApp = fullI / 6;
    const readBack = (I: number) => arrowWidthPx(I, fullI) * oldApp;
    expect(readBack(1.2)).toBeCloseTo(1.38, 10);   // true 1.2 A — 15% high
    expect(readBack(0.3)).toBeCloseTo(0.57, 10);   // true 0.3 A — 90% high
    expect(Math.abs(readBack(1.2) / 1.2 - 1)).toBeGreaterThan(0.1);
    expect(Math.abs(readBack(0.3) / 0.3 - 1)).toBeGreaterThan(0.5);
  });

  it('EXACTLY zero is drawn wider than the thinnest nonzero arrow, so it cannot read as small', () => {
    expect(arrowWidthPx(0, 1.5)).toBe(ARROW_ZERO);
    expect(ARROW_ZERO).toBeGreaterThan(ARROW_BASE);
    // A vanishingly small nonzero current approaches the pedestal from ABOVE
    // ARROW_BASE and stays BELOW the zero width, so the two are never confusable
    // by width — and zero additionally loses its arrowhead and is drawn flat.
    expect(arrowWidthPx(1e-12, 1.5)).toBeGreaterThan(ARROW_BASE);
    expect(arrowWidthPx(1e-12, 1.5)).toBeLessThan(ARROW_ZERO);
  });

  it('the baseline cancels out of a width DIFFERENCE, which is what the text claims', () => {
    const fullI = 1.5, app = ampsPerPixel(fullI);
    const dW = arrowWidthPx(1.2, fullI) - arrowWidthPx(0.3, fullI);
    expect(dW * app).toBeCloseTo(1.2 - 0.3, 12);
  });
});
