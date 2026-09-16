/**
 * THE PLAYBACK SPEED CONTROL, as pure functions shared by every solved-playback page.
 *
 * ONE RUN TAKES `BASE_WALL_SECONDS / speed`. At speed 1 that is a three-second run; at the 0.1
 * default, thirty seconds. The slider is LOGARITHMIC over two decades so the slow end — Peter:
 * "too fast for human intuition" — is reachable and is the default, not a setting to hunt for.
 * Speed is a PRESENTATION choice: it divides simulated seconds by wall seconds and touches no
 * number in the trajectory.
 */
export const BASE_WALL_SECONDS = 3;
export const SPEED_MIN = 0.01, SPEED_MAX = 1;
export const SPEED_DEFAULT = 0.1;

/** Slider position 0…1000 → speed multiplier, log-spaced; a bad value reads as the default. */
export function speedFromSlider(raw: number): number {
  if (!Number.isFinite(raw)) return SPEED_DEFAULT;
  const f = Math.min(1, Math.max(0, raw / 1000));
  return SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, f);
}

export function wallSecondsFor(speed: number): number {
  return BASE_WALL_SECONDS / speed;
}
