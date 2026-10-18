import type { Track } from '../types';

export type ProfileThemeColor = 'orange' | 'purple' | 'cyan' | 'emerald' | 'pink' | 'amber';

export interface AvatarPreset {
  id: string;
  name: string;
  icon: string;
  gradient: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'dj', name: 'DJ Hero', icon: '🎧', gradient: 'from-orange-500 to-amber-600' },
  { id: 'neon', name: 'Neon Pulse', icon: '⚡', gradient: 'from-cyan-500 to-blue-600' },
  { id: 'cyber', name: 'Cyber Synth', icon: '👾', gradient: 'from-purple-500 to-pink-600' },
  { id: 'vinyl', name: 'Vinyl Classic', icon: '💿', gradient: 'from-neutral-700 to-neutral-900' },
  { id: 'astral', name: 'Astral Wave', icon: '🌌', gradient: 'from-indigo-600 to-violet-800' },
  { id: 'cat', name: 'Pixel Cat', icon: '🐱', gradient: 'from-pink-500 to-rose-600' },
  { id: 'flame', name: 'Bass Fire', icon: '🔥', gradient: 'from-red-500 to-orange-600' },
  { id: 'lofi', name: 'Lo-Fi Chill', icon: '☕', gradient: 'from-emerald-500 to-teal-700' },
];

export const PROFILE_BADGES = [
  '🎧 Audiophile',
  '🔥 Bass Addict',
  '🌙 Night Owl',
  '👑 Jam Host',
  '☕ Lo-Fi Dreamer',
  '⚡ Synth Rider',
  '💎 Music Explorer',
  '🚀 Beat Conductor',
];

export interface UserProfile {
  code: string;
  name: string;
  avatarUrl?: string;
  avatarPreset?: string;
  badge?: string;
  bio?: string;
  themeColor?: ProfileThemeColor;
  totalListenedSeconds?: number;
  tracksListenedCount?: number;
  appearOffline?: boolean;
  shareWithDiscord?: boolean;
}

export interface Friend {
  code: string;
  name: string;
  avatarUrl?: string;
  avatarPreset?: string;
  badge?: string;
  bio?: string;
  themeColor?: ProfileThemeColor;
  addedAt: number;
  note?: string;
}

export interface FriendPresence {
  code: string;
  name: string;
  avatarUrl?: string;
  avatarPreset?: string;
  badge?: string;
  bio?: string;
  themeColor?: ProfileThemeColor;
  online: boolean;
  lastSeen: number;
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  timestamp: number;
  roomId?: string | null;
  totalListenedSeconds?: number;
  tracksListenedCount?: number;
}

export type ListenTogetherMessage =
  | {
      type: 'FRIEND_HELLO';
      senderProfile: UserProfile;
      isResponse?: boolean;
    }
  | {
      type: 'PROFILE_UPDATE';
      senderProfile: UserProfile;
    }
  | {
      type: 'PRESENCE_REQUEST';
      senderCode: string;
    }
  | {
      type: 'PRESENCE_UPDATE';
      senderCode: string;
      senderName: string;
      avatarUrl?: string;
      avatarPreset?: string;
      badge?: string;
      bio?: string;
      themeColor?: ProfileThemeColor;
      totalListenedSeconds?: number;
      tracksListenedCount?: number;
      appearOffline?: boolean;
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
  avatarUrl?: string;
  avatarPreset?: string;
  badge?: string;
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

export function loadProfile(defaultName?: string, defaultAvatar?: string): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.code === 'string') {
        const isDefaultName = !parsed.name || parsed.name.startsWith('Listener #');
        return {
          code: sanitizeCode(parsed.code),
          name: isDefaultName && defaultName ? defaultName : parsed.name || `Listener #${parsed.code.slice(-4)}`,
          avatarUrl: parsed.avatarUrl || defaultAvatar,
          avatarPreset: parsed.avatarPreset || 'dj',
          badge: parsed.badge || '🎧 Audiophile',
          bio: parsed.bio || 'Vibing to SoundCloud',
          themeColor: parsed.themeColor || 'orange',
          totalListenedSeconds: parsed.totalListenedSeconds || 0,
          tracksListenedCount: parsed.tracksListenedCount || 0,
          appearOffline: Boolean(parsed.appearOffline),
          shareWithDiscord: parsed.shareWithDiscord !== undefined ? Boolean(parsed.shareWithDiscord) : true,
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
    avatarUrl: defaultAvatar,
    avatarPreset: 'dj',
    bio: 'Vibing to SoundCloud',
    themeColor: 'orange',
    totalListenedSeconds: 0,
    tracksListenedCount: 0,
    appearOffline: false,
    shareWithDiscord: true,
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
          avatarUrl: f.avatarUrl,
          avatarPreset: f.avatarPreset,
          badge: f.badge,
          bio: f.bio,
          themeColor: f.themeColor,
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
