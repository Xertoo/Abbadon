/**
 * Web Playback SDK wrapper.
 *
 * The SDK turns this renderer into a Spotify Connect device and decrypts the
 * stream itself (Widevine/EME), which is the only way to get full-length
 * playback - the Web API never hands out an audio URL. It needs a Premium
 * account, and in Electron it needs a Widevine-enabled build to actually
 * decrypt; without a CDM the SDK still connects but silent play fails and an
 * error is surfaced.
 *
 * Everything is kept behind this class so the rest of the app only sees a small
 * transport surface: connect, play a URI, pause/resume, seek, volume.
 */

export interface SpotifyTrackMeta {
  uri: string;
  id: string | null;
  title: string;
  artist: string;
  durationMs: number;
  artwork: string;
}

export interface SpotifyPlayerSnapshot {
  paused: boolean;
  /** Playback position in ms. */
  position: number;
  /** Track length in ms. */
  duration: number;
  /** `spotify:track:...` of whatever the device is playing, when known. */
  uri: string | null;
  /** Details of the current track, so the UI can follow the SDK's own advance. */
  track: SpotifyTrackMeta | null;
}

type StateListener = (s: SpotifyPlayerSnapshot) => void;
type ErrorListener = (message: string, fatal: boolean) => void;
type ReadyListener = (deviceId: string) => void;

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: any;
  }
}

let sdkPromise: Promise<any> | null = null;

/** Loads `spotify-player.js` exactly once and resolves with the global SDK. */
export function loadSpotifySdk(): Promise<any> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.Spotify) {
      resolve(window.Spotify);
      return;
    }
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify);
    if (!document.getElementById('spotify-web-playback-sdk')) {
      const script = document.createElement('script');
      script.id = 'spotify-web-playback-sdk';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.onerror = () => reject(new Error('Could not load the Spotify Web Playback SDK'));
      document.body.appendChild(script);
    }
  });
  return sdkPromise;
}

export class SpotifySdkPlayer {
  private player: any = null;
  private deviceId: string | null = null;
  private ready = false;
  private destroyed = false;
  private volume = 0.7;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private stateListeners = new Set<StateListener>();
  private errorListeners = new Set<ErrorListener>();
  private readyListeners = new Set<ReadyListener>();

  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly name = 'Abbadon'
  ) {}

  onState(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  onError(cb: ErrorListener): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  onReady(cb: ReadyListener): () => void {
    this.readyListeners.add(cb);
    if (this.deviceId) cb(this.deviceId);
    return () => this.readyListeners.delete(cb);
  }

  getDeviceId(): string | null {
    return this.deviceId;
  }

  isReady(): boolean {
    return this.ready;
  }

  private emitError(message: string, fatal = false): void {
    this.errorListeners.forEach((f) => f(message, fatal));
  }

  private snapshot(state: any): SpotifyPlayerSnapshot {
    const cur = state.track_window?.current_track;
    return {
      paused: !!state.paused,
      position: state.position ?? 0,
      duration: state.duration ?? 0,
      uri: cur?.uri ?? null,
      track: cur
        ? {
            uri: cur.uri,
            id: cur.id ?? null,
            title: cur.name ?? 'Unknown track',
            artist: (cur.artists ?? []).map((a: any) => a.name).join(', '),
            durationMs: cur.duration_ms ?? 0,
            artwork: cur.album?.images?.[0]?.url ?? '',
          }
        : null,
    };
  }

  /**
   * `player_state_changed` only fires on discrete changes, so the progress bar
   * would sit still during playback. While playing, poll the current state so
   * the position advances, and stop the moment the track pauses or ends.
   */
  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (this.destroyed || !this.player) return;
      void Promise.resolve(this.player.getCurrentState())
        .then((state: any) => {
          if (!state) return;
          this.stateListeners.forEach((f) => f(this.snapshot(state)));
          if (state.paused) this.stopPolling();
        })
        .catch(() => {
          /* transient - the next tick retries */
        });
    }, 750);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async connect(): Promise<void> {
    const Spotify = await loadSpotifySdk();
    if (this.destroyed) return;

    this.player = new Spotify.Player({
      name: this.name,
      getOAuthToken: (cb: (token: string) => void) => {
        this.getToken()
          .then(cb)
          .catch(() => {
            /* a failed refresh is reported by the auth error below */
          });
      },
      volume: this.volume,
    });

    this.player.addListener('ready', ({ device_id }: { device_id: string }) => {
      this.deviceId = device_id;
      this.ready = true;
      this.readyListeners.forEach((f) => f(device_id));
    });
    this.player.addListener('not_ready', () => {
      this.deviceId = null;
      this.ready = false;
    });
    this.player.addListener('player_state_changed', (state: any) => {
      if (!state) return;
      this.stateListeners.forEach((f) => f(this.snapshot(state)));
      if (state.paused) this.stopPolling();
      else this.startPolling();
    });
    this.player.addListener('initialization_error', ({ message }: any) =>
      this.emitError(message || 'Spotify player failed to initialize', true)
    );
    this.player.addListener('authentication_error', ({ message }: any) =>
      this.emitError(message || 'Spotify authentication failed - sign in again', true)
    );
    this.player.addListener('account_error', ({ message }: any) =>
      this.emitError(message || 'Spotify Premium is required for full playback', true)
    );

    const ok = await this.player.connect();
    if (!ok) this.emitError('Spotify player could not connect', true);
  }

  /**
   * Must be called from a user gesture the first time, or Chromium refuses to
   * let the SDK's audio element start.
   */
  async activate(): Promise<void> {
    try {
      await this.player?.activateElement?.();
    } catch {
      /* activation is best-effort */
    }
  }

  async resume(): Promise<void> {
    await this.player?.resume();
  }

  async pause(): Promise<void> {
    await this.player?.pause();
  }

  async togglePlay(): Promise<void> {
    await this.player?.togglePlay();
  }

  async seek(positionMs: number): Promise<void> {
    await this.player?.seek(Math.max(0, Math.floor(positionMs)));
  }

  async setVolume(v: number): Promise<void> {
    this.volume = Math.min(1, Math.max(0, v));
    try {
      await this.player?.setVolume(this.volume);
    } catch {
      /* player not connected yet */
    }
  }

  /** Releases the device. Safe to call more than once. */
  async disconnect(): Promise<void> {
    this.destroyed = true;
    this.ready = false;
    this.deviceId = null;
    this.stopPolling();
    try {
      await this.player?.disconnect();
    } catch {
      /* already gone */
    }
    this.player = null;
  }
}
