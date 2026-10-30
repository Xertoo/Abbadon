/**
 * Utilities for managing custom playlist artworks & cover overrides.
 * Persists locally in-memory, localStorage, and directly to desktop disk
 * so covers are immediately and permanently preserved across app launches.
 */

const STORAGE_KEY = 'sc9000:playlist_artwork_overrides';

let inMemoryOverrides: Record<string, string> | null = null;

export function normalizePlaylistId(id: string | number): string {
  if (!id) return '';
  return String(id).replace(/^(?:soundcloud:playlists:|local:|server:)/, '').trim();
}

export function getPlaylistArtworkOverrides(): Record<string, string> {
  if (inMemoryOverrides) return inMemoryOverrides;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    inMemoryOverrides = raw ? JSON.parse(raw) : {};
  } catch {
    inMemoryOverrides = {};
  }
  return inMemoryOverrides || {};
}

export function getPlaylistArtworkOverride(id: string | number): string | null {
  if (!id) return null;
  const overrides = getPlaylistArtworkOverrides();
  const rawId = String(id).trim();
  const cleanId = normalizePlaylistId(rawId);

  return (
    overrides[rawId] ||
    overrides[cleanId] ||
    overrides[`soundcloud:playlists:${cleanId}`] ||
    null
  );
}

export function setPlaylistArtworkOverride(id: string | number, artwork: string): void {
  if (!id) return;
  const rawId = String(id).trim();
  const cleanId = normalizePlaylistId(rawId);
  const overrides = { ...getPlaylistArtworkOverrides() };

  if (artwork && artwork.trim()) {
    const val = artwork.trim();
    overrides[rawId] = val;
    if (cleanId) overrides[cleanId] = val;
    if (/^\d+$/.test(cleanId)) {
      overrides[`soundcloud:playlists:${cleanId}`] = val;
    }
  } else {
    delete overrides[rawId];
    if (cleanId) delete overrides[cleanId];
    delete overrides[`soundcloud:playlists:${cleanId}`];
  }

  inMemoryOverrides = overrides;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    }
  } catch (err) {
    console.warn('[playlistArtwork] Failed to save artwork override to localStorage:', err);
  }

  // Also persist to desktop disk (userData/playlist_artwork.json)
  if (typeof window !== 'undefined' && window.desktop?.saveArtworkOverrides) {
    window.desktop.saveArtworkOverrides(overrides).catch((err) => {
      console.warn('[playlistArtwork] Desktop artwork override save failed:', err);
    });
  }
}

export function removePlaylistArtworkOverride(id: string | number): void {
  setPlaylistArtworkOverride(id, '');
}

/**
 * Loads artwork overrides from disk (Electron) on boot and synchronizes with localStorage.
 */
export async function initPlaylistArtworkOverrides(): Promise<Record<string, string>> {
  const local = getPlaylistArtworkOverrides();
  if (typeof window !== 'undefined' && window.desktop?.loadArtworkOverrides) {
    try {
      const res = await window.desktop.loadArtworkOverrides();
      if (res?.ok && res.data && typeof res.data === 'object') {
        const merged = { ...res.data, ...local };
        inMemoryOverrides = merged;
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          }
        } catch {}
        return merged;
      }
    } catch (err) {
      console.warn('[playlistArtwork] Desktop artwork override load failed:', err);
    }
  }
  return local;
}

/**
 * Resizes and compresses an image (File, Blob, or image URL) to a square JPEG data URL.
 * Keeps storage minimal (~30-60KB) and ensures instant loading.
 */
export async function optimizePlaylistImage(
  source: File | Blob | string,
  targetSize = 500,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    let srcUrl = '';
    let shouldRevoke = false;

    if (typeof source === 'string') {
      srcUrl = source;
    } else {
      srcUrl = URL.createObjectURL(source);
      shouldRevoke = true;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas context unavailable');
        }

        // Center crop to square
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        if (shouldRevoke) URL.revokeObjectURL(srcUrl);
        resolve(dataUrl);
      } catch (err) {
        if (shouldRevoke) URL.revokeObjectURL(srcUrl);
        if (typeof source === 'string') {
          resolve(source);
        } else {
          reject(err);
        }
      }
    };

    img.onerror = () => {
      if (shouldRevoke) URL.revokeObjectURL(srcUrl);
      if (typeof source === 'string') {
        resolve(source);
      } else {
        reject(new Error('Failed to load image file'));
      }
    };

    img.src = srcUrl;
  });
}
