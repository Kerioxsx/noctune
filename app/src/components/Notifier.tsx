import { useStore, type Alert } from '../store';
import { bridge } from '../lib/bridge';
import { playRelease } from '../engine/discover';
import { play } from '../engine/sound';

const dismiss = (id: string) => useStore.setState({ alerts: useStore.getState().alerts.filter((a) => a.id !== id) });

/** Pops up (with a chime) when an update is ready or a favourite artist releases something. */
export function Notifier({ onPlay }: { onPlay: (trackIds: string[]) => void }) {
  const alerts = useStore((s) => s.alerts);
  if (!alerts.length) return null;
  return (
    <div className="notifier" role="region" aria-label="Notifications">
      {alerts.slice(-3).map((a) => (
        <AlertCard key={a.id} a={a} onPlay={onPlay} />
      ))}
    </div>
  );
}

function AlertCard({ a, onPlay }: { a: Alert; onPlay: (ids: string[]) => void }) {
  const notify = useStore((s) => s.notify);
  const listen = async () => {
    if (!a.release) return;
    dismiss(a.id);
    try {
      const ids = await playRelease(a.release);
      if (ids.length) onPlay(ids);
      else notify('Could not load this release right now.', 'error');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  return (
    <div className="alert ui-text" role="status" aria-live="polite">
      {a.artwork ? <img src={a.artwork} alt="" width={52} height={52} /> : <span className="art" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" /></svg></span>}
      <div>
        <b>{a.title}</b>
        <p>{a.text}</p>
        <div className="row">
          {a.kind === 'update' ? (
            <button className="primary" onClick={() => { dismiss(a.id); void bridge.updates.download(); }}>Update</button>
          ) : (
            <button className="primary" onClick={() => void listen()}>Play</button>
          )}
          <button onClick={() => { play('back'); dismiss(a.id); }} aria-label={`Dismiss: ${a.title}`}>Later</button>
        </div>
      </div>
    </div>
  );
}
