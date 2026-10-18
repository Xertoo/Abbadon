import { X, ListMusic, Sparkles, Compass, Plus, Loader2, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import type { Track } from '../types';
import { EqBars } from './Visualizer';

interface Props {
  queue: Track[];
  currentId: string | null;
  onClose: () => void;
  onPlay: (t: Track, q: Track[]) => void;
  onOpenArtist?: (artist: { id: string; username: string; permalinkUrl?: string }) => void;
  onTriggerEndOfQueue?: () => void;
  onAppendSimilar?: () => void;
  onClearQueue?: () => void;
  loadingSimilar?: boolean;
}

export function QueueDrawer({
  queue,
  currentId,
  onClose,
  onPlay,
  onOpenArtist,
  onTriggerEndOfQueue,
  onAppendSimilar,
  onClearQueue,
  loadingSimilar = false,
}: Props) {
  return (
    <aside className="w-80 shrink-0 border-l border-sc-line bg-sc-panel flex flex-col animate-drawer">
      <div className="h-16 flex items-center justify-between px-4 border-b border-sc-line">
        <span className="flex items-center gap-2 text-[13px] font-bold">
          <ListMusic className="w-4 h-4 text-sc-orange" />
          Queue
          {queue.length > 0 && (
            <span className="text-[11px] font-normal text-sc-muted">({queue.length})</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {queue.length > 0 && onClearQueue && (
            <button
              onClick={onClearQueue}
              className="w-8 h-8 rounded-full flex items-center justify-center text-sc-muted hover:text-red-400 hover:bg-sc-fill/6 transition-all duration-150 hover:scale-110 active:scale-90 cursor-pointer"
              title="Clear the queue"
              aria-label="Clear the queue"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onTriggerEndOfQueue && (
            <button
              onClick={onTriggerEndOfQueue}
              disabled={loadingSimilar}
              className="w-8 h-8 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-orange hover:bg-sc-fill/6 transition-all duration-150 hover:scale-110 active:scale-90 cursor-pointer disabled:opacity-40"
              title="Fill the queue (discover similar)"
              aria-label="Fill the queue"
            >
              {loadingSimilar ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sc-orange" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-sc-orange" />
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:bg-sc-fill/6 transition-all duration-150 hover:scale-110 active:scale-90 cursor-pointer"
            aria-label="Close queue"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-2 space-y-0.5">
        {queue.length === 0 && (
          <div className="px-3 py-8 text-center space-y-3">
            <p className="text-[12px] text-sc-dim">
              The queue is empty. Play a track to fill it.
            </p>
            {onTriggerEndOfQueue && (
              <button
                onClick={onTriggerEndOfQueue}
                disabled={loadingSimilar}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold bg-sc-orange/15 hover:bg-sc-orange/25 border border-sc-orange/40 text-sc-orange hover:text-white transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {loadingSimilar ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>Build a Discover queue</span>
              </button>
            )}
          </div>
        )}
        {queue.map((t, i) => {
          const active = t.id === currentId;
          return (
            <div
              key={`${t.id}-${i}`}
              onClick={() => onPlay(t, queue)}
              className={clsx(
                'group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all duration-200 cursor-pointer select-none active:scale-[0.98]',
                active ? 'bg-sc-fill/8 translate-x-1 shadow-xs' : 'hover:bg-sc-fill/4 hover:translate-x-0.5'
              )}
            >
              <div className="w-9 h-9 rounded overflow-hidden bg-sc-panel-2 shrink-0 relative">
                <Artwork src={t.artwork} seed={t.id} size={67} rounded="rounded" className="w-full h-full transition-transform duration-300 group-hover:scale-105" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={clsx(
                    'text-[12.5px] font-semibold truncate',
                    active ? 'text-sc-orange' : 'text-sc-fg'
                  )}
                >
                  {t.title}
                </div>
                <div className="truncate">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenArtist?.({
                        id: t.artistId ?? '',
                        username: t.artist,
                        permalinkUrl: t.artistUrl,
                      });
                    }}
                    className="text-[11px] text-sc-muted hover:text-sc-orange hover:underline transition-colors truncate inline-block max-w-full cursor-pointer"
                    title={`Open ${t.artist}`}
                  >
                    {t.artist}
                  </span>
                </div>
              </div>
              {active ? (
                <EqBars color="#6d5efc" size={12} />
              ) : (
                <span className="text-[11px] tabular-nums text-sc-dim">{t.durationFormatted}</span>
              )}
            </div>
          );
        })}

        {/* End-of-queue section */}
        {queue.length > 0 && (
          <div className="pt-3 pb-2 px-1">
            <div className="rounded-xl border border-dashed border-sc-line bg-sc-fill/3 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[12px] font-bold text-sc-fg">
                  <Sparkles className="w-3.5 h-3.5 text-sc-orange" />
                  End of queue
                </span>
                <span className="text-[10px] text-sc-orange font-bold uppercase tracking-wider bg-sc-orange/10 px-1.5 py-0.5 rounded">
                  Discover
                </span>
              </div>
              <p className="text-[11px] text-sc-muted leading-relaxed">
                Build a queue of similar tracks like Discover does, either at the end or right now:
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                {onAppendSimilar && (
                  <button
                    onClick={onAppendSimilar}
                    disabled={loadingSimilar}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-sc-fill/6 hover:bg-sc-fill/12 border border-sc-line text-sc-fg hover:border-sc-orange/50 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                    title="Append similar tracks to the end of the current queue"
                  >
                    {loadingSimilar ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-sc-orange" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-sc-orange" />
                    )}
                    <span>Add to end</span>
                  </button>
                )}
                {onTriggerEndOfQueue && (
                  <button
                    onClick={onTriggerEndOfQueue}
                    disabled={loadingSimilar}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-sc-orange/15 hover:bg-sc-orange/25 border border-sc-orange/40 text-sc-orange hover:text-white transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                    title="Fill the queue with similar tracks immediately"
                  >
                    {loadingSimilar ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Compass className="w-3.5 h-3.5" />
                    )}
                    <span>Fill queue now</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}