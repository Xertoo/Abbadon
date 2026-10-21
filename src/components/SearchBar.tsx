import { useEffect, useRef, useState, startTransition } from 'react';
import { Search, Loader2, X, Play, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { sc } from '../lib/soundcloud';
import { playTypingSound } from '../lib/typingAudio';
import type { Track } from '../types';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: (q: string) => void;
  onPlayTrack?: (track: Track) => void;
  loading: boolean;
  isMusicPlaying?: boolean;
  typingSoundEnabled?: boolean;
  typingSoundVolume?: number;
  typingSoundSwitch?: 'tactile' | 'clicky' | 'thock' | 'typewriter';
  placeholder?: string;
  ariaLabel?: string;
}

export function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  onPlayTrack,
  loading,
  isMusicPlaying = false,
  typingSoundEnabled = true,
  typingSoundVolume = 0.6,
  typingSoundSwitch = 'tactile',
  placeholder,
  ariaLabel,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [localQuery, setLocalQuery] = useState(query);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [suggestions, setSuggestions] = useState<{ queries: string[]; tracks: Track[] }>({
    queries: [],
    tracks: [],
  });
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Sync external query changes (e.g. from history navigation or clearing)
  useEffect(() => {
    if (query !== localQuery) {
      setLocalQuery(query);
    }
  }, [query]);

  // Handle typing input with zero latency and mechanical switch sound
  const handleInputChange = (val: string) => {
    setLocalQuery(val);

    // Typing animation state with auto-reset
    setIsTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 650);

    // Mark parent state update with low priority transition so typing is never blocked
    startTransition(() => {
      onQueryChange(val);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Play mechanical click only when music is NOT playing and feature is enabled
    if (typingSoundEnabled && !isMusicPlaying && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter' || e.key === ' ') {
        playTypingSound(e.key, typingSoundVolume, typingSoundSwitch);
      }
    }
  };

  // Debounced live suggestions with abort controller to eliminate lag and network thrashing
  useEffect(() => {
    const trimmed = localQuery.trim();
    if (trimmed.length < 2) {
      setSuggestions({ queries: [], tracks: [] });
      setLoadingSuggestions(false);
      return;
    }

    setLoadingSuggestions(true);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const ac = new AbortController();
    abortControllerRef.current = ac;

    const timer = setTimeout(async () => {
      if (ac.signal.aborted) return;
      try {
        const res = await sc.getSearchSuggestions(trimmed);
        if (!ac.signal.aborted) {
          setSuggestions(res);
        }
      } catch {
        if (!ac.signal.aborted) {
          setSuggestions({ queries: [], tracks: [] });
        }
      } finally {
        if (!ac.signal.aborted) {
          setLoadingSuggestions(false);
        }
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [localQuery]);

  // Click outside listener
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        ref.current?.focus();
      }
      if (e.key === 'Escape') {
        ref.current?.blur();
        setFocused(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hasSuggestions =
    focused && localQuery.trim().length >= 2 && (suggestions.queries.length > 0 || suggestions.tracks.length > 0);

  return (
    <div ref={containerRef} className="relative w-full z-50">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFocused(false);
          setIsTyping(false);
          onSubmit(localQuery);
        }}
        className={clsx(
          'group relative flex items-center gap-3 h-10 px-4 rounded-full border transition-all duration-200 w-full',
          isTyping
            ? 'bg-sc-panel-2 border-sc-orange shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-sc-orange)_30%,transparent),0_0_22px_color-mix(in_oklab,var(--color-sc-orange)_35%,transparent)]'
            : focused
            ? 'bg-sc-panel-2 border-sc-orange/80 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-sc-orange)_18%,transparent),0_4px_16px_-4px_rgba(0,0,0,0.3)]'
            : 'bg-sc-panel/80 hover:bg-sc-panel border-sc-line hover:border-sc-dim/70 shadow-sm'
        )}
      >
        {loading || loadingSuggestions ? (
          <Loader2 className="w-4 h-4 text-sc-orange animate-spin-slow shrink-0" />
        ) : (
          <Search
            className={clsx(
              'w-4 h-4 shrink-0 transition-all duration-200',
              isTyping
                ? 'text-sc-orange scale-110 rotate-[-8deg] drop-shadow-[0_0_8px_var(--color-sc-orange)]'
                : focused
                ? 'text-sc-orange scale-105'
                : 'text-sc-muted group-hover:text-sc-fg'
            )}
          />
        )}
        <input
          ref={ref}
          value={localQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          placeholder={placeholder ?? 'Search tracks, artists, or paste a SoundCloud link...'}
          aria-label={ariaLabel ?? 'Search SoundCloud'}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 bg-transparent text-[13px] text-sc-fg placeholder:text-sc-dim/80 outline-none min-w-0"
        />

        {/* Dynamic Typing Equalizer Wave Animation */}
        {isTyping && (
          <div
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-sc-orange/15 border border-sc-orange/30 shrink-0 animate-fade-in"
            title="Typing..."
          >
            <span className="w-1 h-2.5 rounded-full bg-sc-orange animate-pulse" style={{ animationDuration: '600ms' }} />
            <span className="w-1 h-4 rounded-full bg-sc-orange animate-pulse" style={{ animationDuration: '450ms', animationDelay: '120ms' }} />
            <span className="w-1 h-2 rounded-full bg-sc-orange animate-pulse" style={{ animationDuration: '650ms', animationDelay: '240ms' }} />
          </div>
        )}

        {localQuery && (
          <button
            type="button"
            onClick={() => {
              setLocalQuery('');
              onQueryChange('');
              setSuggestions({ queries: [], tracks: [] });
              ref.current?.focus();
            }}
            className="w-5 h-5 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-fg hover:bg-sc-fill/10 transition-all duration-150 hover:scale-110 active:scale-90 animate-scale-in shrink-0 cursor-pointer"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <kbd className="hidden md:inline-flex items-center justify-center min-w-[20px] h-5 text-[10px] font-semibold text-sc-dim bg-sc-fill/5 border border-sc-line rounded px-1.5 shrink-0 select-none shadow-xs">
          /
        </kbd>
      </form>

      {/* Instant Suggestions Dropdown - 100% opaque solid background & top z-index */}
      {hasSuggestions && (
        <div className="absolute left-0 right-0 top-12 z-[100] bg-[#121218] border border-white/10 rounded-2xl shadow-[0_25px_60px_-10px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.08)] p-2.5 animate-in fade-in-0 zoom-in-95 duration-150 overflow-hidden">
          {/* Query Suggestions */}
          {suggestions.queries.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sc-dim/70 flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3 text-sc-orange" /> Suggestions
              </div>
              <div className="flex flex-col gap-0.5">
                {suggestions.queries.slice(0, 4).map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setLocalQuery(q);
                      onQueryChange(q);
                      setFocused(false);
                      setIsTyping(false);
                      onSubmit(q);
                    }}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-left text-[13px] text-sc-fg hover:bg-sc-fill/10 hover:text-sc-orange transition-colors cursor-pointer group"
                  >
                    <Search className="w-3.5 h-3.5 text-sc-dim group-hover:text-sc-orange transition-colors shrink-0" />
                    <span className="truncate">{q}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Direct Matching Tracks */}
          {suggestions.tracks.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sc-dim/70 flex items-center gap-1.5">
                <Play className="w-3 h-3 text-sc-orange" /> Top Matching Tracks
              </div>
              <div className="flex flex-col gap-1">
                {suggestions.tracks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setFocused(false);
                      setIsTyping(false);
                      if (onPlayTrack) {
                        onPlayTrack(t);
                      } else {
                        onSubmit(t.title);
                      }
                    }}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-sc-fill/10 transition-all cursor-pointer group"
                  >
                    <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-sc-panel-2 border border-sc-line/40">
                      {t.artwork ? (
                        <img src={t.artwork} alt={t.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-sc-panel-2 flex items-center justify-center">
                          <Play className="w-3.5 h-3.5 text-sc-dim" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Play className="w-4 h-4 text-white fill-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-sc-fg group-hover:text-sc-orange transition-colors truncate">
                        {t.title}
                      </div>
                      <div className="text-[11px] text-sc-muted truncate">{t.artist}</div>
                    </div>
                    {t.durationFormatted && (
                      <span className="text-[11px] text-sc-dim tabular-nums shrink-0">{t.durationFormatted}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}