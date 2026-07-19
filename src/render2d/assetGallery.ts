import { Dir, PieceKind } from '../core/types';
import { CELL, drawFlooz, drawMascot, drawPlate, pieceSprite } from './sprites';
import { extract, refDigitRect, sheetsReady } from './sheet';

/**
 * Asset review page (/PipeDreamz_assets): every asset as its own DOM
 * element — per-piece cards (empty + filled), connection chains rendered
 * on the real board background to judge water-tightness, and board
 * furniture. Each card is an individual <canvas>, so assets can be
 * inspected and saved separately.
 */

interface ChainCell {
  dx: number;
  dy: number;
  kind: PieceKind;
  exit?: Dir;
  fill?: number[];
  reversed?: boolean;
}

function tile(cellsW: number, cellsH: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cellsW * CELL;
  c.height = cellsH * CELL;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  draw(g);
  c.style.width = `${c.width * 2}px`;
  c.style.imageRendering = 'pixelated';
  return c;
}

function chainCanvas(cells: ChainCell[], filled: boolean): HTMLCanvasElement {
  const w = Math.max(...cells.map((c) => c.dx)) + 1;
  const h = Math.max(...cells.map((c) => c.dy)) + 1;
  return tile(w, h, (g) => {
    for (const { dx, dy } of cells) drawPlate(g, dx * CELL, dy * CELL);
    for (const c of cells) g.drawImage(pieceSprite(c.kind, c.exit), c.dx * CELL, c.dy * CELL);
    if (!filled) return;
    for (const c of cells) {
      const channels = c.fill ?? (c.kind === 'X' || c.kind === 'BONUS' ? [0, 1] : [0]);
      for (const ch of channels) {
        g.save();
        g.translate(c.dx * CELL, c.dy * CELL);
        drawFlooz(g, c.kind, ch, 1, c.reversed ?? false, c.exit);
        g.restore();
      }
    }
  });
}

function card(root: HTMLElement, title: string, ...canvases: HTMLCanvasElement[]): void {
  const fig = document.createElement('figure');
  fig.className = 'asset-card';
  for (const c of canvases) fig.appendChild(c);
  const cap = document.createElement('figcaption');
  cap.textContent = title;
  fig.appendChild(cap);
  root.appendChild(fig);
}

function section(root: HTMLElement, title: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  root.appendChild(h);
  const div = document.createElement('div');
  div.className = 'asset-row';
  root.appendChild(div);
  return div;
}

export function assetGallery(gameCanvas: HTMLCanvasElement): void {
  gameCanvas.style.display = 'none';
  document.getElementById('scanlines')?.classList.add('off');
  document.body.style.overflow = 'auto';

  const style = document.createElement('style');
  style.textContent = `
    #gallery { padding: 20px 28px 60px; font-family: 'Courier New', monospace; color: #dfe8df; }
    #gallery h1 { font-size: 20px; letter-spacing: 2px; color: #4ce03c; margin-bottom: 4px; }
    #gallery .sub { color: #8a948a; font-size: 12px; margin-bottom: 18px; }
    #gallery h2 { font-size: 14px; letter-spacing: 1px; color: #e8c34a; margin: 26px 0 10px; }
    #gallery .asset-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
    #gallery figure.asset-card { background: #171c21; border: 1px solid #303840;
      padding: 8px; display: flex; flex-direction: column; gap: 6px; align-items: center; }
    #gallery figure.asset-card canvas { display: block; }
    #gallery figcaption { font-size: 11px; color: #9aa39a; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'gallery';
  document.body.appendChild(root);

  const h1 = document.createElement('h1');
  h1.textContent = 'PIPEDREAMZ ASSET SHEET';
  root.appendChild(h1);
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `sheets ${sheetsReady() ? 'loaded' : 'MISSING (procedural fallback)'} — every asset is an individual element; right-click any canvas to save it`;
  root.appendChild(sub);

  // ---------- pieces ----------
  const KINDS: Array<{ kind: PieceKind; exit?: Dir; name: string }> = [
    { kind: 'H', name: 'straight H' },
    { kind: 'V', name: 'straight V' },
    { kind: 'NE', name: 'elbow NE' },
    { kind: 'NW', name: 'elbow NW' },
    { kind: 'SE', name: 'elbow SE' },
    { kind: 'SW', name: 'elbow SW' },
    { kind: 'X', name: 'cross' },
    { kind: 'BONUS', name: 'bonus' },
    { kind: 'ONEWAY_N', name: 'one-way N' },
    { kind: 'ONEWAY_E', name: 'one-way E' },
    { kind: 'ONEWAY_S', name: 'one-way S' },
    { kind: 'ONEWAY_W', name: 'one-way W' },
    { kind: 'RESERVOIR_H', name: 'reservoir H' },
    { kind: 'RESERVOIR_V', name: 'reservoir V' },
    { kind: 'START', exit: 1, name: 'start (E)' },
    { kind: 'START', exit: 2, name: 'start (S)' },
    { kind: 'END', name: 'end' },
    { kind: 'OBSTACLE', name: 'obstacle' },
  ];
  const pieces = section(root, 'PIECES — empty | filled');
  for (const k of KINDS) {
    const empty = tile(1, 1, (g) => {
      drawPlate(g, 0, 0);
      g.drawImage(pieceSprite(k.kind, k.exit), 0, 0);
    });
    if (k.kind === 'OBSTACLE') {
      card(pieces, k.name, empty);
      continue;
    }
    const filled = tile(1, 1, (g) => {
      drawPlate(g, 0, 0);
      g.drawImage(pieceSprite(k.kind, k.exit), 0, 0);
      const channels = k.kind === 'X' || k.kind === 'BONUS' ? [0, 1] : [0];
      for (const ch of channels) drawFlooz(g, k.kind, ch, 1, false, k.exit);
    });
    card(pieces, k.name, empty, filled);
  }

  // ---------- connection chains ----------
  const chains = section(root, 'CONNECTIONS — seams should read water-tight');
  const runH: ChainCell[] = [
    { dx: 0, dy: 0, kind: 'START', exit: 1 },
    { dx: 1, dy: 0, kind: 'H' },
    { dx: 2, dy: 0, kind: 'RESERVOIR_H' },
    { dx: 3, dy: 0, kind: 'H' },
    { dx: 4, dy: 0, kind: 'ONEWAY_E' },
    { dx: 5, dy: 0, kind: 'END' },
  ];
  card(chains, 'straight run — empty', chainCanvas(runH, false));
  card(chains, 'straight run — filled', chainCanvas(runH, true));

  const snake: ChainCell[] = [
    { dx: 0, dy: 0, kind: 'SE' },
    { dx: 1, dy: 0, kind: 'H' },
    { dx: 2, dy: 0, kind: 'SW', reversed: true },
    { dx: 2, dy: 1, kind: 'NE', reversed: true },
    { dx: 3, dy: 1, kind: 'H' },
    { dx: 4, dy: 1, kind: 'NW' },
    { dx: 4, dy: 0, kind: 'V' },
  ];
  card(chains, 'elbow snake — empty', chainCanvas(snake, false));
  card(chains, 'elbow snake — filled', chainCanvas(snake, true));

  const weave: ChainCell[] = [
    { dx: 0, dy: 1, kind: 'H' },
    { dx: 1, dy: 1, kind: 'X' },
    { dx: 2, dy: 1, kind: 'H' },
    { dx: 1, dy: 0, kind: 'V' },
    { dx: 1, dy: 2, kind: 'V' },
  ];
  card(chains, 'crossover — empty', chainCanvas(weave, false));
  card(chains, 'crossover — filled', chainCanvas(weave, true));
  const weaveB = weave.map((c) => ({ ...c, kind: c.kind === 'X' ? ('BONUS' as PieceKind) : c.kind }));
  card(chains, 'crossover — bonus', chainCanvas(weaveB, true));

  // ---------- board furniture ----------
  const board = section(root, 'BOARD — plates, digits, mascot');
  card(board, 'plate variants', tile(4, 1, (g) => {
    for (let i = 0; i < 4; i++) drawPlate(g, i * CELL, 0);
  }));
  if (sheetsReady()) {
    for (let d = 0; d < 10; d++) {
      const c = document.createElement('canvas');
      c.width = 12;
      c.height = 20;
      c.getContext('2d')!.drawImage(extract('ref', refDigitRect(d), 12, 20), 0, 0);
      c.style.width = '24px';
      c.style.imageRendering = 'pixelated';
      card(board, `digit ${d}`, c);
    }
  }
  const mascot = document.createElement('canvas');
  mascot.width = 64;
  mascot.height = 100;
  drawMascot(mascot.getContext('2d')!, 0, 0, 96);
  mascot.style.width = '128px';
  mascot.style.imageRendering = 'pixelated';
  card(board, 'mascot', mascot);

  // ---------- source SVG specs, rendered natively as vectors ----------
  const specs = section(root, 'SPEC — source SVG definitions (native vector render; game uses procedural canvas ports of these)');
  for (const [file, name] of [
    ['pipe_v3.svg', 'pipe_v3.svg — current material & geometry spec'],
    ['pipe.svg', 'pipe.svg — original spec (v1)'],
  ] as const) {
    const fig = document.createElement('figure');
    fig.className = 'asset-card';
    const img = document.createElement('img');
    img.src = `${import.meta.env.BASE_URL}assets/${file}`;
    img.style.width = '640px';
    const cap = document.createElement('figcaption');
    cap.textContent = name;
    fig.appendChild(img);
    fig.appendChild(cap);
    specs.appendChild(fig);
  }
}
