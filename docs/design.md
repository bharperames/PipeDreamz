# PipeDreamz — Design Notes

## Architecture

- `src/core/` — pure, deterministic game simulation. No DOM, no canvas, no
  `Math.random()` (seeded mulberry32 via injection), no wall clock. Time
  enters exclusively through `tick(dtMs)`; the app runs it at a fixed
  120 Hz timestep via an accumulator. Everything here is unit-tested.
  - `pieces.ts` — connectivity table; the cross piece is two independent
    channels, which is what makes the double-pass/self-cross emerge naturally.
  - `flow.ts` — flooz head traversal: countdown, per-piece fill durations
    (reservoirs ×2.5), fast-forward (~80 ms/pipe), spill conditions,
    one-way enforcement, wrap-around via declared edge openings.
  - `round.ts` — action validation (placement, bombing with lockout and
    materialize delay), scoring attribution, expert-mode dispenser
    alternation, end-of-round tally.
  - `bonus.ts` — the every-4th-level sliding-puzzle bonus round.
  - `levels/` — timing curve formulas plus 36 hand-authored original layouts.
- `src/render2d/` — canvas renderer. All drawing happens in a small internal
  framebuffer (~370×220 px depending on board size) blitted to the display
  canvas with integer nearest-neighbor scaling: the authentic look of a
  low-res 1989 home-computer screen. Piece sprites are original pixel art
  drawn in code and cached as offscreen canvases. Flooz fill is drawn by
  sampling each channel's parametric path up to the fill progress.
- `src/audio/` — original compositions for a 4-channel tracker-style
  sequencer (square lead, pulse harmony, triangle bass, noise drums) and
  procedurally synthesized retro SFX. No audio assets are shipped; everything
  is generated with the Web Audio API at runtime.

## Timing (from the reference-card mechanics)

- Countdown: 20 s at level 1, −450 ms per level, floor 5 s.
- Fill per pipe: 2000 ms at level 1 decaying exponentially to 400 ms at 36.
- Distance quota: 8 pipes at level 1 rising to 30 at level 36.
- Fast flow: fill clamps to 80 ms per pipe; all fill scoring ×2; irreversible.
- Reservoirs fill at 2.5× the level fill time (that is the time they buy).
- Bomb replacement: −50, 500 ms lockout before a piece may be replaced,
  350 ms materialize delay before the new piece is connectable.

## Scoring table

| Event | Points |
|---|---|
| Pipe filled before / after quota | 50 / 100 |
| Crossover self-cross | 500 |
| Bonus or reservoir piece before / after quota | 500 / 1000 |
| End tank | 1000 |
| Bomb replacement | −50 |
| Unused placed pipe at round end | −100 each |
| Fast flow | ×2 per fill |
| Expert alternation | +100 per alternated pipe |
| Bonus round | 100 per pipe, no penalties |

## Faithfulness vs. originality

Game rules and timing follow the published reference-card description of the
1989 original. All expressive assets — sprites, palette, music, sound, level
layouts, text — are original work created for this project. Where the
original's exact behavior is undocumented (e.g. two-player dispenser
sharing), the chosen ruling is isolated in one place so it is cheap to
change after playtesting against period footage.
