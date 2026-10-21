/**
 * High-accuracy automatic lyric lookup with multi-tier query normalization,
 * fallback search, and secondary provider support (LRCLIB + lyrics.ovh).
 */

import type { Track } from '../types';

const LRCLIB_GET = 'https://lrclib.net/api/get';
const LRCLIB_SEARCH = 'https://lrclib.net/api/search';
const LYRICS_OVH = 'https://api.lyrics.ovh/v1';

const APP_USER_AGENT = 'AbbadonSoundCloudClient/1.0.5 (https://github.com)';

/** Similarity threshold for search ranking */
const ARTIST_SIMILARITY = 0.45;

export interface LyricLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface Lyrics {
  lines: LyricLine[];
  /** Unsynced text, present when the database only has a transcript. */
  plain: string;
  instrumental: boolean;
  /** True when `lines` can drive a scrolling view. */
  synced: boolean;
  source?: 'lrclib' | 'lyrics.ovh' | 'cache';
}

interface LrcLibResponse {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

interface LrcLibSearchItem {
  trackName: string;
  artistName: string;
  albumName?: string;
  instrumental?: boolean;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
}

/**
 * Removes SoundCloud and YouTube upload decorations, video tags, audio tags,
 * producer tags, and extra bracketed notes from a title or artist segment.
 */
export function cleanDecorations(s: string): string {
  if (!s) return '';
  return s
    // Remove bracketed feature tags: [feat. X], (ft. X), (with X)
    .replace(/[\(\[\{](?:feat\.?|ft\.?|featuring|with)\s+[^)\x5D\}]+[\)\]\}]/gi, ' ')
    // Remove upload fluff in brackets/parentheses
    .replace(
      /[\(\[\{][^)\x5D\}]*(?:official|video|music\s*video|audio|lyrics?|visualizer|hd|hq|4k|prod\b|slowed|reverb|sped\s*up|speed\s*up|bass\s*boosted|remix|edit|version|clip)[^)\x5D\}]*[\)\]\}]/gi,
      ' '
    )
    // Remove leftover empty brackets
    .replace(/[\(\[\{]\s*[\)\]\}]/g, ' ')
    // Remove trailing ft./feat./prod. tags
    .replace(/\s+(?:feat\.?|ft\.?|featuring|prod\.?|produced\s+by)\s+.*$/i, ' ')
    // Remove unwanted surrounding quotes
    .replace(/^["'„”«»]+|["'„”«»]+$/g, '')
    // Normalize spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract primary artist in case of collaborations (e.g. "Skrillex & Fred again.. feat. Flowdan" -> "Skrillex")
 */
export function extractPrimaryArtist(artist: string): string {
  if (!artist) return '';
  const first = artist.split(/\s*(?:,|&|\bx\b|\bvs\.?\b|\bft\.?\b|\bfeat\.?\b)\s*/i)[0];
  return cleanDecorations(first);
}

export interface CandidateQuery {
  artist: string;
  title: string;
  duration?: number;
}

/**
 * Generates prioritized candidate queries from SoundCloud track information.
 * Handles cases where the title contains "Artist - Title", or where artist
 * uploaded "Title (feat. X)" or vice-versa.
 */
export function generateCandidateQueries(track: Track): CandidateQuery[] {
  const rawTitle = track.title || '';
  const rawArtist = track.artist || '';
  const duration = track.duration && track.duration > 0 ? track.duration : undefined;

  const candidates: CandidateQuery[] = [];
  const seen = new Set<string>();

  const add = (artist: string, title: string) => {
    const a = cleanDecorations(artist);
    const t = cleanDecorations(title);
    if (!t) return;
    const key = `${a.toLowerCase()}::${t.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ artist: a, title: t, duration });
    }
  };

  // 1. Delimiter in title ("Artist - Title" or "Artist : Title" or "Artist – Title")
  const delimMatch = rawTitle.match(/^(.+?)\s*[-–—:]\s*(.+)$/);
  if (delimMatch) {
    const part1 = delimMatch[1].trim();
    const part2 = delimMatch[2].trim();

    // Standard "Artist - Title"
    add(part1, part2);

    // Primary artist of part1
    const primPart1 = extractPrimaryArtist(part1);
    if (primPart1 && primPart1.toLowerCase() !== part1.toLowerCase()) {
      add(primPart1, part2);
    }

    // Inverted "Title - Artist"
    add(part2, part1);

    // If SC artist differs from part1, also try SC artist + part2
    if (rawArtist && rawArtist.toLowerCase() !== part1.toLowerCase()) {
      add(rawArtist, part2);
      const primRaw = extractPrimaryArtist(rawArtist);
      if (primRaw) add(primRaw, part2);
    }
  }

  // 2. SC Artist + cleaned title
  add(rawArtist, rawTitle);
  const primRawArtist = extractPrimaryArtist(rawArtist);
  if (primRawArtist && primRawArtist.toLowerCase() !== rawArtist.toLowerCase()) {
    add(primRawArtist, rawTitle);
  }

  // 3. Fallback: Search with just the cleaned title if artist might be random uploader
  if (delimMatch) {
    add('', delimMatch[2]);
  } else {
    add('', rawTitle);
  }

  return candidates;
}

/**
 * Removes punctuation, diacritics, and normalizes strings for robust token comparison.
 */
const tidy = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\((?:feat|ft|with)\.?[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[-–—:]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Token overlap (Jaccard similarity).
 */
function similarity(a: string, b: string): number {
  const ta = new Set(tidy(a).split(' ').filter(Boolean));
  const tb = new Set(tidy(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Ranks candidates from lrclib search results.
 */
function rankCandidates(
  wanted: { title: string; artist: string; duration?: number },
  candidates: LrcLibSearchItem[]
): number[] {
  const trackDuration = wanted.duration ?? 0;
  // A reasonable threshold (up to 25s or 18% difference)
  const hardLimit = trackDuration > 0 ? Math.max(25, trackDuration * 0.18) : 0;
  const scored: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const titleSim = similarity(wanted.title, c.trackName);
    if (titleSim < ARTIST_SIMILARITY) continue;

    const artistSim = wanted.artist && c.artistName ? similarity(wanted.artist, c.artistName) : 0;
    let score = titleSim * 0.55 + artistSim * 0.25;

    if (trackDuration && c.duration) {
      const diff = Math.abs(c.duration - trackDuration);
      if (hardLimit > 0 && diff > hardLimit) continue;
      // Close duration gets full score; decaying score beyond 5 seconds
      score *= diff <= 5 ? 1 : Math.max(0.1, 1 / (1 + (diff - 5) / 8));
    }

    // Prefer synced lyrics over plain
    if (c.syncedLyrics) score += 0.2;

    if (score > 0) scored.push({ index: i, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.index);
}

/**
 * Validates that timestamps in synced lyrics fit the track duration.
 */
function fitsTrack(lyrics: Lyrics | null, trackDuration: number): boolean {
  if (!lyrics || !trackDuration || !lyrics.synced || !lyrics.lines.length) return true;
  const last = lyrics.lines[lyrics.lines.length - 1].time;
  return last <= trackDuration + 20;
}

/**
 * Parses LRC formatted string into sorted timestamped lines.
 */
export function parseLrc(raw: string): LyricLine[] {
  const out: LyricLine[] = [];
  const TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const OFFSET = /\[offset:\s*([+-]?\d+)\s*\]/i;
  const offsetMs = Number(raw.match(OFFSET)?.[1] ?? 0);
  const shift = offsetMs / 1000;

  for (const rawLine of raw.split(/\r?\n/)) {
    TAG.lastIndex = 0;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = TAG.exec(rawLine))) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      times.push(min * 60 + sec + frac + shift);
    }
    if (!times.length) continue;

    const text = rawLine.replace(TAG, '').replace(OFFSET, '').trim();
    for (const time of times) out.push({ time, text });
  }

  out.sort((a, b) => a.time - b.time);

  // Collapse duplicate timestamps
  const merged: LyricLine[] = [];
  for (const line of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.time - line.time) < 0.01) {
      if (!last.text && line.text) last.text = line.text;
      continue;
    }
    merged.push(line);
  }

  return merged;
}

/**
 * Binary search to find current active line index for playback position.
 */
export function activeLineIndex(lines: LyricLine[], time: number): number {
  if (!lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function shapeLrcLib(raw: LrcLibResponse): Lyrics | null {
  const lines = raw.syncedLyrics ? parseLrc(raw.syncedLyrics) : [];
  const plain = (raw.plainLyrics ?? '').trim();
  if (!lines.length && !plain && !raw.instrumental) return null;
  return {
    lines,
    plain,
    instrumental: Boolean(raw.instrumental) && !lines.length,
    synced: lines.length > 0,
    source: 'lrclib',
  };
}

/**
 * Attempt exact match against LRCLIB /api/get
 */
async function tryLrcLibGet(artist: string, track: string, duration?: number): Promise<Lyrics | null> {
  const params = new URLSearchParams();
  if (artist) params.set('artist_name', artist);
  params.set('track_name', track);
  if (duration && duration > 0) params.set('duration', String(Math.round(duration)));

  try {
    const res = await fetch(`${LRCLIB_GET}?${params.toString()}`, {
      headers: {
        'User-Agent': APP_USER_AGENT,
        'Lrclib-Client': APP_USER_AGENT,
      },
    });
    if (!res.ok) return null;
    return shapeLrcLib((await res.json()) as LrcLibResponse);
  } catch {
    return null;
  }
}

/**
 * Search LRCLIB using specific query parameters (track_name and artist_name)
 */
async function tryLrcLibSearch(wanted: { title: string; artist: string; duration?: number }): Promise<Lyrics | null> {
  const params = new URLSearchParams();
  if (wanted.title) params.set('track_name', wanted.title);
  if (wanted.artist) params.set('artist_name', wanted.artist);

  // If both empty, fallback to general q
  if (!wanted.title) {
    params.set('q', `${wanted.artist} ${wanted.title}`.trim());
  }

  try {
    const res = await fetch(`${LRCLIB_SEARCH}?${params.toString()}`, {
      headers: {
        'User-Agent': APP_USER_AGENT,
        'Lrclib-Client': APP_USER_AGENT,
      },
    });
    if (!res.ok) return null;
    const list = (await res.json()) as LrcLibSearchItem[];
    if (!Array.isArray(list) || !list.length) return null;

    const ranked = rankCandidates(wanted, list);
    if (!ranked.length) return null;

    let transcript: Lyrics | null = null;
    for (const index of ranked) {
      const hit = list[index];
      const shaped = shapeLrcLib({
        syncedLyrics: hit.syncedLyrics ?? null,
        plainLyrics: hit.plainLyrics ?? null,
        instrumental: hit.instrumental,
      });
      if (!shaped) continue;
      if (shaped.synced) {
        if (fitsTrack(shaped, wanted.duration || 0)) return shaped;
        continue;
      }
      transcript ??= shaped;
    }
    return transcript;
  } catch {
    return null;
  }
}

/**
 * Secondary provider: lyrics.ovh as plain text fallback
 */
async function tryLyricsOvh(artist: string, title: string): Promise<Lyrics | null> {
  if (!artist || !title) return null;
  try {
    const url = `${LYRICS_OVH}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { lyrics?: string };
    const plain = (data.lyrics || '').trim();
    if (!plain) return null;
    return {
      lines: [],
      plain,
      instrumental: false,
      synced: false,
      source: 'lyrics.ovh',
    };
  } catch {
    return null;
  }
}

/** Cache so re-opening a view does not re-hit the network for the same track. */
const cache = new Map<string, Lyrics | null>();

export function cachedLyrics(track: Track): Lyrics | null | undefined {
  return cache.get(track.id);
}

export function rememberLyrics(trackId: string, value: Lyrics | null): void {
  cache.set(trackId, value);
  if (cache.size > 80) cache.delete(cache.keys().next().value as string);
}

/**
 * Main lookup function: tries multiple candidate queries against LRCLIB exact get,
 * LRCLIB parameter search, and lyrics.ovh fallback.
 */
export async function fetchLyrics(track: Track): Promise<Lyrics | null> {
  const candidates = generateCandidateQueries(track);

  // Phase 1: Try exact match on LRCLIB with candidate queries
  for (const c of candidates) {
    if (!c.artist) continue; // /api/get requires both track_name and artist_name
    const found = await tryLrcLibGet(c.artist, c.title, c.duration);
    if (found && fitsTrack(found, track.duration || 0)) {
      return found;
    }
    // Also try without duration constraint in case upload length has slight intro/outro padding
    if (c.duration) {
      const foundNoDur = await tryLrcLibGet(c.artist, c.title);
      if (foundNoDur && fitsTrack(foundNoDur, track.duration || 0)) {
        return foundNoDur;
      }
    }
  }

  // Phase 2: Try LRCLIB search endpoint with top candidates
  for (const c of candidates.slice(0, 3)) {
    const found = await tryLrcLibSearch(c);
    if (found && fitsTrack(found, track.duration || 0)) {
      return found;
    }
  }

  // Phase 3: Secondary provider fallback (lyrics.ovh) for plain text lyrics
  for (const c of candidates) {
    if (c.artist && c.title) {
      const fallback = await tryLyricsOvh(c.artist, c.title);
      if (fallback) return fallback;
    }
  }

  return null;
}
