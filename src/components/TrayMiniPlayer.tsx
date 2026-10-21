import { useEffect, useState } from 'react';
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
        }));
        if (synced.volume !== undefined) {
          setLocalVolume(synced.volume);
        }
      }
    };

    if (window.desktop?.onTrayStateSync) {
      return window.desktop.onTrayStateSync(handleSync);
    }
  }, []);

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

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setState((p) => ({ ...p, currentTime: val }));
    sendCommand('seek', val);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setLocalVolume(val);
    setIsMuted(val === 0);
    sendCommand('volume', val);
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      sendCommand('volume', localVolume || 0.5);
    } else {
      setIsMuted(true);
      sendCommand('volume', 0);
    }
  };

  const track = state.track;

  // Background blur and transparency styles
  const getGlassStyle = () => {
    const blur = prefs.miniBlur || 'heavy';
    const op = blur === 'solid' ? 1 : (prefs.miniOpacity ?? 0.65);

    if (blur === 'solid') {
      return {
        className: 'border border-sc-line/80 shadow-2xl',
        style: {
          backgroundColor: 'var(--sc-bg, #0b0b0f)',
        },
      };
    }

    const baseBg = `color-mix(in srgb, var(--sc-bg, #0b0b0f) ${Math.round(op * 100)}%, transparent)`;

    if (blur === 'none') {
      return {
        className: 'border border-white/15 shadow-2xl',
        style: {
          backgroundColor: baseBg,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        },
      };
    }

    if (blur === 'subtle') {
      return {
        className: 'border border-white/25 shadow-2xl',
        style: {
          backgroundColor: baseBg,
          boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.20), 0 12px 36px rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        },
      };
    }

    if (blur === 'frosted') {
      return {
        className: 'border border-white/35 shadow-2xl',
        style: {
          backgroundColor: baseBg,
          boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.25), 0 16px 44px rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        },
      };
    }

    // heavy (smoked)
    return {
      className: 'border border-white/30 shadow-2xl',
      style: {
        backgroundColor: baseBg,
        boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.35), 0 20px 50px rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(36px)',
        WebkitBackdropFilter: 'blur(36px)',
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
          <span>{fmtTime(state.currentTime)}</span>
          <input
            type="range"
            min={0}
            max={state.duration || 100}
            value={state.currentTime || 0}
            onChange={handleSeek}
            aria-label="Seek track"
            className="flex-1 h-1 bg-sc-fill/15 rounded-lg appearance-none cursor-pointer accent-[var(--color-sc-orange)] focus:outline-none"
          />
          <span>{fmtTime(state.duration)}</span>
        </div>
      )}

      {/* Bottom Controls: Playback & Volume */}
      <div className="flex items-center justify-between pt-0.5">
        {/* Volume */}
        {prefs.miniShowVolume ? (
          <div className="flex items-center gap-1.5 w-24">
            <button
              onClick={toggleMute}
              aria-label="Mute / Unmute"
              className="text-sc-muted hover:text-sc-fg transition-colors cursor-pointer"
            >
              {isMuted || localVolume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : localVolume}
              onChange={handleVolumeChange}
              aria-label="Volume slider"
              className="w-16 h-1 bg-sc-fill/15 rounded-lg appearance-none cursor-pointer accent-[var(--color-sc-orange)] focus:outline-none"
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
