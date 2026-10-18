import { useEffect, useState, useCallback } from 'react';
import type { UpdateState } from '../vite-env';

export function useAutoUpdater() {
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: 'idle',
    currentVersion: '1.0.0',
    availableVersion: null,
    releaseNotes: null,
    progressPercent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
    error: null,
  });

  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Initial status fetch
    if (window.desktop?.getUpdateStatus) {
      void window.desktop.getUpdateStatus().then((s) => {
        if (s) setUpdateState(s);
      });
    }

    // Subscribe to live status changes from main process
    if (window.desktop?.onUpdateStatus) {
      const unsub = window.desktop.onUpdateStatus((next) => {
        setUpdateState(next);
        // Reset dismissed flag if a new update arrives
        if (next.status === 'available' || next.status === 'downloaded') {
          setDismissed(false);
        }
      });
      return unsub;
    }
  }, []);

  // Check for updates on startup
  useEffect(() => {
    const fn = window.desktop?.checkForUpdates;
    if (fn) {
      const timer = window.setTimeout(() => {
        void fn().catch(() => {});
      }, 1000);
      return () => window.clearTimeout(timer);
    }
  }, []);

  // Periodic update check every 3 hours while open
  useEffect(() => {
    const fn = window.desktop?.checkForUpdates;
    if (!fn) return;
    const interval = window.setInterval(() => {
      void fn().catch(() => {});
    }, 3 * 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!window.desktop?.checkForUpdates) return { ok: false, error: 'Update check is not supported in this environment' };
    setUpdateState((prev) => ({ ...prev, status: 'checking', error: null }));
    try {
      const res = await window.desktop.checkForUpdates();
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateState((prev) => ({ ...prev, status: 'error', error: msg }));
      return { ok: false, error: msg };
    }
  }, []);

  const downloadUpdate = useCallback(async () => {
    if (!window.desktop?.downloadUpdate) return;
    try {
      await window.desktop.downloadUpdate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateState((prev) => ({ ...prev, status: 'error', error: msg }));
    }
  }, []);

  const quitAndInstall = useCallback(() => {
    if (window.desktop?.quitAndInstall) {
      window.desktop.quitAndInstall();
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    updateState,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    dismissed,
    dismiss,
  };
}
