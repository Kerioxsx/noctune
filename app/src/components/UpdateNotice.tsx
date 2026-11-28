import { useEffect, useState } from 'react';
import { bridge } from '../lib/bridge';
import type { UpdateState } from '../lib/types';

/** Live update state from the main process. */
export function useUpdateState() {
  const [s, setS] = useState<UpdateState>({ status: 'idle' });
  useEffect(() => {
    void bridge.updates.state().then(setS);
    return bridge.updates.onState(setS);
  }, []);
  return s;
}

const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;

/** Words and the one action for each step, shared by the notice and the settings row. */
export function updateCopy(s: UpdateState): { text: string; action?: { label: string; run: () => void } } {
  switch (s.status) {
    case 'checking':
      return { text: 'Checking for updates…' };
    case 'none':
      return { text: 'Noctune is up to date.' };
    case 'available':
      return { text: `Noctune ${s.version} is available.`, action: { label: 'Update', run: () => void bridge.updates.download() } };
    case 'downloading':
      return { text: `Downloading Noctune ${s.version}… ${pct(s.percent)}` };
    case 'ready':
      return s.manual
        ? { text: `Noctune ${s.version} is downloaded. Open the installer and drag Noctune to Applications.`, action: { label: 'Open installer', run: () => void bridge.updates.install() } }
        : { text: `Noctune ${s.version} is ready.`, action: { label: 'Restart to update', run: () => void bridge.updates.install() } };
    case 'error':
      return { text: s.message, action: { label: 'Try again', run: () => void bridge.updates.check() } };
    default:
      return { text: '' };
  }
}

/** Small pill on the library screen; only appears when there is something to do. */
export function UpdateNotice() {
  const s = useUpdateState();
  const [hidden, setHidden] = useState<string | null>(null);
  if (!['available', 'downloading', 'ready'].includes(s.status)) return null;
  const key = `${s.status}:${'version' in s ? s.version : ''}`;
  if (hidden === key) return null;
  const { text, action } = updateCopy(s);
  return (
    <div className="update-notice ui-text" role="status" aria-live="polite">
      {s.status === 'downloading' && <span className="update-bar" style={{ ['--p' as string]: pct(s.percent) }} aria-hidden />}
      <span>{text}</span>
      {action && <button className="btn primary" onClick={action.run}>{action.label}</button>}
      {s.status === 'available' && <button className="update-later" onClick={() => setHidden(key)} aria-label="Remind me later">Later</button>}
    </div>
  );
}
