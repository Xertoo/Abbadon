import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import {
  Play,
  Disc3,
  Users,
  ArrowLeft,
  Download,
  TrendingUp,
  Clock,
  CalendarClock,
  Loader2,
  ListOrdered,
  ArrowUpDown,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import type { Playlist, Track, User } from '../types';
import { TrackList, SectionHeader, SkeletonRows } from './TrackList';
import { PlaylistAddButton } from './PlaylistAddButton';
import { ArtistSocial } from './ArtistSocial';

interface Props {
  playlist: Playlist | null;
  loading: boolean;
  likedIds: string[];
  playingId: string | null;
  isPlaying: boolean;
  onPlay: (t: Track, q: Track[]) => void;
  onToggleLike: (t: Track) => void;
  onOpenArtist: (u: { id: string; username: string }) => void;
  onBack: () => void;
  onPlayAll: (tracks: Track[]) => void;
  /** Tighter rows, from Settings. */
  compactRows?: boolean;
  /** Cover art in rows, from Settings. */
  showArtwork?: boolean;

  /**
   * Playlist editing.
   *
   * `accountPlaylists` are the playlists the signed-in user owns, which is the
   * only set the API will accept edits against. An artist page has none, so the
   * whole block hides itself there rather than offering a dead control.
   */
  signedIn: boolean;
  accountPlaylists: Playlist[];
  /** Tracks already in `currentPlaylist`, used to label add/remove. */
  playlistTrackIds: string[];
  playlistBusy: string | null;
  onAddToPlaylist: (playlist: Playlist, track: Track) => void;
  onRemoveFromPlaylist: (playlist: Playlist, track: Track) => void;
  onCreatePlaylist: (title: string) => Promise<Playlist | null>;
  onDownload: (track: Track) => void;
  /** Ids of tracks with a download in flight, which get a spinner. */
  downloadingIds: string[];
  /** Sends an unsigned-in user to the login flow from a row action. */
  onLogin: () => void;

  /**
   * Track-level extras: comments, lyrics, audience.
   *
   * The currently playing track only, so these panels always describe what the
   * user is hearing rather than whatever row happens to be scrolled to.
   */
  currentTrack: Track | null;
  currentTime: number;
  /** The signed-in account, for comment ownership and the follow button. */
  me: User | null;
  notify: (msg: string) => void;
  /** Opens the player's position at a given second, from a comment timestamp. */
  onSeekTo?: (sec: number) => void;
}

type SortId = 'default' | 'popular' | 'newest' | 'oldest';

/** Stable empty list so the ordering helper keeps its identity while loading. */
const EMPTY_TRACKS: Track[] = [];

/**
 * Epoch milliseconds, or null when there is no usable date.
 *
 * Normalizing invalid or missing dates to null allows comparator logic to
 * consistently push dateless tracks to the end in both Ascending (Oldest)
 * and Descending (Newest) views, preventing dateless tracks from jumping to
 * the top of the playlist as 1970 items.
 */
const epoch = (d: string | undefined): number | null => {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
};

interface IndexedTrack {
  track: Track;
  index: number;
}

const byDateDesc = (a: IndexedTrack, b: IndexedTrack) => {
  const ta = epoch(a.track.createdAt);
  const tb = epoch(b.track.createdAt);
  if (ta === null && tb === null) return a.index - b.index;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta || a.index - b.index;
};

const byDateAsc = (a: IndexedTrack, b: IndexedTrack) => {
  const ta = epoch(a.track.createdAt);
  const tb = epoch(b.track.createdAt);
  if (ta === null && tb === null) return a.index - b.index;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta - tb || a.index - b.index;
};

/** Most played first, with original index as a tie-break for stable ordering. */
const playsDesc = (a: IndexedTrack, b: IndexedTrack) =>
  (b.track.playsCount ?? 0) - (a.track.playsCount ?? 0) || a.index - b.index;

export function DetailView(p: Props) {
  const [sort, setSort] = useState<SortId>('default');
  const [showFullBio, setShowFullBio] = useState(false);
  const pl = p.playlist;
  const isArtist = pl?.id.startsWith('user-') ?? false;

  /**
   * Reset the ordering when a *different* list is opened, not when the same one
   * changes shape.
   */
  const listId = pl?.id ?? '';
  useEffect(() => {
    setSort('default');
    setShowFullBio(false);
  }, [listId]);

  const tracks = pl?.tracks ?? EMPTY_TRACKS;

  /**
   * Ordering for the list.
   *
   * "Order" is always present as the first chip, preserving authored playlist order.
   */
  const visible = useMemo(() => {
    if (sort === 'default') return tracks;
    /**
     * SoundCloud has no "add to top": every track added to a playlist lands at
     * the bottom, so the stored order runs oldest-added -> newest-added and the
     * API returns it verbatim. There is no per-track "added" date either, so
     * "Newest" (most recently added first) is simply that stored order
     * reversed. Sorting by the track's own upload date was the old behaviour
     * and is what made a playlist look unsorted: a track you added yesterday
     * but that was uploaded in 2019 jumped to the middle.
     */
    if (sort === 'newest' && !isArtist) return [...tracks].reverse();
    const indexed: IndexedTrack[] = tracks.map((track, index) => ({ track, index }));
    if (sort === 'popular') return indexed.sort(playsDesc).map((item) => item.track);
    if (sort === 'newest') return indexed.sort(byDateDesc).map((item) => item.track);
    if (sort === 'oldest') return indexed.sort(byDateAsc).map((item) => item.track);
    return tracks;
  }, [tracks, sort, isArtist]);

  const sortOptions: Array<{ id: SortId; label: string; icon: typeof Clock; title: string }> =
    isArtist
      ? [
          { id: 'default', label: 'Latest', icon: Clock, title: 'Uploads (latest first)' },
          { id: 'popular', label: 'Popular', icon: TrendingUp, title: 'Most played first' },
        ]
      : [
          { id: 'default', label: 'Order', icon: ListOrdered, title: 'Original playlist order' },
          { id: 'newest', label: 'Newest', icon: Clock, title: 'Most recently added first' },
        ];

  const activeSort = sortOptions.find((o) => o.id === sort);

  if (!pl) {
    return (
      <div className="p-8 max-w-[1560px] mx-auto w-full">
        <SkeletonRows count={10} />
      </div>
    );
  }

  const totalSec = visible.reduce((a, t) => a + t.duration, 0);
  const totalPlays = visible.reduce((a, t) => a + (t.playsCount ?? 0), 0);
  const totalLikes = visible.reduce((a, t) => a + (t.likesCount ?? 0), 0);
  const owner = pl.owner;

  /**
   * Whether the signed-in user owns this playlist.
   *
   * The API accepts edits only against your own playlists, so the remove button
   * is gated on this. Without the check it appeared on every playlist, including
   * other people's, and every click came back as a 403.
   */
  const ownsPlaylist =
    !isArtist && p.accountPlaylists.some((ap) => ap.id === pl.id);

  return (
    <div className="w-full max-w-[1560px] mx-auto">
      {/* Banner */}
      <div className="relative px-6 sm:px-8 pt-6 pb-8">
        <div className="absolute inset-x-0 top-0 h-64 -z-10 bg-gradient-to-b from-sc-orange/10 to-transparent" />
        <button
          onClick={p.onBack}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-sc-muted hover:text-sc-fg transition-all duration-150 hover:-translate-x-1 active:scale-95 mb-5 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-150" />
          Back
        </button>

        <div className="flex flex-col sm:flex-row gap-6 items-start">
          <div className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl overflow-hidden bg-sc-panel-2 shrink-0 shadow-2xl ring-1 ring-sc-fill/5 transition-transform duration-300 hover:scale-[1.02]">
            <Artwork src={pl.artwork} seed={pl.id} size={500} rounded="rounded-2xl" className="w-full h-full" />
          </div>

          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-sc-orange">
              {isArtist ? <Users className="w-3 h-3" /> : <Disc3 className="w-3 h-3" />}
              {isArtist ? 'Artist' : 'Playlist'}
            </span>
            <h1 className="mt-2 text-3xl sm:text-5xl font-extrabold tracking-tight leading-none break-words">
              {pl.title}
            </h1>
            {owner && !isArtist && (
              <button
                onClick={() => p.onOpenArtist(owner)}
                className="mt-3 inline-flex items-center gap-2 text-[13px] font-semibold hover:underline cursor-pointer"
              >
                <div className="w-6 h-6 rounded-full overflow-hidden bg-sc-panel-2 shrink-0">
                  <Artwork
                    src={owner.avatarUrl}
                    seed={owner.id}
                    size={67}
                    rounded="rounded-full"
                    className="w-full h-full"
                  />
                </div>
                <span className="text-sc-orange">{owner.fullName}</span>
              </button>
            )}

            {/* Bio or description */}
            {(isArtist ? owner?.description || pl.description : pl.description) ? (
              <div className="mt-2.5 max-w-3xl">
                <p
                  className={clsx(
                    'text-[13px] text-sc-muted leading-relaxed whitespace-pre-line',
                    !showFullBio && 'line-clamp-2'
                  )}
                >
                  {isArtist ? owner?.description || pl.description : pl.description}
                </p>
                {((isArtist ? owner?.description || pl.description : pl.description) ?? '').length > 180 && (
                  <button
                    type="button"
                    onClick={() => setShowFullBio(!showFullBio)}
                    className="mt-1 text-[11px] font-semibold text-sc-orange hover:text-sc-orange-soft hover:underline cursor-pointer transition-colors"
                  >
                    {showFullBio ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            ) : null}

            {/* Artist social links / web profiles */}
            {isArtist && owner?.webProfiles && owner.webProfiles.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {owner.webProfiles.map((wp, idx) => (
                  <a
                    key={wp.url || idx}
                    href={wp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium bg-sc-panel hover:bg-sc-panel-2 border border-sc-line text-sc-muted hover:text-sc-fg transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer shadow-sm group"
                    title={wp.url}
                  >
                    <ExternalLink className="w-3 h-3 text-sc-orange group-hover:text-sc-orange-soft transition-colors shrink-0" />
                    <span className="capitalize">{wp.title || wp.network || wp.service || 'Web Link'}</span>
                  </a>
                ))}
              </div>
            )}
            {/* Followers / following live on the artist header, not in the
                track-count line: they describe the person, not the uploads. */}
            {isArtist && owner && (
              <div className="mt-3">
                <ArtistSocial
                  artist={owner}
                  me={p.me}
                  signedIn={p.signedIn}
                  onOpenUser={p.onOpenArtist}
                  onRequireSignIn={p.onLogin}
                  notify={p.notify}
                />
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-sc-muted">
              <span className="font-semibold text-sc-fg/80">{pl.tracks.length} tracks</span>
              {totalSec > 0 && (
                <>
                  <span className="text-sc-dim">·</span>
                  <span>
                    {Math.floor(totalSec / 3600) > 0 &&
                      `${Math.floor(totalSec / 3600)}h `}
                    {Math.floor((totalSec % 3600) / 60)}m
                  </span>
                </>
              )}
              {totalPlays > 0 && (
                <>
                  <span className="text-sc-dim">·</span>
                  <span>{totalPlays.toLocaleString()} plays</span>
                </>
              )}
              {totalLikes > 0 && (
                <>
                  <span className="text-sc-dim">·</span>
                  <span>{totalLikes.toLocaleString()} likes</span>
                </>
              )}
              {activeSort && sort !== 'default' && (
                <>
                  <span className="text-sc-dim">·</span>
                  <span className="text-sc-orange-soft">sorted by {activeSort.label}</span>
                </>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={() => p.onPlayAll(visible)}
                disabled={visible.length === 0}
                className="inline-flex items-center gap-2 rounded-full bg-sc-orange px-6 py-2.5 text-[13px] font-bold text-sc-fg hover:bg-sc-orange-soft hover:text-sc-bg hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-40 glow-orange cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                Play
              </button>

              {/* Track order */}
              <div
                className="flex items-center gap-1 rounded-full border border-sc-line bg-sc-panel p-0.5"
                role="group"
                aria-label="Sort tracks"
              >
                {sortOptions.map(({ id, label, icon: Icon, title }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSort(id)}
                    aria-pressed={sort === id}
                    title={title}
                    className={clsx(
                      'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all duration-200 cursor-pointer active:scale-95',
                      sort === id
                        ? 'bg-sc-orange/15 text-sc-orange-soft shadow-xs'
                        : 'text-sc-muted hover:text-sc-fg hover:bg-sc-fill/5'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tracks */}
      <div className="px-4 sm:px-6 pb-10">
        {p.loading && pl.tracks.length === 0 ? (
          <SkeletonRows count={10} compact={p.compactRows} />
        ) : (
          <>
            <SectionHeader
              title={sort === 'default' ? 'Tracks' : `${activeSort?.label ?? 'Sorted'} first`}
              subtitle={`${visible.length} of ${pl.tracks.length}`}
              icon={<ArrowUpDown className="w-[18px] h-[18px] text-sc-orange" />}
            />
            <TrackList
              tracks={visible}
              likedIds={p.likedIds}
              playingId={p.playingId}
              isPlaying={p.isPlaying}
              compact={p.compactRows}
              showArtwork={p.showArtwork ?? true}
              onPlay={(track) => p.onPlay(track, visible)}
              onToggleLike={p.onToggleLike}
              onOpenArtist={p.onOpenArtist}
              renderActions={(t) => {
                const isDownloading = p.downloadingIds.includes(t.id);
                return (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        p.onDownload(t);
                      }}
                      disabled={isDownloading}
                      title={isDownloading ? 'Downloading' : 'Save to Downloads'}
                      aria-label={`Download ${t.title}`}
                      aria-busy={isDownloading}
                      className={clsx(
                        'w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all',
                        isDownloading
                          ? 'text-sc-orange opacity-100'
                          : 'text-sc-dim opacity-0 group-hover:opacity-100 hover:text-sc-fg'
                      )}
                    >
                      {isDownloading ? (
                        <Loader2 className="w-[15px] h-[15px] animate-spin-slow" />
                      ) : (
                        <Download className="w-[15px] h-[15px]" />
                      )}
                    </button>
                    {!isArtist && ownsPlaylist && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            p.onRemoveFromPlaylist(pl, t);
                          }}
                          title="Remove from playlist"
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sc-dim opacity-0 group-hover:opacity-100 hover:text-sc-orange transition-all shrink-0"
                        >
                          <Trash2 className="w-[15px] h-[15px]" />
                        </button>
                        <PlaylistAddButton
                          track={t}
                          playlists={p.accountPlaylists}
                          busy={p.playlistBusy}
                          signedIn={p.signedIn}
                          onLogin={p.onLogin}
                          onAdd={p.onAddToPlaylist}
                          onCreate={p.onCreatePlaylist}
                          onRemove={p.onRemoveFromPlaylist}
                          inPlaylists={[pl.id]}
                        />
                      </>
                    )}
                  </>
                );
              }}
            />
          </>
        )}

      </div>
    </div>
  );
}
