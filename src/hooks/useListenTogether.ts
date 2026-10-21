import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type IncomingSessionRequest,
  type RoomParticipant,
  loadProfile,
  saveProfile,
  loadFriends,
  saveFriends,
  peerIdForCode,
  codeFromPeerId,
  sanitizeCode,
  generateFriendCode,
  type SharedPlaylist,
  loadCollabPlaylists,
  saveCollabPlaylists,
} from '../lib/listenTogether';
import { recordFriendTrack } from '../lib/stats';

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
  const [incomingSessionRequests, setIncomingSessionRequests] = useState<IncomingSessionRequest[]>([]);
  const [pendingOutgoingRequestTo, setPendingOutgoingRequestTo] = useState<string | null>(null);
  const [incomingInvites, setIncomingInvites] = useState<IncomingInvite[]>([]);
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const [collabPlaylists, setCollabPlaylists] = useState<SharedPlaylist[]>(() => loadCollabPlaylists());
  const collabPlaylistsRef = useRef(collabPlaylists);
  collabPlaylistsRef.current = collabPlaylists;

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const isRemoteApplyingRef = useRef(false);
  const remoteExecutingTrackIdRef = useRef<string | null>(null);
  const processedCommandIdsRef = useRef<Set<string>>(new Set());
  const lastLocalActionTimeRef = useRef(0);
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

  // Track user listening time and tracks listened count:
  // Only counts a track after at least 15 seconds of active playback.
  const currentTrackSecondsRef = useRef<number>(0);
  const creditedTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (currentTrack?.id !== creditedTrackIdRef.current) {
      currentTrackSecondsRef.current = 0;
    }
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      if (currentTrack) {
        currentTrackSecondsRef.current += 1;
        if (currentTrackSecondsRef.current >= 15 && creditedTrackIdRef.current !== currentTrack.id) {
          creditedTrackIdRef.current = currentTrack.id;
          setProfileState((prev) => {
            const next = {
              ...prev,
              tracksListenedCount: (prev.tracksListenedCount || 0) + 1,
            };
            saveProfile(next);
            return next;
          });
        }
      }

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
  }, [isPlaying, currentTrack]);

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
          if (syncSessionRef.current.mode === 'co-listening' && syncSessionRef.current.partnerCode === code) {
            setSyncSession({ mode: 'idle' });
            notify('Friend disconnected. Listening together ended.');
          }
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
          if (syncSessionRef.current.mode === 'co-listening' && syncSessionRef.current.partnerCode === code) {
            setSyncSession({ mode: 'idle' });
            notify('Utracono połączenie. Zakończono wspólne słuchanie.');
          }
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
              appearOffline: Boolean(profileRef.current.appearOffline),
              track: profileRef.current.appearOffline ? null : currentTrackRef.current,
              isPlaying: profileRef.current.appearOffline ? false : isPlayingRef.current,
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
              online: !msg.appearOffline,
              lastSeen: Date.now(),
              track: msg.appearOffline ? null : msg.track,
              isPlaying: msg.appearOffline ? false : msg.isPlaying,
              currentTime: msg.currentTime,
              duration: msg.duration,
              timestamp: msg.timestamp,
              sessionPartnerCode: msg.sessionPartnerCode,
              roomId: msg.roomId,
            },
          }));
          if (msg.track && !msg.appearOffline) {
            recordFriendTrack(senderCode, msg.track);
          }
          // Note: PRESENCE_UPDATE is strictly metadata for friends list.
          // Audio playback and sync is driven solely by explicit SYNC_COMMAND actions
          // to prevent seek feedback loops and infinite buffering.
          break;
        }

        case 'SESSION_REQUEST': {
          const senderCode = sanitizeCode(msg.senderCode);
          const req: IncomingSessionRequest = {
            id: msg.requestId,
            senderCode,
            senderName: msg.senderName,
            senderAvatar: msg.senderAvatar,
            track: msg.track,
            timestamp: msg.timestamp,
          };
          if (msg.track) {
            recordFriendTrack(senderCode, msg.track);
          }
          setIncomingSessionRequests((prev) => [
            req,
            ...prev.filter((r) => r.senderCode !== senderCode),
          ]);
          notify(`🎧 ${msg.senderName} zaprasza Cię do wspólnego słuchania!`);
          break;
        }

        case 'SESSION_ACCEPT': {
          const partnerCode = sanitizeCode(msg.senderCode);
          setPendingOutgoingRequestTo(null);
          setSyncSession({
            mode: 'co-listening',
            partnerCode,
            partnerName: msg.senderName,
            partnerAvatar: msg.senderAvatar,
            lastSyncTime: Date.now(),
          });
          notify(`🎧 ${msg.senderName} zaakceptował zaproszenie! Rozpoczęto wspólne słuchanie.`);

          // If local player already has a track playing, send it to partner so they sync with us
          if (currentTrackRef.current) {
            const cmdId = `${profileRef.current.code}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            sendToPeer(partnerCode, {
              type: 'SYNC_COMMAND',
              commandId: cmdId,
              senderCode: profileRef.current.code,
              action: 'PLAY_TRACK',
              track: currentTrackRef.current,
              currentTime: currentTimeRef.current,
              timestamp: Date.now(),
            });
          } else if (msg.track) {
            // Otherwise if partner had a track, play partner's track
            isRemoteApplyingRef.current = true;
            remoteExecutingTrackIdRef.current = String(msg.track.id);
            lastBroadcastRef.current.trackId = String(msg.track.id);
            void Promise.resolve(onPlayTrack(msg.track)).finally(() => {
              setTimeout(() => {
                onPlay();
                setTimeout(() => {
                  isRemoteApplyingRef.current = false;
                  remoteExecutingTrackIdRef.current = null;
                }, 800);
              }, 350);
            });
          }
          break;
        }

        case 'SESSION_DECLINE': {
          setPendingOutgoingRequestTo(null);
          notify(`${msg.senderName} declined the invitation to listen together.`);
          break;
        }

        case 'SESSION_END': {
          const senderCode = sanitizeCode(msg.senderCode);
          if (syncSessionRef.current.mode === 'co-listening' && syncSessionRef.current.partnerCode === senderCode) {
            setSyncSession({ mode: 'idle' });
            notify(`${msg.senderName} ended the listening session.`);
          }
          break;
        }

        case 'SYNC_COMMAND': {
          const senderCode = sanitizeCode(msg.senderCode);
          const session = syncSessionRef.current;

          // Deduplicate commands
          if (msg.commandId) {
            if (processedCommandIdsRef.current.has(msg.commandId)) break;
            processedCommandIdsRef.current.add(msg.commandId);
            if (processedCommandIdsRef.current.size > 200) {
              const arr = Array.from(processedCommandIdsRef.current);
              processedCommandIdsRef.current = new Set(arr.slice(-100));
            }
          }

          const isApplicable =
            (session.mode === 'co-listening' && session.partnerCode === senderCode) ||
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

        case 'COLLAB_PLAYLIST_INVITE': {
          const pl = msg.playlist;
          setCollabPlaylists((prev) => {
            const next = [pl, ...prev.filter((p) => p.id !== pl.id)];
            saveCollabPlaylists(next);
            return next;
          });
          notify(`${msg.senderName} zaprosił Cię do wspólnej playlisty "${pl.title}"!`);
          break;
        }

        case 'COLLAB_PLAYLIST_UPDATE': {
          const pl = msg.playlist;
          setCollabPlaylists((prev) => {
            const next = prev.map((p) => (p.id === pl.id ? pl : p));
            if (!next.some((p) => p.id === pl.id)) next.push(pl);
            saveCollabPlaylists(next);
            return next;
          });
          break;
        }

        case 'COLLAB_PLAYLIST_ADD_TRACK': {
          const currentList = collabPlaylistsRef.current;
          const target = currentList.find((p) => p.id === msg.playlistId);
          if (target && target.hostCode === profileRef.current.code) {
            const newItem = {
              track: msg.track,
              addedBy: { code: sanitizeCode(msg.senderCode), name: msg.senderName },
              addedAt: Date.now(),
            };
            const updated: SharedPlaylist = {
              ...target,
              items: [...target.items, newItem],
            };
            const next = currentList.map((p) => (p.id === target.id ? updated : p));
            setCollabPlaylists(next);
            saveCollabPlaylists(next);
            notify(`${msg.senderName} dodał "${msg.track.title}" do playlisty "${target.title}"!`);

            // Broadcast updated playlist to all collaborator connections
            target.collaborators.forEach((c) => {
              const conn = connectionsRef.current.get(c.code);
              if (conn && conn.open) {
                try {
                  conn.send({
                    type: 'COLLAB_PLAYLIST_UPDATE',
                    playlist: updated,
                    senderCode: profileRef.current.code,
                    senderName: profileRef.current.name,
                  });
                } catch {}
              }
            });
          }
          break;
        }

        case 'COLLAB_PLAYLIST_REMOVE_TRACK': {
          const currentList = collabPlaylistsRef.current;
          const target = currentList.find((p) => p.id === msg.playlistId);
          if (target && target.hostCode === profileRef.current.code) {
            const updated: SharedPlaylist = {
              ...target,
              items: target.items.filter((item) => String(item.track.id) !== String(msg.trackId)),
            };
            const next = currentList.map((p) => (p.id === target.id ? updated : p));
            setCollabPlaylists(next);
            saveCollabPlaylists(next);

            // Broadcast updated playlist
            target.collaborators.forEach((c) => {
              const conn = connectionsRef.current.get(c.code);
              if (conn && conn.open) {
                try {
                  conn.send({
                    type: 'COLLAB_PLAYLIST_UPDATE',
                    playlist: updated,
                    senderCode: profileRef.current.code,
                    senderName: profileRef.current.name,
                  });
                } catch {}
              }
            });
          }
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


  // Apply explicit command from peer
  const applyRemoteCommand = useCallback(
    async (cmd: {
      action: 'PLAY_TRACK' | 'PLAY' | 'PAUSE' | 'SEEK';
      track?: Track;
      currentTime?: number;
      timestamp: number;
    }) => {
      switch (cmd.action) {
        case 'PLAY_TRACK': {
          if (!cmd.track) return;
          const incomingTrackId = String(cmd.track.id);
          const currentTrackId = currentTrackRef.current ? String(currentTrackRef.current.id) : null;

          // If it's already the same track, avoid re-fetching/re-resolving
          if (currentTrackId === incomingTrackId) {
            if (!isPlayingRef.current) {
              onPlay();
            }
            if (cmd.currentTime !== undefined && Math.abs(currentTimeRef.current - cmd.currentTime) > 3) {
              onSeek(cmd.currentTime);
            }
            return;
          }

          // Lock outbound broadcasts while resolving & loading remote track
          isRemoteApplyingRef.current = true;
          remoteExecutingTrackIdRef.current = incomingTrackId;
          lastBroadcastRef.current.trackId = incomingTrackId;

          try {
            await Promise.resolve(onPlayTrack(cmd.track));
          } catch (err) {
            console.error('[ListenTogether] Failed to play remote track:', err);
          } finally {
            setTimeout(() => {
              const transit = Math.max(0, (Date.now() - cmd.timestamp) / 1000);
              const targetTime = Math.max(0, (cmd.currentTime || 0) + transit);
              if (targetTime > 0.5) {
                onSeek(targetTime);
              }
              onPlay();
              // Maintain lock across React render pass to prevent echo
              setTimeout(() => {
                isRemoteApplyingRef.current = false;
                remoteExecutingTrackIdRef.current = null;
              }, 800);
            }, 350);
          }
          break;
        }

        case 'PLAY': {
          if (!isPlayingRef.current) {
            isRemoteApplyingRef.current = true;
            onPlay();
            setTimeout(() => {
              isRemoteApplyingRef.current = false;
            }, 300);
          }
          break;
        }

        case 'PAUSE': {
          if (isPlayingRef.current) {
            isRemoteApplyingRef.current = true;
            onPause();
            setTimeout(() => {
              isRemoteApplyingRef.current = false;
            }, 300);
          }
          break;
        }

        case 'SEEK': {
          if (cmd.currentTime !== undefined) {
            const transit = Math.max(0, (Date.now() - cmd.timestamp) / 1000);
            const targetTime = Math.max(0, cmd.currentTime + transit);
            isRemoteApplyingRef.current = true;
            onSeek(targetTime);
            setTimeout(() => {
              isRemoteApplyingRef.current = false;
            }, 350);
          }
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
          if (syncSessionRef.current.mode === 'co-listening' && syncSessionRef.current.partnerCode === remoteCode) {
            setSyncSession({ mode: 'idle' });
            notify('Friend disconnected. Listening together ended.');
          }
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
        appearOffline: Boolean(profileRef.current.appearOffline),
        track: profileRef.current.appearOffline ? null : currentTrackRef.current,
        isPlaying: profileRef.current.appearOffline ? false : isPlayingRef.current,
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
    if (isRemoteApplyingRef.current) return;
    if (remoteExecutingTrackIdRef.current && currentTrack?.id === remoteExecutingTrackIdRef.current) {
      return;
    }

    const trackChanged = lastBroadcastRef.current.trackId !== currentTrack?.id;
    const playChanged = lastBroadcastRef.current.isPlaying !== isPlaying;

    if (trackChanged || playChanged) {
      lastBroadcastRef.current = {
        trackId: currentTrack?.id,
        isPlaying,
        time: currentTime,
      };

      // 1. Presence update to everyone (metadata only)
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
        appearOffline: Boolean(profile.appearOffline),
        track: profile.appearOffline ? null : currentTrack,
        isPlaying: profile.appearOffline ? false : isPlaying,
        currentTime,
        duration,
        timestamp: Date.now(),
        sessionPartnerCode: syncSession.mode === 'co-listening' ? syncSession.partnerCode : null,
        roomId: syncSession.roomId || null,
      });

      // 2. Broadcast sync command: ONLY in active co-listening or room where user has control!
      // NEVER in 'idle' mode.
      const session = syncSessionRef.current;
      if (session.mode === 'co-listening' && session.partnerCode) {
        lastLocalActionTimeRef.current = Date.now();
        const cmdId = `${profile.code}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        if (trackChanged && currentTrack) {
          sendToPeer(session.partnerCode, {
            type: 'SYNC_COMMAND',
            commandId: cmdId,
            senderCode: profile.code,
            action: 'PLAY_TRACK',
            track: currentTrack,
            currentTime: 0,
            timestamp: Date.now(),
          });
        } else if (playChanged) {
          sendToPeer(session.partnerCode, {
            type: 'SYNC_COMMAND',
            commandId: cmdId,
            senderCode: profile.code,
            action: isPlaying ? 'PLAY' : 'PAUSE',
            currentTime,
            timestamp: Date.now(),
          });
        }
      } else if (session.mode === 'room' && (session.isHost || session.allowGuestsControl)) {
        const cmdId = `${profile.code}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        if (trackChanged && currentTrack) {
          broadcast({
            type: 'SYNC_COMMAND',
            commandId: cmdId,
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
            commandId: cmdId,
            senderCode: profile.code,
            action: isPlaying ? 'PLAY' : 'PAUSE',
            currentTime,
            timestamp: Date.now(),
            roomId: session.roomId,
          });
        }
      }
    }
  }, [currentTrack, isPlaying, currentTime, duration, profile, broadcast, sendToPeer, syncSession]);

  // Action: Request to Listen Together (Sends session invitation)
  const requestListenTogether = useCallback(
    (friendCodeRaw: string) => {
      const friendCode = sanitizeCode(friendCodeRaw);
      const friend = friendsRef.current.find((f) => f.code === friendCode);
      const friendPresence = presences[friendCode];

      if (!friendPresence || !friendPresence.online) {
        notify('Friend is currently offline');
        return;
      }

      setPendingOutgoingRequestTo(friendCode);

      const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const sent = sendToPeer(friendCode, {
        type: 'SESSION_REQUEST',
        requestId: reqId,
        senderCode: profileRef.current.code,
        senderName: profileRef.current.name,
        senderAvatar: profileRef.current.avatarUrl,
        track: currentTrackRef.current,
        timestamp: Date.now(),
      });

      if (sent) {
        notify(`Sent invitation to listen together to ${friend?.name || friendCode}!`);
      } else {
        setPendingOutgoingRequestTo(null);
        notify(`Could not connect to ${friend?.name || friendCode} (network error)`);
      }
    },
    [presences, sendToPeer, notify]
  );

  // Action: Accept session request
  const acceptSessionRequest = useCallback(
    (requestId: string) => {
      const req = incomingSessionRequests.find((r) => r.id === requestId);
      if (!req) return;

      setIncomingSessionRequests((prev) => prev.filter((r) => r.id !== requestId));
      connectToFriend(req.senderCode);

      setSyncSession({
        mode: 'co-listening',
        partnerCode: req.senderCode,
        partnerName: req.senderName,
        partnerAvatar: req.senderAvatar,
        lastSyncTime: Date.now(),
      });

      sendToPeer(req.senderCode, {
        type: 'SESSION_ACCEPT',
        requestId: req.id,
        senderCode: profileRef.current.code,
        senderName: profileRef.current.name,
        senderAvatar: profileRef.current.avatarUrl,
        track: currentTrackRef.current,
        timestamp: Date.now(),
      });

      notify(`🎧 Listening together with ${req.senderName}! Dual control active.`);

      if (req.track) {
        isRemoteApplyingRef.current = true;
        remoteExecutingTrackIdRef.current = String(req.track.id);
        lastBroadcastRef.current.trackId = String(req.track.id);
        void Promise.resolve(onPlayTrack(req.track)).finally(() => {
          setTimeout(() => {
            onPlay();
            setTimeout(() => {
              isRemoteApplyingRef.current = false;
              remoteExecutingTrackIdRef.current = null;
            }, 800);
          }, 350);
        });
      }
    },
    [incomingSessionRequests, connectToFriend, sendToPeer, notify, onPlayTrack, onPlay]
  );

  // Action: Decline session request
  const declineSessionRequest = useCallback(
    (requestId: string) => {
      const req = incomingSessionRequests.find((r) => r.id === requestId);
      if (!req) return;

      setIncomingSessionRequests((prev) => prev.filter((r) => r.id !== requestId));
      sendToPeer(req.senderCode, {
        type: 'SESSION_DECLINE',
        requestId: req.id,
        senderCode: profileRef.current.code,
        senderName: profileRef.current.name,
      });
      notify('Odrzucono zaproszenie.');
    },
    [incomingSessionRequests, sendToPeer, notify]
  );

  // Action: Cancel outgoing request
  const cancelSessionRequest = useCallback(() => {
    setPendingOutgoingRequestTo(null);
    notify('Anulowano zaproszenie');
  }, [notify]);

  // Action: Broadcast seek explicitly to partner
  const broadcastSeek = useCallback(
    (sec: number) => {
      if (isRemoteApplyingRef.current) return;
      const session = syncSessionRef.current;
      if (session.mode === 'co-listening' && session.partnerCode) {
        lastLocalActionTimeRef.current = Date.now();
        sendToPeer(session.partnerCode, {
          type: 'SYNC_COMMAND',
          commandId: `${profileRef.current.code}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          senderCode: profileRef.current.code,
          action: 'SEEK',
          currentTime: sec,
          timestamp: Date.now(),
        });
      } else if (session.mode === 'room' && (session.isHost || session.allowGuestsControl)) {
        broadcast({
          type: 'SYNC_COMMAND',
          commandId: `${profileRef.current.code}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          senderCode: profileRef.current.code,
          action: 'SEEK',
          currentTime: sec,
          timestamp: Date.now(),
          roomId: session.roomId,
        });
      }
    },
    [sendToPeer, broadcast]
  );

  // Deterministic leader for natural track-end advance in co-listening
  const isAdvanceLeader = useMemo(() => {
    if (syncSession.mode !== 'co-listening' || !syncSession.partnerCode) return true;
    return profile.code.localeCompare(syncSession.partnerCode) <= 0;
  }, [syncSession.mode, syncSession.partnerCode, profile.code]);

  // Action: Follow friend (legacy fallback, redirected to request)
  const followFriend = useCallback(
    (friendCodeRaw: string) => {
      requestListenTogether(friendCodeRaw);
    },
    [requestListenTogether]
  );

  // Action: Stop sync / Leave session
  const stopSync = useCallback(() => {
    const session = syncSessionRef.current;
    if (session.mode === 'co-listening' && session.partnerCode) {
      sendToPeer(session.partnerCode, {
        type: 'SESSION_END',
        senderCode: profileRef.current.code,
        senderName: profileRef.current.name,
      });
    } else if (session.mode === 'room' && session.roomId) {
      broadcast({
        type: 'ROOM_LEAVE',
        senderCode: profileRef.current.code,
        roomId: session.roomId,
      });
    }

    setSyncSession({ mode: 'idle' });
    notify('Zakończono wspólne słuchanie');
  }, [sendToPeer, broadcast, notify]);

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

  const createCollabPlaylist = useCallback(
    (title: string) => {
      const pl: SharedPlaylist = {
        id: `collab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: title.trim() || 'Wspólna Playlista',
        hostCode: profile.code,
        hostName: profile.name,
        items: [],
        createdAt: Date.now(),
        collaborators: [],
      };
      setCollabPlaylists((prev) => {
        const next = [pl, ...prev];
        saveCollabPlaylists(next);
        return next;
      });
      notify(`Utworzono wspólną playlistę: "${pl.title}"`);
      return pl;
    },
    [profile, notify]
  );

  const inviteFriendToCollab = useCallback(
    (playlistId: string, friendCode: string) => {
      const cleanCode = sanitizeCode(friendCode);
      const pl = collabPlaylistsRef.current.find((p) => p.id === playlistId);
      if (!pl) return;

      const friend = friendsRef.current.find((f) => f.code === cleanCode);
      const collaboratorEntry = { code: cleanCode, name: friend?.name || cleanCode };

      // Add to collaborators if not already present
      let updatedPl = pl;
      if (!pl.collaborators.some((c) => c.code === cleanCode)) {
        updatedPl = {
          ...pl,
          collaborators: [...pl.collaborators, collaboratorEntry],
        };
        setCollabPlaylists((prev) => {
          const next = prev.map((p) => (p.id === pl.id ? updatedPl : p));
          saveCollabPlaylists(next);
          return next;
        });
      }

      // Connect and send invite
      connectToFriend(cleanCode);
      const conn = connectionsRef.current.get(cleanCode);
      if (conn && conn.open) {
        conn.send({
          type: 'COLLAB_PLAYLIST_INVITE',
          playlist: updatedPl,
          senderCode: profile.code,
          senderName: profile.name,
        });
        notify(`Sent invitation to ${friend?.name || cleanCode}!`);
      } else {
        setTimeout(() => {
          const c = connectionsRef.current.get(cleanCode);
          if (c && c.open) {
            c.send({
              type: 'COLLAB_PLAYLIST_INVITE',
              playlist: updatedPl,
              senderCode: profile.code,
              senderName: profile.name,
            });
            notify(`Sent invitation to ${friend?.name || cleanCode}!`);
          }
        }, 1200);
      }
    },
    [connectToFriend, profile, notify]
  );

  const addTrackToCollab = useCallback(
    (playlistId: string, track: Track) => {
      const pl = collabPlaylistsRef.current.find((p) => p.id === playlistId);
      if (!pl) return;

      if (pl.hostCode === profile.code) {
        // Host directly adds track
        const newItem = {
          track,
          addedBy: { code: profile.code, name: profile.name },
          addedAt: Date.now(),
        };
        const updated: SharedPlaylist = {
          ...pl,
          items: [...pl.items, newItem],
        };
        setCollabPlaylists((prev) => {
          const next = prev.map((p) => (p.id === pl.id ? updated : p));
          saveCollabPlaylists(next);
          return next;
        });
        notify(`Added "${track.title}" to "${pl.title}"`);

        // Broadcast to collaborators
        pl.collaborators.forEach((c) => {
          const conn = connectionsRef.current.get(c.code);
          if (conn && conn.open) {
            try {
              conn.send({
                type: 'COLLAB_PLAYLIST_UPDATE',
                playlist: updated,
                senderCode: profile.code,
                senderName: profile.name,
              });
            } catch {}
          }
        });
      } else {
        // Collaborator sends request to host
        connectToFriend(pl.hostCode);
        const conn = connectionsRef.current.get(pl.hostCode);
        const sendMsg = () => {
          const c = connectionsRef.current.get(pl.hostCode);
          if (c && c.open) {
            c.send({
              type: 'COLLAB_PLAYLIST_ADD_TRACK',
              playlistId,
              track,
              senderCode: profile.code,
              senderName: profile.name,
            });
            notify(`Sent request to add "${track.title}" to host (${pl.hostName})`);
          } else {
            notify(`Host (${pl.hostName}) is offline - track will sync upon connecting`);
          }
        };

        if (conn && conn.open) {
          sendMsg();
        } else {
          setTimeout(sendMsg, 1200);
        }
      }
    },
    [profile, notify, connectToFriend]
  );

  const removeTrackFromCollab = useCallback(
    (playlistId: string, trackId: string | number) => {
      const pl = collabPlaylistsRef.current.find((p) => p.id === playlistId);
      if (!pl) return;

      if (pl.hostCode === profile.code) {
        const updated: SharedPlaylist = {
          ...pl,
          items: pl.items.filter((item) => String(item.track.id) !== String(trackId)),
        };
        setCollabPlaylists((prev) => {
          const next = prev.map((p) => (p.id === pl.id ? updated : p));
          saveCollabPlaylists(next);
          return next;
        });
        // Broadcast
        pl.collaborators.forEach((c) => {
          const conn = connectionsRef.current.get(c.code);
          if (conn && conn.open) {
            try {
              conn.send({
                type: 'COLLAB_PLAYLIST_UPDATE',
                playlist: updated,
                senderCode: profile.code,
                senderName: profile.name,
              });
            } catch {}
          }
        });
      } else {
        // Send removal request to host
        const conn = connectionsRef.current.get(pl.hostCode);
        if (conn && conn.open) {
          conn.send({
            type: 'COLLAB_PLAYLIST_REMOVE_TRACK',
            playlistId,
            trackId,
            senderCode: profile.code,
            senderName: profile.name,
          });
        }
      }
    },
    [profile]
  );

  const deleteCollabPlaylist = useCallback((playlistId: string) => {
    setCollabPlaylists((prev) => {
      const next = prev.filter((p) => p.id !== playlistId);
      saveCollabPlaylists(next);
      return next;
    });
  }, []);

  return {
    profile,
    updateProfile,
    friends,
    presences,
    connectionStatus,
    syncSession,
    incomingSessionRequests,
    pendingOutgoingRequestTo,
    incomingInvites,
    chatMessages,
    reactions,
    collabPlaylists,
    createCollabPlaylist,
    inviteFriendToCollab,
    addTrackToCollab,
    removeTrackFromCollab,
    deleteCollabPlaylist,
    addFriend,
    removeFriend,
    renameFriend,
    connectToFriend,
    followFriend,
    requestListenTogether,
    acceptSessionRequest,
    declineSessionRequest,
    cancelSessionRequest,
    broadcastSeek,
    isAdvanceLeader,
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
