export interface Track {
  id: string;
  title: string;
  artist: string;
  artistUrl?: string;
  /** Numeric SoundCloud user id of the artist. Needed to open an artist page
   *  without re-resolving the permalink, which can land on a different
   *  same-named account. */
  artistId?: string;
  duration: number;
  durationFormatted: string;
  artwork: string;
  genre: string;
  description?: string;
  album?: string;
  permalinkUrl: string;
  playsCount?: number;
  likesCount?: number;
  repostsCount?: number;
  createdAt?: string;
  isLiked?: boolean;
  streamUrl?: string;
  /**
   * Which catalog this track came from.
   *
   * Everything SoundCloud-vended omits it; Audius tracks are tagged `audius`
   * so the player can skip SoundCloud-only affordances (liking, playlists,
   * artist pages) for material that does not live on SoundCloud.
   */
  source?: 'soundcloud' | 'audius' | 'spotify';
  /**
   * Spotify only: the `spotify:track:...` URI used to start playback on the Web
   * Playback SDK. Present on every Spotify track; undefined elsewhere.
   */
  uri?: string;
  /**
   * SoundCloud only serves a 30 second preview for this track (region or
   * rights restriction). The duration shown is the preview length, so anything
   * presenting this track should say so rather than act as if it ended early.
   */
  previewOnly?: boolean;
  /**
   * Precomputed waveform JSON URL from SoundCloud (used for instant silence trimming).
   */
  waveformUrl?: string;
}

export interface WebProfile {
  id?: number;
  kind?: string;
  network?: string;
  title?: string;
  url: string;
  username?: string;
  service?: string;
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string;
  permalinkUrl: string;
  followersCount: number;
  followingsCount?: number;
  trackCount: number;
  location: string;
  /** ISO date the account was created. Used to sort artists newest-first;
   *  the payload does not always carry it, so it stays optional. */
  createdAt?: string;
  description?: string;
  webProfiles?: WebProfile[];
}

export interface Playlist {
  id: string;
  title: string;
  description: string;
  artwork: string;
  trackCount: number;
  permalinkUrl?: string;
  owner?: User;
  tracks: Track[];
  albums?: Playlist[];
}

/**
 * One horizontal rail of the Discover feed.
 *
 * The feed is a list of these rather than a single list so it can carry several
 * kinds of recommendation at once - taste-derived, per-seed and platform-wide -
 * each labelled with where it came from.
 */
export interface DiscoverSection {
  id: string;
  title: string;
  subtitle?: string;
  /** Seed this rail was derived from, when it is a "because you played" rail. */
  seed?: Track;
  tracks: Track[];
}