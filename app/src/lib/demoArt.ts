/**
 * Original cover art for the bundled demo albums, drawn on canvas at startup.
 * Real libraries use the artwork embedded in files or supplied by providers.
 */
type Painter = (g: CanvasRenderingContext2D, s: number) => void;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function grain(g: CanvasRenderingContext2D, s: number, amount: number, seed = 1) {
  const r = rng(seed);
  const img = g.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// ------------------------------------------------------------ Ember Dragon
const dragon: Painter = (g, s) => {
  g.fillStyle = '#f3f1ec';
  g.fillRect(0, 0, s, s);
  grain(g, s, 10, 7);

  // Serpentine body along an S-curve, tapering toward a flame tail.
  const N = 220;
  const pts: { x: number; y: number; nx: number; ny: number; r: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = 0.5 + 0.2 * Math.sin(t * Math.PI * 2.35 + 0.55) * (1 - t * 0.25);
    const y = 0.25 + 0.55 * t;
    const r = (0.052 * (1 - t) + 0.012) * (1 + 0.12 * Math.sin(t * 40));
    pts.push({ x: x * s, y: y * s, nx: 0, ny: 0, r: r * s });
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    pts[i].nx = -dy / l;
    pts[i].ny = dx / l;
  }
  const grad = g.createLinearGradient(0, s * 0.2, 0, s * 0.85);
  grad.addColorStop(0, '#c81e17');
  grad.addColorStop(0.55, '#e04a17');
  grad.addColorStop(1, '#f28a1d');

  // dorsal spikes (drawn first so the body overlaps their base)
  g.fillStyle = grad;
  for (let i = 8; i < N - 20; i += 7) {
    const p = pts[i];
    const side = Math.sin((i / N) * Math.PI * 2.35 + 0.55) > 0 ? 1 : -1;
    const len = p.r * (1.3 + 0.4 * ((i * 7) % 3));
    const bx = p.x + p.nx * p.r * 0.7 * side;
    const by = p.y + p.ny * p.r * 0.7 * side;
    const q = pts[Math.min(N, i + 5)];
    g.beginPath();
    g.moveTo(bx - (q.x - p.x) * 0.6, by - (q.y - p.y) * 0.6);
    g.lineTo(bx + p.nx * len * side + (q.x - p.x) * 0.9, by + p.ny * len * side + (q.y - p.y) * 0.9);
    g.lineTo(bx + (q.x - p.x) * 0.9, by + (q.y - p.y) * 0.9);
    g.closePath();
    g.fill();
  }

  // body outline polygon
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x + p.nx * p.r, p.y + p.ny * p.r) : g.moveTo(p.x + p.nx * p.r, p.y + p.ny * p.r)));
  for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i].x - pts[i].nx * pts[i].r, pts[i].y - pts[i].ny * pts[i].r);
  g.closePath();
  g.fill();

  // belly scales: pale chevrons along one side
  g.strokeStyle = 'rgba(255,210,150,0.55)';
  g.lineWidth = s * 0.004;
  for (let i = 10; i < N - 30; i += 6) {
    const p = pts[i];
    g.beginPath();
    g.moveTo(p.x - p.nx * p.r * 0.85, p.y - p.ny * p.r * 0.85);
    g.lineTo(p.x - p.nx * p.r * 0.35 + (pts[i + 3].x - p.x), p.y - p.ny * p.r * 0.35 + (pts[i + 3].y - p.y));
    g.stroke();
  }

  // claws
  const claw = (i: number, dir: number) => {
    const p = pts[i];
    const bx = p.x - p.nx * p.r * dir;
    const by = p.y - p.ny * p.r * dir;
    g.strokeStyle = '#c81e17';
    g.lineCap = 'round';
    g.lineWidth = s * 0.016;
    const ex = bx - p.nx * s * 0.07 * dir - s * 0.02;
    const ey = by - p.ny * s * 0.07 * dir + s * 0.03;
    g.beginPath();
    g.moveTo(bx, by);
    g.quadraticCurveTo((bx + ex) / 2 - s * 0.02, (by + ey) / 2, ex, ey);
    g.stroke();
    g.lineWidth = s * 0.007;
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(ex - s * 0.025 + k * s * 0.012, ey + s * 0.022 + Math.abs(k) * s * -0.006);
      g.stroke();
    }
  };
  claw(40, 1);
  claw(70, -1);
  claw(128, 1);

  // flame tail
  const tail = pts[N];
  g.fillStyle = '#f28a1d';
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k - 3) * 0.38;
    const len = s * (0.06 + (k % 3) * 0.018);
    g.beginPath();
    g.moveTo(tail.x - s * 0.012, tail.y);
    g.quadraticCurveTo(tail.x + Math.cos(a + 0.4) * len * 0.6, tail.y + Math.sin(a + 0.4) * len * 0.6 + s * 0.02, tail.x + Math.cos(a) * len, tail.y + Math.sin(a) * len + s * 0.05);
    g.quadraticCurveTo(tail.x + Math.cos(a - 0.3) * len * 0.4, tail.y + s * 0.02, tail.x + s * 0.012, tail.y);
    g.fill();
  }

  // head: wedge snout pointing left, open jaw, horns, mane
  const h = pts[0];
  const hx = h.x;
  const hy = h.y;
  g.fillStyle = '#c81e17';
  g.beginPath();
  g.moveTo(hx + s * 0.04, hy - s * 0.045);
  g.lineTo(hx - s * 0.085, hy - s * 0.035);
  g.lineTo(hx - s * 0.13, hy - s * 0.012);
  g.lineTo(hx - s * 0.085, hy + s * 0.0);
  g.lineTo(hx - s * 0.12, hy + s * 0.028);
  g.lineTo(hx - s * 0.06, hy + s * 0.04);
  g.lineTo(hx + s * 0.045, hy + s * 0.05);
  g.closePath();
  g.fill();
  // mane
  for (let k = 0; k < 6; k++) {
    g.beginPath();
    g.moveTo(hx + s * 0.02, hy - s * 0.03 + k * s * 0.012);
    g.lineTo(hx + s * (0.09 + (k % 2) * 0.03), hy - s * 0.07 + k * s * 0.025);
    g.lineTo(hx + s * 0.03, hy - s * 0.01 + k * s * 0.012);
    g.fill();
  }
  // horns
  g.strokeStyle = '#c81e17';
  g.lineWidth = s * 0.01;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(hx - s * 0.01, hy - s * 0.04);
  g.quadraticCurveTo(hx + s * 0.02, hy - s * 0.1, hx + s * 0.07, hy - s * 0.11);
  g.stroke();
  // whisker
  g.lineWidth = s * 0.005;
  g.beginPath();
  g.moveTo(hx - s * 0.11, hy - s * 0.02);
  g.bezierCurveTo(hx - s * 0.16, hy - s * 0.06, hx - s * 0.18, hy + s * 0.0, hx - s * 0.15, hy + s * 0.03);
  g.stroke();
  // eye + mouth gap
  g.fillStyle = '#f3f1ec';
  g.beginPath();
  g.arc(hx - s * 0.04, hy - s * 0.025, s * 0.007, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(hx - s * 0.115, hy + s * 0.002);
  g.lineTo(hx - s * 0.05, hy + s * 0.008);
  g.lineTo(hx - s * 0.1, hy + s * 0.018);
  g.fill();
};

// --------------------------------------------------------------- Red Line
const redLine: Painter = (g, s) => {
  const r = rng(22);
  g.fillStyle = '#16120f';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${90 + r() * 60},${70 + r() * 40},${55 + r() * 30},${r() * 0.12})`;
    g.fillRect(r() * s, r() * s, r() * s * 0.06, r() * s * 0.006);
  }
  grain(g, s, 34, 3);
  g.strokeStyle = '#d3271d';
  g.lineWidth = s * 0.012;
  g.beginPath();
  g.moveTo(-s * 0.05, s * 0.92);
  g.lineTo(s * 1.05, s * 0.12);
  g.stroke();
  // small object: a lit match-box cube
  const cx = s * 0.5, cy = s * 0.53;
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.16);
  glow.addColorStop(0, 'rgba(255,190,110,0.35)');
  glow.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#e8dcc4';
  g.fillRect(cx - s * 0.03, cy - s * 0.02, s * 0.06, s * 0.04);
  g.fillStyle = '#b9ab8f';
  g.beginPath();
  g.moveTo(cx - s * 0.03, cy - s * 0.02);
  g.lineTo(cx - s * 0.015, cy - s * 0.035);
  g.lineTo(cx + s * 0.045, cy - s * 0.035);
  g.lineTo(cx + s * 0.03, cy - s * 0.02);
  g.fill();
  g.font = `600 ${s * 0.035}px "Barlow Condensed", sans-serif`;
  g.fillStyle = 'rgba(233,220,196,0.75)';
  g.fillText('OVERPASS', s * 0.07, s * 0.1);
};

// -------------------------------------------------------------- Slow Burn
const slowBurn: Painter = (g, s) => {
  g.fillStyle = '#2b2a22';
  g.fillRect(0, 0, s, s);
  // window with night city
  g.fillStyle = '#d9cfb2';
  g.fillRect(s * 0.04, s * 0.06, s * 0.3, s * 0.5);
  g.fillStyle = '#5c6b74';
  g.fillRect(s * 0.06, s * 0.08, s * 0.26, s * 0.46);
  const r = rng(31);
  for (let b = 0; b < 5; b++) {
    const bx = s * (0.06 + b * 0.055);
    const bh = s * (0.12 + r() * 0.25);
    g.fillStyle = ['#b9b29a', '#8f8a78', '#d6ceb3'][b % 3];
    g.fillRect(bx, s * 0.54 - bh, s * 0.05, bh);
    g.fillStyle = '#3a3a33';
    for (let wy = s * 0.54 - bh + s * 0.015; wy < s * 0.53; wy += s * 0.03) g.fillRect(bx + s * 0.01, wy, s * 0.03, s * 0.012);
  }
  // wall + table
  g.fillStyle = '#4a4636';
  g.fillRect(s * 0.34, 0, s * 0.66, s);
  g.fillStyle = '#e9dfc6';
  g.beginPath();
  g.moveTo(s * 0.3, s * 0.66);
  g.lineTo(s * 1, s * 0.56);
  g.lineTo(s * 1, s * 0.86);
  g.lineTo(s * 0.4, s * 1);
  g.closePath();
  g.fill();
  // hooded figure
  g.fillStyle = '#5f8a3a';
  g.beginPath();
  g.ellipse(s * 0.33, s * 0.55, s * 0.16, s * 0.2, -0.15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c45a2a';
  g.beginPath();
  g.ellipse(s * 0.26, s * 0.78, s * 0.2, s * 0.17, 0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c7c9c6';
  g.beginPath();
  g.ellipse(s * 0.35, s * 0.55, s * 0.08, s * 0.11, -0.1, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2b2a22';
  g.fillRect(s * 0.3, s * 0.52, s * 0.04, s * 0.02);
  g.fillRect(s * 0.37, s * 0.52, s * 0.04, s * 0.02);
  // bowl + carton
  g.fillStyle = '#d84a2a';
  g.beginPath();
  g.ellipse(s * 0.66, s * 0.78, s * 0.1, s * 0.05, 0, 0, Math.PI);
  g.fill();
  g.fillStyle = '#efe3b8';
  g.beginPath();
  g.ellipse(s * 0.66, s * 0.78, s * 0.1, s * 0.025, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f2efe6';
  g.fillRect(s * 0.78, s * 0.48, s * 0.1, s * 0.18);
  g.fillStyle = '#3d6fb0';
  g.fillRect(s * 0.78, s * 0.53, s * 0.1, s * 0.04);
  // bubbly green title
  g.save();
  g.translate(s * 0.7, s * 0.2);
  g.rotate(-0.06);
  g.font = `400 ${s * 0.11}px "Silkscreen", monospace`;
  g.textAlign = 'center';
  g.lineJoin = 'round';
  g.lineWidth = s * 0.03;
  g.strokeStyle = '#161612';
  g.strokeText('SLOW', 0, 0);
  g.strokeText('BURN', 0, s * 0.11);
  g.fillStyle = '#9ad13b';
  g.fillText('SLOW', 0, 0);
  g.fillText('BURN', 0, s * 0.11);
  g.restore();
  grain(g, s, 18, 9);
};

// -------------------------------------------------------------- Blue Hour
const blueHour: Painter = (g, s) => {
  const sky = g.createLinearGradient(0, 0, 0, s);
  sky.addColorStop(0, '#0d1d4a');
  sky.addColorStop(0.62, '#2f5fb3');
  sky.addColorStop(0.63, '#0a1430');
  sky.addColorStop(1, '#050a1c');
  g.fillStyle = sky;
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#efe6cf';
  g.beginPath();
  g.arc(s * 0.66, s * 0.4, s * 0.17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0a1430';
  for (let i = 0; i < 9; i++) g.fillRect(s * (0.05 + i * 0.1), s * 0.63 - s * 0.06 * ((i * 5) % 4), s * 0.07, s * 0.4);
  g.fillStyle = 'rgba(239,230,207,0.9)';
  g.font = `500 ${s * 0.05}px "IBM Plex Mono", monospace`;
  g.fillText('BLUE HOUR', s * 0.07, s * 0.12);
  g.font = `400 ${s * 0.03}px "IBM Plex Mono", monospace`;
  g.fillText('SORA TAPES · 1996', s * 0.07, s * 0.17);
  grain(g, s, 16, 4);
};

// ------------------------------------------------------------ Rust Static
const rustStatic: Painter = (g, s) => {
  g.fillStyle = '#e7d9bd';
  g.fillRect(0, 0, s, s);
  const cell = s / 46;
  for (let y = 0; y < 46; y++) {
    for (let x = 0; x < 46; x++) {
      const v = Math.max(0, Math.min(1, 1 - Math.hypot(x - 30, y - 26) / 30 + 0.15 * Math.sin(x * 0.5)));
      g.fillStyle = '#b4471c';
      g.beginPath();
      g.arc(x * cell + cell / 2, y * cell + cell / 2, (cell / 2) * Math.sqrt(v) * 1.1, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = '#16120f';
  g.font = `600 ${s * 0.2}px "Barlow Condensed", sans-serif`;
  g.fillText('RUST', s * 0.06, s * 0.82);
  g.fillText('STATIC', s * 0.06, s * 0.98);
};

// ----------------------------------------------------------- Cream Signal
const creamSignal: Painter = (g, s) => {
  g.fillStyle = '#efe7d2';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#1b1a16';
  g.lineWidth = s * 0.004;
  for (let i = 1; i < 6; i++) {
    g.beginPath();
    g.moveTo(0, (s * i) / 6);
    g.lineTo(s, (s * i) / 6);
    g.stroke();
  }
  g.fillStyle = '#1b1a16';
  g.font = `400 ${s * 0.36}px "Instrument Serif", serif`;
  g.fillText('5:24', s * 0.06, s * 0.62);
  // battery glyph
  g.lineWidth = s * 0.012;
  g.strokeRect(s * 0.62, s * 0.76, s * 0.24, s * 0.1);
  g.fillRect(s * 0.86, s * 0.79, s * 0.02, s * 0.04);
  g.fillStyle = '#c0391b';
  g.fillRect(s * 0.635, s * 0.775, s * 0.05, s * 0.07);
  g.fillStyle = '#1b1a16';
  g.font = `500 ${s * 0.035}px "IBM Plex Mono", monospace`;
  g.fillText('LOW BATTERY', s * 0.06, s * 0.1);
  g.fillText('CREAM SIGNAL', s * 0.06, s * 0.82);
  grain(g, s, 12, 6);
};

const PAINTERS: Record<string, Painter> = {
  'ember-dragon': dragon,
  'red-line': redLine,
  'slow-burn': slowBurn,
  'blue-hour': blueHour,
  'rust-static': rustStatic,
  'cream-signal': creamSignal,
};

const cache = new Map<string, string>();

export async function demoArtwork(id: string, size = 640): Promise<string> {
  const key = `${id}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  await document.fonts.ready;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  (PAINTERS[id] ?? creamSignal)(g, size);
  const url = c.toDataURL('image/jpeg', 0.9);
  cache.set(key, url);
  return url;
}
