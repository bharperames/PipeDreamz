import { FAST_FILL_MS, FlowSim, FlowTickEvent } from './flow';
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
  PlaceableKind,
  PlacedPiece,
  PlayerId,
  RoundResult,
} from './types';

/**
 * Sticky-refresh threshold: a queue slot survives the far-queue refresh
 * if its kind still scores at least this under the current bias. Useful
 * pieces score 8/16 (down to ~3 after duplicate + discard damping);
 * non-fitting (0.4) and fit-but-doomed (1) pieces re-roll.
 */
export const STICKY_KEEP_WEIGHT = 2;

/**
 * Easy mode eases the clock as well as the queue: per-pipe fill time is
 * multiplied by this while the easy switch is on (25% slower flooz).
 * The pre-flow countdown is unchanged.
 */
export const EASY_FLOW_FACTOR = 1.25;

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
  /**
   * Easy mode: re-roll the far queue slots (index 2+) against the
   * current board after each placement, so the bias stays fresh without
   * sacrificing lookahead. Defaults on when easyQueue is on.
   */
  easyRefresh?: boolean;
}

interface PieceMeta {
  dispenser: 0 | 1;
}

/** Forward path-finder trace for the debug overlay. */
export interface PathDebugInfo {
  path: GridPos[];
  gap: { pos: GridPos; entry: Dir } | null;
  deadEnd: GridPos | null;
  suggestions: PlaceableKind[];
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
  private _easyQueue = false;

  get easyQueue(): boolean {
    return this._easyQueue;
  }

  set easyQueue(on: boolean) {
    this._easyQueue = on;
    // Easy mode also eases the clock: the flooz fills a bit slower.
    if (this.flow) this.flow.easeFactor = on ? EASY_FLOW_FACTOR : 1;
  }

  private meta = new Map<PlacedPiece, PieceMeta>();
  private lastFilledDispenser: 0 | 1 | null = null;
  private easyRefresh: boolean;
  /** Crosses the flooz has passed through BOTH channels of. */
  private crossesLooped = 0;
  private fullBoardAwarded = false;

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
    this.easyRefresh = config.easyRefresh ?? true;
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
    // Re-apply: the setter ran before the flow existed.
    this.flow.easeFactor = this._easyQueue ? EASY_FLOW_FACTOR : 1;
  }

  /**
   * What the dispenser is currently leaning toward: the top-weighted
   * kinds under the live easy-mode bias. Used by the UI to preview the
   * still-baking queue slots (a prediction, not a promise).
   */
  predictedKinds(count = 3): PlaceableKind[] {
    const biased = this.easyQueue ? this.neededWeights() : null;
    const w = biased ?? this.level.pieceWeights ?? DEFAULT_WEIGHTS;
    return [...PLACEABLE_KINDS].sort((a, b) => w[b] - w[a]).slice(0, count);
  }

  /**
   * Follow the pipeline from the flow head (or the start piece before
   * flow begins) through connected placed pieces. Returns the traversed
   * cells, the first gap (empty cell the flow is heading toward), or
   * the dead-end cell where the pipeline is doomed to spill.
   */
  private walkPipeline(): {
    path: GridPos[];
    gap: { pos: GridPos; entry: Dir } | null;
    deadEnd: GridPos | null;
  } {
    let pos: GridPos;
    let exit: Dir;
    const head = this.flow?.head;
    if (head && this.flow.state === 'flowing') {
      const piece = this.grid.get(head.pos)!;
      if (piece.kind === 'END') return { path: [head.pos], gap: null, deadEnd: null };
      pos = head.pos;
      exit =
        piece.kind === 'START'
          ? this.level.start.exit
          : channelExit(piece.kind, head.channelIdx, head.entryDir);
    } else {
      pos = this.level.start.pos;
      exit = this.level.start.exit;
    }

    const path: GridPos[] = [pos];
    const seen = new Set<string>();
    for (let i = 0; i < this.level.gridW * this.level.gridH * 2; i++) {
      const step = this.grid.neighbor(pos, exit);
      if (!step) return { path, gap: null, deadEnd: pos }; // spills off-board
      const piece = this.grid.get(step.pos);
      if (!piece) {
        return { path, gap: { pos: step.pos, entry: opposite(exit) }, deadEnd: null };
      }
      if (piece.kind === 'OBSTACLE' || piece.kind === 'START') {
        return { path, gap: null, deadEnd: step.pos };
      }
      if (piece.kind === 'END') {
        path.push(step.pos);
        return { path, gap: null, deadEnd: null }; // pipeline complete
      }
      const entry = opposite(exit);
      const ch = findChannel(piece.kind, entry);
      if (ch === null || piece.channels[ch]!.filled) {
        return { path, gap: null, deadEnd: step.pos };
      }
      const key = `${step.pos.x},${step.pos.y}:${ch}`;
      if (seen.has(key)) return { path, gap: null, deadEnd: null };
      seen.add(key);
      exit = channelExit(piece.kind, ch, entry);
      pos = step.pos;
      path.push(pos);
    }
    return { path, gap: null, deadEnd: null };
  }

  /**
   * Easy-mode solver: boost the pieces that fit the pipeline's first
   * gap — strongest for pieces whose exit also leads somewhere useful.
   */
  private neededWeights(): PieceWeights | null {
    const walk = this.walkPipeline();
    if (!walk.gap) return null;
    return this.weightsForGap(walk.gap.pos, walk.gap.entry);
  }

  /**
   * Plumber excitement: 0 (placid calm) .. 5 (freaking out), 6 =
   * defeated (round lost). Driven by how close the flooz is to
   * spilling — time left before it reaches the pipeline's first gap or
   * dead end — adjusted by how likely the player is to escape: a
   * rescue piece already in the queue calms him, a doomed pipeline or
   * a nearly-full board (few routing options) worries him further.
   * Once the quota is met and nothing more is required, he relaxes for
   * good. Thresholds are deliberately generous so frantic poses are
   * reserved for genuinely imminent spills.
   */
  panicLevel(): number {
    if (this.over) return this.result?.won ? 0 : 6;

    const walk = this.walkPipeline();
    const fill = this.level.fillMs * this.flow.easeFactor;
    // Guaranteed-safe time: pipes already connected ahead of the head,
    // plus the rest of the current segment (or the pre-flow countdown).
    // Under fast-forward the future pipes drain at the fast rate too.
    const perPipe = this.flow.fastForward ? Math.min(fill, FAST_FILL_MS) : fill;
    let msLeft = Math.max(0, walk.path.length - 1) * perPipe;
    if (this.flow.state === 'countdown') {
      msLeft += Math.max(0, this.flow.countdownMs);
    } else {
      msLeft += (1 - this.flow.segmentProgress()) * this.flow.segmentDurationMs();
    }

    let level: number;
    if (msLeft > 18000) level = 0;
    else if (msLeft > 12000) level = 1;
    else if (msLeft > 7500) level = 2;
    else if (msLeft > 4500) level = 3;
    else if (msLeft > 2000) level = 4;
    else level = 5;
    // Once the flooz is moving he is never fully placid — the frantic
    // tiers stay reserved for imminent spills, but the mid-range
    // engages: safety is temporary, the flooz keeps coming.
    if (this.flow.state === 'flowing') level = Math.max(level, 1);

    // Escape odds.
    if (walk.deadEnd) {
      level += 1; // nothing fits — only a bomb can save this
    } else if (walk.gap) {
      const gap = walk.gap;
      const fitsAt = this.queues.flatMap((q) =>
        q.peek().map((k) => findChannel(k, gap.entry) !== null),
      );
      if (fitsAt.slice(0, 2).some(Boolean)) {
        level -= 1; // the rescue piece is already in hand
      } else if (!fitsAt.some(Boolean)) {
        level += 1; // nothing visible in the queue fits the gap
      }
    }
    let used = 0;
    this.grid.forEach(() => used++);
    if (used / (this.level.gridW * this.level.gridH) > 0.8) level += 1; // nearly full board

    // The pipeline already runs into the END tank: the flooz closing
    // in is triumph, not danger — anticipation, never hysteria.
    const last = walk.path[walk.path.length - 1];
    const endsAtEnd =
      !walk.gap && !walk.deadEnd && last !== undefined && this.grid.get(last)?.kind === 'END';
    if (endsAtEnd && this.distanceMet) level = Math.min(level, 2);

    // Quota met and nothing more required: the win is assured, so he
    // relaxes a tier and never goes frantic — but he still tracks the
    // flooz racing toward the end of the line. If the player is
    // fast-forwarding a won round, he's just cashing in: nearly calm.
    if (this.distanceMet && (!this.level.requireEndPiece || this.reachedEnd)) {
      level = Math.min(level - 1, 3);
      if (this.flow.fastForward) level = Math.min(level, 1);
    }

    return Math.max(0, Math.min(5, level));
  }

  /**
   * Debug view of the forward path finder: the traced pipeline, the gap
   * or dead-end it terminates at, and the pieces the solver believes
   * would prevent failure (best first).
   */
  debugPath(): PathDebugInfo {
    const walk = this.walkPipeline();
    let suggestions: PlaceableKind[] = [];
    if (walk.gap) {
      const gap = walk.gap;
      const weights = this.weightsForGap(gap.pos, gap.entry);
      suggestions = PLACEABLE_KINDS.filter((k) => findChannel(k, gap.entry) !== null)
        .sort((a, b) => weights[b] - weights[a])
        .slice(0, 3);
    }
    return { ...walk, suggestions };
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
      // Fits the gap, but where does its exit lead? A piece whose exit
      // runs off the board (or into an obstacle / mismatched / filled
      // pipe) guarantees a spill one step later — near borders the
      // dispenser must favor pieces that turn away from the edge.
      let w = 1; // dead end
      const exitDir = channelExit(kind, ch, entry);
      const next = this.grid.neighbor(pos, exitDir);
      if (next) {
        const target = this.grid.get(next.pos);
        if (!target) {
          w = 8; // open continuation
        } else if (target.kind === 'END') {
          w = 16; // straight into the goal tank
        } else {
          const ch2 = findChannel(target.kind, opposite(exitDir));
          if (ch2 !== null && !target.channels[ch2]!.filled) {
            // Exit links the flow into the player's built network.
            w = 16;
          }
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

    // Easy mode: the far queue re-decides against the board as it is
    // NOW (including the piece just placed); near slots stay stable.
    // The refresh is STICKY: a slot whose piece still helps the current
    // gap is kept, never re-rolled away — otherwise each placement
    // could thrash a still-needed piece out of the far queue while
    // chasing the next need.
    if (this.easyQueue && this.easyRefresh) {
      const w = this.neededWeights();
      q.refreshTail(2, w ? (k) => w[k] >= STICKY_KEEP_WEIGHT : undefined);
    }

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
          // Original feat: looping through both sides of 5 crosses.
          this.crossesLooped++;
          if (this.crossesLooped === 5) {
            const lp = SCORE.crossLoop;
            if (owner !== null) this.scores[owner] += lp;
            else this.creditFixed(lp);
            events.push({ type: 'loopBonus', pos: fe.pos, points: lp, crosses: 5 });
          }
        }
        if (fe.pieceClass === 'end') {
          events.push({ type: 'endReached', pos: fe.pos, points: SCORE.endPiece });
        }
        if (!this.distanceMet && this.flow.pipesFilled >= this.level.distance) {
          this.distanceMet = true;
          events.push({ type: 'distanceMet' });
        }
        // Original feat: flooz through every square (obstacles excepted).
        if (!this.fullBoardAwarded && this.isBoardSwept()) {
          this.fullBoardAwarded = true;
          const bp = SCORE.fullBoard;
          this.creditFixed(bp);
          events.push({
            type: 'fullBoard',
            pos: { x: Math.floor(this.level.gridW / 2), y: Math.floor(this.level.gridH / 2) },
            points: bp,
          });
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

  /** Every square (obstacles excepted) holds a pipe the flooz has filled. */
  private isBoardSwept(): boolean {
    for (let y = 0; y < this.level.gridH; y++) {
      for (let x = 0; x < this.level.gridW; x++) {
        const piece = this.grid.get({ x, y });
        if (!piece) return false;
        if (piece.kind === 'OBSTACLE') continue;
        if (!piece.channels.some((c) => c.filled)) return false;
      }
    }
    return true;
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
