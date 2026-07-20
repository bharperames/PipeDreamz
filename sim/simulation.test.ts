import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { LEVELS } from '../src/core/levels/levels';
import { Aggregate, runBatch } from './harness';

/**
 * Full simulation matrix (RUN_SIM=1 npm run sim): thousands of bot games
 * across levels, strategies, reaction times, and easy-queue settings.
 * Writes sim/results.json; the analysis lives in sim/REPORT.md.
 */

const GAMES = Number(process.env.SIM_GAMES ?? 250);

describe.runIf(process.env.RUN_SIM === '1')('game simulation matrix', () => {
  it('runs the matrix and writes results', () => {
    const levels = [1, 5, 13, 21, 24];
    const reactions = [200, 500, 1000];
    const results: Aggregate[] = [];
    let seedBase = 1000;

    for (const levelId of levels) {
      const requireEnd = LEVELS[levelId - 1]!.requireEndPiece;
      const bots = requireEnd
        ? (['greedy', 'looper', 'route'] as const)
        : (['greedy', 'looper'] as const);
      for (const bot of bots) {
        for (const reactionMs of reactions) {
          for (const easy of [false, true]) {
            const agg = runBatch({ levelId, bot, reactionMs, easy }, GAMES, seedBase);
            seedBase += GAMES * 7919;
            results.push(agg);
            // eslint-disable-next-line no-console
            console.log(
              `L${levelId} ${bot} ${reactionMs}ms easy=${easy}: win=${(agg.winRate * 100).toFixed(1)}% score=${agg.avgScore.toFixed(0)} pipes=${agg.avgPipes.toFixed(1)} crosses=${agg.avgCrosses.toFixed(2)} end=${(agg.endRate * 100).toFixed(0)}%`,
            );
          }
        }
      }
    }
    writeFileSync('sim/results.json', JSON.stringify(results, null, 2));
  });
});
