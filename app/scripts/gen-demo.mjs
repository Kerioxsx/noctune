// Generates the bundled demo library: original synthesized tracks (OGG),
// one original music video (MP4) and timed lyrics (LRC). Everything here is
// produced from code, so the demo ships with no third-party media.
// Requires ffmpeg on PATH. Run: npm run gen:demo
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'public', 'demo');
const tmp = join(tmpdir(), 'noctune-demo');
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

const SR = 22050;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const PROGRESSIONS = [
  [0, 5, 3, 4], // i VI iv v (in minor degrees)
  [0, 3, 5, 6],
  [0, 6, 5, 4],
  [0, 4, 5, 3],
];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

function chordNotes(root, degree) {
  const n = (d) => root + MINOR[d % 7] + 12 * Math.floor(d / 7);
  return [n(degree), n(degree + 2), n(degree + 4), n(degree + 6)];
}

/** Render one track and return { samples, bpm, barSec, bars } */
function renderTrack({ seed, bpm, root, prog, swing = 0, bright = 0.5, bars = 16, drums = true }) {
  const r = rng(seed);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const len = Math.ceil((bars * bar + 2.5) * SR);
  const L = new Float32Array(len);
  const R = new Float32Array(len);

  const add = (buf, i, v) => {
    if (i >= 0 && i < len) buf[i] += v;
  };
  const addSt = (i, v, pan = 0) => {
    add(L, i, v * (1 - Math.max(0, pan)));
    add(R, i, v * (1 + Math.min(0, pan)));
  };

  const kick = (t, amp = 0.9) => {
    const s = Math.floor(t * SR);
    let ph = 0;
    for (let k = 0; k < SR * 0.35; k++) {
      const tt = k / SR;
      const f = 45 + 95 * Math.exp(-tt * 28);
      ph += (2 * Math.PI * f) / SR;
      addSt(s + k, Math.sin(ph) * Math.exp(-tt * 9) * amp);
    }
  };
  const snare = (t, amp = 0.35) => {
    const s = Math.floor(t * SR);
    let lp = 0;
    for (let k = 0; k < SR * 0.22; k++) {
      const tt = k / SR;
      const nz = r() * 2 - 1;
      lp += (nz - lp) * 0.45;
      const tone = Math.sin(2 * Math.PI * 185 * tt) * Math.exp(-tt * 30);
      addSt(s + k, (lp * Math.exp(-tt * 16) + tone * 0.5) * amp, 0.1);
    }
  };
  const hat = (t, amp = 0.09, open = false) => {
    const s = Math.floor(t * SR);
    let prev = 0;
    const d = open ? 9 : 45;
    for (let k = 0; k < SR * (open ? 0.25 : 0.06); k++) {
      const nz = r() * 2 - 1;
      const hp = nz - prev;
      prev = nz;
      addSt(s + k, hp * Math.exp((-k / SR) * d) * amp, -0.35);
    }
  };
  const tone = (t, dur, midi, amp, kind, pan = 0, attack = 0.005, release = 0.08) => {
    const s = Math.floor(t * SR);
    const n = Math.floor((dur + release) * SR);
    const f = mtof(midi);
    let lp = 0;
    const cutoff = kind === 'bass' ? 0.08 : 0.18 + bright * 0.3;
    for (let k = 0; k < n; k++) {
      const tt = k / SR;
      let env = Math.min(1, tt / attack);
      if (tt > dur) env *= Math.max(0, 1 - (tt - dur) / release);
      let v;
      const p = 2 * Math.PI * f * tt;
      if (kind === 'pad') {
        v = (tri(f * tt) + tri(f * 1.004 * tt) + 0.5 * tri(f * 2.003 * tt)) / 2.5;
      } else if (kind === 'bass') {
        v = Math.sin(p) + 0.45 * Math.sin(2 * p) + 0.2 * Math.sin(3 * p);
        v *= Math.exp(-tt * 1.6);
      } else if (kind === 'keys') {
        v = (Math.sin(p) + 0.3 * Math.sin(2 * p) * Math.exp(-tt * 4) + 0.12 * Math.sin(4 * p) * Math.exp(-tt * 8));
        v *= Math.exp(-tt * 2.2);
      } else {
        // lead: soft square
        v = Math.tanh(Math.sin(p) * 2.2) * 0.7;
        v *= Math.exp(-tt * 3.5);
      }
      lp += (v - lp) * cutoff;
      addSt(s + k, lp * env * amp, pan);
    }
  };
  const tri = (x) => 4 * Math.abs(x - Math.floor(x + 0.5)) - 1;

  const intro = 2; // bars without drums
  for (let b = 0; b < bars; b++) {
    const t0 = 0.4 + b * bar;
    const deg = prog[b % prog.length];
    const ch = chordNotes(root, deg);
    // pad
    for (const [i, m] of ch.entries()) tone(t0, bar * 0.96, m + 12, 0.07, 'pad', (i - 1.5) * 0.3, 0.35, 0.6);
    // bass
    if (b >= 1) {
      tone(t0, beat * 1.5, ch[0] - 12, 0.32, 'bass');
      tone(t0 + beat * 2.5, beat * 0.8, ch[0] - 12 + (r() < 0.5 ? 7 : 12), 0.22, 'bass');
    }
    // keys arpeggio
    if (b >= 2 && b < bars - 1) {
      for (let s = 0; s < 8; s++) {
        if (r() < 0.28) continue;
        const sw = s % 2 ? swing * beat * 0.5 : 0;
        const m = ch[(s * 3 + b) % 4] + 24 + (r() < 0.15 ? 12 : 0);
        tone(t0 + s * beat * 0.5 + sw, beat * 0.4, m, 0.07, 'keys', ((s % 3) - 1) * 0.45);
      }
    }
    // lead hook on later bars
    if (b >= 8 && b < bars - 2 && b % 2 === 0) {
      const scale = MINOR.map((x) => x + root + 24);
      let idx = Math.floor(r() * 4) + 2;
      for (let s = 0; s < 6; s++) {
        idx = Math.max(0, Math.min(6, idx + Math.floor(r() * 3) - 1));
        tone(t0 + s * beat * 0.66, beat * 0.5, scale[idx], 0.06, 'lead', 0.2);
      }
    }
    // drums
    if (drums && b >= intro && b < bars - 1) {
      for (let q = 0; q < 4; q++) {
        const tq = t0 + q * beat;
        if (q === 0 || (q === 2 && r() < 0.6)) kick(tq);
        if (q === 1 || q === 3) snare(tq);
        hat(tq, 0.08);
        hat(tq + beat * 0.5 + swing * beat * 0.25, 0.05, r() < 0.08);
      }
      if (r() < 0.4) kick(t0 + beat * 2.5, 0.6);
    }
  }
  // tape hiss + crackle
  for (let i = 0; i < len; i++) {
    const h = (r() * 2 - 1) * 0.004;
    L[i] += h;
    R[i] += h;
    if (r() < 0.00012) {
      const c = (r() * 2 - 1) * 0.12;
      L[i] += c;
      R[i] += c * 0.7;
    }
  }
  // gentle saturation, fade in/out
  const fadeIn = SR * 1.2;
  const fadeOut = SR * 3;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = 0.92 / Math.max(peak, 1e-6);
  for (let i = 0; i < len; i++) {
    let e = Math.min(1, i / fadeIn) * Math.min(1, (len - i) / fadeOut);
    L[i] = Math.tanh(L[i] * g * 1.15) * e;
    R[i] = Math.tanh(R[i] * g * 1.15) * e;
  }
  return { L, R, barSec: bar, bars, start: 0.4, duration: len / SR };
}

function writeWav(path, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(path, buf);
}

const ts = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

/** Build an LRC: one line every 2 bars from bar 2. wordLevel adds <mm:ss.xx> word stamps. */
function makeLrc(meta, lines, track, wordLevel = false) {
  const head = [`[ti:${meta.title}]`, `[ar:${meta.artist}]`, `[al:${meta.album}]`, `[by:Noctune demo]`];
  const body = lines.map((line, i) => {
    const t = track.start + track.barSec * (2 + i * 2);
    if (!wordLevel) return `[${ts(t)}]${line}`;
    const words = line.split(' ');
    const span = track.barSec * 1.6;
    return `[${ts(t)}]` + words.map((w, k) => `<${ts(t + (span * k) / words.length)}>${w}`).join(' ');
  });
  const end = track.start + track.barSec * (2 + lines.length * 2);
  return [...head, ...body, `[${ts(end)}]`].join('\n') + '\n';
}

// ----- the demo catalogue (all original titles, artists and words) -----
export const ALBUMS = [
  {
    id: 'ember-dragon', title: 'Ember Dragon', artist: 'Kowloon Static', year: 1998,
    tracks: [
      { title: 'Neon Seraph', seed: 11, bpm: 86, root: 45, prog: 0, swing: 0.3, video: true,
        lyrics: ['Red signs bleed into the rain', 'I keep your number in my coat', 'Every train goes past your window', 'Every light forgets my name', 'Turn the dial till the static sings', 'Neon seraph, carry me home', 'Down the stairwell, out of frame'] },
      { title: 'Paper Lanterns', seed: 12, bpm: 92, root: 48, prog: 2, swing: 0.15,
        lyrics: ['Paper lanterns on the water', 'Drifting slower than the night', 'You said meet me where the road ends', 'I am already there', 'Folding wishes into boats', 'Watch them burning bright'] },
    ],
  },
  {
    id: 'red-line', title: 'Red Line', artist: 'Overpass', year: 2001,
    tracks: [
      { title: 'Diagonal', seed: 21, bpm: 100, root: 43, prog: 1, swing: 0.05, bright: 0.7,
        lyrics: ['Cut across the city grid', 'One red line from you to me', 'Every crossing holds its breath', 'Every signal turns to green', 'Draw it straight and draw it fast', 'Nothing here was meant to last'] },
      { title: 'Last Platform', seed: 22, bpm: 78, root: 46, prog: 3, swing: 0.2,
        lyrics: ['Last platform, quarter past', 'Echoes running down the tiles', 'Hold the door, hold the door', 'I could stay a little while', 'Lights go out along the line', 'Still I hear you every time'] },
    ],
  },
  {
    id: 'slow-burn', title: 'Slow Burn', artist: 'Moss Diner', year: 2004,
    tracks: [
      { title: 'Cereal at Midnight', seed: 31, bpm: 90, root: 50, prog: 2, swing: 0.4,
        lyrics: ['Cereal at midnight, radio low', 'Neighbours fighting through the wall', 'I write verses on the napkins', 'Nobody reads them at all', 'Spoon in the bowl keeps time', 'Beat goes round, so do I'] },
      { title: 'Green Mask', seed: 32, bpm: 94, root: 41, prog: 0, swing: 0.35,
        lyrics: ['Pull the hood and pull the mask', 'Walk the block like it is mine', 'Every corner knows the story', 'Every story bends in time', 'Say it twice so it is true', 'Slow burn coming back to you'] },
    ],
  },
  {
    id: 'blue-hour', title: 'Blue Hour', artist: 'Sora Tapes', year: 1996,
    tracks: [
      { title: 'Skyway', seed: 41, bpm: 82, root: 47, prog: 1, swing: 0.1, bright: 0.35,
        lyrics: ['Skyway glowing over sleep', 'Headlights painting lines of white', 'I am counting all the windows', 'One of them is yours tonight', 'Blue hour, hold it still', 'Let the morning wait until'] },
      { title: 'Glass Towers', seed: 42, bpm: 88, root: 44, prog: 3, swing: 0.1, bright: 0.4,
        lyrics: ['Glass towers in a row', 'Mirrors made of afterglow', 'Say my name against the wind', 'Watch it fall a hundred floors', 'Catch it, catch it, let it go', 'Glass towers in a row'] },
    ],
  },
  {
    id: 'rust-static', title: 'Rust Static', artist: 'Halftone Club', year: 1999,
    tracks: [
      { title: 'Dot Screen', seed: 51, bpm: 104, root: 42, prog: 0, swing: 0, bright: 0.8,
        lyrics: ['Print me in a million dots', 'Step back and you see my face', 'Step in close and I am nothing', 'Only ink and empty space', 'Turn the contrast way up high', 'Rust and static, you and I'] },
      { title: 'Copy of a Copy', seed: 52, bpm: 96, root: 49, prog: 2, swing: 0.2, bright: 0.6,
        lyrics: ['Copy of a copy fading', 'Edges soft and colours worn', 'Still the shape of you is in it', 'Like the day that it was born', 'Feed it through the glass again', 'Keep the ghost, lose the pen'] },
    ],
  },
  {
    id: 'cream-signal', title: 'Cream Signal', artist: 'Low Battery', year: 2003,
    tracks: [
      { title: 'Five Twenty-Four', seed: 61, bpm: 84, root: 45, prog: 3, swing: 0.25,
        lyrics: ['Five twenty-four on the little screen', 'Battery blinking in the dark', 'Saved my game at the last door', 'Left the rest up to the heart', 'Press start, press start again', 'Somewhere it begins again'] },
      { title: 'Save Point', seed: 62, bpm: 76, root: 52, prog: 1, swing: 0.3, bright: 0.3,
        lyrics: ['Little light by the save point', 'Warm enough to rest a while', 'Every map I ever finished', 'Ended somewhere near your smile', 'Write it down and close the lid', 'Remember everything we did'] },
    ],
  },
];

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!hasFfmpeg()) {
  console.error('ffmpeg is required to generate demo media.');
  process.exit(1);
}

const catalogue = [];
for (const album of ALBUMS) {
  const tracks = [];
  for (const [i, t] of album.tracks.entries()) {
    const id = `${album.id}-${i + 1}`;
    const track = renderTrack({ seed: t.seed, bpm: t.bpm, root: t.root, prog: PROGRESSIONS[t.prog], swing: t.swing, bright: t.bright ?? 0.5 });
    const wav = join(tmp, `${id}.wav`);
    writeWav(wav, track.L, track.R);
    const ogg = join(out, `${id}.ogg`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '1', ogg]);
    const meta = { title: t.title, artist: album.artist, album: album.title };
    writeFileSync(join(out, `${id}.lrc`), makeLrc(meta, t.lyrics, track, !!t.video));
    let video = null;
    if (t.video) {
      video = `${id}.mp4`;
      makeVideo(wav, join(out, video), t.title, track.duration);
    }
    tracks.push({ id, title: t.title, number: i + 1, duration: Math.round(track.duration * 100) / 100, audio: `${id}.ogg`, lyrics: `${id}.lrc`, video });
    console.log('rendered', id);
  }
  catalogue.push({ id: album.id, title: album.title, artist: album.artist, year: album.year, tracks });
}
writeFileSync(join(out, 'catalogue.json'), JSON.stringify(catalogue, null, 2));
rmSync(tmp, { recursive: true, force: true });
console.log('demo library written to', out);

function makeVideo(wav, dest, title, duration) {
  // Original "music video": drifting amber city lights through haze, a title
  // card in serif type, film grain and a dark vignette. Generated by ffmpeg.
  const font = findFont();
  const W = 960, H = 540;
  const d = duration.toFixed(2);
  const lights = `life=s=120x68:mold=10:r=6:ratio=0.18:death_color=#000000:life_color=#ffb347`;
  const streaks = `life=s=240x34:mold=30:r=12:ratio=0.12:death_color=#000000:life_color=#ff5a2a`;
  const titleFilter = font
    ? `,drawtext=fontfile='${font}':text='${title}':fontsize=96:fontcolor=#f2c14e:x=(w-tw)/2:y=(h-th)/2-20:` +
      `alpha='if(lt(t,0.6),0,if(lt(t,1.6),(t-0.6),if(lt(t,4.2),1,if(lt(t,5.2),1-(t-4.2),0))))':shadowcolor=black@0.6:shadowx=2:shadowy=3`
    : '';
  const fc =
    `[0:v]scale=${W}:${H}:flags=bilinear,gblur=sigma=11,format=gbrp,colorlevels=rimax=0.3:gimax=0.3:bimax=0.3[a];` +
    `[1:v]scale=${W}:${H}:flags=neighbor,gblur=sigma=16:sigmaV=2,format=gbrp,colorlevels=rimax=0.25:gimax=0.25:bimax=0.25[b];` +
    `[2:v]format=gbrp[g];[a][b]blend=all_mode=screen[ab];[ab][g]blend=all_mode=screen,noise=alls=16:allf=t+u,vignette=PI/3.2,format=yuv420p,eq=contrast=1.15:gamma=0.9${titleFilter},format=yuv420p[v]`;
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-t', d, '-i', `${lights}:rate=24`,
    '-f', 'lavfi', '-t', d, '-i', `${streaks}:rate=24`,
    '-f', 'lavfi', '-t', d, '-i', `gradients=s=${W}x${H}:c0=0x2a0800:c1=0x000000:c2=0x5a1a00:c3=0x000000:nb_colors=4:speed=0.004:type=radial:rate=24`,
    '-i', wav,
    '-filter_complex', fc,
    '-map', '[v]', '-map', '3:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', dest,
  ]);
}

function findFont() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSerif-Bold.ttf',
    '/Library/Fonts/Georgia.ttf',
    'C:/Windows/Fonts/georgiab.ttf',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}
