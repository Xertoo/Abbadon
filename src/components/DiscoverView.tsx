import { useState, useRef, useEffect } from 'react';
import { Play, Heart, Compass, Sparkles, Flame, Music2, RotateCcw, ListPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import type { Track, DiscoverSection } from '../types';
import { SectionHeader, SkeletonRows } from './TrackList';

interface Props {
  sections: DiscoverSection[];
  loading: boolean;
  likedIds: string[];
  playingId: string | null;
  isPlaying: boolean;
  onPlay: (t: Track, q: Track[]) => void;
  onToggleLike: (t: Track) => void;
  onOpenArtist: (u: { id: string; username: string; permalinkUrl?: string }) => void;
  onFindSimilar: (seed: Track) => void;
  onRefresh: () => void;
  renderActions?: (track: Track) => React.ReactNode;
}

/** Picks a rail icon from the section id, which encodes where it came from. */
function railIcon(id: string): React.ReactNode {
  if (id === 'foryou') return <Sparkles className="w-[18px] h-[18px] text-sc-orange" />;
  if (id === 'trending') return <Flame className="w-[18px] h-[18px] text-sc-orange" />;
  if (id.startsWith('seed:')) return <Play className="w-[18px] h-[18px] text-sc-orange" />;
  if (id.startsWith('genre:')) return <Music2 className="w-[18px] h-[18px] text-sc-orange" />;
  return <Compass className="w-[18px] h-[18px] text-sc-orange" />;
}

/**
 * A single card in a rail.
 *
 * Only the artwork is a click target for playback: the like and playlist
 * buttons sit on top of it and would otherwise fight the play handler for the
 * same click.
 */
function RailCard({
  track,
  playing,
  liked,
  onPlay,
  onToggleLike,
  onOpenArtist,
  onFindSimilar,
  renderActions,
}: {
  track: Track;
  playing: boolean;
  liked: boolean;
  onPlay: () => void;
  onToggleLike: () => void;
  onOpenArtist: () => void;
  onFindSimilar: () => void;
  renderActions?: (track: Track) => React.ReactNode;
}) {
  return (
    <div className="group flex flex-col text-left select-none">
      <div className="relative aspect-square rounded-xl overflow-hidden bg-sc-panel-2 shadow-inner">
        <Artwork
          src={track.artwork}
          seed={track.id}
          size={200}
          className="w-full h-full transition-transform duration-500 ease-out group-hover:scale-108"
        />
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play ${track.title}`}
          className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        >
          <span className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shadow-xl scale-90 group-hover:scale-100 transition-transform">
            <Play className="w-4 h-4 fill-current translate-x-[1px]" />
          </span>
        </button>

        {playing && (
          <span className="absolute top-2 left-2 rounded-full bg-black/75 backdrop-blur-xs px-2 py-0.5 text-[9px] font-extrabold tracking-wider text-sc-orange flex items-center gap-1 shadow-md">
            <span className="w-1.5 h-1.5 rounded-full bg-sc-orange animate-ping" />
            PLAYING
          </span>
        )}

        <button
          type="button"
          onClick={onToggleLike}
          aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
          aria-pressed={liked}
          className={clsx(
            'absolute bottom-2 left-2 w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 active:scale-90 cursor-pointer',
            liked
              ? 'bg-sc-orange text-white opacity-100'
              : 'bg-black/60 text-white/90 opacity-0 group-hover:opacity-100 hover:scale-110'
          )}
        >
          <Heart className={clsx('w-3.5 h-3.5', liked && 'fill-current')} />
        </button>

        {renderActions && (
          <div
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {renderActions(track)}
          </div>
        )}
      </div>

      <div title={track.title} className="mt-2 text-[12.5px] font-semibold text-sc-fg truncate">
        {track.title}
      </div>
      <button
        type="button"
        onClick={onOpenArtist}
        title={`Open ${track.artist}`}
        className="mt-0.5 text-[11.5px] text-sc-muted hover:text-sc-orange hover:underline transition-colors truncate text-left cursor-pointer"
      >
        {track.artist}
      </button>
      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-sc-faint">
        <span>{track.durationFormatted || ''}</span>
        <button
          type="button"
          onClick={onFindSimilar}
          title={`Find tracks like ${track.title}`}
          aria-label={`Find similar to ${track.title}`}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-sc-dim hover:text-sc-orange cursor-pointer"
        >
          <Compass className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function RailSection({
  section,
  liked,
  playingId,
  isPlaying,
  onPlay,
  onToggleLike,
  onOpenArtist,
  onFindSimilar,
  renderActions,
}: {
  section: DiscoverSection;
  liked: Set<string>;
  playingId: string | null;
  isPlaying: boolean;
  onPlay: (t: Track, q: Track[]) => void;
  onToggleLike: (t: Track) => void;
  onOpenArtist: (u: { id: string; username: string; permalinkUrl?: string }) => void;
  onFindSimilar: (seed: Track) => void;
  renderActions?: (track: Track) => React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 20);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 20);
  };

  useEffect(() => {
    checkScroll();
  }, [section.tracks]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = 540;
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  return (
    <section key={section.id} className="relative group/rail">
      <SectionHeader
        title={section.title}
        subtitle={section.subtitle}
        icon={railIcon(section.id)}
        action={
          <div className="flex items-center gap-2">
            {section.tracks.length > 0 && (
              <button
                type="button"
                onClick={() => onPlay(section.tracks[0], section.tracks)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold text-sc-muted hover:text-sc-fg border border-sc-line hover:border-sc-orange/50 hover:bg-sc-fill/5 transition-all cursor-pointer active:scale-95 shrink-0"
              >
                <ListPlus className="w-3.5 h-3.5 text-sc-orange" />
                Play all
              </button>
            )}

            {/* Carousel navigation arrows */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => scroll('left')}
                disabled={!canScrollLeft}
                aria-label="Scroll left"
                className="w-7 h-7 rounded-full flex items-center justify-center border border-sc-line bg-sc-panel/80 hover:bg-sc-panel hover:text-sc-fg text-sc-muted disabled:opacity-20 disabled:hover:bg-sc-panel/80 disabled:hover:text-sc-muted transition-all cursor-pointer active:scale-90"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => scroll('right')}
                disabled={!canScrollRight}
                aria-label="Scroll right"
                className="w-7 h-7 rounded-full flex items-center justify-center border border-sc-line bg-sc-panel/80 hover:bg-sc-panel hover:text-sc-fg text-sc-muted disabled:opacity-20 disabled:hover:bg-sc-panel/80 disabled:hover:text-sc-muted transition-all cursor-pointer active:scale-90"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        }
      />

      {/* Floating edge arrows on hover */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll('left')}
          aria-label="Scroll left"
          className="absolute left-0 top-[60%] -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/80 hover:bg-black text-white shadow-xl flex items-center justify-center opacity-0 group-hover/rail:opacity-100 transition-opacity backdrop-blur-xs cursor-pointer hover:scale-110 active:scale-95"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scroll('right')}
          aria-label="Scroll right"
          className="absolute right-0 top-[60%] -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/80 hover:bg-black text-white shadow-xl flex items-center justify-center opacity-0 group-hover/rail:opacity-100 transition-opacity backdrop-blur-xs cursor-pointer hover:scale-110 active:scale-95"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {/* Track rail: scrollbar hidden, smooth snapping */}
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className="flex gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-2 -mx-1 px-1 snap-x scroll-smooth"
      >
        {section.tracks.map((t) => (
          <div key={t.id} className="w-[164px] shrink-0 snap-start">
            <RailCard
              track={t}
              playing={t.id === playingId && isPlaying}
              liked={liked.has(t.id)}
              onPlay={() => onPlay(t, section.tracks)}
              onToggleLike={() => onToggleLike(t)}
              onOpenArtist={() =>
                onOpenArtist({
                  id: t.artistId ?? '',
                  username: t.artist,
                  permalinkUrl: t.artistUrl,
                })
              }
              onFindSimilar={() => onFindSimilar(t)}
              renderActions={renderActions}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The home screen.
 *
 * Built as a stack of horizontal rails rather than one grid so several kinds of
 * recommendation sit together, each labelled with why it is there. The feed is
 * assembled in the data layer; this only lays it out.
 */
export function DiscoverView(p: Props) {
  const liked = new Set(p.likedIds);

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-[1560px] mx-auto w-full">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight">
            <Compass className="w-6 h-6 text-sc-orange" />
            Discover
          </h1>
          <p className="text-[13px] text-sc-muted mt-1.5 max-w-lg leading-relaxed">
            New tracks picked from what you play, what you have saved, and what the whole
            platform is listening to right now.
          </p>
        </div>
        <button
          type="button"
          onClick={p.onRefresh}
          disabled={p.loading}
          title="Shuffle in a fresh set of recommendations"
          aria-label="Refresh recommendations"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold text-sc-muted hover:text-sc-fg border border-sc-line hover:border-sc-orange/50 hover:bg-sc-fill/5 transition-all cursor-pointer active:scale-95 disabled:opacity-40"
        >
          <RotateCcw className={clsx('w-3.5 h-3.5 text-sc-orange', p.loading && 'animate-spin')} />
          Refresh
        </button>
      </header>

      {p.loading && p.sections.length === 0 && <SkeletonRows count={8} />}

      {!p.loading && p.sections.length === 0 && (
        <div className="rounded-2xl border border-dashed border-sc-line px-5 py-6 text-center">
          <p className="text-[13px] text-sc-muted">
            Nothing to recommend yet - check your connection and try refreshing.
          </p>
          <button
            type="button"
            onClick={p.onRefresh}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-sc-orange px-4 py-2 text-[12px] font-bold text-sc-fg hover:bg-sc-orange-soft hover:text-sc-bg active:scale-95 transition-all cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Try again
          </button>
        </div>
      )}

      {p.sections.map((section) => (
        <RailSection
          key={section.id}
          section={section}
          liked={liked}
          playingId={p.playingId}
          isPlaying={p.isPlaying}
          onPlay={p.onPlay}
          onToggleLike={p.onToggleLike}
          onOpenArtist={p.onOpenArtist}
          onFindSimilar={p.onFindSimilar}
          renderActions={p.renderActions}
        />
      ))}
    </div>
  );
}
