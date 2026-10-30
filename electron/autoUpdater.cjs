const path = require('node:path');
const { app, ipcMain, shell, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;
let onBeforeInstall = null;
let isDevOrLocal = false;
let isInstallingUpdate = false;

const isPortable = Boolean(
  process.env.PORTABLE_EXECUTABLE_FILE ||
  process.env.PORTABLE_EXECUTABLE_DIR ||
  (process.platform === 'win32' && /portable/i.test(path.basename(process.execPath)))
);

const updateState = {
  status: 'idle', // 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error'
  currentVersion: app.getVersion(),
  availableVersion: null,
  releaseNotes: null,
  progressPercent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0,
  error: null,
  feedUrl: null,
  isPortable,
};

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status-changed', updateState);
  }
}

function initAutoUpdater(win, isDev, beforeInstallCb) {
  mainWindow = win;
  onBeforeInstall = beforeInstallCb;
  isDevOrLocal = Boolean(isDev);
  updateState.currentVersion = app.getVersion();
  updateState.isPortable = isPortable;

  // On Windows, explicitly set installDirectory to the directory of the running executable.
  // This passes /D=<dir> to NSIS so that the installer replaces the files of the running app
  // instead of defaulting to %LOCALAPPDATA%\Programs\abbadon if run from a custom path.
  if (process.platform === 'win32' && !isPortable) {
    try {
      const runningDir = path.dirname(process.execPath);
      autoUpdater.installDirectory = runningDir;
      console.log('[AutoUpdater] Target installDirectory configured:', runningDir);
    } catch (err) {
      console.warn('[AutoUpdater] Failed to set installDirectory:', err.message);
    }
  }

  // Configure update behavior - download automatically in background
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Ensure GitHub feed URL is set even if app-update.yml is absent
  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'Xertoo',
      repo: 'abbadon',
      private: false,
    });
  } catch (err) {
    console.log('[AutoUpdater] Fallback feed URL notice:', err.message);
  }

  autoUpdater.on('before-quit-for-update', () => {
    isInstallingUpdate = true;
    if (typeof onBeforeInstall === 'function') {
      try {
        onBeforeInstall();
      } catch (err) {
        console.warn('[AutoUpdater] before-quit-for-update error:', err.message);
      }
    }
  });

  autoUpdater.on('checking-for-update', () => {
    updateState.status = 'checking';
    updateState.error = null;
    broadcastState();
  });

  autoUpdater.on('update-available', (info) => {
    updateState.status = 'available';
    updateState.availableVersion = info?.version || null;
    updateState.releaseNotes = typeof info?.releaseNotes === 'string' ? info.releaseNotes : null;
    broadcastState();
  });

  autoUpdater.on('update-not-available', (info) => {
    updateState.status = 'not-available';
    updateState.currentVersion = info?.version || app.getVersion();
    broadcastState();
  });

  autoUpdater.on('error', (err) => {
    updateState.status = 'error';
    updateState.error = err ? (err.message || String(err)) : 'Unknown error while checking for updates';
    broadcastState();
  });

  autoUpdater.on('download-progress', (progressObj) => {
    updateState.status = 'downloading';
    updateState.progressPercent = Math.round(progressObj.percent || 0);
    updateState.bytesPerSecond = Math.round(progressObj.bytesPerSecond || 0);
    updateState.transferred = Math.round(progressObj.transferred || 0);
    updateState.total = Math.round(progressObj.total || 0);
    broadcastState();
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateState.status = 'downloaded';
    updateState.availableVersion = info?.version || updateState.availableVersion;
    broadcastState();
  });

  // Automatically check for updates on startup in packaged production builds
  if (!isDev) {
    setTimeout(() => {
      try {
        autoUpdater.checkForUpdates().catch((err) => {
          console.log('[AutoUpdater] Startup check notice:', err.message);
        });
      } catch (err) {
        console.log('[AutoUpdater] Startup check exception:', err.message);
      }
    }, 1200);
  }
}

// Register IPC handlers
ipcMain.handle('updater:check', async () => {
  if (isDevOrLocal && !app.isPackaged) {
    return { ok: false, error: 'Update checks are disabled in development mode' };
  }

  try {
    updateState.status = 'checking';
    updateState.error = null;
    broadcastState();

    const result = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo };
  } catch (err) {
    updateState.status = 'error';
    updateState.error = err.message || 'Error connecting to update server';
    broadcastState();
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('updater:download', async () => {
  if (isPortable) {
    const portableUrl = updateState.availableVersion
      ? `https://github.com/Xertoo/abbadon/releases/download/v${updateState.availableVersion}/Abbadon-portable.exe`
      : 'https://github.com/Xertoo/abbadon/releases/latest';
    shell.openExternal(portableUrl);
    return { ok: true, isPortable: true };
  }

  try {
    updateState.status = 'downloading';
    broadcastState();
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    updateState.status = 'error';
    updateState.error = err.message;
    broadcastState();
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('updater:install', () => {
  try {
    if (isInstallingUpdate) {
      return { ok: true, message: 'Update installation already in progress' };
    }
    isInstallingUpdate = true;
    updateState.status = 'installing';
    broadcastState();

    // If running in portable mode, direct user to download the latest portable executable
    if (isPortable) {
      const portableUrl = updateState.availableVersion
        ? `https://github.com/Xertoo/abbadon/releases/download/v${updateState.availableVersion}/Abbadon-portable.exe`
        : 'https://github.com/Xertoo/abbadon/releases/latest';
      shell.openExternal(portableUrl);
      return { ok: true, isPortable: true };
    }

    // Disable autoInstallOnAppQuit so BaseUpdater's app.onQuit does not
    // launch a redundant competing installer execution when quitting.
    autoUpdater.autoInstallOnAppQuit = false;

    // Run clean shutdown in main process:
    // 1. Release single-instance mutex so newly launched process can take it immediately.
    // 2. Destroy tray icon, global shortcuts, and Discord RPC socket.
    // 3. Close custom CSS file watcher.
    // 4. Destroy all BrowserWindow instances.
    if (typeof onBeforeInstall === 'function') {
      try {
        onBeforeInstall();
      } catch (err) {
        console.warn('[AutoUpdater] onBeforeInstall error:', err.message);
      }
    }

    // Force-destroy all windows immediately
    BrowserWindow.getAllWindows().forEach((w) => {
      try {
        w.removeAllListeners('close');
        w.destroy();
      } catch {}
    });

    // Spawn NSIS installer detached:
    // isSilent: false (user sees installer progress bar so they know files are being updated)
    // isForceRunAfter: true (installer automatically restarts the updated app)
    console.log('[AutoUpdater] Spawning installer via autoUpdater.quitAndInstall(false, true)...');
    autoUpdater.quitAndInstall(false, true);

    // Give autoUpdater 300ms to spawn the detached installer process,
    // then forcefully terminate this Electron instance with app.exit(0).
    // This releases all operating system file locks on Abbadon.exe and DLLs,
    // avoiding Windows ERROR_ACCESS_DENIED sharing violations during file replacement,
    // and completely freeing the single-instance lock for the incoming instance.
    setTimeout(() => {
      console.log('[AutoUpdater] Terminating current process (app.exit) to release binary locks...');
      try {
        app.exit(0);
      } catch {
        process.exit(0);
      }
    }, 300);

    return { ok: true };
  } catch (err) {
    console.error('[AutoUpdater] Failed to install update:', err);
    isInstallingUpdate = false;
    updateState.status = 'error';
    updateState.error = err.message || 'Failed to install update';
    broadcastState();
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('updater:status', () => {
  return updateState;
});

ipcMain.handle('updater:set-feed-url', (_e, options) => {
  try {
    autoUpdater.setFeedURL(options);
    updateState.feedUrl = typeof options === 'string' ? options : JSON.stringify(options);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

module.exports = {
  initAutoUpdater,
  getUpdateState: () => updateState,
  isPortable,
};
