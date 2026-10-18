import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Loader2, Search, RefreshCw, Music4, X } from 'lucide-react';
import type { Track } from '../types';
import {
  fetchLyrics,
  cachedLyrics,
  rememberLyrics,
  activeLineIndex,
  type Lyrics,
} from '../lib/lyrics';

interface Props {
  track: Track | null;
  /** Playback position in seconds. Drives the highlight when lyrics are synced. */
  currentTime: number;
  isPlaying: boolean;
  /** Seeks the player, used when a line is clicked. */
  onSeek?: (sec: number) => void;
  notify: (msg: string) => void;
  /** Starts expanded. */
  defaultOpen?: boolean;
  /** No collapse header, for a panel placed in the flow on purpose. */
  inline?: boolean;
  /**
   * Renders nothing at all unless lyrics were found.
   *
   * Most tracks have none, and an empty "No lyrics found" block in the middle of
   * the now-playing view is worse than silence - it reads as a broken panel
   * rather than an absent feature. The lookup still happens, because that is the
   * only way to know.
   */
  hideWhenEmpty?: boolean;
  /** Scroll height cap, so the caller can size the panel. */
  maxHeightClass?: string;
  /**
   * Covers its parent instead of taking space in the flow.
   *
   * The parent must be `relative`. While closed the panel draws a small chip in
   * the corner of whatever it covers, so the affordance exists only for tracks
   * that really do have lyrics.
   */
  cover?: boolean;
  onCloseCover?: () => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; lyrics: Lyrics }
  | { kind: 'missing' }
  | { kind: 'error' };

/**
 * Lyrics.
 *
 * Lookup is lazy but not optional: the view has to know whether a track has
 * lyrics before it can decide whether to offer them, so the request goes out on
 * mount and the panel simply renders nothing until it lands.
 */
export function LyricsPanel({
  track,
  currentTime,
  isPlaying,
  onSeek,
  notify,
  defaultOpen = false,
  inline = false,
  hideWhenEmpty = false,
  maxHeightClass,
  cover = false,
  onCloseCover,
}: Props) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [follow, setFollow] = useState(true);
  const [covering, setCovering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  // Cover mode has its own open flag because it is a layer over the artwork
  // rather than a section of the page.
  const open = cover ? covering : inline || expanded;

  const run = useCallback(
    async (t: Track, force = false) => {
      if (!force) {
        const hit = cachedLyrics(t);
        // `undefined` means "not looked up yet"; `null` means "looked up, nothing
        // there". The difference decides whether a retry button is worth showing.
        if (hit !== undefined) {
          setState(hit ? { kind: 'ready', lyrics: hit } : { kind: 'missing' });
          return;
        }
      }

      setState({ kind: 'loading' });
      try {
        const lyrics = await fetchLyrics(t);
        rememberLyrics(t.id, lyrics);
        setState(lyrics ? { kind: 'ready', lyrics } : { kind: 'missing' });
      } catch (err) {
        setState({ kind: 'error' });
        notify(err instanceof Error ? err.message : 'Could not load lyrics');
      }
    },
    [notify]
  );

  // Reset on track change so a stale result is never shown under a new title.
  useEffect(() => {
    setState({ kind: 'idle' });
    setFollow(true);
    setCovering(false);
  }, [track?.id]);

  // The lookup runs even while closed: "does this track have lyrics" is what
  // decides whether the cover chip is drawn at all.
  useEffect(() => {
    if (track && state.kind === 'idle') void run(track);
  }, [track, state.kind, run]);

  const lines = state.kind === 'ready' ? state.lyrics.lines : [];
  const synced = state.kind === 'ready' && state.lyrics.synced;
  const active = useMemo(() => activeLineIndex(lines, currentTime), [lines, currentTime]);

  /**
   * Keeps the active line centred.
   *
   * `nearest` is what makes this readable rather than just functional: without
   * it the highlight sits wherever it happens to be and the user has to hunt.
   */
  useEffect(() => {
    if (!open || !follow) return;
    const container = scrollRef.current;
    if (!container) return;
    if (active <= 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const node = activeRef.current;
    if (!node) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const relativeTop = nodeRect.top - containerRect.top + container.scrollTop;
    const target = relativeTop - container.clientHeight / 2 + node.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [active, open, follow]);

  /**
   * Nothing to show.
   *
   * Only the found-and-has-text states render. That covers the lookup itself, the
   * instrumental case and the failure case - an empty box in the middle of the
   * now-playing view reads as something being broken rather than a track that
   * simply has no lyrics.
   */
  const hasContent =
    state.kind === 'ready' &&
    !state.lyrics.instrumental &&
    (state.lyrics.synced || Boolean(state.lyrics.plain.trim()));

  if (hideWhenEmpty && !hasContent) return null;

  const linesView = (
    <ul
      className={clsx(
        cover
          ? 'space-y-3 pt-6 pb-[45vh] px-4'
          : 'space-y-1.5 py-2 pb-[35vh]'
      )}
    >
      {lines.map((line, i) => {
        const isActive = i === active;
        return (
          <li
            key={`${line.time}-${i}`}
            ref={isActive ? activeRef : undefined}
            onClick={() => onSeek?.(line.time)}
            className={clsx(
              'rounded-lg cursor-pointer transition-all duration-300 ease-out will-change-transform',
              cover
                ? clsx(
                    'px-3 py-1.5 text-center',
                    isActive
                      ? 'text-sc-orange-soft font-extrabold scale-105 drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]'
                      : 'text-sc-muted/45 blur-[1.5px] hover:blur-0 hover:text-sc-fg'
                  )
                : clsx(
                    'text-[14px] leading-snug px-2 py-1',
                    isActive
                      ? 'text-sc-orange-soft font-semibold bg-sc-orange/10 translate-x-0.5'
                      : 'text-sc-dim hover:text-sc-muted hover:bg-sc-fill/5'
                  )
            )}
          >
            {line.text || <span className="opacity-40">♪</span>}
          </li>
        );
      })}
    </ul>
  );

  if (cover) {
    // Nothing to draw until the lookup answers: no chip, no layer.
    if (state.kind !== 'ready') return null;

    // Closed: just the chip, floating over whatever this panel covers.
    if (!covering) {
      if (!hasContent) return null;
      return (
        <button
          onClick={() => setCovering(true)}
          className="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sc-bg/70 backdrop-blur-md border border-sc-line/70 text-[11px] font-bold text-sc-fg hover:border-sc-orange/60 hover:text-sc-orange-soft transition-all duration-200 active:scale-95 cursor-pointer animate-fade-in"
          title="Show the lyrics over the artwork"
        >
          <Music4 className="w-3.5 h-3.5" />
          Lyrics
        </button>
      );
    }

    return (
      <div className="absolute inset-0 z-20 flex flex-col rounded-3xl overflow-hidden animate-fade-in">
        <div className="absolute inset-0 bg-sc-bg/80 backdrop-blur-xl" />
        <div className="absolute inset-0 bg-gradient-to-b from-sc-bg/40 via-transparent to-sc-bg/70" />

        <div className="relative flex items-center gap-2 px-4 py-2.5 border-b border-sc-line/50 shrink-0">
          <Music4 className="w-3.5 h-3.5 text-sc-orange shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-sc-muted">
            Lyrics
          </span>
          {state.lyrics.synced && (
            <span className="text-[10px] font-bold text-sc-dim uppercase tracking-wide">
              Synced
            </span>
          )}
          <button
            onClick={() => {
              setCovering(false);
              onCloseCover?.();
            }}
            aria-label="Hide the lyrics"
            title="Hide the lyrics"
            className="ml-auto w-7 h-7 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-fg hover:bg-sc-fill/10 transition-all duration-150 active:scale-90 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="relative flex-1 min-h-0 overflow-y-auto px-4 overflow-x-clip scroll-rail"
        >
          {state.lyrics.synced ? (
            linesView
          ) : (
            <p className="text-[13px] text-sc-muted whitespace-pre-wrap leading-relaxed py-4 text-center">
              {state.lyrics.plain}
            </p>
          )}
        </div>

        {/* Only while audio runs - there is no position to follow when paused. */}
        {state.lyrics.synced && isPlaying && (
          <label className="relative flex items-center gap-2 px-4 py-2 text-[10px] text-sc-dim cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="accent-sc-orange"
            />
            Auto-scroll
          </label>
        )}
      </div>
    );
  }

  const content = !track ? (
    <p className="text-[13px] text-sc-dim py-3">Nothing playing.</p>
  ) : state.kind === 'loading' || state.kind === 'idle' ? (
    <div className="flex items-center justify-center py-8 gap-2 text-sc-dim text-[13px]">
      <Loader2 className="w-4 h-4 animate-spin" />
      Searching for lyrics…
    </div>
  ) : state.kind === 'error' ? (
    <div className="flex items-center gap-3 py-4">
      <p className="text-[13px] text-sc-dim flex-1">
        Could not reach the lyrics database.
      </p>
      <button
        onClick={() => void run(track, true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-sc-line text-[11px] font-semibold text-sc-muted hover:text-sc-fg hover:bg-sc-fill/5 transition-colors cursor-pointer"
      >
        <RefreshCw className="w-3 h-3" />
        Retry
      </button>
    </div>
  ) : state.kind === 'missing' ? (
    <div className="flex items-center gap-3 py-4">
      <p className="text-[13px] text-sc-dim flex-1">
        No lyrics found for “{track.title}”.
      </p>
      <button
        onClick={() => void run(track, true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-sc-line text-[11px] font-semibold text-sc-muted hover:text-sc-fg hover:bg-sc-fill/5 transition-colors cursor-pointer"
      >
        <Search className="w-3 h-3" />
        Search again
      </button>
    </div>
  ) : state.lyrics.instrumental ? (
    <p className="text-[13px] text-sc-dim py-4 italic">Instrumental — no lyrics for this track.</p>
  ) : state.lyrics.synced ? (
    <div
      ref={scrollRef}
      className={clsx(
        'relative flex-1 min-h-0 overflow-y-auto pr-2 overflow-x-clip scroll-rail',
        maxHeightClass ?? 'max-h-[340px]'
      )}
    >
      {linesView}
    </div>
  ) : (
    <p
      className={clsx(
        'text-[13px] text-sc-muted whitespace-pre-wrap leading-relaxed',
        maxHeightClass && 'overflow-y-auto overflow-x-clip scroll-rail'
      )}
    >
      {state.lyrics.plain}
    </p>
  );

  // Inline mode is a fixed slot: the lyrics arrive on their own once the lookup
  // lands, so a heading would be a placeholder for something that may never come.
  if (inline) {
    return (
      <div className="animate-fade-in">
        {state.kind === 'ready' && (
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sc-dim">
            <Music4 className="w-3 h-3" />
            Lyrics
            {state.lyrics.synced && (
              <span className="text-sc-orange/80 normal-case tracking-normal">synced</span>
            )}
          </div>
        )}
        {content}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-[13px] font-semibold text-sc-muted hover:text-sc-fg transition-colors cursor-pointer group"
      >
        <Music4
          className={clsx(
            'w-4 h-4 transition-colors',
            expanded ? 'text-sc-orange' : 'group-hover:text-sc-orange'
          )}
        />
        <span>Lyrics</span>
        {synced && (
          <span className="text-[10px] font-bold text-sc-dim bg-sc-fill/10 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
            Synced
          </span>
        )}
        <span
          className={clsx(
            'ml-1 text-sc-dim transition-transform duration-200',
            expanded && 'rotate-180'
          )}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-4 animate-fade-in">
          {content}
          {synced && isPlaying && (
            <label className="mt-3 flex items-center gap-2 text-[11px] text-sc-dim cursor-pointer select-none">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
                className="accent-sc-orange"
              />
              Auto-scroll
            </label>
          )}
        </div>
      )}
    </div>
  );
}
