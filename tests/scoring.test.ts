import { describe, expect, it } from 'vitest';
import { fillPoints, SCORE } from '../src/core/scoring';
import { REPLACE_LOCKOUT_MS } from '../src/core/round';
import { at, lay, makeLevel, makeTestRound, run } from './helpers';

describe('fillPoints', () => {
  it('scores 50 before distance, 100 after', () => {
    const base = { kind: 'normal' as const, fastForward: false, expertAlternated: false };
    expect(fillPoints({ ...base, distanceMet: false })).toBe(50);
    expect(fillPoints({ ...base, distanceMet: true })).toBe(100);
  });

  it('bonus and reservoir pieces score 500/1000', () => {
    const base = { fastForward: false, expertAlternated: false };
    expect(fillPoints({ ...base, kind: 'bonusPiece', distanceMet: false })).toBe(500);
    expect(fillPoints({ ...base, kind: 'bonusPiece', distanceMet: true })).toBe(1000);
    expect(fillPoints({ ...base, kind: 'reservoir', distanceMet: false })).toBe(500);
    expect(fillPoints({ ...base, kind: 'reservoir', distanceMet: true })).toBe(1000);
  });

  it('fast forward doubles, alternation adds 100', () => {
    expect(
      fillPoints({ kind: 'normal', distanceMet: false, fastForward: true, expertAlternated: false }),
    ).toBe(100);
    expect(
      fillPoints({ kind: 'normal', distanceMet: true, fastForward: false, expertAlternated: true }),
    ).toBe(200);
  });
});

describe('round scoring', () => {
  it('50/100 boundary lands exactly at the distance requirement', () => {
    const round = makeTestRound(makeLevel({ distance: 3 }));
    lay(round, 2, 3, 'H');
    lay(round, 3, 3, 'H');
    lay(round, 4, 3, 'H');
    lay(round, 5, 3, 'H');
    const events = run(round, 10000);
    // pipes 1-3 at 50 (flag flips after pipe 3), pipe 4 at 100
    expect(round.scores[0]).toBe(150 + 100);
    const met = events.findIndex((e) => e.type === 'distanceMet');
    expect(met).toBeGreaterThan(-1);
    expect(round.result!.won).toBe(true);
  });

  it('penalizes unused placed pipes at round end', () => {
    const round = makeTestRound(makeLevel({ distance: 2 }));
    lay(round, 2, 3, 'H');
    lay(round, 3, 3, 'H');
    lay(round, 6, 6, 'X'); // never reached
    lay(round, 7, 6, 'V'); // never reached
    run(round, 10000);
    expect(round.result!.unusedCount).toBe(2);
    expect(round.scores[0]).toBe(100 + 2 * SCORE.unusedPipePenalty);
  });

  it('replacement costs 50 and respects the lockout', () => {
    const round = makeTestRound(makeLevel({ delayMs: 60000 }));
    const events1 = round.apply({ type: 'place', player: 0, pos: at(5, 5) });
    expect(events1.some((e) => e.type === 'piecePlaced')).toBe(true);
    // Immediate re-place is rejected (lockout).
    const events2 = round.apply({ type: 'place', player: 0, pos: at(5, 5) });
    expect(events2.length).toBe(0);
    run(round, REPLACE_LOCKOUT_MS + 50);
    const events3 = round.apply({ type: 'place', player: 0, pos: at(5, 5) });
    const placed = events3.find((e) => e.type === 'piecePlaced');
    expect(placed && placed.type === 'piecePlaced' && placed.wasReplacement).toBe(true);
    expect(round.scores[0]).toBe(SCORE.replacePenalty);
  });

  it('cannot replace fixed or filled pieces', () => {
    const round = makeTestRound(makeLevel({ distance: 1 }));
    round.grid.set(at(5, 5), round.grid.makePiece('OBSTACLE', null, true, 0));
    expect(round.apply({ type: 'place', player: 0, pos: at(5, 5) }).length).toBe(0);
    lay(round, 2, 3, 'H');
    run(round, 5000); // flow fills (2,3) then spills
    expect(round.over).toBe(true);
  });

  it('losing when distance not met', () => {
    const round = makeTestRound(makeLevel({ distance: 5 }));
    lay(round, 2, 3, 'H');
    run(round, 10000);
    expect(round.result!.won).toBe(false);
    expect(round.result!.pipesFilled).toBe(1);
  });

  it('requireEndPiece: distance met but no end reached is a loss', () => {
    const level = makeLevel({ distance: 2, requireEndPiece: true });
    const round = makeTestRound(level);
    lay(round, 2, 3, 'H');
    lay(round, 3, 3, 'H');
    run(round, 10000);
    expect(round.result!.pipesFilled).toBe(2);
    expect(round.result!.won).toBe(false);
  });
});

describe('competitive scoring', () => {
  it('attributes points to the player who placed each pipe', () => {
    const round = makeTestRound(makeLevel({ distance: 2 }), {
      mode: 'competitive',
      players: 2,
    });
    lay(round, 2, 3, 'H', 0);
    lay(round, 3, 3, 'H', 1);
    lay(round, 4, 3, 'H', 0);
    run(round, 10000);
    // p0: pipe1 50 + pipe3 100 (after distance); p1: pipe2 50
    expect(round.scores[0]).toBe(150);
    expect(round.scores[1]).toBe(50);
  });
});

describe('original-manual feats', () => {
  it('awards the 5-cross loop bonus once, on the 5th double-passed cross', () => {
    // Horizontal pass through 5 crosses, then a weave that descends and
    // climbs back through each cross vertically (both channels filled).
    const round = makeTestRound(makeLevel({ delayMs: 50, distance: 3 }));
    for (let x = 2; x <= 6; x++) lay(round, x, 3, 'X');
    lay(round, 7, 3, 'NW');
    lay(round, 7, 2, 'SW');
    lay(round, 6, 2, 'SE');
    lay(round, 6, 4, 'NW');
    lay(round, 5, 4, 'NE');
    lay(round, 5, 2, 'SW');
    lay(round, 4, 2, 'SE');
    lay(round, 4, 4, 'NW');
    lay(round, 3, 4, 'NE');
    lay(round, 3, 2, 'SW');
    lay(round, 2, 2, 'SE');
    round.apply({ type: 'fastForward', player: 0 });
    const events = run(round, 60000);
    const loops = events.filter((e) => e.type === 'loopBonus');
    expect(loops.length).toBe(1);
    expect(loops[0]).toMatchObject({ points: SCORE.crossLoop, crosses: 5 });
    expect(events.filter((e) => e.type === 'crossCompleted').length).toBe(5);
  });

  it('awards the full-board bonus when every square is swept', () => {
    // 4x3 board, serpentine through all 12 cells ending at the far wall.
    const level = makeLevel({
      gridW: 4,
      gridH: 3,
      delayMs: 50,
      distance: 3,
      start: { pos: { x: 0, y: 0 }, exit: 1 },
    });
    const round = makeTestRound(level);
    lay(round, 1, 0, 'H');
    lay(round, 2, 0, 'H');
    lay(round, 3, 0, 'SW');
    lay(round, 3, 1, 'NW');
    lay(round, 2, 1, 'H');
    lay(round, 1, 1, 'H');
    lay(round, 0, 1, 'SE');
    lay(round, 0, 2, 'NE');
    lay(round, 1, 2, 'H');
    lay(round, 2, 2, 'H');
    lay(round, 3, 2, 'H');
    round.apply({ type: 'fastForward', player: 0 });
    const events = run(round, 60000);
    const full = events.filter((e) => e.type === 'fullBoard');
    expect(full.length).toBe(1);
    expect(full[0]).toMatchObject({ points: SCORE.fullBoard });
  });
});
