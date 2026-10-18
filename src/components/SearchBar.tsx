import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: (q: string) => void;
  loading: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

export function SearchBar({ query, onQueryChange, onSubmit, loading, placeholder, ariaLabel }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        ref.current?.focus();
      }
      if (e.key === 'Escape') ref.current?.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(query);
      }}
      className={clsx(
        'group relative flex items-center gap-3 h-10 px-4 rounded-full border transition-all duration-200 w-full',
        focused
          ? 'bg-sc-panel-2 border-sc-orange/80 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-sc-orange)_18%,transparent),0_4px_16px_-4px_rgba(0,0,0,0.3)]'
          : 'bg-sc-panel/80 hover:bg-sc-panel border-sc-line hover:border-sc-dim/70 shadow-sm'
      )}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 text-sc-orange animate-spin-slow shrink-0" />
      ) : (
        <Search
          className={clsx(
            'w-4 h-4 shrink-0 transition-all duration-200',
            focused ? 'text-sc-orange scale-105' : 'text-sc-muted group-hover:text-sc-fg'
          )}
        />
      )}
      <input
        ref={ref}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder ?? 'Search tracks, artists, or paste a SoundCloud link...'}
        aria-label={ariaLabel ?? 'Search SoundCloud'}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 bg-transparent text-[13px] text-sc-fg placeholder:text-sc-dim/80 outline-none min-w-0"
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            onQueryChange('');
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
  );
}