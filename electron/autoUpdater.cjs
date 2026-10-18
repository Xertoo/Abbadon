const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;

const updateState = {
  status: 'idle', // 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: app.getVersion(),
  availableVersion: null,
  releaseNotes: null,
  progressPercent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0,
  error: null,
  feedUrl: null,
};

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status-changed', updateState);
  }
}

function initAutoUpdater(win, isDev) {
  mainWindow = win;
  updateState.currentVersion = app.getVersion();

  // Configure update behavior
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

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
    updateState.error = err ? (err.message || String(err)) : 'Nieznany błąd podczas sprawdzania aktualizacji';
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

  // Automatically check for updates on startup in production
  if (!isDev) {
    setTimeout(() => {
      try {
        autoUpdater.checkForUpdates().catch((err) => {
          console.log('[AutoUpdater] Startup check notice:', err.message);
        });
      } catch (err) {
        console.log('[AutoUpdater] Startup check exception:', err.message);
      }
    }, 6000);
  }
}

// Register IPC handlers
ipcMain.handle('updater:check', async () => {
  try {
    updateState.status = 'checking';
    updateState.error = null;
    broadcastState();

    const result = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo };
  } catch (err) {
    updateState.status = 'error';
    updateState.error = err.message || 'Błąd połączenia z serwerem aktualizacji';
    broadcastState();
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('updater:download', async () => {
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
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
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
};
