/**
 * Spotify client.
 *
 * Metadata/search/library come from the Web API and are relayed through the
 * main process (`window.desktop.fetch`) so no CORS proxy is needed. Full-length
 * audio does NOT come from here: the Web API exposes no stream URL, so playback
 * is handed to the Web Playback SDK (see `spotifyPlayer.ts`), which needs a
 * Premium account.
 *
 * Auth is OAuth PKCE with a public client: the user pastes their own app Client
 * ID in Settings, the main process runs the browser flow and token exchange,
 * and only the resulting tokens are kept here, in localStorage.
 */

import type { Playlist, Track } from '../types';

const TOKEN_KEY = 'sc9000:spotifyToken';

export interface SpotifyToken {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms at which `accessToken` stops being valid. */
  expiresAt: number;
  clientId: string;
  /** Display name of the signed-in account, for the UI. */
  displayName?: string;
  product?: string;
}

export function loadSpotifyToken(): SpotifyToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<SpotifyToken>;
    if (!t.accessToken || !t.refreshToken || !t.clientId) return null;
    return {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: typeof t.expiresAt === 'number' ? t.expiresAt : 0,
      clientId: t.clientId,
      displayName: t.displayName,
      product: t.product,
    };
  } catch {
    return null;
  }
}

export function saveSpotifyToken(token: SpotifyToken): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    /* quota - the in-memory token still works for this session */
  }
}

export function clearSpotifyToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function isSpotifyAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.desktop?.spotifyLogin;
}

export function spotifyRedirectUri(): Promise<string> {
  if (!window.desktop?.spotifyConfig) return Promise.resolve('http://127.0.0.1:8888/callback');
  return window.desktop
    .spotifyConfig()
    .then((c) => c.redirectUri)
    .catch(() => 'http://127.0.0.1:8888/callback');
}

export async function spotifyLogin(clientId: string): Promise<SpotifyToken> {
  if (!window.desktop?.spotifyLogin) throw new Error('Spotify sign-in requires the desktop app');
  const res = await window.desktop.spotifyLogin(clientId.trim());
  if (!res.ok || !res.accessToken || !res.refreshToken) {
    throw new Error(res.error || 'Spotify sign-in failed');
  }
  const token: SpotifyToken = {
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    expiresAt: Date.now() + (res.expiresIn ?? 3600) * 1000,
    clientId: clientId.trim(),
  };
  saveSpotifyToken(token);
  return token;
}

let refreshInFlight: Promise<SpotifyToken> | null = null;

/**
 * Returns a usable access token, refreshing first when the stored one is within
 * a minute of expiring. Concurrent callers share one refresh request so a burst
 * of API calls cannot trigger a storm of token exchanges.
 */
export async function ensureSpotifyToken(): Promise<string> {
  const current = loadSpotifyToken();
  if (!current) throw new Error('Not signed in to Spotify');
  if (current.expiresAt - 60_000 > Date.now()) return current.accessToken;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      if (!window.desktop?.spotifyRefresh) throw new Error('Spotify sign-in requires the desktop app');
      const res = await window.desktop.spotifyRefresh(current.clientId, current.refreshToken);
      if (!res.ok || !res.accessToken) {
        clearSpotifyToken();
        throw new Error(res.error || 'Spotify session expired - sign in again');
      }
      const next: SpotifyToken = {
        ...current,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken || current.refreshToken,
        expiresAt: Date.now() + (res.expiresIn ?? 3600) * 1000,
      };
      saveSpotifyToken(next);
      return next;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  const refreshed = await refreshInFlight;
  return refreshed.accessToken;
}

async function spotifyRequest<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!window.desktop?.fetch) throw new Error('Spotify requires the desktop app');
  const token = await ensureSpotifyToken();
  const res = await window.desktop.fetch(`https://api.spotify.com/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : null,
  });
  if (!res.ok) {
    let message = `Spotify request failed (${res.status})`;
    try {
      const parsed = JSON.parse(res.text);
      message = parsed?.error?.message || message;
    } catch {
      /* not json */
    }
    throw new Error(message);
  }
  if (!res.text) return undefined as T;
  return JSON.parse(res.text) as T;
}

/* ------------------------------------------------------------------ *
 * Mapping
 * ------------------------------------------------------------------ */

interface SpotifyImage {
  url: string;
  width?: number;
  height?: number;
}

interface SpotifyArtist {
  id?: string;
  name: string;
}

interface SpotifyTrackObject {
  id: string | null;
  name: string;
  duration_ms: number;
  uri: string;
  artists?: SpotifyArtist[];
  album?: { name?: string; images?: SpotifyImage[] };
  external_urls?: { spotify?: string };
  type?: string;
  is_local?: boolean;
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function mapSpotifyTrack(t: SpotifyTrackObject | null | undefined): Track | null {
  if (!t || !t.id) return null;
  const artist = (t.artists ?? []).map((a) => a.name).join(', ') || 'Unknown artist';
  const duration = Math.round((t.duration_ms ?? 0) / 1000);
  const images = t.album?.images ?? [];
  return {
    id: t.id,
    title: t.name,
    artist,
    artistId: t.artists?.[0]?.id,
    duration,
    durationFormatted: fmtDuration(duration),
    artwork: images[0]?.url ?? '',
    genre: '',
    permalinkUrl: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
    source: 'spotify',
    uri: t.uri,
  };
}

interface SpotifyPaging<T> {
  items: T[];
  next: string | null;
  total: number;
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

export interface SpotifyMe {
  id: string;
  display_name?: string;
  product?: string;
  images?: SpotifyImage[];
}

export async function spotifyMe(): Promise<SpotifyMe> {
  return spotifyRequest<SpotifyMe>('/me');
}

export async function spotifySearch(query: string, limit = 30): Promise<Track[]> {
  const data = await spotifyRequest<{ tracks?: SpotifyPaging<SpotifyTrackObject> }>(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
  );
  const items = data.tracks?.items ?? [];
  return items.map((item) => mapSpotifyTrack(item)).filter((t): t is Track => !!t);
}

export async function spotifyLikedTracks(): Promise<Track[]> {
  const data = await spotifyRequest<SpotifyPaging<{ track: SpotifyTrackObject }>>('/me/tracks?limit=50');
  return (data.items ?? [])
    .map((i) => mapSpotifyTrack(i.track))
    .filter((t): t is Track => !!t);
}

export async function spotifyPlaylists(): Promise<Playlist[]> {
  const data = await spotifyRequest<
    SpotifyPaging<{ id: string; name: string; description?: string; images?: SpotifyImage[]; tracks?: { total?: number } }>
  >('/me/playlists?limit=50');
  return (data.items ?? [])
    .filter((p) => !!p.id)
    .map((p) => ({
      id: p.id,
      title: p.name,
      description: p.description ?? '',
      artwork: p.images?.[0]?.url ?? '',
      trackCount: p.tracks?.total ?? 0,
      tracks: [] as Track[],
    }));
}

export async function spotifyPlaylistTracks(id: string): Promise<Track[]> {
  const data = await spotifyRequest<SpotifyPaging<{ track: SpotifyTrackObject | null }>>(
    `/playlists/${id}/tracks?limit=100`
  );
  return (data.items ?? [])
    .map((i) => mapSpotifyTrack(i.track))
    .filter((t): t is Track => !!t);
}

/**
 * Starts (or replaces) playback of `uris` on the given SDK device. The Web
 * Playback SDK owns the audio; this only tells Spotify Connect what to play.
 */
export async function spotifyStartPlayback(deviceId: string, uris: string[], offset = 0): Promise<void> {
  await spotifyRequest(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: { uris, offset: { position: offset } },
  });
}
