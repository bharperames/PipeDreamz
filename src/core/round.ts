import { FlowSim, FlowTickEvent } from './flow';
import { Grid } from './grid';
import { DispenserQueue } from './queue';
import { Rng } from './rng';
import { fillPoints, SCORE } from './scoring';
import {
  GameAction,
  GameEvent,
  GameMode,
  GridPos,
  LevelDef,
  PlacedPiece,
  PlayerId,
  RoundResult,
} from './types';

/** Delay before a bombed-in replacement piece becomes flow-connectable. */
export const PLACE_DELAY_MS = 350;
/** Minimum age of a piece before it may be replaced. */
export const REPLACE_LOCKOUT_MS = 500;

export interface GameRoundConfig {
  level: LevelDef;
  mode: GameMode;
  seed: number;
  players: 1 | 2;
  /** Training mode: multiplies delay and fill durations (e.g. 1.75). */
  timeScale?: number;
}

interface PieceMeta {
  dispenser: 0 | 1;
}

export class GameRound {
  readonly level: LevelDef;
  readonly mode: GameMode;
  readonly grid: Grid;
  readonly queues: DispenserQueue[];
  readonly flow: FlowSim;
  scores: [number, number] = [0, 0];
  distanceMet = false;
  reachedEnd = false;
  over = false;
  result: RoundResult | null = null;

  private meta = new Map<PlacedPiece, PieceMeta>();
  private lastFilledDispenser: 0 | 1 | null = null;

  constructor(config: GameRoundConfig, rng: Rng) {
    const scale = config.timeScale ?? 1;
    this.level = {
      ...config.level,
      delayMs: Math.round(config.level.delayMs * scale),
      fillMs: Math.round(config.level.fillMs * scale),
    };
    this.mode = config.mode;
    this.grid = new Grid(this.level.gridW, this.level.gridH, this.level.wraps);

    // Pre-place level pieces.
    this.grid.set(
      this.level.start.pos,
      this.grid.makePiece('START', null, true, 0),
    );
    for (const f of this.level.fixed) {
      this.grid.set(f.pos, this.grid.makePiece(f.kind, null, true, 0));
    }

    this.queues =
      config.mode === 'expert'
        ? [
            new DispenserQueue(rng, 3, this.level.pieceWeights),
            new DispenserQueue(rng, 3, this.level.pieceWeights),
          ]
        : [new DispenserQueue(rng, 5, this.level.pieceWeights)];

    this.flow = new FlowSim(this.level, this.grid);
  }

  apply(action: GameAction): GameEvent[] {
    if (this.over) return [];
    switch (action.type) {
      case 'place':
        return this.place(action.player, action.pos, action.dispenser ?? 0);
      case 'fastForward':
        this.flow.requestFastForward();
        return [];
      case 'moveCursor':
        return []; // cursors are presentation-side
    }
  }

  private place(player: PlayerId, pos: GridPos, dispenser: 0 | 1): GameEvent[] {
    if (!this.grid.inBounds(pos)) return [];
    const q = this.queues[this.mode === 'expert' ? dispenser : 0];
    if (!q) return [];

    const existing = this.grid.get(pos);
    let wasReplacement = false;
    if (existing) {
      if (existing.fixed) return [];
      if (existing.channels.some((c) => c.filled)) return [];
      // Cannot bomb the piece the flooz is currently filling.
      const head = this.flow.head;
      if (head && head.pos.x === pos.x && head.pos.y === pos.y) return [];
      if (this.flow.nowMs - existing.placedAtMs < REPLACE_LOCKOUT_MS) return [];
      wasReplacement = true;
      this.scores[player] += SCORE.replacePenalty;
      this.meta.delete(existing);
    }

    const kind = q.take();
    const piece = this.grid.makePiece(
      kind,
      player,
      false,
      this.flow.nowMs,
      wasReplacement ? this.flow.nowMs + PLACE_DELAY_MS : this.flow.nowMs,
    );
    this.grid.set(pos, piece);
    this.meta.set(piece, { dispenser });

    return [{ type: 'piecePlaced', pos, kind, player, wasReplacement }];
  }

  tick(dtMs: number): GameEvent[] {
    if (this.over) return [];
    const events: GameEvent[] = [];
    for (const fe of this.flow.tick(dtMs)) this.handleFlowEvent(fe, events);
    return events;
  }

  private handleFlowEvent(fe: FlowTickEvent, events: GameEvent[]): void {
    switch (fe.type) {
      case 'flowStarted':
        events.push({ type: 'flowStarted' });
        break;
      case 'filled': {
        const piece = this.grid.get(fe.pos)!;
        let points = 0;
        if (fe.pieceClass === 'end') {
          points = SCORE.endPiece;
          this.reachedEnd = true;
        } else if (fe.pieceClass !== 'start') {
          const expertAlternated =
            this.mode === 'expert' && this.isAlternated(piece);
          points = fillPoints({
            kind: fe.pieceClass,
            distanceMet: this.distanceMet,
            fastForward: this.flow.fastForward,
            expertAlternated,
          });
        }
        const owner = piece.owner;
        if (owner !== null) this.scores[owner] += points;
        else if (points) this.creditFixed(points);
        events.push({
          type: 'segmentFilled',
          pos: fe.pos,
          channelIdx: fe.channelIdx,
          points,
          player: owner,
          pipesFilled: this.flow.pipesFilled,
        });
        if (fe.selfCross) {
          const p = SCORE.cross;
          if (owner !== null) this.scores[owner] += p;
          else this.creditFixed(p);
          events.push({ type: 'crossCompleted', pos: fe.pos, points: p });
        }
        if (fe.pieceClass === 'end') {
          events.push({ type: 'endReached', pos: fe.pos, points: SCORE.endPiece });
        }
        if (!this.distanceMet && this.flow.pipesFilled >= this.level.distance) {
          this.distanceMet = true;
          events.push({ type: 'distanceMet' });
        }
        this.trackDispenser(piece);
        break;
      }
      case 'endReached':
        this.finish(events);
        break;
      case 'spill':
        events.push({ type: 'spill', pos: fe.pos, dir: fe.dir });
        this.finish(events);
        break;
    }
  }

  private players2(): boolean {
    return this.mode === 'competitive';
  }

  /** Points from fixed pieces (end, bonus, reservoir) go to player 0 in 1P;
   *  in competitive mode they are split evenly. */
  private creditFixed(points: number): void {
    if (!this.players2()) {
      this.scores[0] += points;
      return;
    }
    this.scores[0] += points / 2;
    this.scores[1] += points / 2;
  }

  private isAlternated(piece: PlacedPiece): boolean {
    const m = this.meta.get(piece);
    if (!m) return false;
    const alternated =
      this.lastFilledDispenser !== null && this.lastFilledDispenser !== m.dispenser;
    return alternated;
  }

  private trackDispenser(piece: PlacedPiece): void {
    const m = this.meta.get(piece);
    if (m) this.lastFilledDispenser = m.dispenser;
  }

  private finish(events: GameEvent[]): void {
    this.over = true;
    // End-of-round penalty: every placed-but-unfilled player piece.
    let unusedCount = 0;
    this.grid.forEach((piece) => {
      if (piece.owner === null) return;
      if (piece.channels.some((c) => c.filled)) return;
      unusedCount++;
      this.scores[piece.owner] += SCORE.unusedPipePenalty;
    });

    const won =
      this.flow.pipesFilled >= this.level.distance &&
      (!this.level.requireEndPiece || this.reachedEnd);

    this.result = {
      won,
      pipesFilled: this.flow.pipesFilled,
      distance: this.level.distance,
      scores: [...this.scores] as [number, number],
      unusedPenalty: unusedCount * SCORE.unusedPipePenalty,
      unusedCount,
      reachedEnd: this.reachedEnd,
    };
    events.push({ type: 'roundOver', result: this.result });
  }
}
