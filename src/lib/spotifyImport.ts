import type { Track } from '../types';
import { sc, mapTrack } from './soundcloud';

export interface SpotifyImportItem {
  title: string;
  artist: string;
  durationMs: number;
  artwork?: string;
  uri?: string;
}

export interface SpotifyImportSource {
  type: 'playlist' | 'album' | 'track';
  id: string;
  title: string;
  description?: string;
  artwork?: string;
  tracks: SpotifyImportItem[];
}

export interface SpotifyMatchResult {
  original: SpotifyImportItem;
  match: Track | null;
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  candidates: Track[];
  selected: boolean;
}

/**
 * Extracts the entity type and ID from any Spotify URL or bare ID.
 */
export function extractSpotifyIdAndType(input: string): { type: 'playlist' | 'album' | 'track'; id: string } {
  let s = input.trim();
  // Strip trailing query parameters (?si=...) and hashes
  s = s.split('?')[0].split('#')[0];

  const match = s.match(/(playlist|album|track)[/:]([A-Za-z0-9]+)/i);
  if (match) {
    const rawType = match[1].toLowerCase() as 'playlist' | 'album' | 'track';
    return { type: rawType, id: match[2] };
  }

  // Bare alphanumeric ID -> default to playlist
  if (/^[A-Za-z0-9]{15,}$/.test(s)) {
    return { type: 'playlist', id: s };
  }

  throw new Error('Please enter a valid Spotify link (playlist, album, or track)');
}

/**
 * Decodes common HTML entities (e.g. &amp;, &#39;, &quot;).
 */
export function decodeHtmlEntities(s: string): string {
  if (!s) return '';
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#x27;/gi, "'");
}

/**
 * Normalizes text for fuzzy string matching (lowercased, alphanumeric only, trimmed).
 */
export function normalizeText(s: string): string {
  if (!s) return '';
  return decodeHtmlEntities(s)
    .toLowerCase()
    .replace(/\(feat[^)]*\)|\[feat[^)]*\]|feat\.?.*$/i, ' ')
    .replace(/\(with[^)]*\)|\[with[^)]*\]/i, ' ')
    .replace(/\((?:official|lyric|audio|video|visualizer)[^)]*\)/gi, ' ')
    .replace(/\[(?:official|lyric|audio|video|visualizer)[^\]]*\]/gi, ' ')
    .replace(/\((?:remastered|deluxe|radio edit|bonus track)[^)]*\)/gi, ' ')
    .replace(/\[(?:remastered|deluxe|radio edit|bonus track)[^\]]*\]/gi, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips noise from the search query so SoundCloud's search engine returns the most relevant original tracks.
 */
export function cleanSearchQuery(title: string, artist: string): string {
  const cleanTitle = decodeHtmlEntities(title)
    .replace(/\(feat[^)]*\)|\[feat[^)]*\]|feat\.?.*$/i, '')
    .replace(/\(with[^)]*\)|\[with[^)]*\]/i, '')
    .replace(/\((?:official|lyric|audio|video|visualizer)[^)]*\)/gi, '')
    .replace(/\[(?:official|lyric|audio|video|visualizer)[^\]]*\]/gi, '')
    .replace(/\((?:remastered|deluxe|radio edit|bonus track)[^)]*\)/gi, '')
    .replace(/\[(?:remastered|deluxe|radio edit|bonus track)[^\]]*\]/gi, '')
    .trim();

  const cleanArtist = decodeHtmlEntities(artist).trim();

  return `${cleanArtist} ${cleanTitle}`.trim();
}

/**
 * Computes the Sørensen-Dice bigram coefficient between two strings (0..1).
 */
export function diceCoefficient(a: string, b: string): number {
  const sa = normalizeText(a);
  const sb = normalizeText(b);
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  if (sa.length < 2 || sb.length < 2) return 0;

  const bgA = new Map<string, number>();
  for (let i = 0; i < sa.length - 1; i++) {
    const bi = sa.substring(i, i + 2);
    bgA.set(bi, (bgA.get(bi) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < sb.length - 1; i++) {
    const bi = sb.substring(i, i + 2);
    const count = bgA.get(bi) || 0;
    if (count > 0) {
      bgA.set(bi, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (sa.length - 1 + (sb.length - 1));
}

/**
 * Scores a SoundCloud candidate against the original Spotify track metadata.
 */
export function scoreCandidate(
  sp: SpotifyImportItem,
  cand: Track
): { score: number; confidence: 'high' | 'medium' | 'low' | 'none' } {
  const wantNorm = normalizeText(`${sp.artist} ${sp.title}`);
  const candNorm = normalizeText(`${cand.artist || ''} ${cand.title || ''}`);
  let score = diceCoefficient(wantNorm, candNorm);

  // Artist presence bonus
  const normArtist = normalizeText(sp.artist);
  if (normArtist && (normalizeText(cand.artist || '').includes(normArtist) || candNorm.includes(normArtist))) {
    score += 0.12;
  }

  // Duration proximity check
  if (sp.durationMs > 0 && cand.duration > 0) {
    const diffSec = Math.abs(sp.durationMs / 1000 - cand.duration);
    if (diffSec <= 4) {
      score += 0.15;
    } else if (diffSec <= 8) {
      score += 0.08;
    } else if (diffSec > 35) {
      score -= 0.20;
    }
  }

  // Unwanted modifiers penalty (remixes, sped up, slowed, covers when not requested)
  const unwantedTerms = [
    'remix',
    'sped up',
    'speed up',
    'slowed',
    'nightcore',
    'cover',
    'instrumental',
    'karaoke',
    'parody',
    'tribute',
  ];
  const spLower = `${sp.title} ${sp.artist}`.toLowerCase();
  const candLower = `${cand.title} ${cand.artist || ''}`.toLowerCase();

  for (const term of unwantedTerms) {
    if (!spLower.includes(term) && candLower.includes(term)) {
      score -= 0.25;
      break;
    }
  }

  // Snippet / Preview only penalty: avoid picking 30-second previews
  if (cand.previewOnly) {
    score -= 0.35;
  }

  // High play count boost
  if (cand.playsCount && cand.playsCount > 100_000) {
    score += 0.05;
  }

  score = Math.max(0, Math.min(1, score));
  let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';
  if (score >= 0.70) {
    confidence = 'high';
  } else if (score >= 0.45) {
    confidence = 'medium';
  } else if (score >= 0.28) {
    confidence = 'low';
  }

  return { score: Number(score.toFixed(2)), confidence };
}

/**
 * Recursively searches any nested object for a `trackList` array.
 */
function findTrackList(obj: any): any[] | null {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.trackList) && obj.trackList.length > 0) {
    return obj.trackList;
  }
  for (const k of Object.keys(obj)) {
    try {
      const res = findTrackList(obj[k]);
      if (res) return res;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Fetches HTML from Spotify using Electron's desktop fetch or browser fetch.
 */
async function fetchHtml(url: string): Promise<string> {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en,pl;q=0.9',
  };

  if (window.desktop?.fetch) {
    const res = await window.desktop.fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          'Nie można odczytać tej playlisty (404). Upewnij się, że playlista jest publiczna. (Jeśli to playlista algorytmiczna Spotify np. Odkryj w tym tygodniu, Top 50, Daylist – skopiuj jej utwory do własnej playlisty w Spotify i wklej jej link).'
        );
      }
      throw new Error(`Błąd pobierania strony Spotify (kod: ${res.status || res.error})`);
    }
    return res.text;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        'Nie można odczytać tej playlisty (404). Upewnij się, że playlista jest publiczna. (Jeśli to playlista algorytmiczna Spotify np. Odkryj w tym tygodniu, Top 50, Daylist – skopiuj jej utwory do własnej playlisty w Spotify i wklej jej link).'
      );
    }
    throw new Error(`Błąd pobierania strony Spotify (kod: ${res.status})`);
  }
  return res.text();
}

/**
 * Reads public Spotify track, album, or playlist metadata WITHOUT login or API keys.
 */
export async function fetchSpotifyMetadata(input: string): Promise<SpotifyImportSource> {
  const { type, id } = extractSpotifyIdAndType(input);
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
  const html = await fetchHtml(embedUrl);

  let title = type === 'track' ? 'Spotify Track' : type === 'album' ? 'Spotify Album' : 'Spotify Playlist';
  let description = '';
  let artwork = '';
  const tracks: SpotifyImportItem[] = [];

  // 1) Parse NEXT_DATA JSON
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (match) {
    try {
      const json = JSON.parse(match[1]);
      const entity = json?.props?.pageProps?.state?.data?.entity;
      if (entity) {
        title = entity.name || entity.title || title;
        description = entity.description || '';

        // Artwork
        if (entity.visualIdentity?.image?.[0]?.url) {
          artwork = entity.visualIdentity.image[0].url;
        } else if (entity.coverArt?.sources?.[0]?.url) {
          artwork = entity.coverArt.sources[0].url;
        }
      }

      // Check for trackList directly or recursively
      const trackList = (entity && Array.isArray(entity.trackList) && entity.trackList.length > 0)
        ? entity.trackList
        : findTrackList(json);

      if (trackList && Array.isArray(trackList) && trackList.length > 0) {
        for (const it of trackList) {
          const tTitle = it.title || it.name || '';
          const tArtist =
            it.subtitle || (Array.isArray(it.artists) ? it.artists.map((a: any) => a.name).join(', ') : '');
          const dur = typeof it.duration === 'number' ? it.duration : (typeof it.durationMs === 'number' ? it.durationMs : 0);
          if (tTitle) {
            tracks.push({
              title: tTitle,
              artist: tArtist || 'Unknown Artist',
              durationMs: dur,
              uri: it.uri,
            });
          }
        }
      } else if (type === 'track' && entity) {
        const tTitle = entity.title || entity.name || '';
        const tArtist = Array.isArray(entity.artists)
          ? entity.artists.map((a: any) => a.name).join(', ')
          : entity.subtitle || 'Unknown Artist';
        const dur = typeof entity.duration === 'number' ? entity.duration : 0;
        if (tTitle) {
          tracks.push({
            title: tTitle,
            artist: tArtist,
            durationMs: dur,
            uri: entity.uri,
          });
        }
      }
    } catch (err) {
      console.warn('[spotifyImport] Failed to parse __NEXT_DATA__:', err);
    }
  }

  // 2) Fallback regex parsing if no tracks found
  if (tracks.length === 0) {
    const regexMatches = [...html.matchAll(/"title":"((?:[^"\\]|\\.)*)","subtitle":"((?:[^"\\]|\\.)*)"/g)];
    for (const rm of regexMatches) {
      try {
        const tTitle = JSON.parse('"' + rm[1] + '"');
        const tArtist = JSON.parse('"' + rm[2] + '"');
        if (tTitle && !tracks.some((x) => x.title === tTitle && x.artist === tArtist)) {
          tracks.push({
            title: tTitle,
            artist: tArtist || 'Unknown Artist',
            durationMs: 0,
          });
        }
      } catch {
        /* ignore regex json error */
      }
    }
  }

  // 3) Try oEmbed for accurate title and thumbnail
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=https://open.spotify.com/${type}/${id}`;
    let oembedText = '';
    if (window.desktop?.fetch) {
      const r = await window.desktop.fetch(oembedUrl);
      if (r.ok) oembedText = r.text;
    } else {
      const r = await fetch(oembedUrl);
      if (r.ok) oembedText = await r.text();
    }
    if (oembedText) {
      const oembed = JSON.parse(oembedText);
      if (oembed.title && (title === 'Spotify Playlist' || title === 'Spotify Album' || title === 'Spotify Track')) {
        title = oembed.title;
      }
      if (oembed.thumbnail_url && !artwork) {
        artwork = oembed.thumbnail_url;
      }
    }
  } catch {
    /* oembed optional */
  }

  if (tracks.length === 0) {
    throw new Error(
      'No tracks found. Please make sure the playlist/album is public and shareable via link.'
    );
  }

  return {
    type,
    id,
    title,
    description,
    artwork,
    tracks,
  };
}

/**
 * Searches SoundCloud for candidates matching a Spotify track and ranks them.
 */
export async function searchAndRankCandidates(
  item: SpotifyImportItem,
  limit = 8
): Promise<{ candidates: Track[]; bestMatch: Track | null; score: number; confidence: 'high' | 'medium' | 'low' | 'none' }> {
  const query = cleanSearchQuery(item.title, item.artist);
  try {
    const res = await sc.searchTracks(query, limit);
    const seenIds = new Set<string>();
    const scTracks = (res.collection || [])
      .map((raw) => {
        const mapped = mapTrack(raw);
        if (mapped.artwork) {
          mapped.artwork = mapped.artwork.replace('-large', '-t500x500');
        } else if (item.artwork) {
          mapped.artwork = item.artwork;
        }
        return mapped;
      })
      .filter((t) => {
        if (!t.id || seenIds.has(t.id)) return false;
        seenIds.add(t.id);
        return true;
      });

    // Score all candidates
    const scored = scTracks.map((cand) => ({
      cand,
      ...scoreCandidate(item, cand),
    }));

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    const candidates = scored.map((s) => s.cand);
    const top = scored[0];

    if (!top || top.score < 0.25) {
      return {
        candidates,
        bestMatch: null,
        score: top ? top.score : 0,
        confidence: 'none',
      };
    }

    return {
      candidates,
      bestMatch: top.cand,
      score: top.score,
      confidence: top.confidence,
    };
  } catch (err) {
    console.warn('[spotifyImport] SoundCloud search failed for:', query, err);
    return {
      candidates: [],
      bestMatch: null,
      score: 0,
      confidence: 'none',
    };
  }
}

/**
 * Searches SoundCloud candidates for a manual query override.
 */
export async function searchManualQuery(
  originalItem: SpotifyImportItem,
  customQuery: string,
  limit = 8
): Promise<{ candidates: Track[]; bestMatch: Track | null; score: number; confidence: 'high' | 'medium' | 'low' | 'none' }> {
  try {
    const res = await sc.searchTracks(customQuery.trim(), limit);
    const seenIds = new Set<string>();
    const scTracks = (res.collection || [])
      .map((raw) => {
        const mapped = mapTrack(raw);
        if (mapped.artwork) {
          mapped.artwork = mapped.artwork.replace('-large', '-t500x500');
        } else if (originalItem.artwork) {
          mapped.artwork = originalItem.artwork;
        }
        return mapped;
      })
      .filter((t) => {
        if (!t.id || seenIds.has(t.id)) return false;
        seenIds.add(t.id);
        return true;
      });

    const scored = scTracks.map((cand) => ({
      cand,
      ...scoreCandidate(originalItem, cand),
    }));

    scored.sort((a, b) => b.score - a.score);
    const candidates = scored.map((s) => s.cand);
    const top = scored[0];

    return {
      candidates,
      bestMatch: top ? top.cand : null,
      score: top ? top.score : 0,
      confidence: top ? top.confidence : 'none',
    };
  } catch (err) {
    return { candidates: [], bestMatch: null, score: 0, confidence: 'none' };
  }
}
