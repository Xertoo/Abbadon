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
  LayoutGrid,
  ListMusic,
  Plus,
  CopyPlus,
  Pencil,
  Camera,
  Check,
  X,
  ChevronUp,
  ChevronDown,
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
  onCopyPlaylist?: (playlist: Playlist, title?: string) => Promise<Playlist | null>;
  onUpdatePlaylistDetails?: (playlistId: string, details: { title?: string; description?: string; artwork?: string }) => Promise<boolean>;
  onEditArtwork?: (playlist: Playlist) => void;
  onReorderPlaylistTracks?: (playlistId: string, tracks: Track[]) => Promise<boolean>;
  onDeletePlaylist?: (playlist: Playlist) => void;
  onContextMenuPlaylist?: (playlist: Playlist, x: number, y: number) => void;
  onContextMenuTrack?: (track: Track, x: number, y: number, queue?: Track[]) => void;
  onContextMenuArtist?: (artist: { id?: string; username: string; fullName?: string; avatarUrl?: string; permalinkUrl?: string }, x: number, y: number) => void;
  onOpenAddMedia?: () => void;
  onDownload: (track: Track) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
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

export interface AlbumGroup {
  id: string;
  title: string;
  artwork?: string;
  releaseYear?: string;
  type: 'Album' | 'EP' | 'Single';
  tracks: Track[];
}

function normalizeArtworkUrl(url?: string): string {
  if (!url) return '';
  return url.replace(/-(?:large|t\d+x\d+)\.(jpg|png|webp)/i, '').split('?')[0];
}

function detectAlbumsAndEps(tracks: Track[]): AlbumGroup[] {
  if (!tracks.length) return [];

  // Count normalized artwork occurrences across tracks
  const artworkCounts = new Map<string, number>();
  for (const t of tracks) {
    const norm = normalizeArtworkUrl(t.artwork);
    if (norm) {
      artworkCounts.set(norm, (artworkCounts.get(norm) || 0) + 1);
    }
  }

  // An artwork used by > 75% of tracks in a large catalogue (12+ tracks) is a generic avatar
  const isGenericArtwork = (art?: string) => {
    if (!art || tracks.length < 12) return false;
    const norm = normalizeArtworkUrl(art);
    const count = artworkCounts.get(norm) || 0;
    return count / tracks.length > 0.75;
  };

  const groupsMap = new Map<string, { artwork?: string; tracks: Track[]; dateStr?: string }>();

  for (const t of tracks) {
    const art = t.artwork;
    const normArt = normalizeArtworkUrl(art);
    const generic = isGenericArtwork(art);
    const dateStr = t.createdAt ? t.createdAt.slice(0, 10) : '';

    let key = '';
    if (normArt && !generic) {
      key = `art:${normArt}`;
    } else if (dateStr) {
      key = `date:${dateStr}`;
    } else {
      key = `single:${t.id}`;
    }

    if (!groupsMap.has(key)) {
      groupsMap.set(key, { artwork: art, tracks: [], dateStr });
    }
    groupsMap.get(key)!.tracks.push(t);
  }

  const result: AlbumGroup[] = [];

  for (const [key, group] of groupsMap.entries()) {
    const groupTracks = group.tracks;
    let albumTitle = '';
    const firstTitle = groupTracks[0].title;

    if (groupTracks.length > 1) {
      const parts = firstTitle.split(/ [-–—:] /);
      if (parts.length > 1 && groupTracks.every((t) => t.title.startsWith(parts[0]))) {
        albumTitle = parts[0].trim();
      }
    }

    if (!albumTitle) {
      if (groupTracks.length >= 2) {
        albumTitle = firstTitle.replace(/\s*\(feat\..*?\)/i, '').replace(/\s*\[.*?\]/, '').trim();
      } else {
        albumTitle = firstTitle;
      }
    }

    let releaseYear = '';
    const date = groupTracks[0].createdAt;
    if (date) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getFullYear())) {
        releaseYear = String(parsed.getFullYear());
      }
    }

    const type = groupTracks.length >= 7 ? 'Album' : groupTracks.length >= 2 ? 'EP' : 'Single';

    result.push({
      id: key,
      title: albumTitle,
      artwork: group.artwork || groupTracks[0].artwork,
      releaseYear,
      type,
      tracks: groupTracks,
    });
  }

  return result.sort((a, b) => {
    const rank = (x: AlbumGroup) => (x.type === 'Album' ? 1 : x.type === 'EP' ? 2 : 3);
    const rDiff = rank(a) - rank(b);
    if (rDiff !== 0) return rDiff;

    const dateA = a.tracks[0]?.createdAt ? Date.parse(a.tracks[0].createdAt) : 0;
    const dateB = b.tracks[0]?.createdAt ? Date.parse(b.tracks[0].createdAt) : 0;
    return dateB - dateA;
  });
}

function getSavedPlaylistSort(listId?: string): SortId {
  try {
    if (listId) {
      const perList = localStorage.getItem(`sc9000:playlist_sort:${listId}`);
      if (perList === 'default' || perList === 'newest') return perList;
    }
    const globalSort = localStorage.getItem('sc9000:playlist_sort');
    if (globalSort === 'default' || globalSort === 'newest') return globalSort;
  } catch {}
  return 'default';
}

function savePlaylistSort(sortId: SortId, listId?: string) {
  try {
    localStorage.setItem('sc9000:playlist_sort', sortId);
    if (listId) {
      localStorage.setItem(`sc9000:playlist_sort:${listId}`, sortId);
    }
  } catch {}
}

export function DetailView(p: Props) {
  const pl = p.playlist;
  const isArtist = pl?.id.startsWith('user-') ?? false;
  const listId = pl?.id ?? '';

  const [sort, setSort] = useState<SortId>(() => (isArtist ? 'default' : getSavedPlaylistSort(listId)));
  const [showFullBio, setShowFullBio] = useState(false);
  const [artistViewMode, setArtistViewMode] = useState<'tracks' | 'albums'>('tracks');
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumGroup | null>(null);

  // Copy Playlist Modal state
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyTitle, setCopyTitle] = useState('');
  const [isCopying, setIsCopying] = useState(false);

  // Delete Playlist Modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Editable Playlist Title state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  /**
   * Reset or restore ordering when a different list is opened.
   * Remembers the sorting choice (Order vs Newest/recent).
   */
  useEffect(() => {
    if (isArtist) {
      setSort('default');
    } else {
      setSort(getSavedPlaylistSort(listId));
    }
    setShowFullBio(false);
    setArtistViewMode('tracks');
    setSelectedAlbum(null);
    setIsEditingTitle(false);
    setCopyModalOpen(false);
    setDeleteModalOpen(false);
  }, [listId, isArtist]);

  const handleSortChange = (newSort: SortId) => {
    setSort(newSort);
    if (!isArtist) {
      savePlaylistSort(newSort, listId);
    }
  };

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

  const albumsAndEps = useMemo(() => {
    if (!isArtist || !pl) return [];

    // 1. If official SoundCloud albums/playlists are present, use the artist's published sequence
    if (pl.albums && pl.albums.length > 0) {
      const groups: AlbumGroup[] = pl.albums.map((a) => {
        const year = a.tracks[0]?.createdAt
          ? String(new Date(a.tracks[0].createdAt).getFullYear())
          : '';
        const count = a.tracks.length || a.trackCount;
        const type: 'Album' | 'EP' | 'Single' = count >= 7 ? 'Album' : count >= 2 ? 'EP' : 'Single';
        return {
          id: a.id,
          title: a.title,
          artwork: a.artwork || a.tracks[0]?.artwork,
          releaseYear: year,
          type,
          tracks: a.tracks, // EXACT published track order by creator
        };
      });

      return groups.sort((a, b) => {
        const rank = (x: AlbumGroup) => (x.type === 'Album' ? 1 : x.type === 'EP' ? 2 : 3);
        const rDiff = rank(a) - rank(b);
        if (rDiff !== 0) return rDiff;

        const dateA = a.tracks[0]?.createdAt ? Date.parse(a.tracks[0].createdAt) : 0;
        const dateB = b.tracks[0]?.createdAt ? Date.parse(b.tracks[0].createdAt) : 0;
        return dateB - dateA;
      });
    }

    // 2. Fallback to automated catalogue detection
    return detectAlbumsAndEps(pl.tracks);
  }, [isArtist, pl]);

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
    (!isArtist && p.accountPlaylists.some((ap) => ap.id === pl.id)) || Boolean(pl?.isLocal);

  const handleCopyPlaylist = async () => {
    if (!pl || !p.onCopyPlaylist) return;
    setIsCopying(true);
    try {
      await p.onCopyPlaylist(pl, copyTitle);
      setCopyModalOpen(false);
    } finally {
      setIsCopying(false);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!pl || !p.onDeletePlaylist) return;
    setIsDeleting(true);
    try {
      await p.onDeletePlaylist(pl);
      setDeleteModalOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveTitle = async () => {
    if (!pl || !editTitleValue.trim() || !p.onUpdatePlaylistDetails) return;
    setIsSavingTitle(true);
    try {
      const ok = await p.onUpdatePlaylistDetails(pl.id, { title: editTitleValue.trim() });
      if (ok) setIsEditingTitle(false);
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handleMoveTrack = async (index: number, direction: 'up' | 'down') => {
    if (!pl || !p.onReorderPlaylistTracks) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tracks.length) return;
    const reordered = [...tracks];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    await p.onReorderPlaylistTracks(pl.id, reordered);
  };

  return (
    <div className="w-full max-w-[1560px] mx-auto">
      {/* Banner */}
      <div
        onContextMenu={(e) => {
          if (!isArtist && pl && p.onContextMenuPlaylist) {
            e.preventDefault();
            p.onContextMenuPlaylist(pl, e.clientX, e.clientY);
          } else if (isArtist && pl && p.onContextMenuArtist) {
            e.preventDefault();
            p.onContextMenuArtist(
              { id: pl.id, username: pl.title, fullName: pl.title, avatarUrl: pl.artwork, permalinkUrl: pl.permalinkUrl },
              e.clientX,
              e.clientY
            );
          }
        }}
        className="relative px-6 sm:px-8 pt-6 pb-8"
      >
        <div className="absolute inset-x-0 top-0 h-64 -z-10 bg-gradient-to-b from-sc-orange/10 to-transparent" />
        <button
          onClick={p.onBack}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-sc-muted hover:text-sc-fg transition-all duration-150 hover:-translate-x-1 active:scale-95 mb-5 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-150" />
          Back
        </button>

        <div className="flex flex-col sm:flex-row gap-6 items-start">
          <div
            onContextMenu={(e) => {
              if (isArtist && pl && p.onContextMenuArtist) {
                e.preventDefault();
                e.stopPropagation();
                p.onContextMenuArtist(
                  { id: pl.id, username: pl.title, fullName: pl.title, avatarUrl: pl.artwork, permalinkUrl: pl.permalinkUrl },
                  e.clientX,
                  e.clientY
                );
              }
            }}
            className="relative group w-40 h-40 sm:w-48 sm:h-48 rounded-2xl overflow-hidden bg-sc-panel-2 shrink-0 shadow-2xl ring-1 ring-sc-fill/5 transition-transform duration-300 hover:scale-[1.02]"
          >
            <Artwork src={pl.artwork} seed={pl.id} size={500} rounded="rounded-2xl" className="w-full h-full object-cover" />
            {ownsPlaylist && p.onEditArtwork && (
              <button
                type="button"
                onClick={() => p.onEditArtwork?.(pl)}
                title="Change playlist cover"
                aria-label="Change playlist cover"
                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-1.5 text-white cursor-pointer backdrop-blur-[2px]"
              >
                <div className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md transition-transform duration-150 group-hover:scale-110">
                  <Camera className="w-6 h-6" />
                </div>
                <span className="text-[11.5px] font-bold tracking-wide">Change Cover</span>
              </button>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-sc-orange">
              {isArtist ? <Users className="w-3 h-3" /> : <Disc3 className="w-3 h-3" />}
              {isArtist ? 'Artist' : 'Playlist'}
            </span>
            {isEditingTitle ? (
              <div className="mt-2 flex items-center gap-2 max-w-xl animate-fade-in">
                <input
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveTitle();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  autoFocus
                  className="flex-1 bg-sc-panel border border-sc-orange/60 rounded-xl px-3 py-1.5 text-2xl sm:text-3xl font-extrabold text-sc-fg outline-none focus:ring-2 focus:ring-sc-orange/30 shadow-inner"
                />
                <button
                  type="button"
                  onClick={handleSaveTitle}
                  disabled={isSavingTitle || !editTitleValue.trim()}
                  title="Save title"
                  className="p-2 rounded-xl bg-sc-orange text-white hover:bg-sc-orange-soft transition-all duration-150 disabled:opacity-50 cursor-pointer shadow-sm shrink-0"
                >
                  {isSavingTitle ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(false)}
                  title="Cancel"
                  className="p-2 rounded-xl bg-sc-panel border border-sc-line text-sc-muted hover:text-sc-fg transition-all duration-150 cursor-pointer shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-none break-words">
                  {pl.title}
                </h1>
                {ownsPlaylist && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditTitleValue(pl.title);
                        setIsEditingTitle(true);
                      }}
                      title="Rename playlist"
                      aria-label="Rename playlist"
                      className="p-1.5 rounded-lg border border-transparent hover:border-sc-line hover:bg-sc-panel/80 text-sc-dim hover:text-sc-fg transition-all duration-150 cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {p.onEditArtwork && (
                      <button
                        type="button"
                        onClick={() => p.onEditArtwork?.(pl)}
                        title="Change playlist cover"
                        aria-label="Change playlist cover"
                        className="p-1.5 rounded-lg border border-transparent hover:border-sc-line hover:bg-sc-panel/80 text-sc-dim hover:text-sc-fg transition-all duration-150 cursor-pointer"
                      >
                        <Camera className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {owner && !isArtist && (
              <button
                onClick={() => p.onOpenArtist(owner)}
                onContextMenu={(e) => {
                  if (owner && p.onContextMenuArtist) {
                    e.preventDefault();
                    e.stopPropagation();
                    p.onContextMenuArtist(owner, e.clientX, e.clientY);
                  }
                }}
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

              {/* Copy playlist button */}
              {!isArtist && (
                <button
                  type="button"
                  onClick={() => {
                    if (!p.signedIn && !pl.isLocal) {
                      p.onLogin();
                      return;
                    }
                    setCopyTitle(pl.title);
                    setCopyModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-sc-line bg-sc-panel hover:bg-sc-panel-2 px-4 py-2.5 text-[13px] font-bold text-sc-fg hover:border-sc-orange/50 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer shadow-xs group"
                  title="Copy this playlist to your account to edit and customize it"
                >
                  <CopyPlus className="w-4 h-4 text-sc-orange group-hover:scale-110 transition-transform" />
                  <span>{ownsPlaylist ? 'Duplicate Playlist' : 'Copy to My Account'}</span>
                </button>
              )}

              {/* Add Songs from PC or Server button */}
              {!isArtist && ownsPlaylist && p.onOpenAddMedia && (
                <button
                  type="button"
                  onClick={p.onOpenAddMedia}
                  className="inline-flex items-center gap-2 rounded-full border border-sc-line bg-sc-panel hover:bg-sc-panel-2 px-4 py-2.5 text-[13px] font-bold text-sc-fg hover:border-sc-orange/50 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer shadow-xs group"
                  title="Add songs from PC or Server to this playlist"
                >
                  <Plus className="w-4 h-4 text-sc-orange group-hover:scale-110 transition-transform" />
                  <span>Add Songs</span>
                </button>
              )}

              {/* Delete Playlist button */}
              {!isArtist && p.onDeletePlaylist && (
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 px-4 py-2.5 text-[13px] font-bold text-red-400 hover:text-red-300 hover:border-red-500/50 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer shadow-xs group"
                  title="Delete this playlist"
                >
                  <Trash2 className="w-4 h-4 text-red-400 group-hover:scale-110 transition-transform" />
                  <span>Delete Playlist</span>
                </button>
              )}

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
                    onClick={() => handleSortChange(id)}
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

              {/* Artist view mode switch */}
              {isArtist && albumsAndEps.length > 0 && (
                <div
                  className="flex items-center gap-1 rounded-full border border-sc-line bg-sc-panel p-0.5 ml-auto"
                  role="tablist"
                  aria-label="Artist view mode"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setArtistViewMode('tracks');
                      setSelectedAlbum(null);
                    }}
                    className={clsx(
                      'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all duration-200 cursor-pointer active:scale-95',
                      artistViewMode === 'tracks'
                        ? 'bg-sc-orange/15 text-sc-orange-soft shadow-xs'
                        : 'text-sc-muted hover:text-sc-fg hover:bg-sc-fill/5'
                    )}
                  >
                    <ListMusic className="w-3.5 h-3.5" />
                    All Tracks
                  </button>
                  <button
                    type="button"
                    onClick={() => setArtistViewMode('albums')}
                    className={clsx(
                      'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all duration-200 cursor-pointer active:scale-95',
                      artistViewMode === 'albums'
                        ? 'bg-sc-orange/15 text-sc-orange-soft shadow-xs'
                        : 'text-sc-muted hover:text-sc-fg hover:bg-sc-fill/5'
                    )}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Albums & EPs ({albumsAndEps.filter((a) => a.type !== 'Single').length || albumsAndEps.length})
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content Area: Albums & EPs Grid OR Tracks List */}
      <div className="px-4 sm:px-6 pb-10">
        {p.loading && pl.tracks.length === 0 ? (
          <SkeletonRows count={10} compact={p.compactRows} />
        ) : isArtist && artistViewMode === 'albums' ? (
          selectedAlbum ? (
            /* Selected Album Track List */
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-sc-panel/60 border border-sc-line">
                <button
                  type="button"
                  onClick={() => setSelectedAlbum(null)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-sc-line bg-sc-panel text-[12px] font-bold text-sc-muted hover:text-sc-fg hover:border-sc-orange/50 transition-all cursor-pointer active:scale-95"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to all Albums & EPs
                </button>
                <div className="flex items-center gap-3">
                  <Artwork
                    src={selectedAlbum.artwork}
                    seed={selectedAlbum.id}
                    size={80}
                    rounded="rounded-lg"
                    className="w-10 h-10 shrink-0 shadow-sm"
                  />
                  <div>
                    <h3 className="text-sm font-bold text-sc-fg">{selectedAlbum.title}</h3>
                    <p className="text-[11px] text-sc-muted">
                      {selectedAlbum.type} · {selectedAlbum.tracks.length} tracks
                      {selectedAlbum.releaseYear ? ` · ${selectedAlbum.releaseYear}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => p.onPlay(selectedAlbum.tracks[0], selectedAlbum.tracks)}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-sc-orange text-sc-on-accent text-xs font-bold hover:scale-105 active:scale-95 transition-all cursor-pointer shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Play {selectedAlbum.type}
                </button>
              </div>

              <TrackList
                tracks={selectedAlbum.tracks}
                likedIds={p.likedIds}
                playingId={p.playingId}
                isPlaying={p.isPlaying}
                compact={p.compactRows}
                showArtwork={p.showArtwork ?? true}
                onPlay={(track) => p.onPlay(track, selectedAlbum.tracks)}
                onToggleLike={p.onToggleLike}
                onOpenArtist={p.onOpenArtist}
                onPlayNext={p.onPlayNext}
                onAddToQueue={p.onAddToQueue}
                onContextMenuTrack={p.onContextMenuTrack}
              />
            </div>
          ) : (
            /* Albums & EPs Tiled Grid */
            <div className="space-y-4 animate-fade-in">
              <SectionHeader
                title="Albums & EPs"
                subtitle={`${albumsAndEps.length} releases`}
                icon={<Disc3 className="w-[18px] h-[18px] text-sc-orange" />}
              />

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {albumsAndEps.map((album) => (
                  <div
                    key={album.id}
                    onClick={() => setSelectedAlbum(album)}
                    className="group flex flex-col text-left select-none p-3 rounded-2xl bg-sc-panel/40 hover:bg-sc-panel border border-white/[0.04] hover:border-sc-orange/50 transition-all duration-200 cursor-pointer hover:scale-[1.02] shadow-sm"
                  >
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-sc-panel-2 shadow-inner">
                      <Artwork
                        src={album.artwork}
                        seed={album.id}
                        size={250}
                        className="w-full h-full transition-transform duration-500 ease-out group-hover:scale-108"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onPlay(album.tracks[0], album.tracks);
                        }}
                        aria-label={`Play ${album.title}`}
                        className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <span className="w-12 h-12 rounded-full bg-sc-orange text-sc-on-accent flex items-center justify-center shadow-xl scale-90 group-hover:scale-100 transition-transform">
                          <Play className="w-5 h-5 fill-current translate-x-[1px]" />
                        </span>
                      </button>
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-xs text-[9px] font-extrabold text-sc-orange uppercase tracking-wider shadow-md">
                        {album.type}
                      </span>
                    </div>
                    <div className="mt-2.5 min-w-0">
                      <h4
                        className="text-[12.5px] font-bold text-sc-fg truncate group-hover:text-sc-orange transition-colors"
                        title={album.title}
                      >
                        {album.title}
                      </h4>
                      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-sc-muted">
                        <span>{album.tracks.length} tracks</span>
                        {album.releaseYear && <span>{album.releaseYear}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          /* Standard All Tracks List */
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
              onPlayNext={p.onPlayNext}
              onAddToQueue={p.onAddToQueue}
              onContextMenuTrack={p.onContextMenuTrack}
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
                        {sort === 'default' && visible.length > 1 && (
                          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const idx = visible.indexOf(t);
                                if (idx > 0) void handleMoveTrack(idx, 'up');
                              }}
                              disabled={visible.indexOf(t) === 0}
                              title="Move track up"
                              className="w-7 h-7 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-fg disabled:opacity-20 transition-all shrink-0 cursor-pointer"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const idx = visible.indexOf(t);
                                if (idx < visible.length - 1) void handleMoveTrack(idx, 'down');
                              }}
                              disabled={visible.indexOf(t) === visible.length - 1}
                              title="Move track down"
                              className="w-7 h-7 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-fg disabled:opacity-20 transition-all shrink-0 cursor-pointer"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            p.onRemoveFromPlaylist(pl, t);
                          }}
                          title="Remove from playlist"
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sc-dim opacity-0 group-hover:opacity-100 hover:text-sc-orange transition-all shrink-0 cursor-pointer"
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

      {/* Copy Playlist Modal Dialog */}
      {copyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in p-4">
          <div className="w-full max-w-md rounded-2xl border border-sc-line bg-sc-panel p-6 shadow-2xl animate-scale-in">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sc-orange/15 flex items-center justify-center text-sc-orange shrink-0">
                <CopyPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-sc-fg">Copy Playlist to Your Account</h3>
                <p className="text-[12px] text-sc-muted">
                  Create a fully editable copy with {pl.tracks.length} {pl.tracks.length === 1 ? 'track' : 'tracks'}.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div>
                <label className="text-[11.5px] font-semibold text-sc-dim uppercase tracking-wider block mb-1.5">
                  Playlist Title
                </label>
                <input
                  type="text"
                  value={copyTitle}
                  onChange={(e) => setCopyTitle(e.target.value)}
                  placeholder="My Playlist"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && copyTitle.trim()) void handleCopyPlaylist();
                    if (e.key === 'Escape') setCopyModalOpen(false);
                  }}
                  className="w-full rounded-xl border border-sc-line bg-sc-panel-2 px-3.5 py-2.5 text-[13px] font-medium text-sc-fg placeholder-sc-dim outline-none focus:border-sc-orange focus:ring-1 focus:ring-sc-orange transition-all"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setCopyModalOpen(false)}
                disabled={isCopying}
                className="px-4 py-2 rounded-xl text-[12.5px] font-semibold text-sc-muted hover:text-sc-fg hover:bg-sc-fill/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCopyPlaylist}
                disabled={isCopying || !copyTitle.trim()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-sc-orange text-[12.5px] font-bold text-white hover:bg-sc-orange-soft transition-all duration-150 hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer shadow-sm glow-orange"
              >
                {isCopying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Copying...</span>
                  </>
                ) : (
                  <span>Copy to Account</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Playlist Confirmation Modal */}
      {deleteModalOpen && pl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in p-4 select-none">
          <div className="w-full max-w-sm rounded-2xl border border-red-500/30 bg-[#121218]/95 backdrop-blur-2xl p-6 shadow-2xl animate-scale-in">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-sc-fg">Delete Playlist?</h3>
                <p className="text-[12px] text-sc-muted truncate mt-0.5">
                  <span className="font-semibold text-sc-fg">"{pl.title}"</span>
                </p>
              </div>
            </div>

            <p className="mt-4 text-[12.5px] text-sc-muted leading-relaxed">
              Are you sure you want to permanently delete this playlist? This action cannot be undone.
            </p>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-[12.5px] font-semibold text-sc-muted hover:text-sc-fg hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeletePlaylist}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-red-500 hover:bg-red-600 active:scale-95 text-[12.5px] font-bold text-white transition-all shadow-lg shadow-red-500/20 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
