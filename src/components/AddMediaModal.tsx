import { useState, useRef } from 'react';
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
  Radio,
} from 'lucide-react';
import clsx from 'clsx';
import type { Playlist, Track } from '../types';
import { createServerTrack, createLocalPlaylist, parseBrowserAudioFiles } from '../lib/localMedia';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  playlists: Playlist[];
  defaultPlaylistId?: string | null;
  onAddTracks: (tracks: Track[], targetPlaylistId?: string | null, newPlaylistName?: string) => Promise<void>;
  onAddPlaylist: (playlist: Playlist) => Promise<void>;
  notify: (msg: string) => void;
}

export function AddMediaModal({
  isOpen,
  onClose,
  playlists,
  defaultPlaylistId,
  onAddTracks,
  onAddPlaylist,
  notify,
}: Props) {
  const [activeTab, setActiveTab] = useState<'pc' | 'server'>('pc');

  // Destination state
  const [destination, setDestination] = useState<'new' | 'existing' | 'library'>(
    defaultPlaylistId ? 'existing' : 'new'
  );
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
    // 1. If any playlists were imported (.m3u, .pls)
    if (items.playlists?.length) {
      for (const pl of items.playlists) {
        await onAddPlaylist(pl);
      }
    }

    // 2. If songs were imported
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
        // Fetch and parse remote M3U playlist
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
          // Web fallback fetch
          const res = await fetch(serverUrl.trim());
          const text = await res.text();
          const pl = createLocalPlaylist(serverTitle || 'Server Playlist', [], serverUrl.trim());
          await onAddPlaylist(pl);
          notify('Server playlist added');
          onClose();
          return;
        }
      } else {
        // Single Audio Stream / Song
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in p-4">
      <div className="w-full max-w-lg rounded-3xl border border-sc-line bg-sc-panel p-6 shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-sc-line">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sc-orange/15 flex items-center justify-center text-sc-orange shrink-0">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-sc-fg tracking-tight">Add Songs & Playlists</h2>
              <p className="text-[12px] text-sc-muted">Import audio from your PC or connect a server stream</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
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
            <span>From Server / Stream</span>
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
        <div className="flex-1 overflow-y-auto py-3 space-y-4 pr-1">
          {activeTab === 'pc' ? (
            /* Tab 1: PC */
            <div className="space-y-4">
              {/* Dropzone */}
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

              {/* Quick Action Buttons */}
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
          ) : (
            /* Tab 2: Server / Stream URL */
            <form onSubmit={handleAddServerStream} className="space-y-3.5">
              {/* Mode switch: Single Stream vs Remote Playlist */}
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

              {/* URL Input */}
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

              {/* Metadata Inputs (for single track) */}
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
          )}

          {/* Destination Section */}
          <div className="pt-2 border-t border-sc-line/60 space-y-2.5">
            <label className="text-[11.5px] font-bold text-sc-dim uppercase tracking-wider block">
              Add To Destination:
            </label>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setDestination('new')}
                className={clsx(
                  'p-2.5 rounded-xl border text-center transition-all cursor-pointer font-bold',
                  destination === 'new'
                    ? 'border-sc-orange bg-sc-orange/15 text-sc-orange-soft'
                    : 'border-sc-line bg-sc-panel-2/50 text-sc-muted hover:text-sc-fg'
                )}
              >
                New Playlist
              </button>
              <button
                type="button"
                onClick={() => setDestination('existing')}
                disabled={!playlists.length}
                className={clsx(
                  'p-2.5 rounded-xl border text-center transition-all cursor-pointer font-bold disabled:opacity-40',
                  destination === 'existing'
                    ? 'border-sc-orange bg-sc-orange/15 text-sc-orange-soft'
                    : 'border-sc-line bg-sc-panel-2/50 text-sc-muted hover:text-sc-fg'
                )}
              >
                Existing Playlist
              </button>
              <button
                type="button"
                onClick={() => setDestination('library')}
                className={clsx(
                  'p-2.5 rounded-xl border text-center transition-all cursor-pointer font-bold',
                  destination === 'library'
                    ? 'border-sc-orange bg-sc-orange/15 text-sc-orange-soft'
                    : 'border-sc-line bg-sc-panel-2/50 text-sc-muted hover:text-sc-fg'
                )}
              >
                Liked Tracks
              </button>
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
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-sc-line flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
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
        </div>
      </div>
    </div>
  );
}
