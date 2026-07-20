import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBatch } from './harness';

/**
 * Depth A/B (RUN_SIM=1): does the easy-mode depth-3 queue cost win rate
 * by shrinking the player's cycling lookahead? Higher-power runs on the
 * chain levels plus the goal level.
 */
describe.runIf(process.env.RUN_SIM === '1')('queue depth experiment', () => {
  it('compares easy-mode depths 3/4/5', () => {
    const out: unknown[] = [];
    let seed = 900_000;
    for (const levelId of [1, 5, 21]) {
      const bot = levelId === 21 ? ('route' as const) : ('greedy' as const);
      for (const queueDepth of [3, 4, 5]) {
        for (const reactionMs of [200, 500]) {
          const agg = runBatch(
            { levelId, bot, reactionMs, easy: true, queueDepth },
            500,
            seed,
          );
          seed += 500 * 7919;
          out.push(agg);
          // eslint-disable-next-line no-console
          console.log(
            `L${levelId} ${bot} depth=${queueDepth} ${reactionMs}ms: win=${(agg.winRate * 100).toFixed(1)}% score=${agg.avgScore.toFixed(0)} pipes=${agg.avgPipes.toFixed(1)}`,
          );
        }
      }
    }
    writeFileSync('sim/depth_results.json', JSON.stringify(out, null, 2));
  });
});
