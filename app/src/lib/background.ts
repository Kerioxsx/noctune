import { useStore } from '../store';
import { bridge } from './bridge';

/** Pick a picture or GIF and make it the library background. The file is copied into app data. */
export async function chooseBackground() {
  const st = useStore.getState();
  try {
    const url = await bridge.pickImage();
    if (!url) return;
    const animated = /^data:image\/gif/i.test(url) || /\.gif$/i.test(decodeBase64Path(url));
    st.updateSettings((x) => {
      x.background.kind = 'custom';
      x.background.url = url;
      x.background.animated = animated;
    });
    st.notify(animated ? 'Background set. The GIF keeps playing behind your library.' : 'Background set.');
  } catch (e) {
    st.notify((e as Error).message, 'error');
  }
}

/** noctune://media/<base64url(path)> → path, to read the file extension */
function decodeBase64Path(url: string) {
  const m = /^noctune:\/\/media\/(.+)$/.exec(url);
  if (!m) return url;
  try {
    return atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return url;
  }
}
