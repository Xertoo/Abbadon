import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { UserPlus, UserCheck, Loader2 } from 'lucide-react';
import { sc, mapUser } from '../lib/soundcloud';
import { Artwork } from './Artwork';
import type { User } from '../types';

interface Props {
  artist: User;
  /** The signed-in account, for the follow button. */
  me: User | null;
  signedIn: boolean;
  onOpenUser?: (user: { id: string; username: string; permalinkUrl?: string }) => void;
  onRequireSignIn?: () => void;
  notify: (msg: string) => void;
}

type Tab = 'followers' | 'followings';

/**
 * Follower / following counts plus the list behind each one.
 *
 * The counts come straight off the artist object and are always visible; the two
 * lists are fetched only when a tab is opened, because a profile page renders on
 * every navigation and two extra requests per view is a lot for a count.
 */
export function ArtistSocial({
  artist,
  me,
  signedIn,
  onOpenUser,
  onRequireSignIn,
  notify,
}: Props) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const isMe = me?.id === artist.id;

  useEffect(() => {
    // A different artist means the previous list belongs to somebody else.
    setTab(null);
    setUsers(null);
  }, [artist.id]);

  const load = useCallback(
    async (which: Tab) => {
      setLoading(true);
      try {
        const res =
          which === 'followers'
            ? await sc.userFollowers(artist.id, 100)
            : await sc.userFollowings(artist.id, 100);
        setUsers((res.collection ?? []).map(mapUser));
      } catch (err) {
        setUsers([]);
        notify(err instanceof Error ? err.message : `Could not load ${which}`);
      } finally {
        setLoading(false);
      }
    },
    [artist.id, notify]
  );

  const pick = (which: Tab) => {
    if (tab === which) {
      setTab(null);
      return;
    }
    setTab(which);
    // Fetch on first open of this artist; the list is kept for tab switches.
    if (users === null) void load(which);
  };

  /**
   * Whether the signed-in user already follows this artist.
   *
   * The relationship is not on the artist object, so it is derived from the
   * "following" list once that has been fetched. `null` means unknown, which is
   * why the button reads "Follow" rather than claiming a state it has not
   * verified - guessing wrong and showing "Unfollow" would fire the wrong request.
   */
  const [followsThem, setFollowsThem] = useState<boolean | null>(null);

  useEffect(() => {
    setFollowsThem(null);
    if (!signedIn || isMe) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await sc.userFollowings(me!.id, 800);
        if (cancelled) return;
        setFollowsThem((res.collection ?? []).some((u) => String(u.id) === artist.id));
      } catch {
        /* stays unknown; the button defaults to the safe action */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artist.id, me, signedIn, isMe]);

  /**
   * Follow / unfollow.
   *
   * `followersCount` is patched locally rather than re-fetched: the endpoint
   * returns no new total, and reloading the list would collapse the panel the
   * user is looking at.
   */
  const toggleFollow = async () => {
    if (!signedIn) {
      onRequireSignIn?.();
      return;
    }
    if (!me || isMe || busy) return;
    const following = followsThem === true;
    setBusy(true);
    try {
      if (following) await sc.unfollowUser(artist.id);
      else await sc.followUser(artist.id);
      setFollowsThem(!following);
      notify(following ? `Unfollowed ${artist.username}` : `Following ${artist.username}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update follow');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="flex items-center gap-3">
        <Stat
          label="Followers"
          value={artist.followersCount}
          active={tab === 'followers'}
          onClick={() => pick('followers')}
        />
        <Stat
          label="Following"
          value={artist.followingsCount}
          active={tab === 'followings'}
          onClick={() => pick('followings')}
          // The count is omitted on many responses, so this tab has to stay
          // reachable even when the number is unknown.
          unknownLabel={artist.followingsCount === undefined}
        />
      </div>

      {!isMe && signedIn && (
        <button
          onClick={() => void toggleFollow()}
          disabled={busy}
          className={clsx(
            'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95 cursor-pointer disabled:opacity-60',
            followsThem
              ? 'bg-sc-fill/10 text-sc-muted hover:text-sc-fg'
              : 'bg-sc-orange text-sc-fg hover:bg-sc-orange-soft hover:text-sc-bg'
          )}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : followsThem ? (
            <UserCheck className="w-3.5 h-3.5" />
          ) : (
            <UserPlus className="w-3.5 h-3.5" />
          )}
          {followsThem ? 'Following' : 'Follow'}
        </button>
      )}

      {tab && (
        <div className="w-full basis-full mt-1 animate-fade-in">
          <div className="rounded-xl border border-sc-line bg-sc-panel overflow-hidden">
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-sc-line">
              {(['followers', 'followings'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => pick(t)}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer capitalize',
                    tab === t
                      ? 'bg-sc-orange/15 text-sc-orange-soft'
                      : 'text-sc-dim hover:text-sc-fg'
                  )}
                >
                  {t}
                </button>
              ))}
              <button
                onClick={() => setTab(null)}
                className="ml-auto text-[11px] text-sc-dim hover:text-sc-fg transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-sc-muted" />
              </div>
            ) : !users?.length ? (
              <p className="text-[12px] text-sc-dim px-3 py-4">
                No {tab} yet.
              </p>
            ) : (
              <ul className="max-h-[260px] overflow-y-auto divide-y divide-sc-line/60 overflow-x-clip scroll-rail">
                {users.map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={() =>
                        onOpenUser?.({
                          id: u.id,
                          username: u.username,
                          permalinkUrl: u.permalinkUrl,
                        })
                      }
                      disabled={!onOpenUser}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-sc-fill/5 transition-colors disabled:cursor-default disabled:hover:bg-transparent group/u"
                    >
                      <div className="w-7 h-7 rounded-full overflow-hidden shrink-0">
                        <Artwork
                          src={u.avatarUrl}
                          seed={u.id}
                          size={67}
                          rounded="rounded-full"
                          className="w-full h-full"
                        />
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-semibold text-sc-fg truncate group-hover/u:text-sc-orange-soft transition-colors">
                          {u.username}
                        </span>
                        {u.fullName !== u.username && (
                          <span className="block text-[10px] text-sc-dim truncate">
                            {u.fullName}
                          </span>
                        )}
                      </span>
                      {me?.id === u.id && (
                        <span className="text-[10px] font-bold text-sc-orange-soft shrink-0">
                          you
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      </div>
  );
}

function Stat({
  label,
  value,
  active,
  onClick,
  unknownLabel,
}: {
  label: string;
  value: number | undefined;
  active: boolean;
  onClick: () => void;
  unknownLabel?: boolean;
}) {
  const display =
    value === undefined
      ? unknownLabel
        ? '–'
        : '0'
      : value >= 1000
        ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
        : String(value);

  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-baseline gap-1.5 rounded-lg px-1.5 py-0.5 -mx-1.5 transition-colors cursor-pointer',
        active ? 'text-sc-orange-soft' : 'hover:text-sc-fg'
      )}
      title={value === undefined ? `${label}: not reported` : `${label}: ${value}`}
    >
      <span className="text-[13px] font-bold tabular-nums">{display}</span>
      <span className={clsx('text-[11px]', active ? 'text-sc-orange-soft' : 'text-sc-dim')}>
        {label}
      </span>
    </button>
  );
}