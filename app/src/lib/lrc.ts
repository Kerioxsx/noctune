export interface LyricWord {
  t: number;
  w: string;
}
export interface LyricLine {
  t: number;
  text: string;
  words?: LyricWord[];
}
export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
  source: string;
}

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

const toSec = (m: string, s: string, f?: string) => parseInt(m, 10) * 60 + parseInt(s, 10) + (f ? parseInt(f, 10) / Math.pow(10, f.length) : 0);

/** Parses LRC, including enhanced (word-level) `<mm:ss.xx>` stamps and `[offset:±ms]`. */
export function parseLrc(text: string, source: string): Lyrics {
  const lines: LyricLine[] = [];
  let offset = 0;
  let anyTime = false;
  const plain: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(raw);
    if (off) {
      offset = parseInt(off[1], 10) / 1000;
      continue;
    }
    if (/^\[(ti|ar|al|by|re|ve|length|au|la):/i.test(raw)) continue;
    const stamps = [...raw.matchAll(TIME)];
    const body = raw.replace(TIME, '').trim();
    if (!stamps.length) {
      if (raw.trim()) plain.push(raw.trim());
      continue;
    }
    anyTime = true;
    const wordStamps = [...body.matchAll(WORD)];
    let words: LyricWord[] | undefined;
    if (wordStamps.length) {
      words = [];
      const parts = body.split(WORD);
      // split returns [pre, m, s, f, text, m, s, f, text ...]
      for (let i = 1; i < parts.length; i += 4) {
        const w = (parts[i + 3] ?? '').trim();
        if (w) words.push({ t: toSec(parts[i], parts[i + 1], parts[i + 2]) - offset, w });
      }
    }
    const textOnly = body.replace(WORD, '').replace(/\s+/g, ' ').trim();
    for (const st of stamps) {
      lines.push({ t: toSec(st[1], st[2], st[3]) - offset, text: textOnly, words });
    }
  }
  if (!anyTime) return { synced: false, lines: plain.map((t) => ({ t: 0, text: t })), source };
  lines.sort((a, b) => a.t - b.t);
  return { synced: true, lines, source };
}

/** Index of the line active at time t (binary search). -1 before the first line. */
export function activeLine(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
