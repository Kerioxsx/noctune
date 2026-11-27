import { useStore, currentTrack, type RepeatMode } from '../store';
import { bridge } from '../lib/bridge';
import { audio } from './audio';
import type { LibraryTrack, RemoteState } from '../lib/types';

/**
 * Every source plays through a Backend. The active backend's clock is the
 * single source of truth for the timeline and lyric highlighting.
 */
export interface Capabilities {
  seek: boolean;
  volume: boolean;
  eq: boolean;
  repeatOne: boolean;
  video: boolean;
}

interface Backend {
  kind: 'media' | 'spotify' | 'youtube';
  caps: Capabilities;
  load(t: LibraryTrack, autoplay: boolean, startAt: number): Promise<void>;
  play(): Promise<void> | void;
  pause(): void;
  seek(t: number): void;
  setVolume(v: number, muted: boolean): void;
  time(): number;
  duration(): number;
  buffered(): number;
  stop(): void;
}

// ------------------------------------------------------------------ media
class MediaBackend implements Backend {
  kind = 'media' as const;
  el: HTMLVideoElement;
  caps: Capabilities = { seek: true, volume: true, eq: true, repeatOne: true, video: true };
  private routed = false;

  constructor() {
    const el = document.createElement('video');
    el.className = 'media-el';
    el.preload = 'auto';
    el.playsInline = true;
    el.crossOrigin = 'anonymous';
    el.disablePictureInPicture = true;
    this.el = el;
    el.addEventListener('ended', () => controller.handleEnded());
    el.addEventListener('waiting', () => useStore.setState({ buffering: true }));
    el.addEventListener('playing', () => useStore.setState({ buffering: false, playing: true, error: null }));
    el.addEventListener('pause', () => useStore.setState({ playing: false }));
    el.addEventListener('canplay', () => useStore.setState({ buffering: false }));
    el.addEventListener('error', () => {
      const code = el.error?.code;
      const msg = code === 4 ? 'This file could not be played. It may have been moved, or its format is not supported here.' : code === 2 ? 'The file could not be read. It may have moved or the network dropped.' : 'Playback failed.';
      controller.fail(msg);
    });
  }

  async load(t: LibraryTrack, autoplay: boolean, startAt: number) {
    const src = t.videoUrl ?? t.audioUrl;
    if (!src) throw new Error('No playable file for this track.');
    this.el.src = src;
    this.caps.video = !!t.videoUrl || !!t.isVideo;
    if (!this.routed) this.routed = audio.attach(this.el);
    this.caps.eq = this.routed;
    if (startAt > 0) {
      await new Promise<void>((res) => {
        const h = () => {
          this.el.currentTime = Math.min(startAt, (this.el.duration || startAt + 1) - 0.5);
          res();
        };
        this.el.addEventListener('loadedmetadata', h, { once: true });
        setTimeout(res, 3000);
      });
    }
    if (autoplay) await this.play();
  }
  async play() {
    audio.resume();
    try {
      await this.el.play();
    } catch (e) {
      // Only an autoplay block means "press play"; a broken or missing file is handled by the 'error' event, which recovers.
      if ((e as Error).name === 'NotAllowedError') controller.fail('Playback was blocked. Press play to start.', { recover: false });
    }
  }
  pause() {
    this.el.pause();
  }
  seek(t: number) {
    if (Number.isFinite(this.el.duration)) this.el.currentTime = Math.max(0, Math.min(t, this.el.duration - 0.05));
  }
  setVolume(v: number, muted: boolean) {
    // The element stays at unity; the WebAudio gain applies volume so EQ headroom is consistent.
    if (this.routed) {
      this.el.volume = 1;
      this.el.muted = false;
      audio.setMusicVolume(muted ? 0 : v);
    } else {
      this.el.volume = v * v;
      this.el.muted = muted;
    }
  }
  time() {
    return this.el.currentTime || 0;
  }
  duration() {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }
  buffered() {
    const b = this.el.buffered;
    const t = this.el.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
    return b.length ? b.end(b.length - 1) : 0;
  }
  stop() {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  }
}

// --------------------------------------------------------- Spotify Connect
class SpotifyBackend implements Backend {
  kind = 'spotify' as const;
  caps: Capabilities = { seek: true, volume: true, eq: false, repeatOne: true, video: false };
  private state: RemoteState = { active: false, playing: false, positionMs: 0, durationMs: 0 };
  private at = performance.now();
  private poll: number | undefined;
  private uri = '';
  private reviving = false;

  async load(t: LibraryTrack, autoplay: boolean, startAt: number) {
    if (!t.providerUri) throw new Error('This Spotify item has no playable reference.');
    this.uri = t.providerUri;
    this.state = { active: true, playing: autoplay, positionMs: startAt * 1000, durationMs: (t.duration ?? 0) * 1000 };
    this.at = performance.now();
    if (autoplay) await spotifyPlay([t.providerUri], Math.round(startAt * 1000));
    clearInterval(this.poll);
    this.poll = window.setInterval(() => void this.refresh(), 1000);
    useStore.setState({ playing: autoplay, buffering: false });
  }
  private async refresh() {
    try {
      const s = await bridge.providers.remote({ op: 'state' });
      if (!s) return;
      if (s.uri && s.uri !== this.uri && this.state.playing && this.state.positionMs > this.state.durationMs - 2500) {
        controller.handleEnded();
        return;
      }
      this.state = s;
      this.at = performance.now();
      useStore.setState({ playing: s.playing });
      if (!s.active && this.state.playing && !this.reviving) {
        // Spotify was closed mid-song: bring a device back and carry on from here.
        this.reviving = true;
        try {
          await spotifyPlay([this.uri], Math.round(this.time() * 1000));
        } catch (e) {
          controller.fail((e as Error).message);
        } finally {
          this.reviving = false;
        }
      }
    } catch (e) {
      controller.fail((e as Error).message, { recover: false });
    }
  }
  async play() {
    await bridge.providers.remote({ op: 'resume' }).catch(() => spotifyPlay([this.uri], Math.round(this.time() * 1000)).catch((e) => controller.fail((e as Error).message)));
    this.state.playing = true;
    this.at = performance.now();
  }
  pause() {
    this.state.positionMs = this.time() * 1000;
    this.state.playing = false;
    void bridge.providers.remote({ op: 'pause' }).catch((e) => controller.fail((e as Error).message, { recover: false }));
  }
  seek(t: number) {
    this.state.positionMs = t * 1000;
    this.at = performance.now();
    void bridge.providers.remote({ op: 'seek', ms: t * 1000 }).catch((e) => controller.fail((e as Error).message, { recover: false }));
  }
  private volTimer: number | undefined;
  setVolume(v: number, muted: boolean) {
    clearTimeout(this.volTimer);
    this.volTimer = window.setTimeout(() => void bridge.providers.remote({ op: 'volume', pct: muted ? 0 : v * 100 }).catch(() => undefined), 200);
  }
  time() {
    const p = this.state.positionMs + (this.state.playing ? performance.now() - this.at : 0);
    return Math.min(p, this.state.durationMs || p) / 1000;
  }
  duration() {
    return this.state.durationMs / 1000;
  }
  buffered() {
    return this.duration();
  }
  stop() {
    clearInterval(this.poll);
  }
}

// ---------------------------------------------------------------- YouTube
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allow: boolean): void;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, o: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

class VideoBlocked extends Error {}

let ytReady: Promise<void> | null = null;
function loadYT() {
  ytReady ??= new Promise((res, rej) => {
    if (window.YT?.Player) return res();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => rej(new Error('Could not reach YouTube.'));
    window.onYouTubeIframeAPIReady = () => res();
    document.head.appendChild(s);
  });
  return ytReady;
}

/** Official videos play inside YouTube's own embedded player, as its terms require. */
class YouTubeBackend implements Backend {
  kind = 'youtube' as const;
  caps: Capabilities = { seek: true, volume: true, eq: false, repeatOne: true, video: true };
  host: HTMLDivElement;
  private p: YTPlayer | null = null;

  constructor() {
    this.host = document.createElement('div');
    this.host.className = 'yt-host';
  }
  async load(t: LibraryTrack, autoplay: boolean, startAt: number) {
    if (!t.youtubeId) throw new Error('No official video linked.');
    await loadYT();
    const mount = document.createElement('div');
    this.host.replaceChildren(mount);
    this.p?.destroy();
    await new Promise<void>((res, rej) => {
      this.p = new window.YT!.Player(mount, {
        videoId: t.youtubeId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: autoplay ? 1 : 0, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(startAt), iv_load_policy: 3, origin: location.origin.startsWith('http') ? location.origin : undefined },
        events: {
          onReady: () => res(),
          onStateChange: (e: { data: number }) => {
            const S = window.YT!.PlayerState;
            if (e.data === S.ENDED) controller.handleEnded();
            useStore.setState({ playing: e.data === S.PLAYING, buffering: e.data === S.BUFFERING });
          },
          onError: (e: { data: number }) => {
            const msg = e.data === 101 || e.data === 150 ? 'The owner does not allow this video to play in other apps.' : e.data === 100 ? 'This video is unavailable.' : 'The video could not be played.';
            controller.fail(msg, { video: true });
            rej(new VideoBlocked(msg));
          },
        },
      });
    });
  }
  play() {
    this.p?.playVideo();
  }
  pause() {
    this.p?.pauseVideo();
  }
  seek(t: number) {
    this.p?.seekTo(t, true);
  }
  setVolume(v: number, muted: boolean) {
    if (!this.p) return;
    this.p.setVolume(Math.round(v * 100));
    if (muted) this.p.mute();
    else this.p.unMute();
  }
  time() {
    return this.p?.getCurrentTime?.() ?? 0;
  }
  duration() {
    return this.p?.getDuration?.() ?? 0;
  }
  buffered() {
    return (this.p?.getVideoLoadedFraction?.() ?? 0) * this.duration();
  }
  stop() {
    this.p?.destroy();
    this.p = null;
    this.host.replaceChildren();
  }
}

// ------------------------------------------------- Spotify device wake-up
type Device = { id: string; name: string; is_active: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Play on Spotify no matter where it is: the active device, else any device the
 * account has, else open the Spotify app on this computer and wait for it.
 */
async function spotifyPlay(uris: string[], positionMs = 0, deviceId?: string) {
  try {
    await bridge.providers.remote({ op: 'play', uris, positionMs, deviceId });
    return;
  } catch (e) {
    if (!/no active spotify device/i.test((e as Error).message)) throw e;
  }
  let devices = ((await bridge.providers.remote({ op: 'devices' })) as unknown as Device[]) ?? [];
  if (!devices.length) {
    useStore.getState().notify('Opening Spotify on this computer…');
    await bridge.openExternal('spotify:');
    for (let i = 0; i < 15 && !devices.length; i++) {
      await sleep(1000);
      devices = ((await bridge.providers.remote({ op: 'devices' })) as unknown as Device[]) ?? [];
    }
  }
  const dev = devices.find((d) => d.is_active) ?? devices[0];
  if (!dev) throw new Error('Spotify did not open. Install or open the Spotify app, then press play.');
  await bridge.providers.remote({ op: 'play', uris, positionMs, deviceId: dev.id });
}

// --------------------------------------------- Spotify inside the app (SDK)
interface SdkState { paused: boolean; position: number; duration: number; timestamp: number }
interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(ev: string, cb: (x: never) => void): void;
  resume(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>;
  activateElement?(): Promise<void>;
}
declare global {
  interface Window {
    Spotify?: { Player: new (o: { name: string; getOAuthToken: (cb: (t: string) => void) => void; volume: number }) => SdkPlayer };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

/** Widevine is what Spotify's in-browser player needs; stock Electron builds do not ship it. */
async function hasWidevine() {
  try {
    await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] }]);
    return true;
  } catch {
    return false;
  }
}

/** Spotify audio played by Noctune itself, as a Spotify Connect device named "Noctune" (Premium). */
class SpotifySdkBackend implements Backend {
  kind = 'spotify' as const;
  caps: Capabilities = { seek: true, volume: true, eq: false, repeatOne: true, video: false };
  private player: SdkPlayer | null = null;
  private deviceId = '';
  private st: SdkState = { paused: true, position: 0, duration: 0, timestamp: performance.now() };
  private lastPos = 0;
  private ready: Promise<boolean> | null = null;

  /** Resolves true once the in-app player is connected; false where it cannot run. */
  init(): Promise<boolean> {
    this.ready ??= (async () => {
      if (!(await hasWidevine())) return false;
      try {
        await new Promise<void>((res, rej) => {
          if (window.Spotify) return res();
          window.onSpotifyWebPlaybackSDKReady = () => res();
          const sc = document.createElement('script');
          sc.src = 'https://sdk.scdn.co/spotify-player.js';
          sc.onerror = () => rej(new Error('sdk'));
          document.head.appendChild(sc);
        });
        const p = new window.Spotify!.Player({ name: 'Noctune', volume: useStore.getState().settings.volume, getOAuthToken: (cb) => void bridge.providers.spotifyToken().then(cb) });
        const id = await new Promise<string>((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout')), 10000);
          p.addListener('ready', ((d: { device_id: string }) => (clearTimeout(t), res(d.device_id))) as never);
          for (const ev of ['initialization_error', 'authentication_error', 'account_error']) p.addListener(ev, (() => (clearTimeout(t), rej(new Error(ev)))) as never);
          void p.connect();
        });
        p.addListener('player_state_changed', ((s: { paused: boolean; position: number; duration: number } | null) => {
          if (!s) return;
          const wasNearEnd = !this.st.paused && this.st.duration > 0 && this.lastPos > this.st.duration - 2500;
          this.st = { paused: s.paused, position: s.position, duration: s.duration, timestamp: performance.now() };
          this.lastPos = s.position;
          useStore.setState({ playing: !s.paused, buffering: false });
          if (s.paused && s.position === 0 && wasNearEnd) controller.handleEnded();
        }) as never);
        p.addListener('playback_error', ((e: { message: string }) => controller.fail(`Spotify: ${e.message}`)) as never);
        this.player = p;
        this.deviceId = id;
        return true;
      } catch {
        return false;
      }
    })();
    return this.ready;
  }
  async load(t: LibraryTrack, autoplay: boolean, startAt: number) {
    if (!t.providerUri) throw new Error('This Spotify item has no playable reference.');
    await this.player?.activateElement?.();
    this.st = { paused: !autoplay, position: startAt * 1000, duration: (t.duration ?? 0) * 1000, timestamp: performance.now() };
    if (autoplay) await bridge.providers.remote({ op: 'play', uris: [t.providerUri], positionMs: Math.round(startAt * 1000), deviceId: this.deviceId });
  }
  play() {
    void this.player?.resume();
  }
  pause() {
    void this.player?.pause();
  }
  seek(t: number) {
    void this.player?.seek(Math.round(t * 1000));
    this.st = { ...this.st, position: t * 1000, timestamp: performance.now() };
  }
  setVolume(v: number, muted: boolean) {
    void this.player?.setVolume(muted ? 0 : v * v);
  }
  time() {
    const p = this.st.position + (this.st.paused ? 0 : performance.now() - this.st.timestamp);
    return Math.min(p, this.st.duration || p) / 1000;
  }
  duration() {
    return this.st.duration / 1000;
  }
  buffered() {
    return this.duration();
  }
  stop() {
    void this.player?.pause();
  }
}

// ------------------------------------------------- the same song elsewhere
const norm = (x: string) =>
  x
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[([][^)\]]*\b(feat|ft|with|from|remaster(ed)?|version|edit|mix|mono|stereo|deluxe|bonus|explicit|clean)\b[^)\]]*[)\]]/g, '')
    .replace(/\s[-–]\s.*(remaster|version|edit|mix).*$/, '')
    .replace(/\b(feat|ft)\.?\s.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const firstArtist = (a: string) => norm(a.split(/,|&|\sx\s|\sand\s/i)[0] ?? a);
const SOURCE_RANK: Record<string, number> = { local: 0, soundcloud: 1, spotify: 2, apple: 3, demo: 4 };

/** Other playable copies of the same song in the library, best first: your own file, then services. */
export function alternativesFor(t: LibraryTrack, all: Record<string, LibraryTrack>): LibraryTrack[] {
  const title = norm(t.title);
  const artist = firstArtist(t.artist);
  if (!title) return [];
  return Object.values(all)
    .filter((x) => x.id !== t.id && x.available && (x.audioUrl || x.providerUri || x.videoUrl) && norm(x.title) === title && (firstArtist(x.artist) === artist || norm(x.artist).includes(artist) || artist.includes(firstArtist(x.artist))))
    .filter((x) => !(x.duration && t.duration) || Math.abs(x.duration - t.duration) < 20)
    .sort((a, b) => (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9));
}

const SOURCE_NAME: Record<string, string> = { local: 'your files', soundcloud: 'SoundCloud', spotify: 'Spotify', apple: 'Apple Music', demo: 'the demo library' };

// ------------------------------------------------------------- controller
class Controller {
  media = new MediaBackend();
  youtube = new YouTubeBackend();
  private spotify = new SpotifyBackend();
  private spotifySdk = new SpotifySdkBackend();
  private sdkOk = false;
  active: Backend = this.media;
  private loadToken = 0;
  /** what is actually playing for the current queue item (a fallback copy may stand in for it) */
  playing: LibraryTrack | null = null;
  private tried = new Set<string>();
  private recovering = false;
  private autoplayNext = true;

  backendFor(t: LibraryTrack): Backend {
    if (t.youtubeId) return this.youtube;
    if (t.source === 'spotify') return this.sdkOk ? this.spotifySdk : this.spotify;
    return this.media;
  }

  get caps(): Capabilities {
    return this.active.caps;
  }

  /** Replace the queue and start at index. */
  async start(trackIds: string[], index: number, opts: { autoplay?: boolean; startAt?: number } = {}) {
    useStore.setState({ queue: trackIds, index });
    await this.loadIndex(index, opts.autoplay ?? true, opts.startAt ?? 0);
  }

  private async loadIndex(index: number, autoplay: boolean, startAt = 0) {
    const s = useStore.getState();
    const t = s.tracks[s.queue[index]];
    this.tried = new Set();
    useStore.setState({ index, error: null, buffering: true, notice: null });
    if (!t) {
      this.fail('This track is no longer in your library.');
      return;
    }
    this.autoplayNext = autoplay;
    if (!t.available) {
      this.fail(`“${t.title}” is unavailable from ${SOURCE_NAME[t.source] ?? t.source}.`);
      return;
    }
    await this.loadTrack(t, autoplay, startAt);
  }

  /** Load one concrete track into the right backend. Returns false when it failed outright. */
  private async loadTrack(t: LibraryTrack, autoplay: boolean, startAt = 0): Promise<boolean> {
    const token = ++this.loadToken;
    this.tried.add(t.id + (t.youtubeId ? ':video' : ''));
    this.playing = t;
    if (t.source === 'spotify' && !t.youtubeId && !this.sdkOk) this.sdkOk = await this.spotifySdk.init();
    const next = this.backendFor(t);
    if (next !== this.active) this.active.stop();
    this.active = next;
    this.applyVolume();
    try {
      await next.load(t, autoplay, startAt);
      if (token !== this.loadToken) return true;
      this.applyVolume();
      this.updateMediaSession(t);
      // keep the provider's own repeat in sync where it owns the queue
      if (t.source === 'spotify') void bridge.providers.remote({ op: 'repeat', mode: useStore.getState().repeat === 'one' ? 'track' : 'off' }).catch(() => undefined);
      return true;
    } catch (e) {
      if (token !== this.loadToken) return true;
      // a blocked video already started its own recovery from the player's error event
      if (e instanceof VideoBlocked) return true;
      // YouTube unreachable (offline, network blocks it): treat like a blocked video and play the audio
      this.fail((e as Error).message, { video: next.kind === 'youtube' });
      return false;
    }
  }

  /**
   * Something could not play. Unless told otherwise, keep the music going:
   * a blocked video falls back to the song's audio; anything else falls back to
   * another copy of the same song in the library. Only when nothing is left is
   * the error shown.
   */
  fail(msg: string, opts: { video?: boolean; recover?: boolean } = {}) {
    if (opts.recover !== false && !this.recovering) {
      void this.recover(msg, !!opts.video);
      return;
    }
    useStore.setState({ error: msg, buffering: false, playing: false });
  }

  private async recover(msg: string, video: boolean) {
    const s = useStore.getState();
    const item = s.tracks[s.queue[s.index]];
    const cur = this.playing ?? item;
    if (!item || !cur) {
      useStore.setState({ error: msg, buffering: false, playing: false });
      return;
    }
    this.recovering = true;
    try {
      const at = this.active.time();
      if (video && cur.youtubeId) {
        const audioOnly = { ...cur, youtubeId: undefined };
        const watch = `https://www.youtube.com/watch?v=${cur.youtubeId}`;
        const playable = audioOnly.audioUrl || audioOnly.providerUri || audioOnly.videoUrl;
        if (playable && (await this.loadTrack(audioOnly, true, at))) {
          useStore.setState({ notice: { text: `${msg.replace(/\.$/, '')}. The song plays with the visualizer instead.`, url: watch, link: 'Watch on YouTube' } });
          return;
        }
        useStore.setState({ notice: { text: 'This video can only be watched on YouTube.', url: watch, link: 'Watch on YouTube' } });
      }
      for (const alt of alternativesFor(item, s.tracks)) {
        if (this.tried.has(alt.id)) continue;
        if (await this.loadTrack(alt, this.autoplayNext, 0)) {
          useStore.setState({ error: null, notice: { text: `${msg.replace(/\.$/, '')}. Playing the copy from ${SOURCE_NAME[alt.source] ?? alt.source} instead.` } });
          s.notify(`Playing “${alt.title}” from ${SOURCE_NAME[alt.source] ?? alt.source}`);
          return;
        }
      }
      const hint = item.source === 'local' ? '' : ' Add your own copy of this song to your music folder and Noctune will play it here.';
      useStore.setState({ error: msg + hint, buffering: false, playing: false });
    } finally {
      this.recovering = false;
    }
  }

  toggle() {
    const s = useStore.getState();
    if (s.index < 0) return;
    if (s.playing) this.active.pause();
    else void this.active.play();
  }
  play() {
    void this.active.play();
  }
  pause() {
    this.active.pause();
  }
  seek(t: number) {
    if (!this.active.caps.seek) return;
    this.active.seek(Math.max(0, t));
  }
  seekBy(d: number) {
    this.seek(this.active.time() + d);
  }
  next(manual = true) {
    const s = useStore.getState();
    if (!s.queue.length) return;
    let i = s.index + 1;
    if (i >= s.queue.length) {
      if (s.repeat === 'all' || manual) i = 0;
      else {
        this.active.pause();
        this.active.seek(0);
        return;
      }
    }
    void this.loadIndex(i, true);
  }
  prev() {
    const s = useStore.getState();
    if (!s.queue.length) return;
    // standard behaviour: restart if more than 3s in
    if (this.active.time() > 3) {
      this.seek(0);
      return;
    }
    const i = s.index - 1 < 0 ? (s.repeat === 'all' ? s.queue.length - 1 : 0) : s.index - 1;
    void this.loadIndex(i, true);
  }
  handleEnded() {
    const s = useStore.getState();
    if (s.repeat === 'one') {
      this.active.seek(0);
      void this.active.play();
      return;
    }
    this.next(false);
  }
  setRepeat(mode: RepeatMode) {
    const st = useStore.getState();
    useStore.setState({ repeat: mode });
    if (st.settings.repeatPersist) st.updateSettings((x) => (x.repeat = mode));
    if (this.active.kind === 'spotify') void bridge.providers.remote({ op: 'repeat', mode: mode === 'one' ? 'track' : 'off' }).catch(() => undefined);
  }
  cycleRepeat() {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const r = useStore.getState().repeat;
    let next = order[(order.indexOf(r) + 1) % 3];
    if (next === 'one' && !this.active.caps.repeatOne) next = 'off';
    this.setRepeat(next);
    return next;
  }
  applyVolume() {
    const s = useStore.getState().settings;
    this.active.setVolume(s.volume, s.muted);
  }
  time() {
    return this.active.time();
  }
  duration() {
    return this.active.duration() || currentTrack(useStore.getState())?.duration || 0;
  }
  buffered() {
    return this.active.buffered();
  }

  private updateMediaSession(t: LibraryTrack) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: t.artwork && !t.artwork.startsWith('data:') ? [{ src: t.artwork, sizes: '512x512' }] : [] });
  }

  installMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => this.play());
    ms.setActionHandler('pause', () => this.pause());
    ms.setActionHandler('previoustrack', () => this.prev());
    ms.setActionHandler('nexttrack', () => this.next());
    ms.setActionHandler('seekbackward', (d) => this.seekBy(-(d.seekOffset ?? 10)));
    ms.setActionHandler('seekforward', (d) => this.seekBy(d.seekOffset ?? 10));
    ms.setActionHandler('seekto', (d) => d.seekTime !== undefined && this.seek(d.seekTime));
  }

  // ---- session persistence
  saveSession() {
    const s = useStore.getState();
    if (s.index < 0) return;
    void bridge.store.set('session', { queue: s.queue, index: s.index, time: this.time() });
  }
  async restoreSession() {
    const sess = await bridge.store.get<{ queue: string[]; index: number; time: number } | null>('session', null);
    const s = useStore.getState();
    if (!sess || !s.settings.resumeSession) return;
    const queue = sess.queue.filter((id) => s.tracks[id]);
    if (!queue.length) return;
    const index = Math.max(0, queue.indexOf(sess.queue[sess.index]));
    // restore paused, so opening the app never surprises with sound
    await this.start(queue, index, { autoplay: false, startAt: sess.time });
    useStore.setState({ playing: false });
  }
}

export const controller = new Controller();
