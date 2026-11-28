import { contextBridge, ipcRenderer } from 'electron';

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('noctune', {
  platform: process.platform,
  version: process.env.NOCTUNE_VERSION ?? '0.1.0',
  library: {
    get: () => invoke('library:get'),
    addFolder: () => invoke('library:addFolder'),
    addFiles: () => invoke('library:addFiles'),
    removeFolder: (p: string) => invoke('library:removeFolder', p),
    rescan: () => invoke('library:rescan'),
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
  deleteAllData: () => invoke('app:deleteAllData'),
});
