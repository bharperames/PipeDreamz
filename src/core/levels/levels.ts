import { Dir, LevelDef, PieceKind, WrapOpening } from '../types';
import { delayMs, distance, fillMs } from './curve';

/**
 * 36 original level layouts (10x7 grid) in the spirit of the 1989 game.
 * Feature introduction: obstacles L3+, one-ways L9+, wrap-around L13+,
 * reservoirs L17+, required end pieces L21+, bonus pieces L25+.
 */

interface Spec {
  start: [number, number, Dir];
  obstacles?: Array<[number, number]>;
  oneways?: Array<[number, number, Dir]>;
  reservoirs?: Array<[number, number, 'H' | 'V']>;
  bonuses?: Array<[number, number]>;
  /** [x, y, required] */
  end?: [number, number, boolean];
  /** Horizontal wrap openings on both sides of these rows. */
  wrapRows?: number[];
  /** Vertical wrap openings on top/bottom of these columns. */
  wrapCols?: number[];
}

const W = 10;
const H = 7;

const ONEWAY_BY_DIR: Record<Dir, PieceKind> = {
  0: 'ONEWAY_N',
  1: 'ONEWAY_E',
  2: 'ONEWAY_S',
  3: 'ONEWAY_W',
};

function build(id: number, spec: Spec): LevelDef {
  const fixed: LevelDef['fixed'] = [];
  for (const [x, y] of spec.obstacles ?? []) fixed.push({ pos: { x, y }, kind: 'OBSTACLE' });
  for (const [x, y, d] of spec.oneways ?? [])
    fixed.push({ pos: { x, y }, kind: ONEWAY_BY_DIR[d] });
  for (const [x, y, axis] of spec.reservoirs ?? [])
    fixed.push({ pos: { x, y }, kind: axis === 'H' ? 'RESERVOIR_H' : 'RESERVOIR_V' });
  for (const [x, y] of spec.bonuses ?? []) fixed.push({ pos: { x, y }, kind: 'BONUS' });
  if (spec.end) fixed.push({ pos: { x: spec.end[0], y: spec.end[1] }, kind: 'END' });

  const wraps: WrapOpening[] = [];
  for (const y of spec.wrapRows ?? []) {
    wraps.push({ x: 0, y, side: 3 }, { x: W - 1, y, side: 1 });
  }
  for (const x of spec.wrapCols ?? []) {
    wraps.push({ x, y: 0, side: 0 }, { x, y: H - 1, side: 2 });
  }

  return {
    id,
    gridW: W,
    gridH: H,
    delayMs: delayMs(id),
    fillMs: fillMs(id),
    distance: distance(id),
    requireEndPiece: spec.end?.[2] ?? false,
    start: { pos: { x: spec.start[0], y: spec.start[1] }, exit: spec.start[2] },
    fixed,
    wraps,
    musicTrack: Math.min(3, Math.floor((id - 1) / 9)),
  };
}

const E: Dir = 1;
const S: Dir = 2;
const N: Dir = 0;
const Wd: Dir = 3;

const SPECS: Spec[] = [
  /* 1 */ { start: [1, 3, E] },
  /* 2 */ { start: [2, 1, S] },
  /* 3 */ { start: [1, 2, E], obstacles: [[4, 3]] },
  /* 4 */ { start: [7, 5, Wd], obstacles: [[3, 2], [6, 4]] },
  /* 5 */ { start: [1, 1, S], obstacles: [[2, 1], [5, 3], [7, 5]] },
  /* 6 */ { start: [8, 1, S], obstacles: [[3, 2], [6, 4], [4, 3]] },
  /* 7 */ { start: [1, 5, E], obstacles: [[3, 3], [4, 3], [5, 3]] },
  /* 8 */ { start: [4, 0, S], obstacles: [[1, 4], [3, 1], [6, 3], [8, 5]] },
  /* 9 */ { start: [1, 3, E], obstacles: [[4, 3]], oneways: [[5, 3, E]] },
  /* 10 */ { start: [2, 5, N], obstacles: [[2, 1], [5, 3], [7, 5]], oneways: [[4, 2, N]] },
  /* 11 */ { start: [7, 1, S], obstacles: [[3, 2], [6, 4]], oneways: [[3, 3, Wd], [6, 5, S]] },
  /* 12 */ { start: [1, 1, E], obstacles: [[3, 3], [4, 3], [5, 3]], oneways: [[4, 1, E], [4, 5, E]] },
  /* 13 */ { start: [1, 3, E], obstacles: [[4, 3]], wrapRows: [3] },
  /* 14 */ { start: [4, 1, S], obstacles: [[3, 2], [6, 4]], wrapCols: [4] },
  /* 15 */ { start: [2, 2, E], oneways: [[6, 1, E]], wrapRows: [1, 5] },
  /* 16 */ { start: [8, 1, Wd], obstacles: [[2, 1], [5, 3], [7, 5]], oneways: [[2, 3, Wd]], wrapRows: [3] },
  /* 17 */ { start: [1, 3, E], obstacles: [[4, 3]], reservoirs: [[6, 3, 'H']] },
  /* 18 */ { start: [2, 1, S], obstacles: [[3, 2], [6, 4]], reservoirs: [[2, 4, 'V'], [7, 2, 'H']] },
  /* 19 */ { start: [1, 5, E], reservoirs: [[5, 5, 'H']], oneways: [[7, 3, N]], wrapRows: [0] },
  /* 20 */ { start: [8, 1, Wd], obstacles: [[3, 3], [4, 3], [5, 3]], reservoirs: [[4, 1, 'H'], [4, 5, 'H']] },
  /* 21 */ { start: [1, 3, E], obstacles: [[4, 3]], end: [8, 3, true] },
  /* 22 */ { start: [1, 1, S], obstacles: [[2, 1], [5, 3], [7, 5]], end: [8, 5, true] },
  /* 23 */ { start: [4, 6, N], oneways: [[4, 3, N]], end: [5, 0, true] },
  /* 24 */ { start: [1, 5, E], obstacles: [[3, 2], [6, 4]], reservoirs: [[5, 3, 'V']], end: [8, 1, true] },
  /* 25 */ { start: [1, 3, E], obstacles: [[2, 1], [5, 3], [7, 5]], bonuses: [[6, 3]] },
  /* 26 */ { start: [2, 1, S], obstacles: [[4, 3]], bonuses: [[5, 4]], reservoirs: [[7, 2, 'H']] },
  /* 27 */ { start: [8, 3, Wd], bonuses: [[3, 3], [6, 1]], oneways: [[5, 5, Wd]] },
  /* 28 */ { start: [1, 1, E], obstacles: [[3, 2], [6, 4]], bonuses: [[4, 4]], end: [8, 5, true] },
  /* 29 */ { start: [1, 3, E], obstacles: [[4, 3]], reservoirs: [[6, 1, 'H']], oneways: [[6, 3, E]], wrapRows: [3] },
  /* 30 */ { start: [4, 0, S], obstacles: [[2, 1], [5, 3], [7, 5]], bonuses: [[5, 2]], wrapCols: [2, 7] },
  /* 31 */ { start: [1, 5, E], obstacles: [[3, 2], [6, 4]], oneways: [[6, 3, N]], end: [8, 0, true], wrapRows: [2] },
  /* 32 */ { start: [8, 1, Wd], obstacles: [[1, 4], [3, 1], [6, 3], [8, 5]], reservoirs: [[3, 2, 'H'], [6, 4, 'V']], bonuses: [[2, 4]] },
  /* 33 */ { start: [1, 1, S], obstacles: [[4, 3]], reservoirs: [[4, 5, 'H']], oneways: [[6, 2, S]], end: [8, 3, true], wrapRows: [6] },
  /* 34 */ { start: [1, 2, E], obstacles: [[3, 3], [4, 3], [5, 3]], bonuses: [[5, 1], [5, 5]], oneways: [[7, 3, Wd]] },
  /* 35 */ { start: [1, 0, S], obstacles: [[2, 1], [5, 3], [7, 5]], reservoirs: [[5, 2, 'V']], end: [8, 6, true], wrapRows: [3] },
  /* 36 */ {
    start: [1, 3, E],
    obstacles: [[3, 3], [7, 1], [7, 5]],
    reservoirs: [[4, 1, 'H'], [4, 5, 'H']],
    oneways: [[6, 3, E]],
    bonuses: [[2, 1]],
    end: [8, 3, true],
    wrapRows: [0, 6],
  },
];

export const LEVELS: LevelDef[] = SPECS.map((s, i) => build(i + 1, s));
