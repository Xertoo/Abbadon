/**
 * Left-side playlist ordering.
 *
 * SoundCloud's `/users/:id/playlists` has no ordering endpoint, so the order
 * lives here: a list of playlist ids the user dragged into place, applied on top
 * of whatever the API returned. Ids the user has not seen yet keep their
 * original relative position at the end, and ids that disappear from the account
 * are pruned, so the list never accumulates ghosts.
 */

import type { Playlist } from '../types';

/** Applies a saved id order to a freshly fetched list. */
export function applyOrder(order: string[], playlists: Playlist[]): Playlist[] {
  if (!order.length) return playlists;
  const rank = new Map(order.map((id, i) => [id, i]));
  const known = playlists.filter((p) => rank.has(p.id));
  const rest = playlists.filter((p) => !rank.has(p.id));
  known.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...known, ...rest];
}

/**
 * The id order to store after a move.
 *
 * Written as the full resulting id list rather than a patch, so a playlist that
 * disappears from the account drops out of storage on the next reorder instead
 * of lingering forever.
 */
export function orderFrom(next: Playlist[]): string[] {
  return next.map((p) => p.id);
}

/** Moves one entry and returns the new array. Out-of-range indices are a no-op. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}