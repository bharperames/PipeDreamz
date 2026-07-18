/**
 * Difficulty curve for the 36 levels. Values are original tuning in the
 * spirit of the 1989 game: countdown shrinks linearly, per-pipe fill time
 * decays exponentially, required distance grows linearly.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Countdown before flooz starts: 20s at level 1 down to 5s. */
export function delayMs(level: number): number {
  return Math.round(clamp(20000 - (level - 1) * 450, 5000, 20000));
}

/** Per-pipe fill time: 2000ms at level 1 decaying to 400ms at level 36. */
export function fillMs(level: number): number {
  return Math.round(2000 * Math.pow(0.4 / 2.0, (level - 1) / 35));
}

/** Required pipes: 8 at level 1 up to 30 at level 36. */
export function distance(level: number): number {
  return 8 + Math.floor((level - 1) * 0.65);
}
