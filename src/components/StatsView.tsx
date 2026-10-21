import { useState, useMemo, useCallback, useRef } from 'react';
import {
  BarChart3,
  Clock,
  Play,
  Flame,
  Sparkles,
  TrendingUp,
  Headphones,
  Award,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ZoomOut,
} from 'lucide-react';
import { Artwork } from './Artwork';
import type { Track } from '../types';
import type { Friend, FriendPresence } from '../lib/listenTogether';
import {
  loadListeningStats,
  getTopTracks,
  getTopArtists,
  compareMusicTaste,
  getTracksForDay,
  recordFriendTrack,
  getFriendObservedArtists,
  type ListeningStats,
} from '../lib/stats';
import clsx from 'clsx';

interface Props {
  friends: Friend[];
  presences: Record<string, FriendPresence>;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onOpenArtist?: (artist: { id?: string; username: string; artistId?: string; artistUrl?: string }) => void;
}

type ZoomLevel = 'week' | 'month' | 'year';
type SlideDirection = 'left' | 'right' | null;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Returns Monday (00:00:00) of the week containing the given date.
 */
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0 is Sunday, 1 is Monday...
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Returns dynamic color & glow styling for month square tiles.
 */
function getTileIntensity(count: number, isToday: boolean, isSelected: boolean) {
  if (count === 0) {
    return {
      bgClass: isSelected
        ? 'bg-orange-500/15 border-orange-500/50 text-white shadow-[0_0_10px_rgba(249,115,22,0.2)]'
        : isToday
        ? 'bg-white/[0.08] border-orange-500/40 text-white/80'
        : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:bg-white/[0.07] hover:border-white/20',
      numClass: isToday ? 'text-orange-400 font-bold' : isSelected ? 'text-orange-300 font-bold' : 'text-white/50',
      glow: 'none',
    };
  }
  if (count >= 10) {
    return {
      bgClass: 'bg-gradient-to-br from-red-600 via-orange-500 to-amber-300 border-amber-300 text-black font-black',
      numClass: 'text-black font-black',
      glow: '0 0 16px rgba(249,115,22,0.7), 0 0 28px rgba(234,179,8,0.35)',
    };
  }
  if (count >= 6) {
    return {
      bgClass: 'bg-gradient-to-br from-orange-600 to-amber-500 border-orange-400 text-black font-black',
      numClass: 'text-black font-black',
      glow: '0 0 14px rgba(249,115,22,0.5)',
    };
  }
  if (count >= 3) {
    return {
      bgClass: 'bg-orange-800/60 border-orange-500/60 text-white',
      numClass: 'text-orange-200 font-bold',
      glow: '0 0 10px rgba(249,115,22,0.3)',
    };
  }
  return {
    bgClass: 'bg-orange-950/40 border-orange-500/30 text-orange-200/90',
    numClass: 'text-orange-300 font-semibold',
    glow: '0 0 8px rgba(249,115,22,0.15)',
  };
}

/**
 * Returns dynamic gradient & glow styling based on play count density.
 */
function getBarIntensity(count: number, maxCount: number, isSelected: boolean) {
  if (count === 0) {
    return {
      barClass: isSelected ? 'bg-orange-500/25' : 'bg-white/[0.08]',
      boxShadow: isSelected ? '0 0 10px rgba(249,115,22,0.2)' : 'none',
    };
  }
  if (count >= 10 || (maxCount > 0 && count / maxCount >= 0.85)) {
    return {
      barClass: 'bg-gradient-to-t from-red-600 via-orange-500 to-amber-300',
      boxShadow: '0 0 22px rgba(249,115,22,0.85), 0 0 38px rgba(234,179,8,0.45)',
    };
  }
  if (count >= 5 || (maxCount > 0 && count / maxCount >= 0.5)) {
    return {
      barClass: 'bg-gradient-to-t from-orange-600 via-amber-500 to-yellow-300',
      boxShadow: '0 0 14px rgba(249,115,22,0.6)',
    };
  }
  if (count >= 2 || (maxCount > 0 && count / maxCount >= 0.25)) {
    return {
      barClass: 'bg-gradient-to-t from-orange-700 to-amber-500',
      boxShadow: '0 0 8px rgba(249,115,22,0.35)',
    };
  }
  return {
    barClass: 'bg-gradient-to-t from-orange-950/60 to-orange-500/80',
    boxShadow: 'none',
  };
}

export function StatsView({ friends, presences, onPlayTrack, onOpenArtist }: Props) {
  const [stats] = useState<ListeningStats>(() => loadListeningStats());
  const [selectedFriendCode, setSelectedFriendCode] = useState<string>(friends[0]?.code || '');

  // Navigation & Zoom State
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('week');
  const [cursorDate, setCursorDate] = useState<Date>(() => new Date());
  const [selectedDayDate, setSelectedDayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [zoomAnimClass, setZoomAnimClass] = useState<string>('scale-100 opacity-100');
  const [slideDirection, setSlideDirection] = useState<SlideDirection>(null);
  const [slideKey, setSlideKey] = useState<number>(0);

  // Debounced track player to prevent double click races
  const lastPlayClickRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const handleTrackClick = useCallback(
    (t: Track, q: Track[]) => {
      const now = Date.now();
      if (lastPlayClickRef.current.id === t.id && now - lastPlayClickRef.current.time < 350) {
        return;
      }
      lastPlayClickRef.current = { id: t.id, time: now };
      onPlayTrack(t, q);
    },
    [onPlayTrack]
  );

  // Trigger smooth zoom transition animation
  const triggerZoom = useCallback((newLevel: ZoomLevel, newDate?: Date) => {
    setSlideDirection(null);
    setZoomAnimClass('scale-95 opacity-0 pointer-events-none');
    setTimeout(() => {
      if (newDate) {
        setCursorDate(newDate);
        setSelectedDayDate(newDate.toISOString().slice(0, 10));
      }
      setZoomLevel(newLevel);
      setSlideKey((k) => k + 1);
      setZoomAnimClass('scale-105 opacity-0');
      requestAnimationFrame(() => {
        setZoomAnimClass('scale-100 opacity-100 transition-all duration-300 ease-out');
      });
    }, 150);
  }, []);

  // Arrow navigation handlers with left/right column slide animation
  const handlePrev = useCallback(() => {
    setSlideDirection('left');
    setSlideKey((k) => k + 1);
    setCursorDate((prev) => {
      const next = new Date(prev);
      if (zoomLevel === 'week') {
        const mon = getMonday(prev);
        mon.setDate(mon.getDate() - 7);
        setSelectedDayDate(mon.toISOString().slice(0, 10));
        return mon;
      } else if (zoomLevel === 'month') {
        next.setMonth(next.getMonth() - 1);
        return next;
      } else {
        next.setFullYear(next.getFullYear() - 1);
        return next;
      }
    });
  }, [zoomLevel]);

  const handleNext = useCallback(() => {
    setSlideDirection('right');
    setSlideKey((k) => k + 1);
    setCursorDate((prev) => {
      const next = new Date(prev);
      if (zoomLevel === 'week') {
        const mon = getMonday(prev);
        mon.setDate(mon.getDate() + 7);
        setSelectedDayDate(mon.toISOString().slice(0, 10));
        return mon;
      } else if (zoomLevel === 'month') {
        next.setMonth(next.getMonth() + 1);
        return next;
      } else {
        next.setFullYear(next.getFullYear() + 1);
        return next;
      }
    });
  }, [zoomLevel]);

  // Selected Day breakdown details
  const selectedDayTracks = useMemo(() => {
    return getTracksForDay(stats, selectedDayDate);
  }, [stats, selectedDayDate]);

  const selectedDayLabel = useMemo(() => {
    try {
      const d = new Date(selectedDayDate + 'T12:00:00');
      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return selectedDayDate;
    }
  }, [selectedDayDate]);

  const selectedDayPlayCount = useMemo(() => {
    return stats.dailyPlays[selectedDayDate] || selectedDayTracks.reduce((sum, t) => sum + t.count, 0);
  }, [stats.dailyPlays, selectedDayDate, selectedDayTracks]);

  // General KPIs
  const topTracks = useMemo(() => getTopTracks(stats, 10), [stats]);
  const topArtists = useMemo(() => getTopArtists(stats, 8), [stats]);
  const totalHours = useMemo(() => {
    return (stats.totalListeningSeconds / 3600).toFixed(1);
  }, [stats.totalListeningSeconds]);

  // Selected friend comparison (only using genuine listening history)
  const comparison = useMemo(() => {
    if (!selectedFriendCode) return null;
    const friend = friends.find((f) => f.code === selectedFriendCode);
    const presence = presences[selectedFriendCode];
    if (!friend) return null;

    if (presence?.track) {
      recordFriendTrack(selectedFriendCode, presence.track);
    }

    const observedArtists = getFriendObservedArtists(selectedFriendCode);
    const friendArtists = [...observedArtists];
    if (
      presence?.track?.artist &&
      !friendArtists.some((a) => a.toLowerCase() === presence.track!.artist.trim().toLowerCase())
    ) {
      friendArtists.push(presence.track.artist.trim());
    }

    const result = compareMusicTaste(
      stats,
      friendArtists,
      presence?.track ? [presence.track.title] : []
    );

    return {
      friend,
      presence,
      friendArtists,
      result,
    };
  }, [selectedFriendCode, friends, presences, stats]);

  // Compute breakdown data according to zoom level
  const periodData = useMemo(() => {
    const year = cursorDate.getFullYear();
    const month = cursorDate.getMonth();

    if (zoomLevel === 'week') {
      // Always Monday to Sunday (7 days) without exceptions
      const monday = getMonday(cursorDate);
      const days: { date: string; label: string; count: number; rawDate: Date }[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const iso = d.toISOString().slice(0, 10);
        const dayName = d.toLocaleDateString(undefined, { weekday: 'short' });
        days.push({
          date: iso,
          label: `${dayName} ${d.getDate()}`,
          count: stats.dailyPlays[iso] || 0,
          rawDate: d,
        });
      }
      const totalPeriodPlays = days.reduce((sum, d) => sum + d.count, 0);
      const sunday = days[6].rawDate;
      const monMonth = monday.toLocaleDateString(undefined, { month: 'short' });
      const sunMonth = sunday.toLocaleDateString(undefined, { month: 'short' });
      const title =
        monMonth === sunMonth
          ? `${monday.getDate()} – ${sunday.getDate()} ${monMonth}, ${monday.getFullYear()}`
          : `${monday.getDate()} ${monMonth} – ${sunday.getDate()} ${sunMonth}, ${sunday.getFullYear()}`;
      return {
        type: 'week' as const,
        items: days,
        maxCount: Math.max(1, ...days.map((d) => d.count)),
        totalPlays: totalPeriodPlays,
        title,
        year: monday.getFullYear(),
        month: monday.getMonth(),
      };
    }

    if (zoomLevel === 'month') {
      // All days in this month with calendar start offset (Monday = 0, Sunday = 6)
      const firstDay = new Date(year, month, 1);
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
      const startDayIndex = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

      const days: { date: string; label: string; count: number; rawDate: Date }[] = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${monthPrefix}-${String(day).padStart(2, '0')}`;
        days.push({
          date: iso,
          label: `${day}`,
          count: stats.dailyPlays[iso] || 0,
          rawDate: new Date(year, month, day),
        });
      }
      const totalPeriodPlays = days.reduce((sum, d) => sum + d.count, 0);
      const title = `${MONTH_NAMES[month]} ${year}`;
      return {
        type: 'month' as const,
        items: days,
        startDayIndex,
        maxCount: Math.max(1, ...days.map((d) => d.count)),
        totalPlays: totalPeriodPlays,
        title,
        year,
        month,
      };
    }

    // Year level: 12 months
    const yearPrefix = `${year}-`;
    const months: { label: string; count: number; monthIndex: number }[] = [];
    for (let m = 0; m < 12; m++) {
      const mPrefix = `${yearPrefix}${String(m + 1).padStart(2, '0')}`;
      const count = Object.entries(stats.dailyPlays)
        .filter(([date]) => date.startsWith(mPrefix))
        .reduce((sum, [, c]) => sum + c, 0);
      months.push({
        label: MONTH_SHORT[m],
        count,
        monthIndex: m,
      });
    }
    const totalPeriodPlays = months.reduce((sum, m) => sum + m.count, 0);
    const title = `Year ${year}`;
    return {
      type: 'year' as const,
      items: months,
      maxCount: Math.max(1, ...months.map((m) => m.count)),
      totalPlays: totalPeriodPlays,
      title,
      year,
      month,
    };
  }, [cursorDate, zoomLevel, stats.dailyPlays]);

  return (
    <div className="p-6 sm:p-8 max-w-[1000px] mx-auto w-full space-y-8 animate-fade-in font-sans">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-white/[0.06] pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white">
                Statistics
              </h1>
              <p className="text-xs text-white/50 mt-0.5">
                Detailed metrics for your library, listening history, and taste compatibility
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] shadow-sm">
          <div className="flex items-center justify-between text-white/50 text-xs font-semibold mb-2">
            <span>Completed Tracks</span>
            <Headphones className="w-4 h-4 text-orange-400" />
          </div>
          <div className="text-2xl font-black text-white">{stats.totalPlays}</div>
          <div className="text-[11px] text-white/40 mt-1">Full track completions</div>
        </div>

        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] shadow-sm">
          <div className="flex items-center justify-between text-white/50 text-xs font-semibold mb-2">
            <span>Listening Time</span>
            <Clock className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-white">
            {totalHours} <span className="text-sm font-semibold text-white/50">hrs</span>
          </div>
          <div className="text-[11px] text-white/40 mt-1">{Math.round(stats.totalListeningSeconds / 60)} minutes in music</div>
        </div>

        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] shadow-sm">
          <div className="flex items-center justify-between text-white/50 text-xs font-semibold mb-2">
            <span>Favorite Artists</span>
            <Award className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-white">{Object.keys(stats.artistCounts).length}</div>
          <div className="text-[11px] text-white/40 mt-1">Unique artists recorded</div>
        </div>

        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] shadow-sm">
          <div className="flex items-center justify-between text-white/50 text-xs font-semibold mb-2">
            <span>Period Plays</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white">{periodData.totalPlays}</div>
          <div className="text-[11px] text-white/40 mt-1">In selected {zoomLevel} view</div>
        </div>
      </div>

      {/* Interactive Zoomable Time Chart */}
      <div className="p-6 rounded-3xl bg-white/[0.025] border border-white/[0.08] shadow-lg relative overflow-hidden">
        {/* Navigation & Zoom Bar */}
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          {/* Left: Title & Period Breadcrumb */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded-xl border border-white/5">
              <button
                type="button"
                onClick={handlePrev}
                title="Previous period"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                title="Next period"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-orange-400" />
                <h3 className="text-base font-bold text-white tracking-tight">{periodData.title}</h3>
              </div>
              <p className="text-[11px] text-white/40 mt-0.5">
                {zoomLevel === 'week' && 'Click any day to view track plays, or use Zoom Out to see the month'}
                {zoomLevel === 'month' && 'Click any day bar to drill down into its 7-day week'}
                {zoomLevel === 'year' && 'Click any month card to view its daily breakdown'}
              </p>
            </div>
          </div>

          {/* Right: Zoom Level Switcher */}
          <div className="flex items-center gap-2">
            <div className="flex items-center p-1 rounded-2xl bg-black/40 border border-white/10">
              <button
                type="button"
                onClick={() => triggerZoom('week')}
                className={clsx(
                  'px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1',
                  zoomLevel === 'week'
                    ? 'bg-orange-500 text-black shadow-md shadow-orange-500/30'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                )}
              >
                Week
              </button>
              <button
                type="button"
                onClick={() => triggerZoom('month')}
                className={clsx(
                  'px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1',
                  zoomLevel === 'month'
                    ? 'bg-orange-500 text-black shadow-md shadow-orange-500/30'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                )}
              >
                Month
              </button>
              <button
                type="button"
                onClick={() => triggerZoom('year')}
                className={clsx(
                  'px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1',
                  zoomLevel === 'year'
                    ? 'bg-orange-500 text-black shadow-md shadow-orange-500/30'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                )}
              >
                Year
              </button>
            </div>

            {/* Quick Zoom Out Button */}
            {zoomLevel !== 'year' && (
              <button
                type="button"
                onClick={() => triggerZoom(zoomLevel === 'week' ? 'month' : 'year')}
                title="Zoom Out"
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all cursor-pointer active:scale-95"
              >
                <ZoomOut className="w-3.5 h-3.5 text-orange-400" />
                <span>Zoom Out</span>
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Visualizer Chart Area with Smooth Pop-Out and Left/Right Slide Animations */}
        <div
          key={`${zoomLevel}-${slideKey}`}
          className={clsx(
            'transition-all duration-300 transform',
            zoomAnimClass,
            slideDirection === 'left' && 'animate-in slide-in-from-left-6 duration-200',
            slideDirection === 'right' && 'animate-in slide-in-from-right-6 duration-200'
          )}
        >
          {/* LEVEL 1: WEEK VIEW (7 Days) */}
          {zoomLevel === 'week' && (
            <div>
              <div className="flex items-end gap-2 sm:gap-3.5 h-48 pt-6 px-1">
                {(periodData.items as { date: string; label: string; count: number; rawDate: Date }[]).map((d) => {
                  const heightPct = Math.max(10, Math.round((d.count / periodData.maxCount) * 100));
                  const isDaySelected = d.date === selectedDayDate;
                  const isToday = d.date === new Date().toISOString().slice(0, 10);
                  const { barClass, boxShadow } = getBarIntensity(d.count, periodData.maxCount, isDaySelected);

                  return (
                    <div
                      key={d.date}
                      onClick={() => setSelectedDayDate(d.date)}
                      title={`${d.date}: ${d.count} plays. Click to inspect tracks`}
                      className={clsx(
                        'flex-1 flex flex-col items-center gap-2 h-full justify-end group cursor-pointer p-1 rounded-2xl transition-all',
                        isDaySelected ? 'bg-orange-500/10' : 'hover:bg-white/[0.03]'
                      )}
                    >
                      <span
                        className={clsx(
                          'text-[11px] font-bold transition-opacity',
                          isDaySelected
                            ? 'opacity-100 text-orange-400 font-black'
                            : 'text-orange-400/80 opacity-0 group-hover:opacity-100'
                        )}
                      >
                        {d.count} {d.count === 1 ? 'play' : 'plays'}
                      </span>
                      <div
                        className={clsx(
                          'w-full rounded-t-xl overflow-hidden flex items-end h-full border transition-all duration-300',
                          isDaySelected
                            ? 'border-orange-500 shadow-[0_0_16px_rgba(249,115,22,0.5)] bg-orange-500/10'
                            : 'border-white/5 bg-white/[0.05] group-hover:border-orange-500/50'
                        )}
                      >
                        <div
                          style={{ height: `${heightPct}%`, boxShadow }}
                          className={clsx(
                            'w-full rounded-t-xl transition-all duration-500',
                            barClass
                          )}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <span
                          className={clsx(
                            'text-[11px] font-semibold tracking-tight transition-colors',
                            isDaySelected
                              ? 'text-orange-400 font-bold'
                              : isToday
                              ? 'text-amber-300 font-semibold'
                              : 'text-white/50 group-hover:text-white'
                          )}
                        >
                          {d.label}
                        </span>
                        {isDaySelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_6px_#f97316]" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Day Track Breakdown */}
              <div className="mt-6 pt-5 border-t border-white/[0.08] animate-fade-in">
                <div className="flex items-center justify-between mb-3.5 flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-400">
                      <Calendar className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>{selectedDayLabel}</span>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                          {selectedDayPlayCount} {selectedDayPlayCount === 1 ? 'play' : 'plays'}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-white/40">
                        Tracks completed on this day and play counts
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] text-white/40 hidden sm:inline">
                    Click any day above to view its track breakdown
                  </span>
                </div>

                {selectedDayTracks.length === 0 ? (
                  <div className="p-7 rounded-2xl bg-white/[0.02] border border-white/[0.06] text-center">
                    <Headphones className="w-5 h-5 text-white/20 mx-auto mb-2" />
                    <div className="text-xs font-semibold text-white/50">
                      No track plays recorded on this day
                    </div>
                    <p className="text-[11px] text-white/30 mt-0.5 max-w-sm mx-auto">
                      Completed tracks appear here automatically with their exact play counts.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedDayTracks.map(({ track, count }, idx) => (
                      <div
                        key={track.id}
                        onClick={() => handleTrackClick(track, selectedDayTracks.map((d) => d.track))}
                        className="group flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-orange-500/40 transition-all cursor-pointer shadow-sm hover:shadow-orange-500/5"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-bold text-white/30 w-4 text-center group-hover:text-orange-400 transition-colors">
                            #{idx + 1}
                          </span>
                          <div className="w-9 h-9 rounded-xl overflow-hidden bg-neutral-800 shrink-0 relative border border-white/10 group-hover:border-orange-500/40 transition-colors">
                            <Artwork
                              src={track.artwork}
                              seed={track.id}
                              size={67}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Play className="w-4 h-4 text-white fill-current" />
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate group-hover:text-orange-400 transition-colors">
                              {track.title}
                            </div>
                            <div className="text-[11px] text-white/50 truncate">{track.artist}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-xs font-bold text-orange-400 bg-orange-500/15 px-2.5 py-1 rounded-xl border border-orange-500/30">
                            {count} {count === 1 ? 'play' : 'plays'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* LEVEL 2: MONTH VIEW (Square tiles grid with color intensity) */}
          {zoomLevel === 'month' && (
            <div className="pt-2">
              {/* Day of Week Headers (Mon - Sun) */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2 text-center">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <span key={day} className="text-[11px] font-bold text-white/40 uppercase tracking-wider">
                    {day}
                  </span>
                ))}
              </div>

              {/* Calendar Grid of Square Tiles */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {/* Empty placeholders before the 1st day of month */}
                {Array.from({ length: (periodData as any).startDayIndex || 0 }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="aspect-square rounded-xl bg-white/[0.01] border border-transparent opacity-20 pointer-events-none"
                  />
                ))}

                {/* Day Square Tiles */}
                {(periodData.items as { date: string; label: string; count: number; rawDate: Date }[]).map((d) => {
                  const isToday = d.date === new Date().toISOString().slice(0, 10);
                  const isDaySelected = d.date === selectedDayDate;
                  const { bgClass, numClass, glow } = getTileIntensity(d.count, isToday, isDaySelected);

                  return (
                    <div
                      key={d.date}
                      onClick={() => {
                        setSelectedDayDate(d.date);
                        triggerZoom('week', d.rawDate);
                      }}
                      title={`${d.date}: ${d.count} ${d.count === 1 ? 'play' : 'plays'}. Click to zoom into Monday – Sunday week`}
                      style={{ boxShadow: glow }}
                      className={clsx(
                        'aspect-square rounded-xl border p-1 sm:p-2 flex flex-col justify-between cursor-pointer transition-all duration-200 select-none group hover:scale-[1.04] active:scale-95',
                        bgClass,
                        isToday && 'ring-2 ring-orange-500/80 ring-offset-1 ring-offset-neutral-950',
                        isDaySelected && 'border-orange-400'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className={clsx('text-[11px] sm:text-xs leading-none', numClass)}>
                          {d.label}
                        </span>
                        {isToday && (
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shadow-[0_0_6px_#f97316]" />
                        )}
                      </div>

                      <div className="flex items-end justify-between">
                        {d.count > 0 ? (
                          <span className="text-[10px] sm:text-xs font-black leading-none">
                            {d.count}
                          </span>
                        ) : (
                          <span className="text-[9px] text-white/20 group-hover:text-white/40 leading-none">·</span>
                        )}
                        {d.count > 0 && (
                          <span className="text-[9px] opacity-75 hidden sm:inline leading-none font-medium">
                            {d.count === 1 ? 'play' : 'plays'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Legend & Guide */}
              <div className="flex items-center justify-between flex-wrap gap-3 mt-4 pt-3 border-t border-white/[0.06] text-xs text-white/40">
                <span className="text-[11px]">Click any square tile to zoom into its Monday – Sunday week</span>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-white/40">Less</span>
                  <div className="w-3.5 h-3.5 rounded-md bg-white/[0.04] border border-white/[0.08]" title="0 plays" />
                  <div className="w-3.5 h-3.5 rounded-md bg-orange-950/50 border border-orange-500/30" title="1-2 plays" />
                  <div className="w-3.5 h-3.5 rounded-md bg-orange-800/60 border border-orange-500/60" title="3-5 plays" />
                  <div className="w-3.5 h-3.5 rounded-md bg-gradient-to-br from-orange-600 to-amber-500" title="6-9 plays" />
                  <div className="w-3.5 h-3.5 rounded-md bg-gradient-to-br from-red-600 via-orange-500 to-amber-300" title="10+ plays" />
                  <span className="text-[10px] text-white/40">More</span>
                </div>
              </div>
            </div>
          )}

          {/* LEVEL 3: YEAR VIEW (12 Month tiles) */}
          {zoomLevel === 'year' && (
            <div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-2">
                {(periodData.items as { label: string; count: number; monthIndex: number }[]).map((m) => {
                  const isCurrentMonth =
                    new Date().getFullYear() === cursorDate.getFullYear() &&
                    new Date().getMonth() === m.monthIndex;
                  return (
                    <div
                      key={m.label}
                      onClick={() =>
                        triggerZoom('month', new Date(cursorDate.getFullYear(), m.monthIndex, 1))
                      }
                      title={`Click to zoom into ${MONTH_NAMES[m.monthIndex]}`}
                      className={clsx(
                        'p-4 rounded-2xl border transition-all cursor-pointer group flex flex-col justify-between hover:scale-[1.03] active:scale-95',
                        isCurrentMonth
                          ? 'bg-orange-500/10 border-orange-500/40 shadow-[0_0_20px_rgba(249,115,22,0.15)]'
                          : 'bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.06] hover:border-white/20'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={clsx(
                            'text-xs font-black uppercase tracking-wider',
                            isCurrentMonth ? 'text-orange-400' : 'text-white/70 group-hover:text-white'
                          )}
                        >
                          {m.label}
                        </span>
                      </div>

                      <div className="mt-3">
                        <div className="text-xl font-black text-white group-hover:text-orange-300 transition-colors">
                          {m.count}
                        </div>
                        <div className="text-[10px] text-white/40">
                          {m.count === 1 ? 'play' : 'plays'}
                        </div>
                      </div>

                      <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-3">
                        <div
                          style={{
                            width: `${Math.max(5, Math.min(100, (m.count / periodData.maxCount) * 100))}%`,
                          }}
                          className={clsx(
                            'h-full rounded-full transition-all duration-500',
                            isCurrentMonth ? 'bg-orange-500' : 'bg-white/40 group-hover:bg-cyan-400'
                          )}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-center mt-4 text-xs text-white/40">
                Click any month to zoom in and see every day&apos;s activity
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Artists & Top Tracks Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Artists */}
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
            <Flame className="w-4 h-4 text-amber-400" />
            Most Played Artists
          </h3>

          {topArtists.length === 0 ? (
            <div className="text-center py-8 text-xs text-white/40">
              No completed plays recorded yet. Finish a few tracks to build your stats!
            </div>
          ) : (
            <div className="space-y-2.5">
              {topArtists.slice(0, 6).map((a, idx) => (
                <div
                  key={a.artist}
                  onClick={() =>
                    onOpenArtist?.({
                      id: a.artistId || '',
                      username: a.artist,
                      artistId: a.artistId,
                      artistUrl: a.artistUrl,
                    })
                  }
                  className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-bold text-white/30 w-4 text-center">#{idx + 1}</span>
                    <div className="w-8 h-8 rounded-full bg-neutral-800 overflow-hidden shrink-0 border border-white/10 flex items-center justify-center text-xs font-bold text-orange-400">
                      {a.artist.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-xs font-semibold text-white truncate group-hover:text-orange-400 transition-colors">
                      {a.artist}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-orange-400/90 shrink-0">
                    {a.count} {a.count === 1 ? 'play' : 'plays'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Tracks */}
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Award className="w-4 h-4 text-orange-400" />
              Top Tracks
            </h3>
          </div>

          {topTracks.length === 0 ? (
            <div className="text-center py-8 text-xs text-white/40">
              Listen to tracks to generate your personal Top Tracks leaderboard!
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {topTracks.slice(0, 6).map(({ track, count }, idx) => (
                <div
                  key={track.id}
                  onClick={() => handleTrackClick(track, topTracks.map((t) => t.track))}
                  className="group flex items-center justify-between py-2 px-2.5 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-bold text-white/30 w-4 text-center group-hover:text-orange-400 transition-colors">
                      #{idx + 1}
                    </span>
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-neutral-800 shrink-0 relative">
                      <Artwork
                        src={track.artwork}
                        seed={track.id}
                        size={67}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Play className="w-3.5 h-3.5 text-white fill-current" />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate group-hover:text-orange-400 transition-colors">
                        {track.title}
                      </div>
                      <div className="text-[11px] text-white/50 truncate">{track.artist}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-bold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full border border-orange-500/20">
                      {count} {count === 1 ? 'play' : 'plays'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Friend Music Taste Comparison */}
      <div className="p-6 rounded-3xl bg-gradient-to-br from-purple-950/25 via-neutral-900/50 to-neutral-950 border border-purple-500/20 shadow-xl">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Friend Taste Comparison</h3>
              <p className="text-xs text-white/50">Check musical compatibility with your Abbadon co-listeners</p>
            </div>
          </div>

          {friends.length > 0 && (
            <select
              value={selectedFriendCode}
              onChange={(e) => setSelectedFriendCode(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-xs font-semibold text-white outline-none cursor-pointer hover:bg-white/15"
            >
              {friends.map((f) => (
                <option key={f.code} value={f.code} className="bg-neutral-900 text-white">
                  {f.name} ({f.code})
                </option>
              ))}
            </select>
          )}
        </div>

        {friends.length === 0 ? (
          <div className="text-center py-6 text-xs text-white/40">
            Add friends in the &quot;Friends &amp; Activity&quot; drawer to compare your musical taste!
          </div>
        ) : comparison ? (
          comparison.friendArtists.length === 0 ? (
            <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
              <Headphones className="w-6 h-6 text-purple-400/60 mx-auto mb-2" />
              <div className="text-xs font-semibold text-white/80">
                No listening history recorded for {comparison.friend.name} yet
              </div>
              <p className="text-[11px] text-white/40 mt-1 max-w-sm mx-auto">
                Once {comparison.friend.name} plays tracks on Abbadon, your taste compatibility and shared artists will be calculated here automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center font-bold text-purple-300">
                    {comparison.friend.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      {comparison.friend.name}
                      {comparison.presence?.online && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                      )}
                    </div>
                    <div className="text-[11px] text-white/50">
                      {comparison.presence?.track
                        ? `Listening now: ${comparison.presence.track.title}`
                        : 'Recently active on Abbadon'}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                    {comparison.result.score}%
                  </div>
                  <div className="text-[10px] uppercase tracking-wider font-bold text-purple-300/80">
                    Taste Match
                  </div>
                </div>
              </div>

              {/* Compatibility Progress Bar */}
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                <div
                  style={{ width: `${comparison.result.score}%` }}
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-700"
                />
              </div>

              {/* Shared Highlights */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5">
                  <span className="font-semibold text-white/60 block mb-1">Shared Artists:</span>
                  {comparison.result.sharedArtists.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {comparison.result.sharedArtists.map((a) => (
                        <span
                          key={a}
                          className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-semibold text-[11px]"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-white/40 italic">You explore different musical genres!</span>
                  )}
                </div>

                <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5">
                  <span className="font-semibold text-white/60 block mb-1">Taste Assessment:</span>
                  <span className="text-white font-medium">
                    {comparison.result.score >= 70
                      ? 'Musical twins! You listen to remarkably similar sounds. 🔥'
                      : comparison.result.score >= 40
                        ? 'Solid common ground! You share several favorite styles. ✨'
                        : comparison.result.score > 0
                          ? 'Some crossover! You share a few favorite tracks or artists. 🎵'
                          : 'You explore different musical styles — time to discover something new! 🎧'}
                  </span>
                </div>
              </div>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
