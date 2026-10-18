/**
 * Automatic lyric lookup.
 *
 * SoundCloud has no lyrics on its API, so this goes to lrclib - a free,
 * key-less, CORS-enabled lyrics database that serves both plain text and
 * time-stamped LRC. `fetch` is used directly rather than the Electron relay
 * because that relay exists only to carry SoundCloud cookies past the file://
 * origin, and lrclib needs neither cookies nor a client_id.
 */

import type { Track } from '../types';

const LRCLIB = 'https://lrclib.net/api/get';
/** A match this bad is noise, not a result. */
const ARTIST_SIMILARITY = 0.6;

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
}

interface LrcLibResponse {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

const strip = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** "Artist - Title" / "Artist: Title" / "Artist – Title" into its two halves. */
function splitTitle(raw: string): { artist: string; title: string } {
  const m = raw.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: raw.replace(/\s*\((official video|lyrics?|audio|hd|hq)\)\s*$/i, '').trim() };
}

/**
 * Removes the decorations that make titles differ between sites without
 * changing the song: bracketed qualifiers, trailing features, punctuation.
 */
const tidy = (s: string) =>
  s
    .replace(/\((?:feat|ft|with)\.?[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Token overlap between two titles.
 *
 * Jaccard rather than a substring test: "Run" is a substring of "Runner", which
 * made a wrong match look right. Both sides are tidied first so "(Remix)" and
 * punctuation cannot decide the result on their own.
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
 * Picks the best candidate, by index.
 *
 * Title has to match; the artist only breaks ties, because a lot of uploads are
 * credited to nobody and would otherwise fail on an artist comparison alone.
 *
 * Length is what decides the rest. This database holds a live take, a remix and a
 * radio edit under the same title, each with its own perfectly valid LRC, and
 * picking the wrong one is exactly what makes lyrics look "out of sync" against
 * audio that was never going to match it. So a candidate whose length disagrees
 * with the track is thrown out rather than ranked down, and among the survivors
 * the closest length wins, preferring one that has timestamps at all.
 *
 * The index is returned rather than the object because duplicates exist here, and
 * finding the row again by title+artist afterwards picks the first of them, not
 * the one that was scored.
 */
function rankCandidates<T extends {
  title: string;
  artist: string;
  duration?: number;
  hasSynced?: boolean;
}>(
  wanted: { title: string; artist: string; duration?: number },
  candidates: T[]
): number[] {
  const trackDuration = wanted.duration ?? 0;
  // Beyond this the two files are not the same recording, so no amount of title
  // agreement makes their timestamps comparable. A slow tempo or a fade-out can
  // account for a few percent on a legitimate match.
  const hardLimit = Math.max(20, trackDuration * 0.15);
  const scored: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const title = similarity(wanted.title, c.title);
    if (title < ARTIST_SIMILARITY) continue;
    const artist = wanted.artist && c.artist ? similarity(wanted.artist, c.artist) : 0;
    let score = title * 0.5 + artist * 0.15;

    if (trackDuration && c.duration) {
      const diff = Math.abs(c.duration - trackDuration);
      if (diff > hardLimit) continue;
      // Within 4s is two players reporting the same file; beyond that the score
      // falls away fast so a close title cannot outvote a close length.
      score *= diff <= 4 ? 1 : Math.max(0.05, 1 / (1 + (diff - 4) / 6));
    }

    // A synced copy beats a bare transcript at equal title, artist and length.
    if (c.hasSynced) score += 0.12;

    if (score > 0) scored.push({ index: i, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.index);
}

/**
 * Rejects an LRC that cannot belong to this audio.
 *
 * Two things give it away. Timestamps that run past the end of the track mean
 * the file was typed against a longer recording, so every line is shifted by
 * however much longer that was. Timestamps that all sit in the first few seconds
 * mean the parse found a fragment rather than a song.
 */
function fitsTrack(lyrics: Lyrics | null, trackDuration: number): boolean {
  if (!lyrics || !trackDuration || !lyrics.synced || !lyrics.lines.length) return true;
  const last = lyrics.lines[lyrics.lines.length - 1].time;
  return last <= trackDuration + 15;
}

/**
 * Parses LRC into sorted, de-duplicated lines.
 *
 * `[mm:ss.xx]` and the extended `[mm:ss.xxx]` both appear in the wild, and some
 * files put several tags on one line, so both forms are read. Lines that share a
 * timestamp are merged rather than kept, because the database emits an empty
 * line and the first word of the chorus at the same time and the view would
 * flicker between them.
 */
export function parseLrc(raw: string): LyricLine[] {
  const out: LyricLine[] = [];
  const TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  // Global shift carried by the file itself. lrclib mostly omits it, but when it
  // is present the whole file is wrong by that much and ignoring it looks like
  // random drift rather than a constant error.
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
      // Two digits are hundredths, three are milliseconds.
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      times.push(min * 60 + sec + frac + shift);
    }
    if (!times.length) continue;

    const text = rawLine.replace(TAG, '').replace(OFFSET, '').trim();
    for (const time of times) out.push({ time, text });
  }

  out.sort((a, b) => a.time - b.time);

  // Collapse a repeated timestamp, keeping whichever line actually has words.
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

/** Index of the line that should be highlighted at `time`, or -1 before the first. */
export function activeLineIndex(lines: LyricLine[], time: number): number {
  if (!lines.length) return -1;
  // Binary search: the view re-runs this on every timeupdate tick.
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

interface TrackQuery {
  artist_name?: string;
  track_name: string;
  album_name?: string;
  duration?: number;
}

/**
 * Looks the lyrics up, trying progressively looser queries.
 *
 * lrclib answers 404 on any field it cannot match, so the search endpoint is used
 * first and the exact `get` endpoint only as a fallback for a full album + exact
 * duration match. Failing that, the plain track title on its own - which finds
 * the instrumental/typo uploads far more often than not.
 */
export async function fetchLyrics(track: Track): Promise<Lyrics | null> {
  const fromTitle = splitTitle(track.title);
  const wanted = {
    title: fromTitle.title || track.title,
    artist: fromTitle.artist || track.artist,
  };

  const queries: TrackQuery[] = [
    {
      artist_name: wanted.artist,
      track_name: wanted.title,
      album_name: track.genre && track.genre !== 'SoundCloud' ? track.genre : undefined,
      duration: track.duration || undefined,
    },
    { artist_name: wanted.artist, track_name: wanted.title },
    { track_name: wanted.title },
  ];

  for (const q of queries) {
    const found = await tryGet(q);
    // A hit that runs past the end of the track is a longer recording under the
    // same name. Skipping it here rather than accepting it is what stops the
    // highlight from drifting further and further behind as the song plays.
    if (found && fitsTrack(found, track.duration || 0)) return found;
  }

  // Nothing exact: fall back to a search and let pickBest judge the results.
  const params = new URLSearchParams({ q: `${wanted.artist} ${wanted.title}`.trim() });
  try {
    const res = await fetch(`https://lrclib.net/api/search?${params.toString()}`);
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{
      trackName: string;
      artistName: string;
      albumName?: string;
      instrumental?: boolean;
      duration?: number;
      syncedLyrics?: string;
      plainLyrics?: string;
    }>;
    const ranked = rankCandidates(
      {
        title: wanted.title,
        artist: wanted.artist,
        duration: track.duration || undefined,
      },
      list.map((c) => ({
        title: c.trackName,
        artist: c.artistName,
        duration: c.duration,
        hasSynced: Boolean(c.syncedLyrics),
      }))
    );
    if (!ranked.length) return null;

    // Best fit first, but a candidate whose timestamps run past the end of the
    // audio is skipped in favour of the next one - the ranking judges names and
    // lengths, and only the timestamps themselves prove a mismatch.
    let transcript: Lyrics | null = null;
    for (const index of ranked) {
      const hit = list[index];
      const shaped = shape({
        syncedLyrics: hit.syncedLyrics ?? null,
        plainLyrics: hit.plainLyrics ?? null,
        instrumental: hit.instrumental,
      });
      if (!shaped) continue;
      if (shaped.synced) {
        if (fitsTrack(shaped, track.duration || 0)) return shaped;
        continue;
      }
      // Keep the first untimed copy as a last resort: a transcript is better
      // than nothing, and it cannot be out of sync because it has no times.
      transcript ??= shaped;
    }
    return transcript;
  } catch {
    return null;
  }
}

/** One exact-match attempt. 404 is an expected answer, not a failure. */
async function tryGet(q: TrackQuery): Promise<Lyrics | null> {
  const params = new URLSearchParams();
  if (q.artist_name) params.set('artist_name', q.artist_name);
  params.set('track_name', q.track_name);
  if (q.album_name) params.set('album_name', q.album_name);
  if (q.duration) params.set('duration', String(Math.round(q.duration)));

  try {
    const res = await fetch(`${LRCLIB}?${params.toString()}`);
    if (!res.ok) return null;
    return shape((await res.json()) as LrcLibResponse);
  } catch {
    return null;
  }
}

function shape(raw: LrcLibResponse): Lyrics | null {
  const lines = raw.syncedLyrics ? parseLrc(raw.syncedLyrics) : [];
  const plain = (raw.plainLyrics ?? '').trim();
  // An instrumental is a real answer, but an empty record is not.
  if (!lines.length && !plain && !raw.instrumental) return null;
  return {
    lines,
    plain,
    instrumental: Boolean(raw.instrumental) && !lines.length,
    synced: lines.length > 0,
  };
}

/** Cache so re-opening a view does not re-hit the network for the same track. */
const cache = new Map<string, Lyrics | null>();

export function cachedLyrics(track: Track): Lyrics | null | undefined {
  return cache.get(track.id);
}

export function rememberLyrics(trackId: string, value: Lyrics | null): void {
  cache.set(trackId, value);
  // The panel is opened on artist pages too, so the map has to stay bounded.
  if (cache.size > 60) cache.delete(cache.keys().next().value as string);
}
