import { DispenserQueue } from '../core/queue';
import { Dir, GridPos, LevelDef, PlaceableKind } from '../core/types';
import {
  CELL,
  drawFlooz,
  drawMascot,
  drawPlate,
  PAL,
  pieceSprite,
  setRenderQuality,
} from './sprites';
import { extract, refDigitRect, sheetsReady } from './sheet';

export type RenderMode = 'retro' | 'smooth';

const HUD_H = 40;
const LEFT_W = 80;
const BAR_W = 32;
const GAP = 8;

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
  /** Pre-flow countdown 0..1 (drains the bar red). */
  countdownFrac: number;
  /** Pipeline progress 0..1 once flowing (fills the bar green). */
  progressFrac: number;
  paused: boolean;
  fastFlow: boolean;
  /** Draws the clickable music chip in the upper right when defined. */
  musicOn?: boolean;
  /** Instant-replay playback indicator. */
  replay?: boolean;
}

/**
 * 2× resolution renderer laid out like the 1989 screen: HUD strip across
 * the top, dispenser box and flooz timer bar on the left, the plated
 * board filling the middle.
 * Drawn into a small framebuffer, integer-upscaled with nearest-neighbor.
 */
export class Renderer2D {
  private buffer: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private out: CanvasRenderingContext2D;
  private bufW = 640;
  private bufH = 400;
  private boardX = 0;
  private boardY = 0;
  private level: { gridW: number; gridH: number } = { gridW: 10, gridH: 7 };
  private popups: Popup[] = [];
  private particles: Particle[] = [];
  private frameCount = 0;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  /** retro = 1x framebuffer, pixelated; smooth = 3x, smooth scaling. */
  mode: RenderMode = 'retro';
  private quality = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.buffer = document.createElement('canvas');
    this.g = this.buffer.getContext('2d')!;
    this.out = canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.fit());
    this.setBoardSize(10, 7);
  }

  setRenderMode(mode: RenderMode): void {
    this.mode = mode;
    this.quality = mode === 'smooth' ? 3 : 1;
    setRenderQuality(this.quality);
    this.digitCache.clear();
    this.placeholder = null;
    this.setBoardSize(this.level.gridW, this.level.gridH);
  }

  setBoardSize(gridW: number, gridH: number): void {
    this.level = { gridW, gridH };
    this.bufW = GAP + LEFT_W + GAP + gridW * CELL + GAP + BAR_W + GAP;
    this.bufH = HUD_H + GAP + gridH * CELL + GAP;
    this.boardX = GAP + LEFT_W + GAP;
    this.boardY = HUD_H + GAP;
    this.buffer.width = this.bufW * this.quality;
    this.buffer.height = this.bufH * this.quality;
    // New board: drop queue animation state so the fresh dispenser
    // doesn't crossfade from the previous round's pieces.
    this.dispAnim = [];
    this.fit();
  }

  private fit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    const raw = Math.min(w / this.bufW, h / this.bufH);
    // Retro snaps to integer scale for a clean pixel grid; smooth fits.
    this.scale = this.mode === 'retro' ? Math.max(1, Math.floor(raw)) : raw;
    this.offX = Math.floor((w - this.bufW * this.scale) / 2);
    this.offY = Math.floor((h - this.bufH * this.scale) / 2);
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
    g.setTransform(this.quality, 0, 0, this.quality, 0, 0);
    g.fillStyle = PAL.black;
    g.fillRect(0, 0, this.bufW, this.bufH);
  }

  drawBoard(level: LevelDef): void {
    const g = this.g;
    const { gridW, gridH } = level;
    // thin metal frame around the whole board
    g.fillStyle = PAL.frameLo;
    g.fillRect(this.boardX - 6, this.boardY - 6, gridW * CELL + 12, gridH * CELL + 12);
    g.fillStyle = PAL.frame;
    g.fillRect(this.boardX - 4, this.boardY - 4, gridW * CELL + 8, gridH * CELL + 8);
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
      const t = 6;
      if (w.side === 0) g.fillRect(o.x + 8, o.y, CELL - 16, t);
      if (w.side === 2) g.fillRect(o.x + 8, o.y + CELL - t, CELL - 16, t);
      if (w.side === 3) g.fillRect(o.x, o.y + 8, t, CELL - 16);
      if (w.side === 1) g.fillRect(o.x + CELL - t, o.y + 8, t, CELL - 16);
      g.fillStyle = PAL.ledYellow;
      if (w.side === 0) g.fillRect(o.x + 8, o.y, 4, t);
      if (w.side === 2) g.fillRect(o.x + 8, o.y + CELL - t, 4, t);
      if (w.side === 3) g.fillRect(o.x, o.y + 8, t, 4);
      if (w.side === 1) g.fillRect(o.x + CELL - t, o.y + 8, t, 4);
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
      g.drawImage(pieceSprite(kind, opts.startExit), o.x, o.y, CELL, CELL);
      g.restore();
    } else {
      g.drawImage(pieceSprite(kind, opts.startExit), o.x, o.y, CELL, CELL);
    }
  }

  drawFloozAt(
    x: number,
    y: number,
    kind: Parameters<typeof drawFlooz>[1],
    ch: number,
    progress: number,
    reversed: boolean,
    startExit?: Dir,
  ): void {
    const o = this.cellOrigin(x, y);
    const g = this.g;
    g.save();
    g.translate(o.x, o.y);
    drawFlooz(g, kind, ch, progress, reversed, startExit);
    g.restore();
  }

  /** Dashed rounded selection frame, like the original's cursor. */
  drawCursorAt(x: number, y: number, valid: boolean, color: string = PAL.white): void {
    if (x < 0 || y < 0 || x >= this.level.gridW || y >= this.level.gridH) return;
    const o = this.cellOrigin(x, y);
    const g = this.g;
    g.save();
    g.strokeStyle = valid ? color : PAL.red;
    g.lineWidth = 4;
    g.setLineDash([6, 4]);
    g.lineDashOffset = -Math.floor(this.frameCount / 4) % 10;
    g.strokeRect(o.x + 2, o.y + 2, CELL - 4, CELL - 4);
    g.restore();
  }

  private easySwitch: { x: number; y: number; w: number; h: number } | null = null;
  private musicSwitch: { x: number; y: number; w: number; h: number } | null = null;

  /** Presentation-only queue animation state (slides and crossfades). */
  private dispAnim: Array<{
    prev: PlaceableKind[] | null;
    prevPredicted: readonly PlaceableKind[] | null;
    slideStart: number;
    /** kind null = the "baking" placeholder tile. */
    fades: Map<number, { kind: PlaceableKind | null; start: number }>;
  }> = [];
  private placeholder: HTMLCanvasElement | null = null;

  /** Ghosted "?" tile for easy-mode slots that are still being decided. */
  private placeholderSprite(): HTMLCanvasElement {
    if (this.placeholder) return this.placeholder;
    const c = document.createElement('canvas');
    c.width = CELL * this.quality;
    c.height = CELL * this.quality;
    const g = c.getContext('2d')!;
    g.scale(this.quality, this.quality);
    g.fillStyle = 'rgba(150,160,170,0.08)';
    g.fillRect(6, 6, CELL - 12, CELL - 12);
    g.strokeStyle = '#3f454c';
    g.lineWidth = 2;
    g.strokeRect(6, 6, CELL - 12, CELL - 12);
    g.font = `bold 24px 'Courier New', monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(182,131,75,0.65)';
    g.fillText('?', CELL / 2, CELL / 2 + 1);
    this.placeholder = c;
    return c;
  }

  private hitRect(
    rect: { x: number; y: number; w: number; h: number } | null,
    clientX: number,
    clientY: number,
  ): boolean {
    if (!rect) return false;
    const lx = (clientX - this.offX) / this.scale;
    const ly = (clientY - this.offY) / this.scale;
    return lx >= rect.x && lx <= rect.x + rect.w && ly >= rect.y && ly <= rect.y + rect.h;
  }

  /** Whether a client-coordinate point hits the easy-queue switch. */
  hitEasySwitch(clientX: number, clientY: number): boolean {
    return this.hitRect(this.easySwitch, clientX, clientY);
  }

  /** Whether a client-coordinate point hits the music chip. */
  hitMusicSwitch(clientX: number, clientY: number): boolean {
    return this.hitRect(this.musicSwitch, clientX, clientY);
  }

  /**
   * Dispenser box(es) in the left column; next piece at the bottom.
   * `predicted` previews what the easy solver currently leans toward in
   * the still-baking far slots (a prediction, not a promise).
   */
  drawDispensers(
    queues: DispenserQueue[],
    easy?: boolean,
    predicted?: readonly PlaceableKind[],
  ): void {
    const g = this.g;
    const x = GAP;
    let y = HUD_H + GAP;
    let firstBoxTop: number | null = null;
    const SLIDE_MS = 150;
    const FADE_MS = 240;
    const now = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    queues.forEach((q, qi) => {
      if (firstBoxTop === null) firstBoxTop = y;
      const innerH = q.depth * (CELL + 4) + 8;
      const boxH = innerH + 16;
      // metal frame
      g.fillStyle = PAL.frameLo;
      g.fillRect(x, y, LEFT_W, boxH);
      g.fillStyle = PAL.frame;
      g.fillRect(x + 2, y + 2, LEFT_W - 4, boxH - 4);
      g.fillStyle = PAL.black;
      g.fillRect(x + 8, y + 8, LEFT_W - 16, innerH);

      const items = [...q.peek()];
      const anim = (this.dispAnim[qi] ??= {
        prev: null,
        prevPredicted: null,
        slideStart: 0,
        fades: new Map(),
      });

      // Detect what changed since last frame: a take shifts everything
      // down one slot (slide); a re-decided far slot swaps in place
      // (crossfade from the old piece).
      const prev = anim.prev;
      if (prev && prev.some((k, i) => k !== items[i])) {
        const shifted =
          prev.length === items.length &&
          prev[1] === items[0] &&
          (easy === true || items.length < 3 || prev[2] === items[1]);
        if (shifted) {
          anim.slideStart = now;
          anim.fades.clear();
          if (easy === true && items.length > 1) {
            // A baking slot just graduated into the stable near queue:
            // reveal it with a crossfade from whatever it displayed
            // (the top prediction, or the ? tile).
            anim.fades.set(1, {
              kind: anim.prevPredicted?.[0] ?? null,
              start: now + SLIDE_MS,
            });
          }
        } else {
          for (let i = 0; i < items.length; i++) {
            const hidden = easy === true && i >= 2;
            if (!hidden && prev[i] !== items[i]) {
              anim.fades.set(i, { kind: prev[i]!, start: now });
            }
          }
        }
      }
      anim.prev = items;
      anim.prevPredicted = predicted ?? null;

      const slideP = anim.slideStart ? Math.min(1, (now - anim.slideStart) / SLIDE_MS) : 1;
      const slideOff = -(CELL + 4) * (1 - easeOut(slideP));

      // Pieces are clipped to the rack interior so the new top piece
      // slides IN from above rather than popping.
      g.save();
      g.beginPath();
      g.rect(x + 8, y + 8, LEFT_W - 16, innerH);
      g.clip();
      for (let i = 0; i < q.depth; i++) {
        const sy = y + 8 + innerH - 4 - (i + 1) * (CELL + 4) + 4 + slideOff;
        const sx = x + (LEFT_W - CELL) / 2;
        const kind = items[i];
        if (!kind) continue;
        // Easy mode: far slots are still being decided against the live
        // board — preview what the solver currently leans toward,
        // ghosted and badged so it reads as a prediction, not a promise.
        const hidden = easy === true && i >= 2;
        if (hidden) {
          const guess = predicted?.[i - 2];
          if (guess) {
            g.save();
            g.filter = 'blur(0.8px)';
            g.globalAlpha = 0.45;
            g.drawImage(pieceSprite(guess), sx, sy, CELL, CELL);
            g.restore();
            g.save();
            g.font = `bold 13px 'Courier New', monospace`;
            g.textAlign = 'left';
            g.textBaseline = 'top';
            g.fillStyle = 'rgba(10,10,14,0.8)';
            g.fillRect(sx + CELL - 13, sy + 1, 12, 14);
            g.fillStyle = '#d8a94c';
            g.fillText('?', sx + CELL - 10, sy + 2);
            g.restore();
          } else {
            g.drawImage(this.placeholderSprite(), sx, sy, CELL, CELL);
          }
          continue;
        }
        const fade = anim.fades.get(i);
        let p = 1;
        if (fade) {
          p = Math.max(0, Math.min(1, (now - fade.start) / FADE_MS));
          if (p >= 1) anim.fades.delete(i);
        }
        g.save();
        if (fade && p < 1) {
          g.globalAlpha = 1 - p;
          const old = fade.kind === null ? this.placeholderSprite() : pieceSprite(fade.kind);
          g.drawImage(old, sx, sy, CELL, CELL);
        }
        g.globalAlpha = fade ? p : 1;
        g.drawImage(pieceSprite(kind), sx, sy, CELL, CELL);
        g.restore();
      }
      g.restore();

      // Marker brackets around the (stationary) next-piece slot.
      const my = y + 8 + innerH - 4 - (CELL + 4) + 4;
      const mx = x + (LEFT_W - CELL) / 2;
      g.fillStyle = PAL.ledYellow;
      g.fillRect(mx - 6, my, 4, 12);
      g.fillRect(mx - 6, my + CELL - 12, 4, 12);
      g.fillRect(mx + CELL + 2, my, 4, 12);
      g.fillRect(mx + CELL + 2, my + CELL - 12, 4, 12);

      y += boxH + GAP;
    });
    // Easy-queue switch: a small clickable tag on the dispenser itself.
    if (easy !== undefined && firstBoxTop !== null) {
      const tw = 64;
      const tx = x + (LEFT_W - tw) / 2;
      const ty = firstBoxTop - 2;
      g.fillStyle = PAL.black;
      g.fillRect(tx - 2, ty - 2, tw + 4, 16);
      g.fillStyle = easy ? '#12240f' : '#181c20';
      g.fillRect(tx, ty, tw, 12);
      g.strokeStyle = easy ? PAL.flooz : '#4c5258';
      g.lineWidth = 1;
      g.strokeRect(tx + 0.5, ty + 0.5, tw - 1, 11);
      g.font = `bold 9px 'Courier New', monospace`;
      g.textBaseline = 'top';
      g.fillStyle = easy ? PAL.floozHi : '#8a949e';
      g.fillText(easy ? 'EASY: ON' : 'EASY:OFF', tx + 6, ty + 2);
      this.easySwitch = { x: tx - 2, y: ty - 2, w: tw + 4, h: 16 };
    } else {
      this.easySwitch = null;
    }
    // Mascot stands in the leftover space BELOW the dispenser box so he
    // never covers the next-piece slot.
    if (queues.length === 1) {
      const h = this.bufH - y - 4;
      if (h >= 40) {
        drawMascot(g, x + Math.round((LEFT_W - h * 0.63) / 2), y, h);
      }
    }
  }

  // ---------- HUD ----------

  private digitCache = new Map<string, HTMLCanvasElement>();

  /** Bitmap digit from the sprite sheet, tinted to the readout color. */
  private bitmapDigit(d: number, color: string): HTMLCanvasElement {
    const key = `${d}:${color}`;
    let c = this.digitCache.get(key);
    if (!c) {
      const q = this.quality;
      c = extract('ref', refDigitRect(d), 12 * q, 20 * q, { smooth: q > 1 });
      const g = c.getContext('2d')!;
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = 0.55;
      g.fillStyle = color;
      g.fillRect(0, 0, 12 * q, 20 * q);
      this.digitCache.set(key, c);
    }
    return c;
  }

  /** Chunky LED-segment digit, 12x20 px with 4px strokes. */
  private ledDigit(x: number, y: number, d: number, color: string): void {
    const g = this.g;
    if (sheetsReady()) {
      g.drawImage(this.bitmapDigit(d, color), x, y, 12, 20);
      return;
    }
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
    if (s[0]) g.fillRect(x, y, 12, 4);
    if (s[1]) g.fillRect(x, y, 4, 12);
    if (s[2]) g.fillRect(x + 8, y, 4, 12);
    if (s[3]) g.fillRect(x, y + 8, 12, 4);
    if (s[4]) g.fillRect(x, y + 8, 4, 12);
    if (s[5]) g.fillRect(x + 8, y + 8, 4, 12);
    if (s[6]) g.fillRect(x, y + 16, 12, 4);
  }

  private ledNumber(x: number, y: number, value: number, digits: number, color: string): number {
    const s = Math.max(0, Math.round(value)).toString().padStart(digits, '0').slice(-digits);
    for (let i = 0; i < s.length; i++) this.ledDigit(x + i * 14, y, Number(s[i]), color);
    return x + s.length * 14;
  }

  private label(s: string, x: number, y: number, color: string): number {
    const g = this.g;
    g.font = `bold 16px 'Courier New', monospace`;
    g.textBaseline = 'top';
    g.fillStyle = PAL.black;
    g.fillText(s, x + 2, y + 2);
    g.fillStyle = color;
    g.fillText(s, x, y);
    return x + g.measureText(s).width;
  }

  private inset(x: number, y: number, w: number, h: number): void {
    const g = this.g;
    g.fillStyle = PAL.black;
    g.fillRect(x - 4, y - 4, w + 8, h + 8);
    g.fillStyle = PAL.hudInset;
    g.fillRect(x - 2, y - 2, w + 4, h + 4);
  }

  drawHud(s: HudState): void {
    const g = this.g;
    // Simple flat HUD bar across the top — faithful to the original
    g.fillStyle = PAL.frame;
    g.fillRect(2, 2, this.bufW - 4, HUD_H - 4);
    g.fillStyle = PAL.frameLo;
    g.fillRect(3, 3, this.bufW - 6, HUD_H - 6);
    g.fillStyle = PAL.hudBar;
    g.fillRect(4, 4, this.bufW - 8, HUD_H - 8);
    g.fillStyle = PAL.hudBarHi;
    g.fillRect(4, 4, this.bufW - 8, 2);

    const digY = 10;
    const labY = 12;
    let x = 16;
    x = this.label('P1:', x, labY, PAL.white) + 8;
    this.inset(x, digY, 7 * 14 - 2, 20);
    x = this.ledNumber(x + 2, digY, s.score, 7, PAL.ledYellow) + 20;
    x = this.label('P2:', x, labY, PAL.white) + 8;
    this.inset(x, digY, 7 * 14 - 2, 20);
    this.ledNumber(x + 2, digY, s.score2 ?? 0, 7, PAL.ledGreen);

    // Music chip in the far upper right (clickable), then L and D.
    let rightEdge = this.bufW - 20;
    if (s.musicOn !== undefined) {
      const mw = 30;
      const mx = this.bufW - 12 - mw;
      const my = 8;
      g.fillStyle = PAL.black;
      g.fillRect(mx - 2, my - 2, mw + 4, 28);
      g.fillStyle = s.musicOn ? '#12240f' : '#181c20';
      g.fillRect(mx, my, mw, 24);
      g.strokeStyle = s.musicOn ? PAL.flooz : '#4c5258';
      g.lineWidth = 2;
      g.strokeRect(mx + 1, my + 1, mw - 2, 22);
      g.font = `bold 18px 'Courier New', monospace`;
      g.textBaseline = 'top';
      g.fillStyle = s.musicOn ? PAL.floozHi : '#8a949e';
      g.fillText('♪', mx + 9, my + 2);
      if (!s.musicOn) {
        g.strokeStyle = '#8a949e';
        g.beginPath();
        g.moveTo(mx + 5, my + 20);
        g.lineTo(mx + mw - 5, my + 4);
        g.stroke();
      }
      this.musicSwitch = { x: mx - 2, y: my - 2, w: mw + 4, h: 28 };
      rightEdge = mx - 14;
    } else {
      this.musicSwitch = null;
    }
    const dNumX = rightEdge - 26;
    this.inset(dNumX, digY, 28, 20);
    this.ledNumber(dNumX + 2, digY, s.pipesLeft, 2, PAL.ledBlue);
    this.label('D:', dNumX - 30, labY, PAL.white);
    const lNumX = dNumX - 30 - 20 - 26;
    this.inset(lNumX, digY, 28, 20);
    if (typeof s.level === 'number') {
      this.ledNumber(lNumX + 2, digY, s.level, 2, PAL.ledBlue);
    } else {
      this.label('BN', lNumX + 4, labY, PAL.ledBlue);
    }
    this.label('L:', lNumX - 30, labY, PAL.white);

    // RIGHT-hand vertical flooz timer bar (original Amiga position)
    const bx = this.bufW - GAP - BAR_W;
    const by = HUD_H + GAP;
    const bh = this.bufH - by - GAP;
    g.fillStyle = PAL.frame;
    g.fillRect(bx + 2, by, BAR_W - 4, bh);
    g.fillRect(bx, by + 2, BAR_W, bh - 4);
    g.fillStyle = PAL.frameLo;
    g.fillRect(bx + BAR_W - 4, by + 2, 2, bh - 4);
    g.fillRect(bx + 2, by + bh - 4, BAR_W - 4, 2);
    g.fillStyle = PAL.black;
    g.fillRect(bx + 6, by + 6, BAR_W - 12, bh - 12);
    if (s.countdownFrac > 0) {
      const fh = Math.round((bh - 20) * Math.min(1, s.countdownFrac));
      g.fillStyle = PAL.red;
      g.fillRect(bx + 10, by + 10 + (bh - 20 - fh), BAR_W - 20, fh);
      g.fillStyle = PAL.hudBarHi;
      g.fillRect(bx + 10, by + 10 + (bh - 20 - fh), 2, fh);
    } else {
      const fh = Math.round((bh - 20) * Math.min(1, s.progressFrac));
      g.fillStyle = PAL.flooz;
      g.fillRect(bx + 10, by + 10 + (bh - 20 - fh), BAR_W - 20, fh);
      g.fillStyle = PAL.floozHi;
      g.fillRect(bx + 10, by + 10 + (bh - 20 - fh), 2, fh);
    }

    if (s.fastFlow && s.countdownFrac <= 0) {
      this.label('FAST', bx - 52, this.bufH - 24, PAL.ledYellow);
    }
    if (s.replay && Math.floor(this.frameCount / 30) % 2 === 0) {
      this.label('▶ REPLAY', this.boardX + 8, HUD_H + 8, PAL.red);
    }
    if (s.paused) {
      const cx = this.boardX + (this.level.gridW * CELL) / 2;
      const cy = this.boardY + (this.level.gridH * CELL) / 2;
      g.fillStyle = PAL.black;
      g.fillRect(cx - 68, cy - 16, 136, 32);
      g.fillStyle = PAL.frame;
      g.fillRect(cx - 66, cy - 14, 132, 28);
      g.fillStyle = PAL.hudInset;
      g.fillRect(cx - 62, cy - 10, 124, 20);
      this.label('PAUSED', cx - 36, cy - 8, PAL.ledYellow);
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
      const sp = 28 + Math.random() * 44;
      this.particles.push({
        x: o.x + CELL / 2,
        y: o.y + CELL / 2,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 36,
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
      p.vy += 120 * (dtMs / 1000);
      p.x += p.vx * (dtMs / 1000);
      p.y += p.vy * (dtMs / 1000);
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), 4, 4);
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
      g2.font = `bold 16px 'Courier New', monospace`;
      g2.textBaseline = 'top';
      g2.fillStyle = PAL.black;
      g2.fillText(p.text, p.x - p.text.length * 5 + 2, p.y - t * 24 + 2);
      g2.fillStyle = p.color;
      g2.fillText(p.text, p.x - p.text.length * 5, p.y - t * 24);
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
    g.imageSmoothingEnabled = this.mode === 'smooth';
    if (this.mode === 'smooth') g.imageSmoothingQuality = 'high';
    g.drawImage(
      this.buffer,
      this.offX,
      this.offY,
      this.bufW * this.scale,
      this.bufH * this.scale,
    );
  }
}
