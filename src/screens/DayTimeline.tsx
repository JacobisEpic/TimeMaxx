import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Block, PIXELS_PER_MINUTE } from '@/src/components/Block';
import { BlockEditorModal } from '@/src/components/BlockEditorModal';
import { TAG_CATALOG } from '@/src/constants/tags';
import { UI_COLORS, UI_RADIUS, UI_TYPE, getCategoryColor, getCategoryLabel } from '@/src/constants/uiTheme';
import { useAppSettings } from '@/src/context/AppSettingsContext';
import { deleteBlock, getBlocksForDay, getBlocksForDayRange, insertBlock, updateBlock } from '@/src/storage/blocksDb';
import type { Block as TimeBlock, Lane } from '@/src/types/blocks';
import { dayKeyToLocalDate, getLocalDayKey, shiftDayKey } from '@/src/utils/dayKey';
import { clamp, formatDuration, formatHHMM, parseHHMM, roundTo15 } from '@/src/utils/time';

type TagFilter = 'all' | (typeof TAG_CATALOG)[number];
type ViewMode = 'compare' | 'planned' | 'actual';

type EditorState = {
  visible: boolean;
  mode: 'create' | 'edit';
  lane: Lane;
  blockId: string | null;
  title: string;
  tags: string[];
  startText: string;
  endText: string;
  linkedPlannedId: string | null;
  errorText: string | null;
};

type QuickPreset = {
  key: string;
  title: string;
  durationMin: number;
  lane: Lane;
  tags: string[];
};

type ScorecardMetrics = {
  plannedMinutes: number;
  doneMinutes: number;
  executionDoneMinutes: number;
  executionScorePercent: number;
};

type CategoryVarianceRow = {
  tag: string;
  label: string;
  color: string;
  plannedMinutes: number;
  doneMinutes: number;
  deltaMinutes: number;
  deltaPercent: number;
};

type DraftCreateState = {
  anchorMin: number;
  startMin: number;
  endMin: number;
  invalid: boolean;
};

type DraftCandidate = {
  anchorMin: number;
  anchorAbsoluteY: number;
  lastAbsoluteY: number;
  startedAtMs: number;
};

type CalendarCell = {
  key: string;
  dayKey: string | null;
  date: Date | null;
  inCurrentMonth: boolean;
};

type CalendarMonth = {
  key: string;
  label: string;
  monthStart: Date;
  rowCount: number;
  height: number;
  cells: CalendarCell[];
};

const MINUTES_PER_DAY = 24 * 60;
const TIMELINE_HEIGHT = MINUTES_PER_DAY * PIXELS_PER_MINUTE;
const TIME_GUTTER_WIDTH = 54;
const SHEET_VISIBLE_HEIGHT = '86%';
const NOW_BUBBLE_HEIGHT = 20;
const NOW_COLOR = '#FF3B30';
const NOW_LINE_CONNECT_OFFSET = 4;
const FEEDBACK_DURATION_MS = 1500;
const CREATE_THRESHOLD_PX = 16;
const CREATE_DELAY_MS = 260;
const TAP_CREATE_MIN_HOLD_MS = 500;
const TAP_CREATE_DURATION_MIN = 60;
const SCROLL_LIKE_VELOCITY_Y = 900;
const CALENDAR_WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const CALENDAR_MONTH_SPAN = 12;
const CALENDAR_CELL_HEIGHT = 52;
const CALENDAR_MONTH_LABEL_HEIGHT = 38;
const CALENDAR_WEEKDAY_ROW_HEIGHT = 22;
const CALENDAR_MONTH_BOTTOM_SPACE = 16;

const QUICK_PRESETS: QuickPreset[] = [
  { key: 'focus-60', title: 'Focus', durationMin: 60, lane: 'planned', tags: ['focus'] },
  { key: 'work-90', title: 'Work', durationMin: 90, lane: 'planned', tags: ['work'] },
  { key: 'admin-30', title: 'Admin', durationMin: 30, lane: 'planned', tags: ['work'] },
  { key: 'workout-60', title: 'Workout', durationMin: 60, lane: 'actual', tags: ['health'] },
  { key: 'break-15', title: 'Break', durationMin: 15, lane: 'actual', tags: ['break'] },
  { key: 'personal-60', title: 'Personal', durationMin: 60, lane: 'actual', tags: ['personal'] },
];

const INITIAL_EDITOR_STATE: EditorState = {
  visible: false,
  mode: 'create',
  lane: 'planned',
  blockId: null,
  title: '',
  tags: [],
  startText: '08:00',
  endText: '09:00',
  linkedPlannedId: null,
  errorText: null,
};

function formatHourLabel(hour: number): string {
  if (hour === 0) {
    return '12 AM';
  }

  if (hour < 12) {
    return `${hour} AM`;
  }

  if (hour === 12) {
    return '12 PM';
  }

  return `${hour - 12} PM`;
}

function getNextQuarterMinuteFromNow(): number {
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const nextQuarter = Math.ceil(minute / 15) * 15;
  return clamp(nextQuarter, 0, MINUTES_PER_DAY - 15);
}

function parseDayKeyParam(input: string | string[] | undefined): string | null {
  const raw = Array.isArray(input) ? input[0] : input;

  if (!raw) {
    return null;
  }

  return dayKeyToLocalDate(raw) ? raw : null;
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getCalendarMonthHeight(rowCount: number): number {
  return CALENDAR_MONTH_LABEL_HEIGHT + CALENDAR_WEEKDAY_ROW_HEIGHT + rowCount * CALENDAR_CELL_HEIGHT + CALENDAR_MONTH_BOTTOM_SPACE;
}

function buildMonthCells(monthStart: Date): { cells: CalendarCell[]; rowCount: number; height: number } {
  const start = getMonthStart(monthStart);
  const firstWeekday = start.getDay();
  const dayCount = getDaysInMonth(start);
  const rowCount = Math.ceil((firstWeekday + dayCount) / 7);
  const totalCells = rowCount * 7;
  const cells: CalendarCell[] = [];

  for (let i = 0; i < totalCells; i += 1) {
    const dayOfMonth = i - firstWeekday + 1;
    const isInMonth = dayOfMonth >= 1 && dayOfMonth <= dayCount;
    const date = isInMonth ? new Date(start.getFullYear(), start.getMonth(), dayOfMonth) : null;
    cells.push({
      key: `${start.getFullYear()}-${start.getMonth() + 1}-${i}`,
      dayKey: date ? getLocalDayKey(date) : null,
      date,
      inCurrentMonth: isInMonth,
    });
  }

  return { cells, rowCount, height: getCalendarMonthHeight(rowCount) };
}

function buildCalendarMonths(anchorDate: Date): CalendarMonth[] {
  const months: CalendarMonth[] = [];

  for (let offset = -CALENDAR_MONTH_SPAN; offset <= CALENDAR_MONTH_SPAN; offset += 1) {
    const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + offset, 1);
    const monthCells = buildMonthCells(monthStart);
    months.push({
      key: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat(undefined, { month: 'long' }).format(monthStart),
      monthStart,
      rowCount: monthCells.rowCount,
      height: monthCells.height,
      cells: monthCells.cells,
    });
  }

  return months;
}

function formatCurrentTimeLabel(min: number): string {
  const safe = clamp(Math.round(min), 0, MINUTES_PER_DAY - 1);
  const hour24 = Math.floor(safe / 60);
  const minute = safe % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')}`;
}

function formatAmPm(min: number): string {
  const rounded = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(min)));
  const safe = rounded === MINUTES_PER_DAY ? 0 : rounded;
  const hours24 = Math.floor(safe / 60);
  const minutes = safe % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
}

function sortByStartMin(items: TimeBlock[]): TimeBlock[] {
  return [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id)
  );
}

function hasOverlap(
  lane: Lane,
  ignoreId: string | null,
  startMin: number,
  endMin: number,
  blocks: TimeBlock[]
): boolean {
  return blocks.some((other) => {
    if (other.lane !== lane || other.id === ignoreId) {
      return false;
    }

    return startMin < other.endMin && endMin > other.startMin;
  });
}

function matchesTagFilter(block: TimeBlock, tagFilter: TagFilter): boolean {
  if (tagFilter === 'all') {
    return true;
  }

  return block.tags.map((tag) => tag.toLowerCase()).includes(tagFilter);
}

function buildTagTotals(
  blocks: TimeBlock[]
): { tag: string; plannedMin: number; actualMin: number; deltaMin: number }[] {
  const totals = new Map<string, { plannedMin: number; actualMin: number }>();

  blocks.forEach((block) => {
    const duration = Math.max(0, block.endMin - block.startMin);

    block.tags.forEach((rawTag) => {
      const tag = rawTag.trim().toLowerCase();

      if (!tag) {
        return;
      }

      const current = totals.get(tag) ?? { plannedMin: 0, actualMin: 0 };

      if (block.lane === 'planned') {
        current.plannedMin += duration;
      } else {
        current.actualMin += duration;
      }

      totals.set(tag, current);
    });
  });

  return [...totals.entries()]
    .map(([tag, value]) => ({
      tag,
      plannedMin: value.plannedMin,
      actualMin: value.actualMin,
      deltaMin: value.actualMin - value.plannedMin,
    }))
    .sort((a, b) => b.actualMin - a.actualMin || a.tag.localeCompare(b.tag));
}

function formatBlockLine(block: TimeBlock): string {
  const tagsText = block.tags.length > 0 ? block.tags.join(', ') : 'none';
  return `${formatHHMM(block.startMin)}-${formatHHMM(block.endMin)} | ${block.title} | tags: ${tagsText}`;
}

function minutesToHM(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const restMinutes = safeMinutes % 60;

  if (hours === 0) {
    return `${restMinutes}m`;
  }

  if (restMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${restMinutes}m`;
}

function formatSignedMinutes(minutes: number): string {
  const prefix = minutes >= 0 ? '+' : '-';
  return `${prefix}${minutesToHM(Math.abs(minutes))}`;
}

function computeDeltaPercent(doneMinutes: number, plannedMinutes: number): number {
  if (plannedMinutes <= 0) {
    return doneMinutes > 0 ? 100 : 0;
  }

  return Math.round(((doneMinutes - plannedMinutes) / plannedMinutes) * 100);
}

function getCategoryKey(block: TimeBlock): string {
  return block.tags[0]?.trim().toLowerCase() || 'uncategorized';
}

function isExcludedFromMetrics(block: TimeBlock): boolean {
  const key = getCategoryKey(block);
  return key === 'other' || key === 'none';
}

function toSingleCategory(tags: string[]): string[] {
  const first = tags[0]?.trim().toLowerCase();
  return first ? [first] : [];
}

function findEarliestSlot(
  lane: Lane,
  durationMin: number,
  preferredStartMin: number,
  blocks: TimeBlock[]
): { startMin: number; endMin: number } | null {
  if (durationMin <= 0 || durationMin > MINUTES_PER_DAY) {
    return null;
  }

  const startCandidate = clamp(roundTo15(preferredStartMin), 0, MINUTES_PER_DAY - durationMin);

  for (let startMin = startCandidate; startMin + durationMin <= MINUTES_PER_DAY; startMin += 15) {
    const endMin = startMin + durationMin;

    if (!hasOverlap(lane, null, startMin, endMin, blocks)) {
      return { startMin, endMin };
    }
  }

  return null;
}

function normalizeDraftRange(anchorMin: number, cursorMin: number): { startMin: number; endMin: number } {
  if (cursorMin >= anchorMin) {
    return {
      startMin: anchorMin,
      endMin: Math.min(MINUTES_PER_DAY, cursorMin + 15),
    };
  }

  return {
    startMin: Math.max(0, cursorMin),
    endMin: Math.min(MINUTES_PER_DAY, anchorMin + 15),
  };
}

function minuteFromGestureY(y: number): number | null {
  if (!Number.isFinite(y)) {
    return null;
  }

  const minute = Math.floor(y / PIXELS_PER_MINUTE);

  if (!Number.isFinite(minute)) {
    return null;
  }

  return clamp(roundTo15(minute), 0, MINUTES_PER_DAY - 15);
}

async function triggerSelectionHaptic(): Promise<void> {
  try {
    await Haptics.selectionAsync();
  } catch {
    // Ignore platform/runtime haptics failures during gesture interactions.
  }
}

async function triggerSuccessHaptic(): Promise<void> {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Ignore platform/runtime haptics failures during gesture interactions.
  }
}

export default function DayTimeline() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { dayKey: dayKeyParam } = useLocalSearchParams<{ dayKey?: string | string[] }>();
  const routeDayKey = useMemo(() => parseDayKeyParam(dayKeyParam), [dayKeyParam]);
  const { settings, loading: settingsLoading, dataVersion } = useAppSettings();
  const { height: windowHeight } = useWindowDimensions();

  const [dayKey, setDayKey] = useState(() => routeDayKey ?? getLocalDayKey());
  const [dataReloadTick, setDataReloadTick] = useState(0);
  const [clockMinute, setClockMinute] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState>(INITIAL_EDITOR_STATE);
  const [selectedLane, setSelectedLane] = useState<Lane>('planned');
  const [lastUsedCreateLane, setLastUsedCreateLane] = useState<Lane>('planned');
  const [laneVisibility, setLaneVisibility] = useState<Record<Lane, boolean>>({
    planned: true,
    actual: false,
  });
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');
  const [toolsSheetVisible, setToolsSheetVisible] = useState(false);
  const [actionsMenuVisible, setActionsMenuVisible] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarScoreByDay, setCalendarScoreByDay] = useState<Record<string, number | null>>({});
  const [calendarVisibleYear, setCalendarVisibleYear] = useState(() => new Date().getFullYear());
  const [focusedPlannedId, setFocusedPlannedId] = useState<string | null>(null);
  const [quickAddExpanded, setQuickAddExpanded] = useState(false);
  const [draftCreate, setDraftCreate] = useState<DraftCreateState | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [dragPreviewById, setDragPreviewById] = useState<Record<string, { startMin: number; endMin: number }>>({});
  const draftCreateRef = useRef<DraftCreateState | null>(null);
  const createHapticKeyRef = useRef<string | null>(null);
  const draftCandidateRef = useRef<DraftCandidate | null>(null);
  const finalizeHandledRef = useRef(false);
  const createGestureBlockedRef = useRef(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRequestIdRef = useRef(0);
  const timelineScrollRef = useRef<ScrollView | null>(null);
  const calendarListRef = useRef<FlatList<CalendarMonth> | null>(null);
  const calendarInitialPositionedRef = useRef(false);
  const timelineViewportTopRef = useRef(0);
  const timelineScrollOffsetYRef = useRef(0);
  const autoScrolledDayKeyRef = useRef<string | null>(null);

  const todayDayKey = getLocalDayKey();
  const canGoToNextDay = dayKey < todayDayKey;
  const isViewingToday = dayKey === todayDayKey;
  const selectedDate = useMemo(() => dayKeyToLocalDate(dayKey) ?? new Date(), [dayKey]);
  const calendarMonths = useMemo(() => buildCalendarMonths(selectedDate), [selectedDate]);
  const selectedMonthIndex = CALENDAR_MONTH_SPAN;
  const calendarMonthOffsets = useMemo(() => {
    const offsets: number[] = [];
    let running = 0;
    for (const month of calendarMonths) {
      offsets.push(running);
      running += month.height;
    }
    return offsets;
  }, [calendarMonths]);
  const centeredMonthOffset = useMemo(() => {
    const estimatedCalendarViewportHeight = Math.max(0, windowHeight - 124);
    const selectedMonthTop = calendarMonthOffsets[selectedMonthIndex] ?? 0;
    const selectedMonthHeight = calendarMonths[selectedMonthIndex]?.height ?? 0;
    const centeredOffset =
      selectedMonthTop -
      (estimatedCalendarViewportHeight - selectedMonthHeight) / 2;
    return Math.max(0, Math.round(centeredOffset));
  }, [calendarMonthOffsets, calendarMonths, selectedMonthIndex, windowHeight]);
  const calendarViewabilityConfig = useRef({ itemVisiblePercentThreshold: 45 });
  const onViewableMonthsChanged = useRef(
    ({ viewableItems }: { viewableItems: { item: CalendarMonth }[] }) => {
      const firstVisible = viewableItems[0]?.item;
      if (firstVisible) {
        setCalendarVisibleYear(firstVisible.monthStart.getFullYear());
      }
    }
  );

  const visibleDateLabel = useMemo(() => {
    const date = dayKeyToLocalDate(dayKey);

    if (!date) {
      return dayKey;
    }

    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }, [dayKey]);
  const dateRowLabel = useMemo(() => {
    const date = dayKeyToLocalDate(dayKey);

    if (!date) {
      return dayKey;
    }

    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }, [dayKey]);

  const sortedBlocks = useMemo(() => sortByStartMin(blocks), [blocks]);
  const plannedBlocks = useMemo(
    () => sortByStartMin(sortedBlocks.filter((block) => block.lane === 'planned')),
    [sortedBlocks]
  );
  const metricBlocks = useMemo(
    () => sortedBlocks.filter((block) => !isExcludedFromMetrics(block)),
    [sortedBlocks]
  );
  const metricPlannedBlocks = useMemo(
    () => sortByStartMin(metricBlocks.filter((block) => block.lane === 'planned')),
    [metricBlocks]
  );
  const metricActualBlocks = useMemo(
    () => sortByStartMin(metricBlocks.filter((block) => block.lane === 'actual')),
    [metricBlocks]
  );
  const plannedLinkOptions = useMemo(
    () =>
      plannedBlocks.map((block) => ({
        id: block.id,
        title: block.title,
        startMin: block.startMin,
        endMin: block.endMin,
        tags: block.tags,
      })),
    [plannedBlocks]
  );
  const categoryOptions = settings.categories;
  const categoryColorMap = useMemo(
    () =>
      categoryOptions.reduce<Record<string, string>>((acc, category) => {
        acc[category.id.toLowerCase()] = category.color;
        return acc;
      }, {}),
    [categoryOptions]
  );
  const categoryLabelMap = useMemo(
    () =>
      categoryOptions.reduce<Record<string, string>>((acc, category) => {
        acc[category.id.toLowerCase()] = category.label;
        return acc;
      }, {}),
    [categoryOptions]
  );
  const categoryVarianceRows = useMemo<CategoryVarianceRow[]>(() => {
    const totals = new Map<string, { planned: number; actual: number }>();

    metricPlannedBlocks.forEach((block) => {
      const key = getCategoryKey(block);
      const value = totals.get(key) ?? { planned: 0, actual: 0 };
      value.planned += Math.max(0, block.endMin - block.startMin);
      totals.set(key, value);
    });

    metricActualBlocks.forEach((block) => {
      const key = getCategoryKey(block);
      const value = totals.get(key) ?? { planned: 0, actual: 0 };
      value.actual += Math.max(0, block.endMin - block.startMin);
      totals.set(key, value);
    });

    return [...totals.entries()]
      .map(([tag, value]) => ({
      tag,
      label: categoryLabelMap[tag] ?? getCategoryLabel(tag),
      color: categoryColorMap[tag] ?? getCategoryColor(tag),
      plannedMinutes: value.planned,
      doneMinutes: value.actual,
      deltaMinutes: value.actual - value.planned,
      deltaPercent: computeDeltaPercent(value.actual, value.planned),
    }))
      .sort((a, b) => Math.abs(b.deltaMinutes) - Math.abs(a.deltaMinutes) || a.label.localeCompare(b.label));
  }, [categoryColorMap, categoryLabelMap, metricActualBlocks, metricPlannedBlocks]);
  const nowMinute = clockMinute;

  const { plannedTotalMin, doneTotalMin } = useMemo(() => {
    const totals = metricBlocks.reduce(
      (acc, block) => {
        const duration = Math.max(0, block.endMin - block.startMin);

        if (block.lane === 'planned') {
          acc.plannedTotalMin += duration;
        } else {
          acc.doneTotalMin += duration;
        }

        return acc;
      },
      { plannedTotalMin: 0, doneTotalMin: 0 }
    );

    return {
      plannedTotalMin: totals.plannedTotalMin,
      doneTotalMin: totals.doneTotalMin,
    };
  }, [metricBlocks]);

  const tagTotals = useMemo(() => buildTagTotals(metricBlocks), [metricBlocks]);
  const tagFilterOptions = useMemo(() => {
    const options = new Set<TagFilter>(['all']);
    tagTotals.forEach((row) => {
      if ((TAG_CATALOG as readonly string[]).includes(row.tag)) {
        options.add(row.tag as TagFilter);
      }
    });

    for (const tag of TAG_CATALOG) {
      if (options.size >= 6) {
        break;
      }
      options.add(tag);
    }

    return [...options];
  }, [tagTotals]);

  const scorecardMetrics = useMemo<ScorecardMetrics>(() => {
    const executionDoneMinutes = doneTotalMin;
    const executionScoreRaw = plannedTotalMin > 0 ? (executionDoneMinutes / plannedTotalMin) * 100 : 0;

    return {
      plannedMinutes: plannedTotalMin,
      doneMinutes: doneTotalMin,
      executionDoneMinutes,
      executionScorePercent: Math.min(100, Math.round(executionScoreRaw)),
    };
  }, [doneTotalMin, plannedTotalMin]);

  const maxCategoryMinutes = useMemo(
    () => categoryVarianceRows.reduce((max, row) => Math.max(max, row.plannedMinutes, row.doneMinutes), 0),
    [categoryVarianceRows]
  );

  useEffect(() => {
    if (!calendarVisible || calendarMonths.length === 0) {
      return;
    }

    const firstMonthCells = calendarMonths[0].cells;
    const lastMonthCells = calendarMonths[calendarMonths.length - 1].cells;
    const startDayKey = firstMonthCells.find((cell) => cell.inCurrentMonth)?.dayKey;
    const endDayKey = [...lastMonthCells].reverse().find((cell) => cell.inCurrentMonth)?.dayKey;

    if (!startDayKey || !endDayKey) {
      return;
    }

    let cancelled = false;

    const loadCalendarScores = async () => {
      try {
        const blocksByDay = await getBlocksForDayRange(startDayKey, endDayKey);

        if (cancelled) {
          return;
        }

        const nextScores: Record<string, number | null> = {};
        for (const month of calendarMonths) {
          for (const cell of month.cells) {
            if (!cell.inCurrentMonth || !cell.dayKey) {
              continue;
            }

            const dayBlocks = blocksByDay[cell.dayKey] ?? [];
            let plannedMinutes = 0;
            let doneMinutes = 0;

            for (const block of dayBlocks) {
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

            nextScores[cell.dayKey] = plannedMinutes > 0 ? Math.min(100, Math.round((doneMinutes / plannedMinutes) * 100)) : null;
          }
        }

        setCalendarScoreByDay(nextScores);
      } catch {
        if (!cancelled) {
          setCalendarScoreByDay({});
        }
      }
    };

    void loadCalendarScores();

    return () => {
      cancelled = true;
    };
  }, [calendarMonths, calendarVisible, dataVersion]);

  const reloadCurrentDay = useCallback(() => {
    setDataReloadTick((current) => current + 1);
  }, []);

  const closeCalendar = useCallback(() => {
    setCalendarVisible(false);
  }, []);

  const openCalendar = useCallback(() => {
    setCalendarVisibleYear(selectedDate.getFullYear());
    calendarInitialPositionedRef.current = false;
    setCalendarVisible(true);
  }, [selectedDate]);

  const syncTimelineViewportTop = useCallback(() => {
    const measurable = timelineScrollRef.current as unknown as
      | {
          measureInWindow?: (
            cb: (x: number, y: number, width: number, height: number) => void
          ) => void;
        }
      | null;

    measurable?.measureInWindow?.((_x: number, y: number) => {
      timelineViewportTopRef.current = y;
    });
  }, []);

  const minuteFromAbsoluteY = useCallback((absoluteY: number): number | null => {
    if (!Number.isFinite(absoluteY)) {
      return null;
    }

    const relativeY =
      absoluteY - timelineViewportTopRef.current + timelineScrollOffsetYRef.current;
    return minuteFromGestureY(relativeY);
  }, []);

  const closeEditor = useCallback(() => {
    setEditorState((current) => ({ ...current, visible: false, errorText: null }));
  }, []);

  useEffect(() => {
    setDayKey(getLocalDayKey());
    setDataReloadTick((current) => current + 1);
  }, [dataVersion]);

  useEffect(() => {
    if (!routeDayKey) {
      return;
    }

    setDayKey(routeDayKey);
  }, [routeDayKey]);

  useEffect(() => {
    const loadData = async () => {
      const requestId = ++loadRequestIdRef.current;
      setBlocks([]);
      setActiveDragId(null);
      setFocusedPlannedId(null);
      setDraftCreate(null);
      setDragPreviewById({});
      draftCreateRef.current = null;
      draftCandidateRef.current = null;
      setIsCreatingDraft(false);

      try {
        const loadedBlocks = await getBlocksForDay(dayKey);

        if (requestId === loadRequestIdRef.current) {
          setBlocks(sortByStartMin(loadedBlocks));
        }
      } catch {
        if (requestId === loadRequestIdRef.current) {
          Alert.alert('Storage error', 'Could not load blocks for this day.');
        }
      }
    };

    void loadData();

    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, [dayKey, dataReloadTick, dataVersion]);

  useEffect(() => {
    if (autoScrolledDayKeyRef.current === dayKey) {
      return;
    }

    const targetMinute =
      dayKey === todayDayKey ? Math.max(0, nowMinute - 90) : 8 * 60;
    const targetY = targetMinute * PIXELS_PER_MINUTE;

    const timer = setTimeout(() => {
      timelineScrollRef.current?.scrollTo({ y: targetY, animated: false });
      autoScrolledDayKeyRef.current = dayKey;
    }, 0);

    return () => clearTimeout(timer);
  }, [dayKey, nowMinute, todayDayKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      syncTimelineViewportTop();
    }, 0);

    return () => clearTimeout(timer);
  }, [dayKey, syncTimelineViewportTop]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setClockMinute(now.getHours() * 60 + now.getMinutes());
    }, 60_000);

    return () => clearInterval(timer);
  }, []);

  const showFeedback = useCallback((message: string) => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }

    setFeedbackMessage(message);

    feedbackTimerRef.current = setTimeout(() => {
      setFeedbackMessage(null);
      feedbackTimerRef.current = null;
    }, FEEDBACK_DURATION_MS);
  }, []);

  const openCreateEditor = useCallback(
    (lane: Lane, presetRange?: { startMin: number; endMin: number }) => {
      setLastUsedCreateLane(lane);
      const defaultStart = getNextQuarterMinuteFromNow();
      const startMin = presetRange?.startMin ?? clamp(roundTo15(defaultStart), 0, MINUTES_PER_DAY - 15);
      const endMin = presetRange?.endMin ?? Math.min(MINUTES_PER_DAY, startMin + 60);

      setEditorState({
        visible: true,
        mode: 'create',
        lane,
        blockId: null,
        title: '',
        tags: [],
        startText: formatHHMM(startMin),
        endText: formatHHMM(endMin),
        linkedPlannedId: null,
        errorText: null,
      });
    },
    []
  );

  const openEditEditor = useCallback((block: TimeBlock) => {
    setEditorState({
      visible: true,
      mode: 'edit',
      lane: block.lane,
      blockId: block.id,
      title: block.title,
      tags: toSingleCategory(block.tags),
      startText: formatHHMM(block.startMin),
      endText: formatHHMM(block.endMin),
      linkedPlannedId: block.lane === 'actual' ? block.linkedPlannedId ?? null : null,
      errorText: null,
    });
  }, []);

  const goToPreviousDay = useCallback(() => {
    closeEditor();
    setDayKey((current) => shiftDayKey(current, -1));
  }, [closeEditor]);

  const goToToday = useCallback(() => {
    closeEditor();
    autoScrolledDayKeyRef.current = null;
    setDayKey(getLocalDayKey());
  }, [closeEditor]);

  const goToNextDay = useCallback(() => {
    if (!canGoToNextDay) {
      return;
    }

    closeEditor();
    setDayKey((current) => {
      const nextKey = shiftDayKey(current, 1);
      return nextKey > todayDayKey ? current : nextKey;
    });
  }, [canGoToNextDay, closeEditor, todayDayKey]);

  const handleDragStart = useCallback((blockId: string) => {
    setActiveDragId(blockId);
  }, []);

  const handleDragRelease = useCallback((blockId: string) => {
    setFocusedPlannedId(null);
    setActiveDragId((current) => (current === blockId ? null : current));
    setDragPreviewById((current) => {
      if (!(blockId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[blockId];
      return next;
    });
  }, []);

  const handleDragStep = useCallback(() => {
    setFocusedPlannedId(null);
    void triggerSelectionHaptic();
  }, []);

  const handleDragPreview = useCallback((blockId: string, startMin: number, endMin: number) => {
    setDragPreviewById((current) => {
      const existing = current[blockId];
      if (existing && existing.startMin === startMin && existing.endMin === endMin) {
        return current;
      }

      return {
        ...current,
        [blockId]: { startMin, endMin },
      };
    });
  }, []);

  const handleDragEnd = useCallback(
    (blockId: string, proposedStartMin: number) => {
      const draggedBlock = sortedBlocks.find((block) => block.id === blockId);

      if (!draggedBlock) {
        return;
      }

      const duration = draggedBlock.endMin - draggedBlock.startMin;
      const snappedStartMin = roundTo15(Math.round(proposedStartMin));
      const clampedStartMin = clamp(snappedStartMin, 0, MINUTES_PER_DAY - duration);
      const nextEndMin = clampedStartMin + duration;

      if (hasOverlap(draggedBlock.lane, blockId, clampedStartMin, nextEndMin, sortedBlocks)) {
        showFeedback('Time overlaps another block');
        setDragPreviewById((current) => {
          const next = { ...current };
          delete next[blockId];
          return next;
        });
        return;
      }

      if (clampedStartMin === draggedBlock.startMin) {
        setDragPreviewById((current) => {
          const next = { ...current };
          delete next[blockId];
          return next;
        });
        return;
      }

      const updatedBlock: TimeBlock = {
        ...draggedBlock,
        startMin: clampedStartMin,
        endMin: nextEndMin,
      };

      void (async () => {
        try {
          await updateBlock(updatedBlock, dayKey);
          setBlocks((current) =>
            sortByStartMin(current.map((block) => (block.id === blockId ? updatedBlock : block)))
          );
          setDragPreviewById((current) => {
            const next = { ...current };
            delete next[blockId];
            return next;
          });
          void triggerSuccessHaptic();
        } catch {
          Alert.alert('Storage error', 'Could not save drag change.');
        }
      })();
    },
    [dayKey, showFeedback, sortedBlocks]
  );

  const handleBlockPress = useCallback(
    (blockId: string) => {
      if (activeDragId !== null || isCreatingDraft) {
        return;
      }

      const block = sortedBlocks.find((item) => item.id === blockId);

      if (!block) {
        return;
      }

      openEditEditor(block);
    },
    [activeDragId, isCreatingDraft, openEditEditor, sortedBlocks]
  );

  const handleBlockFocusStart = useCallback(
    (blockId: string) => {
      if (activeDragId !== null || isCreatingDraft) {
        return;
      }

      const block = sortedBlocks.find((item) => item.id === blockId);
      if (!block) {
        return;
      }

      if (block.lane === 'planned') {
        setFocusedPlannedId(block.id);
        return;
      }

      setFocusedPlannedId(block.linkedPlannedId ?? null);
    },
    [activeDragId, isCreatingDraft, sortedBlocks]
  );

  const handleBlockFocusEnd = useCallback(() => {
    setFocusedPlannedId(null);
  }, []);

  const setEditorField = useCallback((field: keyof EditorState, value: string) => {
    setEditorState((current) => ({ ...current, [field]: value, errorText: null }));
  }, []);

  const setEditorLane = useCallback((lane: Lane) => {
    setEditorState((current) => ({
      ...current,
      lane,
      linkedPlannedId: lane === 'actual' ? current.linkedPlannedId : null,
      errorText: null,
    }));
  }, []);

  const toggleEditorTag = useCallback((tag: string) => {
    setEditorState((current) => {
      const normalized = tag.toLowerCase();
      const selected = current.tags[0]?.toLowerCase() === normalized;

      return {
        ...current,
        tags: selected ? [] : [normalized],
        errorText: null,
      };
    });
  }, []);

  const handleDelete = useCallback(() => {
    if (editorState.mode !== 'edit' || !editorState.blockId) {
      return;
    }

    const targetId = editorState.blockId;

    Alert.alert('Delete block', 'Are you sure you want to delete this block?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteBlock(targetId);
              setBlocks((current) => current.filter((block) => block.id !== targetId));
              closeEditor();
            } catch {
              Alert.alert('Storage error', 'Could not delete block.');
            }
          })();
        },
      },
    ]);
  }, [closeEditor, editorState.blockId, editorState.mode]);

  const handleSaveEditor = useCallback(() => {
    const title = editorState.title.trim();

    if (title.length === 0) {
      Alert.alert('Missing title', 'Title cannot be empty.');
      return;
    }

    const parsedStart = parseHHMM(editorState.startText);
    const parsedEnd = parseHHMM(editorState.endText);

    if (parsedStart === null || parsedEnd === null) {
      setEditorState((current) => ({
        ...current,
        errorText: 'Enter start and end using HH:MM (24-hour time).',
      }));
      return;
    }

    const startMin = roundTo15(parsedStart);
    const endMin = roundTo15(parsedEnd);
    const normalizedLinkedPlannedId =
      editorState.linkedPlannedId && plannedLinkOptions.some((option) => option.id === editorState.linkedPlannedId)
        ? editorState.linkedPlannedId
        : null;

    if (startMin < 0 || endMin > MINUTES_PER_DAY || endMin <= startMin) {
      setEditorState((current) => ({
        ...current,
        errorText: 'Time range must be within 00:00 to 24:00 and end after start.',
      }));
      return;
    }

    if (editorState.mode === 'edit') {
      if (!editorState.blockId) {
        setEditorState((current) => ({ ...current, errorText: 'Block not found.' }));
        return;
      }

      const existing = sortedBlocks.find((block) => block.id === editorState.blockId);

      if (!existing) {
        setEditorState((current) => ({ ...current, errorText: 'Block not found.' }));
        return;
      }

      if (hasOverlap(existing.lane, existing.id, startMin, endMin, sortedBlocks)) {
        Alert.alert('Invalid time', 'Time overlaps another block.');
        return;
      }

      const updatedBlock: TimeBlock = {
        ...existing,
        title,
        tags: toSingleCategory(editorState.tags),
        startMin,
        endMin,
        linkedPlannedId: existing.lane === 'actual' ? normalizedLinkedPlannedId : undefined,
      };

      void (async () => {
        try {
          await updateBlock(updatedBlock, dayKey);
          setBlocks((current) =>
            sortByStartMin(current.map((block) => (block.id === updatedBlock.id ? updatedBlock : block)))
          );
          void triggerSuccessHaptic();
          closeEditor();
        } catch {
          Alert.alert('Storage error', 'Could not save block changes.');
        }
      })();

      return;
    }

    if (hasOverlap(editorState.lane, null, startMin, endMin, sortedBlocks)) {
      Alert.alert('Invalid time', 'Time overlaps another block.');
      return;
    }

    const newBlockInput: Omit<TimeBlock, 'id'> = {
      lane: editorState.lane,
      title,
      tags: toSingleCategory(editorState.tags),
      startMin,
      endMin,
      linkedPlannedId: editorState.lane === 'actual' ? normalizedLinkedPlannedId : undefined,
    };

    void (async () => {
      try {
        const insertedBlock = await insertBlock(newBlockInput, dayKey);
        setBlocks((current) => sortByStartMin([...current, insertedBlock]));
        setLastUsedCreateLane(editorState.lane);
        void triggerSuccessHaptic();
        closeEditor();
      } catch {
        Alert.alert('Storage error', 'Could not create block.');
      }
    })();
  }, [closeEditor, dayKey, editorState, plannedLinkOptions, sortedBlocks]);

  const isEditorSaveDisabled = useMemo(() => {
    const titleValid = editorState.title.trim().length > 0;
    const hasCategory = editorState.tags.length > 0;
    const parsedStart = parseHHMM(editorState.startText);
    const parsedEnd = parseHHMM(editorState.endText);

    if (!titleValid || !hasCategory || parsedStart === null || parsedEnd === null) {
      return true;
    }

    const startMin = roundTo15(parsedStart);
    const endMin = roundTo15(parsedEnd);

    if (startMin < 0 || endMin > MINUTES_PER_DAY || endMin <= startMin) {
      return true;
    }

    const ignoreId = editorState.mode === 'edit' ? editorState.blockId : null;
    return hasOverlap(editorState.lane, ignoreId, startMin, endMin, sortedBlocks);
  }, [
    editorState.blockId,
    editorState.endText,
    editorState.lane,
    editorState.mode,
    editorState.startText,
    editorState.tags.length,
    editorState.title,
    sortedBlocks,
  ]);

  const handleQuickAdd = useCallback(
    (preset: QuickPreset) => {
      const preferredStartMin = getNextQuarterMinuteFromNow();

      const slot = findEarliestSlot(preset.lane, preset.durationMin, preferredStartMin, sortedBlocks);

      if (!slot) {
        Alert.alert('No slot available', 'No non-overlapping slot is available for this preset.');
        return;
      }

      void (async () => {
        try {
          const inserted = await insertBlock(
            {
              lane: preset.lane,
              title: preset.title,
              tags: preset.tags,
              startMin: slot.startMin,
              endMin: slot.endMin,
            },
            dayKey
          );

          setBlocks((current) => sortByStartMin([...current, inserted]));
          openEditEditor(inserted);
        } catch {
          Alert.alert('Storage error', 'Could not create quick add block.');
        }
      })();
    },
    [dayKey, openEditEditor, sortedBlocks]
  );

  const copyPlannedToActual = useCallback(() => {
    void (async () => {
      const planned = sortByStartMin(sortedBlocks.filter((block) => block.lane === 'planned'));
      const targetActual = sortByStartMin(sortedBlocks.filter((block) => block.lane === 'actual'));

      let created = 0;
      let skipped = 0;

      try {
        for (const plannedBlock of planned) {
          if (hasOverlap('actual', null, plannedBlock.startMin, plannedBlock.endMin, targetActual)) {
            skipped += 1;
            continue;
          }

          const inserted = await insertBlock(
            {
              lane: 'actual',
              title: plannedBlock.title,
              tags: [...plannedBlock.tags],
              startMin: plannedBlock.startMin,
              endMin: plannedBlock.endMin,
            },
            dayKey
          );

          targetActual.push(inserted);
          created += 1;
        }

        reloadCurrentDay();
        Alert.alert('Copy complete', `Created ${created}, skipped ${skipped}.`);
      } catch {
        reloadCurrentDay();
        Alert.alert('Storage error', 'Could not finish copy plan to done.');
      }
    })();
  }, [dayKey, reloadCurrentDay, sortedBlocks]);

  const copyYesterdayPlannedToToday = useCallback(() => {
    if (!isViewingToday) {
      return;
    }

    void (async () => {
      const yesterdayKey = shiftDayKey(todayDayKey, -1);

      try {
        const yesterdayBlocks = await getBlocksForDay(yesterdayKey);
        const yesterdayPlanned = sortByStartMin(
          yesterdayBlocks.filter((block) => block.lane === 'planned')
        );
        const targetPlanned = sortByStartMin(sortedBlocks.filter((block) => block.lane === 'planned'));

        let created = 0;
        let skipped = 0;

        for (const plannedBlock of yesterdayPlanned) {
          if (hasOverlap('planned', null, plannedBlock.startMin, plannedBlock.endMin, targetPlanned)) {
            skipped += 1;
            continue;
          }

          const inserted = await insertBlock(
            {
              lane: 'planned',
              title: plannedBlock.title,
              tags: [...plannedBlock.tags],
              startMin: plannedBlock.startMin,
              endMin: plannedBlock.endMin,
            },
            todayDayKey
          );

          targetPlanned.push(inserted);
          created += 1;
        }

        reloadCurrentDay();
        Alert.alert('Copy complete', `Created ${created}, skipped ${skipped}.`);
      } catch {
        reloadCurrentDay();
        Alert.alert('Storage error', 'Could not copy yesterday plan blocks.');
      }
    })();
  }, [isViewingToday, reloadCurrentDay, sortedBlocks, todayDayKey]);

  const shareDaySummary = useCallback(() => {
    const summaryPlannedBlocks = sortByStartMin(metricBlocks.filter((block) => block.lane === 'planned'));
    const summaryActualBlocks = sortByStartMin(metricBlocks.filter((block) => block.lane === 'actual'));

    const tagLines = tagTotals.length
      ? tagTotals
          .map(
            (row) =>
              `${row.tag}: plan ${formatDuration(row.plannedMin)}, done ${formatDuration(
                row.actualMin
              )}, delta ${row.deltaMin >= 0 ? '+' : '-'}${formatDuration(row.deltaMin)}`
          )
          .join('\n')
      : 'none';

    const plannedLines = summaryPlannedBlocks.length ? summaryPlannedBlocks.map(formatBlockLine).join('\n') : 'none';
    const actualLines = summaryActualBlocks.length ? summaryActualBlocks.map(formatBlockLine).join('\n') : 'none';

    const summary = [
      `Date: ${visibleDateLabel}`,
      `Plan total: ${formatDuration(plannedTotalMin)}`,
      `Done total: ${formatDuration(doneTotalMin)}`,
      `Delta: ${doneTotalMin - plannedTotalMin >= 0 ? '+' : '-'}${formatDuration(doneTotalMin - plannedTotalMin)}`,
      '',
      'Tag totals:',
      tagLines,
      '',
      'Plan blocks:',
      plannedLines,
      '',
      'Done blocks:',
      actualLines,
    ].join('\n');

    void Share.share({
      message: summary,
      title: `Day summary ${dayKey}`,
    });
  }, [dayKey, doneTotalMin, metricBlocks, plannedTotalMin, tagTotals, visibleDateLabel]);

  const showInsightsInfo = useCallback((section: 'execution' | 'totals' | 'categories') => {
    if (section === 'execution') {
      Alert.alert(
        'Execution Score',
        'Done time divided by planned time for today. None is excluded.'
      );
      return;
    }

    if (section === 'totals') {
      Alert.alert(
        'Planned vs Done',
        'Planned and done totals for today, plus the delta between them. None is excluded.'
      );
      return;
    }

    Alert.alert(
      'Planned vs Done by Category',
      'For each category, compare planned time versus done time. Bar lengths are scaled within today.'
    );
  }, []);

  const beginDraftCreation = useCallback(
    (lane: Lane, absoluteY: number) => {
      finalizeHandledRef.current = false;
      draftCandidateRef.current = null;
      draftCreateRef.current = null;
      setDraftCreate(null);
      setIsCreatingDraft(false);
      setSelectedLane(lane);

      if (activeDragId !== null) {
        createGestureBlockedRef.current = true;
        return;
      }

      const minute = minuteFromAbsoluteY(absoluteY);

      if (minute === null) {
        createGestureBlockedRef.current = true;
        return;
      }

      const laneBlocks = sortedBlocks.filter((block) => block.lane === lane);
      const touchedExisting = laneBlocks.some(
        (block) => minute >= block.startMin && minute < block.endMin
      );

      if (touchedExisting) {
        createGestureBlockedRef.current = true;
        return;
      }

      createGestureBlockedRef.current = false;
      draftCandidateRef.current = {
        anchorMin: minute,
        anchorAbsoluteY: absoluteY,
        lastAbsoluteY: absoluteY,
        startedAtMs: Date.now(),
      };
    },
    [activeDragId, minuteFromAbsoluteY, sortedBlocks]
  );

  const updateDraftCreation = useCallback(
    (lane: Lane, absoluteY: number, velocityY: number) => {
      if (createGestureBlockedRef.current) {
        return;
      }

      const minute = minuteFromAbsoluteY(absoluteY);

      if (minute === null) {
        return;
      }

      const candidate = draftCandidateRef.current;

      if (!candidate) {
        return;
      }

      if (!draftCreateRef.current) {
        const dragDistance = Math.abs(absoluteY - candidate.anchorAbsoluteY);
        const hasMovedPastThreshold = dragDistance >= CREATE_THRESHOLD_PX;
        const hasHeldLongEnough = Date.now() - candidate.startedAtMs >= CREATE_DELAY_MS;
        const isScrollLikeSwipe =
          Number.isFinite(velocityY) && Math.abs(velocityY) > SCROLL_LIKE_VELOCITY_Y;

        if ((!hasMovedPastThreshold && !hasHeldLongEnough) || isScrollLikeSwipe) {
          draftCandidateRef.current = {
            ...candidate,
            lastAbsoluteY: absoluteY,
          };
          return;
        }

        const initialRange = normalizeDraftRange(candidate.anchorMin, minute);
        const invalid = hasOverlap(
          lane,
          null,
          initialRange.startMin,
          initialRange.endMin,
          sortedBlocks
        );
        const initialDraft: DraftCreateState = {
          anchorMin: candidate.anchorMin,
          startMin: initialRange.startMin,
          endMin: initialRange.endMin,
          invalid,
        };

      draftCreateRef.current = initialDraft;
      createHapticKeyRef.current = `${initialDraft.startMin}-${initialDraft.endMin}`;
      void triggerSelectionHaptic();
      setDraftCreate(initialDraft);
      setIsCreatingDraft(true);
        return;
      }

      const current = draftCreateRef.current;

      const nextRange = normalizeDraftRange(current.anchorMin, minute);
      const invalid = hasOverlap(lane, null, nextRange.startMin, nextRange.endMin, sortedBlocks);
      const nextDraft: DraftCreateState = {
        ...current,
        startMin: nextRange.startMin,
        endMin: nextRange.endMin,
        invalid,
      };

      draftCreateRef.current = nextDraft;
      setDraftCreate(nextDraft);
      const nextKey = `${nextDraft.startMin}-${nextDraft.endMin}`;

      if (createHapticKeyRef.current !== nextKey) {
        createHapticKeyRef.current = nextKey;
        void triggerSelectionHaptic();
      }
    },
    [minuteFromAbsoluteY, sortedBlocks]
  );

  const finalizeDraftCreation = useCallback(() => {
    if (finalizeHandledRef.current) {
      return;
    }

    finalizeHandledRef.current = true;

    if (createGestureBlockedRef.current) {
      createGestureBlockedRef.current = false;
      setIsCreatingDraft(false);
      setDraftCreate(null);
      draftCreateRef.current = null;
      draftCandidateRef.current = null;
      createHapticKeyRef.current = null;
      return;
    }

    const currentCandidate = draftCandidateRef.current;
    const currentDraft = draftCreateRef.current;

    setIsCreatingDraft(false);
    setDraftCreate(null);
    draftCreateRef.current = null;
    draftCandidateRef.current = null;
    createHapticKeyRef.current = null;

    if (!currentDraft && !currentCandidate) {
      return;
    }

    if (currentDraft && currentDraft.invalid) {
      Alert.alert('Invalid time', 'Time overlaps another block.');
      return;
    }

    if (currentDraft) {
      openCreateEditor(selectedLane, {
        startMin: currentDraft.startMin,
        endMin: currentDraft.endMin,
      });
      return;
    }

    const tapStartMin = currentCandidate?.anchorMin;
    const tapDragDistance =
      currentCandidate === null
        ? 0
        : Math.abs(currentCandidate.lastAbsoluteY - currentCandidate.anchorAbsoluteY);

    if (tapDragDistance > CREATE_THRESHOLD_PX) {
      return;
    }

    if (tapStartMin === undefined) {
      return;
    }

    const heldMs = currentCandidate ? Date.now() - currentCandidate.startedAtMs : 0;

    if (heldMs < TAP_CREATE_MIN_HOLD_MS) {
      return;
    }

    const tapEndMin = Math.min(MINUTES_PER_DAY, tapStartMin + TAP_CREATE_DURATION_MIN);

    if (hasOverlap(selectedLane, null, tapStartMin, tapEndMin, sortedBlocks)) {
      Alert.alert('Invalid time', 'Time overlaps another block.');
      return;
    }

    openCreateEditor(selectedLane, {
      startMin: tapStartMin,
      endMin: tapEndMin,
    });
  }, [openCreateEditor, selectedLane, sortedBlocks]);

  const buildCreateGesture = useCallback(
    (lane: Lane) =>
      Gesture.Pan()
        .runOnJS(true)
        .activateAfterLongPress(220)
        .activeOffsetY([-CREATE_THRESHOLD_PX, CREATE_THRESHOLD_PX])
        .shouldCancelWhenOutside(false)
        .onBegin((event) => {
          beginDraftCreation(lane, event.absoluteY);
        })
        .onUpdate((event) => {
          updateDraftCreation(lane, event.absoluteY, event.velocityY);
        })
        .onFinalize(() => {
          finalizeDraftCreation();
        }),
    [beginDraftCreation, finalizeDraftCreation, updateDraftCreation]
  );

  const createGesture = useMemo(
    () =>
      buildCreateGesture(selectedLane),
    [buildCreateGesture, selectedLane]
  );
  const plannedCreateGesture = useMemo(() => buildCreateGesture('planned'), [buildCreateGesture]);
  const actualCreateGesture = useMemo(() => buildCreateGesture('actual'), [buildCreateGesture]);

  const compareMode = laneVisibility.planned && laneVisibility.actual;

  useEffect(() => {
    if (focusedPlannedId === null) {
      return;
    }

    const stillExists = plannedBlocks.some((block) => block.id === focusedPlannedId);

    if (!stillExists) {
      setFocusedPlannedId(null);
    }
  }, [focusedPlannedId, plannedBlocks]);

  const renderedLaneBlocks = useMemo(() => {
    const isFocusActive = focusedPlannedId !== null;

    const isHighlighted = (block: TimeBlock): boolean => {
      if (!focusedPlannedId) {
        return true;
      }

      if (block.lane === 'planned') {
        return block.id === focusedPlannedId;
      }

      return block.linkedPlannedId === focusedPlannedId;
    };

    const toRenderable = (lane: Lane) =>
      sortByStartMin(sortedBlocks.filter((block) => block.lane === lane))
        .map((block) => {
        const matches = matchesTagFilter(block, tagFilter);

        const dimForFocus = isFocusActive && !isHighlighted(block);

        return {
          block,
          dimmed: !matches || dimForFocus,
        };
      })
      .filter((item): item is { block: TimeBlock; dimmed: boolean } => item !== null);

    return {
      planned: toRenderable('planned'),
      actual: toRenderable('actual'),
    };
  }, [focusedPlannedId, sortedBlocks, tagFilter]);

  const hasAnyBlocks = sortedBlocks.length > 0;
  const nowOffset = clamp(nowMinute, 0, MINUTES_PER_DAY) * PIXELS_PER_MINUTE;
  const nowTimeLabel = formatCurrentTimeLabel(nowMinute);
  const timelineCanvasHeight = TIMELINE_HEIGHT + insets.bottom;
  const hourLineOffsets = useMemo(() => {
    const baseOffsets = Array.from({ length: 25 }, (_, index) => index * 60 * PIXELS_PER_MINUTE);
    const bottomRuleOffset = Math.max(0, timelineCanvasHeight - StyleSheet.hairlineWidth);
    const lastBaseOffset = baseOffsets[baseOffsets.length - 1] ?? 0;

    if (bottomRuleOffset > lastBaseOffset) {
      baseOffsets.push(bottomRuleOffset);
    }

    return baseOffsets;
  }, [timelineCanvasHeight]);
  const viewMode: ViewMode = laneVisibility.planned && laneVisibility.actual
    ? 'compare'
    : laneVisibility.planned
      ? 'planned'
      : 'actual';

  const setViewMode = useCallback((mode: ViewMode) => {
    if (mode === 'compare') {
      setLaneVisibility({ planned: true, actual: true });
      return;
    }

    if (mode === 'planned') {
      setLaneVisibility({ planned: true, actual: false });
      setSelectedLane('planned');
      return;
    }

    setLaneVisibility({ planned: false, actual: true });
    setSelectedLane('actual');
  }, []);

  const handleSelectCalendarDay = useCallback(
    (nextDayKey: string) => {
      setDayKey(nextDayKey);
      closeCalendar();
    },
    [closeCalendar]
  );

  if (calendarVisible) {
    return (
      <View
        style={[
          styles.screen,
          {
            paddingTop: insets.top,
            paddingLeft: 12 + insets.left,
            paddingRight: 12 + insets.right,
            paddingBottom: insets.bottom,
          },
        ]}>
        <View style={styles.calendarScreenTopBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to day view"
            style={styles.calendarTopButton}
            onPress={closeCalendar}>
            <Ionicons name="close" size={18} color={UI_COLORS.neutralText} />
            <Text style={styles.calendarTopButtonText}>{calendarVisibleYear}</Text>
          </Pressable>
          <View style={styles.calendarTopCenterSpacer} />
          <View style={styles.calendarTopRightSpacer} />
        </View>

        <FlatList
          ref={calendarListRef}
          data={calendarMonths}
          keyExtractor={(item) => item.key}
          onLayout={() => {
            if (calendarInitialPositionedRef.current) {
              return;
            }

            calendarInitialPositionedRef.current = true;
            requestAnimationFrame(() => {
              calendarListRef.current?.scrollToOffset({ offset: centeredMonthOffset, animated: false });
            });
          }}
          getItemLayout={(_data, index) => ({
            index,
            length: calendarMonths[index]?.height ?? 0,
            offset: calendarMonthOffsets[index] ?? 0,
          })}
          onScrollToIndexFailed={() => {
            // Ignore occasional first-render measurement misses.
          }}
          viewabilityConfig={calendarViewabilityConfig.current}
          onViewableItemsChanged={onViewableMonthsChanged.current}
          showsVerticalScrollIndicator={false}
          scrollsToTop={false}
          contentContainerStyle={styles.calendarListContent}
          renderItem={({ item }) => (
            <View style={[styles.calendarMonthSection, { height: item.height }]}>
              <Text style={styles.calendarMonthLabel}>{item.label}</Text>
              <View style={styles.calendarWeekdayRow}>
                {CALENDAR_WEEKDAY_LABELS.map((label, labelIndex) => (
                  <Text key={`${item.key}-${labelIndex}`} style={styles.calendarWeekdayLabel}>
                    {label}
                  </Text>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {item.cells.map((cell) => {
                  if (!cell.inCurrentMonth) {
                    return <View key={`${item.key}-${cell.key}`} style={styles.calendarCellPlaceholder} />;
                  }

                  const cellDayKey = cell.dayKey;
                  const isToday = cellDayKey === todayDayKey;
                  const score = cellDayKey ? calendarScoreByDay[cellDayKey] : null;

                  return (
                    <Pressable
                      key={`${item.key}-${cell.key}`}
                      accessibilityRole="button"
                      accessibilityLabel={cellDayKey ? `Open ${cellDayKey}` : 'Open date'}
                      style={styles.calendarCell}
                      onPress={() => {
                        if (cellDayKey) {
                          handleSelectCalendarDay(cellDayKey);
                        }
                      }}>
                      <View
                        style={[
                          styles.calendarDayBadge,
                          isToday && styles.calendarDayBadgeSelected,
                        ]}>
                        <Text
                          style={[
                            styles.calendarDayNumber,
                            isToday && styles.calendarDayNumberSelected,
                          ]}>
                          {cell.date?.getDate() ?? ''}
                        </Text>
                      </View>
                      <Text style={styles.calendarScoreText}>{score != null ? `${score}%` : ' '}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          paddingLeft: 12 + insets.left,
          paddingRight: 12 + insets.right,
        },
      ]}>
      <View style={styles.topHeaderRow}>
        <Text style={styles.appTitle}>Plan vs Done</Text>
        <View style={styles.topActions}>
          <Pressable
            accessibilityLabel="Open daily insights"
            accessibilityRole="button"
            style={styles.analyticsButton}
            onPress={() => setToolsSheetVisible(true)}>
            <Ionicons name="bar-chart-outline" size={18} color={UI_COLORS.neutralText} />
          </Pressable>
          <Pressable
            accessibilityLabel="Open timeline actions"
            accessibilityRole="button"
            style={styles.analyticsButton}
            onPress={() => setActionsMenuVisible(true)}>
            <Ionicons name="ellipsis-horizontal" size={18} color={UI_COLORS.neutralText} />
          </Pressable>
          <Pressable
            accessibilityLabel="Open month view"
            accessibilityRole="button"
            style={styles.analyticsButton}
            onPress={openCalendar}>
            <Ionicons name="calendar-outline" size={18} color={UI_COLORS.neutralText} />
          </Pressable>
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            style={styles.analyticsButton}
            onPress={() => router.push('/(tabs)/settings')}>
            <Ionicons name="settings-outline" size={18} color={UI_COLORS.neutralText} />
          </Pressable>
          <Pressable
            accessibilityLabel={`Add ${(compareMode ? lastUsedCreateLane : selectedLane) === 'planned' ? 'plan' : 'done'} block`}
            accessibilityRole="button"
            style={styles.addButton}
            onPress={() => openCreateEditor(compareMode ? lastUsedCreateLane : selectedLane)}>
            <Ionicons name="add" size={20} color={UI_COLORS.neutralText} />
          </Pressable>
        </View>
      </View>

      <View style={styles.dateRow}>
        <View style={styles.dateCenterNav}>
          <Pressable
            accessibilityLabel="Go to previous day"
            accessibilityRole="button"
            style={styles.dateNavButton}
            onPress={goToPreviousDay}>
            <Ionicons name="chevron-back" size={18} color={UI_COLORS.neutralTextSoft} />
          </Pressable>
          <View style={styles.dateLabelWrap}>
            <Ionicons name="calendar-outline" size={15} color={UI_COLORS.neutralTextSoft} />
            <Text style={styles.dateLabel}>{dateRowLabel}</Text>
          </View>
          <Pressable
            accessibilityLabel="Go to next day"
            accessibilityRole="button"
            style={[styles.dateNavButton, !canGoToNextDay && styles.dayNavButtonDisabled]}
            onPress={goToNextDay}
            disabled={!canGoToNextDay}>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={canGoToNextDay ? UI_COLORS.neutralTextSoft : '#94A3B8'}
            />
          </Pressable>
        </View>
      </View>
      {!isViewingToday ? (
        <View style={styles.todayJumpRow}>
          <Pressable
            accessibilityLabel="Go to today"
            accessibilityRole="button"
            style={styles.todayJumpButton}
            onPress={goToToday}>
            <Text style={styles.todayJumpButtonText}>Go to Today</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.dateDivider} />

      <View style={styles.dayContent}>
          <View style={styles.topControlRow}>
            <View style={styles.segmentedControl}>
              {(['compare', 'planned', 'actual'] as ViewMode[]).map((mode) => {
                const selected = viewMode === mode;

                return (
                  <Pressable
                    key={mode}
                    accessibilityLabel={`Set ${mode} view`}
                    accessibilityRole="button"
                    onPress={() => setViewMode(mode)}
                    style={[styles.segmentButton, selected && styles.segmentButtonSelected]}>
                    <Text style={[styles.segmentButtonText, selected && styles.segmentButtonTextSelected]}>
                      {mode === 'compare' ? 'Compare' : mode === 'planned' ? 'Plan' : 'Done'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {!hasAnyBlocks ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>No blocks for this day.</Text>
              <Text style={styles.emptyStateBody}>Tap empty time to create your first event.</Text>
              <Pressable
                accessibilityLabel="Add first block"
                accessibilityRole="button"
                style={styles.emptyStateButton}
                onPress={() => openCreateEditor(selectedLane)}>
                <Text style={styles.emptyStateButtonText}>Add first block</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.headerRow}>
            <View style={styles.timeHeader} />
            <View style={styles.laneHeaderContainer}>
              {compareMode ? (
                <View style={styles.compareHeaderRow}>
                  <Text style={styles.compareHeaderLabel}>Plan</Text>
                  <View style={styles.compareHeaderDivider} />
                  <Text style={styles.compareHeaderLabel}>Done</Text>
                </View>
              ) : (
                <Text style={styles.laneHeader}>{laneVisibility.planned ? 'Plan' : 'Done'}</Text>
              )}
            </View>
          </View>

          <ScrollView
            ref={timelineScrollRef}
            scrollEnabled={activeDragId === null && !isCreatingDraft}
            style={styles.scrollView}
            contentContainerStyle={[styles.scrollContent, { minHeight: timelineCanvasHeight }]}
            onLayout={syncTimelineViewportTop}
            onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
              timelineScrollOffsetYRef.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator>
        <View style={[styles.timelineBody, { height: timelineCanvasHeight }]}>
          <View style={styles.timeColumn}>
            {Array.from({ length: 24 }, (_, hour) => {
              const top = hour * 60 * PIXELS_PER_MINUTE;

              return (
                <View key={hour} style={[styles.hourLabelWrap, { top }]}>
                  <Text style={styles.hourLabel}>{formatHourLabel(hour)}</Text>
                </View>
              );
            })}
          </View>

          {compareMode ? (
            <View style={styles.compareWrap}>
              {(['planned', 'actual'] as Lane[]).map((lane, laneIndex) => (
                <GestureDetector
                  key={lane}
                  gesture={lane === 'planned' ? plannedCreateGesture : actualCreateGesture}>
                  <View
                    style={[
                      styles.laneSurface,
                      styles.compareLane,
                      laneIndex === 0 && styles.compareLaneLeft,
                      { height: timelineCanvasHeight },
                    ]}
                    onStartShouldSetResponderCapture={() => {
                      if (focusedPlannedId !== null) {
                        setFocusedPlannedId(null);
                      }

                      return false;
                    }}>
                    {hourLineOffsets.map((top, index) => {
                      return <View key={index} style={[styles.hourLine, { top }]} />;
                    })}
                    {renderedLaneBlocks[lane].map(({ block, dimmed }) => (
                    <Block
                      key={block.id}
                      id={block.id}
                      startMin={block.startMin}
                      endMin={block.endMin}
                      previewStartMin={dragPreviewById[block.id]?.startMin}
                      previewEndMin={dragPreviewById[block.id]?.endMin}
                      title={block.title}
                      tags={block.tags}
                      lane={block.lane}
                      onPress={handleBlockPress}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDragRelease={handleDragRelease}
                      onDragStep={handleDragStep}
                      onDragPreview={handleDragPreview}
                      onFocusStart={handleBlockFocusStart}
                      onFocusEnd={handleBlockFocusEnd}
                      categoryColorMap={categoryColorMap}
                      interactive={!dimmed}
                      dimmed={dimmed}
                    />
                    ))}
                    {draftCreate && selectedLane === lane ? (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.draftBlock,
                          {
                            top: draftCreate.startMin * PIXELS_PER_MINUTE,
                            height: (draftCreate.endMin - draftCreate.startMin) * PIXELS_PER_MINUTE,
                          },
                          draftCreate.invalid && styles.draftBlockInvalid,
                        ]}>
                        <Text style={styles.draftBlockText}>
                          {formatAmPm(draftCreate.startMin)}-{formatAmPm(draftCreate.endMin)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </GestureDetector>
              ))}
            </View>
          ) : (
            <GestureDetector gesture={createGesture}>
              <View
                style={[styles.laneSurface, { height: timelineCanvasHeight }]}
                onStartShouldSetResponderCapture={() => {
                  if (focusedPlannedId !== null) {
                    setFocusedPlannedId(null);
                  }

                  return false;
                }}>
                {hourLineOffsets.map((top, index) => {
                  return <View key={index} style={[styles.hourLine, { top }]} />;
                })}

                {renderedLaneBlocks[selectedLane].map(({ block, dimmed }) => (
                  <Block
                    key={block.id}
                    id={block.id}
                    startMin={block.startMin}
                    endMin={block.endMin}
                    previewStartMin={dragPreviewById[block.id]?.startMin}
                    previewEndMin={dragPreviewById[block.id]?.endMin}
                    title={block.title}
                    tags={block.tags}
                    lane={block.lane}
                    onPress={handleBlockPress}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragRelease={handleDragRelease}
                    onDragStep={handleDragStep}
                    onDragPreview={handleDragPreview}
                    onFocusStart={handleBlockFocusStart}
                    onFocusEnd={handleBlockFocusEnd}
                    categoryColorMap={categoryColorMap}
                    interactive={!dimmed}
                    dimmed={dimmed}
                  />
                ))}

                {draftCreate ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.draftBlock,
                      {
                        top: draftCreate.startMin * PIXELS_PER_MINUTE,
                        height: (draftCreate.endMin - draftCreate.startMin) * PIXELS_PER_MINUTE,
                      },
                      draftCreate.invalid && styles.draftBlockInvalid,
                    ]}>
                    <Text style={styles.draftBlockText}>
                      {formatAmPm(draftCreate.startMin)}-{formatAmPm(draftCreate.endMin)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </GestureDetector>
          )}
          {dayKey === todayDayKey ? (
            <>
              <View pointerEvents="none" style={[styles.nowLineWrap, { top: nowOffset }]}>
                <View style={styles.nowLine} />
              </View>
              <View pointerEvents="none" style={[styles.nowLineLabelWrap, { top: nowOffset }]}>
                <View style={styles.nowLineLabel}>
                  <Text style={styles.nowLineLabelText}>{nowTimeLabel}</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>
          </ScrollView>
        </View>

      {feedbackMessage ? <Text style={[styles.feedbackText, { bottom: 8 + insets.bottom }]}>{feedbackMessage}</Text> : null}

      <BlockEditorModal
        visible={editorState.visible}
        mode={editorState.mode}
        lane={editorState.lane}
        titleValue={editorState.title}
        selectedTags={editorState.tags}
        startValue={editorState.startText}
        endValue={editorState.endText}
        linkedPlannedId={editorState.linkedPlannedId}
        categoryOptions={categoryOptions}
        plannedLinkOptions={plannedLinkOptions}
        errorText={editorState.errorText}
        onChangeTitle={(value) => setEditorField('title', value)}
        onToggleTag={toggleEditorTag}
        onChangeStart={(value) => setEditorField('startText', value)}
        onChangeEnd={(value) => setEditorField('endText', value)}
        onChangeLane={setEditorLane}
        onChangeLinkedPlannedId={(value) =>
          setEditorState((current) => ({ ...current, linkedPlannedId: value, errorText: null }))
        }
        saveDisabled={isEditorSaveDisabled}
        onCancel={closeEditor}
        onSave={handleSaveEditor}
        onDelete={handleDelete}
      />

      <Modal
        animationType="slide"
        transparent
        visible={toolsSheetVisible}
        onRequestClose={() => setToolsSheetVisible(false)}>
        <View style={styles.sheetModalRoot}>
          <Pressable
            style={styles.sheetBackdrop}
            accessibilityLabel="Close tools"
            accessibilityRole="button"
            onPress={() => setToolsSheetVisible(false)}
          />
          <View
            style={[
              styles.sheetCard,
              {
                paddingBottom: 18 + insets.bottom,
                paddingLeft: 16 + insets.left,
                paddingRight: 16 + insets.right,
              },
            ]}>
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Insights</Text>
              <Pressable
                accessibilityLabel="Close daily insights"
                style={styles.sheetCloseButton}
                onPress={() => setToolsSheetVisible(false)}>
                <Ionicons name="close" size={18} color={UI_COLORS.neutralText} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
              <View style={styles.sectionHeader}>
                <Ionicons name="speedometer-outline" size={14} color={UI_COLORS.neutralTextSoft} />
                <Text style={styles.sectionTitle}>Execution Score</Text>
                <Pressable
                  accessibilityLabel="About execution score"
                  style={styles.infoButton}
                  onPress={() => showInsightsInfo('execution')}>
                  <Ionicons name="information-circle-outline" size={14} color={UI_COLORS.neutralTextSoft} />
                </Pressable>
              </View>
              <View style={styles.executionCard}>
                <View style={styles.executionEquation}>
                  <View style={styles.executionFraction}>
                    <Text style={styles.executionEquationValue}>{minutesToHM(scorecardMetrics.executionDoneMinutes)}</Text>
                    <View style={styles.executionFractionBar} />
                    <Text style={styles.executionEquationValue}>{minutesToHM(scorecardMetrics.plannedMinutes)}</Text>
                  </View>
                  <Text style={styles.executionEquationOperator}>*</Text>
                  <Text style={styles.executionEquationValue}>100%</Text>
                  <Text style={styles.executionEquationOperator}>=</Text>
                  <Text style={styles.executionScoreValue}>{scorecardMetrics.executionScorePercent}%</Text>
                </View>
              </View>

              <View style={styles.sectionHeader}>
                <Ionicons name="analytics-outline" size={14} color={UI_COLORS.neutralTextSoft} />
                <Text style={styles.sectionTitle}>Planned vs Done</Text>
                <Pressable
                  accessibilityLabel="About planned versus done totals"
                  style={styles.infoButton}
                  onPress={() => showInsightsInfo('totals')}>
                  <Ionicons name="information-circle-outline" size={14} color={UI_COLORS.neutralTextSoft} />
                </Pressable>
              </View>
              <View style={styles.categoryBalanceList}>
                <View style={styles.categoryBalanceCard}>
                  <View style={styles.categoryBalanceHeader}>
                    <Text style={styles.categoryTitle}>Total</Text>
                    <Text style={[styles.categoryBalanceDelta, styles.overallDeltaLabel]}>
                      {formatSignedMinutes(scorecardMetrics.doneMinutes - scorecardMetrics.plannedMinutes)}
                    </Text>
                  </View>
                  <Text style={styles.barLabel}>Planned {minutesToHM(scorecardMetrics.plannedMinutes)}</Text>
                  <View style={styles.categoryTrack}>
                    <View
                      style={[
                        styles.categoryBarPlan,
                        {
                          width: `${Math.round(
                            (scorecardMetrics.plannedMinutes /
                              Math.max(scorecardMetrics.plannedMinutes, scorecardMetrics.doneMinutes, 1)) *
                              100
                          )}%`,
                          backgroundColor: `${UI_COLORS.accent}66`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.barLabel}>Done {minutesToHM(scorecardMetrics.doneMinutes)}</Text>
                  <View style={styles.categoryTrack}>
                    <View
                      style={[
                        styles.categoryBarActual,
                        {
                          width: `${Math.round(
                            (scorecardMetrics.doneMinutes /
                              Math.max(scorecardMetrics.plannedMinutes, scorecardMetrics.doneMinutes, 1)) *
                              100
                          )}%`,
                          backgroundColor: UI_COLORS.accent,
                        },
                      ]}
                    />
                  </View>
                </View>

                {categoryVarianceRows.map((row) => (
                  <View key={row.tag} style={styles.categoryBalanceCard}>
                    <View style={styles.categoryBalanceHeader}>
                      <View style={styles.categoryHeader}>
                        <View style={[styles.categoryDot, { backgroundColor: row.color }]} />
                        <Text style={styles.categoryTitle}>{row.label}</Text>
                      </View>
                      <Text style={styles.categoryBalanceDelta}>
                        {row.deltaMinutes === 0
                          ? 'Aligned'
                          : `${row.deltaMinutes > 0 ? 'Over' : 'Under'} ${minutesToHM(Math.abs(row.deltaMinutes))}`}
                      </Text>
                    </View>
                    <Text style={styles.barLabel}>Planned {minutesToHM(row.plannedMinutes)}</Text>
                    <View style={styles.categoryTrack}>
                      <View
                        style={[
                          styles.categoryBarPlan,
                          {
                            width: `${maxCategoryMinutes > 0 ? Math.round((row.plannedMinutes / maxCategoryMinutes) * 100) : 0}%`,
                            backgroundColor: `${row.color}66`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barLabel}>Done {minutesToHM(row.doneMinutes)}</Text>
                    <View style={styles.categoryTrack}>
                      <View
                        style={[
                          styles.categoryBarActual,
                          {
                            width: `${maxCategoryMinutes > 0 ? Math.round((row.doneMinutes / maxCategoryMinutes) * 100) : 0}%`,
                            backgroundColor: row.color,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={actionsMenuVisible}
        onRequestClose={() => setActionsMenuVisible(false)}>
        <View style={styles.menuModalRoot}>
          <Pressable
            style={styles.menuBackdrop}
            accessibilityLabel="Close timeline actions"
            accessibilityRole="button"
            onPress={() => setActionsMenuVisible(false)}
          />
          <View style={styles.menuCard}>
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Timeline Actions</Text>
              <Pressable
                accessibilityLabel="Close timeline actions"
                style={styles.sheetCloseButton}
                onPress={() => setActionsMenuVisible(false)}>
                <Ionicons name="close" size={18} color={UI_COLORS.neutralText} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
              <Text style={styles.sectionTitle}>Actions</Text>
              <View style={styles.actionGrid}>
                <Pressable accessibilityLabel="Share day summary" style={styles.actionButton} onPress={shareDaySummary}>
                  <Text style={styles.actionButtonText}>Share Summary</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Copy plan blocks into done lane"
                  style={styles.actionButton}
                  onPress={copyPlannedToActual}>
                  <Text style={styles.actionButtonText}>Copy Plan to Done</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Copy yesterday plan blocks to today"
                  style={[styles.actionButton, !isViewingToday && styles.actionButtonDisabled]}
                  onPress={copyYesterdayPlannedToToday}
                  disabled={!isViewingToday}>
                  <Text style={[styles.actionButtonText, !isViewingToday && styles.actionButtonTextDisabled]}>
                    Copy Yesterday Plan
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.sectionTitle}>Quick Add</Text>
              <Pressable
                accessibilityLabel="Toggle quick add presets"
                style={styles.expanderButton}
                onPress={() => setQuickAddExpanded((current) => !current)}>
                <Text style={styles.expanderButtonText}>
                  {quickAddExpanded ? 'Hide presets' : 'Show presets'}
                </Text>
                <Ionicons
                  name={quickAddExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={UI_COLORS.neutralTextSoft}
                />
              </Pressable>
              {quickAddExpanded ? (
                <View style={styles.quickPresetList}>
                  {QUICK_PRESETS.map((preset) => (
                    <Pressable
                      key={preset.key}
                      accessibilityLabel={`Quick add ${preset.title}`}
                      style={styles.quickPresetButton}
                      onPress={() => handleQuickAdd(preset)}>
                      <View>
                        <Text style={styles.quickPresetTitle}>{preset.title}</Text>
                        <Text style={styles.quickPresetMeta}>
                          {preset.lane === 'planned' ? 'Plan' : 'Done'} • {minutesToHM(preset.durationMin)}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Text style={styles.sectionTitle}>Filter</Text>
              <View style={styles.filterRow}>
                {tagFilterOptions.map((option) => {
                  const selected = tagFilter === option;
                  const label = option === 'all' ? 'All' : getCategoryLabel(option);

                  return (
                    <Pressable
                      key={option}
                      accessibilityLabel={`Filter blocks by ${label}`}
                      style={[styles.filterChip, selected && styles.filterChipSelected]}
                      onPress={() => setTagFilter(option)}>
                      <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {settingsLoading ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: UI_COLORS.appBackground,
  },
  topHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  appTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: UI_COLORS.neutralText,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  analyticsButton: {
    width: 36,
    height: 36,
    borderRadius: UI_RADIUS.control,
    backgroundColor: UI_COLORS.glassSurface,
    borderWidth: 1,
    borderColor: UI_COLORS.glassStroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  dateCenterNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateNavButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: UI_COLORS.glassSurface,
    borderWidth: 1,
    borderColor: UI_COLORS.glassStroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  todayJumpRow: {
    alignItems: 'center',
    marginBottom: 4,
  },
  todayJumpButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: UI_COLORS.glassStroke,
    backgroundColor: UI_COLORS.glassSurface,
    paddingHorizontal: 10,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayJumpButtonText: {
    color: UI_COLORS.neutralText,
    fontSize: 12,
    fontWeight: '600',
  },
  dateLabel: {
    color: UI_COLORS.neutralText,
    fontSize: 15,
    fontWeight: '500',
  },
  dateDivider: {
    borderTopWidth: 1,
    borderTopColor: UI_COLORS.neutralBorder,
    marginBottom: 8,
  },
  dayNavButtonDisabled: {
    opacity: 0.5,
  },
  topControlRow: {
    marginBottom: 6,
  },
  dayContent: {
    flex: 1,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: UI_COLORS.surfaceMuted,
    borderRadius: 10,
    padding: 1.5,
  },
  segmentButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 30,
    borderRadius: 9,
  },
  segmentButtonSelected: {
    backgroundColor: UI_COLORS.surface,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: '400',
    color: UI_COLORS.neutralTextSoft,
  },
  segmentButtonTextSelected: {
    color: UI_COLORS.neutralText,
    fontWeight: '600',
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: UI_RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI_COLORS.glassSurface,
    borderWidth: 1,
    borderColor: UI_COLORS.glassStroke,
  },
  feedbackText: {
    position: 'absolute',
    left: 12,
    right: 12,
    fontSize: 12,
    color: UI_COLORS.neutralTextSoft,
    textAlign: 'center',
    zIndex: 10,
  },
  emptyState: {
    paddingVertical: 8,
    marginBottom: 4,
    gap: 4,
    alignItems: 'center',
  },
  emptyStateTitle: {
    fontSize: 15,
    color: UI_COLORS.neutralText,
    fontWeight: '600',
  },
  emptyStateBody: {
    fontSize: 13,
    color: UI_COLORS.neutralTextSoft,
  },
  emptyStateButton: {
    marginTop: 4,
    alignSelf: 'flex-start',
    borderRadius: 12,
    backgroundColor: UI_COLORS.glassSurfaceStrong,
    borderWidth: 1,
    borderColor: UI_COLORS.glassStroke,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  emptyStateButtonText: {
    color: UI_COLORS.neutralText,
    fontWeight: '600',
    fontSize: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  timeHeader: {
    width: TIME_GUTTER_WIDTH,
  },
  laneHeaderContainer: {
    flex: 1,
    minHeight: 25,
    borderBottomWidth: 0.5,
    borderBottomColor: UI_COLORS.neutralBorder,
    justifyContent: 'center',
    paddingBottom: 6,
  },
  laneHeader: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '500',
    color: UI_COLORS.neutralText,
  },
  compareHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compareHeaderLabel: {
    flex: 1,
    textAlign: 'center',
    color: UI_COLORS.neutralText,
    fontSize: 12,
    fontWeight: '500',
  },
  compareHeaderDivider: {
    width: 0.5,
    alignSelf: 'stretch',
    backgroundColor: UI_COLORS.neutralBorder,
  },
  scrollView: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: UI_COLORS.glassSurface,
    overflow: 'hidden',
  },
  scrollContent: {
    minHeight: TIMELINE_HEIGHT,
  },
  timelineBody: {
    flexDirection: 'row',
    position: 'relative',
  },
  timeColumn: {
    width: TIME_GUTTER_WIDTH,
    borderRightWidth: 0.5,
    borderRightColor: UI_COLORS.neutralBorder,
    backgroundColor: 'transparent',
  },
  hourLabelWrap: {
    position: 'absolute',
    left: 2,
    transform: [{ translateY: -6 }],
  },
  hourLabel: {
    fontSize: 10,
    color: UI_COLORS.neutralTextSoft,
    fontVariant: ['tabular-nums'],
  },
  laneSurface: {
    flex: 1,
    position: 'relative',
  },
  compareWrap: {
    flex: 1,
    flexDirection: 'row',
  },
  compareLane: {
    flex: 1,
  },
  compareLaneLeft: {
    borderRightWidth: 0.5,
    borderRightColor: UI_COLORS.neutralBorder,
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: UI_COLORS.neutralBorder,
  },
  nowLineWrap: {
    position: 'absolute',
    left: TIME_GUTTER_WIDTH - NOW_LINE_CONNECT_OFFSET,
    right: 0,
    zIndex: 4,
  },
  nowLine: {
    borderTopWidth: 2,
    borderTopColor: NOW_COLOR,
  },
  nowLineLabelWrap: {
    position: 'absolute',
    left: 0,
    width: TIME_GUTTER_WIDTH,
    zIndex: 5,
  },
  nowLineLabel: {
    position: 'absolute',
    top: -NOW_BUBBLE_HEIGHT / 2,
    right: 0,
    backgroundColor: NOW_COLOR,
    height: NOW_BUBBLE_HEIGHT,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: NOW_BUBBLE_HEIGHT / 2,
    overflow: 'hidden',
  },
  nowLineLabelText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  draftBlock: {
    position: 'absolute',
    left: 6,
    right: 6,
    borderWidth: 1,
    borderColor: '#0F172A',
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 6,
    zIndex: 5,
  },
  draftBlockInvalid: {
    borderColor: '#B91C1C',
    backgroundColor: '#FEE2E2',
  },
  draftBlockText: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '600',
  },
  calendarScreenTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  calendarModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 28,
  },
  calendarBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  calendarSheet: {
    flex: 1,
    backgroundColor: '#F2F2F5',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingTop: 10,
    overflow: 'hidden',
  },
  calendarTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  calendarTopTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  calendarTopCenterSpacer: {
    flex: 1,
  },
  calendarTopRightSpacer: {
    minWidth: 88,
    height: 38,
  },
  calendarTopButton: {
    minWidth: 88,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 7,
  },
  calendarTopButtonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  calendarListContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  calendarMonthSection: {
    marginBottom: 0,
    paddingBottom: CALENDAR_MONTH_BOTTOM_SPACE,
  },
  calendarMonthLabel: {
    color: '#111827',
    fontSize: 30,
    lineHeight: CALENDAR_MONTH_LABEL_HEIGHT,
    fontWeight: '600',
    marginBottom: 0,
    paddingHorizontal: 8,
  },
  calendarWeekdayRow: {
    flexDirection: 'row',
    height: CALENDAR_WEEKDAY_ROW_HEIGHT,
    marginBottom: 0,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  calendarWeekdayLabel: {
    flex: 1,
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: '14.2857%',
    height: CALENDAR_CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  calendarCellPlaceholder: {
    width: '14.2857%',
    height: CALENDAR_CELL_HEIGHT,
  },
  calendarDayBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayBadgeSelected: {
    backgroundColor: '#FF3B30',
  },
  calendarDayBadgeToday: {
    borderWidth: 1.5,
    borderColor: '#FF3B30',
  },
  calendarDayNumber: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  calendarDayNumberMuted: {
    color: '#9CA3AF',
  },
  calendarDayNumberSelected: {
    color: '#FFFFFF',
  },
  calendarScoreText: {
    color: '#2563EB',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  calendarScoreTextMuted: {
    color: '#9CA3AF',
  },
  sheetModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  menuModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: UI_COLORS.overlay,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: UI_COLORS.overlay,
  },
  sheetCard: {
    height: SHEET_VISIBLE_HEIGHT,
    backgroundColor: UI_COLORS.surface,
    borderTopLeftRadius: UI_RADIUS.sheet,
    borderTopRightRadius: UI_RADIUS.sheet,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
    marginBottom: 12,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sheetTitle: {
    color: UI_COLORS.neutralText,
    fontSize: UI_TYPE.section,
    fontWeight: '800',
  },
  sheetCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: UI_COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetContent: {
    gap: 8,
    paddingBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  infoButton: {
    marginLeft: 'auto',
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    borderRadius: 0,
    paddingHorizontal: 2,
    paddingVertical: 8,
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI_COLORS.neutralBorder,
  },
  summaryCardPlanned: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  summaryCardActual: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  summaryCardFulfillment: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  summaryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryCardLabel: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  summaryCardValue: {
    marginTop: 2,
    fontSize: 20,
    fontWeight: '700',
  },
  summaryCardValuePlanned: {
    color: UI_COLORS.planned,
  },
  summaryCardValueActual: {
    color: UI_COLORS.actual,
  },
  summaryCardValueFulfillment: {
    color: UI_COLORS.accent,
  },
  summaryCardSubtext: {
    marginTop: 0,
    color: UI_COLORS.neutralTextSoft,
    fontSize: UI_TYPE.caption,
    fontWeight: '600',
  },
  sectionTitle: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '700',
  },
  executionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    backgroundColor: '#E0F2FE',
    minHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  executionEquation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'nowrap',
    columnGap: 8,
  },
  executionFraction: {
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  executionFractionBar: {
    width: '100%',
    height: 2,
    borderRadius: 1,
    backgroundColor: '#0369A1',
  },
  executionEquationValue: {
    color: '#0C4A6E',
    fontSize: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  executionEquationOperator: {
    color: '#0369A1',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  executionScoreValue: {
    color: '#0C4A6E',
    fontSize: 30,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  categoryBalanceList: {
    gap: 8,
  },
  categoryBalanceCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: UI_COLORS.glassStroke,
    backgroundColor: UI_COLORS.glassSurface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  categoryBalanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  barLabel: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 11,
    fontWeight: '600',
  },
  categoryBalanceDelta: {
    color: UI_COLORS.neutralText,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  overallDeltaLabel: {
    alignSelf: 'flex-end',
  },
  actionGrid: {
    gap: 8,
  },
  actionButton: {
    minHeight: 40,
    borderRadius: UI_RADIUS.control,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surface,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDisabled: {
    backgroundColor: UI_COLORS.surfaceMuted,
    opacity: 0.7,
  },
  actionButtonText: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  actionButtonTextDisabled: {
    color: UI_COLORS.neutralTextSoft,
  },
  expanderButton: {
    minHeight: 40,
    borderRadius: UI_RADIUS.control,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surface,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expanderButtonText: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  quickPresetList: {
    gap: 8,
  },
  quickPresetButton: {
    minHeight: 44,
    borderRadius: UI_RADIUS.control,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surface,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  quickPresetTitle: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '700',
  },
  quickPresetMeta: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 11,
    marginTop: 1,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterChipSelected: {
    backgroundColor: UI_COLORS.surfaceMuted,
    borderColor: UI_COLORS.neutralText,
  },
  filterChipText: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextSelected: {
    color: UI_COLORS.neutralText,
  },
  tagBreakdownList: {
    gap: 8,
  },
  tagBreakdownRow: {
    borderRadius: UI_RADIUS.control,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  tagBreakdownTag: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  tagBreakdownMeta: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '500',
  },
  emptySheetText: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 13,
    marginBottom: 4,
  },
  fulfillmentCard: {
    borderRadius: 10,
    backgroundColor: UI_COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: UI_COLORS.neutralBorder,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  fulfillmentRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  fulfillmentTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  categoryDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  fulfillmentTitle: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  fulfillmentPercent: {
    color: UI_COLORS.neutralText,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  fulfillmentRowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  fulfillmentMeta: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '500',
  },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  categoryCard: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  categoryTitle: {
    color: UI_COLORS.neutralText,
    fontSize: 14,
    fontWeight: '700',
  },
  categoryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryLineLabel: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  categoryLineValue: {
    color: UI_COLORS.neutralText,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  categoryTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
    marginBottom: 4,
  },
  categoryBarPlan: {
    height: '100%',
    borderRadius: 999,
  },
  categoryBarActual: {
    height: '100%',
    borderRadius: 999,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  quickAddCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  quickAddTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  modalClose: {
    marginTop: 4,
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  modalCloseText: {
    color: '#0F172A',
    fontWeight: '600',
  },
  menuCard: {
    backgroundColor: UI_COLORS.surface,
    borderRadius: UI_RADIUS.card,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    maxHeight: '70%',
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  menuItemDisabled: {
    opacity: 0.45,
  },
  menuItemText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '500',
  },
  menuItemTextDisabled: {
    color: '#64748B',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
