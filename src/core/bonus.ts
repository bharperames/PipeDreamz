import { FlowSim } from './flow';
import { Grid } from './grid';
import { Rng } from './rng';
import { GridPos, LevelDef, PLACEABLE_KINDS, posEq } from './types';

export const BONUS_TIMER_MS = 45000;
export const BONUS_POINTS_PER_PIPE = 100;
export const BONUS_FILL_MS = 300;

export type BonusPhase = 'arrange' | 'flow' | 'done';

export type BonusEvent =
  | { type: 'slid'; from: GridPos; to: GridPos }
  | { type: 'flowStarted' }
  | { type: 'segmentFilled'; pos: GridPos; channelIdx: number; points: number }
  | { type: 'bonusOver'; score: number; pipesFilled: number };

/**
 * Bonus round: a 15-puzzle variant. The board starts full of pipe pieces
 * with one empty cell; slide pieces around to build a pipeline before the
 * timer runs out, then the flooz drains through whatever is connected.
 * 100 points per pipe filled; no penalties; cannot be lost.
 */
export class BonusRound {
  phase: BonusPhase = 'arrange';
  timerMs = BONUS_TIMER_MS;
  grid: Grid;
  hole: GridPos;
  score = 0;
  pipesFilled = 0;
  flow: FlowSim | null = null;
  readonly level: LevelDef;

  constructor(rng: Rng, gridW = 10, gridH = 7) {
    this.level = {
      id: 0,
      gridW,
      gridH,
      delayMs: 1,
      fillMs: BONUS_FILL_MS,
      distance: 1,
      requireEndPiece: false,
      start: { pos: { x: 0, y: Math.floor(gridH / 2) }, exit: 1 },
      fixed: [],
      wraps: [],
      musicTrack: 0,
    };
    this.grid = new Grid(gridW, gridH);
    this.grid.set(this.level.start.pos, this.grid.makePiece('START', null, true, 0));
    // Hole somewhere on the right half so the start area is never empty.
    this.hole = { x: gridW - 1 - rng.int(3), y: rng.int(gridH) };
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const pos = { x, y };
        if (posEq(pos, this.level.start.pos) || posEq(pos, this.hole)) continue;
        const kind = PLACEABLE_KINDS[rng.int(PLACEABLE_KINDS.length)]!;
        this.grid.set(pos, this.grid.makePiece(kind, 0, false, 0));
      }
    }
  }

  /** Slide the piece at `from` into the hole (must be orthogonally adjacent). */
  slide(from: GridPos): BonusEvent[] {
    if (this.phase !== 'arrange') return [];
    const piece = this.grid.get(from);
    if (!piece || piece.fixed) return [];
    const adjacent =
      Math.abs(from.x - this.hole.x) + Math.abs(from.y - this.hole.y) === 1;
    if (!adjacent) return [];
    const to = this.hole;
    this.grid.set(to, piece);
    this.grid.set(from, null);
    this.hole = from;
    return [{ type: 'slid', from, to }];
  }

  /** Player presses flow key: skip the rest of the arrange timer. */
  startFlow(): void {
    if (this.phase === 'arrange') this.timerMs = 0;
  }

  tick(dtMs: number): BonusEvent[] {
    const events: BonusEvent[] = [];
    if (this.phase === 'done') return events;

    if (this.phase === 'arrange') {
      this.timerMs -= dtMs;
      if (this.timerMs > 0) return events;
      this.phase = 'flow';
      this.flow = new FlowSim(this.level, this.grid);
      dtMs = -this.timerMs; // carry leftover time into the flow
      this.timerMs = 0;
    }

    for (const fe of this.flow!.tick(dtMs)) {
      if (fe.type === 'flowStarted') events.push({ type: 'flowStarted' });
      if (fe.type === 'filled' && fe.countsAsPipe) {
        this.pipesFilled++;
        this.score += BONUS_POINTS_PER_PIPE;
        events.push({
          type: 'segmentFilled',
          pos: fe.pos,
          channelIdx: fe.channelIdx,
          points: BONUS_POINTS_PER_PIPE,
        });
      }
      if (fe.type === 'spill' || fe.type === 'endReached') {
        this.phase = 'done';
        events.push({ type: 'bonusOver', score: this.score, pipesFilled: this.pipesFilled });
      }
    }
    return events;
  }
}
