import { BonusRound, BONUS_TIMER_MS } from '../../core/bonus';
import { mulberry32 } from '../../core/rng';
import { Renderer2D } from '../../render2d/Renderer2D';
import { PAL } from '../../render2d/sprites';
import { Sfx } from '../../audio/Sfx';
import { KEY_FAST, KEY_QUIT } from '../../input/bindings';
import { GridPos } from '../../core/types';

const SIM_DT = 1000 / 120;

/**
 * Bonus round: Connect-4 style. Click a column to drop the next
 * dispenser piece into its lowest open space; after the timer (or F),
 * the flooz pours from the bottom-left tank.
 */
export class BonusScreen {
  readonly bonus: BonusRound;
  private cursorCell: GridPos = { x: 5, y: 3 };
  private accumulator = 0;
  private renderTime = 0;
  private endedAtMs: number | null = null;

  constructor(
    private renderer: Renderer2D,
    private sfx: Sfx,
    seed: number,
    private onDone: (score: number) => void,
    private onQuit: () => void,
    private totalScore: number,
  ) {
    this.bonus = new BonusRound(mulberry32(seed));
    renderer.setBoardSize(this.bonus.level.gridW, this.bonus.level.gridH);
  }

  onKeyDown(e: KeyboardEvent): void {
    if (KEY_QUIT.includes(e.code)) return this.onQuit();
    if (KEY_FAST.includes(e.code)) this.bonus.startFlow();
  }

  onKeyUp(_e: KeyboardEvent): void {}

  onMouseMove(e: MouseEvent): void {
    const cell = this.renderer.screenToCell(e.clientX, e.clientY);
    if (this.bonus.grid.inBounds(cell)) this.cursorCell = cell;
  }

  onMouseDown(e: MouseEvent): void {
    const cell = this.renderer.screenToCell(e.clientX, e.clientY);
    if (!this.bonus.grid.inBounds(cell)) return;
    if (this.bonus.drop(cell.x).length) this.sfx.play('place');
  }

  update(dtMs: number): void {
    this.renderTime += dtMs;
    this.accumulator += Math.min(dtMs, 100);
    while (this.accumulator >= SIM_DT) {
      this.accumulator -= SIM_DT;
      for (const e of this.bonus.tick(SIM_DT)) {
        if (e.type === 'flowStarted') this.sfx.play('reservoir');
        if (e.type === 'segmentFilled') {
          this.sfx.play('fill', Math.min(24, this.bonus.pipesFilled));
          this.renderer.addPopup(e.pos, `+${e.points}`, 'gain');
        }
      }
    }
    this.draw(dtMs);

    if (this.bonus.phase === 'done' && this.endedAtMs === null) this.endedAtMs = this.renderTime;
    if (this.endedAtMs !== null && this.renderTime - this.endedAtMs > 1200) {
      this.endedAtMs = Infinity;
      this.onDone(this.bonus.score);
    }
  }

  private draw(dtMs: number): void {
    const r = this.renderer;
    r.begin();
    r.drawBoard(this.bonus.level);

    this.bonus.grid.forEach((piece, pos) => {
      r.drawPieceAt(pos.x, pos.y, piece.kind, {
        startExit: piece.kind === 'START' ? this.bonus.level.start.exit : undefined,
      });
      piece.channels.forEach((ch, i) => {
        if (ch.filled) {
          r.drawFloozAt(
            pos.x,
            pos.y,
            piece.kind,
            i,
            1,
            false,
            piece.kind === 'START' ? this.bonus.level.start.exit : undefined,
          );
        }
      });
    });

    const flow = this.bonus.flow;
    if (flow?.head && flow.state === 'flowing') {
      const piece = this.bonus.grid.get(flow.head.pos)!;
      r.drawFloozAt(
        flow.head.pos.x,
        flow.head.pos.y,
        piece.kind,
        flow.head.channelIdx,
        flow.segmentProgress(),
        false,
      );
    }

    if (this.bonus.phase === 'arrange') {
      // The hovered column's landing cell, marked gold; full columns red.
      const landing = this.bonus.landing(this.cursorCell.x);
      if (landing) {
        r.drawCursorAt(landing.x, landing.y, true, PAL.gold);
      } else {
        r.drawCursorAt(this.cursorCell.x, 0, false);
      }
    }

    // The dispenser rack shows what drops next; the plumber just watches.
    r.drawDispensers([this.bonus.queue], undefined, undefined, 1);

    r.updateOverlays(dtMs);
    r.drawHud({
      score: this.totalScore + this.bonus.score,
      score2: null,
      level: 'BN',
      pipesLeft: this.bonus.pipesFilled,
      countdownFrac: this.bonus.phase === 'arrange' ? this.bonus.timerMs / BONUS_TIMER_MS : 0,
      progressFrac: 1,
      paused: false,
      fastFlow: false,
    });
    r.present();
  }

  dispose(): void {
    this.renderer.clearOverlays();
  }
}
