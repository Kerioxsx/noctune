import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot, useStore, type Alert } from './store';
import { bridge } from './lib/bridge';
import { play } from './engine/sound';
import { loadDiscovery, notePlayback, refreshFeed, checkReleases } from './engine/discover';
import { installKeyboard, installGamepad } from './engine/input';
import { controller } from './engine/playback';
import { audio } from './engine/audio';
import './styles/app.css';
import './styles/settings.css';
import './styles/karaoke.css';

installKeyboard();
installGamepad();
controller.installMediaSession();
// Browsers start audio suspended until a gesture.
const unlock = () => audio.resume();
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

boot().then(async () => {
  await controller.restoreSession();
  await loadDiscovery();
  startDiscovery();
});

/** Show a pop-up with a chime (and a system notification when Noctune is in the background). */
function pushAlert(a: Alert) {
  const st = useStore.getState();
  if (st.alerts.some((x) => x.id === a.id)) return;
  useStore.setState({ alerts: [...st.alerts, a] });
  play('notify');
  if (!document.hasFocus()) void bridge.systemNotify(a.title, a.text).catch(() => undefined);
}

function startDiscovery() {
  // count a listen after 30 s (or half the song)
  window.setInterval(() => {
    const st = useStore.getState();
    if (st.playing) notePlayback(controller.playing, controller.time(), controller.playToken);
  }, 3000);
  window.setTimeout(() => void refreshFeed(), 20_000);
  window.setInterval(() => void refreshFeed(), 3 * 3_600_000);
  const releases = async () => {
    if (!useStore.getState().settings.releaseAlerts) return;
    for (const r of (await checkReleases()).slice(0, 3)) {
      pushAlert({ id: `release:${r.key}`, kind: 'release', title: `New from ${r.artist}`, text: `${r.title} · ${r.type === 'single' ? 'single' : r.type === 'ep' ? 'EP' : 'album'}, out ${new Date(r.date + 'T12:00:00').toLocaleDateString()}`, artwork: r.artwork, release: r });
    }
  };
  window.setTimeout(() => void releases(), 45_000);
  window.setInterval(() => void releases(), 12 * 3_600_000);
  // an update is ready to install
  let toldAbout = '';
  bridge.updates.onState((u) => {
    if (u.status === 'available' && u.version !== toldAbout) {
      toldAbout = u.version;
      pushAlert({ id: `update:${u.version}`, kind: 'update', title: `Noctune ${u.version} is out`, text: 'Update now; it installs from inside the app.' });
    }
  });
}
