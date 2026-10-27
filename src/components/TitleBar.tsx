import { useEffect, useState } from 'react';
import type { Track } from '../types';
import appIcon from '../assets/icon.png';

interface Props {
  buttonStyle?: 'discord' | 'windows';
  currentTrack?: Track | null;
  isPlaying?: boolean;
}

export function WindowControls({
  buttonStyle = 'discord',
}: {
  buttonStyle?: 'discord' | 'windows';
}) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Check initial maximize state
    window.desktop?.isWindowMaximized?.().then((max) => {
      if (typeof max === 'boolean') setIsMaximized(max);
    });

    // Listen for maximize state changes from Electron
    const unsub = window.desktop?.onMaximizedChange?.((max) => {
      setIsMaximized(max);
    });

    return () => {
      unsub?.();
    };
  }, []);

  const handleMinimize = () => {
    void window.desktop?.minimizeWindow?.();
  };

  const handleToggleMaximize = () => {
    void window.desktop?.toggleMaximizeWindow?.();
  };

  const handleClose = () => {
    void window.desktop?.closeWindow?.();
  };

  return (
    <div className="app-no-drag flex items-center h-full shrink-0">
      {buttonStyle === 'windows' ? (
        /* Windows 11 style buttons (46px wide, crisp fluent glyphs) */
        <>
          <button
            type="button"
            onClick={handleMinimize}
            title="Minimize"
            aria-label="Minimize"
            className="w-[46px] h-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors duration-100 cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect fill="currentColor" width="10" height="1" y="5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            className="w-[46px] h-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors duration-100 cursor-pointer"
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M2.5 0.5h7v7" fill="none" stroke="currentColor" strokeWidth="1" />
                <rect width="7" height="7" x="0.5" y="2.5" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect width="9" height="9" x="0.5" y="0.5" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            title="Close"
            aria-label="Close"
            className="w-[46px] h-full flex items-center justify-center text-sc-muted hover:text-white hover:bg-[#e81123] active:bg-[#c4101f] transition-colors duration-100 cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path
                fill="currentColor"
                d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4-4-4z"
              />
            </svg>
          </button>
        </>
      ) : (
        /* Modern style buttons (sleek, rounded, smooth hover with signature red close) */
        <>
          <button
            type="button"
            onClick={handleMinimize}
            title="Minimize"
            aria-label="Minimize"
            className="w-8 h-full flex items-center justify-center text-sc-muted hover:text-white hover:bg-white/[0.08] active:bg-white/[0.14] transition-colors duration-150 cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect fill="currentColor" width="10" height="1.2" x="1" y="5.4" rx="0.6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            className="w-8 h-full flex items-center justify-center text-sc-muted hover:text-white hover:bg-white/[0.08] active:bg-white/[0.14] transition-colors duration-150 cursor-pointer"
          >
            {isMaximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path
                  d="M3.5 2h5a1.5 1.5 0 0 1 1.5 1.5v5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <rect
                  width="6.5"
                  height="6.5"
                  x="2"
                  y="3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  rx="1.2"
                />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect
                  width="8.5"
                  height="8.5"
                  x="1.75"
                  y="1.75"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  rx="1.5"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            title="Close"
            aria-label="Close"
            className="w-8 h-full flex items-center justify-center text-sc-muted hover:text-white hover:bg-[#ed4245] active:bg-[#c03537] transition-colors duration-150 cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path
                fill="currentColor"
                d="M9.8 2.2a.75.75 0 0 0-1.06 0L6 4.94 3.26 2.2a.75.75 0 0 0-1.06 1.06L4.94 6 2.2 8.74a.75.75 0 1 0 1.06 1.06L6 7.06l2.74 2.74a.75.75 0 1 0 1.06-1.06L7.06 6l2.74-2.74a.75.75 0 0 0 0-1.06z"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

export function TitleBar({
  buttonStyle = 'discord',
  currentTrack,
  isPlaying = false,
}: Props) {
  const handleDoubleClick = () => {
    void window.desktop?.toggleMaximizeWindow?.();
  };

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className="app-drag-region h-8 w-full bg-[#0b0b0f]/90 select-none border-b border-white/[0.06] backdrop-blur-xl flex items-center justify-between text-xs text-sc-muted relative z-10 shrink-0"
    >
      {/* Left: App icon, Brand, Now Playing */}
      <div className="flex items-center gap-2.5 px-3 min-w-0 h-full">
        <div className="flex items-center gap-2 shrink-0">
          <img
            src={appIcon}
            alt="Abbadon"
            className="w-4 h-4 object-contain rounded-xs pointer-events-none drop-shadow-xs"
          />
          <span className="text-[12px] font-bold tracking-wide text-sc-fg/80 pointer-events-none">
            Abbadon
          </span>
        </div>

        {/* Now playing indicator */}
        {currentTrack && (
          <div className="app-no-drag flex items-center gap-1.5 pl-2 border-l border-white/[0.08] min-w-0 max-w-[340px] truncate text-sc-dim hover:text-sc-fg transition-colors">
            {isPlaying ? (
              <span className="flex items-end gap-[2px] h-3 shrink-0 text-sc-orange py-0.5">
                <span className="w-[2px] bg-sc-orange rounded-full animate-eq-1 h-full" />
                <span className="w-[2px] bg-sc-orange rounded-full animate-eq-2 h-2/3" />
                <span className="w-[2px] bg-sc-orange rounded-full animate-eq-3 h-4/5" />
              </span>
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-sc-dim/50 shrink-0" />
            )}
            <span className="text-[11px] truncate">
              <span className="font-medium text-sc-fg/90">{currentTrack.title}</span>
              <span className="text-sc-dim/60 mx-1">·</span>
              <span className="text-sc-muted/80">{currentTrack.artist}</span>
            </span>
          </div>
        )}
      </div>

      {/* Center: Draggable Title Area */}
      <div className="flex-1 h-full flex items-center justify-center pointer-events-none">
        {/* Subtle center title on wide screens when not playing */}
        {!currentTrack && (
          <span className="text-[11px] font-medium text-sc-dim/40 tracking-wider">
            Abbadon Player
          </span>
        )}
      </div>

      {/* Right: Window Controls */}
      <WindowControls buttonStyle={buttonStyle} />
    </div>
  );
}
