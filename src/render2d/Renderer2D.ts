import { DispenserQueue } from '../core/queue';
import { Dir, GridPos, LevelDef } from '../core/types';
import { CELL, drawFlooz, PAL, pieceSprite } from './sprites';

const HUD_H = 18;
const DISP_W = 34;
const MARGIN = 6;
const FRAME = 5;

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  ageMs: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  color: string;
}

/**
 * Low-resolution 2D renderer: everything is drawn into a small internal
 * framebuffer (roughly 320x200-class, like a 1989 home computer screen)
 * and blitted to the visible canvas with nearest-neighbor upscaling.
 */
export class Renderer2D {
  private buffer: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private out: CanvasRenderingContext2D;
  private bufW = 320;
  private bufH = 200;
  private boardX = 0;
  private boardY = 0;
  private level: { gridW: number; gridH: number } = { gridW: 10, gridH: 7 };
  private popups: Popup[] = [];
  private particles: Particle[] = [];
  /** Blit transform (for mouse mapping). */
  private scale = 1;
  private offX = 0;
  private offY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.buffer = document.createElement('canvas');
    this.g = this.buffer.getContext('2d')!;
    this.out = canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.fit());
    this.setBoardSize(10, 7);
  }

  setBoardSize(gridW: number, gridH: number): void {
    this.level = { gridW, gridH };
    this.bufW = MARGIN + DISP_W + MARGIN + FRAME + gridW * CELL + FRAME + MARGIN;
    this.bufH = HUD_H + MARGIN + FRAME + gridH * CELL + FRAME + MARGIN + 10;
    this.boardX = MARGIN + DISP_W + MARGIN + FRAME;
    this.boardY = HUD_H + MARGIN + FRAME;
    this.buffer.width = this.bufW;
    this.buffer.height = this.bufH;
    this.fit();
  }

  private fit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    this.scale = Math.max(1, Math.floor(Math.min(w / this.bufW, h / this.bufH)));
    this.offX = Math.floor((w - this.bufW * this.scale) / 2);
    this.offY = Math.floor((h - this.bufH * this.scale) / 2);
    this.out.imageSmoothingEnabled = false;
  }

  // ---------- coordinate mapping ----------

  screenToCell(clientX: number, clientY: number): GridPos {
    const bx = (clientX - this.offX) / this.scale - this.boardX;
    const by = (clientY - this.offY) / this.scale - this.boardY;
    return { x: Math.floor(bx / CELL), y: Math.floor(by / CELL) };
  }

  private cellOrigin(x: number, y: number): { x: number; y: number } {
    return { x: this.boardX + x * CELL, y: this.boardY + y * CELL };
  }

  // ---------- frame drawing ----------

  begin(): void {
    const g = this.g;
    g.fillStyle = PAL.bg;
    g.fillRect(0, 0, this.bufW, this.bufH);
  }

  drawBoard(level: LevelDef): void {
    const g = this.g;
    const { gridW, gridH } = level;
    // Frame with bevel
    const fx = this.boardX - FRAME;
    const fy = this.boardY - FRAME;
    const fw = gridW * CELL + FRAME * 2;
    const fh = gridH * CELL + FRAME * 2;
    g.fillStyle = PAL.frameLo;
    g.fillRect(fx, fy, fw, fh);
    g.fillStyle = PAL.frameHi;
    g.fillRect(fx, fy, fw, 2);
    g.fillRect(fx, fy, 2, fh);
    g.fillStyle = PAL.frame;
    g.fillRect(fx + 2, fy + 2, fw - 4, fh - 4);

    // Cells
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const o = this.cellOrigin(x, y);
        g.fillStyle = (x + y) % 2 ? PAL.boardDark : PAL.boardLight;
        g.fillRect(o.x, o.y, CELL, CELL);
        g.fillStyle = PAL.outline;
        g.fillRect(o.x, o.y, CELL, 1);
        g.fillRect(o.x, o.y, 1, CELL);
      }
    }

    // Wrap openings: green sockets cut into the frame
    for (const w of level.wraps) {
      const o = this.cellOrigin(w.x, w.y);
      g.fillStyle = PAL.flooz;
      if (w.side === 0) g.fillRect(o.x + 4, this.boardY - FRAME, CELL - 8, FRAME);
      if (w.side === 2) g.fillRect(o.x + 4, this.boardY + gridH * CELL, CELL - 8, FRAME);
      if (w.side === 3) g.fillRect(this.boardX - FRAME, o.y + 4, FRAME, CELL - 8);
      if (w.side === 1) g.fillRect(this.boardX + gridW * CELL, o.y + 4, FRAME, CELL - 8);
    }
  }

  drawPieceAt(x: number, y: number, kind: Parameters<typeof pieceSprite>[0], opts: {
    alpha?: number;
    startExit?: Dir;
  } = {}): void {
    const o = this.cellOrigin(x, y);
    const g = this.g;
    if (opts.alpha !== undefined && opts.alpha < 1) {
      g.save();
      g.globalAlpha = opts.alpha;
      g.drawImage(pieceSprite(kind, opts.startExit), o.x, o.y);
      g.restore();
    } else {
      g.drawImage(pieceSprite(kind, opts.startExit), o.x, o.y);
    }
  }

  drawFloozAt(
    x: number,
    y: number,
    kind: Parameters<typeof drawFlooz>[1],
    ch: number,
    progress: number,
    reversed: boolean,
  ): void {
    const o = this.cellOrigin(x, y);
    const g = this.g;
    g.save();
    g.translate(o.x, o.y);
    drawFlooz(g, kind, ch, progress, reversed);
    g.restore();
  }

  drawCursorAt(x: number, y: number, valid: boolean, color: string = PAL.white): void {
    if (x < 0 || y < 0 || x >= this.level.gridW || y >= this.level.gridH) return;
    const o = this.cellOrigin(x, y);
    const g = this.g;
    g.strokeStyle = valid ? color : PAL.red;
    g.lineWidth = 1;
    g.strokeRect(o.x + 0.5, o.y + 0.5, CELL - 1, CELL - 1);
    g.strokeRect(o.x + 1.5, o.y + 1.5, CELL - 3, CELL - 3);
  }

  /** Dispensers on the left; slot 0 (next piece) at the bottom. */
  drawDispensers(queues: DispenserQueue[]): void {
    const g = this.g;
    const x = MARGIN;
    queues.forEach((q, qi) => {
      const items = q.peek();
      const rackH = q.depth * (CELL + 2) + 8;
      const y0 = this.boardY + (qi === 0 ? this.level.gridH * CELL - rackH : 0);
      g.fillStyle = PAL.frameLo;
      g.fillRect(x - 2, y0 - 2, DISP_W + 2, rackH + 4);
      g.fillStyle = PAL.frame;
      g.fillRect(x, y0, DISP_W - 2, rackH);
      for (let i = 0; i < q.depth; i++) {
        const sy = y0 + rackH - 6 - (i + 1) * (CELL + 2);
        const sx = x + (DISP_W - 2 - CELL) / 2;
        if (i === 0) {
          g.fillStyle = PAL.gold;
          g.fillRect(sx - 2, sy - 2, CELL + 4, CELL + 4);
          g.fillStyle = PAL.boardDark;
          g.fillRect(sx - 1, sy - 1, CELL + 2, CELL + 2);
        }
        const kind = items[i];
        if (kind) {
          g.fillStyle = PAL.boardLight;
          g.fillRect(sx, sy, CELL, CELL);
          g.drawImage(pieceSprite(kind), sx, sy);
        }
      }
    });
  }

  // ---------- HUD ----------

  private text(s: string, x: number, y: number, color: string = PAL.white, size = 8): void {
    const g = this.g;
    g.font = `${size}px 'Courier New', monospace`;
    g.textBaseline = 'top';
    g.fillStyle = PAL.outline;
    g.fillText(s, x + 1, y + 1);
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  drawHud(opts: {
    score: number;
    score2: number | null;
    level: number | string;
    pipesLeft: number;
    countdownFrac: number;
    countdownLabel: string;
    hint: string;
  }): void {
    const g = this.g;
    g.fillStyle = PAL.frameLo;
    g.fillRect(0, 0, this.bufW, HUD_H);
    g.fillStyle = PAL.frameHi;
    g.fillRect(0, HUD_H - 1, this.bufW, 1);
    const score2 = opts.score2 === null ? '' : `/${opts.score2}`;
    this.text(`SCORE ${opts.score}${score2}`, 6, 5, PAL.gold);
    this.text(`LEVEL ${opts.level}`, this.bufW / 2 - 24, 5);
    this.text(
      `PIPES ${Math.max(0, opts.pipesLeft)}`,
      this.bufW - 62,
      5,
      opts.pipesLeft <= 0 ? PAL.gold : PAL.floozHi,
    );

    // countdown bar bottom-left
    const bw = 70;
    const by = this.bufH - 9;
    this.text(opts.countdownLabel, MARGIN, by - 8, PAL.frameHi, 7);
    g.fillStyle = PAL.outline;
    g.fillRect(MARGIN, by, bw, 5);
    g.fillStyle = opts.countdownFrac < 0.25 ? PAL.red : PAL.flooz;
    g.fillRect(MARGIN + 1, by + 1, Math.max(0, Math.min(1, opts.countdownFrac)) * (bw - 2), 3);
    this.text(opts.hint, MARGIN + bw + 8, by - 1, PAL.frameHi, 7);
  }

  // ---------- popups & particles ----------

  addPopup(pos: GridPos, text: string, kind: 'gain' | 'loss' | 'big' = 'gain'): void {
    const o = this.cellOrigin(pos.x, pos.y);
    this.popups.push({
      x: o.x + CELL / 2,
      y: o.y,
      text,
      color: kind === 'loss' ? PAL.red : kind === 'big' ? PAL.gold : PAL.floozHi,
      ageMs: 0,
    });
  }

  burst(pos: GridPos, color: string, count = 12): void {
    const o = this.cellOrigin(pos.x, pos.y);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sp = 14 + Math.random() * 22;
      this.particles.push({
        x: o.x + CELL / 2,
        y: o.y + CELL / 2,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 18,
        ageMs: 0,
        lifeMs: 450 + Math.random() * 250,
        color,
      });
    }
  }

  updateOverlays(dtMs: number): void {
    const g = this.g;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.ageMs += dtMs;
      if (p.ageMs >= p.lifeMs) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += 60 * (dtMs / 1000);
      p.x += p.vx * (dtMs / 1000);
      p.y += p.vy * (dtMs / 1000);
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.ageMs += dtMs;
      if (p.ageMs >= 900) {
        this.popups.splice(i, 1);
        continue;
      }
      const t = p.ageMs / 900;
      this.text(p.text, p.x - p.text.length * 2.5, p.y - t * 12, p.color, 8);
    }
  }

  clearOverlays(): void {
    this.popups = [];
    this.particles = [];
  }

  /** Blit the framebuffer to the visible canvas, integer-scaled. */
  present(): void {
    const g = this.out;
    g.fillStyle = '#0c0f12';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(
      this.buffer,
      this.offX,
      this.offY,
      this.bufW * this.scale,
      this.bufH * this.scale,
    );
  }
}
