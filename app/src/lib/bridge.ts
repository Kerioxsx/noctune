import type { BridgeAPI, LibraryIndex, ProviderStatus } from './types';

declare global {
  interface Window {
    noctune?: BridgeAPI;
  }
}

const emptyIndex: LibraryIndex = { tracks: [], albums: [], scannedAt: 0, folders: [], files: [] };

/**
 * Browser fallback used by `vite` dev and the website's live demo. It keeps
 * state in localStorage and explains that library and provider features need
 * the desktop app, rather than pretending they work.
 */
function browserBridge(): BridgeAPI {
  const ls = {
    get<T>(k: string, f: T): T {
      try {
        const v = localStorage.getItem(`noctune:${k}`);
        return v ? (JSON.parse(v) as T) : f;
      } catch {
        return f;
      }
    },
    set(k: string, v: unknown) {
      try {
        localStorage.setItem(`noctune:${k}`, JSON.stringify(v));
      } catch {
        /* storage unavailable: run without persistence */
      }
    },
  };
  const desktopOnly = () => Promise.reject(new Error('Available in the desktop app.'));
  const pickFile = (accept: string) =>
    new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  const providers: ProviderStatus[] = (['spotify', 'apple', 'soundcloud'] as const).map((id) => ({
    id,
    name: id === 'spotify' ? 'Spotify' : id === 'apple' ? 'Apple Music' : 'SoundCloud',
    connected: false,
    configured: false,
    secureStorage: false,
    needs: ['desktop'],
    capabilities: [],
    limitations: ['Connecting a provider needs the desktop app, which stores sign-in tokens in your system keychain.'],
  }));
  return {
    platform: 'web',
    version: '0.2.0',
    library: {
      get: async () => emptyIndex,
      addFolder: desktopOnly,
      addFiles: desktopOnly,
      removeFolder: desktopOnly,
      rescan: desktopOnly,
      autoDetect: async () => null,
      setOverride: async () => undefined,
      onProgress: () => () => undefined,
    },
    pickImage: async () => {
      const f = await pickFile('image/*');
      if (!f) return null;
      return await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(f);
      });
    },
    pickLyrics: async () => {
      const f = await pickFile('.lrc,.txt');
      return f ? { name: f.name, text: await f.text() } : null;
    },
    pickVideo: async () => {
      const f = await pickFile('video/*');
      return f ? URL.createObjectURL(f) : null;
    },
    saveDataUrl: async (_n, url) => url,
    exportFile: async (name, text) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = name;
      a.click();
      return true;
    },
    importFile: async () => {
      const f = await pickFile('.json');
      return f ? f.text() : null;
    },
    store: { get: async (k, f) => ls.get(k, f), set: async (k, v) => ls.set(k, v) },
    providers: {
      status: async () => providers,
      configure: desktopOnly,
      connect: desktopOnly,
      disconnect: desktopOnly,
      library: async () => ({ tracks: [], albums: [], playlists: [] }),
      playlistTracks: async () => [],
      remote: desktopOnly,
    },
    lyrics: { lookup: async () => null },
    discover: { similar: async () => [], releases: async () => [], releaseSongs: async () => [] },
    youtube: { status: async () => false, signIn: async () => false, signOut: async () => undefined },
    video: { lookup: async () => null },
    window: {
      toggleFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen().catch(() => undefined);
        return !!document.fullscreenElement;
      },
      isFullscreen: async () => !!document.fullscreenElement,
      onFullscreen: (cb) => {
        const h = () => cb(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', h);
        return () => document.removeEventListener('fullscreenchange', h);
      },
    },
    systemNotify: async () => undefined,
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener');
    },
    clearCache: async () => undefined,
    updates: {
      state: async () => ({ status: 'idle' as const }),
      check: async () => ({ status: 'none' as const }),
      download: async () => undefined,
      install: async () => undefined,
      onState: () => () => undefined,
    },
    deleteAllData: async () => {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('noctune:')).forEach((k) => localStorage.removeItem(k));
      } catch {
        /* storage unavailable */
      }
      location.reload();
    },
  };
}

export const bridge: BridgeAPI = window.noctune ?? browserBridge();
export const isDesktop = !!window.noctune;
