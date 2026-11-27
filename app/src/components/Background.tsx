import { useEffect, useRef } from 'react';
import { renderCity, halftone, nightGrade } from '../lib/city';
import type { BackgroundSettings } from '../store';

/**
 * Regions of the 1280×720 stage where interface text and icons sit. The
 * background under each is sampled so those elements can switch between
 * light and dark ink and stay readable on any picture.
 */
export const TONE_REGIONS = {
  status: { x: 880, y: 630, w: 380, h: 80 },
  hud: { x: 580, y: 420, w: 520, h: 160 },
  prompt: { x: 780, y: 450, w: 380, h: 110 },
  mini: { x: 0, y: 0, w: 520, h: 44 },
} as const;
export type ToneRegion = keyof typeof TONE_REGIONS;
/** 'light' = the background there is light, so use dark ink */
export type Tones = Record<ToneRegion, 'light' | 'dark'>;

const SAMPLE_W = 160;
const SAMPLE_H = 90;

function measure(src: CanvasImageSource, fit: 'cover' | 'contain', dim: number, sw: number, sh: number): Tones | null {
  const c = document.createElement('canvas');
  c.width = SAMPLE_W;
  c.height = SAMPLE_H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, SAMPLE_W, SAMPLE_H);
  // reproduce object-fit so samples line up with what is on screen
  const scale = fit === 'cover' ? Math.max(SAMPLE_W / sw, SAMPLE_H / sh) : Math.min(SAMPLE_W / sw, SAMPLE_H / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  try {
    g.drawImage(src, (SAMPLE_W - dw) / 2, (SAMPLE_H - dh) / 2, dw, dh);
    const d = g.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    const k = SAMPLE_W / 1280;
    const out = {} as Tones;
    for (const [name, r] of Object.entries(TONE_REGIONS) as [ToneRegion, (typeof TONE_REGIONS)[ToneRegion]][]) {
      let sum = 0;
      let n = 0;
      const x0 = Math.floor(r.x * k), y0 = Math.floor(r.y * k);
      const x1 = Math.min(SAMPLE_W, Math.ceil((r.x + r.w) * k)), y1 = Math.min(SAMPLE_H, Math.ceil((r.y + r.h) * k));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * SAMPLE_W + x) * 4;
          // relative luminance (sRGB approximation)
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          n++;
        }
      }
      const lum = (n ? sum / n : 0) * (1 - dim);
      out[name] = lum > 0.52 ? 'light' : 'dark';
    }
    return out;
  } catch {
    // a picture that cannot be read (cross-origin without CORS): keep light ink
    return null;
  }
}

interface Props {
  night: boolean;
  dim: boolean;
  halftoneOn: boolean;
  bg: BackgroundSettings;
  onTones: (t: Tones) => void;
}

export function Background({ night, dim, halftoneOn, bg, onTones }: Props) {
  const printRef = useRef<HTMLCanvasElement>(null);
  const nightRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const tonesCb = useRef(onTones);
  tonesCb.current = onTones;
  const custom = bg.kind === 'custom' && !!bg.url;

  // The city is always rendered: it is the default and the night grade of the launch sequence.
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(1280 * dpr);
    const h = Math.round(720 * dpr);
    const id = requestAnimationFrame(() => {
      const layers = renderCity(w, h);
      if (printRef.current) {
        if (halftoneOn) {
          halftone(layers.lum, printRef.current, { cell: 5.2 * dpr, ink: '#0c0f09', paper: '#ece6cc', highlight: '#f5e3dc', angle: 0.2 });
        } else {
          const c = printRef.current;
          c.width = w;
          c.height = h;
          const g = c.getContext('2d')!;
          g.drawImage(layers.lum, 0, 0);
          g.globalCompositeOperation = 'multiply';
          g.fillStyle = '#c9c79a';
          g.fillRect(0, 0, w, h);
          g.globalCompositeOperation = 'source-over';
        }
        const g = printRef.current.getContext('2d')!;
        g.globalCompositeOperation = 'multiply';
        const grade = g.createLinearGradient(0, 0, 0, h);
        grade.addColorStop(0, '#eef0d8');
        grade.addColorStop(0.6, '#cdd3a6');
        grade.addColorStop(1, '#a3ab78');
        g.fillStyle = grade;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
        if (!custom) {
          const t = measure(printRef.current, 'cover', 0, w, h);
          if (t) tonesCb.current(t);
        }
      }
      if (nightRef.current) nightGrade(layers, nightRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [halftoneOn, custom]);

  // Custom picture: sample once it loads, and keep sampling while an animated GIF plays.
  useEffect(() => {
    if (!custom) return;
    const img = imgRef.current;
    if (!img) return;
    const sample = () => {
      if (!img.naturalWidth) return;
      // the print look turns the picture into a high-contrast duotone; sample it the same way
      const t = measure(img, bg.fit, bg.dim + (bg.print ? 0.05 : 0), img.naturalWidth, img.naturalHeight);
      if (t) tonesCb.current(t);
    };
    if (img.complete) sample();
    img.addEventListener('load', sample);
    const iv = bg.animated ? window.setInterval(sample, 1200) : undefined;
    return () => {
      img.removeEventListener('load', sample);
      clearInterval(iv);
    };
  }, [custom, bg.url, bg.fit, bg.dim, bg.print, bg.animated]);

  return (
    <div className={`layer bg${night ? ' is-night' : ''}${dim ? ' is-dim' : ''}${custom ? ' is-custom' : ''}`} aria-hidden>
      <canvas ref={printRef} className="print" />
      {custom && (
        <div className={`custom-bg${bg.print ? ' print-look' : ''}`} style={{ ['--bg-dim' as string]: bg.dim }}>
          <img ref={imgRef} src={bg.url} alt="" crossOrigin="anonymous" draggable={false} style={{ objectFit: bg.fit }} />
          {bg.print && <div className="dots" />}
        </div>
      )}
      <canvas ref={nightRef} className="night" />
    </div>
  );
}
