import { app, BrowserWindow, ipcMain, dialog, shell, screen, session } from 'electron';
import { join, basename } from 'node:path';
import { promises as fs } from 'node:fs';
import { registerSchemes, handleProtocol, allowRoot, allowPath, mediaUrl } from './protocol';
import { readJson, writeJson, dataDir } from './store';
import * as library from './library';
import * as providers from './providers';
import { findLyrics, findOfficialVideo, type SongQuery } from './lookups';
import * as youtube from './youtube';
import { initUpdater, checkForUpdates, downloadUpdate, installUpdate, getUpdateState } from './updater';

registerSchemes();

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let win: BrowserWindow | null = null;

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
  fullscreen?: boolean;
}

async function createWindow() {
  // Saved state is untrusted input: a half-written or edited file must never stop the app opening.
  const raw = await readJson<Partial<WindowState>>('window', {});
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const saved: WindowState = { width: num(raw.width, 1280), height: num(raw.height, 720), x: typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : undefined, y: typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : undefined, maximized: raw.maximized === true, fullscreen: raw.fullscreen === true };
  // Only restore a position that is still on a connected display.
  const visible =
    saved.x !== undefined &&
    saved.y !== undefined &&
    screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return saved.x! >= b.x - 50 && saved.y! >= b.y - 50 && saved.x! < b.x + b.width - 100 && saved.y! < b.y + b.height - 100;
    });

  win = new BrowserWindow({
    width: Math.max(960, saved.width),
    height: Math.max(540, saved.height),
    x: visible ? saved.x : undefined,
    y: visible ? saved.y : undefined,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#050605',
    title: 'Noctune',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      // only for YouTube's page; every <webview> is checked and locked down in youtube.guardWebviews
      webviewTag: true,
      additionalArguments: [`--noctune-version=${app.getVersion()}`],
    },
  });
  youtube.guardWebviews(win.webContents);
  if (saved.maximized) win.maximize();
  if (saved.fullscreen) win.setFullScreen(true);
  win.once('ready-to-show', () => win?.show());

  let normalBounds = win.getNormalBounds();
  const persist = () => {
    if (!win) return;
    if (!win.isFullScreen() && !win.isMaximized()) normalBounds = win.getNormalBounds();
    void writeJson('window', { ...normalBounds, maximized: win.isMaximized(), fullscreen: win.isFullScreen() } satisfies WindowState);
  };
  let t: NodeJS.Timeout | undefined;
  const debounced = () => {
    clearTimeout(t);
    t = setTimeout(persist, 400);
  };
  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('close', persist);
  win.on('enter-full-screen', () => win?.webContents.send('window:fullscreen', true));
  win.on('leave-full-screen', () => win?.webContents.send('window:fullscreen', false));

  // External links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL!)) return;
    e.preventDefault();
  });

  if (isDev) await win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else await win.loadFile(join(__dirname, '..', 'dist', 'index.html'));
}

function registerIpc() {
  const send = (d: number, total: number) => win?.webContents.send('library:progress', d, total);

  ipcMain.handle('library:get', () => library.loadIndex());
  ipcMain.handle('library:addFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Add music folder', properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return null;
    const cfg = await library.getConfig();
    for (const p of r.filePaths) {
      if (!cfg.folders.includes(p)) cfg.folders.push(p);
      allowRoot(p);
    }
    await library.saveConfig(cfg);
    return library.scan(send);
  });
  ipcMain.handle('library:addFiles', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Add music or video files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio and video', extensions: [...library.AUDIO_EXT, ...library.VIDEO_EXT, '.lrc'].map((e) => e.slice(1)) },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const cfg = await library.getConfig();
    for (const p of r.filePaths) {
      if (!cfg.files.includes(p)) cfg.files.push(p);
      allowPath(p);
    }
    await library.saveConfig(cfg);
    return library.scan(send);
  });
  ipcMain.handle('library:removeFolder', async (_e, p: string) => {
    const cfg = await library.getConfig();
    cfg.folders = cfg.folders.filter((f) => f !== p);
    cfg.files = cfg.files.filter((f) => f !== p);
    await library.saveConfig(cfg);
    return (await library.scan(send)).index;
  });
  ipcMain.handle('library:rescan', () => library.scan(send));
  ipcMain.handle('library:setOverride', async (_e, id: string, v: Record<string, unknown>) => {
    const cfg = await library.getConfig();
    const allowedKeys = ['title', 'artist', 'album', 'artwork', 'videoUrl'];
    cfg.overrides[id] = { ...cfg.overrides[id], ...Object.fromEntries(Object.entries(v).filter(([k]) => allowedKeys.includes(k))) };
    await library.saveConfig(cfg);
  });

  ipcMain.handle('pick:image', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose cover image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    // Copy into app data so the cover survives the original being moved.
    const dir = join(dataDir(), 'covers');
    await fs.mkdir(dir, { recursive: true });
    const dest = join(dir, `${Date.now()}-${basename(r.filePaths[0])}`);
    await fs.copyFile(r.filePaths[0], dest);
    return mediaUrl(dest);
  });
  ipcMain.handle('pick:lyrics', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Import timed lyrics', properties: ['openFile'], filters: [{ name: 'Lyrics', extensions: ['lrc', 'txt'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const text = await fs.readFile(r.filePaths[0], 'utf8');
    return { name: basename(r.filePaths[0]), text: text.slice(0, 500_000) };
  });
  ipcMain.handle('pick:video', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Link a video file', properties: ['openFile'], filters: [{ name: 'Video', extensions: library.VIDEO_EXT.map((e) => e.slice(1)) }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return mediaUrl(r.filePaths[0]);
  });
  ipcMain.handle('file:saveDataUrl', async (_e, name: string, url: string) => {
    const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(url);
    if (!m) throw new Error('Unsupported image data');
    const dir = join(dataDir(), 'covers');
    await fs.mkdir(dir, { recursive: true });
    const dest = join(dir, `${name.replace(/[^a-z0-9-]/gi, '_')}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
    await fs.writeFile(dest, Buffer.from(m[2], 'base64'));
    return mediaUrl(dest);
  });
  ipcMain.handle('file:export', async (_e, name: string, text: string) => {
    const r = await dialog.showSaveDialog(win!, { title: 'Export playlist', defaultPath: name, filters: [{ name: 'Noctune playlist', extensions: ['noctune.json', 'json'] }] });
    if (r.canceled || !r.filePath) return false;
    await fs.writeFile(r.filePath, text);
    return true;
  });
  ipcMain.handle('file:import', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Import playlist', properties: ['openFile'], filters: [{ name: 'Noctune playlist', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return (await fs.readFile(r.filePaths[0], 'utf8')).slice(0, 2_000_000);
  });

  const STORE_KEYS = new Set(['settings', 'playlists', 'session', 'lyrics-imports', 'profile']);
  ipcMain.handle('store:get', (_e, k: string, f: unknown) => (STORE_KEYS.has(k) ? readJson(k, f) : f));
  ipcMain.handle('store:set', (_e, k: string, v: unknown) => (STORE_KEYS.has(k) ? writeJson(k, v) : undefined));

  ipcMain.handle('providers:status', () => providers.status());
  ipcMain.handle('providers:configure', (_e, id, v) => providers.configure(id, v));
  ipcMain.handle('providers:connect', (_e, id) => providers.connect(id));
  ipcMain.handle('providers:disconnect', (_e, id) => providers.disconnect(id));
  ipcMain.handle('providers:library', (_e, id) => providers.library(id));
  ipcMain.handle('providers:playlistTracks', (_e, id) => providers.playlistTracks(id));
  ipcMain.handle('providers:remote', (_e, cmd) => providers.remote(cmd));

  // Community lyrics (LRCLIB). Only called when the user turns it on in Settings.
  // Online lookups (LRCLIB lyrics, MusicBrainz official videos); renderer settings decide whether they run.
  const songQuery = (q: unknown): SongQuery | null => {
    const o = q as Partial<SongQuery>;
    if (!o || typeof o.title !== 'string' || typeof o.artist !== 'string' || !o.title.trim() || !o.artist.trim() || o.artist === 'Unknown artist') return null;
    return { title: o.title.slice(0, 200), artist: o.artist.slice(0, 200), album: typeof o.album === 'string' ? o.album.slice(0, 200) : undefined, duration: typeof o.duration === 'number' ? o.duration : undefined };
  };
  ipcMain.handle('lyrics:lookup', async (_e, q: unknown) => {
    const sq = songQuery(q);
    return sq ? findLyrics(sq) : null;
  });
  ipcMain.handle('youtube:status', () => youtube.signedIn());
  ipcMain.handle('youtube:signIn', () => youtube.signIn(win));
  ipcMain.handle('youtube:signOut', () => youtube.signOut());
  ipcMain.handle('video:lookup', async (_e, q: unknown) => {
    const sq = songQuery(q);
    return sq ? findOfficialVideo(sq) : null;
  });
  // First launch: add the system Music folder if it exists, so the user's songs appear straight away.
  ipcMain.handle('library:autoDetect', async () => {
    const cfg = await library.getConfig();
    if (cfg.folders.length || cfg.files.length) return null;
    const found = await library.defaultMusicFolders(app.getPath('music'));
    if (!found.length) return null;
    cfg.folders.push(...found);
    found.forEach(allowRoot);
    await library.saveConfig(cfg);
    return { ...(await library.scan(send)), folders: found };
  });

  // in-app updates
  ipcMain.handle('update:state', () => getUpdateState());
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:install', () => installUpdate());

  ipcMain.handle('window:toggleFullscreen', () => {
    if (!win) return false;
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });
  ipcMain.handle('window:isFullscreen', () => win?.isFullScreen() ?? false);
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    // https links, and the bare spotify: scheme to open the Spotify app
    if (/^https:\/\//.test(url) || url === 'spotify:') return shell.openExternal(url);
  });
  ipcMain.handle('app:clearCache', async () => {
    await session.defaultSession.clearCache();
  });
  // Erases everything Noctune stored on this computer, then restarts. Music files are never touched.
  ipcMain.handle('app:deleteAllData', async () => {
    const dir = dataDir();
    const names = ['settings', 'playlists', 'session', 'lyrics-imports', 'profile', 'library-config', 'library-index', 'providers', 'secrets', 'window'];
    await Promise.all(names.map((n) => fs.rm(join(dir, `${n}.json`), { force: true })));
    await fs.rm(join(dir, 'artwork'), { recursive: true, force: true });
    await fs.rm(join(dir, 'covers'), { recursive: true, force: true });
    await session.defaultSession.clearStorageData();
    await session.defaultSession.clearCache();
    await youtube.clearAll();
    app.relaunch();
    app.exit(0);
  });
}

app.whenReady().then(async () => {
  // Electron grants web permissions (microphone, camera, location, notifications...) by default.
  // Noctune needs none of them, so refuse everything except going full screen.
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  // YouTube refuses embeds that arrive without a referrer, which a local app page never sends.
  // Identify the embed as coming from Noctune's website.
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (details, cb) => {
    cb({ requestHeaders: { ...details.requestHeaders, Referer: 'https://kerioxsx.github.io/noctune/' } });
  });

  // Re-allow paths the user added in earlier sessions.
  const cfg = await library.getConfig();
  cfg.folders.forEach(allowRoot);
  cfg.files.forEach(allowPath);
  // videos linked to tracks by hand live outside the library folders; re-allow them too
  for (const o of Object.values(cfg.overrides)) {
    const m = typeof o?.videoUrl === 'string' && /^noctune:\/\/media\/([\w-]+)$/.exec(o.videoUrl);
    if (m) allowPath(Buffer.from(m[1], 'base64url').toString('utf8'));
  }
  allowRoot(join(dataDir(), 'artwork'));
  allowRoot(join(dataDir(), 'covers'));
  handleProtocol(async (url, req) => {
    if (url.host === 'soundcloud') {
      try {
        return await providers.soundcloudStream(url.pathname.slice(1), req.headers.get('range'));
      } catch (e) {
        return new Response((e as Error).message, { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }
    return null;
  });
  await youtube.prepareSession();
  registerIpc();
  await createWindow();
  initUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
