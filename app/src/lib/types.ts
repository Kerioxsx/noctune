export type Source = 'demo' | 'local' | 'spotify' | 'soundcloud' | 'apple';
export type ProviderId = 'spotify' | 'soundcloud' | 'apple';

export interface LibraryTrack {
  id: string;
  source: Source;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  albumArtist?: string;
  number?: number;
  disc?: number;
  year?: number;
  duration?: number;
  artwork?: string;
  audioUrl?: string;
  videoUrl?: string;
  /** Official video on YouTube, linked by the user. Played with YouTube's own embedded player. */
  youtubeId?: string;
  lyricsUrl?: string;
  embeddedLyrics?: string;
  providerUri?: string;
  path?: string;
  isVideo?: boolean;
  available: boolean;
}

export interface LibraryAlbum {
  id: string;
  source: Source;
  title: string;
  artist: string;
  year?: number;
  artwork?: string;
  trackIds: string[];
  providerUri?: string;
}

export interface LibraryIndex {
  tracks: LibraryTrack[];
  albums: LibraryAlbum[];
  scannedAt: number;
  folders: string[];
  files: string[];
}

export interface ScanReport {
  scanned: number;
  added: number;
  unsupported: number;
  failed: { file: string; reason: string }[];
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  connected: boolean;
  configured: boolean;
  secureStorage: boolean;
  needs: string[];
  capabilities: string[];
  limitations: string[];
  redirectUri?: string;
}

export interface ProviderLibrary {
  tracks: LibraryTrack[];
  albums: LibraryAlbum[];
  playlists: { id: string; title: string; description: string; artwork?: string; providerUri?: string; trackIds: string[] }[];
}

export interface RemoteState {
  active: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  uri?: string;
  device?: string;
  volume?: number;
  supportsVolume?: boolean;
}

export type PlaylistCover =
  | { kind: 'auto' }
  | { kind: 'image'; url: string }
  | { kind: 'track'; trackId: string }
  | { kind: 'collage'; url: string };

export interface PlaylistEntry {
  key: string;
  trackId: string;
  addedBy?: string;
  addedAt: number;
  /** Snapshot so an unavailable track still shows what it was. */
  title: string;
  artist: string;
}

export interface Playlist {
  id: string;
  title: string;
  description: string;
  cover: PlaylistCover;
  entries: PlaylistEntry[];
  createdAt: number;
  updatedAt: number;
  /** Set when imported from a provider; read-only mirror. */
  providerId?: string;
  shared?: { role: 'owner' | 'editor' | 'listener'; members: { name: string; role: 'owner' | 'editor' | 'listener' }[] };
  history?: { at: number; by: string; action: string }[];
}

export interface BridgeAPI {
  platform: string;
  version: string;
  library: {
    get(): Promise<LibraryIndex>;
    addFolder(): Promise<{ index: LibraryIndex; report: ScanReport } | null>;
    addFiles(): Promise<{ index: LibraryIndex; report: ScanReport } | null>;
    removeFolder(path: string): Promise<LibraryIndex>;
    rescan(): Promise<{ index: LibraryIndex; report: ScanReport }>;
    setOverride(trackId: string, values: Partial<LibraryTrack>): Promise<void>;
    onProgress(cb: (done: number, total: number) => void): () => void;
  };
  pickImage(): Promise<string | null>;
  pickLyrics(): Promise<{ name: string; text: string } | null>;
  pickVideo(): Promise<string | null>;
  saveDataUrl(name: string, dataUrl: string): Promise<string>;
  exportFile(name: string, text: string): Promise<boolean>;
  importFile(): Promise<string | null>;
  store: { get<T>(key: string, fallback: T): Promise<T>; set(key: string, value: unknown): Promise<void> };
  providers: {
    status(): Promise<ProviderStatus[]>;
    configure(id: ProviderId, values: Record<string, string>): Promise<void>;
    connect(id: ProviderId): Promise<void>;
    disconnect(id: ProviderId): Promise<void>;
    library(id: ProviderId): Promise<ProviderLibrary>;
    playlistTracks(id: string): Promise<LibraryTrack[]>;
    remote(cmd: unknown): Promise<RemoteState | null>;
  };
  lyrics: { lookup(q: { title: string; artist: string; album?: string; duration?: number }): Promise<string | null> };
  window: { toggleFullscreen(): Promise<boolean>; isFullscreen(): Promise<boolean>; onFullscreen(cb: (v: boolean) => void): () => void };
  openExternal(url: string): Promise<void>;
  clearCache(): Promise<void>;
}
