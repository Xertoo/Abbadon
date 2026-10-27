import type { Playlist, Track } from '../types';

const STORAGE_KEY = 'sc9000:local_library';

export interface LocalMediaState {
  playlists: Playlist[];
  tracks: Track[];
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export async function loadLocalMedia(): Promise<LocalMediaState> {
  // Try Electron desktop storage first
  if (window.desktop?.loadLocalLibrary) {
    try {
      const res = await window.desktop.loadLocalLibrary();
      if (res.ok && res.data) {
        return {
          playlists: Array.isArray(res.data.playlists) ? res.data.playlists : [],
          tracks: Array.isArray(res.data.tracks) ? res.data.tracks : [],
        };
      }
    } catch (err) {
      console.warn('[localMedia] load from desktop failed, using localStorage fallback:', err);
    }
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
        tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
      };
    }
  } catch {}

  return { playlists: [], tracks: [] };
}

export async function saveLocalMedia(state: LocalMediaState): Promise<void> {
  // Save to localStorage
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[localMedia] localStorage save failed:', err);
  }

  // Save to Electron desktop storage
  if (window.desktop?.saveLocalLibrary) {
    try {
      await window.desktop.saveLocalLibrary(state);
    } catch (err) {
      console.warn('[localMedia] desktop save failed:', err);
    }
  }
}

export function createServerTrack(
  url: string,
  title?: string,
  artist?: string,
  artwork?: string
): Track {
  let defaultTitle = 'Server Stream';
  let defaultArtist = 'Web Server';

  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    if (pathSegments.length > 0) {
      const last = pathSegments[pathSegments.length - 1];
      defaultTitle = decodeURIComponent(last.replace(/\.[a-zA-Z0-9]+$/, '')) || parsed.hostname;
    } else {
      defaultTitle = parsed.hostname;
    }
    defaultArtist = parsed.hostname;
  } catch {}

  const finalTitle = (title?.trim() || defaultTitle).trim();
  const finalArtist = (artist?.trim() || defaultArtist).trim();
  const id = `server:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    title: finalTitle,
    artist: finalArtist,
    duration: 0,
    durationFormatted: '0:00',
    artwork: artwork?.trim() || '',
    genre: 'Server Stream',
    permalinkUrl: url,
    streamUrl: url,
    source: 'server',
  };
}

export function createLocalPlaylist(
  title: string,
  tracks: Track[] = [],
  description = ''
): Playlist {
  const id = `local:pl:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: title.trim() || 'Local Playlist',
    description: description || `Created locally with ${tracks.length} tracks`,
    artwork: tracks[0]?.artwork || '',
    trackCount: tracks.length,
    tracks,
    isLocal: true,
    source: 'local',
  };
}

/** Fallback parser for browser File objects (drag & drop or file input) */
export async function parseBrowserAudioFiles(files: FileList | File[]): Promise<Track[]> {
  const tracks: Track[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = file.name;
    const baseName = name.replace(/\.[^/.]+$/, '');
    const parts = baseName.split(/\s*[-–—]\s*/);

    let artist = 'Local Artist';
    let title = baseName;
    if (parts.length > 1) {
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }

    const streamUrl = URL.createObjectURL(file);
    const id = `local:blob:${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;

    tracks.push({
      id,
      title,
      artist,
      duration: 0,
      durationFormatted: '0:00',
      artwork: '',
      genre: 'Local',
      permalinkUrl: name,
      streamUrl,
      source: 'local',
    });
  }

  return tracks;
}
