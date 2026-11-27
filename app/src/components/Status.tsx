import { useEffect, useState } from 'react';
import { Battery, Dino, Gear } from './Icons';

interface BatteryState {
  level: number;
  charging: boolean;
}
interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

/**
 * Battery is only shown when the system really reports one. Desktops without
 * a battery report "full, charging, 0s to charge" forever; that is treated as
 * no battery and the icon is hidden rather than faked.
 */
function useBattery(): BatteryState | null {
  const [b, setB] = useState<BatteryState | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (!nav.getBattery) return;
    let mgr: BatteryManagerLike | null = null;
    const update = () => {
      if (!mgr) return;
      const desktop = mgr.charging && mgr.level === 1 && mgr.chargingTime === 0 && mgr.dischargingTime === Infinity;
      setB(desktop ? null : { level: mgr.level, charging: mgr.charging });
    };
    nav.getBattery().then((m) => {
      mgr = m;
      update();
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => m.addEventListener(ev, update));
    }).catch(() => undefined);
    return () => {
      if (mgr) ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => mgr!.removeEventListener(ev, update));
    };
  }, []);
  return b;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const ms = 60_000 - (Date.now() % 60_000);
    let iv: number | undefined;
    const t = window.setTimeout(() => {
      tick();
      iv = window.setInterval(tick, 60_000);
    }, ms);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, []);
  return now;
}

export function formatClock(d: Date, h24: boolean) {
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (h24) return `${md} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const h = d.getHours() % 12 || 12;
  return `${md} ${h}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

export function Status({ onSettings, h24, reduced }: { onSettings: () => void; h24: boolean; reduced: boolean }) {
  const now = useClock();
  const battery = useBattery();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (reduced) return;
    // the mascot shifts its weight every few seconds; nothing more
    const iv = window.setInterval(() => {
      setFrame(1);
      window.setTimeout(() => setFrame(0), 260);
    }, 4200);
    return () => clearInterval(iv);
  }, [reduced]);
  return (
    <div className="status ui-text">
      <button className="icon-btn" onClick={onSettings} aria-label="Settings" title="Settings">
        <Gear />
      </button>
      <Dino frame={frame} />
      <span className="clock" aria-label={`Date and time ${now.toLocaleString()}`}>{formatClock(now, h24)}</span>
      {battery && (
        <span title={`Battery ${Math.round(battery.level * 100)}%${battery.charging ? ', charging' : ''}`} aria-label={`Battery ${Math.round(battery.level * 100)} percent`}>
          <Battery level={battery.level} charging={battery.charging} />
        </span>
      )}
    </div>
  );
}
