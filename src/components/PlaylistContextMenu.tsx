import { useEffect, useRef, useState } from 'react';
import {
  Play,
  ListPlus,
  ListMusic,
  CopyPlus,
  Link as LinkIcon,
  EyeOff,
  Trash2,
  FolderPlus,
  Camera,
  ImageDown,
  AlertTriangle,
  Check,
} from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import type { Playlist, Track } from '../types';

export interface PlaylistContextMenuState {
  playlist: Playlist;
  x: number;
  y: number;
}

interface Props {
  state: PlaylistContextMenuState | null;
  onClose: () => void;
  onPlay?: (playlist: Playlist) => void;
  onPlayNext?: (tracks: Track[]) => void;
  onAddToQueue?: (tracks: Track[]) => void;
  onCopyPlaylist?: (playlist: Playlist) => void;
  onHidePlaylist?: (id: string) => void;
  onDeletePlaylist?: (playlist: Playlist) => void;
  onOpenAddMedia?: (playlistId: string) => void;
  onEditArtwork?: (playlist: Playlist) => void;
  onSaveCover?: (url: string, title: string) => void;
  ownsPlaylist?: boolean;
}

export function PlaylistContextMenu({
  state,
  onClose,
  onPlay,
  onPlayNext,
  onAddToQueue,
  onCopyPlaylist,
  onHidePlaylist,
  onDeletePlaylist,
  onOpenAddMedia,
  onEditArtwork,
  onSaveCover,
  ownsPlaylist = false,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Close on Escape or click outside
  useEffect(() => {
    if (!state) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDeleteOpen) {
          setConfirmDeleteOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, onClose, confirmDeleteOpen]);

  if (!state) return null;

  const { playlist, x, y } = state;
  const tracks = playlist.tracks || [];

  // Clamp positioning to keep menu entirely inside viewport
  const MENU_WIDTH = 240;
  const MENU_HEIGHT = 350;
  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 12);
  const top = Math.min(Math.max(8, y), window.innerHeight - MENU_HEIGHT - 12);

  const handleCopyLink = async () => {
    const url =
      playlist.permalinkUrl ||
      (playlist.id.startsWith('http')
        ? playlist.id
        : `https://soundcloud.com/playlists/${playlist.id}`);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const isOwner =
    ownsPlaylist ||
    playlist.isLocal ||
    playlist.source === 'server';

  return (
    <>
      {/* Invisible backdrop to dismiss on click outside */}
      <div
        className="fixed inset-0 z-[120] cursor-default bg-transparent"
        onClick={() => {
          if (!confirmDeleteOpen) onClose();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!confirmDeleteOpen) onClose();
        }}
      />

      {/* Floating Stylish Context Menu */}
      {!confirmDeleteOpen && (
        <div
          ref={menuRef}
          style={{ left: `${left}px`, top: `${top}px` }}
          className="fixed z-[125] w-[240px] rounded-2xl bg-[#121218]/95 backdrop-blur-2xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.06)] p-1.5 animate-in fade-in-0 zoom-in-95 duration-100 ease-out select-none"
        >
          {/* Header with thumbnail & title */}
          <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1 rounded-xl bg-white/[0.03] border border-white/[0.04]">
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-sc-panel shrink-0">
              <Artwork
                src={playlist.artwork}
                seed={playlist.id}
                size={67}
                rounded="rounded-lg"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold text-sc-fg truncate">{playlist.title}</div>
              <div className="text-[10px] text-sc-muted truncate flex items-center gap-1.5">
                <span>{playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'}</span>
                {playlist.isLocal && (
                  <span className="px-1 py-0.2 rounded bg-sc-orange/20 text-sc-orange text-[9px] font-extrabold uppercase">
                    PC
                  </span>
                )}
                {playlist.source === 'server' && (
                  <span className="px-1 py-0.2 rounded bg-blue-500/20 text-blue-400 text-[9px] font-extrabold uppercase">
                    Server
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-0.5 text-[12.5px] font-medium text-sc-fg">
            {/* Play Now */}
            {onPlay && (
              <button
                type="button"
                onClick={() => {
                  onPlay(playlist);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-sc-orange hover:text-black transition-colors cursor-pointer group"
              >
                <Play className="w-3.5 h-3.5 fill-current text-sc-orange group-hover:text-black shrink-0" />
                <span className="truncate">Play</span>
              </button>
            )}

            {/* Play Next */}
            {onPlayNext && tracks.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onPlayNext(tracks);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <ListPlus className="w-3.5 h-3.5 text-sc-dim shrink-0" />
                <span className="truncate">Play Next</span>
              </button>
            )}

            {/* Add to Queue */}
            {onAddToQueue && tracks.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onAddToQueue(tracks);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <ListMusic className="w-3.5 h-3.5 text-sc-dim shrink-0" />
                <span className="truncate">Add to Queue</span>
              </button>
            )}

            {/* Copy / Duplicate Playlist */}
            {onCopyPlaylist && (
              <button
                type="button"
                onClick={() => {
                  onCopyPlaylist(playlist);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <CopyPlus className="w-3.5 h-3.5 text-sc-dim shrink-0" />
                <span className="truncate">
                  {isOwner ? 'Duplicate Playlist' : 'Copy to My Account'}
                </span>
              </button>
            )}

            {/* Add Songs from PC/Server */}
            {isOwner && onOpenAddMedia && (
              <button
                type="button"
                onClick={() => {
                  onOpenAddMedia(playlist.id);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5 text-sc-dim shrink-0" />
                <span className="truncate">Add Songs</span>
              </button>
            )}

            {/* Change Playlist Cover */}
            {isOwner && onEditArtwork && (
              <button
                type="button"
                onClick={() => {
                  onEditArtwork(playlist);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5 text-sc-dim shrink-0" />
                <span className="truncate">Change Cover</span>
              </button>
            )}

            {/* Save Cover to Pictures */}
            {playlist.artwork && onSaveCover && (
              <button
                type="button"
                onClick={() => {
                  onSaveCover(playlist.artwork, `${playlist.title} - Cover`);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <ImageDown className="w-3.5 h-3.5 text-sc-dim shrink-0" />
                <span className="truncate">Save Cover to Pictures</span>
              </button>
            )}

            {/* Copy Link */}
            {(playlist.permalinkUrl || !playlist.isLocal) && (
              <button
                type="button"
                onClick={handleCopyLink}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                {copiedLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <LinkIcon className="w-3.5 h-3.5 text-sc-dim shrink-0" />
                )}
                <span className="truncate">
                  {copiedLink ? 'Link Copied!' : 'Copy Playlist Link'}
                </span>
              </button>
            )}

            {/* Divider */}
            <div className="my-1 border-t border-white/[0.08]" />

            {/* Hide from Sidebar (for SoundCloud or non-local playlists) */}
            {!playlist.isLocal && onHidePlaylist && (
              <button
                type="button"
                onClick={() => {
                  onHidePlaylist(playlist.id);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] text-sc-muted hover:text-sc-fg transition-colors cursor-pointer"
              >
                <EyeOff className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Hide from Sidebar</span>
              </button>
            )}

            {/* Delete Playlist */}
            {onDeletePlaylist && (
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteOpen(true);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-red-400 hover:text-white hover:bg-red-500/80 active:bg-red-600 transition-colors cursor-pointer group"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate font-semibold">Delete Playlist</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stylish Delete Confirmation Dialog */}
      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in p-4 select-none">
          <div className="w-full max-w-sm rounded-2xl border border-red-500/30 bg-[#121218]/95 backdrop-blur-2xl p-6 shadow-2xl animate-scale-in">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-sc-fg">Delete Playlist?</h3>
                <p className="text-[12px] text-sc-muted truncate mt-0.5">
                  <span className="font-semibold text-sc-fg">"{playlist.title}"</span>
                </p>
              </div>
            </div>

            <p className="mt-4 text-[12.5px] text-sc-muted leading-relaxed">
              Are you sure you want to delete this playlist? This will remove all{' '}
              <span className="text-sc-fg font-medium">{playlist.trackCount} tracks</span> from your library. This action cannot be undone.
            </p>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteOpen(false);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl text-[12.5px] font-semibold text-sc-muted hover:text-sc-fg hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteOpen(false);
                  onClose();
                  onDeletePlaylist?.(playlist);
                }}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-red-500 hover:bg-red-600 active:scale-95 text-[12.5px] font-bold text-white transition-all shadow-lg shadow-red-500/20 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
