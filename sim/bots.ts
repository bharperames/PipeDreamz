import { GameRound } from '../src/core/round';
import { channelExit, findChannel } from '../src/core/pieces';
import { Grid } from '../src/core/grid';
import { Rng } from '../src/core/rng';
import {
  Dir,
  GridPos,
  LevelDef,
  opposite,
  PieceKind,
  PlaceableKind,
} from '../src/core/types';

/**
 * Simulation bots. Each bot makes one decision per "reaction time"
 * interval: place the next queue piece somewhere useful, discard it out
 * of the way, or hit fast-forward. Bots only know what a player knows:
 * the board and the visible queue.
 */

export type BotAction =
  | { type: 'place'; pos: GridPos }
  | { type: 'fast' }
  | { type: 'wait' };

export interface Bot {
  readonly name: string;
  decide(round: GameRound): BotAction;
  /** Count of pieces this bot dumped away from its plan. */
  discards: number;
}

const key = (p: GridPos) => `${p.x},${p.y}`;

/** Follow the pipeline from the flow front to the first empty cell. */
export function walkToGap(round: GameRound): { pos: GridPos; entry: Dir } | null {
  let pos: GridPos;
  let exit: Dir;
  const head = round.flow.head;
  if (head && round.flow.state === 'flowing') {
    const piece = round.grid.get(head.pos)!;
    if (piece.kind === 'END') return null; // pipeline is terminal
    pos = head.pos;
    exit =
      piece.kind === 'START'
        ? round.level.start.exit
        : channelExit(piece.kind, head.channelIdx, head.entryDir);
  } else {
    pos = round.level.start.pos;
    exit = round.level.start.exit;
  }
  const seen = new Set<string>();
  for (let i = 0; i < round.level.gridW * round.level.gridH * 2; i++) {
    const step = round.grid.neighbor(pos, exit);
    if (!step) return null;
    const piece = round.grid.get(step.pos);
    if (!piece) return { pos: step.pos, entry: opposite(exit) };
    if (piece.kind === 'OBSTACLE' || piece.kind === 'START' || piece.kind === 'END') return null;
    const entry = opposite(exit);
    const ch = findChannel(piece.kind, entry);
    if (ch === null || piece.channels[ch]!.filled) return null;
    const k = `${key(step.pos)}:${ch}`;
    if (seen.has(k)) return null;
    seen.add(k);
    exit = channelExit(piece.kind, ch, entry);
    pos = step.pos;
  }
  return null;
}

/** Empty cell far from the gap, avoiding protected cells. */
function discardTarget(
  round: GameRound,
  protectedCells: Set<string>,
  gap: GridPos | null,
): GridPos | null {
  let best: GridPos | null = null;
  let bestDist = -1;
  for (let y = 0; y < round.level.gridH; y++) {
    for (let x = 0; x < round.level.gridW; x++) {
      const pos = { x, y };
      if (round.grid.get(pos)) continue;
      if (protectedCells.has(key(pos))) continue;
      const d = gap ? Math.abs(x - gap.x) + Math.abs(y - gap.y) : x + y;
      if (d > bestDist) {
        bestDist = d;
        best = pos;
      }
    }
  }
  return best;
}

/**
 * Extends the pipeline whenever the next piece fits the gap. Discards
 * only to cycle toward a fitting piece VISIBLE in the queue — patient
 * players don't burn -100s dumping pieces with nothing better coming.
 */
export class GreedyBot implements Bot {
  readonly name: string = 'greedy';
  discards = 0;

  decide(round: GameRound): BotAction {
    const gap = walkToGap(round);
    const next = round.queues[0]!.next();
    const fits = (k: PlaceableKind) => gap !== null && findChannel(k, gap.entry) !== null;
    if (gap && fits(next)) {
      return { type: 'place', pos: gap.pos };
    }
    // Quota met and nothing useful: cash out with fast flow.
    if (round.flow.pipesFilled >= round.level.distance && round.flow.state === 'flowing') {
      return { type: 'fast' };
    }
    // Cycle only when a fitting piece is visible further up the queue.
    if (gap && round.queues[0]!.peek().slice(1).some(fits)) {
      const dump = discardTarget(round, new Set(), gap.pos);
      if (dump) {
        this.discards++;
        return { type: 'place', pos: dump };
      }
    }
    return { type: 'wait' };
  }
}

/**
 * Loop chaser: like greedy, but when a cross lands on the pipeline it
 * plans the classic 3-elbow loop back through the cross's other axis
 * (the +500 self-cross bonus) and prioritizes completing that plan.
 */
export class LooperBot implements Bot {
  readonly name: string = 'looper';
  discards = 0;
  private plan = new Map<string, PlaceableKind>();

  private loopTemplate(x: number, y: number, entry: Dir): Array<[GridPos, PlaceableKind]> {
    switch (entry) {
      case 3: // flow heading E through the cross
        return [
          [{ x: x + 1, y }, 'SW'],
          [{ x: x + 1, y: y + 1 }, 'NW'],
          [{ x, y: y + 1 }, 'NE'],
        ];
      case 1: // heading W
        return [
          [{ x: x - 1, y }, 'SE'],
          [{ x: x - 1, y: y + 1 }, 'NE'],
          [{ x, y: y + 1 }, 'NW'],
        ];
      case 0: // heading S
        return [
          [{ x, y: y + 1 }, 'NW'],
          [{ x: x - 1, y: y + 1 }, 'NE'],
          [{ x: x - 1, y }, 'SE'],
        ];
      case 2: // heading N
        return [
          [{ x, y: y - 1 }, 'SE'],
          [{ x: x + 1, y: y - 1 }, 'SW'],
          [{ x: x + 1, y }, 'NW'],
        ];
    }
  }

  decide(round: GameRound): BotAction {
    const gap = walkToGap(round);
    const next = round.queues[0]!.next();

    // Complete an existing loop plan first.
    for (const [k, kind] of this.plan) {
      const [x, y] = k.split(',').map(Number);
      const pos = { x: x!, y: y! };
      const placed = round.grid.get(pos);
      if (placed) {
        if (placed.kind !== kind) this.plan.delete(k); // someone overwrote it
        else this.plan.delete(k); // done
        continue;
      }
      if (next === kind) {
        this.plan.delete(k);
        return { type: 'place', pos };
      }
    }

    if (gap && findChannel(next, gap.entry) !== null) {
      if (next === 'X') {
        const template = this.loopTemplate(gap.pos.x, gap.pos.y, gap.entry);
        const viable = template.every(
          ([p]) => round.grid.inBounds(p) && !round.grid.get(p) && !this.plan.has(key(p)),
        );
        if (viable) for (const [p, kind] of template) this.plan.set(key(p), kind);
      }
      return { type: 'place', pos: gap.pos };
    }
    if (round.flow.pipesFilled >= round.level.distance && round.flow.state === 'flowing') {
      return { type: 'fast' };
    }
    // Cycle only when the queue visibly holds a piece we want (for the
    // gap or for an open loop-plan cell).
    const wanted = new Set<PlaceableKind>();
    if (gap) {
      for (const k of ['H', 'V', 'NE', 'NW', 'SE', 'SW', 'X'] as PlaceableKind[]) {
        if (findChannel(k, gap.entry) !== null) wanted.add(k);
      }
    }
    for (const kind of this.plan.values()) wanted.add(kind);
    if (round.queues[0]!.peek().slice(1).some((k) => wanted.has(k))) {
      const protectedCells = new Set(this.plan.keys());
      const dump = discardTarget(round, protectedCells, gap?.pos ?? null);
      if (dump) {
        this.discards++;
        return { type: 'place', pos: dump };
      }
    }
    return { type: 'wait' };
  }
}

/**
 * Route planner for goal levels: BFS a path from the start to the END
 * tank, lengthen it with detour "bumps" until it satisfies the distance
 * quota, then build exactly that route (discarding non-matching pieces)
 * and fast-forward once complete.
 */
export class RouteBot implements Bot {
  readonly name: string = 'route';
  discards = 0;
  private route: Array<{ pos: GridPos; kind: PlaceableKind }> = [];
  private routeKeys = new Set<string>();
  private fastFired = false;

  constructor(level: LevelDef, grid: Grid, rng: Rng) {
    const cells = this.planRoute(level, grid, rng);
    if (cells) {
      this.route = cells;
      this.routeKeys = new Set(cells.map((c) => key(c.pos)));
    }
  }

  /** Piece kind connecting entry->exit sides. */
  private kindFor(entry: Dir, exit: Dir): PlaceableKind {
    const set = new Set([entry, exit]);
    if (set.has(0) && set.has(2)) return 'V';
    if (set.has(1) && set.has(3)) return 'H';
    if (set.has(0) && set.has(1)) return 'NE';
    if (set.has(0) && set.has(3)) return 'NW';
    if (set.has(2) && set.has(1)) return 'SE';
    return 'SW';
  }

  /**
   * Randomized meander search: seeded DFS walks that wander AWAY from
   * the END until the path is quota-length, then steer home. Best
   * end-reaching walk across restarts wins.
   */
  private planRoute(
    level: LevelDef,
    grid: Grid,
    rng: Rng,
  ): Array<{ pos: GridPos; kind: PlaceableKind }> | null {
    const end = level.fixed.find((f) => f.kind === 'END');
    if (!end) return null;
    const startStep = grid.neighbor(level.start.pos, level.start.exit);
    if (!startStep) return null;
    const target = end.pos;

    interface Cell {
      pos: GridPos;
      entry: Dir;
      exit?: Dir;
    }
    let best: Cell[] | null = null;

    for (let attempt = 0; attempt < 400; attempt++) {
      const visited = new Set<string>([key(startStep.pos)]);
      const path: Cell[] = [{ pos: startStep.pos, entry: opposite(level.start.exit) }];
      let reached = false;

      for (let step = 0; step < 300; step++) {
        const cur = path[path.length - 1]!;
        const wantEnd = path.length >= level.distance;
        interface Option {
          exit: Dir;
          pos: GridPos;
          isEnd: boolean;
          score: number;
        }
        const options: Option[] = [];
        for (const exit of [0, 1, 2, 3] as Dir[]) {
          if (exit === cur.entry) continue;
          const nb = grid.neighbor(cur.pos, exit);
          if (!nb) continue;
          const isEnd = nb.pos.x === target.x && nb.pos.y === target.y;
          if (!isEnd && (grid.get(nb.pos) || visited.has(key(nb.pos)))) continue;
          const dist = Math.abs(nb.pos.x - target.x) + Math.abs(nb.pos.y - target.y);
          // Wander away from the END while short, then steer toward it.
          const score = (wantEnd ? -dist : dist) + rng.next() * 2.5;
          options.push({ exit, pos: nb.pos, isEnd, score });
        }
        if (!options.length) break;
        const endOpt = options.find((o) => o.isEnd);
        if (endOpt && wantEnd) {
          cur.exit = endOpt.exit;
          reached = true;
          break;
        }
        const walkable = options.filter((o) => !o.isEnd);
        if (!walkable.length) {
          if (endOpt) {
            cur.exit = endOpt.exit;
            reached = true;
          }
          break;
        }
        walkable.sort((a, b) => b.score - a.score);
        const choice = walkable[0]!;
        cur.exit = choice.exit;
        visited.add(key(choice.pos));
        path.push({ pos: choice.pos, entry: opposite(choice.exit) });
      }

      if (reached) {
        if (path.length >= level.distance) {
          best = path;
          break;
        }
        if (!best || path.length > best.length) best = path;
      }
    }

    if (!best) return null;
    return best.map((c) => ({ pos: c.pos, kind: this.kindFor(c.entry, c.exit!) }));
  }

  decide(round: GameRound): BotAction {
    if (!this.route.length) {
      // No END route available: behave like greedy.
      const gap = walkToGap(round);
      const next = round.queues[0]!.next();
      if (gap && findChannel(next, gap.entry) !== null) return { type: 'place', pos: gap.pos };
      const dump = discardTarget(round, new Set(), gap?.pos ?? null);
      if (dump) {
        this.discards++;
        return { type: 'place', pos: dump };
      }
      return { type: 'wait' };
    }
    const queue = round.queues[0]!.peek();
    const next = queue[0]!;
    // Build any still-empty route cell whose kind we're holding (order
    // doesn't matter for correctness, and it uses more of the queue).
    const wanted = new Set<PlaceableKind>();
    let complete = true;
    let firstOpen: GridPos | null = null;
    for (const cell of this.route) {
      const placed = round.grid.get(cell.pos);
      if (placed) continue;
      complete = false;
      firstOpen ??= cell.pos;
      if (next === cell.kind) return { type: 'place', pos: cell.pos };
      wanted.add(cell.kind);
    }
    if (complete) {
      if (!this.fastFired) {
        this.fastFired = true;
        return { type: 'fast' };
      }
      return { type: 'wait' };
    }
    // Cycle only when a wanted kind is visible in the queue.
    if (queue.slice(1).some((k) => wanted.has(k))) {
      const dump = discardTarget(round, this.routeKeys, firstOpen);
      if (dump) {
        this.discards++;
        return { type: 'place', pos: dump };
      }
    }
    return { type: 'wait' };
  }
}

export function makeBot(kind: string, level: LevelDef, grid: Grid, rng: Rng): Bot {
  if (kind === 'looper') return new LooperBot();
  if (kind === 'route') return new RouteBot(level, grid, rng);
  return new GreedyBot();
}

export type { PieceKind };
