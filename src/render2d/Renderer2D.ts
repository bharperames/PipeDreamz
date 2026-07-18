import { DispenserQueue } from '../core/queue';
import { Dir, GridPos, LevelDef } from '../core/types';
import { CELL, drawFlooz, drawMascot, drawPlate, PAL, pieceSprite } from './sprites';

const HUD_H = 20;
const LEFT_W = 40;
const BAR_W = 12;
const GAP = 4;

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

export interface HudState {
  score: number;
  score2: number | null;
  level: number | string;
  /** Pipes still required (D readout). */
  pipesLeft: number;
  /** Pre-flow countdown 0..1 (drains the right-hand bar red). */
  countdownFrac: number;
  /** Pipeline progress 0..1 once flowing (fills the bar yellow). */
  progressFrac: number;
  paused: boolean;
  fastFlow: boolean;
}

/**
 * Low-resolution renderer laid out like the 1989 screen: HUD strip across
 * the top, dispenser box top-left with the mascot below it, the plated
 * board filling the middle, and a vertical flooz timer bar on the right.
 * Drawn into a small framebuffer, integer-upscaled with nearest-neighbor.
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
  private frameCount = 0;
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
    this.bufW = GAP + LEFT_W + GAP + gridW * CELL + GAP + BAR_W + GAP;
    this.bufH = HUD_H + GAP + gridH * CELL + GAP;
    this.boardX = GAP + LEFT_W + GAP;
    this.boardY = HUD_H + GAP;
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
    this.frameCount++;
    const g = this.g;
    g.fillStyle = PAL.black;
    g.fillRect(0, 0, this.bufW, this.bufH);
  }

  drawBoard(level: LevelDef): void {
    const g = this.g;
    const { gridW, gridH } = level;
    // thin metal frame around the whole board
    g.fillStyle = PAL.frameLo;
    g.fillRect(this.boardX - 3, this.boardY - 3, gridW * CELL + 6, gridH * CELL + 6);
    g.fillStyle = PAL.frame;
    g.fillRect(this.boardX - 2, this.boardY - 2, gridW * CELL + 4, gridH * CELL + 4);
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const o = this.cellOrigin(x, y);
        drawPlate(g, o.x, o.y);
      }
    }
    // Wrap openings: dark tunnel mouths on the board edge.
    for (const w of level.wraps) {
      const o = this.cellOrigin(w.x, w.y);
      g.fillStyle = PAL.black;
      const t = 3;
      if (w.side === 0) g.fillRect(o.x + 4, o.y, CELL - 8, t);
      if (w.side === 2) g.fillRect(o.x + 4, o.y + CELL - t, CELL - 8, t);
      if (w.side === 3) g.fillRect(o.x, o.y + 4, t, CELL - 8);
      if (w.side === 1) g.fillRect(o.x + CELL - t, o.y + 4, t, CELL - 8);
      g.fillStyle = PAL.ledYellow;
      if (w.side === 0) g.fillRect(o.x + 4, o.y, 2, t);
      if (w.side === 2) g.fillRect(o.x + 4, o.y + CELL - t, 2, t);
      if (w.side === 3) g.fillRect(o.x, o.y + 4, t, 2);
      if (w.side === 1) g.fillRect(o.x + CELL - t, o.y + 4, t, 2);
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

  /** Dashed rounded selection frame, like the original's cursor. */
  drawCursorAt(x: number, y: number, valid: boolean, color: string = PAL.white): void {
    if (x < 0 || y < 0 || x >= this.level.gridW || y >= this.level.gridH) return;
    const o = this.cellOrigin(x, y);
    const g = this.g;
    g.save();
    g.strokeStyle = valid ? color : PAL.red;
    g.lineWidth = 2;
    g.setLineDash([3, 2]);
    g.lineDashOffset = -Math.floor(this.frameCount / 4) % 5;
    g.strokeRect(o.x + 1, o.y + 1, CELL - 2, CELL - 2);
    g.restore();
  }

  /** Dispenser box(es) in the left column; next piece at the bottom. */
  drawDispensers(queues: DispenserQueue[]): void {
    const g = this.g;
    const x = GAP;
    let y = HUD_H + GAP;
    for (const q of queues) {
      const innerH = q.depth * (CELL + 2) + 4;
      const boxH = innerH + 8;
      // metal frame
      g.fillStyle = PAL.frameLo;
      g.fillRect(x, y, LEFT_W, boxH);
      g.fillStyle = PAL.frame;
      g.fillRect(x + 1, y + 1, LEFT_W - 2, boxH - 2);
      g.fillStyle = PAL.black;
      g.fillRect(x + 4, y + 4, LEFT_W - 8, innerH);
      const items = q.peek();
      for (let i = 0; i < q.depth; i++) {
        const sy = y + 4 + innerH - 2 - (i + 1) * (CELL + 2) + 2;
        const sx = x + (LEFT_W - CELL) / 2;
        const kind = items[i];
        if (kind) g.drawImage(pieceSprite(kind), sx, sy);
        if (i === 0) {
          // subtle marker brackets around the next piece
          g.fillStyle = PAL.ledYellow;
          g.fillRect(sx - 3, sy, 2, 6);
          g.fillRect(sx - 3, sy + CELL - 6, 2, 6);
          g.fillRect(sx + CELL + 1, sy, 2, 6);
          g.fillRect(sx + CELL + 1, sy + CELL - 6, 2, 6);
        }
      }
      y += boxH + GAP;
    }
    // Mascot overlaps the bottom-left corner, in front of the dispenser
    // column — only when a single dispenser leaves him room to stand.
    if (queues.length === 1) {
      drawMascot(g, x + 2, this.bufH - 50);
    }
  }

  // ---------- HUD ----------

  /** Chunky LED-segment digit, 6x10 px with 2px strokes. */
  private ledDigit(x: number, y: number, d: number, color: string): void {
    const g = this.g;
    //   0
    //  1 2
    //   3
    //  4 5
    //   6
    const SEG: number[][] = [
      [1, 1, 1, 0, 1, 1, 1], // 0
      [0, 0, 1, 0, 0, 1, 0],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 0, 1, 1],
      [0, 1, 1, 1, 0, 1, 0],
      [1, 1, 0, 1, 0, 1, 1],
      [1, 1, 0, 1, 1, 1, 1],
      [1, 0, 1, 0, 0, 1, 0],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1, 1],
    ];
    const s = SEG[d]!;
    g.fillStyle = color;
    if (s[0]) g.fillRect(x, y, 6, 2);
    if (s[1]) g.fillRect(x, y, 2, 6);
    if (s[2]) g.fillRect(x + 4, y, 2, 6);
    if (s[3]) g.fillRect(x, y + 4, 6, 2);
    if (s[4]) g.fillRect(x, y + 4, 2, 6);
    if (s[5]) g.fillRect(x + 4, y + 4, 2, 6);
    if (s[6]) g.fillRect(x, y + 8, 6, 2);
  }

  private ledNumber(x: number, y: number, value: number, digits: number, color: string): number {
    const s = Math.max(0, Math.round(value)).toString().padStart(digits, '0').slice(-digits);
    for (let i = 0; i < s.length; i++) this.ledDigit(x + i * 7, y, Number(s[i]), color);
    return x + s.length * 7;
  }

  private label(s: string, x: number, y: number, color: string): number {
    const g = this.g;
    g.font = `bold 8px 'Courier New', monospace`;
    g.textBaseline = 'top';
    g.fillStyle = PAL.black;
    g.fillText(s, x + 1, y + 1);
    g.fillStyle = color;
    g.fillText(s, x, y);
    return x + g.measureText(s).width;
  }

  private inset(x: number, y: number, w: number, h: number): void {
    const g = this.g;
    g.fillStyle = PAL.black;
    g.fillRect(x - 2, y - 2, w + 4, h + 4);
    g.fillStyle = PAL.hudInset;
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
  }

  drawHud(s: HudState): void {
    const g = this.g;
    // red-brown bar with metal trim
    g.fillStyle = PAL.frameLo;
    g.fillRect(0, 0, this.bufW, HUD_H);
    g.fillStyle = PAL.hudBar;
    g.fillRect(2, 2, this.bufW - 4, HUD_H - 4);
    g.fillStyle = PAL.hudBarHi;
    g.fillRect(2, 2, this.bufW - 4, 1);

    const digY = 5;
    const labY = 6;
    let x = 8;
    x = this.label('P1:', x, labY, PAL.white) + 4;
    this.inset(x, digY, 7 * 7 - 1, 10);
    x = this.ledNumber(x + 1, digY, s.score, 7, PAL.ledYellow) + 10;
    x = this.label('P2:', x, labY, PAL.white) + 4;
    this.inset(x, digY, 7 * 7 - 1, 10);
    this.ledNumber(x + 1, digY, s.score2 ?? 0, 7, PAL.ledGreen);

    // right-aligned L and D readouts
    const dNumX = this.bufW - 10 - 13;
    this.inset(dNumX, digY, 14, 10);
    this.ledNumber(dNumX + 1, digY, s.pipesLeft, 2, PAL.ledBlue);
    this.label('D:', dNumX - 15, labY, PAL.white);
    const lNumX = dNumX - 15 - 10 - 13;
    this.inset(lNumX, digY, 14, 10);
    if (typeof s.level === 'number') {
      this.ledNumber(lNumX + 1, digY, s.level, 2, PAL.ledBlue);
    } else {
      this.label('BN', lNumX + 2, labY, PAL.ledBlue);
    }
    this.label('L:', lNumX - 15, labY, PAL.white);

    // right-hand vertical flooz timer bar
    const bx = this.bufW - GAP - BAR_W;
    const by = HUD_H + GAP;
    const bh = this.bufH - by - GAP;
    g.fillStyle = PAL.frameLo;
    g.fillRect(bx, by, BAR_W, bh);
    g.fillStyle = PAL.frame;
    g.fillRect(bx + 1, by + 1, BAR_W - 2, bh - 2);
    g.fillStyle = PAL.black;
    g.fillRect(bx + 3, by + 3, BAR_W - 6, bh - 6);
    if (s.countdownFrac > 0) {
      const fh = Math.round((bh - 8) * Math.min(1, s.countdownFrac));
      g.fillStyle = PAL.red;
      g.fillRect(bx + 4, by + 4 + (bh - 8 - fh), BAR_W - 8, fh);
      g.fillStyle = PAL.hudBarHi;
      g.fillRect(bx + 4, by + 4 + (bh - 8 - fh), 1, fh);
    } else {
      const fh = Math.round((bh - 8) * Math.min(1, s.progressFrac));
      g.fillStyle = PAL.flooz;
      g.fillRect(bx + 4, by + 4 + (bh - 8 - fh), BAR_W - 8, fh);
      g.fillStyle = PAL.floozHi;
      g.fillRect(bx + 4, by + 4 + (bh - 8 - fh), 1, fh);
    }

    if (s.fastFlow && s.countdownFrac <= 0) {
      this.label('FAST', bx - 26, this.bufH - 12, PAL.ledYellow);
    }
    if (s.paused) {
      const cx = this.boardX + (this.level.gridW * CELL) / 2;
      const cy = this.boardY + (this.level.gridH * CELL) / 2;
      g.fillStyle = PAL.black;
      g.fillRect(cx - 34, cy - 8, 68, 16);
      g.fillStyle = PAL.frame;
      g.fillRect(cx - 33, cy - 7, 66, 14);
      g.fillStyle = PAL.hudInset;
      g.fillRect(cx - 31, cy - 5, 62, 10);
      this.label('PAUSED', cx - 18, cy - 4, PAL.ledYellow);
    }
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
      const g2 = this.g;
      g2.font = `bold 8px 'Courier New', monospace`;
      g2.textBaseline = 'top';
      g2.fillStyle = PAL.black;
      g2.fillText(p.text, p.x - p.text.length * 2.5 + 1, p.y - t * 12 + 1);
      g2.fillStyle = p.color;
      g2.fillText(p.text, p.x - p.text.length * 2.5, p.y - t * 12);
    }
  }

  clearOverlays(): void {
    this.popups = [];
    this.particles = [];
  }

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
