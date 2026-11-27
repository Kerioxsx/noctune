import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useActions } from '../engine/input';
import { play } from '../engine/sound';
import { fmt } from './Player';
import { Cross, Circle, Square, Triangle } from './Icons';
import type { LibraryTrack } from '../lib/types';

export interface Row {
  key: string;
  trackId: string;
  fallbackTitle?: string;
  fallbackArtist?: string;
}

interface Props {
  title: string;
  subtitle: string;
  rows: Row[];
  index: number;
  onIndex: (i: number) => void;
  onPlay: (i: number) => void;
  onClose: () => void;
  onOptions: (i: number) => void;
  /** set for editable playlists */
  onMove?: (from: number, to: number) => void;
  onRemove?: (i: number) => void;
  current?: string;
  emptyText?: string;
}

export function TrackList({ title, subtitle, rows, index, onIndex, onPlay, onClose, onOptions, onMove, onRemove, current, emptyText }: Props) {
  const tracks = useStore((s) => s.tracks);
  const listRef = useRef<HTMLOListElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  useActions((a, e) => {
    const n = rows.length;
    if (a === 'up' || a === 'down') {
      if (!n) return true;
      if (e?.altKey && onMove) {
        const to = a === 'up' ? index - 1 : index + 1;
        if (to >= 0 && to < n) {
          onMove(index, to);
          onIndex(to);
          play('tick');
        }
        return true;
      }
      const ni = Math.max(0, Math.min(n - 1, index + (a === 'up' ? -1 : 1)));
      if (ni !== index) {
        onIndex(ni);
        play('tick');
      }
      return true;
    }
    if (a === 'confirm') {
      if (n) onPlay(index);
      return true;
    }
    if (a === 'back' || a === 'info') {
      play('back');
      onClose();
      return true;
    }
    if (a === 'options') {
      if (n) onOptions(index);
      return true;
    }
    return false;
  });

  const total = rows.reduce((acc, r) => acc + (tracks[r.trackId]?.duration ?? 0), 0);

  return (
    <section className="tracklist ui-text" aria-label={`${title} tracks`} onKeyDown={(e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && onRemove && rows.length) {
        e.preventDefault();
        e.stopPropagation();
        onRemove(index);
      }
    }}>
      <header>
        <b>{title}</b>
        <span>{subtitle} · {rows.length} track{rows.length === 1 ? '' : 's'}{total ? ` · ${fmt(total)}` : ''}</span>
      </header>
      {rows.length === 0 ? (
        <div className="empty">{emptyText ?? 'No tracks yet.'}</div>
      ) : (
        <ol ref={listRef} role="listbox" aria-activedescendant={`row-${index}`}>
          {rows.map((r, i) => {
            const t: LibraryTrack | undefined = tracks[r.trackId];
            const unavailable = !t || !t.available;
            return (
              <li
                id={`row-${i}`}
                key={r.key}
                role="option"
                aria-selected={i === index}
                className={`${i === index ? 'sel' : ''}${unavailable ? ' unavail' : ''}${dragFrom === i ? ' dragging' : ''}${dropAt === i && dragFrom !== null && dragFrom !== i ? ' drop-above' : ''}`}
                draggable={!!onMove}
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  setDropAt(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null && onMove && dragFrom !== i) onMove(dragFrom, dragFrom < i ? i - 1 : i);
                  setDragFrom(null);
                  setDropAt(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDropAt(null);
                }}
                onClick={() => (i === index ? onPlay(i) : onIndex(i))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onIndex(i);
                  onOptions(i);
                }}
              >
                <span className="n">{r.trackId === current ? <svg viewBox="0 0 10 10" width="9" height="9" aria-label="Now playing"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg> : String(t?.number ?? i + 1).padStart(2, '0')}</span>
                <span className="tt">
                  <b>{t?.title ?? r.fallbackTitle ?? 'Unknown track'}</b>
                  <span>{unavailable ? `Unavailable${t ? ` from ${t.source}` : ' · removed from library'}` : t.artist}</span>
                </span>
                {t && t.source !== 'demo' && t.source !== 'local' ? <span className="tag">{t.source}</span> : t?.videoUrl || t?.youtubeId ? <span className="tag">video</span> : <span />}
                <span className="d">{t?.duration ? fmt(t.duration) : ''}</span>
              </li>
            );
          })}
        </ol>
      )}
      <footer>
        <span><Cross /> Play</span>
        <span><Circle /> Back</span>
        <span><Square /> Options</span>
        {onMove && <span>Alt+↑↓ / drag · Reorder</span>}
        {!onMove && <span><Triangle /> Close</span>}
      </footer>
    </section>
  );
}

export interface MenuItem {
  label: string;
  run?: () => void;
  separator?: boolean;
  heading?: boolean;
  disabled?: boolean;
}

export function Menu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    first?.focus();
  }, []);
  useActions((a) => {
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (a === 'up' || a === 'down') {
      btns[(i + (a === 'up' ? -1 : 1) + btns.length) % btns.length]?.focus();
      play('tick');
      return true;
    }
    if (a === 'confirm') {
      btns[i]?.click();
      return true;
    }
    if (a === 'back' || a === 'options') {
      play('back');
      onClose();
      return true;
    }
    return true; // modal: swallow everything else
  });
  return (
    <>
      <div className="layer" style={{ zIndex: 39 }} onPointerDown={onClose} />
      <div className="menu ui-text" ref={ref} role="menu" style={{ left: x, top: y }}>
        {items.map((it, i) =>
          it.separator ? (
            <hr key={i} />
          ) : it.heading ? (
            <div key={i} className="label">{it.label}</div>
          ) : (
            <button
              key={i}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                play('confirm');
                onClose();
                it.run?.();
              }}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    </>
  );
}
