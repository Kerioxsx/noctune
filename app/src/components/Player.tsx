import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore, currentTrack } from '../store';
import { controller, onlineLyrics } from '../engine/playback';
import { audio } from '../engine/audio';
import { bridge } from '../lib/bridge';
import { parseLrc, activeLine, type Lyrics } from '../lib/lrc';
import type { LibraryTrack } from '../lib/types';
import * as I from './Icons';

export const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${sec}`;
  return `${Math.floor(s / 60)}:${sec}`;
};

/** Playback clock: re-renders ~20×/s from the active backend's real position. */
export function usePlaybackClock(active = true) {
  const [t, setT] = useState({ time: 0, duration: 0, buffered: 0 });
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 50) return;
      last = now;
      setT({ time: controller.time(), duration: controller.duration(), buffered: controller.buffered() });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return t;
}

export function useLyrics(track: LibraryTrack | undefined): { lyrics: Lyrics | null; state: 'none' | 'loading' | 'ready' } {
  const community = useStore((s) => s.settings.lyrics.community);
  const [res, setRes] = useState<{ id?: string; lyrics: Lyrics | null; state: 'none' | 'loading' | 'ready' }>({ lyrics: null, state: 'none' });
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const h = () => setBump((b) => b + 1);
    window.addEventListener('noctune:lyrics-imported', h);
    return () => window.removeEventListener('noctune:lyrics-imported', h);
  }, []);
  useEffect(() => {
    if (!track) {
      setRes({ lyrics: null, state: 'none' });
      return;
    }
    let cancelled = false;
    setRes({ id: track.id, lyrics: null, state: 'loading' });
    (async () => {
      const imports = await bridge.store.get<Record<string, string>>('lyrics-imports', {});
      if (imports[track.id]) return parseLrc(imports[track.id], 'Imported file');
      if (track.lyricsUrl) {
        try {
          const r = await fetch(track.lyricsUrl);
          if (r.ok) return parseLrc(await r.text(), track.source === 'demo' ? 'Demo lyrics' : 'Lyrics file');
        } catch {
          /* fall through */
        }
      }
      if (track.embeddedLyrics) return parseLrc(track.embeddedLyrics, 'Embedded in file');
      if (community) {
        const txt = await onlineLyrics(track);
        if (txt) return parseLrc(txt, 'LRCLIB');
      }
      return null;
    })().then((lyrics) => {
      if (!cancelled) setRes({ id: track.id, lyrics, state: 'ready' });
    });
    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.lyricsUrl, community, bump]);
  return { lyrics: res.lyrics, state: res.state };
}

/**
 * Music videos often run longer than the song (an intro, a skit before the music).
 * Lyrics synced to the video's own length are used when they exist; otherwise the
 * lyrics wait out the extra time at the start. [ and ] still fine-tune it.
 */
function useVideoAlignment(track: LibraryTrack | undefined, isVideo: boolean, videoLength: number) {
  const [res, setRes] = useState<{ key: string; lyrics: Lyrics | null; shift: number } | null>(null);
  const song = track?.duration ?? 0;
  const len = Math.round(videoLength);
  const key = track && isVideo && song > 0 && len > 0 ? `${track.id}:${len}` : '';
  useEffect(() => {
    if (!key || !track) return;
    const extra = len - song;
    if (Math.abs(extra) <= 2.5) return setRes({ key, lyrics: null, shift: 0 });
    let gone = false;
    void bridge.lyrics
      .forLength({ title: track.title, artist: track.artist, album: track.album, duration: song }, len)
      .catch(() => null)
      .then((txt) => {
        if (gone) return;
        const own = txt ? parseLrc(txt, 'LRCLIB (video)') : null;
        setRes({ key, lyrics: own && own.synced ? own : null, shift: own ? 0 : extra > 2.5 && extra < 90 ? extra : 0 });
      });
    return () => {
      gone = true;
    };
  }, [key]);
  return res && res.key === key ? res : null;
}

function LyricsView({ lyrics, state, time, offset }: { lyrics: Lyrics | null; state: string; time: number; offset: number }) {
  const show = useStore((s) => s.settings.lyrics.show);
  const showNext = useStore((s) => s.settings.lyrics.showNext);
  if (!show) return null;
  if (state === 'loading') return null;
  if (!lyrics) return <div className="lyrics"><span className="note">No synced lyrics · import a .lrc from the track menu (O)</span></div>;
  if (!lyrics.synced) return <div className="lyrics"><span className="note">Lyrics are not time-synced ({lyrics.source})</span></div>;
  const t = time + offset;
  const lines = lyrics.lines;
  const i = activeLine(lines, t);
  const first = lines.find((l) => l.text)?.t ?? 0;
  // a long instrumental gap (or the intro) shows a filling beat instead of a stale line
  const cur = i >= 0 ? lines[i] : null;
  const nextT = lines[i + 1]?.t ?? (cur ? cur.t + 6 : first);
  const gapStart = cur ? cur.t : 0;
  const waiting = (!cur || !cur.text) && nextT - gapStart > 4;
  // lines on screen: the one just sung, the current one, and what comes next
  const shown: { k: number; role: 'past' | 'current' | 'next' | 'later' }[] = [];
  for (let k = Math.max(0, i - 1); k <= Math.min(lines.length - 1, i + 1); k++) {
    if (k < 0) continue;
    const role = k < i ? 'past' : k === i ? 'current' : k === i + 1 ? 'next' : 'later';
    if (role !== 'current' && !showNext && role !== 'past') continue;
    shown.push({ k, role });
  }
  if (i < 0) for (let k = 0; k < Math.min(2, lines.length); k++) if (showNext || k === 0) shown.push({ k, role: k === 0 ? 'next' : 'later' });
  const progress = (from: number, to: number) => Math.max(0, Math.min(1, (t - from) / Math.max(0.2, to - from)));
  return (
    <div className="lyrics" aria-live="polite">
      {waiting && (
        <div className="beat" style={{ ['--p' as string]: progress(gapStart, nextT) }} aria-hidden>
          <i /><i /><i />
        </div>
      )}
      <div className="lyric-stack">
        {shown.map(({ k, role }) => {
          const l = lines[k];
          if (!l.text) return null;
          const end = lines[k + 1]?.t ?? l.t + 5;
          return (
            <div key={k} className={`ly ${role}`} aria-hidden={role !== 'current'}>
              {role === 'current' && l.words ? (
                l.words.map((w, n) => {
                  const wEnd = l.words![n + 1]?.t ?? end;
                  return (
                    <span key={n} className="w" style={{ ['--p' as string]: progress(w.t, wEnd) }}>
                      {w.w}
                      {n < l.words!.length - 1 ? ' ' : ''}
                    </span>
                  );
                })
              ) : role === 'current' ? (
                <span className="w" style={{ ['--p' as string]: progress(l.t, Math.min(end, l.t + Math.max(1.5, l.text.length * 0.07))) }}>{l.text}</span>
              ) : (
                l.text
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Colour of an image (average of a small sample), for tinting the scene. */
function averageColor(img: HTMLImageElement): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  try {
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) (r += d[i]), (gr += d[i + 1]), (b += d[i + 2]);
    const n = d.length / 4;
    return [r / n, gr / n, b / n];
  } catch {
    return [60, 50, 40]; // artwork from another site without CORS: a warm neutral
  }
}

/**
 * The scene for songs without a video: the cover, blurred into a halftone backdrop,
 * a CD with the cover printed on it spinning while the song plays, and a ring of
 * light that moves with the music.
 */
function Visualizer({ track }: { track: LibraryTrack }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useStore((s) => s.settings.motion === 'reduced');
  const playingRef = useRef(false);
  playingRef.current = useStore((s) => s.playing);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    const W = (c.width = 1280), H = (c.height = 720);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let bg: HTMLCanvasElement | null = null;
    let tint: [number, number, number] = [70, 60, 45];
    const hueOf = [...(track.album || track.title)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
    const buildBg = () => {
      const b = document.createElement('canvas');
      b.width = W;
      b.height = H;
      const bg2 = b.getContext('2d')!;
      if (img.complete && img.naturalWidth) {
        tint = averageColor(img);
        bg2.filter = 'blur(38px) saturate(1.35) brightness(0.55)';
        bg2.drawImage(img, -80, -260, W + 160, W + 160);
        bg2.filter = 'none';
      } else {
        const gr = bg2.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.7);
        gr.addColorStop(0, `hsl(${hueOf} 45% 26%)`);
        gr.addColorStop(1, `hsl(${(hueOf + 40) % 360} 35% 7%)`);
        bg2.fillStyle = gr;
        bg2.fillRect(0, 0, W, H);
        tint = [180, 150, 110];
      }
      // halftone over the backdrop, in the app's print style
      const shade = bg2.getImageData(0, 0, W, H).data;
      bg2.fillStyle = 'rgba(5,5,4,0.55)';
      bg2.fillRect(0, 0, W, H);
      const cell = 10;
      for (let y = cell / 2; y < H; y += cell)
        for (let x = cell / 2; x < W; x += cell) {
          const k = ((y | 0) * W + (x | 0)) * 4;
          const lum = (shade[k] * 0.3 + shade[k + 1] * 0.59 + shade[k + 2] * 0.11) / 255;
          const r = lum * cell * 0.62;
          if (r < 0.4) continue;
          bg2.fillStyle = `rgba(${shade[k]},${shade[k + 1]},${shade[k + 2]},0.9)`;
          bg2.beginPath();
          bg2.arc(x, y, r, 0, Math.PI * 2);
          bg2.fill();
        }
      const v = bg2.createRadialGradient(W / 2, H * 0.45, H * 0.2, W / 2, H / 2, W * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.75)');
      bg2.fillStyle = v;
      bg2.fillRect(0, 0, W, H);
      bg = b;
    };
    img.onload = buildBg;
    img.onerror = buildBg;
    if (track.artwork) img.src = track.artwork;
    else buildBg();

    const bins = new Uint8Array(128);
    let angle = 0;
    let last = performance.now();
    let level = 0;
    let raf = 0;
    const cx = W / 2, cy = H * 0.33, R = 128;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const playing = playingRef.current;
      // music level: the real spectrum for local files, a gentle stand-in otherwise
      let spectrum: number[] | null = null;
      if (audio.analyser && !reduced) {
        audio.analyser.getByteFrequencyData(bins);
        let sum = 0;
        for (let i = 2; i < 24; i++) sum += bins[i];
        const lv = sum / (22 * 255);
        if (lv > 0.01) {
          spectrum = Array.from(bins.slice(2, 98), (v) => v / 255);
          level += (lv - level) * 0.3;
        }
      }
      if (!spectrum) level += ((playing && !reduced ? 0.35 + 0.15 * Math.sin(now / 420) : 0.1) - level) * 0.05;
      if (playing && !reduced) angle += dt * 2.2; // about 21 turns a minute

      if (bg) g.drawImage(bg, 0, 0);
      else (g.fillStyle = '#050504'), g.fillRect(0, 0, W, H);

      // ring of light
      const bars = 96;
      const [tr, tg, tb] = tint;
      const glow = `rgb(${Math.min(255, tr + 110)},${Math.min(255, tg + 100)},${Math.min(255, tb + 80)})`;
      g.save();
      g.translate(cx, cy);
      g.strokeStyle = glow;
      g.lineCap = 'round';
      g.lineWidth = 3;
      for (let i = 0; i < bars; i++) {
        const v = spectrum ? spectrum[i % spectrum.length] : (0.5 + 0.5 * Math.sin(i * 0.7 + now / 300)) * level;
        const len = 5 + v * 34;
        const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
        g.globalAlpha = 0.35 + v * 0.6;
        g.beginPath();
        g.moveTo(Math.cos(a) * (R + 14), Math.sin(a) * (R + 14));
        g.lineTo(Math.cos(a) * (R + 14 + len), Math.sin(a) * (R + 14 + len));
        g.stroke();
      }
      g.restore();
      g.globalAlpha = 1;

      // the disc
      const pulse = 1 + level * 0.025;
      g.save();
      g.translate(cx, cy);
      g.scale(pulse, pulse);
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 40;
      g.shadowOffsetY = 16;
      g.beginPath();
      g.arc(0, 0, R, 0, Math.PI * 2);
      g.fillStyle = '#c9c6bd';
      g.fill();
      g.shadowColor = 'transparent';
      g.rotate(angle);
      g.save();
      g.beginPath();
      g.arc(0, 0, R - 3, 0, Math.PI * 2);
      g.clip();
      if (img.complete && img.naturalWidth) g.drawImage(img, -R, -R, R * 2, R * 2);
      else {
        g.fillStyle = `hsl(${hueOf} 40% 40%)`;
        g.fillRect(-R, -R, R * 2, R * 2);
        g.fillStyle = 'rgba(236,230,207,0.9)';
        g.font = '600 26px "Barlow Condensed", sans-serif';
        g.textAlign = 'center';
        g.fillText((track.album || track.title).toUpperCase().slice(0, 22), 0, -R * 0.45);
      }
      // grooves and the shine of a pressed disc
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.lineWidth = 1;
      for (let r = 60; r < R; r += 6) {
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      g.rotate(-angle); // the light stays still while the disc turns
      const shine = g.createConicGradient(-0.6, 0, 0);
      shine.addColorStop(0, 'rgba(255,255,255,0)');
      shine.addColorStop(0.08, 'rgba(255,255,255,0.22)');
      shine.addColorStop(0.16, 'rgba(255,255,255,0)');
      shine.addColorStop(0.5, 'rgba(255,255,255,0)');
      shine.addColorStop(0.58, 'rgba(255,255,255,0.14)');
      shine.addColorStop(0.66, 'rgba(255,255,255,0)');
      g.fillStyle = shine;
      g.beginPath();
      g.arc(0, 0, R - 3, 0, Math.PI * 2);
      g.fill();
      // clear hub and centre hole
      g.beginPath();
      g.arc(0, 0, 46, 0, Math.PI * 2);
      g.fillStyle = 'rgba(220,220,215,0.55)';
      g.fill();
      g.beginPath();
      g.arc(0, 0, 16, 0, Math.PI * 2);
      g.fillStyle = '#0b0b0a';
      g.fill();
      g.restore();

    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [track.id, track.artwork, reduced]);
  return <canvas className="visualizer" ref={ref} aria-hidden />;
}

export function TimelineBar({ time, duration, buffered, canSeek }: { time: number; duration: number; buffered: number; canSeek: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const [dragT, setDragT] = useState<number | null>(null);
  const toTime = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };
  const shown = dragT ?? time;
  const p = duration ? (shown / duration) * 100 : 0;
  const b = duration ? Math.min(100, (buffered / duration) * 100) : 0;
  return (
    <div className="timeline">
      <span>{fmt(shown)}</span>
      <div
        ref={bar}
        className={`track-bar${dragT !== null ? ' dragging' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${fmt(shown)} of ${fmt(duration)}`}
        aria-disabled={!canSeek}
        onPointerDown={(e) => {
          if (!canSeek || !duration) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setDragT(toTime(e.clientX));
        }}
        onPointerMove={(e) => dragT !== null && setDragT(toTime(e.clientX))}
        onPointerUp={(e) => {
          if (dragT === null) return;
          controller.seek(toTime(e.clientX));
          setDragT(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            controller.seekBy(e.key === 'ArrowLeft' ? -5 : 5);
          }
        }}
      >
        <div className="rail" />
        <div className="buf" style={{ width: `${b}%` }} />
        <div className="fill" style={{ width: `${p}%` }} />
        <div className="knob" style={{ left: `${p}%` }} />
      </div>
      <span>{fmt(duration)}</span>
    </div>
  );
}

export function Player({ visible, onBack, onQueue, onMenu, fullscreen }: { visible: boolean; onBack: () => void; onQueue: () => void; onMenu: () => void; fullscreen: boolean }) {
  const track = useStore(currentTrack);
  const playing = useStore((s) => s.playing);
  const buffering = useStore((s) => s.buffering);
  const error = useStore((s) => s.error);
  const notice = useStore((s) => s.notice);
  const adShowing = useStore((s) => s.adShowing);
  const shuffle = useStore((s) => s.shuffle);
  const repeat = useStore((s) => s.repeat);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const clock = usePlaybackClock(visible);
  const { lyrics, state } = useLyrics(track);
  const mediaHost = useRef<HTMLDivElement>(null);
  const ytHost = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number>();

  useEffect(() => {
    mediaHost.current?.appendChild(controller.media.el);
    ytHost.current?.appendChild(controller.youtube.host);
  }, []);

  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2600);
  }, []);
  useEffect(() => {
    if (!visible) return;
    wake();
    const h = () => wake();
    window.addEventListener('pointermove', h);
    window.addEventListener('keydown', h);
    window.addEventListener('pointerdown', h);
    return () => {
      window.removeEventListener('pointermove', h);
      window.removeEventListener('keydown', h);
      window.removeEventListener('pointerdown', h);
      clearTimeout(idleTimer.current);
    };
  }, [visible, wake]);

  const caps = controller.caps;
  const kind = controller.active.kind;
  const hasVideo = !!track && (kind === 'youtube' || (kind === 'media' && (!!track.videoUrl || !!track.isVideo)));
  controller.media.el.classList.toggle('audio-only', !(kind === 'media' && hasVideo));
  const align = useVideoAlignment(track, kind === 'youtube', kind === 'youtube' ? clock.duration : 0);
  const offset = (track ? settings.lyrics.offsets[track.id] ?? 0 : 0) - (align?.shift ?? 0);
  const vol = settings.muted ? 0 : settings.volume;
  const setVol = (v: number) => {
    updateSettings((s) => {
      s.volume = v;
      s.muted = v === 0;
    });
    queueMicrotask(() => controller.applyVolume());
  };

  return (
    <div className={`player${idle && playing && !error ? ' idle' : ''}`} style={{ visibility: visible ? 'visible' : 'hidden', ['--lyric-bg' as string]: settings.lyrics.backdrop, ['--lyric-size' as string]: settings.lyrics.size }} aria-hidden={!visible}>
      <div className="media-host" ref={mediaHost} style={{ display: kind === 'media' ? undefined : 'none' }} />
      <div className="yt-host-wrap" ref={ytHost} style={{ display: kind === 'youtube' ? undefined : 'none' }} />
      {track && !hasVideo && <Visualizer track={track} />}
      <div className="top-line">
        <span>{track ? `${track.album} · ${(controller.playing ?? track).source === 'demo' ? 'demo' : (controller.playing ?? track).source}` : ''}</span>
        <span>{adShowing ? 'YouTube ad · the song starts after it' : buffering ? 'Buffering…' : kind === 'spotify' ? 'Playing on Spotify Connect' : kind === 'youtube' ? 'Official video · YouTube player' : hasVideo ? 'Video' : 'Audio'}</span>
      </div>
      {adShowing && kind === 'youtube' && <span className="ad-badge" aria-hidden>AD</span>}
      {notice && !error && (
        <div className="player-notice ui-text" role="status">
          {notice.text}
          {notice.url && <button onClick={() => void bridge.openExternal(notice.url!)}>{notice.link ?? 'Open'}</button>}
        </div>
      )}
      {visible && track && <LyricsView lyrics={align?.lyrics ?? lyrics} state={state} time={clock.time} offset={offset} />}
      {error && (
        <div className="player-error" role="alert">
          {error}
          <div>
            <button onClick={() => controller.next()}>Skip to next track</button>
            <button onClick={onBack}>Back to library</button>
          </div>
        </div>
      )}
      <div className="controls ui-text" onPointerDown={(e) => e.stopPropagation()}>
        <TimelineBar time={clock.time} duration={clock.duration} buffered={clock.buffered} canSeek={caps.seek} />
        <div className="ctl-row">
          <button className="ctl" onClick={onBack} aria-label="Back to library" title="Back to library (Esc)"><I.Home /></button>
          <div className="meta">
            <b>{track?.title ?? 'Nothing playing'}</b>
            <span>{track ? `${track.artist}${offset ? ` · lyrics ${offset > 0 ? '+' : ''}${offset.toFixed(1)}s` : ''}` : ''}</span>
          </div>
          <button className="ctl" onClick={() => controller.prev()} aria-label="Previous track" title="Previous (P)"><I.Prev /></button>
          <button className="ctl" onClick={() => controller.seekBy(-10)} disabled={!caps.seek} aria-label="Back 10 seconds" title="Back 10s (J)"><I.Back10 /></button>
          <button className="ctl big" onClick={() => controller.toggle()} aria-label={playing ? 'Pause' : 'Play'} title="Play/Pause (Space)">{playing ? <I.Pause /> : <I.Play />}</button>
          <button className="ctl" onClick={() => controller.seekBy(10)} disabled={!caps.seek} aria-label="Forward 10 seconds" title="Forward 10s (L)"><I.Fwd10 /></button>
          <button className="ctl" onClick={() => controller.next()} aria-label="Next track" title="Next (N)"><I.Next /></button>
          <button
            className="ctl"
            onClick={() => controller.cycleRepeat()}
            aria-pressed={repeat !== 'off'}
            aria-label={`Repeat: ${repeat === 'off' ? 'off' : repeat === 'all' ? 'all' : 'one'}`}
            title={`Repeat ${repeat} (R)${!caps.repeatOne ? ' · repeat one unavailable for this source' : ''}`}
          >
            <I.Repeat />
            {repeat === 'one' && <span className="badge">1</span>}
          </button>
          <button
            className="ctl"
            onClick={() => controller.cycleShuffle()}
            aria-pressed={shuffle !== 'off'}
            aria-label={`Shuffle: ${shuffle === 'off' ? 'off' : shuffle === 'shuffle' ? 'on' : 'magic'}`}
            title={shuffle === 'off' ? 'Shuffle off (H)' : shuffle === 'shuffle' ? 'Shuffle: random order (H)' : 'Magic shuffle: with songs you may like (H)'}
          >
            {shuffle === 'magic' ? <I.Sparkle /> : <I.Shuffle />}
          </button>
          <button className="ctl" onClick={() => updateSettings((s) => (s.lyrics.show = !s.lyrics.show))} aria-pressed={settings.lyrics.show} aria-label="Show lyrics" title="Lyrics"><I.Lyrics /></button>
          <button className="ctl" onClick={onQueue} aria-label="Queue" title="Queue (I)"><I.List /></button>
          <div className="vol">
            <button className="ctl" onClick={() => { updateSettings((s) => (s.muted = !s.muted)); queueMicrotask(() => controller.applyVolume()); }} aria-label={settings.muted ? 'Unmute' : 'Mute'} title="Mute (0)">
              <I.Volume level={vol === 0 ? 0 : vol < 0.5 ? 0.4 : 1} />
            </button>
            <input type="range" min={0} max={100} step={1} value={Math.round(vol * 100)} aria-label="Volume" disabled={!caps.volume} style={{ ['--p' as string]: `${vol * 100}%` }} onChange={(e) => setVol(Number(e.target.value) / 100)} />
            <output>{Math.round(vol * 100)}</output>
          </div>
          <button className="ctl" onClick={onMenu} aria-label="Track options" title="Options (O)"><I.Square /></button>
          <button className="ctl" onClick={() => void bridge.window.toggleFullscreen()} aria-pressed={fullscreen} aria-label="Full screen" title="Full screen (F)"><I.Fullscreen /></button>
        </div>
      </div>
    </div>
  );
}
