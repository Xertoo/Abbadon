import React, { useState, useMemo, useRef } from 'react';
import {
  Users,
  Radio,
  Copy,
  Check,
  UserPlus,
  Headphones,
  Sparkles,
  Share2,
  Trash2,
  MessageSquare,
  Send,
  RefreshCw,
  Music,
  LogOut,
  X,
  Palette,
  Clock,
  Flame,
  Activity,
  SlidersHorizontal,
  Upload,
  Eye,
  EyeOff,
  Play,
  Volume2,
} from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import { fmtTime } from '../lib/soundcloud';
import type { Track, User } from '../types';
import {
  type UserProfile,
  type Friend,
  type FriendPresence,
  type SyncSession,
  type RoomChatMessage,
  type RoomReaction,
  type IncomingInvite,
  type ProfileThemeColor,
  AVATAR_PRESETS,
} from '../lib/listenTogether';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  updateProfile: (updates: Partial<UserProfile> | string, newCode?: string) => void;
  friends: Friend[];
  presences: Record<string, FriendPresence>;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  syncSession: SyncSession;
  incomingInvites: IncomingInvite[];
  chatMessages: RoomChatMessage[];
  reactions: RoomReaction[];
  currentTrack: Track | null;
  isPlaying: boolean;
  soundCloudUser?: User | null;
  onAddFriend: (code: string, name?: string) => boolean;
  onRemoveFriend: (code: string) => void;
  onRenameFriend: (code: string, newName: string) => void;
  onFollowFriend: (code: string) => void;
  onStopSync: () => void;
  onInviteFriend: (code: string) => void;
  onAcceptInvite: (invite: IncomingInvite) => void;
  onDismissInvite: (id: string) => void;
  onCreateRoom: (name?: string) => string;
  onJoinRoom: (roomId: string) => void;
  onSendChatMessage: (text: string) => void;
  onSendReaction: (emoji: string) => void;
  onConnectToFriend: (code: string) => void;
}

export function FriendsPopover({
  isOpen,
  onClose,
  profile,
  updateProfile,
  friends,
  presences,
  connectionStatus,
  syncSession,
  incomingInvites,
  chatMessages,
  reactions,
  currentTrack,
  isPlaying,
  soundCloudUser,
  onAddFriend,
  onRemoveFriend,
  onRenameFriend,
  onFollowFriend,
  onStopSync,
  onInviteFriend,
  onAcceptInvite,
  onDismissInvite,
  onCreateRoom,
  onJoinRoom,
  onSendChatMessage,
  onSendReaction,
  onConnectToFriend,
}: Props) {
  const [activeTab, setActiveTab] = useState<'friends' | 'room' | 'profile'>('friends');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [friendNameInput, setFriendNameInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.name);
  const [bioDraft, setBioDraft] = useState(profile.bio || '');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const onlineFriends = useMemo(() => {
    return friends.filter((f) => presences[f.code]?.online);
  }, [friends, presences]);

  const offlineFriends = useMemo(() => {
    return friends.filter((f) => !presences[f.code]?.online);
  }, [friends, presences]);

  if (!isOpen) return null;

  const copyCode = () => {
    navigator.clipboard.writeText(profile.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyDiscordInvite = () => {
    const inviteText = `🎵 Join my music session on Abbadon!\n• Already installed? abbadon://friend/${profile.code}\n• Download app: https://github.com/Xertoo/abbadon/releases\n• Friend Code: ${profile.code}`;
    navigator.clipboard.writeText(inviteText);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  const handleAddFriend = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    if (!friendCodeInput.trim()) return;
    const ok = onAddFriend(friendCodeInput.trim(), friendNameInput.trim() || undefined);
    if (ok) {
      setFriendCodeInput('');
      setFriendNameInput('');
      setStatusMessage('Friend added! Connecting...');
      setTimeout(() => setStatusMessage(null), 3000);
    } else {
      setAddError('Cannot add yourself or code already in friends.');
    }
  };

  const handleSaveProfile = () => {
    updateProfile({
      name: nameDraft.trim() || profile.name,
      bio: bioDraft.trim(),
    });
    setEditingName(false);
    setStatusMessage('Profile updated!');
    setTimeout(() => setStatusMessage(null), 2500);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setStatusMessage('Please select an image file (PNG, JPG, WEBP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Compress image onto a small 160x160 canvas for lightweight P2P transport
        const canvas = document.createElement('canvas');
        const maxDim = 160;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
          updateProfile({ avatarUrl: compressedDataUrl });
          setStatusMessage('Profile photo updated!');
          setTimeout(() => setStatusMessage(null), 2500);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  };

  const handleUseSoundCloudPhoto = () => {
    if (!soundCloudUser) return;
    updateProfile({
      name: soundCloudUser.username,
      avatarUrl: soundCloudUser.avatarUrl,
    });
    setNameDraft(soundCloudUser.username);
    setStatusMessage('Restored SoundCloud identity!');
    setTimeout(() => setStatusMessage(null), 2500);
  };

  const formatListenedTime = (seconds: number) => {
    if (!seconds || seconds < 60) return `${seconds || 0}s`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${remM}m`;
  };

  const activePreset = AVATAR_PRESETS.find((p) => p.id === profile.avatarPreset) || AVATAR_PRESETS[0];

  return (
    <>
      {/* Invisible backdrop to dismiss popover when clicking anywhere else */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] animate-fade-in"
        onClick={onClose}
      />

      {/* Floating Popover anchored at top-right */}
      <div
        role="dialog"
        aria-label="Friends and Activity"
        className="absolute top-16 right-4 sm:right-6 z-50 w-[380px] max-w-[calc(100vw-24px)] max-h-[85vh] flex flex-col rounded-3xl border border-white/[0.1] bg-sc-panel/95 backdrop-blur-2xl shadow-[0_16px_40px_rgba(0,0,0,0.6)] animate-popover overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 border-b border-white/[0.06] flex items-center justify-between shrink-0 bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sc-orange/15 text-sc-orange flex items-center justify-center font-bold">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-sc-fg tracking-tight">Friends & Activity</h3>
                <span
                  className={clsx(
                    'w-2 h-2 rounded-full',
                    profile.appearOffline
                      ? 'bg-neutral-500'
                      : connectionStatus === 'connected'
                        ? 'bg-emerald-500 animate-pulse'
                        : 'bg-amber-500'
                  )}
                  title={
                    profile.appearOffline
                      ? 'Invisible (Appearing offline)'
                      : connectionStatus === 'connected'
                        ? 'Connected to P2P network'
                        : 'Connecting...'
                  }
                />
              </div>
              <p className="text-[11px] text-sc-muted">
                {onlineFriends.length} online · {friends.length} total
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Quick Appear Offline Toggle */}
            <button
              onClick={() => updateProfile({ appearOffline: !profile.appearOffline })}
              title={profile.appearOffline ? 'You appear offline. Click to appear online.' : 'Appear offline (invisible)'}
              className={clsx(
                'px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer',
                profile.appearOffline
                  ? 'bg-neutral-700/60 text-neutral-300 border border-white/10'
                  : 'bg-white/5 text-sc-muted hover:text-sc-fg border border-white/5'
              )}
            >
              {profile.appearOffline ? <EyeOff className="w-3 h-3 text-neutral-400" /> : <Eye className="w-3 h-3 text-emerald-400" />}
              <span>{profile.appearOffline ? 'Invisible' : 'Online'}</span>
            </button>

            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:bg-white/5 transition-all cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Toast Notification inside popover */}
        {statusMessage && (
          <div className="px-4 py-2 bg-sc-orange/15 border-b border-sc-orange/20 text-sc-orange text-xs font-semibold flex items-center gap-2 animate-fade-in shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Incoming Invites Alert */}
        {incomingInvites.length > 0 && (
          <div className="p-3 bg-sc-orange/10 border-b border-sc-orange/20 shrink-0 space-y-2">
            {incomingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-sc-orange">{invite.senderName}</span>
                  <span className="text-sc-muted"> invites you to listen: </span>
                  <p className="font-semibold text-sc-fg truncate">{invite.track.title}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onAcceptInvite(invite)}
                    className="px-2.5 py-1 rounded-lg bg-sc-orange text-sc-on-accent text-[11px] font-bold hover:scale-105 active:scale-95 transition-all cursor-pointer"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onDismissInvite(invite.id)}
                    className="w-6 h-6 rounded-lg text-sc-muted hover:text-sc-fg hover:bg-white/5 flex items-center justify-center text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06] bg-black/20 shrink-0 px-2 pt-1.5">
          <button
            onClick={() => setActiveTab('friends')}
            className={clsx(
              'flex-1 py-2 text-xs font-bold transition-all relative flex items-center justify-center gap-1.5 cursor-pointer',
              activeTab === 'friends'
                ? 'text-sc-fg'
                : 'text-sc-muted hover:text-sc-fg'
            )}
          >
            <Users className="w-3.5 h-3.5 text-sc-orange" />
            <span>Activity</span>
            {onlineFriends.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-sc-orange text-white font-extrabold">
                {onlineFriends.length}
              </span>
            )}
            {activeTab === 'friends' && (
              <span className="absolute bottom-0 inset-x-2 h-0.5 bg-sc-orange rounded-full" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('room')}
            className={clsx(
              'flex-1 py-2 text-xs font-bold transition-all relative flex items-center justify-center gap-1.5 cursor-pointer',
              activeTab === 'room'
                ? 'text-sc-fg'
                : 'text-sc-muted hover:text-sc-fg'
            )}
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>Jam Room</span>
            {syncSession.mode === 'room' && (
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            )}
            {activeTab === 'room' && (
              <span className="absolute bottom-0 inset-x-2 h-0.5 bg-cyan-400 rounded-full" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('profile')}
            className={clsx(
              'flex-1 py-2 text-xs font-bold transition-all relative flex items-center justify-center gap-1.5 cursor-pointer',
              activeTab === 'profile'
                ? 'text-sc-fg'
                : 'text-sc-muted hover:text-sc-fg'
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-purple-400" />
            <span>My Profile</span>
            {activeTab === 'profile' && (
              <span className="absolute bottom-0 inset-x-2 h-0.5 bg-purple-400 rounded-full" />
            )}
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-4">
          {/* TAB 1: FRIENDS & ACTIVITY */}
          {activeTab === 'friends' && (
            <div className="space-y-4">
              {/* Quick Add Friend Bar */}
              <form onSubmit={handleAddFriend} className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={friendCodeInput}
                    onChange={(e) => setFriendCodeInput(e.target.value.toUpperCase())}
                    placeholder="Enter Friend Code (e.g. SC-98AB)"
                    className="flex-1 px-3 py-1.5 rounded-xl bg-black/30 border border-white/[0.08] text-xs font-mono tracking-wider text-sc-fg placeholder:text-sc-dim focus:outline-none focus:border-sc-orange/60"
                  />
                  <button
                    type="submit"
                    disabled={!friendCodeInput.trim()}
                    className="px-3 py-1.5 rounded-xl bg-sc-orange text-sc-on-accent text-xs font-bold hover:scale-105 active:scale-95 disabled:opacity-30 transition-all cursor-pointer shrink-0"
                  >
                    Add
                  </button>
                </div>
                {addError && <p className="text-[11px] text-red-400">{addError}</p>}
              </form>

              {/* Online Friends / Live Activity */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-sc-muted uppercase tracking-wider">
                  <span>Live Friend Activity ({onlineFriends.length})</span>
                </div>

                {onlineFriends.length === 0 ? (
                  <div className="p-4 rounded-2xl border border-dashed border-white/[0.08] bg-black/10 text-center space-y-1.5">
                    <p className="text-xs text-sc-muted">No friends online right now.</p>
                    <p className="text-[11px] text-sc-dim">
                      Share your code <span className="font-mono text-sc-orange">{profile.code}</span> with friends to listen together!
                    </p>
                  </div>
                ) : (
                  onlineFriends.map((f) => {
                    const presence = presences[f.code];
                    const friendTrack = presence?.track;
                    const isFriendPlaying = Boolean(presence?.isPlaying);
                    const currentPos = presence?.currentTime ?? 0;
                    const trackDur = presence?.duration || friendTrack?.duration || 0;
                    const progressPct = trackDur > 0 ? Math.min(100, Math.max(0, (currentPos / trackDur) * 100)) : 0;
                    const isFollowingThisFriend = syncSession.mode === 'following' && syncSession.targetCode === f.code;

                    return (
                      <div
                        key={f.code}
                        className={clsx(
                          'p-3 rounded-2xl border transition-all duration-200 space-y-2.5 bg-black/25',
                          isFollowingThisFriend
                            ? 'border-sc-orange/60 shadow-[0_4px_16px_rgba(var(--sc-accent-rgb,255,102,0),0.15)] ring-1 ring-sc-orange/40'
                            : 'border-white/[0.06] hover:border-white/[0.12]'
                        )}
                      >
                        {/* Friend Identity Row */}
                        <div className="flex items-center justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            {/* Avatar */}
                            <div className="relative shrink-0">
                              {presence?.avatarUrl ? (
                                <img
                                  src={presence.avatarUrl}
                                  alt={f.name}
                                  className="w-9 h-9 rounded-full object-cover ring-1 ring-white/10"
                                />
                              ) : (
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sc-orange to-purple-600 flex items-center justify-center text-sm font-bold shadow-sm">
                                  {f.name.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-sc-panel" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-sc-fg truncate">{presence?.name || f.name}</p>
                              <p className="text-[10px] text-sc-muted truncate">
                                {presence?.bio || 'Listening on Abbadon'}
                              </p>
                            </div>
                          </div>

                          {/* Quick Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            {isFollowingThisFriend ? (
                              <button
                                onClick={onStopSync}
                                className="px-2 py-1 rounded-lg bg-sc-orange text-sc-on-accent text-[10px] font-bold hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center gap-1"
                              >
                                <Headphones className="w-3 h-3" />
                                <span>Syncing</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => onFollowFriend(f.code)}
                                disabled={!friendTrack}
                                title={friendTrack ? `Listen along with ${f.name}` : 'Friend is not playing anything'}
                                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-sc-orange hover:text-sc-on-accent text-sc-muted text-[10px] font-bold transition-all disabled:opacity-30 cursor-pointer flex items-center gap-1"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>Listen</span>
                              </button>
                            )}

                            <button
                              onClick={() => onRemoveFriend(f.code)}
                              title="Remove friend"
                              className="w-6 h-6 rounded-lg text-sc-dim hover:text-red-400 hover:bg-white/5 flex items-center justify-center transition-all cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Track Being Listened To */}
                        {friendTrack ? (
                          <div className="p-2.5 rounded-xl bg-black/40 border border-white/[0.04] space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Artwork
                                src={friendTrack.artwork}
                                seed={friendTrack.id}
                                size={80}
                                rounded="rounded-lg"
                                className="w-8 h-8 shrink-0 shadow-sm"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-[11.5px] font-bold text-sc-fg truncate">{friendTrack.title}</p>
                                <p className="text-[10px] text-sc-muted truncate">{friendTrack.artist}</p>
                              </div>
                              {isFriendPlaying && (
                                <div className="flex items-end gap-0.5 h-3 shrink-0 ml-1">
                                  <span className="w-0.5 bg-sc-orange rounded-full animate-eq-1" />
                                  <span className="w-0.5 bg-sc-orange rounded-full animate-eq-2" />
                                  <span className="w-0.5 bg-sc-orange rounded-full animate-eq-3" />
                                </div>
                              )}
                            </div>

                            {/* Live scrubber display */}
                            <div className="space-y-1">
                              <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-sc-orange to-purple-500 rounded-full transition-all duration-300"
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[9px] tabular-nums text-sc-dim font-mono">
                                <span>{fmtTime(currentPos)}</span>
                                <span>{fmtTime(trackDur)}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-sc-dim italic px-1">
                            Browsing music / Idle
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Offline Friends */}
              {offlineFriends.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-white/[0.04]">
                  <span className="text-[11px] font-bold text-sc-dim uppercase tracking-wider">
                    Offline ({offlineFriends.length})
                  </span>
                  <div className="space-y-1">
                    {offlineFriends.map((f) => (
                      <div
                        key={f.code}
                        className="px-2.5 py-2 rounded-xl flex items-center justify-between hover:bg-white/[0.02] text-xs text-sc-muted"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-neutral-600 shrink-0" />
                          <span className="truncate">{f.name}</span>
                          <span className="text-[10px] text-sc-dim font-mono">({f.code})</span>
                        </div>
                        <button
                          onClick={() => onRemoveFriend(f.code)}
                          title="Remove friend"
                          className="text-sc-dim hover:text-red-400 p-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: JAM ROOM */}
          {activeTab === 'room' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-black/30 border border-white/[0.06] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-sc-fg">Synchronized Jam Room</h4>
                    <p className="text-[11px] text-sc-muted">
                      {syncSession.mode === 'room'
                        ? `Connected to Room: ${syncSession.roomName || syncSession.roomId}`
                        : 'Host a live room or join a friend’s room to listen simultaneously.'}
                    </p>
                  </div>
                  {syncSession.mode === 'room' && (
                    <button
                      onClick={onStopSync}
                      className="px-2 py-1 rounded-lg bg-red-500/20 text-red-300 text-[11px] font-bold hover:bg-red-500/30 transition-all cursor-pointer"
                    >
                      Leave
                    </button>
                  )}
                </div>

                {syncSession.mode !== 'room' ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onCreateRoom()}
                      className="flex-1 py-2 rounded-xl bg-sc-orange text-sc-on-accent text-xs font-bold hover:scale-[1.02] active:scale-98 transition-all cursor-pointer shadow-sm"
                    >
                      Host Jam Room
                    </button>
                    <div className="flex-1 flex gap-1">
                      <input
                        type="text"
                        value={roomCodeInput}
                        onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                        placeholder="Room Code"
                        className="w-full px-2.5 py-1.5 rounded-xl bg-black/40 border border-white/[0.08] text-xs font-mono text-sc-fg"
                      />
                      <button
                        onClick={() => {
                          if (roomCodeInput.trim()) onJoinRoom(roomCodeInput.trim());
                        }}
                        disabled={!roomCodeInput.trim()}
                        className="px-3 py-1.5 rounded-xl bg-cyan-600 text-white text-xs font-bold hover:scale-105 active:scale-95 disabled:opacity-30 cursor-pointer"
                      >
                        Join
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 rounded-xl bg-black/40 border border-white/[0.04]">
                      <span className="text-[11px] text-sc-muted">Room Code:</span>
                      <button
                        onClick={() => {
                          if (syncSession.roomId) navigator.clipboard.writeText(syncSession.roomId);
                          setStatusMessage('Room code copied!');
                          setTimeout(() => setStatusMessage(null), 2000);
                        }}
                        className="flex items-center gap-1 text-xs font-mono font-bold text-sc-orange hover:underline cursor-pointer"
                      >
                        <span>{syncSession.roomId}</span>
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat & Reactions */}
              {syncSession.mode === 'room' && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                    {['🔥', '❤️', '🎧', '⚡', '🙌', '✨', '🕺'].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => onSendReaction(emoji)}
                        className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 active:scale-90 transition-all text-sm cursor-pointer"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>

                  <div className="h-44 rounded-2xl bg-black/40 border border-white/[0.06] p-2.5 overflow-y-auto scroll-thin space-y-1.5 text-xs">
                    {chatMessages.length === 0 ? (
                      <p className="text-[11px] text-sc-dim italic text-center py-8">
                        No messages yet. Say hello to everyone!
                      </p>
                    ) : (
                      chatMessages.map((msg) => (
                        <div key={msg.id} className="leading-relaxed">
                          <span className="font-bold text-sc-orange">{msg.senderName}: </span>
                          <span className="text-sc-fg">{msg.text}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (chatInput.trim()) {
                        onSendChatMessage(chatInput.trim());
                        setChatInput('');
                      }
                    }}
                    className="flex gap-1.5"
                  >
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Send message to room..."
                      className="flex-1 px-3 py-1.5 rounded-xl bg-black/30 border border-white/[0.08] text-xs text-sc-fg placeholder:text-sc-dim focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim()}
                      className="p-2 rounded-xl bg-cyan-600 text-white disabled:opacity-30 hover:scale-105 active:scale-95 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MY PROFILE & CUSTOMIZATION */}
          {activeTab === 'profile' && (
            <div className="space-y-4">
              {/* Profile Card Preview */}
              <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.08] space-y-3">
                <div className="flex items-center gap-3">
                  <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    {profile.avatarUrl ? (
                      <img
                        src={profile.avatarUrl}
                        alt={profile.name}
                        className="w-14 h-14 rounded-2xl object-cover ring-2 ring-sc-orange/50 shadow-md"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sc-orange to-purple-600 flex items-center justify-center text-xl font-bold shadow-md">
                        {profile.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold transition-opacity">
                      Change
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-sm font-bold text-sc-fg truncate">{profile.name}</h4>
                    </div>
                    <p className="text-[11px] text-sc-muted truncate mt-0.5">
                      {profile.bio || 'Vibing to SoundCloud'}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-sc-dim">
                      <span>{formatListenedTime(profile.totalListenedSeconds || 0)} listened</span>
                      <span>·</span>
                      <span>{profile.tracksListenedCount || 0} tracks</span>
                    </div>
                  </div>
                </div>

                {/* My Friend Code & Discord Invite Button */}
                <div className="pt-2 border-t border-white/[0.04] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-sc-muted">Your Friend Code:</span>
                    <button
                      onClick={copyCode}
                      className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-sc-orange font-mono font-bold flex items-center gap-1 cursor-pointer transition-all"
                    >
                      <span>{profile.code}</span>
                      {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>

                  <button
                    onClick={copyDiscordInvite}
                    className="w-full py-2 rounded-xl bg-[#5865F2]/20 hover:bg-[#5865F2]/30 text-[#8592ff] text-xs font-bold flex items-center justify-center gap-2 border border-[#5865F2]/30 transition-all cursor-pointer active:scale-98"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{copiedInvite ? 'Copied Invite to Clipboard!' : 'Copy Invite for Discord'}</span>
                  </button>

                  {/* Discord Presence Mode */}
                  <div className="p-2.5 rounded-xl bg-[#5865F2]/10 border border-[#5865F2]/20 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#5865F2] shrink-0" />
                        <span className="text-xs font-bold text-sc-fg">
                          {profile.shareWithDiscord ? 'PC GameSDK Join Mode' : 'Universal Profile Buttons'}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-sc-muted leading-tight mt-0.5">
                        {profile.shareWithDiscord
                          ? 'Shows native PC Join button for Discord Desktop friends (replaces URL buttons).'
                          : 'Shows [Join on Abbadon] & [SoundCloud] buttons on both Mobile and PC.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateProfile({ shareWithDiscord: !profile.shareWithDiscord })}
                      className={clsx(
                        'w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0',
                        profile.shareWithDiscord ? 'bg-[#5865F2]' : 'bg-white/10'
                      )}
                      role="switch"
                      aria-checked={Boolean(profile.shareWithDiscord)}
                      title="Toggle between Universal Buttons and PC GameSDK Join"
                    >
                      <div
                        className={clsx(
                          'w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
                          profile.shareWithDiscord ? 'translate-x-4' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Photo Upload & Identity Options */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-sc-fg">Profile Photo</span>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/png, image/jpeg, image/webp"
                  className="hidden"
                />

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 rounded-xl border border-white/[0.08] hover:border-sc-orange/50 bg-white/5 hover:bg-white/10 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-sc-orange" />
                    <span>Upload from PC</span>
                  </button>

                  {soundCloudUser && (
                    <button
                      onClick={handleUseSoundCloudPhoto}
                      className="p-2.5 rounded-xl border border-white/[0.08] hover:border-sc-orange/50 bg-white/5 hover:bg-white/10 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-sc-orange" />
                      <span>Use SoundCloud</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Edit Name & Bio */}
              <div className="space-y-3 pt-2 border-t border-white/[0.06]">
                <span className="text-xs font-bold text-sc-fg">Edit Profile Info</span>

                <div className="space-y-1">
                  <label className="text-[10px] text-sc-muted uppercase font-bold">Display Name</label>
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-black/40 border border-white/[0.08] text-xs text-sc-fg"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-sc-muted uppercase font-bold">Bio / Status Quote</label>
                  <input
                    type="text"
                    value={bioDraft}
                    onChange={(e) => setBioDraft(e.target.value)}
                    placeholder="e.g. Vibing to SoundCloud..."
                    className="w-full px-3 py-1.5 rounded-xl bg-black/40 border border-white/[0.08] text-xs text-sc-fg"
                  />
                </div>

                <button
                  onClick={handleSaveProfile}
                  className="w-full py-2 rounded-xl bg-sc-orange text-sc-on-accent text-xs font-bold hover:scale-[1.01] active:scale-98 transition-all cursor-pointer shadow-sm"
                >
                  Save Profile Changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
