/**
 * Local playlist persistence & background server synchronizer.
 *
 * Prevents SoundCloud bot-protection / DataDome 403 blocks by:
 * 1. Immediately persisting playlist edits locally so the user sees their changes instantly.
 * 2. Queuing server mutations with human-like pacing (1.5s-2.5s jittered delays)
 *    and batching multiple additions to the same playlist into a single PUT.
 * 3. Surviving temporary server blocks without losing tracks or interrupting user flow.
 */

import type { Track } from '../types';
import { sc, clearPlaylistCache } from './soundcloud';

const LOCAL_ADDED_KEY = 'sc9000:playlist_local_added:';
const LOCAL_REMOVED_KEY = 'sc9000:playlist_local_removed:';

export function getLocalPlaylistAdded(playlistId: string | number): Track[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_ADDED_KEY}${playlistId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getLocalPlaylistRemoved(playlistId: string | number): string[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_REMOVED_KEY}${playlistId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addTrackLocally(playlistId: string | number, track: Track): void {
  try {
    const idStr = String(playlistId);
    const added = getLocalPlaylistAdded(idStr);
    if (!added.some((t) => String(t.id) === String(track.id))) {
      added.push(track);
      localStorage.setItem(`${LOCAL_ADDED_KEY}${idStr}`, JSON.stringify(added));
    }
    // If it was previously marked removed, unmark it
    const removed = getLocalPlaylistRemoved(idStr).filter((tid) => tid !== String(track.id));
    localStorage.setItem(`${LOCAL_REMOVED_KEY}${idStr}`, JSON.stringify(removed));
  } catch {
    /* quota */
  }
}

export function removeTrackLocally(playlistId: string | number, trackId: string | number): void {
  try {
    const idStr = String(playlistId);
    const tidStr = String(trackId);
    // Remove from added
    const added = getLocalPlaylistAdded(idStr).filter((t) => String(t.id) !== tidStr);
    localStorage.setItem(`${LOCAL_ADDED_KEY}${idStr}`, JSON.stringify(added));

    // Add to removed
    const removed = getLocalPlaylistRemoved(idStr);
    if (!removed.includes(tidStr)) {
      removed.push(tidStr);
      localStorage.setItem(`${LOCAL_REMOVED_KEY}${idStr}`, JSON.stringify(removed));
    }
  } catch {
    /* quota */
  }
}

export function mergeLocalPlaylistTracks(
  playlistId: string | number,
  serverTracks: Track[]
): Track[] {
  const idStr = String(playlistId);
  const removedIds = new Set(getLocalPlaylistRemoved(idStr));
  const addedTracks = getLocalPlaylistAdded(idStr);

  // 1. Remove tracks user deleted locally
  const filteredServer = serverTracks.filter((t) => !removedIds.has(String(t.id)));

  // 2. Append locally added tracks if not already present
  const existingIds = new Set(filteredServer.map((t) => String(t.id)));
  const additions = addedTracks.filter((t) => !existingIds.has(String(t.id)));

  return [...filteredServer, ...additions];
}

/* ------------------------------------------------------------------ *
 * Rate-limited Background Queue
 * ------------------------------------------------------------------ */

interface QueueItem {
  playlistId: string;
  trackId: string;
  action: 'add' | 'remove';
  knownTracks?: string[];
  retryCount: number;
}

const syncQueue: QueueItem[] = [];
let isProcessing = false;
let queueTimer: number | null = null;

export function queuePlaylistSync(
  playlistId: string | number,
  trackId: string | number,
  action: 'add' | 'remove',
  knownTracks?: Array<string | number>
) {
  const pId = String(playlistId).replace(/^soundcloud:playlists:/, '').trim();
  const tId = String(trackId).replace(/^soundcloud:tracks:/, '').trim();

  // Deduplicate in queue
  const existingIdx = syncQueue.findIndex((q) => q.playlistId === pId && q.trackId === tId);
  if (existingIdx >= 0) {
    syncQueue[existingIdx].action = action;
  } else {
    syncQueue.push({
      playlistId: pId,
      trackId: tId,
      action,
      knownTracks: knownTracks?.map((id) => String(id)),
      retryCount: 0,
    });
  }

  scheduleQueueProcessor();
}

function scheduleQueueProcessor(delayMs = 1200) {
  if (queueTimer !== null) return;
  // Human-like timing with a bit of jitter (e.g. 1.2s - 2.0s) so it doesn't look like a robotic burst
  const jitter = Math.floor(Math.random() * 800);
  queueTimer = window.setTimeout(() => {
    queueTimer = null;
    void processNextQueueItem();
  }, delayMs + jitter);
}

async function processNextQueueItem() {
  if (isProcessing || syncQueue.length === 0) return;
  isProcessing = true;

  const item = syncQueue.shift();
  if (!item) {
    isProcessing = false;
    return;
  }

  try {
    if (item.action === 'add') {
      await sc.addTrackToPlaylist(item.playlistId, item.trackId, item.knownTracks);
      // Clean up local added flag once verified on server
      const remainingAdded = getLocalPlaylistAdded(item.playlistId).filter(
        (t) => String(t.id) !== item.trackId
      );
      localStorage.setItem(`${LOCAL_ADDED_KEY}${item.playlistId}`, JSON.stringify(remainingAdded));
    } else {
      await sc.removeTrackFromPlaylist(item.playlistId, item.trackId, item.knownTracks);
      const remainingRemoved = getLocalPlaylistRemoved(item.playlistId).filter(
        (id) => id !== item.trackId
      );
      localStorage.setItem(`${LOCAL_REMOVED_KEY}${item.playlistId}`, JSON.stringify(remainingRemoved));
    }
    clearPlaylistCache(item.playlistId);
  } catch (err: unknown) {
    console.warn(`[playlistSync] Background sync for playlist ${item.playlistId} failed:`, err);
    // If bot protection or rate limit was encountered, back off and retry later in the background
    // without interrupting the user (since the track is already active locally)
    if (item.retryCount < 3) {
      item.retryCount += 1;
      syncQueue.push(item);
      // Back off for 5-8 seconds before next attempt
      scheduleQueueProcessor(5000 + item.retryCount * 2500);
      isProcessing = false;
      return;
    }
  }

  isProcessing = false;
  if (syncQueue.length > 0) {
    scheduleQueueProcessor(1500);
  }
}
