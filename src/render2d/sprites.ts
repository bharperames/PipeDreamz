import { Dir, PieceKind } from '../core/types';

/**
 * Original pixel-art piece sprites drawn in code, in the spirit of the
 * chunky 16-color look of 1989 Amiga puzzlers. Cell sprites are 24x24
 * internal pixels; the whole framebuffer is integer-upscaled with
 * nearest-neighbor sampling for the authentic look.
 */

export const CELL = 24;

export const PAL = {
  bg: '#20262b',
  boardDark: '#2c353c',
  boardLight: '#333d45',
  frame: '#55636e',
  frameHi: '#7c8b96',
  frameLo: '#39434b',
  outline: '#14181c',
  pipe: '#98a4ae',
  pipeHi: '#d6dee4',
  pipeLo: '#5c6872',
  flooz: '#28c62c',
  floozHi: '#8af07e',
  floozLo: '#158a1c',
  gold: '#e0b23c',
  goldLo: '#8a6a18',
  green: '#3fae4e',
  red: '#c8483c',
  blue: '#6f86c8',
  concrete: '#68625a',
  concreteLo: '#443f39',
  white: '#f0f2f0',
} as const;

/** Point on a channel's flow path (cell-local 0..CELL coords). */
export function pathPoint(kind: PieceKind, channelIdx: number, t: number): { x: number; y: number } {
  const c = CELL / 2;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  // Edge midpoints: N (c,0)  E (CELL,c)  S (c,CELL)  W (0,c)
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    const a = a0 + (a1 - a0) * t;
    return { x: cx + c * Math.cos(a), y: cy + c * Math.sin(a) };
  };
  switch (kind) {
    case 'H': case 'RESERVOIR_H': case 'ONEWAY_E':
      return { x: lerp(0, CELL), y: c };
    case 'ONEWAY_W':
      return { x: lerp(CELL, 0), y: c };
    case 'V': case 'RESERVOIR_V': case 'ONEWAY_S':
      return { x: c, y: lerp(0, CELL) };
    case 'ONEWAY_N':
      return { x: c, y: lerp(CELL, 0) };
    case 'NE': return arc(CELL, 0, Math.PI, Math.PI / 2);
    case 'NW': return arc(0, 0, 0, Math.PI / 2);
    case 'SE': return arc(CELL, CELL, Math.PI, 1.5 * Math.PI);
    case 'SW': return arc(0, CELL, 0, -Math.PI / 2);
    case 'X': case 'BONUS':
      return channelIdx === 0 ? { x: c, y: lerp(0, CELL) } : { x: lerp(0, CELL), y: c };
    default:
      return { x: c, y: c };
  }
}

function strokePath(
  g: CanvasRenderingContext2D,
  kind: PieceKind,
  ch: number,
  width: number,
  color: string,
): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'butt';
  g.beginPath();
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const p = pathPoint(kind, ch, i / steps);
    if (i === 0) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  g.stroke();
}

/** Pipe body along a channel: outline, steel fill, top highlight. */
function pipeBody(g: CanvasRenderingContext2D, kind: PieceKind, ch: number, steel: string = PAL.pipe): void {
  strokePath(g, kind, ch, 13, PAL.outline);
  strokePath(g, kind, ch, 11, PAL.pipeLo);
  strokePath(g, kind, ch, 8, steel);
  strokePath(g, kind, ch, 3, PAL.pipeHi);
}

/** Flange collars at the open cell edges. */
function flange(g: CanvasRenderingContext2D, side: Dir): void {
  g.fillStyle = PAL.outline;
  const w = 17;
  const t = 4;
  const c = CELL / 2;
  const draw = (x: number, y: number, fw: number, fh: number) => {
    g.fillRect(x - 1, y - 1, fw + 2, fh + 2);
    g.fillStyle = PAL.pipeLo;
    g.fillRect(x, y, fw, fh);
    g.fillStyle = PAL.pipeHi;
    g.fillRect(x, y, fw, 1);
  };
  if (side === 0) draw(c - w / 2, 0, w, t);
  if (side === 2) draw(c - w / 2, CELL - t, w, t);
  if (side === 3) draw(0, c - w / 2, t, w);
  if (side === 1) draw(CELL - t, c - w / 2, t, w);
}

function flangesFor(kind: PieceKind): Dir[] {
  switch (kind) {
    case 'H': case 'ONEWAY_E': case 'ONEWAY_W': case 'RESERVOIR_H': return [1, 3];
    case 'V': case 'ONEWAY_N': case 'ONEWAY_S': case 'RESERVOIR_V': return [0, 2];
    case 'NE': return [0, 1];
    case 'NW': return [0, 3];
    case 'SE': return [1, 2];
    case 'SW': return [2, 3];
    case 'X': case 'BONUS': return [0, 1, 2, 3];
    default: return [];
  }
}

function arrow(g: CanvasRenderingContext2D, dir: Dir, color: string): void {
  const c = CELL / 2;
  g.fillStyle = color;
  g.save();
  g.translate(c, c);
  g.rotate((Math.PI / 2) * dir); // 0=N up
  g.beginPath();
  g.moveTo(0, -5);
  g.lineTo(4, 1);
  g.lineTo(1, 1);
  g.lineTo(1, 5);
  g.lineTo(-1, 5);
  g.lineTo(-1, 1);
  g.lineTo(-4, 1);
  g.closePath();
  g.fill();
  g.restore();
}

/** Draw one piece sprite into a 24x24 context at origin. */
export function drawPiece(g: CanvasRenderingContext2D, kind: PieceKind, startExit?: Dir): void {
  switch (kind) {
    case 'OBSTACLE': {
      g.fillStyle = PAL.outline;
      g.fillRect(1, 1, 22, 22);
      g.fillStyle = PAL.concrete;
      g.fillRect(2, 2, 20, 20);
      g.fillStyle = PAL.concreteLo;
      // brick joints
      g.fillRect(2, 8, 20, 1);
      g.fillRect(2, 15, 20, 1);
      g.fillRect(11, 2, 1, 6);
      g.fillRect(6, 9, 1, 6);
      g.fillRect(16, 9, 1, 6);
      g.fillRect(11, 16, 1, 6);
      g.fillStyle = '#7d766c';
      g.fillRect(2, 2, 20, 1);
      break;
    }
    case 'START': {
      g.fillStyle = PAL.outline;
      g.fillRect(2, 2, 20, 20);
      g.fillStyle = PAL.green;
      g.fillRect(3, 3, 18, 18);
      g.fillStyle = '#6fd47e';
      g.fillRect(3, 3, 18, 2);
      // spout toward exit
      if (startExit !== undefined) {
        g.save();
        pipeBody(g, (['ONEWAY_N', 'ONEWAY_E', 'ONEWAY_S', 'ONEWAY_W'] as const)[startExit]!, 0);
        g.restore();
        // Cover the non-exit half with housing again
        g.fillStyle = PAL.green;
        const c = CELL / 2;
        if (startExit === 1) g.fillRect(3, 3, c - 3, 18);
        if (startExit === 3) g.fillRect(c, 3, c - 3 + 3, 18);
        if (startExit === 2) g.fillRect(3, 3, 18, c - 3);
        if (startExit === 0) g.fillRect(3, c, 18, c - 3 + 3);
        arrow(g, startExit, PAL.white);
      }
      break;
    }
    case 'END': {
      g.fillStyle = PAL.outline;
      g.fillRect(2, 2, 20, 20);
      g.fillStyle = PAL.red;
      g.fillRect(3, 3, 18, 18);
      g.fillStyle = '#e08a80';
      g.fillRect(3, 3, 18, 2);
      g.fillStyle = PAL.white;
      g.fillRect(10, 7, 5, 2);
      g.fillRect(10, 7, 2, 10);
      g.fillRect(10, 11, 4, 2);
      g.fillRect(10, 15, 5, 2);
      break;
    }
    case 'X': case 'BONUS': {
      const steel = kind === 'BONUS' ? PAL.gold : PAL.pipe;
      // horizontal under, vertical over (matches flow overpass)
      pipeBody(g, kind, 1, steel);
      pipeBody(g, kind, 0, steel);
      for (const d of flangesFor(kind)) flange(g, d);
      if (kind === 'BONUS') {
        g.fillStyle = PAL.goldLo;
        g.fillRect(10, 10, 4, 4);
        g.fillStyle = PAL.gold;
        g.fillRect(11, 9, 2, 6);
        g.fillRect(9, 11, 6, 2);
      }
      break;
    }
    default: {
      const oneWay = kind.startsWith('ONEWAY');
      const reservoir = kind.startsWith('RESERVOIR');
      pipeBody(g, kind, 0, oneWay ? '#b0a878' : PAL.pipe);
      if (reservoir) {
        // bulging tank in the middle
        g.fillStyle = PAL.outline;
        g.beginPath();
        g.arc(12, 12, 9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = PAL.blue;
        g.beginPath();
        g.arc(12, 12, 8, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#9daede';
        g.fillRect(8, 6, 6, 2);
      }
      for (const d of flangesFor(kind)) flange(g, d);
      if (oneWay) {
        const dir = (['ONEWAY_N', 'ONEWAY_E', 'ONEWAY_S', 'ONEWAY_W'].indexOf(kind)) as Dir;
        arrow(g, dir, PAL.outline);
      }
      break;
    }
  }
}

const spriteCache = new Map<string, HTMLCanvasElement>();

export function pieceSprite(kind: PieceKind, startExit?: Dir): HTMLCanvasElement {
  const key = `${kind}:${startExit ?? ''}`;
  let c = spriteCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    drawPiece(c.getContext('2d')!, kind, startExit);
    spriteCache.set(key, c);
  }
  return c;
}

/**
 * Draw flooz along a channel up to `progress`, as a fat green line with a
 * bright core — drawn over the pipe body so the pipe reads as filling up.
 */
export function drawFlooz(
  g: CanvasRenderingContext2D,
  kind: PieceKind,
  ch: number,
  progress: number,
  reversed: boolean,
): void {
  if (progress <= 0) return;
  const steps = Math.max(2, Math.ceil(16 * progress));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * progress;
    pts.push(pathPoint(kind, ch, reversed ? 1 - t : t));
  }
  const stroke = (w: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.lineCap = 'butt';
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
  };
  stroke(7, PAL.floozLo);
  stroke(5, PAL.flooz);
  stroke(2, PAL.floozHi);
  // Reservoir bowl fills visually once the flow passes the middle.
  if (kind.startsWith('RESERVOIR') && progress > 0.35) {
    const f = Math.min(1, (progress - 0.35) / 0.4);
    g.fillStyle = PAL.flooz;
    g.beginPath();
    g.arc(12, 12, 7 * f, 0, Math.PI * 2);
    g.fill();
  }
}
