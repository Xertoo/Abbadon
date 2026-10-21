import { useMemo } from 'react';
import {
  X,
  BarChart3,
  Clock,
  Music2,
  Headphones,
  Sparkles,
  Play,
  Flame,
  Radio,
  ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import type { Track } from '../types';
import type { Friend, FriendPresence } from '../lib/listenTogether';
import {
  loadListeningStats,
  compareMusicTaste,
  getFriendObservedArtists,
  getFriendObservedTracks,
} from '../lib/stats';

interface Props {
  friend: Friend | null;
  presence?: FriendPresence;
  isOpen: boolean;
  onClose: () => void;
  onOpenInFullStats?: (friendCode: string) => void;
  onPlayTrack?: (track: Track, queue?: Track[]) => void;
  onOpenArtist?: (artist: { id?: string; username: string; artistId?: string; artistUrl?: string }) => void;
}

export function FriendStatsModal({
  friend,
  presence,
  isOpen,
  onClose,
  onOpenInFullStats,
  onPlayTrack,
  onOpenArtist,
}: Props) {
  const stats = useMemo(() => loadListeningStats(), [isOpen]);

  const friendObservedArtists = useMemo(() => {
    if (!friend) return [];
    const list = getFriendObservedArtists(friend.code);
    if (presence?.track?.artist) {
      const liveArtist = presence.track.artist.trim();
      if (!list.some((a) => a.toLowerCase() === liveArtist.toLowerCase())) {
        return [liveArtist, ...list];
      }
    }
    return list;
  }, [friend, presence?.track]);

  const friendObservedTracks = useMemo(() => {
    if (!friend) return [];
    return getFriendObservedTracks(friend.code);
  }, [friend]);

  const tasteComparison = useMemo(() => {
    if (!friend) return null;
    const currentTrackList = presence?.track ? [presence.track.title] : [];
    return compareMusicTaste(stats, friendObservedArtists, currentTrackList);
  }, [friend, stats, friendObservedArtists, presence?.track]);

  if (!isOpen || !friend) return null;

  const isOnline = Boolean(presence?.online);
  const totalHours = (
    ((presence?.totalListenedSeconds || 0)) / 3600
  ).toFixed(1);
  const songsCount = presence?.tracksListenedCount || friendObservedTracks.length || 0;

  return (
    <div className="fixed inset-0 z-[140] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none">
      <div
        className="w-full max-w-lg bg-sc-panel border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-white animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              {presence?.avatarUrl ? (
                <img
                  src={presence.avatarUrl}
                  alt={friend.name}
                  className="w-12 h-12 rounded-2xl object-cover border border-white/15 shadow-md"
                />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sc-orange to-purple-600 flex items-center justify-center text-lg font-black shadow-md border border-white/15">
                  {friend.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span
                className={clsx(
                  'absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full ring-2 ring-sc-panel',
                  isOnline
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : 'bg-neutral-600'
                )}
                title={isOnline ? 'Online now' : 'Offline'}
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white truncate">{friend.name}</h3>
                <span className="text-[10px] font-mono text-white/50 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                  {friend.code}
                </span>
              </div>
              <p className="text-xs text-white/50 truncate mt-0.5">
                {presence?.bio || (isOnline ? 'Active on Abbadon' : 'Offline on Abbadon')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Top 3 KPI Cards */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-col items-center text-center">
              <Clock className="w-4 h-4 text-orange-400 mb-1" />
              <div className="text-base font-black text-white">{totalHours}h</div>
              <span className="text-[10px] text-white/40 uppercase font-semibold">Listened</span>
            </div>

            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-col items-center text-center">
              <Music2 className="w-4 h-4 text-cyan-400 mb-1" />
              <div className="text-base font-black text-white">{songsCount}</div>
              <span className="text-[10px] text-white/40 uppercase font-semibold">Tracks</span>
            </div>

            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-col items-center text-center">
              <Sparkles className="w-4 h-4 text-purple-400 mb-1" />
              <div className="text-base font-black text-purple-300">
                {tasteComparison?.score ?? 0}%
              </div>
              <span className="text-[10px] text-white/40 uppercase font-semibold">Match</span>
            </div>
          </div>

          {/* Live Playing Card if currently active */}
          {isOnline && presence?.track && (
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-orange-500/10 to-purple-500/10 border border-orange-500/20 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-bold text-orange-400 uppercase tracking-wider text-[10px]">
                  <Radio className="w-3.5 h-3.5 animate-pulse" />
                  Currently Playing
                </span>
                {presence.isPlaying && (
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    Live
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <Artwork
                  src={presence.track.artwork}
                  seed={presence.track.id}
                  size={67}
                  rounded="rounded-xl"
                  className="w-12 h-12 shrink-0 shadow-md border border-white/10"
                />
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-white truncate">{presence.track.title}</h4>
                  <p className="text-[11px] text-white/60 truncate">{presence.track.artist}</p>
                </div>
                {onPlayTrack && (
                  <button
                    onClick={() => onPlayTrack(presence.track!)}
                    className="p-2.5 rounded-xl bg-orange-500 text-black hover:bg-orange-400 transition-all cursor-pointer shadow-md hover:scale-105 active:scale-95 shrink-0"
                    title="Play track"
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Taste Compatibility Breakdown */}
          {tasteComparison && (
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-orange-400" />
                  Musical Taste Compatibility
                </span>
                <span className="text-xs font-black text-orange-400">
                  {tasteComparison.score}% Match
                </span>
              </div>

              <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                <div
                  style={{ width: `${tasteComparison.score}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-orange-500 via-purple-500 to-cyan-400 shadow-[0_0_12px_rgba(249,115,22,0.5)] transition-all duration-700"
                />
              </div>

              {tasteComparison.sharedArtists.length > 0 ? (
                <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                  <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                    Shared Favorite Artists ({tasteComparison.sharedArtists.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {tasteComparison.sharedArtists.map((artist) => (
                      <span
                        key={artist}
                        onClick={() => onOpenArtist?.({ username: artist })}
                        className={clsx(
                          'px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/90 transition-all',
                          onOpenArtist && 'hover:bg-orange-500/20 hover:text-orange-300 hover:border-orange-500/30 cursor-pointer'
                        )}
                      >
                        {artist}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-white/40 italic">
                  No overlapping artists yet. As you both listen to more tracks on Abbadon, shared favorites will appear here!
                </p>
              )}
            </div>
          )}

          {/* Top Observed Artists */}
          {friendObservedArtists.length > 0 && (
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-2.5">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Headphones className="w-3.5 h-3.5 text-purple-400" />
                Artists Listened to by {friend.name}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {friendObservedArtists.map((artist) => (
                  <span
                    key={artist}
                    onClick={() => onOpenArtist?.({ username: artist })}
                    className={clsx(
                      'px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-500/10 border border-purple-500/20 text-purple-200 transition-all',
                      onOpenArtist && 'hover:bg-purple-500/25 hover:border-purple-400 cursor-pointer'
                    )}
                  >
                    {artist}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recently Observed Tracks */}
          {friendObservedTracks.length > 0 && (
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-2.5">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                Recent Tracks Heard
              </span>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {friendObservedTracks.slice(0, 10).map(({ track, count }) => (
                  <div
                    key={track.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 transition-all text-xs group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Artwork
                        src={track.artwork}
                        seed={track.id}
                        size={67}
                        rounded="rounded-lg"
                        className="w-8 h-8 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{track.title}</div>
                        <div className="text-[10px] text-white/50 truncate">{track.artist}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-white/40 font-mono">
                        {count} {count === 1 ? 'play' : 'plays'}
                      </span>
                      {onPlayTrack && (
                        <button
                          onClick={() => onPlayTrack(track)}
                          className="p-1 rounded-lg bg-white/10 hover:bg-orange-500 hover:text-black transition-all cursor-pointer opacity-0 group-hover:opacity-100"
                          title="Play track"
                        >
                          <Play className="w-3 h-3 fill-current" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer with jump to full stats */}
        <div className="p-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between gap-3">
          {onOpenInFullStats ? (
            <button
              onClick={() => {
                onClose();
                onOpenInFullStats(friend.code);
              }}
              className="px-4 py-2 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-200 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 hover:scale-[1.02] active:scale-95"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Full Comparison in Statistics</span>
            </button>
          ) : (
            <div />
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
