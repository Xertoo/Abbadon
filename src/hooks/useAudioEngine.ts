import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

/**
 * Web Audio playback. Two <audio> elements (active + standby) are fed through
 * MediaElementSource + AnalyserNode so we can render a real spectrum, crossfade
 * between tracks, and warm the next stream without one AudioContext per track.
 */

export interface PlayerTrackLike {
  id: string;
  title: string;
  artist: string;
  artwork: string;
  duration: number;
  streamUrl?: string;
}

export interface EqBand {
  id: string;
  label: string;
  freq: number;
  gain: number;
}

/** Selectable band counts. The audio graph is rebuilt when this changes. */
export type BandCount = 4 | 8 | 16;

export const EQ_BAND_COUNTS: BandCount[] = [4, 8, 16];

/**
 * Frequency layouts.
 *
 * 4 is plain octave spacing, 8 is half-octave (the usual "graphic EQ" shape),
 * and 16 runs from 25 Hz to 16 kHz. The wider layout spans further at both
 * ends so the extra resolution is actually useful on real material.
 */
const EQ_LAYOUTS: Record<BandCount, { label: string; freq: number }[]> = {
  4: [
    { label: '60', freq: 60 },
    { label: '250', freq: 250 },
    { label: '1k', freq: 1000 },
    { label: '4k', freq: 4000 },
  ],
  8: [
    { label: '31', freq: 31.5 },
    { label: '63', freq: 63 },
    { label: '125', freq: 125 },
    { label: '250', freq: 250 },
    { label: '500', freq: 500 },
    { label: '1k', freq: 1000 },
    { label: '2k', freq: 2000 },
    { label: '4k', freq: 4000 },
  ],
  16: [
    { label: '25', freq: 25 },
    { label: '40', freq: 40 },
    { label: '63', freq: 63 },
    { label: '100', freq: 100 },
    { label: '160', freq: 160 },
    { label: '250', freq: 250 },
    { label: '400', freq: 400 },
    { label: '630', freq: 630 },
    { label: '1k', freq: 1000 },
    { label: '1.6k', freq: 1600 },
    { label: '2.5k', freq: 2500 },
    { label: '4k', freq: 4000 },
    { label: '6.3k', freq: 6300 },
    { label: '10k', freq: 10000 },
    { label: '12.5k', freq: 12500 },
    { label: '16k', freq: 16000 },
  ],
};

/** Live band list for a count. Cached, because it is read on every render. */
const bandCache = new Map<BandCount, EqBand[]>();

export function bandsFor(count: BandCount): EqBand[] {
  const hit = bandCache.get(count);
  if (hit) return hit;
  const list = EQ_LAYOUTS[count].map((b, i) => ({
    id: `b${String(i).padStart(2, '0')}`,
    label: b.label,
    freq: b.freq,
    gain: 0,
  }));
  bandCache.set(count, list);
  return list;
}

/** Frequencies the old 5-band build shipped with, kept for migration. */
export const EQ_LEGACY_FREQS = [60, 250, 1000, 4000, 12000];

export const EQ_RANGE = 12;

const clampDb = (n: unknown) =>
  Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Math.round(Number(n) || 0)));

/**
 * Resamples a curve onto a new set of centre frequencies.
 *
 * Interpolates in log-frequency space, because that is how the bands are
 * actually spaced: doing it linearly would drag a 1 kHz boost down towards
 * 100 Hz. Values outside the source range are clamped to the nearest known
 * point, which is what a lowshelf/highshelf naturally does anyway.
 */
export function resampleEq(
  fromFreqs: number[],
  gains: number[],
  toFreqs: number[]
): number[] {
  if (!fromFreqs.length || fromFreqs.length !== gains.length) {
    return toFreqs.map(() => 0);
  }

  return toFreqs.map((f) => {
    if (f <= fromFreqs[0]) return clampDb(gains[0]);
    const last = fromFreqs.length - 1;
    if (f >= fromFreqs[last]) return clampDb(gains[last]);

    for (let i = 0; i < last; i++) {
      const a = fromFreqs[i];
      const b = fromFreqs[i + 1];
      if (f < a || f > b) continue;
      const t = (Math.log(f) - Math.log(a)) / (Math.log(b) - Math.log(a));
      return clampDb(gains[i] + (gains[i + 1] - gains[i]) * t);
    }
    return clampDb(gains[last]);
  });
}

/**
 * Prepares a saved curve for the requested band count.
 *
 * Saved curves carry no frequencies, only gains, so the layout is inferred
 * from the length: 4/8/16 map to the layouts above and 5 is the retired
 * default. Anything else is treated as custom and dropped rather than guessed
 * at, because a wrong guess silently distorts someone's mix.
 */
export function migrateEq(saved: number[], count: BandCount = 8): number[] {
  const target = bandsFor(count).map((b) => b.freq);

  if (saved.length === count) return saved.map(clampDb);

  const legacy = EQ_LEGACY_FREQS;
  if (saved.length === legacy.length) {
    return resampleEq(legacy, saved.map(clampDb), target);
  }

  for (const n of EQ_BAND_COUNTS) {
    if (saved.length === n) {
      const from = bandsFor(n).map((b) => b.freq);
      return resampleEq(from, saved.map(clampDb), target);
    }
  }

  return new Array(count).fill(0);
}

/**
 * Presets are authored once, at 16 bands, and resampled down to the active
 * count. Storing four parallel tables meant every tweak had to be made four
 * times and the copies drifted apart.
 */
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2],
  'Bass boost': [9, 8, 7, 5, 3, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3],
  Vocal: [-3, -3, -2, -1, 0, 1, 3, 4, 4, 3, 2, 1, 0, -1, -2, -3],
  Treble: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 5, 6, 7, 8, 8],
  Loudness: [5, 4, 3, 2, 1, 0, 0, 0, 0, 1, 2, 3, 3, 4, 5, 5],
  Electronic: [6, 5, 4, 2, 0, -1, -2, -1, 1, 3, 4, 4, 5, 6, 7, 7],
  Acoustic: [2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 3, 4, 4, 4, 4, 3],
};

/** The gains for a named preset at the active band count. */
export function presetEq(name: string, count: BandCount): number[] {
  const source = EQ_PRESETS[name] ?? EQ_PRESETS.Flat;
  const full = bandsFor(16).map((b) => b.freq);
  const target = bandsFor(count).map((b) => b.freq);
  return resampleEq(full, source, target);
}

export const PRESET_NAMES = Object.keys(EQ_PRESETS);

export interface PlayerApi {
  audio: HTMLAudioElement | null;
  /** The element that is actually audible right now, read live. */
  getActive: () => HTMLAudioElement | null;
  /**
   * True for the active element and for the one the next `play()` will promote.
   * Media error handlers have to answer the staged track too: it is not active
   * the moment its stream refuses to load, but that refusal is still the cue
   * to walk the format ladder.
   */
  isMediaTarget: (el: HTMLAudioElement) => boolean;
  /** Every element the engine owns. Callers attach media events to all of
   *  them and ignore the ones that are not active. */
  audioElements: () => HTMLAudioElement[];
  load: (src: string | null) => void;
  /**
   * Stages the standby slot so the next `play()` starts from a filled buffer.
   * Same element the switch promotes, so a `load()` on the same URL afterwards
   * short-circuits instead of re-fetching. Best effort: a refused stream simply
   * does not stage.
   */
  preload: (src: string | null) => void;
  play: () => Promise<void>;
  pause: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  /** Crossfade length in seconds. 0 is a hard cut. */
  setCrossfade: (seconds: number) => void;
  crossfade: () => number;
  /** Playback speed, 0.5..2. */
  setRate: (r: number) => void;
  rate: () => number;
  /**
   * Keeps the pitch fixed while the rate changes.
   *
   * Web Audio has no separate pitch control on a media element, so this maps to
   * the element's own `preservesPitch`: on leaves the pitch alone, off lets the
   * rate drag it along (chipmunk).
   */
  setPreservePitch: (on: boolean) => void;
  preservePitch: () => boolean;
  getAnalyser: () => AnalyserNode | null;
  getFreq: () => Uint8Array | null;
  onEnded: (fn: () => void) => () => void;
  /**
   * Fires while the active track is still playing, `crossfade + margin`
   * seconds from its natural end. The switch it triggers can then crossfade
   * instead of hard-cutting after the element has already stopped.
   */
  onNearEnd: (fn: () => void) => () => void;
  currentTime: () => number;
  duration: () => number;
  setEq: (gains: number[]) => void;
  /** Switches the filter chain to a different band count. Returns the resampled
   *  curve so the caller can mirror it into state. */
  setBandCount: (count: BandCount) => number[];
  bandCount: () => BandCount;
  setLoudnessEqualizer: (on: boolean) => void;
  setSpatialAudio: (on: boolean) => void;
  setAutoTrimSilence: (on: boolean) => void;
  setSilenceBounds: (startSec: number, endSec: number) => void;
}

/**
 * Perceptual volume curve.
 *
 * A linear slider is unusable here: SoundCloud streams are mastered loud, so
 * the top of the range clips and every useful setting is crammed into the
 * first few percent. This maps the slider to an equal-loudness curve and caps
 * the ceiling below unity, with extra headroom when the EQ is boosting.
 *
 * The band count lives at module scope because the gain compensation has to
 * see it before React has re-rendered, and `setEq` can arrive first.
 */
const eqState = { count: 8 as BandCount, gains: EQ_PRESETS.Flat };

/**
 * Rate and pitch mode live at module scope for the same reason as the EQ: a new
 * track must inherit the speed the user picked without waiting for a re-render,
 * since `load` runs before React has committed the new state.
 */
export const RATE_MIN = 0.5;
export const RATE_MAX = 2;
const rateState = { value: 1, preservePitch: true };

/** The steps the control offers. 0.05 near 1x, coarser at the extremes. */
export const RATE_STEPS = [
  0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.25, 1.5, 1.75, 2,
];

export function formatRate(r: number): string {
  return `${Number.isInteger(r) ? r : r.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

/**
 * Crossfade length in seconds.
 *
 * Lives at module scope for the same reason as the rate: a track switch has to
 * know whether to fade or to cut before React has committed the new settings,
 * and `play()` runs first.
 */
export const CROSSFADE_MAX = 12;
const crossfadeState = { seconds: 3 };

/** Builds one playback element. Both slots share the setup. */
function makeElement(): HTMLAudioElement {
  const a = new Audio();
  // Required for the Web Audio graph: an element fed into createMediaElementSource
  // without CORS-clean media outputs silence.
  a.crossOrigin = 'anonymous';
  a.preload = 'auto';
  applyRateTo(a);
  return a;
}

/**
 * Writes the current rate and pitch mode onto an element.
 *
 * Module scope because three places need it - a new track, a user change, and the
 * element created at mount - and `load` runs before any of the callbacks that
 * could otherwise supply it. Both vendor-prefixed `preservesPitch` spellings are
 * set because Chromium honours only one of them on some builds, and a silent
 * no-op there would leave the pitch shifted with no sign of why.
 */
function applyRateTo(audio: HTMLAudioElement): void {
  const el = audio as HTMLAudioElement & {
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  audio.playbackRate = rateState.value;
  audio.preservesPitch = rateState.preservePitch;
  el.mozPreservesPitch = rateState.preservePitch;
  el.webkitPreservesPitch = rateState.preservePitch;
}

function masterGainFor(volume: number): number {
  const v = Math.min(1, Math.max(0, volume));
  // x^2.2 ≈ -18 dB at the top instead of 0 dB.
  const ceiling = 0.85;
  let gain = ceiling * Math.pow(v, 2.2);

  // Boosted bands add level, so give some of it back. The filters overlap, so
  // this is a partial compensation rather than a full inverse of the sum.
  const boost = eqState.gains.reduce<number>((sum, g) => sum + Math.max(0, g), 0);
  if (boost > 0) gain *= 1 / (1 + boost / 30);

  return Math.min(0.95, gain);
}

/**
 * One playback element plus the URL last assigned to it.
 *
 * Two of these exist for the lifetime of the app: the active slot is what the
 * UI reads, the standby slot holds the track that is about to start. Swapping
 * them is what makes a crossfade possible - the outgoing track keeps playing
 * through its own element while the incoming one ramps up.
 */
interface Slot {
  el: HTMLAudioElement;
  src: string | null;
  fade: GainNode | null;
  hls?: Hls | null;
  nearFired?: boolean;
  startSilenceSec?: number;
  endSilenceSec?: number;
  introDone?: boolean;
}

function isHlsUrl(src: string): boolean {
  try {
    const parsed = new URL(src);
    return (
      parsed.pathname.endsWith('.m3u8') ||
      parsed.pathname.includes('/hls') ||
      parsed.searchParams.has('hls') ||
      /\.m3u8($|\?)/i.test(src) ||
      src.includes('/hls') ||
      src.includes('audio/mpegurl')
    );
  } catch {
    return /\.m3u8($|\?)/i.test(src) || src.includes('/hls') || src.includes('audio/mpegurl');
  }
}

function setSlotSource(
  slot: Slot,
  src: string | null,
  applyRate: (el: HTMLAudioElement) => void
): void {
  if (slot.hls) {
    try {
      slot.hls.destroy();
    } catch {
      /* ignore */
    }
    slot.hls = null;
  }

  slot.src = src;
  slot.nearFired = false;
  slot.startSilenceSec = 0;
  slot.endSilenceSec = 0;
  slot.introDone = false;

  if (!src) {
    slot.el.removeAttribute('src');
    slot.el.load();
    return;
  }

  if (isHlsUrl(src) && Hls.isSupported()) {
    slot.el.removeAttribute('src');
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 90,
      maxBufferLength: 60,
      maxMaxBufferLength: 300,
      startFragPrefetch: true,
      testBandwidth: false,
      progressive: true,
      fragLoadingMaxRetry: 2,
    });
    let networkRetries = 0;
    let mediaRetries = 0;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        console.warn('[AudioEngine/Hls] Fatal error:', data.type, data.details);
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: {
            const status = data.response?.code;
            if (status === 401 || status === 403 || status === 404 || networkRetries >= 2) {
              try {
                hls.destroy();
              } catch {
                /* ignore */
              }
              slot.hls = null;
              slot.el.dispatchEvent(new Event('error'));
            } else {
              networkRetries++;
              try {
                hls.startLoad();
              } catch {
                try {
                  hls.destroy();
                } catch {
                  /* ignore */
                }
                slot.hls = null;
                slot.el.dispatchEvent(new Event('error'));
              }
            }
            break;
          }
          case Hls.ErrorTypes.MEDIA_ERROR: {
            if (mediaRetries >= 2) {
              try {
                hls.destroy();
              } catch {
                /* ignore */
              }
              slot.hls = null;
              slot.el.dispatchEvent(new Event('error'));
            } else {
              mediaRetries++;
              try {
                hls.recoverMediaError();
              } catch {
                try {
                  hls.destroy();
                } catch {
                  /* ignore */
                }
                slot.hls = null;
                slot.el.dispatchEvent(new Event('error'));
              }
            }
            break;
          }
          default:
            try {
              hls.destroy();
            } catch {
              /* ignore */
            }
            slot.hls = null;
            slot.el.dispatchEvent(new Event('error'));
            break;
        }
      }
    });
    hls.loadSource(src);
    hls.attachMedia(slot.el);
    slot.hls = hls;
    applyRate(slot.el);
  } else {
    slot.el.preload = 'auto';
    slot.el.src = src;
    applyRate(slot.el);
    slot.el.load();
  }
}

export function useAudioEngine(): PlayerApi {
  const slotsRef = useRef<Slot[]>([]);
  const activeRef = useRef(0);
  const pendingIdxRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const busRef = useRef<GainNode | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const eqRef = useRef<BiquadFilterNode[]>([]);
  const endedRef = useRef<(() => void)[]>([]);
  const nearEndRef = useRef<(() => void)[]>([]);
  const volumeRef = useRef(0.55);
  const countRef = useRef<BandCount>(eqState.count);
  const fadeTimersRef = useRef<number[]>([]);

  if (!slotsRef.current.length && typeof Audio !== 'undefined') {
    slotsRef.current = [
      { el: makeElement(), src: null, fade: null },
      { el: makeElement(), src: null, fade: null },
    ];
  }

  const activeEl = (): HTMLAudioElement | null =>
    slotsRef.current[activeRef.current]?.el ?? null;

  const isMediaTarget = useCallback((el: HTMLAudioElement) => {
    const slots = slotsRef.current;
    if (!slots.length) return false;
    if (slots[activeRef.current]?.el === el) return true;
    const p = pendingIdxRef.current;
    return p !== null && slots[p]?.el === el;
  }, []);

  const clearFadeTimers = useCallback(() => {
    fadeTimersRef.current.forEach((t) => window.clearTimeout(t));
    fadeTimersRef.current = [];
  }, []);

  /**
   * Wires slots -> bus -> filters -> master. Called on first play, because the
   * graph cannot be built before React mounts and both elements have to be
   * routed through it: whichever slot is active is always inside the chain.
   */
  const buildEqChain = useCallback((ctx: AudioContext, head: AudioNode) => {
    const bands = bandsFor(eqState.count);
    let node: AudioNode = head;

    eqRef.current.forEach((f) => {
      try {
        f.disconnect();
      } catch {
        /* already detached */
      }
    });
    eqRef.current = [];

    for (let i = 0; i < bands.length; i++) {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === bands.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = bands[i].freq;
      f.gain.value = eqState.gains[i] ?? 0;
      if (f.type === 'peaking') f.Q.value = 1.1;
      node.connect(f);
      node = f;
      eqRef.current.push(f);
    }

    return node;
  }, []);

  const loudnessRef = useRef(false);
  const spatialRef = useRef(false);
  const spatialInputRef = useRef<GainNode | null>(null);
  const spatialDryGainRef = useRef<GainNode | null>(null);
  const spatialWetGainRef = useRef<GainNode | null>(null);
  const directGainRef = useRef<GainNode | null>(null);
  const compGainRef = useRef<GainNode | null>(null);
  const autoTrimSilenceRef = useRef(true);
  const silenceStreakRef = useRef(0);

  const ensureGraph = useCallback(() => {
    const slots = slotsRef.current;
    if (!slots.length || ctxRef.current) return;
    const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;

    // Both slots feed a shared bus, so the EQ, analyser and master gain stay
    // single instances even though the source element changes on every switch.
    const bus = ctx.createGain();
    bus.gain.value = 1;
    for (const s of slots) {
      const src = ctx.createMediaElementSource(s.el);
      const fade = ctx.createGain();
      fade.gain.value = 1;
      src.connect(fade);
      fade.connect(bus);
      s.fade = fade;
    }

    // EQ sits between the bus and the master gain, so a boosted band
    // cannot push the output into clipping on its own.
    const tail = buildEqChain(ctx, bus);

    // --- Spatial 3D Audio Network ---
    const spatialInput = ctx.createGain();
    spatialInputRef.current = spatialInput;

    const spatialDry = ctx.createGain();
    spatialDry.gain.value = spatialRef.current ? 0 : 1;
    spatialDryGainRef.current = spatialDry;

    const spatialWet = ctx.createGain();
    spatialWet.gain.value = spatialRef.current ? 1 : 0;
    spatialWetGainRef.current = spatialWet;

    const presence = ctx.createBiquadFilter();
    presence.type = 'highshelf';
    presence.frequency.value = 9000;
    presence.gain.value = 2.5;

    const depth = ctx.createBiquadFilter();
    depth.type = 'lowshelf';
    depth.frequency.value = 85;
    depth.gain.value = 2.0;

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const delayL = ctx.createDelay(0.05);
    delayL.delayTime.value = 0.013;
    const delayR = ctx.createDelay(0.05);
    delayR.delayTime.value = 0.013;
    const crossGainL = ctx.createGain();
    crossGainL.gain.value = -0.32;
    const crossGainR = ctx.createGain();
    crossGainR.gain.value = -0.32;

    tail.connect(spatialInput);
    spatialInput.connect(spatialDry);
    spatialInput.connect(presence);
    presence.connect(depth);
    depth.connect(splitter);

    // Direct L -> L, Direct R -> R
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 1, 1);
    // Cross delay L -> R, R -> L
    splitter.connect(delayL, 0);
    delayL.connect(crossGainL);
    crossGainL.connect(merger, 0, 1);
    splitter.connect(delayR, 1);
    delayR.connect(crossGainR);
    crossGainR.connect(merger, 0, 0);

    merger.connect(spatialWet);

    const preComp = ctx.createGain();
    spatialDry.connect(preComp);
    spatialWet.connect(preComp);

    // --- Loudness Equalizer (Dynamics Compressor) Network ---
    const directComp = ctx.createGain();
    directComp.gain.value = loudnessRef.current ? 0 : 1;
    directGainRef.current = directComp;

    const wetComp = ctx.createGain();
    wetComp.gain.value = loudnessRef.current ? 1.25 : 0;
    compGainRef.current = wetComp;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.15;

    preComp.connect(directComp);
    preComp.connect(compressor);
    compressor.connect(wetComp);

    const master = ctx.createGain();
    master.gain.value = masterGainFor(volumeRef.current);

    directComp.connect(master);
    wetComp.connect(master);

    master.connect(analyser);
    analyser.connect(ctx.destination);

    ctxRef.current = ctx;
    analyserRef.current = analyser;
    busRef.current = bus;
    masterRef.current = master;
  }, [buildEqChain]);

  useEffect(() => {
    const slots = slotsRef.current;
    const handlers: {
      el: HTMLAudioElement;
      fn: () => void;
      near: () => void;
    }[] = [];
    for (const s of slots) {
      const el = s.el;
      const fn = () => {
        // An outgoing track running out its crossfade must not advance the
        // queue - only the track the UI is showing may end playback.
        if (slotsRef.current[activeRef.current]?.el !== el) return;
        endedRef.current.forEach((f) => f());
      };
      const near = () => {
        const ai = activeRef.current;
        const curSlot = slotsRef.current[ai];
        if (curSlot?.el !== el) return;
        const cf = crossfadeState.seconds;
        if (cf <= 0) return;
        // The `ended` event arrives only after the element has stopped, by which
        // point there is nothing left to fade out. Fire the handover a beat
        // early instead, while the track is still audible, so `play()` can cross
        // it into the next one over its own ramp.
        if (el.paused || el.ended) return;
        if (el.currentTime <= 1) return;
        if (!isFinite(el.duration)) return;
        if (el.duration - el.currentTime <= cf + 0.25) {
          if (curSlot.nearFired) return;
          curSlot.nearFired = true;
          nearEndRef.current.forEach((f) => f());
        }
      };
      el.addEventListener('ended', fn);
      el.addEventListener('timeupdate', near);
      handlers.push({ el, fn, near });
    }

    const silenceInterval = setInterval(() => {
      if (!autoTrimSilenceRef.current) return;
      const ai = activeRef.current;
      const curSlot = slotsRef.current[ai];
      const el = curSlot?.el;
      if (!el || el.paused || el.ended || !isFinite(el.duration) || el.duration <= 10) return;

      // 1. Bound-based start silence check (from precomputed waveform)
      if (curSlot.startSilenceSec && curSlot.startSilenceSec >= 2.0 && el.currentTime < curSlot.startSilenceSec) {
        curSlot.introDone = true;
        try {
          el.currentTime = curSlot.startSilenceSec;
        } catch {
          /* ignore */
        }
        return;
      }

      // 2. Bound-based outro silence check (from precomputed waveform)
      if (
        curSlot.endSilenceSec &&
        curSlot.endSilenceSec > 0 &&
        curSlot.endSilenceSec < el.duration &&
        el.currentTime >= curSlot.endSilenceSec
      ) {
        if (!curSlot.nearFired) {
          curSlot.nearFired = true;
          nearEndRef.current.forEach((f) => f());
        }
        el.currentTime = Math.max(el.currentTime, el.duration - 0.25);
        return;
      }

      const analyser = analyserRef.current;
      if (!analyser) return;

      const bins = analyser.frequencyBinCount;
      let buf = freqBufferRef.current;
      if (!buf || buf.length !== bins) {
        buf = new Uint8Array(bins);
        freqBufferRef.current = buf;
      }
      analyser.getByteFrequencyData(buf);

      let maxAmp = 0;
      let sumAmp = 0;
      for (let i = 0; i < bins; i++) {
        if (buf[i] > maxAmp) maxAmp = buf[i];
        sumAmp += buf[i];
      }
      const avgAmp = sumAmp / bins;
      // Strict dead silence: maxAmp <= 5 and avgAmp <= 2 (guards against ambient decay / quiet bridges)
      const isSilent = maxAmp <= 5 && avgAmp <= 2;

      // 3. Dynamic outro silence fallback:
      // Only check within the very end of the track (last 15s) and require at least 4.0s of continuous silence
      // (16 consecutive checks at 250ms), ensuring breakdowns and quiet bridges are never cut.
      if (el.duration > 30 && el.duration - el.currentTime <= 15 && el.currentTime > 20) {
        if (isSilent) {
          silenceStreakRef.current += 1;
          if (silenceStreakRef.current >= 16) {
            silenceStreakRef.current = 0;
            if (!curSlot.nearFired) {
              curSlot.nearFired = true;
              nearEndRef.current.forEach((f) => f());
            }
            el.currentTime = Math.max(el.currentTime, el.duration - 0.25);
          }
        } else {
          silenceStreakRef.current = 0;
        }
      } else {
        silenceStreakRef.current = 0;
      }
    }, 250);

    return () => {
      clearInterval(silenceInterval);
      handlers.forEach(({ el, fn, near }) => {
        el.removeEventListener('ended', fn);
        el.removeEventListener('timeupdate', near);
      });
      clearFadeTimers();
      slots.forEach((s) => {
        if (s.hls) {
          try {
            s.hls.destroy();
          } catch {
            /* ignore */
          }
          s.hls = null;
        }
        s.el.pause();
      });
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [clearFadeTimers]);

  /**
   * Points the standby slot at a stream.
   *
   * The active element is left alone: whatever is playing keeps playing until
   * `play()` swaps the slots, which is the whole point of a crossfade. A null
   * source means the track has no stream (removed or region-locked) - never
   * substitute unrelated audio for it, just stop everything.
   */
  const load = useCallback(
    (src: string | null) => {
      const slots = slotsRef.current;
      if (!slots.length) return;
      clearFadeTimers();

      const si = 1 - activeRef.current;
      const cur = slots[activeRef.current];
      const standby = slots[si];

      if (!src) {
        pendingIdxRef.current = null;
        for (const s of slots) {
          setSlotSource(s, null, applyRateTo);
          if (s.fade) s.fade.gain.value = 1;
          s.el.pause();
        }
        return;
      }

      if (cur.src === src) {
        pendingIdxRef.current = null;
        return;
      }
      if (standby.src === src) {
        // Already staged by an earlier attempt: rewind so replaying the same
        // track still starts from the top instead of where it was left.
        pendingIdxRef.current = si;
        try {
          standby.el.currentTime = 0;
        } catch {
          /* no metadata yet */
        }
        return;
      }

      pendingIdxRef.current = si;
      setSlotSource(standby, src, applyRateTo);
    },
    [clearFadeTimers]
  );

  /**
   * Warms the standby slot with the next track's stream.
   *
   * Unlike a detached buffer element this fills the slot the coming `play()`
   * will actually promote: `preload='auto'` pulls in the whole track while the
   * current one runs, so the switch starts from the element's own buffer instead
   * of waiting on a fresh `load()`. `pendingIdxRef` is deliberately left alone -
   * this is a warm-up, not a pick, so a staged stream that refuses to load is
   * the next track's problem at switch time, not a reason to advance early.
   */
  const preload = useCallback((src: string | null) => {
    const slots = slotsRef.current;
    if (!slots.length || !src) return;
    if (slots.some((s) => s.src === src)) return;
    const si = 1 - activeRef.current;
    const standby = slots[si];
    setSlotSource(standby, src, applyRateTo);
  }, []);

  /**
   * Starts the standby slot, crossfading when the outgoing track is audible.
   *
   * The active pointer moves immediately so the UI reads the new track's time
   * and duration; the old element is left running at full level only until the
   * fade ramp has taken it down, then it is paused and its gain reset.
   */
  const play = useCallback(async () => {
    const slots = slotsRef.current;
    if (!slots.length) return;
    ensureGraph();
    if (ctxRef.current?.state === 'suspended') await ctxRef.current.resume();

    const ai = activeRef.current;
    const si = 1 - ai;
    const cur = slots[ai];
    const nxt = slots[si];
    const ctx = ctxRef.current;
    const swapping = nxt.src !== null && nxt.src !== cur.src;

    if (!swapping) {
      pendingIdxRef.current = null;
      if (cur.fade) cur.fade.gain.value = 1;
      try {
        await cur.el.play();
      } catch {
        /* autoplay blocked until user gesture */
      }
      return;
    }

    clearFadeTimers();
    pendingIdxRef.current = null;
    const cf = crossfadeState.seconds;
    const outgoingAudible = Boolean(cur.src) && !cur.el.paused && !cur.el.ended;

    if (ctx && outgoingAudible && cf > 0 && nxt.fade && cur.fade) {
      const now = ctx.currentTime;
      const out = cur.fade.gain;
      out.cancelScheduledValues(now);
      out.setValueAtTime(out.value, now);
      out.linearRampToValueAtTime(0, now + cf);
      const into = nxt.fade.gain;
      into.cancelScheduledValues(now);
      into.setValueAtTime(0, now);
      into.linearRampToValueAtTime(1, now + cf);

      activeRef.current = si;
      try {
        await nxt.el.play();
      } catch {
        /* autoplay blocked until user gesture */
      }

      const timer = window.setTimeout(() => {
        cur.el.pause();
        const g = cur.fade?.gain;
        if (g && ctxRef.current) {
          const t = ctxRef.current.currentTime;
          g.cancelScheduledValues(t);
          g.value = 1;
        }
      }, cf * 1000 + 80);
      fadeTimersRef.current.push(timer);
      return;
    }

    // Nothing playing on the other side (first track, a pause, or a retry of
    // another format after a stream error): start straight away.
    cur.el.pause();
    if (cur.fade) cur.fade.gain.value = 1;
    if (nxt.fade) nxt.fade.gain.value = 1;
    activeRef.current = si;
    try {
      await nxt.el.play();
    } catch {
      /* autoplay blocked until user gesture */
    }
  }, [ensureGraph, clearFadeTimers]);

  const pause = useCallback(() => {
    slotsRef.current[activeRef.current]?.el.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const ai = activeRef.current;
    const curSlot = slotsRef.current[ai];
    const el = activeEl();
    if (!el) return;
    if (curSlot) {
      curSlot.introDone = true;
    }
    try {
      el.currentTime = t;
      const cf = crossfadeState.seconds;
      if (curSlot && isFinite(el.duration) && el.duration - t > cf + 1) {
        curSlot.nearFired = false;
      }
    } catch {
      /* not seekable yet */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSilenceBounds = useCallback((startSec: number, endSec: number) => {
    const ai = activeRef.current;
    const curSlot = slotsRef.current[ai];
    if (!curSlot) return;
    curSlot.startSilenceSec = Math.max(0, startSec);
    curSlot.endSilenceSec = endSec > 0 ? endSec : 0;

    if (autoTrimSilenceRef.current && startSec >= 2.0) {
      curSlot.introDone = true;
      try {
        if (curSlot.el.currentTime < startSec) {
          curSlot.el.currentTime = startSec;
        }
      } catch {
        /* wait for metadata */
      }
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    volumeRef.current = Math.min(1, Math.max(0, v));
    const gain = masterGainFor(volumeRef.current);
    if (masterRef.current) masterRef.current.gain.value = gain;
    // The element volume stays at 1 so the EQ graph owns the final level.
    slotsRef.current.forEach((s) => {
      s.el.volume = 1;
    });
  }, []);

  const setCrossfade = useCallback((seconds: number) => {
    crossfadeState.seconds = Math.min(CROSSFADE_MAX, Math.max(0, Number(seconds) || 0));
  }, []);

  const setRate = useCallback((r: number) => {
    rateState.value = Math.min(RATE_MAX, Math.max(RATE_MIN, r));
    slotsRef.current.forEach((s) => applyRateTo(s.el));
  }, []);

  const setPreservePitch = useCallback((on: boolean) => {
    rateState.preservePitch = on;
    slotsRef.current.forEach((s) => applyRateTo(s.el));
  }, []);

  const setEq = useCallback((gains: number[]) => {
    eqState.gains = gains;
    eqRef.current.forEach((f, i) => {
      f.gain.value = gains[i] ?? 0;
    });
    if (masterRef.current) masterRef.current.gain.value = masterGainFor(volumeRef.current);
  }, []);

  /**
   * Switches band count.
   *
   * The current curve is resampled onto the new centres first, so going 16 -> 8
   * keeps the shape of the user's mix instead of dropping every other gain. The
   * filter chain is only rebuilt when the graph already exists, otherwise the
   * next `play()` picks up the new count on its own.
   */
  const setBandCount = useCallback((count: BandCount) => {
    const previous = countRef.current;
    if (previous === count) return eqState.gains;

    const gains = migrateEq(eqState.gains, count);
    eqState.gains = gains;
    eqState.count = count;
    countRef.current = count;

    const ctx = ctxRef.current;
    const bus = busRef.current;
    const master = masterRef.current;
    if (ctx && bus && master) {
      // The bus keeps feeding the head of the chain; only the filters
      // between it and the master gain have to be replaced.
      try {
        bus.disconnect();
      } catch {
        /* not connected yet */
      }
      const tail = buildEqChain(ctx, bus);
      if (spatialInputRef.current) {
        tail.connect(spatialInputRef.current);
      } else {
        tail.connect(master);
      }
    }

    if (masterRef.current) masterRef.current.gain.value = masterGainFor(volumeRef.current);
    return gains;
  }, [buildEqChain]);

  const setLoudnessEqualizer = useCallback((on: boolean) => {
    loudnessRef.current = on;
    const ctx = ctxRef.current;
    if (!ctx || !directGainRef.current || !compGainRef.current) return;
    const now = ctx.currentTime;
    directGainRef.current.gain.cancelScheduledValues(now);
    compGainRef.current.gain.cancelScheduledValues(now);
    directGainRef.current.gain.setValueAtTime(directGainRef.current.gain.value, now);
    compGainRef.current.gain.setValueAtTime(compGainRef.current.gain.value, now);
    directGainRef.current.gain.linearRampToValueAtTime(on ? 0 : 1, now + 0.05);
    compGainRef.current.gain.linearRampToValueAtTime(on ? 1.25 : 0, now + 0.05);
  }, []);

  const setSpatialAudio = useCallback((on: boolean) => {
    spatialRef.current = on;
    const ctx = ctxRef.current;
    if (!ctx || !spatialDryGainRef.current || !spatialWetGainRef.current) return;
    const now = ctx.currentTime;
    spatialDryGainRef.current.gain.cancelScheduledValues(now);
    spatialWetGainRef.current.gain.cancelScheduledValues(now);
    spatialDryGainRef.current.gain.setValueAtTime(spatialDryGainRef.current.gain.value, now);
    spatialWetGainRef.current.gain.setValueAtTime(spatialWetGainRef.current.gain.value, now);
    spatialDryGainRef.current.gain.linearRampToValueAtTime(on ? 0 : 1, now + 0.05);
    spatialWetGainRef.current.gain.linearRampToValueAtTime(on ? 1 : 0, now + 0.05);
  }, []);

  const freqBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Reuses one buffer. Allocating a fresh Uint8Array on every call meant one
  // per canvas per animation frame, trickling GC pressure.
  const getFreq = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return null;
    const bins = analyser.frequencyBinCount;
    let buf = freqBufferRef.current;
    if (!buf || buf.length !== bins) {
      buf = new Uint8Array(bins);
      freqBufferRef.current = buf;
    }
    analyser.getByteFrequencyData(buf);
    return buf;
  }, []);

  return {
    audio: activeEl(),
    getActive: activeEl,
    isMediaTarget,
    audioElements: () => slotsRef.current.map((s) => s.el),
    load,
    preload,
    play,
    pause,
    seek,
    setVolume,
    setCrossfade,
    crossfade: () => crossfadeState.seconds,
    setRate,
    rate: () => rateState.value,
    setPreservePitch,
    preservePitch: () => rateState.preservePitch,
    getAnalyser: () => analyserRef.current,
    getFreq,
    onEnded: (fn) => {
      endedRef.current.push(fn);
      return () => {
        endedRef.current = endedRef.current.filter((f) => f !== fn);
      };
    },
    onNearEnd: (fn) => {
      nearEndRef.current.push(fn);
      return () => {
        nearEndRef.current = nearEndRef.current.filter((f) => f !== fn);
      };
    },
    currentTime: () => activeEl()?.currentTime ?? 0,
    duration: () => {
      const a = activeEl();
      if (!a || !isFinite(a.duration)) return 0;
      return a.duration;
    },
    setEq,
    setBandCount,
    bandCount: () => countRef.current,
    setLoudnessEqualizer,
    setSpatialAudio,
    setAutoTrimSilence: (on: boolean) => {
      autoTrimSilenceRef.current = on;
    },
    setSilenceBounds,
  };
}