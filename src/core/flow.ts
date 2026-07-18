import { Grid } from './grid';
import { channelExit, findChannel, isReservoir } from './pieces';
import { Dir, FlowHead, FlowState, GridPos, LevelDef, opposite } from './types';

/** Fill duration per pipe while fast-forwarding. */
export const FAST_FILL_MS = 80;
/** Reservoirs take this much longer to fill — that's the time they buy. */
export const RESERVOIR_FILL_FACTOR = 2.5;

export type FlowTickEvent =
  | { type: 'flowStarted' }
  | {
      type: 'filled';
      pos: GridPos;
      channelIdx: number;
      /** True when this fill counts toward the distance requirement. */
      countsAsPipe: boolean;
      pieceClass: 'normal' | 'bonusPiece' | 'reservoir' | 'start' | 'end';
      /** True when this fill completed the second channel of a cross. */
      selfCross: boolean;
    }
  | { type: 'endReached'; pos: GridPos }
  | { type: 'spill'; pos: GridPos; dir: Dir };

export class FlowSim {
  state: FlowState = 'countdown';
  countdownMs: number;
  head: FlowHead | null = null;
  segmentElapsedMs = 0;
  pipesFilled = 0;
  fastForward = false;
  /** Sim clock, advanced by tick; readable by the round for lockouts. */
  nowMs = 0;

  constructor(
    private level: LevelDef,
    private grid: Grid,
  ) {
    this.countdownMs = level.delayMs;
  }

  /** Duration to fill the piece currently under the head. */
  segmentDurationMs(): number {
    if (!this.head) return this.level.fillMs;
    const piece = this.grid.get(this.head.pos);
    let ms = this.level.fillMs;
    if (piece && isReservoir(piece.kind)) ms *= RESERVOIR_FILL_FACTOR;
    if (this.fastForward) ms = Math.min(ms, FAST_FILL_MS);
    return ms;
  }

  /** 0..1 progress of the segment currently filling (for rendering). */
  segmentProgress(): number {
    if (this.state !== 'flowing' || !this.head) return 0;
    return Math.min(1, this.segmentElapsedMs / this.segmentDurationMs());
  }

  requestFastForward(): void {
    if (this.state !== 'done') this.fastForward = true;
  }

  /** Skip the remaining countdown (also triggered by fast-forward). */
  private maybeStartFlow(events: FlowTickEvent[]): void {
    if (this.state !== 'countdown') return;
    if (this.countdownMs > 0 && !this.fastForward) return;
    this.state = 'flowing';
    this.segmentElapsedMs = Math.max(0, -this.countdownMs);
    // The head starts inside the START piece; entryDir is arbitrary but
    // consistent (opposite of its exit) so rendering knows the direction.
    this.head = {
      pos: this.level.start.pos,
      entryDir: opposite(this.level.start.exit),
      channelIdx: 0,
    };
    events.push({ type: 'flowStarted' });
  }

  tick(dtMs: number): FlowTickEvent[] {
    const events: FlowTickEvent[] = [];
    if (this.state === 'done') return events;
    this.nowMs += dtMs;

    if (this.state === 'countdown') {
      this.countdownMs -= dtMs;
      this.maybeStartFlow(events);
      if ((this.state as FlowState) !== 'flowing') return events;
    } else {
      this.segmentElapsedMs += dtMs;
    }

    // A single tick can complete multiple segments during fast-forward.
    while (this.state === 'flowing' && this.segmentElapsedMs >= this.segmentDurationMs()) {
      this.segmentElapsedMs -= this.segmentDurationMs();
      this.completeSegment(events);
    }
    return events;
  }

  private completeSegment(events: FlowTickEvent[]): void {
    const head = this.head!;
    const piece = this.grid.get(head.pos)!;
    const channel = piece.channels[head.channelIdx]!;
    channel.filled = true;
    channel.fillEntry = head.entryDir;

    const isStart = piece.kind === 'START';
    const isEnd = piece.kind === 'END';
    const isCrossShape = piece.kind === 'X' || piece.kind === 'BONUS';
    const selfCross = isCrossShape && piece.channels.every((c) => c.filled);
    const pieceClass = isStart
      ? 'start'
      : isEnd
        ? 'end'
        : piece.kind === 'BONUS'
          ? 'bonusPiece'
          : isReservoir(piece.kind)
            ? 'reservoir'
            : 'normal';

    if (!isStart) this.pipesFilled++;
    events.push({
      type: 'filled',
      pos: head.pos,
      channelIdx: head.channelIdx,
      countsAsPipe: !isStart,
      pieceClass,
      selfCross,
    });

    if (isEnd) {
      events.push({ type: 'endReached', pos: head.pos });
      this.state = 'done';
      this.head = null;
      return;
    }

    this.advance(events);
  }

  /** Move the head into the next cell, or spill. */
  private advance(events: FlowTickEvent[]): void {
    const head = this.head!;
    const piece = this.grid.get(head.pos)!;
    const exitDir: Dir =
      piece.kind === 'START'
        ? this.level.start.exit
        : channelExit(piece.kind, head.channelIdx, head.entryDir);

    const spill = () => {
      events.push({ type: 'spill', pos: head.pos, dir: exitDir });
      this.state = 'done';
      this.head = null;
    };

    const step = this.grid.neighbor(head.pos, exitDir);
    if (!step) return spill();

    const next = this.grid.get(step.pos);
    const entry = opposite(exitDir);
    if (!next) return spill();
    if (next.kind === 'OBSTACLE' || next.kind === 'START') return spill();
    // A piece still materializing after a bomb is not yet connectable.
    if (next.readyAtMs > this.nowMs) return spill();
    if (next.kind === 'END') {
      this.head = { pos: step.pos, entryDir: entry, channelIdx: 0 };
      return;
    }
    const chIdx = findChannel(next.kind, entry);
    if (chIdx === null) return spill();
    if (next.channels[chIdx]!.filled) return spill();
    this.head = { pos: step.pos, entryDir: entry, channelIdx: chIdx };
  }
}
