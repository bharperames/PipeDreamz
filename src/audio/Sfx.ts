/**
 * Retro sound effects synthesized with the Web Audio API.
 * All sounds are original, generated procedurally — no samples.
 */
export type SfxName =
  | 'move'
  | 'place'
  | 'bomb'
  | 'fill'
  | 'cross'
  | 'reservoir'
  | 'spill'
  | 'distance'
  | 'end'
  | 'tally'
  | 'menu'
  | 'slide';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.5;

  /** Must be called from a user gesture to satisfy autoplay policies. */
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

  private tone(
    freq: number,
    durMs: number,
    type: OscillatorType,
    gain = 0.25,
    slideTo?: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + durMs / 1000);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.02);
  }

  private noise(durMs: number, gain = 0.2): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const len = Math.floor((this.ctx.sampleRate * durMs) / 1000);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start(t0);
  }

  /** `pitch` lets the fill tick rise as the pipeline grows. */
  play(name: SfxName, pitch = 0): void {
    switch (name) {
      case 'move': this.tone(520, 35, 'square', 0.06); break;
      case 'place': this.tone(300, 70, 'square', 0.18, 180); break;
      case 'bomb': this.noise(160, 0.3); this.tone(120, 160, 'sawtooth', 0.2, 50); break;
      case 'fill': this.tone(340 + pitch * 14, 60, 'triangle', 0.2); break;
      case 'cross': this.tone(660, 90, 'square', 0.18); this.tone(880, 140, 'square', 0.14); break;
      case 'reservoir': this.tone(200, 400, 'triangle', 0.16, 320); break;
      case 'spill': this.noise(450, 0.35); this.tone(280, 500, 'sawtooth', 0.22, 60); break;
      case 'distance': this.tone(523, 90, 'square', 0.16); this.tone(784, 160, 'square', 0.16); break;
      case 'end': this.tone(523, 100, 'square', 0.16); this.tone(659, 100, 'square', 0.16); this.tone(1046, 220, 'square', 0.18); break;
      case 'tally': this.tone(700, 30, 'square', 0.1); break;
      case 'menu': this.tone(440, 50, 'square', 0.12); break;
      case 'slide': this.tone(240, 60, 'triangle', 0.15, 300); break;
    }
  }
}
