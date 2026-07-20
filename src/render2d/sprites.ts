import { Dir, PieceKind } from '../core/types';
import {
  extract,
  ExtractOpts,
  LATTICE_CLEAN_CELLS,
  latticeCellRect,
  pipeCellRect,
  Rect,
  REF,
  SheetId,
  sheetsReady,
} from './sheet';

/**
 * Original pixel-art sprites drawn in code, styled after the visual
 * language of 1989 Amiga pipe puzzlers: rust-red pipes with a dark shadow
 * band and hot highlight, riveted grey plate tiles with diagonal braces,
 * and bright yellow flooz. Cell sprites are 48x48 internal pixels (2× the
 * original 24px); the framebuffer is integer-upscaled with nearest-neighbor.
 *
 * Elbows use sharp right-angle bends (not smooth arcs) to match the
 * geometric pipe look of the original game.
 */

export const CELL = 48;

export const PAL = {
  black: '#0c0c0e',
  // plates — darkened for contrast against red pipes
  plate: '#585e66',
  plateFace: '#484e56',
  plateHi: '#787e86',
  plateLo: '#282c32',
  plateBrace: '#606870',
  plateBraceLo: '#282e36',
  plateGroove: '#181c22',
  obstacle: '#383e46',
  obstacleHi: '#585e66',
  obstacleLo: '#1e2228',
  // pipes — rust-red (faithful to the original Amiga game)
  pipeDark: '#3a0c08',
  pipeBody: '#8e2410',
  pipeMid: '#c84c20',
  pipeHi: '#f09050',
  pipeGlint: '#f8c088',
  collar: '#b8bec4',
  collarLo: '#6b7178',
  // flooz — radioactive green, matching the glass/brass asset sheets
  floozEdge: '#1a7a1c',
  flooz: '#4ce03c',
  floozHi: '#c8ffb0',
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

/**
 * Point on a channel's flow path (cell-local 0..CELL coords).
 *
 * Elbows use sharp right-angle segments (two straight lines meeting at
 * the cell center) rather than smooth arcs, matching the geometric
 * pipe style of the original 1989 game.
 */
export function pathPoint(kind: PieceKind, channelIdx: number, t: number): { x: number; y: number } {
  const c = CELL / 2;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  switch (kind) {
    case 'H': case 'RESERVOIR_H': case 'ONEWAY_E':
      return { x: lerp(0, CELL), y: c };
    case 'ONEWAY_W':
      return { x: lerp(CELL, 0), y: c };
    case 'V': case 'RESERVOIR_V': case 'ONEWAY_S':
      return { x: c, y: lerp(0, CELL) };
    case 'ONEWAY_N':
      return { x: c, y: lerp(CELL, 0) };
    // Fitting-style elbows (v3): two straight segments meeting at center.
    case 'NE':
      if (t <= 0.5) return { x: c, y: t * 2 * c };
      return { x: c + (t - 0.5) * 2 * c, y: c };
    case 'NW':
      if (t <= 0.5) return { x: c, y: t * 2 * c };
      return { x: c - (t - 0.5) * 2 * c, y: c };
    case 'SE':
      if (t <= 0.5) return { x: c, y: CELL - t * 2 * c };
      return { x: c + (t - 0.5) * 2 * c, y: c };
    case 'SW':
      if (t <= 0.5) return { x: c, y: CELL - t * 2 * c };
      return { x: c - (t - 0.5) * 2 * c, y: c };
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
  g.lineJoin = 'miter';
  g.miterLimit = 10;
  g.beginPath();
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const p = pathPoint(kind, ch, i / steps);
    if (i === 0) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  g.stroke();
}

/**
 * Rust pipe body drawn as concentric color bands: black outline, dark
 * shadow edge, flat red body, lighter band, hot highlight, and a thin
 * bright glint at center. Sharp miter joins at right-angle bends.
 */
function pipeBody(g: CanvasRenderingContext2D, kind: PieceKind, ch: number, gold = false): void {
  strokePath(g, kind, ch, 24, PAL.black);
  strokePath(g, kind, ch, 20, gold ? '#4c3c0a' : PAL.pipeDark);
  strokePath(g, kind, ch, 16, gold ? '#9c7814' : PAL.pipeBody);
  strokePath(g, kind, ch, 10, gold ? '#cca428' : PAL.pipeMid);
  strokePath(g, kind, ch, 4, gold ? '#f0d060' : PAL.pipeHi);
  strokePath(g, kind, ch, 2, gold ? '#f8e890' : PAL.pipeGlint);
}

/** Grey collar flanges at the open cell edges, wider than the pipe. */
function flange(g: CanvasRenderingContext2D, side: Dir): void {
  const w = 30;
  const t = 8;
  const c = CELL / 2;
  const draw = (x: number, y: number, fw: number, fh: number, horizontal: boolean) => {
    g.fillStyle = PAL.black;
    g.fillRect(x - 2, y - 2, fw + 4, fh + 4);
    g.fillStyle = PAL.collarLo;
    g.fillRect(x, y, fw, fh);
    g.fillStyle = PAL.collar;
    if (horizontal) {
      g.fillRect(x, y, fw, 3);
      g.fillStyle = PAL.white;
      g.fillRect(x + 2, y, fw - 4, 1);
    } else {
      g.fillRect(x, y, 3, fh);
      g.fillStyle = PAL.white;
      g.fillRect(x, y + 2, 1, fh - 4);
    }
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
  g.moveTo(0, -12);
  g.lineTo(10, 2);
  g.lineTo(4, 2);
  g.lineTo(4, 12);
  g.lineTo(-4, 12);
  g.lineTo(-4, 2);
  g.lineTo(-10, 2);
  g.closePath();
  g.fill();
  g.restore();
}

/**
 * Compact blue machine housing used by start/end pieces — sits on the
 * plate rather than filling the whole cell, like the reference's S block.
 */
function housing(g: CanvasRenderingContext2D): void {
  // rounded valve block with corner bolts
  g.fillStyle = PAL.black;
  g.fillRect(8, 6, 32, 36);
  g.fillRect(6, 8, 36, 32);
  g.fillStyle = PAL.housing;
  g.fillRect(10, 8, 28, 32);
  g.fillRect(8, 10, 32, 28);
  g.fillStyle = PAL.housingHi;
  g.fillRect(10, 8, 28, 4);
  g.fillRect(8, 10, 4, 28);
  g.fillStyle = '#1c3478';
  g.fillRect(36, 12, 4, 26);
  g.fillRect(12, 36, 26, 4);
  g.fillStyle = '#8ea6ec';
  for (const [bx, by] of [[10, 10], [36, 10], [10, 36], [36, 36]] as const) {
    g.fillRect(bx, by, 2, 2);
  }
}

/** Chunky 5x7 letter for S / E labels, doubled to 10x14. */
function letter(g: CanvasRenderingContext2D, ch: 'S' | 'E', x: number, y: number, color: string): void {
  g.fillStyle = color;
  const rows =
    ch === 'S'
      ? [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110]
      : [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111];
  rows.forEach((bits, ry) => {
    for (let rx = 0; rx < 5; rx++) {
      if (bits & (1 << (4 - rx))) g.fillRect(x + rx * 2, y + ry * 2, 2, 2);
    }
  });
}

/** Draw one piece sprite into a 48x48 context at origin. */
export function drawPiece(g: CanvasRenderingContext2D, kind: PieceKind, startExit?: Dir): void {
  switch (kind) {
    case 'OBSTACLE': {
      // Dark plate with a heavy raised X brace — clearly impassable.
      g.fillStyle = PAL.plateGroove;
      g.fillRect(0, 0, CELL, CELL);
      g.fillStyle = PAL.obstacle;
      g.fillRect(2, 2, CELL - 4, CELL - 4);
      g.fillStyle = PAL.obstacleHi;
      g.fillRect(2, 2, CELL - 4, 2);
      g.fillRect(2, 2, 2, CELL - 4);
      g.fillStyle = PAL.obstacleLo;
      g.fillRect(2, CELL - 4, CELL - 4, 2);
      g.fillRect(CELL - 4, 2, 2, CELL - 4);
      g.strokeStyle = PAL.obstacleLo;
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(6, 6); g.lineTo(CELL - 6, CELL - 6);
      g.moveTo(CELL - 6, 6); g.lineTo(6, CELL - 6);
      g.stroke();
      g.strokeStyle = PAL.obstacleHi;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(6, 6); g.lineTo(CELL - 8, CELL - 8);
      g.moveTo(CELL - 8, 6); g.lineTo(6, CELL - 8);
      g.stroke();
      break;
    }
    case 'START': {
      // Draw housing first, then pipe spout ON TOP so exit direction is clearly visible
      housing(g);
      letter(g, 'S', 17, 15, PAL.ledYellow);
      if (startExit !== undefined) {
        const spoutKind = (['ONEWAY_N', 'ONEWAY_E', 'ONEWAY_S', 'ONEWAY_W'] as const)[startExit]!;
        // Draw spout pipe from housing edge to cell edge (on top of housing)
        g.save();
        g.beginPath();
        const c = CELL / 2;
        // Clip to exit side only, starting just past center
        const inset = 6; // slight overlap onto housing for visual connection
        if (startExit === 0) g.rect(0, 0, CELL, c - inset);
        if (startExit === 1) g.rect(c + inset, 0, c - inset, CELL);
        if (startExit === 2) g.rect(0, c + inset, CELL, c - inset);
        if (startExit === 3) g.rect(0, 0, c - inset, CELL);
        g.clip();
        pipeBody(g, spoutKind, 0);
        g.restore();
        flange(g, startExit);
        // Bright directional arrow on the housing showing exit direction
        g.fillStyle = PAL.ledYellow;
        g.save();
        g.translate(c, c);
        g.rotate((Math.PI / 2) * startExit);
        // Arrow pointing upward (direction 0=N), rotated for actual exit
        g.beginPath();
        g.moveTo(0, -16);
        g.lineTo(8, -4);
        g.lineTo(3, -4);
        g.lineTo(3, 4);
        g.lineTo(-3, 4);
        g.lineTo(-3, -4);
        g.lineTo(-8, -4);
        g.closePath();
        g.fill();
        // Dark outline for arrow
        g.strokeStyle = PAL.black;
        g.lineWidth = 2;
        g.stroke();
        g.restore();
      }
      break;
    }
    case 'END': {
      housing(g);
      letter(g, 'E', 17, 15, PAL.ledYellow);
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
        g.arc(24, 24, 18, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = PAL.pipeBody;
        g.beginPath();
        g.arc(24, 24, 16, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = PAL.pipeMid;
        g.beginPath();
        g.arc(22, 22, 12, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = PAL.pipeHi;
        g.fillRect(16, 14, 8, 4);
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

/**
 * Background plate tile: dark groove between cells, beveled frame strip,
 * recessed face with thin diagonal X braces ending in corner pads.
 * Faithful to the original Amiga tile pattern at 2× resolution.
 */
let plateBitmaps: HTMLCanvasElement[] | null = null;

export function drawPlate(g: CanvasRenderingContext2D, x: number, y: number): void {
  if (sheetsReady()) {
    if (!plateBitmaps) {
      // Dark girder-lattice background cells; a few variants for texture.
      plateBitmaps = LATTICE_CLEAN_CELLS.map(([c, r]) =>
        extract('lattice', latticeCellRect(c, r), CELL * QUALITY, CELL * QUALITY, {
          smooth: QUALITY > 1,
        }),
      );
    }
    // Deterministic per-cell variant so the board doesn't shimmer.
    const idx = Math.abs((x * 7 + y * 13) | 0) % plateBitmaps.length;
    g.drawImage(plateBitmaps[idx]!, x, y, CELL, CELL);
    return;
  }
  // groove between plates
  g.fillStyle = PAL.plateGroove;
  g.fillRect(x, y, CELL, CELL);
  // frame strip with bevel
  g.fillStyle = PAL.plate;
  g.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
  g.fillStyle = PAL.plateHi;
  g.fillRect(x + 2, y + 2, CELL - 4, 2);
  g.fillRect(x + 2, y + 2, 2, CELL - 4);
  g.fillStyle = PAL.plateLo;
  g.fillRect(x + 2, y + CELL - 4, CELL - 4, 2);
  g.fillRect(x + CELL - 4, y + 2, 2, CELL - 4);
  // recessed face
  g.fillStyle = PAL.plateFace;
  g.fillRect(x + 6, y + 6, CELL - 12, CELL - 12);
  g.fillStyle = PAL.plateLo;
  g.fillRect(x + 6, y + 6, CELL - 12, 2);
  // heavy raised X ridges spanning the face, with drop shadow and lit top
  const diag = (x0: number, y0: number, x1: number, y1: number) => {
    g.beginPath();
    g.moveTo(x + x0, y + y0);
    g.lineTo(x + x1, y + y1);
    g.stroke();
  };
  g.lineWidth = 8;
  g.strokeStyle = PAL.plateBraceLo;
  diag(10, 12, CELL - 8, CELL - 6);
  diag(CELL - 10, 12, 8, CELL - 6);
  g.lineWidth = 6;
  g.strokeStyle = PAL.plateBrace;
  diag(9, 9, CELL - 9, CELL - 9);
  diag(CELL - 9, 9, 9, CELL - 9);
  g.lineWidth = 2;
  g.strokeStyle = PAL.plateHi;
  diag(9, 7, CELL - 11, CELL - 13);
  diag(CELL - 9, 7, 11, CELL - 11);
  // corner pads bolting the braces down
  for (const [rx, ry] of [[4, 4], [CELL - 14, 4], [4, CELL - 14], [CELL - 14, CELL - 14]] as const) {
    g.fillStyle = PAL.plate;
    g.fillRect(x + rx, y + ry, 10, 10);
    g.fillStyle = PAL.plateHi;
    g.fillRect(x + rx, y + ry, 10, 2);
    g.fillRect(x + rx, y + ry, 2, 10);
    g.fillStyle = PAL.plateLo;
    g.fillRect(x + rx, y + ry + 8, 10, 2);
    g.fillRect(x + rx + 8, y + ry, 2, 10);
  }
}

const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Render quality multiplier. 1 = retro (pixelated framebuffer); higher
 * values rasterize the procedural vector art at that multiple for the
 * smooth high-res mode. All drawing code works in logical 48px cell
 * coordinates; quality only changes the backing resolution.
 */
let QUALITY = 1;

export function renderQuality(): number {
  return QUALITY;
}

export function setRenderQuality(q: number): void {
  if (q === QUALITY) return;
  QUALITY = q;
  spriteCache.clear();
  plateBitmaps = null;
  heroBitmaps.clear();
  floozScratch = null;
}

/** Sprite canvas backed at QUALITY resolution, drawn in logical coords. */
function makePieceCanvas(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = CELL * QUALITY;
  c.height = CELL * QUALITY;
  const g = c.getContext('2d')!;
  g.scale(QUALITY, QUALITY);
  return { c, g };
}

// ---------- SVG-spec hollow glass & brass pipes ----------
// Materials ported from the user's pipe.svg definition: the glass tube is
// TRANSLUCENT (bright white walls falling to a nearly-transparent core so
// the board shows through the hollow), with three white specular streaks;
// brass is a 7-stop gradient peaking at #ffe49c. Geometry: tube 24px on a
// 48px cell, collars 32px wide with each piece drawing an 8px half at its
// edge — two neighbors compose the full joint, so connections are flush
// by construction. Elbow shading uses radial gradients centered on the
// bend corner so the falloff follows the curve.

const TUBE_R = 10;
const OUTLINE = '#1a1c21';

// Material stops per pipe_v3.svg: glassier 4-stop tube, punchier brass.
function addGlassStops(grad: CanvasGradient, mode: 'empty' | 'filled' | 'gold'): void {
  if (mode === 'empty') {
    grad.addColorStop(0, 'rgba(255,255,255,0.40)');
    grad.addColorStop(0.2, 'rgba(150,160,170,0.10)');
    grad.addColorStop(0.8, 'rgba(150,160,170,0.10)');
    grad.addColorStop(1, 'rgba(255,255,255,0.50)');
  } else if (mode === 'filled') {
    grad.addColorStop(0, 'rgba(238,255,228,0.95)');
    grad.addColorStop(0.2, 'rgba(88,214,66,0.92)');
    grad.addColorStop(0.8, 'rgba(88,214,66,0.92)');
    grad.addColorStop(1, 'rgba(242,255,232,0.95)');
  } else {
    grad.addColorStop(0, 'rgba(255,236,180,0.55)');
    grad.addColorStop(0.2, 'rgba(196,156,66,0.22)');
    grad.addColorStop(0.8, 'rgba(196,156,66,0.22)');
    grad.addColorStop(1, 'rgba(255,240,196,0.60)');
  }
}

function addBrassStops(grad: CanvasGradient): void {
  grad.addColorStop(0, '#7a5531');
  grad.addColorStop(0.2, '#dfaf6e');
  grad.addColorStop(0.5, '#ffe49c');
  grad.addColorStop(0.8, '#b6834b');
  grad.addColorStop(1, '#3a2514');
}

type GlassMode = 'empty' | 'filled' | 'gold';

/** Straight glass tube segment from x0..x1 (horizontal) or y0..y1. */
function glassStraight(
  g: CanvasRenderingContext2D,
  horizontal: boolean,
  mode: GlassMode,
  from = 0,
  to = CELL,
): void {
  const c = CELL / 2;
  const grad = horizontal
    ? g.createLinearGradient(0, c - TUBE_R, 0, c + TUBE_R)
    : g.createLinearGradient(c - TUBE_R, 0, c + TUBE_R, 0);
  addGlassStops(grad, mode);
  g.fillStyle = grad;
  if (horizontal) g.fillRect(from, c - TUBE_R, to - from, TUBE_R * 2);
  else g.fillRect(c - TUBE_R, from, TUBE_R * 2, to - from);

  const line = (offset: number, w: number, color: string, alpha = 1) => {
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    if (horizontal) {
      g.moveTo(from, c + offset);
      g.lineTo(to, c + offset);
    } else {
      g.moveTo(c + offset, from);
      g.lineTo(c + offset, to);
    }
    g.stroke();
    g.restore();
  };
  // tube wall outlines
  line(-TUBE_R, 2, OUTLINE);
  line(TUBE_R, 2, OUTLINE);
  // two specular streaks per the v3 spec (no center haze)
  line(-TUBE_R + 4, 2, '#ffffff', 0.6);
  line(TUBE_R - 4, 1, '#ffffff', 0.3);
}

/**
 * Fitting-style elbow per pipe_v3: straight runs meeting at a corner with
 * a small inner fillet and a large outer fillet. Drawn once in canonical
 * NE orientation (N + E openings) and mirrored for the other three.
 */
function glassElbow(g: CanvasRenderingContext2D, kind: PieceKind, mode: GlassMode): void {
  const c = CELL / 2;
  const wall = c - TUBE_R; // 14
  const wallF = c + TUBE_R; // 34
  const RO = 20; // outer fillet radius
  const RI = 6; // inner fillet radius

  g.save();
  // Mirror canonical NE into the requested orientation.
  if (kind === 'NW') {
    g.translate(CELL, 0);
    g.scale(-1, 1);
  } else if (kind === 'SE') {
    g.translate(0, CELL);
    g.scale(1, -1);
  } else if (kind === 'SW') {
    g.translate(CELL, CELL);
    g.scale(-1, -1);
  }

  const tube = () => {
    g.beginPath();
    g.moveTo(wall, 0);
    g.arcTo(wall, wallF, CELL, wallF, RO); // outer sweep
    g.lineTo(CELL, wallF);
    g.lineTo(CELL, wall);
    g.arcTo(wallF, wall, wallF, 0, RI); // inner fillet
    g.lineTo(wallF, 0);
    g.closePath();
  };

  // Gradient perpendicular to the horizontal arm (v3's compromise).
  const grad = g.createLinearGradient(0, wall, 0, wallF);
  addGlassStops(grad, mode);
  g.fillStyle = grad;
  tube();
  g.fill();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 2;
  tube();
  g.stroke();

  // Speculars: bright streak inside the inner wall, faint inside outer.
  g.save();
  g.globalAlpha = 0.6;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(wallF - 4, 0);
  g.arcTo(wallF - 4, wall + 4, CELL, wall + 4, RI + 4);
  g.lineTo(CELL, wall + 4);
  g.stroke();
  g.globalAlpha = 0.3;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(wall + 4, 0);
  g.arcTo(wall + 4, wallF - 4, CELL, wallF - 4, RO - 8);
  g.lineTo(CELL, wallF - 4);
  g.stroke();
  g.restore();
  g.restore();
}

/**
 * Fused 4-way cross per pipe_v3: one glass path with small fillets at all
 * four junction corners — no double-painted intersection.
 */
function glassCross(g: CanvasRenderingContext2D, mode: GlassMode): void {
  const wall = CELL / 2 - TUBE_R;
  const wallF = CELL / 2 + TUBE_R;
  const RI = 6;

  const tube = () => {
    g.beginPath();
    g.moveTo(wall, 0);
    g.arcTo(wall, wall, 0, wall, RI);
    g.lineTo(0, wall);
    g.lineTo(0, wallF);
    g.arcTo(wall, wallF, wall, CELL, RI);
    g.lineTo(wall, CELL);
    g.lineTo(wallF, CELL);
    g.arcTo(wallF, wallF, CELL, wallF, RI);
    g.lineTo(CELL, wallF);
    g.lineTo(CELL, wall);
    g.arcTo(wallF, wall, wallF, 0, RI);
    g.lineTo(wallF, 0);
    g.closePath();
  };

  const grad = g.createLinearGradient(0, wall, 0, wallF);
  addGlassStops(grad, mode);
  g.fillStyle = grad;
  tube();
  g.fill();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 2;
  tube();
  g.stroke();

  // Specular segments on each arm, stopping short of the junction.
  g.save();
  g.strokeStyle = '#ffffff';
  const seg = (x0: number, y0: number, x1: number, y1: number, w: number, a: number) => {
    g.globalAlpha = a;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  const b = wall + 4; // bright offset
  const f = wallF - 4; // faint offset
  seg(0, b, wall - 2, b, 2, 0.6);
  seg(wallF + 2, b, CELL, b, 2, 0.6);
  seg(0, f, wall - 2, f, 1, 0.3);
  seg(wallF + 2, f, CELL, f, 1, 0.3);
  seg(b, 0, b, wall - 2, 2, 0.6);
  seg(b, wallF + 2, b, CELL, 2, 0.6);
  seg(f, 0, f, wall - 2, 1, 0.3);
  seg(f, wallF + 2, f, CELL, 1, 0.3);
  g.restore();
}

/**
 * Half-collar at a cell edge: 32px wide, 8px deep, riveted brass with the
 * SVG's gradient running across the pipe. The neighboring piece's half
 * completes the double-ring coupler of the spec.
 */
function brassCollar(g: CanvasRenderingContext2D, side: Dir): void {
  const w = 28;
  const t = 8;
  const c = CELL / 2;
  const horizontal = side === 0 || side === 2;
  const x = horizontal ? c - w / 2 : side === 3 ? 0 : CELL - t;
  const y = horizontal ? (side === 0 ? 0 : CELL - t) : c - w / 2;
  const rw = horizontal ? w : t;
  const rh = horizontal ? t : w;

  const grad = horizontal
    ? g.createLinearGradient(x, 0, x + w, 0)
    : g.createLinearGradient(0, y, 0, y + w);
  addBrassStops(grad);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 2;
  g.shadowOffsetX = 1;
  g.shadowOffsetY = 1;
  g.fillStyle = grad;
  g.fillRect(x, y, rw, rh);
  g.restore();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 2;
  g.strokeRect(x + 0.5, y + 0.5, rw - 1, rh - 1);
  // No rivets: clean collars read better at game scale.
}

/** Glass stub from a cell edge to the center (drawn under housings). */
function glassStub(g: CanvasRenderingContext2D, side: Dir, filled: boolean): void {
  const c = CELL / 2;
  const mode: GlassMode = filled ? 'filled' : 'empty';
  const horizontal = side === 1 || side === 3;
  if (side === 0) glassStraight(g, false, mode, 0, c);
  if (side === 2) glassStraight(g, false, mode, c, CELL);
  if (side === 3) glassStraight(g, true, mode, 0, c);
  if (side === 1) glassStraight(g, true, mode, c, CELL);
  void horizontal;
}

const GLASS_KINDS = new Set<PieceKind>([
  'H', 'V', 'NE', 'NW', 'SE', 'SW', 'X', 'BONUS',
  'ONEWAY_N', 'ONEWAY_E', 'ONEWAY_S', 'ONEWAY_W',
  'RESERVOIR_H', 'RESERVOIR_V',
]);

/** Brass canister bulge for reservoirs, with optional green core. */
function brassCanister(g: CanvasRenderingContext2D, horizontal: boolean, filled: boolean): void {
  const c = CELL / 2;
  const along = 26;
  const across = 34;
  const x = horizontal ? c - along / 2 : c - across / 2;
  const y = horizontal ? c - across / 2 : c - along / 2;
  const w = horizontal ? along : across;
  const h = horizontal ? across : along;
  const grad = horizontal
    ? g.createLinearGradient(0, y, 0, y + h)
    : g.createLinearGradient(x, 0, x + w, 0);
  addBrassStops(grad);
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.strokeStyle = OUTLINE;
  g.lineWidth = 2;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(x + 3, y + 3, horizontal ? w - 6 : 3, horizontal ? 3 : h - 6);
  if (filled) {
    g.fillStyle = 'rgba(62,202,46,0.95)';
    g.beginPath();
    g.ellipse(c, c, horizontal ? 8 : 11, horizontal ? 11 : 8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(196,252,166,0.9)';
    g.beginPath();
    g.arc(c - 2, c - 3, 3.5, 0, Math.PI * 2);
    g.fill();
  }
}

/** SVG-spec piece: exact geometry, flush half-collar joints, hollow glass. */
function glassPiece(kind: PieceKind, filled: boolean): HTMLCanvasElement {
  const { c, g } = makePieceCanvas();
  const mode: GlassMode = filled ? 'filled' : kind === 'BONUS' ? 'gold' : 'empty';

  switch (kind) {
    case 'H': case 'ONEWAY_E': case 'ONEWAY_W': case 'RESERVOIR_H':
      glassStraight(g, true, mode);
      break;
    case 'V': case 'ONEWAY_N': case 'ONEWAY_S': case 'RESERVOIR_V':
      glassStraight(g, false, mode);
      break;
    case 'NE': case 'NW': case 'SE': case 'SW':
      glassElbow(g, kind, mode);
      break;
    case 'X': case 'BONUS':
      glassCross(g, mode);
      break;
    default:
      break;
  }

  if (kind.startsWith('RESERVOIR')) brassCanister(g, kind === 'RESERVOIR_H', filled);
  for (const d of flangesFor(kind)) brassCollar(g, d);
  if (kind.startsWith('ONEWAY')) {
    const dir = (['ONEWAY_N', 'ONEWAY_E', 'ONEWAY_S', 'ONEWAY_W'].indexOf(kind)) as Dir;
    arrow(g, dir, filled ? PAL.black : PAL.white);
  }
  return c;
}

/** Letter label with a dark chip behind it for readability on bitmaps. */
function letterChip(g: CanvasRenderingContext2D, ch: 'S' | 'E'): void {
  g.fillStyle = 'rgba(10,10,14,0.85)';
  g.fillRect(14, 12, 20, 24);
  letter(g, ch, 19, 17, PAL.ledYellow);
}

/**
 * Sheet-cell mapping for each piece kind (glass/brass sheets). The sheets
 * only contain south-facing elbows (SW at c3, SE at c4), so north-facing
 * orientations are generated by rotation — the classic sheet-thrift trick.
 */
function pieceCrop(
  kind: PieceKind,
  startExit?: Dir,
): { col: number; row: number; rotate: 0 | 90 | 180 | 270 } | null {
  switch (kind) {
    case 'H': return { col: 0, row: 0, rotate: 0 };
    case 'V': return { col: 1, row: 0, rotate: 0 };
    case 'SW': return { col: 3, row: 0, rotate: 0 };
    case 'SE': return { col: 4, row: 0, rotate: 0 };
    case 'NW': return { col: 3, row: 0, rotate: 90 };
    case 'NE': return { col: 4, row: 0, rotate: 270 };
    case 'X': return { col: 2, row: 1, rotate: 0 };
    case 'BONUS': return { col: 3, row: 1, rotate: 0 }; // diagonal crossover
    case 'END': return { col: 4, row: 1, rotate: 0 }; // ornate brass cross
    case 'ONEWAY_E': case 'ONEWAY_W': return { col: 5, row: 1, rotate: 0 }; // HIGH PRESSURE
    case 'ONEWAY_N': case 'ONEWAY_S': return { col: 6, row: 1, rotate: 0 }; // gauge vertical
    case 'RESERVOIR_V': return { col: 0, row: 2, rotate: 0 }; // double glass tank
    case 'RESERVOIR_H': return { col: 2, row: 2, rotate: 0 }; // brass canister
    case 'START':
      // Valve wheel; openings are W/E, rotate for N/S exits.
      return { col: 1, row: 2, rotate: startExit === 0 || startExit === 2 ? 90 : 0 };
    default:
      return null;
  }
}

/** Decoration overlays shared by the empty and filled sprite variants. */
function pieceOverlays(g: CanvasRenderingContext2D, kind: PieceKind, startExit?: Dir): void {
  if (kind.startsWith('ONEWAY')) {
    const dir = (['ONEWAY_N', 'ONEWAY_E', 'ONEWAY_S', 'ONEWAY_W'].indexOf(kind)) as Dir;
    arrow(g, dir, PAL.white);
  }
  if (kind === 'START') {
    if (startExit !== undefined) {
      const off = 15;
      const d = [[0, -off], [off, 0], [0, off], [-off, 0]][startExit]!;
      g.save();
      g.translate(d[0]!, d[1]!);
      arrow(g, startExit, PAL.ledYellow);
      g.restore();
    }
    letterChip(g, 'S');
  }
  if (kind === 'END') letterChip(g, 'E');
}

/**
 * START/END housings and the obstacle use the sheet art; glass stubs are
 * drawn UNDER the housing toward its open sides so blueprint-spec pipe
 * chains connect to it flush.
 */
function housingPiece(
  kind: 'START' | 'END' | 'OBSTACLE',
  filled: boolean,
  startExit?: Dir,
): HTMLCanvasElement | null {
  if (!sheetsReady()) return null;
  const smooth = QUALITY > 1;
  if (kind === 'OBSTACLE') {
    return extract('ref', REF.plateRust!, CELL * QUALITY, CELL * QUALITY, { smooth });
  }
  const crop = pieceCrop(kind, startExit)!;
  const { c, g } = makePieceCanvas();
  const sides: Dir[] = kind === 'END' ? [0, 1, 2, 3] : startExit !== undefined ? [startExit] : [];
  for (const s of sides) glassStub(g, s, filled);
  const art = extract(
    filled ? 'filled' : 'pipes',
    pipeCellRect(crop.col, crop.row),
    CELL * QUALITY,
    CELL * QUALITY,
    { key: true, overscan: 2 * QUALITY, rotate: crop.rotate, smooth },
  );
  g.drawImage(art, 0, 0, CELL, CELL);
  pieceOverlays(g, kind, startExit);
  return c;
}

/** Glowing filled variant of a piece. */
export function filledPieceSprite(kind: PieceKind, startExit?: Dir): HTMLCanvasElement | null {
  const key = `filled:${kind}:${startExit ?? ''}:${sheetsReady() ? 'bmp' : 'proc'}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  let c: HTMLCanvasElement | null = null;
  if (GLASS_KINDS.has(kind)) c = glassPiece(kind, true);
  else if (kind === 'START' || kind === 'END') c = housingPiece(kind, true, startExit);
  if (!c) return null;
  spriteCache.set(key, c);
  return c;
}

export function pieceSprite(kind: PieceKind, startExit?: Dir): HTMLCanvasElement {
  const key = `${kind}:${startExit ?? ''}:${sheetsReady() ? 'bmp' : 'proc'}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  let c: HTMLCanvasElement | null = null;
  if (GLASS_KINDS.has(kind)) {
    c = glassPiece(kind, false);
  } else if (kind === 'START' || kind === 'END' || kind === 'OBSTACLE') {
    c = housingPiece(kind, false, startExit);
  }
  if (!c) {
    const made = makePieceCanvas();
    drawPiece(made.g, kind, startExit);
    c = made.c;
  }
  spriteCache.set(key, c);
  return c;
}

/**
 * Additive glow along a channel path: concentric strokes of decreasing
 * width and alpha approximate a smooth light falloff from the flooz core;
 * 'lighter' compositing lets overlapping light sum, so the glow runs
 * continuously through bends and across cell boundaries instead of
 * forming a blurred blob per cell.
 */
export function glowAlongPath(
  g: CanvasRenderingContext2D,
  kind: PieceKind,
  ch: number,
  progress: number,
  reversed: boolean,
): void {
  const steps = Math.max(2, Math.ceil(20 * progress));
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const layers: Array<[number, number]> = [
    [26, 0.04],
    [20, 0.065],
    [14, 0.09],
    [9, 0.13],
  ];
  for (const [w, a] of layers) {
    g.strokeStyle = `rgba(90, 235, 70, ${a})`;
    g.lineWidth = w;
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * progress;
      const p = pathPoint(kind, ch, reversed ? 1 - t : t);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.stroke();
  }
  g.restore();
}

/**
 * Draw flooz along a channel up to `progress`: bright yellow with a dark
 * edge, riding inside the pipe like the original's liquid.
 */
let floozScratch: HTMLCanvasElement | null = null;

export function drawFlooz(
  g: CanvasRenderingContext2D,
  kind: PieceKind,
  ch: number,
  progress: number,
  reversed: boolean,
  startExit?: Dir,
): void {
  if (progress <= 0) return;

  // Bitmap mode: reveal the glowing filled sprite along the flow path.
  if (sheetsReady()) {
    const filled = filledPieceSprite(kind, startExit);
    if (filled) {
      // Housings/tanks: fade the whole filled sprite in as they fill.
      if (kind === 'START' || kind === 'END') {
        if (progress > 0.25) g.drawImage(filled, 0, 0, CELL, CELL);
        return;
      }
      // Single-channel piece fully filled: draw whole sprite (full halo).
      const multiChannel = kind === 'X' || kind === 'BONUS';
      if (progress >= 1 && !multiChannel) {
        g.drawImage(filled, 0, 0, CELL, CELL);
        glowAlongPath(g, kind, ch, 1, reversed);
        return;
      }
      const q = renderQuality();
      if (!floozScratch) {
        floozScratch = document.createElement('canvas');
        floozScratch.width = CELL * q;
        floozScratch.height = CELL * q;
      }
      const sg = floozScratch.getContext('2d')!;
      sg.setTransform(q, 0, 0, q, 0, 0);
      sg.globalCompositeOperation = 'source-over';
      sg.clearRect(0, 0, CELL, CELL);
      sg.strokeStyle = '#ffffff';
      sg.lineWidth = 32;
      sg.lineCap = 'round';
      sg.lineJoin = 'round';
      sg.beginPath();
      const steps = Math.max(2, Math.ceil(20 * progress));
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * progress;
        const p = pathPoint(kind, ch, reversed ? 1 - t : t);
        if (i === 0) sg.moveTo(p.x, p.y);
        else sg.lineTo(p.x, p.y);
      }
      sg.stroke();
      sg.globalCompositeOperation = 'source-in';
      sg.drawImage(filled, 0, 0, CELL, CELL);
      g.drawImage(floozScratch, 0, 0, CELL, CELL);
      glowAlongPath(g, kind, ch, progress, reversed);
      return;
    }
  }

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
    g.lineJoin = 'miter';
    g.miterLimit = 10;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
  };
  stroke(12, PAL.floozEdge);
  stroke(8, PAL.flooz);
  stroke(4, PAL.floozHi);
  if (kind.startsWith('RESERVOIR') && progress > 0.35) {
    const f = Math.min(1, (progress - 0.35) / 0.4);
    g.fillStyle = PAL.flooz;
    g.beginPath();
    g.arc(24, 24, 14 * f, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PAL.floozHi;
    g.beginPath();
    g.arc(20, 20, 6 * f, 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * Original mascot: a stubby hard-hat plumber clutching a wrench, drawn
 * from scratch (not a recreation of any existing game character).
 */
const heroBitmaps = new Map<number, HTMLCanvasElement>();

/** Mascot at an arbitrary height so he can fit below the dispenser. */
// ---------- plumber character: six levels of excitement ----------
// The player's generated sheet is a 2x3 grid (1686x2528): calm,
// curiosity, concern, panic, hysteria, freaking out. Captions sit in
// the top ~95px of each cell, so crops start below them.

const PLUMBER_SHEET = { w: 1686, h: 2528, cols: 2, rows: 3, padX: 55, padBot: 20 };
/** Measured per-pose caption clearance (pixel-scanned; sweat drops kept). */
const PLUMBER_PAD_TOP = [100, 100, 118, 120, 110, 110] as const;

function plumberRect(mood: number) {
  const s = PLUMBER_SHEET;
  const cw = s.w / s.cols;
  const ch = s.h / s.rows;
  const col = mood % s.cols;
  const row = Math.floor(mood / s.cols);
  const padTop = PLUMBER_PAD_TOP[mood] ?? 110;
  return {
    x: Math.round(col * cw + s.padX),
    y: Math.round(row * ch + padTop),
    w: Math.round(cw - 2 * s.padX),
    h: Math.round(ch - padTop - s.padBot),
  };
}

const plumberBitmaps = new Map<string, HTMLCanvasElement>();

/** Separate defeated pose (sitting on the toolbox), its own image. */
const DEFEAT_RECT = { x: 6, y: 6, w: 582, h: 540 };

function plumberSource(mood: number): { sheet: SheetId; rect: Rect } {
  return mood >= 6
    ? { sheet: 'defeat', rect: DEFEAT_RECT }
    : { sheet: 'plumber', rect: plumberRect(mood) };
}

/**
 * The plumber at excitement level `mood`: 0 calm .. 5 freaking out,
 * 6 = defeated (the flooz spilled and the round is lost).
 */
export function drawPlumber(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  mood = 0,
): void {
  mood = Math.max(0, Math.min(6, Math.round(mood)));
  if (!sheetsReady()) return drawMascot(g, x, y, h);
  const { sheet, rect } = plumberSource(mood);
  const w = Math.round(h * (rect.w / rect.h));
  const key = `${mood}:${h}:${QUALITY}`;
  let c = plumberBitmaps.get(key);
  if (!c) {
    c = extract(sheet, rect, w * QUALITY, h * QUALITY, {
      keySelf: true,
      threshold: 42,
      smooth: QUALITY > 1,
    });
    plumberBitmaps.set(key, c);
  }
  g.drawImage(c, x, y, w, h);
}

/** Width the plumber will occupy for a given height (poses are ~square). */
export function plumberWidth(h: number, mood = 0): number {
  const { rect } = plumberSource(Math.max(0, Math.min(6, Math.round(mood))));
  return Math.round(h * (rect.w / rect.h));
}

export function drawMascot(g: CanvasRenderingContext2D, x: number, y: number, h = 96): void {
  if (sheetsReady()) {
    const w = Math.round(h * 0.63);
    let hero = heroBitmaps.get(h);
    if (!hero) {
      hero = extract('ref', REF.heroStand!, w * QUALITY, h * QUALITY, {
        key: true,
        smooth: QUALITY > 1,
      });
      heroBitmaps.set(h, hero);
    }
    g.drawImage(hero, x, y, w, h);
    return;
  }
  if (h < 88) return; // procedural mascot has a fixed 96px frame
  g.save();
  g.translate(x, y);
  // boots
  g.fillStyle = '#3a3026';
  g.fillRect(12, 80, 16, 8);
  g.fillRect(36, 80, 16, 8);
  // overalls
  g.fillStyle = '#2c50b4';
  g.fillRect(14, 52, 36, 28);
  g.fillStyle = '#1c3478';
  g.fillRect(14, 76, 36, 4);
  g.fillRect(28, 52, 8, 16);
  // shirt + arms
  g.fillStyle = '#c8442c';
  g.fillRect(10, 44, 44, 12);
  g.fillRect(6, 48, 8, 16);
  g.fillRect(50, 48, 8, 16);
  // hands
  g.fillStyle = '#e8b088';
  g.fillRect(6, 64, 8, 6);
  g.fillRect(50, 64, 8, 6);
  // head
  g.fillStyle = '#e8b088';
  g.fillRect(18, 20, 28, 24);
  // eyes + grin
  g.fillStyle = PAL.black;
  g.fillRect(24, 28, 4, 6);
  g.fillRect(36, 28, 4, 6);
  g.fillRect(24, 38, 16, 2);
  // hard hat
  g.fillStyle = PAL.ledYellow;
  g.fillRect(16, 10, 32, 12);
  g.fillRect(12, 18, 40, 4);
  g.fillStyle = '#b09010';
  g.fillRect(12, 20, 40, 2);
  // wrench in right hand
  g.fillStyle = '#9aa1a8';
  g.fillRect(54, 48, 6, 20);
  g.fillRect(50, 44, 14, 6);
  g.fillStyle = '#575d64';
  g.fillRect(54, 46, 6, 2);
  g.restore();
}
