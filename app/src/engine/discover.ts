import { useStore } from '../store';
import { bridge } from '../lib/bridge';
import type { FoundSong, LibraryTrack, Release } from '../lib/types';

/**
 * Listening history (kept only on this computer), magic shuffle, the For you feed
 * and new-release alerts. Discovered songs come from Deezer's public catalogue and
 * play through their official YouTube video.
 */

export interface PlayStat { n: number; last: number; title: string; artist: string }
export interface FeedSection { id: string; title: string; subtitle: string; songs: FoundSong[] }
export interface Feed { at: number; sections: FeedSection[] }

const DAY = 86_400_000;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const songKey = (artist: string, title: string) => `${norm(artist)}::${norm(title)}`;
const mainArtist = (a: string) => a.split(/\s*(?:,|;|\s&\s|\sfeat\.?\s|\sft\.?\s|\sx\s)\s*/i)[0].trim() || a;

let plays: Record<string, PlayStat> = {};
let loaded = false;

export async function loadDiscovery() {
  const raw: unknown = await bridge.store.get<Record<string, PlayStat>>('plays', {}).catch(() => ({}));
  plays = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, PlayStat>) : {};
  loaded = true;
  const feed = await bridge.store.get<Feed | null>('feed', null).catch(() => null);
  if (feed && Array.isArray(feed.sections)) applyFeed(feed);
}

/** Turn found songs into playable tracks (their video is looked up when they play). */
export function toTracks(songs: FoundSong[]): LibraryTrack[] {
  const st = useStore.getState();
  const tracks = { ...st.tracks };
  const out = songs.map((f) => {
    const id = `discover:${f.key}`;
    const t: LibraryTrack = tracks[id] ?? { id, source: 'discover', title: f.title, artist: f.artist, album: f.album, duration: f.duration, artwork: f.artwork, available: true };
    tracks[id] = t;
    return t;
  });
  useStore.setState({ tracks });
  return out;
}

// ------------------------------------------------------------- history
let counted: string | null = null;
/** A song counts as played after 30 seconds or half its length. Called by the player clock. */
export function notePlayback(t: LibraryTrack | null, time: number, token: number) {
  if (!t || !loaded || t.source === 'demo') return;
  const mark = `${token}:${t.id}`;
  if (counted === mark) return;
  const need = Math.min(30, (t.duration || 60) / 2);
  if (time < need) return;
  counted = mark;
  const k = songKey(mainArtist(t.artist), t.title);
  const p = plays[k] ?? { n: 0, last: 0, title: t.title, artist: mainArtist(t.artist) };
  plays[k] = { ...p, n: p.n + 1, last: Date.now() };
  void bridge.store.set('plays', plays);
}

/** Artists you listen to most, recent plays weighing more; your library when there is no history yet. */
export function topArtists(n: number): string[] {
  const score = new Map<string, number>();
  const now = Date.now();
  for (const p of Object.values(plays)) {
    const age = (now - p.last) / DAY;
    score.set(p.artist, (score.get(p.artist) ?? 0) + p.n * (age < 30 ? 1 : age < 120 ? 0.5 : 0.2));
  }
  if (score.size < n) {
    const st = useStore.getState();
    for (const t of Object.values(st.tracks)) {
      if (t.source === 'demo' || t.source === 'discover' || !t.artist || t.artist === 'Unknown artist') continue;
      const a = mainArtist(t.artist);
      score.set(a, (score.get(a) ?? 0) + 0.05);
    }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([a]) => a);
}

/** Songs already in the library or played, to leave out of suggestions. */
function knownSongs(): string[] {
  const st = useStore.getState();
  const out = new Set<string>();
  for (const t of Object.values(st.tracks)) if (t.source !== 'demo' && t.source !== 'discover') out.add(`${mainArtist(t.artist)} ${t.title}`);
  for (const p of Object.values(plays)) out.add(`${p.artist} ${p.title}`);
  return [...out].slice(0, 20000);
}

// ------------------------------------------------------------- magic shuffle
let magicFor = '';
/**
 * Mix songs you may like into the queue after the current song: one discovery after
 * every two of your own songs. Seeds are the artists of what is queued.
 */
export async function fillMagic() {
  const st = useStore.getState();
  if (st.shuffle !== 'magic' || !st.queue.length) return;
  const sig = st.queue.join('|');
  if (sig === magicFor) return;
  const own = st.queue.filter((id) => !id.startsWith('discover:'));
  const count = new Map<string, number>();
  for (const id of own) {
    const t = st.tracks[id];
    if (t && t.source !== 'demo') count.set(mainArtist(t.artist), (count.get(mainArtist(t.artist)) ?? 0) + 1);
  }
  let seeds = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a).slice(0, 6);
  if (!seeds.length) seeds = topArtists(6);
  if (!seeds.length) return;
  const found = await bridge.discover.similar(seeds, knownSongs(), Math.ceil(own.length / 2) + 4).catch(() => []);
  const now = useStore.getState();
  if (now.shuffle !== 'magic' || now.queue.join('|') !== sig || !found.length) return;
  const extra = toTracks(found).map((t) => t.id);
  const head = now.queue.slice(0, now.index + 1);
  const rest = now.queue.slice(now.index + 1).filter((id) => !id.startsWith('discover:'));
  const mixed: string[] = [];
  let e = 0;
  rest.forEach((id, i) => {
    mixed.push(id);
    if (i % 2 === 1 && e < extra.length) mixed.push(extra[e++]);
  });
  while (e < extra.length && mixed.length < rest.length + 3) mixed.push(extra[e++]); // short albums still get a few
  const queue = [...head, ...mixed];
  magicFor = queue.join('|');
  useStore.setState({ queue });
}

/** Leaving magic shuffle takes the discoveries back out. */
export function clearMagic() {
  const st = useStore.getState();
  if (!st.queue.some((id) => id.startsWith('discover:'))) return;
  const cur = st.queue[st.index];
  const queue = st.queue.filter((id, i) => !id.startsWith('discover:') || i === st.index);
  useStore.setState({ queue, index: Math.max(0, queue.indexOf(cur)) });
  magicFor = '';
}

// ------------------------------------------------------------- feed
function applyFeed(feed: Feed) {
  const sections = feed.sections.map((s) => ({ ...s, trackIds: toTracks(s.songs).map((t) => t.id) }));
  useStore.setState({ feed: { at: feed.at, sections: sections.map(({ songs, ...rest }) => ({ ...rest, artwork: songs[0]?.artwork })) } });
}

let building = false;
/** Rebuild "For you" once a day from what you play most. */
export async function refreshFeed(force = false) {
  if (building) return;
  const cur = useStore.getState().feed;
  if (!force && cur && Date.now() - cur.at < DAY && cur.sections.length) return;
  const top = topArtists(8);
  if (!top.length) return;
  building = true;
  useStore.setState({ feedLoading: true });
  try {
    const known = knownSongs();
    const sections: FeedSection[] = [];
    const forYou = await bridge.discover.similar(top.slice(0, 6), known, 30);
    if (forYou.length) sections.push({ id: 'feed:for-you', title: 'For you', subtitle: `Like ${top.slice(0, 3).join(', ')}`, songs: forYou });
    const releases = await bridge.discover.releases(top.slice(0, 15)).catch(() => [] as Release[]);
    if (releases.length) {
      const songs: FoundSong[] = [];
      for (const r of releases.slice(0, 8)) songs.push(...(await bridge.discover.releaseSongs(r.key).catch(() => [])).slice(0, r.type === 'album' ? 4 : 2));
      if (songs.length) sections.push({ id: 'feed:new', title: 'New from your artists', subtitle: releases.slice(0, 3).map((r) => r.artist).join(', '), songs });
    }
    for (const a of top.slice(0, 4)) {
      const songs = await bridge.discover.similar([a], known, 15).catch(() => []);
      if (songs.length >= 5) sections.push({ id: `feed:because:${norm(a)}`, title: `Because you play ${a}`, subtitle: `${songs.length} songs`, songs });
    }
    if (sections.length) {
      const feed = { at: Date.now(), sections };
      void bridge.store.set('feed', feed);
      applyFeed(feed);
    }
  } catch {
    // offline: keep yesterday's feed
  } finally {
    building = false;
    useStore.setState({ feedLoading: false });
  }
}

// ------------------------------------------------------------- new releases
/** Releases from your top artists you have not been told about yet. */
export async function checkReleases(): Promise<Release[]> {
  const top = topArtists(15);
  if (!top.length) return [];
  const releases = await bridge.discover.releases(top).catch(() => [] as Release[]);
  const seen = await bridge.store.get<string[]>('notified', []).catch(() => [] as string[]);
  const seenSet = new Set(Array.isArray(seen) ? seen : []);
  const fresh = releases.filter((r) => !seenSet.has(r.key));
  if (fresh.length) void bridge.store.set('notified', [...seenSet, ...fresh.map((r) => r.key)].slice(-500));
  return fresh;
}

export async function playRelease(r: Release): Promise<string[]> {
  const songs = await bridge.discover.releaseSongs(r.key);
  return toTracks(songs).map((t) => t.id);
}
