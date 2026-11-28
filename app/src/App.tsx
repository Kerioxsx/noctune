import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, stackItems, currentTrack, playlists, type Shelf, type StackItem } from './store';
import { useActions, useReducedMotion } from './engine/input';
import { play } from './engine/sound';
import { controller } from './engine/playback';
import { setUiSound } from './engine/sound';
import { audio } from './engine/audio';
import { bridge } from './lib/bridge';
import { Background, type Tones } from './components/Background';
import { chooseBackground } from './lib/background';
import { Effects } from './components/Effects';
import { AlbumStack, type DiscPhase } from './components/AlbumStack';
import { Status } from './components/Status';
import { Player } from './components/Player';
import { TrackList, Menu, type MenuItem, type Row } from './components/TrackList';
import { SettingsHub } from './components/Settings';
import { PlaylistEditor } from './components/PlaylistEditor';
import { Welcome } from './components/Welcome';
import { isDesktop } from './lib/bridge';
import { Cross, Circle, Triangle, Square } from './components/Icons';

const STAGE_W = 1280;
const STAGE_H = 720;

/** Scale the fixed 16:9 stage to the window, letterboxing instead of stretching. */
function useStageScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

export function App() {
  const scale = useStageScale();
  const reduced = useReducedMotion();
  const s = useStore();
  const { screen, shelf, sel, settings } = s;
  const items = useMemo(() => stackItems(s, shelf), [s.albums, s.playlists, s.providerPlaylists, s.settings.showDemo, s.settings.sort, shelf, s.tracks]);
  const selIndex = Math.min(sel[shelf], Math.max(0, items.length - 1));
  const front: StackItem | undefined = items[selIndex];
  const nowTrack = currentTrack(s);
  const [glitch, setGlitch] = useState(false);
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [welcome, setWelcome] = useState(false);
  // first launch of the desktop app: explain how to get your own music in
  useEffect(() => {
    if (s.ready && isDesktop && !s.settings.onboarded) setWelcome(true);
  }, [s.ready]);
  const closeWelcome = () => {
    setWelcome(false);
    if (!useStore.getState().settings.onboarded) s.updateSettings((x) => (x.onboarded = true));
  };
  const [tones, setTones] = useState<Tones>({ status: 'dark', hud: 'dark', prompt: 'dark', mini: 'dark' });
  const launchTimer = useRef<number[]>([]);

  // -------------------------------------------------- global side effects
  useEffect(() => bridge.window.onFullscreen(setFullscreen), []);
  useEffect(() => {
    const quiet = settings.sound.quietDuringPlayback && s.playing ? 0.5 : 1;
    setUiSound(settings.sound.enabled, settings.sound.volume * quiet);
  }, [settings.sound, s.playing]);
  useEffect(() => {
    audio.setEq(settings.eq.enabled, settings.eq.preamp, settings.eq.gains);
  }, [settings.eq]);
  useEffect(() => {
    const iv = window.setInterval(() => controller.saveSession(), 5000);
    const save = () => controller.saveSession();
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(iv);
      window.removeEventListener('beforeunload', save);
    };
  }, []);

  const anim = reduced ? 0.01 : 1 / settings.animation;
  const fxOn = settings.effects.enabled;

  const doGlitch = useCallback(() => {
    if (!fxOn || !settings.effects.glitches || reduced) return;
    setGlitch(true);
    window.setTimeout(() => setGlitch(false), 360);
  }, [fxOn, settings.effects.glitches, reduced]);

  const go = (screenNext: typeof screen) => useStore.setState({ screen: screenNext });
  const setSel = (i: number) => useStore.setState({ sel: { ...sel, [shelf]: i }, trackList: { open: false, index: 0 } });

  // --------------------------------------------------------- navigation
  const step = (d: 1 | -1) => {
    if (!items.length) return;
    setSel((selIndex + d + items.length) % items.length);
    play('tick');
  };
  const switchShelf = (to?: Shelf) => {
    const next = to ?? (shelf === 'albums' ? 'playlists' : 'albums');
    if (next === shelf) return;
    useStore.setState({ shelf: next, trackList: { open: false, index: 0 } });
    play('tab');
    doGlitch();
  };

  const rowsFor = (it: StackItem | undefined): Row[] => {
    if (!it) return [];
    if (it.kind === 'playlist') {
      const p = [...s.playlists, ...s.providerPlaylists].find((x) => x.id === it.id);
      return p ? p.entries.map((e) => ({ key: e.key, trackId: e.trackId, fallbackTitle: e.title, fallbackArtist: e.artist })) : [];
    }
    return it.trackIds.map((id) => ({ key: id, trackId: id }));
  };

  const openItem = async () => {
    if (!front) return;
    if (front.kind === 'new') {
      const p = playlists.create();
      play('confirm');
      useStore.setState({ editing: p.id, sel: { ...sel, playlists: 1 } });
      return;
    }
    if (front.kind === 'playlist' && front.id.startsWith('spotify-playlist:')) {
      // provider playlists load their track list on demand
      const p = s.providerPlaylists.find((x) => x.id === front.id);
      if (p && !p.entries.length) {
        try {
          const ts = await bridge.providers.playlistTracks(front.id);
          const tracks = { ...useStore.getState().tracks };
          ts.forEach((t) => (tracks[t.id] = t));
          useStore.setState({
            tracks,
            providerPlaylists: useStore.getState().providerPlaylists.map((x) => (x.id === front.id ? { ...x, entries: ts.map((t, i) => ({ key: `${t.id}:${i}`, trackId: t.id, addedAt: 0, title: t.title, artist: t.artist })) } : x)),
          });
        } catch (e) {
          s.notify((e as Error).message, 'error');
        }
      }
    }
    play('open');
    go('confirm');
  };

  const launch = (trackIds: string[], index: number) => {
    const playable = trackIds.length > 0;
    if (!playable) {
      play('error');
      s.notify('Nothing to play here yet. Add tracks from an album’s options (□).', 'error');
      return;
    }
    play('confirm');
    launchTimer.current.forEach(clearTimeout);
    useStore.setState({ trackList: { open: false, index: 0 }, launchFrom: { trackIds, index } });
    // Playback starts immediately; the sequence below never delays it.
    void controller.start(trackIds, index, { autoplay: true });
    const t = reduced ? 0.25 : settings.animation;
    go('launch');
    doGlitch();
    launchTimer.current = [
      window.setTimeout(() => {
        go('loading');
        doGlitch();
      }, 1100 * t),
      window.setTimeout(() => waitForPlayback(), 1900 * t),
    ];
  };

  const waitForPlayback = () => {
    const started = performance.now();
    const check = () => {
      const st = useStore.getState();
      if (st.screen !== 'loading') return;
      const ready = st.playing || controller.time() > 0.05;
      if (ready || st.error) {
        go('player');
        doGlitch();
        return;
      }
      if (performance.now() - started > 12000) {
        controller.fail('This is taking longer than expected. The file may be large or the network slow.');
        go('player');
        return;
      }
      launchTimer.current.push(window.setTimeout(check, 120));
    };
    check();
  };

  const backToLibrary = () => {
    launchTimer.current.forEach(clearTimeout);
    play('back');
    useStore.setState({ screen: 'library', trackList: { open: false, index: 0 } });
    doGlitch();
  };

  const showMenu = (list: MenuItem[], x = 640, y = 260) => setMenu({ items: list, x, y });

  const trackMenu = (trackId: string, playlistId?: string, entryKey?: string): MenuItem[] => {
    const t = s.tracks[trackId];
    const editable = s.playlists;
    const list: MenuItem[] = [{ label: t ? `${t.title} — ${t.artist}` : 'Track', heading: true }];
    list.push({ label: 'Play next', run: () => {
      const st = useStore.getState();
      if (st.index < 0) return void controller.start([trackId], 0);
      const q = [...st.queue];
      q.splice(st.index + 1, 0, trackId);
      useStore.setState({ queue: q });
      st.notify('Queued to play next.');
    } });
    if (editable.length) list.push({ label: 'Add to playlist', heading: true }, ...editable.filter((p) => p.id !== playlistId).slice(0, 6).map((p) => ({ label: `  ${p.title}`, run: () => { playlists.addTracks(p.id, [trackId]); s.notify(`Added to “${p.title}”.`); } })));
    list.push({ label: 'Add to new playlist', run: () => { const p = playlists.create(t ? `${t.title} mix` : 'New playlist', [trackId]); s.notify(`Created “${p.title}”.`); } });
    if (playlistId && entryKey && s.playlists.some((p) => p.id === playlistId)) list.push({ label: 'Remove from this playlist', run: () => playlists.removeEntry(playlistId, entryKey) });
    list.push({ separator: true, label: '' });
    list.push({ label: 'Import timed lyrics (.lrc)…', run: async () => {
      const f = await bridge.pickLyrics();
      if (!f) return;
      const imports = await bridge.store.get<Record<string, string>>('lyrics-imports', {});
      imports[trackId] = f.text;
      await bridge.store.set('lyrics-imports', imports);
      window.dispatchEvent(new Event('noctune:lyrics-imported'));
      s.notify(`Lyrics from ${f.name} linked to this track.`);
    } });
    list.push({ label: t?.youtubeId ? 'Change official video link…' : 'Link official video (YouTube)…', run: () => {
      const url = prompt('Paste the official YouTube video link for this track. Only link videos published by the artist or label.', t?.youtubeId ? `https://youtu.be/${t.youtubeId}` : '');
      if (url === null) return;
      const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(url) ?? (/^[\w-]{11}$/.test(url.trim()) ? [url, url.trim()] : null);
      s.updateSettings((x) => {
        if (!url.trim()) delete x.videoLinks[trackId];
        else if (m) x.videoLinks[trackId] = m[1];
      });
      const st = useStore.getState();
      const tr = st.tracks[trackId];
      if (tr) useStore.setState({ tracks: { ...st.tracks, [trackId]: { ...tr, youtubeId: url.trim() && m ? m[1] : undefined } } });
      if (url.trim() && !m) s.notify('That does not look like a YouTube link.', 'error');
    } });
    if (t?.source === 'local') list.push({ label: 'Link a local video file…', run: async () => {
      const v = await bridge.pickVideo();
      if (!v) return;
      await bridge.library.setOverride(trackId, { videoUrl: v });
      const st = useStore.getState();
      useStore.setState({ tracks: { ...st.tracks, [trackId]: { ...st.tracks[trackId], videoUrl: v } } });
      s.notify('Video linked. Your original files were not changed.');
    } });
    if (t?.source === 'local') list.push({ label: 'Edit title / artist…', run: async () => {
      const title = prompt('Title', t.title);
      if (title === null) return;
      const artist = prompt('Artist', t.artist);
      if (artist === null) return;
      await bridge.library.setOverride(trackId, { title, artist });
      const st = useStore.getState();
      useStore.setState({ tracks: { ...st.tracks, [trackId]: { ...st.tracks[trackId], title, artist } } });
    } });
    if (t?.source === 'local') list.push({ label: 'Choose custom artwork…', run: async () => {
      const url = await bridge.pickImage();
      if (!url) return;
      await bridge.library.setOverride(trackId, { artwork: url });
      const st = useStore.getState();
      useStore.setState({ tracks: { ...st.tracks, [trackId]: { ...st.tracks[trackId], artwork: url } } });
    } });
    return list;
  };

  const itemMenu = (it: StackItem): MenuItem[] => {
    if (it.kind === 'new') return [{ label: 'Create playlist', run: () => void openItem() }, { label: 'Import playlist file…', run: async () => {
      const txt = await bridge.importFile();
      if (!txt) return;
      try {
        const p = playlists.import(txt);
        s.notify(`Imported “${p.title}”.`);
      } catch (e) {
        s.notify((e as Error).message, 'error');
      }
    } }];
    const own = s.playlists.find((p) => p.id === it.id);
    const bgItems: MenuItem[] = [
      { separator: true, label: '' },
      { label: 'Add your music…', run: () => setWelcome(true) },
      { label: 'Change background…', run: () => void chooseBackground() },
      ...(settings.background.kind === 'custom' ? [{ label: 'Use the city background', run: () => s.updateSettings((x) => (x.background.kind = 'city')) }] : []),
    ];
    const list: MenuItem[] = [{ label: it.title, heading: true }, { label: 'Play', run: () => launch(rowsFor(it).map((r) => r.trackId), 0) }, { label: 'Shuffle play', run: () => {
      const ids = rowsFor(it).map((r) => r.trackId);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      launch(ids, 0);
    } }, { label: 'Show tracks', run: () => useStore.setState({ trackList: { open: true, index: 0 } }) }];
    if (own) {
      list.push({ label: 'Edit details & cover…', run: () => useStore.setState({ editing: own.id }) });
      list.push({ label: 'Duplicate', run: () => playlists.duplicate(own.id) });
      list.push({ label: 'Export / share file…', run: async () => {
        if (await bridge.exportFile(`${own.title}.noctune.json`, playlists.serialize(own, s.tracks))) s.notify('Exported. Shared files hold references, not media.');
      } });
      list.push({ label: 'Delete playlist', run: () => confirm(`Delete “${own.title}”?`) && playlists.remove(own.id) });
    } else if (it.kind === 'playlist') {
      list.push({ label: 'Save a copy you can edit', run: () => playlists.duplicate(it.id) });
    } else {
      list.push({ label: 'Save album as playlist', run: () => { const p = playlists.create(it.title, it.trackIds); s.notify(`Created “${p.title}”.`); } });
    }
    return [...list, ...bgItems];
  };

  // ----------------------------------------------------------- actions
  useActions((a) => {
    if (menu || s.editing || welcome) return false;
    // global
    if (a === 'fullscreen') return void bridge.window.toggleFullscreen();
    if (a === 'playPause') return void controller.toggle();
    if (a === 'next' && s.index >= 0) return void controller.next();
    if (a === 'prev' && s.index >= 0) return void controller.prev();
    if (a === 'mute') return void (s.updateSettings((x) => (x.muted = !x.muted)), queueMicrotask(() => controller.applyVolume()));
    if (a === 'volUp' || a === 'volDown') {
      s.updateSettings((x) => ((x.volume = Math.max(0, Math.min(1, x.volume + (a === 'volUp' ? 0.05 : -0.05)))), (x.muted = false)));
      queueMicrotask(() => controller.applyVolume());
      return;
    }
    if (a === 'repeat') {
      const m = controller.cycleRepeat();
      s.notify(`Repeat ${m === 'off' ? 'off' : m === 'all' ? 'all' : 'one'}`);
      return;
    }
    if (a === 'lyricsEarlier' || a === 'lyricsLater') {
      if (!nowTrack) return;
      const id = nowTrack.id;
      s.updateSettings((x) => (x.lyrics.offsets[id] = Math.round(((x.lyrics.offsets[id] ?? 0) + (a === 'lyricsLater' ? 0.1 : -0.1)) * 10) / 10));
      return;
    }
    if (a === 'settings' && screen !== 'settings') {
      play('confirm');
      useStore.setState({ screen: 'settings', returnTo: screen });
      return;
    }

    if (screen === 'library' || screen === 'confirm') {
      if (s.trackList.open) return false;
      if (a === 'up') return step(1); // up pulls the next sleeve forward from the stack
      if (a === 'down') return step(-1); // down sends it back
      if (screen === 'library') {
        if (a === 'left') return switchShelf('albums');
        if (a === 'right') return switchShelf('playlists');
        if (a === 'confirm') return void openItem();
        if (a === 'info') {
          if (!front || front.kind === 'new') return;
          play('tick');
          useStore.setState({ trackList: { open: true, index: 0 } });
          return;
        }
        if (a === 'options' && front) return showMenu(itemMenu(front));
        if (a === 'nowPlaying' && s.index >= 0) {
          play('confirm');
          go('player');
          return;
        }
        if (a === 'back') return void play('back');
      } else {
        if (a === 'confirm' && front) return launch(rowsFor(front).map((r) => r.trackId), 0);
        if (a === 'back') {
          play('back');
          go('library');
          return;
        }
        if (a === 'info') {
          play('tick');
          useStore.setState({ trackList: { open: true, index: 0 } });
          return;
        }
        if (a === 'options' && front) return showMenu(itemMenu(front));
      }
      return;
    }
    if (screen === 'player') {
      if (a === 'back') return backToLibrary();
      if (a === 'seekFwd' || a === 'right') return void controller.seekBy(10);
      if (a === 'seekBack' || a === 'left') return void controller.seekBy(-10);
      if (a === 'confirm') return void controller.toggle();
      if (a === 'up' || a === 'down') {
        s.updateSettings((x) => ((x.volume = Math.max(0, Math.min(1, x.volume + (a === 'up' ? 0.05 : -0.05)))), (x.muted = false)));
        queueMicrotask(() => controller.applyVolume());
        return;
      }
      if (a === 'info' || a === 'nowPlaying') {
        play('tick');
        useStore.setState({ trackList: { open: !s.trackList.open, index: Math.max(0, s.index) } });
        return;
      }
      if (a === 'options' && nowTrack) return showMenu(trackMenu(nowTrack.id), 900, 330);
      return;
    }
    if (screen === 'loading' || screen === 'launch') {
      if (a === 'back') return backToLibrary();
      return;
    }
    return false;
  });

  // -------------------------------------------------------------- view
  const phase: DiscPhase = screen === 'confirm' ? 'out' : screen === 'launch' ? 'launch' : screen === 'loading' ? 'loading' : 'hidden';
  const onLibrary = screen === 'library' || screen === 'confirm' || screen === 'launch';
  const listRows = screen === 'player' ? s.queue.map((id, i) => ({ key: `${id}:${i}`, trackId: id })) : rowsFor(front);
  const ownPlaylist = front?.kind === 'playlist' ? s.playlists.find((p) => p.id === front.id) : undefined;
  const settingsOpen = screen === 'settings';
  const returnTo = s.returnTo;

  return (
    <div className="viewport">
      <div
        className={`stage${glitch ? ' glitching' : ''}${reduced ? ' reduced' : ''}${fxOn && settings.effects.chroma ? ' chroma' : ''}${settings.highContrast ? ' high-contrast' : ''}${settings.focusAlways ? ' focus-always' : ''}`}
        data-tone-status={screen === 'launch' ? 'dark' : tones.status}
        data-tone-hud={tones.hud}
        data-tone-prompt={screen === 'launch' ? 'dark' : tones.prompt}
        data-tone-mini={tones.mini}
        style={{ transform: `translate(-50%, -50%) scale(${scale})`, ['--scan' as string]: fxOn && settings.effects.vhs ? settings.effects.scanlineStrength : 0, ['--anim' as string]: anim, ['--fx' as string]: fxOn ? settings.effects.intensity : 0, ['--text-scale' as string]: settings.textScale }}
      >
        <div className="stage-content">
          <Background night={screen === 'launch'} dim={settingsOpen} halftoneOn={settings.effects.halftone} bg={settings.background} onTones={setTones} />
          {screen === 'loading' && (
            <div className="loading" role="status">
              <span className="label ui-text">Loading…</span>
            </div>
          )}
          {!settingsOpen && (
            <AlbumStack
              items={items}
              sel={selIndex}
              phase={phase}
              hideCards={!onLibrary}
              spinning={phase !== 'hidden'}
              onSelect={(i) => { setSel(i); play('tick'); }}
              onStep={step}
              onOpen={() => (screen === 'library' ? void openItem() : front && launch(rowsFor(front).map((r) => r.trackId), 0))}
            />
          )}

          {(screen === 'library' || screen === 'confirm') && !s.trackList.open && (
            <>
              <InfoPanel screen={screen} item={front} />
              {screen === 'library' && (
                <>
                  <div className="hud-shade" aria-hidden />
                  <div className="hud-title ui-text">{shelf === 'albums' ? 'Select a Soundtrack' : 'Select a Playlist'}</div>
                  {front && (
                    <div className="now-label ui-text" aria-live="polite">
                      <div className="t">{front.title}</div>
                      <div className="a">{front.subtitle}{front.source && front.source !== 'demo' ? ` · ${front.source}` : front.source === 'demo' ? ' · demo' : ''}</div>
                    </div>
                  )}
                  <div className="shelf-switch ui-text" role="group" aria-label="Shelf">
                    <button aria-pressed={shelf === 'albums'} onClick={() => switchShelf('albums')}>Albums</button>
                    <button aria-pressed={shelf === 'playlists'} onClick={() => switchShelf('playlists')}>Playlists</button>
                  </div>
                </>
              )}
              {screen === 'confirm' && (
                <div className="prompt ui-text">
                  <span className="q">PLAY?</span>
                  <span className="opt"><button onClick={() => front && launch(rowsFor(front).map((r) => r.trackId), 0)}><Cross /> Select</button></span>
                  <span className="opt"><button onClick={() => { play('back'); go('library'); }}><Circle /> Back</button></span>
                </div>
              )}
            </>
          )}

          {s.trackList.open && (screen === 'library' || screen === 'confirm' || screen === 'player') && (
            <div style={screen === 'player' ? { position: 'absolute', inset: 0, zIndex: 30 } : undefined}>
              <TrackList
                title={screen === 'player' ? 'Queue' : front?.title ?? ''}
                subtitle={screen === 'player' ? 'Up next' : front?.subtitle ?? ''}
                rows={listRows}
                index={s.trackList.index}
                current={nowTrack?.id}
                onIndex={(i) => useStore.setState({ trackList: { open: true, index: i } })}
                onPlay={(i) => {
                  if (screen === 'player') {
                    void controller.start(s.queue, i);
                    useStore.setState({ trackList: { open: false, index: 0 } });
                  } else launch(listRows.map((r) => r.trackId), i);
                }}
                onClose={() => useStore.setState({ trackList: { open: false, index: 0 } })}
                onOptions={(i) => showMenu(trackMenu(listRows[i].trackId, ownPlaylist?.id, listRows[i].key), 760, 200)}
                onMove={ownPlaylist && screen !== 'player' ? (from, to) => playlists.move(ownPlaylist.id, from, to) : undefined}
                onRemove={ownPlaylist && screen !== 'player' ? (i) => playlists.removeEntry(ownPlaylist.id, listRows[i].key) : undefined}
                emptyText={ownPlaylist ? 'This playlist is empty. Open any album’s track list, press □ on a track and choose “Add to playlist”.' : undefined}
              />
            </div>
          )}

          <Player visible={screen === 'player'} fullscreen={fullscreen} onBack={backToLibrary} onQueue={() => useStore.setState({ trackList: { open: !s.trackList.open, index: Math.max(0, s.index) } })} onMenu={() => nowTrack && showMenu(trackMenu(nowTrack.id), 900, 330)} />

          {settingsOpen && <SettingsHub onClose={() => go(returnTo === 'settings' ? 'library' : returnTo)} />}

          {screen !== 'player' && screen !== 'loading' && !settingsOpen && (
            <>
              <Status onSettings={() => { play('confirm'); useStore.setState({ screen: 'settings', returnTo: screen }); }} h24={settings.clock24} reduced={reduced} />
              {nowTrack && screen !== 'launch' && (
                <button className={`now-mini ui-text${s.playing ? '' : ' paused'}`} onClick={() => go('player')} title="Now playing (Tab)">
                  <span className="bars" aria-hidden><i /><i /><i /></span>
                  <b>{nowTrack.title}</b>
                  <span>— {nowTrack.artist}</span>
                </button>
              )}
            </>
          )}

          {welcome && !settingsOpen && (
            <Welcome
              onClose={closeWelcome}
              onConnect={() => {
                closeWelcome();
                useStore.setState({ screen: 'settings', returnTo: 'library', settingsTab: 'connections' });
              }}
            />
          )}
          {s.editing && <PlaylistEditor id={s.editing} onClose={() => useStore.setState({ editing: null })} />}
          {menu && <Menu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
          {s.toast && <div className={`toast ${s.toast.tone}`} role="status">{s.toast.text}</div>}
        </div>
        <Effects fx={settings.effects} reduced={reduced} />
      </div>
    </div>
  );
}

function InfoPanel({ screen, item }: { screen: string; item?: StackItem }) {
  const text =
    screen === 'confirm'
      ? item?.kind === 'playlist'
        ? 'A playlist plays like a disc: in order, from the top. Open the track list to start anywhere.'
        : 'Ready to play from the first track. Open the track list to start from another song.'
      : 'Choose your soundtrack. Each record sets a different atmosphere and shapes the night ahead.';
  return (
    <aside className="info-panel ui-text">
      <p>{text}</p>
      <div className="hints">
        <span><Cross /> {screen === 'confirm' ? 'Play' : 'Select'}</span>
        <span><Triangle /> Tracks</span>
        <span><Circle /> Back</span>
        <span><Square /> Options</span>
      </div>
    </aside>
  );
}
