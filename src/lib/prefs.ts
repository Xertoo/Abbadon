/**
 * User preferences.
 *
 * One flat object in localStorage, read once at boot and written back whenever
 * something changes. Kept apart from `themes.ts` because these are behavioural
 * choices rather than colours, and apart from the settings.json reader because
 * that file only seeds defaults on launch.
 */

import { useCallback, useEffect, useState } from 'react';

export interface Prefs {
  /**
   * When the queue runs out, ask SoundCloud for something related instead of
   * stopping. Suspended while Repeat or Shuffle is engaged.
   */
  autodiscovery: boolean;
  /** Master animation switch. Mirrors `prefers-reduced-motion` by default. */
  animations: boolean;
  /** Reapply the last used volume on launch. */
  rememberVolume: boolean;
  volume: number;
  /** Tighter track rows, so more of the list fits above the fold. */
  compactRows: boolean;
  /** Cover art in every track row. */
  showArtwork: boolean;
  /**
   * Which music catalog search and browsing operate on.
   *
   * SoundCloud is the home catalog; Audius is a fully open one (CC / Creative
   * Commons material), played the same way - search and play, no account. The
   * switch never touches the library: likes, playlists and history stay on the
   * SoundCloud account either way.
   *
   * Spotify is the third catalog and the only one that needs a sign-in (OAuth
   * PKCE with the user's own app Client ID). Full-length playback runs through
   * the Web Playback SDK, which is why it stays marked experimental.
   */
  source: 'soundcloud' | 'audius' | 'spotify';
  /**
   * Spotify app Client ID, pasted by the user from developer.spotify.com.
   * Kept here (not a secret) so the PKCE sign-in can run without a build step.
   */
  spotifyClientId: string;
  /** Left-side playlist order the user dragged into place. */
  playlistOrder: string[];
  /**
   * Playback speed multiplier, applied to every new track.
   *
   * Pitch is corrected by default: a speed change that also drags the vocal up
   * an octave is a karaoke trick, not a listening mode.
   */
  playbackRate: number;
  /** False switches the speed control to full pitch-shift (chipmunk) mode. */
  preservePitch: boolean;
  /**
   * Crossfade length in seconds (0..12). 0 is a hard cut.
   *
   * The outgoing track keeps playing while the next one is resolved and then
   * fades out over this window, so switching tracks never drops to silence.
   */
  crossfade: number;
  /** Playlists hidden by the user. */
  hiddenPlaylistIds: string[];
  /** Visualizer noise gate threshold (0..0.5). */
  visualizerThreshold: number;
  /** Visualizer amplitude gain/sensitivity (0.5..3.0). */
  visualizerSensitivity: number;
  /** Visualizer falloff smoothing (0.1..0.95). */
  visualizerSmoothing: number;
  /** Visualizer bar density (24..64). */
  visualizerBars: number;
  /** Background & Atmosphere mode. */
  bgMode: 'cosmic' | 'stars' | 'aurora' | 'particles' | 'minimal' | 'off';
  /** Shooting stars / meteors streaking across the sky. */
  bgShootingStars: boolean;
  /** React to audio frequencies & launch shooting stars on bass hits. */
  bgAudioReactive: boolean;
  /** Music responsiveness gain (0.5..2.5). */
  bgSensitivity: number;
  /** Star and particle density multiplier (0.5..2.5). */
  bgStarDensity: number;
  /** Animation speed multiplier (0.5..2.0). */
  bgSpeed: number;
  /** Background glow intensity/brightness (0.2..1.8). */
  bgIntensity: number;
  /** Color source for atmospheric glow and stars. */
  bgColorSource: 'artwork' | 'theme' | 'neon';
  /**
   * How much the background changes while music plays (0..1).
   *
   * Zero pins the palette: one hue, fixed star tint, no drift. One keeps the
   * glow slowly cycling through hues and spreads star colours wide, so no two
   * tracks ever sit against quite the same sky.
   */
  bgVariation: number;
  /** Master proxy toggle for unblocking regional tracks. */
  proxyEnabled: boolean;
  /** Proxy mode: built-in unblock pool or custom user proxy. */
  proxyMode: 'builtin' | 'custom';
  /** Preset for proxy / geo bypass. */
  proxyPreset: 'system' | string;
  /** Custom proxy protocol. */
  proxyCustomProtocol: 'http' | 'https' | 'socks5' | 'socks4';
  /** Custom proxy host/IP. */
  proxyCustomHost: string;
  /** Custom proxy port. */
  proxyCustomPort: string;
  /** Custom proxy authentication toggle. */
  proxyCustomAuth: boolean;
  /** Custom proxy username. */
  proxyCustomUser: string;
  /** Custom proxy password. */
  proxyCustomPass: string;
  /** Custom full proxy URL string. */
  proxyCustomUrl: string;
}

const KEY = 'sc9000:prefs';

/**
 * The factory defaults.
 *
 * Exported so "reset all settings" can rebuild the whole set in one go instead
 * of clearing fields one by one, which would strand any preference added later.
 */
export function defaultPrefs(): Prefs {
  return {
    autodiscovery: true,
    animations: true,
    rememberVolume: false,
    volume: 0.55,
    compactRows: false,
    showArtwork: true,
    source: 'soundcloud',
    spotifyClientId: '',
    playlistOrder: [],
    playbackRate: 1,
    preservePitch: true,
    crossfade: 3,
    hiddenPlaylistIds: [],
    visualizerThreshold: 0.05,
    visualizerSensitivity: 1.0,
    visualizerSmoothing: 0.8,
    visualizerBars: 48,
    bgMode: 'cosmic',
    bgShootingStars: true,
    bgAudioReactive: true,
    bgSensitivity: 1.0,
    bgStarDensity: 1.0,
    bgSpeed: 1.0,
    bgIntensity: 1.0,
    bgColorSource: 'artwork',
    bgVariation: 0.4,
    proxyEnabled: false,
    proxyMode: 'builtin',
    proxyPreset: 'system',
    proxyCustomProtocol: 'http',
    proxyCustomHost: '',
    proxyCustomPort: '',
    proxyCustomAuth: false,
    proxyCustomUser: '',
    proxyCustomPass: '',
    proxyCustomUrl: '',
  };
}

const clamp01 = (n: unknown, fallback: number) =>
  typeof n === 'number' && isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;

/** Kept in step with the rate steps the control itself offers. */
const clampRange = (n: unknown, fallback: number, min: number, max: number) =>
  typeof n === 'number' && isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;

const VALID_BG_MODES = ['cosmic', 'stars', 'aurora', 'particles', 'minimal', 'off'] as const;
const VALID_BG_COLORS = ['artwork', 'theme', 'neon'] as const;
const VALID_SOURCES = ['soundcloud', 'audius', 'spotify'] as const;

export function loadPrefs(): Prefs {
  const base = defaultPrefs();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    return {
      autodiscovery: typeof saved.autodiscovery === 'boolean' ? saved.autodiscovery : base.autodiscovery,
      animations: typeof saved.animations === 'boolean' ? saved.animations : base.animations,
      rememberVolume:
        typeof saved.rememberVolume === 'boolean' ? saved.rememberVolume : base.rememberVolume,
      volume: clamp01(saved.volume, base.volume),
      compactRows: typeof saved.compactRows === 'boolean' ? saved.compactRows : base.compactRows,
      showArtwork: typeof saved.showArtwork === 'boolean' ? saved.showArtwork : base.showArtwork,
      source:
        saved.source && VALID_SOURCES.includes(saved.source as any)
          ? saved.source
          : base.source,
      spotifyClientId:
        typeof saved.spotifyClientId === 'string' ? saved.spotifyClientId.trim() : base.spotifyClientId,
      playlistOrder: Array.isArray(saved.playlistOrder)
        ? saved.playlistOrder.filter((v): v is string => typeof v === 'string')
        : [],
      playbackRate: clampRange(saved.playbackRate, base.playbackRate, 0.5, 2),
      preservePitch: typeof saved.preservePitch === 'boolean' ? saved.preservePitch : base.preservePitch,
      crossfade: clampRange(saved.crossfade, base.crossfade, 0, 12),
      hiddenPlaylistIds: Array.isArray(saved.hiddenPlaylistIds)
        ? saved.hiddenPlaylistIds.filter((v): v is string => typeof v === 'string')
        : [],
      visualizerThreshold:
        typeof saved.visualizerThreshold === 'number' ? saved.visualizerThreshold : base.visualizerThreshold,
      visualizerSensitivity:
        typeof saved.visualizerSensitivity === 'number' ? saved.visualizerSensitivity : base.visualizerSensitivity,
      visualizerSmoothing:
        typeof saved.visualizerSmoothing === 'number' ? saved.visualizerSmoothing : base.visualizerSmoothing,
      visualizerBars:
        typeof saved.visualizerBars === 'number' ? saved.visualizerBars : base.visualizerBars,
      bgMode:
        saved.bgMode && VALID_BG_MODES.includes(saved.bgMode as any)
          ? saved.bgMode
          : base.bgMode,
      bgShootingStars:
        typeof saved.bgShootingStars === 'boolean' ? saved.bgShootingStars : base.bgShootingStars,
      bgAudioReactive:
        typeof saved.bgAudioReactive === 'boolean' ? saved.bgAudioReactive : base.bgAudioReactive,
      bgSensitivity: clampRange(saved.bgSensitivity, base.bgSensitivity, 0.5, 2.5),
      bgStarDensity: clampRange(saved.bgStarDensity, base.bgStarDensity, 0.5, 2.5),
      bgSpeed: clampRange(saved.bgSpeed, base.bgSpeed, 0.5, 2.0),
      bgIntensity: clampRange(saved.bgIntensity, base.bgIntensity, 0.2, 1.8),
      bgColorSource:
        saved.bgColorSource && VALID_BG_COLORS.includes(saved.bgColorSource as any)
          ? saved.bgColorSource
          : base.bgColorSource,
      bgVariation: clampRange(saved.bgVariation, base.bgVariation, 0, 1),
      proxyEnabled: typeof saved.proxyEnabled === 'boolean' ? saved.proxyEnabled : base.proxyEnabled,
      proxyMode: saved.proxyMode === 'custom' || saved.proxyMode === 'builtin' ? saved.proxyMode : base.proxyMode,
      proxyPreset: typeof saved.proxyPreset === 'string' && saved.proxyPreset ? saved.proxyPreset : base.proxyPreset,
      proxyCustomProtocol: ['http', 'https', 'socks5', 'socks4'].includes(saved.proxyCustomProtocol as any) ? (saved.proxyCustomProtocol as any) : base.proxyCustomProtocol,
      proxyCustomHost: typeof saved.proxyCustomHost === 'string' ? saved.proxyCustomHost : base.proxyCustomHost,
      proxyCustomPort: typeof saved.proxyCustomPort === 'string' ? saved.proxyCustomPort : (saved.proxyCustomPort ? String(saved.proxyCustomPort) : base.proxyCustomPort),
      proxyCustomAuth: typeof saved.proxyCustomAuth === 'boolean' ? saved.proxyCustomAuth : base.proxyCustomAuth,
      proxyCustomUser: typeof saved.proxyCustomUser === 'string' ? saved.proxyCustomUser : base.proxyCustomUser,
      proxyCustomPass: typeof saved.proxyCustomPass === 'string' ? saved.proxyCustomPass : base.proxyCustomPass,
      proxyCustomUrl: typeof saved.proxyCustomUrl === 'string' ? saved.proxyCustomUrl : base.proxyCustomUrl,
    };
  } catch {
    return base;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* quota - the in-memory preferences still apply for this session */
  }
}

/** Writes one key. The function identity is stable, so effects can depend on it. */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  const next = { ...loadPrefs(), [key]: value };
  savePrefs(next);
}

/**
 * Preferences as state, plus a stable setter.
 *
 * Every consumer shares one object rather than each keeping its own copy of a
 * flag, which is what stops the sidebar's order and the player's volume from
 * disagreeing after a restart.
 */
export function usePrefs(): {
  prefs: Prefs;
  update: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  replace: (next: Prefs) => void;
} {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  const update = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      savePrefs(next);
      return next;
    });
  }, []);

  const replace = useCallback((next: Prefs) => {
    setPrefs(next);
    savePrefs(next);
  }, []);

  return { prefs, update, replace };
}

/**
 * Applies the animation preference to the document.
 *
 * A class rather than a media query, because the user can override the OS
 * setting in either direction and `prefers-reduced-motion` cannot do that.
 */
export function useAnimationClass(enabled: boolean): void {
  useEffect(() => {
    document.documentElement.classList.toggle('no-anim', !enabled);
  }, [enabled]);
}