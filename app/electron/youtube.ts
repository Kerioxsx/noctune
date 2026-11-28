import { app, BrowserWindow, session, shell, type WebContents } from 'electron';

/**
 * YouTube: finding a song's official video, and the private browser session that
 * plays YouTube's page inside Noctune (see YouTubeBackend in the renderer).
 *
 * The session is separate from the app's own: YouTube's page never gets Noctune's
 * bridge, cannot open windows, and can only navigate within YouTube and Google's
 * sign-in/consent pages. Signing in is optional and happens on Google's own page;
 * Noctune never sees the password, only whether a YouTube sign-in cookie exists.
 */
export const PARTITION = 'persist:youtube';
const yt = () => session.fromPartition(PARTITION);

const ALLOWED_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|google\.com|google\.[a-z.]+|gstatic\.com|googleusercontent\.com|ggpht\.com|youtu\.be)$/;
const hostOk = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname);
  } catch {
    return false;
  }
};

let prepared = false;
export async function prepareSession() {
  if (prepared) return;
  prepared = true;
  const ses = yt();
  // YouTube needs nothing from the device: no camera, microphone, location or notifications.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  // Present as the Chromium browser it is, without the app's name.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(noctune|Electron)\/\S+/gi, ''));
  // Cookie choice for regions that ask: only the necessary cookies ("Reject all").
  const consent = await ses.cookies.get({ url: 'https://www.youtube.com', name: 'SOCS' }).catch(() => []);
  if (!consent.length) {
    await ses.cookies
      .set({ url: 'https://www.youtube.com', domain: '.youtube.com', name: 'SOCS', value: 'CAI', secure: true, sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + 400 * 86400 })
      .catch(() => undefined);
  }
}

/** Rules for the <webview> that shows YouTube's page; applied by the main window. */
export function guardWebviews(host: WebContents) {
  host.on('will-attach-webview', (e, prefs, params) => {
    if (!/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}(&t=\d+s)?$/.test(params.src ?? '')) {
      e.preventDefault();
      return;
    }
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    prefs.autoplayPolicy = 'no-user-gesture-required';
    params.partition = PARTITION;
    delete (params as { allowpopups?: string }).allowpopups;
  });
  host.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      // links inside the page (channel, "watch on YouTube") open in the real browser
      if (hostOk(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (!hostOk(url)) e.preventDefault();
    });
    wc.on('did-fail-load', (_e, code, desc, url, main) => {
      if (main && code !== -3) console.error('[youtube] page did not load:', code, desc, url);
    });
    wc.on('will-redirect', (e, url) => {
      if (!hostOk(url)) e.preventDefault();
    });
  });
}

// ------------------------------------------------------------- sign-in
export async function signedIn() {
  const cookies = await yt().cookies.get({ domain: '.youtube.com' }).catch(() => []);
  return cookies.some((c) => c.name === 'LOGIN_INFO' || c.name === '__Secure-3PSID' || c.name === 'SAPISID');
}

let signInWin: BrowserWindow | null = null;
export function signIn(parent?: BrowserWindow | null): Promise<boolean> {
  if (signInWin) {
    signInWin.focus();
    return new Promise((r) => signInWin!.once('closed', () => void signedIn().then(r)));
  }
  const w = new BrowserWindow({
    width: 480,
    height: 680,
    parent: parent ?? undefined,
    title: 'Sign in to YouTube',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  signInWin = w;
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e, url) => {
    if (!hostOk(url)) e.preventDefault();
  });
  const done = () => {
    if (!w.isDestroyed()) w.close();
  };
  // back on YouTube with a sign-in cookie: finished
  w.webContents.on('did-navigate', async (_e, url) => {
    if (/^https:\/\/(www|m)\.youtube\.com\//.test(url) && (await signedIn())) done();
  });
  void w.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&continue=' + encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=%2F'));
  return new Promise((resolve) => {
    w.once('closed', () => {
      signInWin = null;
      void signedIn().then(resolve);
    });
  });
}

export async function signOut() {
  await yt().clearStorageData();
  await yt().clearCache();
  prepared = false;
  await prepareSession();
}

export async function clearAll() {
  await yt().clearStorageData();
  await yt().clearCache();
}

// ------------------------------------------------------------- search
export interface VideoQuery {
  title: string;
  artist: string;
  duration?: number;
}
type Run = { text: string };
type Renderer = {
  videoId: string;
  title?: { runs?: Run[] };
  ownerText?: { runs?: Run[] };
  lengthText?: { simpleText?: string };
  ownerBadges?: { metadataBadgeRenderer?: { style?: string } }[];
};

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const secs = (t?: string) => (t ? t.split(':').reduce((a, x) => a * 60 + (parseInt(x, 10) || 0), 0) : 0);
const UNWANTED = /\b(lyrics?|lyric video|audio|visuali[sz]er|live|cover|karaoke|instrumental|reaction|8d|slowed|sped up|nightcore|remix|fan ?made|tutorial|teaser|trailer|behind the scenes|making of|performance)\b/;

/**
 * The song's official music video on YouTube, by searching the way YouTube's own
 * website does. Only uploads by the artist (verified artist badge, the artist's name
 * or their VEVO channel) count, and the title must name the song.
 */
export async function searchOfficialVideo(q: VideoQuery): Promise<string | null> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': `Mozilla/5.0 Noctune/${app.getVersion()}` },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20251120.01.00', hl: 'en', gl: 'US' } },
      query: `${q.artist} ${q.title} official music video`,
      params: 'EgIQAQ%3D%3D', // videos only
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: unknown = await res.json();
  const found: Renderer[] = [];
  const walk = (o: unknown, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 40 || found.length > 25) return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1));
    const r = (o as { videoRenderer?: Renderer }).videoRenderer;
    if (r?.videoId) found.push(r);
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(data);
  const title = words(q.title);
  const artist = words(q.artist);
  const songUnwanted = UNWANTED.test(title);
  let best: { id: string; score: number } | null = null;
  found.forEach((r, i) => {
    if (!/^[\w-]{11}$/.test(r.videoId)) return;
    const vt = words(r.title?.runs?.map((x) => x.text).join('') ?? '');
    const owner = words(r.ownerText?.runs?.[0]?.text ?? '');
    const verified = (r.ownerBadges ?? []).some((b) => b.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST');
    const byArtist = verified || owner === artist || owner.replace(/ ?vevo$/, '') === artist.replace(/ /g, '') || owner.replace(/ ?vevo$/, '') === artist || owner === `${artist} topic`;
    if (!byArtist || !vt.includes(title)) return;
    if (!songUnwanted && UNWANTED.test(vt.replace(title, ''))) return;
    const len = secs(r.lengthText?.simpleText);
    if (q.duration && len && (len < q.duration - 25 || len > q.duration + 300)) return;
    let score = 10 - i; // YouTube's own ranking
    if (/official (music )?video|music video|\bmv\b/.test(vt)) score += 20;
    if (/official/.test(vt)) score += 5;
    if (owner.endsWith(' topic')) score -= 15; // an album track still image, not a video
    if (!best || score > best.score) best = { id: r.videoId, score };
  });
  return (best as { id: string } | null)?.id ?? null;
}
