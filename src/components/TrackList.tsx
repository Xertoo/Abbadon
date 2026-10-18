import { useEffect } from 'react';
import { Play, Heart, MoreHorizontal, Plus, Compass, Eye, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import type { Track } from '../types';
import { EqBars } from './Visualizer';
import { isSoundCloudTrack } from '../lib/audius';
import { resolveStreamUrls } from '../lib/soundcloud';

interface Props {
  tracks: Track[];
  likedIds: string[];
  playingId: string | null;
  isPlaying: boolean;
  onPlay: (track: Track, queue: Track[]) => void;
  onToggleLike: (track: Track) => void;
  /** Receives the artist id when the track carries one, so the artist page
   *  is opened directly instead of re-resolving an ambiguous username. */
  onOpenArtist?: (artist: { id: string; username: string; permalinkUrl?: string }) => void;
  /** Shows a compass button that seeds the "Find similar" view. */
  onFindSimilar?: (track: Track) => void;
  numbered?: boolean;
  showArtwork?: boolean;
  /** Tighter rows, from Settings. Fits roughly a third more tracks per screen. */
  compact?: boolean;
  /**
   * Extra controls rendered at the end of each row.
   *
   * Views pass their own actions instead of TrackList growing a prop per
   * feature. Keep the returned nodes self-contained: each one has to call
   * `e.stopPropagation()` itself, because the row itself is clickable.
   */
  renderActions?: (track: Track) => React.ReactNode;
}

/** Abbreviates a play count. Named `abbreviate` so it does not collide with the
 *  `compact` prop once rows got a density toggle. */
function abbreviate(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TrackRow({
  track,
  index,
  queue,
  liked,
  playing,
  onPlay,
  onToggleLike,
  onOpenArtist,
  onFindSimilar,
  showArtwork = true,
  compact,
  actions,
}: {
  track: Track;
  index: number;
  queue: Track[];
  liked: boolean;
  playing: boolean;
  onPlay: (track: Track, queue: Track[]) => void;
  onToggleLike: (track: Track) => void;
  onOpenArtist?: (artist: { id: string; username: string; permalinkUrl?: string }) => void;
  onFindSimilar?: (track: Track) => void;
  showArtwork?: boolean;
  compact?: boolean;
  actions?: React.ReactNode;
}) {
  // Liking and artist pages are SoundCloud-account features; material from the
  // open catalog keeps the byline plain and leaves the like out entirely.
  const soundCloud = isSoundCloudTrack(track);
  return (
    <div
      onDoubleClick={() => onPlay(track, queue)}
      onClick={() => onPlay(track, queue)}
      onMouseEnter={() => {
        void resolveStreamUrls(track.id).catch(() => {});
      }}
      className={clsx(
        'group grid items-center gap-3.5 px-3.5 sm:px-4.5 rounded-2xl transition-all duration-300 cursor-default select-none animate-row-cascade border border-transparent backdrop-blur-xs',
        // Compact drops the vertical padding and the genre, which is what made
        // rows tall enough that only a handful were visible at once.
        compact ? 'py-1.5' : 'py-2.5',
        playing
          ? 'bg-sc-orange/12 border-sc-orange/30 shadow-[0_4px_20px_rgba(var(--sc-accent-rgb,109,94,252),0.15)] translate-x-1.5'
          : 'hover:bg-white/[0.045] hover:border-white/[0.06] hover:translate-x-1 hover:shadow-md'
      )}
      style={{ gridTemplateColumns: '1.75rem 1fr auto', ['--row-idx' as string]: index }}
    >
      {/* Index / play button */}
      <div className="relative w-7 h-7 flex items-center justify-center">
        <span
          className={clsx(
            'text-[12px] tabular-nums transition-opacity',
            playing ? 'opacity-0' : 'opacity-100 group-hover:opacity-0 text-sc-dim'
          )}
        >
          {index + 1}
        </span>
        {playing && (
          <span className="absolute inset-0 flex items-center justify-center">
            <EqBars color="var(--color-sc-orange, #ff5500)" size={13} />
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(track, queue);
          }}
          className={clsx(
            'absolute inset-0 rounded-full bg-sc-orange items-center justify-center transition-all duration-200 hover:scale-115 active:scale-85 shadow-md',
            playing ? 'flex scale-100' : 'hidden group-hover:flex animate-scale-in'
          )}
        >
          <Play className="w-3 h-3 fill-white translate-x-[0.5px]" />
        </button>
      </div>

      {/* Main */}
      <div className="flex items-center gap-3 min-w-0">
        {showArtwork && (
          <div
            className={clsx(
              'rounded-xl overflow-hidden bg-sc-panel-2 shrink-0 relative transition-all shadow-sm ring-1 ring-white/5',
              compact ? 'w-8 h-8' : 'w-10 h-10'
            )}
          >
            <Artwork
              src={track.artwork}
              seed={track.id}
              size={67}
              rounded="rounded-xl"
              className="w-full h-full transition-transform duration-300 group-hover:scale-105"
            />
            {playing && <div className="absolute inset-0 bg-black/40" />}
          </div>
        )}
        <div className="min-w-0">
          <div
            className={clsx(
              'text-[13px] font-semibold truncate transition-colors cursor-pointer',
              playing ? 'text-sc-orange' : 'text-sc-fg group-hover:text-sc-fg'
            )}
            onClick={(e) => {
              e.stopPropagation();
              onPlay(track, queue);
            }}
          >
            {track.title}
          </div>
          {/*
            The byline always goes to creator, except when clicking on the track title above.
          */}
          <div className="flex items-center gap-2 text-[12px] text-sc-muted truncate">
            {soundCloud && onOpenArtist ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenArtist({ id: track.artistId ?? '', username: track.artist, permalinkUrl: track.artistUrl });
                }}
                className="max-w-fit inline-block truncate hover:text-sc-orange hover:underline transition-colors text-left cursor-pointer"
                title={`Open ${track.artist}`}
              >
                {track.artist}
              </button>
            ) : (
              <span className="truncate">{track.artist}</span>
            )}
            {!compact && track.genre && (
              <>
                <span className="text-sc-dim">·</span>
                <span className="truncate hidden sm:inline">{track.genre}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        <div className="hidden sm:flex items-center gap-2 text-[11px] tabular-nums text-sc-dim">
          {track.playsCount !== undefined && track.playsCount > 0 ? (
            <span
              title={`${track.playsCount.toLocaleString()} plays`}
              className="inline-flex items-center gap-1 hover:text-sc-fg transition-colors"
            >
              <Play className="w-2.5 h-2.5 fill-current opacity-60" />
              {abbreviate(track.playsCount)}
            </span>
          ) : null}
          {track.likesCount !== undefined && track.likesCount > 0 ? (
            <span
              title={`${track.likesCount.toLocaleString()} likes`}
              className="hidden lg:inline-flex items-center gap-1 text-sc-dim/70 hover:text-sc-fg transition-colors"
            >
              <Heart className="w-2.5 h-2.5 fill-current opacity-60" />
              {abbreviate(track.likesCount)}
            </span>
          ) : null}
        </div>
        {soundCloud && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleLike(track);
            }}
            className={clsx(
              'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-125 active:scale-75 cursor-pointer',
              liked
                ? 'text-sc-orange opacity-100'
                : 'text-sc-dim opacity-0 group-hover:opacity-100 hover:text-sc-fg'
            )}
          >
            <Heart className={clsx('w-[15px] h-[15px]', liked && 'fill-sc-orange animate-heart-pop')} />
          </button>
        )}
        {onFindSimilar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFindSimilar(track);
            }}
            title="Find tracks like this one"
            aria-label="Find similar"
            className="w-8 h-8 rounded-full flex items-center justify-center text-sc-dim opacity-0 group-hover:opacity-100 hover:text-sc-orange hover:scale-125 active:scale-75 hover:rotate-45 transition-all duration-200 cursor-pointer"
          >
            <Compass className="w-[15px] h-[15px]" />
          </button>
        )}
        <span
          className="text-[12px] tabular-nums text-sc-muted w-9 text-right"
          title={
            track.previewOnly
              ? 'SoundCloud Go+ track - 30 second preview only'
              : undefined
          }
        >
          {track.durationFormatted}
        </span>
        {/* SoundCloud Go+ track unblocked via yt-dlp official studio audio pipeline */}
        {track.previewOnly && (
          <span
            title="SoundCloud Go+ · Odblokowano oficjalny utwór HQ Studio (yt-dlp)"
            aria-label="Odblokowany utwór Go+ HQ"
            className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-purple-500/20 border border-amber-500/40 text-amber-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-xs shrink-0 select-none cursor-help"
          >
            <Sparkles className="w-2.5 h-2.5 text-amber-300 animate-pulse" />
            HQ Studio
          </span>
        )}
        {/* Row actions sit after the duration so they never shift the play
            count and duration columns that are aligned across rows. */}
        {actions}
      </div>
    </div>
  );
}

export function TrackList(props: Props) {
  useEffect(() => {
    if (!props.tracks || props.tracks.length === 0) return;
    const toWarm = props.tracks.slice(0, 4);
    const timers: number[] = [];
    toWarm.forEach((t, i) => {
      const timer = window.setTimeout(() => {
        void resolveStreamUrls(t.id).catch(() => {});
      }, 350 * (i + 1));
      timers.push(timer);
    });
    return () => timers.forEach((tm) => window.clearTimeout(tm));
  }, [props.tracks]);

  if (props.tracks.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[13px] text-sc-muted">Nothing here yet</p>
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      {props.tracks.map((t, i) => (
        <TrackRow
          /**
           * The index is part of the key on purpose.
           *
           * `t.id` alone collides when a playlist holds the same track twice or
           * when a row has no id, and React reacts to duplicate keys by
           * silently dropping rows — but only when the order *changes*. That is
           * why the unsorted view looked complete while the sorted one was a
           * track short. A composite key keeps every row stable and distinct.
           */
          key={`${t.id}-${i}`}
          track={t}
          index={i}
          queue={props.tracks}
          liked={props.likedIds.includes(t.id)}
          playing={props.playingId === t.id}
          onPlay={props.onPlay}
          onToggleLike={props.onToggleLike}
          onOpenArtist={props.onOpenArtist}
          onFindSimilar={props.onFindSimilar}
          showArtwork={props.showArtwork}
          compact={props.compact}
          actions={props.renderActions?.(t)}
        />
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 8, compact }: { count?: number; compact?: boolean }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={clsx('flex items-center gap-3 px-4', compact ? 'py-1' : 'py-2')}>
          <div className="w-7 h-7 rounded skeleton" />
          <div className={clsx('rounded-md skeleton', compact ? 'w-8 h-8' : 'w-10 h-10')} />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 rounded skeleton w-1/3" />
            <div className="h-2 rounded skeleton w-1/5" />
          </div>
          <div className="h-2.5 rounded skeleton w-8" />
        </div>
      ))}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-3">
      <div>
        <h2 className="flex items-center gap-2 text-[17px] font-bold text-sc-fg tracking-tight">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="text-[12px] text-sc-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export { Plus, MoreHorizontal, Eye };