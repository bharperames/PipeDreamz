import { GameRound, GameRoundConfig } from '../src/core/round';
import { mulberry32 } from '../src/core/rng';
import { Dir, GridPos, LevelDef, PieceKind, PlayerId } from '../src/core/types';

export function makeLevel(overrides: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 1,
    gridW: 10,
    gridH: 7,
    delayMs: 50,
    fillMs: 100,
    distance: 3,
    requireEndPiece: false,
    start: { pos: { x: 1, y: 3 }, exit: 1 as Dir },
    fixed: [],
    wraps: [],
    musicTrack: 0,
    ...overrides,
  };
}

export function makeTestRound(
  level: LevelDef,
  config: Partial<GameRoundConfig> = {},
): GameRound {
  return new GameRound(
    { level, mode: 'basic', seed: 42, players: 1, ...config },
    mulberry32(config.seed ?? 42),
  );
}

/** Place a piece directly on the board, bypassing the dispenser queue. */
export function lay(
  round: GameRound,
  x: number,
  y: number,
  kind: PieceKind,
  owner: PlayerId | null = 0,
): void {
  round.grid.set({ x, y }, round.grid.makePiece(kind, owner, false, 0));
}

/** Run the round for `ms` sim-milliseconds in 1/120s steps. */
export function run(round: GameRound, ms: number) {
  const events = [];
  const dt = 1000 / 120;
  for (let t = 0; t < ms && !round.over; t += dt) {
    events.push(...round.tick(dt));
  }
  return events;
}

export function at(x: number, y: number): GridPos {
  return { x, y };
}
