import { protocol } from 'electron';
import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { extname, resolve, sep } from 'node:path';

/**
 * noctune://media/<base64url(path)> serves a local file the user added to the
 * library, with HTTP range support so video and audio can seek. Only paths
 * registered through the library (allow-list) are served.
 */
const allowed = new Set<string>();
const allowedRoots = new Set<string>();

/** Paths are compared fully resolved, so "folder/../.." can never step outside an allowed folder. */
export function allowPath(p: string) {
  allowed.add(resolve(p));
}
export function allowRoot(p: string) {
  const r = resolve(p);
  allowedRoots.add(r.endsWith(sep) ? r : r + sep);
}
function isAllowed(resolved: string) {
  return allowed.has(resolved) || [...allowedRoots].some((root) => resolved.startsWith(root));
}

export function mediaUrl(path: string) {
  allowed.add(resolve(path));
  return `noctune://media/${Buffer.from(path, 'utf8').toString('base64url')}`;
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.lrc': 'text/plain; charset=utf-8',
};

export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'noctune', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: false } },
  ]);
}

type Extra = (url: URL, req: Request) => Promise<Response | null>;

export function handleProtocol(extra?: Extra) {
  protocol.handle('noctune', async (req) => {
    const url = new URL(req.url);
    // Only the app's own page may read these responses. Embedded third-party frames
    // (the YouTube player) send their own origin and are refused.
    const origin = req.headers.get('origin');
    const dev = process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : null;
    const fromApp = !origin || origin === 'null' || origin === 'file://' || origin.startsWith('noctune://') || origin === dev;
    if (!fromApp) return new Response('Forbidden', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origin && origin !== 'null' ? origin : '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges', Vary: 'Origin' };
    if (url.host !== 'media') {
      const r = extra ? await extra(url, req) : null;
      return r ?? new Response('Not found', { status: 404, headers: cors });
    }
    let path: string;
    try {
      const raw = Buffer.from(url.pathname.slice(1), 'base64url').toString('utf8');
      if (!raw || raw.includes('\0')) throw new Error('bad path');
      path = resolve(raw);
    } catch {
      return new Response('Bad request', { status: 400, headers: cors });
    }
    if (!isAllowed(path)) return new Response('Forbidden', { status: 403, headers: cors });
    let size: number;
    try {
      size = (await fs.stat(path)).size;
    } catch {
      return new Response('Not found', { status: 404, headers: cors });
    }
    const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
    const range = req.headers.get('range');
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (!m[1] && m[2]) {
        start = Math.max(0, size - parseInt(m[2], 10));
        end = size - 1;
      }
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${size}` } });
      }
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
      return new Response(stream, {
        status: 206,
        headers: { ...cors, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
      });
    }
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new Response(stream, { status: 200, headers: { ...cors, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size) } });
  });
}
