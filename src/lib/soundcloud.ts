/**
 * SoundCloud API client with built-in rate-limit protection.
 *
 * SoundCloud's public API requires a `client_id` on every call. There is no
 * official login endpoint, so we:
 *   1. scrape the client_id from soundcloud.com's own JS bundles,
 *   2. cache it for hours (fallback to disk),
 *   3. funnel every request through a token-bucket queue with a hard cap on
 *      concurrent in-flight requests,
 *   4. honour Retry-After / exponential backoff on 429 and 5xx,
 *   5. memoise responses with TTLs so repeat views cost zero API calls.
 */

const API_BASE = 'https://api-v2.soundcloud.com';
const SCRAPE_BASE = 'https://soundcloud.com';
/** Playback history, owned by the data layer so "clear history" can reach it. */
const HISTORY_KEY = 'sc9000:history';

import type { Track, Playlist, User, WebProfile } from '../types';

const CLIENT_ID_RE = /(?:client_id|clientId)\s*[:=]\s*["']([A-Za-z0-9_-]{20,})["']/g;
const SCRIPTS_RE = /<script[^>]+src="([^"]+)"/g;

export const CLIENT_ID_TTL = 6 * 60 * 60 * 1000; // 6h
export const FALLBACK_CLIENT_IDS = [
  'dkevB9EsY4jIoSm8RfddPNUKyn6hurXF',
  '2t9loNfh0ekOf4AwijdOETPR1cu1rqAV',
  'a3e059563d7fd3372b49b37f00a00bcf',
];
export const FALLBACK_CLIENT_ID = FALLBACK_CLIENT_IDS[0];
const CACHE_PREFIX = 'sc9000:';

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

function readCache<T>(key: string): T | null {
  const now = Date.now();
  const hit = memoryCache.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  if (hit) memoryCache.delete(key);

  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (parsed.expires <= now) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    memoryCache.set(key, parsed);
    return parsed.value;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T, ttl: number): void {
  const entry: CacheEntry<T> = { value, expires: Date.now() + ttl };
  memoryCache.set(key, entry);
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota exceeded - memory cache still works */
  }
}

/* ------------------------------------------------------------------ *
 * Request queue: caps concurrency so we never burst the API.
 * ------------------------------------------------------------------ */

const MIN_GAP_MS = 120; // min spacing between requests
const MAX_CONCURRENT = 2;

let active = 0;
const pending: Array<() => void> = [];
let lastRequestAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt = Date.now();
      active++;
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      } finally {
        active--;
        const next = pending.shift();
        if (next) next();
      }
    };

    if (active < MAX_CONCURRENT) void run();
    else pending.push(run);
  });
}

/* ------------------------------------------------------------------ *
 * client_id discovery
 * ------------------------------------------------------------------ */

export interface Credentials {
  clientId: string;
  authToken?: string;
}

let creds: Credentials = { clientId: '' };
let credsResolvedAt = 0;

async function fetchClientId(): Promise<string> {
  const cached = readCache<string>('clientId');
  if (cached) return cached;

  const scrapeTask = async (): Promise<string | null> => {
    try {
      const page = await httpGet(`${SCRAPE_BASE}/`);
      if (!page.ok) return null;

      const scriptSrcs: string[] = [];
      let m: RegExpExecArray | null;
      SCRIPTS_RE.lastIndex = 0;
      while ((m = SCRIPTS_RE.exec(page.text))) scriptSrcs.push(m[1]);

      // The client_id is also inlined directly in the page markup on some
      // deployments, so check that before spending requests on the bundles.
      CLIENT_ID_RE.lastIndex = 0;
      const inline = CLIENT_ID_RE.exec(page.text);
      if (inline) {
        return inline[1];
      }

      // Probe the site's own bundles.
      const targets = scriptSrcs
        .filter((s) => s.includes('scdn') || s.includes('assets'))
        .filter((s) => s.endsWith('.js'))
        .slice(0, 20);

      const probeOrder = [...targets].reverse();

      for (const src of probeOrder) {
        try {
          const js = await schedule(() => httpGet(src.startsWith('http') ? src : `${SCRAPE_BASE}${src}`));
          if (!js.ok) continue;
          CLIENT_ID_RE.lastIndex = 0;
          const found = CLIENT_ID_RE.exec(js.text);
          if (found) {
            return found[1];
          }
        } catch {
          /* try next bundle */
        }
      }
    } catch (err) {
      console.warn('[soundcloud] Failed to scrape client_id:', err);
    }
    return null;
  };

  // Bound scraping time to 3.5s so startup is always fast and responsive
  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
  const discovered = await Promise.race([scrapeTask(), timeoutPromise]);

  if (discovered) {
    writeCache('clientId', discovered, CLIENT_ID_TTL);
    return discovered;
  }

  // Graceful fallback: use verified client_id so the app functions immediately
  writeCache('clientId', FALLBACK_CLIENT_ID, 2 * 60 * 60 * 1000);
  return FALLBACK_CLIENT_ID;
}

export async function getCredentials(): Promise<Credentials> {
  const stale = Date.now() - credsResolvedAt < CLIENT_ID_TTL;
  if (creds.clientId && stale) return creds;
  try {
    const clientId = await fetchClientId();
    creds = { clientId, authToken: creds.authToken };
    credsResolvedAt = Date.now();
    return creds;
  } catch {
    creds = { clientId: FALLBACK_CLIENT_ID, authToken: creds.authToken };
    credsResolvedAt = Date.now();
    return creds;
  }
}

export function setAuthToken(token: string): void {
  creds = { ...creds, authToken: token };
  credsResolvedAt = 0;
  writeCache('authToken', token, 30 * 24 * 60 * 60 * 1000);
}

export function restoreAuthToken(): string | null {
  const token = readCache<string>('authToken');
  if (token) creds = { ...creds, authToken: token };
  return token ?? null;
}

export function hasAuthToken(): boolean {
  return Boolean(creds.authToken);
}

export function clearAuthToken(): void {
  creds = { ...creds, authToken: undefined };
  memoryCache.delete('authToken');
  try {
    localStorage.removeItem(CACHE_PREFIX + 'authToken');
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Transport
 *
 * In Electron the renderer is served from file://, so CORS blocks direct
 * calls to api-v2.soundcloud.com. Requests are relayed through the main
 * process, which also attaches the login cookies from the default session.
 * Outside Electron we fall back to plain fetch (dev server / browser).
 * ------------------------------------------------------------------ */

interface RelayResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text: string;
  error?: string;
}

const relay = () => (typeof window !== 'undefined' ? window.desktop : undefined);

/**
 * Headers that authenticate a write.
 *
 * SoundCloud accepts the session either as an `oauth_token` query parameter or
 * as an `Authorization: OAuth <token>` header, and it answers 401 when the
 * token only survives the first half of that pair - which is exactly what every
 * "like silently fails" report looked like. Both are sent from here on.
 */
function authHeaders(): Record<string, string> {
  const token = creds.authToken;
  if (!token || token === '__cookie_session__') return {};
  return { Authorization: `OAuth ${token}` };
}

export class TransportError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TransportError';
  }
}

/**
 * A mutation that needs an account was attempted with no session at all.
 *
 * Separate from `AuthExpiredError` because the remedy is different: a missing
 * session means "sign in", while an expired one means "sign in again".
 */
export class NotSignedInError extends Error {
  constructor(what = 'This action') {
    super(`${what} needs a SoundCloud account - connect one first`);
    this.name = 'NotSignedInError';
  }
}

async function httpGet(url: string): Promise<RelayResponse> {
  const bridge = relay();
  if (bridge) return bridge.fetch(url);

  const res = await fetch(url);
  return {
    ok: res.ok,
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text: await res.text(),
  };
}

async function httpSend(
  url: string,
  method: string,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<RelayResponse> {
  const bridge = relay();
  const payload = body === undefined || body === null ? null : JSON.stringify(body);
  const headers: Record<string, string> = payload
    ? { 'Content-Type': 'application/json', ...extraHeaders }
    : { ...extraHeaders };

  if (bridge) return bridge.fetch(url, { method, headers, body: payload });

  const res = await fetch(url, {
    method,
    headers,
    body: payload ?? undefined,
  });
  return {
    ok: res.ok,
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text: await res.text(),
  };
}

/* ------------------------------------------------------------------ *
 * Core fetch with backoff
 * ------------------------------------------------------------------ */

export class RateLimitError extends Error {
  constructor(public readonly retryAfter: number) {
    super('Rate limited by SoundCloud');
    this.name = 'RateLimitError';
  }
}

/** A genuinely missing resource (404/403), e.g. a bad permalink. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** The saved session is no longer accepted; the user must sign in again. */
export class AuthExpiredError extends Error {
  constructor() {
    super('SoundCloud rejected the saved session. Please sign in again.');
    this.name = 'AuthExpiredError';
  }
}

/**
 * SoundCloud answers 401 and 500 even for valid tokens when it is shedding
 * load, so both are retried. Only a run of consecutive 401s is treated as a
 * genuinely dead session.
 */
const MAX_RETRIES = 3;
const TRANSIENT_STATUSES = new Set([401, 429, 500, 502, 503, 504]);

interface RequestOpts {
  method?: string;
  body?: unknown;
  /** Sends the session and fails fast with `NotSignedInError` when absent. */
  auth?: boolean;
}

async function request<T>(path: string, ttl: number, opts: RequestOpts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  // Cookie-session is also a valid "auth" - it means the login cookies are set
  const effectiveToken = creds.authToken === '__cookie_session__' ? null : creds.authToken;
  if (opts.auth && !creds.authToken) throw new NotSignedInError();

  const key = `${method} ${path}`;
  if (method === 'GET') {
    const hit = readCache<T>(key);
    if (hit) return hit;
  }

  let attempt = 0;
  for (;;) {
    const { clientId } = await getCredentials();
    const qs = new URLSearchParams();
    qs.set('client_id', clientId);
    if (effectiveToken) qs.set('oauth_token', effectiveToken);
    const [base, query] = path.split('?');
    if (query) {
      for (const [k, v] of new URLSearchParams(query)) qs.set(k, v);
    }
    const url = `${API_BASE}${base}?${qs.toString()}`;

    let res: RelayResponse;
    try {
      res = await schedule(() => httpSend(url, method, opts.body, authHeaders()));
    } catch (err) {
      if (attempt++ >= MAX_RETRIES) throw err;
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (res.error) {
      if (attempt++ >= MAX_RETRIES) throw new TransportError(res.error);
      await sleep(500 * 2 ** attempt);
      continue;
    }

    /**
     * A 401 against a real session is not load shedding - the token is dead -
     * so it gets one retry rather than three, and then reports itself. Sitting
     * through seven seconds of backoff before admitting the token was rejected
     * is what made every failed like look like a hang.
     */
    if (res.status === 401) {
      if (attempt++ >= 1) throw new AuthExpiredError();
      await sleep(400);
      continue;
    }

    if (TRANSIENT_STATUSES.has(res.status)) {
      if (attempt++ >= MAX_RETRIES) {
        if (res.status === 429 || res.status === 503) throw new RateLimitError(parseRetryAfter(res));
        throw new Error(`SoundCloud API ${res.status}`);
      }
      const header = res.headers['retry-after'];
      const wait = header ? parseInt(header, 10) * 1000 : 700 * 2 ** attempt;
      await sleep(Math.min(wait, 15_000));
      continue;
    }

    if (res.status === 403) {
      let msg = 'SoundCloud rejected this action (Forbidden 403)';
      try {
        const parsed = JSON.parse(res.text);
        if (typeof parsed?.message === 'string' && parsed.message) msg = parsed.message;
        else if (typeof parsed?.error === 'string' && parsed.error) msg = parsed.error;
        else if (typeof parsed?.error?.message === 'string' && parsed.error.message)
          msg = parsed.error.message;
        else if (typeof parsed?.status === 'string' && parsed.status) msg = parsed.status;
      } catch {
        // Not JSON - fall through to the raw body below.
      }
      /**
       * A write with no OAuth token is the cookie-only session. It can read
       * fine but SoundCloud refuses every mutation with 403, and the only fix
       * is a fresh sign-in that captures a real token - so say that instead of
       * echoing a bare "Forbidden".
       */
      if (opts.auth && !effectiveToken) {
        msg = 'SoundCloud refused the write because the session has no token. Sign out and sign in again.';
      } else if (res.text && (res.text.includes('captcha-delivery.com') || res.text.includes('initialCid') || res.text.includes('datadome'))) {
        msg = 'SoundCloud bot protection triggered. Please check your connection or wait a few seconds and try again.';
      } else if (msg.startsWith('SoundCloud rejected this action') && res.text) {
        // Keep SoundCloud's own wording visible when we could not parse it, so
        // the reason is not silently swallowed.
        msg = `${msg} - ${res.text.slice(0, 160)}`;
      }
      throw new Error(msg);
    }

    if (res.status === 404) {
      throw new NotFoundError(`SoundCloud has no such resource (404)`);
    }

    if (!res.ok) throw new Error(`SoundCloud API ${res.status}`);

    let data: T;
    try {
      data = res.text ? (JSON.parse(res.text) as T) : ({} as T);
    } catch {
      throw new Error('Malformed response from SoundCloud');
    }
    if (method === 'GET') writeCache(key, data, ttl);
    return data;
  }
}

function parseRetryAfter(res: RelayResponse): number {
  const h = res.headers['retry-after'];
  return h ? parseInt(h, 10) * 1000 : 5000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Mapping helpers
 * ------------------------------------------------------------------ */

export interface ScUser {
  id: number;
  username: string;
  full_name: string;
  avatar_url: string;
  permalink_url: string;
  followers_count?: number;
  followings_count?: number;
  track_count?: number;
  city?: string;
  country_code?: string;
  created_at?: string;
  description?: string;
}

export interface ScTrack {
  id: number;
  title: string;
  duration: number;
  permalink_url: string;
  artwork_url?: string;
  genre?: string;
  description?: string;
  play_count?: number;
  playback_count?: number;
  likes_count?: number;
  reposts_count?: number;
  full_duration?: number;
  media?: {
    transcodings: Array<{
      url: string;
      preset?: string;
      duration?: number;
      format: { protocol: string; mime_type: string };
      snipped?: boolean;
    }>;
  };
  /**
   * Availability flag. `SNIP` means SoundCloud only serves a 30 second preview
   * (geo-restricted or uploader/label limited), `BLOCK` means no link at all.
   */
  policy?: StreamPolicy;
  user: ScUser;
  created_at?: string;
}

export interface ScPlaylist {
  id: number;
  title: string;
  description?: string;
  artwork_url?: string;
  track_count: number;
  permalink_url: string;
  user: ScUser;
  tracks?: ScTrack[];
}

export interface ScComment {
  id: number;
  body: string;
  created_at: string;
  timestamp?: number;
  user: ScUser;
  track_id: number;
}

export interface ScCollection<T> {
  collection: T[];
  next_href: string | null;
}

/** One entry of `/users/:id/likes`: a like wrapping the liked track. */
export interface ScTrackLike {
  kind: 'like';
  created_at: string;
  track: ScTrack;
}

export function mapUser(u: ScUser): User {
  return {
    id: String(u.id),
    username: u.username,
    fullName: u.full_name || u.username,
    avatarUrl: u.avatar_url?.replace('-large.jpg', '-t500x500.jpg') ?? '',
    permalinkUrl: u.permalink_url,
    followersCount: u.followers_count ?? 0,
    followingsCount: u.followings_count,
    trackCount: u.track_count ?? 0,
    location: [u.city, u.country_code].filter(Boolean).join(', '),
    createdAt: u.created_at ?? '',
    description: u.description ?? '',
  };
}

export function fmtTime(secs: number): string {
  if (!secs || secs < 0) return '0:00';
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function mapTrack(t: ScTrack): Track {
  // Large playlists contain removed tracks: no title, no user, no media.
  const user = t.user ?? ({} as ScUser);
  // SoundCloud API v2 returns duration in milliseconds (e.g. 129091 for 2:09).
  // Duration is converted to seconds for consistency across audio engine and UI.
  const isPreview = t.policy === 'SNIP';
  const displayMs = (isPreview && t.full_duration) ? t.full_duration : (t.duration || 0);
  const durationSec = displayMs ? Math.round(displayMs / 1000) : 0;
  return {
    id: String(t.id),
    title: t.title || 'Unavailable track',
    artist: user.username || 'Unknown artist',
    artistUrl: user.permalink_url ?? '',
    artistId: user.id ? String(user.id) : undefined,
    duration: durationSec,
    durationFormatted: fmtTime(durationSec),
    artwork: t.artwork_url ?? '',
    genre: t.genre || 'SoundCloud',
    description: t.description ?? '',
    permalinkUrl: t.permalink_url ?? '',
    playsCount: t.playback_count ?? t.play_count ?? 0,
    likesCount: t.likes_count ?? 0,
    repostsCount: t.reposts_count ?? 0,
    createdAt: t.created_at ?? '',
    /**
     * A `SNIP` track's metadata duration is the preview length (30s), not the
     * real running time, so the UI can label it instead of looking like a track
     * that mysteriously ends early.
     */
    previewOnly: t.policy === 'SNIP',
    isLiked: false,
  };
}

export function mapPlaylistMeta(p: ScPlaylist): Playlist {
  return {
    id: String(p.id),
    title: p.title,
    description: p.description ?? '',
    artwork: p.artwork_url?.replace('-large.jpg', '-t500x500.jpg') ?? '',
    trackCount: p.track_count,
    permalinkUrl: p.permalink_url,
    owner: mapUser(p.user),
    tracks: [],
  };
}

/* ------------------------------------------------------------------ *
 * Public API surface
 * ------------------------------------------------------------------ */

const LONG = 60 * 60 * 1000;
const MED = 15 * 60 * 1000;
const SHORT = 5 * 60 * 1000;

/** `/tracks?ids=` accepts at most 50 ids; 51+ answers 400. */
const HYDRATE_BATCH = 50;

export const sc = {
  search(
    query: string,
    kind: 'tracks' | 'users' | 'playlists' | 'albums' = 'tracks',
    limit = 24
  ) {
    return request<{ collection: Array<ScTrack | ScUser | ScPlaylist> }>(
      `/search/${kind}?q=${encodeURIComponent(query)}&limit=${limit}`,
      MED
    );
  },

  searchTracks(query: string, limit = 30) {
    return request<{ collection: ScTrack[] }>(
      `/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}`,
      MED
    );
  },

  searchUsers(query: string, limit = 12) {
    return request<{ collection: ScUser[] }>(
      `/search/users?q=${encodeURIComponent(query)}&limit=${limit}`,
      MED
    );
  },

  searchPlaylists(query: string, limit = 12) {
    return request<{ collection: ScPlaylist[] }>(
      `/search/playlists?q=${encodeURIComponent(query)}&limit=${limit}`,
      MED
    );
  },

  /**
   * Tracks SoundCloud itself considers related to the given one.
   *
   * This is the same feed the web player shows under "More like this", so the
   * results stay on-genre: measured across hyperpop/techno/jazz/hardstyle it
   * returned 20 playable tracks per seed, with no duplicates and never the seed
   * itself. The only noise is the occasional track by the same artist, so those
   * are pushed to the back rather than dropped, which keeps the list full.
   */
  async related(track: { id: string; artistId?: string | number }, limit = 20) {
    const res = await request<{ collection: ScTrack[] }>(
      `/tracks/${track.id}/related?limit=${Math.min(limit, 50)}`,
      MED
    );

    // The wire format uses numeric ids while the app's Track keeps them as
    // strings, so both sides are normalised before comparing.
    const seen = new Set<string>([String(track.id)]);
    const seedArtist = track.artistId == null ? null : String(track.artistId);
    const other: ScTrack[] = [];
    const sameArtist: ScTrack[] = [];

    for (const t of res.collection) {
      if (seen.has(String(t.id))) continue;
      seen.add(String(t.id));
      (seedArtist !== null && String(t.user?.id) === seedArtist ? sameArtist : other).push(t);
    }

    return { collection: [...other, ...sameArtist].slice(0, limit) };
  },

  /**
   * The trending / most-played chart for a genre.
   *
   * This is the one recommendation surface SoundCloud exposes without a seed,
   * which is what lets the Discover feed show something for a brand new account
   * (and a signed-out one). Each entry wraps the track in a `{ track }` object,
   * unlike every other collection endpoint. `genre` is a URN such as
   * `soundcloud:genres:all-music`; a bare word is not accepted.
   */
  charts(
    kind: 'trending' | 'top' = 'trending',
    genre = 'soundcloud:genres:all-music',
    limit = 24
  ) {
    return request<{ collection: Array<{ track: ScTrack }> }>(
      `/charts?kind=${kind}&genre=${genre}&limit=${Math.min(limit, 50)}`,
      SHORT
    );
  },

  /** Authenticated only: the account behind the current oauth_token. */
  me() {
    return request<ScUser>('/me', SHORT);
  },

  /**
   * `/resolve` only accepts absolute URLs; a bare username returns 404.
   * Anything that is not already a soundcloud.com link is wrapped first.
   */
  userByPermalink(permalink: string) {
    const term = /^(https?:)?\/\/?(www\.)?soundcloud\.com\//i.test(permalink)
      ? (/^https?:/i.test(permalink) ? permalink : `https://${permalink}`)
      : `https://soundcloud.com/${permalink.replace(/^@/, '')}`;
    return request<ScUser>(`/resolve?url=${encodeURIComponent(term)}`, MED);
  },

  /** Fetches full user details by numeric ID. */
  user(userId: string | number) {
    const id = String(userId).replace(/^soundcloud:users:/, '');
    return request<ScUser>(`/users/${id}`, MED);
  },

  /** External web profiles (social links, websites) for a user. */
  async userWebProfiles(userId: string | number): Promise<WebProfile[]> {
    const rawId = String(userId).replace(/^soundcloud:users:/, '');
    const urn = `soundcloud:users:${rawId}`;
    try {
      const res = await request<WebProfile[]>(`/users/${encodeURIComponent(urn)}/web-profiles`, MED);
      return Array.isArray(res) ? res : [];
    } catch {
      try {
        const res = await request<WebProfile[]>(`/users/${rawId}/web-profiles`, MED);
        return Array.isArray(res) ? res : [];
      } catch {
        return [];
      }
    }
  },

  userTracks(userId: string | number, limit = 40) {
    return request<ScCollection<ScTrack>>(`/users/${userId}/tracks?limit=${limit}`, MED);
  },

  /**
   * Loads an artist's full catalogue.
   *
   * `limit` is silently clamped by this endpoint: asking for 50 returns 31,
   * asking for 800 returns 0, and the cap is not the artist's real count. The
   * only way to get everything is to follow the `next_href` cursor to the end.
   * Measured against real accounts, paging is both complete and deterministic
   * (171 vs 31 tracks for one artist, identical across repeated runs), while a
   * single request is the truncated view.
   *
   * Each page is retried on its own, because the endpoint also throws 500 while
   * shedding load, and search is used as a last resort when paging yields
   * nothing at all.
   */
  async userTracksAll(userId: string | number, username: string, maxTracks = 600) {
    const byId = new Map<number, ScTrack>();
    const seenCursors = new Set<string>();
    let path: string | null = `/users/${userId}/tracks?limit=50`;
    let hops = 0;

    while (path && hops++ < 40 && byId.size < maxTracks) {
      let page: ScCollection<ScTrack> | null = null;

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          page = await request<ScCollection<ScTrack>>(path, MED);
          break;
        } catch (err) {
          if (err instanceof NotFoundError) break;
          if (attempt === 3) return [...byId.values()];
          await sleep(600 * 2 ** attempt);
        }
      }
      if (!page) break;

      const items = page.collection ?? [];
      let added = 0;
      for (const t of items) {
        if (t?.id && !byId.has(t.id)) {
          byId.set(t.id, t);
          added++;
        }
      }

      if (!page.next_href || !items.length || !added) break;

      // Guard against a cursor that loops back on itself.
      const cursor: string = page.next_href;
      if (seenCursors.has(cursor)) break;
      seenCursors.add(cursor);

      const qs: string = new URL(cursor, API_BASE).search;
      path = qs ? `/users/${userId}/tracks${qs}` : null;
    }

    if (byId.size) return [...byId.values()];

    // Nothing came back at all. `/search/tracks` still finds some uploads, so
    // it is worth one attempt before showing an empty artist page.
    try {
      const { collection } = await sc.searchTracks(username, 50);
      const mine = collection.filter((t) => t.user?.id === Number(userId));
      if (mine.length) return mine;
    } catch {
      /* fall through to an empty page */
    }

    return [];
  },

  userPlaylists(userId: string | number, limit = 50) {
    return request<{ collection: ScPlaylist[] }>(`/users/${userId}/playlists?limit=${limit}`, MED);
  },

  userAlbums(userId: string | number, limit = 50) {
    return request<{ collection: ScPlaylist[] }>(`/users/${userId}/albums?limit=${limit}`, MED);
  },

  /**
   * `/users/:id/likes` does NOT return tracks. It returns "like" envelopes -
   * `{ kind: 'like', created_at, track: {...} }` - so mapping the collection
   * directly yields objects with no id, no title and no artwork, which is why
   * the library rendered empty even though the account had 185 likes.
   */
  userLikes(userId: string | number, limit = 50) {
    return request<ScCollection<ScTrackLike>>(`/users/${userId}/likes?limit=${limit}`, SHORT);
  },

  /**
   * Walks `/users/:id/likes` to the end of the cursor and unwraps each
   * envelope into its track.
   *
   * A single page caps out well below what an account has liked (limit=50
   * returns 48, limit=200 returns 184, and the true total here is 185), so a
   * single request made heavy likers look like they had almost nothing.
   */
  async allUserLikes(userId: string | number, max = 600) {
    const seen = new Map<number, ScTrack>();
    const PAGE = 100;
    let offset: string | null = null;

    for (;;) {
      // The cursor from `next_href` is what actually pages this endpoint;
      // `limit` alone caps out and then returns overlapping short pages.
      const path = offset
        ? `/users/${userId}/likes?limit=${PAGE}&offset=${encodeURIComponent(offset)}`
        : `/users/${userId}/likes?limit=${PAGE}`;

      let page: ScCollection<ScTrackLike>;
      try {
        page = await request<ScCollection<ScTrackLike>>(path, SHORT);
      } catch {
        break; // keep whatever earlier pages returned
      }

      const items = page.collection ?? [];
      let added = 0;
      for (const item of items) {
        const t = item?.track;
        if (t?.id && !seen.has(t.id)) {
          seen.set(t.id, t);
          added++;
        }
      }

      if (!page.next_href || !items.length || !added) break;
      if (seen.size >= max) break;

      const next = new URL(page.next_href, API_BASE);
      offset = next.searchParams.get('offset');
      if (!offset) break;
    }

    return [...seen.values()];
  },

  /**
   * Playlist loading needs two requests, not one.
   *
   * `/playlists/:id` returns every entry, but only the first handful are
   * complete objects; the rest are bare stubs carrying just an `id`. That is
   * the same lazy hydration the SoundCloud web player does as you scroll, so
   * the client does it up front. `GET /tracks?ids=a,b,c` (comma separated,
   * 50 max) returns fully hydrated tracks, but silently omits ids that no
   * longer exist and does not preserve order, so results are re-indexed and
   * gaps are left in place as unavailable entries.
   */
  async playlistTracks(playlistId: string | number, limit = 500) {
    const playlist = await request<{ tracks: ScTrack[] }>(`/playlists/${playlistId}`, MED);
    const entries = (playlist.tracks ?? []).slice(0, limit);
    if (!entries.length) return { collection: [] as ScTrack[] };

    const isStub = (t: ScTrack) => !t.title && !t.media;
    const stubIds = entries.filter(isStub).map((t) => t.id);

    if (stubIds.length) {
      const byId = new Map<number, ScTrack>();
      const chunks: number[][] = [];
      for (let i = 0; i < stubIds.length; i += HYDRATE_BATCH) {
        chunks.push(stubIds.slice(i, i + HYDRATE_BATCH));
      }

      // Sequential on purpose: this is hundreds of tracks and the scheduler
      // already caps concurrency, and it keeps us well clear of rate limits.
      //
      // A failing chunk used to `break` the loop, which stranded every later
      // chunk as a stub: they would render as blank "Unavailable track" rows
      // and, because a stub has no `created_at`, they all sank to the bottom of
      // the "Newest" sort. One retry and then moving on keeps a single bad
      // request from taking the rest of the playlist down with it.
      for (const chunk of chunks) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const full = await request<ScTrack[]>(
              `/tracks?ids=${chunk.join(',')}`,
              MED
            );
            for (const t of full) if (t?.id) byId.set(t.id, t);
            break;
          } catch {
            // Retry once, then leave this chunk's stubs in place and continue
            // with the next one instead of abandoning the remainder.
          }
        }
      }

      return {
        collection: entries.map((t) => (isStub(t) ? byId.get(t.id) ?? t : t)),
      };
    }

    return { collection: entries };
  },

  trackStream(trackId: string | number) {
    return request<ScTrack>(`/tracks/${trackId}`, LONG);
  },

  /**
   * Likes a track.
   *
   * In SoundCloud API v2, liking uses `PUT /users/:userId/track_likes/:trackId`.
   * If userId is omitted, `me()` is called to fetch the current authenticated user's ID.
   */
  async likeTrack(trackId: string | number, userId?: string | number) {
    let uid = userId;
    if (!uid) {
      const me = await this.me();
      uid = me.id;
    }
    const cleanUid = String(uid).replace(/^soundcloud:users:/, '');
    const cleanTrackId = String(trackId).replace(/^soundcloud:tracks:/, '');
    return request<{ id: number }>(`/users/${cleanUid}/track_likes/${cleanTrackId}`, 0, {
      method: 'PUT',
      auth: true,
      body: {},
    });
  },

  async unlikeTrack(trackId: string | number, userId?: string | number) {
    let uid = userId;
    if (!uid) {
      const me = await this.me();
      uid = me.id;
    }
    const cleanUid = String(uid).replace(/^soundcloud:users:/, '');
    const cleanTrackId = String(trackId).replace(/^soundcloud:tracks:/, '');
    return request<unknown>(`/users/${cleanUid}/track_likes/${cleanTrackId}`, 0, {
      method: 'DELETE',
      auth: true,
    });
  },

  /**
   * Adds a track to one of the account's own playlists.
   *
   * In SoundCloud API v2, modifying playlist tracks is done via `PUT /playlists/:id`
   * with the updated track list in `{ playlist: { tracks: [...] } }`.
   *
   * Each entry has to be an object (`{ id }`), not a bare number. The API
   * accepts the numeric form for some read paths but rejects it here with a
   * 403, so the objects are built from the ids at the edge.
   */
  async addTrackToPlaylist(
    playlistId: string | number,
    trackId: string | number,
    existingTrackIds?: Array<string | number>
  ) {
    const cleanPlId = String(playlistId).replace(/^soundcloud:playlists:/, '');
    let ids: number[] = [];
    if (existingTrackIds && existingTrackIds.length > 0) {
      ids = existingTrackIds.map(Number).filter(Boolean);
    } else {
      const p = await this.playlistTracks(cleanPlId);
      ids = (p.collection || []).map((t) => Number(t.id)).filter(Boolean);
    }
    const numId = Number(String(trackId).replace(/^soundcloud:tracks:/, ''));
    if (!ids.includes(numId)) {
      ids.push(numId);
    }
    const result = await request<ScPlaylist>(`/playlists/${cleanPlId}`, 0, {
      method: 'PUT',
      auth: true,
      body: {
        playlist: {
          tracks: ids.map((id) => ({ id })),
        },
      },
    });

    // Invalidate playlist tracks cache
    const cacheKey = `GET /playlists/${cleanPlId}`;
    memoryCache.delete(cacheKey);
    try {
      localStorage.removeItem(CACHE_PREFIX + cacheKey);
    } catch {
      /* ignore */
    }
    
    return result;
  },

  /** Removes a track from a playlist using `PUT /playlists/:id`. */
  async removeTrackFromPlaylist(
    playlistId: string | number,
    trackId: string | number,
    existingTrackIds?: Array<string | number>
  ) {
    let ids: number[] = [];
    if (existingTrackIds && existingTrackIds.length > 0) {
      ids = existingTrackIds.map(Number).filter(Boolean);
    } else {
      const p = await this.playlistTracks(playlistId);
      ids = (p.collection || []).map((t) => Number(t.id)).filter(Boolean);
    }
    const numId = Number(trackId);
    ids = ids.filter((id) => id !== numId);
    const result = await request<ScPlaylist>(`/playlists/${playlistId}`, 0, {
      method: 'PUT',
      auth: true,
      body: {
        playlist: {
          // Objects, not numbers - see addTrackToPlaylist for why.
          tracks: ids.map((id) => ({ id })),
        },
      },
    });

    // Invalidate playlist tracks cache
    const cacheKey = `GET /playlists/${playlistId}`;
    memoryCache.delete(cacheKey);
    try {
      localStorage.removeItem(CACHE_PREFIX + cacheKey);
    } catch {
      /* ignore */
    }

    return result;
  },

  /** Creates an empty playlist owned by the signed-in account. */
  createPlaylist(title: string, description = '') {
    return request<ScPlaylist>('/playlists', 0, {
      method: 'POST',
      auth: true,
      body: { playlist: { title, description, sharing: 'public' } },
    });
  },

  /** Reorders the account's own playlists; SoundCloud has no dedicated call
   *  for it, so the order is stored locally and applied to the sidebar. */
  reloadPlaylists(userId: string | number, limit = 50) {
    return request<{ collection: ScPlaylist[] }>(`/users/${userId}/playlists?limit=${limit}`, 0);
  },

  /** Followers of a user (who follows them). */
  userFollowers(userId: string | number, limit = 200) {
    return request<ScCollection<ScUser>>(`/users/${userId}/followers?limit=${limit}`, MED);
  },

  /**
   * Follows a user. Requires auth.
   *
   * `PUT /users/:id/follows`. The response body carries no relationship state, so
   * the caller has to assume success from a 2xx and keep its own flag.
   */
  followUser(userId: string | number) {
    const clean = String(userId).replace(/^soundcloud:users:/, '');
    return request<{ id: number }>(`/users/${clean}/follows`, 0, {
      method: 'PUT',
      auth: true,
      body: {},
    });
  },

  /** Unfollows a user. Requires auth. */
  unfollowUser(userId: string | number) {
    const clean = String(userId).replace(/^soundcloud:users:/, '');
    return request<unknown>(`/users/${clean}/follows`, 0, {
      method: 'DELETE',
      auth: true,
    });
  },

  /** Users that the given user follows. */
  userFollowings(userId: string | number, limit = 200) {
    return request<ScCollection<ScUser>>(`/users/${userId}/followings?limit=${limit}`, MED);
  },

  /** Public comments on a track, newest first. */
  trackComments(trackId: string | number, limit = 50) {
    return request<ScCollection<ScComment>>(`/tracks/${trackId}/comments?limit=${limit}&threaded=0&linked_partitioning=1`, SHORT);
  },

  /** Posts a comment on a track. Requires auth. */
  postComment(trackId: string | number, body: string, timestamp?: number) {
    return request<ScComment>(`/comments`, 0, {
      method: 'POST',
      auth: true,
      body: {
        comment: {
          track_id: Number(trackId),
          body,
          ...(timestamp !== undefined ? { timestamp: Math.round(timestamp * 1000) } : {}),
        },
      },
    });
  },

  /** Deletes a comment. Only works on comments owned by the current user. */
  deleteComment(commentId: string | number) {
    return request<unknown>(`/comments/${commentId}`, 0, {
      method: 'DELETE',
      auth: true,
    });
  },

  /**
   * People who liked the track, newest like first.
   *
   * This is the closest thing SoundCloud exposes to an audience for a track;
   * there is no endpoint for "currently listening". See `TrackListeners`.
   */
  trackLikes(trackId: string | number, limit = 50) {
    return request<ScCollection<{ user: ScUser; created_at: string }>>(
      `/tracks/${trackId}/likes?limit=${limit}`,
      SHORT
    );
  },

  /**
   * Fans of the artist, most active first.
   *
   * Used to widen the listener panel when a track has too few likes to be
   * interesting on its own. It is a separate request because it can be slow and
   * the panel must not wait for it to render what it already has.
   */
  artistFans(userId: string | number, limit = 12) {
    return request<ScCollection<ScUser>>(`/users/${userId}/followers?limit=${limit}`, MED);
  },
};

/* ------------------------------------------------------------------ *
 * Stream resolution
 * ------------------------------------------------------------------ */

export interface StreamCandidate {
  url: string;
  /** Human readable, e.g. "mp3 (progressive)". Shown in the retry message. */
  format: string;
}

/**
 * Playback policy reported by `/tracks/:id`.
 *
 * `BLOCK` is what SoundCloud returns for a track that is geo-restricted: the
 * track exists and its metadata is complete, but no CDN link is issued from
 * this region. `SNIP` means partially available. Distinguishing this from
 * "track deleted" is the difference between an honest message and a wrong one.
 */
export type StreamPolicy = 'ALLOW' | 'SNIP' | 'BLOCK' | 'UNKNOWN';

export interface ResolveResult {
  candidates: StreamCandidate[];
  policy: StreamPolicy;
  hasMedia: boolean;
  /** True when every candidate is only the 30 second preview. */
  previewOnly: boolean;
  /**
   * True when the track offers media but all of it is encrypted, i.e. nothing
   * this client can ever decode. Distinct from "no media", which means the track
   * is gone or blocked.
   */
  drmOnly: boolean;
  /**
   * Hands out the next format that has not been tried yet, or null when the
   * ladder is exhausted.
   *
   * Resolution used to walk every transcoding before playback could start, so a
   * track with five formats paid five round trips on the critical path to hear
   * the first second of it. Only the best link is needed to play, and a format
   * that fails is rare enough that paying a request when it happens is much
   * cheaper than paying five on every single track.
   */
  next?: () => Promise<StreamCandidate | null>;
  /** True when a Go+ / snipped track was automatically matched with a full stream */
  unblockedFull?: boolean;
  /** Actual full duration in seconds if unblocked */
  actualDuration?: number;
}

/**
 * Formats a plain `<audio>` element cannot play.
 *
 * `cbc-encrypted-hls` / `ctr-encrypted-hls` are FairPlay/Widevine streams. The
 * CDN hands back a link that a browser without the right licence will refuse,
 * so requesting them only spends a request and produces a confusing error. On
 * tracks that offer nothing else they are the *only* entries, which is why
 * "no playable format" and "every format refused" have to stay distinguishable.
 */
const DRM_PROTOCOLS = new Set(['cbc-encrypted-hls', 'ctr-encrypted-hls', 'ad-encrypted-hls']);

export const isDrmFormat = (protocol: string | undefined) =>
  DRM_PROTOCOLS.has(protocol ?? '');

/**
 * The playable streams for a track, best first.
 *
 * The legacy `/tracks/:id/stream/...` endpoints have been retired. Transcodings
 * now live at `media.transcodings[].url`, which is already a full media URL; a
 * single GET on it returns `{ url }` with a short-lived, signed CDN link.
 *
 * Progressive is preferred because `<audio>` can play it directly and seek in
 * it, whereas HLS only works in Chromium without MSE. Only the best link is
 * resolved up front - one request instead of one per format - and the remaining
 * transcodings stay behind `next`, which the player calls when a stream errors
 * and it has to walk the next rung. That ladder is still the basis of how a
 * codec that 403s gets replaced by one that plays; it just no longer runs on the
 * critical path of every track that plays fine on the first try.
 *
 * Encrypted-HLS entries are dropped outright: they are DRM streams no licence
 * here can decrypt, so asking for them costs a request and buys a 403.
 */
const streamResolveCache = new Map<string, { result: ResolveResult; expires: number }>();

export async function resolveStreamUrls(trackId: string | number): Promise<ResolveResult> {
  const cacheKey = String(trackId);
  const cached = streamResolveCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.result;
  }

  const authed = (path: string) => {
    const qs = new URLSearchParams();
    qs.set('client_id', creds.clientId);
    if (creds.authToken) qs.set('oauth_token', creds.authToken);
    return `${path}${path.includes('?') ? '&' : '?'}${qs.toString()}`;
  };

  const empty: ResolveResult = {
    candidates: [],
    policy: 'UNKNOWN',
    hasMedia: false,
    previewOnly: false,
    drmOnly: false,
  };

  try {
    await getCredentials();

    const meta = await sc.trackStream(trackId);
    const transcodings = meta.media?.transcodings ?? [];
    const policy = meta.policy ?? 'UNKNOWN';
    const previewOnly = policy === 'SNIP';
    if (!transcodings.length) {
      return { candidates: [], policy, hasMedia: false, previewOnly, drmOnly: false };
    }

    // Rank the formats rather than picking one, so a failure can fall through
    // to the next rung instead of giving up on the track.
    type Transcoding = NonNullable<ScTrack['media']>['transcodings'][number];

    const playable = transcodings.filter((t) => !isDrmFormat(t.format?.protocol));
    const drmOnly = playable.length === 0;

    const rank = (t: Transcoding) =>
      t.format?.protocol === 'progressive' && t.format?.mime_type === 'audio/mpeg'
        ? 0
        : t.format?.protocol === 'progressive'
          ? 1
          : t.format?.protocol === 'hls' && t.preset === 'aac_160k'
            ? 2
            : t.format?.protocol === 'hls'
              ? 3
              : 4;

    const ordered = [...playable].sort((a, b) => rank(a) - rank(b));
    let activeCandidates = ordered;
    let effectivePolicy = policy;
    let effectivePreviewOnly = previewOnly;
    let unblockedFull = false;
    let actualDuration: number | undefined = undefined;

    // Smart Full-Track Unblocker:
    // If the official track is snipped/preview-only (Go+ or territory-restricted),
    // automatically retrieve the full, official studio release.
    if ((previewOnly || transcodings.every((t) => t.snipped)) && meta.title) {
      const artist = meta.user?.username || '';
      const cleanTitle = meta.title.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();

      // Priority 1: Native official studio stream (exact official release via yt-dlp)
      const bridge = relay();
      if (bridge?.resolveOfficialStream) {
        try {
          const res = await bridge.resolveOfficialStream({ artist, title: cleanTitle });
          if (res.ok && res.url) {
            const resolved: ResolveResult = {
              candidates: [{ url: res.url, format: 'official stream' }],
              policy: 'ALLOW',
              hasMedia: true,
              previewOnly: false,
              drmOnly: false,
              unblockedFull: true,
              actualDuration: res.duration || (meta.full_duration ? Math.round(meta.full_duration / 1000) : undefined),
            };
            streamResolveCache.set(cacheKey, { result: resolved, expires: Date.now() + 60 * 60 * 1000 });
            return resolved;
          }
        } catch {
          /* fallback to secondary search */
        }
      }

      // Priority 2: Full unrestricted uploads on SoundCloud (filtering out remix/edit/karaoke)
      try {
        const queries = Array.from(
          new Set(
            [
              cleanTitle.toLowerCase().includes(artist.toLowerCase())
                ? cleanTitle
                : `${artist} ${cleanTitle}`,
              `${artist} ${cleanTitle}`,
              `${cleanTitle} ${artist}`,
              cleanTitle,
              meta.title,
            ].filter(Boolean)
          )
        );

        let bestCand: ScTrack | null = null;
        for (const q of queries) {
          const searchRes = await sc.searchTracks(q, 15);
          const candidates = (searchRes.collection || []).filter((c) => {
            if (String(c.id) === String(meta.id)) return false;
            if (c.policy === 'SNIP') return false;
            const durSec = (c.duration || 0) / 1000;
            if (durSec < 60) return false;
            const lowerTitle = (c.title || '').toLowerCase();
            const lowerClean = cleanTitle.toLowerCase();
            const words = lowerClean.split(/\s+/).filter((w) => w.length > 2);
            if (!words.every((w) => lowerTitle.includes(w))) return false;
            const badTerms = ['type beat', 'instrumental', 'karaoke', 'remake', 'acapella', 'remix', 'edit', 'slowed', 'reverb', 'sped up'];
            if (badTerms.some((b) => lowerTitle.includes(b)) && !lowerClean.includes('instrumental') && !lowerClean.includes('remix')) {
              return false;
            }
            return true;
          });

          if (candidates.length > 0) {
            const expectedSec = (meta.full_duration || meta.duration || 0) / 1000;
            if (expectedSec > 60) {
              candidates.sort((a, b) => {
                const diffA = Math.abs((a.duration || 0) / 1000 - expectedSec);
                const diffB = Math.abs((b.duration || 0) / 1000 - expectedSec);
                return diffA - diffB;
              });
            }
            bestCand = candidates[0];
            break;
          }
        }

        if (bestCand && bestCand.id) {
          const fullMeta = await sc.trackStream(bestCand.id);
          const fullTrans = (fullMeta.media?.transcodings ?? []).filter(
            (t) => !isDrmFormat(t.format?.protocol) && !t.snipped
          );
          if (fullTrans.length > 0) {
            fullTrans.sort((a, b) => rank(a) - rank(b));
            activeCandidates = fullTrans;
            effectivePolicy = 'ALLOW';
            effectivePreviewOnly = false;
            unblockedFull = true;
            actualDuration = bestCand.duration ? Math.round(bestCand.duration / 1000) : undefined;
          }
        }
      } catch {
        // Fall back gracefully to original snippet on search error
      }
    }

    /**
     * One transcoding in, one signed link out. Kept separate from the ranking so
     * the same request can be made for the next rung when playback actually
     * needs it, instead of for all of them up front.
     */
    const resolveOne = async (t: Transcoding): Promise<StreamCandidate | null> => {
      try {
        const res = await schedule(() => httpGet(authed(t.url)));
        if (!res.ok) return null;
        const { url } = JSON.parse(res.text) as { url?: string };
        if (!url) return null;
        const mime = t.format?.mime_type ?? '';
        const ext = mime.includes('mpeg') ? 'mp3' : mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('aac') ? 'm4a' : 'audio';
        return { url, format: `${ext} (${t.format?.protocol ?? 'unknown'})` };
      } catch {
        // One format failing is normal; the next one may still resolve.
        return null;
      }
    };

    let cursor = 0;
    const next = async (): Promise<StreamCandidate | null> => {
      while (cursor < activeCandidates.length) {
        const candidate = await resolveOne(activeCandidates[cursor]);
        cursor += 1;
        if (candidate) return candidate;
      }
      return null;
    };

    const first = await next();
    const resolved: ResolveResult = {
      candidates: first ? [first] : [],
      policy: effectivePolicy,
      hasMedia: true,
      previewOnly: effectivePreviewOnly,
      drmOnly,
      unblockedFull,
      actualDuration,
      next: cursor < activeCandidates.length ? next : undefined,
    };
    if (resolved.candidates.length > 0) {
      streamResolveCache.set(cacheKey, { result: resolved, expires: Date.now() + 60 * 60 * 1000 });
    }
    return resolved;
  } catch {
    return empty;
  }
}

/** Convenience wrapper: the best stream, or null when nothing resolves. */
export async function resolveStreamUrl(trackId: string | number): Promise<string | null> {
  const { candidates } = await resolveStreamUrls(trackId);
  return candidates[0]?.url ?? null;
}

/* ------------------------------------------------------------------ *
 * Desktop login
 * ------------------------------------------------------------------ */

export interface LoginResult {
  ok: boolean;
  token?: string;
  reason?: string;
}

/**
 * Opens the real SoundCloud sign-in page in a child window that shares the
 * main-process session. Once authenticated, SoundCloud writes an
 * access_token to localStorage, which the window polls for and hands back.
 */
export async function desktopLogin(): Promise<LoginResult> {
  const bridge = relay();
  if (!bridge) return { ok: false, reason: 'desktop-only' };

  const res = await bridge.login();
  if (res.ok) {
    if (res.token) {
      // Normal OAuth token
      setAuthToken(res.token);
    } else {
      // Cookie-based auth (no explicit token but session cookies are set)
      // Use a special marker so syncLikes knows we're "logged in"
      setAuthToken('__cookie_session__');
    }
    return { ok: true, token: res.token || '__cookie_session__' };
  }
  return { ok: false, reason: res.reason };
}

export async function desktopLogout(): Promise<void> {
  clearAuthToken();
  await relay()?.logout();
}

export function isDesktop(): boolean {
  return Boolean(relay());
}

export function cacheStats() {
  let alive = 0;
  const now = Date.now();
  for (const [k, v] of memoryCache) {
    if (v.expires > now) alive++;
    else memoryCache.delete(k);
  }
  return { entries: memoryCache.size, alive, inflight: active, queued: pending.length };
}

/**
 * Drops every cached response and the play history.
 *
 * The saved session survives unless `keepAuth` is false, because signing in
 * again is the most annoying thing to have to redo after clearing a cache.
 */
export function purgeCache(opts: { keepAuth?: boolean } = { keepAuth: true }): number {
  const keepAuth = opts.keepAuth !== false;
  let removed = 0;

  for (const key of [...memoryCache.keys()]) {
    if (keepAuth && key === 'authToken') continue;
    memoryCache.delete(key);
  }

  const keys = new Set<string>([HISTORY_KEY]);
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(CACHE_PREFIX)) continue;
    if (keepAuth && k === `${CACHE_PREFIX}authToken`) continue;
    keys.add(k);
  }
  if (!keepAuth) keys.add(`${CACHE_PREFIX}authToken`);

  for (const key of keys) {
    try {
      localStorage.removeItem(key);
      removed++;
    } catch {
      /* storage disabled - the in-memory cache is already clear */
    }
  }
  if (!keepAuth) creds = { ...creds, authToken: undefined };
  return removed;
}