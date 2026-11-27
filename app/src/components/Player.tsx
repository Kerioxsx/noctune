import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore, currentTrack } from '../store';
import { controller } from '../engine/playback';
import { audio } from '../engine/audio';
import { bridge } from '../lib/bridge';
import { parseLrc, activeLine, type Lyrics } from '../lib/lrc';
import type { LibraryTrack } from '../lib/types';
import * as I from './Icons';

export const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
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
        const txt = await bridge.lyrics.lookup({ title: track.title, artist: track.artist, album: track.album, duration: track.duration });
        if (txt) return parseLrc(txt, 'LRCLIB (community)');
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

function LyricsView({ lyrics, state, time, offset }: { lyrics: Lyrics | null; state: string; time: number; offset: number }) {
  const show = useStore((s) => s.settings.lyrics.show);
  const showNext = useStore((s) => s.settings.lyrics.showNext);
  if (!show) return null;
  if (state === 'loading') return null;
  if (!lyrics) return <div className="lyrics"><span className="note">No synced lyrics · import a .lrc from the track menu (O)</span></div>;
  if (!lyrics.synced) return <div className="lyrics"><span className="note">Lyrics are not time-synced ({lyrics.source})</span></div>;
  const t = time + offset;
  const i = activeLine(lyrics.lines, t);
  const line = i >= 0 ? lyrics.lines[i] : null;
  const next = lyrics.lines[i + 1];
  return (
    <div className="lyrics" aria-live="polite">
      {line && line.text ? (
        <div key={`${i}-${line.t}`} className="line enter">
          {line.words
            ? line.words.map((w, k) => (
                <span key={k} className={`w${t >= w.t ? ' on' : ''}`}>
                  {w.w}
                  {k < line.words!.length - 1 ? ' ' : ''}
                </span>
              ))
            : line.text}
        </div>
      ) : null}
      {showNext && next && next.text && <div className="nextline">{next.text}</div>}
    </div>
  );
}

/** Restrained audio-reactive fallback when a track has no video: cover art, slow halftone pulse. */
function Visualizer({ track }: { track: LibraryTrack }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useStore((s) => s.settings.motion === 'reduced');
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    const img = new Image();
    if (track.artwork) img.src = track.artwork;
    let raf = 0;
    const bins = new Uint8Array(128);
    const W = (c.width = 1280), H = (c.height = 720);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      let level = 0.2;
      if (audio.analyser && !reduced) {
        audio.analyser.getByteFrequencyData(bins);
        let sum = 0;
        for (let i = 2; i < 40; i++) sum += bins[i];
        level = sum / (38 * 255);
      }
      g.fillStyle = '#050504';
      g.fillRect(0, 0, W, H);
      // dot field that breathes with the low end
      g.fillStyle = 'rgba(242,184,75,0.16)';
      const cell = 18;
      for (let y = cell / 2; y < H; y += cell) {
        for (let x = cell / 2; x < W; x += cell) {
          const d = Math.hypot(x - W / 2, y - H / 2) / (W / 2);
          const r = Math.max(0, (1 - d) * (2 + level * 7));
          if (r < 0.3) continue;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      const s = 360 + level * 16;
      if (img.complete && img.naturalWidth) {
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.7)';
        g.shadowBlur = 30;
        g.shadowOffsetY = 12;
        g.drawImage(img, W / 2 - s / 2, H / 2 - s / 2 - 50, s, s);
        g.restore();
      }
    };
    draw();
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
  const offset = track ? settings.lyrics.offsets[track.id] ?? 0 : 0;
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
        <span>{track ? `${track.album} · ${track.source === 'demo' ? 'demo' : track.source}` : ''}</span>
        <span>{buffering ? 'Buffering…' : kind === 'spotify' ? 'Playing on Spotify Connect' : kind === 'youtube' ? 'Official video · YouTube player' : hasVideo ? 'Video' : 'Audio'}</span>
      </div>
      {visible && track && <LyricsView lyrics={lyrics} state={state} time={clock.time} offset={offset} />}
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
