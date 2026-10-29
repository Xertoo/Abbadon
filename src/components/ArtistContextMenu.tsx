import { useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  Link as LinkIcon,
  Check,
  ImageDown,
  User,
} from 'lucide-react';
import { Artwork } from './Artwork';

export interface ArtistContextMenuState {
  artist: {
    id?: string;
    username: string;
    fullName?: string;
    avatarUrl?: string;
    permalinkUrl?: string;
  };
  x: number;
  y: number;
}

interface Props {
  state: ArtistContextMenuState | null;
  onClose: () => void;
  onOpenArtist?: (artist: { id: string; username: string; permalinkUrl?: string }) => void;
  onSaveAvatar: (url: string, title: string) => void;
}

export function ArtistContextMenu({
  state,
  onClose,
  onOpenArtist,
  onSaveAvatar,
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

  const { artist, x, y } = state;

  const MENU_WIDTH = 240;
  const MENU_HEIGHT = 180;
  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 12);
  const top = Math.min(Math.max(8, y), window.innerHeight - MENU_HEIGHT - 12);

  const displayName = artist.fullName || artist.username || 'Artist';

  const handleCopyLink = async () => {
    const url = artist.permalinkUrl || `https://soundcloud.com/${artist.username}`;
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
    if (!artist.avatarUrl) return;
    onSaveAvatar(artist.avatarUrl, `${displayName} - Profile Picture`);
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
        {/* Header with avatar & name */}
        <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1 rounded-xl bg-white/[0.03] border border-white/[0.04]">
          <div className="w-8 h-8 rounded-full overflow-hidden bg-sc-panel shrink-0">
            <Artwork
              src={artist.avatarUrl}
              seed={artist.id || artist.username}
              size={67}
              rounded="rounded-full"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold text-sc-fg truncate">{displayName}</div>
            <div className="text-[10px] text-sc-orange uppercase tracking-wider font-extrabold">Artist Profile</div>
          </div>
        </div>

        <div className="flex flex-col gap-0.5 text-[12.5px] font-medium text-sc-fg">
          {/* Save Profile Picture to Pictures */}
          <button
            type="button"
            onClick={handleSavePicture}
            disabled={!artist.avatarUrl}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-sc-orange hover:text-black transition-colors cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ImageDown className="w-3.5 h-3.5 text-sc-orange group-hover:text-black shrink-0" />
            <span className="truncate font-semibold">Save Picture to Pictures</span>
          </button>

          {/* Divider */}
          <div className="my-1 border-t border-white/[0.08]" />

          {/* Open Artist Profile */}
          {onOpenArtist && (
            <button
              type="button"
              onClick={() => {
                onOpenArtist({
                  id: artist.id || '',
                  username: artist.username,
                  permalinkUrl: artist.permalinkUrl,
                });
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-sc-dim shrink-0" />
              <span className="truncate">View Profile</span>
            </button>
          )}

          {/* Copy Link */}
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
            <span className="truncate">{copiedLink ? 'Link Copied!' : 'Copy Profile Link'}</span>
          </button>
        </div>
      </div>
    </>
  );
}
