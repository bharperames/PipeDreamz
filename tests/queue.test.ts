import { describe, expect, it } from 'vitest';
import { DispenserQueue } from '../src/core/queue';
import { mulberry32 } from '../src/core/rng';
import { PLACEABLE_KINDS } from '../src/core/types';

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
