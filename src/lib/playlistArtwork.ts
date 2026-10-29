/**
 * Utilities for managing custom playlist artworks & cover overrides.
 */

const STORAGE_KEY = 'sc9000:playlist_artwork_overrides';

export function getPlaylistArtworkOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getPlaylistArtworkOverride(id: string): string | null {
  if (!id) return null;
  const overrides = getPlaylistArtworkOverrides();
  return overrides[id] || null;
}

export function setPlaylistArtworkOverride(id: string, artwork: string): void {
  if (!id) return;
  try {
    const overrides = getPlaylistArtworkOverrides();
    if (artwork && artwork.trim()) {
      overrides[id] = artwork.trim();
    } else {
      delete overrides[id];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch (err) {
    console.warn('[playlistArtwork] Failed to save artwork override:', err);
  }
}

export function removePlaylistArtworkOverride(id: string): void {
  if (!id) return;
  try {
    const overrides = getPlaylistArtworkOverrides();
    if (overrides[id]) {
      delete overrides[id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    }
  } catch {}
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
