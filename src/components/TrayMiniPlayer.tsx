import { useEffect, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize2, X, Music } from 'lucide-react';
import type { Track } from '../types';
import { resolveTheme, applyTheme, loadCustomThemes, THEME_ACTIVE_KEY } from '../lib/themes';

interface PlaybackState {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume?: number;
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

  return (
    <div className="w-full h-full box-border bg-sc-bg/95 backdrop-blur-2xl text-sc-fg select-none border border-sc-line rounded-2xl p-3.5 flex flex-col justify-between shadow-2xl overflow-hidden font-sans">
      {/* Top Bar: Logo & Actions */}
      <div className="flex items-center justify-between gap-2 border-b border-sc-line/40 pb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-sc-orange animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sc-muted">Abbadon Mini</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => sendCommand('restore')}
            title="Open full app"
            className="p-1 rounded-lg text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10 transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
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
      <div className="flex items-center gap-3 my-1">
        <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-sc-fill/5 border border-sc-line shrink-0 shadow-md">
          {track?.artwork ? (
            <img src={track.artwork} alt={track.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sc-dim">
              <Music className="w-5 h-5" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-sc-fg truncate leading-tight">
            {track?.title || 'Nothing playing'}
          </div>
          <div className="text-[11px] text-sc-muted truncate leading-normal mt-0.5">
            {track?.artist || 'SoundCloud'}
          </div>

          {/* Mini Animated Spectrum Bars matching theme accent */}
          <div className="flex items-end gap-0.5 h-3 mt-1">
            {[0.4, 0.8, 0.6, 1.0, 0.5, 0.9, 0.7, 0.3].map((h, i) => (
              <div
                key={i}
                className="w-1 bg-gradient-to-t from-sc-orange to-sc-orange-soft rounded-full transition-all duration-150"
                style={{
                  height: state.isPlaying ? `${Math.max(20, h * 100)}%` : '20%',
                  opacity: state.isPlaying ? 0.95 : 0.3,
                  animation: state.isPlaying ? `pulse 0.6s ease-in-out infinite alternate ${i * 80}ms` : 'none',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Progress Slider */}
      <div className="flex items-center gap-2 text-[10px] text-sc-muted tabular-nums">
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

      {/* Bottom Controls: Playback & Volume */}
      <div className="flex items-center justify-between pt-1">
        {/* Volume */}
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

        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => sendCommand('prev')}
            title="Previous track"
            className="p-1.5 rounded-full text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10 active:scale-95 transition-all cursor-pointer"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() => sendCommand('toggle')}
            title={state.isPlaying ? 'Pause' : 'Play'}
            className="w-8 h-8 rounded-full bg-sc-orange hover:brightness-110 text-sc-on-accent flex items-center justify-center shadow-lg shadow-sc-orange/25 active:scale-95 transition-all cursor-pointer"
          >
            {state.isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>
          <button
            onClick={() => sendCommand('next')}
            title="Next track"
            className="p-1.5 rounded-full text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10 active:scale-95 transition-all cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
