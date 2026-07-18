import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/core/levels/levels';
import { validateLevel } from '../src/core/levels/schema';
import { delayMs, distance, fillMs } from '../src/core/levels/curve';
import { DIR_DELTA } from '../src/core/types';

describe('level definitions', () => {
  it('has exactly 36 levels with sequential ids', () => {
    expect(LEVELS.length).toBe(36);
    LEVELS.forEach((l, i) => expect(l.id).toBe(i + 1));
  });

  it('every level validates', () => {
    for (const level of LEVELS) {
      expect(validateLevel(level), `level ${level.id}`).toEqual([]);
    }
  });

  it('the start piece never exits directly into an obstacle or off-board', () => {
    for (const level of LEVELS) {
      const d = DIR_DELTA[level.start.exit]!;
      const nx = level.start.pos.x + d.dx;
      const ny = level.start.pos.y + d.dy;
      expect(nx, `level ${level.id}`).toBeGreaterThanOrEqual(0);
      expect(nx, `level ${level.id}`).toBeLessThan(level.gridW);
      expect(ny, `level ${level.id}`).toBeGreaterThanOrEqual(0);
      expect(ny, `level ${level.id}`).toBeLessThan(level.gridH);
      const blocker = level.fixed.find(
        (f) => f.pos.x === nx && f.pos.y === ny && f.kind === 'OBSTACLE',
      );
      expect(blocker, `level ${level.id}`).toBeUndefined();
    }
  });

  it('difficulty curve is monotonic', () => {
    for (let l = 2; l <= 36; l++) {
      expect(delayMs(l)).toBeLessThanOrEqual(delayMs(l - 1));
      expect(fillMs(l)).toBeLessThan(fillMs(l - 1));
      expect(distance(l)).toBeGreaterThanOrEqual(distance(l - 1));
    }
    expect(delayMs(1)).toBe(20000);
    expect(fillMs(1)).toBe(2000);
    expect(fillMs(36)).toBe(400);
    expect(distance(1)).toBe(8);
    expect(distance(36)).toBe(30);
  });

  it('feature introduction bands', () => {
    const has = (id: number, pred: (k: string) => boolean) =>
      LEVELS[id - 1]!.fixed.some((f) => pred(f.kind));
    expect(has(1, (k) => k === 'OBSTACLE')).toBe(false);
    expect(has(9, (k) => k.startsWith('ONEWAY'))).toBe(true);
    expect(LEVELS[12]!.wraps.length).toBeGreaterThan(0); // level 13
    expect(has(17, (k) => k.startsWith('RESERVOIR'))).toBe(true);
    expect(LEVELS[20]!.requireEndPiece).toBe(true); // level 21
    expect(has(25, (k) => k === 'BONUS')).toBe(true);
    expect(LEVELS[35]!.requireEndPiece).toBe(true);
  });
});
