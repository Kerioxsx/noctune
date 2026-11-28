import { audio } from './audio';

/**
 * Original interface sounds, synthesized live (no samples). Short, soft and
 * immediate. Repeats are throttled so a held direction never stacks voices.
 */
export type Cue = 'tick' | 'confirm' | 'back' | 'open' | 'error' | 'tab' | 'notify';

let last = 0;
let lastCue: Cue | null = null;
let enabled = true;

export function setUiSound(on: boolean, volume: number) {
  enabled = on && volume > 0;
  audio.setUiVolume(volume * 0.5);
}

export function play(cue: Cue) {
  if (!enabled) return;
  const ctx = audio.ensure();
  if (ctx.state === 'suspended') void ctx.resume();
  const now = performance.now();
  if (cue === lastCue && now - last < 45) return;
  last = now;
  lastCue = cue;
  const t = ctx.currentTime + 0.002;
  switch (cue) {
    case 'tick':
      blip(t, 1850, 1850, 0.045, 0.22, 'square', 3800);
      break;
    case 'tab':
      blip(t, 1200, 1500, 0.05, 0.18, 'triangle');
      break;
    case 'confirm':
      blip(t, 1320, 1320, 0.05, 0.22, 'triangle');
      blip(t + 0.055, 1980, 1980, 0.08, 0.2, 'triangle');
      break;
    case 'back':
      blip(t, 1100, 520, 0.1, 0.22, 'triangle');
      break;
    case 'open':
      blip(t, 660, 660, 0.06, 0.2, 'triangle');
      blip(t + 0.06, 990, 990, 0.06, 0.2, 'triangle');
      blip(t + 0.12, 1320, 1320, 0.12, 0.18, 'sine');
      whir(t, 0.24);
      break;
    case 'error':
      blip(t, 190, 160, 0.11, 0.26, 'square', 900);
      break;
    case 'notify':
      // a soft three-note chime, like a console's message arrival
      blip(t, 880, 880, 0.09, 0.2, 'sine');
      blip(t + 0.1, 1175, 1175, 0.09, 0.2, 'sine');
      blip(t + 0.2, 1760, 1760, 0.22, 0.17, 'sine');
      break;
  }
}

function blip(t: number, f0: number, f1: number, dur: number, amp: number, type: OscillatorType, lp = 6000) {
  const ctx = audio.ctx!;
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lp;
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(amp, t + 0.004);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(gn).connect(audio.ui);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Quiet mechanical disc spin-up: filtered noise with a rising band. */
function whir(t: number, dur: number) {
  const ctx = audio.ctx!;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(2400, t + dur);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(0.07, t + 0.03);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(gn).connect(audio.ui);
  src.start(t);
}
