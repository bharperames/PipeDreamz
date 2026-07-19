/**
 * Sprite-sheet loading and decomposition.
 *
 * Two user-supplied sheets (both AI-generated for this project):
 *  - pipes.jpg  (1999x1316): fixed 7x4 grid of pipe/conduit sprites.
 *  - sheet.jpg  (2528x1664): reference sheet with plates, HUD digits and
 *    the player character.
 *
 * Sprites are cropped, chroma-keyed against the flat grey background where
 * needed, and rescaled to cell size with nearest-neighbor sampling.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SheetId = 'pipes' | 'filled' | 'ref' | 'lattice';

const images = new Map<SheetId, HTMLCanvasElement>();
let ready = false;

export function sheetsReady(): boolean {
  return ready;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Load both sheets; resolves false (procedural fallback) on any failure. */
export async function loadSheets(baseUrl: string): Promise<boolean> {
  try {
    const [pipes, filled, ref, lattice] = await Promise.all([
      loadImage(`${baseUrl}assets/pipes.jpg`),
      loadImage(`${baseUrl}assets/pipes_filled.jpg`),
      loadImage(`${baseUrl}assets/sheet.jpg`),
      loadImage(`${baseUrl}assets/lattice.png`),
    ]);
    for (const [id, img] of [
      ['pipes', pipes],
      ['filled', filled],
      ['ref', ref],
      ['lattice', lattice],
    ] as const) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      images.set(id, c);
    }
    ready = true;
    return true;
  } catch {
    ready = false;
    return false;
  }
}

// ---------- pipes.jpg grid geometry (7 cols x 4 rows) ----------

// Glass/brass sheets have a subtitle row, shifting the grid down.
const PIPE_GRID = {
  x0: 40,
  y0: 118,
  pitchX: (1959 - 40) / 7,
  pitchY: (1310 - 118) / 4,
};

/** Crop rect for a pipes-sheet grid cell, inset past the white rules. */
export function pipeCellRect(col: number, row: number, inset = 16): Rect {
  return {
    x: Math.round(PIPE_GRID.x0 + col * PIPE_GRID.pitchX + inset),
    y: Math.round(PIPE_GRID.y0 + row * PIPE_GRID.pitchY + inset),
    w: Math.round(PIPE_GRID.pitchX - 2 * inset),
    h: Math.round(PIPE_GRID.pitchY - 2 * inset),
  };
}

// ---------- lattice background mock (10x7 grid of dark girder cells) ----------

const LATTICE_GRID = {
  x0: 18,
  y0: 18,
  pitchX: (1634 - 36) / 10,
  pitchY: (1148 - 36) / 7,
};

/** Crop rect for one lattice background cell from the mock screen. */
export function latticeCellRect(col: number, row: number): Rect {
  return {
    x: Math.round(LATTICE_GRID.x0 + col * LATTICE_GRID.pitchX + 3),
    y: Math.round(LATTICE_GRID.y0 + row * LATTICE_GRID.pitchY + 3),
    w: Math.round(LATTICE_GRID.pitchX - 6),
    h: Math.round(LATTICE_GRID.pitchY - 6),
  };
}

/** Cells in the mock that contain no pipes/cursor/start overlay. */
export const LATTICE_CLEAN_CELLS: ReadonlyArray<[number, number]> = [
  [0, 0],
  [6, 4],
  [8, 5],
  [2, 6],
];

// ---------- ref sheet named regions ----------

export const REF: Record<string, Rect> = {
  // tileset plates (silver + rusty variants)
  plateSilver: { x: 60, y: 530, w: 155, h: 150 },
  plateRust: { x: 60, y: 190, w: 155, h: 150 },
  // player character, standing pose
  heroStand: { x: 1990, y: 160, w: 440, h: 700 },
  // digit strip 0..9 (bottom middle)
  digits: { x: 1136, y: 1540, w: 745, h: 100 },
};

export function refDigitRect(d: number): Rect {
  const strip = REF.digits!;
  const pitch = strip.w / 10;
  return {
    x: Math.round(strip.x + d * pitch + 12),
    y: strip.y + 4,
    w: Math.round(pitch - 24),
    h: strip.h - 8,
  };
}

// ---------- extraction ----------

let keyColor: { r: number; g: number; b: number } | null = null;

function sampleKeyColor(): { r: number; g: number; b: number } {
  if (keyColor) return keyColor;
  // Sample the flat background inside the first pipe cell's corner.
  const src = images.get('pipes')!;
  const r = pipeCellRect(0, 0);
  const d = src.getContext('2d')!.getImageData(r.x + 4, r.y + 4, 1, 1).data;
  keyColor = { r: d[0]!, g: d[1]!, b: d[2]! };
  return keyColor;
}

export interface ExtractOpts {
  /** Make background-colored pixels transparent. */
  key?: boolean;
  rotate?: 0 | 90 | 180 | 270;
  /** Chroma-key distance threshold (JPEG noise tolerance). */
  threshold?: number;
  /**
   * Scale the crop this many output pixels past each edge (clipped by the
   * output canvas). Compensates for source art that leaves margins inside
   * its grid cell, so pipe ends reach the cell border and connect.
   */
  overscan?: number;
}

/** Crop a rect from a sheet and scale it to (outW,outH), pixelated. */
export function extract(
  id: SheetId,
  rect: Rect,
  outW: number,
  outH: number,
  opts: ExtractOpts = {},
): HTMLCanvasElement {
  const src = images.get(id);
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  if (!src) return out;

  // 1. crop at native size
  let crop = document.createElement('canvas');
  crop.width = rect.w;
  crop.height = rect.h;
  crop.getContext('2d')!.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

  // 2. chroma key
  if (opts.key) {
    const kc = sampleKeyColor();
    const ctx = crop.getContext('2d')!;
    const img = ctx.getImageData(0, 0, crop.width, crop.height);
    const t = opts.threshold ?? 52;
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i]! - kc.r;
      const dg = data[i + 1]! - kc.g;
      const db = data[i + 2]! - kc.b;
      if (Math.sqrt(dr * dr + dg * dg + db * db) < t) data[i + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);
  }

  // 3. rotate
  if (opts.rotate) {
    const rot = document.createElement('canvas');
    const quarter = opts.rotate === 90 || opts.rotate === 270;
    rot.width = quarter ? crop.height : crop.width;
    rot.height = quarter ? crop.width : crop.height;
    const rg = rot.getContext('2d')!;
    rg.translate(rot.width / 2, rot.height / 2);
    rg.rotate((opts.rotate * Math.PI) / 180);
    rg.drawImage(crop, -crop.width / 2, -crop.height / 2);
    crop = rot;
  }

  // 4. scale to output (optionally overscanned), nearest-neighbor
  const og = out.getContext('2d')!;
  og.imageSmoothingEnabled = false;
  const ov = opts.overscan ?? 0;
  og.drawImage(
    crop,
    0,
    0,
    crop.width,
    crop.height,
    -ov,
    -ov,
    outW + 2 * ov,
    outH + 2 * ov,
  );
  return out;
}
