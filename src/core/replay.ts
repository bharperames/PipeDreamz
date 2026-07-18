import { GameRound, GameRoundConfig } from './round';
import { mulberry32 } from './rng';
import { GameAction, GameEvent } from './types';

export const SIM_DT = 1000 / 120;

export interface TimedAction {
  /** Sim tick index at which the action is applied. */
  tick: number;
  action: GameAction;
}

export interface Replay {
  config: Omit<GameRoundConfig, 'level'> & { levelId: number };
  actions: TimedAction[];
}

/**
 * Deterministically replay a recorded action script against a round.
 * Runs until the round is over or `maxTicks` elapse.
 */
export function runReplay(
  round: GameRound,
  actions: TimedAction[],
  maxTicks = 120 * 600,
): GameEvent[] {
  const all: GameEvent[] = [];
  let next = 0;
  for (let t = 0; t < maxTicks && !round.over; t++) {
    while (next < actions.length && actions[next]!.tick <= t) {
      all.push(...round.apply(actions[next]!.action));
      next++;
    }
    all.push(...round.tick(SIM_DT));
  }
  return all;
}

export function makeRound(config: GameRoundConfig): GameRound {
  return new GameRound(config, mulberry32(config.seed));
}
