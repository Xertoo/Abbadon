import { useEffect, useRef, useState } from 'react';
import { Plus, X, Sparkles, Check } from 'lucide-react';
import {
  bandsFor,
  presetEq,
  resampleEq,
  PRESET_NAMES,
  EQ_RANGE,
  type BandCount,
  type EqBand,
} from '../hooks/useAudioEngine';
import { useAccent } from '../lib/themes';
import clsx from 'clsx';

interface Props {
  getFreq: (() => Uint8Array | null) | null;
  active: boolean;
  className?: string;
  bars?: number;
  color?: string;
  color2?: string;
  mode?: VisualizerMode;
  /**
   * Keeps animating even with no audio.
   *
   * Used by the settings thumbnails, where a frozen frame told you nothing about
   * how a mode moves. `demo` draws the synthetic spectrum above instead of the
   * real analyser, so previews are alive whether or not music is playing.
   */
  demo?: boolean;
  /** Noise gate threshold (0..0.5). */
  threshold?: number;
  /** Amplitude sensitivity / gain multiplier (0.5..3.0). */
  sensitivity?: number;
  /** Falloff smoothing (0.1..0.95). */
  smoothing?: number;
}

export type VisualizerMode = 'bars' | 'wave' | 'mirror' | 'off';

/** Modes offered in Settings. */
export const VISUALIZER_MODES: { id: VisualizerMode; label: string; hint: string }[] = [
  { id: 'bars', label: 'Bars', hint: 'Vertical frequency spectrum bars' },
  { id: 'wave', label: 'Waveform', hint: 'Smooth line through the spectrum' },
  { id: 'mirror', label: 'Mirror', hint: 'Spectrum mirrored around the centre' },
  { id: 'off', label: 'Off', hint: 'No visualizer' },
];

/**
 * Synthetic spectrum for the settings previews.
 *
 * The tiles used to freeze on one frame whenever nothing was playing, so an
 * unselected mode showed a flat stub and gave no clue what it did. This
 * produces a plausible spectrum without an audio source: a bass-weighted curve
 * with a slow sweep and a little noise, so every mode has real movement to
 * draw and the tiles are actually comparable.
 */
function demoSpectrum(bins: number, t: number): Uint8Array {
  const out = new Uint8Array(bins);
  for (let i = 0; i < bins; i++) {
    const p = i / bins;
    // Real music falls off towards the top end, which is the shape that makes
    // the difference between the modes visible.
    const tilt = Math.pow(1 - p, 1.6);
    const sweep = 0.55 + 0.45 * Math.sin(t * 1.7 - p * 5.5);
    const pulse = 0.7 + 0.3 * Math.sin(t * 0.9 + p * 2.1);
    const jitter = 0.9 + 0.1 * Math.sin(i * 12.9898 + t * 8);
    out[i] = Math.round(255 * Math.min(1, Math.max(0.05, tilt * sweep * pulse * jitter)));
  }
  return out;
}

/** Smoothed 0..1 per band, shared by every visualizer mode. */
function readBands(
  getFreq: (() => Uint8Array | null) | null,
  active: boolean,
  bars: number
): number[] {
  const data = active ? getFreq?.() ?? null : null;
  const out = new Array(bars).fill(0);

  if (data && data.length) {
    for (let i = 0; i < bars; i++) {
      // Log-ish bin mapping: the low end has far more energy than the top, so
      // a linear read makes the right half look permanently dead.
      const t = i / bars;
      const idx = Math.floor(Math.pow(t, 1.7) * data.length);
      out[i] = Math.pow(data[Math.min(idx, data.length - 1)] / 255, 1.35);
    }
  } else {
    for (let i = 0; i < bars; i++) {
      out[i] = 0.08 + 0.05 * Math.sin(Date.now() / 600 + i * 0.4);
    }
  }
  return out;
}

/** Canvas visualizer driven by the Web Audio analyser. */
export function Spectrum({
  getFreq,
  active,
  className,
  bars = 48,
  color: colorProp,
  color2: color2Prop,
  mode = 'bars',
  demo = false,
  threshold = 0.05,
  sensitivity = 1.0,
  smoothing = 0.8,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const smoothRef = useRef<number[]>([]);
  // A canvas cannot resolve a CSS variable, so the accent is sampled from the
  // document. It re-renders on theme change, which restarts the effect.
  const accent = useAccent();
  const color = colorProp ?? accent.accent;
  const color2 = color2Prop ?? accent.accent2;

  useEffect(() => {
    if (mode === 'off') return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Built once per mount and reused for the lifetime of the canvas.
    const strip = makeGradientStrip(ctx, color, color2);

    // Clock for the demo spectrum. The live visualizer reads no time at all;
    // only the previews advance this.
    const started = performance.now();
    let t = 0;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const raw = demo
        ? readBands(() => demoSpectrum(bars, t / 1000), true, bars)
        : readBands(getFreq, active, bars);
      // Attack fast, release slow: peaks stay visible instead of flickering.
      const prev = smoothRef.current;
      const attackRate = Math.max(0.15, 1 - smoothing * 0.65);
      const decayRate = Math.max(0.03, (1 - smoothing) * 0.7);

      for (let i = 0; i < bars; i++) {
        let target = raw[i];
        if (target < threshold) {
          target = 0;
        } else {
          target = Math.min(1, ((target - threshold) / Math.max(0.01, 1 - threshold)) * sensitivity);
        }
        prev[i] = prev[i] === undefined ? target : prev[i] + (target - prev[i]) * (target > prev[i] ? attackRate : decayRate);
      }
      const v = prev;

      if (mode === 'bars') drawBars(ctx, w, h, v, dpr, color, color2, strip);
      else if (mode === 'mirror') drawMirror(ctx, w, h, v, dpr, color, color2);
      else if (mode === 'wave') drawWave(ctx, w, h, v, dpr, color, color2);
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      t = performance.now() - started;
      draw();
    };

    // Every instance animates now. The previews are 44x32 canvases, so six of
    // them running at once costs less than the one full-width player
    // visualiser, and a frozen frame is useless for judging a mode.
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [getFreq, active, bars, color, color2, mode, demo, threshold, sensitivity, smoothing]);

  if (mode === 'off') return null;
  return <canvas ref={ref} className={className} aria-hidden />;
}

function grad(ctx: CanvasRenderingContext2D, y0: number, y1: number, color: string, color2: string) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, color2);
  g.addColorStop(1, `${color}55`);
  return g;
}

/**
 * Vertical gradient factory with a small cache.
 *
 * Building a canvas gradient is not free and drawBars used to create one per
 * bar per frame (40-48 allocations at 60fps). A 1x256 strip is created once
 * and reused as a repeating pattern that is stretched per bar, which looks
 * identical because the gradient only varies along y.
 */
function makeGradientStrip(ctx: CanvasRenderingContext2D, color: string, color2: string) {
  const strip = document.createElement('canvas');
  strip.width = 1;
  strip.height = 256;
  const sctx = strip.getContext('2d');
  if (!sctx) return null;
  const g = sctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, color2);
  g.addColorStop(1, `${color}55`);
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, 1, 256);
  return strip;
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  v: number[],
  dpr: number,
  color: string,
  color2: string,
  strip: HTMLCanvasElement | null
) {
  const n = v.length;
  const gap = Math.max(1, Math.floor(w / n / 4));
  const bw = Math.max(1, (w - gap * (n - 1)) / n);
  const radius = Math.min(bw / 2, 3 * dpr);

  // One pattern for the whole frame; only its transform changes per bar.
  const pattern = strip ? ctx.createPattern(strip, 'repeat') : null;
  if (pattern) {
    const m = new DOMMatrix();
    for (let i = 0; i < n; i++) {
      const bh = Math.max(2 * dpr, v[i] * h * 0.96);
      const x = i * (bw + gap);
      const y = h - bh;
      m.a = bw;
      m.d = bh;
      m.e = x;
      m.f = y;
      pattern.setTransform(m);
      ctx.fillStyle = pattern;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, radius);
      ctx.fill();
    }
    return;
  }

  for (let i = 0; i < n; i++) {
    const bh = Math.max(2 * dpr, v[i] * h * 0.96);
    const x = i * (bw + gap);
    const y = h - bh;
    ctx.fillStyle = grad(ctx, y, h, color, color2);
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, radius);
    ctx.fill();
  }
}

function drawMirror(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  v: number[],
  dpr: number,
  color: string,
  color2: string
) {
  const mid = h / 2;
  const n = v.length;
  const gap = Math.max(1, Math.floor(w / n / 4));
  const bw = Math.max(1, (w - gap * (n - 1)) / n);
  ctx.fillStyle = grad(ctx, 0, mid, color, color2);
  for (let i = 0; i < n; i++) {
    const bh = Math.max(1 * dpr, v[i] * mid * 0.94);
    const x = i * (bw + gap);
    ctx.beginPath();
    ctx.roundRect(x, mid - bh, bw, bh, Math.min(bw / 2, 3 * dpr));
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x, mid, bw, bh, Math.min(bw / 2, 3 * dpr));
    ctx.fill();
  }
  ctx.fillStyle = `${color}55`;
  ctx.fillRect(0, mid - dpr / 2, w, dpr);
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  v: number[],
  dpr: number,
  color: string,
  color2: string
) {
  const n = v.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h / 2 - v[i] * h * 0.42;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h / 2);
  ctx.lineTo(0, h / 2);
  ctx.closePath();
  ctx.fillStyle = grad(ctx, 0, h, color, color2);
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h / 2 - v[i] * h * 0.42;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color2;
  ctx.lineWidth = 2 * dpr;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawRadial(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  v: number[],
  dpr: number,
  color: string,
  color2: string
) {
  const cx = w / 2;
  const cy = h / 2;
  const r0 = Math.min(w, h) * 0.18;
  const maxLen = Math.min(w, h) * 0.3;
  const n = v.length;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const len = Math.max(2 * dpr, v[i] * maxLen);
    const x0 = cx + Math.cos(a) * r0;
    const y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a) * (r0 + len);
    const y1 = cy + Math.sin(a) * (r0 + len);
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, color);
    g.addColorStop(1, color2);
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(2 * dpr, (Math.PI * 2 * r0) / n / 2.4);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}

function drawPulse(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  v: number[],
  dpr: number,
  color: string,
  color2: string
) {
  const cx = w / 2;
  const cy = h / 2;
  const energy = v.reduce((a, b) => a + b, 0) / v.length;
  const r = Math.min(w, h) * (0.16 + energy * 0.3);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `${color2}dd`);
  g.addColorStop(0.55, `${color}77`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `${color2}88`;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Halo that reacts to the music.
 *
 * Performance notes: the wrapper element gets three custom properties and the
 * CSS only consumes them in `opacity` and `transform`, so the compositor does
 * the animation and no repaint happens per frame. Values are quantised before
 * being written because a change to any of them still invalidates the layer,
 * and sub-pixel jitter in the analyser would otherwise force constant
 * invalidation for output nobody can see. Hue moves in 8-degree steps, which is
 * indistinguishable and roughly 50x less often.
 */
export function AudioBloom({
  getFreq,
  active,
  className,
  color,
  children,
}: {
  getFreq: (() => Uint8Array | null) | null;
  active: boolean;
  className?: string;
  color?: { hue: number; sat?: number; light?: number };
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const smooth = useRef(0);
  const last = useRef({ energy: -1, hue: -1 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = color?.sat ?? 88;
    const l = color?.light ?? 56;
    el.style.setProperty('--bloom-sat', `${s}%`);
    el.style.setProperty('--bloom-light', `${l}%`);
  }, [color?.sat, color?.light]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let t = 0;
    const baseHue = color?.hue ?? 232;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      t += 0.016;
      const data = active ? getFreq?.() ?? null : null;

      let energy = 0.12;
      let tilt = 0.5;
      if (data && data.length) {
        // Bass drives the size, mids shift the hue, so the halo reacts to the
        // part of the track you actually hear rather than a single average.
        const bass = data[Math.floor(data.length * 0.02)] / 255;
        const mid = data[Math.floor(data.length * 0.22)] / 255;
        energy = Math.min(1, bass * 0.75 + mid * 0.35);
        tilt = 0.35 + mid * 0.9;
      } else {
        energy = 0.12 + 0.05 * Math.sin(t * 1.6);
        tilt = 0.55 + 0.08 * Math.sin(t * 0.7);
      }

      smooth.current += (energy - smooth.current) * (energy > smooth.current ? 0.35 : 0.09);

      const e = Math.round(smooth.current * 20) / 20;
      // Slight musical modulation around the artwork's dominant hue (±16 degrees)
      const rawHue = baseHue + (tilt - 0.5) * 32;
      const hue = Math.round(((rawHue % 360 + 360) % 360) / 4) * 4;

      if (e !== last.current.energy) {
        el.style.setProperty('--bloom-energy', String(e));
        last.current.energy = e;
      }
      if (hue !== last.current.hue) {
        el.style.setProperty('--bloom-hue', String(hue));
        last.current.hue = hue;
      }
      // The ring's rotation is a CSS animation now, so the angle is only used
      // to pick up the analyser's own phase on the very first frame.
      if (last.current.energy < 0) {
        el.style.setProperty('--bloom-spin', `${(t * 14) % 360}deg`);
      }
    };
    tick();

    return () => cancelAnimationFrame(raf);
  }, [getFreq, active, color?.hue]);

  return (
    <div ref={ref} className={className}>
      <span className="audio-bloom-glow" aria-hidden />
      <span className="audio-bloom-ring" aria-hidden />
      {children}
    </div>
  );
}

function drawPerimeterRadial(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bw: number,
  bh: number,
  r: number,
  bands: number[],
  dpr: number,
  color: string,
  color2: string
) {
  const cx = w / 2;
  const cy = h / 2;
  const straightW = Math.max(0, bw - 2 * r);
  const straightH = Math.max(0, bh - 2 * r);
  const arcLen = (Math.PI / 2) * r;
  const totalP = 2 * straightW + 2 * straightH + 4 * arcLen;
  if (totalP <= 0) return;

  const n = bands.length;
  const maxLen = 38 * dpr;
  ctx.lineCap = 'round';

  for (let i = 0; i < n; i++) {
    const s = (i / n) * totalP;
    let px = 0;
    let py = 0;
    let nx = 0;
    let ny = 0;

    let cur = s;
    if (cur < straightW) {
      px = cx - straightW / 2 + cur;
      py = cy - bh / 2;
      nx = 0;
      ny = -1;
    } else {
      cur -= straightW;
      if (cur < arcLen) {
        const theta = -Math.PI / 2 + (cur / arcLen) * (Math.PI / 2);
        nx = Math.cos(theta);
        ny = Math.sin(theta);
        px = cx + straightW / 2 + nx * r;
        py = cy - straightH / 2 + ny * r;
      } else {
        cur -= arcLen;
        if (cur < straightH) {
          px = cx + bw / 2;
          py = cy - straightH / 2 + cur;
          nx = 1;
          ny = 0;
        } else {
          cur -= straightH;
          if (cur < arcLen) {
            const theta = (cur / arcLen) * (Math.PI / 2);
            nx = Math.cos(theta);
            ny = Math.sin(theta);
            px = cx + straightW / 2 + nx * r;
            py = cy + straightH / 2 + ny * r;
          } else {
            cur -= arcLen;
            if (cur < straightW) {
              px = cx + straightW / 2 - cur;
              py = cy + bh / 2;
              nx = 0;
              ny = 1;
            } else {
              cur -= straightW;
              if (cur < arcLen) {
                const theta = Math.PI / 2 + (cur / arcLen) * (Math.PI / 2);
                nx = Math.cos(theta);
                ny = Math.sin(theta);
                px = cx - straightW / 2 + nx * r;
                py = cy + straightH / 2 + ny * r;
              } else {
                cur -= arcLen;
                if (cur < straightH) {
                  px = cx - bw / 2;
                  py = cy + straightH / 2 - cur;
                  nx = -1;
                  ny = 0;
                } else {
                  cur -= straightH;
                  const theta = Math.PI + (cur / arcLen) * (Math.PI / 2);
                  nx = Math.cos(theta);
                  ny = Math.sin(theta);
                  px = cx - straightW / 2 + nx * r;
                  py = cy - straightH / 2 + ny * r;
                }
              }
            }
          }
        }
      }
    }

    const val = bands[i];
    const len = Math.max(3 * dpr, val * maxLen);
    const x0 = px;
    const y0 = py;
    const x1 = px + nx * len;
    const y1 = py + ny * len;

    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, color);
    g.addColorStop(1, color2);
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(2 * dpr, (totalP / n) * 0.55);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}

function drawPerimeterPulse(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bw: number,
  bh: number,
  r: number,
  bands: number[],
  dpr: number,
  color: string,
  color2: string,
  t: number
) {
  const cx = w / 2;
  const cy = h / 2;
  const energy = bands.reduce((a, b) => a + b, 0) / bands.length;
  const bass = (bands[0] + bands[1] + bands[2]) / 3;

  const waves = 3;
  for (let k = 0; k < waves; k++) {
    const wavePhase = (t * 0.85 + k / waves) % 1;
    const dist = (4 + wavePhase * 36 * (1 + bass * 0.8)) * dpr;
    const alpha = Math.max(0, (1 - wavePhase) * (0.35 + bass * 0.65));

    ctx.save();
    ctx.strokeStyle = `${color2}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
    ctx.lineWidth = (2 + (1 - wavePhase) * 2) * dpr;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14 * dpr * wavePhase;

    ctx.beginPath();
    ctx.roundRect(
      cx - bw / 2 - dist,
      cy - bh / 2 - dist,
      bw + dist * 2,
      bh + dist * 2,
      r + dist
    );
    ctx.stroke();
    ctx.restore();
  }

  const glowDist = (6 + energy * 20) * dpr;
  ctx.save();
  ctx.strokeStyle = `${color}44`;
  ctx.lineWidth = 4 * dpr;
  ctx.beginPath();
  ctx.roundRect(
    cx - bw / 2 - glowDist,
    cy - bh / 2 - glowDist,
    bw + glowDist * 2,
    bh + glowDist * 2,
    r + glowDist
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * ArtworkFrameVisualizer is deprecated (radial and pulse modes removed).
 */
export function ArtworkFrameVisualizer(_props: unknown) {
  return null;
}

/** Animated bars used as a "now playing" indicator. */
export function EqBars({ color = '#ff5500', size = 14 }: { color?: string; size?: number }) {
  return (
    <span className="inline-flex items-end gap-[2px] p-0.5" style={{ height: size }} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="eq-bar w-[2.5px] rounded-full shadow-xs"
          style={{
            background: color.startsWith('#')
              ? `linear-gradient(to top, ${color}, color-mix(in oklab, ${color} 70%, white))`
              : color,
            height: '100%',
            animationDelay: `${i * 0.15}s`,
            animationDuration: `${0.65 + (i % 2) * 0.25}s`,
          }}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Equalizer UI (shared by the player popover and the settings page)
 * ------------------------------------------------------------------ */

const fmtDb = (g: number) => (g > 0 ? `+${g.toFixed(1)}` : g.toFixed(1));

/**
/**
 * Spotify-style response curve: filled area, gridlines and draggable points.
 *
 * `interactive` only turns the handles and pointer handling off; the geometry is
 * shared with the read-only variant so the line in the player bar is literally
 * the same shape as the one in Settings.
 */
function EqCurve({
  eq,
  bands,
  onEq,
  height = 150,
  interactive = true,
}: {
  eq: number[];
  bands: EqBand[];
  onEq: (g: number[]) => void;
  height?: number;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const { accent, accent2 } = useAccent();
  // Mirror of the dragged index in state, so the readout and the enlarged
  // handle repaint while dragging (a ref would not trigger a render).
  const [activeBand, setActiveBand] = useState<number | null>(null);

  const valueAt = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    // Straight from the pointer to the value, top = +EQ_RANGE. Sharing this
    // mapping with the band sliders is what keeps the two controls agreeing.
    const t = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    return Math.round((1 - t * 2) * EQ_RANGE);
  };

  /**
   * Picks the band whose handle is closest in 2D, so clicking near a point
   * grabs that point instead of whichever band happens to be under the cursor
   * on the x axis alone. Falls back to a single click far from any handle.
   */
  const nearestBand = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < bands.length; i++) {
      const hx = (i / (bands.length - 1)) * r.width;
      const g = eq[i] ?? 0;
      const hy = (1 - (g + EQ_RANGE) / (EQ_RANGE * 2)) * r.height;
      const d = Math.hypot(hx - px, hy - py);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return { index: best, distance: bestDist };
  };

  const points = bands.map((band, i) => {
    const g = eq[i] ?? 0;
    return {
      band,
      g,
      x: (i / (bands.length - 1)) * 100,
      // 0 at the top, matching the SVG's own y axis.
      y: (1 - (g + EQ_RANGE) / (EQ_RANGE * 2)) * 100,
    };
  });

  const line = points.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `0,100 ${line} 100,100`;

  return (
    <div
      ref={ref}
      className="relative w-full rounded-xl border border-sc-line bg-sc-panel/60 select-none touch-none"
      style={{ height }}
      onPointerDown={(e) => {
        if (!interactive) return;
        const { index, distance } = nearestBand(e.clientX, e.clientY);
        dragging.current = index;
        setActiveBand(index);
        e.currentTarget.setPointerCapture(e.pointerId);
        // Only rewrite the curve when the click is close enough to a handle to
        // be a deliberate grab. A click on empty space used to yank the
        // nearest band to the pointer, which is what felt like fighting back.
        if (distance < 28) {
          const next = [...eq];
          next[index] = valueAt(e.clientY);
          onEq(next);
        }
      }}
      onPointerMove={(e) => {
        if (!interactive || dragging.current === null) return;
        const next = [...eq];
        next[dragging.current] = valueAt(e.clientY);
        onEq(next);
      }}
      onPointerUp={() => {
        dragging.current = null;
        setActiveBand(null);
      }}
      onPointerCancel={() => {
        dragging.current = null;
        setActiveBand(null);
      }}
    >
      {/* gridlines */}
      <div className="absolute inset-0 pointer-events-none">
        {[0, 25, 50, 75, 100].map((p) => (
          <div
            key={'h' + p}
            className="absolute left-0 right-0 h-px bg-sc-fill/6"
            style={{ top: `${p}%` }}
          />
        ))}
        {bands.map((b, i) => (
          <div
            key={'v' + b.id}
            className="absolute top-0 bottom-0 w-px bg-sc-fill/6"
            style={{ left: `${(i / (bands.length - 1)) * 100}%` }}
          />
        ))}
      </div>

      {/* 0 dB reference */}
      <div
        className="absolute left-0 right-0 h-px bg-sc-fill/25 pointer-events-none"
        style={{ top: '50%' }}
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-sc-dim pointer-events-none">
        0 dB
      </span>

      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent2} stopOpacity="0.45" />
            <stop offset="50%" stopColor={accent} stopOpacity="0.22" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.45" />
          </linearGradient>
          <linearGradient id="eqLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} />
            <stop offset="100%" stopColor={accent2} />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#eqFill)" />
        <polyline
          points={line}
          fill="none"
          stroke="url(#eqLine)"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>

      {activeBand !== null && points[activeBand] && (
        <div
          className="absolute z-10 -translate-x-1/2 -translate-y-full pointer-events-none rounded-md bg-sc-panel border border-sc-line px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-sc-fg shadow-lg"
          style={{
            left: `${points[activeBand].x}%`,
            top: `${points[activeBand].y}%`,
            marginTop: -10,
          }}
        >
          {fmtDb(points[activeBand].g)}
        </div>
      )}

      {interactive &&
        points.map((p, i) => (
          <button
            key={p.band.id}
            type="button"
            className="group/pt absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center cursor-ns-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-sc-orange/70"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          aria-label={`${p.band.label} Hz, ${fmtDb(p.g)} dB`}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            dragging.current = i;
            setActiveBand(i);
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const next = [...eq];
            next[i] = valueAt(e.clientY);
            onEq(next);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1 && dragging.current === i) {
              // Pointer capture retargets events to this button, but they still
              // bubble to the plot. Without this the plot's own move handler
              // would commit a second update for the same pixel.
              e.stopPropagation();
              const next = [...eq];
              next[i] = valueAt(e.clientY);
              onEq(next);
            }
          }}
          onPointerUp={(e) => {
            dragging.current = null;
            setActiveBand(null);
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = null;
            setActiveBand(null);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 3 : 1;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const next = [...eq];
              const dir = e.key === 'ArrowUp' ? 1 : -1;
              next[i] = Math.max(-EQ_RANGE, Math.min(EQ_RANGE, (eq[i] ?? 0) + dir * step));
              onEq(next);
            }
            if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') {
              const next = [...eq];
              next[i] = 0;
              onEq(next);
            }
          }}
          onDoubleClick={() => {
            const next = [...eq];
            next[i] = 0;
            onEq(next);
          }}
        >
          {/* A generous invisible hit area around a small visible dot, so the
              point is easy to grab without the handle covering the curve. */}
          <span className="absolute inset-0 rounded-full" />
          <span
            className="relative w-3.5 h-3.5 rounded-full bg-white border-2 border-sc-orange shadow-md transition-transform duration-150 group-hover/pt:scale-125 group-focus-visible/pt:scale-125"
            style={{ transform: activeBand === i ? 'scale(1.3)' : undefined }}
          />
        </button>
      ))}
    </div>
  );
}

/**
 * Preset gains for a band count, computed once per count.
 *
 * Resampling is cheap but not free, and the chip list re-renders on every drag
 * frame of the curve, so the table is memoised by count instead of rebuilt.
 */
const presetCache = new Map<BandCount, Record<string, number[]>>();

function presetsFor(count: BandCount): Record<string, number[]> {
  const hit = presetCache.get(count);
  if (hit) return hit;
  const all: Record<string, number[]> = {};
  for (const key of PRESET_NAMES) all[key] = presetEq(key, count);
  presetCache.set(count, all);
  return all;
}

const CUSTOM_PRESETS_KEY = 'sc9000:eq:custom-presets';

export function loadCustomPresets(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveCustomPresetToStorage(name: string, gains16: number[]) {
  try {
    const all = loadCustomPresets();
    all[name] = gains16;
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(all));
  } catch {}
}

export function deleteCustomPresetFromStorage(name: string) {
  try {
    const all = loadCustomPresets();
    delete all[name];
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(all));
  } catch {}
}

/** Preset chips that wrap instead of overflowing their container. */
export function EqPresets({
  eq,
  onEq,
  count,
  className,
  allowCustomSave = false,
}: {
  eq: number[];
  onEq: (g: number[]) => void;
  count: BandCount;
  className?: string;
  allowCustomSave?: boolean;
}) {
  const [customPresets, setCustomPresets] = useState<Record<string, number[]>>(() => loadCustomPresets());
  const [isAdding, setIsAdding] = useState(false);
  const [presetName, setPresetName] = useState('');

  const presets = presetsFor(count);
  const entries = Object.entries(presets);

  const fullFreqs = bandsFor(16).map((b) => b.freq);
  const targetFreqs = bandsFor(count).map((b) => b.freq);

  const customEntries = Object.entries(customPresets).map(([name, gains16]) => {
    const gains = resampleEq(fullFreqs, gains16, targetFreqs);
    return { name, gains };
  });

  const activeBuiltin = entries.find(([, g]) => g.every((v, i) => v === (eq[i] ?? 0)))?.[0];
  const activeCustom = customEntries.find(({ gains }) => gains.every((v, i) => v === (eq[i] ?? 0)))?.name;
  const active = activeBuiltin ?? activeCustom;

  const handleSave = () => {
    const trimmed = presetName.trim();
    if (!trimmed) return;
    const curFreqs = bandsFor(count).map((b) => b.freq);
    const gains16 = resampleEq(curFreqs, eq, fullFreqs);
    saveCustomPresetToStorage(trimmed, gains16);
    setCustomPresets(loadCustomPresets());
    setPresetName('');
    setIsAdding(false);
  };

  const handleDelete = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    deleteCustomPresetFromStorage(name);
    setCustomPresets(loadCustomPresets());
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-sc-muted">
            Presets
          </span>
          <span className="text-[11px] font-semibold text-sc-orange-soft">{active ?? 'Custom'}</span>
        </div>
        {allowCustomSave && (!isAdding ? (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-sc-dim hover:text-sc-orange transition-colors cursor-pointer"
            title="Save current setting as custom preset"
          >
            <Plus className="w-3 h-3" />
            <span>Save preset</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setIsAdding(false);
              setPresetName('');
            }}
            className="text-[10px] text-sc-dim hover:text-sc-fg cursor-pointer"
          >
            Cancel
          </button>
        ))}
      </div>

      {isAdding && (
        <div className="mb-2.5 flex items-center gap-1.5 p-1.5 rounded-xl border border-sc-orange/40 bg-sc-orange/5 animate-fade-in">
          <input
            type="text"
            autoFocus
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') {
                setIsAdding(false);
                setPresetName('');
              }
            }}
            placeholder="Preset name..."
            className="flex-1 min-w-0 bg-sc-panel border border-sc-line rounded-lg px-2.5 py-1 text-[11px] text-sc-fg placeholder:text-sc-dim/50 outline-none focus:border-sc-orange"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!presetName.trim()}
            className="px-2.5 py-1 rounded-lg bg-sc-orange hover:brightness-110 text-white text-[10px] font-bold transition-all disabled:opacity-40 cursor-pointer"
          >
            Save
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {entries.map(([name, gains]) => (
          <button
            key={name}
            type="button"
            onClick={() => onEq([...gains])}
            className={clsx(
              'px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors whitespace-nowrap cursor-pointer',
              active === name
                ? 'border-sc-orange/60 bg-sc-orange/15 text-sc-fg shadow-xs'
                : 'border-sc-line text-sc-muted hover:text-sc-fg hover:border-neutral-500'
            )}
          >
            {name}
          </button>
        ))}

        {customEntries.map(({ name, gains }) => (
          <div
            key={`custom-${name}`}
            className={clsx(
              'group/chip inline-flex items-center rounded-full text-[10px] font-semibold border transition-all whitespace-nowrap',
              active === name
                ? 'border-amber-500/70 bg-amber-500/15 text-amber-300 shadow-xs'
                : 'border-sc-line/80 bg-sc-panel-2/50 text-sc-muted hover:text-sc-fg hover:border-neutral-500'
            )}
          >
            <button
              type="button"
              onClick={() => onEq([...gains])}
              className="pl-2.5 pr-1 py-1 flex items-center gap-1 cursor-pointer"
              title={`Custom preset: ${name}`}
            >
              <Sparkles className="w-2.5 h-2.5 text-amber-400" />
              <span>{name}</span>
            </button>
            <button
              type="button"
              onClick={(e) => handleDelete(e, name)}
              title={`Delete preset "${name}"`}
              aria-label={`Delete preset ${name}`}
              className="pr-2 pl-0.5 py-1 text-sc-dim hover:text-red-400 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Read-only curve for the player bar.
 *
 * Deliberately the same component as the settings editor with the handles
 * removed, so the two can never disagree about what the curve looks like.
 */
export function EqCurvePreview({
  eq,
  bands,
  height = 88,
}: {
  eq: number[];
  bands: EqBand[];
  height?: number;
}) {
  return (
    <EqCurve
      eq={eq}
      bands={bands}
      onEq={() => undefined}
      height={height}
      interactive={false}
    />
  );
}

export { EqCurve as EqResponseCurve };
