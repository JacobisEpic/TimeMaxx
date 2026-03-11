import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { UI_COLORS, UI_RADIUS } from '@/src/constants/uiTheme';
import { useAppSettings } from '@/src/context/AppSettingsContext';
import { getBlocksForDayRange } from '@/src/storage/blocksDb';
import type { Block } from '@/src/types/blocks';
import { getLocalDayKey } from '@/src/utils/dayKey';

type DayExecution = {
  dayKey: string;
  plannedMinutes: number;
  doneMinutes: number;
  scorePercent: number | null;
};

type CalendarCell = {
  dayKey: string;
  date: Date;
  inCurrentMonth: boolean;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function toDayKey(date: Date): string {
  return getLocalDayKey(date);
}

function addDays(base: Date, count: number): Date {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + count);
  return copy;
}

function getCategoryKey(block: Block): string {
  return block.tags[0]?.trim().toLowerCase() || 'uncategorized';
}

function isExcludedFromMetrics(block: Block): boolean {
  const key = getCategoryKey(block);
  return key === 'none' || key === 'other';
}

function computeExecution(blocks: Block[]): DayExecution {
  let plannedMinutes = 0;
  let doneMinutes = 0;

  for (const block of blocks) {
    if (isExcludedFromMetrics(block)) {
      continue;
    }

    const duration = Math.max(0, block.endMin - block.startMin);
    if (block.lane === 'planned') {
      plannedMinutes += duration;
    } else {
      doneMinutes += duration;
    }
  }

  const scorePercent = plannedMinutes > 0 ? Math.round((doneMinutes / plannedMinutes) * 100) : null;
  return { dayKey: '', plannedMinutes, doneMinutes, scorePercent };
}

function buildCalendarCells(displayMonth: Date): CalendarCell[] {
  const monthStart = getMonthStart(displayMonth);
  const monthEnd = getMonthEnd(displayMonth);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const gridEnd = addDays(monthEnd, 6 - monthEnd.getDay());
  const cells: CalendarCell[] = [];

  let cursor = gridStart;
  while (cursor <= gridEnd) {
    cells.push({
      dayKey: toDayKey(cursor),
      date: cursor,
      inCurrentMonth: cursor.getMonth() === displayMonth.getMonth() && cursor.getFullYear() === displayMonth.getFullYear(),
    });
    cursor = addDays(cursor, 1);
  }

  return cells;
}

export default function MonthView() {
  const router = useRouter();
  const { dataVersion } = useAppSettings();
  const [displayMonth, setDisplayMonth] = useState(() => getMonthStart(new Date()));
  const [dayScores, setDayScores] = useState<Record<string, DayExecution>>({});
  const [loading, setLoading] = useState(false);

  const todayKey = getLocalDayKey();
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      }).format(displayMonth),
    [displayMonth]
  );

  const cells = useMemo(() => buildCalendarCells(displayMonth), [displayMonth]);

  useEffect(() => {
    const monthStart = getMonthStart(displayMonth);
    const monthEnd = getMonthEnd(displayMonth);
    const startKey = toDayKey(monthStart);
    const endKey = toDayKey(monthEnd);
    const fetchEndKey = endKey > todayKey ? todayKey : endKey;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const byDay =
          startKey <= fetchEndKey ? await getBlocksForDayRange(startKey, fetchEndKey) : {};
        if (cancelled) {
          return;
        }

        const nextScores: Record<string, DayExecution> = {};
        const cursor = new Date(monthStart);
        while (cursor <= monthEnd) {
          const dayKey = toDayKey(cursor);
          if (dayKey > todayKey) {
            nextScores[dayKey] = { dayKey, plannedMinutes: 0, doneMinutes: 0, scorePercent: null };
          } else {
            const summary = computeExecution(byDay[dayKey] ?? []);
            nextScores[dayKey] = { ...summary, dayKey };
          }
          cursor.setDate(cursor.getDate() + 1);
        }
        setDayScores(nextScores);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [dataVersion, displayMonth, todayKey]);

  return (
    <View style={styles.screen}>
      <View style={styles.topHeaderRow}>
        <Text style={styles.appTitle}>Month View</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to day view"
          style={styles.iconButton}
          onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={UI_COLORS.neutralText} />
        </Pressable>
      </View>

      <View style={styles.monthHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={styles.iconButton}
          onPress={() => setDisplayMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>
          <Ionicons name="chevron-back" size={18} color={UI_COLORS.neutralText} />
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          style={styles.iconButton}
          onPress={() => setDisplayMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>
          <Ionicons name="chevron-forward" size={18} color={UI_COLORS.neutralText} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.calendarWrap} showsVerticalScrollIndicator={false}>
        <View style={styles.weekdayRow}>
          {WEEKDAY_LABELS.map((label) => (
            <Text key={label} style={styles.weekdayLabel}>
              {label}
            </Text>
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {cells.map((cell) => {
            const score = dayScores[cell.dayKey]?.scorePercent ?? null;
            const isToday = cell.dayKey === todayKey;
            const isFuture = cell.dayKey > todayKey;
            const muted = !cell.inCurrentMonth;

            return (
              <Pressable
                key={cell.dayKey}
                accessibilityRole="button"
                accessibilityLabel={`Open ${cell.dayKey}`}
                style={[
                  styles.dayCell,
                  muted && styles.dayCellMuted,
                  isToday && styles.dayCellToday,
                  isFuture && styles.dayCellFuture,
                ]}
                onPress={() => router.push({ pathname: '/(tabs)', params: { dayKey: cell.dayKey } })}>
                <Text style={[styles.dayNumber, muted && styles.dayNumberMuted]}>{cell.date.getDate()}</Text>
                <Text style={[styles.scoreLabel, muted && styles.scoreLabelMuted]}>
                  {isFuture ? ' ' : score === null ? '—' : `${score}%`}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.legendRow}>
          <Text style={styles.legendText}>Daily execution score shown as `Done / Planned`</Text>
          {loading ? <Text style={styles.legendText}>Loading…</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: UI_COLORS.appBackground,
    paddingTop: 62,
    paddingHorizontal: 16,
  },
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  appTitle: {
    color: UI_COLORS.neutralText,
    fontSize: 21,
    fontWeight: '900',
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: UI_COLORS.glassStroke,
    backgroundColor: UI_COLORS.glassSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonDisabled: {
    opacity: 0.6,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthLabel: {
    color: UI_COLORS.neutralText,
    fontSize: 18,
    fontWeight: '800',
  },
  calendarWrap: {
    paddingBottom: 28,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    color: UI_COLORS.neutralTextSoft,
    fontSize: 11,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    aspectRatio: 1,
    borderRadius: UI_RADIUS.card,
    borderWidth: 1,
    borderColor: UI_COLORS.glassStroke,
    backgroundColor: UI_COLORS.glassSurface,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dayCellMuted: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  dayCellFuture: {
    backgroundColor: '#F8FAFC',
  },
  dayCellToday: {
    borderColor: UI_COLORS.accent,
    borderWidth: 2,
  },
  dayNumber: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '800',
  },
  dayNumberMuted: {
    color: '#94A3B8',
  },
  scoreLabel: {
    color: UI_COLORS.accent,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  scoreLabelMuted: {
    color: '#94A3B8',
  },
  legendRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  legendText: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 11,
    fontWeight: '600',
  },
});
