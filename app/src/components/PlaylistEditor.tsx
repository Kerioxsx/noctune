import { useEffect, useRef, useState } from 'react';
import { useStore, playlists, playlistArtwork } from '../store';
import { useActions } from '../engine/input';
import { play } from '../engine/sound';
import { bridge } from '../lib/bridge';

async function collage(urls: string[]): Promise<string> {
  const S = 640;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#111';
  g.fillRect(0, 0, S, S);
  const imgs = await Promise.all(
    urls.slice(0, 4).map(
      (u) =>
        new Promise<HTMLImageElement | null>((res) => {
          const im = new Image();
          im.crossOrigin = 'anonymous';
          im.onload = () => res(im);
          im.onerror = () => res(null);
          im.src = u;
        }),
    ),
  );
  const ok = imgs.filter(Boolean) as HTMLImageElement[];
  const grid = ok.length >= 4 ? 2 : 1;
  const cell = S / grid;
  ok.slice(0, grid * grid).forEach((im, i) => g.drawImage(im, (i % grid) * cell, Math.floor(i / grid) * cell, cell, cell));
  return c.toDataURL('image/jpeg', 0.9);
}

/** Edit title, description and cover; share by exporting references. */
export function PlaylistEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const p = useStore((s) => s.playlists.find((x) => x.id === id));
  const tracks = useStore((s) => s.tracks);
  const profile = useStore((s) => s.profile);
  const notify = useStore((s) => s.notify);
  const [title, setTitle] = useState(p?.title ?? '');
  const [desc, setDesc] = useState(p?.description ?? '');
  const [artIdx, setArtIdx] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  useActions((a) => {
    if (a === 'back') {
      save();
      play('back');
      onClose();
      return true;
    }
    if (a === 'up' || a === 'down') {
      const f = [...document.querySelectorAll<HTMLElement>('.pl-editor button, .pl-editor input, .pl-editor textarea')];
      const i = f.indexOf(document.activeElement as HTMLElement);
      f[(i + (a === 'up' ? -1 : 1) + f.length) % f.length]?.focus();
      return true;
    }
    return true;
  });

  if (!p) return null;
  const arts = [...new Set(p.entries.map((e) => tracks[e.trackId]?.artwork).filter(Boolean) as string[])];
  const cover = playlistArtwork(p, tracks);

  function save() {
    const t = title.trim() || 'Untitled playlist';
    if (t !== p!.title || desc !== p!.description) playlists.update(id, (x) => ((x.title = t), (x.description = desc)), 'edited details');
  }

  return (
    <>
      <div className="layer" style={{ background: 'rgba(0,0,0,0.55)', zIndex: 44 }} onPointerDown={() => { save(); onClose(); }} />
      <section className="pl-editor ui-text" role="dialog" aria-label="Edit playlist" style={{ zIndex: 45 }}>
        <div className="pl-cover">
          {cover ? <img src={cover} alt="" /> : <div className="pl-cover-empty">No cover yet</div>}
        </div>
        <div className="pl-fields">
          <label>
            <span>Title</span>
            <input ref={titleRef} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (save(), (e.target as HTMLInputElement).blur())} />
          </label>
          <label>
            <span>Description</span>
            <textarea value={desc} maxLength={600} rows={3} onChange={(e) => setDesc(e.target.value)} onBlur={save} />
          </label>
          <div className="pl-row">
            <span className="pl-k">Cover</span>
            <button className="btn" onClick={async () => {
              const url = await bridge.pickImage();
              if (url) playlists.update(id, (x) => (x.cover = { kind: 'image', url }), 'changed the cover');
            }}>Choose image…</button>
            <button className="btn" disabled={!arts.length} onClick={() => {
              const trackWithArt = p.entries.filter((e) => tracks[e.trackId]?.artwork);
              const pick = trackWithArt[artIdx % Math.max(1, trackWithArt.length)];
              if (pick) playlists.update(id, (x) => (x.cover = { kind: 'track', trackId: pick.trackId }), 'changed the cover');
              setArtIdx((i) => i + 1);
            }}>Use track artwork{arts.length > 1 ? ' (next)' : ''}</button>
            <button className="btn" disabled={arts.length < 2} onClick={async () => {
              try {
                const data = await collage(arts);
                const url = await bridge.saveDataUrl('collage', data);
                playlists.update(id, (x) => (x.cover = { kind: 'collage', url }), 'made a collage cover');
              } catch {
                notify('Could not build a collage from these covers.', 'error');
              }
            }}>Make collage</button>
            <button className="btn" onClick={() => playlists.update(id, (x) => (x.cover = { kind: 'auto' }), 'reset the cover')}>Auto</button>
          </div>
          <div className="pl-row">
            <span className="pl-k">Share</span>
            <button className="btn" onClick={async () => {
              const ok = await bridge.exportFile(`${p.title.replace(/[^\w -]/g, '')}.noctune.json`, playlists.serialize(p, tracks));
              if (ok) notify('Exported. The file holds track references and metadata, never audio or video.');
            }}>Export playlist file…</button>
            <button className="btn" onClick={() => playlists.duplicate(id)}>Duplicate</button>
          </div>
          <p className="pl-note">
            Live collaboration (invites, Can listen / Can add &amp; edit roles, change history synced between people) needs a Noctune sync server.
            None is configured, so this playlist is private to this computer. Exported files can be imported by anyone; collaborators still need access to the same tracks or provider.
          </p>
          {p.history && p.history.length > 0 && (
            <div className="pl-history">
              {p.history.slice(-3).reverse().map((h, i) => (
                <div key={i}>{h.by === profile.name ? 'You' : h.by} {h.action} · {new Date(h.at).toLocaleDateString()}</div>
              ))}
            </div>
          )}
          <div className="pl-row end">
            <button className="btn danger" onClick={() => {
              if (confirm(`Delete “${p.title}”? This cannot be undone.`)) {
                playlists.remove(id);
                onClose();
              }
            }}>Delete playlist</button>
            <button className="btn primary" onClick={() => { save(); play('confirm'); onClose(); }}>Done</button>
          </div>
        </div>
      </section>
    </>
  );
}
