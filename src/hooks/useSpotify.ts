/**
 * Spotify session + playback, as one hook.
 *
 * Owns three things the rest of the app should not have to juggle:
 *   - the OAuth session (token presence = "connected"),
 *   - the Web Playback SDK device (full-length Premium audio),
 *   - the small set of library/search calls used by the UI.
 *
 * Playback is deliberately NOT wired into the HTMLAudioElement engine: the SDK
 * decrypts and plays the stream itself, so the player only needs to be told
 * which URI to start. Its state is pushed back out through `onState` so the
 * app's existing progress/playing UI keeps working unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Playlist, Track } from '../types';
import {
  clearSpotifyToken,
  ensureSpotifyToken,
  isSpotifyAvailable,
  loadSpotifyToken,
  saveSpotifyToken,
  spotifyLikedTracks,
  spotifyLogin,
  spotifyMe,
  spotifyPlaylistTracks,
  spotifyPlaylists,
  spotifySearch,
  spotifyStartPlayback,
  type SpotifyToken,
} from '../lib/spotify';
import { SpotifySdkPlayer, type SpotifyPlayerSnapshot } from '../lib/spotifyPlayer';

export interface UseSpotifyOptions {
  /** Fired whenever the SDK device reports a new playback state. */
  onState?: (s: SpotifyPlayerSnapshot) => void;
  /** Fired on player/account errors; `fatal` means playback cannot continue. */
  onError?: (message: string, fatal: boolean) => void;
}

export interface UseSpotifyResult {
  available: boolean;
  connected: boolean;
  accountName: string | null;
  product: string | null;
  playerReady: boolean;
  deviceId: string | null;
  login: (clientId: string) => Promise<SpotifyToken>;
  logout: () => void;
  playTrack: (track: Track, queueUris?: string[]) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  setVolume: (v: number) => Promise<void>;
  search: (query: string, limit?: number) => Promise<Track[]>;
  loadLiked: () => Promise<Track[]>;
  loadPlaylists: () => Promise<Playlist[]>;
  loadPlaylistTracks: (id: string) => Promise<Track[]>;
}

export function useSpotify({ onState, onError }: UseSpotifyOptions = {}): UseSpotifyResult {
  const [token, setToken] = useState<SpotifyToken | null>(() => loadSpotifyToken());
  const [accountName, setAccountName] = useState<string | null>(() => loadSpotifyToken()?.displayName ?? null);
  const [product, setProduct] = useState<string | null>(() => loadSpotifyToken()?.product ?? null);
  const [playerReady, setPlayerReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const playerRef = useRef<SpotifySdkPlayer | null>(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const connected = !!token;

  // Build the SDK device for the life of the session. Recreating it on every
  // render would leak Spotify Connect devices, so it is keyed on `connected`.
  useEffect(() => {
    if (!connected) {
      if (playerRef.current) {
        void playerRef.current.disconnect();
        playerRef.current = null;
      }
      setPlayerReady(false);
      setDeviceId(null);
      return;
    }

    const player = new SpotifySdkPlayer(() => ensureSpotifyToken());
    playerRef.current = player;
    const offReady = player.onReady((id) => {
      setDeviceId(id);
      setPlayerReady(true);
    });
    const offState = player.onState((s) => onStateRef.current?.(s));
    const offErr = player.onError((m, f) => onErrorRef.current?.(m, f));

    player.connect().catch((e) => {
      onErrorRef.current?.(e instanceof Error ? e.message : 'Spotify player failed to start', true);
    });

    return () => {
      offReady();
      offState();
      offErr();
      void player.disconnect();
      playerRef.current = null;
      setPlayerReady(false);
      setDeviceId(null);
    };
  }, [connected]);

  // Pull the profile once per session - cosmetic, and it tells the UI whether
  // the account is Premium (the SDK refuses playback otherwise).
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      try {
        const me = await spotifyMe();
        if (cancelled) return;
        const name = me.display_name || me.id;
        setAccountName(name);
        setProduct(me.product ?? null);
        const cur = loadSpotifyToken();
        if (cur) saveSpotifyToken({ ...cur, displayName: name, product: me.product });
        setToken((t) => (t ? { ...t, displayName: name, product: me.product } : t));
      } catch {
        /* profile is cosmetic - a failure here must not break playback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected]);

  const login = useCallback(async (clientId: string) => {
    const t = await spotifyLogin(clientId);
    setToken(t);
    return t;
  }, []);

  const logout = useCallback(() => {
    clearSpotifyToken();
    setToken(null);
    setAccountName(null);
    setProduct(null);
  }, []);

  const playTrack = useCallback(async (track: Track, queueUris?: string[]) => {
    const player = playerRef.current;
    if (!player) throw new Error('Spotify player is not ready yet');
    const id = player.getDeviceId();
    if (!id) throw new Error('Spotify player is still connecting - try again in a moment');
    const uris = queueUris && queueUris.length ? queueUris : track.uri ? [track.uri] : [];
    if (!uris.length) throw new Error('That track has no playable Spotify URI');
    await player.activate();
    await spotifyStartPlayback(id, uris, Math.max(0, uris.indexOf(track.uri ?? '')));
  }, []);

  const pause = useCallback(async () => {
    await playerRef.current?.pause();
  }, []);
  const resume = useCallback(async () => {
    await playerRef.current?.resume();
  }, []);
  const seek = useCallback(async (ms: number) => {
    await playerRef.current?.seek(ms);
  }, []);
  const setVolume = useCallback(async (v: number) => {
    await playerRef.current?.setVolume(v);
  }, []);

  return {
    available: isSpotifyAvailable(),
    connected,
    accountName,
    product,
    playerReady,
    deviceId,
    login,
    logout,
    playTrack,
    pause,
    resume,
    seek,
    setVolume,
    search: spotifySearch,
    loadLiked: spotifyLikedTracks,
    loadPlaylists: spotifyPlaylists,
    loadPlaylistTracks: spotifyPlaylistTracks,
  };
}
