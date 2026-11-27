import { useEffect, useRef } from 'react';
import { useStore, type Action } from '../store';

type Handler = (a: Action, e?: KeyboardEvent) => boolean | void;

/** Handler stack: the top-most (most recently mounted) handler gets actions first. */
const stack: { h: { current: Handler } }[] = [];

export function dispatch(a: Action, e?: KeyboardEvent) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].h.current(a, e) !== false) return true;
  }
  return false;
}

export function useActions(handler: Handler, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const entry = { h: ref };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

const TEXT_INPUT = (el: Element | null) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable);

let capture: ((key: string) => void) | null = null;
/** Next key press is delivered to cb instead of being dispatched (for remapping). */
export function captureNextKey(cb: (key: string) => void) {
  capture = cb;
}

export function installKeyboard() {
  const onKey = (e: KeyboardEvent) => {
    if (capture) {
      e.preventDefault();
      const c = capture;
      capture = null;
      c(e.key);
      return;
    }
    const active = document.activeElement;
    if (TEXT_INPUT(active) && e.key !== 'Escape') return;
    // Native controls keep their own arrow behaviour (range sliders etc.)
    if (active instanceof HTMLInputElement && active.type === 'range' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    if (active instanceof HTMLSelectElement && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // reserved for reordering inside lists
      } else return;
    }
    const map = useStore.getState().settings.keymap;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    for (const [action, keys] of Object.entries(map) as [Action, string[]][]) {
      if (keys.some((k) => (k.length === 1 ? k.toLowerCase() : k) === key)) {
        // Enter/Space on a focused button should click it natively
        if ((action === 'confirm' || action === 'playPause') && active instanceof HTMLElement && active.matches('button, [role="tab"], a, input[type="checkbox"], select, [data-native-activate]')) return;
        if (dispatch(action, e)) e.preventDefault();
        return;
      }
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/**
 * Gamepad: standard mapping. D-pad/left stick move, A confirm, B back, Y info,
 * X options, LB/RB tabs, Start settings, Select now playing. Held directions
 * repeat after 380 ms every 110 ms.
 */
export function installGamepad() {
  const BTN: Record<number, Action> = { 0: 'confirm', 1: 'back', 2: 'options', 3: 'info', 4: 'tabPrev', 5: 'tabNext', 8: 'nowPlaying', 9: 'settings', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  const held = new Map<string, { since: number; last: number }>();
  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const pads = navigator.getGamepads?.() ?? [];
    const now = performance.now();
    const pressed = new Set<string>();
    for (const p of pads) {
      if (!p) continue;
      p.buttons.forEach((b, i) => b.pressed && BTN[i] && pressed.add(BTN[i]));
      const [x, y] = [p.axes[0] ?? 0, p.axes[1] ?? 0];
      if (y < -0.6) pressed.add('up');
      if (y > 0.6) pressed.add('down');
      if (x < -0.6) pressed.add('left');
      if (x > 0.6) pressed.add('right');
    }
    for (const a of pressed) {
      const h = held.get(a);
      const repeats = ['up', 'down', 'left', 'right'].includes(a);
      if (!h) {
        held.set(a, { since: now, last: now });
        dispatch(a as Action);
      } else if (repeats && now - h.since > 380 && now - h.last > 110) {
        h.last = now;
        dispatch(a as Action);
      }
    }
    for (const a of [...held.keys()]) if (!pressed.has(a)) held.delete(a);
  };
  const start = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };
  window.addEventListener('gamepadconnected', start);
  if ((navigator.getGamepads?.() ?? []).some(Boolean)) start();
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('gamepadconnected', start);
  };
}

export function useReducedMotion() {
  const pref = useStore((s) => s.settings.motion);
  const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (pref === 'reduced') return true;
  if (pref === 'full') return false;
  return !!mq?.matches;
}
