import { Peer, type DataConnection } from 'peerjs';
import type { Track } from '../types';

export interface UserProfile {
  code: string;
  name: string;
  avatarSeed?: string;
}

export interface Friend {
  code: string;
  name: string;
  addedAt: number;
  note?: string;
}

export interface FriendPresence {
  code: string;
  name: string;
  online: boolean;
  lastSeen: number;
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  timestamp: number;
  roomId?: string | null;
}

export type ListenTogetherMessage =
  | {
      type: 'PRESENCE_REQUEST';
      senderCode: string;
    }
  | {
      type: 'PRESENCE_UPDATE';
      senderCode: string;
      senderName: string;
      track: Track | null;
      isPlaying: boolean;
      currentTime: number;
      duration: number;
      timestamp: number;
      roomId?: string | null;
    }
  | {
      type: 'INVITE';
      senderCode: string;
      senderName: string;
      track: Track;
      roomId?: string;
      roomName?: string;
      timestamp: number;
    }
  | {
      type: 'SYNC_COMMAND';
      senderCode: string;
      action: 'PLAY_TRACK' | 'PLAY' | 'PAUSE' | 'SEEK';
      track?: Track;
      currentTime?: number;
      timestamp: number;
      roomId?: string;
    }
  | {
      type: 'ROOM_JOIN';
      senderCode: string;
      senderName: string;
      roomId: string;
    }
  | {
      type: 'ROOM_LEAVE';
      senderCode: string;
      roomId: string;
    }
  | {
      type: 'CHAT_MESSAGE';
      id: string;
      senderCode: string;
      senderName: string;
      text: string;
      timestamp: number;
      roomId: string;
    }
  | {
      type: 'REACTION';
      senderCode: string;
      senderName: string;
      emoji: string;
      timestamp: number;
      roomId?: string;
    };

export interface RoomParticipant {
  code: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
}

export interface SyncSession {
  mode: 'idle' | 'following' | 'room';
  targetCode?: string;
  targetName?: string;
  roomId?: string;
  roomName?: string;
  isHost?: boolean;
  allowGuestsControl?: boolean;
  participants?: RoomParticipant[];
  lastSyncTime?: number;
}

export interface RoomChatMessage {
  id: string;
  senderCode: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface RoomReaction {
  id: string;
  senderName: string;
  emoji: string;
  timestamp: number;
}

export interface IncomingInvite {
  id: string;
  senderCode: string;
  senderName: string;
  track: Track;
  roomId?: string;
  roomName?: string;
  timestamp: number;
}

const PROFILE_KEY = 'abbadon:listen_together:profile';
const FRIENDS_KEY = 'abbadon:listen_together:friends';

export function sanitizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

export function generateFriendCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SC-${rand}`;
}

export function loadProfile(defaultName?: string): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.code === 'string') {
        return {
          code: sanitizeCode(parsed.code),
          name: parsed.name || defaultName || `Listener #${parsed.code.slice(-4)}`,
          avatarSeed: parsed.avatarSeed || parsed.code,
        };
      }
    }
  } catch {
    // fallback
  }

  const newCode = generateFriendCode();
  const profile: UserProfile = {
    code: newCode,
    name: defaultName || `Listener #${newCode.slice(-4)}`,
    avatarSeed: newCode,
  };
  saveProfile(profile);
  return profile;
}

export function saveProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export function loadFriends(): Friend[] {
  try {
    const raw = localStorage.getItem(FRIENDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((f) => ({
          code: sanitizeCode(f.code),
          name: f.name || f.code,
          addedAt: f.addedAt || Date.now(),
          note: f.note,
        }));
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveFriends(friends: Friend[]): void {
  try {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(friends));
  } catch {
    // ignore
  }
}

export function peerIdForCode(code: string): string {
  return `abbadon-listen-${sanitizeCode(code)}`;
}

export function codeFromPeerId(peerId: string): string | null {
  if (peerId.startsWith('abbadon-listen-')) {
    return peerId.slice('abbadon-listen-'.length);
  }
  return null;
}
