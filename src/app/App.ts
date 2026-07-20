import { LEVELS } from '../core/levels/levels';
import { GameMode, PlaceableKind, RoundResult } from '../core/types';
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
import { PlayingScreen, RecordedAction } from './screens/PlayingScreen';

/** Everything needed to re-run the round just played, deterministically. */
interface LastRoundSetup {
  levelIndex: number;
  seed: number;
  mode: GameMode;
  training: boolean;
  easyInitial: boolean;
  totalsBefore: [number, number];
}

interface Session {
  mode: GameMode;
  training: boolean;
  /** Easy mode: dispenser biased toward pieces the pipeline needs. */
  easy: boolean;
  /** Assist overlay: render the path finder's view of the pipeline. */
  assist: boolean;
  levelIndex: number; // 0-based
  /** Where this session began (level picker) — for PLAY AGAIN. */
  startLevelIndex: number;
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
  private lastRound: LastRoundSetup | null = null;
  /** Title-screen picks, remembered across sessions in this visit. */
  private titleLevel = 1; // 1-based, as displayed
  private prefEasy = true;
  private prefAssist = false;

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

  /**
   * Idle backdrop behind DOM menus: the level-1 board dressed with
   * glowing, flooz-filled pipework snaking around the edges (the menu
   * panel covers the center) and the mascot looking on from the right.
   */
  private static readonly BACKDROP_PIPES: Array<{ x: number; y: number; kind: PlaceableKind }> = [
    // Left column, rising then turning right along the top.
    { x: 0, y: 5, kind: 'V' },
    { x: 0, y: 4, kind: 'V' },
    { x: 0, y: 3, kind: 'V' },
    { x: 0, y: 2, kind: 'V' },
    { x: 0, y: 1, kind: 'SE' },
    { x: 1, y: 1, kind: 'H' },
    { x: 2, y: 1, kind: 'X' },
    { x: 3, y: 1, kind: 'H' },
    // Right column, dropping then turning left along the bottom.
    { x: 9, y: 1, kind: 'V' },
    { x: 9, y: 2, kind: 'V' },
    { x: 9, y: 3, kind: 'V' },
    { x: 9, y: 4, kind: 'V' },
    { x: 9, y: 5, kind: 'NW' },
    { x: 8, y: 5, kind: 'H' },
    { x: 7, y: 5, kind: 'X' },
    { x: 6, y: 5, kind: 'H' },
  ];

  private drawMenuBackdrop(): void {
    const r = this.renderer;
    r.begin();
    r.drawBoard(LEVELS[0]!);
    for (const p of App.BACKDROP_PIPES) {
      r.drawPieceAt(p.x, p.y, p.kind);
      r.drawFloozAt(p.x, p.y, p.kind, 0, 1, false);
      if (p.kind === 'X') r.drawFloozAt(p.x, p.y, p.kind, 1, 1, false);
    }
    r.drawPieceAt(LEVELS[0]!.start.pos.x, LEVELS[0]!.start.pos.y, 'START', {
      startExit: LEVELS[0]!.start.exit,
    });
    r.drawMascotAt(8.2, 1.6, 3.4);
    r.present();
  }

  // ---------- screen helpers ----------

  private clearScreen(): void {
    this.screen?.dispose();
    this.screen = null;
  }

  private menu(html: string, panelClass = ''): HTMLElement {
    this.menuRoot.innerHTML = `<div class="panel${panelClass ? ' ' + panelClass : ''}">${html}</div>`;
    this.menuRoot.classList.add('visible');
    return this.menuRoot;
  }

  /**
   * Menu button rendered as the glass-and-brass pipe from the player's
   * SVG spec: dark pipe body, brass flanges, glass window with glowing
   * neon text behind a glare. `attrs` carries the data-* hook, e.g.
   * 'data-act="start"'.
   */
  private pipeBtn(label: string, attrs: string, primary = false): string {
    // No viewBox: the SVG uses the button's own pixel space, so text
    // renders at natural proportions no matter the button width (a
    // stretched viewBox squished the glyphs). Caps are fixed-pixel,
    // spans are percentages.
    const fs = primary ? 21 : 15;
    const text = (cls: string, glow: boolean) =>
      `<text x="50%" y="53%" class="pipe-btn-text${cls}"${glow ? ' filter="url(#pbGlow)"' : ''} font-size="${fs}">${label}</text>`;
    return `
      <button class="pipe-btn${primary ? ' primary' : ''}" ${attrs}>
        <svg width="100%" height="100%" aria-hidden="true">
          <defs>
            <linearGradient id="pbBrass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#5a3d0d"/><stop offset=".15" stop-color="#b8862d"/>
              <stop offset=".3" stop-color="#ffebb5"/><stop offset=".5" stop-color="#d49e31"/>
              <stop offset=".75" stop-color="#735114"/><stop offset=".9" stop-color="#e8b958"/>
              <stop offset="1" stop-color="#3d2705"/>
            </linearGradient>
            <linearGradient id="pbPipe" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#2c2d30"/><stop offset=".25" stop-color="#4a4b50"/>
              <stop offset=".5" stop-color="#18191c"/><stop offset=".8" stop-color="#0a0a0c"/>
              <stop offset="1" stop-color="#1e1f22"/>
            </linearGradient>
            <linearGradient id="pbGlassBg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#050806"/><stop offset="1" stop-color="#121814"/>
            </linearGradient>
            <linearGradient id="pbGlare" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#fff" stop-opacity=".25"/>
              <stop offset=".35" stop-color="#fff" stop-opacity=".05"/>
              <stop offset=".36" stop-color="#fff" stop-opacity="0"/>
              <stop offset="1" stop-color="#fff" stop-opacity="0"/>
            </linearGradient>
            <filter id="pbGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <rect x="10" y="25%" width="100%" height="50%" rx="4" fill="url(#pbPipe)" stroke="#111" stroke-width="2"/>
          <rect x="2" y="15%" width="12" height="70%" rx="2" fill="url(#pbBrass)" stroke="#221100" stroke-width="1.5"/>
          <rect x="14" y="20%" width="7" height="60%" rx="1" fill="url(#pbBrass)" stroke="#221100" stroke-width="1.5"/>
          <rect x="100%" transform="translate(-14,0)" y="15%" width="12" height="70%" rx="2" fill="url(#pbBrass)" stroke="#221100" stroke-width="1.5"/>
          <rect x="100%" transform="translate(-21,0)" y="20%" width="7" height="60%" rx="1" fill="url(#pbBrass)" stroke="#221100" stroke-width="1.5"/>
          <rect x="8%" y="28%" width="84%" height="44%" rx="6" fill="url(#pbBrass)" stroke="#1a1a1a" stroke-width="2"/>
          <rect x="8.8%" y="32%" width="82.4%" height="36%" rx="4" fill="url(#pbGlassBg)" stroke="#000" stroke-width="1.5"/>
          ${text('', true)}
          ${text(' top', false)}
          <rect x="8.8%" y="32%" width="82.4%" height="36%" rx="4" fill="url(#pbGlare)" pointer-events="none"/>
          <line x1="9.5%" y1="34%" x2="90.5%" y2="34%" stroke="#fff" stroke-opacity=".15" stroke-width="1.5"/>
          <line x1="9.5%" y1="66%" x2="90.5%" y2="66%" stroke="#000" stroke-opacity=".4" stroke-width="1.5"/>
        </svg>
      </button>`;
  }

  /** Update a pipe button's label (both the glow and top text layers). */
  private setPipeLabel(btn: Element, label: string): void {
    btn.querySelectorAll('text').forEach((t) => (t.textContent = label));
  }

  private hideMenu(): void {
    this.menuRoot.classList.remove('visible');
    this.menuRoot.innerHTML = '';
  }

  private trackForLevel(levelIndex: number): TrackName {
    return (['game1', 'game2', 'game3', 'game4'] as const)[Math.min(3, Math.floor(levelIndex / 9))]!;
  }

  /** Scanlines come free with the retro pixel framebuffer, off otherwise. */
  private applyScanlines(): void {
    const s = getSettings();
    document.getElementById('scanlines')!.classList.toggle('off', s.renderMode !== 'retro');
  }

  private newSession(overrides: Partial<Session> = {}): Session {
    const s: Session = {
      mode: 'basic',
      training: false,
      easy: this.prefEasy,
      assist: this.prefAssist,
      levelIndex: this.titleLevel - 1,
      startLevelIndex: 0,
      totals: [0, 0],
      seedBase: (Date.now() % 100000) + 7,
      ...overrides,
    };
    s.startLevelIndex = s.levelIndex;
    return s;
  }

  // ---------- title ----------

  showTitle(): void {
    this.clearScreen();
    this.session = null;
    this.music.playTrack('title');
    this.renderer.setBoardSize(10, 7);

    const levelOptions = LEVELS.map(
      (lv, i) =>
        `<option value="${i + 1}" ${i + 1 === this.titleLevel ? 'selected' : ''}>LEVEL ${lv.id}</option>`,
    ).join('');
    const el = this.menu(`
      <div class="title-logo">PIPEDREAMZ</div>
      <div class="title-sub">an original tribute to the classic 1989 pipe-building puzzle</div>
      <div class="menu-list">
        ${this.pipeBtn('START', 'data-act="start"', true)}
      </div>
      <div class="title-opts">
        <select data-act="level">${levelOptions}</select>
        <a data-act="easy" class="opt-toggle">EASY QUEUE: ${this.prefEasy ? 'ON' : 'OFF'}</a>
      </div>
      <div class="menu-secondary">
        <a data-act="howto">how to play</a> ·
        <a data-act="modes">modes</a> ·
        <a data-act="scores">high scores</a> ·
        <a data-act="settings">options</a>
      </div>
      <div class="menu-note">Build faster, the flooz is rising!</div>
    `);
    el.querySelector('[data-act=start]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.session = this.newSession();
      this.startRound();
    });
    el.querySelector('[data-act=level]')!.addEventListener('change', (ev) => {
      this.titleLevel = Number((ev.target as HTMLSelectElement).value) || 1;
      this.sfx.play('menu');
    });
    el.querySelector('[data-act=easy]')!.addEventListener('click', (ev) => {
      this.prefEasy = !this.prefEasy;
      (ev.target as HTMLElement).textContent = `EASY QUEUE: ${this.prefEasy ? 'ON' : 'OFF'}`;
      this.sfx.play('menu');
    });
    el.querySelector('[data-act=modes]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.showModeSelect();
    });
    el.querySelector('[data-act=scores]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.showHighScores();
    });
    el.querySelector('[data-act=settings]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.showSettings();
    });
    el.querySelector('[data-act=howto]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.showHowTo();
    });
  }

  // ---------- how to play ----------

  private showHowTo(): void {
    this.clearScreen();
    const el = this.menu(
      `
      <h2 class="panel-heading">HOW TO PLAY</h2>
      <div class="howto">
        <div class="howto-h">THE POINT</div>
        <p>Build an unbroken pipeline from the START tank before the flooz
        starts flowing — then stay ahead of it. Guide the flooz through at
        least the number of pipes on the <b>D</b> readout to clear the level;
        some levels also demand the pipeline reach the END tank. If the flooz
        hits a gap, an obstacle, or the board edge, it spills and the round
        is over. You can't rotate pieces — you must place the dispenser's
        bottom piece, so plan ahead using the queue.</p>

        <div class="howto-h">CONTROLS — COMPUTER</div>
        <table class="howto-keys">
          <tr><td>Mouse / arrow keys</td><td>aim the cursor</td></tr>
          <tr><td>Click / SPACE</td><td>place the next piece</td></tr>
          <tr><td>Click a placed pipe</td><td>replace it (−50; unfilled pipes only)</td></tr>
          <tr><td>F</td><td>fast-forward the flooz — every pipe scores double</td></tr>
          <tr><td>G</td><td>assist overlay on/off</td></tr>
          <tr><td>P</td><td>pause</td></tr>
          <tr><td>ESC</td><td>quit to title</td></tr>
          <tr><td>SHIFT-click / right-click</td><td>expert mode: place from the second dispenser</td></tr>
          <tr><td>WASD + Q</td><td>player 2 cursor and place (competitive)</td></tr>
        </table>

        <div class="howto-h">CONTROLS — IPAD &amp; TOUCH</div>
        <table class="howto-keys">
          <tr><td>Tap a square</td><td>place the next piece there</td></tr>
          <tr><td>Tap EASY / ASSIST / ♪</td><td>toggle the easy queue, assist overlay, music</td></tr>
          <tr><td>Bonus round: tap a column</td><td>drop the piece into its lowest open space</td></tr>
        </table>

        <div class="howto-h">SCORING</div>
        <table class="howto-keys">
          <tr><td>Pipe filled</td><td>50 — or 100 once the quota is met</td></tr>
          <tr><td>Flooz crosses itself in a cross pipe</td><td>+500</td></tr>
          <tr><td>Looping BOTH sides of 5 crosses</td><td>+5000</td></tr>
          <tr><td>Bonus / reservoir pipe</td><td>500 — or 1000 after the quota</td></tr>
          <tr><td>Reaching the END tank</td><td>+1000</td></tr>
          <tr><td>Flooz through EVERY square</td><td>+10000</td></tr>
          <tr><td>Fast-forward</td><td>×2 per pipe</td></tr>
          <tr><td>Expert: alternating dispensers</td><td>+100 per pipe</td></tr>
          <tr><td>Replacing a pipe</td><td>−50</td></tr>
          <tr><td>Each unused pipe at round end</td><td>−100</td></tr>
          <tr><td>Bonus round (every 4th level)</td><td>100 per pipe, no penalties</td></tr>
        </table>

        <div class="menu-note">EASY QUEUE biases the dispenser toward pieces your
        pipeline needs and eases the flow a little. ASSIST traces the path the
        flooz will take and ghosts the piece that would prevent the spill.</div>
      </div>
      <div class="menu-list">${this.pipeBtn('BACK', 'data-act="back"')}</div>
    `,
      'panel-howto',
    );
    el.querySelector('[data-act=back]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.showTitle();
    });
  }

  // ---------- mode select ----------

  private showModeSelect(): void {
    let training = false;
    let easy = this.prefEasy;
    const el = this.menu(`
      <h2 class="panel-heading">SELECT MODE</h2>
      <div class="menu-list">
        ${this.pipeBtn('BASIC ONE-PLUMBER', 'data-mode="basic"')}
        ${this.pipeBtn('EXPERT ONE-PLUMBER', 'data-mode="expert"')}
        ${this.pipeBtn('COMPETITIVE TWO-PLUMBER', 'data-mode="competitive"')}
        ${this.pipeBtn('TRAINING: OFF', 'data-act="training"')}
        ${this.pipeBtn(`EASY QUEUE: ${easy ? 'ON' : 'OFF'}`, 'data-act="easy"')}
        ${this.pipeBtn('BACK', 'data-act="back"')}
      </div>
      <div class="menu-note">Basic: one dispenser, five pieces queued.<br/>
      Expert: two dispensers — alternate them for bonus points.<br/>
      Competitive: P2 uses WASD + Q. Training: slower flooz.<br/>
      Easy queue: the dispenser favors pieces your pipeline needs.</div>
    `);
    const trainingBtn = el.querySelector('[data-act=training]') as HTMLButtonElement;
    trainingBtn.addEventListener('click', () => {
      training = !training;
      this.setPipeLabel(trainingBtn, `TRAINING: ${training ? 'ON' : 'OFF'}`);
      this.sfx.play('menu');
    });
    const easyBtn = el.querySelector('[data-act=easy]') as HTMLButtonElement;
    easyBtn.addEventListener('click', () => {
      easy = !easy;
      this.setPipeLabel(easyBtn, `EASY QUEUE: ${easy ? 'ON' : 'OFF'}`);
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
      <div class="menu-list">${this.pipeBtn('GO! ▶', 'data-act="go"', true)}</div>
    `);
    el.querySelector('[data-act=go]')!.addEventListener('click', () => this.startRound());
  }

  private startRound(): void {
    const s = this.session!;
    this.hideMenu();
    this.clearScreen();
    this.music.playTrack(this.trackForLevel(s.levelIndex));
    const level = LEVELS[s.levelIndex]!;
    this.lastRound = {
      levelIndex: s.levelIndex,
      seed: s.seedBase + s.levelIndex * 1013,
      mode: s.mode,
      training: s.training,
      easyInitial: s.easy,
      totalsBefore: [...s.totals] as [number, number],
    };
    this.screen = new PlayingScreen(
      this.renderer,
      this.sfx,
      level,
      s.mode,
      s.seedBase + s.levelIndex * 1013,
      s.training,
      s.easy,
      s.assist,
      {
        onRoundOver: (result) => this.showRoundEnd(result),
        onQuit: () => this.showTitle(),
        onEasyToggle: (on) => {
          s.easy = on;
          this.prefEasy = on;
        },
        onAssistToggle: (on) => {
          s.assist = on;
          this.prefAssist = on;
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

  private showRoundEnd(result: RoundResult, alreadyTallied = false): void {
    const s = this.session!;
    // The finished pipework stays on screen behind the dialog — the
    // player wants to see what they built.
    if (!alreadyTallied) {
      s.totals[0] += result.scores[0];
      s.totals[1] += result.scores[1];
    }

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

    const canReplay =
      this.screen instanceof PlayingScreen &&
      this.screen.actionLog.length > 0 &&
      this.lastRound !== null;
    const replayBtn = canReplay ? this.pipeBtn('INSTANT REPLAY ⟲', 'data-act="replay"') : '';

    if (result.won) {
      const finishedGame = s.levelIndex + 1 >= LEVELS.length;
      const bonusNext = (s.levelIndex + 1) % 4 === 0 && !finishedGame;
      const el = this.menu(`
        <h2 class="panel-heading">LEVEL ${s.levelIndex + 1} COMPLETE</h2>
        <div class="tally">${rows.join('')}</div>
        <div class="menu-list">${this.pipeBtn(
          finishedGame ? 'FINISH' : bonusNext ? 'BONUS ROUND ▶' : 'NEXT LEVEL ▶',
          'data-act="next"',
        )}${replayBtn}</div>
      `);
      el.querySelector('[data-act=next]')!.addEventListener('click', () => {
        this.sfx.play('menu');
        if (finishedGame) return this.showGameOver(true);
        if (bonusNext) return this.startBonus();
        s.levelIndex++;
        this.showLevelIntro();
      });
      el.querySelector('[data-act=replay]')?.addEventListener('click', () => {
        this.sfx.play('menu');
        this.startReplay(result);
      });
    } else {
      const el = this.menu(`
        <h2 class="panel-heading" style="color:var(--red)">THE FLOOZ SPILLED!</h2>
        <div class="tally">${rows.join('')}</div>
        <div class="menu-list">${this.pipeBtn('CONTINUE', 'data-act="over"')}${replayBtn}</div>
      `);
      el.querySelector('[data-act=over]')!.addEventListener('click', () => this.showGameOver(false));
      el.querySelector('[data-act=replay]')?.addEventListener('click', () => {
        this.sfx.play('menu');
        this.startReplay(result);
      });
    }
  }

  /**
   * Instant replay: re-run the identical round (same level, same seed,
   * same dispenser) with the recorded action script standing in for the
   * player's input — the build reconstructs itself in real time.
   */
  private startReplay(result: RoundResult): void {
    const setup = this.lastRound;
    if (!setup || !(this.screen instanceof PlayingScreen)) return;
    const log: RecordedAction[] = [...this.screen.actionLog];
    this.hideMenu();
    this.clearScreen();
    const level = LEVELS[setup.levelIndex]!;
    this.screen = new PlayingScreen(
      this.renderer,
      this.sfx,
      level,
      setup.mode,
      setup.seed,
      setup.training,
      setup.easyInitial,
      this.session?.assist ?? true,
      {
        onRoundOver: () => this.showRoundEnd(result, true),
        onQuit: () => this.showRoundEnd(result, true),
        onAssistToggle: (on) => {
          if (this.session) this.session.assist = on;
          this.prefAssist = on;
        },
        musicOn: () => this.music.volume > 0,
        toggleMusic: () => this.toggleMusic(),
      },
      setup.totalsBefore,
      log,
    );
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
          <div class="menu-list">${this.pipeBtn('NEXT LEVEL ▶', 'data-act="next"')}</div>
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
    // Board stays visible behind the game-over dialog too.
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
        finalize('PLAYER 2', s.totals[1], () => this.showPostGame());
      } else {
        this.showPostGame();
      }
    });
  }

  /** End-of-game screen: this mode's scores, then play again or title. */
  private showPostGame(): void {
    const s = this.session!;
    this.clearScreen();
    const el = this.menu(`
      <h2 class="panel-heading">HIGH SCORES — ${s.mode.toUpperCase()}</h2>
      <table class="scores">${this.scoreRows(s.mode)}</table>
      <div class="menu-list">
        ${this.pipeBtn('PLAY AGAIN ▶', 'data-act="again"')}
        ${this.pipeBtn('TITLE', 'data-act="back"')}
      </div>
    `);
    el.querySelector('[data-act=again]')!.addEventListener('click', () => {
      this.sfx.play('menu');
      this.session = this.newSession({
        mode: s.mode,
        training: s.training,
        easy: s.easy,
        assist: s.assist,
        levelIndex: s.startLevelIndex,
      });
      this.startRound();
    });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.showTitle());
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

  private scoreRows(mode: GameMode): string {
    const list = getHighScores(mode);
    return list.length
      ? list
          .map(
            (e, i) =>
              `<tr><td>${i + 1}.</td><td>${e.name}</td><td>L${e.level}</td><td class="num">${e.score}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">No scores yet — be the first plumber!</td></tr>';
  }

  /** High-score browser (from the title): all modes at once, no controls. */
  private showHighScores(): void {
    this.clearScreen();
    const order: GameMode[] = ['basic', 'expert', 'competitive'];
    const sections = order
      .map(
        (mode) => `
          <div class="scores-mode">${mode.toUpperCase()}</div>
          <table class="scores">${this.scoreRows(mode)}</table>`,
      )
      .join('');
    const el = this.menu(`
      <h2 class="panel-heading">HIGH SCORES</h2>
      ${sections}
      <div class="menu-list">${this.pipeBtn('TITLE', 'data-act="back"')}</div>
    `);
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.showTitle());
  }

  // ---------- settings ----------

  private showSettings(): void {
    const settings = getSettings();
    const el = this.menu(`
      <h2 class="panel-heading">OPTIONS</h2>
      <div class="menu-list">
        ${this.pipeBtn(`MUSIC VOLUME: ${Math.round(settings.musicVol * 100)}%`, 'data-act="music"')}
        ${this.pipeBtn(`SFX VOLUME: ${Math.round(settings.sfxVol * 100)}%`, 'data-act="sfx"')}
        ${this.pipeBtn(`GRAPHICS: ${(settings.renderMode ?? 'smooth').toUpperCase()}`, 'data-act="gfx"')}
        ${this.pipeBtn('BACK', 'data-act="back"')}
      </div>
    `);
    el.querySelector('[data-act=gfx]')!.addEventListener('click', (ev) => {
      const mode = (getSettings().renderMode ?? 'smooth') === 'smooth' ? 'retro' : 'smooth';
      saveSettings({ renderMode: mode });
      this.renderer.setRenderMode(mode);
      this.applyScanlines();
      this.sfx.play('menu');
      this.setPipeLabel((ev.currentTarget as HTMLElement), `GRAPHICS: ${mode.toUpperCase()}`);
    });
    el.querySelector('[data-act=music]')!.addEventListener('click', (ev) => {
      const v = (Math.round(getSettings().musicVol * 100) + 20) % 120;
      saveSettings({ musicVol: v / 100 });
      this.music.setVolume(v / 100);
      this.setPipeLabel((ev.currentTarget as HTMLElement), `MUSIC VOLUME: ${v}%`);
    });
    el.querySelector('[data-act=sfx]')!.addEventListener('click', (ev) => {
      const v = (Math.round(getSettings().sfxVol * 100) + 20) % 120;
      saveSettings({ sfxVol: v / 100 });
      this.sfx.setVolume(v / 100);
      this.sfx.play('menu');
      this.setPipeLabel((ev.currentTarget as HTMLElement), `SFX VOLUME: ${v}%`);
    });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.showTitle());
  }
}
