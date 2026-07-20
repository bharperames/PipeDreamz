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

describe('bonus round (Connect-4 drop)', () => {
  it('starts with an empty board, a tank in the bottom-left, and a queue', () => {
    const bonus = new BonusRound(mulberry32(9));
    let pieces = 0;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 10; x++) if (bonus.grid.get({ x, y })) pieces++;
    }
    expect(pieces).toBe(1);
    expect(bonus.grid.get({ x: 0, y: 6 })!.kind).toBe('START');
    expect(bonus.queue.peek().length).toBe(5);
  });

  it('drops land in the lowest open space and stack upward', () => {
    const bonus = new BonusRound(mulberry32(9));
    const k1 = bonus.queue.next();
    expect(bonus.drop(3)).toMatchObject([{ type: 'dropped', pos: { x: 3, y: 6 }, kind: k1 }]);
    const k2 = bonus.queue.next();
    expect(bonus.drop(3)).toMatchObject([{ type: 'dropped', pos: { x: 3, y: 5 }, kind: k2 }]);
    // Column 0 stacks on top of the fixed START.
    expect(bonus.drop(0)).toMatchObject([{ type: 'dropped', pos: { x: 0, y: 5 } }]);
  });

  it('rejects drops into a full column and out-of-range columns', () => {
    const bonus = new BonusRound(mulberry32(9));
    for (let i = 0; i < 7; i++) bonus.drop(4);
    expect(bonus.landing(4)).toBeNull();
    expect(bonus.drop(4).length).toBe(0);
    expect(bonus.drop(-1).length).toBe(0);
    expect(bonus.drop(10).length).toBe(0);
  });

  it('rejects drops once the flow phase begins', () => {
    const bonus = new BonusRound(mulberry32(9));
    bonus.startFlow();
    runBonus(bonus, 100);
    expect(bonus.drop(3).length).toBe(0);
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
