import { app, BrowserWindow, net, shell } from 'electron';
import { createWriteStream, existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { autoUpdater } from 'electron-updater';

/**
 * In-app updates, from the project's GitHub Releases.
 *
 * - Windows (installer), Linux AppImage and .deb: electron-updater downloads the
 *   update in the background and installs it on restart.
 * - macOS: the system only lets signed apps replace themselves, and these builds are
 *   not signed yet. Noctune downloads the new .dmg itself and opens it, so the user
 *   only drags it to Applications. The Windows portable .exe and the Linux .tar.gz
 *   get the same treatment (new file downloaded and shown).
 */
export type UpdateState =
  | { status: 'idle' | 'checking' | 'none' }
  | { status: 'available'; version: string; manual: boolean }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string; manual: boolean; file?: string }
  | { status: 'error'; message: string };

const REPO = 'kerioxsx/noctune';
let state: UpdateState = { status: 'idle' };
let manualAsset: { url: string; name: string; version: string } | null = null;

const send = (s: UpdateState) => {
  state = s;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', s);
};

/** Builds that cannot replace themselves in place. */
function manualPlatform() {
  if (process.platform === 'darwin') return true;
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) return true;
  if (process.platform === 'linux' && !process.env.APPIMAGE && !isDeb()) return true;
  return false;
}
function isDeb() {
  // electron-updater writes this marker into .deb builds
  return process.platform === 'linux' && existsSync(join(process.resourcesPath, 'package-type'));
}

function manualAssetName() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'Noctune-mac-arm64.dmg' : 'Noctune-mac-x64.dmg';
  if (process.platform === 'win32') return 'Noctune-Portable.exe';
  return 'Noctune-linux.tar.gz';
}

const newer = (a: string, b: string) => {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

export function initUpdater() {
  if (!app.isPackaged) return; // development builds do not update themselves
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => send({ status: 'available', version: i.version, manual: false }));
  autoUpdater.on('update-not-available', () => send({ status: 'none' }));
  autoUpdater.on('download-progress', (p) => state.status !== 'error' && send({ status: 'downloading', version: (state as { version?: string }).version ?? '', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send({ status: 'ready', version: i.version, manual: false }));
  autoUpdater.on('error', (e) => send({ status: 'error', message: friendly(e) }));
  setTimeout(() => void checkForUpdates(), 15_000);
  setInterval(() => void checkForUpdates(), 6 * 3_600_000);
}

function friendly(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  console.error('[updater]', m);
  if (/ENOTFOUND|ECONN|ETIMEDOUT|network|offline/i.test(m)) return 'Could not reach the update server. Check the internet connection.';
  return 'The update could not be completed. Try again later.';
}

export function getUpdateState() {
  return state;
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return send({ status: 'none' }), state;
  if (state.status === 'downloading' || state.status === 'ready') return state;
  send({ status: 'checking' });
  try {
    if (!manualPlatform()) {
      await autoUpdater.checkForUpdates();
      return state;
    }
    // Each release carries a tiny version.json; GitHub's latest/download link serves it without API limits.
    // Older releases without it fall back to the releases API.
    const ua = { 'User-Agent': `Noctune/${app.getVersion()}` };
    let tag: string | undefined;
    const vj = await net.fetch(`https://github.com/${REPO}/releases/latest/download/version.json`, { headers: ua });
    if (vj.ok) tag = ((await vj.json()) as { tag?: string }).tag;
    if (!tag) {
      const api = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { ...ua, Accept: 'application/vnd.github+json' } });
      if (!api.ok) throw new Error(`release lookup failed (HTTP ${api.status})`);
      tag = ((await api.json()) as { tag_name?: string }).tag_name;
    }
    if (!tag || !/^v?\d+\.\d+\.\d+/.test(tag)) throw new Error('no release found');
    const version = tag.replace(/^v/, '');
    if (!newer(version, app.getVersion())) return send({ status: 'none' }), state;
    const name = manualAssetName();
    manualAsset = { url: `https://github.com/${REPO}/releases/download/${tag}/${name}`, name, version };
    send({ status: 'available', version, manual: true });
  } catch (e) {
    send({ status: 'error', message: friendly(e) });
  }
  return state;
}

export async function downloadUpdate() {
  if (state.status !== 'available') return;
  const version = state.version;
  if (!state.manual) {
    send({ status: 'downloading', version, percent: 0 });
    await autoUpdater.downloadUpdate().catch((e) => send({ status: 'error', message: friendly(e) }));
    return;
  }
  if (!manualAsset) return;
  const dest = join(app.getPath('downloads'), manualAsset.name.replace(/(\.\w+)$/, `-${version}$1`));
  send({ status: 'downloading', version, percent: 0 });
  try {
    const res = await net.fetch(manualAsset.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = `${dest}.part`;
    const out = createWriteStream(tmp);
    let got = 0;
    let last = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== last) {
        last = pct;
        send({ status: 'downloading', version, percent: pct });
      }
    }
    await new Promise<void>((r, j) => out.end((err?: Error | null) => (err ? j(err) : r())));
    if (total && got !== total) throw new Error('incomplete download');
    await fs.rename(tmp, dest);
    if (process.platform !== 'win32') await fs.chmod(dest, 0o755).catch(() => undefined);
    send({ status: 'ready', version, manual: true, file: dest });
  } catch (e) {
    send({ status: 'error', message: friendly(e) });
  }
}

/** Finish: restart into the new version, or open the downloaded installer. */
export async function installUpdate() {
  if (state.status !== 'ready') return;
  if (!state.manual) {
    setImmediate(() => autoUpdater.quitAndInstall());
    return;
  }
  if (state.file) {
    if (process.platform === 'darwin') await shell.openPath(state.file); // mounts the .dmg
    else shell.showItemInFolder(state.file);
  }
}
