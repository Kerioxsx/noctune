import { create } from 'zustand';
import { bridge } from './lib/bridge';
import type { LibraryTrack, LibraryAlbum, Playlist, PlaylistEntry, ProviderStatus, Source } from './lib/types';
import { demoArtwork } from './lib/demoArt';

export type RepeatMode = 'off' | 'all' | 'one';
export type Screen = 'library' | 'confirm' | 'launch' | 'loading' | 'player' | 'settings';
export type Shelf = 'albums' | 'playlists' | 'feed';
/** off: in order · shuffle: every song of the album/playlist once, random order · magic: shuffle plus songs you may like */
export type ShuffleMode = 'off' | 'shuffle' | 'magic';
export type SettingsTab = 'equalizer' | 'settings' | 'accessibility' | 'connections' | 'account';
export const SETTINGS_TABS: SettingsTab[] = ['equalizer', 'settings', 'accessibility', 'connections', 'account'];

export type Action =
  | 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'info' | 'options' | 'settings'
  | 'playPause' | 'next' | 'prev' | 'seekFwd' | 'seekBack' | 'volUp' | 'volDown' | 'mute'
  | 'fullscreen' | 'lyricsEarlier' | 'lyricsLater' | 'nowPlaying' | 'repeat' | 'shuffle' | 'tabPrev' | 'tabNext';

export const DEFAULT_KEYMAP: Record<Action, string[]> = {
  up: ['ArrowUp', 'w'],
  down: ['ArrowDown', 's'],
  left: ['ArrowLeft', 'a'],
  right: ['ArrowRight', 'd'],
  confirm: ['Enter', 'x'],
  back: ['Escape', 'Backspace'],
  info: ['i', 't'],
  options: ['o'],
  settings: [','],
  playPause: [' ', 'k'],
  next: ['n', 'MediaTrackNext'],
  prev: ['p', 'MediaTrackPrevious'],
  seekFwd: ['l', '.'],
  seekBack: ['j', 'm'],
  volUp: ['=', '+'],
  volDown: ['-', '_'],
  mute: ['0'],
  fullscreen: ['f', 'F11'],
  lyricsEarlier: ['['],
  lyricsLater: [']'],
  nowPlaying: ['v'],
  repeat: ['r'],
  shuffle: ['h'],
  tabPrev: ['q'],
  tabNext: ['e'],
};

export interface BackgroundSettings {
  kind: 'city' | 'custom';
  url?: string;
  /** animated GIFs keep playing; the tone check re-samples them */
  animated?: boolean;
  fit: 'cover' | 'contain';
  print: boolean;
  dim: number;
}

export interface Settings {
  /** the first-run welcome has been seen */
  onboarded: boolean;
  /** bumped when defaults change in a way existing installs should pick up */
  settingsVersion: number;
  /** look up each song's official music video and play it when one exists */
  autoVideo: boolean;
  background: BackgroundSettings;
  effects: { enabled: boolean; intensity: number; vhs: boolean; scanlineStrength: number; halftone: boolean; scanlines: boolean; noise: boolean; glitches: boolean; chroma: boolean; vignette: boolean };
  sound: { enabled: boolean; volume: number; quietDuringPlayback: boolean };
  motion: 'system' | 'full' | 'reduced';
  animation: number;
  sort: 'library' | 'title' | 'artist' | 'source' | 'year';
  repeat: RepeatMode;
  shuffle?: ShuffleMode;
  /** pop-up when a favourite artist releases something */
  releaseAlerts: boolean;
  repeatPersist: boolean;
  resumeSession: boolean;
  volume: number;
  muted: boolean;
  lyrics: { show: boolean; showNext: boolean; backdrop: number; size: number; community: boolean; offsets: Record<string, number> };
  textScale: number;
  highContrast: boolean;
  focusAlways: boolean;
  eq: { enabled: boolean; preamp: number; gains: number[]; preset: string };
  keymap: Record<Action, string[]>;
  /** demo albums: shown until your own music appears ('auto'), always, or never */
  demos: 'auto' | 'show' | 'hide';
  clock24: boolean;
  diagnostics: boolean;
  videoLinks: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  settingsVersion: 4,
  autoVideo: true,
  background: { kind: 'city', fit: 'cover', print: false, dim: 0.15 },
  effects: { enabled: true, intensity: 0.6, vhs: true, scanlineStrength: 0.6, halftone: true, scanlines: true, noise: true, glitches: true, chroma: true, vignette: true },
  sound: { enabled: true, volume: 0.6, quietDuringPlayback: true },
  motion: 'system',
  animation: 1,
  sort: 'library',
  repeat: 'off',
  repeatPersist: true,
  releaseAlerts: true,
  resumeSession: true,
  volume: 0.85,
  muted: false,
  lyrics: { show: true, showNext: true, backdrop: 0.45, size: 1, community: true, offsets: {} },
  textScale: 1,
  highContrast: false,
  focusAlways: false,
  eq: { enabled: false, preamp: 0, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preset: 'Flat' },
  keymap: DEFAULT_KEYMAP,
  demos: 'auto',
  clock24: false,
  diagnostics: false,
  videoLinks: {},
};

export interface Profile {
  name: string;
  avatar?: string;
  /** App account. Not created by connecting a music provider. */
  account: null | { email: string };
}

export interface Alert {
  id: string;
  kind: 'update' | 'release';
  title: string;
  text: string;
  artwork?: string;
  /** for releases: what to play */
  release?: import('./lib/types').Release;
}

export interface StackItem {
  kind: 'album' | 'playlist' | 'new' | 'mix';
  id: string;
  title: string;
  subtitle: string;
  artwork?: string;
  source?: Source;
  trackIds: string[];
}

interface State {
  ready: boolean;
  /** what first-launch detection found, shown in the welcome */
  detected: { folders: string[]; added: number } | null;
  settings: Settings;
  profile: Profile;
  tracks: Record<string, LibraryTrack>;
  albums: LibraryAlbum[];
  playlists: Playlist[];
  providerPlaylists: Playlist[];
  providers: ProviderStatus[];
  folders: string[];
  files: string[];
  scan: { running: boolean; done: number; total: number; message?: string };

  screen: Screen;
  returnTo: Screen;
  shelf: Shelf;
  sel: Record<Shelf, number>;
  trackList: { open: boolean; index: number };
  settingsTab: SettingsTab;
  editing: string | null;
  toast: { id: number; text: string; tone: 'info' | 'error' } | null;
  launchFrom: { trackIds: string[]; index: number } | null;

  queue: string[];
  index: number;
  /** For you: mixes built from what you play most (songs from discovery) */
  feed: { at: number; sections: { id: string; title: string; subtitle: string; trackIds: string[]; artwork?: string }[] } | null;
  feedLoading: boolean;
  /** pop-up notices: an update is ready, or a favourite artist released something */
  alerts: Alert[];
  shuffle: ShuffleMode;
  /** the album/playlist in its own order while shuffled */
  baseQueue: string[] | null;
  playing: boolean;
  buffering: boolean;
  error: string | null;
  /** a fallback that kept the music going, shown in the player */
  notice: { text: string; url?: string; link?: string } | null;
  /** YouTube is showing an ad before or during the video */
  adShowing: boolean;
  repeat: RepeatMode;

  set: (p: Partial<State>) => void;
  updateSettings: (fn: (s: Settings) => void) => void;
  notify: (text: string, tone?: 'info' | 'error') => void;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  detected: null,
  settings: DEFAULT_SETTINGS,
  profile: { name: 'Player 1', account: null },
  tracks: {},
  albums: [],
  playlists: [],
  providerPlaylists: [],
  providers: [],
  folders: [],
  files: [],
  scan: { running: false, done: 0, total: 0 },
  screen: 'library',
  returnTo: 'library',
  shelf: 'albums',
  sel: { albums: 0, playlists: 0, feed: 0 },
  trackList: { open: false, index: 0 },
  settingsTab: 'equalizer',
  editing: null,
  toast: null,
  launchFrom: null,
  queue: [],
  index: -1,
  shuffle: 'off',
  baseQueue: null,
  feed: null,
  feedLoading: false,
  alerts: [],
  playing: false,
  buffering: false,
  error: null,
  notice: null,
  adShowing: false,
  repeat: 'off',
  set: (p) => set(p),
  updateSettings: (fn) => {
    const next = structuredClone(get().settings);
    fn(next);
    set({ settings: next });
    void bridge.store.set('settings', next);
  },
  notify: (text, tone = 'info') => {
    const id = Date.now();
    set({ toast: { id, text, tone } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3800);
  },
}));

// ------------------------------------------------------------- selectors
export function stackItems(s: Pick<State, 'albums' | 'playlists' | 'providerPlaylists' | 'settings' | 'shelf' | 'tracks' | 'feed'>, shelf: Shelf = s.shelf): StackItem[] {
  if (shelf === 'feed') {
    return (s.feed?.sections ?? []).map((f) => ({ kind: 'mix', id: f.id, title: f.title, subtitle: f.subtitle, artwork: f.artwork, source: 'discover', trackIds: f.trackIds }));
  }
  if (shelf === 'albums') {
    const demos = s.settings.demos;
    const ownMusic = s.albums.some((a) => a.source !== 'demo') || s.providerPlaylists.length > 0;
    const showDemo = demos === 'show' || (demos === 'auto' && !ownMusic);
    let albums = s.albums.filter((a) => showDemo || a.source !== 'demo');
    const sort = s.settings.sort;
    if (sort === 'title') albums = [...albums].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'artist') albums = [...albums].sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    if (sort === 'source') albums = [...albums].sort((a, b) => a.source.localeCompare(b.source));
    if (sort === 'year') albums = [...albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return albums.map((a) => ({ kind: 'album', id: a.id, title: a.title, subtitle: a.artist, artwork: a.artwork, source: a.source, trackIds: a.trackIds }));
  }
  const pls = [...s.playlists, ...s.providerPlaylists].map<StackItem>((p) => ({
    kind: 'playlist',
    id: p.id,
    title: p.title,
    subtitle: `${(p.entries.length || p.total) ?? 0} track${((p.entries.length || p.total) ?? 0) === 1 ? '' : 's'}${p.providerId ? ` · ${p.providerId}` : ''}`,
    artwork: playlistArtwork(p, s.tracks),
    trackIds: p.entries.map((e) => e.trackId),
  }));
  return [{ kind: 'new', id: 'new', title: 'New playlist', subtitle: 'Create', trackIds: [] }, ...pls];
}

export function playlistArtwork(p: Playlist, tracks: Record<string, LibraryTrack>): string | undefined {
  if (p.cover.kind === 'image' || p.cover.kind === 'collage') return p.cover.url;
  if (p.cover.kind === 'track') return tracks[p.cover.trackId]?.artwork;
  for (const e of p.entries) {
    const a = tracks[e.trackId]?.artwork;
    if (a) return a;
  }
  return undefined;
}

export const currentTrack = (s: Pick<State, 'queue' | 'index' | 'tracks'>) => (s.index >= 0 ? s.tracks[s.queue[s.index]] : undefined);

// ---------------------------------------------------------------- loading
interface DemoCatalogue {
  id: string;
  title: string;
  artist: string;
  year: number;
  tracks: { id: string; title: string; number: number; duration: number; audio: string; lyrics: string; video: string | null }[];
}

async function loadDemo(): Promise<{ tracks: LibraryTrack[]; albums: LibraryAlbum[] }> {
  const base = new URL('demo/', document.baseURI).toString();
  const res = await fetch(`${base}catalogue.json`);
  const cat = (await res.json()) as DemoCatalogue[];
  const tracks: LibraryTrack[] = [];
  const albums: LibraryAlbum[] = [];
  for (const a of cat) {
    const artwork = await demoArtwork(a.id);
    const albumId = `demo-album:${a.id}`;
    for (const t of a.tracks) {
      tracks.push({
        id: `demo:${t.id}`,
        source: 'demo',
        title: t.title,
        artist: a.artist,
        album: a.title,
        albumId,
        number: t.number,
        year: a.year,
        duration: t.duration,
        artwork,
        audioUrl: base + t.audio,
        videoUrl: t.video ? base + t.video : undefined,
        lyricsUrl: base + t.lyrics,
        available: true,
      });
    }
    albums.push({ id: albumId, source: 'demo', title: a.title, artist: a.artist, year: a.year, artwork, trackIds: a.tracks.map((t) => `demo:${t.id}`) });
  }
  return { tracks, albums };
}

export async function boot() {
  const [settingsRaw, profileRaw, playlistsRaw, index, demo, providers] = await Promise.all([
    bridge.store.get<Settings>('settings', DEFAULT_SETTINGS),
    bridge.store.get<Profile>('profile', { name: 'Player 1', account: null }),
    bridge.store.get<Playlist[]>('playlists', []),
    bridge.library.get(),
    loadDemo().catch(() => ({ tracks: [], albums: [] })),
    bridge.providers.status().catch(() => [] as ProviderStatus[]),
  ]);
  // Stored values are untrusted: keep only the right shapes so a damaged file never breaks start-up.
  const obj = <T,>(v: unknown, d: T): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : d);
  const settings = obj<Partial<Settings>>(settingsRaw, {}) as Settings;
  const profileObj = obj<Partial<Profile>>(profileRaw, {});
  const profile: Profile = { name: typeof profileObj.name === 'string' && profileObj.name ? profileObj.name : 'Player 1', avatar: typeof profileObj.avatar === 'string' ? profileObj.avatar : undefined, account: null };
  const playlists = (Array.isArray(playlistsRaw) ? playlistsRaw : []).filter((p): p is Playlist => !!p && typeof p === 'object' && typeof (p as Playlist).id === 'string' && Array.isArray((p as Playlist).entries)).map((p) => ({ ...p, title: typeof p.title === 'string' ? p.title : 'Untitled playlist', description: typeof p.description === 'string' ? p.description : '', cover: p.cover && typeof p.cover === 'object' ? p.cover : { kind: 'auto' as const } }));
  const merged: Settings = { ...DEFAULT_SETTINGS, ...settings, background: { ...DEFAULT_SETTINGS.background, ...settings.background }, effects: { ...DEFAULT_SETTINGS.effects, ...settings.effects }, sound: { ...DEFAULT_SETTINGS.sound, ...settings.sound }, lyrics: { ...DEFAULT_SETTINGS.lyrics, ...settings.lyrics }, eq: { ...DEFAULT_SETTINGS.eq, ...settings.eq }, keymap: { ...DEFAULT_KEYMAP, ...settings.keymap } };
  if (!Array.isArray(merged.eq.gains) || merged.eq.gains.length !== DEFAULT_SETTINGS.eq.gains.length || merged.eq.gains.some((g) => typeof g !== 'number')) merged.eq = { ...DEFAULT_SETTINGS.eq };
  for (const k of Object.keys(DEFAULT_KEYMAP) as Action[]) if (!Array.isArray(merged.keymap[k])) merged.keymap[k] = DEFAULT_KEYMAP[k];
  if (!merged.videoLinks || typeof merged.videoLinks !== 'object') merged.videoLinks = {};
  if (!merged.lyrics.offsets || typeof merged.lyrics.offsets !== 'object') merged.lyrics.offsets = {};
  // v2: lyrics and official videos are found automatically (people expect them without digging in settings)
  if ((settings.settingsVersion ?? 1) < 2) {
    merged.lyrics.community = true;
    merged.autoVideo = true;
    merged.settingsVersion = 2;
  }
  // v3: Tab is for moving focus (keyboard users, screen readers); "Now playing" moved to V
  if ((settings.settingsVersion ?? 1) < 3) {
    merged.keymap.nowPlaying = merged.keymap.nowPlaying.filter((k) => k !== 'Tab');
    if (!merged.keymap.nowPlaying.length) merged.keymap.nowPlaying = ['v'];
    merged.settingsVersion = 3;
  }
  // v4: demo albums step aside on their own once your music is there
  if ((settings.settingsVersion ?? 1) < 4) {
    merged.demos = (settings as { showDemo?: boolean }).showDemo === false ? 'hide' : 'auto';
    delete (merged as { showDemo?: boolean }).showDemo;
    merged.settingsVersion = 4;
  }
  if (!['auto', 'show', 'hide'].includes(merged.demos)) merged.demos = 'auto';
  const tracks: Record<string, LibraryTrack> = {};
  for (const t of [...demo.tracks, ...index.tracks]) tracks[t.id] = applyLinks(t, merged);
  // Real libraries come first; the demo shelf sits after them.
  const albums = [...index.albums, ...demo.albums];
  useStore.setState({
    ready: true,
    settings: merged,
    profile,
    playlists,
    tracks,
    albums,
    folders: index.folders,
    files: index.files,
    providers,
    repeat: merged.repeatPersist ? merged.repeat : 'off',
    shuffle: merged.repeatPersist && (merged.shuffle === 'shuffle' || merged.shuffle === 'magic') ? merged.shuffle : 'off',
  });
  void loadProviders();
  // first launch of the desktop app: pick up the system Music folder straight away
  if (!merged.onboarded) {
    bridge.library.autoDetect().then((r) => {
      if (!r) return;
      applyLibrary(r.index);
      useStore.setState({ detected: { folders: r.folders, added: r.report.added }, sel: { albums: 0, playlists: 0, feed: 0 } });
    }).catch(() => undefined);
  }
}

function applyLinks(t: LibraryTrack, s: Settings): LibraryTrack {
  const yt = s.videoLinks[t.id];
  return yt ? { ...t, youtubeId: yt } : t;
}

export function applyLibrary(index: { tracks: LibraryTrack[]; albums: LibraryAlbum[]; folders: string[]; files: string[] }) {
  const s = useStore.getState();
  const tracks: Record<string, LibraryTrack> = {};
  for (const t of Object.values(s.tracks)) if (t.source !== 'local') tracks[t.id] = t;
  for (const t of index.tracks) tracks[t.id] = applyLinks(t, s.settings);
  const albums = [...index.albums, ...s.albums.filter((a) => a.source !== 'local')];
  useStore.setState({ tracks, albums, folders: index.folders, files: index.files });
}

export async function loadProviders() {
  const statuses = await bridge.providers.status().catch(() => [] as ProviderStatus[]);
  useStore.setState({ providers: statuses });
  for (const p of statuses.filter((x) => x.connected && x.id !== 'apple')) {
    try {
      const lib = await bridge.providers.library(p.id);
      const s = useStore.getState();
      const tracks = { ...s.tracks };
      for (const t of lib.tracks) tracks[t.id] = applyLinks(t, s.settings);
      const albums = [...s.albums.filter((a) => a.source !== p.id), ...lib.albums];
      const pls: Playlist[] = lib.playlists.map((pl) => ({
        id: pl.id,
        title: pl.title,
        description: pl.description,
        cover: pl.artwork ? { kind: 'image', url: pl.artwork } : { kind: 'auto' },
        entries: pl.trackIds.map((id, i) => ({ key: `${pl.id}:${i}`, trackId: id, addedAt: 0, title: tracks[id]?.title ?? '', artist: tracks[id]?.artist ?? '' })),
        createdAt: 0,
        updatedAt: 0,
        providerId: p.id,
        total: pl.total,
      }));
      useStore.setState({ tracks, albums, providerPlaylists: [...s.providerPlaylists.filter((x) => x.providerId !== p.id), ...pls] });
    } catch (e) {
      useStore.getState().notify(`${p.name}: ${(e as Error).message}`, 'error');
    }
  }
}

// -------------------------------------------------------------- playlists
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function savePlaylists(pls: Playlist[]) {
  useStore.setState({ playlists: pls });
  void bridge.store.set('playlists', pls);
}

export const playlists = {
  create(title = 'Untitled playlist', trackIds: string[] = []): Playlist {
    const s = useStore.getState();
    const now = Date.now();
    const p: Playlist = {
      id: `pl:${uid()}`,
      title,
      description: '',
      cover: { kind: 'auto' },
      entries: trackIds.map((id) => entry(id, s.tracks[id], s.profile.name)),
      createdAt: now,
      updatedAt: now,
      history: [{ at: now, by: s.profile.name, action: 'created the playlist' }],
    };
    savePlaylists([p, ...s.playlists]);
    return p;
  },
  update(id: string, fn: (p: Playlist) => void, action?: string) {
    const s = useStore.getState();
    const next = s.playlists.map((p) => {
      if (p.id !== id) return p;
      const c = structuredClone(p);
      fn(c);
      c.updatedAt = Date.now();
      if (action) c.history = [...(c.history ?? []), { at: c.updatedAt, by: s.profile.name, action }].slice(-50);
      return c;
    });
    savePlaylists(next);
  },
  remove(id: string) {
    savePlaylists(useStore.getState().playlists.filter((p) => p.id !== id));
  },
  duplicate(id: string) {
    const s = useStore.getState();
    const src = [...s.playlists, ...s.providerPlaylists].find((p) => p.id === id);
    if (!src) return;
    const now = Date.now();
    const copy: Playlist = { ...structuredClone(src), id: `pl:${uid()}`, title: `${src.title} copy`, providerId: undefined, shared: undefined, createdAt: now, updatedAt: now, entries: src.entries.map((e) => ({ ...e, key: uid() })) };
    savePlaylists([copy, ...s.playlists]);
  },
  addTracks(id: string, trackIds: string[]) {
    const s = useStore.getState();
    playlists.update(id, (p) => p.entries.push(...trackIds.map((t) => entry(t, s.tracks[t], s.profile.name))), `added ${trackIds.length} track${trackIds.length === 1 ? '' : 's'}`);
  },
  removeEntry(id: string, key: string) {
    playlists.update(id, (p) => (p.entries = p.entries.filter((e) => e.key !== key)), 'removed a track');
  },
  move(id: string, from: number, to: number) {
    playlists.update(id, (p) => {
      const [it] = p.entries.splice(from, 1);
      p.entries.splice(Math.max(0, Math.min(p.entries.length, to)), 0, it);
    }, 'reordered tracks');
  },
  serialize(p: Playlist, tracks: Record<string, LibraryTrack>) {
    // References and metadata only: never audio or video files.
    return JSON.stringify(
      {
        format: 'noctune-playlist',
        version: 1,
        title: p.title,
        description: p.description,
        entries: p.entries.map((e) => {
          const t = tracks[e.trackId];
          return { trackId: e.trackId, source: t?.source, providerUri: t?.providerUri, title: t?.title ?? e.title, artist: t?.artist ?? e.artist, album: t?.album, duration: t?.duration };
        }),
      },
      null,
      2,
    );
  },
  import(text: string) {
    const j = JSON.parse(text) as { format?: string; title: string; description?: string; entries: { trackId: string; title: string; artist: string; album?: string }[] };
    if (j.format !== 'noctune-playlist') throw new Error('This file is not a Noctune playlist.');
    const s = useStore.getState();
    // Match by id first, then by title+artist so playlists move between machines.
    const byName = new Map(Object.values(s.tracks).map((t) => [`${t.title.toLowerCase()}::${t.artist.toLowerCase()}`, t.id]));
    const p = playlists.create(j.title);
    playlists.update(p.id, (pl) => {
      pl.description = j.description ?? '';
      pl.entries = j.entries.map((e) => {
        const id = s.tracks[e.trackId] ? e.trackId : byName.get(`${e.title.toLowerCase()}::${e.artist.toLowerCase()}`) ?? e.trackId;
        return { key: uid(), trackId: id, addedAt: Date.now(), addedBy: s.profile.name, title: e.title, artist: e.artist };
      });
    }, 'imported the playlist');
    return p;
  },
};

function entry(trackId: string, t: LibraryTrack | undefined, by: string): PlaylistEntry {
  return { key: uid(), trackId, addedAt: Date.now(), addedBy: by, title: t?.title ?? 'Unknown', artist: t?.artist ?? '' };
}

export function saveProfile(p: Profile) {
  useStore.setState({ profile: p });
  void bridge.store.set('profile', p);
}
