/**
 * Audius API client (https://audius.co).
 *
 * Audius serves its catalog over an open discovery provider: search and
 * trending endpoints return tracks with a signed stream URL already attached,
 * which is why every result here is directly playable - no second resolve, no
 * format ladder. Tracks are namespaced `audius:<id>` so a queue can hold
 * material from both catalogs at once.
 */

import type { Track } from '../types';
import { fmtTime } from './soundcloud';

export const AUDIUS_SITE = 'https://audius.co';
export const AUDIUS_DISCOVERY = 'https://discoveryprovider.audius.co';
export const AUDIUS_APP_NAME = 'Abbadon';

/** Backends the "Music source" setting can point the player at. */
export const MUSIC_SOURCES = ['soundcloud', 'audius'] as const;
export type MusicSource = (typeof MUSIC_SOURCES)[number];

export function isSoundCloudTrack(t: Track): boolean {
  return (t.source ?? 'soundcloud') === 'soundcloud';
}

interface AudiusUser {
  name?: string;
  handle?: string;
  id?: string;
}

interface AudiusTrackPayload {
  id: string;
  title?: string;
  duration?: number;
  genre?: string;
  play_count?: number;
  favorite_count?: number;
  repost_count?: number;
  permalink?: string;
  artwork?: { '1000x1000'?: string; '480x480'?: string; '150x150'?: string };
  user?: AudiusUser;
  stream?: { url?: string };
}

const SEARCH_LIMIT = 40;
const TRENDING_LIMIT = 50;

async function fetchPayload(url: string): Promise<AudiusTrackPayload[]> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Audius responded with ${res.status}`);
  const body = (await res.json().catch(() => null)) as { data?: AudiusTrackPayload[] } | null;
  return Array.isArray(body?.data) ? body.data : [];
}

function mapAudiusTrack(t: AudiusTrackPayload): Track {
  // Artistic picks: 480 is the resolution the cover grid uses everywhere.
  const artwork =
    t.artwork?.['480x480'] ?? t.artwork?.['1000x1000'] ?? t.artwork?.['150x150'] ?? '';
  return {
    id: `audius:${t.id}`,
    title: t.title && t.title.length > 0 ? t.title : 'Untitled track',
    artist: t.user?.name ?? t.user?.handle ?? 'Unknown artist',
    duration: t.duration ?? 0,
    durationFormatted: fmtTime(t.duration ?? 0),
    artwork,
    genre: t.genre ?? '',
    permalinkUrl: t.permalink ? `${AUDIUS_SITE}${t.permalink}` : AUDIUS_SITE,
    playsCount: t.play_count ?? 0,
    likesCount: t.favorite_count ?? 0,
    streamUrl: t.stream?.url,
    source: 'audius',
  };
}

export async function searchAudius(query: string, limit: number = SEARCH_LIMIT): Promise<Track[]> {
  const url = `${AUDIUS_DISCOVERY}/v1/tracks/search?query=${encodeURIComponent(
    query
  )}&app_name=${AUDIUS_APP_NAME}&limit=${limit}`;
  return (await fetchPayload(url)).map(mapAudiusTrack);
}

export async function trendingAudius(limit: number = TRENDING_LIMIT): Promise<Track[]> {
  const url = `${AUDIUS_DISCOVERY}/v1/tracks/trending?app_name=${AUDIUS_APP_NAME}&limit=${limit}`;
  return (await fetchPayload(url)).map(mapAudiusTrack);
}