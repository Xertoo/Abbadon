import { useState, useRef, useEffect } from 'react';
import {
  HardDrive,
  Globe,
  FolderPlus,
  FileAudio,
  ListMusic,
  Plus,
  X,
  Upload,
  Loader2,
  Check,
  CheckCheck,
  Radio,
  Search,
  ArrowRight,
  ExternalLink,
  AlertTriangle,
  AlertCircle,
  Copy,
  Sparkles,
  RefreshCw,
  Play,
  Pause,
  PlayCircle,
  ListPlus,
  RotateCcw,
  Music,
  Heart,
} from 'lucide-react';
import clsx from 'clsx';
import type { Playlist, Track } from '../types';
import { createServerTrack, createLocalPlaylist, parseBrowserAudioFiles } from '../lib/localMedia';
import {
  fetchSpotifyMetadata,
  searchAndRankCandidates,
  searchManualQuery,
  scoreCandidate,
  type SpotifyImportSource,
  type SpotifyMatchResult,
} from '../lib/spotifyImport';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  playlists: Playlist[];
  defaultPlaylistId?: string | null;
  initialTab?: 'pc' | 'server' | 'spotify';
  onAddTracks: (tracks: Track[], targetPlaylistId?: string | null, newPlaylistName?: string) => Promise<void>;
  onAddPlaylist: (playlist: Playlist) => Promise<void>;
  onPlayTrack?: (track: Track, queue?: Track[]) => void;
  onAddToQueue?: (tracks: Track[]) => void;
  onPlayNext?: (track: Track) => void;
  onTogglePlayPause?: () => void;
  playingId?: string | null;
  isPlaying?: boolean;
  notify: (msg: string) => void;
}

function SpotifyIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 5.524 4.477 10 10 10s10-4.476 10-10c0-5.523-4.477-10-10-10zm4.586 14.424a.627.627 0 0 1-.86.208c-2.358-1.442-5.327-1.767-8.824-.968a.627.627 0 1 1-.28-1.222c3.83-.876 7.114-.504 9.756 1.121.298.183.391.57.184.861zm1.226-2.723a.784.784 0 0 1-1.077.26c-2.7-1.66-6.816-2.139-10.01-1.168a.786.786 0 0 1-.462-1.501c3.654-1.11 8.2-0.58 11.288 1.332.368.227.487.712.261 1.077zm.106-2.836C14.685 8.922 9.356 8.745 6.262 9.684a.942.942 0 1 1-.55-1.804c3.553-1.078 9.444-.871 13.23 1.378a.942.942 0 0 1-.952 1.635z" />
    </svg>
  );
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function AddMediaModal({
  isOpen,
  onClose,
  playlists,
  defaultPlaylistId,
  initialTab = 'pc',
  onAddTracks,
  onAddPlaylist,
  onPlayTrack,
  onAddToQueue,
  onPlayNext,
  onTogglePlayPause,
  playingId,
  isPlaying,
  notify,
}: Props) {
  const [activeTab, setActiveTab] = useState<'pc' | 'server' | 'spotify'>(initialTab);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Destination state
  const [destination, setDestination] = useState<
    'new' | 'existing' | 'library' | 'queue-replace' | 'queue-append'
  >(defaultPlaylistId ? 'existing' : 'new');

  const [targetPlaylistId, setTargetPlaylistId] = useState<string>(
    defaultPlaylistId || (playlists[0]?.id ?? '')
  );
  const [newPlaylistName, setNewPlaylistName] = useState('My Local Music');

  // Server tab state
  const [serverMode, setServerMode] = useState<'single' | 'playlist'>('single');
  const [serverUrl, setServerUrl] = useState('');
  const [serverTitle, setServerTitle] = useState('');
  const [serverArtist, setServerArtist] = useState('');
  const [serverArtwork, setServerArtwork] = useState('');

  // Loading state
  const [loading, setLoading] = useState(false);
  const [dragOverZone, setDragOverZone] = useState(false);

  // Hidden file input for web fallback
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // --- Spotify Importer State ---
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [spotifyStep, setSpotifyStep] = useState<'input' | 'searching' | 'review'>('input');
  const [spotifySource, setSpotifySource] = useState<SpotifyImportSource | null>(null);
  const [spotifyResults, setSpotifyResults] = useState<SpotifyMatchResult[]>([]);
  const [searchProgress, setSearchProgress] = useState<{
    current: number;
    total: number;
    currentTrackName: string;
    matchedCount: number;
    uncertainCount: number;
    notFoundCount: number;
  }>({
    current: 0,
    total: 0,
    currentTrackName: '',
    matchedCount: 0,
    uncertainCount: 0,
    notFoundCount: 0,
  });

  // Candidate picker modal state (for reviewing/changing individual matches)
  const [pickingCandidateIndex, setPickingCandidateIndex] = useState<number | null>(null);
  const [manualSearchQuery, setManualSearchQuery] = useState('');
  const [manualCandidates, setManualCandidates] = useState<Track[]>([]);
  const [manualSearching, setManualSearching] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleClose = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    onClose();
  };

  // Cancel search and clean state if modal closes
  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setPickingCandidateIndex(null);
      setLoading(false);
    }
  }, [isOpen]);

  // Clean unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Keyboard navigation (Escape key)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pickingCandidateIndex !== null) {
          e.stopPropagation();
          setPickingCandidateIndex(null);
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pickingCandidateIndex]);

  if (!isOpen) return null;

  // --- PC Handlers ---
  const handlePickFiles = async () => {
    if (window.desktop?.pickMediaFiles) {
      setLoading(true);
      try {
        const res = await window.desktop.pickMediaFiles();
        if (res.ok && res.items) {
          await processImportedItems(res.items);
        }
      } catch (err: any) {
        notify(err?.message || 'Failed to select files');
      } finally {
        setLoading(false);
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handlePickFolder = async () => {
    if (window.desktop?.pickMediaFolder) {
      setLoading(true);
      try {
        const res = await window.desktop.pickMediaFolder();
        if (res.ok && res.items) {
          const folderName = res.folderName || 'Folder Import';
          await processImportedItems(res.items, folderName);
        }
      } catch (err: any) {
        notify(err?.message || 'Failed to select folder');
      } finally {
        setLoading(false);
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  const processImportedItems = async (
    items: { songs: Track[]; playlists: Playlist[] },
    defaultFolderName?: string
  ) => {
    if (items.playlists?.length) {
      for (const pl of items.playlists) {
        await onAddPlaylist(pl);
      }
    }

    if (items.songs?.length) {
      const plName = defaultFolderName || newPlaylistName.trim() || 'Imported Songs';
      await onAddTracks(
        items.songs,
        destination === 'existing' ? targetPlaylistId : null,
        destination === 'new' ? plName : undefined
      );
      notify(`Imported ${items.songs.length} ${items.songs.length === 1 ? 'song' : 'songs'}!`);
    } else if (items.playlists?.length) {
      notify(`Imported ${items.playlists.length} ${items.playlists.length === 1 ? 'playlist' : 'playlists'}!`);
    }

    onClose();
  };

  const handleBrowserFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setLoading(true);
    try {
      const parsedTracks = await parseBrowserAudioFiles(files);
      if (parsedTracks.length) {
        await onAddTracks(
          parsedTracks,
          destination === 'existing' ? targetPlaylistId : null,
          destination === 'new' ? newPlaylistName.trim() || 'Local Songs' : undefined
        );
        notify(`Added ${parsedTracks.length} tracks!`);
        onClose();
      }
    } catch (err: any) {
      notify(err?.message || 'Failed to read files');
    } finally {
      setLoading(false);
    }
  };

  // --- Server Handlers ---
  const handleAddServerStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverUrl.trim()) {
      notify('Please enter a stream URL');
      return;
    }

    setLoading(true);
    try {
      if (serverMode === 'playlist') {
        if (window.desktop?.fetchServerPlaylist) {
          const res = await window.desktop.fetchServerPlaylist(serverUrl.trim());
          if (res.ok && res.playlist) {
            await onAddPlaylist(res.playlist);
            notify(`Added server playlist with ${res.playlist.tracks.length} tracks!`);
            onClose();
            return;
          } else {
            throw new Error(res.error || 'Could not fetch server playlist');
          }
        } else {
          const res = await fetch(serverUrl.trim());
          const text = await res.text();
          const pl = createLocalPlaylist(serverTitle || 'Server Playlist', [], serverUrl.trim());
          await onAddPlaylist(pl);
          notify('Server playlist added');
          onClose();
          return;
        }
      } else {
        const track = createServerTrack(
          serverUrl.trim(),
          serverTitle,
          serverArtist,
          serverArtwork
        );

        await onAddTracks(
          [track],
          destination === 'existing' ? targetPlaylistId : null,
          destination === 'new' ? newPlaylistName.trim() || 'Server Radio' : undefined
        );
        notify(`Added "${track.title}"!`);
        onClose();
      }
    } catch (err: any) {
      notify(err?.message || 'Could not connect to server stream');
    } finally {
      setLoading(false);
    }
  };

  // --- Spotify Importer Handlers ---
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setSpotifyUrl(text.trim());
      }
    } catch {
      notify('Unable to access clipboard');
    }
  };

  const handleStartSpotifySearch = async () => {
    const raw = spotifyUrl.trim();
    if (!raw) {
      notify('Please enter a Spotify playlist, album, or track link');
      return;
    }

    setLoading(true);
    try {
      notify('Reading public Spotify metadata...');
      const source = await fetchSpotifyMetadata(raw);
      setSpotifySource(source);

      if (destination === 'new' || !newPlaylistName || newPlaylistName === 'My Local Music') {
        setNewPlaylistName(source.title);
      }

      setSpotifyStep('searching');
      setLoading(false);

      const abort = new AbortController();
      abortControllerRef.current = abort;

      const total = source.tracks.length;
      const results: SpotifyMatchResult[] = [];
      let matched = 0;
      let uncertain = 0;
      let notFound = 0;

      for (let i = 0; i < total; i++) {
        if (abort.signal.aborted) break;

        const spItem = source.tracks[i];
        setSearchProgress({
          current: i + 1,
          total,
          currentTrackName: `${spItem.artist} - ${spItem.title}`,
          matchedCount: matched,
          uncertainCount: uncertain,
          notFoundCount: notFound,
        });

        const { candidates, bestMatch, score, confidence } = await searchAndRankCandidates(spItem);

        if (confidence === 'high') matched++;
        else if (confidence === 'medium') uncertain++;
        else notFound++;

        results.push({
          original: spItem,
          match: bestMatch,
          score,
          confidence,
          candidates,
          selected: Boolean(bestMatch),
        });

        if (i < total - 1) {
          await new Promise((r) => setTimeout(r, 140));
        }
      }

      setSpotifyResults(results);
      setSpotifyStep('review');
      notify(`Matched ${results.filter((r) => r.match).length} of ${source.tracks.length} tracks on SoundCloud!`);
    } catch (err: any) {
      setLoading(false);
      notify(err?.message || 'Failed to import from Spotify');
      setSpotifyStep('input');
    }
  };

  const handleCancelSearch = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (spotifyResults.length > 0) {
      setSpotifyStep('review');
    } else {
      setSpotifyStep('input');
    }
  };

  const handleToggleSelect = (index: number) => {
    setSpotifyResults((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], selected: !next[index].selected };
      }
      return next;
    });
  };

  const handleSelectAll = (select: boolean) => {
    setSpotifyResults((prev) =>
      prev.map((r) => ({
        ...r,
        selected: select ? Boolean(r.match) : false,
      }))
    );
  };

  const handleCopyMissing = () => {
    const missing = spotifyResults
      .filter((r) => !r.match || !r.selected)
      .map((r) => `${r.original.artist} - ${r.original.title}`);

    if (missing.length === 0) {
      notify('All tracks were matched and selected!');
      return;
    }

    navigator.clipboard.writeText(missing.join('\n'));
    notify(`Copied ${missing.length} missing songs to clipboard!`);
  };

  const handleOpenCandidatePicker = (index: number) => {
    setPickingCandidateIndex(index);
    const item = spotifyResults[index];
    if (item) {
      setManualSearchQuery(`${item.original.artist} ${item.original.title}`);
      setManualCandidates(item.candidates);
    }
  };

  const handleManualSearch = async () => {
    if (pickingCandidateIndex === null) return;
    const item = spotifyResults[pickingCandidateIndex];
    if (!item || !manualSearchQuery.trim()) return;

    setManualSearching(true);
    try {
      const res = await searchManualQuery(item.original, manualSearchQuery.trim(), 10);
      setManualCandidates(res.candidates);
    } finally {
      setManualSearching(false);
    }
  };

  const handlePickCandidate = (track: Track) => {
    if (pickingCandidateIndex === null) return;
    const original = spotifyResults[pickingCandidateIndex].original;
    const { score, confidence } = scoreCandidate(original, track);

    setSpotifyResults((prev) => {
      const next = [...prev];
      next[pickingCandidateIndex] = {
        ...next[pickingCandidateIndex],
        match: track,
        score,
        confidence,
        selected: true,
      };
      return next;
    });

    setPickingCandidateIndex(null);
    notify(`Updated match to "${track.title}"`);
  };

  const getSelectedTracks = (): Track[] => {
    return spotifyResults
      .filter((r) => r.selected && r.match)
      .map((r) => r.match!);
  };

  // Play a single track from the list (and queue all remaining selected tracks)
  const handlePlaySingle = (track: Track, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playingId === track.id) {
      onTogglePlayPause?.();
    } else {
      const selected = getSelectedTracks();
      const queueToUse = selected.length > 0 && selected.some((t) => t.id === track.id) ? selected : [track];
      onPlayTrack?.(track, queueToUse);
    }
  };

  // Add a single track to the current queue
  const handleAddTrackToQueue = (track: Track, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onAddToQueue?.([track]);
  };

  // Create queue with all selected tracks and start playing from track #1
  const handleCreateQueueAndPlay = () => {
    const selected = getSelectedTracks();
    if (selected.length === 0) {
      notify('Please select at least one track to play');
      return;
    }
    onPlayTrack?.(selected[0], selected);
    notify(`Created queue & started playback of ${selected.length} tracks!`);
    handleClose();
  };

  // Append all selected tracks to the queue
  const handleAppendAllToQueue = () => {
    const selected = getSelectedTracks();
    if (selected.length === 0) {
      notify('Please select at least one track to add to queue');
      return;
    }
    onAddToQueue?.(selected);
    handleClose();
  };

  const handleCommitSpotifyImport = async () => {
    const selectedTracks = getSelectedTracks();

    if (selectedTracks.length === 0) {
      notify('Please select at least one track to import');
      return;
    }

    if (destination === 'queue-replace') {
      handleCreateQueueAndPlay();
      return;
    }

    if (destination === 'queue-append') {
      handleAppendAllToQueue();
      return;
    }

    setLoading(true);
    try {
      if (destination === 'new') {
        const title = (newPlaylistName.trim() || spotifySource?.title || 'Spotify Import').trim();
        const pl = createLocalPlaylist(
          title,
          selectedTracks,
          spotifySource?.description || `Imported from Spotify (${selectedTracks.length} tracks)`
        );
        if (spotifySource?.artwork) {
          pl.artwork = spotifySource.artwork;
        }
        await onAddPlaylist(pl);
      } else if (destination === 'existing') {
        await onAddTracks(selectedTracks, targetPlaylistId);
        notify(`Added ${selectedTracks.length} tracks to playlist!`);
      } else {
        await onAddTracks(selectedTracks, null);
        notify(`Added ${selectedTracks.length} tracks to library!`);
      }

      handleClose();
    } catch (err: any) {
      notify(err?.message || 'Failed to save imported tracks');
    } finally {
      setLoading(false);
    }
  };

  const isWideModal = activeTab === 'spotify' && (spotifyStep === 'review' || spotifyStep === 'searching');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md animate-fade-in p-4">
      <div
        className={clsx(
          'w-full rounded-3xl border border-sc-line bg-sc-panel p-6 shadow-2xl animate-scale-in flex flex-col max-h-[90vh] transition-all duration-300',
          isWideModal ? 'max-w-3xl' : 'max-w-lg'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-sc-line">
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                'w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-colors',
                activeTab === 'spotify'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-sc-orange/15 text-sc-orange'
              )}
            >
              {activeTab === 'spotify' ? (
                <SpotifyIcon className="w-5 h-5 text-emerald-400" />
              ) : (
                <FolderPlus className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-sc-fg tracking-tight">
                {activeTab === 'spotify' ? 'Import from Spotify' : 'Add Songs & Playlists'}
              </h2>
              <p className="text-[12px] text-sc-muted">
                {activeTab === 'spotify'
                  ? 'Convert public Spotify playlists, albums & tracks into SoundCloud with instant preview & queueing'
                  : 'Import audio from your PC or connect a server stream'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-fg hover:bg-sc-fill/5 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 pt-4 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('pc')}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold transition-all cursor-pointer',
              activeTab === 'pc'
                ? 'bg-sc-orange text-white shadow-xs'
                : 'bg-sc-panel-2 text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10'
            )}
          >
            <HardDrive className="w-4 h-4" />
            <span>From PC</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('server')}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold transition-all cursor-pointer',
              activeTab === 'server'
                ? 'bg-sc-orange text-white shadow-xs'
                : 'bg-sc-panel-2 text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10'
            )}
          >
            <Globe className="w-4 h-4" />
            <span>Server / Stream</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('spotify')}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold transition-all cursor-pointer',
              activeTab === 'spotify'
                ? 'bg-emerald-500 text-white shadow-xs'
                : 'bg-sc-panel-2 text-sc-muted hover:text-emerald-400 hover:bg-sc-fill/10'
            )}
          >
            <SpotifyIcon className="w-4 h-4" />
            <span>Spotify Import</span>
          </button>
        </div>

        {/* Hidden inputs for browser file choosing fallback */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*,.m3u,.m3u8,.pls"
          onChange={(e) => void handleBrowserFiles(e.target.files)}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory attribute
          webkitdirectory=""
          directory=""
          onChange={(e) => void handleBrowserFiles(e.target.files)}
          className="hidden"
        />

        {/* Content body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4 pr-1 scroll-thin">
          {activeTab === 'pc' ? (
            /* Tab 1: PC */
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverZone(true);
                }}
                onDragLeave={() => setDragOverZone(false)}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragOverZone(false);
                  if (e.dataTransfer.files?.length) {
                    if (window.desktop?.parseMediaPaths) {
                      const filePaths = Array.from(e.dataTransfer.files)
                        .map((f: any) => f.path)
                        .filter(Boolean);
                      if (filePaths.length) {
                        setLoading(true);
                        try {
                          const res = await window.desktop.parseMediaPaths(filePaths);
                          if (res.ok && res.items) {
                            await processImportedItems(res.items);
                          }
                        } finally {
                          setLoading(false);
                        }
                        return;
                      }
                    }
                    await handleBrowserFiles(e.dataTransfer.files);
                  }
                }}
                className={clsx(
                  'rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-200 flex flex-col items-center justify-center gap-2 cursor-pointer',
                  dragOverZone
                    ? 'border-sc-orange bg-sc-orange/10 scale-[1.01]'
                    : 'border-sc-line hover:border-sc-orange/50 bg-sc-panel-2/40 hover:bg-sc-panel-2/70'
                )}
                onClick={handlePickFiles}
              >
                <div className="w-12 h-12 rounded-full bg-sc-orange/15 flex items-center justify-center text-sc-orange">
                  <Upload className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="text-[13px] font-bold text-sc-fg">
                    Drag &amp; drop audio files or playlists here
                  </div>
                  <div className="text-[11px] text-sc-muted mt-0.5">
                    Supports MP3, FLAC, WAV, M4A, OGG, OPUS, AAC, and M3U/PLS playlists
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handlePickFiles}
                  disabled={loading}
                  className="flex items-center justify-center gap-2 p-3.5 rounded-xl border border-sc-line bg-sc-panel-2/70 hover:border-sc-orange/60 hover:bg-sc-orange/10 text-sc-fg text-[12.5px] font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  <FileAudio className="w-4 h-4 text-sc-orange" />
                  <span>Select Audio Files</span>
                </button>
                <button
                  type="button"
                  onClick={handlePickFolder}
                  disabled={loading}
                  className="flex items-center justify-center gap-2 p-3.5 rounded-xl border border-sc-line bg-sc-panel-2/70 hover:border-sc-orange/60 hover:bg-sc-orange/10 text-sc-fg text-[12.5px] font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  <FolderPlus className="w-4 h-4 text-sc-orange" />
                  <span>Select Folder</span>
                </button>
              </div>
            </div>
          ) : activeTab === 'server' ? (
            /* Tab 2: Server / Stream URL */
            <form onSubmit={handleAddServerStream} className="space-y-3.5">
              <div className="flex items-center gap-2 p-1 rounded-xl bg-sc-panel-2/80 border border-sc-line text-xs">
                <button
                  type="button"
                  onClick={() => setServerMode('single')}
                  className={clsx(
                    'flex-1 py-1.5 rounded-lg font-bold transition-all cursor-pointer text-center',
                    serverMode === 'single'
                      ? 'bg-sc-orange text-white shadow-xs'
                      : 'text-sc-muted hover:text-sc-fg'
                  )}
                >
                  Audio Stream / Song URL
                </button>
                <button
                  type="button"
                  onClick={() => setServerMode('playlist')}
                  className={clsx(
                    'flex-1 py-1.5 rounded-lg font-bold transition-all cursor-pointer text-center',
                    serverMode === 'playlist'
                      ? 'bg-sc-orange text-white shadow-xs'
                      : 'text-sc-muted hover:text-sc-fg'
                  )}
                >
                  Remote Playlist URL (.m3u)
                </button>
              </div>

              <div>
                <label className="text-[11.5px] font-semibold text-sc-dim block mb-1">
                  {serverMode === 'single' ? 'Stream / Direct Audio URL *' : 'Playlist URL (.m3u / .m3u8) *'}
                </label>
                <input
                  type="url"
                  required
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder={
                    serverMode === 'single'
                      ? 'https://stream.server.org/live.mp3'
                      : 'http://my-server:8000/playlists/favorites.m3u'
                  }
                  className="w-full rounded-xl border border-sc-line bg-sc-panel-2 px-3.5 py-2.5 text-[13px] font-medium text-sc-fg placeholder-sc-dim outline-none focus:border-sc-orange focus:ring-1 focus:ring-sc-orange transition-all"
                />
              </div>

              {serverMode === 'single' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11.5px] font-semibold text-sc-dim block mb-1">
                      Title (Optional)
                    </label>
                    <input
                      type="text"
                      value={serverTitle}
                      onChange={(e) => setServerTitle(e.target.value)}
                      placeholder="My Stream Station"
                      className="w-full rounded-xl border border-sc-line bg-sc-panel-2 px-3 py-2 text-[12.5px] text-sc-fg placeholder-sc-dim outline-none focus:border-sc-orange transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[11.5px] font-semibold text-sc-dim block mb-1">
                      Artist / Host (Optional)
                    </label>
                    <input
                      type="text"
                      value={serverArtist}
                      onChange={(e) => setServerArtist(e.target.value)}
                      placeholder="Radio Station"
                      className="w-full rounded-xl border border-sc-line bg-sc-panel-2 px-3 py-2 text-[12.5px] text-sc-fg placeholder-sc-dim outline-none focus:border-sc-orange transition-all"
                    />
                  </div>
                </div>
              )}
            </form>
          ) : (
            /* Tab 3: Spotify Importer */
            <div className="space-y-4">
              {spotifyStep === 'input' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-start gap-3">
                    <Sparkles className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-[12px] leading-relaxed text-emerald-300">
                      <span className="font-bold text-emerald-400 block mb-0.5">
                        No Spotify login or Premium required!
                      </span>
                      Paste any public playlist, album, or song link from Spotify. Abbadon will automatically match the songs on SoundCloud, allow you to preview them, create playback queues, or save them to your library.
                    </div>
                  </div>

                  <div>
                    <label className="text-[11.5px] font-semibold text-sc-dim block mb-1">
                      Spotify Link or ID *
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={spotifyUrl}
                          onChange={(e) => setSpotifyUrl(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleStartSpotifySearch();
                          }}
                          placeholder="https://open.spotify.com/playlist/... or album / track"
                          className="w-full rounded-xl border border-sc-line bg-sc-panel-2 pl-3.5 pr-20 py-2.5 text-[13px] font-medium text-sc-fg placeholder-sc-dim outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                        />
                        <button
                          type="button"
                          onClick={handlePasteClipboard}
                          className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-sc-panel text-[11px] font-bold text-sc-muted hover:text-sc-fg hover:bg-sc-fill/10 border border-sc-line transition-colors cursor-pointer"
                        >
                          Paste
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleStartSpotifySearch}
                        disabled={loading || !spotifyUrl.trim()}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-[13px] font-bold text-white hover:bg-emerald-400 transition-all duration-150 hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer shadow-sm glow-emerald shrink-0"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Reading...</span>
                          </>
                        ) : (
                          <>
                            <Search className="w-4 h-4" />
                            <span>Find Songs</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {spotifyStep === 'searching' && (
                <div className="py-8 px-4 flex flex-col items-center justify-center text-center space-y-5 animate-fade-in">
                  <div className="relative w-16 h-16 rounded-3xl bg-emerald-500/15 flex items-center justify-center text-emerald-400">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>

                  <div className="space-y-1 max-w-md">
                    <h3 className="text-base font-bold text-sc-fg">
                      Searching tracks on SoundCloud...
                    </h3>
                    <p className="text-xs text-sc-muted line-clamp-1">
                      {searchProgress.currentTrackName || 'Preparing search query...'}
                    </p>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full max-w-md space-y-2">
                    <div className="w-full h-2.5 rounded-full bg-sc-panel-2 overflow-hidden border border-sc-line">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-200 rounded-full"
                        style={{
                          width: `${searchProgress.total ? (searchProgress.current / searchProgress.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11.5px] font-medium text-sc-dim">
                      <span>
                        Track {searchProgress.current} of {searchProgress.total}
                      </span>
                      <span>
                        {searchProgress.total
                          ? Math.round((searchProgress.current / searchProgress.total) * 100)
                          : 0}
                        %
                      </span>
                    </div>
                  </div>

                  {/* Live Stats */}
                  <div className="flex items-center gap-4 text-xs font-semibold">
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      {searchProgress.matchedCount} matched
                    </span>
                    <span className="flex items-center gap-1.5 text-amber-400">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      {searchProgress.uncertainCount} uncertain
                    </span>
                    <span className="flex items-center gap-1.5 text-rose-400">
                      <span className="w-2 h-2 rounded-full bg-rose-400" />
                      {searchProgress.notFoundCount} not found
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleCancelSearch}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-sc-muted hover:text-sc-fg border border-sc-line bg-sc-panel-2 hover:bg-sc-fill/10 transition-colors cursor-pointer"
                  >
                    Cancel / Stop Searching
                  </button>
                </div>
              )}

              {spotifyStep === 'review' && (
                <div className="space-y-4 animate-fade-in">
                  {/* Playlist / Album Banner with Quick Play & Queue actions */}
                  <div className="p-3.5 rounded-2xl bg-sc-panel-2/70 border border-sc-line flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {spotifySource?.artwork ? (
                        <img
                          src={spotifySource.artwork}
                          alt={spotifySource.title}
                          className="w-12 h-12 rounded-xl object-cover shadow-sm ring-1 ring-white/10 shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                          <SpotifyIcon className="w-6 h-6" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-sc-fg truncate">
                          {spotifySource?.title}
                        </h4>
                        <div className="flex items-center gap-2 text-[11px] text-sc-muted">
                          <span>{spotifyResults.length} tracks</span>
                          <span>•</span>
                          <span className="text-emerald-400 font-semibold">
                            {spotifyResults.filter((r) => r.match && r.confidence === 'high').length} high match
                          </span>
                          <span>•</span>
                          <span className="text-amber-400 font-semibold">
                            {spotifyResults.filter((r) => r.match && r.confidence === 'medium').length} possible
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick batch buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap self-end md:self-auto">
                      <button
                        type="button"
                        onClick={handleCreateQueueAndPlay}
                        disabled={getSelectedTracks().length === 0}
                        title="Start playing and replace current queue with all matched tracks"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 text-[11.5px] font-bold text-white hover:bg-emerald-400 transition-all cursor-pointer disabled:opacity-40 shadow-xs"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play &amp; Queue All</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleAppendAllToQueue}
                        disabled={getSelectedTracks().length === 0}
                        title="Add all matched tracks to the end of the current queue"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sc-line bg-sc-panel hover:bg-sc-panel-2 text-[11.5px] font-semibold text-sc-fg transition-all cursor-pointer disabled:opacity-40"
                      >
                        <ListPlus className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Add to Queue</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyMissing}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-sc-line bg-sc-panel hover:bg-sc-panel-2 text-[11px] font-semibold text-sc-muted hover:text-sc-fg transition-all cursor-pointer"
                        title="Copy list of missing or unselected tracks"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Missing</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectAll(true)}
                        className="px-2 py-1.5 rounded-xl border border-sc-line bg-sc-panel hover:bg-sc-panel-2 text-[11px] font-semibold text-sc-muted hover:text-sc-fg transition-all cursor-pointer"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectAll(false)}
                        className="px-2 py-1.5 rounded-xl border border-sc-line bg-sc-panel hover:bg-sc-panel-2 text-[11px] font-semibold text-sc-muted hover:text-sc-fg transition-all cursor-pointer"
                      >
                        None
                      </button>
                    </div>
                  </div>

                  {/* Tracks Review List */}
                  <div className="border border-sc-line rounded-2xl overflow-hidden divide-y divide-sc-line/50 max-h-[340px] overflow-y-auto scroll-thin bg-sc-panel-2/30">
                    {spotifyResults.map((res, idx) => {
                      const isMatched = Boolean(res.match);
                      const isCurrentPlaying = res.match && playingId === res.match.id;
                      const durDiff =
                        res.original.durationMs && res.match?.duration
                          ? Math.round(res.match.duration - res.original.durationMs / 1000)
                          : null;

                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            if (res.match) handlePlaySingle(res.match);
                          }}
                          className={clsx(
                            'p-3 flex items-center gap-3 transition-colors text-xs group cursor-pointer select-none',
                            isCurrentPlaying && 'bg-emerald-500/10 border-l-2 border-emerald-500',
                            !isCurrentPlaying && res.selected ? 'bg-sc-panel-2/40 hover:bg-sc-panel-2/70' : 'opacity-60 bg-transparent hover:bg-sc-panel-2/20'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={res.selected}
                            disabled={!isMatched}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => handleToggleSelect(idx)}
                            className="w-4 h-4 rounded text-emerald-500 accent-emerald-500 cursor-pointer disabled:opacity-30 shrink-0"
                          />

                          <span className="text-[11px] font-mono text-sc-dim w-5 text-right shrink-0">
                            {idx + 1}
                          </span>

                          {/* Spotify Original */}
                          <div className="flex-1 min-w-0 pr-2">
                            <div className="font-semibold text-sc-fg truncate" title={res.original.title}>
                              {res.original.title}
                            </div>
                            <div className="text-[11px] text-sc-muted truncate">
                              {res.original.artist}
                              {res.original.durationMs ? (
                                <span className="ml-1.5 font-mono text-sc-dim">
                                  ({formatDuration(res.original.durationMs / 1000)})
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <ArrowRight className="w-3.5 h-3.5 text-sc-dim shrink-0" />

                          {/* SoundCloud Match with Direct Play & Queue */}
                          <div className="flex-1 min-w-0 pl-2">
                            {res.match ? (
                              <div className="flex items-center gap-2.5">
                                {/* Artwork with Play/Pause button */}
                                <div className="relative group/art shrink-0 w-8 h-8 rounded-lg overflow-hidden bg-sc-panel-2">
                                  {res.match.artwork ? (
                                    <img
                                      src={res.match.artwork}
                                      alt=""
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-sc-dim">
                                      <Music className="w-3.5 h-3.5" />
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => handlePlaySingle(res.match!, e)}
                                    title={isCurrentPlaying && isPlaying ? 'Pause' : 'Play song now'}
                                    className={clsx(
                                      'absolute inset-0 flex items-center justify-center transition-all cursor-pointer',
                                      isCurrentPlaying
                                        ? 'bg-emerald-500 text-white opacity-100'
                                        : 'bg-black/60 opacity-0 group-hover/art:opacity-100 group-hover:opacity-100 text-white'
                                    )}
                                  >
                                    {isCurrentPlaying && isPlaying ? (
                                      <Pause className="w-3.5 h-3.5 fill-current" />
                                    ) : (
                                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                                    )}
                                  </button>
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div
                                    className={clsx(
                                      'font-semibold truncate transition-colors',
                                      isCurrentPlaying ? 'text-emerald-400 font-bold' : 'text-sc-fg'
                                    )}
                                    title={res.match.title}
                                  >
                                    {res.match.title}
                                  </div>
                                  <div className="text-[11px] text-sc-muted truncate flex items-center gap-1.5">
                                    <span>{res.match.artist}</span>
                                    <span className="font-mono text-sc-dim">
                                      ({res.match.durationFormatted})
                                    </span>
                                    {durDiff !== null && Math.abs(durDiff) > 3 && (
                                      <span
                                        className={clsx(
                                          'text-[10px] font-mono px-1 rounded',
                                          Math.abs(durDiff) > 10
                                            ? 'text-amber-400 bg-amber-400/10'
                                            : 'text-sc-dim'
                                        )}
                                      >
                                        {durDiff > 0 ? `+${durDiff}s` : `${durDiff}s`}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-rose-400 font-semibold text-[11px]">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>No match found on SoundCloud</span>
                              </div>
                            )}
                          </div>

                          {/* Quick Actions (Play, Queue, Open, Change) */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {res.confidence === 'high' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                                Match {Math.round(res.score * 100)}%
                              </span>
                            )}
                            {res.confidence === 'medium' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                                Possible
                              </span>
                            )}
                            {(!res.match || res.confidence === 'low' || res.confidence === 'none') && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/20">
                                Not found
                              </span>
                            )}

                            {res.match && (
                              <>
                                <button
                                  type="button"
                                  onClick={(e) => handleAddTrackToQueue(res.match!, e)}
                                  title="Add to current queue"
                                  className="w-7 h-7 rounded-lg border border-sc-line bg-sc-panel hover:bg-emerald-500/20 hover:border-emerald-500/40 text-sc-muted hover:text-emerald-400 flex items-center justify-center transition-colors cursor-pointer"
                                >
                                  <ListPlus className="w-3.5 h-3.5" />
                                </button>
                                {res.match.permalinkUrl && (
                                  <a
                                    href={res.match.permalinkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Open track on SoundCloud"
                                    className="w-7 h-7 rounded-lg border border-sc-line bg-sc-panel hover:bg-sc-panel-2 text-sc-muted hover:text-sc-fg flex items-center justify-center transition-colors cursor-pointer"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                )}
                              </>
                            )}

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenCandidatePicker(idx);
                              }}
                              className="px-2.5 py-1 rounded-lg border border-sc-line bg-sc-panel hover:bg-sc-panel-2 text-sc-muted hover:text-sc-fg text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                              {res.match ? 'Change' : 'Search'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Destination Section */}
          {(activeTab !== 'spotify' || spotifyStep === 'review') && (
            <div className="pt-2 border-t border-sc-line/60 space-y-2.5">
              <label className="text-[11.5px] font-bold text-sc-dim uppercase tracking-wider block">
                Target Action / Destination:
              </label>
              <div
                className={clsx(
                  'grid gap-2 text-xs',
                  activeTab === 'spotify' ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-3'
                )}
              >
                <button
                  type="button"
                  onClick={() => setDestination('new')}
                  className={clsx(
                    'p-2.5 rounded-xl border text-center transition-all cursor-pointer font-bold flex flex-col items-center justify-center gap-1',
                    destination === 'new'
                      ? 'border-sc-orange bg-sc-orange/15 text-sc-orange-soft'
                      : 'border-sc-line bg-sc-panel-2/50 text-sc-muted hover:text-sc-fg'
                  )}
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>New Playlist</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDestination('existing')}
                  disabled={!playlists.length}
                  className={clsx(
                    'p-2.5 rounded-xl border text-center transition-all cursor-pointer font-bold disabled:opacity-40 flex flex-col items-center justify-center gap-1',
                    destination === 'existing'
                      ? 'border-sc-orange bg-sc-orange/15 text-sc-orange-soft'
                      : 'border-sc-line bg-sc-panel-2/50 text-sc-muted hover:text-sc-fg'
                  )}
                >
                  <ListMusic className="w-4 h-4" />
                  <span>Existing Playlist</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDestination('library')}
                  className={clsx(
                    'p-2.5 rounded-xl border text-center transition-all cursor-pointer font-bold flex flex-col items-center justify-center gap-1',
                    destination === 'library'
                      ? 'border-sc-orange bg-sc-orange/15 text-sc-orange-soft'
                      : 'border-sc-line bg-sc-panel-2/50 text-sc-muted hover:text-sc-fg'
                  )}
                >
                  <Heart className="w-4 h-4" />
                  <span>Liked Tracks</span>
                </button>

                {activeTab === 'spotify' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setDestination('queue-replace')}
                      className={clsx(
                        'p-2.5 rounded-xl border text-center transition-all cursor-pointer font-bold flex flex-col items-center justify-center gap-1',
                        destination === 'queue-replace'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400'
                          : 'border-sc-line bg-sc-panel-2/50 text-sc-muted hover:text-emerald-400'
                      )}
                    >
                      <PlayCircle className="w-4 h-4" />
                      <span>Create Queue &amp; Play</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDestination('queue-append')}
                      className={clsx(
                        'p-2.5 rounded-xl border text-center transition-all cursor-pointer font-bold flex flex-col items-center justify-center gap-1',
                        destination === 'queue-append'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400'
                          : 'border-sc-line bg-sc-panel-2/50 text-sc-muted hover:text-emerald-400'
                      )}
                    >
                      <ListPlus className="w-4 h-4" />
                      <span>Add to Queue</span>
                    </button>
                  </>
                )}
              </div>

              {destination === 'new' && (
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="Playlist Name"
                  className="w-full mt-2 rounded-xl border border-sc-line bg-sc-panel-2 px-3 py-2 text-[12.5px] text-sc-fg placeholder-sc-dim outline-none focus:border-sc-orange transition-all"
                />
              )}

              {destination === 'existing' && playlists.length > 0 && (
                <select
                  value={targetPlaylistId}
                  onChange={(e) => setTargetPlaylistId(e.target.value)}
                  className="w-full mt-2 rounded-xl border border-sc-line bg-sc-panel-2 px-3 py-2 text-[12.5px] text-sc-fg outline-none focus:border-sc-orange transition-all"
                >
                  {playlists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.title} ({pl.tracks?.length ?? pl.trackCount} tracks)
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-sc-line flex items-center justify-between gap-2.5">
          <div>
            {activeTab === 'spotify' && spotifyStep === 'review' && (
              <button
                type="button"
                onClick={() => setSpotifyStep('input')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold text-sc-muted hover:text-sc-fg border border-sc-line bg-sc-panel-2 hover:bg-sc-fill/10 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Search another link</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-[12.5px] font-semibold text-sc-muted hover:text-sc-fg hover:bg-sc-fill/5 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            {activeTab === 'server' && (
              <button
                type="button"
                onClick={handleAddServerStream}
                disabled={loading || !serverUrl.trim()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-sc-orange text-[12.5px] font-bold text-white hover:bg-sc-orange-soft transition-all duration-150 hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer shadow-sm glow-orange"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <span>Add Stream to Client</span>
                )}
              </button>
            )}

            {activeTab === 'spotify' && spotifyStep === 'review' && (
              <>
                <button
                  type="button"
                  onClick={handleCommitSpotifyImport}
                  disabled={loading || getSelectedTracks().length === 0}
                  className={clsx(
                    'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12.5px] font-bold text-white transition-all duration-150 hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer shadow-sm',
                    destination === 'queue-replace' || destination === 'queue-append'
                      ? 'bg-emerald-600 hover:bg-emerald-500 glow-emerald'
                      : 'bg-emerald-500 hover:bg-emerald-400 glow-emerald'
                  )}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : destination === 'queue-replace' ? (
                    <>
                      <PlayCircle className="w-4 h-4 fill-current" />
                      <span>Play &amp; Create Queue ({getSelectedTracks().length})</span>
                    </>
                  ) : destination === 'queue-append' ? (
                    <>
                      <ListPlus className="w-4 h-4" />
                      <span>Add {getSelectedTracks().length} Songs to Queue</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Save {getSelectedTracks().length} Songs to Abbadon</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Candidate Picker Sub-Modal */}
        {pickingCandidateIndex !== null && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in p-4">
            <div className="w-full max-w-xl rounded-2xl border border-sc-line bg-sc-panel p-5 shadow-2xl flex flex-col max-h-[80vh] space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-sc-line">
                <div>
                  <h3 className="text-base font-bold text-sc-fg">
                    Choose match on SoundCloud
                  </h3>
                  <p className="text-xs text-sc-muted truncate">
                    For:{' '}
                    <span className="text-emerald-400 font-semibold">
                      {spotifyResults[pickingCandidateIndex]?.original.artist} -{' '}
                      {spotifyResults[pickingCandidateIndex]?.original.title}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPickingCandidateIndex(null)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-sc-dim hover:text-sc-fg hover:bg-sc-fill/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Manual search input */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={manualSearchQuery}
                  onChange={(e) => setManualSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleManualSearch();
                    }
                  }}
                  placeholder="Search SoundCloud manually..."
                  className="flex-1 rounded-xl border border-sc-line bg-sc-panel-2 px-3 py-2 text-xs text-sc-fg outline-none focus:border-emerald-500 transition-all"
                />
                <button
                  type="button"
                  onClick={handleManualSearch}
                  disabled={manualSearching || !manualSearchQuery.trim()}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500 text-xs font-bold text-white hover:bg-emerald-400 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {manualSearching ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span>Search</span>
                </button>
              </div>

              {/* Candidates list */}
              <div className="flex-1 overflow-y-auto divide-y divide-sc-line/50 border border-sc-line rounded-xl scroll-thin bg-sc-panel-2/30">
                {manualCandidates.length === 0 ? (
                  <div className="p-6 text-center text-xs text-sc-muted">
                    No SoundCloud tracks found for this query. Try a different search phrase above.
                  </div>
                ) : (
                  manualCandidates.map((cand) => {
                    const original = spotifyResults[pickingCandidateIndex]?.original;
                    const { score, confidence } = original ? scoreCandidate(original, cand) : { score: 0, confidence: 'none' as const };
                    const isCurrent = spotifyResults[pickingCandidateIndex]?.match?.id === cand.id;
                    const isCandPlaying = playingId === cand.id;

                    return (
                      <div
                        key={cand.id}
                        className={clsx(
                          'p-3 flex items-center justify-between gap-3 hover:bg-sc-panel-2/80 transition-colors',
                          isCurrent && 'bg-emerald-500/10'
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Candidate artwork with Play/Pause button for instant preview */}
                          <div className="relative group/cand shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-sc-panel-2">
                            {cand.artwork ? (
                              <img
                                src={cand.artwork}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-sc-dim">
                                <Music className="w-4 h-4" />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (isCandPlaying) onTogglePlayPause?.();
                                else onPlayTrack?.(cand, [cand]);
                              }}
                              title={isCandPlaying && isPlaying ? 'Pause' : 'Listen to preview'}
                              className={clsx(
                                'absolute inset-0 flex items-center justify-center transition-all cursor-pointer',
                                isCandPlaying
                                  ? 'bg-emerald-500 text-white opacity-100'
                                  : 'bg-black/60 opacity-0 group-hover/cand:opacity-100 text-white'
                              )}
                            >
                              {isCandPlaying && isPlaying ? (
                                <Pause className="w-4 h-4 fill-current" />
                              ) : (
                                <Play className="w-4 h-4 fill-current ml-0.5" />
                              )}
                            </button>
                          </div>

                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-sc-fg truncate" title={cand.title}>
                              {cand.title}
                            </div>
                            <div className="text-[11px] text-sc-muted flex items-center gap-2">
                              <span className="truncate">{cand.artist}</span>
                              <span className="font-mono text-sc-dim">• {cand.durationFormatted}</span>
                              {cand.playsCount ? (
                                <span className="text-[10px] text-sc-dim">
                                  • {cand.playsCount.toLocaleString()} plays
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAddTrackToQueue(cand)}
                            title="Add this candidate to queue"
                            className="w-7 h-7 rounded-lg border border-sc-line bg-sc-panel hover:bg-sc-panel-2 text-sc-muted hover:text-emerald-400 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <ListPlus className="w-3.5 h-3.5" />
                          </button>

                          <span
                            className={clsx(
                              'px-2 py-0.5 rounded-full text-[10px] font-bold border',
                              confidence === 'high'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                                : confidence === 'medium'
                                ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                                : 'bg-sc-panel text-sc-dim border-sc-line'
                            )}
                          >
                            {Math.round(score * 100)}%
                          </span>
                          <button
                            type="button"
                            onClick={() => handlePickCandidate(cand)}
                            className={clsx(
                              'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer',
                              isCurrent
                                ? 'bg-emerald-500 text-white'
                                : 'bg-sc-panel-2 hover:bg-emerald-500 hover:text-white text-sc-fg border border-sc-line'
                            )}
                          >
                            {isCurrent ? 'Selected' : 'Select'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setPickingCandidateIndex(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-sc-muted hover:text-sc-fg border border-sc-line bg-sc-panel-2 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
