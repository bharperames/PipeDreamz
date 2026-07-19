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
