import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, basename, dirname } from 'node:path';
import { dataDir, readJson, writeJson } from './store';
import { mediaUrl } from './protocol';
import type { LibraryIndex, LibraryTrack, LibraryAlbum, ScanReport } from '../src/lib/types';

export const AUDIO_EXT = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.webm'];
export const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.mov', '.mkv'];
const LYRIC_EXT = ['.lrc'];

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

interface LibraryConfig {
  folders: string[];
  files: string[];
  /** Per-track user edits (title/artist/album/artwork). Original files are never modified. */
  overrides: Record<string, Partial<Pick<LibraryTrack, 'title' | 'artist' | 'album' | 'artwork' | 'videoUrl'>>>;
}

export async function getConfig(): Promise<LibraryConfig> {
  return readJson<LibraryConfig>('library-config', { folders: [], files: [], overrides: {} });
}
export async function saveConfig(c: LibraryConfig) {
  await writeJson('library-config', c);
}

async function walk(dir: string, out: string[], depth = 0) {
  if (depth > 12) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else out.push(p);
  }
}

export async function scan(onProgress?: (done: number, total: number) => void): Promise<{ index: LibraryIndex; report: ScanReport }> {
  const cfg = await getConfig();
  const files: string[] = [...cfg.files];
  for (const f of cfg.folders) await walk(f, files);
  const unique = [...new Set(files)];
  const media = unique.filter((f) => [...AUDIO_EXT, ...VIDEO_EXT].includes(extname(f).toLowerCase()));
  const lyricFiles = new Set(unique.filter((f) => LYRIC_EXT.includes(extname(f).toLowerCase())));
  const artDir = join(dataDir(), 'artwork');
  await fs.mkdir(artDir, { recursive: true });

  // The node entry of music-metadata (resolved by esbuild for the main process) exposes parseFile.
  const { parseFile } = (await import('music-metadata')) as unknown as { parseFile: (p: string, o?: object) => Promise<import('music-metadata').IAudioMetadata> };
  const tracks: LibraryTrack[] = [];
  const report: ScanReport = { scanned: 0, added: 0, failed: [], unsupported: 0 };
  const videosByStem = new Map<string, string>();
  for (const f of media) {
    if (VIDEO_EXT.includes(extname(f).toLowerCase())) videosByStem.set(stem(f), f);
  }

  let done = 0;
  for (const file of media) {
    done++;
    onProgress?.(done, media.length);
    report.scanned++;
    const ext = extname(file).toLowerCase();
    const isVideo = VIDEO_EXT.includes(ext) && !(ext === '.webm' && !videosByStem.has(stem(file)));
    // A video that shares its name with an audio file is that track's music video, not a separate item.
    if (isVideo && media.some((m) => m !== file && AUDIO_EXT.includes(extname(m).toLowerCase()) && stem(m) === stem(file))) continue;
    try {
      const meta = await parseFile(file, { duration: true, skipCovers: false });
      const c = meta.common;
      const id = `local:${hash(file)}`;
      let artwork: string | undefined;
      const pic = c.picture?.[0];
      if (pic) {
        const artPath = join(artDir, `${hash(file)}${pic.format.includes('png') ? '.png' : '.jpg'}`);
        try {
          await fs.access(artPath);
        } catch {
          await fs.writeFile(artPath, pic.data);
        }
        artwork = mediaUrl(artPath);
      } else {
        artwork = await folderArt(dirname(file));
      }
      const lrc = [...lyricFiles].find((l) => stem(l) === stem(file));
      const video = isVideo ? file : videosByStem.get(stem(file));
      const embedded = c.lyrics?.[0];
      const t: LibraryTrack = {
        id,
        source: 'local',
        title: c.title || basename(file, ext),
        artist: c.artist || c.albumArtist || 'Unknown artist',
        album: c.album || (isVideo ? 'Videos' : basename(dirname(file))),
        albumArtist: c.albumArtist || c.artist || undefined,
        number: c.trackNumber ?? undefined,
        disc: c.discNumber ?? undefined,
        year: c.year ?? undefined,
        duration: meta.format.duration ?? undefined,
        artwork,
        audioUrl: mediaUrl(file),
        videoUrl: video ? mediaUrl(video) : undefined,
        lyricsUrl: lrc ? mediaUrl(lrc) : undefined,
        embeddedLyrics: typeof embedded === 'string' ? embedded : (embedded as { text?: string } | undefined)?.text,
        path: file,
        isVideo,
        available: true,
      };
      Object.assign(t, cfg.overrides[id] ?? {});
      tracks.push(t);
      report.added++;
    } catch (err) {
      report.failed.push({ file, reason: (err as Error).message.slice(0, 160) });
    }
  }
  report.unsupported = unique.length - media.length - lyricFiles.size;
  const index: LibraryIndex = { tracks, albums: groupAlbums(tracks), scannedAt: Date.now(), folders: cfg.folders, files: cfg.files };
  await writeJson('library-index', index);
  return { index, report };
}

function stem(f: string) {
  return join(dirname(f), basename(f, extname(f))).toLowerCase();
}

async function folderArt(dir: string): Promise<string | undefined> {
  for (const name of ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg', 'album.jpg', 'Cover.jpg', 'Folder.jpg']) {
    const p = join(dir, name);
    try {
      await fs.access(p);
      return mediaUrl(p);
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

function groupAlbums(tracks: LibraryTrack[]): LibraryAlbum[] {
  const map = new Map<string, LibraryAlbum>();
  for (const t of tracks) {
    const key = `${(t.albumArtist ?? t.artist).toLowerCase()}::${t.album.toLowerCase()}`;
    const id = `local-album:${hash(key)}`;
    let a = map.get(id);
    if (!a) {
      a = { id, source: 'local', title: t.album, artist: t.albumArtist ?? t.artist, year: t.year, artwork: t.artwork, trackIds: [] };
      map.set(id, a);
    }
    a.artwork ??= t.artwork;
    a.trackIds.push(t.id);
    t.albumId = id;
  }
  const byId = new Map(tracks.map((t) => [t.id, t]));
  for (const a of map.values()) {
    a.trackIds.sort((x, y) => {
      const tx = byId.get(x)!, ty = byId.get(y)!;
      return (tx.disc ?? 1) - (ty.disc ?? 1) || (tx.number ?? 999) - (ty.number ?? 999) || tx.title.localeCompare(ty.title);
    });
  }
  return [...map.values()];
}

export async function loadIndex(): Promise<LibraryIndex> {
  const cfg = await getConfig();
  const idx = await readJson<LibraryIndex>('library-index', { tracks: [], albums: [], scannedAt: 0, folders: [], files: [] });
  return { ...idx, folders: cfg.folders, files: cfg.files };
}
