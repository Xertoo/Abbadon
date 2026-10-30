import { useEffect, useState, useRef } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  X,
  Music,
  Pin,
  Heart,
  Shuffle,
  Repeat,
} from 'lucide-react';
import type { Track } from '../types';
import { resolveTheme, applyTheme, loadCustomThemes, THEME_ACTIVE_KEY } from '../lib/themes';
import { loadPrefs, type Prefs } from '../lib/prefs';
import { applyCustomCss } from '../lib/customCss';

interface PlaybackState {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume?: number;
  isLiked?: boolean;
  shuffle?: boolean;
  repeat?: 'off' | 'all' | 'one';
}

function fmtTime(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface MiniSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (val: number) => void;
  onChangeEnd?: (val: number) => void;
  onDragStart?: () => void;
  className?: string;
  label?: string;
  title?: string;
}

function MiniSlider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  onChangeEnd,
  onDragStart,
  className = '',
  label,
  title,
}: MiniSliderProps) {
  const isDraggingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const safeMax = max > min ? max : min + 1;
  const clampedVal = Math.min(safeMax, Math.max(min, value || 0));
  const pct = Math.min(100, Math.max(0, ((clampedVal - min) / (safeMax - min)) * 100));

  const computeVal = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return min;
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    let nextVal = min + ratio * (safeMax - min);
    if (step > 0) {
      nextVal = Math.round((nextVal - min) / step) * step + min;
    }
    return Math.min(safeMax, Math.max(min, nextVal));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragStart?.();
    const nextVal = computeVal(e.clientX, e.currentTarget);
    onChange(nextVal);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current || e.currentTarget.hasPointerCapture(e.pointerId)) {
      const nextVal = computeVal(e.clientX, e.currentTarget);
      onChange(nextVal);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const finalVal = computeVal(e.clientX, e.currentTarget);
      onChangeEnd?.(finalVal);
    }
  };

  const handlePointerCancel = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      onChangeEnd?.(clampedVal);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = (safeMax - min) * (e.shiftKey ? 0.1 : 0.02);
    const stepSize = step > 0 ? step : delta;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(safeMax, clampedVal + stepSize);
      onChange(next);
      onChangeEnd?.(next);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(min, clampedVal - stepSize);
      onChange(next);
      onChangeEnd?.(next);
    }
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={Math.round(clampedVal)}
      aria-valuemin={min}
      aria-valuemax={safeMax}
      title={title}
      className={`group relative py-1 flex items-center cursor-pointer outline-none select-none ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      {/* Background track (Tło) - clearly visible full extent showing min to max range */}
      <div
        ref={trackRef}
        className="w-full h-1.5 group-hover:h-2 rounded-full bg-black/45 group-hover:bg-black/55 border border-sc-line/80 group-hover:border-sc-line ring-1 ring-black/50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] relative overflow-hidden transition-all duration-150"
      >
        {/* Active filled range */}
        <div
          className="h-full rounded-full bg-gradient-to-r from-sc-orange to-sc-orange-soft transition-all duration-75"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Thumb knob */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-neutral-200 group-hover:bg-white shadow-md border border-black/35 pointer-events-none transition-all duration-150 scale-75 opacity-80 group-hover:scale-100 group-hover:opacity-100 group-active:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-sc-orange group-focus-visible:opacity-100"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

export function TrayMiniPlayer() {
  const [state, setState] = useState<PlaybackState>({
    track: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.55,
  });

  const [localVolume, setLocalVolume] = useState(0.55);
  const [isMuted, setIsMuted] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [isPinned, setIsPinned] = useState<boolean>(() => prefs.miniAlwaysOnTop ?? true);

  const isSeekingRef = useRef(false);
  const isVolDraggingRef = useRef(false);

  // Sync active user theme from main window / localStorage
  useEffect(() => {
    const syncTheme = () => {
      try {
        const activeId = localStorage.getItem(THEME_ACTIVE_KEY) || 'dark';
        const customThemes = loadCustomThemes();
        const theme = resolveTheme(activeId, customThemes);
        applyTheme(theme);
      } catch {
        /* ignore */
      }
    };
    syncTheme();
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  // Sync prefs when changed in main window
  useEffect(() => {
    const syncPrefs = () => {
      const p = loadPrefs();
      setPrefs(p);
    };
    window.addEventListener('storage', syncPrefs);
    return () => window.removeEventListener('storage', syncPrefs);
  }, []);

  // Apply custom CSS
  useEffect(() => {
    applyCustomCss(prefs.customCss, prefs.customCssEnabled);
  }, [prefs.customCss, prefs.customCssEnabled]);

  // Sync pin state from Electron main process
  useEffect(() => {
    if (window.desktop?.onMiniPinnedSync) {
      return window.desktop.onMiniPinnedSync((pinned) => {
        setIsPinned(pinned);
      });
    }
  }, []);

  // Sync mini player prefs from main window via IPC
  useEffect(() => {
    if (window.desktop?.onMiniPrefsSync) {
      return window.desktop.onMiniPrefsSync((newPrefs) => {
        if (newPrefs) setPrefs(newPrefs);
      });
    }
  }, []);

  useEffect(() => {
    // Listen for state sync from main process
    const handleSync = (_e: unknown, synced: PlaybackState) => {
      if (synced) {
        setState((prev) => ({
          ...prev,
          ...synced,
          currentTime: isSeekingRef.current ? prev.currentTime : (synced.currentTime ?? prev.currentTime),
        }));
        if (synced.volume !== undefined && !isVolDraggingRef.current) {
          setLocalVolume(synced.volume);
          setIsMuted(synced.volume === 0);
        }
      }
    };

    if (window.desktop?.onTrayStateSync) {
      return window.desktop.onTrayStateSync(handleSync);
    }
  }, []);

  // Smoothly increment current time once per second while playing without requiring high-frequency IPC
  useEffect(() => {
    if (!state.isPlaying) return;
    const interval = setInterval(() => {
      setState((prev) => {
        if (!prev.isPlaying || isSeekingRef.current) return prev;
        const next = Math.min(prev.duration || Infinity, prev.currentTime + 1);
        return { ...prev, currentTime: next };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [state.isPlaying]);

  const sendCommand = (action: string, value?: unknown) => {
    if (window.desktop?.sendMiniCommand) {
      window.desktop.sendMiniCommand(action, value);
    }
  };

  const togglePin = () => {
    const next = !isPinned;
    setIsPinned(next);
    sendCommand('pin', next);
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      const restored = localVolume > 0 ? localVolume : 0.5;
      setLocalVolume(restored);
      sendCommand('volume', restored);
    } else {
      setIsMuted(true);
      sendCommand('volume', 0);
    }
  };

  const track = state.track;

  // Background style calculation: 3 options (none = clear, tinted = translucent tint, solid = opaque)
  const getGlassStyle = () => {
    const mode = prefs.miniBlur || 'tinted';
    const op = mode === 'solid' ? 1 : (prefs.miniOpacity ?? 0.65);

    if (mode === 'solid') {
      return {
        className: 'border border-sc-line/80 shadow-2xl',
        style: {
          backgroundColor: 'var(--sc-bg, #0b0b0f)',
        },
      };
    }

    if (mode === 'none') {
      return {
        className: 'border border-sc-line/75 shadow-2xl ring-1 ring-black/40',
        style: {
          backgroundColor: `color-mix(in srgb, var(--sc-bg, #0b0b0f) ${Math.round(Math.min(0.35, op * 0.5) * 100)}%, transparent)`,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55)',
        },
      };
    }

    // Tinted Transparency (mode === 'tinted' or legacy values)
    return {
      className: 'border border-sc-line/80 shadow-2xl ring-1 ring-black/40',
      style: {
        backgroundColor: `color-mix(in srgb, var(--sc-bg, #0b0b0f) ${Math.round(op * 100)}%, transparent)`,
        boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 16px 44px rgba(0, 0, 0, 0.7)',
      },
    };
  };

  const glass = getGlassStyle();

  return (
    <div
      style={glass.style}
      className={`w-full h-full box-border ${glass.className} text-sc-fg select-none rounded-2xl p-3 flex flex-col justify-between overflow-hidden font-sans relative transition-all duration-200`}
    >
      {/* Top Bar: Logo & Draggable area & Actions */}
      <div
        className="flex items-center justify-between gap-2 border-b border-sc-line/40 pb-1.5 cursor-grab active:cursor-grabbing select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        title="Drag to move mini player"
      >
        <div className="flex items-center gap-1.5 select-none pointer-events-none">
          <div className="w-2 h-2 rounded-full bg-sc-orange animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sc-muted">
            Abbadon Mini
          </span>
        </div>

        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Pin Button */}
          <button
            onClick={togglePin}
            title={isPinned ? 'Always on Top: Active (click to unpin)' : 'Pin on Top: Off (click to keep on top)'}
            className={`p-1 rounded-lg transition-all cursor-pointer ${
              isPinned
                ? 'text-sc-orange bg-sc-orange/15 hover:bg-sc-orange/25 shadow-sm shadow-sc-orange/20'
                : 'text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10'
            }`}
          >
            <Pin className={`w-3.5 h-3.5 transition-transform ${isPinned ? 'rotate-45 fill-current' : ''}`} />
          </button>

          {/* Restore / Maximize */}
          <button
            onClick={() => sendCommand('restore')}
            title="Open full app"
            className="p-1 rounded-lg text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10 transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          {/* Close */}
          <button
            onClick={() => sendCommand('hide')}
            title="Close"
            className="p-1 rounded-lg text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Center: Artwork, Metadata, Mini Visualizer */}
      <div className="flex items-center gap-3 my-0.5 min-h-0">
        <div className="relative w-11 h-11 rounded-xl overflow-hidden bg-sc-fill/5 border border-sc-line shrink-0 shadow-md">
          {track?.artwork ? (
            <img src={track.artwork} alt={track.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sc-dim">
              <Music className="w-5 h-5" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-sc-fg truncate leading-tight">
            {track?.title || 'Nothing playing'}
          </div>
          <div className="text-[11px] text-sc-muted truncate leading-normal mt-0.5">
            {track?.artist || 'SoundCloud'}
          </div>

          {/* Mini Animated Spectrum Bars */}
          {prefs.miniShowVisualizer && (
            <div className="flex items-end gap-0.5 h-2.5 mt-1">
              {[0.4, 0.8, 0.6, 1.0, 0.5, 0.9, 0.7, 0.3].map((h, i) => (
                <div
                  key={i}
                  className="w-1 bg-gradient-to-t from-sc-orange to-sc-orange-soft rounded-full transition-all duration-150"
                  style={{
                    height: state.isPlaying ? `${Math.max(20, h * 100)}%` : '20%',
                    opacity: state.isPlaying ? 0.95 : 0.3,
                    animation: state.isPlaying
                      ? `pulse 0.6s ease-in-out infinite alternate ${i * 80}ms`
                      : 'none',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Optional Like Button */}
        {prefs.miniShowLike && (
          <button
            onClick={() => sendCommand('like')}
            title="Like / Unlike"
            className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
              state.isLiked || track?.isLiked
                ? 'text-sc-orange'
                : 'text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10'
            }`}
          >
            <Heart
              className={`w-4 h-4 ${state.isLiked || track?.isLiked ? 'fill-current' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Progress Slider */}
      {prefs.miniShowProgress && (
        <div className="flex items-center gap-2 text-[10px] text-sc-muted tabular-nums py-0.5">
          <span className="shrink-0 select-none min-w-[28px] text-right">{fmtTime(state.currentTime)}</span>
          <MiniSlider
            value={state.currentTime || 0}
            min={0}
            max={state.duration || 100}
            step={0.5}
            onChange={(val) => {
              setState((p) => ({ ...p, currentTime: val }));
            }}
            onDragStart={() => {
              isSeekingRef.current = true;
            }}
            onChangeEnd={(val) => {
              isSeekingRef.current = false;
              setState((p) => ({ ...p, currentTime: val }));
              sendCommand('seek', val);
            }}
            className="flex-1"
            label="Seek track"
            title={`${fmtTime(state.currentTime)} / ${fmtTime(state.duration)}`}
          />
          <span className="shrink-0 select-none min-w-[28px]">{fmtTime(state.duration)}</span>
        </div>
      )}

      {/* Bottom Controls: Playback & Volume */}
      <div className="flex items-center justify-between pt-0.5">
        {/* Volume */}
        {prefs.miniShowVolume ? (
          <div
            className="flex items-center gap-1.5 w-28 group/vol"
            title={`Volume: ${Math.round((isMuted ? 0 : localVolume) * 100)}%`}
          >
            <button
              onClick={toggleMute}
              aria-label={isMuted || localVolume === 0 ? 'Unmute' : 'Mute'}
              title={isMuted || localVolume === 0 ? 'Unmute' : 'Mute'}
              className="text-sc-muted hover:text-sc-fg transition-colors cursor-pointer shrink-0"
            >
              {isMuted || localVolume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            <MiniSlider
              value={isMuted ? 0 : localVolume}
              min={0}
              max={1}
              step={0.01}
              onChange={(val) => {
                if (isMuted && val > 0) setIsMuted(false);
                setLocalVolume(val);
                sendCommand('volume', val);
              }}
              onDragStart={() => {
                isVolDraggingRef.current = true;
              }}
              onChangeEnd={(val) => {
                isVolDraggingRef.current = false;
                setLocalVolume(val);
                sendCommand('volume', val);
              }}
              className="w-20"
              label="Volume slider"
              title={`Volume: ${Math.round((isMuted ? 0 : localVolume) * 100)}%`}
            />
          </div>
        ) : (
          <div className="w-1" />
        )}

        {/* Playback Controls */}
        <div className="flex items-center gap-1.5">
          {/* Optional Shuffle */}
          {prefs.miniShowShuffle && (
            <button
              onClick={() => sendCommand('shuffle')}
              title="Shuffle"
              className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                state.shuffle
                  ? 'text-sc-orange'
                  : 'text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10'
              }`}
            >
              <Shuffle className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Prev */}
          {prefs.miniShowPrevNext && (
            <button
              onClick={() => sendCommand('prev')}
              title="Previous track"
              className="p-1.5 rounded-full text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10 active:scale-95 transition-all cursor-pointer"
            >
              <SkipBack className="w-4 h-4" />
            </button>
          )}

          {/* Play / Pause */}
          <button
            onClick={() => sendCommand('toggle')}
            title={state.isPlaying ? 'Pause' : 'Play'}
            className="w-8 h-8 rounded-full bg-sc-orange hover:brightness-110 text-sc-on-accent flex items-center justify-center shadow-lg shadow-sc-orange/25 active:scale-95 transition-all cursor-pointer"
          >
            {state.isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Next */}
          {prefs.miniShowPrevNext && (
            <button
              onClick={() => sendCommand('next')}
              title="Next track"
              className="p-1.5 rounded-full text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10 active:scale-95 transition-all cursor-pointer"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          )}

          {/* Optional Repeat */}
          {prefs.miniShowRepeat && (
            <button
              onClick={() => sendCommand('repeat')}
              title="Repeat"
              className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                state.repeat && state.repeat !== 'off'
                  ? 'text-sc-orange'
                  : 'text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
