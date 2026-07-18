import { DIR, Dir, PieceKind } from './types';

/**
 * Channels per piece kind. Each channel is a pair of connected sides.
 * For ordered (one-way) pieces the first element is the only legal entry.
 * The cross piece has two independent channels, which is what allows the
 * flooz to pass through it twice (once per axis).
 */
export const CONNECTIONS: Record<PieceKind, ReadonlyArray<readonly [Dir, Dir]>> = {
  H: [[DIR.W, DIR.E]],
  V: [[DIR.N, DIR.S]],
  // Elbow naming: sides the pipe opens toward.
  NE: [[DIR.N, DIR.E]],
  NW: [[DIR.N, DIR.W]],
  SE: [[DIR.S, DIR.E]],
  SW: [[DIR.S, DIR.W]],
  X: [
    [DIR.N, DIR.S],
    [DIR.W, DIR.E],
  ],
  START: [], // exit dir comes from level data
  END: [], // entry allowed from any side; handled in flow
  OBSTACLE: [],
  // One-way: flooz may only travel toward the arrow direction.
  ONEWAY_N: [[DIR.S, DIR.N]],
  ONEWAY_E: [[DIR.W, DIR.E]],
  ONEWAY_S: [[DIR.N, DIR.S]],
  ONEWAY_W: [[DIR.E, DIR.W]],
  RESERVOIR_H: [[DIR.W, DIR.E]],
  RESERVOIR_V: [[DIR.N, DIR.S]],
  BONUS: [], // bonus pieces are placeable-shaped; see level data usage
};

export function isOneWay(kind: PieceKind): boolean {
  return kind.startsWith('ONEWAY_');
}

export function isReservoir(kind: PieceKind): boolean {
  return kind.startsWith('RESERVOIR_');
}

/** Channels for a piece, resolving BONUS (a bonus-scoring cross piece). */
export function channelsOf(kind: PieceKind): ReadonlyArray<readonly [Dir, Dir]> {
  if (kind === 'BONUS') return CONNECTIONS.X;
  return CONNECTIONS[kind];
}

/**
 * Find the channel index a flow entering from `entry` would use, or null.
 * `entry` is the side of THIS piece the flooz comes in through.
 * One-way pieces only accept entry on the first element of their channel.
 */
export function findChannel(kind: PieceKind, entry: Dir): number | null {
  const chans = channelsOf(kind);
  for (let i = 0; i < chans.length; i++) {
    const ch = chans[i]!;
    if (isOneWay(kind)) {
      if (ch[0] === entry) return i;
    } else if (ch[0] === entry || ch[1] === entry) {
      return i;
    }
  }
  return null;
}

/** Exit side for flow entering channel `idx` from side `entry`. */
export function channelExit(kind: PieceKind, idx: number, entry: Dir): Dir {
  const ch = channelsOf(kind)[idx]!;
  return ch[0] === entry ? ch[1] : ch[0];
}

/** Number of channels a piece has (used to init ChannelState[]). */
export function channelCount(kind: PieceKind): number {
  if (kind === 'END' || kind === 'START') return 1;
  return Math.max(1, channelsOf(kind).length);
}
