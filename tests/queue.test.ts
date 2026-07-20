import { describe, expect, it } from 'vitest';
import { DispenserQueue } from '../src/core/queue';
import { GameRound } from '../src/core/round';
import { mulberry32 } from '../src/core/rng';
import { PLACEABLE_KINDS } from '../src/core/types';
import { makeLevel } from './helpers';

describe('DispenserQueue', () => {
  it('maintains its depth as pieces are taken', () => {
    const q = new DispenserQueue(mulberry32(1), 5);
    expect(q.peek().length).toBe(5);
    const first = q.next();
    expect(q.take()).toBe(first);
    expect(q.peek().length).toBe(5);
  });

  it('is deterministic for a given seed', () => {
    const a = new DispenserQueue(mulberry32(123), 5);
    const b = new DispenserQueue(mulberry32(123), 5);
    const seqA = Array.from({ length: 100 }, () => a.take());
    const seqB = Array.from({ length: 100 }, () => b.take());
    expect(seqA).toEqual(seqB);
  });

  it('easy queue biases toward pieces the pipeline needs', () => {
    // Start at (1,3) exiting E onto an empty board: the gap is entered
    // from W, so H / NW / SW / X should dominate the dispenser.
    const level = makeLevel({ delayMs: 600000 });
    const round = new GameRound(
      { level, mode: 'basic', seed: 5, players: 1, easyQueue: true },
      mulberry32(5),
    );
    const accepting = new Set(['H', 'NW', 'SW', 'X']);
    let hits = 0;
    const total = 300;
    for (let i = 0; i < total; i++) {
      if (accepting.has(round.queues[0]!.take())) hits++;
    }
    // Uniform would give ~57%; the bias should push well past 80%.
    expect(hits / total).toBeGreaterThan(0.8);
  });

  it('sticky refresh keeps slots the caller still wants', () => {
    const q = new DispenserQueue(mulberry32(11), 5);
    const before = [...q.peek()];
    // Keep everything: refresh must be a no-op.
    q.refreshTail(2, () => true);
    expect([...q.peek()]).toEqual(before);
    // Keep nothing: slots 0-1 stay, 2-4 re-roll (deterministic seed —
    // verify the near slots were untouched).
    q.refreshTail(2, () => false);
    expect(q.peek()[0]).toBe(before[0]);
    expect(q.peek()[1]).toBe(before[1]);
  });

  it('sticky refresh never thrashes a needed piece out of the far queue', () => {
    // Easy round, empty board: the gap after the START at (1,3) (exit E)
    // is (2,3), which accepts H / NW / SW / X. Such a piece sitting in
    // the far queue must survive refreshes triggered by unrelated
    // placements — unless it is heavily damped (many visible copies or
    // a discarded kind), which is the designed exception. Placements
    // stay NEAR the flow front (< 3 tiles) and off the gap, so only
    // duplicate damping applies; ≤ 2 copies keeps a wanted kind well
    // above the sticky threshold.
    const level = makeLevel({ delayMs: 600000 });
    const round = new GameRound(
      { level, mode: 'basic', seed: 9, players: 1, easyQueue: true },
      mulberry32(9),
    );
    const accepting = new Set(['H', 'NW', 'SW', 'X']);
    const nearCells = [
      { x: 0, y: 2 }, { x: 0, y: 4 }, { x: 1, y: 2 }, { x: 1, y: 4 },
      { x: 0, y: 3 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 3 },
    ];
    let checked = 0;
    for (const pos of nearCells) {
      const all = round.queues[0]!.peek();
      const tailBefore = all.slice(2);
      const copies = new Map<string, number>();
      for (const k of all) copies.set(k, (copies.get(k) ?? 0) + 1);
      const wanted = tailBefore.map((k) => accepting.has(k) && (copies.get(k) ?? 0) <= 2);
      round.apply({ type: 'place', player: 0, pos, dispenser: 0 });
      const tailAfter = round.queues[0]!.peek().slice(2);
      // take() shifted the queue by one before the refresh, so old tail
      // slot i sits at i-1 of the new view (old slots 3,4 → new 2,3).
      for (let i = 1; i < tailBefore.length; i++) {
        if (wanted[i]) {
          expect(tailAfter[i - 1]).toBe(tailBefore[i]);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0); // the scenario actually exercised the guard
  });

  it('produces only placeable kinds with roughly uniform spread', () => {
    const q = new DispenserQueue(mulberry32(7), 5);
    const counts = new Map<string, number>();
    for (let i = 0; i < 7000; i++) {
      const k = q.take();
      expect(PLACEABLE_KINDS).toContain(k);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const k of PLACEABLE_KINDS) {
      const c = counts.get(k) ?? 0;
      expect(c).toBeGreaterThan(700); // expected ~1000 each
      expect(c).toBeLessThan(1300);
    }
  });
});
