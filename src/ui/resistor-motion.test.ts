import { describe, it, expect } from 'vitest';
import { ResistorMotion, AGITATION_SPEED, MAX_DRIFT_SPEED } from './resistor-motion';
const meanX = (motion: ResistorMotion) => motion.particles.reduce((sum, p) => sum + p.x, 0) / motion.particles.length;
describe('resistor illustration motion contract', () => {
  it('keeps agitation at zero current without inventing ensemble drift', () => {
    const motion = new ResistorMotion();
    const start = meanX(motion), first = { ...motion.particles[0] };
    for (let n = 0; n < 300; n++) motion.advance(1 / 30, 0);
    expect(meanX(motion)).toBeCloseTo(start, 9);
    expect(Math.hypot(motion.particles[0].x - first.x, motion.particles[0].y - first.y)).toBeGreaterThan(1);
  });
  it('reverses only the small drift bias while preserving the same agitation', () => {
    const positive = new ResistorMotion(), negative = new ResistorMotion(), zero = new ResistorMotion();
    for (let n = 0; n < 90; n++) {
      positive.advance(1 / 30, 1); negative.advance(1 / 30, -1); zero.advance(1 / 30, 0);
    }
    positive.particles.forEach((p, n) => {
      expect(p.x - zero.particles[n].x).toBeCloseTo(-3 * MAX_DRIFT_SPEED, 9);
      expect(negative.particles[n].x - zero.particles[n].x).toBeCloseTo(3 * MAX_DRIFT_SPEED, 9);
      expect(p.y).toBe(zero.particles[n].y);
    });
    expect(AGITATION_SPEED / MAX_DRIFT_SPEED).toBeGreaterThan(20);
  });
  it('does not advance at a paused timestep', () => {
    const motion = new ResistorMotion();
    const before = JSON.stringify(motion.particles);
    motion.advance(0, 1);
    expect(JSON.stringify(motion.particles)).toBe(before);
  });
});
