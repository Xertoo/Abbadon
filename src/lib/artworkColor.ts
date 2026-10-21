import { useEffect, useState } from 'react';

export interface ArtworkColor {
  hue: number;
  sat: number;
  light: number;
  hex: string;
}

const FALLBACK_PALETTE: ArtworkColor[] = [
  { hue: 230, sat: 85, light: 58, hex: '#4f46e5' }, // indigo
  { hue: 265, sat: 85, light: 58, hex: '#7c3aed' }, // violet
  { hue: 175, sat: 85, light: 50, hex: '#0d9488' }, // teal
  { hue: 295, sat: 85, light: 58, hex: '#c026d3' }, // fuchsia
  { hue: 155, sat: 80, light: 50, hex: '#059669' }, // emerald
  { hue: 205, sat: 85, light: 58, hex: '#0284c7' }, // sky
  { hue: 275, sat: 85, light: 58, hex: '#9333ea' }, // purple
  { hue: 190, sat: 85, light: 55, hex: '#0891b2' }, // cyan
];

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function getFallbackColor(seed?: string | number): ArtworkColor {
  const idx = Math.abs(hashSeed(seed ?? 'abbadon')) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx];
}

const colorCache = new Map<string, ArtworkColor>();

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Extracts a dominant, vibrant color from an image URL.
 * Uses a small 32x32 canvas for sub-millisecond processing.
 */
export async function extractArtworkColor(
  src?: string | null,
  seed?: string | number
): Promise<ArtworkColor> {
  const fallback = getFallbackColor(seed);
  if (!src) return fallback;

  if (colorCache.has(src)) {
    return colorCache.get(src)!;
  }

  // Pick a fast small rendition if available
  const sampleUrl = src.includes('-large.jpg')
    ? src
    : src.replace(/-t\d+x\d+\.jpg$/, '-large.jpg');

  return new Promise<ArtworkColor>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const finish = (result: ArtworkColor) => {
      colorCache.set(src, result);
      resolve(result);
    };

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          finish(fallback);
          return;
        }

        ctx.drawImage(img, 0, 0, 32, 32);
        const imgData = ctx.getImageData(0, 0, 32, 32).data;

        // Group into 36 hue bins (10 deg each)
        const bins: { weight: number; hueSum: number; satSum: number; lightSum: number; count: number }[] =
          Array.from({ length: 36 }, () => ({
            weight: 0,
            hueSum: 0,
            satSum: 0,
            lightSum: 0,
            count: 0,
          }));

        let totalSat = 0;
        let totalLight = 0;
        let validPixels = 0;

        for (let i = 0; i < imgData.length; i += 4) {
          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];
          const a = imgData[i + 3];
          if (a < 128) continue; // skip transparent

          const [h, s, l] = rgbToHsl(r, g, b);
          totalSat += s;
          totalLight += l;
          validPixels++;

          // Discard pure blacks/pure whites from dominating colorful elements
          if (l < 10 || l > 92) continue;

          // Weight colorful, vibrant pixels higher
          const sFrac = s / 100;
          const lFrac = l / 100;
          const weight = (sFrac ** 1.3) * (1 - Math.abs(lFrac - 0.5) * 1.1) * 10;

          const binIndex = Math.floor(h / 10) % 36;
          const bin = bins[binIndex];
          bin.weight += weight;
          bin.hueSum += h * weight;
          bin.satSum += s * weight;
          bin.lightSum += l * weight;
          bin.count++;
        }

        if (validPixels === 0) {
          finish(fallback);
          return;
        }

        const avgSat = totalSat / validPixels;

        // If whole artwork is virtually monochrome / grayscale (< 12% avg saturation)
        if (avgSat < 12) {
          const avgLight = totalLight / validPixels;
          const result: ArtworkColor = {
            hue: 240,
            sat: 10,
            light: Math.max(50, Math.min(85, Math.round(avgLight + 20))),
            hex: hslToHex(240, 10, Math.max(50, Math.min(85, Math.round(avgLight + 20)))),
          };
          finish(result);
          return;
        }

        // Find the most dominant vibrant hue bin
        let bestBin = bins[0];
        for (let i = 1; i < bins.length; i++) {
          if (bins[i].weight > bestBin.weight) {
            bestBin = bins[i];
          }
        }

        if (bestBin.weight > 0 && bestBin.count > 0) {
          const dominantHue = Math.round(bestBin.hueSum / bestBin.weight);
          // Keep saturation rich for the bloom glow (between 65% and 92%)
          const rawSat = bestBin.satSum / bestBin.weight;
          const dominantSat = Math.max(65, Math.min(92, Math.round(rawSat * 1.15)));
          // Keep lightness in ideal glow range (50% to 62%)
          const rawLight = bestBin.lightSum / bestBin.weight;
          const dominantLight = Math.max(50, Math.min(62, Math.round(rawLight)));

          const result: ArtworkColor = {
            hue: dominantHue,
            sat: dominantSat,
            light: dominantLight,
            hex: hslToHex(dominantHue, dominantSat, dominantLight),
          };
          finish(result);
        } else {
          finish(fallback);
        }
      } catch {
        finish(fallback);
      }
    };

    img.onerror = () => {
      finish(fallback);
    };

    img.src = sampleUrl;
  });
}

/**
 * React hook to get the dominant artwork color for a track.
 * Always returns a synchronous color immediately (from cache or seed fallback)
 * and updates once image analysis completes.
 */
export function useArtworkColor(src?: string | null, seed?: string | number): ArtworkColor {
  const fallback = getFallbackColor(seed);
  const cached = src ? colorCache.get(src) : null;
  const [color, setColor] = useState<ArtworkColor>(cached ?? fallback);

  useEffect(() => {
    let canceled = false;
    const initial = src ? colorCache.get(src) : null;
    if (initial) {
      setColor(initial);
      return;
    }

    void extractArtworkColor(src, seed).then((extracted) => {
      if (!canceled) {
        setColor(extracted);
      }
    });

    return () => {
      canceled = true;
    };
  }, [src, seed]);

  return color;
}
