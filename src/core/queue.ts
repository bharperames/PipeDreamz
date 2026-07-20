import { Rng } from './rng';
import { PieceWeights, PlaceableKind, PLACEABLE_KINDS } from './types';

export const DEFAULT_WEIGHTS: PieceWeights = {
  H: 1,
  V: 1,
  NE: 1,
  NW: 1,
  SE: 1,
  SW: 1,
  X: 1,
};

/**
 * Easy-mode hook: called at each roll; returning weights biases the next
 * piece (e.g. toward pieces that extend the current pipeline). Returning
 * null falls back to the queue's static weights.
 */
export type BiasProvider = () => PieceWeights | null;

/**
 * A dispenser of upcoming pipe pieces. The bottom (index 0) piece is the
 * next one that must be placed; taking it shifts the queue down and a new
 * random piece appears at the top.
 */
export class DispenserQueue {
  private items: PlaceableKind[] = [];

  constructor(
    private rng: Rng,
    readonly depth: number,
    private weights: PieceWeights = DEFAULT_WEIGHTS,
    private bias?: BiasProvider,
  ) {
    for (let i = 0; i < depth; i++) this.items.push(this.roll());
  }

  private roll(): PlaceableKind {
    const weights = this.bias?.() ?? this.weights;
    let total = 0;
    for (const k of PLACEABLE_KINDS) total += weights[k];
    let r = this.rng.next() * total;
    for (const k of PLACEABLE_KINDS) {
      r -= weights[k];
      if (r < 0) return k;
    }
    return 'X';
  }

  /** Bottom-first view of the queue. */
  peek(): ReadonlyArray<PlaceableKind> {
    return this.items;
  }

  /**
   * Re-roll every slot at or above `fromIdx` against current bias.
   * Easy mode calls this after each placement so the FAR queue reacts
   * to the board as it is now, while the near slots stay stable for
   * player planning.
   */
  refreshTail(fromIdx: number): void {
    for (let i = Math.max(0, fromIdx); i < this.items.length; i++) {
      this.items[i] = this.roll();
    }
  }

  next(): PlaceableKind {
    return this.items[0]!;
  }

  take(): PlaceableKind {
    const out = this.items.shift()!;
    this.items.push(this.roll());
    return out;
  }
}
