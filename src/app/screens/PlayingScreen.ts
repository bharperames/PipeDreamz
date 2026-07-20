import { GameRound } from '../../core/round';
import { mulberry32 } from '../../core/rng';
import { GameEvent, GameMode, GridPos, LevelDef, PlayerId, RoundResult } from '../../core/types';
import { Renderer2D } from '../../render2d/Renderer2D';
import { PAL } from '../../render2d/sprites';
import { Sfx } from '../../audio/Sfx';
import {
  KEY_ALT_DISPENSER,
  KEY_FAST,
  KEY_PAUSE,
  KEY_QUIT,
  P1_KEYS,
  P2_KEYS,
} from '../../input/bindings';

const SIM_DT = 1000 / 120;

export interface PlayingCallbacks {
  onRoundOver(result: RoundResult): void;
  onQuit(): void;
  /** Live easy-queue switch changed; lets the session remember it. */
  onEasyToggle?(on: boolean): void;
  /** Current music state for the HUD chip. */
  musicOn?(): boolean;
  /** Toggle music; returns the new state. */
  toggleMusic?(): boolean;
}

/** One recorded input, timestamped in deterministic sim time. */
export type RecordedAction =
  | { t: number; type: 'place'; pos: GridPos; dispenser: 0 | 1 }
  | { t: number; type: 'fast' }
  | { t: number; type: 'easy'; on: boolean };

export class PlayingScreen {
  readonly round: GameRound;
  /** Everything the player did, for the instant replay. */
  readonly actionLog: RecordedAction[] = [];
  private cursorCells: GridPos[] = [];
  private accumulator = 0;
  private paused = false;
  private endedAtMs: number | null = null;
  private renderTime = 0;
  private shiftHeld = false;
  private replayCursor = 0;

  constructor(
    private renderer: Renderer2D,
    private sfx: Sfx,
    level: LevelDef,
    mode: GameMode,
    seed: number,
    training: boolean,
    private easyQueue: boolean,
    private callbacks: PlayingCallbacks,
    private totals: [number, number],
    /** When set, this script drives the round instead of user input. */
    private replay?: RecordedAction[],
  ) {
    this.round = new GameRound(
      {
        level,
        mode,
        seed,
        players: mode === 'competitive' ? 2 : 1,
        timeScale: training ? 1.75 : 1,
        easyQueue: this.easyQueue,
      },
      mulberry32(seed),
    );
    renderer.setBoardSize(level.gridW, level.gridH);
    const players = mode === 'competitive' ? 2 : 1;
    for (let p = 0; p < players; p++) this.cursorCells.push({ x: 4 + p, y: 3 });
  }

  // ---------- input ----------

  onKeyDown(e: KeyboardEvent): void {
    if (KEY_QUIT.includes(e.code)) return this.callbacks.onQuit();
    if (KEY_PAUSE.includes(e.code)) {
      this.paused = !this.paused;
      return;
    }
    if (this.replay) return; // playback drives the round, not keys
    if (this.paused || this.round.over) return;
    if (KEY_FAST.includes(e.code)) {
      this.actionLog.push({ t: this.round.flow.nowMs, type: 'fast' });
      this.round.apply({ type: 'fastForward', player: 0 });
      return;
    }
    if (KEY_ALT_DISPENSER.includes(e.code)) this.shiftHeld = true;

    const keysets = this.round.mode === 'competitive' ? [P1_KEYS, P2_KEYS] : [P1_KEYS];
    keysets.forEach((keys, p) => {
      const player = p as PlayerId;
      const cell = this.cursorCells[player]!;
      let moved = false;
      if (keys.up.includes(e.code)) (cell.y = Math.max(0, cell.y - 1)), (moved = true);
      if (keys.down.includes(e.code))
        (cell.y = Math.min(this.round.level.gridH - 1, cell.y + 1)), (moved = true);
      if (keys.left.includes(e.code)) (cell.x = Math.max(0, cell.x - 1)), (moved = true);
      if (keys.right.includes(e.code))
        (cell.x = Math.min(this.round.level.gridW - 1, cell.x + 1)), (moved = true);
      if (moved) {
        e.preventDefault();
        this.sfx.play('move');
      }
      if (keys.place.includes(e.code)) {
        e.preventDefault();
        this.place(player, { ...cell }, this.shiftHeld ? 1 : 0);
      }
    });
  }

  onKeyUp(e: KeyboardEvent): void {
    if (KEY_ALT_DISPENSER.includes(e.code)) this.shiftHeld = false;
  }

  onMouseMove(e: MouseEvent): void {
    const cell = this.renderer.screenToCell(e.clientX, e.clientY);
    if (!this.round.grid.inBounds(cell)) return;
    this.cursorCells[0] = cell;
  }

  onMouseDown(e: MouseEvent): void {
    // Music chip works even while paused or after the round ends.
    if (this.renderer.hitMusicSwitch(e.clientX, e.clientY)) {
      this.callbacks.toggleMusic?.();
      this.sfx.play('menu');
      return;
    }
    if (this.replay) return; // playback drives the round, not clicks
    if (this.paused || this.round.over) return;
    if (this.renderer.hitEasySwitch(e.clientX, e.clientY)) {
      this.round.easyQueue = !this.round.easyQueue;
      this.actionLog.push({
        t: this.round.flow.nowMs,
        type: 'easy',
        on: this.round.easyQueue,
      });
      this.callbacks.onEasyToggle?.(this.round.easyQueue);
      this.sfx.play('menu');
      return;
    }
    const cell = this.renderer.screenToCell(e.clientX, e.clientY);
    if (!this.round.grid.inBounds(cell)) return;
    const dispenser = e.button === 2 || this.shiftHeld ? 1 : 0;
    this.place(0, cell, dispenser as 0 | 1);
  }

  private place(player: PlayerId, pos: GridPos, dispenser: 0 | 1): void {
    const events = this.round.apply({
      type: 'place',
      player,
      pos,
      dispenser: this.round.mode === 'expert' ? dispenser : 0,
    });
    if (events.length > 0) {
      this.actionLog.push({ t: this.round.flow.nowMs, type: 'place', pos, dispenser });
    }
    this.handleEvents(events);
  }

  /** Apply any recorded actions that are due at the current sim time. */
  private applyDueReplayActions(): void {
    if (!this.replay) return;
    while (this.replayCursor < this.replay.length) {
      const a = this.replay[this.replayCursor]!;
      if (a.t > this.round.flow.nowMs) break;
      this.replayCursor++;
      if (a.type === 'place') {
        this.place(0, a.pos, a.dispenser);
      } else if (a.type === 'fast') {
        this.round.apply({ type: 'fastForward', player: 0 });
      } else {
        this.round.easyQueue = a.on;
      }
    }
  }

  // ---------- frame ----------

  update(dtMs: number): void {
    this.renderTime += dtMs;
    if (!this.paused) {
      // Instant replay runs at 2x speed.
      this.accumulator += Math.min(dtMs, 100) * (this.replay ? 2 : 1);
      while (this.accumulator >= SIM_DT) {
        this.applyDueReplayActions();
        this.accumulator -= SIM_DT;
        this.handleEvents(this.round.tick(SIM_DT));
      }
    }
    this.draw(dtMs);

    if (this.round.over && this.endedAtMs === null) this.endedAtMs = this.renderTime;
    if (this.endedAtMs !== null && this.renderTime - this.endedAtMs > 1400) {
      this.callbacks.onRoundOver(this.round.result!);
      this.endedAtMs = Infinity;
    }
  }

  private draw(dtMs: number): void {
    const r = this.renderer;
    const round = this.round;
    r.begin();
    r.drawBoard(round.level);

    // Pieces + settled flooz
    round.grid.forEach((piece, pos) => {
      const materializing = piece.readyAtMs > round.flow.nowMs;
      r.drawPieceAt(pos.x, pos.y, piece.kind, {
        alpha: materializing ? 0.45 : 1,
        startExit: piece.kind === 'START' ? round.level.start.exit : undefined,
      });
      piece.channels.forEach((ch, i) => {
        if (ch.filled) {
          r.drawFloozAt(
            pos.x,
            pos.y,
            piece.kind,
            i,
            1,
            this.reversed(piece.kind, i, ch.fillEntry),
            piece.kind === 'START' ? round.level.start.exit : undefined,
          );
        }
      });
    });

    // Live fill head
    const head = round.flow.head;
    if (head && round.flow.state === 'flowing') {
      const piece = round.grid.get(head.pos)!;
      r.drawFloozAt(
        head.pos.x,
        head.pos.y,
        piece.kind,
        head.channelIdx,
        round.flow.segmentProgress(),
        this.reversed(piece.kind, head.channelIdx, head.entryDir),
        piece.kind === 'START' ? round.level.start.exit : undefined,
      );
    }

    // Cursors
    this.cursorCells.forEach((cell, p) => {
      const piece = round.grid.get(cell);
      const valid = !piece || (!piece.fixed && !piece.channels.some((c) => c.filled));
      r.drawCursorAt(cell.x, cell.y, valid, p === 0 ? PAL.white : '#7db6f0');
    });

    r.drawDispensers(round.queues, round.easyQueue);
    r.updateOverlays(dtMs);

    const mode = round.mode;
    r.drawHud({
      score: this.totals[0] + round.scores[0],
      score2: mode === 'competitive' ? this.totals[1] + round.scores[1] : null,
      level: round.level.id,
      pipesLeft: round.level.distance - round.flow.pipesFilled,
      countdownFrac:
        round.flow.state === 'countdown' ? round.flow.countdownMs / round.level.delayMs : 0,
      progressFrac: Math.min(1, round.flow.pipesFilled / round.level.distance),
      paused: this.paused,
      fastFlow: round.flow.fastForward,
      musicOn: this.callbacks.musicOn?.(),
      replay: this.replay !== undefined,
    });
    r.present();
  }

  /** Whether the flow entered from the far end of the sprite's path. */
  private reversed(kind: string, channelIdx: number, entry: number | null): boolean {
    if (entry === null) return false;
    switch (kind) {
      case 'H': case 'RESERVOIR_H': return entry === 1;
      case 'V': case 'RESERVOIR_V': return entry === 2;
      case 'NE': return entry === 1;
      case 'NW': return entry === 3;
      case 'SE': return entry === 1;
      case 'SW': return entry === 3;
      case 'X': case 'BONUS': return channelIdx === 0 ? entry === 2 : entry === 1;
      default: return false;
    }
  }

  private handleEvents(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'piecePlaced':
          if (e.wasReplacement) {
            this.sfx.play('bomb');
            this.renderer.burst(e.pos, '#d8d0b8');
            this.renderer.addPopup(e.pos, '-50', 'loss');
          } else {
            this.sfx.play('place');
          }
          break;
        case 'flowStarted':
          this.sfx.play('reservoir');
          break;
        case 'segmentFilled':
          if (e.points > 0) {
            this.sfx.play('fill', Math.min(24, e.pipesFilled));
            this.renderer.addPopup(e.pos, `+${e.points}`, e.points >= 500 ? 'big' : 'gain');
          }
          break;
        case 'crossCompleted':
          this.sfx.play('cross');
          this.renderer.addPopup(e.pos, `+${e.points}`, 'big');
          break;
        case 'distanceMet':
          this.sfx.play('distance');
          break;
        case 'endReached':
          this.sfx.play('end');
          break;
        case 'spill':
          this.sfx.play('spill');
          this.renderer.burst(e.pos, PAL.flooz, 20);
          break;
        case 'roundOver':
          break;
      }
    }
  }

  dispose(): void {
    this.renderer.clearOverlays();
  }
}
