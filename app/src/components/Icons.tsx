import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const, 'aria-hidden': true, ...p });

/** Console face-button glyphs, drawn rather than typed. */
export const Cross = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} className="glyph"><path d="M6 6l12 12M18 6L6 18" strokeWidth={2.2} /></svg>
);
export const Circle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} className="glyph"><circle cx="12" cy="12" r="7" strokeWidth={2.2} /></svg>
);
export const Triangle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} className="glyph"><path d="M12 5l7.5 13h-15z" strokeWidth={2} strokeLinejoin="round" /></svg>
);
export const Square = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} className="glyph"><rect x="6" y="6" width="12" height="12" strokeWidth={2.2} /></svg>
);

export const Gear = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={20} height={20} strokeWidth={1.6}>
    <path d="M10 3h4l.6 2.6 2 1.1 2.5-.9 2 3.4-2 1.8v2l2 1.8-2 3.4-2.5-.9-2 1.1L14 21h-4l-.6-2.6-2-1.1-2.5.9-2-3.4 2-1.8v-2l-2-1.8 2-3.4 2.5.9 2-1.1z" />
    <rect x="9.5" y="9.5" width="5" height="5" />
  </svg>
);

export const Play = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" /></svg>;
export const Pause = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z" fill="currentColor" stroke="none" /></svg>;
export const Prev = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6v12" /><path d="M18 6.5v11L9 12z" fill="currentColor" stroke="none" /></svg>;
export const Next = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M18 6v12" /><path d="M6 6.5v11l9-5.5z" fill="currentColor" stroke="none" /></svg>;
export const Back10 = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} strokeWidth={1.6}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4 4v4h4" /><text x="12" y="15.5" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="IBM Plex Mono">10</text></svg>
);
export const Fwd10 = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} strokeWidth={1.6}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M20 4v4h-4" /><text x="12" y="15.5" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="IBM Plex Mono">10</text></svg>
);
export const Repeat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} strokeWidth={1.7}><path d="M5 11V8h12" /><path d="M14.5 5.5L17 8l-2.5 2.5" /><path d="M19 13v3H7" /><path d="M9.5 18.5L7 16l2.5-2.5" /></svg>
);
export const Volume = ({ level = 1, ...p }: SVGProps<SVGSVGElement> & { level?: number }) => (
  <svg {...base(p)} strokeWidth={1.7}>
    <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" stroke="none" />
    {level > 0 && <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />}
    {level > 0.5 && <path d="M17.5 7a7 7 0 0 1 0 10" />}
    {level === 0 && <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />}
  </svg>
);
export const Fullscreen = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} strokeWidth={1.7}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
);
export const Lyrics = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} strokeWidth={1.7}><path d="M4 7h11M4 12h16M4 17h8" /></svg>
);
export const List = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} strokeWidth={1.7}><path d="M9 7h11M9 12h11M9 17h11" /><path d="M4 7h1.5M4 12h1.5M4 17h1.5" /></svg>
);
export const Home = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} strokeWidth={1.7}><path d="M9 6L3.5 12 9 18" /><path d="M4 12h16" /></svg>
);

export function Battery({ level, charging }: { level: number; charging: boolean }) {
  const w = Math.max(0, Math.min(1, level));
  const cells = Math.ceil(w * 3);
  return (
    <svg className="battery" viewBox="0 0 40 24" aria-hidden>
      <rect x="1.5" y="3.5" width="33" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="35" y="9" width="3" height="6" fill="currentColor" />
      {[0, 1, 2].map((i) => (i < cells ? <rect key={i} x={4.5 + i * 10} y="6.5" width="8" height="11" fill="currentColor" /> : null))}
      {charging && <path d="M19 5l-4 8h4l-2 6 6-9h-4l2-5z" fill="#070806" stroke="currentColor" strokeWidth="0.8" />}
    </svg>
  );
}

/**
 * Original pixel dinosaur mascot (a small long-tailed raptor), drawn on a
 * 14×13 grid. Two frames give it a tiny idle step and blink.
 */
const DINO_A = [
  '.......######.',
  '......##.#####',
  '......########',
  '......#####...',
  '......#######.',
  '#....#####....',
  '##..######....',
  '##########....',
  '.#########....',
  '..#######.....',
  '...##..##.....',
  '...#....#.....',
  '...##...##....',
];
const DINO_B = DINO_A.map((r, i) => (i === 1 ? '......########' : i === 11 ? '...#...#......' : i === 12 ? '...##..##.....' : r));

export function Dino({ frame = 0 }: { frame?: number }) {
  const rows = frame ? DINO_B : DINO_A;
  const rects: JSX.Element[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === '#') rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" />);
    });
  });
  return (
    <svg className="dino" viewBox="-0.5 -0.5 15 14" fill="currentColor" shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
}
