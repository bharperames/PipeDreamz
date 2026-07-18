import { describe, expect, it } from 'vitest';
import { BonusRound, BONUS_POINTS_PER_PIPE, BONUS_TIMER_MS } from '../src/core/bonus';
import { mulberry32 } from '../src/core/rng';

function runBonus(bonus: BonusRound, ms: number) {
  const events = [];
  const dt = 1000 / 120;
  for (let t = 0; t < ms && bonus.phase !== 'done'; t += dt) {
    events.push(...bonus.tick(dt));
  }
  return events;
}

describe('bonus round', () => {
  it('generates a full board with one hole and a start piece', () => {
    const bonus = new BonusRound(mulberry32(9));
    let empty = 0;
    let pieces = 0;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 10; x++) {
        const p = bonus.grid.get({ x, y });
        if (!p) empty++;
        else pieces++;
      }
    }
    expect(empty).toBe(1);
    expect(pieces).toBe(69);
    expect(bonus.grid.get(bonus.level.start.pos)!.kind).toBe('START');
  });

  it('slides only pieces adjacent to the hole', () => {
    const bonus = new BonusRound(mulberry32(9));
    const hole = { ...bonus.hole };
    const from = { x: hole.x - 1, y: hole.y };
    const kind = bonus.grid.get(from)!.kind;
    expect(bonus.slide(from).length).toBe(1);
    expect(bonus.grid.get(hole)!.kind).toBe(kind);
    expect(bonus.grid.get(from)).toBeNull();
    expect(bonus.hole).toEqual(from);
    // Non-adjacent slide rejected
    expect(bonus.slide({ x: 0, y: 0 }).length).toBe(0);
  });

  it('cannot slide the start piece', () => {
    const bonus = new BonusRound(mulberry32(1));
    // Move the hole next to the start by force
    bonus.hole = { x: bonus.level.start.pos.x + 1, y: bonus.level.start.pos.y };
    bonus.grid.set(bonus.hole, null);
    expect(bonus.slide(bonus.level.start.pos).length).toBe(0);
  });

  it('flows after the timer and scores 100 per pipe with no loss', () => {
    const bonus = new BonusRound(mulberry32(5));
    bonus.startFlow(); // skip timer
    const events = runBonus(bonus, 60000);
    expect(bonus.phase).toBe('done');
    const over = events.find((e) => e.type === 'bonusOver');
    expect(over).toBeDefined();
    expect(bonus.score).toBe(bonus.pipesFilled * BONUS_POINTS_PER_PIPE);
  });

  it('timer counts down during arrange phase', () => {
    const bonus = new BonusRound(mulberry32(5));
    runBonus(bonus, 1000);
    expect(bonus.timerMs).toBeLessThan(BONUS_TIMER_MS - 900);
    expect(bonus.phase).toBe('arrange');
  });
});
