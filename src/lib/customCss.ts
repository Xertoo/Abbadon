/**
 * Custom CSS injector and preset manager.
 * Allows users to customize the Abbadon client in real-time (Vencord style).
 */

export const CUSTOM_CSS_STYLE_ID = 'abbadon-custom-css';

/**
 * Applies custom CSS live by injecting or updating the custom <style> element in <head>.
 */
export function applyCustomCss(css: string, enabled = true): void {
  if (typeof document === 'undefined') return;

  let styleEl = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = CUSTOM_CSS_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  if (!enabled || !css || !css.trim()) {
    styleEl.textContent = '';
  } else {
    styleEl.textContent = css;
  }
}

export interface CssSnippet {
  id: string;
  name: string;
  description: string;
  css: string;
}

export const CUSTOM_CSS_SNIPPETS: CssSnippet[] = [
  {
    id: 'glassmorphism',
    name: 'Frosted Glassmorphism',
    description: 'Translucent panels with backdrop-blur for sidebar, header, and player bar',
    css: `/* Frosted Glassmorphism */
aside, .sidebar {
  background-color: rgba(19, 19, 26, 0.45) !important;
  backdrop-filter: blur(28px) saturate(180%) !important;
  border-right: 1px solid rgba(255, 255, 255, 0.08) !important;
}

header, .app-header {
  background-color: rgba(19, 19, 26, 0.35) !important;
  backdrop-filter: blur(20px) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
}

footer, .player-bar {
  background-color: rgba(19, 19, 26, 0.55) !important;
  backdrop-filter: blur(32px) saturate(190%) !important;
  border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
}
`,
  },
  {
    id: 'cyberpunk-glow',
    name: 'Neon Cyber Glow',
    description: 'Vibrant neon borders, glowing player controls, and active track illumination',
    css: `/* Neon Cyber Glow */
footer, .player-bar {
  box-shadow: 0 -8px 30px -4px var(--sc-accent), 0 -1px 0 0 var(--sc-accent) !important;
}

.track-row:hover {
  box-shadow: inset 0 0 16px -4px var(--sc-accent) !important;
  border-radius: 12px !important;
}

button:focus-visible, input:focus-visible {
  outline: 2px solid var(--sc-accent) !important;
  box-shadow: 0 0 12px var(--sc-accent) !important;
}
`,
  },
  {
    id: 'floating-player',
    name: 'Floating Pill Player Bar',
    description: 'Detaches the bottom player into a floating rounded deck',
    css: `/* Floating Pill Player Bar */
footer, .player-bar {
  margin: 14px 20px !important;
  border-radius: 24px !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  box-shadow: 0 16px 40px -10px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.06) !important;
  overflow: visible !important;
}
`,
  },
  {
    id: 'font-jetbrains',
    name: 'JetBrains Mono Font',
    description: 'Imports Google Fonts JetBrains Mono for a clean developer aesthetic',
    css: `/* Import JetBrains Mono */
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap');

body, button, input, select, textarea {
  font-family: 'JetBrains Mono', monospace !important;
  letter-spacing: -0.02em;
}
`,
  },
  {
    id: 'font-poppins',
    name: 'Poppins Modern Geometric Font',
    description: 'Smooth, friendly geometric typography across the entire interface',
    css: `/* Import Poppins */
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');

body, button, input, select, textarea {
  font-family: 'Poppins', sans-serif !important;
}
`,
  },
  {
    id: 'rounded-ui',
    name: 'Super Rounded (Pill Aesthetic)',
    description: 'Soft rounded buttons, artwork, badges, and smooth borders',
    css: `/* Super Rounded UI */
img, .track-artwork {
  border-radius: 18px !important;
}

button {
  border-radius: 9999px !important;
}

input {
  border-radius: 9999px !important;
}
`,
  },
  {
    id: 'wallpaper-overlay',
    name: 'Custom Wallpaper Background',
    description: 'Adds a wallpaper image with a subtle ambient dark overlay behind the client',
    css: `/* Custom Wallpaper Background */
/* Replace the URL below with your favorite wallpaper image! */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  background-image: url('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1920&auto=format&fit=crop');
  background-position: center;
  background-size: cover;
  opacity: 0.18;
  pointer-events: none;
  z-index: 0;
  filter: contrast(1.1) brightness(0.9);
}
`,
  },
  {
    id: 'minimal-streamlined',
    name: 'Ultra-Minimalist Studio',
    description: 'Dim muted surfaces, hidden extra badges, and a distraction-free music view',
    css: `/* Ultra-Minimalist Studio */
:root {
  --sc-panel: #0d0d12 !important;
  --sc-bg: #07070a !important;
}

aside, header, footer {
  border-color: rgba(255, 255, 255, 0.04) !important;
}
`,
  },
];

export const CSS_CHEAT_SHEET = {
  variables: [
    { name: '--sc-bg', desc: 'Main app background (#0b0b0f)' },
    { name: '--sc-panel', desc: 'Panels, cards & drawer surface (#13131a)' },
    { name: '--sc-panel-2', desc: 'Secondary panel / hover surface (#1b1b25)' },
    { name: '--sc-line', desc: 'Divider and outline borders (#26262f)' },
    { name: '--sc-fg', desc: 'Primary typography ink (#ececf2)' },
    { name: '--sc-muted', desc: 'Secondary muted labels (#b4b4c4)' },
    { name: '--sc-dim', desc: 'Subtle captions and icons (#87879b)' },
    { name: '--sc-accent', desc: 'Primary theme accent (#6d5efc)' },
    { name: '--sc-accent-2', desc: 'Secondary gradient accent (#38e0d4)' },
    { name: '--sc-orange', desc: 'Main interaction accent / playhead' },
  ],
  selectors: [
    { selector: 'body', desc: 'App root window container' },
    { selector: 'aside, .sidebar', desc: 'Left navigation sidebar' },
    { selector: 'header, .app-header', desc: 'Top bar with search & navigation' },
    { selector: 'footer, .player-bar', desc: 'Bottom music playback bar' },
    { selector: '.track-row', desc: 'Individual song list rows' },
    { selector: '.titlebar', desc: 'Window title bar & caption controls' },
    { selector: 'main', desc: 'Main scrolling content pane' },
  ],
};
