import { FlowSim, FlowTickEvent } from './flow';
import { Grid } from './grid';
import { channelExit, findChannel } from './pieces';
import { BiasProvider, DEFAULT_WEIGHTS, DispenserQueue } from './queue';
import { Rng } from './rng';
import { fillPoints, SCORE } from './scoring';
import {
  Dir,
  GameAction,
  GameEvent,
  GameMode,
  GridPos,
  LevelDef,
  opposite,
  PieceWeights,
  PLACEABLE_KINDS,
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
  /**
   * Easy mode: the dispenser is biased toward pieces that extend the
   * current pipeline (the round solves the path to its first gap and
   * boosts pieces that fit there).
   */
  easyQueue?: boolean;
  /** Override the basic-mode dispenser depth (default 5; easy 3). */
  queueDepth?: number;
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
  /** Live-togglable: biases future dispenser rolls when true. */
  easyQueue = false;

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

    this.easyQueue = config.easyQueue ?? false;
    const bias: BiasProvider = () => (this.easyQueue ? this.neededWeights() : null);
    // Depth 5 everywhere: A/B simulation showed the visible queue is
    // LOOKAHEAD, not just delay — cutting easy mode to depth 3 lowered
    // route-building wins 3.5x and chain wins by ~10 points.
    const basicDepth = config.queueDepth ?? 5;
    this.queues =
      config.mode === 'expert'
        ? [
            new DispenserQueue(rng, 3, this.level.pieceWeights, bias),
            new DispenserQueue(rng, 3, this.level.pieceWeights, bias),
          ]
        : [new DispenserQueue(rng, basicDepth, this.level.pieceWeights, bias)];

    this.flow = new FlowSim(this.level, this.grid);
  }

  /**
   * Easy-mode solver: follow the pipeline from the flow head (or the
   * start piece before flow begins) through placed pieces to the first
   * gap, and boost the pieces that would fit that gap — strongest for
   * pieces whose exit also leads somewhere useful.
   */
  private neededWeights(): PieceWeights | null {
    let pos: GridPos;
    let exit: Dir;
    const head = this.flow?.head;
    if (head && this.flow.state === 'flowing') {
      const piece = this.grid.get(head.pos)!;
      pos = head.pos;
      exit =
        piece.kind === 'START'
          ? this.level.start.exit
          : channelExit(piece.kind, head.channelIdx, head.entryDir);
    } else {
      pos = this.level.start.pos;
      exit = this.level.start.exit;
    }

    const seen = new Set<string>();
    for (let i = 0; i < this.level.gridW * this.level.gridH * 2; i++) {
      const step = this.grid.neighbor(pos, exit);
      if (!step) return null; // heading off the board: no piece helps
      const piece = this.grid.get(step.pos);
      if (!piece) return this.weightsForGap(step.pos, opposite(exit));
      if (piece.kind === 'OBSTACLE' || piece.kind === 'START') return null;
      if (piece.kind === 'END') return null; // pipeline already complete
      const entry = opposite(exit);
      const ch = findChannel(piece.kind, entry);
      if (ch === null || piece.channels[ch]!.filled) return null;
      const key = `${step.pos.x},${step.pos.y}:${ch}`;
      if (seen.has(key)) return null;
      seen.add(key);
      exit = channelExit(piece.kind, ch, entry);
      pos = step.pos;
    }
    return null;
  }

  /**
   * Weights for the gap the flow is heading toward:
   *  - non-fitting pieces are starved (0.4);
   *  - fitting pieces are boosted (4), more if their exit stays open (8),
   *    most if the exit CONNECTS into an already-placed unfilled pipe or
   *    the end tank near the action (16) — the piece the player is
   *    usually wishing for;
   *  - kinds the player has "discarded" (placed unfilled 3+ tiles from
   *    the flow front) are damped, as are kinds already sitting in the
   *    queue, to cut duplicate spam.
   */
  private weightsForGap(pos: GridPos, entry: Dir): PieceWeights {
    const weights: PieceWeights = { ...DEFAULT_WEIGHTS };
    for (const kind of PLACEABLE_KINDS) weights[kind] = 0.4;

    for (const kind of PLACEABLE_KINDS) {
      const ch = findChannel(kind, entry);
      if (ch === null) continue;
      let w = 4;
      const exitDir = channelExit(kind, ch, entry);
      const next = this.grid.neighbor(pos, exitDir);
      if (next) {
        const target = this.grid.get(next.pos);
        if (!target) {
          w = 8;
        } else if (target.kind === 'END') {
          w = 16;
        } else if (
          !target.fixed &&
          findChannel(target.kind, opposite(exitDir)) !== null &&
          !target.channels.every((c) => c.filled)
        ) {
          // Exit links the flow into the player's built network.
          w = 16;
        }
      }
      weights[kind] = w;
    }

    // Discard penalty: unfilled player pieces far from the flow front
    // signal kinds the player didn't want — deal fewer of them.
    const front = this.flow?.head?.pos ?? this.level.start.pos;
    this.grid.forEach((piece, p) => {
      if (piece.owner === null) return;
      if (piece.channels.some((c) => c.filled)) return;
      const kind = piece.kind as keyof PieceWeights;
      if (!(kind in weights)) return;
      const dist = Math.abs(p.x - front.x) + Math.abs(p.y - front.y);
      if (dist >= 3) weights[kind] = Math.max(0.15, weights[kind] * 0.6);
    });

    // Duplicate damping: each copy already visible in the queue makes
    // the next roll of that kind less likely. A/B simulation validated
    // per-copy damping: it approximates drawing without replacement,
    // and the added VARIETY helps both chain play and route building
    // (exempting the first copy measurably lowered win rates).
    for (const q of this.queues ?? []) {
      for (const kind of q.peek()) {
        weights[kind] = Math.max(0.15, weights[kind] * 0.65);
      }
    }

    return weights;
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
