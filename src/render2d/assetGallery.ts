import { Dir, PieceKind } from '../core/types';
import { CELL, drawFlooz, drawMascot, drawPlate, pieceSprite } from './sprites';
import { extract, refDigitRect, sheetsReady } from './sheet';

/**
 * Asset review page (/PipeDreamz_assets): every piece unfilled and filled,
 * plus connection chains rendered on the real board background so seam
 * "water-tightness" between adjacent pieces can be judged at a glance.
 */

const SCALE = 2;

interface ChainCell {
  kind: PieceKind;
  exit?: Dir;
  /** Channels to fill (default channel 0; X gets both). */
  fill?: number[];
  reversed?: boolean;
}

function drawCellGroup(
  g: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cells: Array<{ dx: number; dy: number; cell: ChainCell }>,
  filled: boolean,
): void {
  g.save();
  g.translate(ox, oy);
  g.scale(SCALE, SCALE);
  // plates first
  for (const { dx, dy } of cells) drawPlate(g, dx * CELL, dy * CELL);
  for (const { dx, dy, cell } of cells) {
    g.drawImage(pieceSprite(cell.kind, cell.exit), dx * CELL, dy * CELL);
  }
  if (filled) {
    for (const { dx, dy, cell } of cells) {
      const channels = cell.fill ?? (cell.kind === 'X' || cell.kind === 'BONUS' ? [0, 1] : [0]);
      for (const ch of channels) {
        g.save();
        g.translate(dx * CELL, dy * CELL);
        drawFlooz(g, cell.kind, ch, 1, cell.reversed ?? false, cell.exit);
        g.restore();
      }
    }
  }
  g.restore();
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  g.font = 'bold 13px monospace';
  g.textBaseline = 'top';
  g.fillStyle = '#e8f2e8';
  g.fillText(text, x, y);
}

export function assetGallery(canvas: HTMLCanvasElement): void {
  const W = 1560;
  const H = 1220;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#101418';
  g.fillRect(0, 0, W, H);

  label(g, `PIPEDREAMZ ASSET SHEET — sheets ${sheetsReady() ? 'LOADED' : 'MISSING (procedural fallback)'}`, 16, 10);

  // ---------- section 1: every piece, unfilled vs filled ----------
  const KINDS: Array<{ kind: PieceKind; exit?: Dir; name: string }> = [
    { kind: 'H', name: 'H' },
    { kind: 'V', name: 'V' },
    { kind: 'NE', name: 'NE' },
    { kind: 'NW', name: 'NW' },
    { kind: 'SE', name: 'SE' },
    { kind: 'SW', name: 'SW' },
    { kind: 'X', name: 'X' },
    { kind: 'BONUS', name: 'BONUS' },
    { kind: 'ONEWAY_N', name: 'OW-N' },
    { kind: 'ONEWAY_E', name: 'OW-E' },
    { kind: 'ONEWAY_S', name: 'OW-S' },
    { kind: 'ONEWAY_W', name: 'OW-W' },
    { kind: 'RESERVOIR_H', name: 'RES-H' },
    { kind: 'RESERVOIR_V', name: 'RES-V' },
    { kind: 'START', exit: 1, name: 'START' },
    { kind: 'END', name: 'END' },
    { kind: 'OBSTACLE', name: 'OBST' },
  ];
  label(g, 'PIECES — top: empty, bottom: filled', 16, 34);
  KINDS.forEach((k, i) => {
    const x = 16 + i * (CELL * SCALE + 8);
    drawCellGroup(g, x, 52, [{ dx: 0, dy: 0, cell: { kind: k.kind, exit: k.exit } }], false);
    if (k.kind !== 'OBSTACLE') {
      drawCellGroup(g, x, 52 + CELL * SCALE + 6, [{ dx: 0, dy: 0, cell: { kind: k.kind, exit: k.exit } }], true);
    }
    label(g, k.name, x, 52 + 2 * CELL * SCALE + 12);
  });

  // ---------- section 2: connection chains ----------
  let y = 52 + 2 * CELL * SCALE + 44;
  label(g, 'CONNECTIONS — seams between adjacent pieces should read water-tight', 16, y - 20);

  // a) horizontal run with reservoir
  const runH: Array<{ dx: number; dy: number; cell: ChainCell }> = [
    { dx: 0, dy: 0, cell: { kind: 'START', exit: 1 } },
    { dx: 1, dy: 0, cell: { kind: 'H' } },
    { dx: 2, dy: 0, cell: { kind: 'RESERVOIR_H' } },
    { dx: 3, dy: 0, cell: { kind: 'H' } },
    { dx: 4, dy: 0, cell: { kind: 'ONEWAY_E' } },
    { dx: 5, dy: 0, cell: { kind: 'END' } },
  ];
  drawCellGroup(g, 16, y, runH, false);
  drawCellGroup(g, 16 + 7 * CELL * SCALE, y, runH, true);
  label(g, 'straight run: START > H > RES > H > OW > END (empty | filled)', 16, y + CELL * SCALE + 4);

  // b) S-bend snake using all four elbows
  y += CELL * SCALE + 34;
  const snake: Array<{ dx: number; dy: number; cell: ChainCell }> = [
    { dx: 0, dy: 0, cell: { kind: 'SE', reversed: false } }, // enters S? shown static
    { dx: 1, dy: 0, cell: { kind: 'H' } },
    { dx: 2, dy: 0, cell: { kind: 'SW', reversed: true } },
    { dx: 2, dy: 1, cell: { kind: 'NE', reversed: true } },
    { dx: 3, dy: 1, cell: { kind: 'H' } },
    { dx: 4, dy: 1, cell: { kind: 'NW' } },
    { dx: 4, dy: 0, cell: { kind: 'V' } },
  ];
  drawCellGroup(g, 16, y, snake, false);
  drawCellGroup(g, 16 + 7 * CELL * SCALE, y, snake, true);
  label(g, 'elbow snake: SE > H > SW / NE > H > NW > V (empty | filled)', 16, y + 2 * CELL * SCALE + 4);

  // c) cross weave: vertical chain crossing a horizontal chain
  y += 2 * CELL * SCALE + 34;
  const weave: Array<{ dx: number; dy: number; cell: ChainCell }> = [
    { dx: 0, dy: 1, cell: { kind: 'H' } },
    { dx: 1, dy: 1, cell: { kind: 'X' } },
    { dx: 2, dy: 1, cell: { kind: 'H' } },
    { dx: 1, dy: 0, cell: { kind: 'V' } },
    { dx: 1, dy: 2, cell: { kind: 'V' } },
  ];
  drawCellGroup(g, 16, y, weave, false);
  drawCellGroup(g, 16 + 5 * CELL * SCALE, y, weave, true);
  // BONUS weave
  const weaveB = weave.map((c) => ({ ...c, cell: { ...c.cell, kind: c.cell.kind === 'X' ? ('BONUS' as PieceKind) : c.cell.kind } }));
  drawCellGroup(g, 16 + 10 * CELL * SCALE, y, weaveB, true);
  label(g, 'crossover weave: H > X > H over V (empty | filled | bonus)', 16, y + 3 * CELL * SCALE + 4);

  // ---------- section 3: board furniture ----------
  y += 3 * CELL * SCALE + 34;
  label(g, 'BOARD — plate variants, digits, mascot', 16, y - 20);
  g.save();
  g.translate(16, y);
  g.scale(SCALE, SCALE);
  for (let i = 0; i < 4; i++) drawPlate(g, i * CELL, 0);
  g.restore();
  if (sheetsReady()) {
    for (let d = 0; d < 10; d++) {
      const dig = extract('ref', refDigitRect(d), 12, 20);
      g.save();
      g.imageSmoothingEnabled = false;
      g.drawImage(dig, 16 + 4 * CELL * SCALE + 24 + d * 30, y, 24, 40);
      g.restore();
    }
  }
  g.save();
  g.translate(16 + 4 * CELL * SCALE + 340, y);
  g.scale(1, 1);
  drawMascot(g, 0, 0, 96);
  g.restore();
}
