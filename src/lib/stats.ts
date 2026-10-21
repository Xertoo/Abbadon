import type { Track } from '../types';

export interface ListeningStats {
  totalPlays: number;
  totalListeningSeconds: number;
  trackCounts: Record<string, { track: Track; count: number; lastPlayed: number }>;
  artistCounts: Record<string, { artist: string; count: number; avatarUrl?: string; artistId?: string; artistUrl?: string }>;
  dailyPlays: Record<string, number>; // "YYYY-MM-DD" -> count
  dailyTrackPlays?: Record<string, Record<string, { track: Track; count: number; lastPlayed: number }>>;
}

const STATS_KEY = 'abbadon:listening_stats';

export function loadListeningStats(): ListeningStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return createEmptyStats();
    const parsed = JSON.parse(raw);
    return {
      totalPlays: Number(parsed.totalPlays) || 0,
      totalListeningSeconds: Number(parsed.totalListeningSeconds) || 0,
      trackCounts: parsed.trackCounts || {},
      artistCounts: parsed.artistCounts || {},
      dailyPlays: parsed.dailyPlays || {},
      dailyTrackPlays: parsed.dailyTrackPlays || {},
    };
  } catch {
    return createEmptyStats();
  }
}

function createEmptyStats(): ListeningStats {
  return {
    totalPlays: 0,
    totalListeningSeconds: 0,
    trackCounts: {},
    artistCounts: {},
    dailyPlays: {},
    dailyTrackPlays: {},
  };
}

export function saveListeningStats(stats: ListeningStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* quota */
  }
}

/**
 * Records a completed play. Called ONLY when a track has been listened to
 * >= 95% of its total duration (or reaches its natural end).
 */
export function recordCompletedPlay(track: Track): ListeningStats {
  const stats = loadListeningStats();
  stats.totalPlays += 1;
  const dur = Math.max(1, Math.round(track.duration || 180));
  stats.totalListeningSeconds += dur;

  // Track counts
  const prevTrack = stats.trackCounts[track.id];
  stats.trackCounts[track.id] = {
    track,
    count: (prevTrack?.count || 0) + 1,
    lastPlayed: Date.now(),
  };

  // Artist counts
  const artistName = track.artist.trim();
  if (artistName) {
    const prevArtist = stats.artistCounts[artistName];
    stats.artistCounts[artistName] = {
      artist: artistName,
      count: (prevArtist?.count || 0) + 1,
      avatarUrl: track.artwork || prevArtist?.avatarUrl,
      artistId: track.artistId || prevArtist?.artistId,
      artistUrl: track.artistUrl || prevArtist?.artistUrl,
    };
  }

  // Daily activity
  const today = new Date().toISOString().slice(0, 10);
  stats.dailyPlays[today] = (stats.dailyPlays[today] || 0) + 1;

  if (!stats.dailyTrackPlays) {
    stats.dailyTrackPlays = {};
  }
  if (!stats.dailyTrackPlays[today]) {
    stats.dailyTrackPlays[today] = {};
  }
  const prevDailyTrack = stats.dailyTrackPlays[today][track.id];
  stats.dailyTrackPlays[today][track.id] = {
    track,
    count: (prevDailyTrack?.count || 0) + 1,
    lastPlayed: Date.now(),
  };

  saveListeningStats(stats);
  return stats;
}

/**
 * Returns the tracks played on a given day (dateIso format "YYYY-MM-DD")
 * sorted by play count descending.
 */
export function getTracksForDay(
  stats: ListeningStats,
  dateIso: string
): { track: Track; count: number; lastPlayed: number }[] {
  if (stats.dailyTrackPlays && stats.dailyTrackPlays[dateIso]) {
    const list = Object.values(stats.dailyTrackPlays[dateIso]);
    if (list.length > 0) {
      return list.sort((a, b) => b.count - a.count || b.lastPlayed - a.lastPlayed);
    }
  }

  // Fallback 1: match tracks from trackCounts whose lastPlayed was on dateIso
  const matchedFromTrackCounts = Object.values(stats.trackCounts || {}).filter((item) => {
    try {
      return new Date(item.lastPlayed).toISOString().slice(0, 10) === dateIso;
    } catch {
      return false;
    }
  });
  if (matchedFromTrackCounts.length > 0) {
    return matchedFromTrackCounts.sort((a, b) => b.count - a.count || b.lastPlayed - a.lastPlayed);
  }

  // Fallback 2: if dateIso is today, check recent playback history in localStorage ('sc9000:history')
  const today = new Date().toISOString().slice(0, 10);
  if (dateIso === today) {
    try {
      const raw = localStorage.getItem('sc9000:history');
      if (raw) {
        const hist: Track[] = JSON.parse(raw);
        if (Array.isArray(hist) && hist.length > 0) {
          const counts: Record<string, { track: Track; count: number; lastPlayed: number }> = {};
          hist.forEach((t, i) => {
            if (!counts[t.id]) {
              const knownCount = stats.trackCounts?.[t.id]?.count || 1;
              counts[t.id] = { track: t, count: knownCount, lastPlayed: Date.now() - i * 1000 };
            }
          });
          return Object.values(counts).sort((a, b) => b.count - a.count);
        }
      }
    } catch {
      /* ignore */
    }
  }

  return [];
}

export function getTopTracks(stats: ListeningStats, limit = 10): { track: Track; count: number }[] {
  return Object.values(stats.trackCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function getTopArtists(
  stats: ListeningStats,
  limit = 10
): { artist: string; count: number; avatarUrl?: string; artistId?: string; artistUrl?: string }[] {
  return Object.values(stats.artistCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

const FRIEND_ARTISTS_KEY = 'abbadon:friend_artists:';
const FRIEND_TRACKS_KEY = 'abbadon:friend_tracks:';

export interface FriendTrackEntry {
  track: Track;
  count: number;
  lastPlayed: number;
}

export function recordFriendTrack(friendCode: string, track: Track): void {
  if (!friendCode || !track || !track.artist) return;
  try {
    const key = `${FRIEND_ARTISTS_KEY}${friendCode}`;
    const raw = localStorage.getItem(key);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const artist = track.artist.trim();
    if (artist && !list.some((a) => a.toLowerCase() === artist.toLowerCase())) {
      list.push(artist);
      localStorage.setItem(key, JSON.stringify(list.slice(-50)));
    }
  } catch {
    /* quota */
  }

  // Also record track entry
  try {
    const tKey = `${FRIEND_TRACKS_KEY}${friendCode}`;
    const rawT = localStorage.getItem(tKey);
    const map: Record<string, FriendTrackEntry> = rawT ? JSON.parse(rawT) : {};
    const tId = String(track.id);
    const existing = map[tId];
    map[tId] = {
      track,
      count: (existing?.count || 0) + 1,
      lastPlayed: Date.now(),
    };
    const entries = Object.values(map)
      .sort((a, b) => b.lastPlayed - a.lastPlayed)
      .slice(0, 50);
    const nextMap: Record<string, FriendTrackEntry> = {};
    for (const e of entries) {
      nextMap[String(e.track.id)] = e;
    }
    localStorage.setItem(tKey, JSON.stringify(nextMap));
  } catch {
    /* quota */
  }
}

export function getFriendObservedTracks(friendCode: string): FriendTrackEntry[] {
  if (!friendCode) return [];
  try {
    const key = `${FRIEND_TRACKS_KEY}${friendCode}`;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const map: Record<string, FriendTrackEntry> = JSON.parse(raw);
    return Object.values(map).sort((a, b) => b.count - a.count || b.lastPlayed - a.lastPlayed);
  } catch {
    return [];
  }
}

export function getFriendObservedArtists(friendCode: string): string[] {
  if (!friendCode) return [];
  try {
    const key = `${FRIEND_ARTISTS_KEY}${friendCode}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export interface CompatibilityResult {
  score: number; // 0 - 100%
  sharedArtists: string[];
  sharedTracks: string[];
}

/**
 * Compares your music taste with a friend based on genuinely observed top artists and tracks.
 * Never fabricates or estimates artists the friend hasn't actually listened to.
 */
export function compareMusicTaste(
  myStats: ListeningStats,
  friendTopArtists: string[] = [],
  friendTopTracks: string[] = []
): CompatibilityResult {
  const myArtists = Object.keys(myStats.artistCounts).map((a) => a.toLowerCase());
  const myTracks = Object.values(myStats.trackCounts).map((t) => t.track.title.toLowerCase());

  const sharedArtists: string[] = [];
  friendTopArtists.forEach((fa) => {
    const faClean = fa.trim();
    if (myArtists.includes(faClean.toLowerCase()) && !sharedArtists.some((sa) => sa.toLowerCase() === faClean.toLowerCase())) {
      sharedArtists.push(faClean);
    }
  });

  const sharedTracks: string[] = [];
  friendTopTracks.forEach((ft) => {
    const ftClean = ft.trim().toLowerCase();
    if (myTracks.some((mt) => mt === ftClean || mt.includes(ftClean) || ftClean.includes(mt))) {
      sharedTracks.push(ft.trim());
    }
  });

  if (friendTopArtists.length === 0 && friendTopTracks.length === 0) {
    return {
      score: 0,
      sharedArtists: [],
      sharedTracks: [],
    };
  }

  // Calculate compatibility score from real overlap only
  let score = 0;
  if (friendTopArtists.length > 0) {
    const artistMatchRatio = sharedArtists.length / friendTopArtists.length;
    score += Math.round(artistMatchRatio * 65);
  }
  if (friendTopTracks.length > 0) {
    const trackMatchRatio = sharedTracks.length / friendTopTracks.length;
    score += Math.round(trackMatchRatio * 35);
  }

  score = Math.min(100, Math.max(0, score));

  return {
    score,
    sharedArtists,
    sharedTracks,
  };
}
