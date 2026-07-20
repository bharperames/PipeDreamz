import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBatch } from './harness';

/**
 * Fresh-bias A/B (RUN_SIM=1): does re-rolling the far queue against the
 * current board (stable near slots, reactive far slots) beat both a
 * static depth-5 queue and the fresher-but-shallow depth-3 queue?
 */
describe.runIf(process.env.RUN_SIM === '1')('easy-queue refresh experiment', () => {
  it('compares depth3 / depth5-static / depth5-refresh', () => {
    const out: unknown[] = [];
    let seed = 5_000_000;
    const variants: Array<{ label: string; queueDepth: number; easyRefresh: boolean }> = [
      { label: 'depth3-static', queueDepth: 3, easyRefresh: false },
      { label: 'depth5-static', queueDepth: 5, easyRefresh: false },
      { label: 'depth5-refresh', queueDepth: 5, easyRefresh: true },
      { label: 'depth3-refresh', queueDepth: 3, easyRefresh: true },
    ];
    for (const levelId of [1, 5, 21, 24]) {
      const bot = levelId >= 21 ? ('route' as const) : ('greedy' as const);
      for (const v of variants) {
        for (const reactionMs of [200, 500]) {
          const agg = runBatch(
            {
              levelId,
              bot,
              reactionMs,
              easy: true,
              queueDepth: v.queueDepth,
              easyRefresh: v.easyRefresh,
            },
            500,
            seed,
          );
          seed += 500 * 7919;
          out.push({ label: v.label, ...agg });
          // eslint-disable-next-line no-console
          console.log(
            `L${levelId} ${bot} ${v.label} ${reactionMs}ms: win=${(agg.winRate * 100).toFixed(1)}% score=${agg.avgScore.toFixed(0)} pipes=${agg.avgPipes.toFixed(1)}`,
          );
        }
      }
    }
    writeFileSync('sim/refresh_results.json', JSON.stringify(out, null, 2));
  });
});
