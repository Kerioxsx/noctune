import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useActions } from '../engine/input';
import { play } from '../engine/sound';
import { fmt } from './Player';
import { Cross, Circle, Square, Triangle } from './Icons';
import type { LibraryTrack } from '../lib/types';

/** Fixed row height: lets long lists render only the rows on screen. */
const ROW = 44;
const norm = (v: string) => v.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();

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
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [scroll, setScroll] = useState(0);
  const [viewH, setViewH] = useState(420);

  // rows that match the search (original indices), so a 3,000-song playlist filters as you type
  const visible = useMemo(() => {
    const q = norm(query);
    const all = rows.map((_, i) => i);
    if (!q) return all;
    return all.filter((i) => {
      const r = rows[i];
      const t = tracks[r.trackId];
      return norm(`${t?.title ?? r.fallbackTitle ?? ''} ${t?.artist ?? r.fallbackArtist ?? ''} ${t?.album ?? ''}`).includes(q);
    });
  }, [query, rows, tracks]);
  const pos = visible.indexOf(index);
  useEffect(() => {
    if (pos < 0 && visible.length) onIndex(visible[0]); // keep the selection on a matching song
  }, [pos, visible, onIndex]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight || 420);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length === 0]);

  // keep the selected row in view
  useEffect(() => {
    const el = listRef.current;
    if (!el || pos < 0) return;
    const top = pos * ROW;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
  }, [pos]);

  // "/" jumps to the search field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || document.activeElement === searchRef.current) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const move = (d: number) => {
    if (!visible.length) return;
    const np = Math.max(0, Math.min(visible.length - 1, (pos < 0 ? 0 : pos) + d));
    if (visible[np] !== index) {
      onIndex(visible[np]);
      play('tick');
    }
  };
  const first = Math.max(0, Math.floor(scroll / ROW) - 10);
  const last = Math.min(visible.length, Math.ceil((scroll + viewH) / ROW) + 10);

  useActions((a, e) => {
    const n = rows.length;
    if (a === 'up' || a === 'down') {
      if (!n) return true;
      if (e?.altKey && onMove && !query) {
        const to = a === 'up' ? index - 1 : index + 1;
        if (to >= 0 && to < n) {
          onMove(index, to);
          onIndex(to);
          play('tick');
        }
        return true;
      }
      move(a === 'up' ? -1 : 1);
      return true;
    }
    if (a === 'confirm') {
      if (n && pos >= 0) onPlay(index);
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
        <span>{subtitle} · {rows.length.toLocaleString()} song{rows.length === 1 ? '' : 's'}{total ? ` · ${fmt(total)}` : ''}</span>
      </header>
      {rows.length > 0 && (
        <div className="tl-search">
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search songs  /"
            aria-label={`Search songs in ${title}`}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(e.key === 'ArrowUp' ? -1 : 1);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (pos >= 0) onPlay(index);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                e.preventDefault();
                if (query) setQuery('');
                else searchRef.current?.blur();
              }
            }}
          />
          {query && <span className="tl-count" role="status">{visible.length ? `${visible.length.toLocaleString()} found` : 'No songs match'}</span>}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="empty">{emptyText ?? 'No tracks yet.'}</div>
      ) : (
        <ol ref={listRef} role="listbox" aria-label={`Songs in ${title}`} aria-activedescendant={pos >= 0 ? `row-${index}` : undefined} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
          {query && !visible.length && <li className="tl-none" aria-hidden>No songs match “{query}”. Press Esc to clear the search.</li>}
          {first > 0 && <li className="tl-spacer" aria-hidden style={{ height: first * ROW }} />}
          {visible.slice(first, last).map((i) => {
            const r = rows[i];
            const t: LibraryTrack | undefined = tracks[r.trackId];
            const unavailable = !t || !t.available;
            return (
              <li
                id={`row-${i}`}
                key={r.key}
                role="option"
                aria-selected={i === index}
                className={`${i === index ? 'sel' : ''}${unavailable ? ' unavail' : ''}${dragFrom === i ? ' dragging' : ''}${dropAt === i && dragFrom !== null && dragFrom !== i ? ' drop-above' : ''}`}
                draggable={!!onMove && !query}
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
          {last < visible.length && <li className="tl-spacer" aria-hidden style={{ height: (visible.length - last) * ROW }} />}
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
