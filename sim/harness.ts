import { GameRound } from '../src/core/round';
import { mulberry32 } from '../src/core/rng';
import { LEVELS } from '../src/core/levels/levels';
import { Bot, makeBot } from './bots';

/**
 * Batch game simulator: runs thousands of bot games against the real
 * deterministic core to profile win rates, scoring and mechanic tuning
 * across player reaction times, strategies, and easy-queue settings.
 */

const TICK = 1000 / 60;
const MAX_SIM_MS = 300_000;

export interface GameConfig {
  levelId: number;
  bot: 'greedy' | 'looper' | 'route';
  reactionMs: number;
  easy: boolean;
  /** Optional dispenser-depth override (experiments). */
  queueDepth?: number;
  seed: number;
}

export interface GameResult {
  won: boolean;
  score: number;
  pipes: number;
  quota: number;
  crosses: number;
  endReached: boolean;
  discards: number;
  fastUsed: boolean;
  simMs: number;
}

export function runGame(config: GameConfig): GameResult {
  const level = LEVELS[config.levelId - 1]!;
  const rng = mulberry32(config.seed);
  const round = new GameRound(
    {
      level,
      mode: 'basic',
      seed: config.seed,
      players: 1,
      easyQueue: config.easy,
      queueDepth: config.queueDepth,
    },
    mulberry32(config.seed ^ 0x9e3779b9),
  );
  const bot: Bot = makeBot(config.bot, level, round.grid, rng);

  let simMs = 0;
  let sinceDecision = 0;
  let crosses = 0;
  let fastUsed = false;
  // Human-ish jitter: ±20% of the reaction interval.
  const jitter = () => config.reactionMs * (0.8 + rng.next() * 0.4);
  let nextDecisionIn = jitter();

  while (!round.over && simMs < MAX_SIM_MS) {
    const events = round.tick(TICK);
    for (const e of events) if (e.type === 'crossCompleted') crosses++;
    simMs += TICK;
    sinceDecision += TICK;
    if (sinceDecision >= nextDecisionIn && !round.over) {
      sinceDecision = 0;
      nextDecisionIn = jitter();
      const action = bot.decide(round);
      if (action.type === 'place') {
        round.apply({ type: 'place', player: 0, pos: action.pos });
      } else if (action.type === 'fast') {
        fastUsed = true;
        round.apply({ type: 'fastForward', player: 0 });
      }
    }
  }

  const result = round.result;
  return {
    won: result?.won ?? false,
    score: round.scores[0],
    pipes: round.flow.pipesFilled,
    quota: level.distance,
    crosses,
    endReached: round.reachedEnd,
    discards: bot.discards,
    fastUsed,
    simMs,
  };
}

export interface Aggregate {
  config: Omit<GameConfig, 'seed'>;
  games: number;
  winRate: number;
  avgScore: number;
  medScore: number;
  avgPipes: number;
  avgCrosses: number;
  endRate: number;
  avgDiscards: number;
  fastRate: number;
}

export function runBatch(config: Omit<GameConfig, 'seed'>, games: number, seedBase: number): Aggregate {
  const results: GameResult[] = [];
  for (let i = 0; i < games; i++) {
    results.push(runGame({ ...config, seed: seedBase + i * 7919 }));
  }
  const avg = (f: (r: GameResult) => number) =>
    results.reduce((a, r) => a + f(r), 0) / results.length;
  const scores = results.map((r) => r.score).sort((a, b) => a - b);
  return {
    config,
    games,
    winRate: avg((r) => (r.won ? 1 : 0)),
    avgScore: avg((r) => r.score),
    medScore: scores[Math.floor(scores.length / 2)]!,
    avgPipes: avg((r) => r.pipes),
    avgCrosses: avg((r) => r.crosses),
    endRate: avg((r) => (r.endReached ? 1 : 0)),
    avgDiscards: avg((r) => r.discards),
    fastRate: avg((r) => (r.fastUsed ? 1 : 0)),
  };
}
