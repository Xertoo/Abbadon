import { Sparkles, Download, RefreshCw, X, ArrowUpCircle } from 'lucide-react';
import type { UpdateState } from '../vite-env';

interface Props {
  updateState: UpdateState;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  hasCustomTitleBar?: boolean;
}

export function UpdateBanner({
  updateState,
  onDownload,
  onInstall,
  onDismiss,
  hasCustomTitleBar = false,
}: Props) {
  if (
    updateState.status !== 'available' &&
    updateState.status !== 'downloading' &&
    updateState.status !== 'downloaded' &&
    updateState.status !== 'installing'
  ) {
    return null;
  }

  const formatSpeed = (bps: number) => {
    if (bps < 1024) return `${bps} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  return (
    <div
      className={`fixed ${hasCustomTitleBar ? 'top-11' : 'top-4'} right-4 z-50 max-w-md w-full animate-slide-in-down select-none pointer-events-auto`}
    >
      <div className="p-4 rounded-2xl bg-sc-panel/95 backdrop-blur-2xl border border-sc-orange/40 shadow-2xl shadow-sc-orange/15 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sc-orange/20 border border-sc-orange/40 flex items-center justify-center shrink-0">
              {updateState.status === 'downloaded' ? (
                <Sparkles className="w-5 h-5 text-sc-orange animate-bounce" />
              ) : updateState.status === 'downloading' ? (
                <Download className="w-5 h-5 text-sc-orange animate-pulse" />
              ) : (
                <ArrowUpCircle className="w-5 h-5 text-sc-orange" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-sc-orange">
                  App Update
                </span>
                {updateState.availableVersion && (
                  <span className="px-1.5 py-0.2 rounded bg-white/10 text-[10px] font-mono font-bold text-sc-fg">
                    v{updateState.availableVersion}
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-sc-fg mt-0.5">
                {updateState.status === 'installing'
                  ? 'Installing update, restarting soon...'
                  : updateState.status === 'downloaded'
                    ? (updateState.isPortable ? 'Portable update is ready to download!' : 'Update is ready to install!')
                    : updateState.status === 'downloading'
                      ? `Downloading update: ${updateState.progressPercent}%`
                      : `Version ${updateState.availableVersion || ''} is available!`}
              </p>
            </div>
          </div>

          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg text-sc-muted hover:text-sc-fg hover:bg-white/10 transition-colors cursor-pointer"
            title="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Downloading Progress Bar */}
        {updateState.status === 'downloading' && (
          <div className="space-y-1.5 pt-1">
            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-sc-orange transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(5, updateState.progressPercent)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-sc-muted">
              <span>{formatSpeed(updateState.bytesPerSecond)}</span>
              <span>{updateState.progressPercent}%</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1">
          {updateState.status === 'installing' ? (
            <button
              disabled
              className="flex-1 py-2 rounded-xl bg-sc-orange/70 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-sc-orange/20 cursor-wait opacity-90"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Installing & Restarting...
            </button>
          ) : updateState.status === 'downloaded' ? (
            <button
              onClick={onInstall}
              className="flex-1 py-2 rounded-xl bg-sc-orange hover:bg-sc-orange/90 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-sc-orange/20 transition-all cursor-pointer active:scale-98"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {updateState.isPortable ? 'Download Portable .exe' : 'Restart & Install'}
            </button>
          ) : updateState.status === 'available' ? (
            <button
              onClick={onDownload}
              className="flex-1 py-2 rounded-xl bg-sc-orange hover:bg-sc-orange/90 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-sc-orange/20 transition-all cursor-pointer active:scale-98"
            >
              <Download className="w-3.5 h-3.5" />
              {updateState.isPortable ? 'Download Portable .exe' : 'Download Update'}
            </button>
          ) : null}

          {updateState.status !== 'installing' && (
            <button
              onClick={onDismiss}
              className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-sc-muted hover:text-sc-fg font-semibold text-xs transition-colors cursor-pointer"
            >
              Later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
