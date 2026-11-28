import { readJson, writeJson } from './store';
import { searchOfficialVideo, videoInfo, looksLikeMusicVideo } from './youtube';

/**
 * Online lookups for songs: timed lyrics from LRCLIB and official music videos
 * from MusicBrainz (a free, open music database whose editors link recordings to
 * their official YouTube videos). Only the title, artist, album and length are
 * sent. Results, including "nothing found", are cached so each song is looked up
 * once and keeps working offline.
 */
const UA = 'Noctune/0.2 (https://github.com/kerioxsx/noctune)';
const DAY = 86_400_000;
const MISS_TTL = 14 * DAY; // look again for songs that had nothing, two weeks later

export interface SongQuery {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

type Cache<T> = Record<string, { v: T | null; at: number }>;
// v2: queries are cleaned first (main artist, no "Remastered"/"feat." tails), so earlier misses are retried
const key = (q: SongQuery) => `v4::${q.artist.toLowerCase().trim()}::${q.title.toLowerCase().trim()}`;

/** First credited artist: "A, B", "A & B", "A feat. B", "A x B" all become "A". */
export function mainArtist(artist: string) {
  return artist.split(/\s*(?:,|;|\s&\s|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s|\swith\s|\sx\s|\s\/\s)\s*/i)[0].trim() || artist.trim();
}

/** Title without version tails streaming services add: "Song - Remastered 2011", "Song (feat. X)", "Song - Radio Edit". */
export function cleanTitle(title: string) {
  return (
    title
      .replace(/\s*[([](?:feat|ft|with)\.?\s[^)\]]*[)\]]/gi, '')
      .replace(/\s+-\s+(?:.*\b(?:remaster(?:ed)?|version|edit|mix|live|mono|stereo|deluxe|bonus|single|from)\b.*)$/i, '')
      .replace(/\s*[([](?:.*\b(?:remaster(?:ed)?|radio edit|mono|stereo|deluxe|bonus track|single version|album version)\b.*)[)\]]/gi, '')
      .trim() || title.trim()
  );
}

const clean = (q: SongQuery): SongQuery => ({ ...q, title: cleanTitle(q.title), artist: q.artist.trim() });

/** Try the artist as credited, then only the first name ("Bad Bunny, Jhay Cortez" → "Bad Bunny"). Band names like "Simon & Garfunkel" work on the first try. */
async function eachArtist<T>(q: SongQuery, find: (q: SongQuery) => Promise<T | null>): Promise<T | null> {
  const first = await find(q);
  if (first) return first;
  const main = mainArtist(q.artist);
  return main !== q.artist ? find({ ...q, artist: main }) : null;
}

async function cached<T>(file: string, q: SongQuery, fetcher: (q: SongQuery) => Promise<T | null>): Promise<T | null> {
  q = clean(q);
  const cache = await readJson<Cache<T>>(file, {});
  const hit = cache[key(q)];
  if (hit && (hit.v !== null || Date.now() - hit.at < MISS_TTL)) return hit.v;
  let v: T | null;
  try {
    v = await fetcher(q);
  } catch {
    return hit?.v ?? null; // offline or service down: keep what we had, do not cache the failure
  }
  const fresh = await readJson<Cache<T>>(file, {});
  fresh[key(q)] = { v, at: Date.now() };
  await writeJson(file, fresh);
  return v;
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ------------------------------------------------------------------ lyrics
type LrcLib = { trackName: string; artistName: string; duration: number; syncedLyrics: string | null; plainLyrics: string | null; instrumental?: boolean };

export function findLyrics(raw: SongQuery): Promise<string | null> {
  return cached<string>('lyrics-cache', raw, (cq) => eachArtist(cq, async (q) => {
    // exact match first
    const u = new URL('https://lrclib.net/api/get');
    u.searchParams.set('track_name', q.title);
    u.searchParams.set('artist_name', q.artist);
    if (q.album) u.searchParams.set('album_name', q.album);
    if (q.duration) u.searchParams.set('duration', String(Math.round(q.duration)));
    const exact = await getJson<LrcLib>(u.toString());
    if (exact && (exact.syncedLyrics || exact.plainLyrics)) return exact.syncedLyrics ?? exact.plainLyrics;
    // then a search, preferring timed lyrics with the closest length
    const s = new URL('https://lrclib.net/api/search');
    s.searchParams.set('track_name', q.title);
    s.searchParams.set('artist_name', q.artist);
    const list = (await getJson<LrcLib[]>(s.toString())) ?? [];
    const t = words(q.title);
    const a = words(q.artist);
    const ok = list.filter((x) => (x.syncedLyrics || x.plainLyrics) && words(x.trackName).includes(t) && (words(x.artistName).includes(a) || a.includes(words(x.artistName))));
    ok.sort((x, y) => Number(!x.syncedLyrics) - Number(!y.syncedLyrics) || Math.abs((x.duration ?? 0) - (q.duration ?? 0)) - Math.abs((y.duration ?? 0) - (q.duration ?? 0)));
    const best = ok.find((x) => !q.duration || !x.duration || Math.abs(x.duration - q.duration) < 15);
    if (best) return best.syncedLyrics ?? best.plainLyrics;
    // last try: free-text search, accepted only when title, an artist name and the length all agree
    const f = new URL('https://lrclib.net/api/search');
    f.searchParams.set('q', `${q.artist} ${q.title}`);
    const loose = ((await getJson<LrcLib[]>(f.toString())) ?? []).filter(
      (x) => (x.syncedLyrics || x.plainLyrics) && words(x.trackName) === t && (words(x.artistName).includes(a) || a.includes(words(x.artistName))) && (!q.duration || !x.duration || Math.abs(x.duration - q.duration) < 8),
    );
    loose.sort((x, y) => Number(!x.syncedLyrics) - Number(!y.syncedLyrics));
    return loose[0] ? loose[0].syncedLyrics ?? loose[0].plainLyrics : null;
  }));
}

// ----------------------------------------------------- official music videos
// MusicBrainz asks for at most one request per second per client.
let mbQueue: Promise<unknown> = Promise.resolve();
function mb<T>(path: string): Promise<T | null> {
  const run = mbQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 503 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    }
    throw new Error('MusicBrainz is busy');
  });
  mbQueue = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}

const youtubeId = (url: string) => /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/.exec(url)?.[1] ?? null;
const lucene = (s: string) => s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');

export function findOfficialVideo(raw: SongQuery): Promise<string | null> {
  return cached<string>('video-cache', raw, (cq) => eachArtist(cq, async (q) => {
    // YouTube itself first (finds nearly every official video), then MusicBrainz's links
    const direct = await searchOfficialVideo(q).catch(() => null);
    if (direct) return direct;
    const query = `recording:"${lucene(q.title)}" AND artist:"${lucene(q.artist)}" AND video:true`;
    const res = await mb<{ recordings: { id: string; score: number; title: string; 'artist-credit'?: { name: string }[] }[] }>(`recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`);
    const t = words(q.title);
    const a = words(q.artist);
    const candidates = (res?.recordings ?? []).filter((r) => r.score >= 90 && words(r.title) === t && (r['artist-credit'] ?? []).some((c) => words(c.name).includes(a) || a.includes(words(c.name))));
    for (const r of candidates.slice(0, 3)) {
      const rec = await mb<{ relations?: { type: string; url?: { resource: string } }[] }>(`recording/${r.id}?inc=url-rels&fmt=json`);
      for (const rel of rec?.relations ?? []) {
        const id = rel.url && youtubeId(rel.url.resource);
        if (!id) continue;
        // MusicBrainz sometimes links the audio upload: keep it only if YouTube calls it a video
        const info = await videoInfo(id).catch(() => null);
        if (info && looksLikeMusicVideo(info.title, info.channel, q.title)) return id;
      }
    }
    return null;
  }));
}

/**
 * Timed lyrics made for a specific length: music videos often run longer than the
 * song (an intro, a skit), and some people sync lyrics to the video itself.
 */
export function findLyricsForLength(raw: SongQuery, length: number): Promise<string | null> {
  const q = { ...raw, title: cleanTitle(raw.title), artist: mainArtist(raw.artist) };
  return cached<string>('lyrics-cache', { ...q, title: `${q.title}#len${Math.round(length)}` }, async () => {
    const s = new URL('https://lrclib.net/api/search');
    s.searchParams.set('track_name', q.title);
    s.searchParams.set('artist_name', q.artist);
    const list = (await getJson<LrcLib[]>(s.toString())) ?? [];
    const t = words(q.title);
    const hit = list.find((x) => x.syncedLyrics && words(x.trackName).includes(t) && Math.abs((x.duration ?? 0) - length) <= 2.5);
    return hit?.syncedLyrics ?? null;
  });
}
