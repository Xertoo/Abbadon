import { useState, useEffect } from 'react';
import { Play, Compass, Heart, Sparkles, ArrowRight, ChevronDown, ChevronUp, Flame, ListPlus } from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import type { Track, User } from '../types';
import { SectionHeader, SkeletonRows } from './TrackList';
import { sc, mapTrack } from '../lib/soundcloud';

interface Props {
  /** Seed used for the current recommendation, if one has been loaded. */
  seed: Track | null;
  tracks: Track[];
  loading: boolean;
  /** Played track, so the view can offer it as a fresh seed. */
  currentTrack: Track | null;
  /** Recently played tracks, newest first. These are the seeds. */
  history: Track[];
  likedIds: string[];
  playingId: string | null;
  isPlaying: boolean;
  onPick: (seed: Track) => void;
  onPlay: (t: Track, q: Track[]) => void;
  onToggleLike: (t: Track) => void;
  onOpenArtist: (u: User | { id: string; username: string; permalinkUrl?: string }) => void;
  /** Opens the same view seeded by a row, for drilling sideways. */
  onFindSimilar: (seed: Track) => void;
  onOpenSearch: () => void;
  onAddToQueue?: (track: Track) => void;
  renderActions?: (track: Track) => React.ReactNode;
  compact?: boolean;
  showArtwork?: boolean;
}

/**
 * A card.
 *
 * Used for both the seed rail and the results.
 */
function Card({
  track,
  isSeed,
  playing,
  onClick,
  onOpenArtist,
  onAddToQueue,
  renderActions,
}: {
  track: Track;
  isSeed: boolean;
  playing: boolean;
  onClick: () => void;
  onOpenArtist?: (artist: { id: string; username: string; permalinkUrl?: string }) => void;
  onAddToQueue?: () => void;
  renderActions?: (track: Track) => React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      title={`${track.title} - ${track.artist}`}
      className={clsx(
        'group relative flex flex-col rounded-2xl border p-3.5 text-left transition-all duration-300 cursor-pointer select-none backdrop-blur-md',
        isSeed
          ? 'border-sc-orange/60 bg-sc-orange/12 shadow-[0_8px_30px_rgba(var(--sc-accent-rgb,109,94,252),0.25)] ring-1 ring-sc-orange/40'
          : 'glass-card hover:border-sc-orange/50'
      )}
    >
      <div className="relative aspect-square rounded-xl overflow-hidden bg-sc-panel-2 shadow-inner">
        <Artwork
          src={track.artwork}
          seed={track.id}
          size={200}
          className="w-full h-full transition-transform duration-500 ease-out group-hover:scale-108"
        />
        <span
          className={clsx(
            'absolute bottom-2.5 right-2.5 w-10 h-10 rounded-full flex items-center justify-center shadow-xl transition-all duration-300',
            isSeed
              ? 'bg-sc-orange text-white opacity-100 scale-100 hover:scale-110 active:scale-90 shadow-[0_4px_16px_var(--color-sc-orange)]'
              : 'bg-white text-black opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 scale-90 group-hover:scale-100 hover:scale-110 active:scale-90 hover:shadow-2xl'
          )}
        >
          <Play className="w-4 h-4 fill-current translate-x-[1px]" />
        </span>
        {playing && (
          <span className="absolute top-2.5 left-2.5 rounded-full bg-black/75 backdrop-blur-xs px-2 py-0.5 text-[9px] font-extrabold tracking-wider text-sc-orange flex items-center gap-1 shadow-md">
            <span className="w-1.5 h-1.5 rounded-full bg-sc-orange animate-ping" />
            PLAYING
          </span>
        )}
        {renderActions && (
          <div
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {renderActions(track)}
          </div>
        )}
      </div>
      <div className="mt-2.5 text-[12.5px] font-semibold text-sc-fg truncate">{track.title}</div>
      <div className="mt-0.5 truncate">
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onOpenArtist?.({
              id: track.artistId ?? '',
              username: track.artist,
              permalinkUrl: track.artistUrl,
            });
          }}
          className="text-[11.5px] text-sc-muted hover:text-sc-orange hover:underline transition-colors truncate inline-block max-w-full cursor-pointer"
          title={`Open ${track.artist}`}
        >
          {track.artist}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-sc-faint">
        <span>{track.durationFormatted || ''}</span>
        <div className="flex items-center gap-1">
          {onAddToQueue && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddToQueue();
              }}
              title={`Add ${track.title} to queue`}
              aria-label={`Add ${track.title} to queue`}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-sc-dim hover:text-sc-fg cursor-pointer p-0.5 hover:scale-110 active:scale-90"
            >
              <ListPlus className="w-3.5 h-3.5" />
            </button>
          )}
          {renderActions && (
            <div
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              {renderActions(track)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SimilarView(p: Props) {
  /**
   * Seeds the user can start from: what is playing, then playback history.
   *
   * History replaced liked tracks here on purpose. Likes accumulate for months
   * and then never change, so the rail was the same handful of old favourites
   * in the same order no matter what had been playing. History reflects the
   * last hour of listening, which is what "find me something like this" means.
   */
  const [expandedSeeds, setExpandedSeeds] = useState(false);
  const [starterTracks, setStarterTracks] = useState<Track[]>([]);
  const [starterLoading, setStarterLoading] = useState(false);

  const candidates = [
    ...(p.currentTrack ? [p.currentTrack] : []),
    ...p.history.filter((t) => t.id !== p.currentTrack?.id),
  ].slice(0, 24);

  useEffect(() => {
    if (candidates.length === 0 && !p.seed && starterTracks.length === 0) {
      setStarterLoading(true);
      sc.searchTracks('popular electronic pop dance hits', 16)
        .then((res) => {
          setStarterTracks(res.collection.map(mapTrack).filter((t) => t.duration > 30));
        })
        .catch(() => {})
        .finally(() => {
          setStarterLoading(false);
        });
    }
  }, [candidates.length, p.seed, starterTracks.length]);

  const isCompact = Boolean(p.seed) && !expandedSeeds;
  const displayedCandidates = isCompact
    ? [
        ...(p.seed ? [p.seed] : []),
        ...candidates.filter((c) => c.id !== p.seed?.id),
      ].slice(0, 4)
    : candidates;

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-[1560px] mx-auto w-full">
      <header>
        <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight">
          <Compass className="w-6 h-6 text-sc-orange" />
          Find similar
        </h1>
        <p className="text-[13px] text-sc-muted mt-1.5 max-w-lg leading-relaxed">
          SoundCloud&apos;s own related feed, seeded by anything you played recently. Pick one and
          it finds more in the same vein, so you never have to loop a single playlist.
        </p>
      </header>

      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <SectionHeader
            title="Start from"
            subtitle={
              p.seed
                ? 'Active seed and recent tracks (click one to find similar)'
                : p.history.length === 0
                  ? 'Play a few tracks, or search for one'
                  : 'Now playing, or anything you played recently'
            }
            icon={<Sparkles className="w-[18px] h-[18px] text-sc-orange" />}
          />
          {p.seed && candidates.length > 4 && (
            <button
              onClick={() => setExpandedSeeds(!expandedSeeds)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold text-sc-muted hover:text-sc-fg border border-sc-line hover:border-sc-orange/50 hover:bg-sc-fill/5 transition-all cursor-pointer active:scale-95 shrink-0"
            >
              {expandedSeeds ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5 text-sc-orange" />
                  <span>Compact seeds</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5 text-sc-orange" />
                  <span>Show all recent ({candidates.length})</span>
                </>
              )}
            </button>
          )}
        </div>

        {candidates.length > 0 ? (
          isCompact ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {displayedCandidates.map((t) => {
                const isSelected = p.seed?.id === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => {
                      p.onPick(t);
                      setExpandedSeeds(false);
                    }}
                    className={clsx(
                      'group relative flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-200 cursor-pointer select-none active:scale-[0.98] hover:scale-[1.01]',
                      isSelected
                        ? 'border-sc-orange/70 bg-sc-orange/12 shadow-sm ring-1 ring-sc-orange/30 translate-x-0.5'
                        : 'border-sc-line bg-sc-panel hover:border-sc-orange/50 hover:bg-sc-fill/5 hover:translate-x-0.5'
                    )}
                    title={`${t.title} - ${t.artist}`}
                  >
                    <div className="w-11 h-11 rounded-lg overflow-hidden bg-sc-panel-2 shrink-0 relative">
                      <Artwork src={t.artwork} seed={t.id} size={120} className="w-full h-full" />
                      {isSelected && (
                        <div className="absolute inset-0 bg-sc-orange/20 flex items-center justify-center">
                          <Sparkles className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {isSelected && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sc-orange text-white uppercase tracking-wider">
                            Seed
                          </span>
                        )}
                        <span className="text-[12.5px] font-semibold text-sc-fg truncate">
                          {t.title}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-sc-muted truncate">{t.artist}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {p.onAddToQueue && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            p.onAddToQueue?.(t);
                          }}
                          title={`Add ${t.title} to queue`}
                          aria-label="Add to queue"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-sc-dim hover:text-sc-fg cursor-pointer p-1.5 hover:scale-110 active:scale-90"
                        >
                          <ListPlus className="w-4 h-4" />
                        </button>
                      )}
                      {p.renderActions && (
                        <div
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.renderActions(t)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
              {candidates.map((t) => (
                <Card
                  key={t.id}
                  track={t}
                  isSeed={p.seed?.id === t.id}
                  playing={t.id === p.currentTrack?.id && p.isPlaying}
                  onClick={() => {
                    p.onPick(t);
                    setExpandedSeeds(false);
                  }}
                  onOpenArtist={p.onOpenArtist}
                  onAddToQueue={p.onAddToQueue ? () => p.onAddToQueue?.(t) : undefined}
                  renderActions={p.renderActions}
                />
              ))}
            </div>
          )
        ) : (
          <div className="space-y-6">
            <button
              onClick={p.onOpenSearch}
              className="group flex items-center gap-3 rounded-xl border border-dashed border-sc-line px-5 py-4 text-left hover:border-neutral-600 transition-colors w-full sm:w-auto"
            >
              <ArrowRight className="w-4 h-4 text-sc-muted group-hover:text-sc-fg" />
              <span className="text-[13px] text-sc-muted group-hover:text-sc-fg">
                Search for a track to use as a seed
              </span>
            </button>

            {starterLoading && (
              <div className="pt-2">
                <SkeletonRows count={4} />
              </div>
            )}

            {!starterLoading && starterTracks.length > 0 && (
              <div className="pt-2 space-y-3">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-sc-orange" />
                  <span className="text-[13px] font-bold text-sc-fg">
                    Or start from trending tracks:
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
                  {starterTracks.map((t) => (
                    <Card
                      key={t.id}
                      track={t}
                      isSeed={false}
                      playing={t.id === p.playingId && p.isPlaying}
                      onClick={() => {
                        p.onPick(t);
                      }}
                      onOpenArtist={p.onOpenArtist}
                      onAddToQueue={p.onAddToQueue ? () => p.onAddToQueue?.(t) : undefined}
                      renderActions={p.renderActions}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {p.seed && !p.loading && p.tracks.length > 0 && (
        <section>
          <SectionHeader
            title={`More like ${p.seed.title}`}
            subtitle={`${p.tracks.length} tracks SoundCloud matched to ${p.seed.artist} · click one to keep digging`}
            icon={<Heart className="w-[18px] h-[18px] text-sc-orange" />}
          />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
            {p.tracks.map((t) => (
              <Card
                key={t.id}
                track={t}
                isSeed={false}
                playing={t.id === p.playingId && p.isPlaying}
                onClick={() => p.onPlay(t, p.tracks)}
                onOpenArtist={p.onOpenArtist}
                onAddToQueue={p.onAddToQueue ? () => p.onAddToQueue?.(t) : undefined}
                renderActions={p.renderActions}
              />
            ))}
          </div>
        </section>
      )}

      {p.seed && !p.loading && p.tracks.length === 0 && (
        <p className="text-[13px] text-sc-muted">
          SoundCloud had nothing new for that one - it may be a very niche upload. Try another seed.
        </p>
      )}

      {p.loading && (
        <section>
          <SkeletonRows count={6} />
        </section>
      )}

      {!p.seed && !p.loading && !candidates.length && starterTracks.length === 0 && !starterLoading && (
        <p className="text-[13px] text-sc-dim">Pick a track above to get started.</p>
      )}
    </div>
  );
}