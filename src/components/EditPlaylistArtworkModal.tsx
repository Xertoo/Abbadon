import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Upload,
  Link as LinkIcon,
  X,
  Check,
  Loader2,
  RotateCcw,
  Image as ImageIcon,
} from 'lucide-react';
import clsx from 'clsx';
import type { Playlist } from '../types';
import { Artwork } from './Artwork';
import { optimizePlaylistImage } from '../lib/playlistArtwork';

interface Props {
  isOpen: boolean;
  playlist: Playlist;
  onClose: () => void;
  onSave: (newArtwork: string) => Promise<void>;
  notify: (msg: string) => void;
}

export function EditPlaylistArtworkModal({
  isOpen,
  playlist,
  onClose,
  onSave,
  notify,
}: Props) {
  const [tab, setTab] = useState<'upload' | 'url'>('upload');
  const [previewArtwork, setPreviewArtwork] = useState<string>(playlist.artwork || '');
  const [urlInput, setUrlInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync initial artwork when playlist changes
  useEffect(() => {
    setPreviewArtwork(playlist.artwork || '');
    setUrlInput('');
  }, [playlist]);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        notify('Please select an image file (JPG, PNG, WebP, GIF)');
        return;
      }

      setIsProcessing(true);
      try {
        const optimized = await optimizePlaylistImage(file, 500, 0.88);
        setPreviewArtwork(optimized);
        notify('Image loaded and optimized');
      } catch (err) {
        console.warn('[EditPlaylistArtworkModal] Failed to process image:', err);
        notify('Could not process this image');
      } finally {
        setIsProcessing(false);
      }
    },
    [notify]
  );

  // Clipboard paste support (Ctrl+V an image anywhere in the modal)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept paste if typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            void processFile(file);
            setTab('upload');
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, processFile]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
    // Reset input so re-selecting the same file fires onChange again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleApplyUrl = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      notify('Please enter an image URL');
      return;
    }
    setIsProcessing(true);
    try {
      const optimized = await optimizePlaylistImage(trimmed, 500, 0.88);
      setPreviewArtwork(optimized);
      notify('Preview updated from URL');
    } catch {
      // If canvas optimization fails due to CORS, still use the direct URL
      setPreviewArtwork(trimmed);
      notify('Image URL applied');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResetToDefault = () => {
    // Revert to first track's artwork if available, or empty string
    const fallback = playlist.tracks?.[0]?.artwork || '';
    setPreviewArtwork(fallback);
    setUrlInput('');
    notify('Reset cover art');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(previewArtwork);
      onClose();
    } catch (err) {
      console.warn('[EditPlaylistArtworkModal] Save failed:', err);
      notify('Failed to save playlist cover');
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanged = previewArtwork !== (playlist.artwork || '');

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 backdrop-blur-md animate-fade-in p-4 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-3xl border border-sc-line bg-sc-panel p-6 shadow-2xl animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-sc-line">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-sc-orange/15 flex items-center justify-center text-sc-orange shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-sc-fg tracking-tight">Change Playlist Cover</h2>
              <p className="text-[12px] text-sc-muted truncate max-w-[260px]">
                {playlist.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="p-1.5 rounded-xl text-sc-muted hover:text-sc-fg hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Artwork Preview & Reset */}
        <div className="py-5 flex flex-col items-center">
          <div className="relative group w-36 h-36 rounded-2xl overflow-hidden bg-sc-panel-2 shadow-xl ring-2 ring-white/10 shrink-0">
            {previewArtwork ? (
              <img
                src={previewArtwork}
                alt="Playlist cover preview"
                className="w-full h-full object-cover"
                onError={() => {
                  notify('Failed to display image from URL');
                }}
              />
            ) : (
              <Artwork
                src={null}
                seed={playlist.id}
                size={300}
                rounded="rounded-2xl"
                className="w-full h-full"
              />
            )}

            {isProcessing && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-sc-orange animate-spin" />
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            {hasChanged && (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[11px] font-semibold border border-emerald-500/30">
                New cover selected
              </span>
            )}
            {previewArtwork && (
              <button
                type="button"
                onClick={handleResetToDefault}
                disabled={isSaving || isProcessing}
                className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-sc-muted hover:text-sc-fg transition-colors cursor-pointer hover:underline"
              >
                <RotateCcw className="w-3 h-3" />
                Reset cover
              </button>
            )}
          </div>
        </div>

        {/* Tab Toggle (File vs URL) */}
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-sc-panel-2 border border-sc-line mb-4">
          <button
            type="button"
            onClick={() => setTab('upload')}
            className={clsx(
              'flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer',
              tab === 'upload'
                ? 'bg-sc-orange text-white shadow-sm'
                : 'text-sc-muted hover:text-sc-fg hover:bg-white/[0.04]'
            )}
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Image
          </button>
          <button
            type="button"
            onClick={() => setTab('url')}
            className={clsx(
              'flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer',
              tab === 'url'
                ? 'bg-sc-orange text-white shadow-sm'
                : 'text-sc-muted hover:text-sc-fg hover:bg-white/[0.04]'
            )}
          >
            <LinkIcon className="w-3.5 h-3.5" />
            Image Link (URL)
          </button>
        </div>

        {/* Tab 1: File Upload & Drag-Drop */}
        {tab === 'upload' && (
          <div className="space-y-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
            />
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={clsx(
                'group flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer',
                isDragOver
                  ? 'border-sc-orange bg-sc-orange/10 scale-[1.01]'
                  : 'border-sc-line hover:border-sc-orange/50 bg-white/[0.02] hover:bg-white/[0.04]'
              )}
            >
              <div className="w-11 h-11 rounded-2xl bg-white/[0.06] flex items-center justify-center text-sc-dim group-hover:text-sc-orange group-hover:scale-110 transition-all duration-150 mb-2">
                <ImageIcon className="w-5 h-5" />
              </div>
              <p className="text-[13px] font-semibold text-sc-fg text-center">
                Click to browse or drag & drop image
              </p>
              <p className="text-[11px] text-sc-muted text-center mt-1">
                PNG, JPG, WebP, GIF • You can also press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white font-mono text-[10px]">Ctrl+V</kbd> to paste
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: URL Input */}
        {tab === 'url' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <LinkIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-sc-dim" />
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleApplyUrl();
                  }}
                  placeholder="https://example.com/cover.jpg"
                  className="w-full bg-sc-panel-2 border border-sc-line rounded-xl pl-9 pr-3 py-2 text-xs text-sc-fg outline-none focus:border-sc-orange focus:ring-1 focus:ring-sc-orange transition-all"
                />
              </div>
              <button
                type="button"
                onClick={handleApplyUrl}
                disabled={!urlInput.trim() || isProcessing}
                className="px-4 py-2 rounded-xl bg-sc-panel-2 border border-sc-line hover:border-sc-orange text-xs font-semibold text-sc-fg hover:text-white transition-all disabled:opacity-50 cursor-pointer shrink-0"
              >
                Apply
              </button>
            </div>
            <p className="text-[11px] text-sc-muted">
              Paste direct image link from Imgur, SoundCloud, Spotify, or any web host.
            </p>
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-end gap-2.5 pt-4 border-t border-sc-line">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-sc-muted hover:text-sc-fg hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isProcessing || !hasChanged}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-sc-orange hover:bg-sc-orange-soft active:scale-95 text-xs font-bold text-white transition-all shadow-lg shadow-sc-orange/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Save Cover</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
