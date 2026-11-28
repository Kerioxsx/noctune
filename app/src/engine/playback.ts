import { useStore, currentTrack, type RepeatMode, type ShuffleMode } from '../store';
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
    // switching to a video or a local file: Spotify must not keep playing underneath
    if (this.state.playing) void bridge.providers.remote({ op: 'pause' }).catch(() => undefined);
    this.state.playing = false;
  }
}

// ---------------------------------------------------------------- YouTube
class VideoBlocked extends Error {}

const YT_ORIGIN = 'https://www.youtube-nocookie.com';
const YT_ERRORS: Record<number, string> = {
  2: 'This YouTube link is not valid.',
  5: 'This video cannot play in an embedded player.',
  100: 'This video is unavailable.',
  101: 'The owner does not allow this video to play in other apps.',
  150: 'The owner does not allow this video to play in other apps.',
  153: 'YouTube refused to load the player here.',
};

/**
 * Official videos play inside YouTube's own embedded player, as its terms require.
 * YouTube's code stays inside its cross-origin iframe: no YouTube script runs in
 * the app's window. The player is driven through YouTube's documented postMessage
 * commands, and only messages from that iframe are accepted.
 */
/** YouTube's full page plays label videos that refuse to embed. Only the video is shown. */
const PAGE_CSS = `html,body{overflow:hidden!important;background:#000!important}
#movie_player{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;background:#000!important}
#movie_player video{width:100vw!important;height:100vh!important;left:0!important;top:0!important;object-fit:contain!important}
.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-pause-overlay,.ytp-ce-element,.ytp-watermark,.iv-branding,.ytp-paid-content-overlay,.ytp-cards-teaser,.ytp-cards-button,.ytp-endscreen-content,.ytp-autonav-endscreen-countdown-overlay,.ytp-spinner-message,.ytp-contextmenu,ytd-popup-container,tp-yt-iron-overlay-backdrop{display:none!important}`;
const PAGE_STATE = `(() => {
  const p = document.getElementById('movie_player');
  if (!p || typeof p.getPlayerState !== 'function') {
    const check = !!document.querySelector('#captcha-form, .g-recaptcha, iframe[src*="recaptcha"], form[action*="consent"]') || /unusual traffic|not a robot/i.test(document.body ? document.body.innerText.slice(0, 2000) : '');
    return check ? { check: true } : null;
  }
  const r = p.getPlayerResponse ? p.getPlayerResponse() : null;
  const ps = r && r.playabilityStatus;
  return { s: p.getPlayerState(), t: p.getCurrentTime(), d: p.getDuration(), loaded: p.getVideoLoadedFraction ? p.getVideoLoadedFraction() : 0,
    ad: p.classList.contains('ad-showing'), id: r && r.videoDetails ? r.videoDetails.videoId : '', status: ps ? ps.status : 'OK', reason: ps ? (ps.reason || '') : '' };
})()`;
type PageState = { check?: boolean; s: number; t: number; d: number; loaded: number; ad: boolean; id: string; status: string; reason: string };
type Webview = HTMLElement & { executeJavaScript(code: string): Promise<unknown>; insertCSS(css: string): Promise<string>; getURL(): string; src: string };
/** Errors that mean "not allowed in an embedded player": the full page can still play these. */
const EMBED_REFUSED = new Set([5, 101, 150, 152, 153]);

/**
 * Official videos. First YouTube's embedded player (light, no sign-in needed); when the
 * video's owner refuses embedding, YouTube's own watch page, shown with only the video
 * visible. Both run in YouTube's own sandboxed context, never in the app's window, and
 * are driven only through YouTube's player functions. Lyrics and controls draw on top.
 */
class YouTubeBackend implements Backend {
  kind = 'youtube' as const;
  caps: Capabilities = { seek: true, volume: true, eq: false, repeatOne: true, video: true };
  host: HTMLDivElement;
  private frame: HTMLIFrameElement | null = null;
  private view: Webview | null = null;
  private mode: 'embed' | 'page' = 'embed';
  private track: LibraryTrack | null = null;
  private wantPlay = false;
  private vol = { v: 1, muted: false };
  private poll: number | undefined;
  private info = { currentTime: 0, duration: 0, loaded: 0, at: performance.now(), state: -1 };
  private onMsg = (e: MessageEvent) => this.handle(e);

  constructor() {
    this.host = document.createElement('div');
    this.host.className = 'yt-host';
    window.addEventListener('message', this.onMsg);
  }

  private send(func: string, args: unknown[] = []) {
    if (this.mode === 'page') {
      const v = this.view;
      const code = `(() => { const p = document.getElementById('movie_player'); if (p && typeof p[${JSON.stringify(func)}] === 'function') p[${JSON.stringify(func)}](...${JSON.stringify(args)}); })()`;
      void v?.executeJavaScript(code).catch(() => undefined);
      return;
    }
    this.frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), YT_ORIGIN);
  }

  private ready: { res: () => void; rej: (e: Error) => void } | null = null;

  private handle(e: MessageEvent) {
    if (this.mode !== 'embed' || e.origin !== YT_ORIGIN || !this.frame || e.source !== this.frame.contentWindow) return;
    let d: { event?: string; info?: unknown };
    try {
      d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (d.event === 'onReady' || d.event === 'initialDelivery') {
      this.ready?.res();
      this.ready = null;
    }
    if (d.event === 'infoDelivery' && d.info && typeof d.info === 'object') {
      const i = d.info as { currentTime?: number; duration?: number; videoLoadedFraction?: number; playerState?: number };
      if (typeof i.currentTime === 'number') {
        this.info.currentTime = i.currentTime;
        this.info.at = performance.now();
      }
      if (typeof i.duration === 'number' && i.duration > 0) this.info.duration = i.duration;
      if (typeof i.videoLoadedFraction === 'number') this.info.loaded = i.videoLoadedFraction;
      if (typeof i.playerState === 'number') this.state(i.playerState);
    }
    if (d.event === 'onStateChange' && typeof d.info === 'number') this.state(d.info);
    if (d.event === 'onError') {
      const code = Number(d.info);
      if (EMBED_REFUSED.has(code)) {
        // the owner only allows playback on YouTube itself: use YouTube's page
        this.ready?.res();
        this.ready = null;
        this.toPage();
        return;
      }
      const msg = YT_ERRORS[code] ?? 'The video could not be played.';
      if (this.ready) {
        this.ready.rej(new VideoBlocked(msg));
        this.ready = null;
      }
      controller.fail(msg, { video: true });
    }
  }

  private state(s: number) {
    // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    if (s === this.info.state) return;
    this.info.state = s;
    this.info.at = performance.now();
    if (s === 0) controller.handleEnded();
    useStore.setState({ playing: s === 1, buffering: s === 3 });
  }

  async load(t: LibraryTrack, autoplay: boolean, startAt: number) {
    if (!t.youtubeId || !/^[\w-]{11}$/.test(t.youtubeId)) throw new Error('No valid official video linked.');
    this.stop();
    this.track = t;
    this.wantPlay = autoplay;
    this.mode = 'embed';
    this.info = { currentTime: startAt, duration: t.duration ?? 0, loaded: 0, at: performance.now(), state: -1 };
    const f = document.createElement('iframe');
    const q = new URLSearchParams({ enablejsapi: '1', controls: '0', rel: '0', playsinline: '1', iv_load_policy: '3', autoplay: autoplay ? '1' : '0', start: String(Math.floor(startAt)) });
    f.src = `${YT_ORIGIN}/embed/${t.youtubeId}?${q}`;
    f.allow = 'autoplay; encrypted-media; fullscreen';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.title = 'YouTube video player';
    this.frame = f;
    this.host.replaceChildren(f);
    if (autoplay) {
      // Not really playing within 8 seconds (a silent refusal): try YouTube's page.
      window.setTimeout(() => {
        if (this.mode === 'embed' && this.frame === f && this.info.state !== 1 && this.info.state !== 2 && this.info.state !== 0) this.toPage();
      }, 8000);
    }
    try {
      await new Promise<void>((res, rej) => {
        this.ready = { res, rej };
        const listen = () => f.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN);
        f.addEventListener('load', () => {
          listen();
          let n = 0;
          const iv = window.setInterval(() => (this.ready && n++ < 10 ? listen() : clearInterval(iv)), 300);
        });
        window.setTimeout(() => {
          if (this.ready) {
            this.ready = null;
            rej(new Error('The embedded player did not respond.'));
          }
        }, 12000);
      });
    } catch (e) {
      if (e instanceof VideoBlocked) throw e;
      this.toPage(); // embedded player unreachable: the page may still work
      return;
    }
    if (!autoplay || this.mode !== 'embed') return;
    this.send('playVideo');
  }

  /** Switch the current video to YouTube's own page, at the same moment. */
  private toPage() {
    if (this.mode === 'page' || !this.track) return;
    const t = this.track;
    const at = this.time();
    const play = this.wantPlay || this.info.state === 1;
    this.frame = null;
    this.host.replaceChildren();
    this.mode = 'page';
    this.loadPage(t, play, at).catch((e) => {
      if (this.track === t) controller.fail((e as Error).message, { video: true });
    });
  }

  private loadPage(t: LibraryTrack, autoplay: boolean, startAt: number) {
    const v = document.createElement('webview') as Webview;
    v.setAttribute('partition', 'persist:youtube');
    v.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes');
    v.className = 'yt-page';
    v.src = `https://www.youtube.com/watch?v=${t.youtubeId}${startAt > 1 ? `&t=${Math.floor(startAt)}s` : ''}`;
    this.view = v;
    this.host.replaceChildren(v);
    this.info = { ...this.info, state: -1, at: performance.now() };
    useStore.setState({ buffering: true });
    // only YouTube's own page gets the video-only look; Google's check pages stay as they are
    v.addEventListener('dom-ready', () => /^https:\/\/www\.youtube\.com\/watch/.test(v.getURL()) && void v.insertCSS(PAGE_CSS).catch(() => undefined));
    let check = false;
    v.addEventListener('did-navigate', (e) => {
      const url = (e as Event & { url: string }).url;
      // YouTube can ask people to confirm they are not a robot, or to choose cookie settings:
      // let them do it right there, then carry on.
      check = /google\.[a-z.]+\/sorry|consent\.(youtube|google)\.|accounts\.google\./.test(url);
      this.host.classList.toggle('interactive', check);
      useStore.setState({ notice: check ? { text: 'YouTube wants a quick check before the video plays. Complete it on the video, then it starts.' } : null });
    });
    return new Promise<void>((resolve, reject) => {
      v.addEventListener('did-fail-load', (e) => {
        const f = e as Event & { errorCode: number; isMainFrame: boolean };
        if (!f.isMainFrame || f.errorCode === -3 || this.view !== v) return; // -3: replaced by a newer navigation
        clearInterval(this.poll);
        if (!started) reject(new VideoBlocked('YouTube could not be reached.'));
        else controller.fail('YouTube could not be reached.', { video: true });
      });
      let started = false;
      let unavailable = 0;
      const begin = performance.now();
      this.poll = window.setInterval(async () => {
        if (this.view !== v) return clearInterval(this.poll);
        const st = (await v.executeJavaScript(PAGE_STATE).catch(() => null)) as PageState | null;
        if (this.view !== v) return;
        if (st?.check) {
          // YouTube asks the person to prove they are not a robot (or to pick cookie settings)
          if (!check) {
            check = true;
            this.host.classList.add('interactive');
            useStore.setState({ buffering: false, notice: { text: 'YouTube wants a quick check before the video plays. Complete it on the video, then it starts.' } });
          }
          if (performance.now() - begin > 180_000) {
            clearInterval(this.poll);
            reject(new VideoBlocked('The YouTube check was not completed.'));
          }
          return;
        }
        if (check && st) {
          check = false;
          useStore.setState({ notice: null });
        }
        if (!st) {
          if (!check && performance.now() - begin > 25_000) {
            clearInterval(this.poll);
            reject(new VideoBlocked('YouTube did not load the video.'));
          }
          return;
        }
        if (st.status && st.status !== 'OK') {
          // give a just-navigated page a moment before trusting an error
          if (++unavailable >= 3) {
            clearInterval(this.poll);
            const msg = st.status === 'LOGIN_REQUIRED' ? 'YouTube asks to sign in for this video (Settings → Connections → YouTube).' : st.reason || 'This video is unavailable.';
            if (!started) reject(new VideoBlocked(msg));
            else controller.fail(msg, { video: true });
          }
          return;
        }
        if (!started) {
          started = true;
          if (autoplay) {
            // the page loaded but the video never really starts (and no ad is showing): use the audio
            const since = performance.now();
            const watch = window.setInterval(() => {
              if (this.view !== v) return clearInterval(watch);
              if (this.info.state === 1 || this.info.state === 0 || !this.wantPlay) return clearInterval(watch);
              if (!useStore.getState().adShowing && performance.now() - since > 20_000) {
                clearInterval(watch);
                controller.fail('The video did not start.', { video: true });
              }
            }, 1000);
          }
          this.send('setPlaybackQualityRange', ['highres', 'highres']);
          this.applyVol();
          if (autoplay) this.send('playVideo');
          else this.send('pauseVideo');
          resolve();
        }
        this.host.classList.toggle('interactive', check || st.ad); // an ad's own Skip button stays clickable
        useStore.setState({ adShowing: st.ad });
        if (st.ad) {
          // the song's clock waits while YouTube shows an ad
          this.info.at = performance.now();
          if (this.info.state === 1) this.info.state = 3;
          useStore.setState({ buffering: true, playing: false });
          return;
        }
        this.info.currentTime = st.t;
        this.info.at = performance.now();
        if (st.d > 0) this.info.duration = st.d;
        this.info.loaded = st.loaded;
        this.state(st.s);
      }, 400);
    });
  }

  private applyVol() {
    this.send('setVolume', [Math.round(this.vol.v * 100)]);
    this.send(this.vol.muted ? 'mute' : 'unMute');
  }
  play() {
    this.wantPlay = true;
    this.send('playVideo');
  }
  pause() {
    this.wantPlay = false;
    this.send('pauseVideo');
  }
  seek(t: number) {
    this.send('seekTo', [t, true]);
    this.info.currentTime = t;
    this.info.at = performance.now();
  }
  setVolume(v: number, muted: boolean) {
    this.vol = { v, muted };
    this.applyVol();
  }
  time() {
    const live = this.info.state === 1 ? (performance.now() - this.info.at) / 1000 : 0;
    return Math.min(this.info.currentTime + live, this.info.duration || Infinity);
  }
  duration() {
    return this.info.duration;
  }
  buffered() {
    return this.info.loaded * this.info.duration;
  }
  stop() {
    clearInterval(this.poll);
    this.ready = null;
    this.frame = null;
    this.view = null;
    this.track = null;
    this.mode = 'embed';
    this.host.classList.remove('interactive');
    this.host.replaceChildren();
    useStore.setState({ adShowing: false });
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

// --------------------------------------------- lyrics and videos, found online
const videoMemo = new Map<string, Promise<string | null>>();
const lyricsMemo = new Map<string, Promise<string | null>>();
const songQuery = (t: LibraryTrack) => ({ title: t.title, artist: t.artist, album: t.album, duration: t.duration });
const lookable = (t: LibraryTrack) => t.source !== 'demo' && !!t.title && !!t.artist && t.artist !== 'Unknown artist';

/** The song's official music video (YouTube id), looked up once per track and cached by the app. */
export function officialVideo(t: LibraryTrack): Promise<string | null> {
  if (!lookable(t)) return Promise.resolve(null);
  let p = videoMemo.get(t.id);
  if (!p) {
    p = bridge.video.lookup(songQuery(t)).catch(() => null);
    videoMemo.set(t.id, p);
  }
  return p;
}

/** Timed lyrics found online for the song, looked up once per track. */
export function onlineLyrics(t: LibraryTrack): Promise<string | null> {
  if (!lookable(t)) return Promise.resolve(null);
  let p = lyricsMemo.get(t.id);
  if (!p) {
    p = bridge.lyrics.lookup(songQuery(t)).catch(() => null);
    lyricsMemo.set(t.id, p);
  }
  return p;
}

/** Look up an album's videos and lyrics in the background so they are ready when it plays. */
export async function prefetchSongs(trackIds: string[]) {
  const st = useStore.getState();
  for (const id of trackIds.slice(0, 30)) {
    const t = st.tracks[id];
    if (!t) continue;
    if (st.settings.lyrics.community && !t.lyricsUrl && !t.embeddedLyrics) void onlineLyrics(t);
    if (st.settings.autoVideo && !t.youtubeId && !t.videoUrl) await officialVideo(t); // sequential: the main process paces requests
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

/** Fisher–Yates: every order equally likely. */
export function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------- controller
class Controller {
  media = new MediaBackend();
  youtube = new YouTubeBackend();
  private spotify = new SpotifyBackend();
  active: Backend = this.media;
  private loadToken = 0;
  /** what is actually playing for the current queue item (a fallback copy may stand in for it) */
  playing: LibraryTrack | null = null;
  private tried = new Set<string>();
  private recovering = false;
  private autoplayNext = true;

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
    const mode = useStore.getState().shuffle;
    if (mode !== 'off' && trackIds.length > 1) {
      // the chosen song first, the rest in random order
      useStore.setState({ baseQueue: trackIds, queue: [trackIds[index], ...shuffled(trackIds.filter((_, i) => i !== index))], index: 0 });
      await this.loadIndex(0, opts.autoplay ?? true, opts.startAt ?? 0);
      return;
    }
    useStore.setState({ queue: trackIds, index, baseQueue: null });
    await this.loadIndex(index, opts.autoplay ?? true, opts.startAt ?? 0);
  }

  private indexToken = 0;

  private async loadIndex(index: number, autoplay: boolean, startAt = 0) {
    const s = useStore.getState();
    let t = s.tracks[s.queue[index]];
    const mine = ++this.indexToken;
    this.tried = new Set();
    useStore.setState({ index, error: null, buffering: true, notice: null });
    if (!t) {
      this.fail('This track is no longer in your library.');
      return;
    }
    this.autoplayNext = autoplay;
    // Play the official music video when the song has one (a video file next to the song wins).
    if (s.settings.autoVideo && !t.youtubeId && !t.videoUrl && !t.isVideo) {
      const lookup = officialVideo(t);
      const id = await Promise.race([lookup, sleep(4000).then(() => null)]);
      if (mine !== this.indexToken) return; // the user moved on while we looked
      if (id) {
        t = { ...t, youtubeId: id };
        const st = useStore.getState();
        useStore.setState({ tracks: { ...st.tracks, [t.id]: t } });
      } else {
        // Slow lookup: start the song now, and switch to the video at the same moment if it turns up.
        const song = t;
        void lookup.then((late) => {
          if (!late || mine !== this.indexToken || (this.active.kind !== 'media' && this.active.kind !== 'spotify') || this.playing?.id !== song.id) return;
          const withVideo = { ...song, youtubeId: late };
          const st = useStore.getState();
          useStore.setState({ tracks: { ...st.tracks, [song.id]: withVideo } });
          void this.loadTrack(withVideo, st.playing, this.active.time());
        });
      }
    }
    if (!t.available && !t.youtubeId) {
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
  /** Switch shuffle without interrupting the song that is playing. */
  setShuffle(mode: ShuffleMode) {
    const s = useStore.getState();
    const cur = s.queue[s.index];
    if (mode === 'off') {
      const base = s.baseQueue ?? s.queue;
      const at = cur ? base.indexOf(cur) : -1;
      useStore.setState({ shuffle: mode, queue: base, index: at >= 0 ? at : s.index, baseQueue: null });
    } else if (s.shuffle === 'off' && s.queue.length > 1 && cur) {
      const rest = s.queue.filter((_, i) => i !== s.index);
      useStore.setState({ shuffle: mode, baseQueue: s.queue, queue: [cur, ...shuffled(rest)], index: 0 });
    } else {
      useStore.setState({ shuffle: mode });
    }
    if (s.settings.repeatPersist) s.updateSettings((x) => (x.shuffle = mode));
  }
  cycleShuffle() {
    const order: ShuffleMode[] = ['off', 'shuffle', 'magic'];
    const next = order[(order.indexOf(useStore.getState().shuffle) + 1) % 3];
    this.setShuffle(next);
    return next;
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
