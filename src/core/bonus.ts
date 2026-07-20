import { FlowSim } from './flow';
import { Grid } from './grid';
import { DispenserQueue } from './queue';
import { Rng } from './rng';
import { GridPos, LevelDef, PlaceableKind } from './types';

export const BONUS_TIMER_MS = 45000;
export const BONUS_POINTS_PER_PIPE = 100;
export const BONUS_FILL_MS = 300;

export type BonusPhase = 'arrange' | 'flow' | 'done';

export type BonusEvent =
  | { type: 'dropped'; pos: GridPos; kind: PlaceableKind }
  | { type: 'flowStarted' }
  | { type: 'segmentFilled'; pos: GridPos; channelIdx: number; points: number }
  | { type: 'bonusOver'; score: number; pipesFilled: number };

/**
 * Bonus round, as the original manual describes it: pieces can only be
 * placed in the LOWEST open space of each column — "similarly to the
 * board game of Connect 4". Drop pipes from the dispenser for 45
 * seconds (or press F to start early), then the flooz pours from the
 * bottom-left tank through whatever connected. 100 points per pipe
 * filled; no penalties; cannot be lost.
 */
export class BonusRound {
  phase: BonusPhase = 'arrange';
  timerMs = BONUS_TIMER_MS;
  grid: Grid;
  queue: DispenserQueue;
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
      // Tank in the bottom-left corner, pouring upward into the stack.
      start: { pos: { x: 0, y: gridH - 1 }, exit: 0 },
      fixed: [],
      wraps: [],
      musicTrack: 0,
    };
    this.grid = new Grid(gridW, gridH);
    this.grid.set(this.level.start.pos, this.grid.makePiece('START', null, true, 0));
    this.queue = new DispenserQueue(rng, 5);
  }

  /** Where a piece dropped in `col` would land, or null if the column is full. */
  landing(col: number): GridPos | null {
    if (col < 0 || col >= this.level.gridW) return null;
    for (let y = this.level.gridH - 1; y >= 0; y--) {
      if (!this.grid.get({ x: col, y })) return { x: col, y };
    }
    return null;
  }

  /** Drop the next dispenser piece into the lowest open space of `col`. */
  drop(col: number): BonusEvent[] {
    if (this.phase !== 'arrange') return [];
    const pos = this.landing(col);
    if (!pos) return [];
    const kind = this.queue.take();
    this.grid.set(pos, this.grid.makePiece(kind, 0, false, 0));
    // A completely full board has nothing left to arrange.
    if (!Array.from({ length: this.level.gridW }, (_, c) => this.landing(c)).some(Boolean)) {
      this.timerMs = 0;
    }
    return [{ type: 'dropped', pos, kind }];
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
