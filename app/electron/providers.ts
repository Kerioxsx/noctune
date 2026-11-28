import { shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { getSecret, setSecret, readJson, writeJson, secureStorageAvailable } from './store';
import type { ProviderId, ProviderStatus, ProviderLibrary, LibraryTrack, LibraryAlbum, RemoteState } from '../src/lib/types';

/**
 * Provider adapters. Each talks only to the provider's official, documented
 * API using the provider's own sign-in page in the system browser (OAuth 2
 * Authorization Code + PKCE on a loopback redirect). The app never sees the
 * user's provider password. Tokens are kept in the OS credential store and
 * never sent to the renderer or written to logs.
 */

const REDIRECT_PORT = 43821;
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

interface ProviderConfig {
  spotify?: { clientId?: string };
  soundcloud?: { clientId?: string };
  apple?: { storefront?: string };
}
const cfg = () => readJson<ProviderConfig>('providers', {});

const b64url = (b: Buffer) => b.toString('base64url');

let activeServer: Server | null = null;

/**
 * Loopback listener for the OAuth redirect. It keeps listening until the real
 * callback (matching state, with a code) arrives: browsers can send early or
 * stray requests (prefetch, favicon, a reload of an old tab) and those must not
 * end the sign-in. Resolves `listening` once the port is open, so the browser is
 * only opened when the redirect can be received.
 */
function waitForCode(expectedState: string): { listening: Promise<void>; code: Promise<string> } {
  if (activeServer) {
    activeServer.close(); // a previous attempt that was abandoned
    activeServer.closeAllConnections();
  }
  let onListen!: () => void;
  let onListenErr!: (e: Error) => void;
  const listening = new Promise<void>((res, rej) => ((onListen = res), (onListenErr = rej)));
  const page = (msg: string) =>
    `<!doctype html><meta charset=utf-8><title>Noctune</title><body style="background:#0b0d0a;color:#e9e4d0;font:14px ui-monospace,monospace;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><p>${msg}</p></body>`;
  const code = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { Connection: 'close' }).end();
        return;
      }
      const c = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      if (state !== expectedState) {
        // an old tab or an early request: keep waiting for this sign-in
        res.end(page('This sign-in link has expired. Return to Noctune; the current sign-in is still waiting.'));
        return;
      }
      if (err) {
        res.end(page(err === 'access_denied' ? 'Access was declined. You can close this tab.' : `Sign-in failed (${err.replace(/[<>&"]/g, '')}). Return to Noctune and try again.`));
        finish();
        reject(new Error(err === 'access_denied' ? 'Access was declined.' : `The service refused the sign-in (${err}).`));
        return;
      }
      if (!c) {
        res.end(page('Still waiting for the sign-in to finish…'));
        return;
      }
      res.end(page('Connected. You can close this tab and return to Noctune.'));
      finish();
      resolve(c);
    });
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Sign-in timed out. Try connecting again.'));
    }, 5 * 60_000);
    const finish = () => {
      clearTimeout(timer);
      server.close();
      setTimeout(() => server.closeAllConnections(), 1000).unref();
      if (activeServer === server) activeServer = null;
    };
    server.on('error', (e) => {
      finish();
      const msg = `Could not open the sign-in callback on port ${REDIRECT_PORT}: ${(e as Error).message}`;
      onListenErr(new Error(msg));
      reject(new Error(msg));
    });
    server.listen(REDIRECT_PORT, '127.0.0.1', () => onListen());
    activeServer = server;
  });
  code.catch(() => undefined);
  return { listening, code };
}

async function pkceSignIn(authorizeUrl: string, params: Record<string, string>) {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const url = new URL(authorizeUrl);
  for (const [k, v] of Object.entries({ ...params, response_type: 'code', redirect_uri: REDIRECT_URI, code_challenge_method: 'S256', code_challenge: challenge, state })) {
    url.searchParams.set(k, v);
  }
  const wait = waitForCode(state);
  await wait.listening; // only open the browser once the redirect can be received
  await shell.openExternal(url.toString());
  const code = await wait.code;
  return { code, verifier };
}

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

async function tokenRequest(url: string, body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(body) });
  if (!res.ok) throw new Error(`Token request was refused (${res.status}).`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 };
}

async function saveTokens(p: ProviderId, t: Tokens) {
  const prev = await loadTokens(p);
  await setSecret(`${p}.tokens`, JSON.stringify({ ...t, refresh_token: t.refresh_token ?? prev?.refresh_token }));
}
async function loadTokens(p: ProviderId): Promise<Tokens | null> {
  const s = await getSecret(`${p}.tokens`);
  return s ? (JSON.parse(s) as Tokens) : null;
}

// ---------------------------------------------------------------- Spotify
const SPOTIFY_SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state user-read-currently-playing';

async function spotifyToken(): Promise<string> {
  const t = await loadTokens('spotify');
  if (!t) throw new Error('Spotify is not connected.');
  if (Date.now() < t.expires_at) return t.access_token;
  const clientId = (await cfg()).spotify?.clientId;
  if (!t.refresh_token || !clientId) throw new Error('Spotify sign-in expired. Reconnect in Settings → Connections.');
  try {
    const nt = await tokenRequest('https://accounts.spotify.com/api/token', { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: clientId });
    await saveTokens('spotify', nt);
    return nt.access_token;
  } catch {
    throw new Error('Spotify sign-in expired or was revoked. Reconnect in Settings → Connections.');
  }
}

async function spotify<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await spotifyToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (res.status === 204) return undefined as T;
  if (res.status === 401) throw new Error('Spotify sign-in expired. Reconnect in Settings → Connections.');
  if (res.status === 403) throw new Error('Spotify refused this action. Playback control requires Spotify Premium and an open Spotify app.');
  if (res.status === 404) throw new Error('No active Spotify device. Open Spotify on this computer or another device, then try again.');
  if (res.status === 429) throw new Error('Spotify is rate limiting requests. Try again in a moment.');
  if (!res.ok) throw new Error(`Spotify request failed (${res.status}).`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

type SpImage = { url: string; width?: number };
type SpTrack = { id: string; uri: string; name: string; duration_ms: number; track_number: number; disc_number: number; is_playable?: boolean; artists: { name: string }[]; album?: { id: string; name: string; images: SpImage[] } };

function spTrack(t: SpTrack, album?: { id: string; name: string; images: SpImage[] }): LibraryTrack {
  const al = album ?? t.album;
  return {
    id: `spotify:${t.id}`,
    source: 'spotify',
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    album: al?.name ?? '',
    albumId: al ? `spotify-album:${al.id}` : undefined,
    number: t.track_number,
    disc: t.disc_number,
    duration: t.duration_ms / 1000,
    artwork: al?.images?.[0]?.url,
    providerUri: t.uri,
    available: t.is_playable !== false,
  };
}

const nextPath = (n: string | null | undefined) => (n ? n.replace('https://api.spotify.com/v1', '') : null);

async function spotifyLibrary(): Promise<ProviderLibrary> {
  const tracks: LibraryTrack[] = [];
  const albums: LibraryAlbum[] = [];
  let next: string | null = '/me/albums?limit=50';
  let pages = 0;
  while (next && pages++ < 40) {
    const page: { items: { album: { id: string; name: string; uri: string; release_date: string; images: SpImage[]; artists: { name: string }[]; tracks: { items: SpTrack[] } } }[]; next: string | null } = await spotify(next);
    for (const { album } of page.items) {
      const ts = album.tracks.items.map((t) => spTrack(t, album));
      tracks.push(...ts);
      albums.push({ id: `spotify-album:${album.id}`, source: 'spotify', title: album.name, artist: album.artists.map((a) => a.name).join(', '), year: parseInt(album.release_date, 10) || undefined, artwork: album.images[0]?.url, trackIds: ts.map((t) => t.id), providerUri: album.uri });
    }
    next = nextPath(page.next);
  }
  // Liked Songs first, then every playlist. Songs load when a playlist is opened; the count shows now.
  const pls: ProviderLibrary['playlists'] = [];
  const liked = await spotify<{ total: number }>('/me/tracks?limit=1').catch(() => null);
  if (liked?.total) pls.push({ id: 'spotify-playlist:liked', title: 'Liked Songs', description: 'Your liked songs on Spotify', trackIds: [], total: liked.total });
  next = '/me/playlists?limit=50';
  pages = 0;
  while (next && pages++ < 40) {
    type Pl = { id: string; name: string; description: string; images: SpImage[] | null; uri: string; tracks?: { total: number }; items?: { total: number } };
    const page: { items: (Pl | null)[]; next: string | null } = await spotify(next);
    for (const p of page.items) {
      if (!p) continue;
      pls.push({ id: `spotify-playlist:${p.id}`, title: p.name, description: p.description, artwork: p.images?.[0]?.url, providerUri: p.uri, trackIds: [], total: p.items?.total ?? p.tracks?.total });
    }
    next = nextPath(page.next);
  }
  return { tracks, albums, playlists: pls };
}

/**
 * Every song in a playlist (or Liked Songs). Spotify has been moving playlist
 * contents from /tracks with a `track` field to /items with an `item` field, so
 * both are read. Episodes and local files (no id) are skipped.
 */
async function spotifyPlaylistTracks(id: string): Promise<LibraryTrack[]> {
  const pid = id.replace('spotify-playlist:', '');
  const out: LibraryTrack[] = [];
  type Entry = { track?: SpTrack | null; item?: SpTrack | null };
  const read = async (first: string) => {
    let next: string | null = first;
    let pages = 0;
    while (next && pages++ < 200) {
      const page: { items: Entry[]; next: string | null } = await spotify(next);
      for (const it of page.items ?? []) {
        const t = it.item ?? it.track;
        if (t && t.id && (t as SpTrack & { type?: string }).type !== 'episode') out.push(spTrack(t));
      }
      next = nextPath(page.next);
    }
  };
  if (pid === 'liked') {
    await read('/me/tracks?limit=50');
    return out;
  }
  try {
    await read(`/playlists/${pid}/items?limit=100&additional_types=track`);
  } catch (e) {
    if (out.length) throw e;
    await read(`/playlists/${pid}/tracks?limit=100&additional_types=track`);
  }
  if (!out.length) {
    // some accounts still only return the older shape
    await read(`/playlists/${pid}/tracks?limit=100&additional_types=track`).catch(() => undefined);
  }
  return out;
}

// ------------------------------------------------------------- SoundCloud
async function soundcloudToken(): Promise<string> {
  const t = await loadTokens('soundcloud');
  if (!t) throw new Error('SoundCloud is not connected.');
  if (Date.now() < t.expires_at) return t.access_token;
  const clientId = (await cfg()).soundcloud?.clientId;
  const secret = await getSecret('soundcloud.clientSecret');
  if (!t.refresh_token || !clientId || !secret) throw new Error('SoundCloud sign-in expired. Reconnect in Settings → Connections.');
  const nt = await tokenRequest('https://secure.soundcloud.com/oauth/token', { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: clientId, client_secret: secret });
  await saveTokens('soundcloud', nt);
  return nt.access_token;
}

async function soundcloud<T>(path: string): Promise<T> {
  const token = await soundcloudToken();
  const res = await fetch(path.startsWith('http') ? path : `https://api.soundcloud.com${path}`, { headers: { Authorization: `OAuth ${token}`, Accept: 'application/json; charset=utf-8' } });
  if (res.status === 401) throw new Error('SoundCloud sign-in expired. Reconnect in Settings → Connections.');
  if (!res.ok) throw new Error(`SoundCloud request failed (${res.status}).`);
  return (await res.json()) as T;
}

type ScTrack = { id: number; urn?: string; title: string; duration: number; artwork_url: string | null; streamable: boolean; access?: string; user: { username: string } };
function scTrack(t: ScTrack): LibraryTrack {
  const playable = t.streamable && (t.access ?? 'playable') === 'playable';
  return {
    id: `soundcloud:${t.id}`,
    source: 'soundcloud',
    title: t.title,
    artist: t.user.username,
    album: 'SoundCloud likes',
    duration: t.duration / 1000,
    artwork: t.artwork_url?.replace('-large', '-t500x500') ?? undefined,
    audioUrl: playable ? `noctune://soundcloud/${t.id}` : undefined,
    available: playable,
  };
}

async function soundcloudLibrary(): Promise<ProviderLibrary> {
  const likes = await soundcloud<{ collection: ScTrack[] }>('/me/likes/tracks?limit=200&linked_partitioning=true');
  const tracks = likes.collection.map(scTrack);
  const pls = await soundcloud<{ collection?: { id: number; title: string; description: string | null; artwork_url: string | null; tracks?: ScTrack[] }[] } | { id: number; title: string; description: string | null; artwork_url: string | null; tracks?: ScTrack[] }[]>('/me/playlists?limit=50&linked_partitioning=true');
  const list = Array.isArray(pls) ? pls : pls.collection ?? [];
  const playlists: ProviderLibrary['playlists'] = [];
  for (const p of list) {
    const pts = (p.tracks ?? []).map(scTrack);
    tracks.push(...pts.filter((t) => !tracks.some((x) => x.id === t.id)));
    playlists.push({ id: `soundcloud-playlist:${p.id}`, title: p.title, description: p.description ?? '', artwork: p.artwork_url?.replace('-large', '-t500x500') ?? undefined, trackIds: pts.map((t) => t.id) });
  }
  const albums: LibraryAlbum[] = tracks.length
    ? [{ id: 'soundcloud-album:likes', source: 'soundcloud', title: 'SoundCloud likes', artist: 'Your likes', artwork: tracks.find((t) => t.artwork)?.artwork, trackIds: likes.collection.map((t) => `soundcloud:${t.id}`) }]
    : [];
  return { tracks, albums, playlists };
}

/** Streams a SoundCloud track through the app so the user's token stays in the main process. */
export async function soundcloudStream(id: string, range: string | null): Promise<Response> {
  const streams = await soundcloud<{ http_mp3_128_url?: string; preview_mp3_128_url?: string }>(`/tracks/${encodeURIComponent(id)}/streams`);
  const url = streams.http_mp3_128_url;
  if (!url) return new Response('This track cannot be streamed by third-party apps.', { status: 403 });
  const token = await soundcloudToken();
  const upstream = await fetch(url, { headers: { Authorization: `OAuth ${token}`, ...(range ? { Range: range } : {}) } });
  const headers = new Headers({ 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg' });
  for (const h of ['content-length', 'content-range']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

// ----------------------------------------------------------- Apple Music
async function appleCheck(): Promise<void> {
  const dev = await getSecret('apple.developerToken');
  if (!dev) throw new Error('Add an Apple Music developer token first.');
  const res = await fetch('https://api.music.apple.com/v1/storefronts/us', { headers: { Authorization: `Bearer ${dev}` } });
  if (res.status === 401 || res.status === 403) throw new Error('Apple rejected the developer token. Check that it is a valid, unexpired MusicKit token.');
  if (!res.ok) throw new Error(`Apple Music request failed (${res.status}).`);
}

// ------------------------------------------------------------- public API
export async function status(): Promise<ProviderStatus[]> {
  const c = await cfg();
  const secure = await secureStorageAvailable();
  const sp = await loadTokens('spotify');
  const sc = await loadTokens('soundcloud');
  const apple = await getSecret('apple.developerToken');
  return [
    {
      id: 'spotify', name: 'Spotify', connected: !!sp, configured: !!c.spotify?.clientId, secureStorage: secure,
      needs: c.spotify?.clientId ? [] : ['clientId'],
      capabilities: ['Import saved albums and playlists with real cover art', 'Plays inside Noctune when this system supports Widevine, otherwise on your Spotify app', 'Opens the Spotify app by itself when no device is running', 'Seek, volume and repeat'],
      limitations: ['Needs Spotify Premium for playback', 'Spotify audio is protected, so the equalizer cannot process it', 'A song Spotify cannot play falls back to your own copy or SoundCloud'],
      redirectUri: REDIRECT_URI,
    },
    {
      id: 'apple', name: 'Apple Music', connected: !!apple, configured: !!apple, secureStorage: secure,
      needs: apple ? [] : ['developerToken'],
      capabilities: ['Validate a MusicKit developer token', 'Catalog metadata through the Apple Music API'],
      limitations: ['Apple Music audio is protected; songs play from your files, Spotify or SoundCloud instead', 'Personal library access needs a Music User Token from MusicKit sign-in'],
    },
    {
      id: 'soundcloud', name: 'SoundCloud', connected: !!sc, configured: !!c.soundcloud?.clientId, secureStorage: secure,
      needs: c.soundcloud?.clientId ? [] : ['clientId', 'clientSecret'],
      capabilities: ['Import your likes and playlists', 'Play tracks through the equalizer, with lyrics', 'Preview-only or blocked tracks fall back to your files or Spotify'],
      limitations: ['Requires your own registered SoundCloud app credentials'],
      redirectUri: REDIRECT_URI,
    },
  ];
}

export async function configure(id: ProviderId, values: Record<string, string>) {
  const c = await cfg();
  if (id === 'spotify') c.spotify = { ...c.spotify, clientId: values.clientId?.trim() };
  if (id === 'soundcloud') {
    c.soundcloud = { ...c.soundcloud, clientId: values.clientId?.trim() };
    if (values.clientSecret) await setSecret('soundcloud.clientSecret', values.clientSecret.trim());
  }
  if (id === 'apple' && values.developerToken) await setSecret('apple.developerToken', values.developerToken.trim());
  await writeJson('providers', c);
}

export async function connect(id: ProviderId) {
  if (!(await secureStorageAvailable())) throw new Error('Secure credential storage is unavailable, so Noctune will not store sign-in tokens. On Linux, install and unlock a keyring (GNOME Keyring or KWallet).');
  const c = await cfg();
  if (id === 'spotify') {
    const clientId = c.spotify?.clientId;
    if (!clientId) throw new Error('Add your Spotify app Client ID first.');
    const { code, verifier } = await pkceSignIn('https://accounts.spotify.com/authorize', { client_id: clientId, scope: SPOTIFY_SCOPES });
    await saveTokens('spotify', await tokenRequest('https://accounts.spotify.com/api/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier }));
  } else if (id === 'soundcloud') {
    const clientId = c.soundcloud?.clientId;
    const secret = await getSecret('soundcloud.clientSecret');
    if (!clientId || !secret) throw new Error('Add your SoundCloud app Client ID and Client Secret first.');
    const { code, verifier } = await pkceSignIn('https://secure.soundcloud.com/authorize', { client_id: clientId });
    await saveTokens('soundcloud', await tokenRequest('https://secure.soundcloud.com/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, client_secret: secret, code_verifier: verifier }));
  } else {
    await appleCheck();
  }
}

export async function disconnect(id: ProviderId) {
  await setSecret(`${id}.tokens`, null);
  if (id === 'apple') await setSecret('apple.developerToken', null);
  if (id === 'soundcloud') await setSecret('soundcloud.clientSecret', null);
}

export async function library(id: ProviderId): Promise<ProviderLibrary> {
  if (id === 'spotify') return spotifyLibrary();
  if (id === 'soundcloud') return soundcloudLibrary();
  return { tracks: [], albums: [], playlists: [] };
}

export async function playlistTracks(id: string): Promise<LibraryTrack[]> {
  if (id.startsWith('spotify-playlist:')) return spotifyPlaylistTracks(id);
  return [];
}

/** Spotify Connect remote control. */
export async function remote(cmd: { op: 'play'; uris?: string[]; context?: string; offset?: number; positionMs?: number; deviceId?: string } | { op: 'pause' | 'resume' | 'state' | 'devices' } | { op: 'seek'; ms: number } | { op: 'volume'; pct: number } | { op: 'repeat'; mode: 'off' | 'context' | 'track' }): Promise<RemoteState | null> {
  switch (cmd.op) {
    case 'play': {
      const body: Record<string, unknown> = {};
      if (cmd.context) {
        body.context_uri = cmd.context;
        if (cmd.offset !== undefined) body.offset = { position: cmd.offset };
      } else if (cmd.uris) body.uris = cmd.uris;
      if (cmd.positionMs) body.position_ms = cmd.positionMs;
      const q = cmd.deviceId ? `?device_id=${encodeURIComponent(cmd.deviceId)}` : '';
      await spotify(`/me/player/play${q}`, { method: 'PUT', body: JSON.stringify(body) });
      return null;
    }
    case 'devices': {
      const d = await spotify<{ devices: { id: string; name: string; is_active: boolean; is_restricted: boolean }[] }>('/me/player/devices');
      return (d?.devices ?? []).filter((x) => !x.is_restricted) as unknown as RemoteState;
    }
    case 'resume':
      await spotify('/me/player/play', { method: 'PUT' });
      return null;
    case 'pause':
      await spotify('/me/player/pause', { method: 'PUT' });
      return null;
    case 'seek':
      await spotify(`/me/player/seek?position_ms=${Math.max(0, Math.round(cmd.ms))}`, { method: 'PUT' });
      return null;
    case 'volume':
      await spotify(`/me/player/volume?volume_percent=${Math.round(Math.max(0, Math.min(100, cmd.pct)))}`, { method: 'PUT' });
      return null;
    case 'repeat':
      await spotify(`/me/player/repeat?state=${cmd.mode}`, { method: 'PUT' });
      return null;
    case 'state': {
      const s = await spotify<{ is_playing: boolean; progress_ms: number; item?: { uri: string; duration_ms: number }; device?: { name: string; volume_percent: number | null; supports_volume?: boolean } } | undefined>('/me/player');
      if (!s) return { active: false, playing: false, positionMs: 0, durationMs: 0 };
      return { active: true, playing: s.is_playing, positionMs: s.progress_ms, durationMs: s.item?.duration_ms ?? 0, uri: s.item?.uri, device: s.device?.name, volume: s.device?.volume_percent ?? undefined, supportsVolume: s.device?.supports_volume !== false };
    }
  }
}
