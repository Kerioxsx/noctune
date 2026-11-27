import { protocol } from 'electron';
import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { extname } from 'node:path';

/**
 * noctune://media/<base64url(path)> serves a local file the user added to the
 * library, with HTTP range support so video and audio can seek. Only paths
 * registered through the library (allow-list) are served.
 */
const allowed = new Set<string>();
const allowedRoots = new Set<string>();

export function allowPath(p: string) {
  allowed.add(p);
}
export function allowRoot(p: string) {
  allowedRoots.add(p.endsWith('/') || p.endsWith('\\') ? p : p + (p.includes('\\') ? '\\' : '/'));
}

export function mediaUrl(path: string) {
  allowed.add(path);
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
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' };
    if (url.host !== 'media') {
      const r = extra ? await extra(url, req) : null;
      return r ?? new Response('Not found', { status: 404, headers: cors });
    }
    let path: string;
    try {
      path = Buffer.from(url.pathname.slice(1), 'base64url').toString('utf8');
    } catch {
      return new Response('Bad request', { status: 400, headers: cors });
    }
    const permitted = allowed.has(path) || [...allowedRoots].some((r) => path.startsWith(r));
    if (!permitted) return new Response('Forbidden', { status: 403, headers: cors });
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
