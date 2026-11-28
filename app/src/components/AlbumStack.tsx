import { memo, useRef, useState } from 'react';
import type { StackItem } from '../store';
import discUrl from '@assets/img/disc.webp';

/**
 * Depth slots measured from the reference composition (1280×720 stage):
 * front card large at lower left, each card behind it narrower and higher, so
 * only a strip of its artwork shows above the one in front.
 */
const DEPTH = [
  { y: 250, s: 1 },
  { y: 187, s: 0.823 },
  { y: 119, s: 0.67 },
  { y: 69, s: 0.523 },
  { y: 38, s: 0.42 },
  { y: 22, s: 0.34 },
];
const VISIBLE = 5;

/** Stable hue per title so albums without artwork still read as different sleeves. */
const hue = (t: string) => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return h % 360;
};

export type DiscPhase = 'hidden' | 'out' | 'launch' | 'loading';

const DISC_POS: Record<DiscPhase, { x: number; y: number; s: number; o: number }> = {
  hidden: { x: 132, y: 315, s: 0.94, o: 1 },
  out: { x: 418, y: 331, s: 1, o: 1 },
  launch: { x: 905, y: 331, s: 1, o: 1 },
  loading: { x: 990, y: 457, s: 0.58, o: 1 },
};

interface Props {
  items: StackItem[];
  sel: number;
  phase: DiscPhase;
  hideCards: boolean;
  spinning: boolean;
  onSelect: (i: number) => void;
  onStep: (d: 1 | -1) => void;
  onOpen: () => void;
}

export const AlbumStack = memo(function AlbumStack({ items, sel, phase, hideCards, spinning, onSelect, onStep, onOpen }: Props) {
  const n = items.length;
  const drag = useRef<{ y: number; t: number } | null>(null);
  const wheelAt = useRef(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const slot = (i: number) => {
    if (!n) return 99;
    let rel = (((i - sel) % n) + n) % n;
    // the card that just left the front sits below it, faded, so the wrap is invisible
    if (rel === n - 1 && n > 2) rel = -1;
    return rel;
  };

  const d = DISC_POS[phase];
  return (
    <div
      className={`stack${phase === 'launch' ? ' is-launch' : ''}`}
      onWheel={(e) => {
        const now = performance.now();
        if (now - wheelAt.current < 140 || Math.abs(e.deltaY) < 8) return;
        wheelAt.current = now;
        onStep(e.deltaY < 0 ? 1 : -1);
      }}
      onPointerDown={(e) => (drag.current = { y: e.clientY, t: performance.now() })}
      onPointerUp={(e) => {
        const st = drag.current;
        drag.current = null;
        if (!st) return;
        const dy = e.clientY - st.y;
        if (Math.abs(dy) > 36) onStep(dy < 0 ? 1 : -1);
      }}
    >
      {items.map((it, i) => {
        const r = slot(i);
        const hidden = r < 0 || r >= VISIBLE;
        const pos = r < 0 ? { y: 520, s: 1.02 } : DEPTH[Math.min(r, DEPTH.length - 1)];
        const front = r === 0;
        const dx = front && phase !== 'hidden' && phase !== 'loading' ? -8 : 0;
        return (
          <div
            key={it.id}
            className={`card${front ? ' is-front' : ''}${it.kind === 'new' ? ' new' : ''}`}
            style={{
              transform: `translate3d(${dx}px, ${pos.y}px, 0) scale(${pos.s})`,
              opacity: hidden || hideCards ? 0 : 1,
              transition: hideCards ? 'none' : undefined,
              zIndex: front ? 100 : 90 - r * 10,
              pointerEvents: hidden || hideCards ? 'none' : undefined,
            }}
            aria-hidden={!front}
            onClick={(e) => {
              e.stopPropagation();
              if (front) onOpen();
              else onSelect(i);
            }}
          >
            {it.artwork && !failed[it.id] ? (
              <img src={it.artwork} alt="" draggable={false} decoding="async" onError={() => setFailed((f) => ({ ...f, [it.id]: true }))} />
            ) : (
              <div className="placeholder" style={it.kind === 'new' ? undefined : { ['--h' as string]: hue(it.title) }}>
                <div>
                  <b>{it.kind === 'new' ? '+ New playlist' : it.title}</b>
                  <small>{it.kind === 'new' ? 'Press × to create' : it.subtitle}</small>
                </div>
              </div>
            )}
            {it.source && it.source !== 'demo' && it.source !== 'local' && <span className="src">{it.source}</span>}
          </div>
        );
      })}
      <div className={`disc${spinning ? ' spinning' : ''}`} style={{ transform: `translate3d(${d.x}px, ${d.y}px, 0) scale(${d.s})`, opacity: hideCards && phase === 'hidden' ? 0 : d.o, transition: hideCards && phase === 'hidden' ? 'none' : undefined, zIndex: phase === 'loading' ? 120 : 95 }} aria-hidden>
        <img src={discUrl} alt="" draggable={false} />
      </div>
    </div>
  );
});
