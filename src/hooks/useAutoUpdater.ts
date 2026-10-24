import { useEffect, useState, useCallback, useRef } from 'react';
import type { UpdateState } from '../vite-env';

const DISMISSED_VERSION_KEY = 'sc_dismissed_update_version';

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

  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISSED_VERSION_KEY);
    } catch {
      return null;
    }
  });
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const dismissedRef = useRef(dismissedVersion);
  dismissedRef.current = dismissedVersion;

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
        // Only reset dismissal if a brand new, different version is announced
        if (next.availableVersion && dismissedRef.current && dismissedRef.current !== next.availableVersion) {
          setDismissedVersion(null);
          setSessionDismissed(false);
          try {
            localStorage.removeItem(DISMISSED_VERSION_KEY);
          } catch {}
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
    setSessionDismissed(true);
    const ver = updateState.availableVersion || 'dismissed';
    setDismissedVersion(ver);
    try {
      localStorage.setItem(DISMISSED_VERSION_KEY, ver);
    } catch {}
  }, [updateState.availableVersion]);

  const isDismissed = Boolean(
    sessionDismissed ||
    (dismissedVersion && (
      !updateState.availableVersion ||
      dismissedVersion === updateState.availableVersion ||
      dismissedVersion === 'dismissed'
    ))
  );

  return {
    updateState,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    dismissed: isDismissed,
    dismiss,
  };
}
