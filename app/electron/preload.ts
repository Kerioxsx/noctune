import { contextBridge, ipcRenderer } from 'electron';

// Errors from the main process arrive as "Error invoking remote method 'x': Error: reason"; keep only the reason.
const invoke = (ch: string, ...args: unknown[]) =>
  ipcRenderer.invoke(ch, ...args).catch((e: unknown) => {
    throw new Error(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
  });

contextBridge.exposeInMainWorld('noctune', {
  platform: process.platform,
  // passed by the main process, which knows the installed app's version
  version: process.argv.find((a) => a.startsWith('--noctune-version='))?.split('=')[1] ?? '',
  youtube: {
    status: () => invoke('youtube:status'),
    signIn: () => invoke('youtube:signIn'),
    signOut: () => invoke('youtube:signOut'),
  },
  library: {
    get: () => invoke('library:get'),
    addFolder: () => invoke('library:addFolder'),
    addFiles: () => invoke('library:addFiles'),
    removeFolder: (p: string) => invoke('library:removeFolder', p),
    rescan: () => invoke('library:rescan'),
    autoDetect: () => invoke('library:autoDetect'),
    setOverride: (id: string, v: unknown) => invoke('library:setOverride', id, v),
    onProgress: (cb: (d: number, t: number) => void) => {
      const h = (_: unknown, d: number, t: number) => cb(d, t);
      ipcRenderer.on('library:progress', h);
      return () => ipcRenderer.removeListener('library:progress', h);
    },
  },
  pickImage: () => invoke('pick:image'),
  pickLyrics: () => invoke('pick:lyrics'),
  pickVideo: () => invoke('pick:video'),
  saveDataUrl: (name: string, url: string) => invoke('file:saveDataUrl', name, url),
  exportFile: (name: string, text: string) => invoke('file:export', name, text),
  importFile: () => invoke('file:import'),
  store: {
    get: (k: string, f: unknown) => invoke('store:get', k, f),
    set: (k: string, v: unknown) => invoke('store:set', k, v),
  },
  providers: {
    status: () => invoke('providers:status'),
    configure: (id: string, v: Record<string, string>) => invoke('providers:configure', id, v),
    connect: (id: string) => invoke('providers:connect', id),
    disconnect: (id: string) => invoke('providers:disconnect', id),
    library: (id: string) => invoke('providers:library', id),
    playlistTracks: (id: string) => invoke('providers:playlistTracks', id),
    remote: (cmd: unknown) => invoke('providers:remote', cmd),
  },
  lyrics: { lookup: (q: unknown) => invoke('lyrics:lookup', q) },
  video: { lookup: (q: unknown) => invoke('video:lookup', q) },
  window: {
    toggleFullscreen: () => invoke('window:toggleFullscreen'),
    isFullscreen: () => invoke('window:isFullscreen'),
    onFullscreen: (cb: (v: boolean) => void) => {
      const h = (_: unknown, v: boolean) => cb(v);
      ipcRenderer.on('window:fullscreen', h);
      return () => ipcRenderer.removeListener('window:fullscreen', h);
    },
  },
  openExternal: (url: string) => invoke('shell:openExternal', url),
  clearCache: () => invoke('app:clearCache'),
  updates: {
    state: () => invoke('update:state'),
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    install: () => invoke('update:install'),
    onState: (cb: (s: unknown) => void) => {
      const h = (_: unknown, s: unknown) => cb(s);
      ipcRenderer.on('update:state', h);
      return () => ipcRenderer.removeListener('update:state', h);
    },
  },
  deleteAllData: () => invoke('app:deleteAllData'),
});
