import { useEffect, useRef, useState } from 'react';
import {
  Heart,
  ListMusic,
  Cloud,
  Compass,
  Search,
  GripVertical,
  RotateCcw,
  Settings2,
  EyeOff,
  Sparkles,
  Globe,
  Headphones,
  Users,
  BarChart3,
} from 'lucide-react';
import { Artwork } from './Artwork';
import clsx from 'clsx';
import type { Playlist } from '../types';
import { move } from '../lib/playlistOrder';
import appIcon from '../assets/icon.png';

export type View =
  | 'discover'
  | 'library'
  | 'friends'
  | 'similar'
  | 'search'
  | 'playlist'
  | 'artist'
  | 'settings'
  | 'stats';

interface Props {
  view: View;
  onNavigate: (v: View) => void;
  playlists: Playlist[];
  likedCount: number;
  clientIdReady: boolean;
  onPickPlaylist: (p: Playlist) => void;
  /** Persists a new left-side order, given the full list after the move. */
  onReorder: (next: Playlist[]) => void;
  /** True when the stored order differs from the order the API returned. */
  orderCustomized: boolean;
  onResetOrder: () => void;
  /** Id of the playlist currently open, so it can be highlighted. */
  activePlaylistId: string | null;
  /** Ids of playlists hidden by the user. */
  hiddenPlaylistIds?: string[];
  /** Called when user clicks the hide playlist button. */
  onHidePlaylist?: (id: string) => void;
  /** Opens the SoundHeardle song guesser minigame. */
  onOpenHeardle?: () => void;
  proxyEnabled?: boolean;
  proxyPreset?: string;
  onlineFriendsCount?: number;
  isSyncActive?: boolean;
  friendsDrawerOpen?: boolean;
  onToggleFriendsDrawer?: () => void;
}

const NAV: Array<{ id: View; label: string; icon: typeof Heart }> = [
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'library', label: 'Liked Tracks', icon: Heart },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'stats', label: 'Statistics', icon: BarChart3 },
];

export function Sidebar({
  view,
  onNavigate,
  playlists,
  likedCount,
  clientIdReady,
  onPickPlaylist,
  onReorder,
  orderCustomized,
  onResetOrder,
  activePlaylistId,
  hiddenPlaylistIds = [],
  onHidePlaylist,
  onOpenHeardle,
  proxyEnabled,
  proxyPreset,
  onlineFriendsCount = 0,
  isSyncActive = false,
  friendsDrawerOpen = false,
  onToggleFriendsDrawer,
}: Props) {
  /** Row being dragged, and the row it would land on. */
  const dragFrom = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hint, setHint] = useState(false);

  // The hint is shown until the first successful drag rather than forever.
  useEffect(() => {
    if (orderCustomized) setHint(false);
  }, [orderCustomized]);

  const endDrag = () => {
    dragFrom.current = null;
    setDragIndex(null);
    setDropIndex(null);
  };

  const commit = (from: number, to: number) => {
    const next = move(playlists, from, to);
    if (next === playlists) return;
    onReorder(next);
  };

  return (
    <aside className="relative z-10 w-[268px] shrink-0 flex flex-col backdrop-blur-2xl bg-sc-panel/40 border-r border-white/[0.06] shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)] select-none">
      <div className="h-16 px-4 flex items-center gap-3 border-b border-white/[0.06] select-none">
        <img
          src={appIcon}
          alt="Abbadon"
          className="w-8 h-8 rounded-lg shadow-md object-cover ring-1 ring-white/10"
        />
        <div className="flex flex-col">
          <span className="text-[15px] font-extrabold tracking-wider uppercase bg-gradient-to-r from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent">
            Abbadon
          </span>
          <span className="text-[10px] uppercase tracking-widest text-sc-muted font-medium">
            SoundCloud Client
          </span>
        </div>
      </div>

      <nav className="p-3 space-y-1">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = id === 'friends' ? Boolean(friendsDrawerOpen) : view === id;
          return (
            <button
              key={id}
              onClick={() => {
                if (id === 'friends' && onToggleFriendsDrawer) {
                  onToggleFriendsDrawer();
                } else {
                  onNavigate(id);
                }
              }}
              className={clsx(
                'group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-300 active:scale-[0.98]',
                active
                  ? 'text-sc-fg bg-sc-orange/15 border border-sc-orange/30 translate-x-1 shadow-sm'
                  : 'text-sc-muted hover:text-sc-fg hover:bg-white/[0.06] hover:translate-x-0.5'
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-sc-orange shadow-[0_0_8px_var(--color-sc-orange)]" />
              )}
              <Icon
                className={clsx(
                  'w-[18px] h-[18px] transition-transform duration-300',
                  active ? 'text-sc-orange scale-105' : 'group-hover:scale-110'
                )}
              />
              <span>{label}</span>
              {id === 'library' && likedCount > 0 && (
                <span className="ml-auto text-[11px] tabular-nums text-sc-muted">{likedCount}</span>
              )}
              {id === 'friends' && isSyncActive && (
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sc-orange animate-ping" />
                  <span className="text-[10px] font-bold text-sc-orange uppercase tracking-wider">Sync</span>
                </span>
              )}
              {id === 'friends' && !isSyncActive && onlineFriendsCount > 0 && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {onlineFriendsCount}
                </span>
              )}
            </button>
          );
        })}

        {onOpenHeardle && (
          <button
            onClick={onOpenHeardle}
            className="group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-300 active:scale-[0.98] text-sc-muted hover:text-sc-fg hover:bg-white/[0.06] hover:translate-x-0.5 cursor-pointer"
          >
            <Sparkles className="w-[18px] h-[18px] transition-transform duration-300 group-hover:scale-115 text-sc-orange-soft" />
            <span>Song Guesser</span>
          </button>
        )}
      </nav>

      <div className="flex items-center justify-between gap-2 px-5 pt-3 pb-2">
        <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-sc-dim">
          Your playlists
        </div>
        <div className="flex items-center gap-1">
          {playlists.length > 1 && !hint && (
            <span
              title="Drag a playlist to reorder, or focus one and press Alt with the arrow keys"
              className="text-[10px] text-sc-faint/80"
            >
              drag to reorder
            </span>
          )}
          {orderCustomized && (
            <button
              onClick={onResetOrder}
              title="Back to the order SoundCloud returns"
              aria-label="Reset playlist order"
              className="w-5 h-5 rounded flex items-center justify-center text-sc-dim hover:text-sc-fg transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-3 pb-3 space-y-0.5">
        {playlists.filter((p) => !hiddenPlaylistIds.includes(p.id)).length === 0 && (
          <p className="px-3 py-2 text-[12px] text-sc-dim">
            {playlists.length > 0 ? 'All playlists are hidden' : 'No playlists on your account yet'}
          </p>
        )}
        {playlists
          .filter((p) => !hiddenPlaylistIds.includes(p.id))
          .map((p, i) => {
            const isActive = p.id === activePlaylistId;
            const isDragging = dragIndex === i;
            const isDropTarget = dropIndex === i && dragIndex !== null && dragIndex !== i;
            return (
              <div
                key={p.id}
                draggable
                onDragStart={(e) => {
                  dragFrom.current = i;
                  setDragIndex(i);
                  setHint(true);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox refuses to start a drag without payload.
                  e.dataTransfer.setData('text/plain', p.id);
                }}
                onDragOver={(e) => {
                  if (dragFrom.current === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragFrom.current;
                  endDrag();
                  if (from !== null) commit(from, i);
                }}
                onDragEnd={endDrag}
                onKeyDown={(e) => {
                  if (!e.altKey) return;
                  if (e.key === 'ArrowUp' && i > 0) {
                    e.preventDefault();
                    commit(i, i - 1);
                  } else if (e.key === 'ArrowDown' && i < playlists.length - 1) {
                    e.preventDefault();
                    commit(i, i + 1);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`${p.title}, ${p.trackCount} tracks`}
                className={clsx(
                  'group relative w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-left transition-all duration-200 active:scale-[0.98]',
                  'cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-sc-orange/70',
                  isDragging && 'opacity-40',
                  isActive ? 'bg-sc-fill/8 translate-x-1 shadow-sm' : 'hover:bg-sc-fill/5 hover:translate-x-0.5'
                )}
              >
                {/* Insertion marker for the row that would receive the drop. */}
                {isDropTarget && (
                  <span className="absolute -top-[3px] left-2 right-2 h-[2px] rounded-full bg-sc-orange" />
                )}

                <GripVertical className="w-3.5 h-3.5 shrink-0 text-sc-faint opacity-0 group-hover:opacity-100 transition-opacity" />

                <button
                  onClick={() => onPickPlaylist(p)}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                >
                  <div className="w-9 h-9 rounded-md overflow-hidden bg-sc-panel-2 shrink-0">
                    <Artwork
                      src={p.artwork}
                      seed={p.id}
                      size={67}
                      rounded="rounded-md"
                      className="w-full h-full transition-transform duration-300 group-hover:scale-110"
                    />
                  </div>
                  <div className="min-w-0">
                    <div
                      className={clsx(
                        'text-[12.5px] font-medium truncate',
                        isActive ? 'text-sc-orange' : 'text-sc-muted group-hover:text-sc-fg'
                      )}
                    >
                      {p.title}
                    </div>
                    <div className="text-[11px] text-sc-dim truncate">{p.trackCount} tracks</div>
                  </div>
                </button>

                {onHidePlaylist && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onHidePlaylist(p.id);
                    }}
                    title={`Hide "${p.title}"`}
                    aria-label={`Hide ${p.title}`}
                    className="p-1 rounded-md text-sc-dim hover:text-sc-fg hover:bg-sc-fill/10 opacity-0 group-hover:opacity-100 transition-all duration-150 hover:scale-110 active:scale-90 shrink-0 cursor-pointer"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
      </div>

      <div className="p-3 border-t border-sc-line space-y-2">
        <div className="flex items-center gap-2 px-2 text-[11px]">
          <Cloud
            className={clsx(
              'w-3.5 h-3.5',
              clientIdReady ? 'text-emerald-500' : 'text-sc-orange-soft'
            )}
          />
          <span className="text-sc-muted">{clientIdReady ? 'SoundCloud live' : 'Connecting'}</span>
          <span
            className={clsx(
              'ml-auto w-1.5 h-1.5 rounded-full',
              clientIdReady ? 'bg-emerald-500' : 'bg-sc-orange-soft animate-pulse'
            )}
          />
        </div>

        {proxyEnabled && (
          <div
            onClick={() => onNavigate('settings')}
            title="Proxy active - regional restrictions bypass"
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-sc-dim hover:text-sc-fg transition-colors cursor-pointer rounded-md hover:bg-sc-fill/5"
          >
            <Globe className="w-3 h-3 text-sc-orange shrink-0" />
            <span className="font-semibold text-sc-orange-soft">
              Geo-Bypass {proxyPreset ? `(${proxyPreset.toUpperCase()})` : ''}
            </span>
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)] shrink-0" />
          </div>
        )}

        <button
          onClick={() => onNavigate('settings')}
          className={clsx(
            'group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 active:scale-95 cursor-pointer',
            view === 'settings'
              ? 'text-sc-fg bg-sc-fill/8 translate-x-1 shadow-sm'
              : 'text-sc-dim hover:text-sc-fg hover:bg-sc-fill/5 hover:translate-x-0.5'
          )}
        >
          <Settings2 className="w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-45" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

export { ListMusic };