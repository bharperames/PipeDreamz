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
  /** Shuffle bag for unbiased rolls: bounded droughts, still random. */
  private bag: PlaceableKind[] = [];

  constructor(
    private rng: Rng,
    readonly depth: number,
    private weights: PieceWeights = DEFAULT_WEIGHTS,
    private bias?: BiasProvider,
  ) {
    for (let i = 0; i < depth; i++) this.items.push(this.roll());
  }

  private refillBag(): void {
    this.bag = [...PLACEABLE_KINDS];
    for (let i = this.bag.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [this.bag[i], this.bag[j]] = [this.bag[j]!, this.bag[i]!];
    }
  }

  private roll(): PlaceableKind {
    // Easy-mode bias (dynamic weights) uses a weighted roll.
    const biased = this.bias?.();
    const weights = biased ?? this.weights;
    const uniform =
      !biased && PLACEABLE_KINDS.every((k) => weights[k] === weights[PLACEABLE_KINDS[0]!]);
    if (uniform) {
      // Unbiased play draws from a shuffle bag: every kind is guaranteed
      // to appear within any 13 consecutive pieces (true uniform RNG has
      // a ~10% chance of starving a needed kind for 15+ rolls).
      if (this.bag.length === 0) this.refillBag();
      return this.bag.pop()!;
    }
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
   * Re-roll slots at or above `fromIdx` against current bias. Easy
   * mode calls this after each placement so the FAR queue reacts to
   * the board as it is now, while the near slots stay stable for
   * player planning.
   *
   * `keep` makes the refresh sticky: a slot whose piece the caller
   * still wants is never re-rolled away. Without it, a needed piece
   * sitting in the far queue gets thrashed out — and duplicate damping
   * makes re-rolling that same kind actively UNLIKELY, since its own
   * visible copy damps its weight during the re-roll.
   */
  refreshTail(fromIdx: number, keep?: (kind: PlaceableKind) => boolean): void {
    for (let i = Math.max(0, fromIdx); i < this.items.length; i++) {
      if (keep?.(this.items[i]!)) continue;
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
