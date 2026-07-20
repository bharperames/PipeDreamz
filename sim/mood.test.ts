import { describe, expect, it } from 'vitest';
import { GameRound } from '../src/core/round';
import { mulberry32 } from '../src/core/rng';
import { LEVELS } from '../src/core/levels/levels';
import { Bot, makeBot } from './bots';

/**
 * Mood-transition telemetry: samples panicLevel() every 250ms of sim
 * time across bot games and scores the transition tuning against what
 * a good "excitement track" should look like:
 *
 *  1. TENSION IS HONEST — losing games should end frantic: mood >= 4
 *     one second before the spill, >= 3 at 2.5s before.
 *  2. HEALTHY PLAY ISN'T FRANTIC — while the spill is > 8s away, the
 *     frantic tiers (4-5) should be rare and the mean mood moderate.
 *  3. HE ISN'T A STATUE — no single mood should dominate the round,
 *     and post-quota he should stay engaged (1-3) rather than flatline.
 *  4. NO STROBING — mood direction reversals should be infrequent.
 */

const RUN_SIM = !!process.env.RUN_SIM;
const GAMES = Number(process.env.SIM_GAMES ?? 300);
const TICK = 1000 / 60;
const MAX_SIM_MS = 300_000;
const SAMPLE_MS = 250;

interface MoodTrace {
  won: boolean;
  endMs: number;
  quotaAtMs: number | null;
  /** pq is the round's own distanceMet flag AT sampling time — using
   *  the event timestamp instead misfiles the final pre-quota sample
   *  (same-tick boundary) into the post-quota bucket. */
  samples: Array<{ t: number; mood: number; pq: boolean }>;
}

function runMoodGame(
  levelId: number,
  botKind: 'greedy' | 'route',
  reactionMs: number,
  easy: boolean,
  seed: number,
): MoodTrace {
  const level = LEVELS[levelId - 1]!;
  const rng = mulberry32(seed);
  const round = new GameRound(
    { level, mode: 'basic', seed, players: 1, easyQueue: easy },
    mulberry32(seed ^ 0x9e3779b9),
  );
  const bot: Bot = makeBot(botKind, level, round.grid, rng);

  let simMs = 0;
  let sinceDecision = 0;
  let sinceSample = 0;
  let quotaAtMs: number | null = null;
  const jitter = () => reactionMs * (0.8 + rng.next() * 0.4);
  let nextDecisionIn = jitter();
  const samples: Array<{ t: number; mood: number; pq: boolean }> = [
    { t: 0, mood: round.panicLevel(), pq: false },
  ];

  while (!round.over && simMs < MAX_SIM_MS) {
    const events = round.tick(TICK);
    for (const e of events) {
      if (e.type === 'distanceMet' && quotaAtMs === null) quotaAtMs = simMs;
    }
    simMs += TICK;
    sinceDecision += TICK;
    sinceSample += TICK;
    if (sinceSample >= SAMPLE_MS) {
      sinceSample = 0;
      if (!round.over) {
        samples.push({ t: simMs, mood: round.panicLevel(), pq: round.distanceMet });
      }
    }
    if (sinceDecision >= nextDecisionIn && !round.over) {
      sinceDecision = 0;
      nextDecisionIn = jitter();
      const action = bot.decide(round);
      if (action.type === 'place') round.apply({ type: 'place', player: 0, pos: action.pos });
      else if (action.type === 'fast') round.apply({ type: 'fastForward', player: 0 });
    }
  }
  return { won: round.result?.won ?? false, endMs: simMs, quotaAtMs, samples };
}

function moodAt(trace: MoodTrace, t: number): number | null {
  let best: { t: number; mood: number } | null = null;
  for (const s of trace.samples) {
    if (s.t <= t && (!best || s.t > best.t)) best = s;
  }
  return best?.mood ?? null;
}

interface Report {
  label: string;
  share: number[];
  franticAt1s: number;
  concernAt2500: number;
  healthyMean: number;
  healthyFranticShare: number;
  postQuotaMean: number;
  postQuotaFranticShare: number;
  maxShare: number;
  flipsPerMin: number;
  debouncedFlipsPerMin: number;
}

/**
 * The presentation-layer debounce: adjacent-level drifts must persist
 * for 4 consecutive samples (~1s) — queue churn flaps the ±1 modifiers
 * at the placement cadence — while escalations to the frantic tiers or
 * jumps of 2+ apply immediately (spills must stay telegraphed).
 */
const HOLD_SAMPLES = 4;

function debounce(samples: Array<{ mood: number }>): number[] {
  const out: number[] = [];
  let shown = samples[0]?.mood ?? 0;
  let pending = -1;
  let held = 0;
  for (const s of samples) {
    if (s.mood === shown) {
      pending = -1;
    } else if (s.mood >= 4 || Math.abs(s.mood - shown) >= 2) {
      shown = s.mood;
      pending = -1;
    } else if (s.mood === pending) {
      if (++held >= HOLD_SAMPLES) {
        shown = s.mood;
        pending = -1;
      }
    } else {
      pending = s.mood;
      held = 1;
    }
    out.push(shown);
  }
  return out;
}

function analyze(label: string, traces: MoodTrace[]): Report {
  const share = new Array(7).fill(0);
  let total = 0;
  let healthySum = 0;
  let healthyN = 0;
  let healthyFrantic = 0;
  let pqSum = 0;
  let pqN = 0;
  let pqFrantic = 0;
  let flips = 0;
  let dbFlips = 0;
  let minutes = 0;
  let losses = 0;
  let franticAt1s = 0;
  let concernAt2500 = 0;

  for (const tr of traces) {
    minutes += tr.endMs / 60000;
    let prev: number | null = null;
    let dir = 0;
    for (const s of tr.samples) {
      share[s.mood]!++;
      total++;
      const timeToEnd = tr.endMs - s.t;
      if (tr.won || timeToEnd > 8000) {
        // "Healthy" pre-quota play: not within 8s of a losing spill.
        if (!s.pq) {
          healthySum += s.mood;
          healthyN++;
          if (s.mood >= 4) healthyFrantic++;
        }
      }
      if (s.pq) {
        pqSum += s.mood;
        pqN++;
        if (s.mood >= 4) pqFrantic++;
      }
      if (prev !== null && s.mood !== prev) {
        const d = Math.sign(s.mood - prev);
        if (dir !== 0 && d !== dir) flips++;
        dir = d;
      }
      prev = s.mood;
    }
    let dprev: number | null = null;
    let ddir = 0;
    for (const m of debounce(tr.samples)) {
      if (dprev !== null && m !== dprev) {
        const d = Math.sign(m - dprev);
        if (ddir !== 0 && d !== ddir) dbFlips++;
        ddir = d;
      }
      dprev = m;
    }
    if (!tr.won) {
      losses++;
      const m1 = moodAt(tr, tr.endMs - 1000);
      const m25 = moodAt(tr, tr.endMs - 2500);
      if (m1 !== null && m1 >= 4) franticAt1s++;
      if (m25 !== null && m25 >= 3) concernAt2500++;
    }
  }

  return {
    label,
    share: share.map((n) => Math.round((n / total) * 1000) / 10),
    franticAt1s: losses ? franticAt1s / losses : 1,
    concernAt2500: losses ? concernAt2500 / losses : 1,
    healthyMean: healthyN ? healthySum / healthyN : 0,
    healthyFranticShare: healthyN ? healthyFrantic / healthyN : 0,
    postQuotaMean: pqN ? pqSum / pqN : 0,
    postQuotaFranticShare: pqN ? pqFrantic / pqN : 0,
    maxShare: Math.max(...share.map((n) => n / total)),
    flipsPerMin: minutes ? flips / minutes : 0,
    debouncedFlipsPerMin: minutes ? dbFlips / minutes : 0,
  };
}

function fmt(r: Report): string {
  return (
    `${r.label}\n` +
    `  time-share 0..6: [${r.share.join(', ')}]%\n` +
    `  losing spills: frantic(>=4) @T-1s ${(r.franticAt1s * 100).toFixed(0)}%, ` +
    `concern(>=3) @T-2.5s ${(r.concernAt2500 * 100).toFixed(0)}%\n` +
    `  healthy play: mean ${r.healthyMean.toFixed(2)}, frantic share ${(r.healthyFranticShare * 100).toFixed(1)}%\n` +
    `  post-quota: mean ${r.postQuotaMean.toFixed(2)}, frantic share ${(r.postQuotaFranticShare * 100).toFixed(1)}%\n` +
    `  max single-mood share ${(r.maxShare * 100).toFixed(0)}%, flips/min ${r.flipsPerMin.toFixed(1)} raw -> ${r.debouncedFlipsPerMin.toFixed(1)} debounced`
  );
}

describe.runIf(RUN_SIM)('plumber mood telemetry', () => {
  it('measures mood transitions across the matrix', () => {
    const cells: Array<[string, number, 'greedy' | 'route', number, boolean]> = [
      ['L1 greedy 500ms easy', 1, 'greedy', 500, true],
      ['L1 greedy 200ms normal', 1, 'greedy', 200, false],
      ['L5 greedy 500ms easy', 5, 'greedy', 500, true],
      ['L21 route 500ms easy', 21, 'route', 500, true],
    ];
    for (const [label, lvl, bot, ms, easy] of cells) {
      const traces: MoodTrace[] = [];
      for (let i = 0; i < GAMES; i++) {
        traces.push(runMoodGame(lvl, bot, ms, easy, 1000 + i * 7919));
      }
      const r = analyze(label, traces);
      console.log(fmt(r));
      expect(traces.length).toBe(GAMES);
    }
  });
});
