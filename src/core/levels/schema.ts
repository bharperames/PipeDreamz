import { channelsOf } from '../pieces';
import { LevelDef } from '../types';

/** Validate a level definition; returns a list of problems (empty = ok). */
export function validateLevel(def: LevelDef): string[] {
  const problems: string[] = [];
  const inBounds = (x: number, y: number) =>
    x >= 0 && x < def.gridW && y >= 0 && y < def.gridH;

  if (def.gridW < 5 || def.gridH < 5) problems.push('grid too small');
  if (!inBounds(def.start.pos.x, def.start.pos.y)) problems.push('start out of bounds');
  if (def.delayMs <= 0 || def.fillMs <= 0) problems.push('non-positive timing');
  if (def.distance < 1) problems.push('distance < 1');
  if (def.distance > def.gridW * def.gridH * 2) problems.push('distance unachievable');

  const occupied = new Set<string>([`${def.start.pos.x},${def.start.pos.y}`]);
  for (const f of def.fixed) {
    const key = `${f.pos.x},${f.pos.y}`;
    if (!inBounds(f.pos.x, f.pos.y)) problems.push(`fixed piece out of bounds at ${key}`);
    if (occupied.has(key)) problems.push(`overlapping pieces at ${key}`);
    occupied.add(key);
    if (f.kind === 'START') problems.push('START must come from def.start, not fixed[]');
    // Board-only sanity: fixed placeable-shaped pieces are allowed (pre-laid pipes).
    void channelsOf(f.kind);
  }

  if (def.requireEndPiece && !def.fixed.some((f) => f.kind === 'END')) {
    problems.push('requireEndPiece with no END piece');
  }

  for (const w of def.wraps) {
    if (!inBounds(w.x, w.y)) problems.push(`wrap out of bounds at ${w.x},${w.y}`);
    const onEdge =
      (w.side === 0 && w.y === 0) ||
      (w.side === 2 && w.y === def.gridH - 1) ||
      (w.side === 3 && w.x === 0) ||
      (w.side === 1 && w.x === def.gridW - 1);
    if (!onEdge) problems.push(`wrap not on matching edge at ${w.x},${w.y} side ${w.side}`);
  }

  return problems;
}
