# PipeDreamz

An original browser tribute to the classic 1989 pipe-building puzzle game
(*Pipe Mania* / *Pipe Dream* by The Assembly Line), rendered in a faithful
retro pixel style with an authentic low-resolution framebuffer look.

**All artwork, music, sound effects, and level layouts in this project are
original creations** — pixel art drawn in code, chiptune music composed as
pattern data for a 4-channel Web Audio sequencer, and hand-authored levels.
Nothing is extracted from or copied out of the original game.

## Play

- **Build a pipeline** from the start piece before the flooz starts flowing.
- Pieces come from the dispenser on the left — the **bottom piece is next**,
  and pieces cannot be rotated.
- **Click / Space** places the piece under the cursor. Placing on top of an
  unfilled pipe bombs it (−50 and a short delay).
- Meet the level's pipe quota to advance. **F** speeds the flooz (double
  points), **P** pauses, **Esc** quits to the title.

### Modes

| Mode | Rules |
|---|---|
| Basic | One dispenser, five pieces queued |
| Expert | Two 3-deep dispensers; Shift/right-click uses the top one; alternating dispensers earns +100 per pipe |
| Competitive | Two players, one board — P2 uses WASD + Q; each pipe scores for whoever placed it |
| Training | Any of the above at a slower flow rate |

Every 4th level is a **bonus round**: a sliding-puzzle board with one empty
cell — arrange the pipes before the drain opens, 100 points per pipe filled.

### Scoring

50 per pipe (100 after the quota is met), 500 for a flooz crossover,
500/1000 for bonus and reservoir pieces, 1000 for the end tank,
−50 per bomb, −100 per unused pipe at round end, everything ×2 during
fast flow.

## Development

```sh
npm install
npm run dev     # local dev server
npm test        # core simulation test suite (vitest)
npm run build   # type-check + production build to dist/
```

The game core (`src/core/`) is a pure, deterministic, seeded simulation with
no DOM or rendering dependencies — the entire rule set is unit-tested,
including flow traversal, crossovers, one-way pipes, wrap-around tunnels,
reservoirs, scoring, and all 36 level definitions. The renderer
(`src/render2d/`) draws into a small internal framebuffer that is
integer-upscaled with nearest-neighbor sampling for the period-correct look.

## Deploy

The built site is committed to the repo root (`index.html`, `assets/`,
`.nojekyll`) so GitHub Pages serves it directly from the `main` branch
with zero configuration. To publish a new build:

```sh
npm run pages   # build + sync dist into the repo root
git commit -am "publish" && git push
```

Development uses `dev.html` as the source entry (`npm run dev` serves it
automatically at `/PipeDreamz/`); the root `index.html` is always the
last published build.
