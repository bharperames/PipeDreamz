/** Cardinal directions. N=0, E=1, S=2, W=3. */
export type Dir = 0 | 1 | 2 | 3;

export const DIR = { N: 0 as Dir, E: 1 as Dir, S: 2 as Dir, W: 3 as Dir };

export function opposite(d: Dir): Dir {
  return ((d + 2) & 3) as Dir;
}

export const DIR_DELTA: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 }, // N
  { dx: 1, dy: 0 }, // E
  { dx: 0, dy: 1 }, // S
  { dx: -1, dy: 0 }, // W
];

export interface GridPos {
  x: number;
  y: number;
}

export function posEq(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Placeable pieces come from the dispenser; the rest are board-only. */
export type PlaceableKind = 'H' | 'V' | 'NE' | 'NW' | 'SE' | 'SW' | 'X';

export type PieceKind =
  | PlaceableKind
  | 'START'
  | 'END'
  | 'OBSTACLE'
  | 'ONEWAY_N'
  | 'ONEWAY_E'
  | 'ONEWAY_S'
  | 'ONEWAY_W'
  | 'RESERVOIR_H'
  | 'RESERVOIR_V'
  | 'BONUS';

export const PLACEABLE_KINDS: ReadonlyArray<PlaceableKind> = [
  'H',
  'V',
  'NE',
  'NW',
  'SE',
  'SW',
  'X',
];

export type PlayerId = 0 | 1;

export type GameMode = 'basic' | 'expert' | 'competitive';

export interface ChannelState {
  filled: boolean;
  /** Side the flooz entered from (for rendering flow direction). */
  fillEntry: Dir | null;
}

export interface PlacedPiece {
  kind: PieceKind;
  /** Player who placed it; null for pre-placed level pieces. */
  owner: PlayerId | null;
  /** True for pieces defined by the level (cannot be bombed). */
  fixed: boolean;
  channels: ChannelState[];
  /** Sim time when placed; used for the replacement lockout. */
  placedAtMs: number;
  /** Sim time until which the piece is still "materializing" (bomb delay). */
  readyAtMs: number;
}

export interface WrapOpening {
  x: number;
  y: number;
  side: Dir;
}

export interface PieceWeights {
  H: number;
  V: number;
  NE: number;
  NW: number;
  SE: number;
  SW: number;
  X: number;
}

export interface LevelDef {
  id: number;
  gridW: number;
  gridH: number;
  /** Countdown before flooz starts flowing. */
  delayMs: number;
  /** Time for flooz to traverse one normal pipe piece. */
  fillMs: number;
  /** Number of pipes flooz must pass through to advance. */
  distance: number;
  /** If true, flooz must reach the END piece to win the round. */
  requireEndPiece: boolean;
  start: { pos: GridPos; exit: Dir };
  fixed: Array<{ pos: GridPos; kind: PieceKind }>;
  wraps: WrapOpening[];
  pieceWeights?: PieceWeights;
  musicTrack: number;
}

export type GameAction =
  | { type: 'place'; player: PlayerId; pos: GridPos; dispenser?: 0 | 1 }
  | { type: 'fastForward'; player: PlayerId }
  | { type: 'moveCursor'; player: PlayerId; pos: GridPos };

export type GameEvent =
  | {
      type: 'piecePlaced';
      pos: GridPos;
      kind: PieceKind;
      player: PlayerId;
      wasReplacement: boolean;
    }
  | {
      type: 'segmentFilled';
      pos: GridPos;
      channelIdx: number;
      points: number;
      player: PlayerId | null;
      pipesFilled: number;
    }
  | { type: 'crossCompleted'; pos: GridPos; points: number }
  | { type: 'loopBonus'; pos: GridPos; points: number; crosses: number }
  | { type: 'fullBoard'; pos: GridPos; points: number }
  | { type: 'flowStarted' }
  | { type: 'distanceMet' }
  | { type: 'endReached'; pos: GridPos; points: number }
  | { type: 'spill'; pos: GridPos; dir: Dir }
  | { type: 'roundOver'; result: RoundResult };

export interface RoundResult {
  won: boolean;
  pipesFilled: number;
  distance: number;
  /** Total score delta for the round per player (includes penalties). */
  scores: [number, number];
  unusedPenalty: number;
  unusedCount: number;
  reachedEnd: boolean;
}

export interface FlowHead {
  pos: GridPos;
  entryDir: Dir;
  channelIdx: number;
}

export type FlowState = 'countdown' | 'flowing' | 'done';
