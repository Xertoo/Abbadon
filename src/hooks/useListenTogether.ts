import { useCallback, useEffect, useRef, useState } from 'react';
import { Peer, type DataConnection } from 'peerjs';
import type { Track } from '../types';
import {
  type UserProfile,
  type Friend,
  type FriendPresence,
  type ListenTogetherMessage,
  type SyncSession,
  type RoomChatMessage,
  type RoomReaction,
  type IncomingInvite,
  type RoomParticipant,
  loadProfile,
  saveProfile,
  loadFriends,
  saveFriends,
  peerIdForCode,
  codeFromPeerId,
  sanitizeCode,
  generateFriendCode,
} from '../lib/listenTogether';

interface UseListenTogetherOptions {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  defaultUsername?: string;
  defaultAvatarUrl?: string;
  onPlayTrack: (track: Track) => Promise<void> | void;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
  notify: (msg: string) => void;
}

export function useListenTogether({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  defaultUsername,
  defaultAvatarUrl,
  onPlayTrack,
  onPlay,
  onPause,
  onSeek,
  notify,
}: UseListenTogetherOptions) {
  const [profile, setProfileState] = useState<UserProfile>(() =>
    loadProfile(defaultUsername, defaultAvatarUrl)
  );
  const [friends, setFriends] = useState<Friend[]>(() => loadFriends());
  const [presences, setPresences] = useState<Record<string, FriendPresence>>({});
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'error'
  >('connecting');
  const [syncSession, setSyncSession] = useState<SyncSession>({ mode: 'idle' });
  const [incomingInvites, setIncomingInvites] = useState<IncomingInvite[]>([]);
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const [reactions, setReactions] = useState<RoomReaction[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const isSyncApplyingRef = useRef(false);
  const lastBroadcastRef = useRef<{ trackId?: string; isPlaying?: boolean; time?: number }>({});
  const syncSessionRef = useRef(syncSession);
  syncSessionRef.current = syncSession;

  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const friendsRef = useRef(friends);
  friendsRef.current = friends;

  // Auto-sync default username & avatar from SoundCloud if user logged in
  useEffect(() => {
    if (!defaultUsername && !defaultAvatarUrl) return;

    setProfileState((prev) => {
      let changed = false;
      const updated = { ...prev };

      const isGeneratedName = !prev.name || prev.name.startsWith('Listener #');
      if (isGeneratedName && defaultUsername && prev.name !== defaultUsername) {
        updated.name = defaultUsername;
        changed = true;
      }
      if (defaultAvatarUrl && !prev.avatarUrl) {
        updated.avatarUrl = defaultAvatarUrl;
        changed = true;
      }

      if (changed) {
        saveProfile(updated);
        return updated;
      }
      return prev;
    });
  }, [defaultUsername, defaultAvatarUrl]);

  // Track user listening time: accumulates seconds while music is playing
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setProfileState((prev) => {
        const next = {
          ...prev,
          totalListenedSeconds: (prev.totalListenedSeconds || 0) + 1,
        };
        // Persist periodically every 15s to keep localStorage light
        if (next.totalListenedSeconds % 15 === 0) {
          saveProfile(next);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying]);

  // Track play counter: count how many unique songs were played
  const lastTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentTrack && isPlaying && currentTrack.id !== lastTrackIdRef.current) {
      lastTrackIdRef.current = currentTrack.id;
      setProfileState((prev) => {
        const next = {
          ...prev,
          tracksListenedCount: (prev.tracksListenedCount || 0) + 1,
        };
        saveProfile(next);
        return next;
      });
    }
  }, [currentTrack, isPlaying]);

  // Broadcast helper to all connected peers
  const broadcast = useCallback((msg: ListenTogetherMessage) => {
    connectionsRef.current.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send(msg);
        } catch {
          // ignore dead connection
        }
      }
    });
  }, []);

  // Send message to a specific friend code
  const sendToPeer = useCallback((friendCode: string, msg: ListenTogetherMessage) => {
    const conn = connectionsRef.current.get(sanitizeCode(friendCode));
    if (conn && conn.open) {
      try {
        conn.send(msg);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }, []);

  // Flexible updateProfile: handles both (updatesObject) and legacy (name, newCode)
  const updateProfile = useCallback(
    (arg1: Partial<UserProfile> | string, newCode?: string) => {
      setProfileState((prev) => {
        let updated: UserProfile;
        if (typeof arg1 === 'string') {
          const sanitized = newCode ? sanitizeCode(newCode) : prev.code;
          updated = {
            ...prev,
            name: arg1.trim() || prev.name,
            code: sanitized,
          };
        } else {
          const sanitized = arg1.code ? sanitizeCode(arg1.code) : prev.code;
          updated = {
            ...prev,
            ...arg1,
            code: sanitized,
            name: arg1.name?.trim() || prev.name,
          };
        }
        saveProfile(updated);
        // Broadcast profile changes live to all connected friends
        broadcast({
          type: 'PROFILE_UPDATE',
          senderProfile: updated,
        });
        return updated;
      });
      notify('Profile updated');
    },
    [broadcast, notify]
  );

  // Connect to friend by code (and optionally initiate mutual friendship handshake)
  const connectToFriend = useCallback(
    (codeRaw: string, isInitiator = false) => {
      const code = sanitizeCode(codeRaw);
      if (!code || code === profileRef.current.code || !peerRef.current || !peerRef.current.open) {
        return;
      }

      // If already connected and open, just ping
      const existing = connectionsRef.current.get(code);
      if (existing && existing.open) {
        try {
          existing.send({
            type: 'PRESENCE_REQUEST',
            senderCode: profileRef.current.code,
          });
        } catch {
          // ignore
        }
        return;
      }

      const targetPeerId = peerIdForCode(code);
      try {
        const conn = peerRef.current.connect(targetPeerId, {
          reliable: true,
          metadata: {
            profile: profileRef.current,
          },
        });

        conn.on('open', () => {
          connectionsRef.current.set(code, conn);

          // 1. Send FRIEND_HELLO so the other person automatically adds us reciprocally!
          try {
            conn.send({
              type: 'FRIEND_HELLO',
              senderProfile: profileRef.current,
              isResponse: !isInitiator,
            });

            // 2. Send current presence
            conn.send({
              type: 'PRESENCE_UPDATE',
              senderCode: profileRef.current.code,
              senderName: profileRef.current.name,
              avatarUrl: profileRef.current.avatarUrl,
              avatarPreset: profileRef.current.avatarPreset,
              badge: profileRef.current.badge,
              bio: profileRef.current.bio,
              themeColor: profileRef.current.themeColor,
              totalListenedSeconds: profileRef.current.totalListenedSeconds,
              tracksListenedCount: profileRef.current.tracksListenedCount,
              track: currentTrackRef.current,
              isPlaying: isPlayingRef.current,
              currentTime: currentTimeRef.current,
              duration: durationRef.current,
              timestamp: Date.now(),
              roomId: syncSessionRef.current.roomId || null,
            });
          } catch {
            // ignore
          }

          setPresences((prev) => ({
            ...prev,
            [code]: {
              ...(prev[code] || {
                code,
                name: friendsRef.current.find((f) => f.code === code)?.name || code,
                lastSeen: Date.now(),
                track: null,
                isPlaying: false,
                currentTime: 0,
                duration: 0,
                timestamp: Date.now(),
              }),
              online: true,
            },
          }));
        });

        conn.on('data', (data) => {
          handleMessage(data as ListenTogetherMessage, conn);
        });

        conn.on('close', () => {
          connectionsRef.current.delete(code);
          setPresences((prev) => {
            if (!prev[code]) return prev;
            return {
              ...prev,
              [code]: {
                ...prev[code],
                online: false,
                lastSeen: Date.now(),
              },
            };
          });
        });

        conn.on('error', () => {
          connectionsRef.current.delete(code);
          setPresences((prev) => {
            if (!prev[code]) return prev;
            return {
              ...prev,
              [code]: {
                ...prev[code],
                online: false,
                lastSeen: Date.now(),
              },
            };
          });
        });
      } catch {
        // ignore connection attempt failure
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Add friend by code (initiates reciprocal friendship)
  const addFriend = useCallback(
    (codeRaw: string, nameRaw?: string) => {
      const code = sanitizeCode(codeRaw);
      if (!code) {
        notify('Please enter a valid friend code');
        return false;
      }
      if (code === profileRef.current.code) {
        notify('You cannot add your own code');
        return false;
      }
      if (friendsRef.current.some((f) => f.code === code)) {
        notify('This friend is already on your list');
        return false;
      }

      const name = nameRaw?.trim() || `Friend #${code}`;
      const newFriend: Friend = {
        code,
        name,
        addedAt: Date.now(),
      };
      const next = [newFriend, ...friendsRef.current];
      setFriends(next);
      saveFriends(next);
      notify(`Added ${name} to friends`);

      // Immediately connect and send FRIEND_HELLO
      connectToFriend(code, true);
      return true;
    },
    [connectToFriend, notify]
  );

  // Remove friend
  const removeFriend = useCallback(
    (codeRaw: string) => {
      const code = sanitizeCode(codeRaw);
      const next = friendsRef.current.filter((f) => f.code !== code);
      setFriends(next);
      saveFriends(next);

      // Disconnect
      const conn = connectionsRef.current.get(code);
      if (conn) {
        conn.close();
        connectionsRef.current.delete(code);
      }
      setPresences((prev) => {
        const copy = { ...prev };
        delete copy[code];
        return copy;
      });

      // If we were following this friend, stop sync
      if (syncSessionRef.current.mode === 'following' && syncSessionRef.current.targetCode === code) {
        setSyncSession({ mode: 'idle' });
      }

      notify('Friend removed');
    },
    [notify]
  );

  // Rename friend alias
  const renameFriend = useCallback((codeRaw: string, newName: string) => {
    const code = sanitizeCode(codeRaw);
    const next = friendsRef.current.map((f) =>
      f.code === code ? { ...f, name: newName.trim() || f.name } : f
    );
    setFriends(next);
    saveFriends(next);
  }, []);

  // Handle incoming data message from a peer
  const handleMessage = useCallback(
    (msg: ListenTogetherMessage, senderConn: DataConnection) => {
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'FRIEND_HELLO': {
          const sender = msg.senderProfile;
          if (!sender || !sender.code) break;
          const senderCode = sanitizeCode(sender.code);

          // 1. RECIPROCAL FRIENDSHIP: Automatically add sender to friends list if not already added!
          if (!friendsRef.current.some((f) => f.code === senderCode)) {
            const autoFriend: Friend = {
              code: senderCode,
              name: sender.name || `Friend #${senderCode}`,
              avatarUrl: sender.avatarUrl,
              avatarPreset: sender.avatarPreset,
              badge: sender.badge,
              bio: sender.bio,
              themeColor: sender.themeColor,
              addedAt: Date.now(),
            };
            const next = [autoFriend, ...friendsRef.current];
            setFriends(next);
            saveFriends(next);
            notify(`${sender.name || senderCode} connected with you!`);
          }

          // 2. If it was the first hello, reply back so both are guaranteed mutually connected
          if (!msg.isResponse) {
            try {
              senderConn.send({
                type: 'FRIEND_HELLO',
                senderProfile: profileRef.current,
                isResponse: true,
              });
            } catch {
              // ignore
            }
          }

          // 3. Update presence with their full profile info
          setPresences((prev) => ({
            ...prev,
            [senderCode]: {
              ...(prev[senderCode] || {
                code: senderCode,
                name: sender.name || senderCode,
                online: true,
                lastSeen: Date.now(),
                track: null,
                isPlaying: false,
                currentTime: 0,
                duration: 0,
                timestamp: Date.now(),
              }),
              name: sender.name || prev[senderCode]?.name || senderCode,
              avatarUrl: sender.avatarUrl,
              avatarPreset: sender.avatarPreset,
              badge: sender.badge,
              bio: sender.bio,
              themeColor: sender.themeColor,
              totalListenedSeconds: sender.totalListenedSeconds,
              tracksListenedCount: sender.tracksListenedCount,
              online: true,
              lastSeen: Date.now(),
            },
          }));
          break;
        }

        case 'PROFILE_UPDATE': {
          const sender = msg.senderProfile;
          if (!sender || !sender.code) break;
          const senderCode = sanitizeCode(sender.code);

          // Update friend details in list
          setFriends((prev) => {
            const updated = prev.map((f) =>
              f.code === senderCode
                ? {
                    ...f,
                    name: sender.name || f.name,
                    avatarUrl: sender.avatarUrl,
                    avatarPreset: sender.avatarPreset,
                    badge: sender.badge,
                    bio: sender.bio,
                    themeColor: sender.themeColor,
                  }
                : f
            );
            saveFriends(updated);
            return updated;
          });

          // Update presence card
          setPresences((prev) => ({
            ...prev,
            [senderCode]: {
              ...(prev[senderCode] || {
                code: senderCode,
                name: sender.name || senderCode,
                online: true,
                lastSeen: Date.now(),
                track: null,
                isPlaying: false,
                currentTime: 0,
                duration: 0,
                timestamp: Date.now(),
              }),
              name: sender.name || prev[senderCode]?.name || senderCode,
              avatarUrl: sender.avatarUrl,
              avatarPreset: sender.avatarPreset,
              badge: sender.badge,
              bio: sender.bio,
              themeColor: sender.themeColor,
              totalListenedSeconds: sender.totalListenedSeconds,
              tracksListenedCount: sender.tracksListenedCount,
            },
          }));
          break;
        }

        case 'PRESENCE_REQUEST': {
          try {
            senderConn.send({
              type: 'PRESENCE_UPDATE',
              senderCode: profileRef.current.code,
              senderName: profileRef.current.name,
              avatarUrl: profileRef.current.avatarUrl,
              avatarPreset: profileRef.current.avatarPreset,
              badge: profileRef.current.badge,
              bio: profileRef.current.bio,
              themeColor: profileRef.current.themeColor,
              totalListenedSeconds: profileRef.current.totalListenedSeconds,
              tracksListenedCount: profileRef.current.tracksListenedCount,
              track: currentTrackRef.current,
              isPlaying: isPlayingRef.current,
              currentTime: currentTimeRef.current,
              duration: durationRef.current,
              timestamp: Date.now(),
              roomId: syncSessionRef.current.roomId || null,
            });
          } catch {
            // ignore
          }
          break;
        }

        case 'PRESENCE_UPDATE': {
          const senderCode = sanitizeCode(msg.senderCode);
          setPresences((prev) => ({
            ...prev,
            [senderCode]: {
              code: senderCode,
              name: msg.senderName || prev[senderCode]?.name || senderCode,
              avatarUrl: msg.avatarUrl || prev[senderCode]?.avatarUrl,
              avatarPreset: msg.avatarPreset || prev[senderCode]?.avatarPreset,
              badge: msg.badge || prev[senderCode]?.badge,
              bio: msg.bio || prev[senderCode]?.bio,
              themeColor: msg.themeColor || prev[senderCode]?.themeColor,
              totalListenedSeconds: msg.totalListenedSeconds ?? prev[senderCode]?.totalListenedSeconds,
              tracksListenedCount: msg.tracksListenedCount ?? prev[senderCode]?.tracksListenedCount,
              online: true,
              lastSeen: Date.now(),
              track: msg.track,
              isPlaying: msg.isPlaying,
              currentTime: msg.currentTime,
              duration: msg.duration,
              timestamp: msg.timestamp,
              roomId: msg.roomId,
            },
          }));

          // If we are currently following this friend, synchronize with their presence
          const session = syncSessionRef.current;
          if (session.mode === 'following' && session.targetCode === senderCode) {
            applyRemoteState({
              track: msg.track,
              isPlaying: msg.isPlaying,
              currentTime: msg.currentTime,
              timestamp: msg.timestamp,
            });
          }
          break;
        }

        case 'SYNC_COMMAND': {
          const senderCode = sanitizeCode(msg.senderCode);
          const session = syncSessionRef.current;

          const isApplicable =
            (session.mode === 'following' && session.targetCode === senderCode) ||
            (session.mode === 'room' &&
              session.roomId === msg.roomId &&
              (session.isHost ? session.allowGuestsControl : true));

          if (isApplicable) {
            applyRemoteCommand(msg);
          }
          break;
        }

        case 'INVITE': {
          const invite: IncomingInvite = {
            id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            senderCode: sanitizeCode(msg.senderCode),
            senderName: msg.senderName,
            track: msg.track,
            roomId: msg.roomId,
            roomName: msg.roomName,
            timestamp: msg.timestamp,
          };
          setIncomingInvites((prev) => [invite, ...prev.slice(0, 4)]);
          notify(`Invite from ${msg.senderName}: Listen Together!`);
          break;
        }

        case 'ROOM_JOIN': {
          const senderCode = sanitizeCode(msg.senderCode);
          setSyncSession((prev) => {
            if (prev.mode !== 'room' || prev.roomId !== msg.roomId) return prev;
            const existing = prev.participants || [];
            if (existing.some((p) => p.code === senderCode)) return prev;
            const updated: RoomParticipant[] = [
              ...existing,
              {
                code: senderCode,
                name: msg.senderName,
                isHost: false,
                joinedAt: Date.now(),
              },
            ];
            return { ...prev, participants: updated };
          });
          notify(`${msg.senderName} joined the listening room`);

          // If we are host, broadcast current track to newly joined user
          if (syncSessionRef.current.isHost && currentTrackRef.current) {
            try {
              senderConn.send({
                type: 'SYNC_COMMAND',
                senderCode: profileRef.current.code,
                action: 'PLAY_TRACK',
                track: currentTrackRef.current,
                currentTime: currentTimeRef.current,
                timestamp: Date.now(),
                roomId: syncSessionRef.current.roomId,
              });
            } catch {
              // ignore
            }
          }
          break;
        }

        case 'ROOM_LEAVE': {
          const senderCode = sanitizeCode(msg.senderCode);
          setSyncSession((prev) => {
            if (prev.mode !== 'room' || prev.roomId !== msg.roomId) return prev;
            const updated = (prev.participants || []).filter((p) => p.code !== senderCode);
            return { ...prev, participants: updated };
          });
          break;
        }

        case 'CHAT_MESSAGE': {
          const session = syncSessionRef.current;
          if (session.mode === 'room' && session.roomId === msg.roomId) {
            const chatMsg: RoomChatMessage = {
              id: msg.id,
              senderCode: sanitizeCode(msg.senderCode),
              senderName: msg.senderName,
              text: msg.text,
              timestamp: msg.timestamp,
            };
            setChatMessages((prev) => [...prev.slice(-49), chatMsg]);
          }
          break;
        }

        case 'REACTION': {
          const session = syncSessionRef.current;
          if (session.mode === 'room' && session.roomId === msg.roomId) {
            const rx: RoomReaction = {
              id: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              senderName: msg.senderName,
              emoji: msg.emoji,
              timestamp: msg.timestamp,
            };
            setReactions((prev) => [...prev.slice(-15), rx]);
            setTimeout(() => {
              setReactions((prev) => prev.filter((r) => r.id !== rx.id));
            }, 3500);
          }
          break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notify]
  );

  // Apply state from followed peer (smart drift correction and auto-play)
  const applyRemoteState = useCallback(
    (remote: {
      track: Track | null;
      isPlaying: boolean;
      currentTime: number;
      timestamp: number;
    }) => {
      if (isSyncApplyingRef.current) return;
      if (!remote.track) return;

      const transit = Math.max(0, (Date.now() - remote.timestamp) / 1000);
      const targetTime = Math.max(0, remote.currentTime + (remote.isPlaying ? transit : 0));

      const localTrack = currentTrackRef.current;
      const localPlaying = isPlayingRef.current;
      const localTime = currentTimeRef.current;

      // Track change
      if (!localTrack || localTrack.id !== remote.track.id) {
        isSyncApplyingRef.current = true;
        void Promise.resolve(onPlayTrack(remote.track)).finally(() => {
          setTimeout(() => {
            if (targetTime > 0) onSeek(targetTime);
            if (!remote.isPlaying) onPause();
            else onPlay();
            setTimeout(() => {
              isSyncApplyingRef.current = false;
            }, 600);
          }, 500);
        });
        return;
      }

      // Play/Pause sync
      if (remote.isPlaying && !localPlaying) {
        isSyncApplyingRef.current = true;
        onPlay();
        setTimeout(() => {
          isSyncApplyingRef.current = false;
        }, 300);
      } else if (!remote.isPlaying && localPlaying) {
        isSyncApplyingRef.current = true;
        onPause();
        setTimeout(() => {
          isSyncApplyingRef.current = false;
        }, 300);
      }

      // Drift correction: if more than 1.8 seconds apart, adjust
      const drift = Math.abs(localTime - targetTime);
      if (drift > 1.8) {
        isSyncApplyingRef.current = true;
        onSeek(targetTime);
        setTimeout(() => {
          isSyncApplyingRef.current = false;
        }, 300);
      }
    },
    [onPlayTrack, onPlay, onPause, onSeek]
  );

  // Apply explicit command from host/peer
  const applyRemoteCommand = useCallback(
    (cmd: {
      action: 'PLAY_TRACK' | 'PLAY' | 'PAUSE' | 'SEEK';
      track?: Track;
      currentTime?: number;
      timestamp: number;
    }) => {
      if (isSyncApplyingRef.current) return;

      const transit = Math.max(0, (Date.now() - cmd.timestamp) / 1000);
      const targetTime = Math.max(0, (cmd.currentTime || 0) + transit);

      switch (cmd.action) {
        case 'PLAY_TRACK': {
          if (cmd.track) {
            isSyncApplyingRef.current = true;
            void Promise.resolve(onPlayTrack(cmd.track)).finally(() => {
              setTimeout(() => {
                if (targetTime > 0) onSeek(targetTime);
                onPlay();
                setTimeout(() => {
                  isSyncApplyingRef.current = false;
                }, 600);
              }, 500);
            });
          }
          break;
        }

        case 'PLAY': {
          if (!isPlayingRef.current) {
            isSyncApplyingRef.current = true;
            onPlay();
            setTimeout(() => {
              isSyncApplyingRef.current = false;
            }, 300);
          }
          break;
        }

        case 'PAUSE': {
          if (isPlayingRef.current) {
            isSyncApplyingRef.current = true;
            onPause();
            setTimeout(() => {
              isSyncApplyingRef.current = false;
            }, 300);
          }
          break;
        }

        case 'SEEK': {
          isSyncApplyingRef.current = true;
          onSeek(targetTime);
          setTimeout(() => {
            isSyncApplyingRef.current = false;
          }, 300);
          break;
        }
      }
    },
    [onPlayTrack, onPlay, onPause, onSeek]
  );

  // Setup PeerJS instance
  useEffect(() => {
    let active = true;
    const peerId = peerIdForCode(profile.code);

    const peer = new Peer(peerId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
        ],
      },
    });

    peer.on('open', () => {
      if (!active) return;
      setConnectionStatus('connected');
      peerRef.current = peer;

      // Connect to all saved friends
      friendsRef.current.forEach((f) => {
        connectToFriend(f.code);
      });
    });

    // Incoming connection from another peer
    peer.on('connection', (conn) => {
      if (!active) return;
      const remotePeerId = conn.peer;
      const remoteCode = codeFromPeerId(remotePeerId);

      conn.on('open', () => {
        if (remoteCode) {
          connectionsRef.current.set(remoteCode, conn);

          // Greet incoming peer with our profile
          try {
            conn.send({
              type: 'FRIEND_HELLO',
              senderProfile: profileRef.current,
              isResponse: false,
            });

            // Send our current presence
            conn.send({
              type: 'PRESENCE_UPDATE',
              senderCode: profileRef.current.code,
              senderName: profileRef.current.name,
              avatarUrl: profileRef.current.avatarUrl,
              avatarPreset: profileRef.current.avatarPreset,
              badge: profileRef.current.badge,
              bio: profileRef.current.bio,
              themeColor: profileRef.current.themeColor,
              totalListenedSeconds: profileRef.current.totalListenedSeconds,
              tracksListenedCount: profileRef.current.tracksListenedCount,
              track: currentTrackRef.current,
              isPlaying: isPlayingRef.current,
              currentTime: currentTimeRef.current,
              duration: durationRef.current,
              timestamp: Date.now(),
              roomId: syncSessionRef.current.roomId || null,
            });
          } catch {
            // ignore
          }

          setPresences((prev) => ({
            ...prev,
            [remoteCode]: {
              ...(prev[remoteCode] || {
                code: remoteCode,
                name: friendsRef.current.find((f) => f.code === remoteCode)?.name || remoteCode,
                lastSeen: Date.now(),
                track: null,
                isPlaying: false,
                currentTime: 0,
                duration: 0,
                timestamp: Date.now(),
              }),
              online: true,
            },
          }));
        }
      });

      conn.on('data', (data) => {
        handleMessage(data as ListenTogetherMessage, conn);
      });

      conn.on('close', () => {
        if (remoteCode) {
          connectionsRef.current.delete(remoteCode);
          setPresences((prev) => {
            if (!prev[remoteCode]) return prev;
            return {
              ...prev,
              [remoteCode]: {
                ...prev[remoteCode],
                online: false,
                lastSeen: Date.now(),
              },
            };
          });
        }
      });
    });

    peer.on('error', (err) => {
      if (!active) return;
      if (err.type === 'peer-unavailable') {
        return;
      }
      if (err.type === 'unavailable-id') {
        const fallback = generateFriendCode();
        setProfileState((prev) => {
          const next = { ...prev, code: fallback };
          saveProfile(next);
          return next;
        });
        return;
      }
      setConnectionStatus('error');
    });

    peer.on('disconnected', () => {
      if (!active) return;
      setConnectionStatus('disconnected');
      try {
        peer.reconnect();
      } catch {
        // ignore
      }
    });

    return () => {
      active = false;
      try {
        peer.destroy();
      } catch {
        // ignore
      }
    };
  }, [profile.code, connectToFriend, handleMessage]);

  // Periodic heartbeat / retry connecting to offline friends
  useEffect(() => {
    const interval = setInterval(() => {
      if (!peerRef.current || !peerRef.current.open) return;

      // 1. Send periodic presence update to all open connections
      broadcast({
        type: 'PRESENCE_UPDATE',
        senderCode: profileRef.current.code,
        senderName: profileRef.current.name,
        avatarUrl: profileRef.current.avatarUrl,
        avatarPreset: profileRef.current.avatarPreset,
        badge: profileRef.current.badge,
        bio: profileRef.current.bio,
        themeColor: profileRef.current.themeColor,
        totalListenedSeconds: profileRef.current.totalListenedSeconds,
        tracksListenedCount: profileRef.current.tracksListenedCount,
        track: currentTrackRef.current,
        isPlaying: isPlayingRef.current,
        currentTime: currentTimeRef.current,
        duration: durationRef.current,
        timestamp: Date.now(),
        roomId: syncSessionRef.current.roomId || null,
      });

      // 2. Try to reconnect to friends that are disconnected
      friendsRef.current.forEach((f) => {
        const conn = connectionsRef.current.get(f.code);
        if (!conn || !conn.open) {
          connectToFriend(f.code);
        }
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [broadcast, connectToFriend]);

  // Broadcast when local track, playing state changes
  useEffect(() => {
    if (isSyncApplyingRef.current) return;

    const trackChanged = lastBroadcastRef.current.trackId !== currentTrack?.id;
    const playChanged = lastBroadcastRef.current.isPlaying !== isPlaying;

    if (trackChanged || playChanged) {
      lastBroadcastRef.current = {
        trackId: currentTrack?.id,
        isPlaying,
        time: currentTime,
      };

      // 1. Presence update to everyone
      broadcast({
        type: 'PRESENCE_UPDATE',
        senderCode: profile.code,
        senderName: profile.name,
        avatarUrl: profile.avatarUrl,
        avatarPreset: profile.avatarPreset,
        badge: profile.badge,
        bio: profile.bio,
        themeColor: profile.themeColor,
        totalListenedSeconds: profile.totalListenedSeconds,
        tracksListenedCount: profile.tracksListenedCount,
        track: currentTrack,
        isPlaying,
        currentTime,
        duration,
        timestamp: Date.now(),
        roomId: syncSession.roomId || null,
      });

      // 2. If we are room host, broadcast sync command
      const session = syncSessionRef.current;
      if (session.mode === 'room' && (session.isHost || session.allowGuestsControl)) {
        if (trackChanged && currentTrack) {
          broadcast({
            type: 'SYNC_COMMAND',
            senderCode: profile.code,
            action: 'PLAY_TRACK',
            track: currentTrack,
            currentTime,
            timestamp: Date.now(),
            roomId: session.roomId,
          });
        } else if (playChanged) {
          broadcast({
            type: 'SYNC_COMMAND',
            senderCode: profile.code,
            action: isPlaying ? 'PLAY' : 'PAUSE',
            currentTime,
            timestamp: Date.now(),
            roomId: session.roomId,
          });
        }
      }
    }
  }, [currentTrack, isPlaying, currentTime, duration, profile, broadcast, syncSession]);

  // Action: Follow friend (Listen Together)
  const followFriend = useCallback(
    (friendCodeRaw: string) => {
      const friendCode = sanitizeCode(friendCodeRaw);
      const friend = friendsRef.current.find((f) => f.code === friendCode);
      const friendPresence = presences[friendCode];

      if (!friendPresence || !friendPresence.online) {
        notify('Friend is currently offline');
        return;
      }
      if (!friendPresence.track) {
        notify(`${friend?.name || friendCode} is not playing anything right now`);
        return;
      }

      setSyncSession({
        mode: 'following',
        targetCode: friendCode,
        targetName: friend?.name || friendPresence.name || friendCode,
        lastSyncTime: Date.now(),
      });

      // Synchronize immediately
      applyRemoteState({
        track: friendPresence.track,
        isPlaying: friendPresence.isPlaying,
        currentTime: friendPresence.currentTime,
        timestamp: friendPresence.timestamp,
      });

      notify(`Now listening together with ${friend?.name || friendCode}!`);
    },
    [presences, applyRemoteState, notify]
  );

  // Action: Stop sync / Leave session
  const stopSync = useCallback(() => {
    const session = syncSessionRef.current;
    if (session.mode === 'room' && session.roomId) {
      broadcast({
        type: 'ROOM_LEAVE',
        senderCode: profileRef.current.code,
        roomId: session.roomId,
      });
    }

    setSyncSession({ mode: 'idle' });
    notify('Stopped listening together');
  }, [broadcast, notify]);

  // Action: Invite friend to listen together
  const inviteFriend = useCallback(
    (friendCodeRaw: string) => {
      const friendCode = sanitizeCode(friendCodeRaw);
      const friend = friendsRef.current.find((f) => f.code === friendCode);
      if (!currentTrackRef.current) {
        notify('Play a track before sending an invite');
        return;
      }

      const sent = sendToPeer(friendCode, {
        type: 'INVITE',
        senderCode: profileRef.current.code,
        senderName: profileRef.current.name,
        track: currentTrackRef.current,
        roomId: syncSessionRef.current.roomId,
        roomName: syncSessionRef.current.roomName,
        timestamp: Date.now(),
      });

      if (sent) {
        notify(`Sent invite to ${friend?.name || friendCode}!`);
      } else {
        notify(`Could not connect to ${friend?.name || friendCode} (offline)`);
      }
    },
    [sendToPeer, notify]
  );

  // Action: Accept invite
  const acceptInvite = useCallback(
    (invite: IncomingInvite) => {
      setIncomingInvites((prev) => prev.filter((i) => i.id !== invite.id));

      if (invite.roomId) {
        joinRoom(invite.roomId, invite.senderCode, invite.roomName);
      } else {
        followFriend(invite.senderCode);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followFriend]
  );

  // Action: Dismiss invite
  const dismissInvite = useCallback((inviteId: string) => {
    setIncomingInvites((prev) => prev.filter((i) => i.id !== inviteId));
  }, []);

  // Action: Create listening room
  const createRoom = useCallback(
    (name?: string) => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let id = '';
      for (let i = 0; i < 4; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const roomId = `JAM-${id}`;
      const roomName = name?.trim() || `${profileRef.current.name}'s Room`;

      const hostParticipant: RoomParticipant = {
        code: profileRef.current.code,
        name: profileRef.current.name,
        avatarUrl: profileRef.current.avatarUrl,
        avatarPreset: profileRef.current.avatarPreset,
        badge: profileRef.current.badge,
        isHost: true,
        joinedAt: Date.now(),
      };

      setSyncSession({
        mode: 'room',
        roomId,
        roomName,
        isHost: true,
        allowGuestsControl: false,
        participants: [hostParticipant],
        lastSyncTime: Date.now(),
      });

      notify(`Created room: ${roomId}`);
      return roomId;
    },
    [notify]
  );

  // Action: Join listening room
  const joinRoom = useCallback(
    (roomCodeRaw: string, hostCodeRaw?: string, roomName?: string) => {
      const roomId = sanitizeCode(roomCodeRaw);
      const hostCode = hostCodeRaw ? sanitizeCode(hostCodeRaw) : undefined;

      const selfParticipant: RoomParticipant = {
        code: profileRef.current.code,
        name: profileRef.current.name,
        avatarUrl: profileRef.current.avatarUrl,
        avatarPreset: profileRef.current.avatarPreset,
        badge: profileRef.current.badge,
        isHost: false,
        joinedAt: Date.now(),
      };

      setSyncSession({
        mode: 'room',
        roomId,
        roomName: roomName || `Room ${roomId}`,
        isHost: false,
        targetCode: hostCode,
        participants: [selfParticipant],
        lastSyncTime: Date.now(),
      });

      // Broadcast join message to peers
      broadcast({
        type: 'ROOM_JOIN',
        senderCode: profileRef.current.code,
        senderName: profileRef.current.name,
        roomId,
      });

      notify(`Joined room ${roomId}`);
    },
    [broadcast, notify]
  );

  // Action: Send room chat message
  const sendChatMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || syncSession.mode !== 'room' || !syncSession.roomId) return;

      const chatMsg: RoomChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        senderCode: profile.code,
        senderName: profile.name,
        text: trimmed,
        timestamp: Date.now(),
      };

      setChatMessages((prev) => [...prev.slice(-49), chatMsg]);

      broadcast({
        type: 'CHAT_MESSAGE',
        id: chatMsg.id,
        senderCode: profile.code,
        senderName: profile.name,
        text: trimmed,
        timestamp: chatMsg.timestamp,
        roomId: syncSession.roomId,
      });
    },
    [profile, syncSession, broadcast]
  );

  // Action: Send quick reaction
  const sendReaction = useCallback(
    (emoji: string) => {
      const rx: RoomReaction = {
        id: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        senderName: profile.name,
        emoji,
        timestamp: Date.now(),
      };

      setReactions((prev) => [...prev.slice(-15), rx]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== rx.id));
      }, 3500);

      broadcast({
        type: 'REACTION',
        senderCode: profile.code,
        senderName: profile.name,
        emoji,
        timestamp: Date.now(),
        roomId: syncSession.roomId,
      });
    },
    [profile, syncSession, broadcast]
  );

  return {
    profile,
    updateProfile,
    friends,
    presences,
    connectionStatus,
    syncSession,
    incomingInvites,
    chatMessages,
    reactions,
    addFriend,
    removeFriend,
    renameFriend,
    connectToFriend,
    followFriend,
    stopSync,
    inviteFriend,
    acceptInvite,
    dismissInvite,
    createRoom,
    joinRoom,
    sendChatMessage,
    sendReaction,
  };
}
