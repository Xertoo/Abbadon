import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderPlus, Loader2, Plus, Check } from 'lucide-react';
import clsx from 'clsx';
import type { Playlist, Track } from '../types';

interface Props {
  track: Track;
  playlists: Playlist[];
  /** `${playlistId}:${trackId}` of the request in flight, used for the spinner. */
  busy: string | null;
  signedIn: boolean;
  onLogin: () => void;
  onAdd: (playlist: Playlist, track: Track) => void;
  /** Returns the new playlist, so the track can go straight into it. */
  onCreate: (title: string) => Playlist | null | Promise<Playlist | null>;
  /** Removes the row's own remove action when the track is already in it. */
  onRemove?: (playlist: Playlist, track: Track) => void;
  inPlaylists?: string[];
  /**
   * Keeps the trigger visible at rest.
   *
   * Row actions are hover-revealed, but the player bar and the fullscreen view
   * have no `group` ancestor to hover, so without this the control would never
   * reach full opacity and would look like it is missing entirely.
   */
  alwaysVisible?: boolean;
  className?: string;
}

/**
 * "Add to playlist" row action plus its picker.
 *
 * A modal rather than a nested menu: a row is not tall enough for a playlist
 * list, and a dropdown opened next to the last row would fall off the bottom
 * of the window. Creating a playlist without leaving the picker is included
 * because "save this" is most often the first action someone wants.
 */
export function PlaylistAddButton({
  track,
  playlists,
  busy,
  signedIn,
  onLogin,
  onAdd,
  onCreate,
  onRemove,
  inPlaylists,
  alwaysVisible,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  /**
   * Escape closes, and focus goes back to the row button that opened the dialog.
   *
   * Focus restore matters here because the trigger is a hover-revealed row
   * action: without it, dismissing the dialog leaves focus on <body> and the
   * next Tab restarts from the top of the sidebar.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return () => trigger.current?.focus();
  }, [open]);

  if (!signedIn) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onLogin();
        }}
        title="Sign in to save this track"
        aria-label="Sign in to add to a playlist"
        className={clsx(
          'w-8 h-8 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-orange transition-all',
          alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          className
        )}
      >
        <FolderPlus className="w-[15px] h-[15px]" />
      </button>
    );
  }

  /**
   * Creates the playlist and immediately files the track into it, because the
   * whole point of opening the picker from a track row is to save that track -
   * stopping at an empty playlist makes the user pick the track a second time.
   */
  const submit = async (value: string) => {
    const name = value.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const made = await onCreate(name);
      if (made) {
        onAdd(made, track);
        setOpen(false);
      }
    } finally {
      setCreating(false);
      setTitle('');
    }
  };

  const create = (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void submit(title);
      }}
      disabled={!title.trim() || creating}
      className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-sc-orange/15 text-sc-orange-soft border border-sc-orange/50 transition-all hover:brightness-110 disabled:opacity-40 shrink-0 inline-flex items-center gap-1.5"
    >
      {creating && <Loader2 className="w-3.5 h-3.5 animate-spin-slow" />}
      Create
    </button>
  );

  return (
    <>
      <button
        ref={trigger}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Add to a playlist"
        aria-label={`Add ${track.title} to a playlist`}
        className={clsx(
          'w-8 h-8 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-fg transition-all shrink-0',
          alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          className
        )}
      >
        <FolderPlus className="w-[15px] h-[15px]" />
      </button>

      {open &&
        createPortal(
          // Portalled to <body> because the trigger sits inside lists and the
          // player bar, whose `backdrop-filter`/`transform` would otherwise
          // become the containing block for this `fixed` overlay - trapping the
          // dialog inside a single row or the footer instead of the viewport.
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in"
            onClick={() => setOpen(false)}
          >
          <div
            className="w-full max-w-[380px] rounded-2xl border border-sc-line bg-sc-panel p-4 shadow-2xl animate-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Add ${track.title} to a playlist`}
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[13px] font-bold text-sc-fg truncate">
                Add &quot;{track.title}&quot;
              </h4>
              <button
                onClick={() => setOpen(false)}
                className="text-sc-dim hover:text-sc-fg transition-colors shrink-0"
                aria-label="Close"
              >
                <Plus className="w-4 h-4 rotate-45" />
              </button>
            </div>

            {playlists.length === 0 ? (
              <p className="text-[12px] text-sc-dim py-2">
                You have no playlists yet - name one below and this track goes in.
              </p>
            ) : (
              <div className="flex flex-col gap-1 max-h-[240px] overflow-y-auto">
                {playlists.map((ap) => {
                  const isIn = inPlaylists?.includes(ap.id);
                  const isBusy = busy === `${ap.id}:${track.id}`;
                  return (
                    <div key={ap.id} className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // Already there: the only sensible action is removal,
                          // so the row toggles instead of silently doing nothing.
                          if (isIn && onRemove) onRemove(ap, track);
                          else onAdd(ap, track);
                          setOpen(false);
                        }}
                        className="flex-1 flex items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-sc-fill/6 transition-colors min-w-0"
                      >
                        <span className="text-[12px] text-sc-fg truncate">{ap.title}</span>
                        <span className="flex items-center gap-1.5 shrink-0 ml-2">
                          {isBusy && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin-slow text-sc-orange" />
                          )}
                          {isIn && <Check className="w-3.5 h-3.5 text-sc-orange" />}
                          <span className="text-[10px] text-sc-dim">{ap.trackCount} tracks</span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-sc-line flex gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit(title);
                }}
                placeholder="New playlist name"
                aria-label="New playlist name"
                className="flex-1 rounded-lg border border-sc-line bg-sc-bg px-2.5 py-1.5 text-[12px] text-sc-fg outline-none focus:border-sc-orange/60"
              />
              {create}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}