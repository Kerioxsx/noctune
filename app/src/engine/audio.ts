/**
 * One AudioContext shared by music and interface sounds, with separate gain
 * paths so UI sounds can be muted or lowered independently of the music.
 *
 * music element → preamp → 10 peaking bands → analyser → music gain → master
 * ui oscillators → ui gain → master
 */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

class AudioGraph {
  ctx: AudioContext | null = null;
  private preamp!: GainNode;
  private bands: BiquadFilterNode[] = [];
  analyser!: AnalyserNode;
  private music!: GainNode;
  ui!: GainNode;
  private sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private eqOn = true;
  private gains: number[] = EQ_BANDS.map(() => 0);
  private pre = 0;

  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.preamp = ctx.createGain();
    this.bands = EQ_BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.music = ctx.createGain();
    this.ui = ctx.createGain();
    let node: AudioNode = this.preamp;
    for (const b of this.bands) {
      node.connect(b);
      node = b;
    }
    node.connect(this.analyser);
    this.analyser.connect(this.music);
    this.music.connect(ctx.destination);
    this.ui.connect(ctx.destination);
    this.applyEq();
    return ctx;
  }

  resume() {
    const c = this.ensure();
    if (c.state === 'suspended') void c.resume();
  }

  /** Route a media element through the EQ. Returns false if it cannot be processed (e.g. cross-origin without CORS). */
  attach(el: HTMLMediaElement): boolean {
    const ctx = this.ensure();
    if (this.sources.has(el)) return true;
    try {
      const src = ctx.createMediaElementSource(el);
      src.connect(this.preamp);
      this.sources.set(el, src);
      return true;
    } catch {
      return false;
    }
  }

  setEq(enabled: boolean, preampDb: number, gainsDb: number[]) {
    this.eqOn = enabled;
    this.pre = preampDb;
    this.gains = gainsDb;
    this.applyEq();
  }

  private applyEq() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.preamp.gain.setTargetAtTime(this.eqOn ? Math.pow(10, this.pre / 20) : 1, t, 0.02);
    this.bands.forEach((b, i) => b.gain.setTargetAtTime(this.eqOn ? this.gains[i] ?? 0 : 0, t, 0.02));
  }

  setMusicVolume(v: number) {
    if (!this.ctx) return;
    // perceptual curve
    this.music.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.015);
  }
  setUiVolume(v: number) {
    this.ensure();
    this.ui.gain.setTargetAtTime(v, this.ctx!.currentTime, 0.01);
  }
}

export const audio = new AudioGraph();

export const EQ_PRESETS: Record<string, { preamp: number; gains: number[] }> = {
  Flat: { preamp: 0, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  'Bass boost': { preamp: -4, gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  Vocal: { preamp: -2, gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  Treble: { preamp: -3, gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  'Late night': { preamp: 0, gains: [-3, -2, -1, 0, 1, 1, 0, -2, -3, -4] },
  'Lo-fi': { preamp: -1, gains: [2, 3, 1, 0, -1, 0, -2, -5, -8, -12] },
};
