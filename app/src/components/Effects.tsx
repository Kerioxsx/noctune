import { useMemo } from 'react';
import type { Settings } from '../store';

/** Analog layers drawn over everything. Each is independent and switchable. */
export function Effects({ fx, reduced }: { fx: Settings['effects']; reduced: boolean }) {
  const noise = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return `url(${c.toDataURL()})`;
  }, []);
  if (!fx.enabled) return null;
  return (
    <div className="layer fx" aria-hidden style={{ ['--noise' as string]: noise }}>
      {fx.noise && <div className="noise" style={reduced ? { animation: 'none' } : undefined} />}
      {fx.vhs && fx.scanlines && <div className="scan" />}
      {fx.vhs && !reduced && fx.glitches && <div className="roll" />}
      {fx.vignette && <div className="vig" />}
      {fx.glitches && !reduced && <div className="tear" />}
    </div>
  );
}
