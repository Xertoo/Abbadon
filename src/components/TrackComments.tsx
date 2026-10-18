import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { MessageSquare, Send, Trash2, Loader2, Clock } from 'lucide-react';
import { sc, mapUser, type ScComment } from '../lib/soundcloud';
import { Artwork } from './Artwork';
import type { Track, User } from '../types';

/** One parsed comment enriched with a mapped user. */
export interface Comment {
  id: number;
  body: string;
  createdAt: string;
  /** Playback position of an inline comment, in seconds. Null = not time-stamped. */
  timestamp: number | null;
  user: User;
  isOwn: boolean;
}

function mapComment(raw: ScComment, meId?: string): Comment {
  return {
    id: raw.id,
    body: raw.body,
    createdAt: raw.created_at,
    timestamp: raw.timestamp != null ? raw.timestamp / 1000 : null,
    user: mapUser(raw.user),
    isOwn: meId != null && String(raw.user.id) === meId,
  };
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function fmtTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

interface Props {
  track: Track;
  me: User | null;
  signedIn: boolean;
  /** Called when the user clicks a timestamp – seeks the player to that point. */
  onSeekTo?: (sec: number) => void;
  notify: (msg: string) => void;
  /** Current playback position, so posted comments can be time-stamped. */
  currentTime?: number;
  /** Opens another user's page from their avatar. */
  onOpenUser?: (user: { id: string; username: string; permalinkUrl?: string }) => void;
  /** Opens Settings -> Account, for the signed-out prompt. */
  onRequireSignIn?: () => void;
  /** Starts expanded. The fullscreen drawer passes true. */
  defaultOpen?: boolean;
  /** The drawer supplies its own title, so this one is not drawn. */
  hideHeader?: boolean;
  /** Lets a parent focus the composer when it opens the panel. */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  className?: string;
}

export function TrackComments({
  track,
  me,
  signedIn,
  onSeekTo,
  notify,
  currentTime,
  onOpenUser,
  onRequireSignIn,
  defaultOpen = false,
  hideHeader = false,
  inputRef: inputRefProp,
  className,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [body, setBody] = useState('');
  const [attachTime, setAttachTime] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const localInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = inputRefProp ?? localInputRef;

  /**
   * Fetches the thread.
   *
   * Runs even while the panel is closed, because the count next to the heading
   * needs a list to count and an empty-looking header is what made this look
   * broken. It is one request per track, and the API layer caches it.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sc.trackComments(track.id, 50);
      setComments((res.collection ?? []).map((c) => mapComment(c, me?.id)));
    } catch {
      notify('Could not load comments');
    } finally {
      setLoading(false);
    }
  }, [track.id, me?.id, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // A track switch must not leave the previous thread up while the new one is
  // still in flight.
  useEffect(() => {
    setComments([]);
    setBody('');
    setAttachTime(false);
  }, [track.id]);

  const submit = useCallback(async () => {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const ts = attachTime && currentTime != null ? currentTime : undefined;
      const raw = await sc.postComment(track.id, text, ts);
      setComments((prev) => [mapComment(raw, me?.id), ...prev]);
      setBody('');
      notify('Comment posted');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not post comment');
    } finally {
      setPosting(false);
    }
  }, [body, posting, attachTime, currentTime, track.id, me?.id, notify]);

  const deleteComment = useCallback(
    async (id: number) => {
      try {
        await sc.deleteComment(id);
        setComments((prev) => prev.filter((c) => c.id !== id));
        notify('Comment deleted');
      } catch {
        notify('Could not delete comment');
      }
    },
    [notify]
  );

/**
 * `defaultOpen` covers the drawer, where a collapsed list would be a closed
 * drawer inside a drawer. The standalone variant keeps its own header for the
 * count, which is the only clue that a track has a thread at all.
 */
return (
    <div className={clsx("flex flex-col min-h-0", className)}>
      {!hideHeader && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-[13px] font-semibold text-sc-muted hover:text-sc-fg transition-colors cursor-pointer group shrink-0"
        >
          <MessageSquare
            className={clsx(
              'w-4 h-4 transition-colors',
              open ? 'text-sc-orange' : 'group-hover:text-sc-orange'
            )}
          />
          <span>Comments</span>
          <span className="text-[11px] font-bold text-sc-dim bg-sc-fill/10 px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
            {loading && comments.length === 0 ? (
              <Loader2 className="w-3 h-3 animate-spin inline-block align-[-0.1em]" />
            ) : (
              comments.length
            )}
          </span>
          <span
            className={clsx(
              'ml-1 text-sc-dim transition-transform duration-200',
              open && 'rotate-180'
            )}
          >
            ▾
          </span>
        </button>
      )}

      {open && (
        <div
          className={clsx(
            'flex flex-col min-h-0 flex-1 animate-fade-in',
            hideHeader ? 'pt-3' : 'mt-4'
          )}
        >
          {/* Signed out: commenting needs an auth token, so say why rather than
              showing a composer that would fail on submit. */}
          {!signedIn && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-sc-line bg-sc-panel-2">
              <p className="text-[12px] text-sc-dim flex-1">
                Sign in to comment on this track.
              </p>
              <button
                onClick={onRequireSignIn}
                className="px-3 py-1.5 rounded-full bg-sc-orange text-sc-fg text-[11px] font-bold hover:bg-sc-orange-soft hover:text-sc-bg transition-all active:scale-95 cursor-pointer"
              >
                Sign in
              </button>
            </div>
          )}

          {/* Post a comment */}
          {signedIn && (
            <div className="flex gap-3">
              {me && (
                <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 mt-0.5">
                  <Artwork src={me.avatarUrl} seed={me.id} size={67} rounded="rounded-full" className="w-full h-full" />
                </div>
              )}
              <div className="flex-1 space-y-2">
                <textarea
                  ref={inputRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
                  }}
                  placeholder="Write a comment… (Ctrl+Enter to post)"
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl text-[13px] bg-sc-panel border border-sc-line text-sc-fg placeholder-sc-dim resize-none focus:outline-none focus:border-sc-orange/60 transition-colors"
                />
                <div className="flex items-center gap-3">
                  {currentTime != null && currentTime > 0 && (
                    <label className="flex items-center gap-1.5 text-[12px] text-sc-muted cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={attachTime}
                        onChange={(e) => setAttachTime(e.target.checked)}
                        className="accent-sc-orange"
                      />
                      <Clock className="w-3 h-3" />
                      at {fmtTimestamp(currentTime)}
                    </label>
                  )}
                  <button
                    onClick={() => void submit()}
                    disabled={!body.trim() || posting}
                    className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-sc-orange text-sc-fg text-[12px] font-bold disabled:opacity-40 hover:bg-sc-orange-soft hover:text-sc-bg transition-all active:scale-95 cursor-pointer"
                  >
                    {posting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    Post
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Comment list */}
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-sc-muted" />
            </div>
          ) : comments.length === 0 ? (
            <p className="text-[13px] text-sc-dim py-4">No comments yet.</p>
          ) : (
            <ul className="space-y-3 overflow-y-auto pr-1 overflow-x-clip scroll-rail flex-1 min-h-0">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-3 group/comment">
                  <button
                    className="w-8 h-8 rounded-full overflow-hidden shrink-0 mt-0.5 ring-1 ring-sc-line hover:ring-sc-orange transition-all cursor-pointer disabled:cursor-default disabled:hover:ring-sc-line"
                    onClick={() =>
                      onOpenUser?.({
                        id: c.user.id,
                        username: c.user.username,
                        permalinkUrl: c.user.permalinkUrl,
                      })
                    }
                    title={
                      onOpenUser ? `Open ${c.user.username}` : c.user.username
                    }
                    disabled={!onOpenUser}
                  >
                    <Artwork
                      src={c.user.avatarUrl}
                      seed={c.user.id}
                      size={67}
                      rounded="rounded-full"
                      className="w-full h-full"
                    />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-sc-fg">{c.user.username}</span>
                      {c.timestamp != null && (
                        <button
                          onClick={() => onSeekTo?.(c.timestamp!)}
                          className="flex items-center gap-0.5 text-[11px] text-sc-orange hover:underline cursor-pointer"
                          title="Jump to this moment"
                        >
                          <Clock className="w-2.5 h-2.5" />
                          {fmtTimestamp(c.timestamp)}
                        </button>
                      )}
                      <span className="text-[11px] text-sc-dim">{fmtDate(c.createdAt)}</span>
                    </div>
                    <p className="text-[13px] text-sc-muted mt-0.5 break-words">{c.body}</p>
                  </div>
                  {c.isOwn && (
                    <button
                      onClick={() => void deleteComment(c.id)}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-sc-dim opacity-0 group-hover/comment:opacity-100 hover:text-sc-orange transition-all cursor-pointer shrink-0"
                      title="Delete comment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
