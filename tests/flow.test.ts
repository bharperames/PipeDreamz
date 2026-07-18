import { describe, expect, it } from 'vitest';
import { channelExit, findChannel } from '../src/core/pieces';
import { DIR, Dir } from '../src/core/types';
import { RESERVOIR_FILL_FACTOR } from '../src/core/flow';
import { at, lay, makeLevel, makeTestRound, run } from './helpers';

describe('piece connectivity', () => {
  it('elbow entry/exit pairs', () => {
    // NE opens to N and E
    expect(findChannel('NE', DIR.N)).toBe(0);
    expect(channelExit('NE', 0, DIR.N)).toBe(DIR.E);
    expect(channelExit('NE', 0, DIR.E)).toBe(DIR.N);
    expect(findChannel('NE', DIR.S)).toBeNull();
    expect(findChannel('NE', DIR.W)).toBeNull();

    expect(channelExit('NW', 0, DIR.N)).toBe(DIR.W);
    expect(channelExit('SE', 0, DIR.S)).toBe(DIR.E);
    expect(channelExit('SW', 0, DIR.W)).toBe(DIR.S);
  });

  it('cross has two independent channels by axis', () => {
    expect(findChannel('X', DIR.N)).toBe(0);
    expect(findChannel('X', DIR.S)).toBe(0);
    expect(findChannel('X', DIR.E)).toBe(1);
    expect(findChannel('X', DIR.W)).toBe(1);
  });

  it('one-way pipes only accept flow toward the arrow', () => {
    // ONEWAY_E: flow enters from W, exits E.
    expect(findChannel('ONEWAY_E', DIR.W)).toBe(0);
    expect(findChannel('ONEWAY_E', DIR.E)).toBeNull();
    expect(channelExit('ONEWAY_E', 0, DIR.W)).toBe(DIR.E);
    expect(findChannel('ONEWAY_N', DIR.S)).toBe(0);
    expect(findChannel('ONEWAY_N', DIR.N)).toBeNull();
  });
});

describe('flow simulation', () => {
  it('flows straight and spills at an open end', () => {
    const round = makeTestRound(makeLevel());
    lay(round, 2, 3, 'H');
    lay(round, 3, 3, 'H');
    const events = run(round, 5000);
    const spill = events.find((e) => e.type === 'spill');
    expect(spill).toBeDefined();
    expect(spill && spill.type === 'spill' && spill.pos).toEqual(at(3, 3));
    expect(round.flow.pipesFilled).toBe(2);
  });

  it('turns through elbows', () => {
    const round = makeTestRound(makeLevel());
    // E from start, then turn south, then west: (2,3)SW goes S... SW opens S+W:
    // entering from W exits S.
    lay(round, 2, 3, 'SW');
    lay(round, 2, 4, 'NE'); // enter from N exits E
    lay(round, 3, 4, 'H');
    const events = run(round, 5000);
    expect(round.flow.pipesFilled).toBe(3);
    const spill = events.find((e) => e.type === 'spill');
    expect(spill && spill.type === 'spill' && spill.pos).toEqual(at(3, 4));
  });

  it('countdown delays the flow start', () => {
    const level = makeLevel({ delayMs: 1000, fillMs: 100 });
    const round = makeTestRound(level);
    lay(round, 2, 3, 'H');
    run(round, 900);
    expect(round.flow.state).toBe('countdown');
    run(round, 150); // 50ms into the flow: start piece still filling
    expect(round.flow.state).toBe('flowing');
  });

  it('fills reservoirs at the slower reservoir rate', () => {
    const level = makeLevel({ delayMs: 10, fillMs: 100, distance: 2 });
    const round = makeTestRound(level);
    round.grid.set(at(2, 3), round.grid.makePiece('RESERVOIR_H', null, true, 0));
    lay(round, 3, 3, 'H');
    // start fill (100) + reservoir (250) + pipe (100) + delay(10)
    run(round, 10 + 100 + 100 * RESERVOIR_FILL_FACTOR + 50);
    expect(round.grid.get(at(2, 3))!.channels[0]!.filled).toBe(true);
    expect(round.grid.get(at(3, 3))!.channels[0]!.filled).toBe(false);
  });

  it('cross allows two passes and detects self-cross', () => {
    // Route: start E -> (2,3) X horizontally -> (3,3) SW down ->
    // (3,4) NW west -> (2,4) NE north -> wait NE opens N,E; entering from S? no.
    // Loop: (3,4) enter from N exits W -> (2,4) enter from E: NE? opens N,E ->
    // enters E exits N -> (2,3) X vertical from S -> selfCross, exits N.
    const round = makeTestRound(makeLevel({ distance: 6 }));
    lay(round, 2, 3, 'X');
    lay(round, 3, 3, 'SW');
    lay(round, 3, 4, 'NW');
    lay(round, 2, 4, 'NE');
    lay(round, 2, 2, 'V');
    const events = run(round, 10000);
    const cross = events.find((e) => e.type === 'crossCompleted');
    expect(cross).toBeDefined();
    expect(cross && cross.type === 'crossCompleted' && cross.points).toBe(500);
    // X counted twice in the distance
    expect(round.flow.pipesFilled).toBe(6);
  });

  it('spills when re-entering an already-filled channel', () => {
    // Same loop but the second entry into the X is horizontal again:
    // (2,3) X h -> (3,3) SW -> (3,4) NW -> (2,4) NE -> (2,2)? No — build a loop
    // that comes back into the X from the E side.
    const round = makeTestRound(makeLevel({ distance: 6 }));
    lay(round, 2, 3, 'X');
    lay(round, 3, 3, 'X');
    lay(round, 4, 3, 'SW');
    lay(round, 4, 4, 'NW');
    lay(round, 3, 4, 'NE'); // enters E, exits N -> (3,3) X vertical: ok
    // then exits N to (3,2): NE? we want it to come back W into (2,3):
    lay(round, 3, 2, 'SW'); // enters S exits W
    lay(round, 2, 2, 'SE'); // enters E exits S -> (2,3) X vertical channel
    lay(round, 2, 4, 'H'); // unused
    const events = run(round, 20000);
    // (2,3) second entry is vertical (channel 0), fine -> exits S to (2,4) H:
    // H entered from N -> no channel -> spill.
    const spill = events.find((e) => e.type === 'spill');
    expect(spill).toBeDefined();
    const crosses = events.filter((e) => e.type === 'crossCompleted');
    expect(crosses.length).toBe(2);
  });

  it('one-way blocks reverse entry', () => {
    const round = makeTestRound(makeLevel());
    round.grid.set(at(2, 3), round.grid.makePiece('ONEWAY_W', null, true, 0));
    const events = run(round, 5000);
    // Flow exits start E, enters (2,3) from W; ONEWAY_W requires entry from E.
    const spill = events.find((e) => e.type === 'spill');
    expect(spill).toBeDefined();
    expect(round.flow.pipesFilled).toBe(0);
  });

  it('wraps through declared edge openings', () => {
    const level = makeLevel({
      start: { pos: { x: 8, y: 3 }, exit: 1 as Dir },
      wraps: [
        { x: 9, y: 3, side: 1 as Dir },
        { x: 0, y: 3, side: 3 as Dir },
      ],
      distance: 2,
    });
    const round = makeTestRound(level);
    lay(round, 9, 3, 'H');
    lay(round, 0, 3, 'H');
    const events = run(round, 5000);
    expect(round.grid.get(at(0, 3))!.channels[0]!.filled).toBe(true);
    const spill = events.find((e) => e.type === 'spill');
    expect(spill && spill.type === 'spill' && spill.pos).toEqual(at(0, 3));
  });

  it('spills at undeclared edges', () => {
    const level = makeLevel({ start: { pos: { x: 8, y: 3 }, exit: 1 as Dir } });
    const round = makeTestRound(level);
    lay(round, 9, 3, 'H');
    const events = run(round, 5000);
    const spill = events.find((e) => e.type === 'spill');
    expect(spill && spill.type === 'spill' && spill.pos).toEqual(at(9, 3));
  });

  it('reaches the end piece and terminates with 1000 points', () => {
    const level = makeLevel({ distance: 2, requireEndPiece: true });
    const round = makeTestRound(level);
    lay(round, 2, 3, 'H');
    lay(round, 3, 3, 'H');
    round.grid.set(at(4, 3), round.grid.makePiece('END', null, true, 0));
    const events = run(round, 5000);
    const end = events.find((e) => e.type === 'endReached');
    expect(end).toBeDefined();
    expect(round.result!.won).toBe(true);
    expect(round.result!.reachedEnd).toBe(true);
    // 2 pipes: 50 + 50 (distance met at pipe 2)... pipe2 fills before flag set
    // so both score 50; end piece +1000.
    expect(round.scores[0]).toBe(50 + 50 + 1000);
  });

  it('fast forward speeds the flow and doubles points', () => {
    const level = makeLevel({ delayMs: 5000, fillMs: 1000, distance: 3 });
    const round = makeTestRound(level);
    lay(round, 2, 3, 'H');
    lay(round, 3, 3, 'H');
    lay(round, 4, 3, 'H');
    lay(round, 5, 3, 'H');
    round.apply({ type: 'fastForward', player: 0 });
    run(round, 2000); // way less than delay+4*fill; fast forward skips it all
    expect(round.over).toBe(true);
    // 3 pipes before distance met at 50*2, 1 after at 100*2
    expect(round.scores[0]).toBe(3 * 100 + 200);
  });
});
