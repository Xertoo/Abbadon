import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Compass, Loader2, Cloud, Users } from 'lucide-react';
import clsx from 'clsx';
import { Sidebar, type View } from './components/Sidebar';
import { SearchBar } from './components/SearchBar';
import { Artwork } from './components/Artwork';
import { PlayerBar } from './components/PlayerBar';
import { SimilarView } from './components/SimilarView';
import { DiscoverView } from './components/DiscoverView';
import { DetailView } from './components/DetailView';
import { SearchView, LibraryView, SettingsView } from './components/Views';
import { AtmosphereLayer } from './components/AtmosphereLayer';
import { QueueDrawer } from './components/QueueDrawer';
import { PlaylistAddButton } from './components/PlaylistAddButton';
import { SoundHeardle } from './components/SoundHeardle';
import { Toasts } from './components/Toasts';
import { ListenTogetherView } from './components/ListenTogetherView';
import { FriendsPopover } from './components/FriendsPopover';
import { useListenTogether } from './hooks/useListenTogether';
import { UpdateBanner } from './components/UpdateBanner';
import { useAutoUpdater } from './hooks/useAutoUpdater';
import { useSoundCloud } from './hooks/useSoundCloud';
import { useSpotify } from './hooks/useSpotify';
import { usePrefs, useAnimationClass, loadPrefs, defaultPrefs } from './lib/prefs';
import { applyOrder, orderFrom } from './lib/playlistOrder';
import { searchAudius, trendingAudius, isSoundCloudTrack } from './lib/audius';
import {
  useAudioEngine,
  EQ_RANGE,
  EQ_BAND_COUNTS,
  bandsFor,
  migrateEq,
  type BandCount,
} from './hooks/useAudioEngine';
import { VISUALIZER_MODES, type VisualizerMode } from './components/Visualizer';
import {
  BUILT_IN_THEMES,
  applyTheme,
  resolveTheme,
  matchTheme,
  loadCustomThemes,
  saveCustomThemes,
  themeFromAccent,
  THEME_ACTIVE_KEY,
  type ThemeDef,
  type ThemeMode,
} from './lib/themes';
import type { Playlist, Track, User } from './types';
import { desktopLogin, desktopLogout, setAuthToken, clearAuthToken, type StreamCandidate, type StreamPolicy, fmtTime } from './lib/soundcloud';
import { spotifyRedirectUri } from './lib/spotify';

/** Active EQ band count. Stored apart from the curve so the two stay in sync. */
const EQ_BAND_COUNT_KEY = 'sc9000:eqBands';

/** Anything other than 4, 8 or 16 falls back to 8. */
function readStoredBandCount(): BandCount {
  const raw = localStorage.getItem(EQ_BAND_COUNT_KEY);
  return raw === '4' || raw === '8' || raw === '16' ? (Number(raw) as BandCount) : 8;
}

/**
 * One entry of the view history behind the back / forward buttons.
 *
 * The buttons have to *work*, not merely look disabled, so each entry carries
 * what is needed to put that view back on screen: a playlist or artist has to be
 * re-shown, not just re-selected. `key` makes two visits to the same list
 * interchangeable - returning to where you already are is not a new step.
 */
type NavEntry =
  | { view: 'discover' | 'library' | 'friends' | 'settings'; key: string }
  | { view: 'search'; query: string; key: string }
  | { view: 'playlist'; playlist: Playlist; key: string }
  | { view: 'artist'; user: User; key: string }
  | { view: 'similar'; seed: Track; key: string };

export default function App() {
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string }>>([]);
  const notify = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const api = useSoundCloud(notify);
  const engine = useAudioEngine();
  const { prefs, update: setPref, replace: replacePrefs } = usePrefs();
  useAnimationClass(prefs.animations);
  const autoUpdater = useAutoUpdater();

  const [view, setView] = useState<View>('discover');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');

  /* -------------------------- view history -------------------------- */

  /**
   * Back / forward for the whole app.
   *
   * A stack of entries plus an index into it. Opening something from anywhere
   * records a step and throws away whatever was ahead; reaching a view *through*
   * back or forward only moves the index. Doing both at once is what makes a
   * second press on Back undo the first press instead of going further back.
   *
   * The stack lives in a ref as well as state because the handlers need the
   * current index *inside* the same update that writes it. Deriving it from
   * state would mean calling `setHistory` with an updater that reads
   * `histIndex`, and that updater runs twice under StrictMode - the index would
   * be incremented twice for one click.
   */
  const [history, setHistory] = useState<NavEntry[]>([{ view: 'discover', key: 'discover' }]);
  const [histIndex, setHistIndex] = useState(0);
  const historyRef = useRef(history);
  const histIndexRef = useRef(0);

  /** Records a step. Re-opening the view already on screen is not a new step. */
  const pushNav = useCallback((entry: NavEntry) => {
    const h = historyRef.current;
    const i = histIndexRef.current;
    if (h[i]?.key === entry.key) return;
    const grown = [...h.slice(0, i + 1), entry];
    // 60 steps is far more than anyone clicks; the cap only stops an accidental
    // loop from growing the array without bound.
    const overflow = Math.max(0, grown.length - 60);
    const next = overflow ? grown.slice(overflow) : grown;
    const index = next.length - 1;
    historyRef.current = next;
    histIndexRef.current = index;
    setHistory(next);
    setHistIndex(index);
  }, []);

  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);

  /** Switches view from a plain navigation control, and records the step. */
  const navTo = useCallback(
    (view: View, opts?: { section?: string }) => {
      if (view === 'settings') {
        setSettingsSection(opts?.section);
      } else {
        setSettingsSection(undefined);
      }
      if (view === 'search') {
        // The search view keeps whatever results it already has, so there is no
        // new query to carry; record it by view name alone.
        pushNav({ view: 'search', query: activeQuery, key: `search:${activeQuery}` });
        setView('search');
        return;
      }
      if (view === 'similar') {
        /*
         * The similar view is defined by its seed, so an entry without one
         * cannot be restored - Back would read `seed.id` off nothing. Recording
         * it only when a seed is already in memory keeps every entry restorable;
         * otherwise this is a plain view switch.
         */
        const seed = api.relatedSeed;
        if (seed) pushNav({ view: 'similar', seed, key: `similar:${seed.id}` });
        setView('similar');
        return;
      }
      pushNav({ view, key: view } as NavEntry);
      setView(view);
    },
    [pushNav, activeQuery, api.relatedSeed]
  );

  /**
   * Re-opens an entry.
   *
   * The playlist and artist branches reuse the object already on screen when the
   * ids match, so Back is instant instead of flashing a skeleton and refetching
   * a list that is still in memory.
   */
  const restoreNav = useCallback(
    (entry: NavEntry) => {
      if (entry.view === 'search') {
        setActiveQuery(entry.query);
        setView('search');
        return;
      }
      if (entry.view === 'playlist') {
        setView('playlist');
        if (api.currentPlaylist?.id !== entry.playlist.id) void api.loadPlaylist(entry.playlist);
        return;
      }
      if (entry.view === 'artist') {
        setView('playlist');
        if (api.currentPlaylist?.id !== `user-${entry.user.id}`) {
          void api.loadUserTracks(entry.user);
        }
        return;
      }
      if (entry.view === 'similar') {
        setView('similar');
        if (api.relatedSeed?.id !== entry.seed.id) void api.loadRelated(entry.seed);
        return;
      }
      setView(entry.view);
    },
    [api]
  );

  /** Steps the index without touching the stack. Shared by both directions. */
  const stepNav = useCallback(
    (delta: number) => {
      const target = histIndexRef.current + delta;
      const h = historyRef.current;
      if (target < 0 || target >= h.length) return;
      histIndexRef.current = target;
      setHistIndex(target);
      restoreNav(h[target]);
    },
    [restoreNav]
  );

  const goBack = useCallback(() => stepNav(-1), [stepNav]);
  const goForward = useCallback(() => stepNav(1), [stepNav]);

  /**
   * Alt+Left / Alt+Right.
   *
   * Safe to bind now that the Electron menu is gone - the old application menu
   * claimed Alt as its own accelerator, and it fired browser-style navigation
   * while typing in the search box. Inputs are skipped so the shortcut does not
   * fight with text editing.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
      }
    };

    /**
     * Mouse side buttons (back / forward).
     * Button 3 is Back (Mouse 4), Button 4 is Forward (Mouse 5).
     */
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        goForward();
      }
    };

    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('auxclick', onAuxClick);

    // Shell-level navigation command from Electron
    const offNav = window.desktop?.onNavCommand?.((action) => {
      if (action === 'back') goBack();
      else if (action === 'forward') goForward();
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('auxclick', onAuxClick);
      offNav?.();
    };
  }, [goBack, goForward]);

  const [sidebarPlaylists, setSidebarPlaylists] = useState<Playlist[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [manualPending, setManualPending] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [friendsDrawerOpen, setFriendsDrawerOpen] = useState(false);
  const [heardleOpen, setHeardleOpen] = useState(false);

  // Player state
  const [track, setTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  /**
   * Volume starts at the remembered level when the user asked for that, and at
   * the default otherwise. Read once at mount: re-deriving it on every
   * preference change would yank the volume back up the moment it was nudged
   * down with the mouse.
   */
  const [volume, setVolume] = useState(() => {
    const saved = loadPrefs();
    return saved.rememberVolume ? saved.volume : 0.55;
  });
  const [muted, setMuted] = useState(false);
  const [rate, setRateState] = useState<number>(() => loadPrefs().playbackRate);
  const [preservePitch, setPreservePitchState] = useState<boolean>(
    () => loadPrefs().preservePitch
  );
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  // Audius catalog state: results and the query they answered, separate from
  // the SoundCloud search so switching sources never clobbers either one.
  const [audiusResults, setAudiusResults] = useState<Track[]>([]);
  const [audiusResultsQuery, setAudiusResultsQuery] = useState('');
  const [audiusSearching, setAudiusSearching] = useState(false);
  // Spotify catalog state, mirroring Audius: results are kept apart so switching
  // sources never clobbers another catalog's list.
  const [spotifyResults, setSpotifyResults] = useState<Track[]>([]);
  const [spotifyResultsQuery, setSpotifyResultsQuery] = useState('');
  const [spotifySearching, setSpotifySearching] = useState(false);
  const [spotifyLiked, setSpotifyLiked] = useState<Track[]>([]);
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<Playlist[]>([]);
  const [spotifyLibLoading, setSpotifyLibLoading] = useState(false);
  const [spotifyLibLoaded, setSpotifyLibLoaded] = useState(false);
  const [spotifyLoginPending, setSpotifyLoginPending] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [spotifyPlaylist, setSpotifyPlaylist] = useState<Playlist | null>(null);
  const [spotifyRedirect, setSpotifyRedirect] = useState('http://127.0.0.1:8888/callback');
  const [trending, setTrending] = useState<Track[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const trendingFetchedRef = useRef(false);
  const [themes, setThemes] = useState<ThemeDef[]>(() => {
    const built = [...BUILT_IN_THEMES];
    try {
      return [...loadCustomThemes(), ...built];
    } catch {
      return built;
    }
  });
  const [themeId, setThemeId] = useState<string>(
    () => localStorage.getItem(THEME_ACTIVE_KEY) ?? BUILT_IN_THEMES[0].id
  );
  const [clientIdReady, setClientIdReady] = useState(false);
  const [eqCount, setEqCountState] = useState<BandCount>(() => readStoredBandCount());
  const [eq, setEq] = useState<number[]>(() => {
    // The saved curve is resampled to whatever band count is active, so an 8
    // band user keeps the shape of a curve they tuned while on 16.
    const count = readStoredBandCount();
    try {
      const raw = localStorage.getItem('sc9000:eq');
      if (raw) {
        const saved = JSON.parse(raw) as number[];
        if (Array.isArray(saved)) return migrateEq(saved, count);
      }
    } catch {
      /* ignore a corrupt value */
    }
    return bandsFor(count).map(() => 0);
  });
  // 'bars' is no longer offered, so it is not the fallback either: a profile that
// still has it stored fails the VISUALIZER_MODES check below and lands here.
const [visualizer, setVisualizer] = useState<VisualizerMode>('wave');

  /**
   * Themes are a set of CSS custom properties on <html>; nothing else needs to
   * know a theme name exists. The active theme is re-applied whenever the
   * picker or settings.json changes which one is selected.
   */
  useEffect(() => {
    const active = resolveTheme(themeId, themes);
    applyTheme(active);
    try {
      localStorage.setItem(THEME_ACTIVE_KEY, active.id);
    } catch {
      /* ignore */
    }
  }, [themeId, themes]);

  /**
   * Persists the EQ so the chosen curve survives a restart. On boot the saved
   * curve is resampled to the active band count, which is what keeps a 4-band
   * user from being handed a 16-band curve.
   */
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sc9000:eq');
      if (raw) {
        const saved = JSON.parse(raw) as number[];
        if (Array.isArray(saved)) {
          const gains = migrateEq(saved, eqCount);
          setEq(gains);
          engine.setEq(gains);
        }
      }
      const v = localStorage.getItem('sc9000:visualizer') as VisualizerMode | null;
      if (v && VISUALIZER_MODES.some((m) => m.id === v)) setVisualizer(v);
    } catch {
      /* ignore a corrupt value */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Switching band count resamples the current curve instead of resetting it,
   * so the user's shape is preserved when they compare 8 against 16 bands.
   * The stored count and curve are updated together so they never disagree.
   */
  const changeBandCount = useCallback(
    (count: BandCount) => {
      const next = migrateEq(eqRef.current, count);
      engine.setBandCount(count);
      setEqCountState(count);
      setEq(next);
      engine.setEq(next);
      try {
        localStorage.setItem(EQ_BAND_COUNT_KEY, String(count));
        localStorage.setItem('sc9000:eq', JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [engine]
  );

  /**
   * settings.json in the Electron userData folder seeds the state on launch
   * and overrides whatever localStorage holds, which is how a preset gets
   * shipped without touching the UI. Runs after the localStorage read above,
   * so a value present in the file always wins.
   */
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge?.loadSettings) return;

    let cancelled = false;
    void bridge.loadSettings().then((res) => {
      if (cancelled || !res?.ok || !res.data) return;
      const d = res.data;

      if (Array.isArray(d.eq)) {
        // The band count has to be settled before the curve, so a file that
        // ships both is applied in the order they depend on each other.
        const declared = d.eqBands === 4 || d.eqBands === 8 || d.eqBands === 16
          ? (d.eqBands as BandCount)
          : eqCount;
        const gains = migrateEq(d.eq, declared);
        changeBandCount(declared);
        setEq(gains);
        engine.setEq(gains);
        try {
          localStorage.setItem('sc9000:eq', JSON.stringify(gains));
        } catch {
          /* ignore */
        }
      }

      // A theme can be a built-in name, a custom theme id, or a full object for
      // a one-off accent, so all three are accepted. An unknown name is
      // ignored rather than silently snapping to the default.
if (typeof d.theme === 'string') {
        const known = matchTheme(d.theme, themes);
        if (known) setThemeId(known.id);
      } else if (d.theme && typeof d.theme === 'object') {
        const made = themeFromAccent(
          (d.theme as { accent?: string }).accent ?? BUILT_IN_THEMES[0].accent,
          ((d.theme as { mode?: string }).mode as ThemeMode) ?? 'dark'
        );
        setThemes((prev) => [made, ...prev.filter((t) => t.id !== made.id)]);
        setThemeId(made.id);
      }

      const v = d.visualizer as VisualizerMode | undefined;
      if (v && VISUALIZER_MODES.some((m) => m.id === v)) {
        setVisualizer(v);
        changeVisualizer(v);
      }

      if (d.autodiscovery === 'on' || d.autodiscovery === 'off') {
        localStorage.setItem('sc9000:autodiscovery', d.autodiscovery);
      }

      if (d.proxy && typeof d.proxy === 'object') {
        const p = d.proxy as any;
        if (typeof p.enabled === 'boolean') setPref('proxyEnabled', p.enabled);
        if (p.mode) setPref('proxyMode', p.mode);
        if (p.preset) setPref('proxyPreset', p.preset);
      }
    });

    // Synchronize saved proxy preferences with the Electron network session
    if (bridge?.setProxyConfig && prefs.proxyEnabled) {
      void bridge.setProxyConfig({
        enabled: prefs.proxyEnabled,
        mode: prefs.proxyMode,
        preset: prefs.proxyPreset,
        customProtocol: prefs.proxyCustomProtocol,
        customHost: prefs.proxyCustomHost,
        customPort: prefs.proxyCustomPort,
        customAuth: prefs.proxyCustomAuth,
        customUser: prefs.proxyCustomUser,
        customPass: prefs.proxyCustomPass,
        customUrl: prefs.proxyCustomUrl,
      });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeVisualizer = useCallback((m: VisualizerMode) => {
    setVisualizer(m);
    try {
      localStorage.setItem('sc9000:visualizer', m);
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * EQ drags fire at the pointer's polling rate, which can be several hundred
   * events per second. Routing every one of them straight into setState made
   * dragging feel heavy, and writing localStorage synchronously on each event
   * blocked the main thread. Now only the newest value of a frame is applied,
   * and the write happens once the drag settles.
   */
  const pendingEq = useRef<number[] | null>(null);
  const eqFrame = useRef(0);
  const eqSaveTimer = useRef(0);

  /**
   * The live curve, readable from callbacks. changeEq is throttled through a
   * frame, so reading React state here would hand back a stale array.
   */
  const eqRef = useRef<number[]>(eq);
  eqRef.current = eq;

  const changeEq = useCallback(
    (gains: number[]) => {
      pendingEq.current = gains;
      if (eqFrame.current) return;

      eqFrame.current = requestAnimationFrame(() => {
        eqFrame.current = 0;
        const next = pendingEq.current;
        pendingEq.current = null;
        if (!next) return;
        setEq(next);
        engine.setEq(next);

        window.clearTimeout(eqSaveTimer.current);
        eqSaveTimer.current = window.setTimeout(() => {
          try {
            localStorage.setItem('sc9000:eq', JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }, 400);
      });
    },
    [engine]
  );

  // Make sure a drag that ends with the window closing still gets persisted.
  useEffect(
    () => () => {
      if (eqFrame.current) {
        cancelAnimationFrame(eqFrame.current);
        eqFrame.current = 0;
      }
      const last = pendingEq.current;
      pendingEq.current = null;
      if (last) {
        try {
          localStorage.setItem('sc9000:eq', JSON.stringify(last));
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  const queueRef = useRef<Track[]>([]);
  queueRef.current = queue;
  const trackRef = useRef<Track | null>(null);
  trackRef.current = track;
  const playingRef = useRef(false);
  playingRef.current = playing;
  const timeRef = useRef(0);
  timeRef.current = time;

  // Spotify lives entirely on its own transport (the Web Playback SDK owns the
  // audio), so its state is mirrored back into the same playing/time/dur state
  // the player bar already renders - but only while a Spotify track is current,
  // otherwise a stray SDK event would fight the HTMLAudioElement engine.
  const spotify = useSpotify({
    onState: (s) => {
      if (trackRef.current?.source !== 'spotify') return;
      setPlaying(!s.paused);
      setTime(s.position / 1000);
      if (s.duration > 0) setDur(s.duration / 1000);
      // Spotify advances its own queue; follow the current track so the title,
      // art and duration do not keep describing the track we started with.
      const meta = s.track;
      if (meta && meta.uri && meta.uri !== trackRef.current.uri) {
        const secs = Math.round(meta.durationMs / 1000);
        setTrack({
          id: meta.id ?? meta.uri,
          title: meta.title,
          artist: meta.artist,
          duration: secs,
          durationFormatted: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
          artwork: meta.artwork,
          genre: '',
          permalinkUrl: meta.uri,
          source: 'spotify',
          uri: meta.uri,
        });
      }
    },
    onError: (message) => notify(`Spotify: ${message}`),
  });
  // Kept in a ref so callbacks below can reach the (identity-unstable) hook
  // result without taking it as a dependency and being rebuilt every render.
  const spotifyRef = useRef(spotify);
  spotifyRef.current = spotify;

  // The library is the account's own likes. It used to be derived by
  // intersecting `charts` (a fixed list of ~24 popular tracks) with the liked
  // ids, which is why it was always empty for real accounts.
  const likedTracks = api.likedTracks;

  const stats = api.stats();

  /* ----------------------------- playback ----------------------------- */

  /**
   * The formats available for the track currently loaded, and how far the
   * retry ladder has walked. A stream that errors is not necessarily dead:
   * SoundCloud issues a separate CDN link per transcoding, and one codec can
   * 403 while another plays fine, so the next candidate is tried before the
   * track is declared unplayable.
   */
  const streamsRef = useRef<StreamCandidate[]>([]);
  const streamPolicyRef = useRef<StreamPolicy>('UNKNOWN');
  /**
   * Fetches the next format when the current one is refused. Nothing is
   * resolved past the first link until playback proves it needs more, because
   * walking every transcoding up front is what made each track wait on a
   * request per codec before its first second of audio.
   */
  const streamNextRef = useRef<(() => Promise<StreamCandidate | null>) | null>(null);
  /** Keeps a second error event from walking two rungs during one resolution. */
  const advancingRef = useRef(false);
  /**
   * Whether the loaded track is only a 30 second preview. Kept alongside the
   * policy flag because the end of a preview is a normal end event, and without
   * this the queue just silently advanced as if the whole track had played.
   */
  const previewRef = useRef(false);
  const retryIndexRef = useRef(0);

  /**
   * Monotonic token for "which track is being switched to".
   *
   * Comparing against React state after the await was unreliable: state is not
   * committed until React re-renders, so a stale resolution could win the race
   * and load the previous track while the UI already showed the new one. This
   * is set synchronously, so only the newest request can ever write to the
   * player.
   */
  const loadTokenRef = useRef(0);

  /** True while a track switch is waiting on its stream link. */
  const switchingRef = useRef(false);

  const playTrack = useCallback(
    async (t: Track, q: Track[]) => {
      // An explicit pick supersedes any related-track request still in flight.
      navToken.current += 1;
      setQueue(q.length ? q : [t]);

      // Spotify is a second transport: the Web Playback SDK owns the audio, so
      // there is no stream to resolve and nothing for the HTML engine to load.
      if (t.source === 'spotify') {
        if (trackRef.current?.id === t.id && trackRef.current?.source === 'spotify') {
          if (playingRef.current) void spotifyRef.current.pause();
          else void spotifyRef.current.resume();
          return;
        }
        // Silence the element engine so it cannot bleed over the SDK.
        engine.pause();
        setTrack(t);
        setPlaying(true);
        setBuffering(false);
        setTime(0);
        setDur(t.duration);
        retryIndexRef.current = 0;
        streamsRef.current = [];
        const uris = (q.length ? q : [t])
          .filter((x) => x.source === 'spotify' && x.uri)
          .map((x) => x.uri as string);
        void spotifyRef.current.playTrack(t, uris).catch((err) => {
          setPlaying(false);
          notify(err instanceof Error ? err.message : 'Spotify playback failed');
        });
        api.pushHistory(t);
        return;
      }

      if (trackRef.current?.id === t.id) {
        setPlaying((p) => {
          if (p) engine.pause();
          else void engine.play();
          return !p;
        });
        return;
      }

      // Switching away from a Spotify track onto an element-engine track: stop
      // the SDK device so the two transports are never audible at once.
      if (trackRef.current?.source === 'spotify') void spotifyRef.current.pause();

      const token = ++loadTokenRef.current;
      // Without a crossfade the outgoing track stops immediately. Leaving it
      // running while the next link resolves was what made a skip look like it
      // had been ignored: the previous track kept playing over the new metadata.
      // With one, it stays audible so `play()` can fade it out underneath the
      // incoming track - exactly the overlap the setting promises.
      if (engine.crossfade() <= 0) engine.pause();
      switchingRef.current = true;

      setTrack(t);
      setPlaying(true);
      setTime(0);
      setDur(t.duration);
      retryIndexRef.current = 0;
      streamsRef.current = [];
      streamPolicyRef.current = 'UNKNOWN';
      streamNextRef.current = null;
      advancingRef.current = false;
      previewRef.current = false;

      let buffTimer: number | null = window.setTimeout(() => {
        setBuffering(true);
      }, 250);

      const { candidates, policy, previewOnly, drmOnly, next, unblockedFull, actualDuration } = await api.resolveStreams(t);
      if (buffTimer) {
        window.clearTimeout(buffTimer);
        buffTimer = null;
      }
      if (token !== loadTokenRef.current) return;

      streamsRef.current = candidates;
      streamPolicyRef.current = policy;
      streamNextRef.current = next ?? null;
      previewRef.current = previewOnly;
      switchingRef.current = false;

      if (actualDuration && actualDuration > 0) {
        setDur(actualDuration);
        setTrack((prev) =>
          prev ? { ...prev, duration: actualDuration, durationFormatted: fmtTime(actualDuration) } : prev
        );
      }

      if (candidates.length === 0) {
        // No usable link. "Only encrypted formats" is a different situation
        // from "gone": the track is right there, it just cannot be decoded here.
        engine.load(null);
        setBuffering(false);
        setPlaying(false);
        notify(
          policy === 'BLOCK'
            ? `"${t.title}" is not available in this region`
            : drmOnly
              ? `"${t.title}" is DRM protected and cannot be played here`
              : `"${t.title}" is no longer available on SoundCloud`
        );
        return;
      }

      if (unblockedFull) {
        notify(`"${t.title}" — Full track unblocked`);
      } else if (previewOnly) {
        notify(`"${t.title}" (SoundCloud Go+) — 30s preview`);
      }

      engine.load(candidates[0].url);
      await engine.play();
      switchingRef.current = false;

      // Recorded once the audio is actually on its way, so the history never
      // lists a track that failed to resolve or was skipped past.
      api.pushHistory(t);
    },
    [api, engine, notify]
  );

  const next = useCallback(() => {
    const q = queueRef.current;
    if (q.length === 0) return;
    if (shuffle) {
      const pick = q[Math.floor(Math.random() * q.length)];
      void playTrack(pick, q);
      return;
    }
    const cur = trackRef.current;
    const i = cur ? q.findIndex((t) => t.id === cur.id) : -1;
    const n = (i + 1) % q.length;
    void playTrack(q[n], q);
  }, [playTrack, shuffle]);

  /**
   * Autodiscovery: instead of looping whatever queue the track came from, ask
   * SoundCloud for something in the same vein and keep the run going.
   *
   * `discoverRef` stays locked for the whole fetch so a second track ending
   * cannot stack requests, and it is only released once the new queue is in
   * place, which is what makes the related list the queue. A seed with nothing
   * to offer falls back to the normal queue so playback never dead-ends.
   */
  const discoverRef = useRef(false);

  /**
   * Bumped whenever the listener picks a track by hand. A pending related
   * request that lands afterwards would otherwise yank playback away from the
   * track the user just chose.
   */
  const navToken = useRef(0);

  const discoverMore = useCallback(
    async (seed: Track) => {
      if (discoverRef.current) return;
      discoverRef.current = true;
      const token = navToken.current;
      let found: Track[] = [];
      try {
        found = (await api.loadRelated(seed)).filter(
          (t) => t.id !== seed.id && t.duration > 0
        );
      } catch {
        found = [];
      }
      discoverRef.current = false;

      // Stale: the user moved on while the request was in flight.
      if (token !== navToken.current) return;

      if (found.length > 0) {
        // The related list becomes the queue, so this can keep drifting.
        await playTrack(found[0], found);
        notify(`Playing something like ${seed.title}`);
      } else {
        notify(`Nothing new for ${seed.title}`);
        next();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api.loadRelated, playTrack, notify, next]
  );

  const [loadingSimilarQueue, setLoadingSimilarQueue] = useState(false);

  /**
   * Fill the rest of the queue on demand.
   *
   * Fetches related tracks and inserts them right after the current one, so they
   * play next rather than at the end, without interrupting what is playing.
   */
  const triggerEndOfQueue = useCallback(async () => {
    const cur = trackRef.current;
    const seed = cur || queueRef.current[queueRef.current.length - 1];
    if (!seed) {
      notify('Play a track first to fill the queue');
      return;
    }
    setLoadingSimilarQueue(true);
    notify(`Looking for tracks similar to "${seed.title}"...`);
    try {
      const found = (await api.loadRelated(seed)).filter(
        (t) => t.id !== seed.id && t.duration > 0
      );
      if (found.length > 0) {
        const currentQueue = queueRef.current;
        const curIdx = cur ? currentQueue.findIndex((t) => t.id === cur.id) : -1;

        // Drop anything already queued.
        const existingIds = new Set(currentQueue.map((t) => t.id));
        const uniqueFound = found.filter((t) => !existingIds.has(t.id));
        const toAdd = uniqueFound.length > 0 ? uniqueFound : found;

        let nextQueue: Track[];
        if (curIdx !== -1) {
          // Insert straight after the playing track so these are the next ones heard.
          nextQueue = [
            ...currentQueue.slice(0, curIdx + 1),
            ...toAdd,
            ...currentQueue.slice(curIdx + 1),
          ];
        } else if (cur) {
          nextQueue = [cur, ...toAdd];
        } else {
          nextQueue = [...currentQueue, ...toAdd];
        }

        queueRef.current = nextQueue;
        setQueue(nextQueue);
        notify(`Added ${toAdd.length} tracks to the queue - they play after "${seed.title}"`);
      } else {
        notify(`No similar tracks found for "${seed.title}"`);
      }
    } catch {
      notify('Could not load similar tracks');
    } finally {
      setLoadingSimilarQueue(false);
    }
  }, [api, notify]);

  /**
   * Append related tracks to the end of the queue, based on the last queued
   * track, without interrupting playback.
   */
  const appendSimilarToQueue = useCallback(async () => {
    const q = queueRef.current;
    const seed = q.length > 0 ? q[q.length - 1] : trackRef.current;
    if (!seed) {
      notify('The queue is empty - play something first');
      return;
    }
    setLoadingSimilarQueue(true);
    notify('Fetching similar tracks for the end of the queue...');
    try {
      const existingIds = new Set(q.map((t) => t.id));
      const found = (await api.loadRelated(seed)).filter(
        (t) => !existingIds.has(t.id) && t.duration > 0
      );
      if (found.length > 0) {
        setQueue((prev) => [...prev, ...found]);
        notify(`Added ${found.length} similar tracks to the end of the queue`);
      } else {
        notify(`No new similar tracks for "${seed.title}"`);
      }
    } catch {
      notify('Could not load similar tracks');
    } finally {
      setLoadingSimilarQueue(false);
    }
  }, [api, notify]);

  const clearQueue = useCallback(() => {
    if (trackRef.current) {
      setQueue([trackRef.current]);
      notify('Queue cleared (kept the current track)');
    } else {
      setQueue([]);
      notify('Queue cleared');
    }
  }, [notify]);

  /**
   * Appends one track to the end of the queue.
   *
   * Unlike `appendSimilarToQueue` this never fetches anything and never touches
   * playback: it is the explicit "play this later" action, so a track that is
   * already queued is reported rather than added twice.
   */
  const addToQueue = useCallback(
    (t: Track) => {
      if (queueRef.current.some((q) => q.id === t.id)) {
        notify(`"${t.title}" is already in the queue`);
        return;
      }
      setQueue((prev) => [...prev, t]);
      notify(`Added "${t.title}" to the queue`);
    },
    [notify]
  );

  /**
   * Inserts one track right after the currently playing track in the queue,
   * so it will play as the very next track.
   */
  const playNext = useCallback(
    (t: Track) => {
      const cur = trackRef.current;
      setQueue((prev) => {
        const remaining = prev.filter((q) => q.id !== t.id);
        if (!cur) {
          return [t, ...remaining];
        }
        const curIndex = remaining.findIndex((q) => q.id === cur.id);
        if (curIndex === -1) {
          return [t, ...remaining];
        }
        const nextQueue = [...remaining];
        nextQueue.splice(curIndex + 1, 0, t);
        return nextQueue;
      });
      notify(`"${t.title}" will play next`);
    },
    [notify]
  );

  const prev = useCallback(() => {
    const q = queueRef.current;
    if (q.length === 0) return;
    const cur = trackRef.current;
    const pos = cur?.source === 'spotify' ? timeRef.current : engine.currentTime();
    if (pos > 3) {
      if (cur?.source === 'spotify') void spotifyRef.current.seek(0);
      else engine.seek(0);
      return;
    }
    const i = cur ? q.findIndex((t) => t.id === cur.id) : -1;
    const p = (i - 1 + q.length) % q.length;
    void playTrack(q[p], q);
  }, [engine, playTrack]);

  const toggle = useCallback(() => {
    if (!trackRef.current) return;
    // Spotify's SDK reports its own paused/playing state, so there is no
    // optimistic flip here - the state callback drives the UI.
    if (trackRef.current.source === 'spotify') {
      if (playingRef.current) void spotifyRef.current.pause();
      else void spotifyRef.current.resume();
      return;
    }
    setPlaying((p) => {
      if (p) engine.pause();
      else void engine.play();
      return !p;
    });
  }, [engine]);

  /** Time-bar seeking that follows whichever transport the track uses. */
  const seekTo = useCallback(
    (sec: number) => {
      if (trackRef.current?.source === 'spotify') void spotifyRef.current.seek(sec * 1000);
      else engine.seek(sec);
    },
    [engine]
  );

  /* ---------------------- listen together / friends ---------------------- */
  const listenTogether = useListenTogether({
    currentTrack: track,
    isPlaying: playing,
    currentTime: time,
    duration: dur,
    defaultUsername: api.me?.username,
    defaultAvatarUrl: api.me?.avatarUrl,
    onPlayTrack: async (remoteTrack) => {
      await playTrack(remoteTrack, [remoteTrack]);
    },
    onPlay: () => {
      if (!playingRef.current) {
        if (trackRef.current?.source === 'spotify') void spotifyRef.current.resume();
        else void engine.play();
        setPlaying(true);
      }
    },
    onPause: () => {
      if (playingRef.current) {
        if (trackRef.current?.source === 'spotify') void spotifyRef.current.pause();
        else engine.pause();
        setPlaying(false);
      }
    },
    onSeek: (seconds) => {
      seekTo(seconds);
    },
    notify,
  });

  const onlineFriendsCount = useMemo(() => {
    return listenTogether.friends.filter((f) => listenTogether.presences[f.code]?.online).length;
  }, [listenTogether.friends, listenTogether.presences]);

  // Media element -> React state
  useEffect(() => {
    // Media element -> React state. The engine owns two playback elements and
    // only one is audible at a time, so handlers are attached to both and each
    // one ignores events from elements that are not the current or next target.
    // Otherwise a crossfade's outgoing pause, or the standby element quietly
    // buffering, would read as the user pausing the track they asked for.
    const els = engine.audioElements();
    if (!els.length) return;
    const onTime = (a: HTMLAudioElement) => () => {
      if (a !== engine.getActive()) return;
      setTime(a.currentTime);
    };
    const onMeta = (a: HTMLAudioElement) => () => {
      if (a !== engine.getActive()) return;
      setDur(isFinite(a.duration) ? a.duration : 0);
    };
    const onWaiting = (a: HTMLAudioElement) => () => {
      if (a !== engine.getActive()) return;
      setBuffering(true);
    };
    const onPlaying = (a: HTMLAudioElement) => () => {
      if (a !== engine.getActive()) return;
      setBuffering(false);
      setPlaying(true);
    };
    // The outgoing track is paused on purpose when switching, and that pause
    // must not be read as the user pressing pause on the new one.
    const onPause = (a: HTMLAudioElement) => () => {
      if (a !== engine.getActive()) return;
      if (switchingRef.current) return;
      setPlaying(false);
    };
    /**
     * A stream that fails is walked forward one format at a time before the
     * track is called unplayable. Silent once a candidate is loading, because
     * a geo-restricted track that recovers should not produce a scary message.
     *
     * The walk resolves one format at a time rather than reading a list that was
     * built up front: the other formats are still reachable, they are just no
     * longer paid for before playback has established that the first one fails.
     *
     * The staged element is not the active one yet, which is why the guard has
     * to accept it too: its refusal to load is still the cue to retry.
     */
    const onError = (a: HTMLAudioElement) => async () => {
      if (a !== engine.getActive() && !engine.isMediaTarget(a)) return;
      // Changing src aborts whatever was loading, and Chromium reports that as
      // an error on the element. Acting on it here would restart the ladder
      // for a track that is still being resolved.
      if (switchingRef.current || advancingRef.current) return;

      advancingRef.current = true;
      const token = loadTokenRef.current;
      try {
        const rung = retryIndexRef.current + 1;
        let candidate = streamsRef.current[rung];
        if (!candidate) {
          const fetched = await streamNextRef.current?.();
          if (token !== loadTokenRef.current) return;
          if (fetched) {
            streamsRef.current = [...streamsRef.current, fetched];
            candidate = fetched;
          }
        }

        if (candidate) {
          retryIndexRef.current = rung;
          engine.load(candidate.url);
          void engine.play();
          return;
        }
        setBuffering(false);
        setPlaying(false);
        notify(
          streamPolicyRef.current === 'BLOCK'
            ? `"${trackRef.current?.title ?? 'That track'}" is not available in this region`
            : 'Could not play that stream - every available format was refused'
        );
      } finally {
        advancingRef.current = false;
      }
    };
    for (const a of els) {
      a.addEventListener('timeupdate', onTime(a));
      a.addEventListener('loadedmetadata', onMeta(a));
      a.addEventListener('waiting', onWaiting(a));
      a.addEventListener('playing', onPlaying(a));
      a.addEventListener('pause', onPause(a));
      a.addEventListener('error', onError(a));
    }
    return () => {
      for (const a of els) {
        a.removeEventListener('timeupdate', onTime(a));
        a.removeEventListener('loadedmetadata', onMeta(a));
        a.removeEventListener('waiting', onWaiting(a));
        a.removeEventListener('playing', onPlaying(a));
        a.removeEventListener('pause', onPause(a));
        a.removeEventListener('error', onError(a));
      }
    };
  }, [engine, notify]);

  /**
   * Hands playback over to the next thing when the active track is done.
   *
   * Runs both from the `ended` event (the track already stopped, so the switch
   * is a cut) and from the engine's near-end callback (the track is still
   * audible, so `play()` can crossfade it into the next one). The one split
   * between the two is repeat-once: there the near-end does nothing and the
   * ended event restarts the same track.
   */
  const advanceOnEnd = useCallback(
    (near: boolean) => {
      // A pause during a switch can surface as an end event on some builds.
      // Acting on it would advance a second time and skip a track the user
      // never asked to leave.
      if (switchingRef.current) return;

      const cur = trackRef.current;

      if (repeat === 'one') {
        // Near the end there is nothing to hand over - the same track plays
        // again. Let it finish; the ended event restarts it cleanly.
        if (near) return;
        engine.seek(0);
        void engine.play();
        return;
      }

      const q = queueRef.current;
      const idx = cur ? q.findIndex((t) => t.id === cur.id) : -1;

      // A preview ending is not the track ending. Without this the queue moved
      // on and the 30 second cut was indistinguishable from a normal finish,
      // which is what made restricted tracks look like a broken player. Warned
      // at the point of actually advancing, so the near-end handover and the
      // real end do not toast twice.
      const warnPreview = () =>
        notify(`Preview ended - "${cur?.title ?? 'that track'}" requires SoundCloud Go+ (30s preview)`);

      // Only the real end of the queue hands over to autodiscovery. Without
      // this check every finished track abandoned the playlist and jumped
      // straight to a related one.
      const atEnd = idx === -1 || idx >= q.length - 1;

      /**
       * Autodiscovery is always on. It fires only at the true end of the
       * queue, and never while a loop is engaged: repeat 'one' already
       * returned above, and repeat 'all' means the user asked to hear the
       * queue again. Shuffle also opts out, because jumping to a related
       * track would fight the shuffled order.
       */
      if (repeat !== 'all' && !shuffle && atEnd && !discoverRef.current && cur) {
        if (previewRef.current) warnPreview();
        void discoverMore(cur);
        return;
      }

      if (repeat === 'off' && q.length <= 1) {
        // Near the end the track is still running its final crossfade out for
        // nothing - there is no next one. Let it finish on its own.
        if (near) return;
        if (previewRef.current) warnPreview();
        setPlaying(false);
        return;
      }

      if (previewRef.current) warnPreview();
      next();
    },
    [engine, next, repeat, shuffle, discoverMore, notify]
  );

  useEffect(() => engine.onEnded(() => advanceOnEnd(false)), [engine, advanceOnEnd]);

  useEffect(() => engine.onNearEnd(() => advanceOnEnd(true)), [engine, advanceOnEnd]);

  // Volume drives both transports: the element engine and the Spotify device.
  useEffect(() => {
    const v = muted ? 0 : volume;
    engine.setVolume(v);
    void spotifyRef.current.setVolume(v);
  }, [engine, volume, muted]);

  /**
   * Speed and pitch are pushed into the element from state, not the other way
   * round, so a stored preference is applied on launch and both values land in
   * the same commit. `setPref` also persists them, which is why there is no
   * separate write here.
   */
  const setRate = useCallback(
    (r: number) => {
      setRateState(r);
      setPref('playbackRate', r);
    },
    [setPref]
  );
  const setPreservePitch = useCallback(
    (on: boolean) => {
      setPreservePitchState(on);
      setPref('preservePitch', on);
    },
    [setPref]
  );

  useEffect(() => engine.setRate(rate), [engine, rate]);
  useEffect(() => engine.setPreservePitch(preservePitch), [engine, preservePitch]);
  useEffect(() => engine.setCrossfade(prefs.crossfade), [engine, prefs.crossfade]);

  /**
   * Warms the track that comes after the current one.
   *
   * The real switch still resolves its own stream, but the fifteen-minute
   * stream cache turns that into a memory hit and the buffer element fills the
   * HTTP cache in the meantime - so the next track starts warm instead of
   * waiting on a fresh fetch over the network.
   */
  useEffect(() => {
    if (!playing || !track) return;
    const q = queueRef.current;
    if (q.length <= 1) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        let nxt: Track | null = null;
        if (shuffle) {
          const others = q.filter((t) => t.id !== track.id);
          nxt = others.length ? others[Math.floor(Math.random() * others.length)] : null;
        } else {
          const i = q.findIndex((t) => t.id === track.id);
          nxt = i >= 0 ? q[(i + 1) % q.length] : q[0];
        }
        if (!nxt || nxt.id === track.id || !alive) return;
        const info = await api.resolveStreams(nxt);
        if (!alive) return;
        const first = info.candidates[0];
        if (first) engine.preload(first.url);

        // Pre-resolve the track after next into cache in background
        if (!shuffle && q.length > 2) {
          const i = q.findIndex((t) => t.id === track.id);
          const nextNext = q[(i + 2) % q.length];
          if (nextNext && nextNext.id !== track.id && alive) {
            void api.resolveStreams(nextNext).catch(() => {});
          }
        }
      } catch {
        /* best-effort; the real switch resolves on its own */
      }
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [playing, track, api, engine, shuffle]);

  useEffect(() => {
    if (heardleOpen && playing) {
      engine.pause();
      setPlaying(false);
    }
  }, [heardleOpen, playing, engine]);

  /**
   * Persists the volume, but only when "remember volume" is on.
   *
   * Written on a timer rather than on every frame: the slider emits far faster
   * than the disk does, and the preference is not worth a synchronous write per
   * pointer move.
   */
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  useEffect(() => {
    if (!prefs.rememberVolume) return;
    const t = window.setTimeout(() => setPref('volume', volumeRef.current), 400);
    return () => window.clearTimeout(t);
  }, [volume, muted, prefs.rememberVolume, setPref]);

  // Hardware media keys from the Electron shell
  useEffect(() => {
    const off = window.desktop?.onMediaCommand((action) => {
      if (action === 'toggle') toggle();
      else if (action === 'next') next();
      else if (action === 'prev') prev();
      else setPlaying(false);
    });
    return () => off?.();
  }, [toggle, next, prev]);

  // Desktop integration: Tray, Discord Rich Presence, and OS Notifications
  useEffect(() => {
    if (!window.desktop?.updatePlayerState) return;
    window.desktop.updatePlayerState({
      track: track
        ? {
            id: track.id,
            title: track.title,
            artist: track.artist,
            artwork: track.artwork,
            permalinkUrl: track.permalinkUrl,
          }
        : null,
      isPlaying: playing,
      currentTime: time,
      duration: dur,
      friendCode: listenTogether.profile.code,
      shareDiscordFriendCode: Boolean(listenTogether.profile.shareWithDiscord),
      showDiscordButtons: listenTogether.profile.showDiscordButtons !== false,
    });
  }, [track, playing, Math.floor(time / 5), dur, listenTogether.profile.code, listenTogether.profile.shareWithDiscord, listenTogether.profile.showDiscordButtons]);

  // Discord Rich Presence & Deep-link friend auto-add listener
  useEffect(() => {
    if (!window.desktop?.onDiscordJoinFriend) return;
    const unsub = window.desktop.onDiscordJoinFriend((code) => {
      if (!code) return;
      listenTogether.addFriend(code);
    });
    return () => unsub?.();
  }, [listenTogether]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="Search"]'
        );
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        } else {
          navTo('search');
        }
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) next();
        else
          seekTo(
            Math.min(dur, (trackRef.current?.source === 'spotify' ? timeRef.current : engine.currentTime()) + 5)
          );
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) prev();
        else
          seekTo(
            Math.max(0, (trackRef.current?.source === 'spotify' ? timeRef.current : engine.currentTime()) - 5)
          );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume((v) => Math.min(1, Math.round((v + 0.05) * 100) / 100));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume((v) => Math.max(0, Math.round((v - 0.05) * 100) / 100));
      } else if (e.key.toLowerCase() === 'm') {
        setMuted((m) => !m);
      } else if (e.key.toLowerCase() === 'l' && track) {
        void api.toggleLike(track);
      } else if (e.key.toLowerCase() === 's') {
        setShuffle((s) => !s);
      } else if (e.key.toLowerCase() === 'r') {
        setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, next, prev, engine, dur, track, api, navTo, setVolume, seekTo]);

  /* ------------------------------ data flow ------------------------------ */

  /**
   * The sidebar list.
   *
   * Only the signed-in account's own playlists - community/trending lists were
   * merged in before, which made it look like the user had saved them - and in
   * the order the user dragged them into on the left. The saved order is applied
   * here rather than at fetch time so a reorder shows instantly without waiting
   * on the network.
   */
  const basePlaylists = useMemo(
    () => api.accountPlaylists.slice(0, 50),
    [api.accountPlaylists]
  );

  useEffect(() => {
    setClientIdReady(true);
    const ordered = applyOrder(prefs.playlistOrder, basePlaylists);
    console.log('[App] re-applying order, new order:', ordered.map(p => p.id));
    setSidebarPlaylists(ordered);
  }, [basePlaylists, prefs.playlistOrder]);

  /** Persists a drag result and shows it without a refetch. */
  const reorderPlaylists = useCallback(
    (next: Playlist[]) => {
      console.log('[reorder] setting playlist order', next.map(p => p.id));
      setSidebarPlaylists(next);
      setPref('playlistOrder', orderFrom(next));
    },
    [setPref]
  );

  /** Back to whatever order SoundCloud returns. */
  const resetPlaylistOrder = useCallback(() => {
    setPref('playlistOrder', []);
  }, [setPref]);

  /** Puts every preference back to its default, including the sidebar order. */
  const resetPrefs = useCallback(() => {
    replacePrefs(defaultPrefs());
    notify('Settings reset to defaults');
  }, [replacePrefs, notify]);

  /**
   * True when the stored order differs from the fetched one, which is what the
   * sidebar's reset button keys off.
   */
  const orderCustomized = useMemo(() => {
    if (!prefs.playlistOrder.length || prefs.playlistOrder.length !== basePlaylists.length) {
      return false;
    }
    return prefs.playlistOrder.some((id, i) => basePlaylists[i]?.id !== id);
  }, [prefs.playlistOrder, basePlaylists]);

  const doSearch = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setActiveQuery(trimmed);
      setView('search');
      pushNav({ view: 'search', query: trimmed, key: `search:${trimmed.toLowerCase()}` });
      if (prefs.source === 'audius') {
        setAudiusResultsQuery(trimmed);
        setAudiusSearching(true);
        void searchAudius(trimmed)
          .then(setAudiusResults)
          .catch(() => setAudiusResults([]))
          .finally(() => setAudiusSearching(false));
        return;
      }
      if (prefs.source === 'spotify') {
        if (!spotifyRef.current.connected) {
          setSpotifyError('Connect a Spotify account in Settings to search its catalog');
          return;
        }
        setSpotifyResultsQuery(trimmed);
        setSpotifySearching(true);
        void spotifyRef.current
          .search(trimmed)
          .then(setSpotifyResults)
          .catch((e) => {
            setSpotifyResults([]);
            setSpotifyError(e instanceof Error ? e.message : 'Spotify search failed');
          })
          .finally(() => setSpotifySearching(false));
        return;
      }
      void api.runSearch(trimmed);
    },
    [api, pushNav, prefs.source]
  );

  /**
   * Audius has no per-account library, so the library view doubles as a home
   * screen when that source is active: it shows the trending chart, fetchable
   * without a token. Fetched once per session and reused.
   */
  useEffect(() => {
    if (prefs.source !== 'audius') return;
    if (trendingFetchedRef.current) return;
    trendingFetchedRef.current = true;
    setTrendingLoading(true);
    void trendingAudius()
      .then(setTrending)
      .catch(() => setTrending([]))
      .finally(() => setTrendingLoading(false));
  }, [prefs.source]);

  /**
   * Load the Spotify library once per session, when that source is active and an
   * account is connected. Liked songs are the guaranteed-playable core (playlists
   * are listed alongside them); a failure only surfaces a message, it never
   * blocks the rest of the app.
   */
  useEffect(() => {
    if (prefs.source !== 'spotify' || !spotify.connected) return;
    if (spotifyLibLoaded) return;
    setSpotifyLibLoaded(true);
    setSpotifyLibLoading(true);
    setSpotifyError(null);
    void Promise.all([
      spotifyRef.current.loadLiked().catch(() => [] as Track[]),
      spotifyRef.current.loadPlaylists().catch(() => [] as Playlist[]),
    ])
      .then(([liked, playlists]) => {
        setSpotifyLiked(liked);
        setSpotifyPlaylists(playlists);
      })
      .finally(() => setSpotifyLibLoading(false));
  }, [prefs.source, spotify.connected, spotifyLibLoaded]);

  // The redirect URI is fixed by the main process; show it so the user can
  // paste the exact same value into their Spotify app's redirect allow-list.
  useEffect(() => {
    let cancelled = false;
    void spotifyRedirectUri().then((uri) => {
      if (!cancelled) setSpotifyRedirect(uri);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openSimilar = useCallback(
    (seed: Track) => {
      setView('similar');
      pushNav({ view: 'similar', seed, key: `similar:${seed.id}` });
      void api.loadRelated(seed);
    },
    [api, pushNav]
  );

  /**
   * Discover, from the header.
   *
   * It lives there rather than in the player bar because it is navigation, not
   * transport: it opens the similar view and never touches the audio. Sitting
   * among shuffle and repeat it read as a fifth playback control, and it was
   * pressed expecting a skip.
   */
  /**
   * Loads the Discover feed when the home view is shown.
   *
   * `loadDiscover` guards itself, so re-entering the view (including through
   * Back) reuses the feed already in memory; the view's refresh button is the
   * only thing that forces a rebuild.
   */
  useEffect(() => {
    if (view === 'discover') void api.loadDiscover();
  }, [view, api.loadDiscover]);

  /**
   * The playlist row action, shared by every list that can offer it.
   *
   * Declared here rather than per view because the account playlists, the busy
   * flag and the two mutations all live in one place. Views pass it to
   * `TrackList` through `renderActions`.
   */
  const openPlaylist = useCallback(
    (p: Playlist) => {
      setView('playlist');
      pushNav({ view: 'playlist', playlist: p, key: `playlist:${p.id}` });
      void api.loadPlaylist(p);
    },
    [api, pushNav]
  );

  /**
   * Opens an artist page.
   *
   * The known user id is authoritative. Searching "ily" and then re-resolving
   * the username sent people to a different, empty same-named account (and a
   * 500 on the way), so an id we already have is never re-resolved.
   */
  const openArtist = useCallback(
    (artist: User | { id: string; username: string; permalinkUrl?: string }) => {
      const user: User = {
        id: artist.id,
        username: artist.username,
        fullName: 'fullName' in artist ? artist.fullName : artist.username,
        avatarUrl: 'avatarUrl' in artist ? artist.avatarUrl : '',
        permalinkUrl:
          'permalinkUrl' in artist && artist.permalinkUrl
            ? artist.permalinkUrl
            : `https://soundcloud.com/${encodeURIComponent(artist.username)}`,
        followersCount: 'followersCount' in artist ? artist.followersCount : 0,
        // Dropped here before, which made the artist header show "Following –"
        // for every profile reached through this path.
        followingsCount:
          'followingsCount' in artist ? artist.followingsCount : undefined,
        trackCount: 'trackCount' in artist ? artist.trackCount : 0,
        location: 'location' in artist ? artist.location : '',
      };
      setView('playlist');
      pushNav({ view: 'artist', user, key: `artist:${user.id}` });
      void api.loadUserTracks(user);
    },
    [api, pushNav]
  );

  const signIn = useCallback(async () => {
    setLoginError(null);
    setLoginPending(true);
    try {
      const res = await desktopLogin();
      if (!res.ok) {
        setLoginError(
          res.reason === 'closed'
            ? 'Login window was closed before finishing.'
            : res.reason === 'timeout'
              ? 'Timed out waiting for sign-in.'
              : 'Sign-in is only available in the desktop app.'
        );
        return;
      }
      // The token is already stored by desktopLogin; verify it works.
      setSyncing(true);
      await api.syncLikes();
      setSyncing(false);
      // Now that the account is known, rebuild the feed with the taste signal
      // the likes just provided.
      void api.loadDiscover({ force: true });
      notify('Signed in to SoundCloud');
    } catch {
      setLoginError('Could not complete sign-in. Please try again.');
    } finally {
      setLoginPending(false);
    }
  }, [api, notify]);

  /**
   * Spotify connect. Runs the PKCE flow in the main process and, on success,
   * the hook swaps in a live Web Playback SDK device on its own.
   */
  const spotifyConnect = useCallback(async () => {
    const clientId = prefs.spotifyClientId.trim();
    if (!clientId) {
      setSpotifyError('Paste your Spotify app Client ID above first');
      return;
    }
    setSpotifyError(null);
    setSpotifyLoginPending(true);
    try {
      await spotifyRef.current.login(clientId);
      setSpotifyLibLoaded(false);
      setSpotifyLiked([]);
      setSpotifyPlaylists([]);
      notify('Connected to Spotify');
    } catch (e) {
      setSpotifyError(e instanceof Error ? e.message : 'Spotify sign-in failed');
    } finally {
      setSpotifyLoginPending(false);
    }
  }, [prefs.spotifyClientId, notify]);

  const spotifyDisconnect = useCallback(() => {
    spotifyRef.current.logout();
    setSpotifyLiked([]);
    setSpotifyPlaylists([]);
    setSpotifyLibLoaded(false);
    setSpotifyResults([]);
    notify('Disconnected from Spotify');
  }, [notify]);

  /** Opens a Spotify playlist by loading its tracks into the shared detail view. */
  const openSpotifyPlaylist = useCallback(
    (p: Playlist) => {
      if (p.tracks.length) {
        setSpotifyPlaylist(p);
        setView('playlist');
        pushNav({ view: 'playlist', playlist: p, key: `sp-playlist:${p.id}` });
        return;
      }
      setSpotifyLibLoading(true);
      void spotifyRef.current
        .loadPlaylistTracks(p.id)
        .then((tracks) => {
          const full = { ...p, tracks, trackCount: tracks.length };
          setSpotifyPlaylist(full);
          setView('playlist');
          pushNav({ view: 'playlist', playlist: full, key: `sp-playlist:${p.id}` });
        })
        .catch((e) => setSpotifyError(e instanceof Error ? e.message : 'Could not load that playlist'))
        .finally(() => setSpotifyLibLoading(false));
    },
    [pushNav]
  );

  /**
   * The playlist row action, shared by every list that can offer it.
   *
   * Declared here rather than per view because the account playlists, the busy
   * flag and the two mutations all live in one place. Views pass it to
   * `TrackList` through `renderActions`.
   */
  const playlistAction = useCallback(
    (t: Track, alwaysVisible = false) => {
      // Likes and playlist edits are SoundCloud-account operations; an Audius
      // track has no such home, so the affordance simply does not appear.
      if (!isSoundCloudTrack(t)) return null;
      return (
        <div className="flex items-center gap-0.5">
          <PlaylistAddButton
            track={t}
            playlists={api.accountPlaylists}
            busy={api.playlistBusy}
            signedIn={Boolean(api.me)}
            onLogin={signIn}
            onAdd={(playlist, track) => void api.addToPlaylist(playlist, track)}
            onCreate={(title) => api.createPlaylist(title)}
            alwaysVisible={alwaysVisible}
          />
        </div>
      );
    },
    [api, signIn]
  );

  /** Like requests are SoundCloud-only too; hide them is not enough everywhere. */
  const toggleLike = useCallback(
    (t: Track) => {
      if (!isSoundCloudTrack(t)) return;
      void api.toggleLike(t);
    },
    [api]
  );

  const saveManualToken = useCallback(async () => {
    const token = manualToken.trim();
    if (token.length < 10) return;
    setManualPending(true);
    setLoginError(null);
    setAuthToken(token);
    try {
      setSyncing(true);
      await api.syncLikes();
      setSyncing(false);
      setManualToken('');
      notify('Token accepted');
    } catch {
      setLoginError('SoundCloud rejected that token.');
      clearAuthToken();
    } finally {
      setManualPending(false);
    }
  }, [manualToken, api, notify]);

  const logout = useCallback(() => {
    void desktopLogout();
    api.setMe(null);
    notify('Disconnected from SoundCloud');
  }, [api, notify]);

  /* ------------------------------- render ------------------------------- */

  const playingId = playing ? track?.id ?? null : null;

  return (
    <div
      className="relative h-full flex bg-sc-bg text-sc-fg overflow-hidden"
      style={{ isolation: 'isolate' }}
    >
      <AtmosphereLayer
        track={track}
        isPlaying={playing}
        prefs={prefs}
        getFreq={engine.getFreq}
      />

      <Sidebar
        view={view}
        onNavigate={navTo}
        playlists={sidebarPlaylists}
        likedCount={api.likedIds.length}
        clientIdReady={clientIdReady}
        onPickPlaylist={openPlaylist}
        onReorder={reorderPlaylists}
        orderCustomized={orderCustomized}
        onResetOrder={resetPlaylistOrder}
        activePlaylistId={view === 'playlist' ? (api.currentPlaylist?.id ?? null) : null}
        hiddenPlaylistIds={prefs.hiddenPlaylistIds}
        onHidePlaylist={(id) => {
          const next = [...(prefs.hiddenPlaylistIds || []), id];
          setPref('hiddenPlaylistIds', next);
          notify('Playlist hidden');
        }}
        onOpenHeardle={() => {
          if (playing) {
            engine.pause();
            setPlaying(false);
          }
          setHeardleOpen(true);
        }}
        proxyEnabled={prefs.proxyEnabled}
        proxyPreset={prefs.proxyPreset}
        onlineFriendsCount={onlineFriendsCount}
        isSyncActive={listenTogether.syncSession.mode !== 'idle'}
        friendsDrawerOpen={friendsDrawerOpen}
        onToggleFriendsDrawer={() => setFriendsDrawerOpen((prev) => !prev)}
      />

      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {/*
          Header layout.

          Both side columns are `flex-1 min-w-0`, so they are always the same
          width and the search field sits over the true middle of the window at
          any size. The `min-w-0` is load-bearing: a flex item defaults to
          `min-width: auto`, so the column holding the Settings button refused to
          shrink below its content and pushed the field off-centre on a narrow
          window. Equal `flex-1` columns also mean the field is squeezed only
          after both sides have given ground equally.
        */}
        <header className="relative h-16 shrink-0 flex items-center justify-between px-4 sm:px-6 border-b border-white/[0.06] backdrop-blur-xl bg-sc-panel/20">
          {/* Left: Navigation history */}
          <div className="flex items-center gap-1 z-10 shrink-0">
            <button
              onClick={goBack}
              disabled={histIndex === 0}
              title="Go back (Alt+Left or Mouse 4)"
              aria-label="Go back"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sc-muted transition-all duration-150 hover:bg-sc-fill/6 hover:text-sc-fg hover:scale-110 active:scale-90 active:-translate-x-0.5 disabled:opacity-25 disabled:hover:scale-100 disabled:hover:bg-transparent disabled:hover:text-sc-muted cursor-pointer"
            >
              <ChevronLeft className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={goForward}
              disabled={histIndex >= history.length - 1}
              title="Go forward (Alt+Right or Mouse 5)"
              aria-label="Go forward"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sc-muted transition-all duration-150 hover:bg-sc-fill/6 hover:text-sc-fg hover:scale-110 active:scale-90 active:translate-x-0.5 disabled:opacity-25 disabled:hover:scale-100 disabled:hover:bg-transparent disabled:hover:text-sc-muted cursor-pointer"
            >
              <ChevronRight className="w-[18px] h-[18px]" />
            </button>
          </div>

          {/* Center: SearchBar (precisely centered in window) */}
          <div className="absolute left-1/2 -translate-x-1/2 w-full max-w-[540px] px-4 pointer-events-none">
            <div className="pointer-events-auto w-full">
              <SearchBar
                query={query}
                onQueryChange={setQuery}
                onSubmit={doSearch}
                loading={
                  prefs.source === 'audius'
                    ? audiusSearching
                    : prefs.source === 'spotify'
                      ? spotifySearching
                      : api.isSearching
                }
                placeholder={
                  prefs.source === 'audius'
                    ? 'Search the open Audius catalog...'
                    : prefs.source === 'spotify'
                      ? 'Search Spotify...'
                      : 'Search tracks, artists, or paste a SoundCloud link...'
                }
                ariaLabel={
                  prefs.source === 'audius'
                    ? 'Search Audius'
                    : prefs.source === 'spotify'
                      ? 'Search Spotify'
                      : 'Search SoundCloud'
                }
              />
            </div>
          </div>

          {/* Right: Friends button & own profile */}
          <div className="flex items-center gap-2.5 z-10 shrink-0">
            {/* Friends popover trigger button */}
            <button
              onClick={() => setFriendsDrawerOpen((prev) => !prev)}
              title={
                listenTogether.syncSession.mode !== 'idle'
                  ? 'Listening together with friend'
                  : onlineFriendsCount > 0
                    ? `Friends (${onlineFriendsCount} online)`
                    : 'Friends & Activity'
              }
              aria-label="Friends and Activity"
              className={clsx(
                'relative w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer',
                friendsDrawerOpen
                  ? 'bg-sc-orange text-sc-on-accent shadow-md scale-105'
                  : 'bg-white/5 hover:bg-white/10 text-sc-muted hover:text-sc-fg hover:scale-105 active:scale-95 border border-white/5'
              )}
            >
              <Users className="w-4 h-4" />
              {onlineFriendsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-emerald-500 text-[9px] font-extrabold text-white flex items-center justify-center shadow-xs">
                  {onlineFriendsCount}
                </span>
              )}
              {listenTogether.syncSession.mode !== 'idle' && (
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-sc-orange animate-ping" />
              )}
            </button>

            {api.me ? (
              <button
                onClick={() => openArtist(api.me!)}
                title={`Your profile - ${api.me.username}`}
                aria-label="Open your profile"
                className="group relative w-9 h-9 rounded-full overflow-hidden ring-2 ring-transparent hover:ring-sc-orange transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Artwork
                  src={api.me.avatarUrl}
                  seed={api.me.id}
                  size={67}
                  rounded="rounded-full"
                  className="w-full h-full"
                />
                <span className="absolute inset-0 bg-sc-orange/0 group-hover:bg-sc-orange/20 transition-colors" />
              </button>
            ) : (
              <button
                onClick={signIn}
                title="Sign in to SoundCloud"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-sc-orange text-sc-fg text-[12px] font-bold hover:bg-sc-orange-soft hover:text-sc-bg transition-all active:scale-95 cursor-pointer"
              >
                Sign in
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto scroll-rail min-h-0">
          <div
            key={
              view === 'playlist'
                ? api.currentPlaylist?.id ?? 'playlist'
                : view === 'search'
                  ? `search:${activeQuery}`
                  : view === 'similar'
                    ? `similar:${api.relatedSeed?.id ?? 'seed'}`
                    : view
            }
            className="animate-view min-h-full"
          >
          {view === 'discover' && (
            <DiscoverView
              sections={api.discoverSections}
              loading={api.isDiscoverLoading}
              likedIds={api.likedIds}
              playingId={playingId}
              isPlaying={playing}
              onPlay={playTrack}
              onToggleLike={toggleLike}
              onOpenArtist={openArtist}
              onFindSimilar={openSimilar}
              onPlayNext={playNext}
              onAddToQueue={addToQueue}
              onRefresh={() => void api.loadDiscover({ force: true })}
              renderActions={playlistAction}
            />
          )}

          {view === 'search' && (
            <SearchView
              query={
                prefs.source === 'audius'
                  ? audiusResultsQuery || activeQuery
                  : prefs.source === 'spotify'
                    ? spotifyResultsQuery || activeQuery
                    : activeQuery
              }
              tracks={
                prefs.source === 'audius'
                  ? audiusResults
                  : prefs.source === 'spotify'
                    ? spotifyResults
                    : api.searchResults
              }
              artists={prefs.source !== 'soundcloud' ? [] : api.searchArtists}
              playlists={prefs.source !== 'soundcloud' ? [] : api.searchPlaylists}
              loading={
                prefs.source === 'audius'
                  ? audiusSearching
                  : prefs.source === 'spotify'
                    ? spotifySearching
                    : api.isSearching
              }
              likedIds={api.likedIds}
              playingId={playingId}
              isPlaying={playing}
              onPlay={playTrack}
              onToggleLike={toggleLike}
              onOpenArtist={openArtist}
              onOpenPlaylist={openPlaylist}
              onFindSimilar={openSimilar}
              onPlayNext={playNext}
              onAddToQueue={addToQueue}
              renderActions={playlistAction}
              compact={prefs.compactRows}
              showArtwork={prefs.showArtwork}
            />
          )}

          {view === 'similar' && (
            <SimilarView
              seed={api.relatedSeed}
              tracks={api.relatedTracks}
              loading={api.isRelatedLoading}
              currentTrack={track}
              history={api.history}
              likedIds={api.likedIds}
              playingId={playingId}
              isPlaying={playing}
              onPick={api.loadRelated}
              onPlay={playTrack}
              onToggleLike={toggleLike}
              onOpenArtist={openArtist}
              onFindSimilar={openSimilar}
              onPlayNext={playNext}
              onAddToQueue={addToQueue}
              onOpenSearch={() => navTo('search')}
              renderActions={playlistAction}
              compact={prefs.compactRows}
              showArtwork={prefs.showArtwork}
            />
          )}

          {view === 'library' && (
            <LibraryView
              tracks={
                prefs.source === 'audius'
                  ? trending
                  : prefs.source === 'spotify'
                    ? spotifyLiked
                    : likedTracks
              }
              title={
                prefs.source === 'audius'
                  ? 'Trending on Audius'
                  : prefs.source === 'spotify'
                    ? 'Spotify library'
                    : undefined
              }
              subtitle={
                prefs.source === 'audius'
                  ? 'Open catalog, played the same way as SoundCloud. Nothing is tied to an account.'
                  : prefs.source === 'spotify'
                    ? 'Your liked songs, plus your playlists. Full playback needs Spotify Premium.'
                    : undefined
              }
              playlists={prefs.source === 'spotify' ? spotifyPlaylists : undefined}
              onOpenPlaylist={prefs.source === 'spotify' ? openSpotifyPlaylist : undefined}
              loading={
                prefs.source === 'audius' ? trendingLoading : prefs.source === 'spotify' ? spotifyLibLoading : false
              }
              showSignIn={prefs.source !== 'audius'}
              signInPrompt={
                prefs.source === 'spotify'
                  ? 'Connect a Spotify account in Settings to load your library. Full playback needs Premium.'
                  : undefined
              }
              signInLabel={prefs.source === 'spotify' ? 'Open Spotify settings' : undefined}
              likedIds={api.likedIds}
              playingId={playingId}
              isPlaying={playing}
              onPlay={playTrack}
              onToggleLike={toggleLike}
              onOpenArtist={openArtist}
              onFindSimilar={openSimilar}
              onPlayNext={playNext}
              onAddToQueue={addToQueue}
              signedIn={prefs.source === 'spotify' ? spotify.connected : Boolean(api.me)}
              onLogin={prefs.source === 'spotify' ? () => navTo('settings') : signIn}
              renderActions={playlistAction}
              compact={prefs.compactRows}
              showArtwork={prefs.showArtwork}
            />
          )}

          {view === 'playlist' && (
            <DetailView
              playlist={prefs.source === 'spotify' ? spotifyPlaylist : api.currentPlaylist}
              loading={prefs.source === 'spotify' ? false : api.status === 'loading'}
              likedIds={api.likedIds}
              playingId={playingId}
              isPlaying={playing}
              onPlay={playTrack}
              onToggleLike={toggleLike}
              onOpenArtist={openArtist}
              onBack={goBack}
              onPlayAll={(tracks) => tracks[0] && playTrack(tracks[0], tracks)}
              onPlayNext={playNext}
              onAddToQueue={addToQueue}
              signedIn={Boolean(api.me)}
              accountPlaylists={api.accountPlaylists}
              playlistTrackIds={(api.currentPlaylist?.tracks ?? []).map((t) => t.id)}
              playlistBusy={api.playlistBusy}
              onAddToPlaylist={(playlist, t) => void api.addToPlaylist(playlist, t)}
              onRemoveFromPlaylist={(playlist, t) => void api.removeFromPlaylist(playlist, t)}
              onCreatePlaylist={(title) => api.createPlaylist(title)}
              onDownload={(t) => void api.downloadTrack(t)}
              downloadingIds={api.downloadingIds}
              onLogin={signIn}
              compactRows={prefs.compactRows}
              showArtwork={prefs.showArtwork}
              currentTrack={track}
              currentTime={time}
              me={api.me}
              notify={notify}
              onSeekTo={seekTo}
            />
          )}

          {view === 'settings' && (
            <SettingsView
              prefs={prefs}
              onPref={setPref}
              onResetPrefs={resetPrefs}
              onClearCache={() => {
                void api.clearCache();
              }}
              onClearHistory={api.resetHistory}
              stats={stats}
              status={api.status}
              error={api.error}
              auth={{
                me: api.me,
                loginPending,
                loginError,
                onLogin: signIn,
                manualToken,
                onManualTokenChange: setManualToken,
                onManualTokenSave: saveManualToken,
                manualPending,
                onLogout: logout,
                onSync: () => {
                  setSyncing(true);
                  void api.syncLikes().finally(() => setSyncing(false));
                },
                syncing,
              }}
              eq={eq}
              onEq={changeEq}
              bandCount={eqCount}
              onBandCount={changeBandCount}
              visualizer={visualizer}
              onVisualizer={changeVisualizer}
              themes={themes}
              themeId={themeId}
              onTheme={setThemeId}
              onSaveCustomTheme={(theme) => {
                setThemes((prev) => {
                  const next = [theme, ...prev.filter((t) => t.id !== theme.id)];
                  saveCustomThemes(next.filter((t) => t.custom));
                  return next;
                });
                setThemeId(theme.id);
              }}
              onDeleteCustomTheme={(id) => {
                setThemes((prev) => {
                  const next = prev.filter((t) => t.id !== id);
                  saveCustomThemes(next.filter((t) => t.custom));
                  return next;
                });
                if (themeId === id) setThemeId(BUILT_IN_THEMES[0].id);
              }}
              focusSection={settingsSection}
              accountPlaylists={basePlaylists}
              spotify={{
                available: spotify.available,
                connected: spotify.connected,
                accountName: spotify.accountName,
                product: spotify.product,
                playerReady: spotify.playerReady,
                clientId: prefs.spotifyClientId,
                onClientIdChange: (v) => setPref('spotifyClientId', v),
                redirectUri: spotifyRedirect,
                loginPending: spotifyLoginPending,
                error: spotifyError,
                onConnect: () => void spotifyConnect(),
                onDisconnect: spotifyDisconnect,
              }}
            />
          )}

          {view === 'friends' && (
            <ListenTogetherView
              profile={listenTogether.profile}
              updateProfile={listenTogether.updateProfile}
              friends={listenTogether.friends}
              presences={listenTogether.presences}
              connectionStatus={listenTogether.connectionStatus}
              syncSession={listenTogether.syncSession}
              incomingInvites={listenTogether.incomingInvites}
              chatMessages={listenTogether.chatMessages}
              reactions={listenTogether.reactions}
              currentTrack={track}
              isPlaying={playing}
              onAddFriend={listenTogether.addFriend}
              onRemoveFriend={listenTogether.removeFriend}
              onRenameFriend={listenTogether.renameFriend}
              onFollowFriend={listenTogether.followFriend}
              onStopSync={listenTogether.stopSync}
              onInviteFriend={listenTogether.inviteFriend}
              onAcceptInvite={listenTogether.acceptInvite}
              onDismissInvite={listenTogether.dismissInvite}
              onCreateRoom={listenTogether.createRoom}
              onJoinRoom={listenTogether.joinRoom}
              onSendChatMessage={listenTogether.sendChatMessage}
              onSendReaction={listenTogether.sendReaction}
              onConnectToFriend={listenTogether.connectToFriend}
            />
          )}
          </div>
        </main>

        <PlayerBar
          track={track}
          isPlaying={playing}
          isBuffering={buffering}
          currentTime={time}
          duration={dur}
          volume={volume}
          muted={muted}
          liked={track ? api.likedIds.includes(track.id) : false}
          queue={queue}
          shuffle={shuffle}
          repeat={repeat}
          getFreq={engine.getFreq}
          onTogglePlay={toggle}
          onNext={next}
          onPrev={prev}
          onSeek={seekTo}
          onVolume={setVolume}
          onMute={() => setMuted((m) => !m)}
          rate={rate}
          onRate={setRate}
          preservePitch={preservePitch}
          onPreservePitch={setPreservePitch}
          onToggleLike={() => track && api.toggleLike(track)}
          onShuffle={() => setShuffle((s) => !s)}
          onRepeat={() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))}
          onOpenQueue={() => setQueueOpen((o) => !o)}
          queueOpen={queueOpen}
          onOpenFriends={() => setFriendsDrawerOpen((o) => !o)}
          isSyncActive={listenTogether.syncSession.mode !== 'idle'}
          syncTargetName={listenTogether.syncSession.targetName || listenTogether.syncSession.roomName}
          friends={listenTogether.friends}
          presences={listenTogether.presences}
          onFollowFriend={listenTogether.followFriend}
          syncSession={listenTogether.syncSession}
          onStopSync={listenTogether.stopSync}
          eq={eq}
          onEq={changeEq}
          visualizer={visualizer}
          visualizerThreshold={prefs.visualizerThreshold}
          visualizerSensitivity={prefs.visualizerSensitivity}
          visualizerSmoothing={prefs.visualizerSmoothing}
          visualizerBars={prefs.visualizerBars}
          renderPlaylistAction={playlistAction}
          onAddToQueue={addToQueue}
          onOpenSettings={(section) => navTo('settings', { section })}
          onOpenArtist={openArtist}
          me={api.me}
          signedIn={Boolean(api.me)}
          notify={notify}
          onRequireSignIn={() => navTo('settings', { section: 'account' })}
          bandCount={eqCount}
          onDownload={() => track && void api.downloadTrack(track)}
          downloading={Boolean(track && api.downloadingIds.includes(track.id))}
          onTriggerEndOfQueue={triggerEndOfQueue}
          loadingSimilarQueue={loadingSimilarQueue}
        />
      </div>

      {!clientIdReady && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-sc-bg/85 backdrop-blur-md animate-fade-in pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 rounded-3xl border border-sc-line bg-sc-panel shadow-2xl max-w-sm w-full mx-4 text-center pointer-events-auto">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-sc-orange/15 flex items-center justify-center text-sc-orange">
                <Cloud className="w-8 h-8 animate-pulse" />
              </div>
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-sc-orange animate-ping opacity-75" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-sc-fg tracking-tight">Connecting to SoundCloud</h3>
              <p className="text-[12px] text-sc-muted mt-1 leading-relaxed">
                Establishing connection and loading your music library...
              </p>
            </div>
            <div className="w-full h-1.5 rounded-full bg-sc-fill/10 overflow-hidden relative mt-1">
              <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-sc-orange to-sc-orange-soft rounded-full animate-indeterminate" />
            </div>
          </div>
        </div>
      )}

      <FriendsPopover
        isOpen={friendsDrawerOpen}
        onClose={() => setFriendsDrawerOpen(false)}
        profile={listenTogether.profile}
        updateProfile={listenTogether.updateProfile}
        friends={listenTogether.friends}
        presences={listenTogether.presences}
        connectionStatus={listenTogether.connectionStatus}
        syncSession={listenTogether.syncSession}
        incomingInvites={listenTogether.incomingInvites}
        chatMessages={listenTogether.chatMessages}
        reactions={listenTogether.reactions}
        currentTrack={track}
        isPlaying={playing}
        soundCloudUser={api.me}
        onAddFriend={listenTogether.addFriend}
        onRemoveFriend={listenTogether.removeFriend}
        onRenameFriend={listenTogether.renameFriend}
        onFollowFriend={listenTogether.followFriend}
        onStopSync={listenTogether.stopSync}
        onInviteFriend={listenTogether.inviteFriend}
        onAcceptInvite={listenTogether.acceptInvite}
        onDismissInvite={listenTogether.dismissInvite}
        onCreateRoom={listenTogether.createRoom}
        onJoinRoom={listenTogether.joinRoom}
        onSendChatMessage={listenTogether.sendChatMessage}
        onSendReaction={listenTogether.sendReaction}
        onConnectToFriend={listenTogether.connectToFriend}
      />

      {queueOpen && (
        <QueueDrawer
          queue={queue}
          currentId={track?.id ?? null}
          onClose={() => setQueueOpen(false)}
          onPlay={playTrack}
          onOpenArtist={openArtist}
          onTriggerEndOfQueue={triggerEndOfQueue}
          onAppendSimilar={appendSimilarToQueue}
          onClearQueue={clearQueue}
          loadingSimilar={loadingSimilarQueue}
        />
      )}

      <SoundHeardle
        isOpen={heardleOpen}
        onClose={() => setHeardleOpen(false)}
        likedTracks={api.likedTracks}
        playlists={sidebarPlaylists}
        resolvePlayable={api.resolvePlayable}
        onPlayFullTrack={(t) => {
          setHeardleOpen(false);
          void playTrack(t, [t]);
        }}
      />

      {!autoUpdater.dismissed && (
        <UpdateBanner
          updateState={autoUpdater.updateState}
          onDownload={autoUpdater.downloadUpdate}
          onInstall={autoUpdater.quitAndInstall}
          onDismiss={autoUpdater.dismiss}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}

export { App };