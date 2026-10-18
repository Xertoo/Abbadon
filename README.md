# Abbadon

A clean, dark-mode desktop client for SoundCloud built with Electron, React, and TypeScript. No browser tabs, no web bloat, just fast streaming, synchronized listening parties with friends, live karaoke lyrics, and a built-in equalizer.

![Abbadon Preview](dist/assets/icon.png)

---

## Why Abbadon?

The standard SoundCloud web interface works, but running it in a browser tab comes with drawbacks: accidental tab closes, heavy memory usage, no global media hotkeys, and no way to listen together with friends without setting up Discord bots or screen sharing.

Abbadon runs as a standalone desktop app with:
- **Zero-lag peer-to-peer audio sync** to listen along with friends in real time.
- **Synchronized karaoke lyrics** pulled straight from LRCLIB.
- **10-band parametric equalizer & audio visualizer** running directly on the Web Audio API.
- **Global media keys support** (Play/Pause, Next, Prev on your keyboard work even when the app is minimized).
- **Instant Spotify playlist conversion** so you can search and play tracks on SoundCloud.
- **Silent auto-updates** delivered directly via GitHub Releases.

---

## Features

### 🎧 Listen Together (P2P Synchronized Playback)
- **Friend Codes:** Add friends using short unique handles (e.g. `SC-98F2`).
- **Live Presence:** Check what your friends are streaming right now with real-time playback position.
- **One-Click Sync:** Follow a friend's stream and your player matches their tracks, play/pause states, and seek timestamps via WebRTC data channels.
- **Jam Rooms:** Host a room as a DJ or join with a room code. Includes live chat and real-time emoji reactions.

### 🎤 Synchronized Lyrics (Karaoke Mode)
- Fullscreen view with live auto-scrolling lyric lines.
- Click any line to seek directly to that part of the track.
- Automatic fallback for instrumental tracks or plain lyrics.

### 🎚 Audio Engine & Visualizer
- 10-band equalizer with custom gain control and savable presets (Bass Boost, Vocal, Electronic, Flat, etc.).
- Real-time frequency spectrum visualizer rendered smoothly via Canvas.

### ⚡ Smart SoundCloud API Layer
- Automatic `client_id` resolution directly from SoundCloud assets with 6-hour local cache.
- Queued requests with exponential backoff on HTTP 429/503.
- Offline demo mode fallback with pre-bundled tracks if network connection drops.

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- Windows 10 / 11

### Quick Launch
Double-click `run.bat` in the project root, or run:

```bash
npm install
npm run app
```

### Useful Scripts

| Command | Description |
| --- | --- |
| `npm run app` | Builds frontend and launches the Electron desktop app |
| `npm run dev` | Runs the Vite dev server only (for rapid UI prototyping) |
| `npm run build` | Runs TypeScript checks and bundles production frontend assets |
| `npm run dist` | Builds the standalone installer (`.exe`) and portable binary in `release/` |
| `publish-update.bat` | Wizard that bumps the version, builds the installer, and prepares `latest.yml` for auto-updates |

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Space` | Play / Pause |
| `/` | Focus search bar |
| `Shift` + `→` / `←` | Next / Previous track |
| `m` | Mute / Unmute audio |
| `s` | Toggle Shuffle mode |
| `r` | Cycle Repeat (Off → All → One) |
| `Media Keys` | Play, Pause, Next, Prev (captured globally from OS) |

---

## Building an Installer & Releasing Updates

1. Run `npm run dist` to create `release/Abbadon Setup 1.0.0.exe`.
2. For distributing updates to existing users, refer to [HOW_TO_RELEASE_UPDATES.md](HOW_TO_RELEASE_UPDATES.md).

---

## License

Built for personal use and audio enthusiasts. Audio streams and metadata are provided by SoundCloud.