import { useEffect, useMemo, useRef, useState } from 'react';
import { Artwork } from './Artwork';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  ExternalLink,
  Loader2,
  ListMusic,
  ListPlus,
  ListEnd,
  Maximize2,
  Minimize2,
  Sliders,
  X,
  Download,
  Gauge,
  Mic2,
  MessageSquare,
  Music4,
  Headphones,
  Users,
  Radio,
} from 'lucide-react';
import clsx from 'clsx';
import type { Track, User } from '../types';
import type { Friend, FriendPresence, SyncSession } from '../lib/listenTogether';
import {
  Spectrum,
  EqBars,
  AudioBloom,
  ArtworkFrameVisualizer,
  EqPresets,
  EqCurvePreview,
  type VisualizerMode,
} from './Visualizer';
import { EQ_RANGE, bandsFor, presetEq, type BandCount } from '../hooks/useAudioEngine';
import { RATE_MAX, RATE_MIN, RATE_STEPS, formatRate } from '../hooks/useAudioEngine';
import { useArtworkColor } from '../lib/artworkColor';
import { TrackComments } from './TrackComments';
import { LyricsPanel } from './LyricsPanel';
import {
  fetchLyrics,
  cachedLyrics,
  rememberLyrics,
  activeLineIndex,
  type Lyrics,
} from '../lib/lyrics';

const ACCENT = '#6d5efc';
const ACCENT_SOFT = '#38e0d4';

/** Used when the host does not wire a toast, so a fetch failure stays silent. */
const NOOP_NOTIFY = () => {};

interface Props {
  track: Track | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  liked: boolean;
  queue: Track[];
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (t: number) => void;
  onVolume: (v: number) => void;
  onMute: () => void;
  /** Playback speed multiplier. */
  rate: number;
  onRate: (r: number) => void;
  /** True keeps the pitch fixed while the rate changes. */
  preservePitch: boolean;
  onPreservePitch: (on: boolean) => void;
  onToggleLike: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  getFreq: (() => Uint8Array | null) | null;
  onOpenQueue: () => void;
  queueOpen?: boolean;
  eq: number[];
  onEq: (gains: number[]) => void;
  /** Active band count. The bar shows a curve, not sliders, so this is read-only. */
  bandCount: BandCount;
  visualizer: VisualizerMode;
  visualizerThreshold?: number;
  visualizerSensitivity?: number;
  visualizerSmoothing?: number;
  visualizerBars?: number;
  renderPlaylistAction?: (track: Track, alwaysVisible?: boolean) => React.ReactNode;
  /** Appends the track to the end of the queue without interrupting playback. */
  onAddToQueue?: (track: Track) => void;
  /** Autodiscovery runs on its own; this opens the "Find similar" category. */
  
  /** Jumps to Settings, where the advanced response curve lives. */
  onOpenSettings?: (section?: string) => void;
  /** Opens creator page. */
  onOpenArtist?: (artist: { id: string; username: string; permalinkUrl?: string }) => void;
  /** The signed-in account, for the comment composer. Null while signed out. */
  me?: User | null;
  signedIn?: boolean;
  notify?: (msg: string) => void;
  /** Opens Settings -> Account, for the signed-out comment prompt. */
  onRequireSignIn?: () => void;
  /** Saves the current track to the OS Downloads folder. */
  onDownload: () => void;
  /** True while the current track is being downloaded, for the spinner. */
  downloading: boolean;
  /** Triggers the end-of-queue autodiscover stream manually on demand. */
  onTriggerEndOfQueue?: () => void;
  loadingSimilarQueue?: boolean;
  onOpenFriends?: () => void;
  isSyncActive?: boolean;
  syncTargetName?: string;
  friends?: Friend[];
  presences?: Record<string, FriendPresence>;
  onFollowFriend?: (code: string) => void;
  onRequestListenTogether?: (code: string) => void;
  pendingOutgoingRequestTo?: string | null;
  syncSession?: SyncSession;
  onStopSync?: () => void;
  onStartRadio?: (track: Track) => void;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/**
 * Wheel over an element adjusts the volume.
 *
 * The listener is attached natively with `{ passive: false }` because React
 * registers its own wheel handlers passively, and a passive listener cannot call
 * `preventDefault` - the page behind would scroll instead of the volume moving.
 * Values are read through a ref so the listener binds once rather than on every
 * drag frame.
 */
function useWheelVolume(
  target: React.RefObject<HTMLElement | null>,
  state: { muted: boolean; volume: number; onVolume: (v: number) => void }
): void {
  const live = useRef(state);
  live.current = state;
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { muted, volume, onVolume } = live.current;
      const current = muted ? 0 : volume;
      onVolume(Math.max(0, Math.min(1, current + (e.deltaY > 0 ? -0.05 : 0.05))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [target]);
}

/** Horizontal drag slider that works with the mouse and the keyboard. */
function Slider({
  value,
  max,
  onChange,
  label,
  className,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  className?: string;
}) {
  const pct = max === 0 ? 0 : (value / max) * 100;
  const fillRef = useRef<HTMLSpanElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const isDraggingRef = useRef(false);

  // Sync DOM with prop whenever not actively dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (knobRef.current) {
        knobRef.current.style.left = `${pct}%`;
        knobRef.current.style.opacity = pct > 0 ? '1' : '0';
      }
    }
  }, [pct]);

  const apply = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const directPct = ratio * 100;
    // Synchronously update DOM elements immediately for instant 0ms latency tracking
    if (fillRef.current) fillRef.current.style.width = `${directPct}%`;
    if (knobRef.current) {
      knobRef.current.style.left = `${directPct}%`;
      knobRef.current.style.opacity = directPct > 0 ? '1' : '0';
    }
    onChange(ratio);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      // The visible track is 6px; the padded box around it is what the pointer
      // actually hits. Negative margins keep the padded area from changing the
      // layout, so the control occupies the same space but is far easier to grab.
      className={clsx(
        'group relative -my-2 py-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sc-orange/70 rounded-full select-none',
        className
      )}
      onPointerDown={(e) => {
        isDraggingRef.current = true;
        // Capture lands on this element, so the value is computed from the padded
        // box rather than the thin visual track - otherwise a drag would jump
        // because the pointer had left the 6px line.
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e.clientX, e.currentTarget);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId) || e.buttons === 1) {
          apply(e.clientX, e.currentTarget);
        }
      }}
      onPointerUp={(e) => {
        isDraggingRef.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={() => {
        isDraggingRef.current = false;
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(1, value + step));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(Math.max(0, value - step));
      }}
    >
      {/* Padded hit area. Transparent, but it is what catches the pointer. */}
      <span className="absolute inset-x-0 -inset-y-2 pointer-events-none" aria-hidden="true" />
      <span
        className="relative block h-1.5 rounded-full bg-sc-fill/10 transition-colors group-hover:bg-sc-fill/15"
        aria-hidden="true"
      >
        <span
          ref={fillRef}
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sc-orange to-sc-orange-soft group-hover:brightness-110 pointer-events-none"
          style={{ width: `${pct}%` }}
        />
        {/* The knob is always in sync with the bar and pointer */}
        <span
          ref={knobRef}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow pointer-events-none"
          style={{ left: `${pct}%`, opacity: pct > 0 ? 1 : 0 }}
        />
      </span>
    </div>
  );
}

/**
 * Compact EQ popover.
 *
 * This is the "quick" surface: presets plus a read-only curve that shows the
 * shape of the current setting. Sliders and the editable curve stay in
 * Settings, where there is room for them - dragging a handle inside a popover
 * this size was never going to feel good.
 */
function EqPanel({
  eq,
  onEq,
  bandCount,
  onOpenAdvanced,
  wide = false,
  width,
}: {
  eq: number[];
  onEq: (g: number[]) => void;
  bandCount: BandCount;
  onOpenAdvanced?: () => void;
  wide?: boolean;
  /** Explicit width for the popover, which sizes itself to the window. */
  width?: number;
}) {
  const bands = bandsFor(bandCount);
  return (
    <div
      style={width ? { width } : undefined}
      className={clsx(
        'rounded-2xl border border-sc-line bg-sc-panel p-4 shadow-2xl',
        !width && !wide && 'w-[420px]'
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[12px] font-bold text-sc-fg flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-sc-orange-soft" />
          Equalizer
          <span className="text-[10px] font-semibold text-sc-dim">{bandCount} bands</span>
        </h4>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onEq(bands.map(() => 0))}
            className="text-[10px] font-semibold text-sc-dim hover:text-sc-fg transition-colors cursor-pointer"
          >
            Reset
          </button>
          {onOpenAdvanced && (
            <button
              onClick={onOpenAdvanced}
              className="text-[10px] font-semibold text-sc-orange-soft hover:brightness-110 transition-all cursor-pointer"
            >
              Advanced curve
            </button>
          )}
        </div>
      </div>

      <EqPresets eq={eq} onEq={onEq} count={bandCount} className="mb-4" />

      {/* Waveform only. The band bars that used to sit here duplicated the curve
          on a smaller scale and made the popover twice as tall for no extra
          information; editing stays in Settings. */}
      <EqCurvePreview bands={bands} eq={eq} height={wide ? 130 : 108} />
    </div>
  );
}

function FriendsListeningNow({
  friends,
  presences,
  currentTrackId,
  onFollowFriend,
  onRequestListenTogether,
  pendingOutgoingRequestTo,
  syncSession,
  onStopSync,
}: {
  friends?: Friend[];
  presences?: Record<string, FriendPresence>;
  currentTrackId?: string;
  onFollowFriend?: (code: string) => void;
  onRequestListenTogether?: (code: string) => void;
  pendingOutgoingRequestTo?: string | null;
  syncSession?: SyncSession;
  onStopSync?: () => void;
}) {
  if (!friends || !presences) return null;

  const activeFriends = friends
    .map((f) => ({ friend: f, presence: presences[f.code] }))
    .filter(({ presence }) => Boolean(presence && presence.track));

  if (activeFriends.length === 0) return null;

  activeFriends.sort((a, b) => {
    const aPlaying = Boolean(a.presence?.isPlaying && a.presence?.online);
    const bPlaying = Boolean(b.presence?.isPlaying && b.presence?.online);
    if (aPlaying && !bPlaying) return -1;
    if (!aPlaying && bPlaying) return 1;
    const aTime = a.presence?.timestamp || a.presence?.lastSeen || 0;
    const bTime = b.presence?.timestamp || b.presence?.lastSeen || 0;
    return bTime - aTime;
  });

  const formatTimeAgo = (ts?: number) => {
    if (!ts) return 'niedawno';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return 'przed chwilą';
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins} min temu`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} godz. temu`;
    const days = Math.floor(hours / 24);
    return `${days} dni temu`;
  };

  return (
    <div className="rounded-2xl border border-sc-line bg-sc-panel/60 p-4 animate-fade-in space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-sc-muted flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-sc-orange" />
          Friends listening to music ({activeFriends.length})
        </span>
      </div>

      <div className="space-y-2 max-h-48 overflow-y-auto scroll-rail pr-1">
        {activeFriends.map(({ friend, presence }) => {
          if (!presence || !presence.track) return null;
          const isSameTrack = currentTrackId && presence.track.id === currentTrackId;
          const isPlaying = Boolean(presence.isPlaying && presence.online);
          const isCoListening = syncSession?.mode === 'co-listening' && syncSession?.partnerCode === friend.code;
          const isFollowing = syncSession?.mode === 'following' && syncSession?.targetCode === friend.code;
          const isPending = pendingOutgoingRequestTo === friend.code;

          return (
            <div
              key={friend.code}
              className={clsx(
                'flex items-center justify-between gap-3 p-2.5 rounded-xl border transition-colors',
                isSameTrack
                  ? 'border-sc-orange/40 bg-sc-orange/[0.06]'
                  : 'border-sc-line bg-black/20 hover:border-white/10'
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="relative shrink-0">
                  {presence.avatarUrl ? (
                    <img
                      src={presence.avatarUrl}
                      alt={friend.name}
                      className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sc-orange to-purple-600 flex items-center justify-center text-xs font-bold text-white shadow-xs">
                      {friend.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span
                    className={clsx(
                      'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-sc-panel',
                      presence.online ? 'bg-emerald-500' : 'bg-neutral-500'
                    )}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-sc-fg truncate">{presence.name || friend.name}</span>
                    {isSameTrack && (
                      <span className="px-1.5 py-0.2 rounded-full bg-sc-orange/20 text-sc-orange text-[9px] font-bold">
                        Same track
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-sc-muted truncate">
                    <span className="text-sc-fg/80 truncate max-w-[140px] sm:max-w-[180px]">
                      {presence.track.title}
                    </span>
                    <span>•</span>
                    <span className="text-sc-dim truncate">{presence.track.artist}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] tabular-nums text-sc-dim">
                  {isPlaying ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Now
                    </span>
                  ) : (
                    formatTimeAgo(presence.timestamp || presence.lastSeen)
                  )}
                </span>

                {presence.online && (
                  isCoListening || isFollowing ? (
                    <button
                      type="button"
                      onClick={onStopSync}
                      className="px-2 py-1 rounded-lg bg-sc-orange text-sc-on-accent text-[10px] font-bold hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                      title="Listening together active — click to disconnect"
                    >
                      <Headphones className="w-3 h-3 animate-pulse" />
                      <span>Disconnect</span>
                    </button>
                  ) : isPending ? (
                    <button
                      type="button"
                      className="px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold flex items-center gap-1"
                      title="Invitation sent"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                      <span>Sent...</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRequestListenTogether ? onRequestListenTogether(friend.code) : onFollowFriend?.(friend.code)}
                      className="px-2 py-1 rounded-lg bg-sc-orange/15 hover:bg-sc-orange text-sc-orange hover:text-sc-on-accent text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 border border-sc-orange/30 hover:border-transparent"
                      title={`Request to listen together with ${friend.name}`}
                    >
                      <Headphones className="w-3 h-3" />
                      <span>Together</span>
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Full-screen "now playing" with large artwork and a full-width visualizer. */
function NowPlaying({
  p,
  onClose,
  eq,
  onEq,
  onOpenAdvanced,
  friends,
  presences,
  onFollowFriend,
  onRequestListenTogether,
  pendingOutgoingRequestTo,
  syncSession,
  onStopSync,
}: {
  p: Props;
  onClose: () => void;
  eq: number[];
  onEq: (g: number[]) => void;
  onOpenAdvanced: () => void;
  friends?: Friend[];
  presences?: Record<string, FriendPresence>;
  onFollowFriend?: (code: string) => void;
  onRequestListenTogether?: (code: string) => void;
  pendingOutgoingRequestTo?: string | null;
  syncSession?: SyncSession;
  onStopSync?: () => void;
}) {
  const artworkColor = useArtworkColor(p.track?.artwork, p.track?.id);
  const pct = p.duration > 0 ? Math.min(100, (p.currentTime / p.duration) * 100) : 0;
  const volumePct = p.muted ? 0 : p.volume * 100;
  const volumeWheel = useRef<HTMLDivElement>(null);
  useWheelVolume(volumeWheel, {
    muted: p.muted,
    volume: p.volume,
    onVolume: p.onVolume,
  });

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [karaokeMode, setKaraokeMode] = useState(() => {
    const saved = localStorage.getItem('sc_karaoke_fullscreen');
    return saved === null ? false : saved === 'true';
  });

  // Fullscreen Karaoke Synced Lyrics state
  const [karaokeLyrics, setKaraokeLyrics] = useState<Lyrics | null>(() =>
    p.track ? cachedLyrics(p.track) ?? null : null
  );
  const [karaokeLoading, setKaraokeLoading] = useState(false);
  const [karaokeFollow, setKaraokeFollow] = useState(true);
  const activeLineRef = useRef<HTMLLIElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!p.track) {
      setKaraokeLyrics(null);
      return;
    }
    const hit = cachedLyrics(p.track);
    if (hit !== undefined) {
      setKaraokeLyrics(hit);
      return;
    }
    let cancelled = false;
    setKaraokeLoading(true);
    fetchLyrics(p.track)
      .then((res) => {
        if (cancelled) return;
        rememberLyrics(p.track!.id, res);
        setKaraokeLyrics(res);
      })
      .catch(() => {
        if (cancelled) return;
        setKaraokeLyrics(null);
      })
      .finally(() => {
        if (!cancelled) setKaraokeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [p.track]);

  const activeIdx = useMemo(() => {
    if (!karaokeLyrics?.synced || !karaokeLyrics.lines.length) return -1;
    return activeLineIndex(karaokeLyrics.lines, p.currentTime);
  }, [karaokeLyrics, p.currentTime]);

  useEffect(() => {
    if (!karaokeMode || !karaokeFollow) return;
    const container = lyricsContainerRef.current;
    if (!container) return;
    if (activeIdx <= 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const node = activeLineRef.current;
    if (!node) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const relativeTop = nodeRect.top - containerRect.top + container.scrollTop;
    const target = relativeTop - container.clientHeight / 2 + node.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeIdx, karaokeMode, karaokeFollow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A new track has no thread on screen yet, so start closed rather than showing
  // another track's comments under a new title.
  useEffect(() => {
    setCommentsOpen(false);
  }, [p.track?.id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-sc-bg animate-fullscreen">
      <div
        className="absolute inset-0 -z-10 opacity-70 transition-opacity duration-500 pointer-events-none"
        style={{
          background: `radial-gradient(120% 90% at 50% 0%, hsla(${artworkColor.hue}, ${artworkColor.sat}%, ${artworkColor.light}%, 0.22), transparent 60%)`,
        }}
      />

      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-sc-muted">
            Now playing
          </div>
          {karaokeMode && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sc-orange/20 border border-sc-orange/40 text-[11px] font-bold uppercase tracking-wider text-sc-orange">
              <Mic2 className="w-3.5 h-3.5" />
              Lyrics
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setKaraokeMode((k) => {
                const next = !k;
                localStorage.setItem('sc_karaoke_fullscreen', String(next));
                return next;
              })
            }
            className={clsx(
              'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-[11px] font-bold transition-all duration-200 cursor-pointer shadow-xs',
              karaokeMode
                ? 'border-sc-orange bg-sc-orange text-white shadow-[0_0_15px_rgba(255,85,0,0.4)]'
                : 'border-sc-line text-sc-muted hover:text-sc-fg hover:border-sc-orange/50'
            )}
            title={karaokeMode ? 'Switch to standard view' : 'Show synchronized lyrics'}
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span>{karaokeMode ? 'Close Lyrics' : 'Lyrics'}</span>
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:bg-sc-fill/8 transition-colors cursor-pointer"
            aria-label="Close (Esc)"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {karaokeMode ? (
        /* Fullscreen Karaoke Mode */
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(320px,400px)_1fr] gap-8 lg:gap-14 px-6 lg:px-14 pb-8 pt-4 overflow-hidden">
          {/* Left: Album cover, track info and player controls */}
          <div className="flex flex-col justify-between min-h-0 py-2">
            <div className="space-y-4">
              <div className="max-w-[320px] aspect-square rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10 mx-auto md:mx-0">
                <Artwork
                  src={p.track?.artwork}
                  seed={p.track?.id}
                  size={500}
                  rounded="rounded-3xl"
                  className="w-full h-full"
                />
              </div>
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white line-clamp-2">
                  {p.track?.title ?? 'Nothing playing'}
                </h2>
                {p.track?.artist ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (p.track) {
                        onClose();
                        p.onOpenArtist?.({
                          id: p.track.artistId ?? '',
                          username: p.track.artist,
                          permalinkUrl: p.track.artistUrl,
                        });
                      }
                    }}
                    className="text-base font-semibold text-sc-orange-soft hover:underline cursor-pointer mt-1 truncate text-left block transition-colors"
                    title={`Open ${p.track.artist}`}
                  >
                    {p.track.artist}
                  </button>
                ) : null}
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-4 pt-4">
              {/* Scrubber */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] tabular-nums text-sc-muted w-10 text-right">
                  {fmt(p.currentTime)}
                </span>
                <div
                  className="relative flex-1 h-2 rounded-full bg-sc-fill/15 cursor-pointer group transition-all"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    p.onSeek(((e.clientX - r.left) / r.width) * p.duration);
                  }}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-sc-orange group-hover:brightness-110"
                    style={{ width: `${pct}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md scale-0 group-hover:scale-100 transition-transform"
                    style={{ left: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] tabular-nums text-sc-muted w-10">
                  {fmt(p.duration || p.track?.duration || 0)}
                </span>
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-between">
                <button
                  onClick={p.onShuffle}
                  className={clsx(
                    'w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-115 active:scale-90 cursor-pointer',
                    p.shuffle ? 'text-sc-orange-soft' : 'text-sc-muted hover:text-sc-fg'
                  )}
                  aria-label="Shuffle"
                >
                  <Shuffle className="w-4 h-4" />
                </button>
                <button
                  onClick={p.onPrev}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:scale-115 active:scale-90 cursor-pointer"
                  aria-label="Previous"
                >
                  <SkipBack className="w-5 h-5 fill-current" />
                </button>
                <button
                  onClick={p.onTogglePlay}
                  disabled={!p.track}
                  className="w-14 h-14 rounded-full bg-sc-orange text-white flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-xl cursor-pointer"
                  aria-label={p.isPlaying ? 'Pause' : 'Play'}
                >
                  {p.isBuffering ? (
                    <Loader2 className="w-6 h-6 animate-spin-slow" />
                  ) : p.isPlaying ? (
                    <Pause className="w-6 h-6 fill-current" />
                  ) : (
                    <Play className="w-6 h-6 fill-current translate-x-[1px]" />
                  )}
                </button>
                <button
                  onClick={p.onNext}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:scale-115 active:scale-90 cursor-pointer"
                  aria-label="Next"
                >
                  <SkipForward className="w-5 h-5 fill-current" />
                </button>
                <button
                  onClick={p.onRepeat}
                  className={clsx(
                    'w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-115 active:scale-90 cursor-pointer',
                    p.repeat === 'off' ? 'text-sc-muted hover:text-sc-fg' : 'text-sc-orange-soft'
                  )}
                  aria-label="Repeat"
                >
                  {p.repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
                </button>
                <button
                  onClick={p.onToggleLike}
                  className={clsx(
                    'w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-125 cursor-pointer',
                    p.liked ? 'text-sc-orange-soft' : 'text-sc-muted hover:text-sc-fg'
                  )}
                  aria-label="Like"
                >
                  <Heart className={clsx('w-5 h-5', p.liked && 'fill-sc-orange-soft')} />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Fullscreen Karaoke Synced Lyrics */}
          <div className="flex-1 min-h-0 flex flex-col relative rounded-3xl border border-white/10 bg-black/30 backdrop-blur-xl overflow-hidden p-6 lg:p-10 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-white/5 shrink-0">
              <span className="text-[12px] font-bold uppercase tracking-wider text-sc-muted flex items-center gap-2">
                <Music4 className="w-4 h-4 text-sc-orange" />
                {karaokeLyrics?.synced ? 'Synchronized Lyrics' : 'Lyrics'}
              </span>
              {karaokeLyrics?.synced && p.isPlaying && (
                <label className="flex items-center gap-2 text-[11px] font-medium text-sc-dim cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={karaokeFollow}
                    onChange={(e) => setKaraokeFollow(e.target.checked)}
                    className="accent-sc-orange cursor-pointer"
                  />
                  Auto-scroll
                </label>
              )}
            </div>

            <div
              ref={lyricsContainerRef}
              className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-rail"
            >
              {karaokeLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-sc-dim">
                  <Loader2 className="w-8 h-8 animate-spin text-sc-orange" />
                  <p className="text-sm font-semibold">Fetching lyrics from LRCLIB...</p>
                </div>
              ) : karaokeLyrics?.synced && karaokeLyrics.lines.length > 0 ? (
                <ul className="space-y-6 pt-6 pb-[40vh] px-4 sm:px-6">
                  {karaokeLyrics.lines.map((line, idx) => {
                    const isActive = idx === activeIdx;
                    const isPassed = idx < activeIdx;
                    return (
                      <li
                        key={`${line.time}-${idx}`}
                        ref={isActive ? activeLineRef : undefined}
                        onClick={() => p.onSeek(line.time)}
                        className={clsx(
                          'cursor-pointer transition-all duration-300 ease-out select-none leading-relaxed origin-left',
                          isActive
                            ? 'text-2xl sm:text-3xl lg:text-4xl font-extrabold text-sc-orange drop-shadow-[0_4px_25px_rgba(255,85,0,0.6)] scale-105 translate-x-2'
                            : isPassed
                            ? 'text-xl sm:text-2xl lg:text-3xl font-semibold text-white/30 hover:text-white/80 hover:translate-x-1'
                            : 'text-xl sm:text-2xl lg:text-3xl font-semibold text-white/45 hover:text-white/80 hover:translate-x-1'
                        )}
                        title="Click to jump to this line"
                      >
                        {line.text || <span className="opacity-40">♪ ♪ ♪</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : karaokeLyrics?.plain ? (
                <div className="py-8 max-w-2xl mx-auto">
                  <p className="text-xl sm:text-2xl font-semibold text-white/80 whitespace-pre-wrap leading-loose">
                    {karaokeLyrics.plain}
                  </p>
                </div>
              ) : karaokeLyrics?.instrumental ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <Music4 className="w-16 h-16 text-sc-orange/60 animate-pulse mb-4" />
                  <h3 className="text-2xl font-bold text-white">Instrumental Track</h3>
                  <p className="text-sm text-sc-muted mt-2">This track has no lyrics.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <Mic2 className="w-12 h-12 text-sc-dim mb-3 opacity-40" />
                  <h3 className="text-xl font-bold text-sc-fg">No lyrics available</h3>
                  <p className="text-xs text-sc-muted mt-1 max-w-sm">
                    No lyrics found for "{p.track?.title}".
                  </p>
                  <button
                    onClick={() => {
                      if (!p.track) return;
                      setKaraokeLoading(true);
                      fetchLyrics(p.track)
                        .then((res) => {
                          rememberLyrics(p.track!.id, res);
                          setKaraokeLyrics(res);
                        })
                        .finally(() => setKaraokeLoading(false));
                    }}
                    className="mt-4 px-4 py-2 rounded-full border border-sc-line text-xs font-semibold text-sc-muted hover:text-white hover:border-sc-orange transition-colors cursor-pointer"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] gap-10 px-6 lg:px-14 pb-6"
        >
        {/* Artwork with a music-reactive halo, the lyrics covering it, and the
            comment thread underneath. The thread is here rather than in an
            overlay: a slide-over covered the whole view and left nothing to look
            at while it was open. */}
        {/* `overflow-x-clip` is load-bearing: the bloom's halo sits at
            `inset: -22%`, so it deliberately spills outside the frame. Without an
            explicit clip, CSS resolves `overflow-x` to `auto` on a scroll
            container whose `overflow-y` is not `visible`, the halo becomes
            scrollable area, and the fullscreen view grows a horizontal scrollbar
            that scrolls nothing. */}
        <div
          className={clsx(
            'flex flex-col items-center min-h-0 overflow-hidden',
            commentsOpen ? 'justify-start gap-3' : 'justify-center gap-6'
          )}
        >
          <div
            className={clsx(
              'w-full flex items-center justify-center shrink-0 transition-all duration-300',
              commentsOpen
                ? 'max-w-[min(36vh,320px)]'
                : 'max-w-[min(87vh,720px)]'
            )}
          >
            <div className={clsx('w-full overflow-clip transition-all duration-300', commentsOpen ? 'p-[10%]' : 'p-[18%]')}>
              <div className="relative w-full">
                <AudioBloom
                  getFreq={p.getFreq}
                  active={p.isPlaying}
                  color={artworkColor}
                  className="relative w-full transition-all duration-300"
                >
                  <div className="relative aspect-square w-full">
                    <div className="relative z-10 w-full h-full rounded-3xl overflow-hidden shadow-2xl ring-1 ring-sc-fill/10">
                      {p.track ? (
                        <Artwork
                          src={p.track.artwork}
                          seed={p.track.id}
                          size={500}
                          rounded="rounded-3xl"
                          className="w-full h-full"
                        />
                      ) : (
                        <div className="w-full h-full bg-sc-panel-2 flex items-center justify-center text-sc-dim text-[13px]">
                          Nothing playing
                        </div>
                      )}
                    </div>
                  </div>
                </AudioBloom>

                {/* Draws its own chip on the artwork and covers the frame when
                    turned on. Mounted always, because whether a track has lyrics
                    is only knowable by asking. */}
                {p.track && (
                  <LyricsPanel
                    track={p.track}
                    currentTime={p.currentTime}
                    isPlaying={p.isPlaying}
                    onSeek={p.onSeek}
                    notify={p.notify ?? NOOP_NOTIFY}
                    cover
                  />
                )}
              </div>
            </div>
          </div>

          {commentsOpen && p.track && (
            <div className="w-full flex-1 min-h-0 max-w-[min(64vh,620px)] flex flex-col overflow-hidden animate-fade-in border-t border-white/10 pt-2">
              <TrackComments
                track={p.track}
                me={p.me ?? null}
                signedIn={p.signedIn ?? false}
                notify={p.notify ?? NOOP_NOTIFY}
                currentTime={p.currentTime}
                onSeekTo={p.onSeek}
                onOpenUser={p.onOpenArtist}
                onRequireSignIn={p.onRequireSignIn}
                hideHeader
                defaultOpen
                className="flex-1 min-h-0"
              />
            </div>
          )}
        </div>

        {/* Info + visualizer + controls. `my-auto` centres the block while it fits and
            degrades to a scrollable top-aligned column once lyrics push it past
            the window height - `justify-center` would clip the overflow instead. */}
        <div className="flex flex-col min-w-0 min-h-0 lg:overflow-y-auto overflow-x-clip scroll-rail">
          <div className="flex flex-col gap-5 lg:my-auto w-full">
          <div className="min-w-0">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight break-words">
              {p.track?.title ?? 'Nothing playing'}
            </h2>
            <div className="mt-2 flex items-center gap-2 text-[15px] text-sc-orange-soft">
              {p.track ? (
                <button
                  type="button"
                  onClick={() => {
                    if (p.track) {
                      onClose();
                      p.onOpenArtist?.({
                        id: p.track.artistId ?? '',
                        username: p.track.artist,
                        permalinkUrl: p.track.artistUrl,
                      });
                    }
                  }}
                  className="font-semibold hover:underline hover:text-sc-fg transition-colors text-left truncate cursor-pointer"
                  title={`Open ${p.track.artist}`}
                >
                  {p.track.artist}
                </button>
              ) : null}
              {p.track?.permalinkUrl && (
                <a
                  href={p.track.permalinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sc-muted hover:text-sc-fg transition-colors"
                  aria-label="Open on SoundCloud"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
            {p.track && (
              <div className="mt-3 flex items-center gap-4 text-[12px] text-sc-muted">
                {p.track.playsCount ? <span>{p.track.playsCount.toLocaleString()} plays</span> : null}
                {p.track.likesCount ? <span>{p.track.likesCount.toLocaleString()} likes</span> : null}
                {p.track.genre ? <span>{p.track.genre}</span> : null}
                <button
                  onClick={() => setCommentsOpen((v) => !v)}
                  aria-expanded={commentsOpen}
                  className={clsx(
                    'ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-colors cursor-pointer',
                    commentsOpen
                      ? 'border-sc-orange/60 text-sc-orange-soft bg-sc-orange/10'
                      : 'border-sc-line text-sc-muted hover:text-sc-fg hover:border-sc-orange/50'
                  )}
                  title={commentsOpen ? 'Hide comments' : 'Show comments for this track'}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Comments
                </button>
              </div>
            )}
          </div>

          {/* Friends who are currently or recently listening */}
          <FriendsListeningNow
            friends={friends}
            presences={presences}
            currentTrackId={p.track?.id}
            onFollowFriend={onFollowFriend}
            onRequestListenTogether={onRequestListenTogether}
            pendingOutgoingRequestTo={pendingOutgoingRequestTo}
            syncSession={syncSession}
            onStopSync={onStopSync}
          />

          {p.visualizer !== 'off' ? (
            <div className="rounded-2xl border border-sc-line bg-sc-panel/60 p-4 animate-fade-in space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-sc-muted">
                  Visualizer ({p.visualizer})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    p.onOpenSettings?.('visualizer');
                  }}
                  className="text-[12px] font-medium text-sc-orange hover:text-sc-orange-soft hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                  title="Configure visualizer in Settings"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  Settings
                </button>
              </div>
              <Spectrum
                getFreq={p.getFreq}
                active={p.isPlaying}
                bars={p.visualizerBars ?? (p.visualizer === 'bars' ? 48 : 72)}
                mode={p.visualizer}
                threshold={p.visualizerThreshold}
                sensitivity={p.visualizerSensitivity}
                smoothing={p.visualizerSmoothing}
                className="w-full h-24"
              />
            </div>
          ) : (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  p.onOpenSettings?.('visualizer');
                }}
                className="text-[12px] text-sc-muted hover:text-sc-fg flex items-center gap-1.5 cursor-pointer bg-sc-panel/60 border border-sc-line px-3 py-1.5 rounded-xl transition-colors hover:border-sc-orange/50"
                title="Configure visualizer in Settings"
              >
                <Sliders className="w-3.5 h-3.5" />
                Visualizer is off • Open settings
              </button>
            </div>
          )}

          {/* Seek */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] tabular-nums text-sc-muted w-11 text-right">
              {fmt(p.currentTime)}
            </span>
            <div
              className="relative flex-1 h-2 hover:h-3 rounded-full bg-sc-fill/10 cursor-pointer group transition-all duration-200 select-none"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                p.onSeek(((e.clientX - r.left) / r.width) * p.duration);
              }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sc-orange to-sc-orange-soft group-hover:brightness-110 shadow-xs"
                style={{ width: `${pct}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow-md scale-0 group-hover:scale-100 transition-transform duration-150 ease-out"
                style={{ left: `${pct}%` }}
              />
            </div>
            <span className="text-[12px] tabular-nums text-sc-muted w-11">
              {fmt(p.duration || p.track?.duration || 0)}
            </span>
          </div>

          {/* Transport */}
          <div className="flex items-center gap-3">
            <button
              onClick={p.onShuffle}
              className={clsx(
                'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-115 active:scale-85 cursor-pointer',
                p.shuffle ? 'text-sc-orange-soft' : 'text-sc-muted hover:text-sc-fg'
              )}
              aria-label="Shuffle"
            >
              <Shuffle className="w-4 h-4" />
            </button>
            <button
              onClick={p.onPrev}
              className="w-11 h-11 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:scale-115 active:scale-85 active:-translate-x-1.5 transition-all duration-150 cursor-pointer"
              aria-label="Previous"
            >
              <SkipBack className="w-6 h-6 fill-current" />
            </button>
            <button
              onClick={p.onTogglePlay}
              disabled={!p.track}
              className={clsx(
                'w-16 h-16 rounded-full bg-gradient-to-br from-sc-orange to-sc-orange-soft text-sc-on-accent flex items-center justify-center hover:scale-110 active:scale-90 transition-all duration-150 disabled:opacity-30 glow-accent shadow-xl cursor-pointer',
                p.isPlaying && 'animate-pulse-glow'
              )}
              aria-label={p.isPlaying ? 'Pause' : 'Play'}
            >
              {p.isBuffering ? (
                <Loader2 className="w-7 h-7 animate-spin-slow" />
              ) : p.isPlaying ? (
                <Pause className="w-7 h-7 fill-current" />
              ) : (
                <Play className="w-7 h-7 fill-current translate-x-[1px]" />
              )}
            </button>
            <button
              onClick={p.onNext}
              className="w-11 h-11 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:scale-115 active:scale-85 active:translate-x-1.5 transition-all duration-150 cursor-pointer"
              aria-label="Next"
            >
              <SkipForward className="w-6 h-6 fill-current" />
            </button>
            <button
              onClick={p.onRepeat}
              className={clsx(
                'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-115 active:scale-85 cursor-pointer',
                p.repeat === 'off' ? 'text-sc-muted hover:text-sc-fg' : 'text-sc-orange-soft'
              )}
              aria-label="Repeat"
            >
              {p.repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
            </button>
            <button
              onClick={p.onToggleLike}
              disabled={!p.track}
              className={clsx(
                'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-125 active:scale-75 disabled:opacity-30 cursor-pointer',
                p.liked ? 'text-sc-orange-soft' : 'text-sc-muted hover:text-sc-fg'
              )}
              aria-label="Like"
            >
              <Heart className={clsx('w-5 h-5', p.liked && 'fill-sc-orange-soft animate-heart-pop')} />
            </button>
            {p.track && p.renderPlaylistAction?.(p.track, true)}
            <button
              onClick={p.onDownload}
              disabled={!p.track || p.downloading}
              title={
                p.downloading
                  ? 'Downloading'
                  : 'Save this track to your Downloads folder'
              }
              className={clsx(
                'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110 disabled:opacity-30',
                p.downloading ? 'text-sc-orange-soft' : 'text-sc-muted hover:text-sc-fg'
              )}
              aria-label="Download"
              aria-busy={p.downloading}
            >
              {p.downloading ? (
                <Loader2 className="w-[18px] h-[18px] animate-spin-slow" />
              ) : (
                <Download className="w-[18px] h-[18px]" />
              )}
            </button>
            </div>

          {/* Volume */}
          <div className="flex items-center gap-4">
            <button
              onClick={p.onMute}
              className="w-9 h-9 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg transition-colors"
              aria-label="Mute"
            >
              {volumePct === 0 ? <VolumeX className="w-[18px] h-[18px]" /> : <Volume2 className="w-[18px] h-[18px]" />}
            </button>
            <div
              ref={volumeWheel}
              className="flex-1 h-10 flex items-center px-2 rounded-md hover:bg-sc-fill/5 transition-colors"
              title="Drag, click or scroll to change volume"
            >
              <Slider
                label="Volume"
                value={p.muted ? 0 : p.volume}
                max={1}
                onChange={p.onVolume}
                className="w-full"
              />
            </div>
            <span className="text-[11px] tabular-nums text-sc-muted w-8 text-right">
              {Math.round(volumePct)}
            </span>
          </div>

          <EqPanel eq={eq} onEq={onEq} bandCount={p.bandCount} onOpenAdvanced={onOpenAdvanced} wide />
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

/**
 * Speed and pitch popover.
 *
 * The rate is a discrete list rather than a free slider: the interesting values
 * are the familiar ones, and snapping to them means a saved setting can never
 * come back as an off-grid number after a reload. Pitch correction is its own
 * switch because leaving it on at 0.5x is what most people want, and at 2x is
 * the chipmunk effect.
 */
function RatePanel({
  rate,
  onRate,
  preservePitch,
  onPreservePitch,
  width,
}: {
  rate: number;
  onRate: (r: number) => void;
  preservePitch: boolean;
  onPreservePitch: (on: boolean) => void;
  width?: number;
}) {
  const nearestStep = (raw: number) =>
    RATE_STEPS.reduce((best, s) =>
      Math.abs(s - raw) < Math.abs(best - raw) ? s : best
    );

  const step = (dir: 1 | -1) => {
    // An off-list rate (a dragged slider that has not snapped yet) still has to
    // move one step from where it is, so it is compared against the nearest step
    // rather than resetting to 1x.
    const i = RATE_STEPS.indexOf(nearestStep(rate));
    const next = Math.min(RATE_STEPS.length - 1, Math.max(0, i + dir));
    onRate(RATE_STEPS[next]);
  };

  return (
    <div
      style={width ? { width } : undefined}
      className="rounded-2xl border border-sc-line bg-sc-panel p-4 shadow-2xl w-[340px]"
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[12px] font-bold text-sc-fg flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-sc-orange-soft" />
          Speed &amp; pitch
        </h4>
        <button
          onClick={() => onRate(1)}
          disabled={rate === 1}
          className="text-[10px] font-semibold text-sc-dim hover:text-sc-fg transition-colors disabled:opacity-40"
        >
          Reset
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => step(-1)}
          disabled={rate <= RATE_MIN}
          className="w-8 h-8 shrink-0 rounded-lg border border-sc-line text-sc-muted hover:text-sc-fg hover:bg-sc-fill/5 disabled:opacity-30 transition-colors text-[15px] leading-none"
          aria-label="Slower"
        >
          &minus;
        </button>
        <div className="flex-1 text-center">
          <span className="text-[22px] font-bold tabular-nums text-sc-fg">{formatRate(rate)}</span>
        </div>
        <button
          onClick={() => step(1)}
          disabled={rate >= RATE_MAX}
          className="w-8 h-8 shrink-0 rounded-lg border border-sc-line text-sc-muted hover:text-sc-fg hover:bg-sc-fill/5 disabled:opacity-30 transition-colors text-[15px] leading-none"
          aria-label="Faster"
        >
          +
        </button>
      </div>

      <Slider
        label="Playback speed"
        value={rate}
        max={RATE_MAX}
        // The slider is continuous; round to the nearest offered step.
        onChange={(ratio) => onRate(nearestStep(ratio * RATE_MAX))}
        className="w-full mb-4"
      />

      <div className="grid grid-cols-4 gap-1.5 mb-4">
        {[0.75, 1.25, 1.5, 2].map((r) => (
          <button
            key={r}
            onClick={() => onRate(r)}
            className={clsx(
              'py-1.5 rounded-lg text-[11px] font-semibold transition-colors border',
              Math.abs(rate - r) < 1e-6
                ? 'border-sc-orange/60 bg-sc-orange/15 text-sc-orange-soft'
                : 'border-sc-line text-sc-dim hover:text-sc-fg hover:bg-sc-fill/5'
            )}
          >
            {formatRate(r)}
          </button>
        ))}
      </div>

      <button
        onClick={() => onPreservePitch(!preservePitch)}
        role="switch"
        aria-checked={preservePitch}
        className={clsx(
          'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-colors text-left',
          preservePitch
            ? 'border-sc-orange/40 bg-sc-orange/[0.07]'
            : 'border-sc-line hover:bg-sc-fill/5'
        )}
      >
        <Mic2
          className={clsx('w-4 h-4 shrink-0', preservePitch ? 'text-sc-orange-soft' : 'text-sc-dim')}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-sc-fg">Correct pitch</span>
          <span className="block text-[10px] text-sc-dim truncate">
            {preservePitch ? 'Vocal stays in tune at any speed' : 'Pitch shifts with speed'}
          </span>
        </span>
        <span
          aria-hidden
          className={clsx(
            'w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors',
            preservePitch ? 'bg-sc-orange' : 'bg-sc-fill/20'
          )}
        >
          <span
            className={clsx(
              'block w-4 h-4 rounded-full bg-white transition-transform duration-200',
              preservePitch && 'translate-x-4'
            )}
          />
        </span>
      </button>
    </div>
  );
}

export function PlayerBar(p: Props) {
  const [eqOpen, setEqOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const pct = p.duration > 0 ? Math.min(100, (p.currentTime / p.duration) * 100) : 0;
  const volumePct = p.muted ? 0 : p.volume * 100;

  const openAdvanced = () => {
    // The response curve only lives in Settings, so both entry points close
    // themselves and hand over to the view.
    setEqOpen(false);
    setFullscreen(false);
    p.onOpenSettings?.('equalizer');
  };

  const eqRoot = useRef<HTMLDivElement>(null);
  const eqButton = useRef<HTMLButtonElement>(null);
  const eqWrap = useRef<HTMLDivElement>(null);
  const rateButton = useRef<HTMLButtonElement>(null);
  const rateWrap = useRef<HTMLDivElement>(null);
  const lyricsWrap = useRef<HTMLDivElement>(null);
  const lyricsButton = useRef<HTMLButtonElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const [barWidth, setBarWidth] = useState<number>(1200);

  useEffect(() => {
    if (!footerRef.current) return;
    let rafId = 0;
    const ro = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const width = entries[0]?.contentRect?.width;
        if (typeof width === 'number') {
          setBarWidth((prev) => (Math.abs(prev - width) < 8 ? prev : width));
        }
      });
    });
    ro.observe(footerRef.current);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  const isTight = Boolean(p.queueOpen && barWidth < 1050) || barWidth < 860;
  const isCompact = Boolean(p.queueOpen && barWidth < 900) || barWidth < 700;
  const isVeryCompact = Boolean(p.queueOpen && barWidth < 750) || barWidth < 540;

  /**
   * The popovers share one dismiss handler, so opening one has to close the
   * others.
   */
  const toggleEq = () => {
    setRateOpen(false);
    setEqOpen((v) => !v);
  };
  const toggleRate = () => {
    setEqOpen(false);
    setRateOpen((v) => !v);
  };

  const volumeWheel = useRef<HTMLDivElement>(null);
  useWheelVolume(volumeWheel, { muted: p.muted, volume: p.volume, onVolume: p.onVolume });

  /**
   * The popovers close on Escape or a click outside, and take focus back with them.
   */
  useEffect(() => {
    if (!eqOpen && !rateOpen && !lyricsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (lyricsOpen) {
        setLyricsOpen(false);
        lyricsButton.current?.focus();
        return;
      }
      if (rateOpen) {
        setRateOpen(false);
        rateButton.current?.focus();
        return;
      }
      setEqOpen(false);
      eqButton.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (lyricsOpen && !lyricsWrap.current?.contains(t) && !lyricsButton.current?.contains(t)) {
        setLyricsOpen(false);
      }
      if (rateOpen && !rateWrap.current?.contains(t) && !rateButton.current?.contains(t)) {
        setRateOpen(false);
      }
      if (eqOpen && !eqWrap.current?.contains(t) && !eqButton.current?.contains(t)) {
        setEqOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [eqOpen, rateOpen, lyricsOpen]);

  /**
   * The equalizer is worth a wider panel than the old fixed 420px. It is sized to
   * the window.
   */
  const [eqWidth, setEqWidth] = useState(420);
  useEffect(() => {
    let rafId = 0;
    const measure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const next = Math.min(560, Math.max(360, window.innerWidth - 48));
        setEqWidth((prev) => (Math.abs(prev - next) < 12 ? prev : next));
      });
    };
    measure();
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <>
      {fullscreen && (
        <NowPlaying
          p={p}
          onClose={() => setFullscreen(false)}
          eq={p.eq}
          onEq={p.onEq}
          onOpenAdvanced={openAdvanced}
          friends={p.friends}
          presences={p.presences}
          onFollowFriend={p.onFollowFriend}
          onRequestListenTogether={p.onRequestListenTogether}
          pendingOutgoingRequestTo={p.pendingOutgoingRequestTo}
          syncSession={p.syncSession}
          onStopSync={p.onStopSync}
        />
      )}

      {/* Synced Karaoke Lyrics Floating Drawer */}
      <div ref={lyricsWrap}>
        {lyricsOpen && !fullscreen && (
          <div
            role="dialog"
            aria-label="Tekst utworu"
            className="fixed bottom-24 right-4 sm:right-6 w-[390px] max-w-[calc(100vw-32px)] h-[520px] max-h-[75vh] rounded-3xl border border-white/10 bg-sc-panel/95 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.65)] flex flex-col overflow-hidden animate-popover z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-sc-line/50 bg-sc-panel-2/40 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-sc-orange/15 text-sc-orange flex items-center justify-center shrink-0">
                  <Mic2 className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-[12px] font-bold text-sc-fg truncate">
                    {p.track ? p.track.title : 'Tekst utworu'}
                  </h4>
                  {p.track ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!p.track) return;
                        setLyricsOpen(false);
                        p.onOpenArtist?.({
                          id: p.track.artistId ?? '',
                          username: p.track.artist,
                          permalinkUrl: p.track.artistUrl,
                        });
                      }}
                      className="text-[10px] text-sc-muted hover:text-sc-orange hover:underline cursor-pointer truncate text-left block transition-colors"
                      title={`Open ${p.track.artist}`}
                    >
                      {p.track.artist} · Synced Lyrics
                    </button>
                  ) : (
                    <p className="text-[10px] text-sc-muted truncate">LRCLIB Synced Lyrics</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLyricsOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-fg hover:bg-sc-fill/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
              {p.track ? (
                <LyricsPanel
                  track={p.track}
                  currentTime={p.currentTime}
                  isPlaying={p.isPlaying}
                  onSeek={p.onSeek}
                  notify={p.notify ?? NOOP_NOTIFY}
                  inline
                  defaultOpen
                  maxHeightClass="flex-1 min-h-0"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-sc-dim text-[12px]">
                  Brak odtwarzanego utworu
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <footer ref={footerRef} className="relative z-20 shrink-0 border-t border-white/[0.08] backdrop-blur-2xl bg-sc-panel/70 shadow-[0_-12px_45px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div ref={eqWrap}>
          {eqOpen && !fullscreen && (
            <div
              ref={eqRoot}
              role="dialog"
              aria-label="Equalizer"
              style={{ width: eqWidth, ['--sc-pop-origin' as string]: 'bottom right' }}
              className="absolute bottom-full right-4 mb-2 animate-popover"
            >
              <EqPanel
                eq={p.eq}
                onEq={p.onEq}
                bandCount={p.bandCount}
                onOpenAdvanced={openAdvanced}
                width={eqWidth}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 h-[88px] overflow-hidden">
          {/* Track info */}
          <div
            className={clsx(
              'flex items-center gap-2.5 sm:gap-3 min-w-0 transition-all duration-200',
              isCompact
                ? 'w-[160px] sm:w-[190px] shrink-0'
                : isTight
                  ? 'w-[210px] sm:w-[240px] shrink-0'
                  : 'w-[280px] sm:w-[320px] lg:w-[360px] shrink-0'
            )}
          >
            {p.track ? (
              <>
                <button
                  onClick={() => setFullscreen(true)}
                  className={clsx(
                    'relative rounded-xl overflow-hidden bg-sc-panel-2 shrink-0 group transition-all duration-300 hover:scale-105 active:scale-95 shadow-[0_4px_16px_rgba(0,0,0,0.4)] hover:shadow-[0_8px_24px_rgba(var(--sc-accent-rgb,109,94,252),0.3)] cursor-pointer ring-1 ring-white/10',
                    isCompact ? 'w-11 h-11' : 'w-14 h-14'
                  )}
                  aria-label="Open now playing"
                  title="Open now playing"
                >
                  <Artwork src={p.track.artwork} seed={p.track.id} size={200} className="w-full h-full transition-transform duration-500 ease-out group-hover:scale-110" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-xs">
                    <Maximize2 className="w-4 h-4 text-white" />
                  </div>
                </button>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={clsx(
                        'font-bold text-sc-fg truncate block',
                        isCompact ? 'text-[12.5px]' : 'text-[13.5px]'
                      )}
                      title={p.track.title}
                    >
                      {p.track.title}
                    </span>
                    {p.isPlaying && (
                      <div className="flex items-end gap-0.5 h-3 shrink-0 ml-0.5" title="Playing">
                        <span className="w-0.5 bg-sc-orange rounded-full animate-eq-1" />
                        <span className="w-0.5 bg-sc-orange rounded-full animate-eq-2" />
                        <span className="w-0.5 bg-sc-orange rounded-full animate-eq-3" />
                      </div>
                    )}
                  </div>
                  <div className="truncate mt-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (p.track) {
                          p.onOpenArtist?.({
                            id: p.track.artistId ?? '',
                            username: p.track.artist,
                            permalinkUrl: p.track.artistUrl,
                          });
                        }
                      }}
                      className="text-[11.5px] sm:text-[12px] font-medium text-sc-muted hover:text-sc-orange hover:underline transition-colors truncate inline-block max-w-full text-left cursor-pointer"
                      title={`Open ${p.track.artist}`}
                    >
                      {p.track.artist}
                    </button>
                  </div>
                </div>
                <button
                  onClick={p.onToggleLike}
                  className={clsx(
                    'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 shrink-0 hover:scale-125 active:scale-75 cursor-pointer',
                    p.liked ? 'text-sc-orange-soft animate-heart-pop' : 'text-sc-muted hover:text-sc-fg'
                  )}
                  aria-label="Like"
                  title={p.liked ? 'Unlike' : 'Like'}
                >
                  <Heart className={clsx('w-[17px] h-[17px] transition-transform duration-200', p.liked && 'fill-sc-orange-soft')} />
                </button>
                {!isTight && (
                  <div className="hidden sm:flex items-center gap-0.5 shrink-0">
                    {p.renderPlaylistAction?.(p.track, true)}
                    <a
                      href={p.track.permalinkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-fg transition-all duration-150 hover:scale-115 active:scale-85 shrink-0"
                      aria-label="Open on SoundCloud"
                      title="Open on SoundCloud"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </>
            ) : (
              <div className="text-[13px] text-sc-dim">Nothing playing</div>
            )}
          </div>

          {/* Controls */}
          <div className="flex-1 flex flex-col items-center gap-1 sm:gap-1.5 min-w-0 px-1 sm:px-2">
            <div className="flex items-center gap-0.5 sm:gap-1">
              {!isTight && (
                <button
                  onClick={p.onShuffle}
                  className={clsx(
                    'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-115 active:scale-90 cursor-pointer',
                    p.shuffle ? 'text-sc-orange-soft' : 'text-sc-muted hover:text-sc-fg'
                  )}
                  aria-label="Shuffle"
                  title="Shuffle"
                >
                  <Shuffle className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={p.onPrev}
                className="w-8 sm:w-9 h-8 sm:h-9 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:scale-115 active:scale-85 active:-translate-x-1 transition-all duration-150 cursor-pointer"
                aria-label="Previous"
                title="Previous"
              >
                <SkipBack className="w-[17px] h-[17px] sm:w-[18px] sm:h-[18px] fill-current" />
              </button>
              <button
                onClick={p.onTogglePlay}
                disabled={!p.track}
                className={clsx(
                  'w-10 sm:w-11 h-10 sm:h-11 rounded-full bg-gradient-to-br from-sc-orange to-sc-orange-soft text-sc-on-accent flex items-center justify-center hover:scale-110 active:scale-90 transition-all duration-200 disabled:opacity-30 cursor-pointer',
                  p.isPlaying && 'animate-pulse-glow'
                )}
                aria-label={p.isPlaying ? 'Pause' : 'Play'}
                title={p.isPlaying ? 'Pause' : 'Play'}
              >
                {p.isBuffering ? (
                  <Loader2 className="w-5 h-5 animate-spin-slow" />
                ) : p.isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current translate-x-[1px]" />
                )}
              </button>
              <button
                onClick={p.onNext}
                className="w-8 sm:w-9 h-8 sm:h-9 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:scale-110 active:scale-85 active:translate-x-1 transition-all duration-150 cursor-pointer"
                aria-label="Next"
                title="Next"
              >
                <SkipForward className="w-[17px] h-[17px] sm:w-[18px] sm:h-[18px] fill-current" />
              </button>
              {!isTight && (
                <button
                  onClick={p.onRepeat}
                  className={clsx(
                    'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-115 active:scale-90 relative cursor-pointer',
                    p.repeat === 'off' ? 'text-sc-muted hover:text-sc-fg' : 'text-sc-orange-soft'
                  )}
                  aria-label="Repeat"
                  title="Repeat"
                >
                  {p.repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
                </button>
              )}
            </div>

            {/* Scrubber */}
            <div className="w-full max-w-[560px] flex items-center gap-1.5 sm:gap-2.5 min-w-0">
              <span className={clsx("tabular-nums text-sc-dim text-right shrink-0", isVeryCompact ? "text-[10px] w-7" : "text-[11px] w-9")}>
                {fmt(p.currentTime)}
              </span>
              <div
                className="relative flex-1 h-1.5 hover:h-2 rounded-full bg-sc-fill/10 group cursor-pointer transition-all duration-200 min-w-[40px]"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  p.onSeek(((e.clientX - r.left) / r.width) * p.duration);
                }}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sc-orange to-sc-orange-soft transition-all duration-75"
                  style={{ width: `${pct}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md scale-0 group-hover:scale-100 transition-transform duration-200"
                  style={{ left: `${pct}%` }}
                />
              </div>
              <span className={clsx("tabular-nums text-sc-dim shrink-0", isVeryCompact ? "text-[10px] w-7" : "text-[11px] w-9")}>
                {fmt(p.duration || p.track?.duration || 0)}
              </span>
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-0.5 sm:gap-1.5 justify-end shrink-0">
            <button
              onClick={p.onOpenQueue}
              className={clsx(
                'relative w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-115 active:scale-90 cursor-pointer',
                p.queueOpen
                  ? 'text-sc-orange bg-sc-orange/15 shadow-xs ring-1 ring-sc-orange/40'
                  : 'text-sc-muted hover:text-sc-fg'
              )}
              title={p.queueOpen ? 'Close queue' : 'Open queue'}
              aria-label="Queue"
            >
              <ListMusic className="w-[17px] h-[17px]" />
              {p.queue.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-sc-orange text-[9px] font-bold flex items-center justify-center text-sc-fg animate-scale-in">
                  {p.queue.length}
                </span>
              )}
            </button>

            {/* Friends & Activity Button */}
            {p.onOpenFriends && (p.isSyncActive || !isTight) && (
              <button
                onClick={p.onOpenFriends}
                className={clsx(
                  'relative w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-115 active:scale-90 cursor-pointer',
                  p.isSyncActive
                    ? 'text-sc-orange bg-sc-orange/15 shadow-xs ring-1 ring-sc-orange/40'
                    : 'text-sc-muted hover:text-sc-fg'
                )}
                title={p.isSyncActive ? `Listening with ${p.syncTargetName || 'friend'}` : 'Friends & Activity'}
                aria-label="Friends"
              >
                <Users className="w-[17px] h-[17px]" />
                {p.isSyncActive && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-sc-orange animate-ping" />
                )}
              </button>
            )}

            {/* Karaoke Synced Lyrics Button */}
            {(lyricsOpen || !isCompact) && (
              <button
                ref={lyricsButton}
                onClick={() => setLyricsOpen((v) => !v)}
                className={clsx(
                  'relative w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-115 active:scale-90 cursor-pointer',
                  lyricsOpen
                    ? 'text-sc-orange-soft bg-sc-orange/15 shadow-xs'
                    : 'text-sc-muted hover:text-sc-fg'
                )}
                title="Tekst utworu (Synced Lyrics)"
                aria-label="Tekst utworu"
              >
                <Mic2 className="w-[17px] h-[17px]" />
              </button>
            )}

            {/* Track Radio button */}
            {p.onStartRadio && p.track && (
              <button
                onClick={() => p.onStartRadio?.(p.track!)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-sc-muted hover:text-cyan-400 transition-all duration-150 hover:scale-115 active:scale-90 cursor-pointer"
                title="Radio utworu (Track Radio)"
                aria-label="Radio utworu"
              >
                <Radio className="w-[17px] h-[17px]" />
              </button>
            )}

            {/* Speed & pitch button */}
            {(rateOpen || p.rate !== 1 || !isTight) && (
              <div ref={rateWrap}>
                {rateOpen && !fullscreen && (
                  <div
                    role="dialog"
                    aria-label="Speed and pitch"
                    style={{ ['--sc-pop-origin' as string]: 'bottom right' }}
                    className="absolute bottom-full right-4 mb-2 animate-popover"
                  >
                    <RatePanel
                      rate={p.rate}
                      onRate={p.onRate}
                      preservePitch={p.preservePitch}
                      onPreservePitch={p.onPreservePitch}
                      width={340}
                    />
                  </div>
                )}
                <button
                  ref={rateButton}
                  onClick={toggleRate}
                  className={clsx(
                    'relative w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-115 active:scale-90 cursor-pointer',
                    rateOpen || p.rate !== 1
                      ? 'text-sc-orange-soft bg-sc-orange/10'
                      : 'text-sc-muted hover:text-sc-fg'
                  )}
                  title={`Speed ${formatRate(p.rate)}${
                    p.preservePitch ? ' (pitch corrected)' : ' (pitch shifted)'
                  }`}
                  aria-label="Speed and pitch"
                  aria-expanded={rateOpen}
                  aria-haspopup="dialog"
                >
                  <Gauge className="w-[17px] h-[17px]" />
                  {p.rate !== 1 && (
                    <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full bg-sc-orange text-[8px] font-bold flex items-center justify-center text-sc-on-accent">
                      {formatRate(p.rate)}
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* Equalizer button */}
            {(eqOpen || !isTight) && (
              <button
                ref={eqButton}
                onClick={toggleEq}
                className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-115 active:scale-90 cursor-pointer',
                  eqOpen ? 'text-sc-orange-soft bg-sc-orange/10' : 'text-sc-muted hover:text-sc-fg'
                )}
                aria-label="Equalizer"
                aria-expanded={eqOpen}
                aria-haspopup="dialog"
                title="Equalizer"
              >
                <Sliders className="w-[17px] h-[17px]" />
              </button>
            )}

            {/* Mute button */}
            <button
              onClick={p.onMute}
              className="w-8 h-8 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg transition-all duration-150 hover:scale-115 active:scale-90 cursor-pointer"
              aria-label="Mute"
              title={volumePct === 0 ? 'Unmute' : 'Mute'}
            >
              {volumePct === 0 ? <VolumeX className="w-[18px] h-[18px]" /> : <Volume2 className="w-[18px] h-[18px]" />}
            </button>

            {/* Volume slider */}
            <div
              ref={volumeWheel}
              className={clsx(
                'px-1.5 py-1 rounded-md hover:bg-sc-fill/5 transition-colors',
                isCompact ? 'w-16 sm:w-20' : 'w-24 lg:w-28'
              )}
              title="Drag, click or scroll to change volume"
            >
              <Slider
                label="Volume"
                value={p.muted ? 0 : p.volume}
                max={1}
                onChange={p.onVolume}
                className="w-full"
              />
            </div>

            {/* Volume percentage */}
            {!isTight && (
              <span className="text-[11px] tabular-nums text-sc-muted w-8 text-right">
                {Math.round(volumePct)}
              </span>
            )}

            {/* Fullscreen button */}
            {!isCompact && (
              <button
                onClick={() => setFullscreen(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-115 active:scale-90 text-sc-muted hover:text-sc-fg cursor-pointer"
                aria-label="Full screen now playing"
                title="Full screen now playing"
              >
                <Maximize2 className="w-[17px] h-[17px]" />
              </button>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}

export { ACCENT, ACCENT_SOFT, Minimize2, EqBars };
