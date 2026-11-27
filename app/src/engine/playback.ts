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
      const msg = code === 4 ? 'This file format is not supported on this system.' : code === 2 ? 'The file could not be read. It may have moved or the network dropped.' : 'Playback failed.';
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
      if ((e as Error).name !== 'AbortError') controller.fail('Playback was blocked. Press play to start.');
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

  async load(t: LibraryTrack, autoplay: boolean, startAt: number) {
    if (!t.providerUri) throw new Error('This Spotify item has no playable reference.');
    this.uri = t.providerUri;
    this.state = { active: true, playing: autoplay, positionMs: startAt * 1000, durationMs: (t.duration ?? 0) * 1000 };
    this.at = performance.now();
    if (autoplay) await bridge.providers.remote({ op: 'play', uris: [t.providerUri], positionMs: Math.round(startAt * 1000) });
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
      if (!s.active) controller.fail('No active Spotify device. Open Spotify, then press play.');
    } catch (e) {
      controller.fail((e as Error).message);
    }
  }
  async play() {
    await bridge.providers.remote({ op: 'resume' }).catch((e) => controller.fail((e as Error).message));
    this.state.playing = true;
    this.at = performance.now();
  }
  pause() {
    this.state.positionMs = this.time() * 1000;
    this.state.playing = false;
    void bridge.providers.remote({ op: 'pause' }).catch((e) => controller.fail((e as Error).message));
  }
  seek(t: number) {
    this.state.positionMs = t * 1000;
    this.at = performance.now();
    void bridge.providers.remote({ op: 'seek', ms: t * 1000 }).catch((e) => controller.fail((e as Error).message));
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
            controller.fail(msg);
            rej(new Error(msg));
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

// ------------------------------------------------------------- controller
class Controller {
  media = new MediaBackend();
  youtube = new YouTubeBackend();
  private spotify = new SpotifyBackend();
  active: Backend = this.media;
  private loadToken = 0;

  backendFor(t: LibraryTrack): Backend {
    if (t.youtubeId) return this.youtube;
    if (t.source === 'spotify') return this.spotify;
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
    const token = ++this.loadToken;
    useStore.setState({ index, error: null, buffering: true });
    if (!t || !t.available) {
      this.fail(t ? `“${t.title}” is unavailable from ${t.source}.` : 'This track is no longer in your library.');
      return;
    }
    const next = this.backendFor(t);
    if (next !== this.active) this.active.stop();
    this.active = next;
    this.applyVolume();
    try {
      await next.load(t, autoplay, startAt);
      if (token !== this.loadToken) return;
      this.applyVolume();
      this.updateMediaSession(t);
      // keep the provider's own repeat in sync where it owns the queue
      if (next.kind === 'spotify') void bridge.providers.remote({ op: 'repeat', mode: s.repeat === 'one' ? 'track' : 'off' }).catch(() => undefined);
    } catch (e) {
      if (token === this.loadToken) this.fail((e as Error).message);
    }
  }

  fail(msg: string) {
    useStore.setState({ error: msg, buffering: false, playing: false });
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
