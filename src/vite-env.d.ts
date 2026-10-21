/// <reference types="vite/client" />

export {};

interface DesktopInfo {
  version: string;
  platform: string;
  dev: boolean;
}

interface DesktopFetchResult {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text: string;
  error?: string;
}

interface DesktopLoginResult {
  ok: boolean;
  token?: string;
  reason?: string;
}

interface DesktopSpotifyConfig {
  redirectUri: string;
  scopes: string;
}

interface DesktopSpotifyTokenResult {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
}

interface DesktopSettingsResult {
  ok: boolean;
  missing?: boolean;
  path: string;
  data?: DesktopSettings;
  error?: string | null;
}

interface DesktopBridge {
  isDesktop: true;
  platform: string;
  versions: { electron: string; chrome: string };
  info: () => Promise<DesktopInfo>;
  /** Reads the optional userData/settings.json. */
  loadSettings: () => Promise<DesktopSettingsResult>;
  /** Absolute path of that settings.json, for showing it in the UI. */
  settingsPath: () => Promise<string>;
  /** Relays an HTTP request through the main process (CORS-free, cookie-aware). */
  fetch: (
    url: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string | null }
  ) => Promise<DesktopFetchResult>;
  /** Opens the SoundCloud sign-in window and resolves once a token is captured. */
  login: () => Promise<DesktopLoginResult>;
  logout: () => Promise<{ ok: boolean }>;
  /** Returns the fixed loopback redirect URI + scopes the Spotify app must allow. */
  spotifyConfig: () => Promise<DesktopSpotifyConfig>;
  /** Runs the Spotify PKCE flow with the user's own app Client ID. */
  spotifyLogin: (clientId: string) => Promise<DesktopSpotifyTokenResult>;
  /** Exchanges a stored refresh token for a fresh access token. */
  spotifyRefresh: (clientId: string, refreshToken: string) => Promise<DesktopSpotifyTokenResult>;
  /** Saves a signed CDN link into the OS Downloads/Music folder with full ID3 metadata. */
  download: (
    payload:
      | string
      | {
          url: string;
          title?: string;
          artist?: string;
          album?: string;
          artwork?: string | null;
          genre?: string;
          year?: number | string;
          downloadPath?: string;
        },
    legacyTitle?: string
  ) => Promise<{ ok: boolean; file?: string; error?: string }>;
  chooseDownloadFolder?: (currentPath?: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  getDefaultDownloadDir?: () => Promise<string>;
  onDownload: (cb: (p: { state: string; file: string; receivedBytes?: number; totalBytes?: number }) => void) => () => void;
  onMediaCommand: (cb: (action: 'toggle' | 'next' | 'prev' | 'stop') => void) => () => void;
  onNavCommand: (cb: (action: 'back' | 'forward') => void) => () => void;
  updatePlayerState?: (state: {
    track: { id: number | string; title: string; artist: string; artwork?: string | null; permalinkUrl?: string } | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    friendCode?: string;
    shareDiscordFriendCode?: boolean;
    showDiscordButtons?: boolean;
    volume?: number;
  }) => void;
  onTrayStateSync?: (cb: (_e: unknown, state: any) => void) => () => void;
  onMiniPinnedSync?: (cb: (pinned: boolean) => void) => () => void;
  sendMiniCommand?: (action: string, value?: unknown) => void;
  sendMiniPrefs?: (prefs: any) => void;
  onMiniPrefsSync?: (cb: (prefs: any) => void) => () => void;
  updateGlobalShortcuts?: (shortcuts: Record<string, any>) => Promise<{ ok: boolean; error?: string }>;
  getGlobalShortcuts?: () => Promise<{ ok: boolean; shortcuts: Record<string, any> }>;
  onSeekCommand?: (cb: (time: number) => void) => () => void;
  onVolumeCommand?: (cb: (vol: number) => void) => () => void;
  onDiscordJoinFriend?: (cb: (code: string) => void) => () => void;
  setDiscordClientId?: (clientId: string) => Promise<{ ok: boolean; clientId?: string; error?: string }>;
  /** Proxy Server & Regional Geo-Bypass */
  getProxyConfig?: () => Promise<DesktopProxyState>;
  setProxyConfig?: (config: Partial<ProxyConfig>) => Promise<{ ok: boolean; proxyRules?: string; status?: string; error?: string }>;
  testProxy?: (config?: Partial<ProxyConfig>) => Promise<ProxyTestResult>;
  getBuiltinProxies?: () => Promise<BuiltinProxyPreset[]>;
  refreshProxies?: () => Promise<{ ok: boolean; count?: number; fastest?: { host: string; port: number; latency: number }; error?: string }>;
  resolveOfficialStream?: (params: { artist: string; title: string }) => Promise<{
    ok: boolean;
    url?: string;
    duration?: number;
    title?: string;
    error?: string;
  }>;
  /** Software Auto-Updates */
  checkForUpdates?: () => Promise<{ ok: boolean; error?: string; updateInfo?: unknown }>;
  downloadUpdate?: () => Promise<{ ok: boolean; error?: string }>;
  quitAndInstall?: () => void;
  getUpdateStatus?: () => Promise<UpdateState>;
  setUpdateFeedUrl?: (options: string | { provider: string; owner: string; repo: string } | { provider: string; url: string }) => Promise<{ ok: boolean; error?: string }>;
  onUpdateStatus?: (cb: (state: UpdateState) => void) => () => void;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  currentVersion: string;
  availableVersion: string | null;
  releaseNotes?: string | null;
  progressPercent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
  error: string | null;
  feedUrl?: string | null;
}

export interface ProxyConfig {
  enabled: boolean;
  mode: 'builtin' | 'custom';
  preset: 'system' | 'clash' | 'v2ray' | 'tor' | string;
  customProtocol: 'http' | 'https' | 'socks5' | 'socks4';
  customHost: string;
  customPort: string | number;
  customAuth: boolean;
  customUser: string;
  customPass: string;
  customUrl?: string;
}

export interface ProxyTestResult {
  ok: boolean;
  latency?: number;
  ip?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  isp?: string;
  proxyHost?: string;
  proxyPort?: number;
  proxyProtocol?: string;
  soundcloudOk?: boolean;
  soundcloudStatus?: number;
  message: string;
}

export interface BuiltinProxyPreset {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  flag: string;
  description: string;
}

export interface DesktopProxyState {
  config: ProxyConfig;
  status: 'connected' | 'disconnected' | 'testing' | 'error';
  activeResolvedProxy?: { host: string; port: number; protocol: string; country?: string; flag?: string } | null;
  lastTestResult?: ProxyTestResult | null;
  localPort: number;
  presets: BuiltinProxyPreset[];
}

/**
 * Optional startup overrides read from `settings.json` in the Electron
 * userData folder. Anything present here wins over localStorage.
 */
interface DesktopSettings {
  /** EQ gains, resampled to `eqBands` when that is also given. */
  eq?: unknown;
  /** Band count: 4, 8 or 16. */
  eqBands?: unknown;
  visualizer?: unknown;
  autodiscovery?: unknown;
  /** Optional proxy configuration seeded at launch. */
  proxy?: unknown;
  /**
   * A theme name, a custom theme id, or `{ accent, mode }` for a one-off
   * theme built at launch.
   */
  theme?: unknown;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}