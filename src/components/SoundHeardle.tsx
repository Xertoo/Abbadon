import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Trophy,
  Flame,
  Volume2,
  Volume1,
  VolumeX,
  Music,
  ChevronDown,
  X,
  Search,
  Sparkles,
  ListMusic,
  Heart,
  Loader2,
  Gamepad2,
  Mic2,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import type { Playlist, Track, User } from '../types';
import { sc, mapTrack, mapUser, type ScUser } from '../lib/soundcloud';
import { getAudibleStartTime } from '../lib/audioBeatDetector';

// Progression intervals in seconds (ensuring audible snippets)
export const HEARDLE_STAGES = [0.5, 1.0, 2.0, 4.0, 7.0, 12.0];
const MAX_ATTEMPTS = HEARDLE_STAGES.length; // 6 attempts

interface SoundHeardleProps {
  isOpen: boolean;
  onClose: () => void;
  likedTracks: Track[];
  playlists: Playlist[];
  resolvePlayable: (track: Track) => Promise<string | null>;
  onPlayFullTrack: (track: Track) => void;
}

interface GuessEntry {
  type: 'correct' | 'wrong' | 'skipped';
  guessedTrack?: Track;
  durationLabel: string;
}

/** Relative widths of the six snippet stages; the later ones are worth more. */
const STAGE_FLEX = [0.5, 1.0, 1.5, 2.5, 4.0, 6.0];

/**
 * The segmented snippet bar.
 *
 * The fill is written straight onto the DOM on every animation frame, reading
 * `currentTime` from the audio element. Going through React state instead meant
 * a re-render per frame of the entire modal around it, and those dropped frames
 * are exactly what made the bar look like it was jumping rather than sliding.
 *
 * There is deliberately no CSS transition on the fill either: the loop is already
 * frame-synced, and a transition would only add a frame of lag behind the audio.
 * The segments themselves still transition, because unlocking one is a state
 * change that should ease.
 */
function SnippetProgress({
  audioRef,
  stages,
  unlockedIndex,
  gameOver,
  isPlaying,
  snippetStartOffset,
}: {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  stages: number[];
  unlockedIndex: number;
  gameOver: boolean;
  isPlaying: boolean;
  snippetStartOffset: number;
}) {
  const fills = useRef<Array<HTMLDivElement | null>>([]);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      if (frame.current) cancelAnimationFrame(frame.current);
      // Park the fills at the stage the audio is currently on rather than at
      // zero, so pausing mid-snippet does not look like a reset.
      const a = audioRef.current;
      const elapsed = a ? Math.max(0, a.currentTime - snippetStartOffset) : 0;
      fills.current.forEach((el, i) => {
        if (!el) return;
        const start = stages[i - 1] ?? 0;
        const span = stages[i] - start;
        const pct = Math.min(100, Math.max(0, ((elapsed - start) / span) * 100));
        el.style.width = `${pct}%`;
      });
      return;
    }

    const tick = () => {
      const a = audioRef.current;
      if (a) {
        const elapsed = Math.max(0, a.currentTime - snippetStartOffset);
        for (let i = 0; i < stages.length; i++) {
          const el = fills.current[i];
          if (!el) continue;
          const start = stages[i - 1] ?? 0;
          const span = stages[i] - start;
          el.style.width = `${Math.min(100, Math.max(0, ((elapsed - start) / span) * 100))}%`;
        }
      }
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [isPlaying, stages, snippetStartOffset, audioRef]);

  return (
    <div className="relative h-3 w-full bg-white/10 rounded-full overflow-hidden flex gap-0.5 p-0.5">
      {stages.map((dur, idx) => {
        const isUnlocked = gameOver || idx <= unlockedIndex;
        return (
          <div
            key={dur}
            className={clsx(
              'h-full rounded-sm transition-colors duration-300 relative',
              isUnlocked ? 'bg-sc-orange' : 'bg-white/15'
            )}
            style={{ flex: STAGE_FLEX[idx] ?? 1 }}
          >
            {isUnlocked && (
              <div
                ref={(el) => {
                  fills.current[idx] = el;
                }}
                className="absolute inset-y-0 left-0 w-0 bg-white shadow-[0_0_8px_white]"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface HeardleStats {
  played: number;
  won: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: number[]; // index 0..5 count
}

const STATS_KEY = 'sc9000:heardleStats';
const VOLUME_KEY = 'sc9000:heardleVolume';
const MUTED_KEY = 'sc9000:heardleMuted';

function loadStats(): HeardleStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {
    played: 0,
    won: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: [0, 0, 0, 0, 0, 0],
  };
}

function saveStats(stats: HeardleStats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}

export function SoundHeardle({
  isOpen,
  onClose,
  likedTracks,
  playlists,
  resolvePlayable,
  onPlayFullTrack,
}: SoundHeardleProps) {
  // Source selection: 'trending' | 'liked' | playlistId | 'artist'
  const [selectedSource, setSelectedSource] = useState<string>(() =>
    likedTracks && likedTracks.length >= 2 ? 'liked' : 'trending'
  );
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [sourceTracks, setSourceTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);

  // Artist mode state
  const [selectedArtist, setSelectedArtist] = useState<{
    id?: string;
    name: string;
    avatarUrl?: string;
  } | null>(null);
  const [artistModalOpen, setArtistModalOpen] = useState(false);
  const [artistSearchQuery, setArtistSearchQuery] = useState('');
  const [artistSearchResults, setArtistSearchResults] = useState<User[]>([]);
  const [searchingArtists, setSearchingArtists] = useState(false);

  // Volume state
  const [volume, setVolume] = useState<number>(() => {
    const v = localStorage.getItem(VOLUME_KEY);
    return v !== null ? Math.max(0, Math.min(1, Number(v))) : 0.45; // default 45% (comfortable)
  });
  const [muted, setMuted] = useState<boolean>(() => {
    return localStorage.getItem(MUTED_KEY) === 'true';
  });

  // Game round state
  const [secretTrack, setSecretTrack] = useState<Track | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);

  // Guesses
  const [guesses, setGuesses] = useState<GuessEntry[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [isWon, setIsWon] = useState(false);

  // Search input for guessing
  const [searchQuery, setSearchQuery] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Audio snippet player state
  const [isPlayingSnippet, setIsPlayingSnippet] = useState(false);
  /**
   * Elapsed seconds for the read-out, updated about ten times a second.
   *
   * It used to be written on every animation frame, which re-rendered the whole
   * modal - the guess list, the source dropdown, the volume control - sixty times
   * a second, and the dropped frames showed up as the progress bar stuttering.
   * The bar itself now writes to the DOM directly; this is only the number.
   */
  const [elapsedLabel, setElapsedLabel] = useState(0);
  const [snippetStartOffset, setSnippetStartOffset] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const labelStampRef = useRef(0);

  // Statistics
  const [stats, setStats] = useState<HeardleStats>(loadStats);

  // Determine current max allowed duration
  const currentStageIndex = Math.min(guesses.length, MAX_ATTEMPTS - 1);
  const currentAllowedDuration = HEARDLE_STAGES[currentStageIndex];

  // Apply volume changes to HTMLAudioElement
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (muted && newVol > 0) setMuted(false);
    try {
      localStorage.setItem(VOLUME_KEY, String(newVol));
    } catch {
      /* ignore */
    }
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem(MUTED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Top artists from library likes for fast selection
  const topArtistsFromLikes = useMemo(() => {
    const map = new Map<string, { name: string; count: number; avatar?: string }>();
    for (const t of likedTracks) {
      if (!t.artist) continue;
      const cur = map.get(t.artist);
      if (cur) {
        cur.count++;
      } else {
        map.set(t.artist, { name: t.artist, count: 1, avatar: t.artwork });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  }, [likedTracks]);

  // Search artists live with debounce
  useEffect(() => {
    if (!artistModalOpen) return;
    const q = artistSearchQuery.trim();
    if (q.length < 2) {
      setArtistSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setSearchingArtists(true);
      sc.search(q, 'users', 8)
        .then((res) => {
          const users = res.collection.map((u) => mapUser(u as ScUser));
          setArtistSearchResults(users);
        })
        .catch(() => {
          setArtistSearchResults([]);
        })
        .finally(() => {
          setSearchingArtists(false);
        });
    }, 280);

    return () => clearTimeout(timer);
  }, [artistModalOpen, artistSearchQuery]);

  // 1. Start a new round with a random track from given pool
  const startNewRound = useCallback(
    async (pool?: Track[]) => {
      const targetPool = pool || sourceTracks;
      const available = targetPool.filter((t) => t.duration > 15);
      if (available.length === 0) return;

      // Stop previous audio immediately
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = '';
      }

      setGuesses([]);
      setGameOver(false);
      setIsWon(false);
      setSearchQuery('');
      setElapsedLabel(0);
      setIsPlayingSnippet(false);
      setSnippetStartOffset(0);

      setLoadingAudio(true);
      try {
        const tried = new Set<number>();
        let chosenTrack: Track | null = null;
        let url: string | null = null;
        let audibleOffset = 0;

        // Try up to 4 candidates in case some have unavailable or dead streams
        for (let i = 0; i < Math.min(4, available.length); i++) {
          let randIdx = Math.floor(Math.random() * available.length);
          while (tried.has(randIdx) && tried.size < available.length) {
            randIdx = (randIdx + 1) % available.length;
          }
          tried.add(randIdx);
          const candidate = available[randIdx];

          const resolved = await resolvePlayable(candidate);
          if (resolved) {
            chosenTrack = candidate;
            url = resolved;
            try {
              audibleOffset = await getAudibleStartTime(candidate.id, resolved, candidate.duration);
            } catch {
              audibleOffset = 0;
            }
            break;
          }
        }

        if (chosenTrack && url) {
          setSecretTrack(chosenTrack);
          setStreamUrl(url);
          setSnippetStartOffset(audibleOffset);
          if (audioRef.current) {
            audioRef.current.src = url;
            audioRef.current.volume = muted ? 0 : volume;
            audioRef.current.currentTime = audibleOffset;
            audioRef.current.load();
          }
        } else {
          setSecretTrack(null);
          setStreamUrl(null);
        }
      } catch {
        setSecretTrack(null);
        setStreamUrl(null);
      } finally {
        setLoadingAudio(false);
      }
    },
    [sourceTracks, resolvePlayable, volume, muted]
  );

  // 2. Centralized, atomic source switcher - guarantees synchronization!
  const changeSource = useCallback(
    async (
      source: 'liked' | string,
      artistUser?: { id?: string; name: string; avatarUrl?: string }
    ) => {
      setSelectedSource(source);
      setSourceDropdownOpen(false);
      setLoadingTracks(true);

      // Stop current playback & reset round immediately to avoid playing old song
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = '';
      }
      setIsPlayingSnippet(false);
      setStreamUrl(null);
      setSecretTrack(null);
      setGuesses([]);
      setGameOver(false);
      setIsWon(false);
      setSearchQuery('');
      setElapsedLabel(0);

      let tracks: Track[] = [];

      try {
        if (source === 'trending') {
          setSelectedArtist(null);
          const res = await sc.searchTracks('popular electronic pop dance hits', 60);
          tracks = res.collection.map(mapTrack).filter((t) => t.duration > 15);
        } else if (source === 'liked') {
          setSelectedArtist(null);
          if (likedTracks.length >= 2) {
            tracks = likedTracks;
          } else {
            // Auto fallback for new users with no likes
            setSelectedSource('trending');
            const res = await sc.searchTracks('popular electronic pop dance hits', 60);
            tracks = res.collection.map(mapTrack).filter((t) => t.duration > 15);
          }
        } else if (source === 'artist') {
          if (artistUser) {
            setSelectedArtist(artistUser);
            if (artistUser.id) {
              // Fetch entire artist discography: paginated uploads (up to 400 tracks) plus albums & EPs
              const [allTracksRes, playlistsRes] = await Promise.allSettled([
                sc.userTracksAll(artistUser.id, artistUser.name, 400),
                sc.userPlaylists(artistUser.id, 40),
              ]);

              const trackMap = new Map<number | string, Track>();

              if (allTracksRes.status === 'fulfilled' && Array.isArray(allTracksRes.value)) {
                for (const t of allTracksRes.value) {
                  if (t?.id && t.duration && t.duration > 15000) {
                    trackMap.set(t.id, mapTrack(t));
                  }
                }
              }

              if (playlistsRes.status === 'fulfilled' && playlistsRes.value?.collection) {
                for (const pl of playlistsRes.value.collection) {
                  for (const pt of pl.tracks ?? []) {
                    const rawTrack = pt as unknown as { id?: number | string; title?: string; duration?: number };
                    if (rawTrack?.id && rawTrack.title && (rawTrack.duration ?? 0) > 15000 && !trackMap.has(rawTrack.id)) {
                      trackMap.set(rawTrack.id, mapTrack(pt as any));
                    }
                  }
                }
              }

              tracks = Array.from(trackMap.values());
            } else {
              tracks = likedTracks.filter(
                (t) => t.artist.toLowerCase() === artistUser.name.toLowerCase() && t.duration > 15
              );
            }
            if (tracks.length === 0) {
              const searched = await sc.searchTracks(artistUser.name, 50);
              tracks = searched.collection.map(mapTrack).filter((t) => t.duration > 15);
            }
          }
        } else {
          // Playlist by ID
          setSelectedArtist(null);
          const pl = playlists.find((p) => p.id === source);
          if (pl) {
            if (pl.tracks && pl.tracks.length > 0) {
              tracks = pl.tracks;
            } else {
              const res = await sc.playlistTracks(pl.id, 200);
              tracks = res.collection.map(mapTrack);
            }
          }
        }
      } catch {
        tracks = [];
      } finally {
        setLoadingTracks(false);
      }

      setSourceTracks(tracks);
      if (tracks.length >= 2) {
        void startNewRound(tracks);
      }
    },
    [likedTracks, playlists, startNewRound]
  );

  // Initialize first game round when opened
  useEffect(() => {
    if (isOpen && sourceTracks.length === 0) {
      void changeSource(selectedSource);
    }
  }, [isOpen, sourceTracks.length, selectedSource, changeSource]);

  // Handler to pick an artist from search
  const handleSelectArtist = useCallback(
    (artistName: string, artistId?: string, avatarUrl?: string) => {
      setArtistModalOpen(false);
      void changeSource('artist', { id: artistId, name: artistName, avatarUrl });
    },
    [changeSource]
  );

  // Snippet Playback Controller
  const togglePlaySnippet = useCallback(() => {
    const a = audioRef.current;
    if (!a || !streamUrl) return;

    if (isPlayingSnippet) {
      a.pause();
      setIsPlayingSnippet(false);
      a.currentTime = snippetStartOffset;
      setElapsedLabel(0);
    } else {
      a.volume = muted ? 0 : volume;
      a.currentTime = snippetStartOffset;
      setElapsedLabel(0);

      // Start playing snippet from audible start point
      void a
        .play()
        .then(() => {
          setIsPlayingSnippet(true);
        })
        .catch((err) => {
          console.warn('[SoundHeardle] Play snippet error:', err);
          setIsPlayingSnippet(false);
        });
    }
  }, [isPlayingSnippet, streamUrl, volume, muted, snippetStartOffset]);

  // Monitor snippet currentTime and stop strictly at currentAllowedDuration
  useEffect(() => {
    if (!isPlayingSnippet) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const checkTime = () => {
      const a = audioRef.current;
      if (a && isPlayingSnippet) {
        const cur = a.currentTime;
        // Calculate played duration relative to audible snippet start
        const elapsed = Math.max(0, cur - snippetStartOffset);

        // The read-out only needs one decimal, so writing it ten times a second
        // is indistinguishable and a fraction of the work.
        const now = performance.now();
        if (now - labelStampRef.current > 100) {
          labelStampRef.current = now;
          setElapsedLabel(elapsed);
        }

        const limit = gameOver ? 15.0 : currentAllowedDuration;
        // Only stop if the audio has actually reached or exceeded snippetStartOffset + limit
        if (cur >= snippetStartOffset + limit) {
          a.pause();
          a.currentTime = snippetStartOffset;
          setElapsedLabel(0);
          setIsPlayingSnippet(false);
          return;
        }
      }
      animFrameRef.current = requestAnimationFrame(checkTime);
    };

    animFrameRef.current = requestAnimationFrame(checkTime);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlayingSnippet, currentAllowedDuration, gameOver, snippetStartOffset]);

  // Stop audio on unmount or modal close
  useEffect(() => {
    if (!isOpen && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlayingSnippet(false);
    }
  }, [isOpen]);

  // Finish round handler (win or lose)
  const finishGame = useCallback(
    (won: boolean, totalAttempts: number) => {
      setGameOver(true);
      setIsWon(won);
      setIsPlayingSnippet(false);
      if (audioRef.current) audioRef.current.pause();

      setStats((prev) => {
        const next: HeardleStats = {
          played: prev.played + 1,
          won: prev.won + (won ? 1 : 0),
          currentStreak: won ? prev.currentStreak + 1 : 0,
          maxStreak: won ? Math.max(prev.maxStreak, prev.currentStreak + 1) : prev.maxStreak,
          guessDistribution: [...prev.guessDistribution],
        };
        if (won && totalAttempts >= 1 && totalAttempts <= 6) {
          next.guessDistribution[totalAttempts - 1] += 1;
        }
        saveStats(next);
        return next;
      });
    },
    []
  );

  // Submit Guess
  const handleGuess = useCallback(
    (chosenTrack: Track) => {
      if (gameOver || !secretTrack) return;

      const attemptIndex = guesses.length;
      const isCorrect = chosenTrack.id === secretTrack.id;

      const newEntry: GuessEntry = {
        type: isCorrect ? 'correct' : 'wrong',
        guessedTrack: chosenTrack,
        durationLabel: `${HEARDLE_STAGES[attemptIndex]}s`,
      };

      const nextGuesses = [...guesses, newEntry];
      setGuesses(nextGuesses);
      setSearchQuery('');
      setIsInputFocused(false);

      if (isCorrect) {
        finishGame(true, nextGuesses.length);
      } else if (nextGuesses.length >= MAX_ATTEMPTS) {
        finishGame(false, nextGuesses.length);
      }
    },
    [gameOver, secretTrack, guesses, finishGame]
  );

  // Skip Attempt
  const handleSkip = useCallback(() => {
    if (gameOver || !secretTrack) return;

    const attemptIndex = guesses.length;
    const newEntry: GuessEntry = {
      type: 'skipped',
      durationLabel: `${HEARDLE_STAGES[attemptIndex]}s`,
    };

    const nextGuesses = [...guesses, newEntry];
    setGuesses(nextGuesses);
    setSearchQuery('');

    if (nextGuesses.length >= MAX_ATTEMPTS) {
      finishGame(false, nextGuesses.length);
    }
  }, [gameOver, secretTrack, guesses, finishGame]);

  // Keyboard shortcut: Space for Play snippet, Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlaySnippet();
      } else if (e.code === 'Escape') {
        if (artistModalOpen) {
          setArtistModalOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, togglePlaySnippet, onClose, artistModalOpen]);

  // Filter autocomplete options from currently active source tracks
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !sourceTracks) return [];
    return sourceTracks
      .filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
      .slice(0, 7);
  }, [searchQuery, sourceTracks]);

  if (!isOpen) return null;

  const currentSourceName =
    selectedSource === 'trending'
      ? 'Trending Hits'
      : selectedSource === 'liked'
        ? 'Liked Tracks'
        : selectedSource === 'artist'
          ? selectedArtist?.name || 'Artist'
          : playlists.find((p) => p.id === selectedSource)?.title || 'Playlist';

  return (
    <div className="fixed inset-0 z-[125] bg-black/90 backdrop-blur-2xl flex flex-col items-center justify-center p-4 select-none animate-fade-in text-white">
      {/* Hidden audio element for zero-latency snippet reproduction */}
      <audio
        ref={audioRef}
        preload="auto"
        onEnded={() => {
          if (audioRef.current) {
            audioRef.current.currentTime = snippetStartOffset;
          }
          setElapsedLabel(0);
          setIsPlayingSnippet(false);
        }}
      />

      {/* Main Container */}
      <div className="relative w-full max-w-xl bg-sc-panel/95 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white/80" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-wide text-white">Song Guesser</h2>
              </div>
              <p className="text-[11px] text-white/50">
                Listen to the snippet and guess the track in the fewest tries.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Source Picker Dropdown */}
            <div className="relative">
              <button
                onClick={() => setSourceDropdownOpen((p) => !p)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-semibold text-white/90 transition-all cursor-pointer"
                title="Select source"
              >
                {selectedSource === 'trending' ? (
                  <Flame className="w-3.5 h-3.5 text-sc-orange" />
                ) : selectedSource === 'liked' ? (
                  <Heart className="w-3.5 h-3.5 text-white/70" />
                ) : selectedSource === 'artist' ? (
                  <Mic2 className="w-3.5 h-3.5 text-white/70" />
                ) : (
                  <ListMusic className="w-3.5 h-3.5 text-white/70" />
                )}
                <span className="truncate max-w-[120px]">{currentSourceName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-white/60" />
              </button>

              {sourceDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-sc-bg border border-white/15 shadow-2xl py-1 z-30 animate-fade-in backdrop-blur-xl">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40 border-b border-white/10">
                    Source
                  </div>

                  {/* Trending hits option - works for all users! */}
                  <button
                    onClick={() => void changeSource('trending')}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left hover:bg-white/10 transition-colors cursor-pointer',
                      selectedSource === 'trending' ? 'text-white font-bold bg-white/5' : 'text-white/80'
                    )}
                  >
                    <Flame className="w-4 h-4 text-sc-orange" />
                    <span className="truncate">Trending Hits (Global)</span>
                  </button>

                  {/* Liked tracks option */}
                  <button
                    onClick={() => void changeSource('liked')}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left hover:bg-white/10 transition-colors cursor-pointer',
                      selectedSource === 'liked' ? 'text-white font-bold bg-white/5' : 'text-white/80'
                    )}
                  >
                    <Heart className="w-4 h-4 text-white/60" />
                    <span className="truncate">Liked Tracks ({likedTracks.length})</span>
                  </button>

                  {/* Specific artist option */}
                  <button
                    onClick={() => {
                      setSourceDropdownOpen(false);
                      setArtistModalOpen(true);
                    }}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left hover:bg-white/10 transition-colors cursor-pointer border-t border-b border-white/10',
                      selectedSource === 'artist' ? 'text-white font-bold bg-white/5' : 'text-white/80'
                    )}
                  >
                    <Mic2 className="w-4 h-4 text-white/60" />
                    <span className="truncate">
                      Specific Artist... {selectedArtist && `(${selectedArtist.name})`}
                    </span>
                  </button>

                  {/* Playlists */}
                  <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
                    Your Playlists
                  </div>
                  {playlists.map((pl) => (
                    <button
                      key={pl.id}
                      onClick={() => void changeSource(pl.id)}
                      className={clsx(
                        'w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left hover:bg-white/10 transition-colors cursor-pointer',
                        selectedSource === pl.id ? 'text-white font-bold bg-white/5' : 'text-white/80'
                      )}
                    >
                      <ListMusic className="w-4 h-4 text-white/60" />
                      <span className="truncate">{pl.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center transition-all cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-5">
          {/* Active Artist Banner if in artist mode */}
          {selectedSource === 'artist' && selectedArtist && (
            <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-white/90 text-xs animate-fade-in">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-full overflow-hidden bg-white/10 shrink-0 border border-white/20">
                  {selectedArtist.avatarUrl ? (
                    <img
                      src={selectedArtist.avatarUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Mic2 className="w-4 h-4 m-1.5 text-white/60" />
                  )}
                </div>
                <div className="truncate">
                  <span className="text-[10px] uppercase font-bold text-white/40 block tracking-wider">
                    Guessing tracks by
                  </span>
                  <span className="font-extrabold text-white text-[13px]">
                    {selectedArtist.name}
                  </span>
                  <span className="text-[11px] text-white/50 ml-1.5 font-mono">
                    ({sourceTracks.length} tracks)
                  </span>
                </div>
              </div>
              <button
                onClick={() => setArtistModalOpen(true)}
                className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 font-bold text-[11px] transition-colors cursor-pointer shrink-0"
              >
                Change artist
              </button>
            </div>
          )}

          {loadingTracks ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-white/60">
              <Loader2 className="w-8 h-8 animate-spin text-sc-orange" />
              <span className="text-xs font-bold uppercase tracking-wider">
                Loading tracks...
              </span>
            </div>
          ) : sourceTracks.length < 2 ? (
            <div className="py-12 text-center text-white/60 space-y-3">
              <p className="text-sm font-semibold">
                Not enough tracks in this source (min. 2 required).
              </p>
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => void changeSource('liked')}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs uppercase cursor-pointer"
                >
                  Switch to Liked Tracks
                </button>
                <button
                  onClick={() => setArtistModalOpen(true)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs uppercase cursor-pointer"
                >
                  Choose another artist
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* ATTEMPTS TILES (Heardle Grid) */}
              <div className="space-y-2">
                {Array.from({ length: MAX_ATTEMPTS }).map((_, idx) => {
                  const guess = guesses[idx];
                  const duration = HEARDLE_STAGES[idx];
                  const isCurrent = idx === currentStageIndex && !gameOver;

                  return (
                    <div
                      key={idx}
                      className={clsx(
                        'flex items-center justify-between px-4 py-2.5 rounded-xl border text-xs font-medium transition-all duration-200',
                        guess
                          ? guess.type === 'correct'
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                            : guess.type === 'skipped'
                              ? 'bg-white/5 border-white/10 text-white/50 italic'
                              : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                          : isCurrent
                            ? 'bg-white/10 border-white/30 text-white ring-1 ring-white/20'
                            : 'bg-white/5 border-white/5 text-white/20'
                      )}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <span className="font-mono text-[11px] font-black text-white/50 w-5">
                          #{idx + 1}
                        </span>
                        {guess ? (
                          guess.type === 'correct' ? (
                            <div className="flex items-center gap-2 truncate">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span className="font-bold truncate text-emerald-200">
                                {guess.guessedTrack?.title} - {guess.guessedTrack?.artist}
                              </span>
                            </div>
                          ) : guess.type === 'skipped' ? (
                            <div className="flex items-center gap-2 truncate">
                              <SkipForward className="w-4 h-4 text-white/40 shrink-0" />
                              <span className="truncate">Skipped attempt</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 truncate">
                              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                              <span className="truncate">
                                {guess.guessedTrack?.title} - {guess.guessedTrack?.artist}
                              </span>
                            </div>
                          )
                        ) : (
                          <span className={clsx('truncate', isCurrent && 'text-white/80')}>
                            {isCurrent ? 'Your turn to guess...' : '—'}
                          </span>
                        )}
                      </div>

                      <span className="font-mono text-[11px] font-bold text-white/40 ml-2 shrink-0">
                        {duration}s
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* PROGRESS BAR & AUDIO DURATION BRACKETS */}
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] font-mono text-white/50 px-1">
                  <span>Unlocked: {gameOver ? '15.0s' : `${currentAllowedDuration}s`}</span>
                  <span>Max 10.0s</span>
                </div>

                {/* Segmented bar. It drives its own fills from the audio element
                    instead of from React state - see SnippetProgress. */}
                <SnippetProgress
                  audioRef={audioRef}
                  stages={HEARDLE_STAGES}
                  unlockedIndex={currentStageIndex}
                  gameOver={gameOver}
                  isPlaying={isPlayingSnippet}
                  snippetStartOffset={snippetStartOffset}
                />
              </div>

              {/* SNIPPET CONTROLLER: BIG PLAY BUTTON & VOLUME CONTROLS */}
              <div className="flex flex-col items-center justify-center py-2 gap-3">
                <button
                  onClick={togglePlaySnippet}
                  disabled={loadingAudio || !streamUrl}
                  className={clsx(
                    'w-18 h-18 rounded-full flex items-center justify-center transition-all duration-300 transform active:scale-95 shadow-2xl cursor-pointer group',
                    loadingAudio
                      ? 'bg-white/10 border border-white/20 text-white/40 cursor-wait'
                      : isPlayingSnippet
                        ? 'bg-sc-orange text-white ring-4 ring-sc-orange/40 scale-105'
                        : 'bg-white/10 hover:bg-sc-orange hover:text-white border border-white/20 text-white'
                  )}
                  title="Play / Pause snippet (Space)"
                >
                  {loadingAudio ? (
                    <Loader2 className="w-8 h-8 animate-spin text-sc-orange" />
                  ) : isPlayingSnippet ? (
                    <Pause className="w-8 h-8 fill-current" />
                  ) : (
                    <Play className="w-8 h-8 ml-1 fill-current group-hover:scale-110 transition-transform" />
                  )}
                </button>

                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-white/60">
                    {loadingAudio
                      ? 'Loading audio snippet...'
                      : isPlayingSnippet
                        ? `Playing... (${elapsedLabel.toFixed(1)}s / ${currentAllowedDuration}s)`
                        : 'Click or press Space to play snippet'}
                  </span>

                  {snippetStartOffset > 0 && !loadingAudio && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] font-mono border border-emerald-500/25 animate-fade-in shadow-sm">
                      <Sparkles className="w-3 h-3 text-emerald-400" />
                      Audible fragment (intro silence skipped: {snippetStartOffset.toFixed(1)}s)
                    </span>
                  )}

                  {/* Volume Slider & Mute Toggle */}
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
                    <button
                      type="button"
                      onClick={toggleMute}
                      className="text-white/60 hover:text-white transition-colors cursor-pointer"
                      title={muted ? 'Unmute' : 'Mute'}
                    >
                      {muted || volume === 0 ? (
                        <VolumeX className="w-4 h-4 text-rose-400" />
                      ) : volume < 0.4 ? (
                        <Volume1 className="w-4 h-4 text-white/80" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-white/80" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={muted ? 0 : Math.round(volume * 100)}
                      onChange={(e) => handleVolumeChange(Number(e.target.value) / 100)}
                      className="w-24 h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-sc-orange"
                      aria-label="Volume"
                    />
                    <span className="text-[10px] font-mono font-bold text-white/50 w-7 text-right">
                      {muted ? '0%' : `${Math.round(volume * 100)}%`}
                    </span>
                  </div>
                </div>
              </div>

              {/* GAME OVER SCREEN: VICTORY OR DEFEAT */}
              {gameOver && secretTrack ? (
                <div className="p-5 rounded-2xl bg-white/5 border border-white/15 flex flex-col items-center text-center gap-4 animate-scale-in">
                  <div className="flex items-center gap-2">
                    {isWon ? (
                      <div className="flex items-center gap-2 text-emerald-400 font-black text-lg">
                        <Trophy className="w-6 h-6" />
                        <span>YOU GOT IT! 🎉</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-rose-400 font-black text-lg">
                        <XCircle className="w-6 h-6" />
                        <span>OUT OF TRIES! IT WAS:</span>
                      </div>
                    )}
                  </div>

                  {/* Secret Track Reveal Card */}
                  <div className="flex items-center gap-4 p-3 rounded-2xl bg-black/40 border border-white/10 w-full max-w-md text-left">
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden shadow-lg shrink-0">
                      <Artwork
                        src={secretTrack.artwork}
                        seed={secretTrack.id}
                        size={80}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-extrabold text-white truncate">
                        {secretTrack.title}
                      </div>
                      <div className="text-xs text-white/60 truncate mt-0.5">
                        {secretTrack.artist}
                      </div>
                      <div className="text-[10px] text-sc-orange font-bold uppercase tracking-wider mt-1">
                        {isWon
                          ? `Guessed on try #${guesses.length} (${HEARDLE_STAGES[guesses.length - 1]}s)`
                          : 'Not guessed'}
                      </div>
                    </div>
                  </div>

                  {/* Stats Bar */}
                  <div className="grid grid-cols-3 gap-3 w-full max-w-md pt-1">
                    <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center">
                      <span className="text-[10px] font-bold uppercase text-white/50">Won</span>
                      <span className="text-base font-black text-white">
                        {stats.won} / {stats.played}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center">
                      <span className="text-[10px] font-bold uppercase text-white/50">Streak</span>
                      <div className="flex items-center gap-1 text-base font-black text-amber-400">
                        <Flame className="w-4 h-4" />
                        <span>{stats.currentStreak}</span>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center">
                      <span className="text-[10px] font-bold uppercase text-white/50">Accuracy</span>
                      <span className="text-base font-black text-cyan-400">
                        {stats.played > 0 ? Math.round((stats.won / stats.played) * 100) : 0}%
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-3 w-full max-w-md mt-1">
                    <button
                      onClick={() => onPlayFullTrack(secretTrack)}
                      className="flex-1 py-3 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current text-sc-orange" />
                      <span>Play full track</span>
                    </button>
                    <button
                      onClick={() => void startNewRound()}
                      className="flex-1 py-3 px-4 rounded-xl bg-sc-orange hover:bg-sc-orange-soft text-white font-extrabold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-sc-orange/30 cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Next round</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* GUESSING INPUT & SKIP CONTROLS */
                <div className="space-y-3 pt-1">
                  <div className="relative">
                    <div className="relative flex items-center">
                      <Search className="absolute left-3.5 w-4 h-4 text-white/40 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => setIsInputFocused(true)}
                        placeholder={
                          selectedSource === 'artist' && selectedArtist
                            ? `Type track title by ${selectedArtist.name}...`
                            : 'Type track title or artist...'
                        }
                        className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/10 border border-white/15 focus:border-sc-orange focus:ring-2 focus:ring-sc-orange/30 text-white placeholder-white/40 text-xs font-semibold outline-none transition-all"
                      />
                    </div>

                    {/* Autocomplete Dropdown List */}
                    {isInputFocused && searchResults.length > 0 && (
                      <div className="absolute left-0 right-0 bottom-full mb-2 bg-sc-bg/95 border border-white/15 rounded-2xl shadow-2xl overflow-hidden z-30 max-h-56 overflow-y-auto backdrop-blur-xl animate-fade-in divide-y divide-white/5">
                        {searchResults.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => handleGuess(t)}
                            className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-white/10 transition-colors text-left cursor-pointer group"
                          >
                            <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-white/5 border border-white/10">
                              <Artwork
                                src={t.artwork}
                                seed={t.id}
                                size={80}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-white group-hover:text-sc-orange transition-colors truncate">
                                {t.title}
                              </div>
                              <div className="text-[11px] text-white/50 truncate">{t.artist}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bottom Skip Button */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-white/40">
                      Don't recognize it? Skip to unlock more audio.
                    </span>
                    <button
                      onClick={handleSkip}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                    >
                      <SkipForward className="w-3.5 h-3.5 text-white/70" />
                      <span>
                        Skip (+
                        {HEARDLE_STAGES[currentStageIndex + 1]
                          ? `${HEARDLE_STAGES[currentStageIndex + 1]}s`
                          : 'End'}
                        )
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ARTIST SELECTION MODAL OVERLAY */}
        {artistModalOpen && (
          <div className="absolute inset-0 z-40 bg-black/95 backdrop-blur-xl p-5 flex flex-col animate-fade-in">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Mic2 className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Choose an artist to guess</h3>
              </div>
              <button
                onClick={() => setArtistModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Artist Search Field */}
            <div className="relative mt-3">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                value={artistSearchQuery}
                onChange={(e) => setArtistSearchQuery(e.target.value)}
                placeholder="Search any artist on SoundCloud (e.g. Fred again.., Skrillex)..."
                autoFocus
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/10 border border-white/15 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-white placeholder-white/40 text-xs font-semibold outline-none transition-all"
              />
              {searchingArtists && (
                <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-amber-400" />
              )}
            </div>

            <div className="flex-1 overflow-y-auto mt-3 space-y-4">
              {/* Search Results */}
              {artistSearchQuery.trim().length >= 2 ? (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-2">
                    SoundCloud search results:
                  </div>
                  {artistSearchResults.length === 0 && !searchingArtists ? (
                    <div className="py-8 text-center text-xs text-white/40">
                      No artists found with this name.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {artistSearchResults.map((user) => (
                        <button
                          key={user.id}
                          onClick={() =>
                            handleSelectArtist(
                              user.fullName || user.username,
                              user.id,
                              user.avatarUrl
                            )
                          }
                          className="w-full p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-amber-400/40 flex items-center gap-3 text-left transition-all cursor-pointer group"
                        >
                          <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 shrink-0 border border-white/10">
                            {user.avatarUrl ? (
                              <img
                                src={user.avatarUrl}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Mic2 className="w-5 h-5 m-2.5 text-white/50" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-extrabold text-white group-hover:text-amber-300 transition-colors truncate">
                              {user.fullName || user.username}
                            </div>
                            <div className="text-[11px] text-white/50 truncate">
                              @{user.username} · {user.trackCount} {user.trackCount === 1 ? 'track' : 'tracks'}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Top artists from user's likes */
                topArtistsFromLikes.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-amber-400" />
                      <span>Artists from your Liked Tracks:</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {topArtistsFromLikes.map((art) => (
                        <button
                          key={art.name}
                          onClick={() => handleSelectArtist(art.name, undefined, art.avatar)}
                          className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-amber-400/40 flex items-center gap-2.5 text-left transition-all cursor-pointer group"
                        >
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 shrink-0 border border-white/10">
                            {art.avatar ? (
                              <img src={art.avatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Mic2 className="w-4 h-4 m-2 text-white/50" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors truncate">
                              {art.name}
                            </div>
                            <div className="text-[10px] text-white/40 font-mono">
                              {art.count} {art.count === 1 ? 'track' : 'tracks'}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
