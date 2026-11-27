import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot } from './store';
import { installKeyboard, installGamepad } from './engine/input';
import { controller } from './engine/playback';
import { audio } from './engine/audio';
import './styles/app.css';
import './styles/settings.css';

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

boot().then(() => controller.restoreSession());
