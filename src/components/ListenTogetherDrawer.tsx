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
  LogOut,
  X,
  Palette,
  Clock,
  Flame,
  Shield,
  Activity,
  SlidersHorizontal,
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
  PROFILE_BADGES,
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

export function ListenTogetherDrawer({
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
  const [activeTab, setActiveTab] = useState<'friends' | 'room'>('friends');
  const [copiedCode, setCopiedCode] = useState(false);
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [friendNameInput, setFriendNameInput] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [editingFriendCode, setEditingFriendCode] = useState<string | null>(null);
  const [editedFriendName, setEditedFriendName] = useState('');
  const [customizingProfile, setCustomizingProfile] = useState(false);

  // Customization studio state
  const [customName, setCustomName] = useState(profile.name);
  const [customBio, setCustomBio] = useState(profile.bio || '');
  const [customBadge, setCustomBadge] = useState(profile.badge || '🎧 Audiophile');
  const [customAvatarUrl, setCustomAvatarUrl] = useState(profile.avatarUrl || '');
  const [customPreset, setCustomPreset] = useState(profile.avatarPreset || 'dj');
  const [customTheme, setCustomTheme] = useState<ProfileThemeColor>(profile.themeColor || 'orange');

  // Sync studio state if profile changes outside
  useEffect(() => {
    setCustomName(profile.name);
    setCustomBio(profile.bio || '');
    setCustomBadge(profile.badge || '🎧 Audiophile');
    setCustomAvatarUrl(profile.avatarUrl || '');
    setCustomPreset(profile.avatarPreset || 'dj');
    setCustomTheme(profile.themeColor || 'orange');
  }, [profile]);

  // Handle ESC key to close drawer
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !customizingProfile) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, customizingProfile, onClose]);

  const copyMyCode = () => {
    navigator.clipboard.writeText(profile.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleAddFriendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendCodeInput.trim()) return;
    const ok = onAddFriend(friendCodeInput, friendNameInput.trim() || undefined);
    if (ok) {
      setFriendCodeInput('');
      setFriendNameInput('');
    }
  };

  const handleJoinRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCodeInput.trim()) return;
    onJoinRoom(roomCodeInput);
    setRoomCodeInput('');
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChatMessage(chatInput);
    setChatInput('');
  };

  const handleSaveCustomization = () => {
    updateProfile({
      name: customName.trim() || profile.name,
      bio: customBio.trim(),
      badge: customBadge,
      avatarUrl: customAvatarUrl.trim() || undefined,
      avatarPreset: customPreset,
      themeColor: customTheme,
    });
    setCustomizingProfile(false);
  };

  const onlineFriendsCount = useMemo(() => {
    return friends.filter((f) => presences[f.code]?.online).length;
  }, [friends, presences]);

  const formatListenedTime = (sec?: number) => {
    if (!sec || sec < 60) return `${sec || 0}s`;
    const mins = Math.floor(sec / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = (mins / 60).toFixed(1);
    return `${hrs}h`;
  };

  if (!isOpen) return null;

  const currentPresetInfo = AVATAR_PRESETS.find((p) => p.id === profile.avatarPreset) || AVATAR_PRESETS[0];

  return (
    <aside className="w-full sm:w-[420px] shrink-0 border-l border-sc-line bg-sc-panel/95 backdrop-blur-2xl flex flex-col z-40 fixed sm:relative inset-y-0 right-0 shadow-2xl animate-drawer text-sc-fg select-none">
      {/* Drawer Top Header */}
      <div className="h-16 px-4 border-b border-sc-line flex items-center justify-between shrink-0 bg-sc-panel/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-sc-orange/15 border border-sc-orange/30 flex items-center justify-center text-sc-orange shrink-0">
            <Headphones className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold tracking-tight">Listen Together</h2>
              <span
                className={clsx(
                  'w-2 h-2 rounded-full',
                  connectionStatus === 'connected'
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                    : connectionStatus === 'connecting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-red-400'
                )}
                title={`Status: ${connectionStatus}`}
              />
            </div>
            <p className="text-[11px] text-sc-muted">
              {onlineFriendsCount > 0 ? `${onlineFriendsCount} friend${onlineFriendsCount > 1 ? 's' : ''} online` : 'P2P Real-Time Sync'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Tab switcher */}
          <div className="flex items-center p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.08]">
            <button
              onClick={() => setActiveTab('friends')}
              className={clsx(
                'px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1',
                activeTab === 'friends' ? 'bg-sc-orange text-white' : 'text-sc-muted hover:text-white'
              )}
            >
              <Users className="w-3 h-3" />
              <span>Friends</span>
            </button>
            <button
              onClick={() => setActiveTab('room')}
              className={clsx(
                'px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1',
                activeTab === 'room' ? 'bg-sc-orange text-white' : 'text-sc-muted hover:text-white'
              )}
            >
              <Radio className="w-3 h-3" />
              <span>Jam</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-sc-muted hover:text-sc-fg hover:bg-white/[0.06] transition-colors cursor-pointer ml-1"
            title="Close drawer (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Incoming invites banner */}
      {incomingInvites.length > 0 && (
        <div className="p-3 bg-sc-orange/15 border-b border-sc-orange/30 shrink-0 space-y-2">
          {incomingInvites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-2 p-2 rounded-xl bg-sc-panel border border-sc-orange/40">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-sc-fg truncate">
                  <span className="text-sc-orange">{inv.senderName}</span> invited you!
                </p>
                <p className="text-[10px] text-sc-muted truncate">
                  {inv.track.title} • {inv.track.artist}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onAcceptInvite(inv)}
                  className="px-2.5 py-1 rounded-lg bg-sc-orange text-white text-[10px] font-bold cursor-pointer"
                >
                  Join
                </button>
                <button
                  onClick={() => onDismissInvite(inv.id)}
                  className="px-2 py-1 rounded-lg bg-white/5 text-sc-muted text-[10px] cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active Sync Status Banner */}
      {syncSession.mode !== 'idle' && (
        <div className="p-3 bg-gradient-to-r from-sc-orange/20 to-purple-600/20 border-b border-sc-orange/30 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-sc-orange animate-ping shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-sc-orange uppercase tracking-wider">
                {syncSession.mode === 'following' ? 'Synced with Friend' : 'Listening Room Active'}
              </p>
              <p className="text-xs font-semibold truncate text-white">
                {syncSession.mode === 'following'
                  ? syncSession.targetName || syncSession.targetCode
                  : `${syncSession.roomName || syncSession.roomId} (${syncSession.participants?.length || 1})`}
              </p>
            </div>
          </div>
          <button
            onClick={onStopSync}
            className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
          >
            <LogOut className="w-3 h-3" />
            Disconnect
          </button>
        </div>
      )}

      {/* Main Drawer Scroll Area */}
      <div className="flex-1 overflow-y-auto min-h-0 scroll-thin p-4 space-y-4">
        {/* Customization Studio Modal / Expandable */}
        {customizingProfile ? (
          <div className="p-4 rounded-2xl bg-sc-panel-2/90 border border-sc-orange/40 space-y-4 animate-fade-in shadow-xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-sc-orange flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5" />
                Customize Profile
              </span>
              <button
                onClick={() => setCustomizingProfile(false)}
                className="text-sc-muted hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>

            {/* Display Name */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-sc-dim">Display Name</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                maxLength={30}
                className="w-full px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-sc-fg outline-none focus:border-sc-orange"
              />
            </div>

            {/* Status Bio */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-sc-dim">Status Quote / Bio</label>
              <input
                type="text"
                value={customBio}
                onChange={(e) => setCustomBio(e.target.value)}
                placeholder="e.g. Vibing to SoundCloud..."
                maxLength={60}
                className="w-full px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-sc-fg outline-none focus:border-sc-orange"
              />
            </div>

            {/* Badges Selector */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-sc-dim">Badge Title</label>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {PROFILE_BADGES.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setCustomBadge(b)}
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer',
                      customBadge === b
                        ? 'border-sc-orange bg-sc-orange/20 text-sc-orange shadow-xs'
                        : 'border-white/[0.08] text-sc-muted hover:text-white'
                    )}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            {/* Avatar Presets */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-sc-dim">Choose Avatar Style</label>
              <div className="grid grid-cols-4 gap-2">
                {AVATAR_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setCustomPreset(p.id);
                      setCustomAvatarUrl('');
                    }}
                    className={clsx(
                      'p-2 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer',
                      customPreset === p.id && !customAvatarUrl
                        ? 'border-sc-orange bg-sc-orange/15 ring-1 ring-sc-orange/50'
                        : 'border-white/[0.06] hover:border-white/[0.14]'
                    )}
                  >
                    <div className={clsx('w-8 h-8 rounded-lg bg-gradient-to-tr flex items-center justify-center text-sm shadow-md', p.gradient)}>
                      {p.icon}
                    </div>
                    <span className="text-[9px] font-bold text-sc-muted truncate max-w-full">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* SoundCloud avatar shortcut if available */}
            {soundCloudUser?.avatarUrl && (
              <button
                type="button"
                onClick={() => {
                  setCustomAvatarUrl(soundCloudUser.avatarUrl);
                  setCustomName(soundCloudUser.username || customName);
                }}
                className="w-full py-2 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] flex items-center gap-2.5 text-xs text-sc-fg transition-colors cursor-pointer"
              >
                <img src={soundCloudUser.avatarUrl} alt="SoundCloud" className="w-5 h-5 rounded-full" />
                <span className="truncate">Use my SoundCloud profile ({soundCloudUser.username})</span>
              </button>
            )}

            {/* Custom Avatar URL option */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-sc-dim">Or Custom Image URL</label>
              <input
                type="url"
                value={customAvatarUrl}
                onChange={(e) => setCustomAvatarUrl(e.target.value)}
                placeholder="https://.../avatar.png"
                className="w-full px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-sc-fg outline-none focus:border-sc-orange"
              />
            </div>

            {/* Save Button */}
            <button
              type="button"
              onClick={handleSaveCustomization}
              className="w-full py-2.5 rounded-xl bg-sc-orange hover:bg-sc-orange/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-sc-orange/25 transition-all cursor-pointer active:scale-98"
            >
              <Check className="w-3.5 h-3.5" />
              Save & Broadcast Profile
            </button>
          </div>
        ) : (
          /* Profile Banner Card */
          <div className="p-4 rounded-2xl bg-sc-panel/60 border border-white/[0.08] shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.name}
                    className="w-12 h-12 rounded-2xl object-cover ring-2 ring-sc-orange/40 shadow-md shrink-0"
                  />
                ) : (
                  <div
                    className={clsx(
                      'w-12 h-12 rounded-2xl bg-gradient-to-tr flex items-center justify-center font-bold text-white text-lg shadow-md shrink-0',
                      currentPresetInfo.gradient
                    )}
                  >
                    {currentPresetInfo.icon}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-sm text-sc-fg truncate">{profile.name}</h3>
                    {profile.badge && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-sc-orange/15 border border-sc-orange/30 text-sc-orange font-bold truncate">
                        {profile.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-sc-dim italic truncate mt-0.5">
                    "{profile.bio || 'Vibing to SoundCloud'}"
                  </p>
                  {/* Listening stats counter */}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-sc-muted">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-sc-orange" />
                      {formatListenedTime(profile.totalListenedSeconds)}
                    </span>
                    <span>•</span>
                    <span>{profile.tracksListenedCount || 0} tracks</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setCustomizingProfile(true)}
                className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-sc-dim hover:text-white transition-colors cursor-pointer shrink-0"
                title="Customize avatar, bio & badge"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Friend Code Badge with 1-click copy */}
            <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-sc-dim uppercase tracking-wider font-semibold">Your Code:</span>
                <span className="font-mono font-extrabold text-xs text-sc-orange tracking-widest selection:bg-sc-orange/30">
                  {profile.code}
                </span>
              </div>
              <button
                type="button"
                onClick={copyMyCode}
                className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-sc-fg font-semibold text-[10px] flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400 font-bold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-sc-muted" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Tab 1: Friends */}
        {activeTab === 'friends' && (
          <div className="space-y-4">
            {/* Add Friend Form */}
            <form onSubmit={handleAddFriendSubmit} className="p-3.5 rounded-2xl bg-sc-panel/40 border border-white/[0.06] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-sc-fg flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-sc-orange" />
                  Add Friend
                </span>
                <span className="text-[9px] text-sc-faint">Both see each other instantly</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Friend code (e.g. SC-98F2)..."
                  value={friendCodeInput}
                  onChange={(e) => setFriendCodeInput(e.target.value.toUpperCase())}
                  className="flex-1 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs font-mono tracking-wider text-sc-fg placeholder:text-sc-faint outline-none focus:border-sc-orange/60"
                />
                <button
                  type="submit"
                  disabled={!friendCodeInput.trim()}
                  className="px-3.5 py-1.5 rounded-xl bg-sc-orange hover:bg-sc-orange/90 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1 shadow-md shadow-sc-orange/20 cursor-pointer active:scale-95"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            </form>

            {/* Friends List Header */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-extrabold uppercase tracking-wider text-sc-dim">
                Friends ({friends.length})
              </span>
              {onlineFriendsCount > 0 && (
                <span className="text-[11px] font-semibold text-emerald-400">
                  {onlineFriendsCount} online
                </span>
              )}
            </div>

            {/* Friends Cards */}
            {friends.length === 0 ? (
              <div className="p-8 rounded-2xl bg-sc-panel/30 border border-white/[0.04] text-center flex flex-col items-center justify-center gap-2">
                <Users className="w-8 h-8 text-sc-dim opacity-50" />
                <p className="text-xs font-bold text-sc-fg">No friends added yet</p>
                <p className="text-[11px] text-sc-muted max-w-xs leading-relaxed">
                  Share your code <strong className="text-sc-orange font-mono">{profile.code}</strong> with a friend. Once added, you will both appear on each other's lists!
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {friends.map((friend) => {
                  const presence = presences[friend.code];
                  const isOnline = Boolean(presence?.online);
                  const isFriendPlaying = Boolean(presence?.isPlaying);
                  const friendTrack = presence?.track;

                  // Live simulated track elapsed time
                  let currentPos = presence?.currentTime || 0;
                  if (isOnline && isFriendPlaying && presence?.timestamp) {
                    const elapsedSec = (Date.now() - presence.timestamp) / 1000;
                    currentPos = Math.min(presence.duration || 9999, currentPos + elapsedSec);
                  }
                  const progressPct = presence?.duration
                    ? Math.min(100, Math.max(0, (currentPos / presence.duration) * 100))
                    : 0;

                  const isFollowingThisFriend =
                    syncSession.mode === 'following' && syncSession.targetCode === friend.code;

                  const friendPreset = AVATAR_PRESETS.find((p) => p.id === (presence?.avatarPreset || friend.avatarPreset)) || AVATAR_PRESETS[0];

                  return (
                    <div
                      key={friend.code}
                      className={clsx(
                        'p-3.5 rounded-2xl border transition-all duration-200 space-y-2.5',
                        isFollowingThisFriend
                          ? 'bg-sc-orange/15 border-sc-orange/60 shadow-lg shadow-sc-orange/10'
                          : isOnline
                          ? 'bg-sc-panel/70 border-white/[0.08] hover:border-white/[0.15]'
                          : 'bg-sc-panel/30 border-white/[0.04] opacity-75'
                      )}
                    >
                      {/* Top: Avatar, Name, Status, Options */}
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* Avatar with live status dot */}
                          <div className="relative shrink-0">
                            {presence?.avatarUrl || friend.avatarUrl ? (
                              <img
                                src={presence?.avatarUrl || friend.avatarUrl}
                                alt={friend.name}
                                className="w-9 h-9 rounded-xl object-cover ring-1 ring-white/10"
                              />
                            ) : (
                              <div
                                className={clsx(
                                  'w-9 h-9 rounded-xl bg-gradient-to-tr flex items-center justify-center font-bold text-white text-xs',
                                  friendPreset.gradient
                                )}
                              >
                                {friendPreset.icon}
                              </div>
                            )}
                            <span
                              className={clsx(
                                'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-sc-panel',
                                isOnline
                                  ? isFriendPlaying
                                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                                    : 'bg-amber-400'
                                  : 'bg-neutral-600'
                              )}
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
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
                                    className="bg-white/10 text-xs px-2 py-0.5 rounded border border-sc-orange text-white focus:outline-none"
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
                                <span className="font-bold text-xs text-sc-fg truncate">{friend.name}</span>
                              )}
                              {(presence?.badge || friend.badge) && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-white/[0.06] text-sc-dim font-bold truncate">
                                  {presence?.badge || friend.badge}
                                </span>
                              )}
                            </div>

                            {/* Friend Bio or status */}
                            <p className="text-[10px] text-sc-muted truncate">
                              {presence?.bio ? `"${presence.bio}"` : isOnline ? (isFriendPlaying ? 'Listening now' : 'Paused') : 'Offline'}
                            </p>
                          </div>
                        </div>

                        {/* Options */}
                        <div className="flex items-center gap-1 shrink-0">
                          {!isOnline && (
                            <button
                              onClick={() => onConnectToFriend(friend.code)}
                              title="Try reconnecting"
                              className="p-1 text-sc-dim hover:text-sc-fg cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingFriendCode(friend.code);
                              setEditedFriendName(friend.name);
                            }}
                            title="Rename"
                            className="p-1 text-sc-dim hover:text-sc-fg cursor-pointer"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onRemoveFriend(friend.code)}
                            title="Remove friend"
                            className="p-1 text-sc-dim hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Middle: Live Track Activity with Durations */}
                      {isOnline && friendTrack ? (
                        <div className="p-2.5 rounded-xl bg-black/30 border border-white/[0.04] space-y-1.5">
                          <div className="flex items-center gap-2.5">
                            <Artwork
                              src={friendTrack.artwork}
                              seed={friendTrack.id}
                              size={80}
                              rounded="rounded-lg"
                              className="w-9 h-9 shrink-0 shadow-sm"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-sc-fg truncate">{friendTrack.title}</p>
                              <p className="text-[10px] text-sc-muted truncate">{friendTrack.artist}</p>
                            </div>
                          </div>

                          {/* Progress bar + track duration */}
                          <div className="space-y-1 pt-0.5">
                            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full bg-sc-orange transition-all duration-300 rounded-full"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-sc-dim font-mono tabular-nums">
                              <span>{fmtTime(currentPos)} / {fmtTime(presence?.duration || friendTrack.duration)}</span>
                              {presence?.totalListenedSeconds ? (
                                <span className="text-[9px] font-sans text-sc-muted">
                                  ⏱️ {formatListenedTime(presence.totalListenedSeconds)} listened
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {/* Bottom action buttons */}
                      <div className="flex items-center gap-1.5 pt-0.5">
                        {isFollowingThisFriend ? (
                          <button
                            onClick={onStopSync}
                            className="flex-1 py-1.5 rounded-xl bg-sc-orange/20 hover:bg-sc-orange/30 border border-sc-orange/50 text-sc-orange font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            Stop Sync
                          </button>
                        ) : (
                          <button
                            onClick={() => onFollowFriend(friend.code)}
                            disabled={!isOnline || !friendTrack}
                            className="flex-1 py-1.5 rounded-xl bg-sc-orange hover:bg-sc-orange/90 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm shadow-sc-orange/20 cursor-pointer active:scale-98"
                          >
                            <Headphones className="w-3.5 h-3.5" />
                            Listen Along
                          </button>
                        )}

                        {currentTrack && (
                          <button
                            onClick={() => onInviteFriend(friend.code)}
                            disabled={!isOnline}
                            title="Invite to listen to your current track"
                            className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed text-sc-fg font-semibold text-xs flex items-center gap-1 cursor-pointer"
                          >
                            <Share2 className="w-3 h-3 text-sc-muted" />
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

        {/* Tab 2: Jam Room */}
        {activeTab === 'room' && (
          <div className="space-y-4">
            {syncSession.mode === 'room' ? (
              /* Active Room Content */
              <div className="space-y-4">
                {/* Room header card */}
                <div className="p-4 rounded-2xl bg-sc-panel/70 border border-sc-orange/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-sc-orange">
                        {syncSession.isHost ? '👑 Host (DJ)' : 'Jam Member'}
                      </span>
                      <h3 className="text-base font-bold text-sc-fg">{syncSession.roomName || syncSession.roomId}</h3>
                    </div>
                    <div className="px-2.5 py-1 rounded-xl bg-white/[0.06] font-mono font-bold text-xs text-sc-orange">
                      Code: {syncSession.roomId}
                    </div>
                  </div>

                  {/* Broadcast track */}
                  {currentTrack ? (
                    <div className="p-2.5 rounded-xl bg-black/40 border border-white/[0.06] flex items-center gap-3">
                      <Artwork
                        src={currentTrack.artwork}
                        seed={currentTrack.id}
                        size={80}
                        rounded="rounded-lg"
                        className="w-10 h-10 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-[9px] uppercase tracking-wider font-bold text-sc-orange">Broadcasting</span>
                        <p className="text-xs font-bold text-sc-fg truncate">{currentTrack.title}</p>
                        <p className="text-[10px] text-sc-muted truncate">{currentTrack.artist}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-sc-dim italic text-center py-2">
                      {syncSession.isHost ? 'Pick any track to broadcast to the room!' : 'Waiting for host to pick a track...'}
                    </p>
                  )}

                  {/* Live reaction buttons */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] font-semibold text-sc-muted">Reactions:</span>
                    <div className="flex gap-1">
                      {['🔥', '🎧', '❤️', '⚡', '🚀'].map((em) => (
                        <button
                          key={em}
                          onClick={() => onSendReaction(em)}
                          className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] active:scale-125 transition-transform flex items-center justify-center text-sm cursor-pointer"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Members list */}
                <div className="p-3.5 rounded-2xl bg-sc-panel/40 border border-white/[0.06] space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-sc-dim">
                    Members ({syncSession.participants?.length || 1})
                  </span>
                  <div className="space-y-1.5">
                    {(syncSession.participants || []).map((p) => (
                      <div key={p.code} className="flex items-center justify-between py-1 px-2 rounded-lg bg-white/[0.02]">
                        <span className="text-xs font-semibold text-sc-fg">{p.name}</span>
                        {p.isHost && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-sc-orange/20 text-sc-orange font-bold">
                            DJ
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Chat window */}
                <div className="p-3.5 rounded-2xl bg-sc-panel/70 border border-white/[0.06] flex flex-col h-64 space-y-2">
                  <span className="text-xs font-bold text-sc-dim flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-sc-orange" />
                    Room Chat
                  </span>
                  <div className="flex-1 overflow-y-auto space-y-2 scroll-thin pr-1 text-xs">
                    {chatMessages.length === 0 ? (
                      <p className="text-sc-dim italic text-center py-8">No messages yet. Say hello!</p>
                    ) : (
                      chatMessages.map((msg) => {
                        const isMe = msg.senderCode === profile.code;
                        return (
                          <div
                            key={msg.id}
                            className={clsx(
                              'p-2 rounded-xl max-w-[85%]',
                              isMe ? 'ml-auto bg-sc-orange text-white' : 'mr-auto bg-white/[0.06] text-sc-fg'
                            )}
                          >
                            <span className="text-[9px] font-bold opacity-75 block">{msg.senderName}</span>
                            <span className="break-words">{msg.text}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <form onSubmit={handleSendChat} className="flex gap-1.5 pt-1 border-t border-white/[0.06]">
                    <input
                      type="text"
                      placeholder="Message room..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-sc-fg outline-none focus:border-sc-orange/60"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim()}
                      className="px-3 py-1.5 rounded-xl bg-sc-orange hover:bg-sc-orange/90 disabled:opacity-30 text-white cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              /* Create or Join Room Cards */
              <div className="space-y-3">
                <div className="p-4 rounded-2xl bg-sc-panel/60 border border-white/[0.08] space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-sc-orange/20 border border-sc-orange/40 flex items-center justify-center text-sc-orange">
                      <Radio className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-sc-fg">Host a Jam Room</h4>
                      <p className="text-[11px] text-sc-muted">Broadcast your music in real-time to friends</p>
                    </div>
                  </div>
                  <button
                    onClick={() => onCreateRoom()}
                    className="w-full py-2.5 rounded-xl bg-sc-orange hover:bg-sc-orange/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-sc-orange/20 cursor-pointer active:scale-98"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    Create Room (Become DJ)
                  </button>
                </div>

                <div className="p-4 rounded-2xl bg-sc-panel/60 border border-white/[0.08] space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-sc-dim">
                      <Headphones className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-sc-fg">Join Jam Room</h4>
                      <p className="text-[11px] text-sc-muted">Enter a room code to join an active party</p>
                    </div>
                  </div>
                  <form onSubmit={handleJoinRoomSubmit} className="space-y-2">
                    <input
                      type="text"
                      placeholder="Room code (e.g. JAM-9421)..."
                      value={roomCodeInput}
                      onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                      className="w-full px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] font-mono tracking-widest text-xs text-sc-fg outline-none focus:border-sc-orange"
                    />
                    <button
                      type="submit"
                      disabled={!roomCodeInput.trim()}
                      className="w-full py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-30 text-white font-bold text-xs cursor-pointer"
                    >
                      Join Room
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
