import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, SETTINGS_TABS, DEFAULT_KEYMAP, DEFAULT_SETTINGS, applyLibrary, loadProviders, saveProfile, type SettingsTab, type Action } from '../store';
import { useActions, captureNextKey } from '../engine/input';
import { play } from '../engine/sound';
import { audio, EQ_BANDS, EQ_PRESETS } from '../engine/audio';
import { bridge, isDesktop } from '../lib/bridge';
import type { ProviderStatus, ScanReport } from '../lib/types';
import { chooseBackground } from '../lib/background';

const TAB_LABEL: Record<SettingsTab, string> = { equalizer: 'Equalizer', settings: 'Settings', accessibility: 'Accessibility', connections: 'Connections', account: 'Account' };

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="row">
      <div className="row-l">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <button role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => { onChange(!checked); play('tick'); }}>
        <span className="switch-track"><span className="switch-dot" /></span>
        <span className="switch-txt">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

function Slider({ label, hint, value, min, max, step = 1, onChange, format, disabled }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; disabled?: boolean }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="row">
      <div className="row-l">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="row-r">
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} style={{ ['--p' as string]: `${p}%` }} onChange={(e) => onChange(Number(e.target.value))} />
        <output>{format ? format(value) : value}</output>
      </div>
    </div>
  );
}

function Choice<T extends string | number>({ label, hint, value, options, onChange }: { label: string; hint?: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="row">
      <div className="row-l">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} role="radio" aria-checked={o.v === value} onClick={() => { onChange(o.v); play('tick'); }}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="group">
    <h3>{title}</h3>
    {children}
  </section>
);

// ---------------------------------------------------------------- tabs
function EqualizerTab() {
  const eq = useStore((s) => s.settings.eq);
  const update = useStore((s) => s.updateSettings);
  const set = (fn: (e: typeof eq) => void) => update((s) => fn(s.eq));
  useEffect(() => {
    audio.setEq(eq.enabled, eq.preamp, eq.gains);
  }, [eq]);
  return (
    <>
      <Toggle label="Equalizer" hint="Applies to local files, demo tracks and SoundCloud streams. Spotify, Apple Music and YouTube play in their own players, which do not expose audio to the app." checked={eq.enabled} onChange={(v) => set((e) => (e.enabled = v))} />
      <div className="row">
        <div className="row-l"><span>Preset</span></div>
        <div className="seg wrap" role="radiogroup" aria-label="Preset">
          {[...Object.keys(EQ_PRESETS), 'Custom'].map((name) => (
            <button key={name} role="radio" aria-checked={eq.preset === name} disabled={name === 'Custom' && eq.preset !== 'Custom'} onClick={() => {
              const pr = EQ_PRESETS[name];
              if (pr) set((e) => ((e.preset = name), (e.preamp = pr.preamp), (e.gains = [...pr.gains])));
              play('tick');
            }}>{name}</button>
          ))}
        </div>
      </div>
      <div className={`eq${eq.enabled ? '' : ' off'}`} role="group" aria-label="Frequency bands">
        <label className="band pre">
          <output>{eq.preamp > 0 ? '+' : ''}{eq.preamp}</output>
          <input type="range" min={-12} max={12} step={0.5} value={eq.preamp} aria-label="Preamp" {...{ orient: 'vertical' }} onChange={(e) => set((x) => ((x.preamp = Number(e.target.value)), (x.preset = 'Custom')))} />
          <span>Pre</span>
        </label>
        {EQ_BANDS.map((f, i) => (
          <label key={f} className="band">
            <output>{eq.gains[i] > 0 ? '+' : ''}{eq.gains[i]}</output>
            <input type="range" min={-12} max={12} step={0.5} value={eq.gains[i]} aria-label={`${f} Hz`} {...{ orient: 'vertical' }} onChange={(e) => set((x) => ((x.gains[i] = Number(e.target.value)), (x.preset = 'Custom')))} />
            <span>{f >= 1000 ? `${f / 1000}k` : f}</span>
          </label>
        ))}
      </div>
      <div className="row end">
        <button className="btn" onClick={() => set((e) => ((e.preamp = 0), (e.gains = [...DEFAULT_SETTINGS.eq.gains]), (e.preset = 'Flat')))}>Reset to flat</button>
      </div>
    </>
  );
}

function GeneralTab() {
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const folders = useStore((x) => x.folders);
  const scan = useStore((x) => x.scan);
  const notify = useStore((x) => x.notify);
  return (
    <>
      <Group title="Background">
        <Choice label="Library background" value={s.background.kind} options={[{ v: 'city', l: 'Halftone city' }, { v: 'custom', l: 'Your picture' }]} onChange={(v) => {
          if (v === 'custom' && !s.background.url) void chooseBackground();
          else update((x) => (x.background.kind = v));
        }} />
        <div className="row">
          <div className="row-l">
            <span>Picture or GIF</span>
            <small>JPG, PNG, WebP or animated GIF. A copy is kept in Noctune’s data folder, so moving the original is fine. Clock, labels and icons switch between light and dark ink to stay readable on it.</small>
          </div>
          <div className="row-r">
            {s.background.url && <img className="bg-thumb" src={s.background.url} alt="" />}
            <button className="btn" onClick={() => void chooseBackground()}>{s.background.url ? 'Change…' : 'Choose…'}</button>
            {s.background.url && <button className="btn" onClick={() => update((x) => { x.background.kind = 'city'; x.background.url = undefined; x.background.animated = false; })}>Remove</button>}
          </div>
        </div>
        <Choice label="Fit" value={s.background.fit} options={[{ v: 'cover', l: 'Fill screen' }, { v: 'contain', l: 'Show whole picture' }]} onChange={(v) => update((x) => (x.background.fit = v))} />
        <Toggle label="Print look" hint="Turns your picture into the app’s olive duotone with a dot screen. Works on GIFs too." checked={s.background.print} onChange={(v) => update((x) => (x.background.print = v))} />
        <Slider label="Darken" value={Math.round(s.background.dim * 100)} min={0} max={80} onChange={(v) => update((x) => (x.background.dim = v / 100))} format={(v) => `${v}%`} />
      </Group>
      <Group title="VHS effect">
        <Toggle label="VHS effect" hint="Scanlines across the screen and a slow tracking band rolling down, like a worn tape." checked={s.effects.vhs} disabled={!s.effects.enabled} onChange={(v) => update((x) => (x.effects.vhs = v))} />
        <Slider label="Scanline strength" value={Math.round(s.effects.scanlineStrength * 100)} min={10} max={100} disabled={!s.effects.enabled || !s.effects.vhs} onChange={(v) => update((x) => (x.effects.scanlineStrength = v / 100))} format={(v) => `${v}%`} />
      </Group>
      <Group title="Look">
        <Toggle label="Analog effects" hint="Master switch for VHS lines, grain, vignette, colour fringing and transition tears. Turning this off does not change your media." checked={s.effects.enabled} onChange={(v) => update((x) => (x.effects.enabled = v))} />
        <Slider label="Effect intensity" value={Math.round(s.effects.intensity * 100)} min={0} max={100} disabled={!s.effects.enabled} onChange={(v) => update((x) => (x.effects.intensity = v / 100))} format={(v) => `${v}%`} />
        <Toggle label="Halftone print" hint="The dot-screen texture on the city backdrop." checked={s.effects.halftone} onChange={(v) => update((x) => (x.effects.halftone = v))} />
        <Toggle label="Colour fringing" checked={s.effects.chroma} disabled={!s.effects.enabled} onChange={(v) => update((x) => (x.effects.chroma = v))} />
        <Toggle label="Vignette" checked={s.effects.vignette} disabled={!s.effects.enabled} onChange={(v) => update((x) => (x.effects.vignette = v))} />
        <Choice label="Clock" value={s.clock24 ? 24 : 12} options={[{ v: 12, l: '12-hour' }, { v: 24, l: '24-hour' }]} onChange={(v) => update((x) => (x.clock24 = v === 24))} />
      </Group>
      <Group title="Sound">
        <Toggle label="Interface sounds" checked={s.sound.enabled} onChange={(v) => update((x) => (x.sound.enabled = v))} />
        <Slider label="Interface volume" value={Math.round(s.sound.volume * 100)} min={0} max={100} disabled={!s.sound.enabled} onChange={(v) => update((x) => (x.sound.volume = v / 100))} format={(v) => `${v}%`} />
        <Toggle label="Quieter during playback" hint="Halves interface sounds while music plays." checked={s.sound.quietDuringPlayback} onChange={(v) => update((x) => (x.sound.quietDuringPlayback = v))} />
      </Group>
      <Group title="Motion">
        <Choice label="Animation" value={s.motion} options={[{ v: 'system', l: 'Follow system' }, { v: 'full', l: 'Full' }, { v: 'reduced', l: 'Reduced' }]} onChange={(v) => update((x) => (x.motion = v))} />
        <Slider label="Animation speed" value={s.animation} min={0.5} max={1.5} step={0.1} onChange={(v) => update((x) => (x.animation = v))} format={(v) => `${v.toFixed(1)}×`} hint="Longer or shorter card and disc moves." />
      </Group>
      <Group title="Library">
        <Choice label="Sort albums" value={s.sort} options={[{ v: 'library', l: 'Library order' }, { v: 'title', l: 'Title' }, { v: 'artist', l: 'Artist' }, { v: 'year', l: 'Year' }, { v: 'source', l: 'Source' }]} onChange={(v) => update((x) => (x.sort = v))} />
        <Toggle label="Show demo albums" checked={s.showDemo} onChange={(v) => update((x) => (x.showDemo = v))} />
        <div className="row">
          <div className="row-l">
            <span>Music folders</span>
            <small>{folders.length ? `${folders.length} folder${folders.length > 1 ? 's' : ''} · manage in Connections` : 'None yet · add in Connections'}</small>
          </div>
          <button className="btn" disabled={!isDesktop || scan.running} onClick={async () => {
            useStore.setState({ scan: { running: true, done: 0, total: 0 } });
            try {
              const r = await bridge.library.rescan();
              applyLibrary(r.index);
              notify(scanSummary(r.report));
            } catch (e) {
              notify((e as Error).message, 'error');
            } finally {
              useStore.setState({ scan: { running: false, done: 0, total: 0 } });
            }
          }}>{scan.running ? `Scanning ${scan.done}/${scan.total}` : 'Rescan'}</button>
        </div>
      </Group>
      <Group title="Playback">
        <Choice label="Repeat" value={s.repeat} options={[{ v: 'off', l: 'Off' }, { v: 'all', l: 'All' }, { v: 'one', l: 'One' }]} onChange={(v) => { update((x) => (x.repeat = v)); useStore.setState({ repeat: v }); }} />
        <Toggle label="Remember repeat mode" hint="Off: repeat resets each session." checked={s.repeatPersist} onChange={(v) => update((x) => (x.repeatPersist = v))} />
        <Toggle label="Resume last session" hint="Reopens the last queue, paused where you left it." checked={s.resumeSession} onChange={(v) => update((x) => (x.resumeSession = v))} />
        <Toggle label="Community lyrics" hint="Looks up timed lyrics on LRCLIB (lrclib.net) when a track has none. Sends the track title and artist to LRCLIB." checked={s.lyrics.community} onChange={(v) => update((x) => (x.lyrics.community = v))} />
      </Group>
      <Group title="Privacy & data">
        <div className="row"><div className="row-l"><span>Diagnostics</span><small>Noctune sends no analytics or crash reports.</small></div></div>
        <div className="row">
          <div className="row-l"><span>Cache</span><small>Clears downloaded artwork and web cache. Your library, playlists and files are kept.</small></div>
          <button className="btn" onClick={async () => { await bridge.clearCache(); notify('Cache cleared.'); }}>Clear cache</button>
        </div>
      </Group>
      <Group title="About">
        <div className="row"><div className="row-l"><span>Noctune {bridge.version}</span><small>{isDesktop ? `Desktop · ${bridge.platform}` : 'Web preview · library and providers need the desktop app'}</small></div>
          <button className="btn" onClick={() => void bridge.openExternal('https://github.com/kerioxsx/noctune/releases')}>Check for updates</button>
        </div>
        <div className="row"><div className="row-l"><span>Troubleshooting</span><small>No sound: check the system output device and that the volume slider is above 0. Video will not play: the format may be unsupported on this OS; MP4 (H.264/AAC) works everywhere.</small></div></div>
      </Group>
    </>
  );
}

const ACTION_LABEL: Record<Action, string> = {
  up: 'Move up', down: 'Move down', left: 'Left / switch shelf', right: 'Right / switch shelf', confirm: 'Select (×)', back: 'Back (○)', info: 'Track list (△)', options: 'Options (□)', settings: 'Settings',
  playPause: 'Play / pause', next: 'Next track', prev: 'Previous track', seekFwd: 'Forward 10s', seekBack: 'Back 10s', volUp: 'Volume up', volDown: 'Volume down', mute: 'Mute',
  fullscreen: 'Full screen', lyricsEarlier: 'Lyrics earlier', lyricsLater: 'Lyrics later', nowPlaying: 'Now playing', repeat: 'Repeat mode', tabPrev: 'Previous tab', tabNext: 'Next tab',
};
const keyName = (k: string) => (k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k.replace('Arrow', '').replace('Media', ''));

function AccessibilityTab() {
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const [rebinding, setRebinding] = useState<Action | null>(null);
  return (
    <>
      <Group title="Motion & flashing">
        <Choice label="Reduce motion" value={s.motion} options={[{ v: 'system', l: 'Follow system' }, { v: 'reduced', l: 'Always' }, { v: 'full', l: 'Never' }]} onChange={(v) => update((x) => (x.motion = v))} />
        <Toggle label="Tracking glitches" hint="Brief horizontal tears on transitions." checked={s.effects.glitches} onChange={(v) => update((x) => (x.effects.glitches = v))} />
        <Toggle label="Scanlines" checked={s.effects.scanlines} onChange={(v) => update((x) => (x.effects.scanlines = v))} />
        <Toggle label="Animated noise" checked={s.effects.noise} onChange={(v) => update((x) => (x.effects.noise = v))} />
      </Group>
      <Group title="Reading">
        <Choice label="Text size" value={s.textScale} options={[{ v: 1, l: '100%' }, { v: 1.15, l: '115%' }, { v: 1.3, l: '130%' }]} onChange={(v) => update((x) => (x.textScale = v))} />
        <Toggle label="High contrast" hint="Brighter outlines and secondary text, darker panels." checked={s.highContrast} onChange={(v) => update((x) => (x.highContrast = v))} />
        <Toggle label="Always show focus outline" checked={s.focusAlways} onChange={(v) => update((x) => (x.focusAlways = v))} />
      </Group>
      <Group title="Lyrics & captions">
        <Toggle label="Show lyrics" checked={s.lyrics.show} onChange={(v) => update((x) => (x.lyrics.show = v))} />
        <Toggle label="Show next line" checked={s.lyrics.showNext} onChange={(v) => update((x) => (x.lyrics.showNext = v))} />
        <Slider label="Lyrics size" value={s.lyrics.size} min={0.7} max={1.6} step={0.05} onChange={(v) => update((x) => (x.lyrics.size = v))} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Lyrics backdrop" hint="Darkens the area behind the current line." value={Math.round(s.lyrics.backdrop * 100)} min={0} max={95} onChange={(v) => update((x) => (x.lyrics.backdrop = v / 100))} format={(v) => `${v}%`} />
      </Group>
      <Group title="Sound">
        <Toggle label="Interface sounds" hint="Muting these never affects the music." checked={s.sound.enabled} onChange={(v) => update((x) => (x.sound.enabled = v))} />
      </Group>
      <Group title="Controls">
        <p className="note">Controllers use the standard layout: D-pad or left stick to move, A select, B back, Y track list, X options, LB/RB tabs, Start settings. Select a key below, then press the new key.</p>
        <div className="keys">
          {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
            <div key={a} className="key-row">
              <span>{ACTION_LABEL[a]}</span>
              <button className={`btn key${rebinding === a ? ' listening' : ''}`} onClick={() => {
                setRebinding(a);
                captureNextKey((k) => {
                  setRebinding(null);
                  if (k === 'Escape' && a !== 'back') return;
                  update((x) => {
                    for (const other of Object.keys(x.keymap) as Action[]) x.keymap[other] = x.keymap[other].filter((kk) => kk !== k);
                    x.keymap[a] = [k, ...s.keymap[a].filter((kk) => kk !== k)].slice(0, 2);
                  });
                });
              }}>{rebinding === a ? 'Press a key…' : s.keymap[a].map(keyName).join(' / ') || 'Unbound'}</button>
            </div>
          ))}
        </div>
        <div className="row end"><button className="btn" onClick={() => update((x) => (x.keymap = DEFAULT_KEYMAP))}>Restore default keys</button></div>
      </Group>
    </>
  );
}

function scanSummary(r: ScanReport) {
  return `Scanned ${r.scanned} file${r.scanned === 1 ? '' : 's'} · ${r.added} in library${r.failed.length ? ` · ${r.failed.length} could not be read` : ''}${r.unsupported ? ` · ${r.unsupported} skipped (not audio/video)` : ''}`;
}

function ProviderCard({ p }: { p: ProviderStatus }) {
  const notify = useStore((x) => x.notify);
  const [busy, setBusy] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) notify(ok);
      await loadProviders();
    } catch (e) {
      notify(`${p.name}: ${(e as Error).message}`, 'error');
      play('error');
    } finally {
      setBusy(false);
    }
  };
  const field = (k: string, label: string, secret = false) => (
    <label className="field" key={k}>
      <span>{label}</span>
      <input type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={vals[k] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />
    </label>
  );
  const state = p.connected ? 'Connected' : p.needs.includes('desktop') ? 'Desktop app only' : p.configured ? 'Not connected' : 'Needs setup';
  return (
    <section className="provider">
      <header>
        <b>{p.name}</b>
        <span className={`pill${p.connected ? ' on' : ''}`}>{state}</span>
      </header>
      <div className="cols">
        <div>
          <h4>Works</h4>
          <ul>{p.capabilities.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
        <div>
          <h4>Limits</h4>
          <ul>{p.limitations.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      </div>
      {!p.needs.includes('desktop') && !p.connected && (
        <div className="setup">
          {p.id === 'spotify' && (
            <>
              <p className="note">Create a free app at developer.spotify.com, add the redirect URI <code>{p.redirectUri}</code>, then paste its Client ID. Sign-in happens on Spotify’s own page in your browser; Noctune never sees your password.</p>
              {field('clientId', 'Client ID')}
            </>
          )}
          {p.id === 'soundcloud' && (
            <>
              <p className="note">Register an app with SoundCloud, set the redirect URI to <code>{p.redirectUri}</code>, then paste its credentials. The secret is stored in your system keychain.</p>
              {field('clientId', 'Client ID')}
              {field('clientSecret', 'Client secret', true)}
            </>
          )}
          {p.id === 'apple' && (
            <>
              <p className="note">Apple Music needs a MusicKit developer token from an Apple Developer account. It is stored in your system keychain.</p>
              {field('developerToken', 'Developer token', true)}
            </>
          )}
          {!p.secureStorage && <p className="note warn">Secure credential storage is not available on this system, so Noctune will not save tokens. On Linux, install and unlock GNOME Keyring or KWallet.</p>}
        </div>
      )}
      <div className="row end">
        {!p.needs.includes('desktop') && !p.connected && (
          <button className="btn primary" disabled={busy} onClick={() => run(async () => {
            if (Object.values(vals).some(Boolean)) await bridge.providers.configure(p.id, vals);
            await bridge.providers.connect(p.id);
          }, `${p.name} connected.`)}>{busy ? 'Waiting for browser sign-in…' : p.configured ? 'Connect' : 'Save & connect'}</button>
        )}
        {p.connected && (
          <>
            <button className="btn" disabled={busy} onClick={() => run(() => bridge.providers.connect(p.id), `${p.name} reconnected.`)}>Reconnect</button>
            <button className="btn" disabled={busy} onClick={() => run(() => loadProviders(), 'Library refreshed.')}>Refresh library</button>
            <button className="btn danger" disabled={busy} onClick={() => run(async () => {
              await bridge.providers.disconnect(p.id);
              const s = useStore.getState();
              useStore.setState({ albums: s.albums.filter((a) => a.source !== p.id), providerPlaylists: s.providerPlaylists.filter((x) => x.providerId !== p.id) });
            }, `${p.name} disconnected. Tokens removed from this computer.`)}>Disconnect</button>
          </>
        )}
      </div>
    </section>
  );
}

function ConnectionsTab() {
  const providers = useStore((s) => s.providers);
  const folders = useStore((s) => s.folders);
  const files = useStore((s) => s.files);
  const scan = useStore((s) => s.scan);
  const notify = useStore((s) => s.notify);
  useEffect(() => {
    if (!isDesktop) return;
    return bridge.library.onProgress((done, total) => useStore.setState({ scan: { running: true, done, total } }));
  }, []);
  const add = async (kind: 'folder' | 'files') => {
    try {
      useStore.setState({ scan: { running: true, done: 0, total: 0 } });
      const r = kind === 'folder' ? await bridge.library.addFolder() : await bridge.library.addFiles();
      if (r) {
        applyLibrary(r.index);
        notify(scanSummary(r.report));
      }
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      useStore.setState({ scan: { running: false, done: 0, total: 0 } });
    }
  };
  return (
    <>
      <section className="provider">
        <header>
          <b>Local files</b>
          <span className={`pill${folders.length + files.length ? ' on' : ''}`}>{scan.running ? `Scanning ${scan.done}/${scan.total || '…'}` : `${folders.length} folder${folders.length === 1 ? '' : 's'} · ${files.length} file${files.length === 1 ? '' : 's'}`}</span>
        </header>
        <p className="note">MP3, FLAC, WAV, AAC/M4A, OGG/Opus audio and MP4/WebM video. A video with the same name as a song becomes its music video; a .lrc file with the same name becomes its timed lyrics. Your files are only read, never changed.</p>
        {!isDesktop && <p className="note warn">Adding local files needs the desktop app.</p>}
        <ul className="folders">
          {[...folders, ...files].map((f) => (
            <li key={f}>
              <span title={f}>{f}</span>
              <button className="btn" onClick={async () => {
                const idx = await bridge.library.removeFolder(f);
                applyLibrary(idx);
              }}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="row end">
          <button className="btn" disabled={!isDesktop || scan.running} onClick={() => add('files')}>Add files…</button>
          <button className="btn primary" disabled={!isDesktop || scan.running} onClick={() => add('folder')}>Add folder…</button>
        </div>
      </section>
      {providers.map((p) => <ProviderCard key={p.id} p={p} />)}
      <p className="note">Official music videos: open a track’s options (□) and link its official YouTube video. It plays in YouTube’s own embedded player; videos whose owners block embedding will say so instead of playing.</p>
    </>
  );
}

function AccountTab() {
  const profile = useStore((s) => s.profile);
  const providers = useStore((s) => s.providers);
  const notify = useStore((s) => s.notify);
  const [name, setName] = useState(profile.name);
  return (
    <>
      <Group title="Profile">
        <div className="row">
          <div className="row-l"><span>Avatar</span><small>Shown on playlists you share.</small></div>
          <div className="row-r">
            <div className="avatar">{profile.avatar ? <img src={profile.avatar} alt="" /> : <span>{profile.name.slice(0, 1).toUpperCase()}</span>}</div>
            <button className="btn" onClick={async () => {
              const url = await bridge.pickImage();
              if (url) saveProfile({ ...profile, avatar: url });
            }}>Choose…</button>
          </div>
        </div>
        <label className="field wide">
          <span>Display name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => saveProfile({ ...profile, name: name.trim() || 'Player 1' })} />
        </label>
      </Group>
      <Group title="Noctune account">
        <p className="note">You are using Noctune without an account. Everything stays on this computer. A Noctune account is separate from Spotify, Apple Music and SoundCloud; connecting a provider never creates one.</p>
        <div className="row">
          <div className="row-l"><span>Shared playlists</span><small>Invitations, roles and live sync need a Noctune sync server. None is configured in this build, so sharing works by exporting playlist files.</small></div>
          <button className="btn" disabled>Sign in</button>
        </div>
      </Group>
      <Group title="Connected services">
        {providers.map((p) => (
          <div className="row" key={p.id}><div className="row-l"><span>{p.name}</span><small>{p.connected ? 'Connected · manage in Connections' : 'Not connected'}</small></div></div>
        ))}
      </Group>
      <Group title="Your data">
        <div className="row">
          <div className="row-l"><span>Export</span><small>Downloads your playlists and settings as JSON (no media files, no tokens).</small></div>
          <button className="btn" onClick={async () => {
            const s = useStore.getState();
            const ok = await bridge.exportFile('noctune-export.json', JSON.stringify({ profile: s.profile, settings: s.settings, playlists: s.playlists }, null, 2));
            if (ok) notify('Exported.');
          }}>Export…</button>
        </div>
        <div className="row">
          <div className="row-l"><span>Reset</span><small>Clears playlists, profile and settings on this computer. Music files are untouched.</small></div>
          <button className="btn danger" onClick={async () => {
            if (!confirm('Reset Noctune on this computer? Playlists and settings will be deleted.')) return;
            await Promise.all([bridge.store.set('playlists', []), bridge.store.set('settings', DEFAULT_SETTINGS), bridge.store.set('profile', { name: 'Player 1', account: null }), bridge.store.set('session', null)]);
            location.reload();
          }}>Reset…</button>
        </div>
      </Group>
    </>
  );
}

export function SettingsHub({ onClose }: { onClose: () => void }) {
  const tab = useStore((s) => s.settingsTab);
  const setTab = (t: SettingsTab) => useStore.setState({ settingsTab: t });
  const panel = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    tabsRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, []);

  const step = (d: number) => {
    const i = SETTINGS_TABS.indexOf(tab);
    const t = SETTINGS_TABS[(i + d + SETTINGS_TABS.length) % SETTINGS_TABS.length];
    setTab(t);
    play('tab');
    requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${t}"]`)?.focus());
  };

  useActions((a) => {
    const inTabs = tabsRef.current?.contains(document.activeElement);
    if (a === 'back') {
      play('back');
      onClose();
      return true;
    }
    if (a === 'tabPrev' || a === 'tabNext') {
      step(a === 'tabPrev' ? -1 : 1);
      return true;
    }
    if ((a === 'left' || a === 'right') && inTabs) {
      step(a === 'left' ? -1 : 1);
      return true;
    }
    if (a === 'left' || a === 'right') {
      // move between sibling buttons in a segmented row
      const el = document.activeElement as HTMLElement | null;
      const seg = el?.closest('.seg, .row-r, .row.end');
      if (seg) {
        const btns = [...seg.querySelectorAll<HTMLElement>('button:not([disabled]), input')];
        const i = btns.indexOf(el!);
        btns[i + (a === 'left' ? -1 : 1)]?.focus();
      }
      return true;
    }
    if (a === 'up' || a === 'down') {
      const focusables = [
        ...(tabsRef.current?.querySelectorAll<HTMLElement>('[aria-selected="true"]') ?? []),
        ...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea') ?? []),
      ].filter((el) => !el.closest('.seg') || el.getAttribute('aria-checked') === 'true' || !el.closest('.seg')!.querySelector('[aria-checked="true"]'));
      const i = focusables.indexOf(document.activeElement as HTMLElement);
      const next = focusables[Math.max(0, Math.min(focusables.length - 1, i + (a === 'up' ? -1 : 1)))];
      next?.focus();
      next?.scrollIntoView({ block: 'nearest' });
      play('tick');
      return true;
    }
    return a !== 'fullscreen';
  });

  return (
    <div className="settings ui-text" role="dialog" aria-label="Settings">
      <div className="tabs" role="tablist" ref={tabsRef} aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <button key={t} role="tab" data-tab={t} aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} aria-controls={`panel-${t}`} onClick={() => { setTab(t); play('tab'); }}>
            {TAB_LABEL[t]}
          </button>
        ))}
        <span className="tabs-hint">Q / E · LB / RB</span>
      </div>
      <div className="panel" id={`panel-${tab}`} role="tabpanel" ref={panel} key={tab}>
        {tab === 'equalizer' && <EqualizerTab />}
        {tab === 'settings' && <GeneralTab />}
        {tab === 'accessibility' && <AccessibilityTab />}
        {tab === 'connections' && <ConnectionsTab />}
        {tab === 'account' && <AccountTab />}
      </div>
      <button className="settings-back" onClick={() => { play('back'); onClose(); }}>Back</button>
    </div>
  );
}
