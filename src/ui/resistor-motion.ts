/** Drawing coordinates only. These particles never enter the electrical model. */
export const AGITATION_SPEED = 80;
export const MAX_DRIFT_SPEED = 3.37;
export class ResistorMotion {
  readonly particles = Array.from({ length: 42 }, (_, n) => ({
    x: ((n * .618034) % 1) * 674,
    y: ((n * .414214) % 1) * 125,
  }));
  private seed = 18473;
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private readonly pairs = Array.from({ length: 21 }, () => ({
    angle: this.random() * 2 * Math.PI, remaining: .08 + this.random() * .13,
  }));

  advance(dt: number, signedFraction: number): void {
    if (!(dt > 0) || !Number.isFinite(dt) || !Number.isFinite(signedFraction)) return;
    const drift = -Math.max(-1, Math.min(1, signedFraction)) * MAX_DRIFT_SPEED;
    this.pairs.forEach((pair, index) => {
      let left = dt;
      while (left > 0) {
        const step = Math.min(left, pair.remaining);
        const dx = Math.cos(pair.angle) * AGITATION_SPEED * step;
        const dy = Math.sin(pair.angle) * AGITATION_SPEED * step;
        // Opposite increments cancel sampling bias, not a physical electron pairing.
        const a = this.particles[index * 2], b = this.particles[index * 2 + 1];
        a.x += dx + drift * step; b.x += -dx + drift * step;
        a.y += dy; b.y -= dy;
        left -= step; pair.remaining -= step;
        if (pair.remaining <= 1e-12) {
          pair.angle = this.random() * 2 * Math.PI;
          pair.remaining = .08 + this.random() * .13;
        }
      }
    });
  }
}
