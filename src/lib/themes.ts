/**
 * Theme model.
 *
 * A theme is a flat bag of colours that gets written straight onto <html> as
 * custom properties. Nothing in the component tree knows a theme name, which is
 * what makes an arbitrary user colour work exactly like a built-in one: the
 * stylesheet only ever reads the variables.
 */

import { useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  bg: string;
  panel: string;
  panel2: string;
  line: string;
  fg: string;
  muted: string;
  dim: string;
  faint: string;
  /** Overlay ink, so `bg-sc-fill/10` reads correctly in either mode. */
  fill: string;
  onAccent: string;
  scrollbar: string;
  scrollbarHi: string;
  skeletonA: string;
  skeletonB: string;
}

export interface ThemeDef extends ThemeColors {
  id: string;
  label: string;
  hint: string;
  mode: ThemeMode;
  /** Primary accent. Maps to --sc-orange, which the UI already treats as "accent". */
  accent: string;
  /** Secondary accent, used for the gradient's far end. */
  accent2: string;
  /** True for themes the user made, which are stored separately. */
  custom?: boolean;
}

const indigo: Pick<ThemeDef, 'accent' | 'accent2'> = { accent: '#6d5efc', accent2: '#38e0d4' };

/**
 * Classic named themes.
 *
 * Each is a hand-picked surface set rather than a tint of one colour: deriving
 * panels from the accent by a fixed formula looked correct on screen but put
 * the contrast between bg/panel/line outside anything readable on a projector.
 */
export const BUILT_IN_THEMES: ThemeDef[] = [
  {
    id: 'dark',
    label: 'Dark',
    hint: 'Neutral near-black with indigo',
    mode: 'dark',
    bg: '#0b0b0f',
    panel: '#13131a',
    panel2: '#1b1b25',
    line: '#26262f',
    fg: '#ececf2',
    muted: '#b4b4c4',
    dim: '#87879b',
    faint: '#6a6a7c',
    fill: '255 255 255',
    onAccent: '#ffffff',
    scrollbar: '#33333f',
    scrollbarHi: '#4a4a5c',
    skeletonA: '#16161e',
    skeletonB: '#20202b',
    ...indigo,
  },
  {
    id: 'light',
    label: 'Light',
    hint: 'Bright surfaces for daylight',
    mode: 'light',
    bg: '#f5f5f7',
    panel: '#ffffff',
    panel2: '#eeeef2',
    line: '#dcdce4',
    fg: '#16161f',
    muted: '#4c4c5e',
    dim: '#6c6c80',
    faint: '#8c8ca0',
    fill: '20 20 35',
    onAccent: '#ffffff',
    scrollbar: '#c9c9d4',
    scrollbarHi: '#a6a6b8',
    skeletonA: '#e8e8ee',
    skeletonB: '#f3f3f7',
    ...indigo,
  },
  {
    id: 'red',
    label: 'Red',
    hint: 'Crimson on charcoal',
    mode: 'dark',
    bg: '#0f0a0b',
    panel: '#180f11',
    panel2: '#211518',
    line: '#331d21',
    fg: '#f6e9ea',
    muted: '#cdaeb1',
    dim: '#a18084',
    faint: '#7f666a',
    fill: '255 255 255',
    onAccent: '#ffffff',
    scrollbar: '#42272c',
    scrollbarHi: '#5c373d',
    skeletonA: '#1d1214',
    skeletonB: '#291a1d',
    accent: '#ef3f52',
    accent2: '#ff9a6b',
  },
  {
    id: 'blue',
    label: 'Blue',
    hint: 'Deep azure with cyan',
    mode: 'dark',
    bg: '#070c14',
    panel: '#0d1420',
    panel2: '#131d2c',
    line: '#1e2c40',
    fg: '#e6eefa',
    muted: '#a9b9d2',
    dim: '#7d8ea8',
    faint: '#5f6f86',
    fill: '255 255 255',
    onAccent: '#ffffff',
    scrollbar: '#27384f',
    scrollbarHi: '#375070',
    skeletonA: '#101a29',
    skeletonB: '#18253a',
    accent: '#2f7cf6',
    accent2: '#38e0d4',
  },
  {
    id: 'green',
    label: 'Green',
    hint: 'Forest with lime accent',
    mode: 'dark',
    bg: '#080f0b',
    panel: '#0f1712',
    panel2: '#16211a',
    line: '#22332a',
    fg: '#e8f3ec',
    muted: '#aec4b6',
    dim: '#82998b',
    faint: '#647a6d',
    fill: '255 255 255',
    onAccent: '#ffffff',
    scrollbar: '#2b4236',
    scrollbarHi: '#3d5b4b',
    skeletonA: '#12201a',
    skeletonB: '#1c2e25',
    accent: '#2fbf6d',
    accent2: '#b6e34a',
  },
  {
    id: 'purple',
    label: 'Purple',
    hint: 'Violet on plum',
    mode: 'dark',
    bg: '#0c0813',
    panel: '#150f1f',
    panel2: '#1e162b',
    line: '#2f2340',
    fg: '#f0eafa',
    muted: '#c3b4d9',
    dim: '#94859f',
    faint: '#776a80',
    fill: '255 255 255',
    onAccent: '#ffffff',
    scrollbar: '#3c2e50',
    scrollbarHi: '#524071',
    skeletonA: '#18111f',
    skeletonB: '#241a30',
    accent: '#8b5cf6',
    accent2: '#f472b6',
  },
  {
    id: 'orange',
    label: 'Orange',
    hint: 'Amber on warm brown',
    mode: 'dark',
    bg: '#100a06',
    panel: '#18100a',
    panel2: '#221709',
    line: '#35240f',
    fg: '#f7ece0',
    muted: '#d0b69c',
    dim: '#a48d76',
    faint: '#816e5d',
    fill: '255 255 255',
    onAccent: '#1a1005',
    scrollbar: '#452f16',
    scrollbarHi: '#5f4320',
    skeletonA: '#1d130c',
    skeletonB: '#2a1c11',
    accent: '#f97316',
    accent2: '#facc15',
  },
  {
    id: 'pink',
    label: 'Pink',
    hint: 'Magenta on aubergine',
    mode: 'dark',
    bg: '#0e0710',
    panel: '#170c19',
    panel2: '#211023',
    line: '#341a38',
    fg: '#f8eaf6',
    muted: '#d3b0d0',
    dim: '#a582a2',
    faint: '#836580',
    fill: '255 255 255',
    onAccent: '#ffffff',
    scrollbar: '#43214a',
    scrollbarHi: '#5c2f66',
    skeletonA: '#1b0f1d',
    skeletonB: '#28162b',
    accent: '#ec4899',
    accent2: '#a78bfa',
  },
];

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full.slice(0, 6) || '000000', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Mixes towards white by `amount` (0-1). */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

/** Mixes towards black by `amount` (0-1). */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/** Relative luminance, used to pick readable ink on top of a colour. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Stable id for a generated theme.
 *
 * Derived from the colours rather than the name, so renaming a saved theme
 * keeps it pointed at by the same id and re-picking the same accent replaces
 * it instead of adding a near-duplicate.
 */
export function customThemeId(accent: string, mode: ThemeMode, accent2?: string): string {
  const clean = (c: string) => c.replace('#', '').toLowerCase();
  return `custom:${clean(accent)}:${mode}:${clean(accent2 ?? '')}`;
}

/**
 * Builds a full theme from an accent colour and a light/dark mode.
 *
 * The surfaces are derived from the accent by tiny amounts (3-8% mixed into a
 * fixed neutral) so the result keeps the contrast ladder of the built-ins while
 * still reading as "this is the colour I picked".
 */
export function themeFromAccent(
  accent: string,
  mode: ThemeMode,
  accent2?: string,
  label?: string
): ThemeDef {
  const base = mode === 'light' ? '#f5f5f7' : '#0b0b0f';
  const secAccent = accent2 && /^#[0-9a-f]{6}$/i.test(accent2.trim()) ? accent2.trim() : shiftHue(accent, 0.08);
  const panel = mode === 'light' ? lighten(accent, 0.97) : mix(accent, '#0b0b0f', 0.05);
  const panel2 = mode === 'light' ? lighten(accent, 0.93) : mix(accent, '#0b0b0f', 0.1);
  const line = mode === 'light' ? mix(accent, '#ffffff', 0.55) : mix(accent, '#000000', 0.3);
  const fg = mode === 'light' ? darken(accent, 0.92) : lighten(accent, 0.95);

  return {
    id: customThemeId(accent, mode, secAccent),
    label: label ?? 'Custom',
    hint: `Built from your colours (${mode})`,
    mode,
    custom: true,
    accent,
    accent2: secAccent,
    bg: base,
    panel,
    panel2,
    line,
    fg,
    muted: mode === 'light' ? mix(accent, '#3a3a48', 0.6) : lighten(accent, 0.72),
    dim: mode === 'light' ? mix(accent, '#4a4a5c', 0.4) : lighten(accent, 0.6),
    faint: mode === 'light' ? mix(accent, '#5a5a70', 0.3) : lighten(accent, 0.45),
    fill: mode === 'light' ? '20 20 35' : '255 255 255',
    onAccent: contrastRatio(accent, '#ffffff') >= 3.2 ? '#ffffff' : '#101018',
    scrollbar: mode === 'light' ? mix(accent, '#ffffff', 0.35) : mix(accent, '#000000', 0.4),
    scrollbarHi: mode === 'light' ? mix(accent, '#ffffff', 0.15) : mix(accent, '#000000', 0.55),
    skeletonA: mode === 'light' ? lighten(accent, 0.9) : mix(accent, '#0b0b0f', 0.08),
    skeletonB: mode === 'light' ? lighten(accent, 0.82) : mix(accent, '#0b0b0f', 0.14),
  };
}

/** Mixes `a` towards `b` by `amount`. */
function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount);
}

/**
 * Rotates the hue so the second accent is related but distinguishable.
 *
 * The standard YIQ rotation matrix is used on RGB: it keeps greys grey, which
 * a naive RGB rotation does not, so picking a neutral accent does not produce a
 * coloured second accent out of nowhere.
 */
function shiftHue(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = amount * Math.PI * 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const nr = (1 - cos) * r + cos * g + sin * b;
  const ng = sin * r + (1 - cos) * g - sin * b;
  const nb = -sin * r + sin * g + (1 - cos) * b;
  return rgbToHex(nr, ng, nb);
}

/* ------------------------------------------------------------------ *
 * Applying
 * ------------------------------------------------------------------ */

const VAR_MAP: Record<keyof ThemeColors, string> = {
  bg: '--sc-bg',
  panel: '--sc-panel',
  panel2: '--sc-panel-2',
  line: '--sc-line',
  fg: '--sc-fg',
  muted: '--sc-muted',
  dim: '--sc-dim',
  faint: '--sc-faint',
  fill: '--sc-fill',
  onAccent: '--sc-on-accent',
  scrollbar: '--sc-scrollbar',
  scrollbarHi: '--sc-scrollbar-hi',
  skeletonA: '--sc-skeleton-a',
  skeletonB: '--sc-skeleton-b',
};

/**
 * Writes a theme onto <html>.
 *
 * `data-theme` is kept for anything that still wants to branch on a name, but
 * the variables are the source of truth. The native window chrome follows via
 * `color-scheme`, which is what makes scrollbars and form controls match.
 */
export function applyTheme(theme: ThemeDef): void {
  const root = document.documentElement;
  const keys = Object.keys(VAR_MAP) as (keyof ThemeColors)[];
  for (const key of keys) {
    root.style.setProperty(VAR_MAP[key], theme[key]);
  }
  root.style.setProperty('--sc-accent', theme.accent);
  root.style.setProperty('--sc-accent-2', theme.accent2);
  root.style.setProperty('color-scheme', theme.mode);
  root.dataset.theme = theme.id;
  emit();
}

/* ------------------------------------------------------------------ *
 * Accent for canvas and inline SVG
 *
 * A `<canvas>` cannot resolve `var(--sc-accent)`, and the EQ curve is drawn
 * partly in SVG. Rather than thread the accent through every component, they
 * subscribe here. It is a two-element store, not a reactive framework.
 * ------------------------------------------------------------------ */

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) fn();
}

function readAccent(): { accent: string; accent2: string } {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: style.getPropertyValue('--sc-accent').trim() || '#6d5efc',
    accent2: style.getPropertyValue('--sc-accent-2').trim() || '#38e0d4',
  };
}

/** Current theme accents, re-rendering the caller when the theme changes. */
export function useAccent(): { accent: string; accent2: string } {
  const [colors, setColors] = useState(readAccent);
  useEffect(() => {
    const onChange: Listener = () => setColors(readAccent());
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return colors;
}

export const THEME_STORE_KEY = 'sc9000:themes';
export const THEME_ACTIVE_KEY = 'sc9000:theme';

export function loadCustomThemes(): ThemeDef[] {
  try {
    const raw = localStorage.getItem(THEME_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ThemeDef[];
    return Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.accent === 'string') : [];
  } catch {
    return [];
  }
}

export function saveCustomThemes(list: ThemeDef[]): void {
  try {
    localStorage.setItem(THEME_STORE_KEY, JSON.stringify(list));
  } catch {
    /* quota - the active theme is still applied for this session */
  }
}

/** Old ids mapped onto the current set so an existing install keeps its look. */
const LEGACY_THEME_ALIASES: Record<string, string> = {
  midnight: 'dark',
  oled: 'dark',
  dusk: 'purple',
  daylight: 'light',
};

/** Normalises a legacy id onto the current set without falling back. */
export function normalizeThemeId(id: string): string {
  return LEGACY_THEME_ALIASES[id] ?? id;
}

/**
 * Looks a theme up by id, following legacy aliases. Returns null when the id is
 * unknown, so callers can tell "not a theme" apart from "the default theme".
 */
export function matchTheme(id: string, custom: ThemeDef[]): ThemeDef | null {
  const target = normalizeThemeId(id);
  return (
    custom.find((t) => t.id === target) ??
    BUILT_IN_THEMES.find((t) => t.id === target) ??
    null
  );
}

export function resolveTheme(id: string, custom: ThemeDef[]): ThemeDef {
  return matchTheme(id, custom) ?? BUILT_IN_THEMES[0];
}

/** Swatch colours for the theme picker. */
export function themeSwatch(t: ThemeDef): string[] {
  return [t.bg, t.panel2, t.accent, t.accent2];
}