import { LEVELS } from '../core/levels/levels';
import { GameMode, RoundResult } from '../core/types';
import { SCORE } from '../core/scoring';
import { Renderer2D } from '../render2d/Renderer2D';
import { MusicPlayer, TrackName } from '../audio/MusicPlayer';
import { Sfx } from '../audio/Sfx';
import {
  addHighScore,
  getHighScores,
  getSettings,
  highScoreRank,
  saveSettings,
} from '../persistence/highscores';
import { BonusScreen } from './screens/BonusScreen';
import { PlayingScreen } from './screens/PlayingScreen';

interface Session {
  mode: GameMode;
  training: boolean;
  /** Easy mode: dispenser biased toward pieces the pipeline needs. */
  easy: boolean;
  levelIndex: number; // 0-based
  totals: [number, number];
  seedBase: number;
}

type ActiveScreen = PlayingScreen | BonusScreen | null;

export class App {
  private renderer: Renderer2D;
  private sfx = new Sfx();
  private music = new MusicPlayer();
  private menuRoot: HTMLElement;
  private screen: ActiveScreen = null;
  private session: Session | null = null;
  private lastFrame = 0;
  private audioUnlocked = false;
  private lastMusicVol = 0.35;

  constructor() {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    this.renderer = new Renderer2D(canvas);
    this.menuRoot = document.getElementById('menu')!;

    const settings = getSettings();
    this.sfx.volume = settings.sfxVol;
    this.music.volume = settings.musicVol;
    this.renderer.setRenderMode(settings.renderMode ?? 'smooth');
    this.applyScanlines();

    // Any first gesture unlocks audio (pointer, mouse, touch, or key).
    window.addEventListener('pointerdown', () => this.ensureAudio());
    window.addEventListener('mousedown', () => this.ensureAudio());
    window.addEventListener('touchstart', () => this.ensureAudio());
    window.addEventListener('keydown', () => this.ensureAudio());

    window.addEventListener('keydown', (e) => this.screen?.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.screen?.onKeyUp(e));
    window.addEventListener('mousemove', (e) => this.screen?.onMouseMove(e));
    canvas.addEventListener('mousedown', (e) => this.screen?.onMouseDown(e));
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__pd = this;
    }
  }

  private frame(t: number): void {
    const dt = this.lastFrame ? t - this.lastFrame : 16;
    this.lastFrame = t;
    if (this.screen) {
      this.screen.update(dt);
    } else {
      this.drawMenuBackdrop();
    }
    this.music.update();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  /** Idle backdrop behind DOM menus: the level-1 board, empty and waiting. */
  private drawMenuBackdrop(): void {
    const r = this.renderer;
    r.begin();
    r.drawBoard(LEVELS[0]!);
    r.drawPieceAt(LEVELS[0]!.start.pos.x, LEVELS[0]!.start.pos.y, 'START', {
      startExit: LEVELS[0]!.start.exit,
    });
    r.present();
  }

  // ---------- screen helpers ----------

  private clearScreen(): void {
    this.screen?.dispose();
    this.screen = null;
  }

  private menu(html: string): HTMLElement {
    this.menuRoot.innerHTML = `<div class="panel">${html}</div>`;
    this.menuRoot.classList.add('visible');
    return this.menuRoot;
  }

  private hideMenu(): void {
    this.menuRoot.classList.remove('visible');
    this.menuRoot.innerHTML = '';
  }

  private trackForLevel(levelIndex: number): TrackName {
    return (['game1', 'game2', 'game3', 'game4'] as const)[Math.min(3, Math.floor(levelIndex / 9))]!;
  }

  /** Scanlines only make sense over the retro pixel framebuffer. */
  private applyScanlines(): void {
    const s = getSettings();
    document
      .getElementById('scanlines')!
      .classList.toggle('off', !s.scanlines || s.renderMode !== 'retro');
  }

  private newSession(overrides: Partial<Session> = {}): Session {
    return {
      mode: 'basic',
      training: false,
      easy: true, // friendly default; classic random queue via the modes screen
      levelIndex: 0,
      totals: [0, 0],
      seedBase: (Date.now() % 100000) + 7,
      ...overrides,
    };
  }

  // ---------- title ----------

  showTitle(): void {
    this.clearScreen();
    this.session = null;
    this.music.playTrack('title');
    this.renderer.setBoardSize(10, 7);

    const el = this.menu(`
      <div class="title-logo">PIPEDREAMZ</div>
      <div class="title-sub">an original tribute to the classic 1989 pipe-building puzzle</div>
      <div class="menu-list">
        <button data-act="start" class="primary">START</button>
      </div>
      <div class="menu-secondary">
        <a data-act="modes">modes</a> ·
        <a data-act="scores">high scores</a> ·
        <a data-act="settings">options</a>
      </div>
      <div class="menu-note">Build a pipeline before the flooz starts flowing.</div>
    `);
    el.querySelector('[data-act=start]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.session = this.newSession();
      this.startRound();
    });
    el.querySelector('[data-act=modes]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.showModeSelect();
    });
    el.querySelector('[data-act=scores]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.showHighScores('basic');
    });
    el.querySelector('[data-act=settings]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.showSettings();
    });
  }

  // ---------- mode select ----------

  private showModeSelect(): void {
    let training = false;
    let easy = true;
    const el = this.menu(`
      <h2 class="panel-heading">SELECT MODE</h2>
      <div class="menu-list">
        <button data-mode="basic">BASIC ONE-PLUMBER</button>
        <button data-mode="expert">EXPERT ONE-PLUMBER</button>
        <button data-mode="competitive">COMPETITIVE TWO-PLUMBER</button>
        <button data-act="training">TRAINING: OFF</button>
        <button data-act="easy">EASY QUEUE: ON</button>
        <button data-act="back">BACK</button>
      </div>
      <div class="menu-note">Basic: one dispenser, five pieces queued.<br/>
      Expert: two dispensers — alternate them for bonus points.<br/>
      Competitive: P2 uses WASD + Q. Training: slower flooz.<br/>
      Easy queue: the dispenser favors pieces your pipeline needs.</div>
    `);
    const trainingBtn = el.querySelector('[data-act=training]') as HTMLButtonElement;
    trainingBtn.addEventListener('click', () => {
      training = !training;
      trainingBtn.textContent = `TRAINING: ${training ? 'ON' : 'OFF'}`;
      this.sfx.play('menu');
    });
    const easyBtn = el.querySelector('[data-act=easy]') as HTMLButtonElement;
    easyBtn.addEventListener('click', () => {
      easy = !easy;
      easyBtn.textContent = `EASY QUEUE: ${easy ? 'ON' : 'OFF'}`;
      this.sfx.play('menu');
    });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.showTitle());
    el.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sfx.play('menu');
        const mode = (btn as HTMLElement).dataset.mode as GameMode;
        this.session = this.newSession({ mode, training, easy });
        this.showLevelIntro();
      });
    });
  }

  // ---------- level intro ----------

  private showLevelIntro(): void {
    const s = this.session!;
    const level = LEVELS[s.levelIndex]!;
    this.clearScreen();
    const features: string[] = [];
    if (level.fixed.some((f) => f.kind === 'OBSTACLE')) features.push('obstacles');
    if (level.fixed.some((f) => f.kind.startsWith('ONEWAY'))) features.push('one-way pipes');
    if (level.fixed.some((f) => f.kind.startsWith('RESERVOIR'))) features.push('reservoirs');
    if (level.fixed.some((f) => f.kind === 'BONUS')) features.push('bonus pipes');
    if (level.wraps.length) features.push('edge tunnels');
    if (level.requireEndPiece) features.push('MUST reach the end piece');
    const el = this.menu(`
      <h2 class="panel-heading">LEVEL ${level.id}</h2>
      <div class="tally">
        <div>Pipes required <span class="num">${level.distance}</span></div>
        <div>Flooz delay <span class="num">${(level.delayMs / 1000).toFixed(1)}s</span></div>
        ${features.length ? `<div>Watch for: ${features.join(', ')}</div>` : ''}
      </div>
      <div class="menu-list"><button data-act="go">GO! <span class="blink">▶</span></button></div>
    `);
    el.querySelector('[data-act=go]')!.addEventListener('click', () => this.startRound());
  }

  private startRound(): void {
    const s = this.session!;
    this.hideMenu();
    this.clearScreen();
    this.music.playTrack(this.trackForLevel(s.levelIndex));
    const level = LEVELS[s.levelIndex]!;
    this.screen = new PlayingScreen(
      this.renderer,
      this.sfx,
      level,
      s.mode,
      s.seedBase + s.levelIndex * 1013,
      s.training,
      s.easy,
      {
        onRoundOver: (result) => this.showRoundEnd(result),
        onQuit: () => this.showTitle(),
        onEasyToggle: (on) => {
          s.easy = on;
        },
        musicOn: () => this.music.volume > 0,
        toggleMusic: () => this.toggleMusic(),
      },
      s.totals,
    );
  }

  /** Create/resume the shared AudioContext (must run inside a gesture). */
  private ensureAudio(): void {
    if (!this.audioUnlocked) {
      this.audioUnlocked = true;
      const ctx = new AudioContext();
      this.sfx.unlock(ctx);
      this.music.unlock(ctx);
    }
    this.music.resume();
  }

  /** Flip music on/off, restoring the previous (or default) volume. */
  private toggleMusic(): boolean {
    this.ensureAudio(); // the toggle click itself is a valid gesture
    if (this.music.volume > 0) {
      this.lastMusicVol = this.music.volume;
      this.music.setVolume(0);
      saveSettings({ musicVol: 0 });
      return false;
    }
    const vol = this.lastMusicVol > 0 ? this.lastMusicVol : 0.35;
    this.music.setVolume(vol);
    saveSettings({ musicVol: vol });
    return true;
  }

  // ---------- round end / tally ----------

  private showRoundEnd(result: RoundResult): void {
    const s = this.session!;
    this.clearScreen();
    s.totals[0] += result.scores[0];
    s.totals[1] += result.scores[1];

    const rows: string[] = [
      `<div>Pipes filled <span class="num">${result.pipesFilled} / ${result.distance}</span></div>`,
    ];
    if (result.unusedCount > 0) {
      rows.push(
        `<div>Unused pipes ${result.unusedCount} × ${SCORE.unusedPipePenalty} <span class="num neg">${result.unusedPenalty}</span></div>`,
      );
    }
    if (s.mode === 'competitive') {
      rows.push(`<div>Player 1 round score <span class="num">${result.scores[0]}</span></div>`);
      rows.push(`<div>Player 2 round score <span class="num">${result.scores[1]}</span></div>`);
      rows.push(`<div class="total">Totals <span class="num">${s.totals[0]} / ${s.totals[1]}</span></div>`);
    } else {
      rows.push(`<div>Round score <span class="num">${result.scores[0]}</span></div>`);
      rows.push(`<div class="total">Total score <span class="num">${s.totals[0]}</span></div>`);
    }

    if (result.won) {
      const finishedGame = s.levelIndex + 1 >= LEVELS.length;
      const bonusNext = (s.levelIndex + 1) % 4 === 0 && !finishedGame;
      const el = this.menu(`
        <h2 class="panel-heading">LEVEL ${s.levelIndex + 1} COMPLETE</h2>
        <div class="tally">${rows.join('')}</div>
        <div class="menu-list"><button data-act="next">${
          finishedGame ? 'FINISH' : bonusNext ? 'BONUS ROUND ▶' : 'NEXT LEVEL ▶'
        }</button></div>
      `);
      el.querySelector('[data-act=next]')!.addEventListener('click', () => {
        this.sfx.play('menu');
        if (finishedGame) return this.showGameOver(true);
        if (bonusNext) return this.startBonus();
        s.levelIndex++;
        this.showLevelIntro();
      });
    } else {
      const el = this.menu(`
        <h2 class="panel-heading" style="color:var(--red)">THE FLOOZ SPILLED!</h2>
        <div class="tally">${rows.join('')}</div>
        <div class="menu-list"><button data-act="over">CONTINUE</button></div>
      `);
      el.querySelector('[data-act=over]')!.addEventListener('click', () => this.showGameOver(false));
    }
  }

  // ---------- bonus round ----------

  private startBonus(): void {
    const s = this.session!;
    this.hideMenu();
    this.clearScreen();
    this.music.playTrack('bonus');
    this.screen = new BonusScreen(
      this.renderer,
      this.sfx,
      s.seedBase + s.levelIndex * 3011,
      (score) => {
        s.totals[0] += score;
        this.clearScreen();
        const el = this.menu(`
          <h2 class="panel-heading">BONUS ROUND</h2>
          <div class="tally">
            <div>Bonus points <span class="num">${score}</span></div>
            <div class="total">Total score <span class="num">${s.totals[0]}</span></div>
          </div>
          <div class="menu-list"><button data-act="next">NEXT LEVEL ▶</button></div>
        `);
        el.querySelector('[data-act=next]')!.addEventListener('click', () => {
          this.sfx.play('menu');
          s.levelIndex++;
          this.showLevelIntro();
        });
      },
      () => this.showTitle(),
      s.totals[0],
    );
  }

  // ---------- game over / high scores ----------

  private showGameOver(victory: boolean): void {
    const s = this.session!;
    this.clearScreen();
    const heading = victory
      ? '<h2 class="panel-heading">ALL 36 LEVELS CLEARED!</h2>'
      : '<h2 class="panel-heading" style="color:var(--red)">GAME OVER</h2>';

    const finalize = (playerLabel: string, score: number, after: () => void) => {
      const rank = highScoreRank(s.mode, score);
      if (rank === -1) return after();
      this.nameEntry(heading, playerLabel, score, () => after());
    };

    finalize('PLAYER 1', s.totals[0], () => {
      if (s.mode === 'competitive') {
        finalize('PLAYER 2', s.totals[1], () => this.showHighScores(s.mode));
      } else {
        this.showHighScores(s.mode);
      }
    });
  }

  /** Era-style 3-initial name entry. */
  private nameEntry(heading: string, label: string, score: number, done: () => void): void {
    const s = this.session!;
    const letters = ['A', 'A', 'A'];
    let slot = 0;
    const render = () => {
      const disp = letters
        .map((ch, i) => `<span class="${i === slot ? 'active' : ''}">${ch}</span>`)
        .join('');
      this.menu(`
        ${heading}
        <div>${label} — NEW HIGH SCORE: <b style="color:var(--amber)">${score}</b></div>
        <div class="name-entry">${disp}</div>
        <div class="menu-note">↑/↓ change letter · ←/→ move · ENTER confirm</div>
      `);
    };
    render();
    const onKey = (e: KeyboardEvent) => {
      const A = 65;
      const idx = letters[slot]!.charCodeAt(0) - A;
      if (e.code === 'ArrowUp') letters[slot] = String.fromCharCode(A + ((idx + 25) % 26));
      if (e.code === 'ArrowDown') letters[slot] = String.fromCharCode(A + ((idx + 1) % 26));
      if (e.code === 'ArrowLeft') slot = Math.max(0, slot - 1);
      if (e.code === 'ArrowRight') slot = Math.min(2, slot + 1);
      if (e.code === 'Enter') {
        window.removeEventListener('keydown', onKey);
        addHighScore(s.mode, {
          name: letters.join(''),
          score,
          level: s.levelIndex + 1,
          dateISO: new Date().toISOString(),
        });
        this.sfx.play('end');
        done();
        return;
      }
      this.sfx.play('tally');
      render();
    };
    window.addEventListener('keydown', onKey);
  }

  private showHighScores(mode: GameMode): void {
    this.clearScreen();
    const list = getHighScores(mode);
    const rows = list.length
      ? list
          .map(
            (e, i) =>
              `<tr><td>${i + 1}.</td><td>${e.name}</td><td>L${e.level}</td><td class="num">${e.score}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">No scores yet — be the first plumber!</td></tr>';
    const el = this.menu(`
      <h2 class="panel-heading">HIGH SCORES — ${mode.toUpperCase()}</h2>
      <table class="scores">${rows}</table>
      <div class="menu-list">
        <button data-act="cycle">NEXT MODE</button>
        <button data-act="back">TITLE</button>
      </div>
    `);
    el.querySelector('[data-act=cycle]')!.addEventListener('click', () => {
      const order: GameMode[] = ['basic', 'expert', 'competitive'];
      this.sfx.play('menu');
      this.showHighScores(order[(order.indexOf(mode) + 1) % order.length]!);
    });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.showTitle());
  }

  // ---------- settings ----------

  private showSettings(): void {
    const settings = getSettings();
    const el = this.menu(`
      <h2 class="panel-heading">OPTIONS</h2>
      <div class="menu-list">
        <button data-act="music">MUSIC VOLUME: ${Math.round(settings.musicVol * 100)}%</button>
        <button data-act="sfx">SFX VOLUME: ${Math.round(settings.sfxVol * 100)}%</button>
        <button data-act="gfx">GRAPHICS: ${(settings.renderMode ?? 'smooth').toUpperCase()}</button>
        <button data-act="scan">SCANLINES: ${settings.scanlines ? 'ON' : 'OFF'}</button>
        <button data-act="back">BACK</button>
      </div>
    `);
    el.querySelector('[data-act=gfx]')!.addEventListener('click', (ev) => {
      const mode = (getSettings().renderMode ?? 'smooth') === 'smooth' ? 'retro' : 'smooth';
      saveSettings({ renderMode: mode });
      this.renderer.setRenderMode(mode);
      this.applyScanlines();
      this.sfx.play('menu');
      (ev.target as HTMLElement).textContent = `GRAPHICS: ${mode.toUpperCase()}`;
    });
    el.querySelector('[data-act=music]')!.addEventListener('click', (ev) => {
      const v = (Math.round(getSettings().musicVol * 100) + 20) % 120;
      saveSettings({ musicVol: v / 100 });
      this.music.setVolume(v / 100);
      (ev.target as HTMLElement).textContent = `MUSIC VOLUME: ${v}%`;
    });
    el.querySelector('[data-act=sfx]')!.addEventListener('click', (ev) => {
      const v = (Math.round(getSettings().sfxVol * 100) + 20) % 120;
      saveSettings({ sfxVol: v / 100 });
      this.sfx.setVolume(v / 100);
      this.sfx.play('menu');
      (ev.target as HTMLElement).textContent = `SFX VOLUME: ${v}%`;
    });
    el.querySelector('[data-act=scan]')!.addEventListener('click', (ev) => {
      const on = !getSettings().scanlines;
      saveSettings({ scanlines: on });
      this.applyScanlines();
      (ev.target as HTMLElement).textContent = `SCANLINES: ${on ? 'ON' : 'OFF'}`;
    });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.showTitle());
  }
}
