import { useEffect, useRef, useState } from 'react';
import { useStore, applyLibrary } from '../store';
import { useActions } from '../engine/input';
import { play } from '../engine/sound';
import { bridge } from '../lib/bridge';

/**
 * First-run welcome: explains that the stack fills with the user's own music once
 * they add files or connect a service, and offers each way in. Shown once; it can be
 * reopened from the options menu ("Add your music…").
 */
export function Welcome({ onClose, onConnect }: { onClose: () => void; onConnect: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const notify = useStore((s) => s.notify);
  const detected = useStore((s) => s.detected);
  const scanning = useStore((s) => s.scan.running);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  useActions((a) => {
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
      btns[(i + (a === 'up' || a === 'left' ? -1 : 1) + btns.length) % btns.length]?.focus();
      play('tick');
      return true;
    }
    if (a === 'confirm') {
      btns[Math.max(0, i)]?.click();
      return true;
    }
    if (a === 'back') {
      play('back');
      onClose();
      return true;
    }
    return true; // modal
  });

  const add = async (kind: 'files' | 'folder') => {
    setBusy(kind);
    useStore.setState({ scan: { running: true, done: 0, total: 0 } });
    try {
      const r = kind === 'folder' ? await bridge.library.addFolder() : await bridge.library.addFiles();
      if (!r) return; // picker cancelled: stay on the welcome screen
      applyLibrary(r.index);
      // your own albums sit at the front of the stack
      useStore.setState({ shelf: 'albums', sel: { albums: 0, playlists: useStore.getState().sel.playlists } });
      notify(r.report.added ? `Added ${r.report.added} track${r.report.added === 1 ? '' : 's'}. Your music is at the front of the stack.` : 'No playable music was found there. Try MP3, FLAC, M4A, OGG, WAV or MP4 files.', r.report.added ? 'info' : 'error');
      if (r.report.added) {
        play('confirm');
        onClose();
      }
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(null);
      useStore.setState({ scan: { running: false, done: 0, total: 0 } });
    }
  };

  return (
    <>
      <div className="layer welcome-scrim" aria-hidden />
      <div className="welcome ui-text" role="dialog" aria-modal="true" aria-labelledby="welcome-h" ref={ref}>
        <h2 id="welcome-h">{detected?.added ? 'Your music is here' : 'Bring your music'}</h2>
        {detected?.added ? (
          <p>Noctune found {detected.added} song{detected.added === 1 ? '' : 's'} in your Music folder and put them at the front of the stack. Lyrics and official music videos are found for each song as you play it. Add more folders or connect a service below.</p>
        ) : (
          <p>{scanning ? 'Looking for music in your Music folder… ' : ''}To see your own music in the stack, add your MP3 and MP4 files, or connect a music service. Lyrics and official music videos are then found for each song automatically. Noctune only reads your files; it never changes them.</p>
        )}
        <div className="welcome-actions">
          <button className="btn primary" disabled={!!busy} onClick={() => void add('files')}>{busy === 'files' ? 'Reading files…' : 'Add music files…'}</button>
          <button className="btn" disabled={!!busy} onClick={() => void add('folder')}>{busy === 'folder' ? 'Reading folder…' : 'Add a music folder…'}</button>
          <button className="btn" disabled={!!busy} onClick={() => { play('confirm'); onConnect(); }}>Connect Spotify or SoundCloud</button>
        </div>
        <button className="welcome-skip" disabled={!!busy} onClick={() => { play('back'); onClose(); }}>{detected?.added ? 'Start listening' : 'Explore the demo albums first'}</button>
        <p className="welcome-note">You can do this any time: press □ (O) on the stack and choose “Add your music…”, or open Settings → Connections.</p>
      </div>
    </>
  );
}
