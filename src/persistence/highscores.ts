import { GameMode } from '../core/types';

const KEY = 'pipedreamz.v1';

export interface HighScoreEntry {
  name: string;
  score: number;
  level: number;
  dateISO: string;
}

export interface Settings {
  musicVol: number;
  sfxVol: number;
  /** 'retro' = pixelated 1x framebuffer (with scanlines); 'smooth' = high-res vector feel. */
  renderMode: 'retro' | 'smooth';
}

interface Store {
  highScores: Record<GameMode, HighScoreEntry[]>;
  settings: Settings;
}

const DEFAULTS: Store = {
  highScores: { basic: [], expert: [], competitive: [] },
  settings: { musicVol: 0.35, sfxVol: 0.5, renderMode: 'smooth' },
};

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      highScores: { ...structuredClone(DEFAULTS.highScores), ...parsed.highScores },
      settings: { ...DEFAULTS.settings, ...parsed.settings },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private-mode Safari etc: scores just don't persist.
  }
}

export function getHighScores(mode: GameMode): HighScoreEntry[] {
  return load().highScores[mode] ?? [];
}

/** Returns the rank (0-based) the score would enter at, or -1. */
export function highScoreRank(mode: GameMode, score: number): number {
  if (score <= 0) return -1;
  const list = getHighScores(mode);
  const idx = list.findIndex((e) => score > e.score);
  if (idx === -1) return list.length < 10 ? list.length : -1;
  return idx;
}

export function addHighScore(mode: GameMode, entry: HighScoreEntry): void {
  const store = load();
  const list = store.highScores[mode] ?? [];
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  store.highScores[mode] = list.slice(0, 10);
  save(store);
}

export function getSettings(): Settings {
  return load().settings;
}

export function saveSettings(settings: Partial<Settings>): void {
  const store = load();
  store.settings = { ...store.settings, ...settings };
  save(store);
}
