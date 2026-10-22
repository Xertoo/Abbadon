/**
 * The backdrop.
 *
 * Everything behind the app: the drifting colour orbs, the dust and the
 * starfield. The stars are drawn on a canvas rather than as DOM nodes because
 * they twinkle against the spectrum every frame - a few hundred animated divs
 * would repaint the whole layer, a canvas repaints only itself.
 *
 * All of it is steered by the `bg*` preferences (Settings -> Background), so the
 * layer deliberately keeps no state of its own: the loop reads a ref that every
 * render refreshes, which is why changing a slider never restarts the frame.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../types';
import { useArtworkColor } from '../lib/artworkColor';
import type { Prefs } from '../lib/prefs';

type BgMode = Prefs['bgMode'];

interface Props {
  track: Track | null;
  isPlaying: boolean;
  prefs: Prefs;
  /** Spectrum of the playing track, or null when nothing is wired up. */
  getFreq?: (() => Uint8Array | null) | null;
}

/** Stars per mode before the density multiplier. */
const STARS_PER_MODE: Record<BgMode, number> = {
  cosmic: 130,
  stars: 260,
  aurora: 110,
  particles: 160,
  minimal: 45,
  off: 0,
};

/** Sprite sheet edge, in pixels. The core of a star ends up ~10% of this. */
const SPRITE = 64;

interface Star {
  /** Normalised position, so a resize never has to rebuild the field. */
  x: number;
  y: number;
  r: number;
  /** Parallax depth: nearer stars drift faster and twinkle brighter. */
  depth: number;
  phase: number;
  twinkle: number;
  /** -1..1, scaled by the variation setting into a hue offset. */
  spread: number;
  /** Peak opacity before twinkle and the spectrum get to it. */
  alpha: number;
  /** A rare star with a four-point diffraction spike. */
  spark: boolean;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  hue: number;
}

/** Reads a hue out of a CSS colour. Themes expose their accent as a variable. */
function cssHue(raw: string | undefined | null): number | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return null;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const body = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return rgbHue(
      parseInt(body.slice(0, 2), 16),
      parseInt(body.slice(2, 4), 16),
      parseInt(body.slice(4, 6), 16)
    );
  }
  const rgb = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return rgbHue(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const hsl = v.match(/hsla?\(\s*(-?[\d.]+)/);
  if (hsl) return ((Number(hsl[1]) % 360) + 360) % 360;
  return null;
}

function rgbHue(r: number, g: number, b: number): number | null {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return null;
  const d = max - min;
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return (h * 60 + 360) % 360;
}

/**
 * Builds one star sprite: a white core that falls off into a tinted halo.
 *
 * Drawing a radial gradient per star per frame is what made the first pass look
 * (and run) cheap, so the gradient is baked once and blitted. `spikes` adds the
 * soft four-point diffraction cross real lenses give the brightest stars -
 * two tapered gradients, never a hard line.
 */
function buildSprite(hue: number, spikes: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE;
  canvas.height = SPRITE;
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  const h = ((Math.round(hue / 10) * 10) % 360 + 360) % 360;
  const r = SPRITE / 2;

  if (spikes) {
    const pass = (width: number, peak: number) => {
      const horiz = g.createLinearGradient(0, 0, SPRITE, 0);
      const vert = g.createLinearGradient(0, 0, 0, SPRITE);
      for (const grad of [horiz, vert]) {
        grad.addColorStop(0, `hsla(${h}, 60%, 92%, 0)`);
        grad.addColorStop(0.5, `hsla(${h}, 60%, 95%, ${peak})`);
        grad.addColorStop(1, `hsla(${h}, 60%, 92%, 0)`);
      }
      g.fillStyle = horiz;
      g.fillRect(0, r - width / 2, SPRITE, width);
      g.fillStyle = vert;
      g.fillRect(r - width / 2, 0, width, SPRITE);
    };
    pass(7, 0.16);
    pass(2, 0.6);
  }

  const core = g.createRadialGradient(r, r, 0, r, r, r);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.08, 'rgba(255,255,255,0.92)');
  core.addColorStop(0.2, `hsla(${h}, 65%, 90%, 0.5)`);
  core.addColorStop(0.45, `hsla(${h}, 70%, 85%, 0.16)`);
  core.addColorStop(1, `hsla(${h}, 70%, 85%, 0)`);
  g.fillStyle = core;
  g.fillRect(0, 0, SPRITE, SPRITE);
  return canvas;
}

interface SpritePair {
  glow: HTMLCanvasElement;
  spark: HTMLCanvasElement;
}

/**
 * Sprites for a hue, bucketed to 10 degrees.
 *
 * The hue drifts continuously with the variation setting, so without bucketing
 * every frame would rebuild a texture. With it, a pair is built roughly once
 * per few seconds and reused by every star that lands in the same bucket.
 */
const spriteCache = new Map<number, SpritePair>();

function spriteFor(hue: number): SpritePair {
  const bucket = (((Math.round(hue / 10) * 10) % 360) + 360) % 360;
  const hit = spriteCache.get(bucket);
  if (hit) return hit;
  if (spriteCache.size > 48) spriteCache.clear();
  const pair: SpritePair = {
    glow: buildSprite(bucket, false),
    spark: buildSprite(bucket, true),
  };
  spriteCache.set(bucket, pair);
  return pair;
}

export const AtmosphereLayer: React.FC<Props> = React.memo(
  ({ track, isPlaying, prefs, getFreq }) => {
    const mode = prefs.bgMode;
    const artColor = useArtworkColor(track?.artwork);
    const intensity = prefs.bgIntensity;
    const variation = prefs.bgVariation;

    // The theme accent lives in a CSS variable, so it has to be sampled - the
    // canvas cannot use `var()` inside a fillStyle string. Polled rather than
    // observed because themes only change from Settings.
    const [themeHue, setThemeHue] = useState<number | null>(null);
    useEffect(() => {
      const read = () =>
        setThemeHue(
          cssHue(getComputedStyle(document.documentElement).getPropertyValue('--color-sc-orange'))
        );
      read();
      const id = window.setInterval(read, 2000);
      return () => window.clearInterval(id);
    }, []);

    // The variation setting, stepped once a second so the orbs' own 1.5s
    // background transition smooths it into a slow wash instead of a jump.
    const [hueShift, setHueShift] = useState(0);
    useEffect(() => {
      if (!(variation > 0) || !prefs.animations) return;
      const id = window.setInterval(
        () => setHueShift((h) => (h + variation * 6) % 360),
        1000
      );
      return () => window.clearInterval(id);
    }, [variation, prefs.animations]);

    const baseHue = useMemo(() => {
      if (prefs.bgColorSource === 'neon') return 300;
      if (prefs.bgColorSource === 'theme') return themeHue ?? artColor.hue;
      return artColor.hue;
    }, [prefs.bgColorSource, themeHue, artColor.hue]);

    const aurora = mode === 'aurora';
    const orbHues: [number, number, number] = aurora
      ? [(150 + hueShift) % 360, (205 + hueShift) % 360, (120 + hueShift) % 360]
      : [
          (baseHue + hueShift) % 360,
          (baseHue + hueShift + 40) % 360,
          (baseHue + hueShift + 20) % 360,
        ];

    const color1 = `hsla(${orbHues[0]}, ${artColor.sat}%, ${artColor.light}%, ${0.28 * intensity})`;
    const color2 = `hsla(${orbHues[1]}, ${artColor.sat}%, ${artColor.light}%, ${0.18 * intensity})`;
    const color3 = `hsla(${orbHues[2]}, ${artColor.sat}%, ${artColor.light}%, ${0.2 * intensity})`;

    const showOrbs = mode === 'cosmic' || mode === 'aurora';
    const showDust = mode === 'cosmic' || mode === 'particles';

    // Static seeded particles for subtle spatial depth.
    const dustCount = mode === 'particles' ? 54 : 28;
    const particles = useMemo(
      () =>
        Array.from({ length: dustCount }, (_, i) => ({
          size: 1 + ((i * 3) % 3),
          left: (i * 29) % 100,
          top: (i * 43) % 100,
          opacity: (0.05 + ((i % 5) * 0.03)) * intensity,
          duration: 6 + (i % 6),
          delay: (i * 0.4) % 4,
        })),
      [dustCount, intensity]
    );

    /* ------------------------------ star canvas ----------------------------- */

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const prefsRef = useRef(prefs);
    prefsRef.current = prefs;
    const getFreqRef = useRef(getFreq);
    getFreqRef.current = getFreq;
    const playingRef = useRef(isPlaying);
    playingRef.current = isPlaying;
    const hueRef = useRef(baseHue);
    hueRef.current = baseHue;

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let stars: Star[] = [];
      let meteors: Meteor[] = [];
      let wanted = -1;
      let w = 0;
      let h = 0;
      let raf = 0;
      let last = performance.now();
      let elapsed = 0;
      let energy = 0;
      let lastBass = 0;
      let nextMeteor = 3 + Math.random() * 8;
      // Signature of the settings the frozen (animations off) path would
      // otherwise never notice, so a slider still repaints a still layer.
      let lastSig = '';
      let resizeScheduled = false;
      const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const curW = canvas.clientWidth || window.innerWidth;
        const curH = canvas.clientHeight || window.innerHeight;
        const targetW = Math.max(1, Math.round(curW * dpr));
        const targetH = Math.max(1, Math.round(curH * dpr));
        if (targetW !== canvas.width || targetH !== canvas.height) {
          w = curW;
          h = curH;
          canvas.width = targetW;
          canvas.height = targetH;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
          w = curW;
          h = curH;
        }
      };

      const onWindowResize = () => {
        if (!resizeScheduled) {
          resizeScheduled = true;
          requestAnimationFrame(() => {
            resizeScheduled = false;
            resize();
          });
        }
      };

      const buildStars = (count: number) => {
        stars = Array.from({ length: count }, () => ({
          x: Math.random(),
          y: Math.random(),
          // Squared off so the field is mostly pinpricks with a few standouts.
          r: 0.35 + Math.random() ** 2.4 * 1.7,
          depth: 0.25 + Math.random() * 0.75,
          phase: Math.random() * Math.PI * 2,
          twinkle: 0.35 + Math.random() * 1.1,
          spread: Math.random() * 2 - 1,
          alpha: 0.16 + Math.random() ** 1.7 * 0.72,
          spark: Math.random() < 0.07,
        }));
      };

      const spawnMeteor = (hue: number) => {
        const dir = Math.random() > 0.5 ? 1 : -1;
        meteors.push({
          x: dir > 0 ? -40 : w + 40,
          y: Math.random() * h * 0.45,
          vx: dir * (520 + Math.random() * 420),
          vy: 170 + Math.random() * 230,
          life: 0,
          max: 1.4 + Math.random() * 1.3,
          hue,
        });
      };

      const render = (t: number, dt: number, e: number) => {
        const p = prefsRef.current;
        ctx.clearRect(0, 0, w, h);
        if (p.bgMode === 'off') return;

        const spd = p.bgSpeed;
        const inten = p.bgIntensity;
        const varn = p.bgVariation;
        const hueDrift = (elapsed * 8 * varn * spd) % 360;
        const rootHue = hueRef.current;

        for (const s of stars) {
          if (dt !== 0) {
            s.x += dt * 0.003 * s.depth * spd * (1 + e * 0.7);
            if (s.x > 1.02) s.x -= 1.04;
            else if (s.x < -0.02) s.x += 1.04;
          }
          // Only a fifth of the brightness swings: the sky should breathe, not
          // flicker like a faulty neon.
          const tw = 0.5 + 0.5 * Math.sin(t * s.twinkle * (1 + e * 1.3) + s.phase);
          const a =
            s.alpha *
            (0.8 + 0.2 * tw) *
            inten *
            (0.75 + s.depth * 0.35) *
            (1 + e * 0.5);
          if (a <= 0.03) continue;
          const hue = rootHue + s.spread * varn * 30 + hueDrift;
          const sprite = spriteFor(hue);
          const size = s.r * 13 * (0.7 + s.depth * 0.5) * (1 + e * 0.25);
          const x = (((s.x % 1) + 1) % 1) * w;
          const y = (((s.y % 1) + 1) % 1) * h;
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(
            s.spark ? sprite.spark : sprite.glow,
            x - size / 2,
            y - size / 2,
            size,
            size
          );
        }
        ctx.globalAlpha = 1;

        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i];
          if (dt !== 0) {
            m.life += dt;
            m.x += m.vx * dt;
            m.y += m.vy * dt;
          }
          if (m.life >= m.max || m.x < -160 || m.x > w + 160) {
            meteors.splice(i, 1);
            continue;
          }
          const k = m.life / m.max;
          const fade = Math.sin(Math.min(1, k * 3) * Math.PI * 0.5) * (1 - k);
          const tailX = m.x - m.vx * 0.28;
          const tailY = m.y - m.vy * 0.28;
          const trail = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
          trail.addColorStop(0, `hsla(${m.hue}, 85%, 95%, ${(fade * 0.9).toFixed(3)})`);
          trail.addColorStop(0.35, `hsla(${m.hue}, 80%, 90%, ${(fade * 0.4).toFixed(3)})`);
          trail.addColorStop(1, `hsla(${m.hue}, 80%, 90%, 0)`);
          ctx.strokeStyle = trail;
          ctx.lineWidth = 1.4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();

          const head = 30;
          ctx.globalAlpha = Math.min(1, fade);
          ctx.drawImage(spriteFor(m.hue).glow, m.x - head / 2, m.y - head / 2, head, head);
          ctx.globalAlpha = 1;
        }
      };

      const loop = (now: number) => {
        if (document.hidden) {
          raf = 0;
          return;
        }

        // Frame rate limiter: cap at ~60 FPS (min 15ms interval between frames)
        // Eliminates wasted CPU/GPU burn on 144Hz/240Hz monitors for ambient background canvas
        if (now - last < 15) {
          raf = requestAnimationFrame(loop);
          return;
        }

        raf = requestAnimationFrame(loop);
        const p = prefsRef.current;
        const sig = `${p.bgMode}|${p.bgStarDensity}|${p.bgIntensity}|${p.bgVariation}|${p.bgSpeed}|${p.bgColorSource}|${p.bgShootingStars}|${hueRef.current}`;
        const settingsMoved = sig !== lastSig;
        if (settingsMoved) lastSig = sig;

        const count = Math.round(STARS_PER_MODE[p.bgMode] * p.bgStarDensity);
        if (count !== wanted) {
          wanted = count;
          buildStars(count);
          meteors = [];
        }

        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;

        if (!p.bgShootingStars) meteors = [];

        // Still layer: no clock, no spectrum, redraw only when something that
        // paints changed. Keeps "Animations off" honest instead of merely
        // slower.
        if (!p.animations) {
          if (settingsMoved) {
            resize();
            render(0, 0, 0);
          }
          return;
        }

        elapsed += dt;
        let target = 0;
        const freq = p.bgAudioReactive && playingRef.current ? getFreqRef.current?.() : null;
        if (freq && freq.length) {
          const bins = Math.min(10, freq.length);
          let sum = 0;
          for (let i = 0; i < bins; i++) sum += freq[i];
          const bass = sum / bins / 255;
          target = Math.min(1, bass * 1.5 * p.bgSensitivity);
          if (bass > 0.5 && lastBass <= 0.5 && p.bgShootingStars && meteors.length < 3) {
            spawnMeteor(hueRef.current);
          }
          lastBass = bass;
        } else {
          lastBass = 0;
        }
        energy += (target - energy) * (target > energy ? 0.4 : 0.08);

        if (p.bgShootingStars && meteors.length < 3) {
          nextMeteor -= dt;
          if (nextMeteor <= 0) {
            spawnMeteor((hueRef.current + 40) % 360);
            nextMeteor = 7 + Math.random() * 13;
          }
        }

        if (settingsMoved) resize();
        render(elapsed, dt, energy);
      };

      resize();
      window.addEventListener('resize', onWindowResize, { passive: true });

      const onVisibilityChange = () => {
        if (!document.hidden && !raf) {
          last = performance.now();
          raf = requestAnimationFrame(loop);
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      raf = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onWindowResize);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      };
    }, []);

    return (
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none"
        style={{ contain: 'strict', transform: 'translateZ(0)' }}
        aria-hidden="true"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {showOrbs && (
          <>
            {/* Orb 1 - Top Left / Drift */}
            <div
              className="absolute -top-[15%] -left-[10%] w-[75vw] h-[75vw] rounded-full mix-blend-screen"
              style={{
                background: `radial-gradient(circle, ${color1} 0%, transparent 68%)`,
                filter: 'blur(130px)',
                animation: prefs.animations ? 'orb-float-1 28s ease-in-out infinite' : 'none',
                transition: 'background 1.5s cubic-bezier(0.2, 0.8, 0.2, 1)',
              }}
            />

            {/* Orb 2 - Bottom Right / Drift */}
            <div
              className="absolute -bottom-[20%] -right-[15%] w-[80vw] h-[80vw] rounded-full mix-blend-screen"
              style={{
                background: `radial-gradient(circle, ${color2} 0%, transparent 65%)`,
                filter: 'blur(150px)',
                animation: prefs.animations ? 'orb-float-2 34s ease-in-out infinite' : 'none',
                transition: 'background 1.5s cubic-bezier(0.2, 0.8, 0.2, 1)',
              }}
            />

            {/* Orb 3 - Center Pulse (Breathes when audio is playing) */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] rounded-full mix-blend-screen"
              style={{
                background: `radial-gradient(circle, ${color3} 0%, transparent 70%)`,
                filter: 'blur(140px)',
                opacity: (isPlaying ? 0.35 : 0.15) * intensity,
                animation:
                  isPlaying && prefs.animations
                    ? 'orb-pulse-breathe 7s ease-in-out infinite'
                    : 'none',
                transition: 'opacity 1.2s ease, background 1.5s ease',
              }}
            />
          </>
        )}

        {showDust &&
          particles.map((p, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                width: `${p.size}px`,
                height: `${p.size}px`,
                left: `${p.left}%`,
                top: `${p.top}%`,
                opacity: p.opacity,
                boxShadow: `0 0 ${p.size * 2}px rgba(255, 255, 255, 0.6)`,
                animation: prefs.animations
                  ? `orb-pulse-breathe ${p.duration}s ease-in-out ${p.delay}s infinite`
                  : 'none',
              }}
            />
          ))}
      </div>
    );
  }
);

AtmosphereLayer.displayName = 'AtmosphereLayer';
