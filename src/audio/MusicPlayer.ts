/**
 * Tracker-style 4-channel chiptune sequencer (Web Audio).
 * Channels: square lead, pulse harmony, triangle bass, noise drums —
 * the classic 1989 home-computer palette. All tunes are original
 * compositions defined as pattern data below.
 */

interface TrackDef {
  bpm: number;
  /** Root MIDI note. */
  root: number;
  /** Chord progression as semitone offsets from root: [degree, minor?]. */
  chords: Array<[number, boolean]>;
  /** Lead pattern: 16 steps per chord, values are chord-tone indices or null. */
  leadSeq: Array<number | null>;
  swing?: boolean;
}

/** Original compositions (chord progressions + arpeggio contours). */
const TRACKS: Record<string, TrackDef> = {
  title: {
    bpm: 112,
    root: 57, // A
    chords: [[0, true], [-4, false], [3, false], [-2, false]], // Am F C G
    leadSeq: [0, null, 1, 2, 3, 2, 1, null, 0, 1, 2, null, 3, 2, 1, 0],
  },
  game1: {
    bpm: 120,
    root: 60, // C
    chords: [[0, false], [-3, true], [5, false], [7, false]], // C Am F G
    leadSeq: [0, 2, 1, 2, 3, null, 2, 1, 0, 2, 1, 2, 3, 2, 1, null],
  },
  game2: {
    bpm: 126,
    root: 62, // D dorian-ish
    chords: [[0, true], [3, false], [-2, false], [5, false]],
    leadSeq: [0, 1, 2, 3, 2, 1, 0, null, 1, 2, 3, null, 2, 1, 0, 1],
  },
  game3: {
    bpm: 132,
    root: 55, // G
    chords: [[0, true], [-2, false], [1, true], [4, false]],
    leadSeq: [0, 3, 1, 3, 2, 3, 1, 3, 0, 3, 1, 3, 2, 1, 2, 3],
    swing: true,
  },
  game4: {
    bpm: 140,
    root: 57,
    chords: [[0, true], [0, true], [-4, false], [-2, false]],
    leadSeq: [0, 1, 2, 1, 3, 1, 2, 1, 0, 1, 2, 1, 3, 2, 1, 0],
  },
  bonus: {
    bpm: 150,
    root: 64, // E
    chords: [[0, false], [5, false], [0, false], [7, false]],
    leadSeq: [0, 2, 3, 2, 0, 2, 3, 2, 1, 2, 3, 2, 3, 2, 1, 0],
  },
};

export type TrackName = keyof typeof TRACKS;

function midiToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

/** Chord tones: root, third (major/minor), fifth, octave. */
function chordTone(root: number, minor: boolean, idx: number): number {
  const tones = [0, minor ? 3 : 4, 7, 12];
  return root + tones[((idx % 4) + 4) % 4]!;
}

export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private current: TrackName | null = null;
  private nextStepTime = 0;
  private step = 0;
  volume = 0.35;

  unlock(ctx: AudioContext): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  playTrack(name: TrackName): void {
    if (this.current === name) return;
    this.current = name;
    this.step = 0;
    if (this.ctx) this.nextStepTime = this.ctx.currentTime + 0.06;
  }

  stop(): void {
    this.current = null;
  }

  /** Call every frame; schedules notes ~0.25s ahead. */
  update(): void {
    if (!this.ctx || !this.master || !this.current) return;
    const track = TRACKS[this.current]!;
    const stepDur = 60 / track.bpm / 4; // 16th notes
    while (this.nextStepTime < this.ctx.currentTime + 0.25) {
      this.scheduleStep(track, this.step, this.nextStepTime, stepDur);
      let dur = stepDur;
      if (track.swing) dur *= this.step % 2 === 0 ? 1.15 : 0.85;
      this.nextStepTime += dur;
      this.step++;
    }
  }

  private voice(
    freq: number,
    t: number,
    durS: number,
    type: OscillatorType,
    gain: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.setValueAtTime(gain, t + durS * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + durS);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + durS + 0.02);
  }

  private drum(t: number, kick: boolean): void {
    const ctx = this.ctx!;
    if (kick) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(130, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.1);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.15);
    } else {
      const len = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      src.connect(g).connect(this.master!);
      src.start(t);
    }
  }

  private scheduleStep(track: TrackDef, step: number, t: number, stepDur: number): void {
    const stepsPerChord = 16;
    const chordIdx = Math.floor(step / stepsPerChord) % track.chords.length;
    const [degree, minor] = track.chords[chordIdx]!;
    const chordRoot = track.root + degree;
    const inChord = step % stepsPerChord;

    // Lead: arpeggio contour
    const leadIdx = track.leadSeq[inChord % track.leadSeq.length];
    if (leadIdx !== null && leadIdx !== undefined) {
      this.voice(
        midiToFreq(chordTone(chordRoot + 12, minor, leadIdx)),
        t,
        stepDur * 0.9,
        'square',
        0.16,
      );
    }
    // Harmony: off-beat chord stabs
    if (inChord % 4 === 2) {
      this.voice(midiToFreq(chordTone(chordRoot, minor, 1)), t, stepDur * 1.6, 'square', 0.07);
      this.voice(midiToFreq(chordTone(chordRoot, minor, 2)), t, stepDur * 1.6, 'square', 0.07);
    }
    // Bass: root pulse on quarters, fifth on the off quarter
    if (inChord % 4 === 0) {
      const tone = inChord % 8 === 0 ? 0 : 2;
      this.voice(midiToFreq(chordTone(chordRoot - 24, minor, tone)), t, stepDur * 3, 'triangle', 0.3);
    }
    // Drums: kick on 1 and 3, hat elsewhere on 8ths
    if (inChord % 8 === 0) this.drum(t, true);
    else if (inChord % 2 === 0) this.drum(t, false);
  }
}
