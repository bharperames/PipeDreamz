import { channelCount } from './pieces';
import {
  Dir,
  DIR_DELTA,
  GridPos,
  PieceKind,
  PlacedPiece,
  PlayerId,
  WrapOpening,
} from './types';

export class Grid {
  readonly w: number;
  readonly h: number;
  private cells: (PlacedPiece | null)[];
  private wraps: WrapOpening[];

  constructor(w: number, h: number, wraps: WrapOpening[] = []) {
    this.w = w;
    this.h = h;
    this.cells = new Array(w * h).fill(null);
    this.wraps = wraps;
  }

  inBounds(pos: GridPos): boolean {
    return pos.x >= 0 && pos.x < this.w && pos.y >= 0 && pos.y < this.h;
  }

  get(pos: GridPos): PlacedPiece | null {
    if (!this.inBounds(pos)) return null;
    return this.cells[pos.y * this.w + pos.x] ?? null;
  }

  set(pos: GridPos, piece: PlacedPiece | null): void {
    if (!this.inBounds(pos)) throw new Error(`out of bounds: ${pos.x},${pos.y}`);
    this.cells[pos.y * this.w + pos.x] = piece;
  }

  makePiece(
    kind: PieceKind,
    owner: PlayerId | null,
    fixed: boolean,
    nowMs: number,
    readyAtMs = nowMs,
  ): PlacedPiece {
    return {
      kind,
      owner,
      fixed,
      channels: Array.from({ length: channelCount(kind) }, () => ({
        filled: false,
        fillEntry: null,
      })),
      placedAtMs: nowMs,
      readyAtMs,
    };
  }

  /**
   * Neighbor in direction `dir`, honoring declared wrap openings.
   * Returns null if the move leaves the board through a non-wrapping edge.
   */
  neighbor(pos: GridPos, dir: Dir): { pos: GridPos; wrapped: boolean } | null {
    const d = DIR_DELTA[dir]!;
    const next = { x: pos.x + d.dx, y: pos.y + d.dy };
    if (this.inBounds(next)) return { pos: next, wrapped: false };
    // Leaving the board: allowed only through a declared opening at (pos, dir).
    const open = this.wraps.some((w) => w.x === pos.x && w.y === pos.y && w.side === dir);
    if (!open) return null;
    const entryPos = {
      x: (next.x + this.w) % this.w,
      y: (next.y + this.h) % this.h,
    };
    return { pos: entryPos, wrapped: true };
  }

  /** Iterate placed pieces. */
  forEach(fn: (piece: PlacedPiece, pos: GridPos) => void): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const p = this.cells[y * this.w + x];
        if (p) fn(p, { x, y });
      }
    }
  }
}
