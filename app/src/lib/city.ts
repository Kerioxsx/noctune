/**
 * Original city/architecture backdrop, drawn procedurally: a low-angle view up
 * into converging towers, a central spire, and an elevated expressway cutting
 * across the frame. Rendered once per size into a luminance canvas, then
 * either printed as a halftone (library) or graded as a blue night (launch).
 */

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

export interface CityLayers {
  /** grayscale scene, white = light */
  lum: HTMLCanvasElement;
  /** emissive windows/lights mask for the night grade */
  lights: HTMLCanvasElement;
}

export function renderCity(w: number, h: number, seed = 5): CityLayers {
  const lum = document.createElement('canvas');
  lum.width = w;
  lum.height = h;
  const g = lum.getContext('2d')!;
  const lights = document.createElement('canvas');
  lights.width = w;
  lights.height = h;
  const L = lights.getContext('2d')!;
  const r = rng(seed);

  // blown-out sky, brightest upper right
  const sky = g.createRadialGradient(w * 0.78, h * 0.05, 0, w * 0.7, h * 0.2, w * 0.9);
  sky.addColorStop(0, '#ffffff');
  sky.addColorStop(0.45, '#d8d8d8');
  sky.addColorStop(1, '#7a7a7a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  const vp = { x: w * 0.56, y: -h * 1.5 };
  const along = (x0: number, y: number) => x0 + (vp.x - x0) * ((h - y) / (h - vp.y));

  type Tower = { x0: number; x1: number; top: number; split: number; tone: number; win: number };
  const towers: Tower[] = [];
  // background ring of towers, then mid, then the central spire
  const add = (x0: number, wd: number, top: number, tone: number) => towers.push({ x0, x1: x0 + wd, top, split: 0.35 + r() * 0.3, tone, win: 0.6 + r() * 0.4 });
  for (let i = 0; i < 12; i++) add(-w * 0.1 + i * w * 0.1 + r() * w * 0.04, w * (0.06 + r() * 0.05), h * (0.02 + r() * 0.3), 0.6 + r() * 0.25);
  for (let i = 0; i < 7; i++) add(w * (-0.02 + i * 0.16) + r() * w * 0.05, w * (0.09 + r() * 0.07), h * (-0.15 + r() * 0.3), 0.25 + r() * 0.35);
  add(w * 0.44, w * 0.15, -h * 0.3, 0.8); // central tower, catches the light
  add(-w * 0.08, w * 0.2, -h * 0.4, 0.12); // dark foreground tower, left edge
  add(w * 0.86, w * 0.18, -h * 0.35, 0.3); // right edge

  for (const t of towers) {
    const yb = h * 1.02;
    const blx = t.x0, brx = t.x1;
    const tlx = along(t.x0, t.top), trx = along(t.x1, t.top);
    const smx = t.x0 + (t.x1 - t.x0) * t.split;
    const tmx = along(smx, t.top);
    // lit face
    g.fillStyle = shade(t.tone + 0.2);
    poly(g, [blx, yb, smx, yb, tmx, t.top, tlx, t.top]);
    // shadow face
    g.fillStyle = shade(t.tone - 0.4);
    poly(g, [smx, yb, brx, yb, trx, t.top, tmx, t.top]);
    // window rows: horizontal bands that respect the perspective
    const rows = 22 + Math.floor(r() * 16);
    for (let k = 0; k < rows; k++) {
      const yy = t.top + ((yb - t.top) * Math.pow(k / rows, 1.25));
      const hh = ((yb - t.top) / rows) * 0.45;
      for (const [a, b, toneMod] of [[blx, smx, 0.0], [smx, brx, -0.25]] as const) {
        const xa = along(a, yy), xb = along(b, yy);
        g.fillStyle = shade(t.tone + toneMod - 0.35 + (r() - 0.5) * 0.12);
        g.fillRect(xa + 1, yy, xb - xa - 2, hh);
        // vertical mullions
        const cols = 4 + Math.floor((b - a) / (w * 0.012));
        for (let c = 0; c < cols; c++) {
          if (r() < 1 - t.win * 0.35) continue;
          const xm = xa + ((xb - xa) * (c + 0.5)) / cols;
          L.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.65})`;
          L.fillRect(xm - 1, yy, Math.max(1.5, (xb - xa) / cols - 2), hh);
        }
      }
    }
    // edge highlight on the lit corner
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = Math.max(1, w * 0.0015);
    g.beginPath();
    g.moveTo(smx, yb);
    g.lineTo(tmx, t.top);
    g.stroke();
  }

  // elevated expressway: thick diagonal from mid-left down to the right edge
  const p0 = { x: w * 0.25, y: h * 0.47 };
  const p1 = { x: w * 1.05, y: h * 0.78 };
  const deck = h * 0.035;
  const side = h * 0.11;
  // underside / girder face (dark)
  g.fillStyle = '#1a1a1a';
  poly(g, [p0.x, p0.y + deck, p1.x, p1.y + deck, p1.x, p1.y + deck + side * 1.6, p0.x, p0.y + deck + side * 0.5]);
  // ribs
  g.strokeStyle = '#3a3a3a';
  g.lineWidth = Math.max(1, w * 0.002);
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const x = p0.x + (p1.x - p0.x) * t;
    const y = p0.y + deck + (p1.y - p0.y) * t;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + side * (0.5 + 1.1 * t));
    g.stroke();
  }
  // deck top (bright rail)
  g.fillStyle = '#e8e8e8';
  poly(g, [p0.x, p0.y, p1.x, p1.y, p1.x, p1.y + deck, p0.x, p0.y + deck]);
  g.fillStyle = '#9a9a9a';
  poly(g, [p0.x, p0.y + deck * 0.55, p1.x, p1.y + deck * 0.55, p1.x, p1.y + deck * 0.7, p0.x, p0.y + deck * 0.7]);
  // support pillars
  g.fillStyle = '#2a2a2a';
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const x = p0.x + (p1.x - p0.x) * t;
    const y = p0.y + deck + (p1.y - p0.y) * t + side * (0.5 + 1.1 * t);
    g.fillRect(x - w * 0.012, y, w * 0.024, h - y);
  }
  // lights along the deck for night mode
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    L.fillStyle = 'rgba(255,255,255,0.9)';
    L.fillRect(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t + deck * 0.2, w * 0.004, deck * 0.25);
  }

  // ground: dark band with long light streaks receding bottom-right
  const ground = g.createLinearGradient(0, h * 0.78, 0, h);
  ground.addColorStop(0, '#202020');
  ground.addColorStop(1, '#0a0a0a');
  g.fillStyle = ground;
  poly(g, [0, h * 0.86, w * 0.5, h * 0.82, w, h * 0.93, w, h, 0, h]);
  for (let i = 0; i < 26; i++) {
    const y0 = h * (0.88 + r() * 0.1);
    const x0 = w * (0.3 + r() * 0.3);
    const grad = g.createLinearGradient(x0, y0, w, y0 + h * 0.08);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, `rgba(255,255,255,${0.4 + r() * 0.5})`);
    g.strokeStyle = grad;
    g.lineWidth = 1 + r() * 2.5;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(w, y0 + h * (0.02 + r() * 0.07));
    g.stroke();
    L.strokeStyle = grad;
    L.lineWidth = g.lineWidth;
    L.beginPath();
    L.moveTo(x0, y0);
    L.lineTo(w, y0 + h * 0.05);
    L.stroke();
  }
  // foreground silhouette, lower left
  g.fillStyle = '#0d0d0d';
  poly(g, [0, h * 0.62, w * 0.06, h * 0.6, w * 0.12, h * 0.7, w * 0.2, h * 0.74, w * 0.26, h, 0, h]);

  return { lum, lights };
}

function shade(v: number) {
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${c},${c},${c})`;
}
function poly(g: CanvasRenderingContext2D, p: number[]) {
  g.beginPath();
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.closePath();
  g.fill();
}

export interface HalftoneOptions {
  cell: number;
  ink: string;
  paper: string;
  /** tint mixed into the brightest highlights (the pinkish blow-out in the reference) */
  highlight: string;
  angle: number;
}

/** Prints the luminance canvas as a dot screen: light paper dots on dark ink. */
export function halftone(src: HTMLCanvasElement, out: HTMLCanvasElement, o: HalftoneOptions) {
  const w = src.width, h = src.height;
  out.width = w;
  out.height = h;
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  const data = sg.getImageData(0, 0, w, h).data;
  const g = out.getContext('2d')!;
  g.fillStyle = o.ink;
  g.fillRect(0, 0, w, h);
  const cos = Math.cos(o.angle), sin = Math.sin(o.angle);
  const diag = Math.hypot(w, h);
  const c = o.cell;
  const sample = (x: number, y: number) => {
    const xi = Math.max(0, Math.min(w - 1, x | 0));
    const yi = Math.max(0, Math.min(h - 1, y | 0));
    return data[(yi * w + xi) * 4] / 255;
  };
  const cx = w / 2, cy = h / 2;
  for (let v = -diag / 2; v < diag / 2; v += c) {
    for (let u = -diag / 2; u < diag / 2; u += c) {
      const x = cx + u * cos - v * sin;
      const y = cy + u * sin + v * cos;
      if (x < -c || y < -c || x > w + c || y > h + c) continue;
      let l = sample(x, y);
      l = Math.pow(l, 1.15); // keep shadows deep
      if (l < 0.04) continue;
      const rad = (c * 0.72) * Math.sqrt(l);
      g.fillStyle = l > 0.86 ? o.highlight : o.paper;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Blue night grade: deep navy shadows, cyan-white highlights, glowing windows. */
export function nightGrade(layers: CityLayers, out: HTMLCanvasElement) {
  const { lum, lights } = layers;
  const w = lum.width, h = lum.height;
  out.width = w;
  out.height = h;
  const g = out.getContext('2d')!;
  const src = lum.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h);
  const d = src.data;
  const img = g.createImageData(w, h);
  const o = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] / 255;
    const v = Math.pow(l, 1.6);
    o[i] = 6 + v * 70;
    o[i + 1] = 14 + v * 120;
    o[i + 2] = 40 + v * 200;
    o[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.globalCompositeOperation = 'screen';
  g.filter = `blur(${Math.max(1, w / 640)}px)`;
  g.globalAlpha = 0.9;
  g.drawImage(tint(lights, '#7fd0ff'), 0, 0);
  g.filter = `blur(${Math.max(3, w / 160)}px)`;
  g.globalAlpha = 0.7;
  g.drawImage(tint(lights, '#2c7dff'), 0, 0);
  g.filter = 'none';
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // night sky darkening toward the top
  const top = g.createLinearGradient(0, 0, 0, h * 0.6);
  top.addColorStop(0, 'rgba(2,6,22,0.75)');
  top.addColorStop(1, 'rgba(2,6,22,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, w, h);
}

function tint(mask: HTMLCanvasElement, color: string) {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const g = c.getContext('2d')!;
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
