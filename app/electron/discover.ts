import { readJson, writeJson } from './store';

/**
 * Discovery from Deezer's public music catalogue (no account, no key): artists
 * similar to the ones you play, their best-known songs, and new releases from your
 * favourite artists. Only artist names are sent. Songs found here play through
 * their official YouTube video in the app.
 */
const API = 'https://api.deezer.com';
const DAY = 86_400_000;

export interface FoundSong {
  key: string; // stable id: deezer track id
  title: string;
  artist: string;
  album: string;
  duration: number;
  artwork?: string;
}
export interface Release {
  key: string;
  artist: string;
  title: string;
  date: string; // YYYY-MM-DD
  type: string; // album, single, ep
  artwork?: string;
}

// Deezer allows 50 requests per 5 seconds; stay well under it.
let queue: Promise<unknown> = Promise.resolve();
function deezer<T>(path: string): Promise<T | null> {
  const run = queue.then(async () => {
    const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as T & { error?: { message?: string } };
    if (body && typeof body === 'object' && 'error' in body && body.error) return null;
    return body as T;
  });
  queue = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 140)));
  return run;
}

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

type Cache = Record<string, { at: number; v: unknown }>;
async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const c = await readJson<Cache>('discover-cache', {});
  const hit = c[key];
  if (hit && Date.now() - hit.at < ttl) return hit.v as T;
  const v = await fn();
  const fresh = await readJson<Cache>('discover-cache', {});
  fresh[key] = { at: Date.now(), v };
  // keep the cache small
  const keys = Object.keys(fresh);
  if (keys.length > 600) keys.sort((a, b) => fresh[a].at - fresh[b].at).slice(0, keys.length - 600).forEach((k) => delete fresh[k]);
  await writeJson('discover-cache', fresh);
  return v;
}

async function artistId(name: string): Promise<number | null> {
  return cached(`artist:${words(name)}`, 30 * DAY, async () => {
    const r = await deezer<{ data: { id: number; name: string }[] }>(`/search/artist?q=${encodeURIComponent(name)}&limit=5`);
    const want = words(name);
    const hit = (r?.data ?? []).find((a) => words(a.name) === want) ?? null;
    return hit?.id ?? null;
  });
}

type DzTrack = { id: number; title: string; title_short?: string; duration: number; artist: { name: string }; album?: { title: string; cover_medium?: string } };
const song = (t: DzTrack): FoundSong => ({
  key: String(t.id),
  title: t.title_short || t.title,
  artist: t.artist.name,
  album: t.album?.title ?? '',
  duration: t.duration,
  artwork: t.album?.cover_medium,
});

async function topSongs(id: number, n: number): Promise<FoundSong[]> {
  return cached(`top:${id}:${n}`, 7 * DAY, async () => {
    const r = await deezer<{ data: DzTrack[] }>(`/artist/${id}/top?limit=${n}`);
    return (r?.data ?? []).map(song);
  });
}

async function relatedIds(id: number, n: number): Promise<{ id: number; name: string }[]> {
  return cached(`related:${id}`, 14 * DAY, async () => {
    const r = await deezer<{ data: { id: number; name: string }[] }>(`/artist/${id}/related?limit=20`);
    return (r?.data ?? []).map((a) => ({ id: a.id, name: a.name }));
  }).then((l) => l.slice(0, n));
}

/**
 * Songs you may like: top songs of artists similar to the seeds, plus lesser-played
 * hits of the seeds themselves. Songs whose title+artist is in `known` are left out.
 */
export async function similarSongs(seeds: string[], known: string[], limit = 40): Promise<FoundSong[]> {
  const knownSet = new Set(known.map((k) => words(k)));
  const seen = new Set<string>();
  const out: FoundSong[] = [];
  const add = (s: FoundSong) => {
    const k = words(`${s.artist} ${s.title}`);
    if (seen.has(k) || knownSet.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  const ids = (await Promise.all(seeds.slice(0, 6).map((a) => artistId(a).catch(() => null)))).filter((x): x is number => !!x);
  const seedNames = new Set(seeds.map(words));
  const related: { id: number; name: string }[] = [];
  for (const id of ids) for (const r of await relatedIds(id, 6).catch(() => [])) if (!seedNames.has(words(r.name)) && !related.some((x) => x.id === r.id)) related.push(r);
  // mostly new artists, some deeper cuts from the ones you already play
  for (const r of related.slice(0, 18)) for (const s of (await topSongs(r.id, 4).catch(() => [])).slice(0, 3)) add(s);
  for (const id of ids) for (const s of await topSongs(id, 10).catch(() => [])) add(s);
  // interleave artists so the same one never plays twice in a row
  const byArtist = new Map<string, FoundSong[]>();
  for (const s of out) byArtist.set(s.artist, [...(byArtist.get(s.artist) ?? []), s]);
  const mixed: FoundSong[] = [];
  const lists = [...byArtist.values()].sort(() => Math.random() - 0.5);
  for (let round = 0; mixed.length < limit && lists.some((l) => l.length); round++) for (const l of lists) if (l.length && mixed.length < limit) mixed.push(l.splice(Math.floor(Math.random() * l.length), 1)[0]);
  return mixed;
}

/** Releases from these artists in the last `days` days, newest first. */
export async function newReleases(artists: string[], days = 21): Promise<Release[]> {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const out: Release[] = [];
  for (const name of artists.slice(0, 15)) {
    const id = await artistId(name).catch(() => null);
    if (!id) continue;
    const albums = await cached(`albums:${id}`, DAY / 2, async () => {
      const r = await deezer<{ data: { id: number; title: string; release_date: string; record_type: string; cover_medium?: string }[] }>(`/artist/${id}/albums?limit=15`);
      return r?.data ?? [];
    }).catch(() => []);
    for (const a of albums) {
      if (a.release_date >= since && a.release_date <= new Date().toISOString().slice(0, 10)) out.push({ key: String(a.id), artist: name, title: a.title, date: a.release_date, type: a.record_type, artwork: a.cover_medium });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** The songs of a release, to play it. */
export async function releaseSongs(key: string): Promise<FoundSong[]> {
  if (!/^\d+$/.test(key)) return [];
  return cached(`release:${key}`, 7 * DAY, async () => {
    const r = await deezer<{ title: string; cover_medium?: string; tracks?: { data: DzTrack[] } }>(`/album/${key}`);
    return (r?.tracks?.data ?? []).map((t) => song({ ...t, album: { title: r!.title, cover_medium: r!.cover_medium } }));
  });
}
