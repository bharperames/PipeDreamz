import { describe, expect, it } from 'vitest';
import { GameRound } from '../src/core/round';
import { mulberry32 } from '../src/core/rng';
import { LEVELS } from '../src/core/levels/levels';
import { RouteBot } from './bots';

/** Regression: the route planner must produce quota-length END routes. */
describe('RouteBot planner', () => {
  for (const levelId of [21, 22, 24, 28]) {
    it(`plans a quota-length route to the END on level ${levelId}`, () => {
      const level = LEVELS[levelId - 1]!;
      const round = new GameRound(
        { level, mode: 'basic', seed: 1, players: 1 },
        mulberry32(1),
      );
      const bot = new RouteBot(level, round.grid, mulberry32(42));
      const route = (bot as unknown as { route: Array<{ pos: { x: number; y: number } }> }).route;
      expect(route.length, `route length vs quota ${level.distance}`).toBeGreaterThanOrEqual(
        level.distance,
      );
      // Route cells must be unique and on empty cells.
      const keys = new Set(route.map((c) => `${c.pos.x},${c.pos.y}`));
      expect(keys.size).toBe(route.length);
      for (const c of route) expect(round.grid.get(c.pos)).toBeNull();
    });
  }
});
