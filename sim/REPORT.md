# PipeDreamz Simulation Report

**~72,000 simulated games** against the real deterministic game core, profiling win
rates, scoring, and mechanic tuning across player reaction times, strategies,
levels, and the easy-queue system. Three A/B experiments were run; two shipped
tuning changes came directly out of the data, and one proposed change was
reverted after the data falsified it.

## 1. Methodology

- **Harness** (`sim/harness.ts`): each game runs the production `GameRound`
  (same code the browser executes) at a 60 Hz fixed timestep, up to 300 s of
  sim time. Nothing is mocked; scoring, flow, spills, and the easy-queue
  solver are the shipped implementations.
- **Reaction-time model**: a bot takes one action (place / discard / fast-flow /
  wait) per reaction interval, jittered ±20% — modeling how often a human can
  read the queue and commit. Tiers tested: **200 ms** (fast), **500 ms**
  (typical), **1000 ms** (deliberate).
- **Bots** (`sim/bots.ts`) — all see only what a player sees (board + visible queue):
  - **greedy** — extends the pipeline whenever the next piece fits its gap;
    discards only to cycle toward a fitting piece *visible* in the queue;
    presses F once the quota is met and nothing useful is held.
  - **looper** — greedy plus deliberate loop-building: when a cross lands on
    the pipeline it plans the 3-elbow return path for the +500 self-cross and
    prioritizes completing it (models "the user will probably be trying to
    make loops").
  - **route** — for END-goal levels: plans a quota-length path to the END tank
    (randomized meander search that wanders away from the END until the path
    is long enough, then steers home), builds exactly that route, discards
    non-matching pieces, and fast-forwards on completion.
- **Matrix**: levels **1** (open), **5** (obstacles), **13** (wrap tunnels),
  **21** and **24** (END required — quota 21/22 with obstacles/reservoir);
  × bots × reaction tiers × easy on/off; **250 games per cell** (18,000 per
  matrix run). The depth experiment used 500 games per cell.

## 2. Headline results (final shipped tuning)

Win % / mean score, **normal → easy queue**:

| Level | Bot | 200 ms | 500 ms | 1000 ms |
|---|---|---|---|---|
| L1 open | greedy | 40→**50** / 158→539 | 44→41 / 96→328 | 38→41 / 150→305 |
| L5 obstacles | greedy | 13→13 / −34→130 | 11→14 / −26→92 | 12→13 / −22→121 |
| L13 wraps | greedy | 3→5 / −80→12 | 5→5 / −33→37 | 4→6 / −63→53 |
| L21 END | route | 10→**42** / −750→**1153** | 10→**42** / −961→860 | 0→0 / −839→−801 |
| L24 END | route | 11→**36** / −532→**1119** | 7→**42** / −954→1087 | 0→0 / −708→−634 |

- **Easy mode pays for itself everywhere on score** (spread of +170 to +1900)
  and is neutral-to-strongly-positive on win rate.
- **Goal levels are where easy mode shines**: 4× the win rate, END reached in
  42% of games (vs ~10%), because the connect-to-your-network boost hands the
  route builder exactly the linking pieces.
- Crossover (loop) bonuses under easy roughly **double-to-quadruple**
  (L1 200 ms: 0.08 → 0.31 crosses/game) as crosses survive in the mix.

## 3. Experiment A — duplicate damping (validated, kept)

Proposed change: exempt the first visible copy of a kind from duplicate
damping ("chains need repeats"). **The data said no**: with the exemption,
easy-mode wins *fell* (L1 greedy 200 ms: 34.8% → 28.0%; route L21 200 ms:
15.2% → 4.0%). Per-copy damping approximates **drawing without replacement**
— the variety it forces is worth more than repeat supply, for both chain play
and (especially) route building, which waits on specific kinds. The original
per-copy damping (×0.65 per visible copy, floor 0.15) is kept.

## 4. Experiment B — queue depth (falsified the depth-3 hypothesis)

Easy mode originally shortened the queue to 3 "to reduce conveyor delay".
500-game cells, easy mode on:

| Config | depth 3 | depth 4 | depth 5 |
|---|---|---|---|
| L1 greedy 200 ms | 30.4% | 41.0% | 40.2% |
| L1 greedy 500 ms | 31.4% | 36.8% | 41.4% |
| L21 route 200 ms | 14.4% | 29.8% | **44.4%** |
| L21 route 500 ms | 14.4% | 30.0% | **49.4%** |

The visible queue is **lookahead, not just delay**: every visible slot is a
cycling opportunity and a chance the needed kind is already on its way.
Depth 3 cost ~10 win-points on chains and **3.5×** on routes. **Shipped:
easy mode uses depth 5 again**; a `queueDepth` override remains in the core
for future experiments.

## 5. Other findings

1. **Deliberate loop-building doesn't pay at human speeds.** The looper bot
   underperformed greedy on every level — fewer wins *and fewer crosses*
   (L1 easy: 0.09 vs 0.16 crosses/game). Reserving three specific elbows for
   a loop starves pipeline survival. Most realized crossovers are incidental.
   → Recommendation: a "loop assist" tier for easy mode that boosts pieces
   completing a re-entry into a half-filled cross would make the +500 bonus a
   real strategy rather than luck.
2. **Deliberate players (1000 ms) cannot complete goal levels** — 0% wins at
   every setting, ~20–40 decisions total before the flooz outruns them on a
   21+ cell route. Easy mode can't fix a decision budget.
   → Recommendation: pair goal levels with Training mode by default for
   slower players, or scale the flooz delay with quota length.
3. **Difficulty curve is steep and front-loaded**: 40–50% (L1) → ~13% (L5) →
   ~5% (L13) for a competent chain player. Wrap tunnels (L13) are the
   sharpest cliff; worth revisiting quota or delay on wrap levels.
4. **Discard economics matter**: patient play (discarding only to cycle
   toward a visible fitting piece) is dramatically better than dumping every
   unfit piece — early bot runs that discarded freely averaged **−5,000**
   points from −100 penalties. The visible queue makes patience possible;
   another reason depth 5 wins.
5. **END-goal levels quietly demand meandering**: shortest paths to the END
   (7–10 cells) are far below quota (21–25), so winning requires deliberately
   long routes. The game never tells the player this. → Recommendation: hint
   copy on END-level intros ("the tank must be reached *after* the quota").

## 6. Shipped tuning changes from this study

- Easy-mode queue depth restored **3 → 5** (Experiment B).
- Duplicate damping kept **per-copy** (Experiment A confirmed the original).
- Easy solver retains: non-fitting starve (0.4), fit boost (4), open-exit
  boost (8), connect-to-network / END boost (16), discard-kind damping
  (×0.6, 3+ tiles from the flow front).

## 7. Reproducing

```sh
npm run sim                 # full matrix (~18k games) + depth A/B, ~2 min
SIM_GAMES=50 npm run sim    # quick pass
```

Raw aggregates: `sim/results.json`, `sim/depth_results.json`. The route
planner has its own regression test (`sim/route.test.ts`).
