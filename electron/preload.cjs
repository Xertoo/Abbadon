const { contextBridge, ipcRenderer } = require('electron');

/**
 * Minimal bridge. The renderer never touches Node directly; everything it can
 * do from the desktop shell is listed here.
 */
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  info: () => ipcRenderer.invoke('app-info'),

  /**
   * Reads the optional userData/settings.json. Resolves to { ok, path, data }
   * or { ok: false, missing: true } when the file was never created.
   */
  loadSettings: () => ipcRenderer.invoke('sc:settings'),
  settingsPath: () => ipcRenderer.invoke('sc:settings-path'),

  /**
   * Relays a request through the main process. Required for SoundCloud because
   * the renderer is loaded from file:// and CORS blocks direct API calls.
   * The default Electron session is used, so login cookies are attached.
   */
  fetch: (url, opts = {}) => ipcRenderer.invoke('sc:fetch', { url, ...opts }),

  /** Opens the SoundCloud sign-in window and resolves once a token is found. */
  login: () => ipcRenderer.invoke('sc:login'),
  logout: () => ipcRenderer.invoke('sc:logout'),

  /**
   * Spotify (Premium) sign-in via OAuth PKCE. The user supplies their own app
   * Client ID; the loopback redirect is captured in the main process, which
   * returns an access + refresh token pair.
   */
  spotifyConfig: () => ipcRenderer.invoke('spotify:config'),
  spotifyLogin: (clientId) => ipcRenderer.invoke('spotify:login', { clientId }),
  spotifyRefresh: (clientId, refreshToken) =>
    ipcRenderer.invoke('spotify:refresh', { clientId, refreshToken }),

  /**
   * Saves a signed CDN link through the session, into the OS Downloads
   * folder. Only sndcdn.com links are accepted by the main process.
   */
  download: (url, title) => ipcRenderer.invoke('sc:download', { url, title }),
  /** Reports download lifecycle so the UI can say where the file went. */
  onDownload: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },

  onMediaCommand: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on('media-command', handler);
    return () => ipcRenderer.removeListener('media-command', handler);
  },

  onNavCommand: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on('nav-command', handler);
    return () => ipcRenderer.removeListener('nav-command', handler);
  },

  /** Sends playback state to main process for Tray, Discord RPC, and Notifications */
  updatePlayerState: (state) => {
    ipcRenderer.send('sc:player-state', state);
  },

  /** Sets custom Discord Application Client ID */
  setDiscordClientId: (clientId) => ipcRenderer.invoke('sc:set-discord-client-id', clientId),

  /** Proxy Server & Regional Geo-Bypass */
  getProxyConfig: () => ipcRenderer.invoke('sc:get-proxy-config'),
  setProxyConfig: (config) => ipcRenderer.invoke('sc:set-proxy-config', config),
  testProxy: (config) => ipcRenderer.invoke('sc:test-proxy', config),
  getBuiltinProxies: () => ipcRenderer.invoke('sc:get-builtin-proxies'),
  refreshProxies: () => ipcRenderer.invoke('sc:refresh-proxies'),

  /** Resolve official full stream via native yt-dlp backend */
  resolveOfficialStream: (params) => ipcRenderer.invoke('sc:resolve-official-stream', params),

  /** Software Auto-Updates */
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstall: () => ipcRenderer.invoke('updater:install'),
  getUpdateStatus: () => ipcRenderer.invoke('updater:status'),
  setUpdateFeedUrl: (options) => ipcRenderer.invoke('updater:set-feed-url', options),
  onUpdateStatus: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('updater:status-changed', handler);
    return () => ipcRenderer.removeListener('updater:status-changed', handler);
  },
});