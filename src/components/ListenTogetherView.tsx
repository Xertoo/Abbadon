import { useState, useMemo, useEffect } from 'react';
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
  Edit2,
  MessageSquare,
  Send,
  RefreshCw,
  Music,
  ExternalLink,
  Volume2,
  Pause,
  Play,
  Flame,
  Heart,
  Zap,
  Rocket,
  LogOut,
  Sliders,
  Shield,
  Smile,
} from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from './Artwork';
import { fmtTime } from '../lib/soundcloud';
import type { Track } from '../types';
import type {
  UserProfile,
  Friend,
  FriendPresence,
  SyncSession,
  RoomChatMessage,
  RoomReaction,
  IncomingInvite,
} from '../lib/listenTogether';

interface Props {
  profile: UserProfile;
  updateProfile: (name: string, newCode?: string) => void;
  friends: Friend[];
  presences: Record<string, FriendPresence>;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  syncSession: SyncSession;
  incomingInvites: IncomingInvite[];
  chatMessages: RoomChatMessage[];
  reactions: RoomReaction[];
  currentTrack: Track | null;
  isPlaying: boolean;
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

export function ListenTogetherView({
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
  const [copiedCode, setCopiedCode] = useState(false);
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [friendNameInput, setFriendNameInput] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile.name);
  const [activeTab, setActiveTab] = useState<'friends' | 'room'>('friends');
  const [editingFriendCode, setEditingFriendCode] = useState<string | null>(null);
  const [editedFriendName, setEditedFriendName] = useState('');

  // Live ticking counter so elapsed times update every second
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => (t + 1) % 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  const copyMyCode = () => {
    void navigator.clipboard.writeText(profile.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleAddFriendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendCodeInput.trim()) return;
    const ok = onAddFriend(friendCodeInput, friendNameInput || undefined);
    if (ok) {
      setFriendCodeInput('');
      setFriendNameInput('');
    }
  };

  const handleJoinRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCodeInput.trim()) return;
    onJoinRoom(roomCodeInput.trim());
    setRoomCodeInput('');
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChatMessage(chatInput);
    setChatInput('');
  };

  const handleSaveProfileName = () => {
    if (nameInput.trim()) {
      updateProfile(nameInput.trim());
    }
    setIsEditingName(false);
  };

  const onlineFriendsCount = useMemo(() => {
    return friends.filter((f) => presences[f.code]?.online).length;
  }, [friends, presences]);

  return (
    <div className="relative min-h-full pb-28 px-4 sm:px-8 max-w-7xl mx-auto space-y-6 pt-4 animate-fade-in">
      {/* Floating Reactions Overlay */}
      {reactions.length > 0 && (
        <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center overflow-hidden">
          {reactions.map((rx) => (
            <div
              key={rx.id}
              className="absolute animate-bounce flex flex-col items-center gap-1 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-sc-orange/40 shadow-xl"
              style={{
                top: `${20 + Math.random() * 60}%`,
                left: `${20 + Math.random() * 60}%`,
              }}
            >
              <span className="text-3xl">{rx.emoji}</span>
              <span className="text-[11px] font-bold text-sc-fg">{rx.senderName}</span>
            </div>
          ))}
        </div>
      )}

      {/* Incoming Invitations Banner */}
      {incomingInvites.length > 0 && (
        <div className="space-y-2">
          {incomingInvites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-sc-orange/20 via-neutral-900/80 to-neutral-900/80 border border-sc-orange/40 backdrop-blur-xl shadow-lg shadow-sc-orange/10 animate-pulse"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-sc-orange/20 border border-sc-orange/40 flex items-center justify-center shrink-0">
                  <Headphones className="w-5 h-5 text-sc-orange animate-bounce" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-sc-fg">{inv.senderName}</span>
                    <span className="text-xs text-sc-orange font-semibold">
                      invited you to listen together!
                    </span>
                  </div>
                  {inv.track && (
                    <p className="text-xs text-sc-muted truncate">
                      {inv.track.title} • {inv.track.artist}
                    </p>
                  )}
                  {inv.roomName && (
                    <p className="text-xs text-sc-dim">Room: {inv.roomName}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onAcceptInvite(inv)}
                  className="px-4 py-2 rounded-xl bg-sc-orange hover:bg-sc-orange/90 text-white font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-md shadow-sc-orange/25 cursor-pointer"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  Join Now
                </button>
                <button
                  onClick={() => onDismissInvite(inv.id)}
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sc-muted hover:text-sc-fg font-semibold text-xs transition-colors cursor-pointer"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active Sync Banner */}
      {syncSession.mode !== 'idle' && (
        <div className="p-4 rounded-2xl bg-sc-panel/80 backdrop-blur-2xl border border-sc-orange/40 flex items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-3 h-3 rounded-full bg-sc-orange animate-ping absolute inset-0" />
              <div className="w-3 h-3 rounded-full bg-sc-orange relative" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-sc-orange">
                  {syncSession.mode === 'following'
                    ? 'Listen Together Active'
                    : 'Listening Room'}
                </span>
                <span className="text-xs text-sc-dim">• Synced</span>
              </div>
              <p className="text-sm font-semibold text-sc-fg">
                {syncSession.mode === 'following'
                  ? `Following: ${syncSession.targetName || syncSession.targetCode}`
                  : `In room: ${syncSession.roomName || syncSession.roomId} (${syncSession.participants?.length || 1} members)`}
              </p>
            </div>
          </div>

          <button
            onClick={onStopSync}
            className="px-3.5 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold text-xs flex items-center gap-1.5 border border-red-500/30 transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent">
              Listen Together & Friends
            </h1>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-semibold text-sc-muted">
              <span
                className={clsx(
                  'w-2 h-2 rounded-full',
                  connectionStatus === 'connected'
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                    : connectionStatus === 'connecting'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-red-400'
                )}
              />
              <span>
                {connectionStatus === 'connected'
                  ? 'Network active'
                  : connectionStatus === 'connecting'
                    ? 'Connecting...'
                    : 'Disconnected'}
              </span>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-sc-muted mt-1">
            Exchange friend codes, see what friends are streaming in real-time, and listen in sync.
          </p>
        </div>

        {/* View Mode Tabs */}
        <div className="flex items-center gap-1 p-1 bg-white/[0.04] rounded-2xl border border-white/[0.08] self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('friends')}
            className={clsx(
              'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer',
              activeTab === 'friends'
                ? 'bg-sc-orange text-white shadow-md shadow-sc-orange/20'
                : 'text-sc-muted hover:text-sc-fg'
            )}
          >
            <Users className="w-4 h-4" />
            <span>Friends</span>
            {onlineFriendsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px]">
                {onlineFriendsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('room')}
            className={clsx(
              'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer',
              activeTab === 'room'
                ? 'bg-sc-orange text-white shadow-md shadow-sc-orange/20'
                : 'text-sc-muted hover:text-sc-fg'
            )}
          >
            <Radio className="w-4 h-4" />
            <span>Jam Rooms</span>
          </button>
        </div>
      </div>

      {/* Profile & Add Friend Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Your Profile & Friend Code Card */}
        <div className="p-5 rounded-2xl bg-sc-panel/60 backdrop-blur-xl border border-white/[0.08] shadow-sm flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sc-dim flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-sc-orange" />
                Your Profile & Friend Code
              </span>
              <span className="text-[10px] text-sc-faint">Shareable code</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sc-orange to-purple-600 flex items-center justify-center font-bold text-white text-lg shadow-md shrink-0">
                {profile.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                {isEditingName ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveProfileName()}
                      className="bg-white/10 border border-sc-orange/50 rounded-lg px-2.5 py-1 text-sm font-semibold text-sc-fg focus:outline-none w-full"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveProfileName}
                      className="px-2.5 py-1 rounded-lg bg-sc-orange text-white text-xs font-bold cursor-pointer"
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-base text-sc-fg truncate">{profile.name}</h3>
                    <button
                      onClick={() => {
                        setNameInput(profile.name);
                        setIsEditingName(true);
                      }}
                      title="Edit nickname"
                      className="text-sc-dim hover:text-sc-fg transition-colors cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <p className="text-xs text-sc-muted">
                  {currentTrack
                    ? `${isPlaying ? '▶ Playing:' : '⏸ Paused:'} ${currentTrack.title}`
                    : 'Nothing playing right now'}
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-white/[0.06] flex flex-col sm:flex-row items-center gap-2">
            <div className="flex-1 w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08]">
              <span className="text-[11px] text-sc-dim">Your code:</span>
              <span className="font-mono font-extrabold text-sm text-sc-orange tracking-widest selection:bg-sc-orange/30">
                {profile.code}
              </span>
            </div>
            <button
              onClick={copyMyCode}
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-sc-fg font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95"
            >
              {copiedCode ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-sc-muted" />
                  <span>Copy code</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Add Friend Card */}
        <div className="p-5 rounded-2xl bg-sc-panel/60 backdrop-blur-xl border border-white/[0.08] shadow-sm flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sc-dim flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5 text-sc-orange" />
                Add Friend
              </span>
              <span className="text-[10px] text-sc-faint">Connect via code</span>
            </div>
            <p className="text-xs text-sc-muted mb-3">
              Enter your friend's code to add them and see what they are listening to live.
            </p>
          </div>

          <form onSubmit={handleAddFriendSubmit} className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Friend code (e.g. SC-98F2)..."
                value={friendCodeInput}
                onChange={(e) => setFriendCodeInput(e.target.value.toUpperCase())}
                className="flex-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs font-mono tracking-wider text-sc-fg placeholder:text-sc-faint focus:outline-none focus:border-sc-orange/60"
              />
              <input
                type="text"
                placeholder="Nickname (optional)"
                value={friendNameInput}
                onChange={(e) => setFriendNameInput(e.target.value)}
                className="sm:w-40 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-sc-fg placeholder:text-sc-faint focus:outline-none focus:border-sc-orange/60"
              />
            </div>
            <button
              type="submit"
              disabled={!friendCodeInput.trim()}
              className="w-full py-2.5 rounded-xl bg-sc-orange hover:bg-sc-orange/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-sc-orange/20 cursor-pointer active:scale-98"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add Friend
            </button>
          </form>
        </div>
      </div>

      {/* Main Content: Friends Tab */}
      {activeTab === 'friends' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-sc-fg">Your Friends</h2>
              <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-xs font-bold text-sc-muted">
                {friends.length}
              </span>
            </div>
            {friends.length > 0 && (
              <span className="text-xs text-sc-dim">
                {onlineFriendsCount} online
              </span>
            )}
          </div>

          {friends.length === 0 ? (
            <div className="p-10 rounded-2xl bg-sc-panel/40 border border-white/[0.06] text-center flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                <Users className="w-7 h-7 text-sc-dim" />
              </div>
              <div className="max-w-md">
                <h3 className="text-base font-bold text-sc-fg">No friends added yet</h3>
                <p className="text-xs text-sc-muted mt-1 leading-relaxed">
                  Share your code <strong className="text-sc-orange">{profile.code}</strong> with a friend or enter their code above to start listening together.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {friends.map((friend) => {
                const presence = presences[friend.code];
                const isOnline = Boolean(presence?.online);
                const hasTrack = Boolean(presence?.track);
                const friendTrack = presence?.track;
                const isFriendPlaying = Boolean(presence?.isPlaying);

                // Compute real-time simulated progress
                let currentPos = presence?.currentTime || 0;
                if (isOnline && isFriendPlaying && presence?.timestamp) {
                  const elapsedSec = (Date.now() - presence.timestamp) / 1000;
                  currentPos = Math.min(presence.duration || 9999, currentPos + elapsedSec);
                }

                const progressPercent = presence?.duration
                  ? Math.min(100, Math.max(0, (currentPos / presence.duration) * 100))
                  : 0;

                const isFollowingThisFriend =
                  syncSession.mode === 'following' && syncSession.targetCode === friend.code;

                return (
                  <div
                    key={friend.code}
                    className={clsx(
                      'p-4 rounded-2xl border transition-all duration-300 backdrop-blur-xl flex flex-col justify-between gap-3 group relative overflow-hidden',
                      isFollowingThisFriend
                        ? 'bg-sc-orange/10 border-sc-orange/50 shadow-lg shadow-sc-orange/10'
                        : isOnline
                          ? 'bg-sc-panel/60 border-white/[0.1] hover:border-white/[0.18]'
                          : 'bg-sc-panel/30 border-white/[0.04] opacity-75 hover:opacity-100'
                    )}
                  >
                    {/* Top Row: Avatar, Name, Status, Actions */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center font-bold text-sc-fg text-sm">
                            {friend.name.slice(0, 1).toUpperCase()}
                          </div>
                          <span
                            className={clsx(
                              'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-sc-panel',
                              isOnline
                                ? isFriendPlaying
                                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                                : 'bg-amber-400'
                              : 'bg-neutral-600'
                            )}
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {editingFriendCode === friend.code ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={editedFriendName}
                                  onChange={(e) => setEditedFriendName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      onRenameFriend(friend.code, editedFriendName);
                                      setEditingFriendCode(null);
                                    }
                                  }}
                                  className="bg-white/10 text-xs px-2 py-0.5 rounded border border-sc-orange text-sc-fg focus:outline-none"
                                  autoFocus
                                />
                                <button
                                  onClick={() => {
                                    onRenameFriend(friend.code, editedFriendName);
                                    setEditingFriendCode(null);
                                  }}
                                  className="text-xs text-sc-orange font-bold cursor-pointer"
                                >
                                  OK
                                </button>
                              </div>
                            ) : (
                              <h4 className="font-bold text-sm text-sc-fg truncate">
                                {friend.name}
                              </h4>
                            )}
                            <span className="font-mono text-[10px] text-sc-dim px-1.5 py-0.5 rounded bg-white/[0.04]">
                              {friend.code}
                            </span>
                          </div>

                          <span className="text-[11px] text-sc-muted flex items-center gap-1">
                            {isOnline ? (
                              isFriendPlaying ? (
                                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                                  Listening now
                                </span>
                              ) : hasTrack ? (
                                <span className="text-amber-400 font-semibold">Paused</span>
                              ) : (
                                <span className="text-sc-dim">Idle</span>
                              )
                            ) : (
                              <span className="text-sc-dim">Offline</span>
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {!isOnline && (
                          <button
                            onClick={() => onConnectToFriend(friend.code)}
                            title="Try reconnecting"
                            className="p-1.5 rounded-lg text-sc-dim hover:text-sc-fg hover:bg-white/[0.06] transition-colors cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingFriendCode(friend.code);
                            setEditedFriendName(friend.name);
                          }}
                          title="Rename"
                          className="p-1.5 rounded-lg text-sc-dim hover:text-sc-fg hover:bg-white/[0.06] transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onRemoveFriend(friend.code)}
                          title="Remove friend"
                          className="p-1.5 rounded-lg text-sc-dim hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Middle: Current Track Preview */}
                    {isOnline && hasTrack && friendTrack ? (
                      <div className="p-2.5 rounded-xl bg-black/30 border border-white/[0.06] flex items-center gap-3">
                        <Artwork
                          src={friendTrack.artwork}
                          seed={friendTrack.id}
                          size={67}
                          rounded="rounded-lg"
                          className="w-12 h-12 shrink-0 shadow-md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-sc-fg truncate">
                            {friendTrack.title}
                          </p>
                          <p className="text-[11px] text-sc-muted truncate">
                            {friendTrack.artist}
                          </p>
                          {/* Live Track Scrubber / Time */}
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full bg-sc-orange transition-all duration-300 rounded-full"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-sc-dim tabular-nums">
                              {fmtTime(currentPos)} / {fmtTime(presence?.duration || friendTrack.duration)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] text-center">
                        <p className="text-xs text-sc-dim italic">
                          {isOnline
                            ? 'Friend is not playing anything right now.'
                            : 'Friend is offline. Their status will appear once they launch the app.'}
                        </p>
                      </div>
                    )}

                    {/* Bottom: Action Buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      {isFollowingThisFriend ? (
                        <button
                          onClick={onStopSync}
                          className="flex-1 py-2 rounded-xl bg-sc-orange/20 hover:bg-sc-orange/30 border border-sc-orange/50 text-sc-orange font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          Stop Sync
                        </button>
                      ) : (
                        <button
                          onClick={() => onFollowFriend(friend.code)}
                          disabled={!isOnline || !hasTrack}
                          className="flex-1 py-2 rounded-xl bg-sc-orange hover:bg-sc-orange/90 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-sc-orange/20 cursor-pointer active:scale-98"
                        >
                          <Headphones className="w-3.5 h-3.5" />
                          Listen Together
                        </button>
                      )}

                      {currentTrack && (
                        <button
                          onClick={() => onInviteFriend(friend.code)}
                          disabled={!isOnline}
                          title="Invite to listen to your current track"
                          className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-30 disabled:cursor-not-allowed text-sc-fg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Share2 className="w-3.5 h-3.5 text-sc-muted" />
                          <span>Invite</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main Content: Listening Room (Jam) Tab */}
      {activeTab === 'room' && (
        <div className="space-y-6">
          {syncSession.mode === 'room' ? (
            /* Active Room View */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Room Info & Controls (Col 1 & 2) */}
              <div className="lg:col-span-2 space-y-4">
                <div className="p-6 rounded-2xl bg-sc-panel/70 backdrop-blur-2xl border border-sc-orange/40 shadow-xl space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-sc-orange/20 border border-sc-orange/40 text-[11px] font-bold text-sc-orange uppercase tracking-wider">
                          Listening Room
                        </span>
                        {syncSession.isHost && (
                          <span className="px-2 py-0.5 rounded-full bg-white/[0.08] text-[10px] font-bold text-sc-muted">
                            Host (DJ)
                          </span>
                        )}
                      </div>
                      <h2 className="text-xl font-bold text-sc-fg mt-1">
                        {syncSession.roomName || syncSession.roomId}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="px-3 py-1 rounded-xl bg-white/[0.06] border border-white/[0.08] font-mono font-bold text-xs text-sc-orange">
                        Code: {syncSession.roomId}
                      </div>
                      <button
                        onClick={onStopSync}
                        className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 font-semibold text-xs flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Leave
                      </button>
                    </div>
                  </div>

                  {/* Current Playing in Room */}
                  <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] flex items-center gap-4">
                    {currentTrack ? (
                      <>
                        <Artwork
                          src={currentTrack.artwork}
                          seed={currentTrack.id}
                          size={80}
                          rounded="rounded-xl"
                          className="w-16 h-16 shrink-0 shadow-lg"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-sc-orange">
                            Currently playing in room
                          </span>
                          <h3 className="text-sm font-bold text-sc-fg truncate">
                            {currentTrack.title}
                          </h3>
                          <p className="text-xs text-sc-muted truncate">
                            {currentTrack.artist}
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-3 py-2 text-sc-dim">
                        <Music className="w-6 h-6 text-sc-dim" />
                        <span className="text-xs">
                          {syncSession.isHost
                            ? 'Select any track in the app to broadcast it to the room!'
                            : 'Waiting for the host to pick a track...'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Live Reactions Bar */}
                  <div className="pt-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-sc-muted">Live reactions:</span>
                    <div className="flex items-center gap-1.5">
                      {[
                        { emoji: '🔥', label: 'Fire' },
                        { emoji: '🎧', label: 'Headphones' },
                        { emoji: '❤️', label: 'Heart' },
                        { emoji: '⚡', label: 'Lightning' },
                        { emoji: '🚀', label: 'Rocket' },
                      ].map((item) => (
                        <button
                          key={item.emoji}
                          onClick={() => onSendReaction(item.emoji)}
                          className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] active:scale-125 hover:scale-110 transition-all flex items-center justify-center text-lg cursor-pointer"
                          title={item.label}
                        >
                          {item.emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Participants List */}
                <div className="p-5 rounded-2xl bg-sc-panel/50 backdrop-blur-xl border border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-sc-dim flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-sc-orange" />
                      Room Members ({syncSession.participants?.length || 1})
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(syncSession.participants || []).map((p) => (
                      <div
                        key={p.code}
                        className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                      >
                        <div className="w-8 h-8 rounded-lg bg-sc-orange/20 border border-sc-orange/40 flex items-center justify-center font-bold text-sc-fg text-xs">
                          {p.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-sc-fg truncate">{p.name}</span>
                            {p.isHost && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-sc-orange/20 text-sc-orange font-bold">
                                DJ
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-sc-dim font-mono">{p.code}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Room Live Chat (Col 3) */}
              <div className="p-5 rounded-2xl bg-sc-panel/70 backdrop-blur-2xl border border-white/[0.08] shadow-xl flex flex-col h-[420px]">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                  <span className="text-xs font-bold text-sc-fg flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-sc-orange" />
                    Room Chat
                  </span>
                  <span className="text-[10px] text-sc-dim">Everyone in room</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 py-3 scroll-thin pr-1">
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center">
                      <p className="text-xs text-sc-dim italic">
                        Send the first message in room chat!
                      </p>
                    </div>
                  ) : (
                    chatMessages.map((msg) => {
                      const isMe = msg.senderCode === profile.code;
                      return (
                        <div
                          key={msg.id}
                          className={clsx(
                            'flex flex-col max-w-[85%] rounded-xl px-3 py-2 text-xs',
                            isMe
                              ? 'ml-auto bg-sc-orange text-white'
                              : 'mr-auto bg-white/[0.06] text-sc-fg border border-white/[0.04]'
                          )}
                        >
                          <span
                            className={clsx(
                              'text-[10px] font-bold mb-0.5',
                              isMe ? 'text-white/80' : 'text-sc-dim'
                            )}
                          >
                            {msg.senderName}
                          </span>
                          <span className="leading-relaxed break-words">{msg.text}</span>
                        </div>
                      );
                    })
                  )}
                </div>

                <form onSubmit={handleSendChat} className="pt-2 border-t border-white/[0.06] flex gap-2">
                  <input
                    type="text"
                    placeholder="Type a message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-sc-fg placeholder:text-sc-faint focus:outline-none focus:border-sc-orange/60"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim()}
                    className="px-3 py-2 rounded-xl bg-sc-orange hover:bg-sc-orange/90 disabled:opacity-40 text-white transition-all cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            </div>
          ) : (
            /* Create / Join Room View */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Create Room Box */}
              <div className="p-6 rounded-2xl bg-sc-panel/60 backdrop-blur-xl border border-white/[0.08] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sc-orange/30 to-purple-600/30 border border-sc-orange/40 flex items-center justify-center">
                  <Radio className="w-6 h-6 text-sc-orange" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-sc-fg">Create a Listening Room</h3>
                  <p className="text-xs text-sc-muted mt-1 leading-relaxed">
                    Host a private Jam session. You choose what plays, and everyone connected listens in real-time sync.
                  </p>
                </div>
                <button
                  onClick={() => onCreateRoom()}
                  className="w-full py-3 rounded-xl bg-sc-orange hover:bg-sc-orange/90 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-sc-orange/25 transition-all cursor-pointer active:scale-98"
                >
                  <Radio className="w-4 h-4" />
                  Create Room (Become DJ)
                </button>
              </div>

              {/* Join Room Box */}
              <div className="p-6 rounded-2xl bg-sc-panel/60 backdrop-blur-xl border border-white/[0.08] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                  <Headphones className="w-6 h-6 text-sc-muted" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-sc-fg">Join a Listening Room</h3>
                  <p className="text-xs text-sc-muted mt-1 leading-relaxed">
                    Got a room code from a friend? Enter it below to join the session instantly.
                  </p>
                </div>
                <form onSubmit={handleJoinRoomSubmit} className="space-y-3">
                  <input
                    type="text"
                    placeholder="Enter room code (e.g. JAM-7421)..."
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs font-mono tracking-widest text-sc-fg placeholder:text-sc-faint focus:outline-none focus:border-sc-orange/60"
                  />
                  <button
                    type="submit"
                    disabled={!roomCodeInput.trim()}
                    className="w-full py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-30 disabled:cursor-not-allowed text-sc-fg font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Headphones className="w-4 h-4 text-sc-orange" />
                    Join Session
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
