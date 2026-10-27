import { useCallback, useEffect, useRef, useState } from 'react';
import {
  sc,
  mapTrack,
  mapUser,
  mapPlaylistMeta,
  clearPlaylistCache,
  resolveStreamUrls,
  resolveStreamUrl,
  invalidateStreamResolveCache,
  setAuthToken,
  clearAuthToken,
  restoreAuthToken,
  hasAuthToken,
  getCredentials,
  RateLimitError,
  AuthExpiredError,
  NotFoundError,
  NotSignedInError,
  BadRequestError,
  cacheStats,
  purgeCache,
  type StreamCandidate,
  type StreamPolicy,
} from '../lib/soundcloud';
import { isSoundCloudTrack } from '../lib/audius';
import { loadPrefs } from '../lib/prefs';
import {
  addTrackLocally,
  removeTrackLocally,
  mergeLocalPlaylistTracks,
  getLocalPlaylistAdded,
  getLocalPlaylistRemoved,
  queuePlaylistSync,
} from '../lib/playlistSync';
import type { Track, Playlist, User, DiscoverSection } from '../types';

export type Status = 'idle' | 'loading' | 'ok' | 'error' | 'ratelimited';

/**
 * Turns a thrown request error into something worth reading.
 *
 * Every like and every playlist edit used to report the same "Could not add to
 * X" no matter what SoundCloud actually said, which left the user with no way to
 * tell a dead session from a rate limit from a missing playlist. Each error type
 * now names the remedy.
 */
function describeFailure(err: unknown, fallback: string): string {
  if (err instanceof NotSignedInError) return err.message;
  if (err instanceof AuthExpiredError) return 'SoundCloud rejected the session - please sign in again';
  if (err instanceof RateLimitError)
    return `SoundCloud is rate limiting - try again in ~${Math.max(1, Math.round(err.retryAfter / 1000))}s`;
  if (err instanceof NotFoundError) return 'SoundCloud has no such playlist or track (404)';
  if (err instanceof BadRequestError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Why a track could not be played, which drives the message shown to the user. */
export interface PlaybackFailure {
  reason: 'region' | 'gone' | 'network' | 'unknown';
  policy: StreamPolicy;
}

/** Candidates plus the policy flag, so a failure can be reported accurately. */
export interface StreamInfo {
  candidates: StreamCandidate[];
  policy: StreamPolicy;
  /** Every candidate is the 30 second preview rather than the full track. */
  previewOnly: boolean;
  /** The track only has encrypted formats, which no licence here can decode. */
  drmOnly: boolean;
  /** The next untried format, resolved only when playback actually needs it. */
  next?: () => Promise<StreamCandidate | null>;
  unblockedFull?: boolean;
  actualDuration?: number;
  waveformUrl?: string;
}

const HISTORY_KEY = 'sc9000:history';
const HISTORY_MAX = 60;

/**
 * Short-lived resolve cache shared by the player and the prefetcher.
 *
 * Signed stream links expire within an hour; in edge cases sooner. Caching them
 * for fifteen minutes makes a queued switch instant - no per-codec request, no
 * second resolve for the exact URL the prefetcher already warmed.
 */
const STREAM_CACHE_TTL = 15 * 60 * 1000;
const streamCache = new Map<string, { at: number; info: StreamInfo }>();

/**
 * Playback history, persisted so it survives a restart.
 *
 * Only the fields the UI needs are stored. A full `Track` is kept because the
 * rail renders artwork, title and artist without another round trip, and any
 * field missing from an older entry simply falls back in the view.
 */
function readHistory(): Track[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((t) => t?.id) as Track[]) : [];
  } catch {
    return [];
  }
}

/** Round-robins several lists so no single seed can dominate a mixed rail. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = lists.reduce((max, l) => Math.max(max, l.length), 0);
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }
  return out;
}

/**
 * The genres a listener actually touches, most common first.
 *
 * The placeholder "SoundCloud" genre that unmapped uploads carry is ignored so
 * it never becomes a recommendation rail.
 */
function topGenres(tracks: Track[], count: number): string[] {
  const tally = new Map<string, number>();
  for (const t of tracks) {
    const g = (t.genre ?? '').trim();
    if (!g || g.toLowerCase() === 'soundcloud') continue;
    tally.set(g, (tally.get(g) ?? 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([g]) => g);
}

export interface AppState {
  status: Status;
  error: string | null;
  loadFailed: boolean;
  accountPlaylists: Playlist[];
  notify: (msg: string) => void;

  searchResults: Track[];
  searchArtists: User[];
  searchPlaylists: Playlist[];
  isSearching: boolean;

  runSearch: (q: string) => Promise<void>;

  relatedTracks: Track[];
  relatedSeed: Track | null;
  isRelatedLoading: boolean;
  loadRelated: (seed: Track) => Promise<Track[]>;

  /**
   * The Discover feed: a handful of labelled recommendation rails.
   *
   * Built from several signals at once - recent listening, saved likes and the
   * platform chart - so the home screen always has something new to offer, even
   * before the account is connected.
   */
  discoverSections: DiscoverSection[];
  isDiscoverLoading: boolean;
  /** Builds the feed once; `force` rebuilds it (used by the refresh button). */
  loadDiscover: (opts?: { force?: boolean }) => Promise<void>;

  loadPlaylist: (p: Playlist) => Promise<void>;
  loadUserTracks: (u: User) => Promise<void>;
  currentPlaylist: Playlist | null;
  setCurrentPlaylist: React.Dispatch<React.SetStateAction<Playlist | null>>;

  likedIds: string[];
  likedTracks: Track[];
  toggleLike: (track: Track) => Promise<void>;
  syncLikes: () => Promise<void>;
  /** Likes are local-only until the account is connected; true means they sync. */
  likesSyncToCloud: boolean;

  addToPlaylist: (playlist: Playlist, track: Track) => Promise<boolean>;
  removeFromPlaylist: (playlist: Playlist, track: Track) => Promise<boolean>;
  createPlaylist: (title: string, initialTracks?: Track[]) => Promise<Playlist | null>;
  copyPlaylist: (playlist: Playlist, title?: string) => Promise<Playlist | null>;
  updatePlaylistDetails: (playlistId: string, details: { title?: string; description?: string }) => Promise<boolean>;
  reorderPlaylistTracks: (playlistId: string, newTracks: Track[]) => Promise<boolean>;
  deletePlaylist: (playlistId: string | number) => Promise<boolean>;
  playlistBusy: string | null;

  /**
   * Recently played tracks, newest first, deduplicated.
   *
   * This is the seed list for "Find similar". Liked tracks were a poor fit
   * there: they are a backlog of everything saved over months, so the rail
   * showed the same dozen old favourites and never what you just heard.
   */
  history: Track[];
  pushHistory: (track: Track) => void;

  downloadTrack: (track: Track) => Promise<void>;
  /** Ids of tracks with a download in flight, so the row can show a spinner. */
  downloadingIds: string[];

  /**
   * Wipes cached responses, playback history and the in-memory cache.
   *
   * `keepAuth` defaults to true so clearing a cache does not sign the user out.
   * The account itself is re-synced afterwards, otherwise the sidebar would sit
   * empty until a restart.
   */
  clearCache: (opts?: { keepAuth?: boolean }) => Promise<void>;
  /** Empties the "Find similar" seed rail. */
  resetHistory: () => void;

  me: User | null;
  setMe: (u: User | null) => void;

  /**
   * Every playable stream for a track, best first, plus the region policy.
   * The player walks the list when a stream errors, which is what gives a
   * region-locked track a second chance on a different codec.
   */
  resolveStreams: (track: Track) => Promise<StreamInfo>;
  resolvePlayable: (track: Track) => Promise<string | null>;
  invalidateStreamCache: (trackId: string | number) => void;
  stats: () => ReturnType<typeof cacheStats>;
}

export function useSoundCloud(notify: (msg: string) => void): AppState {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [accountPlaylists, setAccountPlaylists] = useState<Playlist[]>([]);
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [searchArtists, setSearchArtists] = useState<User[]>([]);
  const [searchPlaylists, setSearchPlaylists] = useState<Playlist[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
  const [relatedSeed, setRelatedSeed] = useState<Track | null>(null);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist | null>(null);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState<string | null>(null);

  // Restored eagerly so the "Find similar" rail is populated on the first
  // paint instead of filling in a moment later.
  const [history, setHistory] = useState<Track[]>(readHistory);

  const meRef = useRef<User | null>(null);
  meRef.current = me;

  const likedIdsRef = useRef<string[]>([]);
  likedIdsRef.current = likedIds;

  /**
   * Mirrors of history and likes for `loadDiscover`.
   *
   * The feed builder runs from a stable callback, so it cannot depend on the
   * state arrays directly without being rebuilt on every change; reading them
   * through refs keeps the callback identity fixed while it still sees the
   * newest values at call time.
   */
  const historyRef = useRef<Track[]>(history);
  historyRef.current = history;
  const likedTracksRef = useRef<Track[]>(likedTracks);
  likedTracksRef.current = likedTracks;

  const [discoverSections, setDiscoverSections] = useState<DiscoverSection[]>([]);
  const [isDiscoverLoading, setIsDiscoverLoading] = useState(false);
  const discoverLoadedRef = useRef(false);
  const discoverInFlightRef = useRef(false);
  /** Stops the "read-only session" warning from repeating every sync. */
  const warnedReadOnlyRef = useRef(false);

  const guard = useCallback(
    async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        setStatus('loading');
        setError(null);
        const out = await fn();
        setStatus('ok');
        setLoadFailed(false);
        return out;
      } catch (err) {
        setLoadFailed(true);
        if (err instanceof AuthExpiredError) {
          setStatus('error');
          setError('Your SoundCloud session expired. Sign in again to load your account.');
          setMe(null);
          notify('Session expired - sign in again');
        } else if (err instanceof RateLimitError) {
          setStatus('ratelimited');
          setError('SoundCloud rate limit reached - slowing down. Cached data still works.');
          notify(`Rate limited. Retrying in ~${Math.round(err.retryAfter / 1000)}s`);
        } else if (err instanceof NotFoundError) {
          setStatus('error');
          setError('SoundCloud has no such artist, playlist or track.');
          notify('Not found on SoundCloud');
        } else {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Request failed');
          notify(`Could not load: ${err instanceof Error ? err.message : 'request failed'}`);
        }
        return fallback;
      }
    },
    [notify]
  );

  const runSearch = useCallback(
    async (q: string) => {
      const query = q.trim();
      if (!query) return;
      setIsSearching(true);

      // URL passthrough: soundcloud.com/artist/track or /artist/sets/name
      if (/^https?:\/\/(www\.)?soundcloud\.com\//i.test(query)) {
        const direct = await guard<Track[]>(
          async () => {
            const resolved = await sc.userByPermalink(query);
            setSearchArtists([mapUser(resolved)]);
            setSearchPlaylists([]);
            return (await sc.userTracksAll(resolved.id, resolved.username)).map(mapTrack);
          },
          [] as Track[]
        );
        setSearchResults(direct);
        setIsSearching(false);
        return;
      }

      const [tracks, users, lists] = await Promise.all([
        guard<Track[]>(
          async () => (await sc.searchTracks(query, 40)).collection.map(mapTrack),
          [] as Track[]
        ),
        guard<User[]>(async () => (await sc.searchUsers(query, 12)).collection.map(mapUser), []),
        guard<Playlist[]>(
          async () => (await sc.searchPlaylists(query, 12)).collection.map(mapPlaylistMeta),
          []
        ),
      ]);

      setSearchResults(tracks);
      setSearchArtists(users);
      setSearchPlaylists(lists);
      setIsSearching(false);
    },
    [guard]
  );

  /** Returns the related tracks so callers can act on them without waiting
   *  for a state update, and also stores them for the "Find similar" view. */
  const loadRelated = useCallback(
    async (seed: Track): Promise<Track[]> => {
      setIsRelatedLoading(true);
      const tracks = await guard<Track[]>(
        async () =>
          (await sc.related({ id: seed.id, artistId: seed.artistId })).collection.map(mapTrack),
        [] as Track[]
      );
      // Drop anything already liked so the rail does not just echo the library.
      const fresh = tracks.filter((t) => !likedIdsRef.current.includes(t.id));
      setRelatedTracks(fresh);
      setRelatedSeed(seed);
      setIsRelatedLoading(false);
      return fresh;
    },
    [guard]
  );

  /**
   * Builds the Discover feed.
   *
   * Seeds are recent plays first (one per artist) and then a spread of saved
   * likes, because history reflects the last hour while likes reflect the long
   * tail - together they cover both "more like this" and "more like me". Every
   * rail drops anything already liked or already shown, so the feed is new
   * material rather than an echo of the library.
   */
  const loadDiscover = useCallback(
    async (opts: { force?: boolean } = {}): Promise<void> => {
      if (discoverInFlightRef.current) return;
      if (discoverLoadedRef.current && !opts.force) return;
      discoverInFlightRef.current = true;
      discoverLoadedRef.current = true;
      setIsDiscoverLoading(true);
      try {
        const hist = historyRef.current;
        const likes = likedTracksRef.current;
        const used = new Set<string>([...likedIdsRef.current, ...hist.map((t) => t.id)]);

        // Distinct-artist seeds: recent plays, then a spread of likes so one
        // artist with a hundred saved tracks cannot fill the whole list.
        const seeds: Track[] = [];
        const seenArtists = new Set<string>();
        const addSeed = (t: Track) => {
          if (!t?.id) return;
          const a = t.artistId || t.artist;
          if (seenArtists.has(a)) return;
          seenArtists.add(a);
          seeds.push(t);
        };
        hist.forEach(addSeed);
        const stride = Math.max(1, Math.floor(likes.length / 6));
        for (let i = 0; i < likes.length && seeds.length < 8; i += stride) addSeed(likes[i]);

        const seedList = seeds.slice(0, 6);
        const relatedLists: Track[][] = await Promise.all(
          seedList.map(async (s) => {
            try {
              const r = await sc.related({ id: s.id, artistId: s.artistId }, 20);
              return r.collection.map(mapTrack).filter((t) => t.duration > 0);
            } catch {
              return [] as Track[];
            }
          })
        );

        const sections: DiscoverSection[] = [];

        // "Because you played" reserves its tracks first, so the mixed rail
        // below only fills up with what is left.
        const because: DiscoverSection[] = [];
        seedList.slice(0, 2).forEach((s, i) => {
          const fresh = (relatedLists[i] ?? []).filter((t) => !used.has(t.id));
          fresh.forEach((t) => used.add(t.id));
          if (fresh.length >= 4) {
            because.push({
              id: `seed:${s.id}`,
              title: `Because you played ${s.title}`,
              subtitle: `More like ${s.artist}`,
              seed: s,
              tracks: fresh.slice(0, 18),
            });
          }
        });

        const mixed = interleave(relatedLists)
          .filter((t) => !used.has(t.id))
          .filter((t) => {
            used.add(t.id);
            return true;
          })
          .slice(0, 24);
        if (mixed.length >= 4) {
          sections.push({
            id: 'foryou',
            title: 'Made for you',
            subtitle: 'Fresh material pulled from what you have been playing and saving',
            tracks: mixed,
          });
        }
        sections.push(...because);

        const genres = topGenres([...hist, ...likes], 2);
        const genreQueries = genres.length ? genres : seeds.length ? [] : ['electronic', 'hip hop'];
        for (const g of genreQueries) {
          try {
            const res = await sc.searchTracks(g, 18);
            const fresh = res.collection
              .map(mapTrack)
              .filter((t) => t.duration > 0 && !used.has(t.id));
            fresh.forEach((t) => used.add(t.id));
            if (fresh.length >= 4) {
              sections.push({
                id: `genre:${g}`,
                title: `More ${g}`,
                subtitle: genres.length ? 'From a genre you listen to' : 'A good place to start',
                tracks: fresh.slice(0, 18),
              });
            }
          } catch {
            /* skip a genre that answers nothing */
          }
        }

        setDiscoverSections(sections);
      } finally {
        discoverInFlightRef.current = false;
        setIsDiscoverLoading(false);
      }
    },
    []
  );

  const loadPlaylist = useCallback(
    async (p: Playlist) => {
      if (
        p.isLocal ||
        p.source === 'local' ||
        p.source === 'server' ||
        String(p.id).startsWith('local:') ||
        String(p.id).startsWith('server:')
      ) {
        setCurrentPlaylist({ ...p, tracks: p.tracks || [] });
        return;
      }
      const initialTracks = mergeLocalPlaylistTracks(p.id, p.tracks || []);
      setCurrentPlaylist({ ...p, tracks: initialTracks });
      const tracks = await guard(
        async () => (await sc.playlistTracks(p.id)).collection.map(mapTrack),
        [] as Track[]
      );
      const mergedTracks = mergeLocalPlaylistTracks(p.id, tracks);
      setCurrentPlaylist({ ...p, tracks: mergedTracks });
      if (mergedTracks.length === 0 && p.owner) {
        notify(`${p.title} has no playable tracks on SoundCloud`);
      }
    },
    [guard, notify]
  );

  const loadUserTracks = useCallback(
    async (u: User) => {
      // Resolve a missing id from the permalink, but never re-resolve an id we
      // already have: `/resolve` maps a username to whichever same-named
      // account it likes, which is how an artist with 14 tracks showed as
      // empty.
      let user = u;
      const cleanId = String(user.id || '').replace(/^soundcloud:users:/, '');
      const hasValidNumericId = Boolean(cleanId && /^\d+$/.test(cleanId));
      if (!hasValidNumericId) {
        let resolved = await guard(
          async () => mapUser(await sc.userByPermalink(user.permalinkUrl || user.username)),
          null
        );
        if (!resolved) {
          try {
            const searchRes = await sc.searchUsers(user.username, 5);
            if (searchRes.collection && searchRes.collection.length > 0) {
              const match =
                searchRes.collection.find(
                  (usr) => usr.username?.toLowerCase() === user.username.toLowerCase()
                ) || searchRes.collection[0];
              resolved = mapUser(match);
            }
          } catch {
            /* ignore */
          }
        }
        if (!resolved) {
          notify(`Could not find the SoundCloud user "${u.username}"`);
          setCurrentPlaylist(null);
          return;
        }
        user = resolved;
      }

      setCurrentPlaylist({
        id: `user-${user.id}`,
        title: user.fullName || user.username,
        description: user.description || `All uploads by ${user.username}`,
        artwork: user.avatarUrl,
        trackCount: user.trackCount,
        owner: user,
        tracks: [],
      });

      const [tracks, fullUserResult, webProfilesResult, albumsResult, playlistsResult] = await Promise.all([
        guard(
          async () => (await sc.userTracksAll(user.id, user.username)).map(mapTrack),
          [] as Track[]
        ),
        sc.user(user.id).then(mapUser).catch(() => null),
        sc.userWebProfiles(user.id).catch(() => []),
        sc.userAlbums(user.id, 50).catch(() => ({ collection: [] })),
        sc.userPlaylists(user.id, 50).catch(() => ({ collection: [] })),
      ]);

      const mergedUser: User = {
        ...(fullUserResult || user),
        description: fullUserResult?.description || user.description || '',
        webProfiles: webProfilesResult.length > 0 ? webProfilesResult : (user.webProfiles ?? []),
      };

      // Index catalogue tracks for fast hydration
      const trackMap = new Map<string, Track>();
      for (const t of tracks) {
        trackMap.set(String(t.id), t);
      }

      // Collect official albums & EPs in the exact artist sequence
      const seenAlbumIds = new Set<string>();
      const officialAlbums: Playlist[] = [];
      const rawSets = [...(albumsResult?.collection || []), ...(playlistsResult?.collection || [])];

      for (const p of rawSets) {
        if (!p || !p.id) continue;
        const pId = String(p.id);
        if (seenAlbumIds.has(pId)) continue;
        seenAlbumIds.add(pId);

        const mappedMeta = mapPlaylistMeta(p);
        if (Array.isArray(p.tracks)) {
          mappedMeta.tracks = p.tracks
            .filter((t) => t && (t.title || t.id))
            .map((t) => {
              const existing = trackMap.get(String(t.id));
              if (existing) return existing;
              return mapTrack(t);
            });
        }
        officialAlbums.push(mappedMeta);
      }

      setCurrentPlaylist({
        id: `user-${mergedUser.id}`,
        title: mergedUser.fullName || mergedUser.username,
        description: mergedUser.description || `All uploads by ${mergedUser.username}`,
        artwork: mergedUser.avatarUrl || user.avatarUrl,
        trackCount: tracks.length || mergedUser.trackCount,
        owner: mergedUser,
        tracks,
        albums: officialAlbums,
      });
    },
    [guard, notify]
  );

  /**
   * Likes a track.
   *
   * The heart flips immediately either way, because waiting on a network round
   * trip makes the UI feel broken. When there is no session the like stays
   * local and the user is told, instead of the app silently pretending it was
   * synced and losing it on the next start.
   */
  const toggleLike = useCallback(
    async (track: Track) => {
      const isLiked = likedIds.includes(track.id);
      setLikedIds((prev) =>
        isLiked ? prev.filter((id) => id !== track.id) : [...prev, track.id]
      );
      // Keep the library list in sync so a removed like disappears at once.
      setLikedTracks((prev) =>
        isLiked ? prev.filter((t) => t.id !== track.id) : [track, ...prev]
      );
      if (!meRef.current) {
        notify('Kept locally - connect SoundCloud to sync your likes');
        return;
      }
      try {
        const userId = meRef.current.id;
        if (isLiked) await sc.unlikeTrack(track.id, userId);
        else await sc.likeTrack(track.id, userId);
      } catch (err) {
        setLikedIds((prev) =>
          isLiked ? [...prev, track.id] : prev.filter((id) => id !== track.id)
        );
        setLikedTracks((prev) =>
          isLiked ? prev : prev.filter((t) => t.id !== track.id)
        );
        if (err instanceof AuthExpiredError || err instanceof NotSignedInError) setMe(null);
        notify(describeFailure(err, 'Could not sync like to SoundCloud'));
      }
    },
    [likedIds, notify]
  );

  /* ---------------------------------------------------------------- *
   * Playlists
   * ---------------------------------------------------------------- */

  /** Adds a track to one of the account's own playlists. */
  const addToPlaylist = useCallback(
    async (playlist: Playlist, track: Track) => {
      if (!meRef.current) {
        notify('Connect SoundCloud to edit your playlists');
        return false;
      }
      if (!isSoundCloudTrack(track)) {
        notify('Only SoundCloud tracks can be added to SoundCloud playlists');
        return false;
      }

      // 1. Persist locally first for instant, guaranteed responsiveness
      addTrackLocally(playlist.id, track);

      // 2. Update local state smoothly without destroying active view or wiping stubs
      if (currentPlaylist?.id === playlist.id) {
        setCurrentPlaylist((prev) =>
          prev && prev.id === playlist.id
            ? {
                ...prev,
                trackCount: prev.trackCount + 1,
                tracks: prev.tracks.some((t) => String(t.id) === String(track.id))
                  ? prev.tracks
                  : [...prev.tracks, track],
              }
            : prev
        );
      }

      setAccountPlaylists((prev) =>
        prev.map((p) => (p.id === playlist.id ? { ...p, trackCount: p.trackCount + 1 } : p))
      );

      notify(`Added "${track.title}" to ${playlist.title}`);

      // 3. Queue gentle server sync in the background with human-paced delay & bot-trigger avoidance
      const currentTracks =
        currentPlaylist?.id === playlist.id && currentPlaylist.tracks.length > 0
          ? currentPlaylist.tracks.map((t) => t.id)
          : playlist.tracks?.length
          ? playlist.tracks.map((t) => t.id)
          : undefined;

      queuePlaylistSync(playlist.id, track.id, 'add', currentTracks);
      return true;
    },
    [currentPlaylist, notify]
  );

  const removeFromPlaylist = useCallback(
    async (playlist: Playlist, track: Track) => {
      if (!meRef.current) {
        notify('Connect SoundCloud to edit your playlists');
        return false;
      }

      // 1. Remove locally first
      removeTrackLocally(playlist.id, track.id);

      // 2. Update local state smoothly without destroying active view
      if (currentPlaylist?.id === playlist.id) {
        setCurrentPlaylist((prev) =>
          prev && prev.id === playlist.id
            ? {
                ...prev,
                trackCount: Math.max(0, prev.trackCount - 1),
                tracks: prev.tracks.filter((t) => String(t.id) !== String(track.id)),
              }
            : prev
        );
      }

      setAccountPlaylists((prev) =>
        prev.map((p) => (p.id === playlist.id ? { ...p, trackCount: Math.max(0, p.trackCount - 1) } : p))
      );
      notify(`Removed "${track.title}" from ${playlist.title}`);

      // 3. Queue gentle server sync in background
      const currentTracks =
        currentPlaylist?.id === playlist.id && currentPlaylist.tracks.length > 0
          ? currentPlaylist.tracks.map((t) => t.id)
          : playlist.tracks?.length
          ? playlist.tracks.map((t) => t.id)
          : undefined;

      queuePlaylistSync(playlist.id, track.id, 'remove', currentTracks);
      return true;
    },
    [currentPlaylist, notify]
  );

  const createPlaylist = useCallback(
    async (title: string, initialTracks?: Track[]) => {
      if (!meRef.current) {
        notify('Connect SoundCloud to create playlists');
        return null;
      }
      try {
        const tracksToPass = initialTracks && initialTracks.length > 0 ? initialTracks : [];
        const made = await sc.createPlaylist(title, '', tracksToPass);
        const meta = mapPlaylistMeta(made);
        if (tracksToPass.length > 0) {
          meta.tracks = [...tracksToPass];
          meta.trackCount = Math.max(meta.trackCount, tracksToPass.length);
          for (const t of tracksToPass) {
            addTrackLocally(meta.id, t);
          }
        }
        setAccountPlaylists((prev) => [meta, ...prev]);
        notify(`Created playlist "${meta.title}"`);
        return meta;
      } catch (err) {
        if (err instanceof AuthExpiredError || err instanceof NotSignedInError) setMe(null);
        notify(describeFailure(err, 'Could not create that playlist'));
        return null;
      }
    },
    [notify]
  );

  const copyPlaylist = useCallback(
    async (sourcePlaylist: Playlist, customTitle?: string) => {
      if (!meRef.current) {
        notify('Connect SoundCloud to copy playlists to your account');
        return null;
      }
      const title = (customTitle?.trim() || `${sourcePlaylist.title} (Copy)`).trim();
      try {
        const tracksToCopy = sourcePlaylist.tracks ?? [];
        const made = await sc.createPlaylist(
          title,
          sourcePlaylist.description || `Copied from ${sourcePlaylist.owner?.fullName || 'SoundCloud'}`,
          tracksToCopy
        );
        const meta: Playlist = {
          ...mapPlaylistMeta(made),
          tracks: [...tracksToCopy],
          trackCount: tracksToCopy.length,
        };

        // Also add tracks locally in playlistSync so they are available immediately
        for (const t of tracksToCopy) {
          addTrackLocally(meta.id, t);
        }
        clearPlaylistCache(meta.id);

        setAccountPlaylists((prev) => [meta, ...prev]);
        notify(`Copied "${sourcePlaylist.title}" to your account!`);
        return meta;
      } catch (err) {
        if (err instanceof AuthExpiredError || err instanceof NotSignedInError) setMe(null);
        notify(describeFailure(err, 'Could not copy playlist'));
        return null;
      }
    },
    [notify]
  );

  const updatePlaylistDetails = useCallback(
    async (playlistId: string, details: { title?: string; description?: string }) => {
      if (!meRef.current) {
        notify('Connect SoundCloud to edit playlists');
        return false;
      }
      try {
        await sc.updatePlaylistDetails(playlistId, details);
        setAccountPlaylists((prev) =>
          prev.map((p) => (p.id === playlistId ? { ...p, ...details } : p))
        );
        setCurrentPlaylist((prev) => (prev && prev.id === playlistId ? { ...prev, ...details } : prev));
        clearPlaylistCache(playlistId);
        notify('Playlist updated');
        return true;
      } catch (err) {
        notify(describeFailure(err, 'Could not update playlist'));
        return false;
      }
    },
    [notify]
  );

  const reorderPlaylistTracks = useCallback(
    async (playlistId: string, newTracks: Track[]) => {
      if (!meRef.current) return false;
      try {
        setCurrentPlaylist((prev) => (prev && prev.id === playlistId ? { ...prev, tracks: newTracks } : prev));
        await sc.reorderPlaylistTracks(playlistId, newTracks.map((t) => t.id));
        return true;
      } catch (err) {
        console.warn('Could not reorder playlist tracks on server:', err);
        return false;
      }
    },
    []
  );

  const deletePlaylist = useCallback(
    async (playlistId: string | number): Promise<boolean> => {
      if (!meRef.current) {
        notify('Connect SoundCloud to manage playlists');
        return false;
      }
      const idStr = String(playlistId);
      setPlaylistBusy(idStr);
      try {
        await sc.deletePlaylist(idStr);
        setAccountPlaylists((prev) => prev.filter((p) => String(p.id) !== idStr));
        setCurrentPlaylist((prev) => (prev && String(prev.id) === idStr ? null : prev));
        clearPlaylistCache(idStr);
        notify('Playlist deleted');
        return true;
      } catch (err) {
        notify(describeFailure(err, 'Could not delete playlist'));
        return false;
      } finally {
        setPlaylistBusy(null);
      }
    },
    [notify]
  );

  /* ---------------------------------------------------------------- *
   * Playback history
   * ---------------------------------------------------------------- */

  /**
   * Records a track as recently played.
   *
   * Re-playing a track moves it back to the front rather than adding a second
   * entry, so the rail stays "what you heard last" instead of growing a
   * duplicate every time a track is looped.
   */
  const pushHistory = useCallback((track: Track) => {
    setHistory((prev) => {
      const next = [track, ...prev.filter((t) => t.id !== track.id)].slice(0, HISTORY_MAX);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* quota exceeded - the in-memory list still works */
      }
      return next;
    });
  }, []);

  const resetHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* nothing to clean up */
    }
  }, []);

  /* ---------------------------------------------------------------- *
   * Download
   * ---------------------------------------------------------------- */

  /**
   * Starts a download and reports progress through `downloadingIds`.
   *
   * The whole exchange takes a noticeable moment - the signed CDN link has to
   * be resolved first - and clicking a download icon with no feedback looks
   * broken, so the row spins until the main process answers. The id is held for
   * the whole call, including the wait for the transfer to complete, since that
   * is what the user actually perceives as "downloading".
   */
  const [downloadingIds, setDownloadingIds] = useState<string[]>([]);
  // Mirrors the state so the re-entry guard can read it without making this
  // callback depend on `downloadingIds` and change identity on every transfer.
  const downloadingRef = useRef<Set<string>>(new Set());

  const downloadTrack = useCallback(
    async (track: Track) => {
      const bridge = window.desktop;
      if (!bridge?.download) {
        notify('Downloading is only available in the desktop app');
        return;
      }
      if (downloadingRef.current.has(track.id)) return;

      downloadingRef.current.add(track.id);
      setDownloadingIds((prev) => [...prev, track.id]);
      try {
        // The signed CDN link is single-use, so a separate resolution is done
        // here rather than reusing the one the player is listening to.
        const { candidates } = await resolveStreamUrls(track.id);
        const pick =
          candidates.find((c) => c.format.includes('progressive') || c.format.includes('mp3')) ||
          candidates[0];
        if (!pick) {
          notify(`No downloadable stream for "${track.title}"`);
          return;
        }

        const prefs = loadPrefs();
        const res = await bridge.download({
          url: pick.url,
          title: track.title,
          artist: track.artist,
          album: track.album || track.title,
          artwork: track.artwork,
          genre: track.genre,
          year: track.createdAt ? new Date(track.createdAt).getFullYear() : undefined,
          downloadPath: prefs.downloadPath || undefined,
        });

        if (!res.ok) {
          notify(res.error ?? 'Download was refused');
        } else if (res.file) {
          const parts = res.file.split(/[\\/]/);
          const fileName = parts[parts.length - 1] || `${track.artist} - ${track.title}.mp3`;
          notify(`Pobrano utwór: ${fileName}`);
        }
      } catch {
        notify('Could not start that download');
      } finally {
        downloadingRef.current.delete(track.id);
        setDownloadingIds((prev) => prev.filter((id) => id !== track.id));
      }
    },
    [notify]
  );

  const syncLikes = useCallback(async () => {
    const token = restoreAuthToken();
    if (!token) {
      notify('Not signed in - use "Sign in with SoundCloud" first');
      return;
    }
    setAuthToken(token);

    /**
     * A cookie-only session authenticates reads but SoundCloud refuses every
     * write with 403, so likes and playlist edits quietly fail. Rather than let
     * that look like a bug, say up front that a fresh sign-in is needed.
     */
    if (token === '__cookie_session__' && !warnedReadOnlyRef.current) {
      warnedReadOnlyRef.current = true;
      notify('Connected read-only - sign out and sign in again to enable likes and playlists');
    }

    // /me is the cheapest way to prove the saved token is still accepted.
    let user;
    try {
      user = await sc.me();
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        setMe(null);
        setStatus('error');
        setError('SoundCloud rejected the saved session. Sign in again.');
        notify('Session expired - sign in again');
      } else {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Request failed');
        notify(`Could not verify session: ${err instanceof Error ? err.message : 'failed'}`);
      }
      return;
    }

    setMe(mapUser(user));

    // Likes and playlists are two separate calls; one failing must not hide
    // the other, so they are fetched independently.
    let likes: Track[] = [];
    try {
      likes = (await sc.allUserLikes(user.id)).map(mapTrack);
      setLikedIds(likes.map((t) => t.id));
      setLikedTracks(likes);
      setStatus('ok');
      setError(null);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        setMe(null);
        notify('Session expired - sign in again');
      } else {
        notify(`Likes unavailable: ${err instanceof Error ? err.message : 'failed'}`);
      }
      setError(err instanceof Error ? err.message : 'Request failed');
      setStatus('error');
    }

    try {
      const lists = (await sc.userPlaylists(user.id, 50)).collection.map((p) => {
        const meta = mapPlaylistMeta(p);
        const added = getLocalPlaylistAdded(meta.id).length;
        const removed = getLocalPlaylistRemoved(meta.id).length;
        return {
          ...meta,
          trackCount: Math.max(0, meta.trackCount + added - removed),
        };
      });
      setAccountPlaylists(lists);
    } catch {
      /* playlist sync is best-effort; the sidebar just stays empty */
    }

    notify(likes.length ? `Synced ${likes.length} likes from SoundCloud` : 'Connected to SoundCloud');
  }, [notify]);

  /* ---------------------------------------------------------------- *
   * Local data
   * ---------------------------------------------------------------- */

  /**
   * Drops every cached response.
   *
   * `client_id` lives in that cache too, so it goes out with everything else
   * and is rediscovered on the next call. Re-syncing afterwards is what keeps
   * the sidebar and the library populated instead of blank until a restart.
   */
  const clearCache = useCallback(
    async (opts: { keepAuth?: boolean } = {}) => {
      const keepAuth = opts.keepAuth !== false;
      purgeCache({ keepAuth });
      streamCache.clear();
      setHistory([]);
      setSearchResults([]);
      setSearchArtists([]);
      setSearchPlaylists([]);
      setRelatedTracks([]);
      if (!keepAuth) {
        setMe(null);
        setLikedIds([]);
        setLikedTracks([]);
        setAccountPlaylists([]);
        notify('Cleared cache and signed out');
        return;
      }
      notify('Cleared cache - reloading your library');
      try {
        await getCredentials();
        await syncLikes();
      } catch {
        notify('Cache cleared. Reload if the library looks empty.');
      }
    },
    [notify, syncLikes]
  );

  // The app is live-only: warm the client id and restore any saved session on
  // mount. Nothing is preloaded, since every view fetches its own data.
  useEffect(() => {
    let alive = true;
    void getCredentials()
      .then(() => {
        if (!alive) return;
        void syncLikes();
      })
      .catch(() => {
        if (alive) notify('Could not reach SoundCloud - check connection');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The best playable stream for a track, plus a way to get the next one.
   *
   * Exposed so the player can retry with the next codec after a stream error.
   * A region-locked track usually has no candidates at all, and the policy flag
   * from the metadata is what distinguishes that from a deleted track.
   *
   * `next` exists because resolving every format first is what made a track
   * switch wait on a request per codec before a single second of audio could
   * play; the player only pulls the next rung when the current one refuses.
   */
  const resolveStreams = useCallback(async (track: Track): Promise<StreamInfo> => {
    if (track.streamUrl) {
      return {
        candidates: [{ url: track.streamUrl, format: 'direct' }],
        policy: 'ALLOW',
        previewOnly: Boolean(track.previewOnly),
        drmOnly: false,
      };
    }
    const hit = streamCache.get(track.id);
    if (hit && Date.now() - hit.at < STREAM_CACHE_TTL) return hit.info;
    const { candidates, policy, previewOnly, drmOnly, next, unblockedFull, actualDuration, waveformUrl } = await resolveStreamUrls(track.id);
    const info = { candidates, policy, previewOnly, drmOnly, next, unblockedFull, actualDuration, waveformUrl: waveformUrl || track.waveformUrl };
    if (candidates.length > 0) {
      streamCache.set(track.id, { at: Date.now(), info });
    }
    return info;
  }, []);

  const invalidateStreamCache = useCallback((trackId: string | number) => {
    streamCache.delete(String(trackId));
    invalidateStreamResolveCache(trackId);
  }, []);

  const resolvePlayable = useCallback(
    async (track: Track) => {
      if (track.streamUrl) return track.streamUrl;
      return resolveStreamUrl(track.id);
    },
    []
  );

  return {
    status,
    error,
    loadFailed,
    accountPlaylists,
    notify,
    searchResults,
    searchArtists,
    searchPlaylists,
    isSearching,
    runSearch,
    relatedTracks,
    relatedSeed,
    isRelatedLoading,
    loadRelated,
    discoverSections,
    isDiscoverLoading,
    loadDiscover,
    loadPlaylist,
    loadUserTracks,
    currentPlaylist,
    setCurrentPlaylist,
    likedIds,
    likedTracks,
    toggleLike,
    syncLikes,
    likesSyncToCloud: Boolean(me),
    addToPlaylist,
    removeFromPlaylist,
    createPlaylist,
    copyPlaylist,
    updatePlaylistDetails,
    reorderPlaylistTracks,
    deletePlaylist,
    playlistBusy,
    history,
    pushHistory,
    downloadTrack,
    downloadingIds,
    clearCache,
    resetHistory,
    me,
    setMe,
    resolveStreams,
    resolvePlayable,
    invalidateStreamCache,
    stats: cacheStats,
  };
}

export { setAuthToken, clearAuthToken, hasAuthToken };