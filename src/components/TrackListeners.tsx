import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Users, Loader2, Radio } from 'lucide-react';
import { sc, mapUser } from '../lib/soundcloud';
import { Artwork } from './Artwork';
import type { Track, User } from '../types';

interface Props {
  track: Track | null;
  isPlaying: boolean;
  onOpenUser?: (user: { id: string; username: string; permalinkUrl?: string }) => void;
  /** Starts expanded. The fullscreen tab passes true. */
  defaultOpen?: boolean;
  /**
   * Compact avatar row with no heading, and nothing rendered when the list comes
   * back empty.
   *
   * The now-playing view only has room for this if it earns its place: a track
   * nobody has liked yet should leave no gap in the layout.
   */
  inline?: boolean;
}

interface Listener {
  user: User;
  /** Epoch ms, or null when the source did not say. */
  at: number | null;
}

/**
 * "Who else is listening" panel.
 *
 * SoundCloud has no live-listener endpoint, and nothing in the public API can
 * say who is playing a track at this moment. What it does expose is who liked
 * it and who follows the artist, and both are ordered by recency, so this panel
 * reports those as a recent-audience list rather than inventing a presence
 * signal. The heading and the tooltip both say so, because a panel titled
 * "listening now" that is really a likes list would be a lie about the data.
 */
export function TrackListeners({
  track,
  isPlaying,
  onOpenUser,
  defaultOpen = false,
  inline = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen || inline);
  const [loading, setLoading] = useState(false);
  const [listeners, setListeners] = useState<Listener[]>([]);

  const load = useCallback(async () => {
    if (!track) return;
    setLoading(true);
    try {
      const [likesRes, fansRes] = await Promise.allSettled([
        sc.trackLikes(track.id, 24),
        track.artistId ? sc.artistFans(track.artistId, 10) : Promise.reject(new Error('no artist')),
      ]);

      const out: Listener[] = [];
      const seen = new Set<string>();

      if (likesRes.status === 'fulfilled') {
        for (const entry of likesRes.value.collection ?? []) {
          if (!entry?.user) continue;
          const id = String(entry.user.id);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({
            user: mapUser(entry.user),
            at: entry.created_at ? new Date(entry.created_at).getTime() : null,
          });
        }
      }

      // Only pad from the artist's followers when the likes list is thin. These
      // are not listeners and are marked so in the row.
      if (out.length < 6 && fansRes.status === 'fulfilled') {
        for (const fan of fansRes.value.collection ?? []) {
          const id = String(fan.id);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ user: mapUser(fan), at: null });
        }
      }

      // Newest first, but rows with no date go last rather than sorting as 1970.
      out.sort((a, b) => (b.at ?? -1) - (a.at ?? -1));
      setListeners(out.slice(0, 18));
    } catch {
      setListeners([]);
    } finally {
      setLoading(false);
    }
  }, [track]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  if (inline) {
    if (loading || listeners.length === 0) return null;
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sc-dim">
          <Users className="w-3 h-3" />
          Recent audience
        </div>
        <div className="flex flex-wrap gap-1.5">
          {listeners.slice(0, 10).map((l) => (
            <button
              key={l.user.id}
              onClick={() =>
                onOpenUser?.({
                  id: l.user.id,
                  username: l.user.username,
                  permalinkUrl: l.user.permalinkUrl,
                })
              }
              disabled={!onOpenUser}
              title={
                onOpenUser
                  ? `Open ${l.user.username}`
                  : `${l.user.username} - ${
                      l.at != null ? 'liked recently' : 'follows the artist'
                    }`
              }
              className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-sc-line hover:ring-sc-orange transition-all hover:scale-110 active:scale-95 cursor-pointer disabled:cursor-default disabled:hover:ring-sc-line disabled:hover:scale-100"
            >
              <Artwork
                src={l.user.avatarUrl}
                seed={l.user.id}
                size={67}
                rounded="rounded-full"
                className="w-full h-full"
              />
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-sc-dim leading-relaxed">
          People who liked this track recently, and the artist&rsquo;s followers.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[13px] font-semibold text-sc-muted hover:text-sc-fg transition-colors cursor-pointer group"
      >
        <Users
          className={clsx(
            'w-4 h-4 transition-colors',
            open ? 'text-sc-orange' : 'group-hover:text-sc-orange'
          )}
        />
        <span>Audience</span>
        {listeners.length > 0 && (
          <span className="text-[11px] font-bold text-sc-dim bg-sc-fill/10 px-1.5 py-0.5 rounded-full">
            {listeners.length}
          </span>
        )}
        <span
          className={clsx(
            'ml-1 text-sc-dim transition-transform duration-200',
            open && 'rotate-180'
          )}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-4 animate-fade-in">
          <p className="text-[11px] text-sc-dim mb-3 flex items-start gap-1.5 leading-relaxed">
            <Radio className="w-3.5 h-3.5 shrink-0 mt-px text-sc-dim" />
            <span>
              SoundCloud does not publish live listeners. These are the people who
              liked this track most recently, plus the artist&rsquo;s followers.
            </span>
          </p>

          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-sc-muted" />
            </div>
          ) : listeners.length === 0 ? (
            <p className="text-[13px] text-sc-dim py-3">No audience data yet.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {listeners.map((l) => (
                <li key={l.user.id}>
                  <button
                    onClick={() =>
                      onOpenUser?.({
                        id: l.user.id,
                        username: l.user.username,
                        permalinkUrl: l.user.permalinkUrl,
                      })
                    }
                    disabled={!onOpenUser}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-sc-fill/5 transition-colors disabled:cursor-default disabled:hover:bg-transparent group/listener"
                    title={
                      onOpenUser ? `Open ${l.user.username}` : l.user.username
                    }
                  >
                    <div className="relative w-8 h-8 shrink-0">
                      <Artwork
                        src={l.user.avatarUrl}
                        seed={l.user.id}
                        size={67}
                        rounded="rounded-full"
                        className="w-full h-full"
                      />
                      {/*
                        Pulsing only while this track is the one playing, so the
                        dot means "playing here" rather than "on the site".
                      */}
                      {isPlaying && l.at != null && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-sc-orange ring-2 ring-sc-bg animate-ping" />
                      )}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-sc-fg truncate group-hover/listener:text-sc-orange-soft transition-colors">
                        {l.user.username}
                      </span>
                      <span className="block text-[10px] text-sc-dim">
                        {l.at != null ? 'liked recently' : 'follows the artist'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}