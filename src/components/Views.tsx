/**
 * Settings.
 *
 * Deliberately short. The old page was mostly diagnostics - a cache counter, an
 * in-flight gauge, a queue depth - which told a user nothing they could act on
 * and buried the three things that actually mattered: who you are signed in as,
 * how the player behaves, and how it looks. Those three are the whole page now,
 * and anything that needs its own space (themes, the advanced curve) lives
 * behind a disclosure rather than getting the top of the page by default.
 */

import { useEffect, useMemo, useState } from 'react';
import { Artwork } from './Artwork';
import {
  LogIn,
  LogOut,
  KeyRound,
  AlertTriangle,
  Sliders,
  Activity,
  Check,
  Compass,
  Palette,
  Trash2,
  Loader2,
  Music,
  Music4,
  Users,
  Disc3,
  Gauge,
  Sparkles,
  Volume2,
  Rows3,
  Image as ImageIcon,
  ListVideo,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Cloud,
  Globe,
  ShieldCheck,
  Wifi,
  RefreshCw,
  Server,
  Radio,
  Download,
  Folder,
  ArrowUpCircle,
  Waves,
  Headphones,
  Keyboard,
  Scissors,
  Pin,
  Maximize2,
  Eye,
  Heart,
  Shuffle,
  Repeat,
  Play,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useAutoUpdater } from '../hooks/useAutoUpdater';
import { playTypingSound, type SwitchType } from '../lib/typingAudio';
import type { Playlist, Track, User } from '../types';
import { TrackList, SectionHeader, SkeletonRows } from './TrackList';
import {
  EqResponseCurve,
  EqPresets,
  Spectrum,
  VISUALIZER_MODES,
  type VisualizerMode,
} from './Visualizer';
import { EQ_BAND_COUNTS, EQ_RANGE, bandsFor, type BandCount } from '../hooks/useAudioEngine';
import { themeFromAccent, themeSwatch, type ThemeDef, type ThemeMode } from '../lib/themes';
import type { Prefs } from '../lib/prefs';

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

interface SearchProps {
  query: string;
  tracks: Track[];
  artists: User[];
  playlists: Playlist[];
  loading: boolean;
  likedIds: string[];
  playingId: string | null;
  isPlaying: boolean;
  onPlay: (t: Track, q: Track[]) => void;
  onToggleLike: (t: Track) => void;
  onOpenArtist: (u: User | { id: string; username: string }) => void;
  onOpenPlaylist: (p: Playlist) => void;
  onFindSimilar: (seed: Track) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  renderActions?: (track: Track) => React.ReactNode;
  compact?: boolean;
  showArtwork?: boolean;
}

type Tab = 'all' | 'tracks' | 'artists' | 'playlists';

/** How the artist tab orders its results, matching SoundCloud's own two tabs. */
type ArtistSort = 'popular' | 'newest';

export function SearchView(p: SearchProps) {
  const [tab, setTab] = useState<Tab>('all');
  const [artistSort, setArtistSort] = useState<ArtistSort>('popular');

  // A new search starts on All by default to give a comprehensive overview
  useEffect(() => {
    setTab('all');
  }, [p.query]);

  const tabs: Array<{ id: Tab; label: string; count?: number; icon: typeof Music4 }> = [
    { id: 'all', label: 'All', icon: Sparkles },
    { id: 'tracks', label: 'Tracks', count: p.tracks.length, icon: Music4 },
    { id: 'artists', label: 'Artists', count: p.artists.length, icon: Users },
    { id: 'playlists', label: 'Playlists', count: p.playlists.length, icon: Disc3 },
  ];

  /**
   * Artist results come back in SoundCloud's relevance order, which mixes a
   * long tail of near-zero-follower accounts in with the well-known ones.
   * Popular sorts by followers; Newest sorts by signup date. Accounts whose
   * payload carried no `created_at` fall to the end of Newest rather than being
   * treated as brand new, otherwise a missing date would outrank real history.
   */
  const artists = useMemo(() => {
    if (artistSort === 'popular') {
      return [...p.artists].sort((a, b) => b.followersCount - a.followersCount);
    }
    const dated = (u: User) => (u.createdAt ? Date.parse(u.createdAt) : 0);
    return [...p.artists].sort((a, b) => dated(b) - dated(a));
  }, [p.artists, artistSort]);

  return (
    <div className="p-6 sm:p-8 max-w-[1560px] mx-auto w-full">
      <h1 className="text-2xl font-extrabold tracking-tight">
        Results for <span className="text-sc-orange">{p.query}</span>
      </h1>

      <div className="mt-5 flex items-center gap-1 border-b border-sc-line">
        {tabs.map(({ id, label, count, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'relative px-4 py-2.5 text-[13px] font-semibold transition-all duration-200 flex items-center gap-1.5 active:scale-95 cursor-pointer',
              tab === id ? 'text-sc-fg' : 'text-sc-muted hover:text-sc-fg'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {count !== undefined && <span className="text-[11px] tabular-nums text-sc-dim">{count}</span>}
            {tab === id && (
              <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-sc-orange animate-scale-in" />
            )}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {p.loading ? (
          <SkeletonRows count={8} compact={p.compact} />
        ) : tab === 'all' ? (
          <div className="space-y-8 animate-fade-in">
            {/* Top Artists Section */}
            {artists.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold flex items-center gap-2 text-sc-fg">
                    <Users className="w-4 h-4 text-sc-orange" />
                    Artists
                  </h2>
                  {artists.length > 4 && (
                    <button
                      type="button"
                      onClick={() => setTab('artists')}
                      className="text-xs font-semibold text-sc-orange hover:underline cursor-pointer"
                    >
                      View all {artists.length} artists
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {artists.slice(0, 4).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => p.onOpenArtist(a)}
                      className="group flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.032] backdrop-blur-md p-3.5 hover:border-sc-orange/50 hover:bg-white/[0.07] hover:-translate-y-0.5 active:scale-[0.98] hover:shadow-xl transition-all duration-300 text-left cursor-pointer"
                    >
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-sc-panel-2 shrink-0 ring-1 ring-white/10 shadow-sm">
                        <Artwork
                          src={a.avatarUrl}
                          seed={a.id}
                          size={200}
                          rounded="rounded-full"
                          className="w-full h-full transition-transform duration-300 group-hover:scale-110"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-sc-fg truncate group-hover:text-sc-orange transition-colors">
                          {a.fullName}
                        </div>
                        <div className="text-[12px] text-sc-muted truncate">
                          {a.followersCount.toLocaleString()} followers
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Tracks Section */}
            {p.tracks.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold flex items-center gap-2 text-sc-fg">
                    <Music4 className="w-4 h-4 text-sc-orange" />
                    Tracks
                  </h2>
                  {p.tracks.length > 10 && (
                    <button
                      type="button"
                      onClick={() => setTab('tracks')}
                      className="text-xs font-semibold text-sc-orange hover:underline cursor-pointer"
                    >
                      View all {p.tracks.length} tracks
                    </button>
                  )}
                </div>
                <TrackList
                  tracks={p.tracks}
                  likedIds={p.likedIds}
                  playingId={p.playingId}
                  isPlaying={p.isPlaying}
                  onPlay={p.onPlay}
                  onToggleLike={p.onToggleLike}
                  onOpenArtist={p.onOpenArtist}
                  onFindSimilar={p.onFindSimilar}
                  onPlayNext={p.onPlayNext}
                  onAddToQueue={p.onAddToQueue}
                  compact={p.compact}
                  showArtwork={p.showArtwork}
                  renderActions={p.renderActions}
                />
              </section>
            )}

            {/* Playlists Section */}
            {p.playlists.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold flex items-center gap-2 text-sc-fg">
                    <Disc3 className="w-4 h-4 text-sc-orange" />
                    Playlists
                  </h2>
                  {p.playlists.length > 4 && (
                    <button
                      type="button"
                      onClick={() => setTab('playlists')}
                      className="text-xs font-semibold text-sc-orange hover:underline cursor-pointer"
                    >
                      View all {p.playlists.length} playlists
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {p.playlists.slice(0, 4).map((pl) => (
                    <button
                      key={pl.id}
                      onClick={() => p.onOpenPlaylist(pl)}
                      className="group flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.032] backdrop-blur-md p-3.5 hover:border-sc-orange/50 hover:bg-white/[0.07] hover:-translate-y-0.5 active:scale-[0.98] hover:shadow-xl transition-all duration-300 text-left cursor-pointer"
                    >
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-sc-panel-2 shrink-0 shadow-sm ring-1 ring-white/10">
                        <Artwork
                          src={pl.artwork}
                          seed={pl.id}
                          size={200}
                          className="w-full h-full transition-transform duration-300 group-hover:scale-110"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-sc-fg truncate group-hover:text-sc-orange transition-colors">
                          {pl.title}
                        </div>
                        <div className="text-[12px] text-sc-muted truncate">{pl.trackCount} tracks</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {p.tracks.length === 0 && artists.length === 0 && p.playlists.length === 0 && (
              <div className="py-12 text-center text-sc-muted">
                No results found for &quot;{p.query}&quot;.
              </div>
            )}
          </div>
        ) : tab === 'tracks' ? (
          <TrackList
            tracks={p.tracks}
            likedIds={p.likedIds}
            playingId={p.playingId}
            isPlaying={p.isPlaying}
            onPlay={p.onPlay}
            onToggleLike={p.onToggleLike}
            onOpenArtist={p.onOpenArtist}
            onFindSimilar={p.onFindSimilar}
            onPlayNext={p.onPlayNext}
            onAddToQueue={p.onAddToQueue}
            compact={p.compact}
            showArtwork={p.showArtwork}
            renderActions={p.renderActions}
          />
        ) : tab === 'artists' ? (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-sc-muted mr-1">
                Sort
              </span>
              {(
                [
                  { id: 'popular', label: 'Popular', icon: Gauge },
                  { id: 'newest', label: 'Newest', icon: Sparkles },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setArtistSort(id)}
                  aria-pressed={artistSort === id}
                  title={id === 'popular' ? 'Most followers first' : 'Newest accounts first'}
                  className={clsx(
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-bold transition-all duration-150 cursor-pointer active:scale-95',
                    artistSort === id
                      ? 'bg-sc-orange/15 text-sc-orange-soft border border-sc-orange/50 shadow-xs'
                      : 'bg-sc-panel-2/40 text-sc-dim border border-sc-line hover:text-sc-fg hover:bg-sc-fill/5'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
              {/* Ties fall back to name, so the order is stable between two
                  loads of the same results instead of shuffling on every
                  keystroke that re-renders the tab. */}
              <span className="text-[11px] text-sc-faint ml-auto">
                {artists.length} {artists.length === 1 ? 'artist' : 'artists'}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {artists.map((a) => (
                <button
                  key={a.id}
                  onClick={() => p.onOpenArtist(a)}
                  className="group flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.032] backdrop-blur-md p-3.5 hover:border-sc-orange/50 hover:bg-white/[0.07] hover:-translate-y-0.5 active:scale-[0.98] hover:shadow-xl transition-all duration-300 text-left cursor-pointer animate-scale-in"
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-sc-panel-2 shrink-0 ring-1 ring-white/10 shadow-sm">
                    <Artwork
                      src={a.avatarUrl}
                      seed={a.id}
                      size={200}
                      rounded="rounded-full"
                      className="w-full h-full transition-transform duration-300 group-hover:scale-110"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-sc-fg truncate group-hover:text-sc-orange transition-colors">
                      {a.fullName}
                    </div>
                    <div className="text-[12px] text-sc-muted truncate">
                      {a.followersCount.toLocaleString()} followers
                    </div>
                  </div>
                </button>
              ))}
              {artists.length === 0 && <p className="text-[13px] text-sc-muted">No artists found.</p>}
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {p.playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => p.onOpenPlaylist(pl)}
                className="group flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.032] backdrop-blur-md p-3.5 hover:border-sc-orange/50 hover:bg-white/[0.07] hover:-translate-y-0.5 active:scale-[0.98] hover:shadow-xl transition-all duration-300 text-left cursor-pointer animate-scale-in"
              >
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-sc-panel-2 shrink-0 shadow-sm ring-1 ring-white/10">
                  <Artwork
                    src={pl.artwork}
                    seed={pl.id}
                    size={200}
                    className="w-full h-full transition-transform duration-300 group-hover:scale-110"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-sc-fg truncate group-hover:text-sc-orange transition-colors">
                    {pl.title}
                  </div>
                  <div className="text-[12px] text-sc-muted truncate">{pl.trackCount} tracks</div>
                </div>
              </button>
            ))}
            {p.playlists.length === 0 && (
              <p className="text-[13px] text-sc-muted">No playlists found.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Library                                                                     */
/* -------------------------------------------------------------------------- */

interface LibraryProps {
  tracks: Track[];
  /** Overrides the heading when the library doubles as another feed. */
  title?: string;
  subtitle?: string;
  loading?: boolean;
  /** Audius has no account library, so the sign-in invite is hidden there. */
  showSignIn?: boolean;
  signInPrompt?: string;
  signInLabel?: string;
  playlists?: Playlist[];
  onOpenPlaylist?: (p: Playlist) => void;
  likedIds: string[];
  playingId: string | null;
  isPlaying: boolean;
  onPlay: (t: Track, q: Track[]) => void;
  onToggleLike: (t: Track) => void;
  onOpenArtist: (u: User | { id: string; username: string }) => void;
  onFindSimilar: (seed: Track) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  signedIn: boolean;
  onLogin: () => void;
  renderActions?: (track: Track) => React.ReactNode;
  compact?: boolean;
  showArtwork?: boolean;
}

export function LibraryView(p: LibraryProps) {
  const showSignIn = p.showSignIn !== false;
  return (
    <div className="p-6 sm:p-8 max-w-[1560px] mx-auto w-full">
      <h1 className="text-2xl font-extrabold tracking-tight">{p.title ?? 'Liked Tracks'}</h1>
      <p className="text-[13px] text-sc-muted mt-1">
        {p.subtitle ??
          `${p.tracks.length} saved ${p.tracks.length === 1 ? 'track' : 'tracks'}`}
      </p>

      {showSignIn && !p.signedIn && (
        <div className="mt-6 rounded-2xl border border-sc-line bg-sc-panel p-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-[13px] text-sc-muted">
            {p.signInPrompt ?? 'Sign in to load the likes saved on your SoundCloud account.'}
          </p>
          <button
            onClick={p.onLogin}
            className="inline-flex items-center gap-2 rounded-full bg-sc-orange px-5 py-2.5 text-[12px] font-bold text-sc-fg hover:bg-sc-orange-soft hover:text-sc-bg active:scale-95 transition-all"
          >
            <LogIn className="w-3.5 h-3.5" />
            {p.signInLabel ?? 'Sign in with SoundCloud'}
          </button>
        </div>
      )}

      {p.playlists && p.playlists.length > 0 && (
        <div className="mt-8">
          <h2 className="text-[15px] font-bold text-sc-fg mb-3">Playlists</h2>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {p.playlists.map((pl) => (
              <button
                key={pl.id}
                type="button"
                onClick={() => p.onOpenPlaylist?.(pl)}
                className="group text-left rounded-xl border border-sc-line bg-sc-panel-2/30 p-3 hover:border-sc-dim hover:bg-sc-fill/5 transition-all"
              >
                <div className="aspect-square w-full rounded-lg overflow-hidden bg-sc-panel mb-2">
                  <Artwork src={pl.artwork} seed={pl.id} size={300} className="w-full h-full" />
                </div>
                <div className="text-[12px] font-semibold text-sc-fg truncate">{pl.title}</div>
                <div className="text-[11px] text-sc-muted truncate">
                  {pl.trackCount} {pl.trackCount === 1 ? 'track' : 'tracks'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        {p.loading ? (
          <SkeletonRows count={8} compact={p.compact} />
        ) : (
          <TrackList
            tracks={p.tracks}
            likedIds={p.likedIds}
            playingId={p.playingId}
            isPlaying={p.isPlaying}
            onPlay={p.onPlay}
            onToggleLike={p.onToggleLike}
            onOpenArtist={p.onOpenArtist}
            onFindSimilar={p.onFindSimilar}
            onPlayNext={p.onPlayNext}
            onAddToQueue={p.onAddToQueue}
            compact={p.compact}
            showArtwork={p.showArtwork}
            renderActions={p.renderActions}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared controls                                                             */
/* -------------------------------------------------------------------------- */

/** A labelled on/off row. The whole row is the click target. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
  icon: Icon,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: typeof Activity;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        'w-full flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all duration-200',
        checked
          ? 'border-sc-orange/50 bg-sc-orange/8'
          : 'border-sc-line bg-sc-panel-2/30 hover:border-sc-dim hover:bg-sc-fill/5'
      )}
    >
      <div
        className={clsx(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200',
          checked ? 'bg-sc-orange/15 text-sc-orange-soft' : 'bg-sc-fill/6 text-sc-dim'
        )}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-bold text-sc-fg">{label}</div>
        <div className="text-[11.5px] text-sc-muted leading-snug mt-0.5">{hint}</div>
      </div>
      {/* The visual switch. `after` is the knob, so the whole thing is one
          element that just changes colour and knob position. */}
      <span
        className={clsx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-sc-orange' : 'bg-sc-fill/15'
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200',
            checked ? 'left-[1.125rem]' : 'left-0.5'
          )}
        />
      </span>
    </button>
  );
}

/** Collapsible section. Settings defaults to collapsed so the page starts short. */
function Disclosure({
  id,
  title,
  subtitle,
  icon,
  defaultOpen = false,
  isOpen,
  onToggle,
  children,
}: {
  id?: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const toggle = () => {
    if (onToggle) onToggle();
    else setInternalOpen((v) => !v);
  };
  return (
    <section id={id} className="rounded-2xl border border-sc-line bg-sc-panel overflow-hidden transition-all duration-300">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-sc-fill/5 transition-colors cursor-pointer"
      >
        <span className="transition-transform duration-200 group-hover:scale-110">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-sc-fg">{title}</span>
          <span className="block text-[11.5px] text-sc-muted">{subtitle}</span>
        </span>
        <ChevronDown
          className={clsx(
            'w-4 h-4 text-sc-dim shrink-0 transition-transform duration-300 ease-out',
            open && 'rotate-180 text-sc-orange'
          )}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-sc-line animate-accordion overflow-hidden">{children}</div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Account                                                                     */
/* -------------------------------------------------------------------------- */

interface AuthProps {
  me: User | null;
  loginPending: boolean;
  loginError: string | null;
  onLogin: () => void;
  onSync: () => void;
  onLogout: () => void;
  syncing: boolean;
  manualToken: string;
  onManualTokenChange: (t: string) => void;
  onManualTokenSave: () => void;
  manualPending: boolean;
}

function AuthPanel(p: AuthProps) {
  return (
    <div className="rounded-2xl border border-sc-line bg-sc-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-bold text-sc-fg flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-sc-orange" />
            SoundCloud account
          </h3>
          <p className="text-[12px] text-sc-muted mt-1 max-w-lg leading-relaxed">
            Press the button - a SoundCloud login window opens. Sign in with your usual
            password and the app takes over the session token, then closes the
            window. Your password never reaches the app.
          </p>
        </div>
        {p.me ? (
          <div className="flex items-center gap-2 rounded-full bg-emerald-500/12 px-3 py-1.5 shrink-0">
            {p.me.avatarUrl && (
              <img
                src={p.me.avatarUrl.replace('-large.jpg', '-t100x100.jpg')}
                alt=""
                className="w-5 h-5 rounded-full"
              />
            )}
            <span className="text-[12px] font-semibold text-emerald-400">{p.me.username}</span>
          </div>
        ) : (
          <div className="rounded-full bg-sc-fill/6 px-3 py-1.5 text-[12px] text-sc-muted shrink-0">
            Not connected
          </div>
        )}
      </div>

      {p.me ? (
        <div className="mt-4 flex gap-2">
          <button
            onClick={p.onSync}
            disabled={p.syncing}
            className="rounded-full bg-sc-fg px-4 py-2 text-[12px] font-bold text-sc-bg hover:scale-[1.03] active:scale-95 transition-all disabled:opacity-50"
          >
            {p.syncing ? 'Syncing…' : 'Sync likes now'}
          </button>
          <button
            onClick={p.onLogout}
            className="inline-flex items-center gap-1.5 rounded-full border border-sc-line px-4 py-2 text-[12px] font-semibold text-sc-muted hover:text-sc-fg hover:border-neutral-600 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <button
            onClick={p.onLogin}
            disabled={p.loginPending}
            className="inline-flex items-center gap-2 rounded-full bg-sc-orange px-5 py-2.5 text-[12px] font-bold text-sc-fg hover:bg-sc-orange-soft hover:text-sc-bg hover:scale-[1.03] active:scale-95 transition-all disabled:opacity-50"
          >
            {p.loginPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin-slow" />
                Waiting for login…
              </>
            ) : (
              <>
                <LogIn className="w-3.5 h-3.5" />
                Sign in with SoundCloud
              </>
            )}
          </button>
          {p.loginError && (
            <p className="text-[11px] text-rose-400/90 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
              {p.loginError}
            </p>
          )}

          <details className="group">
            <summary className="cursor-pointer text-[11px] text-sc-dim hover:text-sc-muted transition-colors select-none">
              Not working? Paste the token manually
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-sc-dim leading-relaxed">
                In your browser sign in to soundcloud.com, then in DevTools → Application →
                Local Storage → soundcloud.com copy the <code>access_token</code> value.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={p.manualToken}
                  onChange={(e) => p.onManualTokenChange(e.target.value)}
                  placeholder="access_token"
                  className="flex-1 h-9 rounded-full bg-sc-panel-2 border border-sc-line px-3.5 text-[12px] outline-none focus:border-sc-orange/60 transition-colors"
                />
                <button
                  onClick={p.onManualTokenSave}
                  disabled={p.manualToken.trim().length < 10 || p.manualPending}
                  className="h-9 px-4 rounded-full bg-sc-orange text-[11px] font-bold text-sc-fg hover:bg-sc-orange-soft hover:text-sc-bg disabled:opacity-40 transition-all shrink-0"
                >
                  {p.manualPending ? 'Checking…' : 'Save'}
                </button>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Spotify                                                                     */
/* -------------------------------------------------------------------------- */

interface SpotifyProps {
  /** False when the app is running outside Electron (no OAuth bridge). */
  available: boolean;
  connected: boolean;
  accountName: string | null;
  product: string | null;
  playerReady: boolean;
  clientId: string;
  onClientIdChange: (v: string) => void;
  redirectUri: string;
  loginPending: boolean;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * Spotify sign-in.
 *
 * Unlike SoundCloud this needs the user's own app Client ID: Spotify has no
 * shared public client for a desktop app, so the field is unavoidable. The
 * redirect URI is fixed and shown so it can be pasted verbatim into the app's
 * allow-list - Spotify rejects the flow if the two do not match exactly.
 */
function SpotifyPanel(p: SpotifyProps) {
  const [expanded, setExpanded] = useState(p.connected);
  const premium = p.product === 'premium';
  return (
    <div className="rounded-2xl border border-sc-line bg-sc-panel transition-all duration-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full p-5 flex items-start justify-between gap-4 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Disc3 className="w-4 h-4 text-emerald-400 shrink-0" />
            <h3 className="text-[14px] font-bold text-sc-fg">
              Spotify (experimental)
            </h3>
            <span className="text-[10px] font-semibold text-sc-dim px-2 py-0.5 rounded-full bg-white/5">
              Optional
            </span>
          </div>
          <p className="text-[12px] text-sc-muted mt-1 max-w-lg leading-relaxed">
            Full-length playback through the Web Playback SDK. Needs a Spotify
            <span className="font-semibold text-sc-fg"> Premium </span>
            account and your own app Client ID from developer.spotify.com.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {p.connected ? (
            <div className="flex items-center gap-2 rounded-full bg-emerald-500/12 px-3 py-1.5">
              <span className="text-[12px] font-semibold text-emerald-400">
                {p.accountName ?? 'Connected'}
              </span>
            </div>
          ) : (
            <div className="rounded-full bg-sc-fill/6 px-3 py-1.5 text-[12px] text-sc-muted">
              Not connected
            </div>
          )}
          <div className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-sc-muted">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-0 border-t border-white/[0.04] mt-1 space-y-4 animate-fade-in">

      {!p.available && (
        <p className="mt-3 text-[11px] text-amber-400/90 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
          Spotify sign-in only works in the desktop app.
        </p>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-sc-muted">Client ID</label>
          <input
            type="text"
            value={p.clientId}
            onChange={(e) => p.onClientIdChange(e.target.value)}
            placeholder="e.g. 1a2b3c4d5e6f7g8h9i0j..."
            spellCheck={false}
            className="mt-1 w-full h-9 rounded-lg bg-sc-panel-2 border border-sc-line px-3 text-[12px] outline-none focus:border-emerald-400/60 transition-colors"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-sc-muted">Redirect URI</label>
          <p className="text-[11px] text-sc-dim mt-0.5 leading-relaxed">
            Add this exact value under <span className="text-sc-muted">Redirect URIs</span> in your
            Spotify app settings, then use the button below.
          </p>
          <div className="mt-1 flex gap-2">
            <input
              readOnly
              value={p.redirectUri}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 h-9 rounded-lg bg-sc-panel-2/60 border border-sc-line px-3 text-[11px] text-sc-muted outline-none font-mono"
            />
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(p.redirectUri)}
              className="h-9 px-3 rounded-lg border border-sc-line text-[11px] font-semibold text-sc-muted hover:text-sc-fg hover:border-neutral-600 transition-colors shrink-0"
            >
              Copy
            </button>
          </div>
        </div>

        {p.connected ? (
          <div className="flex items-center gap-2 flex-wrap">
            {p.playerReady ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                <Check className="w-3.5 h-3.5" /> Player ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-sc-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin-slow" /> Starting player…
              </span>
            )}
            {p.product && (
              <span
                className={clsx(
                  'text-[11px] px-2 py-0.5 rounded-full',
                  premium ? 'bg-emerald-500/12 text-emerald-400' : 'bg-amber-500/12 text-amber-400'
                )}
              >
                {premium ? 'Premium' : p.product === 'free' ? 'Free - playback disabled' : p.product}
              </span>
            )}
            <button
              onClick={p.onDisconnect}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-sc-line px-4 py-2 text-[12px] font-semibold text-sc-muted hover:text-sc-fg hover:border-neutral-600 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={p.onConnect}
              disabled={p.loginPending || !p.clientId.trim() || !p.available}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-[12px] font-bold text-sc-bg hover:bg-emerald-400 hover:scale-[1.03] active:scale-95 transition-all disabled:opacity-50"
            >
              {p.loginPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin-slow" />
                  Waiting for Spotify…
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5" />
                  Connect Spotify
                </>
              )}
            </button>
          </div>
        )}

        {p.error && (
          <p className="text-[11px] text-rose-400/90 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
            {p.error}
          </p>
        )}
      </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Theme editor                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Builds a theme from one accent colour and a light/dark choice.
 *
 * The rest of the palette - surfaces, text, glow - is derived rather than asked
 * for, so there is exactly one thing to pick and it still looks deliberate. A
 * colour input is used for the swatch, with a text field next to it for pasting
 * a hex value, because native colour pickers cannot show a hex.
 */
function CustomThemeEditor({ onSave }: { onSave: (t: ThemeDef) => void }) {
  const [accent, setAccent] = useState('#6d5efc');
  const [accent2, setAccent2] = useState('#38e0d4');
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [name, setName] = useState('');

  const valid1 = /^#[0-9a-f]{6}$/i.test(accent.trim());
  const valid2 = /^#[0-9a-f]{6}$/i.test(accent2.trim());
  const valid = valid1 && valid2;

  const preview = themeFromAccent(
    valid1 ? accent.trim() : '#6d5efc',
    mode,
    valid2 ? accent2.trim() : '#38e0d4'
  );

  const save = () => {
    if (!valid) return;
    const label = name.trim().slice(0, 28).replace(/[^\w -]/g, '');
    onSave(themeFromAccent(accent.trim(), mode, accent2.trim(), label || undefined));
    setName('');
  };

  return (
    <div className="mt-4 rounded-2xl border border-sc-line bg-sc-panel-2/40 p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-bold text-sc-fg">Make your own theme</div>
          <div className="text-[11px] text-sc-dim">
            Customize both accent colors and choose light or dark surfaces.
          </div>
        </div>
        {/* Light / Dark Mode selector */}
        <div className="flex items-center gap-1 rounded-xl border border-sc-line bg-sc-bg p-1">
          {(['dark', 'light'] as ThemeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={clsx(
                'px-3 py-1 rounded-lg text-[11px] font-bold capitalize transition-all cursor-pointer',
                mode === m
                  ? 'bg-sc-orange/20 text-sc-orange border border-sc-orange/40 shadow-xs'
                  : 'text-sc-dim hover:text-sc-fg'
              )}
            >
              {m === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </div>

      {/* 2 Color Pickers & Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Color 1: Primary Accent */}
        <div className="p-3 rounded-xl border border-sc-line bg-sc-bg/60 space-y-2">
          <span className="text-[11px] font-bold text-sc-muted uppercase tracking-wider block">
            Primary Accent
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={valid1 ? accent : '#6d5efc'}
              onChange={(e) => setAccent(e.target.value)}
              aria-label="Primary accent color"
              className="w-9 h-9 rounded-lg border border-sc-line bg-transparent cursor-pointer shrink-0"
            />
            <input
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              aria-label="Primary accent hex"
              spellCheck={false}
              className="flex-1 rounded-lg border border-sc-line bg-sc-panel px-2.5 py-1.5 text-[12px] font-mono text-sc-fg outline-none focus:border-sc-orange"
            />
          </div>
        </div>

        {/* Color 2: Secondary Accent */}
        <div className="p-3 rounded-xl border border-sc-line bg-sc-bg/60 space-y-2">
          <span className="text-[11px] font-bold text-sc-muted uppercase tracking-wider block">
            Secondary Accent
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={valid2 ? accent2 : '#38e0d4'}
              onChange={(e) => setAccent2(e.target.value)}
              aria-label="Secondary accent color"
              className="w-9 h-9 rounded-lg border border-sc-line bg-transparent cursor-pointer shrink-0"
            />
            <input
              value={accent2}
              onChange={(e) => setAccent2(e.target.value)}
              aria-label="Secondary accent hex"
              spellCheck={false}
              className="flex-1 rounded-lg border border-sc-line bg-sc-panel px-2.5 py-1.5 text-[12px] font-mono text-sc-fg outline-none focus:border-sc-orange"
            />
          </div>
        </div>
      </div>

      {/* Name and Save */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Theme name (optional)..."
          aria-label="Theme name"
          className="flex-1 min-w-[180px] rounded-xl border border-sc-line bg-sc-bg px-3 py-2 text-[12px] text-sc-fg outline-none focus:border-sc-orange"
        />

        <button
          type="button"
          onClick={save}
          disabled={!valid}
          className="px-4 py-2 rounded-xl text-[12px] font-bold bg-sc-orange text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 cursor-pointer shadow-md shadow-sc-orange/20"
        >
          Save theme
        </button>
      </div>

      {/* Live Preview Card */}
      <div
        className="rounded-xl border border-sc-line p-3.5 flex flex-wrap items-center justify-between gap-3 transition-colors"
        style={{ background: preview.bg, color: preview.fg }}
      >
        <div className="flex items-center gap-2.5">
          {/* Gradient pill */}
          <span
            className="px-3 py-1 rounded-lg text-[11px] font-bold text-white shadow-xs"
            style={{
              background: `linear-gradient(135deg, ${preview.accent}, ${preview.accent2})`,
            }}
          >
            Gradient
          </span>
          {/* Accent 1 badge */}
          <span
            className="px-2.5 py-1 rounded-md text-[10px] font-bold"
            style={{ background: preview.accent, color: preview.onAccent }}
          >
            Accent 1
          </span>
          {/* Accent 2 badge */}
          <span
            className="px-2.5 py-1 rounded-md text-[10px] font-bold"
            style={{ background: preview.accent2, color: preview.onAccent }}
          >
            Accent 2
          </span>
        </div>
        <span className="text-[11px] font-medium" style={{ color: preview.muted }}>
          Surface preview ({mode === 'dark' ? 'Dark' : 'Light'})
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

interface Stats {
  entries: number;
  alive: number;
  inflight: number;
  queued: number;
}

/** Backdrop variants, in the order Settings offers them. */
const BG_MODES = [
  {
    id: 'cosmic',
    label: 'Cosmic',
    hint: 'Drifting colour orbs over a light starfield.',
  },
  {
    id: 'stars',
    label: 'Stars',
    hint: 'A full, twinkling sky. No orbs.',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    hint: 'Cool green and teal bands that shift slowly.',
  },
  {
    id: 'particles',
    label: 'Particles',
    hint: 'Fine stardust drifting across the dark.',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    hint: 'A handful of faint stars, nothing more.',
  },
  { id: 'off', label: 'Off', hint: 'A flat background that never moves.' },
] as const;

const BG_COLOR_SOURCES = [
  { id: 'artwork', label: 'Artwork' },
  { id: 'theme', label: 'Theme' },
  { id: 'neon', label: 'Neon' },
] as const;

/** Catalogs the "Music source" switch can aim search and browsing at. */
const MUSIC_SOURCES_UI = [
  {
    id: 'soundcloud',
    label: 'SoundCloud',
    description: 'Your account behind everything: likes, playlists, follow graphs.',
  },
  {
    id: 'audius',
    label: 'Audius',
    description: 'An open catalog played the same way - search and play, no account.',
  },
  {
    id: 'spotify',
    label: 'Spotify',
    description: 'Full tracks from your library and search - needs a Premium account.',
  },
] as const;

function ProxyPanel({
  prefs,
  onPref,
}: {
  prefs: Prefs;
  onPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}) {
  const [proxyState, setProxyState] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    void window.desktop?.getProxyConfig?.().then((res) => {
      if (res) {
        setProxyState(res);
        if (res.lastTestResult) setTestResult(res.lastTestResult);
      }
    });
  }, []);

  const syncToDesktop = async (updated: Partial<Prefs>) => {
    const nextPrefs = { ...prefs, ...updated };
    if (window.desktop?.setProxyConfig) {
      const res = await window.desktop.setProxyConfig({
        enabled: nextPrefs.proxyEnabled,
        mode: nextPrefs.proxyMode,
        preset: nextPrefs.proxyPreset,
        customProtocol: nextPrefs.proxyCustomProtocol,
        customHost: nextPrefs.proxyCustomHost,
        customPort: nextPrefs.proxyCustomPort,
        customAuth: nextPrefs.proxyCustomAuth,
        customUser: nextPrefs.proxyCustomUser,
        customPass: nextPrefs.proxyCustomPass,
        customUrl: nextPrefs.proxyCustomUrl,
      });
      if (res && window.desktop.getProxyConfig) {
        const nextState = await window.desktop.getProxyConfig();
        setProxyState(nextState);
      }
    }
  };

  const handleToggle = (enabled: boolean) => {
    onPref('proxyEnabled', enabled);
    void syncToDesktop({ proxyEnabled: enabled });
  };

  const handleModeChange = (mode: 'builtin' | 'custom') => {
    onPref('proxyMode', mode);
    void syncToDesktop({ proxyMode: mode });
  };

  const handlePresetChange = (preset: 'auto' | 'us' | 'de' | 'gb' | 'nl') => {
    onPref('proxyPreset', preset);
    void syncToDesktop({ proxyPreset: preset });
  };

  const handleTest = async () => {
    if (!window.desktop?.testProxy) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await window.desktop.testProxy({
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
      setTestResult(res);
      if (window.desktop.getProxyConfig) {
        const nextState = await window.desktop.getProxyConfig();
        setProxyState(nextState);
      }
    } catch (e: any) {
      setTestResult({
        ok: false,
        message: e?.message || 'Connection test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleRefresh = async () => {
    if (!window.desktop?.refreshProxies) return;
    setIsRefreshing(true);
    try {
      await window.desktop.refreshProxies();
      if (window.desktop.getProxyConfig) {
        const nextState = await window.desktop.getProxyConfig();
        setProxyState(nextState);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const presets = proxyState?.presets || [
    { id: 'system', name: 'System / Active VPN', flag: '🛡️', description: 'Uses Windows system proxy or active VPN (Cloudflare WARP, Proton, etc.)' },
  ];

  const activePreset = presets.find((p: any) => p.id === prefs.proxyPreset) || presets[0];

  const subtitle = prefs.proxyEnabled
    ? prefs.proxyMode === 'builtin'
      ? `Active · ${activePreset.flag} ${activePreset.name}`
      : `Active · Custom (${prefs.proxyCustomHost || 'custom'})`
    : 'Direct connection';

  return (
    <Disclosure
      title="Proxy & Geo-Bypass"
      subtitle={subtitle}
      icon={<Globe className="w-[18px] h-[18px] text-sc-orange" />}
      defaultOpen={false}
    >
      <div className="pt-4 space-y-3.5">
        {/* Toggle bar */}
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-sc-line bg-sc-panel-2/50">
          <div className="flex items-center gap-2.5">
            <span
              className={clsx(
                'w-2.5 h-2.5 rounded-full shrink-0',
                prefs.proxyEnabled
                  ? proxyState?.status === 'connected'
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                    : 'bg-amber-400'
                  : 'bg-neutral-600'
              )}
            />
            <div>
              <div className="text-[13px] font-bold text-sc-fg">
                {prefs.proxyEnabled ? 'Proxy Enabled' : 'Proxy Disabled'}
              </div>
              <div className="text-[11px] text-sc-muted">
                {prefs.proxyEnabled
                  ? 'Bypassing regional restrictions for locked tracks'
                  : 'Direct connection using your network IP'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleToggle(!prefs.proxyEnabled)}
            className={clsx(
              'px-4 py-1.5 rounded-full text-[12px] font-bold transition-all cursor-pointer',
              prefs.proxyEnabled
                ? 'bg-sc-orange text-white hover:brightness-110 shadow-sm'
                : 'border border-sc-line text-sc-dim hover:text-sc-fg hover:border-sc-dim'
            )}
          >
            {prefs.proxyEnabled ? 'Enabled' : 'Enable'}
          </button>
        </div>

        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleModeChange('builtin')}
            aria-pressed={prefs.proxyMode === 'builtin'}
            className={clsx(
              'p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between',
              prefs.proxyMode === 'builtin'
                ? 'border-sc-orange/60 bg-sc-orange/10'
                : 'border-sc-line bg-sc-panel-2/40 hover:border-sc-dim'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">🛡️</span>
              <span className="text-[12.5px] font-bold text-sc-fg">System / Active VPN</span>
            </div>
            {prefs.proxyMode === 'builtin' && <Check className="w-3.5 h-3.5 text-sc-orange" />}
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('custom')}
            aria-pressed={prefs.proxyMode === 'custom'}
            className={clsx(
              'p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between',
              prefs.proxyMode === 'custom'
                ? 'border-sc-orange/60 bg-sc-orange/10'
                : 'border-sc-line bg-sc-panel-2/40 hover:border-sc-dim'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">🛠️</span>
              <span className="text-[12.5px] font-bold text-sc-fg">Custom Proxy</span>
            </div>
            {prefs.proxyMode === 'custom' && <Check className="w-3.5 h-3.5 text-sc-orange" />}
          </button>
        </div>

        {/* System / Active VPN Info */}
        {prefs.proxyMode === 'builtin' && (
          <div className="p-3.5 rounded-xl border border-sc-line bg-sc-panel-2/30 animate-fade-in flex items-start gap-3">
            <span className="text-xl shrink-0">🛡️</span>
            <div>
              <div className="text-[12.5px] font-bold text-sc-fg">System / Active VPN</div>
              <div className="text-[11px] text-sc-muted mt-0.5 leading-relaxed">
                Uses Windows system proxy or active VPN (Cloudflare WARP, Proton, NordVPN, etc.) to route your traffic and unblock restricted tracks.
              </div>
            </div>
          </div>
        )}

        {/* Custom Proxy Form */}
        {prefs.proxyMode === 'custom' && (
          <div className="space-y-3 p-3.5 rounded-xl border border-sc-line bg-sc-panel-2/30 animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] font-bold text-sc-muted block mb-1">Protocol</label>
                <select
                  value={prefs.proxyCustomProtocol}
                  onChange={(e) => {
                    onPref('proxyCustomProtocol', e.target.value as any);
                    void syncToDesktop({ proxyCustomProtocol: e.target.value as any });
                  }}
                  className="w-full rounded-xl border border-sc-line bg-sc-panel px-3 py-2 text-[12px] font-medium text-sc-fg outline-none focus:border-sc-orange cursor-pointer"
                >
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                  <option value="socks4">SOCKS4</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-[11px] font-bold text-sc-muted block mb-1">Host / IP</label>
                <input
                  type="text"
                  placeholder="127.0.0.1 or proxy.example.com"
                  value={prefs.proxyCustomHost}
                  onChange={(e) => onPref('proxyCustomHost', e.target.value)}
                  onBlur={() => void syncToDesktop({ proxyCustomHost: prefs.proxyCustomHost })}
                  className="w-full rounded-xl border border-sc-line bg-sc-panel px-3 py-2 text-[12px] font-mono text-sc-fg outline-none focus:border-sc-orange"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] font-bold text-sc-muted block mb-1">Port</label>
                <input
                  type="text"
                  placeholder="8080 or 1080"
                  value={prefs.proxyCustomPort}
                  onChange={(e) => onPref('proxyCustomPort', e.target.value)}
                  onBlur={() => void syncToDesktop({ proxyCustomPort: prefs.proxyCustomPort })}
                  className="w-full rounded-xl border border-sc-line bg-sc-panel px-3 py-2 text-[12px] font-mono text-sc-fg outline-none focus:border-sc-orange"
                />
              </div>

              <div className="sm:col-span-2 flex items-end pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.proxyCustomAuth}
                    onChange={(e) => {
                      onPref('proxyCustomAuth', e.target.checked);
                      void syncToDesktop({ proxyCustomAuth: e.target.checked });
                    }}
                    className="accent-[var(--color-sc-orange)] w-4 h-4 cursor-pointer"
                  />
                  <span className="text-[12px] text-sc-fg font-medium">Authentication required</span>
                </label>
              </div>
            </div>

            {prefs.proxyCustomAuth && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 animate-fade-in">
                <div>
                  <label className="text-[11px] font-bold text-sc-muted block mb-1">Username</label>
                  <input
                    type="text"
                    placeholder="Username"
                    value={prefs.proxyCustomUser}
                    onChange={(e) => onPref('proxyCustomUser', e.target.value)}
                    onBlur={() => void syncToDesktop({ proxyCustomUser: prefs.proxyCustomUser })}
                    className="w-full rounded-xl border border-sc-line bg-sc-panel px-3 py-2 text-[12px] text-sc-fg outline-none focus:border-sc-orange"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-sc-muted block mb-1">Password</label>
                  <input
                    type="password"
                    placeholder="Password"
                    value={prefs.proxyCustomPass}
                    onChange={(e) => onPref('proxyCustomPass', e.target.value)}
                    onBlur={() => void syncToDesktop({ proxyCustomPass: prefs.proxyCustomPass })}
                    className="w-full rounded-xl border border-sc-line bg-sc-panel px-3 py-2 text-[12px] text-sc-fg outline-none focus:border-sc-orange"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Test Connection */}
        <div className="pt-1 space-y-2.5">
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting}
            className="inline-flex items-center gap-1.5 rounded-full bg-sc-fg px-4 py-2 text-[12px] font-bold text-sc-bg hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isTesting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Activity className="w-3.5 h-3.5" />
                Test Connection
              </>
            )}
          </button>

          {testResult && (
            <div
              className={clsx(
                'rounded-xl border p-3.5 animate-fade-in space-y-2',
                testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-950/15'
                  : 'border-rose-500/30 bg-rose-950/15'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-sc-fg flex items-center gap-1.5">
                  <span className={clsx('w-2 h-2 rounded-full', testResult.ok ? 'bg-emerald-400' : 'bg-rose-400')} />
                  {testResult.ok ? 'Connection Successful' : 'Connection Failed'}
                </span>
                {testResult.latency !== undefined && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-sc-panel border border-sc-line text-sc-dim">
                    {testResult.latency} ms
                  </span>
                )}
              </div>

              <div className="text-[11.5px] text-sc-muted">
                {testResult.message}
              </div>

              {testResult.ok && (
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-sc-line/40 text-[11px]">
                  <div>
                    <span className="text-sc-faint block">Exit IP:</span>
                    <span className="font-mono text-sc-fg font-semibold">{testResult.ip || '—'}</span>
                  </div>
                  <div>
                    <span className="text-sc-faint block">Country:</span>
                    <span className="text-sc-fg font-semibold">{testResult.country || '—'}</span>
                  </div>
                  <div>
                    <span className="text-sc-faint block">SoundCloud:</span>
                    <span className={clsx('font-semibold', testResult.soundcloudOk ? 'text-emerald-400' : 'text-amber-400')}>
                      {testResult.soundcloudOk ? '✓ Unlocked' : 'Direct'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Disclosure>
  );
}

function SoftwareUpdatesPanel() {
  const { updateState, checkForUpdates, downloadUpdate, quitAndInstall } = useAutoUpdater();
  const [checking, setChecking] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await checkForUpdates();
    } finally {
      setChecking(false);
    }
  };

  const formatSpeed = (bps: number) => {
    if (bps < 1024) return `${bps} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  return (
    <div className="rounded-2xl border border-sc-line bg-sc-panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sc-orange/15 border border-sc-orange/30 flex items-center justify-center text-sc-orange shrink-0">
            <ArrowUpCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-sc-fg">Software Updates</h3>
              <span className="px-2 py-0.5 rounded-full bg-white/[0.08] text-[11px] font-mono font-bold text-sc-muted">
                v{updateState.currentVersion}
              </span>
            </div>
            <p className="text-[12px] text-sc-muted mt-0.5">
              Automatic checks and installs for new releases
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {updateState.status === 'downloaded' ? (
            <button
              type="button"
              onClick={quitAndInstall}
              className="px-3.5 py-1.5 rounded-xl bg-sc-orange hover:bg-sc-orange/90 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sc-orange/25 transition-all cursor-pointer active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Restart & Install
            </button>
          ) : updateState.status === 'available' ? (
            <button
              type="button"
              onClick={downloadUpdate}
              className="px-3.5 py-1.5 rounded-xl bg-sc-orange hover:bg-sc-orange/90 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sc-orange/25 transition-all cursor-pointer active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              Download Update
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCheck}
              disabled={checking || updateState.status === 'checking'}
              className="px-3.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-50 text-sc-fg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <RefreshCw className={clsx('w-3.5 h-3.5', (checking || updateState.status === 'checking') && 'animate-spin text-sc-orange')} />
              <span>{checking || updateState.status === 'checking' ? 'Checking...' : 'Check for Updates'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Status banner */}
      <div className="p-3 rounded-xl bg-sc-panel-2/60 border border-white/[0.06] flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'w-2 h-2 rounded-full shrink-0',
              updateState.status === 'downloaded' || updateState.status === 'available'
                ? 'bg-sc-orange animate-ping'
                : updateState.status === 'checking' || updateState.status === 'downloading'
                  ? 'bg-amber-400 animate-pulse'
                  : updateState.status === 'error'
                    ? 'bg-red-400'
                    : 'bg-emerald-400'
            )}
          />
          <span className="text-sc-fg font-medium">
            {updateState.status === 'downloaded'
              ? `Version v${updateState.availableVersion || ''} is downloaded and ready to install!`
              : updateState.status === 'downloading'
                ? `Downloading update: ${updateState.progressPercent}% (${formatSpeed(updateState.bytesPerSecond)})`
                : updateState.status === 'available'
                  ? `New version available: v${updateState.availableVersion || ''}!`
                  : updateState.status === 'checking'
                    ? 'Connecting to update server...'
                    : updateState.status === 'error'
                      ? `Status: ${updateState.error || 'Failed to check for updates'}`
                      : 'You have the latest version installed.'}
          </span>
        </div>
      </div>

      {/* Downloading progress bar */}
      {updateState.status === 'downloading' && (
        <div className="space-y-1.5">
          <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-sc-orange transition-all duration-300 rounded-full"
              style={{ width: `${Math.max(5, updateState.progressPercent)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-sc-muted">
            <span>Downloaded: {(updateState.transferred / (1024 * 1024)).toFixed(1)} / {(updateState.total / (1024 * 1024)).toFixed(1)} MB</span>
            <span>{updateState.progressPercent}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadsFolderPanel({
  downloadPath,
  onChangePath,
}: {
  downloadPath: string;
  onChangePath: (path: string) => void;
}) {
  const [defaultDir, setDefaultDir] = useState<string>('');

  useEffect(() => {
    window.desktop?.getDefaultDownloadDir?.().then((dir) => {
      if (dir) setDefaultDir(dir);
    });
  }, []);

  const activePath = downloadPath || defaultDir || 'Windows Music';

  const handleChoose = async () => {
    if (!window.desktop?.chooseDownloadFolder) return;
    const res = await window.desktop.chooseDownloadFolder(downloadPath || defaultDir);
    if (res?.ok && res.path) {
      onChangePath(res.path);
    }
  };

  const handleReset = () => {
    onChangePath('');
  };

  return (
    <div className="rounded-2xl border border-sc-line bg-sc-panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sc-orange/10 flex items-center justify-center text-sc-orange">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sc-fg text-sm">Downloads Folder</h3>
            <p className="text-xs text-sc-muted mt-0.5">
              Tracks are saved as MP3 with full ID3 tags (artist, title, cover art) in this folder.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleChoose}
            className="px-3.5 py-1.5 rounded-xl bg-sc-orange hover:bg-sc-orange/90 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sc-orange/25 transition-all cursor-pointer active:scale-95"
          >
            <Folder className="w-3.5 h-3.5" />
            Change Folder
          </button>
          {downloadPath && (
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-1.5 rounded-xl border border-sc-line text-xs font-medium text-sc-muted hover:text-sc-fg hover:border-neutral-500 transition-colors"
              title="Reset to default Windows Music folder"
            >
              Reset to Default
            </button>
          )}
        </div>
      </div>

      <div className="p-3 rounded-xl border border-sc-line bg-sc-panel-2/40 flex items-center justify-between gap-3 text-xs">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-sc-muted">
            Destination Path
          </div>
          <div className="text-[12.5px] font-mono text-sc-fg truncate mt-0.5 select-all" title={activePath}>
            {activePath}
          </div>
        </div>
        {!downloadPath && (
          <span className="shrink-0 text-[11px] px-2.5 py-0.5 rounded-full bg-sc-orange/15 text-sc-orange font-medium">
            Default (Windows Music)
          </span>
        )}
      </div>
    </div>
  );
}

function MiniPlayerSettingsPanel({
  prefs,
  onPref,
}: {
  prefs: Prefs;
  onPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}) {
  const BLUR_OPTIONS = [
    { id: 'none', label: 'Brak / Transparent', desc: 'Czyste przezroczyste szkło bez rozmywania tła' },
    { id: 'subtle', label: 'Lekki blur', desc: 'Subtelne zmiękczenie krawędzi i tła (8px)' },
    { id: 'frosted', label: 'Matowe szkło (Frosted)', desc: 'Klasyczne mleczne szkło z refleksem (20px)' },
    { id: 'heavy', label: 'Głęboki akryl (Acrylic)', desc: 'Głębokie rozmycie Fluent Acrylic (40px)' },
    { id: 'solid', label: 'Pełne krycie (Solid)', desc: '100% nieprzezroczyste tło motywu' },
  ] as const;

  const BUTTON_TOGGLES: { key: keyof Prefs; label: string; desc: string }[] = [
    { key: 'miniShowPrevNext', label: 'Poprzedni / Następny utwór', desc: 'Przyciski przewijania do poprzedniego i następnego utworu' },
    { key: 'miniShowVolume', label: 'Suwak głośności i wyciszenie', desc: 'Kontrola poziomu dźwięku z możliwością szybkiego wyciszenia' },
    { key: 'miniShowProgress', label: 'Pasek postępu i czas', desc: 'Interaktywny pasek przewijania pozycji utworu' },
    { key: 'miniShowVisualizer', label: 'Animowane słupki spektrum', desc: 'Mini wizualizator częstotliwości audio dopasowany do motywu' },
    { key: 'miniShowLike', label: 'Przycisk Polub (Serduszko)', desc: 'Szybkie dodawanie utworu do polubionych' },
    { key: 'miniShowShuffle', label: 'Przycisk Losowo (Shuffle)', desc: 'Włączanie i wyłączanie losowej kolejności' },
    { key: 'miniShowRepeat', label: 'Przycisk Powtarzaj (Repeat)', desc: 'Przełączanie trybu pętli (jeden / wszystkie / wyłączony)' },
    { key: 'miniAlwaysOnTop', label: 'Zawsze na wierzchu (Always on Top)', desc: 'Domyślne przypinanie okna ponad innymi aplikacjami' },
  ];

  const getPreviewGlassStyle = () => {
    const blur = prefs.miniBlur || 'heavy';
    const op = blur === 'solid' ? 1 : (prefs.miniOpacity ?? 0.65);

    if (blur === 'solid') {
      return {
        className: 'border border-sc-line/80 shadow-2xl',
        style: {
          backgroundColor: 'var(--sc-bg, #0b0b0f)',
        },
      };
    }

    const baseBg = `color-mix(in srgb, var(--sc-bg, #0b0b0f) ${Math.round(op * 100)}%, transparent)`;

    if (blur === 'none') {
      return {
        className: 'backdrop-blur-none border border-white/20 shadow-2xl',
        style: {
          backgroundColor: baseBg,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
        },
      };
    }

    if (blur === 'subtle') {
      return {
        className: 'backdrop-blur-sm border border-white/25 shadow-2xl',
        style: {
          backgroundColor: baseBg,
          boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.18), 0 12px 36px rgba(0, 0, 0, 0.55)',
        },
      };
    }

    if (blur === 'frosted') {
      return {
        className: 'backdrop-blur-md border border-white/35 shadow-2xl',
        style: {
          backgroundImage: 'linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 100%)',
          backgroundColor: baseBg,
          boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.25), 0 16px 44px rgba(0, 0, 0, 0.65)',
        },
      };
    }

    // heavy (acrylic)
    return {
      className: 'backdrop-blur-2xl border border-white/30 shadow-2xl',
      style: {
        backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.12) 0%, transparent 75%)',
        backgroundColor: baseBg,
        boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.35), 0 20px 50px rgba(0, 0, 0, 0.75)',
      },
    };
  };

  const previewGlass = getPreviewGlassStyle();

  return (
    <div className="space-y-6">
      {/* Live Interactive Preview Box */}
      <div className="rounded-2xl border border-sc-line bg-sc-panel/40 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-sc-orange flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" />
              Podgląd na żywo (Live Preview)
            </div>
            <p className="text-[11.5px] text-sc-muted mt-0.5">
              Tak będzie prezentować się okno Twojego mini playera na pulpicie. Zmiany są widoczne w czasie rzeczywistym.
            </p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-sc-orange/15 text-sc-orange font-bold uppercase tracking-wider">
            360 × 205 px
          </span>
        </div>

        {/* Desktop Wallpaper Simulation Container */}
        <div className="relative rounded-2xl overflow-hidden p-8 flex items-center justify-center border border-sc-line bg-gradient-to-br from-[#0a0c16] via-[#101426] to-[#180d22] min-h-[300px]">
          {/* Real desktop scene elements positioned behind and around the player */}
          <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
            {/* Vivid colorful wallpaper artwork with SHARP shapes (NO pre-blur!) */}
            <div className="absolute -top-12 -left-12 w-96 h-96 rounded-full bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 opacity-40 mix-blend-screen" />
            <div className="absolute -bottom-16 -right-16 w-96 h-96 rounded-full bg-gradient-to-tl from-orange-500 via-rose-500 to-fuchsia-600 opacity-45 mix-blend-screen" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-amber-400/25 mix-blend-screen" />

            {/* High-contrast geometric grid pattern */}
            <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:28px_28px]" />

            {/* Sharp Desktop Icons positioned directly behind the player's glass window */}
            <div className="absolute top-6 left-8 flex flex-col gap-4 text-white/90">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/80 border border-white/30 flex items-center justify-center shadow-lg text-white">
                  <Folder className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <div className="text-[11px] font-bold tracking-tight">Dokumenty</div>
                  <div className="text-[9px] text-white/60 font-mono">1.24 GB • Folder</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/80 border border-white/30 flex items-center justify-center shadow-lg text-white">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[11px] font-bold tracking-tight">Przeglądarka Web</div>
                  <div className="text-[9px] text-white/60 font-mono">soundcloud.com</div>
                </div>
              </div>
            </div>

            {/* Sharp Terminal window snippet positioned right through the center behind the player */}
            <div className="absolute bottom-6 right-8 w-80 rounded-xl border border-white/20 bg-black/60 p-3 shadow-2xl">
              <div className="flex items-center gap-1.5 pb-2 border-b border-white/10 text-[10px] font-mono text-white/50">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="ml-1 text-white/70 font-bold">Terminal: desktop_dwm</span>
              </div>
              <div className="mt-2 space-y-1 font-mono text-[10px] leading-relaxed">
                <div className="text-emerald-400 font-bold">&gt; win.dwm.status: ACTIVE</div>
                <div className="text-cyan-300 font-semibold">&gt; rendering: UltraGlass Engine 2026</div>
                <div className="text-amber-300">&gt; track: Midnight City (Lossless M83)</div>
              </div>
            </div>

            {/* High-contrast colorful horizon line across the center */}
            <div className="absolute top-[48%] left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-400 via-amber-400 to-rose-500 opacity-70 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
          </div>

          {/* Actual Mini Player Mockup */}
          <div
            style={previewGlass.style}
            className={`w-[360px] h-[195px] box-border ${previewGlass.className} text-sc-fg select-none rounded-2xl p-3 flex flex-col justify-between relative transition-all duration-300 z-10 overflow-hidden`}
          >
            {/* Ambient Artwork Glass Background Layer */}
            {prefs.miniBlur !== 'none' && prefs.miniBlur !== 'solid' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10 rounded-2xl">
                <div
                  className="w-full h-full scale-125 select-none transition-all duration-500"
                  style={{
                    background:
                      'radial-gradient(circle at 75% 25%, #ff5500 0%, transparent 60%), radial-gradient(circle at 25% 75%, #6366f1 0%, transparent 60%)',
                    filter:
                      prefs.miniBlur === 'subtle'
                        ? 'blur(16px)'
                        : prefs.miniBlur === 'frosted'
                          ? 'blur(30px)'
                          : 'blur(50px)',
                    opacity: Math.max(0.12, (1 - (prefs.miniOpacity ?? 0.65)) * 0.55),
                  }}
                />
              </div>
            )}

            {/* Top Bar */}
            <div className="flex items-center justify-between gap-2 border-b border-sc-line/40 pb-1.5">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-sc-orange animate-pulse" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-sc-muted">Abbadon Mini</span>
              </div>
              <div className="flex items-center gap-1">
                <div
                  className={`p-1 rounded-lg ${
                    prefs.miniAlwaysOnTop
                      ? 'text-sc-orange bg-sc-orange/15'
                      : 'text-sc-muted'
                  }`}
                  title="Pineska Always on Top"
                >
                  <Pin className={`w-3.5 h-3.5 ${prefs.miniAlwaysOnTop ? 'rotate-45 fill-current' : ''}`} />
                </div>
                <div className="p-1 rounded-lg text-sc-muted">
                  <Maximize2 className="w-3.5 h-3.5" />
                </div>
                <div className="p-1 rounded-lg text-sc-muted">
                  <X className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>

            {/* Center Track */}
            <div className="flex items-center gap-3 my-0.5">
              <div className="relative w-11 h-11 rounded-xl overflow-hidden bg-sc-fill/10 border border-sc-line shrink-0 shadow-md flex items-center justify-center text-sc-orange">
                <Music className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-sc-fg truncate leading-tight">
                  Midnight City
                </div>
                <div className="text-[11px] text-sc-muted truncate leading-normal mt-0.5">
                  M83
                </div>
                {prefs.miniShowVisualizer && (
                  <div className="flex items-end gap-0.5 h-2.5 mt-1">
                    {[0.4, 0.8, 0.6, 1.0, 0.5, 0.9, 0.7, 0.3].map((h, i) => (
                      <div
                        key={i}
                        className="w-1 bg-gradient-to-t from-sc-orange to-sc-orange-soft rounded-full transition-all"
                        style={{ height: `${h * 100}%` }}
                      />
                    ))}
                  </div>
                )}
              </div>
              {prefs.miniShowLike && (
                <div className="p-1.5 rounded-lg text-sc-orange">
                  <Heart className="w-4 h-4 fill-current" />
                </div>
              )}
            </div>

            {/* Progress Slider */}
            {prefs.miniShowProgress && (
              <div className="flex items-center gap-2 text-[10px] text-sc-muted tabular-nums py-0.5">
                <span>1:24</span>
                <div className="flex-1 h-1 bg-sc-fill/15 rounded-lg overflow-hidden relative">
                  <div className="h-full bg-sc-orange w-1/3 rounded-lg" />
                </div>
                <span>4:03</span>
              </div>
            )}

            {/* Bottom Controls */}
            <div className="flex items-center justify-between pt-0.5">
              {prefs.miniShowVolume ? (
                <div className="flex items-center gap-1.5 w-24 text-sc-muted">
                  <Volume2 className="w-3.5 h-3.5" />
                  <div className="w-16 h-1 bg-sc-fill/15 rounded-lg overflow-hidden">
                    <div className="h-full bg-sc-orange w-3/4 rounded-lg" />
                  </div>
                </div>
              ) : (
                <div className="w-1" />
              )}

              <div className="flex items-center gap-1.5">
                {prefs.miniShowShuffle && (
                  <div className="p-1.5 text-sc-muted">
                    <Shuffle className="w-3.5 h-3.5" />
                  </div>
                )}
                {prefs.miniShowPrevNext && (
                  <div className="p-1.5 text-sc-muted">
                    <SkipBack className="w-4 h-4" />
                  </div>
                )}
                <div className="w-8 h-8 rounded-full bg-sc-orange text-sc-on-accent flex items-center justify-center shadow-lg shadow-sc-orange/25">
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                </div>
                {prefs.miniShowPrevNext && (
                  <div className="p-1.5 text-sc-muted">
                    <SkipForward className="w-4 h-4" />
                  </div>
                )}
                {prefs.miniShowRepeat && (
                  <div className="p-1.5 text-sc-muted">
                    <Repeat className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Blur Type Selection */}
      <div className="space-y-3">
        <label className="text-[12.5px] font-bold text-sc-fg flex items-center gap-2">
          <span>Typ rozmycia tła (Backdrop Blur)</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {BLUR_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onPref('miniBlur', opt.id)}
              className={clsx(
                'text-left rounded-xl border p-3 transition-all relative cursor-pointer',
                prefs.miniBlur === opt.id
                  ? 'border-sc-orange/60 bg-sc-orange/10'
                  : 'border-sc-line bg-sc-panel-2/40 hover:border-sc-dim'
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[12.5px] font-bold text-sc-fg">{opt.label}</span>
                {prefs.miniBlur === opt.id && <Check className="w-3.5 h-3.5 text-sc-orange shrink-0" />}
              </div>
              <div className="text-[11px] text-sc-muted mt-0.5 leading-snug">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Opacity Slider (if not solid) */}
      {prefs.miniBlur !== 'solid' && (
        <div className="p-4 rounded-xl border border-sc-line bg-sc-panel-2/30 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-sc-fg">Przezroczystość tła (Opacity)</span>
            <span className="font-mono text-sc-orange font-bold">
              {Math.round((prefs.miniOpacity ?? 0.92) * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.2}
            max={1.0}
            step={0.02}
            value={prefs.miniOpacity ?? 0.92}
            onChange={(e) => onPref('miniOpacity', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-sc-fill/15 rounded-lg appearance-none cursor-pointer accent-[var(--color-sc-orange)]"
          />
          <div className="flex justify-between text-[10px] text-sc-dim">
            <span>20% (Bardzo przezroczysty)</span>
            <span>100% (Kryjący)</span>
          </div>
        </div>
      )}

      {/* 3. Button Visibility Toggles */}
      <div className="space-y-3">
        <label className="text-[12.5px] font-bold text-sc-fg">
          Wyświetlane elementy i przyciski
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {BUTTON_TOGGLES.map((t) => {
            const active = Boolean(prefs[t.key]);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onPref(t.key, !active as any)}
                className={clsx(
                  'flex items-start justify-between gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer',
                  active
                    ? 'border-sc-orange/50 bg-sc-orange/10'
                    : 'border-sc-line bg-sc-panel-2/30 hover:border-sc-dim'
                )}
              >
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-sc-fg">{t.label}</div>
                  <div className="text-[11px] text-sc-muted mt-0.5 leading-snug">{t.desc}</div>
                </div>
                <div
                  className={clsx(
                    'w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-all mt-0.5',
                    active
                      ? 'bg-sc-orange border-sc-orange text-white'
                      : 'border-sc-line bg-sc-panel'
                  )}
                >
                  {active && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GlobalShortcutsPanel({
  prefs,
  onPref,
}: {
  prefs: Prefs;
  onPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}) {
  const [recordingKey, setRecordingKey] = useState<string | null>(null);

  const SHORTCUT_ROWS: {
    key: keyof Prefs;
    label: string;
    desc: string;
    defaultVal: string;
  }[] = [
    {
      key: 'shortcutToggle',
      label: 'Play / Pause (Odtwarzaj / Wstrzymaj)',
      desc: 'Wznawia lub pauzuje aktualnie odtwarzany utwór',
      defaultVal: 'Ctrl+Alt+Space',
    },
    {
      key: 'shortcutNext',
      label: 'Następny utwór (Next Track)',
      desc: 'Przechodzi do kolejnego utworu w kolejce',
      defaultVal: 'Ctrl+Alt+Right',
    },
    {
      key: 'shortcutPrev',
      label: 'Poprzedni utwór (Previous Track)',
      desc: 'Cofa do poprzedniego utworu lub na początek',
      defaultVal: 'Ctrl+Alt+Left',
    },
    {
      key: 'shortcutVolumeUp',
      label: 'Zwiększ głośność (Volume Up)',
      desc: 'Podgłaśnia odtwarzacz o +5%',
      defaultVal: 'Ctrl+Alt+Up',
    },
    {
      key: 'shortcutVolumeDown',
      label: 'Zmniejsz głośność (Volume Down)',
      desc: 'Ścisza odtwarzacz o -5%',
      defaultVal: 'Ctrl+Alt+Down',
    },
    {
      key: 'shortcutMiniPlayer',
      label: 'Przełącz Mini Player',
      desc: 'Szybkie otwieranie / ukrywanie pływającego mini playera',
      defaultVal: 'Ctrl+Alt+M',
    },
  ];

  const handleKeyDown = (e: React.KeyboardEvent, prefKey: keyof Prefs) => {
    e.preventDefault();
    e.stopPropagation();

    // Ignore standalone modifier presses
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    let keyName = e.code.replace('Key', '').replace('Digit', '');
    if (e.key === ' ') keyName = 'Space';
    else if (e.key === 'ArrowUp') keyName = 'Up';
    else if (e.key === 'ArrowDown') keyName = 'Down';
    else if (e.key === 'ArrowLeft') keyName = 'Left';
    else if (e.key === 'ArrowRight') keyName = 'Right';
    else if (e.key.length === 1) keyName = e.key.toUpperCase();

    if (parts.length === 0) parts.push('Ctrl', 'Alt');
    parts.push(keyName);

    const combo = parts.join('+');
    onPref(prefKey, combo as any);
    setRecordingKey(null);
  };

  const resetAllDefaults = () => {
    SHORTCUT_ROWS.forEach((r) => {
      onPref(r.key, r.defaultVal as any);
    });
    onPref('globalShortcutsEnabled', true);
  };

  return (
    <div className="space-y-4">
      {/* Master Toggle */}
      <div className="flex items-center justify-between p-3.5 rounded-xl border border-sc-line bg-sc-panel-2/30">
        <div>
          <div className="text-[13px] font-bold text-sc-fg">Globalne skróty multimedialne</div>
          <div className="text-[11.5px] text-sc-muted mt-0.5">
            Działają w całym systemie Windows, również przy zminimalizowanej aplikacji i podczas gier.
          </div>
        </div>
        <button
          type="button"
          onClick={() => onPref('globalShortcutsEnabled', !prefs.globalShortcutsEnabled)}
          className={clsx(
            'px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer',
            prefs.globalShortcutsEnabled
              ? 'bg-sc-orange text-white shadow-md shadow-sc-orange/20'
              : 'border border-sc-line bg-sc-panel text-sc-muted hover:text-sc-fg'
          )}
        >
          {prefs.globalShortcutsEnabled ? 'Włączone' : 'Wyłączone'}
        </button>
      </div>

      {/* Shortcut list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {SHORTCUT_ROWS.map((row) => {
          const val = String(prefs[row.key] || row.defaultVal);
          const isRecording = recordingKey === row.key;

          return (
            <div
              key={row.key}
              className={clsx(
                'p-3 rounded-xl border transition-all flex flex-col justify-between gap-2',
                isRecording
                  ? 'border-sc-orange bg-sc-orange/10 ring-2 ring-sc-orange/30'
                  : 'border-sc-line bg-sc-panel-2/40'
              )}
            >
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold text-sc-fg">{row.label}</div>
                <div className="text-[10.5px] text-sc-muted mt-0.5 leading-snug">{row.desc}</div>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setRecordingKey(isRecording ? null : (row.key as string))}
                  onKeyDown={(e) => isRecording && handleKeyDown(e, row.key)}
                  className={clsx(
                    'flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-bold text-center border transition-all cursor-pointer select-none',
                    isRecording
                      ? 'bg-sc-orange text-white border-sc-orange animate-pulse'
                      : 'bg-sc-panel border-sc-line text-sc-fg hover:border-sc-dim hover:text-sc-orange'
                  )}
                  title="Kliknij, aby zmienić skrót klawiszowy"
                >
                  {isRecording ? 'Wciśnij klawisze...' : val}
                </button>

                {val !== row.defaultVal && (
                  <button
                    type="button"
                    onClick={() => onPref(row.key, row.defaultVal as any)}
                    className="p-1.5 text-sc-muted hover:text-sc-fg text-[11px] rounded-lg border border-sc-line hover:border-sc-dim transition-colors cursor-pointer"
                    title="Przywróć domyślny skrót"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={resetAllDefaults}
          className="px-3 py-1.5 text-xs text-sc-muted hover:text-sc-fg border border-sc-line rounded-xl hover:border-sc-dim transition-colors cursor-pointer"
        >
          Przywróć wszystkie domyślne skróty
        </button>
      </div>
    </div>
  );
}

export function SettingsView({
  prefs,
  onPref,
  onResetPrefs,
  auth,
  onClearCache,
  onClearHistory,
  eq,
  onEq,
  bandCount,
  onBandCount,
  visualizer,
  onVisualizer,
  themes,
  themeId,
  onTheme,
  onSaveCustomTheme,
  onDeleteCustomTheme,
  status,
  error,
  stats,
  focusSection,
  accountPlaylists,
  spotify,
}: {
  prefs: Prefs;
  onPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  /** Returns every preference to its default and clears the stored order. */
  onResetPrefs: () => void;
  auth: AuthProps;
  onClearCache: () => void;
  onClearHistory: () => void;
  eq: number[];
  onEq: (gains: number[]) => void;
  bandCount: BandCount;
  onBandCount: (count: BandCount) => void;
  visualizer: VisualizerMode;
  onVisualizer: (m: VisualizerMode) => void;
  themes: ThemeDef[];
  themeId: string;
  onTheme: (id: string) => void;
  onSaveCustomTheme: (theme: ThemeDef) => void;
  onDeleteCustomTheme: (id: string) => void;
  status: string;
  error: string | null;
  stats: Stats;
  focusSection?: string;
  accountPlaylists?: Playlist[];
  spotify: SpotifyProps;
}) {
  const bands = bandsFor(bandCount);
  const [eqOpen, setEqOpen] = useState(focusSection === 'equalizer');
  const [visOpen, setVisOpen] = useState(focusSection === 'visualizer');

  useEffect(() => {
    if (focusSection === 'equalizer') {
      setEqOpen(true);
      const timer = setTimeout(() => {
        const el = document.getElementById('settings-equalizer');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timer);
    } else if (focusSection === 'visualizer') {
      setVisOpen(true);
      const timer = setTimeout(() => {
        const el = document.getElementById('settings-visualizer');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [focusSection]);

  return (
    <div className="p-6 sm:p-8 max-w-[900px] mx-auto w-full space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
          <p className="text-[12px] text-sc-muted mt-1">
            Everything here is saved as you change it.
          </p>
        </div>
        <button
          type="button"
          onClick={onResetPrefs}
          className="inline-flex items-center gap-1.5 rounded-full border border-sc-line px-3.5 py-1.5 text-[11.5px] font-semibold text-sc-muted hover:text-sc-fg hover:border-sc-dim transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset all settings
        </button>
      </div>

      <AuthPanel {...auth} />

      {/* 1. AUDIO & PLAYBACK */}
      <div className="pt-4">
        <SectionHeader
          title="Audio & Playback"
          subtitle="Sound enhancement, spatial audio, silence trim, and volume controls"
          icon={<Headphones className="w-4 h-4 text-sc-orange" />}
        />
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle
              icon={Waves}
              label="Loudness Equalizer (Auto-Normalization)"
              hint="Balances output levels across quiet and loud tracks distortion-free using Web Audio dynamic compression."
              checked={prefs.loudnessEqualizer}
              onChange={(v) => onPref('loudnessEqualizer', v)}
            />
            <Toggle
              icon={Headphones}
              label="3D Spatial Audio (Dolby Atmos Style)"
              hint="Immersive stereo soundstage widening (Haas delay + presence contour) for a simulated 3D spatial field."
              checked={prefs.spatialAudio}
              onChange={(v) => onPref('spatialAudio', v)}
            />
            <Toggle
              icon={Scissors}
              label="Auto-Trim Silence"
              hint="Automatically skips dead intro pauses and cuts trailing silence between tracks for seamless uninterrupted listening."
              checked={prefs.autoTrimSilence ?? true}
              onChange={(v) => onPref('autoTrimSilence', v)}
            />
            <Toggle
              icon={Compass}
              label="Autodiscovery"
              hint="When the queue runs out, play something related instead of stopping. Suspended while Shuffle or Repeat is on."
              checked={prefs.autodiscovery}
              onChange={(v) => onPref('autodiscovery', v)}
            />
          </div>

          <div className="rounded-2xl border border-sc-line bg-sc-panel p-4 flex items-center gap-4">
            <Activity className="w-4 h-4 text-sc-orange shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[12px] font-bold text-sc-fg">Crossfade</div>
                <span className="text-[11px] text-sc-dim tabular-nums">
                  {prefs.crossfade === 0 ? 'Off' : `${prefs.crossfade}s`}
                </span>
              </div>
              <div className="text-[11px] text-sc-dim mt-0.5">
                The next track ramps up while the current one fades out, so switching never drops to silence.
              </div>
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                value={prefs.crossfade}
                onChange={(e) => onPref('crossfade', Number(e.target.value))}
                aria-label="Crossfade length"
                className="w-full mt-2 accent-[var(--color-sc-orange)]"
              />
            </div>
          </div>

          {prefs.rememberVolume && (
            <div className="rounded-2xl border border-sc-line bg-sc-panel p-4 flex items-center gap-4 animate-fade-in">
              <Volume2 className="w-4 h-4 text-sc-orange shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-bold text-sc-fg">
                  Startup volume · {Math.round(prefs.volume * 100)}%
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(prefs.volume * 100)}
                  onChange={(e) => onPref('volume', Number(e.target.value) / 100)}
                  aria-label="Startup volume"
                  className="w-full mt-2 accent-[var(--color-sc-orange)]"
                />
              </div>
            </div>
          )}

          <Disclosure
            id="settings-equalizer"
            title="Equalizer"
            subtitle={`${bandCount} bands · ±${EQ_RANGE} dB`}
            icon={<Sliders className="w-[18px] h-[18px] text-sc-orange" />}
            isOpen={eqOpen}
            onToggle={() => setEqOpen((v) => !v)}
          >
            <div className="pt-4 space-y-4">
              <p className="text-[12px] text-sc-muted max-w-[60ch]">
                Drag a point on the curve to shape it, or start from a preset. Double-click a point to
                reset it to 0 dB. Changes apply live and are saved.
              </p>

              {/* Band count. Changing it resamples the current curve instead of
                  throwing it away, so the shape survives an 8 -> 16 comparison. */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-sc-muted mr-1">
                  Bands
                </span>
                {EQ_BAND_COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onBandCount(n)}
                    aria-pressed={bandCount === n}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all',
                      bandCount === n
                        ? 'bg-sc-orange/15 text-sc-orange-soft border border-sc-orange/50'
                        : 'bg-sc-panel-2/40 text-sc-dim border border-sc-line hover:text-sc-fg'
                    )}
                  >
                    {n}
                  </button>
                ))}
                <span className="text-[11px] text-sc-faint">
                  {bands.map((b) => b.label).join(' · ')}
                </span>
              </div>

              {/* The waveform only. The per-band sliders that used to sit under this
                  were redundant with the curve - same numbers, harder to aim at -
                  and the point markers are what everyone actually uses. */}
              <div className="rounded-xl border border-sc-line bg-sc-panel-2/40 overflow-hidden">
                <EqResponseCurve eq={eq} onEq={onEq} bands={bands} height={180} />
              </div>

              <EqPresets eq={eq} onEq={onEq} count={bandCount} allowCustomSave />
            </div>
          </Disclosure>

          <Disclosure
            title="Global Media Keybinds"
            subtitle="System-wide shortcuts to control playback anywhere on your PC"
            icon={<Keyboard className="w-[18px] h-[18px] text-sc-orange" />}
            defaultOpen={false}
          >
            <div className="pt-4">
              <GlobalShortcutsPanel prefs={prefs} onPref={onPref} />
            </div>
          </Disclosure>
        </div>
      </div>

      {/* 2. APPEARANCE & INTERFACE */}
      <div className="pt-4">
        <SectionHeader
          title="Appearance & Interface"
          subtitle="Theme colors, artwork accents, animations, and library density"
          icon={<Palette className="w-4 h-4 text-sc-orange" />}
        />
        <div className="space-y-4">
          <Disclosure
            title="Theme"
            subtitle="Applies immediately and is remembered"
            icon={<Palette className="w-[18px] h-[18px] text-sc-orange" />}
          >
            <div className="grid gap-2 sm:grid-cols-2 pt-4">
              {themes.map((t) => {
                const swatch = themeSwatch(t);
                return (
                  <div key={t.id} className="relative">
                    <button
                      type="button"
                      onClick={() => onTheme(t.id)}
                      aria-pressed={themeId === t.id}
                      className={clsx(
                        'w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                        themeId === t.id
                          ? 'border-sc-orange/60 bg-sc-orange/10'
                          : 'border-sc-line bg-sc-panel-2/40 hover:border-sc-dim'
                      )}
                    >
                      <div className="flex shrink-0 rounded-md overflow-hidden border border-sc-line">
                        {swatch.map((c, i) => (
                          <span key={i} className="w-5 h-8 block" style={{ background: c }} />
                        ))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-bold text-sc-fg">{t.label}</span>
                          {themeId === t.id && <Check className="w-3 h-3 text-sc-orange-soft" />}
                        </div>
                        <div className="text-[10px] text-sc-dim leading-tight">
                          {t.mode === 'dark' ? 'Dark' : 'Light'}
                          {t.custom ? ' · custom' : ''}
                        </div>
                      </div>
                    </button>
                    {t.custom && (
                      <button
                        type="button"
                        onClick={() => onDeleteCustomTheme(t.id)}
                        title="Remove this custom theme"
                        aria-label={`Remove ${t.label}`}
                        className="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center text-sc-faint hover:text-sc-fg bg-sc-bg/60 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <CustomThemeEditor onSave={onSaveCustomTheme} />
          </Disclosure>

          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle
              icon={Palette}
              label="Dynamic Artwork Theme"
              hint="Dynamically blends interface accents (buttons, glows, borders) with the vibrant palette of the playing track."
              checked={prefs.dynamicArtworkTheme}
              onChange={(v) => onPref('dynamicArtworkTheme', v)}
            />
            <Toggle
              icon={ImageIcon}
              label="Show cover art"
              hint="Artwork in every track row. Turning it off leaves more room for titles."
              checked={prefs.showArtwork}
              onChange={(v) => onPref('showArtwork', v)}
            />
            <Toggle
              icon={Rows3}
              label="Compact track rows"
              hint="Denser lists, so far more of a playlist fits on screen at once."
              checked={prefs.compactRows}
              onChange={(v) => onPref('compactRows', v)}
            />
            <Toggle
              icon={Sparkles}
              label="Animations"
              hint="Popovers, view transitions and the visualizer. Turn off for a still, instant interface."
              checked={prefs.animations}
              onChange={(v) => onPref('animations', v)}
            />
            <Toggle
              icon={Volume2}
              label="Remember volume"
              hint="Start every launch at the volume you left off at, instead of the default."
              checked={prefs.rememberVolume}
              onChange={(v) => onPref('rememberVolume', v)}
            />
          </div>
        </div>
      </div>

      {/* MINI PLAYER & FLOATING WINDOW */}
      <div className="pt-4">
        <SectionHeader
          title="Mini Player & Floating Window"
          subtitle="Configure draggable floating mini player, buttons, live preview, blur and transparency"
          icon={<Maximize2 className="w-4 h-4 text-sc-orange" />}
        />
        <div className="rounded-2xl border border-sc-line bg-sc-panel p-5">
          <MiniPlayerSettingsPanel prefs={prefs} onPref={onPref} />
        </div>
      </div>

      {/* 3. TYPING FEEDBACK */}
      <div className="pt-4">
        <SectionHeader
          title="Typing Feedback"
          subtitle="Mechanical switch acoustics while searching and chatting"
          icon={<Keyboard className="w-4 h-4 text-sc-orange" />}
        />
        <div className="rounded-2xl border border-sc-line bg-sc-panel p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-sc-orange">
                <Keyboard className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[13px] font-bold text-sc-fg flex items-center gap-2">
                  Mechanical Typing Feedback
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-white/10 text-white/70">
                    Search &amp; Chat
                  </span>
                </div>
                <p className="text-[11.5px] text-sc-muted mt-0.5">
                  Authentic mechanical switch sounds while typing when music is paused.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                playTypingSound(undefined, prefs.typingSoundVolume ?? 0.6, prefs.typingSoundSwitch ?? 'tactile');
              }}
              title="Preview current switch sound"
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
            >
              <Volume2 className="w-3.5 h-3.5 text-sc-orange" />
              Test Click
            </button>
          </div>

          <Toggle
            icon={Keyboard}
            label="Enable typing sound effects"
            hint="Plays realistic mechanical keystrokes only when no track is currently playing."
            checked={prefs.typingSoundEnabled ?? true}
            onChange={(v) => onPref('typingSoundEnabled', v)}
          />

          {prefs.typingSoundEnabled !== false && (
            <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-white/5">
              <div>
                <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                  <span>Keystroke volume</span>
                  <span className="text-sc-orange-soft font-mono">
                    {Math.round((prefs.typingSoundVolume ?? 0.6) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round((prefs.typingSoundVolume ?? 0.6) * 100)}
                  onChange={(e) => onPref('typingSoundVolume', Number(e.target.value) / 100)}
                  className="w-full accent-[var(--color-sc-orange)]"
                />
              </div>

              <div>
                <label className="text-[11.5px] font-semibold text-sc-fg block mb-1.5">
                  Switch acoustic profile
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'tactile', label: 'Brown (Tactile)' },
                      { id: 'clicky', label: 'Blue (Clicky)' },
                      { id: 'thock', label: 'Cream (Thock)' },
                      { id: 'typewriter', label: 'Typewriter' },
                    ] as const
                  ).map((sw) => (
                    <button
                      key={sw.id}
                      type="button"
                      onClick={() => {
                        onPref('typingSoundSwitch', sw.id);
                        playTypingSound(undefined, prefs.typingSoundVolume ?? 0.6, sw.id);
                      }}
                      className={clsx(
                        'py-1.5 px-2.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer text-left',
                        (prefs.typingSoundSwitch || 'tactile') === sw.id
                          ? 'bg-orange-500/15 border-orange-500/50 text-sc-orange font-bold'
                          : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      {sw.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. VISUALIZER & ATMOSPHERE */}
      <div className="pt-4">
        <SectionHeader
          title="Visualizer & Atmosphere"
          subtitle="Audio-reactive spectrum visualizers and cosmic backdrop styling"
          icon={<Activity className="w-4 h-4 text-sc-orange" />}
        />
        <div className="space-y-4">
          <Disclosure
            id="settings-visualizer"
            title="Visualizer"
            subtitle={
              visualizer === 'off'
                ? 'Disabled'
                : `${visualizer} · sensitivity ${(prefs.visualizerSensitivity ?? 1).toFixed(1)}x`
            }
            icon={<Activity className="w-[18px] h-[18px] text-sc-orange" />}
            isOpen={visOpen}
            onToggle={() => setVisOpen((v) => !v)}
          >
            <div className="space-y-5 pt-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {VISUALIZER_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onVisualizer(m.id)}
                    className={clsx(
                      'flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                      visualizer === m.id
                        ? 'border-sc-orange/60 bg-sc-orange/10'
                        : 'border-sc-line bg-sc-panel-2/40 hover:border-neutral-600'
                    )}
                  >
                    <div
                      className={clsx(
                        'w-11 h-8 rounded-md bg-sc-bg/60 border border-sc-line/60 overflow-hidden flex-shrink-0',
                        m.id === 'off' && 'opacity-30'
                      )}
                    >
                      <Spectrum
                        getFreq={null}
                        active={false}
                        bars={14}
                        mode={m.id === 'off' ? 'bars' : m.id}
                        demo
                        threshold={prefs.visualizerThreshold}
                        sensitivity={prefs.visualizerSensitivity}
                        smoothing={prefs.visualizerSmoothing}
                        className="w-full h-full"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-bold text-sc-fg">{m.label}</span>
                        {visualizer === m.id && <Check className="w-3 h-3 text-sc-orange-soft" />}
                      </div>
                      <div className="text-[10px] text-sc-dim leading-tight">{m.hint}</div>
                    </div>
                  </button>
                ))}
              </div>

              {visualizer !== 'off' && (
                <div className="rounded-xl border border-sc-line bg-sc-panel-2/40 p-4 space-y-4 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-sc-fg">Live Preview & Tuning</span>
                    <span className="text-[11px] text-sc-muted capitalize">{visualizer} mode</span>
                  </div>

                  <div className="rounded-lg border border-sc-line bg-sc-bg/80 p-3 h-28 flex items-center justify-center overflow-hidden">
                    <Spectrum
                      getFreq={null}
                      active={false}
                      bars={prefs.visualizerBars ?? (visualizer === 'bars' ? 48 : 64)}
                      mode={visualizer}
                      demo
                      threshold={prefs.visualizerThreshold ?? 0.05}
                      sensitivity={prefs.visualizerSensitivity ?? 1.0}
                      smoothing={prefs.visualizerSmoothing ?? 0.8}
                      className="w-full h-full"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 pt-2">
                    <div>
                      <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                        <span>Noise gate threshold</span>
                        <span className="text-sc-orange-soft font-mono">
                          {Math.round((prefs.visualizerThreshold ?? 0.05) * 100)}%
                        </span>
                      </div>
                      <p className="text-[10.5px] text-sc-muted mb-2">
                        Cuts out background noise so bars remain still when quiet.
                      </p>
                      <input
                        type="range"
                        min={0}
                        max={0.35}
                        step={0.01}
                        value={prefs.visualizerThreshold ?? 0.05}
                        onChange={(e) => onPref('visualizerThreshold', Number(e.target.value))}
                        className="w-full accent-[var(--color-sc-orange)]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                        <span>Sensitivity (Gain)</span>
                        <span className="text-sc-orange-soft font-mono">
                          {(prefs.visualizerSensitivity ?? 1.0).toFixed(1)}x
                        </span>
                      </div>
                      <p className="text-[10.5px] text-sc-muted mb-2">
                        Boosts bar movement on quiet or lower volume tracks.
                      </p>
                      <input
                        type="range"
                        min={0.5}
                        max={2.5}
                        step={0.1}
                        value={prefs.visualizerSensitivity ?? 1.0}
                        onChange={(e) => onPref('visualizerSensitivity', Number(e.target.value))}
                        className="w-full accent-[var(--color-sc-orange)]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                        <span>Falloff smoothing</span>
                        <span className="text-sc-orange-soft font-mono">
                          {Math.round((prefs.visualizerSmoothing ?? 0.8) * 100)}%
                        </span>
                      </div>
                      <p className="text-[10.5px] text-sc-muted mb-2">
                        Higher values make peaks decay smoothly; lower values make bars snappy.
                      </p>
                      <input
                        type="range"
                        min={0.3}
                        max={0.95}
                        step={0.05}
                        value={prefs.visualizerSmoothing ?? 0.8}
                        onChange={(e) => onPref('visualizerSmoothing', Number(e.target.value))}
                        className="w-full accent-[var(--color-sc-orange)]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                        <span>Bar density</span>
                        <span className="text-sc-orange-soft font-mono">
                          {prefs.visualizerBars ?? 48} bars
                        </span>
                      </div>
                      <p className="text-[10.5px] text-sc-muted mb-2">
                        Number of spectrum bands drawn across the canvas.
                      </p>
                      <div className="flex items-center gap-1.5 pt-1">
                        {[24, 36, 48, 64, 80].map((count) => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => onPref('visualizerBars', count)}
                            className={clsx(
                              'flex-1 py-1 rounded-md text-[11px] font-bold border transition-all cursor-pointer',
                              (prefs.visualizerBars ?? 48) === count
                                ? 'bg-sc-orange/15 text-sc-orange-soft border-sc-orange/50'
                                : 'bg-sc-panel border-sc-line text-sc-dim hover:text-sc-fg'
                            )}
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Disclosure>

          <Disclosure
            id="settings-background"
            title="Background"
            subtitle={`${BG_MODES.find((m) => m.id === prefs.bgMode)?.label ?? 'Cosmic'} · variation ${Math.round(
              (prefs.bgVariation ?? 0) * 100
            )}%`}
            icon={<Sparkles className="w-[18px] h-[18px] text-sc-orange" />}
          >
            <div className="space-y-5 pt-4">
              <div className="grid gap-2 sm:grid-cols-3">
                {BG_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onPref('bgMode', m.id)}
                    aria-pressed={prefs.bgMode === m.id}
                    className={clsx(
                      'flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                      prefs.bgMode === m.id
                        ? 'border-sc-orange/60 bg-sc-orange/10'
                        : 'border-sc-line bg-sc-panel-2/40 hover:border-sc-dim'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-bold text-sc-fg">{m.label}</span>
                        {prefs.bgMode === m.id && (
                          <Check className="w-3 h-3 text-sc-orange-soft" />
                        )}
                      </div>
                      <div className="text-[10px] text-sc-dim leading-tight">{m.hint}</div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle
                  icon={Sparkles}
                  label="Shooting stars"
                  hint="Meteors streaking across the sky, more often when the bass hits."
                  checked={prefs.bgShootingStars}
                  onChange={(v) => onPref('bgShootingStars', v)}
                />
                <Toggle
                  icon={Activity}
                  label="React to the music"
                  hint="Twinkle and brightness follow the spectrum of whatever is playing."
                  checked={prefs.bgAudioReactive}
                  onChange={(v) => onPref('bgAudioReactive', v)}
                />
              </div>

              <div className="rounded-xl border border-sc-line bg-sc-panel-2/40 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-sc-fg">Variation &amp; motion</span>
                  <span className="text-[11px] text-sc-muted">
                    {prefs.bgMode === 'off' ? 'Hidden until a mode is on' : 'Applies live'}
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                      <span>Background variation</span>
                      <span className="text-sc-orange-soft font-mono">
                        {Math.round((prefs.bgVariation ?? 0) * 100)}%
                      </span>
                    </div>
                    <p className="text-[10.5px] text-sc-muted mb-2">
                      How much the backdrop changes over time. At 0% the palette is pinned;
                      higher values keep the glow cycling and spread the star colours.
                    </p>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={prefs.bgVariation ?? 0}
                      onChange={(e) => onPref('bgVariation', Number(e.target.value))}
                      className="w-full accent-[var(--color-sc-orange)]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                      <span>Star density</span>
                      <span className="text-sc-orange-soft font-mono">
                        {(prefs.bgStarDensity ?? 1).toFixed(1)}x
                      </span>
                    </div>
                    <p className="text-[10.5px] text-sc-muted mb-2">
                      Scales the number of stars and dust motes drawn per mode.
                    </p>
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.1}
                      value={prefs.bgStarDensity ?? 1}
                      onChange={(e) => onPref('bgStarDensity', Number(e.target.value))}
                      className="w-full accent-[var(--color-sc-orange)]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                      <span>Animation speed</span>
                      <span className="text-sc-orange-soft font-mono">
                        {(prefs.bgSpeed ?? 1).toFixed(1)}x
                      </span>
                    </div>
                    <p className="text-[10.5px] text-sc-muted mb-2">
                      Drift and twinkle rate for the whole backdrop.
                    </p>
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.1}
                      value={prefs.bgSpeed ?? 1}
                      onChange={(e) => onPref('bgSpeed', Number(e.target.value))}
                      className="w-full accent-[var(--color-sc-orange)]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                      <span>Glow intensity</span>
                      <span className="text-sc-orange-soft font-mono">
                        {(prefs.bgIntensity ?? 1).toFixed(1)}x
                      </span>
                    </div>
                    <p className="text-[10.5px] text-sc-muted mb-2">
                      Brightness of the orbs and of every star drawn.
                    </p>
                    <input
                      type="range"
                      min={0.2}
                      max={1.8}
                      step={0.1}
                      value={prefs.bgIntensity ?? 1}
                      onChange={(e) => onPref('bgIntensity', Number(e.target.value))}
                      className="w-full accent-[var(--color-sc-orange)]"
                    />
                  </div>

                  {prefs.bgAudioReactive && (
                    <div>
                      <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                        <span>Music sensitivity</span>
                        <span className="text-sc-orange-soft font-mono">
                          {(prefs.bgSensitivity ?? 1).toFixed(1)}x
                        </span>
                      </div>
                      <p className="text-[10.5px] text-sc-muted mb-2">
                        How hard the spectrum pushes the twinkle and the meteors.
                      </p>
                      <input
                        type="range"
                        min={0.5}
                        max={2.5}
                        step={0.1}
                        value={prefs.bgSensitivity ?? 1}
                        onChange={(e) => onPref('bgSensitivity', Number(e.target.value))}
                        className="w-full accent-[var(--color-sc-orange)]"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between text-[11.5px] font-semibold text-sc-fg mb-1">
                      <span>Colour source</span>
                    </div>
                    <p className="text-[10.5px] text-sc-muted mb-2">
                      What the glow and the stars take their hue from.
                    </p>
                    <div className="flex items-center gap-1.5 pt-1">
                      {BG_COLOR_SOURCES.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onPref('bgColorSource', c.id)}
                          className={clsx(
                            'flex-1 py-1.5 rounded-md text-[11px] font-bold border transition-all cursor-pointer',
                            (prefs.bgColorSource ?? 'artwork') === c.id
                              ? 'bg-sc-orange/15 text-sc-orange-soft border-sc-orange/50'
                              : 'bg-sc-panel border-sc-line text-sc-dim hover:text-sc-fg'
                          )}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Disclosure>
        </div>
      </div>

      {/* 5. INTEGRATIONS & SOCIAL */}
      <div className="pt-4">
        <SectionHeader
          title="Integrations & Social"
          subtitle="Connect Discord Rich Presence, Last.fm scrobbler, and Spotify playlists"
          icon={<Users className="w-4 h-4 text-sc-orange" />}
        />
        <div className="space-y-4">
          <Disclosure
            title="Discord Rich Presence"
            subtitle="Automatycznie wyświetla słuchany utwór na Twoim profilu Discord"
            icon={<Music className="w-[18px] h-[18px] text-sc-orange" />}
          >
            <div className="pt-4 space-y-3">
              <div className="p-3.5 rounded-xl border border-sc-line bg-sc-panel-2/40 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#5865F2]/20 text-[#8592ff] flex items-center justify-center shrink-0 mt-0.5">
                  <Music className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <div className="text-[12.5px] font-bold text-sc-fg flex items-center gap-2">
                    Oficjalna integracja Abbadon na Discordzie
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-400">
                      Aktywna
                    </span>
                  </div>
                  <p className="text-[11.5px] text-sc-muted leading-relaxed">
                    Aplikacja automatycznie łączy się z Twoim Discordem i wyświetla status <strong>„Słucha Abbadon”</strong> z okładką albumu, tytułem utworu, wykonawcą oraz przyciskami do wspólnego słuchania z przyjaciółmi.
                  </p>
                </div>
              </div>
            </div>
          </Disclosure>

          <Disclosure
            title="Last.fm Scrobbler"
            subtitle="Automatic scrobbling and live Now Playing status"
            icon={<Radio className="w-[18px] h-[18px] text-sc-orange" />}
          >
            <div className="pt-4 space-y-4">
              <Toggle
                icon={Radio}
                label="Enable Last.fm scrobbling"
                hint="Broadcasts real-time Now Playing status and automatically submits completed tracks."
                checked={prefs.lastFmEnabled}
                onChange={(v) => onPref('lastFmEnabled', v)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-sc-muted block mb-1">Last.fm Username</label>
                  <input
                    type="text"
                    placeholder="e.g. your_lastfm_user"
                    value={prefs.lastFmUsername || ''}
                    onChange={(e) => onPref('lastFmUsername', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-sc-fg placeholder:text-sc-faint focus:outline-none focus:border-sc-orange/60"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-sc-muted block mb-1">Session Key</label>
                  <input
                    type="password"
                    placeholder="Last.fm 32-character session key..."
                    value={prefs.lastFmSessionKey || ''}
                    onChange={(e) => onPref('lastFmSessionKey', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-sc-fg placeholder:text-sc-faint focus:outline-none focus:border-sc-orange/60 font-mono"
                  />
                </div>
              </div>
            </div>
          </Disclosure>

          <SpotifyPanel {...spotify} />
        </div>
      </div>

      {/* 6. SYSTEM & STORAGE */}
      <div className="pt-4">
        <SectionHeader
          title="System & Storage"
          subtitle="Catalog sources, proxy bypass, updates, cache, and hidden playlists"
          icon={<ListVideo className="w-4 h-4 text-sc-orange" />}
        />
        <div className="space-y-4">
          <Disclosure
            title="Music source"
            subtitle="Search and the library screen operate on this catalog"
            icon={<Cloud className="w-[18px] h-[18px] text-sc-orange" />}
          >
            <div className="grid gap-2 sm:grid-cols-2 pt-4">
              {MUSIC_SOURCES_UI.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPref('source', s.id)}
                  aria-pressed={prefs.source === s.id}
                  className={clsx(
                    'w-full text-left rounded-xl border p-3 transition-all relative overflow-hidden',
                    prefs.source === s.id
                      ? 'border-sc-orange/60 bg-sc-orange/10'
                      : 'border-sc-line bg-sc-panel-2/40 hover:border-sc-dim'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold text-sc-fg">{s.label}</span>
                    {prefs.source === s.id && (
                      <Check className="w-3.5 h-3.5 text-sc-orange shrink-0" />
                    )}
                  </div>
                  <div className="text-[11px] text-sc-muted mt-0.5">{s.description}</div>
                </button>
              ))}
            </div>
          </Disclosure>

          <SoftwareUpdatesPanel />

          <DownloadsFolderPanel
            downloadPath={prefs.downloadPath}
            onChangePath={(path) => onPref('downloadPath', path)}
          />

          <ProxyPanel prefs={prefs} onPref={onPref} />

          <Disclosure
            title="Storage"
            subtitle={`${stats.alive} cached responses · ${stats.entries} keys total`}
            icon={<ListVideo className="w-[18px] h-[18px] text-sc-orange" />}
          >
            <div className="pt-4 space-y-3">
              <p className="text-[12px] text-sc-muted max-w-[60ch]">
                Responses are cached so paging through the app does not re-hit SoundCloud. Clearing
                the cache is safe: it is refetched as you browse, and your likes and playlists are
                re-synced straight afterwards.
              </p>
              {error && (
                <p className="text-[11px] text-rose-400/90 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                  Last error: {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onClearCache}
                  className="rounded-full bg-sc-fg px-4 py-2 text-[12px] font-bold text-sc-bg hover:scale-[1.03] active:scale-95 transition-all"
                >
                  Clear cache
                </button>
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="rounded-full border border-sc-line px-4 py-2 text-[12px] font-semibold text-sc-muted hover:text-sc-fg hover:border-neutral-600 transition-colors"
                >
                  Clear listen history
                </button>
              </div>
              <p className="text-[11px] text-sc-faint">
                Connection status: {status}
                {stats.inflight > 0 && ` · ${stats.inflight} request in flight`}
                {stats.queued > 0 && ` · ${stats.queued} queued`}
              </p>
            </div>
          </Disclosure>

          {prefs.hiddenPlaylistIds?.length > 0 && (
            <Disclosure
              title={`Hidden Playlists (${prefs.hiddenPlaylistIds.length})`}
              subtitle="Manage playlists hidden from your sidebar"
              icon={<EyeOff className="w-[18px] h-[18px] text-sc-orange" />}
              defaultOpen={false}
            >
              <div className="pt-3 space-y-2">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-[12px] text-sc-muted">
                    These playlists are hidden from your sidebar list.
                  </span>
                  <button
                    type="button"
                    onClick={() => onPref('hiddenPlaylistIds', [])}
                    className="text-[11px] font-semibold text-sc-orange-soft hover:underline cursor-pointer"
                  >
                    Unhide all
                  </button>
                </div>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {prefs.hiddenPlaylistIds.map((hid) => {
                    const found = accountPlaylists?.find((p) => p.id === hid);
                    const title = found?.title ?? `Playlist #${hid}`;
                    return (
                      <div
                        key={hid}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-sc-line bg-sc-panel-2/40"
                      >
                        <span className="text-[12.5px] font-medium text-sc-fg truncate">{title}</span>
                        <button
                          type="button"
                          onClick={() =>
                            onPref(
                              'hiddenPlaylistIds',
                              prefs.hiddenPlaylistIds.filter((id) => id !== hid)
                            )
                          }
                          className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-sc-fill/10 hover:bg-sc-fill/20 text-sc-fg transition-colors cursor-pointer"
                        >
                          Unhide
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Disclosure>
          )}
        </div>
      </div>
    </div>
  );
}

export { SectionHeader };