import { Dir, PieceKind } from '../core/types';

/**
 * Original pixel-art sprites drawn in code, styled after the visual
 * language of 1989 Amiga pipe puzzlers: rust-red pipes with a dark shadow
 * band and hot highlight, riveted grey plate tiles with diagonal braces,
 * and bright yellow flooz. Cell sprites are 24x24 internal pixels; the
 * framebuffer is integer-upscaled with nearest-neighbor sampling.
 */

export const CELL = 24;

export const PAL = {
  black: '#0c0c0e',
  // plates
  plate: '#8e959d',
  plateHi: '#bfc6cd',
  plateLo: '#575d64',
  plateBrace: '#7a818a',
  obstacle: '#4e545c',
  obstacleHi: '#6d747d',
  obstacleLo: '#33383e',
  // pipes
  pipeDark: '#5e1810',
  pipeBody: '#a03222',
  pipeMid: '#c24a2a',
  pipeHi: '#e87c46',
  collar: '#b8bec4',
  collarLo: '#6b7178',
  // flooz
  floozEdge: '#7a6408',
  flooz: '#eed222',
  floozHi: '#faf3a2',
  // hud
  hudBar: '#701c14',
  hudBarHi: '#a03428',
  hudInset: '#101012',
  ledYellow: '#f2d022',
  ledGreen: '#3ee04c',
  ledBlue: '#4c8cf0',
  // misc
  frame: '#9aa1a8',
  frameLo: '#4c5258',
  housing: '#2c50b4',
  housingHi: '#5a7ade',
  white: '#f2f4f2',
  red: '#d03828',
  gold: '#e0b23c',
} as const;

/** Point on a channel's flow path (cell-local 0..CELL coords). */
export function pathPoint(kind: PieceKind, channelIdx: number, t: number): { x: number; y: number } {
  const c = CELL / 2;
  const lerp = (a: number, b: number) => a + (b - a) * t;
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
  offY = 0,
): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'butt';
  g.beginPath();
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const p = pathPoint(kind, ch, i / steps);
    if (i === 0) g.moveTo(p.x, p.y + offY);
    else g.lineTo(p.x, p.y + offY);
  }
  g.stroke();
}

/**
 * Rust pipe body: black outline, deep-red shadow, red body, hot highlight
 * offset toward the light (up-left), like the chunky Amiga pipes.
 */
function pipeBody(g: CanvasRenderingContext2D, kind: PieceKind, ch: number, gold = false): void {
  strokePath(g, kind, ch, 16, PAL.black);
  strokePath(g, kind, ch, 14, gold ? '#6a5410' : PAL.pipeDark);
  strokePath(g, kind, ch, 11, gold ? '#b08a1c' : PAL.pipeBody, 1);
  strokePath(g, kind, ch, 7, gold ? '#d8b23c' : PAL.pipeMid, -1);
  strokePath(g, kind, ch, 3, gold ? '#f2dc7a' : PAL.pipeHi, -2);
}

/** Grey collar flanges at the open cell edges. */
function flange(g: CanvasRenderingContext2D, side: Dir): void {
  const w = 20;
  const t = 4;
  const c = CELL / 2;
  const draw = (x: number, y: number, fw: number, fh: number, horizontal: boolean) => {
    g.fillStyle = PAL.black;
    g.fillRect(x - 1, y - 1, fw + 2, fh + 2);
    g.fillStyle = PAL.collarLo;
    g.fillRect(x, y, fw, fh);
    g.fillStyle = PAL.collar;
    if (horizontal) g.fillRect(x, y, fw, 2);
    else g.fillRect(x, y, 2, fh);
  };
  if (side === 0) draw(c - w / 2, 0, w, t, true);
  if (side === 2) draw(c - w / 2, CELL - t, w, t, true);
  if (side === 3) draw(0, c - w / 2, t, w, false);
  if (side === 1) draw(CELL - t, c - w / 2, t, w, false);
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
  g.rotate((Math.PI / 2) * dir);
  g.beginPath();
  g.moveTo(0, -6);
  g.lineTo(5, 1);
  g.lineTo(2, 1);
  g.lineTo(2, 6);
  g.lineTo(-2, 6);
  g.lineTo(-2, 1);
  g.lineTo(-5, 1);
  g.closePath();
  g.fill();
  g.restore();
}

/** Blue machine housing used by start/end pieces. */
function housing(g: CanvasRenderingContext2D): void {
  g.fillStyle = PAL.black;
  g.fillRect(1, 1, 22, 22);
  g.fillStyle = PAL.housing;
  g.fillRect(2, 2, 20, 20);
  g.fillStyle = PAL.housingHi;
  g.fillRect(2, 2, 20, 2);
  g.fillRect(2, 2, 2, 20);
  g.fillStyle = '#1c3478';
  g.fillRect(20, 4, 2, 18);
  g.fillRect(4, 20, 18, 2);
}

/** Chunky 5x7 letter for S / E labels. */
function letter(g: CanvasRenderingContext2D, ch: 'S' | 'E', x: number, y: number, color: string): void {
  g.fillStyle = color;
  const rows =
    ch === 'S'
      ? [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110]
      : [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111];
  rows.forEach((bits, ry) => {
    for (let rx = 0; rx < 5; rx++) {
      if (bits & (1 << (4 - rx))) g.fillRect(x + rx, y + ry, 1, 1);
    }
  });
}

/** Draw one piece sprite into a 24x24 context at origin. */
export function drawPiece(g: CanvasRenderingContext2D, kind: PieceKind, startExit?: Dir): void {
  switch (kind) {
    case 'OBSTACLE': {
      // Dark plate with a heavy riveted X brace — clearly impassable.
      g.fillStyle = PAL.obstacleLo;
      g.fillRect(0, 0, CELL, CELL);
      g.fillStyle = PAL.obstacle;
      g.fillRect(1, 1, CELL - 2, CELL - 2);
      g.strokeStyle = PAL.obstacleHi;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(2, 2); g.lineTo(CELL - 2, CELL - 2);
      g.moveTo(CELL - 2, 2); g.lineTo(2, CELL - 2);
      g.stroke();
      g.strokeStyle = PAL.obstacleLo;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(3, 4); g.lineTo(CELL - 1, CELL);
      g.moveTo(CELL - 1, 4); g.lineTo(3, CELL);
      g.stroke();
      g.fillStyle = PAL.obstacleHi;
      for (const [rx, ry] of [[3, 3], [18, 3], [3, 18], [18, 18]] as const) {
        g.fillRect(rx, ry, 2, 2);
      }
      break;
    }
    case 'START': {
      housing(g);
      if (startExit !== undefined) {
        const spoutKind = (['ONEWAY_N', 'ONEWAY_E', 'ONEWAY_S', 'ONEWAY_W'] as const)[startExit]!;
        pipeBody(g, spoutKind, 0);
        // Re-cover the inner half with housing so the spout only pokes out.
        g.fillStyle = PAL.housing;
        const c = CELL / 2;
        if (startExit === 1) g.fillRect(2, 2, c - 2, 20);
        if (startExit === 3) g.fillRect(c, 2, 22 - c, 20);
        if (startExit === 2) g.fillRect(2, 2, 20, c - 2);
        if (startExit === 0) g.fillRect(2, c, 20, 22 - c);
        g.fillStyle = PAL.housingHi;
        g.fillRect(2, 2, 20, 2);
        g.fillRect(2, 2, 2, 20);
      }
      letter(g, 'S', 9, 8, PAL.ledYellow);
      break;
    }
    case 'END': {
      housing(g);
      letter(g, 'E', 9, 8, PAL.ledYellow);
      break;
    }
    case 'X': case 'BONUS': {
      const gold = kind === 'BONUS';
      pipeBody(g, kind, 1, gold); // horizontal under
      pipeBody(g, kind, 0, gold); // vertical over
      for (const d of flangesFor(kind)) flange(g, d);
      break;
    }
    default: {
      const oneWay = kind.startsWith('ONEWAY');
      const reservoir = kind.startsWith('RESERVOIR');
      pipeBody(g, kind, 0);
      if (reservoir) {
        g.fillStyle = PAL.black;
        g.beginPath();
        g.arc(12, 12, 10, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = PAL.pipeBody;
        g.beginPath();
        g.arc(12, 12, 9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = PAL.pipeMid;
        g.beginPath();
        g.arc(11, 11, 7, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = PAL.pipeHi;
        g.fillRect(8, 6, 5, 2);
      }
      for (const d of flangesFor(kind)) flange(g, d);
      if (oneWay) {
        const dir = (['ONEWAY_N', 'ONEWAY_E', 'ONEWAY_S', 'ONEWAY_W'].indexOf(kind)) as Dir;
        arrow(g, dir, PAL.white);
      }
      break;
    }
  }
}

/** Background plate tile with diagonal brace relief (the empty-cell look). */
export function drawPlate(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = PAL.plate;
  g.fillRect(x, y, CELL, CELL);
  // bevel
  g.fillStyle = PAL.plateHi;
  g.fillRect(x, y, CELL, 1);
  g.fillRect(x, y, 1, CELL);
  g.fillStyle = PAL.plateLo;
  g.fillRect(x, y + CELL - 1, CELL, 1);
  g.fillRect(x + CELL - 1, y, 1, CELL);
  // diagonal braces
  g.strokeStyle = PAL.plateBrace;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x + 2, y + 2); g.lineTo(x + CELL - 2, y + CELL - 2);
  g.moveTo(x + CELL - 2, y + 2); g.lineTo(x + 2, y + CELL - 2);
  g.stroke();
  g.strokeStyle = PAL.plateHi;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + 2, y + 1); g.lineTo(x + CELL - 3, y + CELL - 4);
  g.moveTo(x + CELL - 3, y + 1); g.lineTo(x + 2, y + CELL - 4);
  g.stroke();
  // corner rivets
  g.fillStyle = PAL.plateLo;
  for (const [rx, ry] of [[2, 2], [CELL - 4, 2], [2, CELL - 4], [CELL - 4, CELL - 4]] as const) {
    g.fillRect(x + rx, y + ry, 2, 2);
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
 * Draw flooz along a channel up to `progress`: bright yellow with a dark
 * edge, riding inside the pipe like the original's liquid.
 */
export function drawFlooz(
  g: CanvasRenderingContext2D,
  kind: PieceKind,
  ch: number,
  progress: number,
  reversed: boolean,
): void {
  if (progress <= 0) return;
  const steps = Math.max(2, Math.ceil(20 * progress));
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
  stroke(9, PAL.floozEdge);
  stroke(7, PAL.flooz);
  stroke(3, PAL.floozHi);
  if (kind.startsWith('RESERVOIR') && progress > 0.35) {
    const f = Math.min(1, (progress - 0.35) / 0.4);
    g.fillStyle = PAL.flooz;
    g.beginPath();
    g.arc(12, 12, 8 * f, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PAL.floozHi;
    g.beginPath();
    g.arc(10, 10, 3 * f, 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * Original mascot: a stubby hard-hat plumber clutching a wrench, drawn
 * from scratch (not a recreation of any existing game character).
 */
export function drawMascot(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.save();
  g.translate(x, y);
  // boots
  g.fillStyle = '#3a3026';
  g.fillRect(6, 40, 8, 4);
  g.fillRect(18, 40, 8, 4);
  // overalls
  g.fillStyle = '#2c50b4';
  g.fillRect(7, 26, 18, 14);
  g.fillStyle = '#1c3478';
  g.fillRect(7, 38, 18, 2);
  g.fillRect(14, 26, 4, 8);
  // shirt + arms
  g.fillStyle = '#c8442c';
  g.fillRect(5, 22, 22, 6);
  g.fillRect(3, 24, 4, 8);
  g.fillRect(25, 24, 4, 8);
  // hands
  g.fillStyle = '#e8b088';
  g.fillRect(3, 32, 4, 3);
  g.fillRect(25, 32, 4, 3);
  // head
  g.fillStyle = '#e8b088';
  g.fillRect(9, 10, 14, 12);
  // eyes + grin
  g.fillStyle = PAL.black;
  g.fillRect(12, 14, 2, 3);
  g.fillRect(18, 14, 2, 3);
  g.fillRect(12, 19, 8, 1);
  // hard hat
  g.fillStyle = PAL.ledYellow;
  g.fillRect(8, 5, 16, 6);
  g.fillRect(6, 9, 20, 2);
  g.fillStyle = '#b09010';
  g.fillRect(6, 10, 20, 1);
  // wrench in right hand
  g.fillStyle = '#9aa1a8';
  g.fillRect(27, 24, 3, 10);
  g.fillRect(25, 22, 7, 3);
  g.fillStyle = '#575d64';
  g.fillRect(27, 23, 3, 1);
  g.restore();
}
