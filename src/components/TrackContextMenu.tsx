import { useEffect, useRef, useState } from 'react';
import {
  Play,
  ListPlus,
  ListMusic,
  Heart,
  User,
  Link as LinkIcon,
  Check,
  ImageDown,
} from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import type { Track } from '../types';

export interface TrackContextMenuState {
  track: Track;
  queue?: Track[];
  x: number;
  y: number;
}

interface Props {
  state: TrackContextMenuState | null;
  onClose: () => void;
  onPlay?: (track: Track, queue?: Track[]) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onToggleLike?: (track: Track) => void;
  isLiked?: boolean;
  onOpenArtist?: (artist: { id: string; username: string; permalinkUrl?: string }) => void;
  onSaveArtwork: (url: string, title: string) => void;
}

export function TrackContextMenu({
  state,
  onClose,
  onPlay,
  onPlayNext,
  onAddToQueue,
  onToggleLike,
  isLiked = false,
  onOpenArtist,
  onSaveArtwork,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!state) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, onClose]);

  if (!state) return null;

  const { track, queue, x, y } = state;

  const MENU_WIDTH = 240;
  const MENU_HEIGHT = 320;
  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 12);
  const top = Math.min(Math.max(8, y), window.innerHeight - MENU_HEIGHT - 12);

  const handleCopyLink = async () => {
    const url = track.permalinkUrl || `https://soundcloud.com/${track.artist}/${track.title}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => {
        setCopiedLink(false);
        onClose();
      }, 700);
    } catch {
      /* ignore */
    }
  };

  const handleSavePicture = () => {
    const saveTitle = `${track.artist} - ${track.title}`;
    onSaveArtwork(track.artwork, saveTitle);
    onClose();
  };

  return (
    <>
      {/* Invisible backdrop */}
      <div
        className="fixed inset-0 z-[120] cursor-default bg-transparent"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />

      {/* Floating Stylish Context Menu */}
      <div
        ref={menuRef}
        style={{ left: `${left}px`, top: `${top}px` }}
        className="fixed z-[125] w-[240px] rounded-2xl bg-[#121218]/95 backdrop-blur-2xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.06)] p-1.5 animate-in fade-in-0 zoom-in-95 duration-100 ease-out select-none"
      >
        {/* Header with thumbnail & title */}
        <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1 rounded-xl bg-white/[0.03] border border-white/[0.04]">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-sc-panel shrink-0">
            <Artwork
              src={track.artwork}
              seed={track.id}
              size={67}
              rounded="rounded-lg"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold text-sc-fg truncate">{track.title}</div>
            <div className="text-[10px] text-sc-muted truncate">{track.artist}</div>
          </div>
        </div>

        <div className="flex flex-col gap-0.5 text-[12.5px] font-medium text-sc-fg">
          {/* Save Artwork to Pictures */}
          <button
            type="button"
            onClick={handleSavePicture}
            disabled={!track.artwork}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-sc-orange hover:text-black transition-colors cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ImageDown className="w-3.5 h-3.5 text-sc-orange group-hover:text-black shrink-0" />
            <span className="truncate font-semibold">Save Artwork to Pictures</span>
          </button>

          {/* Divider */}
          <div className="my-1 border-t border-white/[0.08]" />

          {/* Play Now */}
          {onPlay && (
            <button
              type="button"
              onClick={() => {
                onPlay(track, queue);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-sc-dim shrink-0" />
              <span className="truncate">Play</span>
            </button>
          )}

          {/* Play Next */}
          {onPlayNext && (
            <button
              type="button"
              onClick={() => {
                onPlayNext(track);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <ListPlus className="w-3.5 h-3.5 text-sc-dim shrink-0" />
              <span className="truncate">Play Next</span>
            </button>
          )}

          {/* Add to Queue */}
          {onAddToQueue && (
            <button
              type="button"
              onClick={() => {
                onAddToQueue(track);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <ListMusic className="w-3.5 h-3.5 text-sc-dim shrink-0" />
              <span className="truncate">Add to Queue</span>
            </button>
          )}

          {/* Toggle Like */}
          {onToggleLike && (
            <button
              type="button"
              onClick={() => {
                onToggleLike(track);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <Heart
                className={clsx(
                  'w-3.5 h-3.5 shrink-0',
                  isLiked ? 'fill-sc-orange text-sc-orange' : 'text-sc-dim'
                )}
              />
              <span className="truncate">{isLiked ? 'Unlike Track' : 'Like Track'}</span>
            </button>
          )}

          {/* Open Artist */}
          {onOpenArtist && track.artist && (
            <button
              type="button"
              onClick={() => {
                onOpenArtist({
                  id: track.artistId ?? '',
                  username: track.artist,
                  permalinkUrl: track.artistUrl,
                });
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-sc-dim shrink-0" />
              <span className="truncate">Go to Artist</span>
            </button>
          )}

          {/* Copy Track Link */}
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
            <span className="truncate">{copiedLink ? 'Link Copied!' : 'Copy Track Link'}</span>
          </button>
        </div>
      </div>
    </>
  );
}
