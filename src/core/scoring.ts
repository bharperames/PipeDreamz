export const SCORE = {
  /** Per pipe filled before the distance requirement is met. */
  pipeBefore: 50,
  /** Per pipe filled after the distance requirement is met. */
  pipeAfter: 100,
  /** Flooz crossing itself in a cross pipe (second channel filled). */
  cross: 500,
  /** Bonus / reservoir pieces, before vs after distance met. */
  bonusBefore: 500,
  bonusAfter: 1000,
  endPiece: 1000,
  replacePenalty: -50,
  unusedPipePenalty: -100,
  expertAlternation: 100,
  fastForwardMultiplier: 2,
  /**
   * Looping the flooz through BOTH channels of at least 5 cross pieces
   * (documented original feat; value is our tuning — awarded once).
   */
  crossLoop: 5000,
  /**
   * Passing the flooz through every square on the board (documented
   * original feat; value is our tuning — awarded once).
   */
  fullBoard: 10000,
} as const;

export interface FillScoreInput {
  kind: 'normal' | 'bonusPiece' | 'reservoir';
  distanceMet: boolean;
  fastForward: boolean;
  expertAlternated: boolean;
}

/** Points for the flooz filling one pipe segment. */
export function fillPoints(input: FillScoreInput): number {
  let base: number;
  if (input.kind === 'bonusPiece' || input.kind === 'reservoir') {
    base = input.distanceMet ? SCORE.bonusAfter : SCORE.bonusBefore;
  } else {
    base = input.distanceMet ? SCORE.pipeAfter : SCORE.pipeBefore;
  }
  if (input.fastForward) base *= SCORE.fastForwardMultiplier;
  if (input.expertAlternated) base += SCORE.expertAlternation;
  return base;
}
