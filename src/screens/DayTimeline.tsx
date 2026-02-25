import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Block, PIXELS_PER_MINUTE } from '@/src/components/Block';
import { BlockEditorModal } from '@/src/components/BlockEditorModal';
import { TAG_CATALOG } from '@/src/constants/tags';
import { UI_COLORS, UI_RADIUS, UI_TYPE, getCategoryColor, getCategoryLabel } from '@/src/constants/uiTheme';
import { useAppSettings } from '@/src/context/AppSettingsContext';
import { deleteBlock, getBlocksForDay, insertBlock, updateBlock } from '@/src/storage/blocksDb';
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

const MINUTES_PER_DAY = 24 * 60;
const TIMELINE_HEIGHT = MINUTES_PER_DAY * PIXELS_PER_MINUTE;
const DEFAULT_VIEWPORT_HOURS = 10;
const VIEWPORT_HEIGHT = DEFAULT_VIEWPORT_HOURS * 60 * PIXELS_PER_MINUTE;
const FEEDBACK_DURATION_MS = 1500;
const CREATE_THRESHOLD_PX = 16;
const CREATE_DELAY_MS = 260;
const TAP_CREATE_MIN_HOLD_MS = 500;
const TAP_CREATE_DURATION_MIN = 60;
const SCROLL_LIKE_VELOCITY_Y = 900;

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
): Array<{ tag: string; plannedMin: number; actualMin: number; deltaMin: number }> {
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

function computeFulfillment(
  plannedBlocks: TimeBlock[],
  actualBlocks: TimeBlock[]
): Array<{
  plannedId: string;
  title: string;
  startMin: number;
  endMin: number;
  plannedMinutes: number;
  linkedActualMinutes: number;
  fulfillmentPercent: number;
}> {
  return sortByStartMin(plannedBlocks).map((planned) => {
    const plannedMinutes = Math.max(0, planned.endMin - planned.startMin);
    const linkedActualMinutes = actualBlocks.reduce((sum, actual) => {
      if (actual.linkedPlannedId !== planned.id) {
        return sum;
      }

      return sum + Math.max(0, actual.endMin - actual.startMin);
    }, 0);

    const rawPercent = plannedMinutes > 0 ? (linkedActualMinutes / plannedMinutes) * 100 : 0;

    return {
      plannedId: planned.id,
      title: planned.title,
      startMin: planned.startMin,
      endMin: planned.endMin,
      plannedMinutes,
      linkedActualMinutes,
      fulfillmentPercent: Math.min(100, Math.round(rawPercent)),
    };
  });
}

function getCategoryKey(block: TimeBlock): string {
  return block.tags[0]?.trim().toLowerCase() || 'uncategorized';
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

export default function DayTimeline() {
  const router = useRouter();
  const { settings, loading: settingsLoading, updateSettings, dataVersion } = useAppSettings();

  const [dayKey, setDayKey] = useState(getLocalDayKey());
  const [reloadTick, setReloadTick] = useState(0);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState>(INITIAL_EDITOR_STATE);
  const [selectedLane, setSelectedLane] = useState<Lane>('planned');
  const [laneVisibility, setLaneVisibility] = useState<Record<Lane, boolean>>({
    planned: true,
    actual: false,
  });
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');
  const [toolsSheetVisible, setToolsSheetVisible] = useState(false);
  const [focusedPlannedId, setFocusedPlannedId] = useState<string | null>(null);
  const [tagBreakdownExpanded, setTagBreakdownExpanded] = useState(false);
  const [quickAddExpanded, setQuickAddExpanded] = useState(false);
  const [draftCreate, setDraftCreate] = useState<DraftCreateState | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const draftCreateRef = useRef<DraftCreateState | null>(null);
  const draftCandidateRef = useRef<DraftCandidate | null>(null);
  const finalizeHandledRef = useRef(false);
  const createGestureBlockedRef = useRef(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRequestIdRef = useRef(0);
  const timelineScrollRef = useRef<ScrollView | null>(null);
  const timelineViewportTopRef = useRef(0);
  const timelineScrollOffsetYRef = useRef(0);
  const autoScrolledDayKeyRef = useRef<string | null>(null);

  const todayDayKey = getLocalDayKey();
  const canGoToNextDay = dayKey < todayDayKey;
  const isViewingToday = dayKey === todayDayKey;

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
  const actualBlocks = useMemo(
    () => sortByStartMin(sortedBlocks.filter((block) => block.lane === 'actual')),
    [sortedBlocks]
  );
  const plannedLinkOptions = useMemo(
    () =>
      plannedBlocks.map((block) => ({
        id: block.id,
        title: block.title,
        startMin: block.startMin,
        endMin: block.endMin,
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
  const fulfillmentRows = useMemo(
    () => computeFulfillment(plannedBlocks, actualBlocks),
    [actualBlocks, plannedBlocks]
  );
  const linkedActualTotals = useMemo(() => {
    const linked = actualBlocks.filter((block) => block.linkedPlannedId);
    const linkedMinutes = linked.reduce((sum, block) => sum + Math.max(0, block.endMin - block.startMin), 0);

    return { linkedMinutes, linkedBlocks: linked.length };
  }, [actualBlocks]);
  const categoryRows = useMemo(() => {
    const totals = new Map<string, { planned: number; actual: number }>();

    plannedBlocks.forEach((block) => {
      const key = getCategoryKey(block);
      const value = totals.get(key) ?? { planned: 0, actual: 0 };
      value.planned += Math.max(0, block.endMin - block.startMin);
      totals.set(key, value);
    });

    actualBlocks.forEach((block) => {
      const key = getCategoryKey(block);
      const value = totals.get(key) ?? { planned: 0, actual: 0 };
      value.actual += Math.max(0, block.endMin - block.startMin);
      totals.set(key, value);
    });

    const rows = [...totals.entries()].map(([tag, value]) => ({
      tag,
      label: categoryLabelMap[tag] ?? getCategoryLabel(tag),
      color: categoryColorMap[tag] ?? getCategoryColor(tag),
      plannedMinutes: value.planned,
      actualMinutes: value.actual,
      maxMinutes: Math.max(value.planned, value.actual),
    }));

    const maxCategoryMinutes = rows.reduce((max, row) => Math.max(max, row.maxMinutes), 0);

    return rows
      .sort((a, b) => b.maxMinutes - a.maxMinutes || a.label.localeCompare(b.label))
      .map((row) => ({
        ...row,
        plannedRatio: maxCategoryMinutes > 0 ? row.plannedMinutes / maxCategoryMinutes : 0,
        actualRatio: maxCategoryMinutes > 0 ? row.actualMinutes / maxCategoryMinutes : 0,
      }));
  }, [actualBlocks, categoryColorMap, categoryLabelMap, plannedBlocks]);
  const nowMinute = useMemo(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }, [dayKey, reloadTick]);

  const { plannedTotalMin, actualTotalMin, deltaMin } = useMemo(() => {
    const totals = sortedBlocks.reduce(
      (acc, block) => {
        const duration = Math.max(0, block.endMin - block.startMin);

        if (block.lane === 'planned') {
          acc.plannedTotalMin += duration;
        } else {
          acc.actualTotalMin += duration;
        }

        return acc;
      },
      { plannedTotalMin: 0, actualTotalMin: 0 }
    );

    return {
      plannedTotalMin: totals.plannedTotalMin,
      actualTotalMin: totals.actualTotalMin,
      deltaMin: totals.actualTotalMin - totals.plannedTotalMin,
    };
  }, [sortedBlocks]);

  const tagTotals = useMemo(() => buildTagTotals(sortedBlocks), [sortedBlocks]);
  const visibleTagTotals = useMemo(() => tagTotals.slice(0, 5), [tagTotals]);
  const overallFulfillmentPercent = useMemo(() => {
    if (plannedTotalMin <= 0) {
      return 0;
    }

    return Math.min(100, Math.round((linkedActualTotals.linkedMinutes / plannedTotalMin) * 100));
  }, [linkedActualTotals.linkedMinutes, plannedTotalMin]);

  const reloadCurrentDay = useCallback(() => {
    setReloadTick((current) => current + 1);
  }, []);

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
    setReloadTick((current) => current + 1);
  }, [dataVersion]);

  useEffect(() => {
    const loadData = async () => {
      const requestId = ++loadRequestIdRef.current;
      setBlocks([]);
      setActiveDragId(null);
      setFocusedPlannedId(null);
      setDraftCreate(null);
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
  }, [dayKey, reloadTick, dataVersion]);

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
      const defaultStart =
        lane === 'planned' ? settings.plannedScanStartMin : settings.actualScanStartMin;
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
    [settings.actualScanStartMin, settings.plannedScanStartMin]
  );

  const openEditEditor = useCallback((block: TimeBlock) => {
    setEditorState({
      visible: true,
      mode: 'edit',
      lane: block.lane,
      blockId: block.id,
      title: block.title,
      tags: [...block.tags],
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
    setActiveDragId((current) => (current === blockId ? null : current));
  }, []);

  const handleDragStep = useCallback(() => {
    void Haptics.selectionAsync();
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
        return;
      }

      if (clampedStartMin === draggedBlock.startMin) {
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
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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

      if (block.lane === 'planned') {
        setFocusedPlannedId((current) => (current === block.id ? null : block.id));
        return;
      }

      openEditEditor(block);
    },
    [activeDragId, isCreatingDraft, openEditEditor, sortedBlocks]
  );

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
      const hasTag = current.tags.map((item) => item.toLowerCase()).includes(normalized);

      return {
        ...current,
        tags: hasTag
          ? current.tags.filter((item) => item.toLowerCase() !== normalized)
          : [...current.tags, normalized],
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
        tags: editorState.tags.map((tag) => tag.toLowerCase()),
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
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      tags: editorState.tags.map((tag) => tag.toLowerCase()),
      startMin,
      endMin,
      linkedPlannedId: editorState.lane === 'actual' ? normalizedLinkedPlannedId : undefined,
    };

    void (async () => {
      try {
        const insertedBlock = await insertBlock(newBlockInput, dayKey);
        setBlocks((current) => sortByStartMin([...current, insertedBlock]));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      const preferredStartMin =
        preset.lane === 'planned' ? settings.plannedScanStartMin : settings.actualScanStartMin;

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
    [dayKey, openEditEditor, settings.actualScanStartMin, settings.plannedScanStartMin, sortedBlocks]
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
        Alert.alert('Storage error', 'Could not finish copy planned to actual.');
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
        Alert.alert('Storage error', 'Could not copy yesterday planned blocks.');
      }
    })();
  }, [isViewingToday, reloadCurrentDay, sortedBlocks, todayDayKey]);

  const setDimMode = useCallback((value: boolean) => {
    void (async () => {
      try {
        await updateSettings({ dimInsteadOfHide: value });
      } catch {
        Alert.alert('Settings error', 'Could not update dim mode setting.');
      }
    })();
  }, [updateSettings]);

  const shareDaySummary = useCallback(() => {
    const plannedBlocks = sortByStartMin(sortedBlocks.filter((block) => block.lane === 'planned'));
    const actualBlocks = sortByStartMin(sortedBlocks.filter((block) => block.lane === 'actual'));

    const tagLines = tagTotals.length
      ? tagTotals
          .map(
            (row) =>
              `${row.tag}: planned ${formatDuration(row.plannedMin)}, actual ${formatDuration(
                row.actualMin
              )}, delta ${row.deltaMin >= 0 ? '+' : '-'}${formatDuration(row.deltaMin)}`
          )
          .join('\n')
      : 'none';

    const plannedLines = plannedBlocks.length ? plannedBlocks.map(formatBlockLine).join('\n') : 'none';
    const actualLines = actualBlocks.length ? actualBlocks.map(formatBlockLine).join('\n') : 'none';

    const summary = [
      `Date: ${visibleDateLabel}`,
      `Planned total: ${formatDuration(plannedTotalMin)}`,
      `Actual total: ${formatDuration(actualTotalMin)}`,
      `Delta: ${deltaMin >= 0 ? '+' : '-'}${formatDuration(deltaMin)}`,
      '',
      'Tag totals:',
      tagLines,
      '',
      'Planned blocks:',
      plannedLines,
      '',
      'Actual blocks:',
      actualLines,
    ].join('\n');

    void Share.share({
      message: summary,
      title: `Day summary ${dayKey}`,
    });
  }, [actualTotalMin, dayKey, deltaMin, plannedTotalMin, sortedBlocks, tagTotals, visibleDateLabel]);

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
        void Haptics.selectionAsync();
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
      return;
    }

    const currentCandidate = draftCandidateRef.current;
    const currentDraft = draftCreateRef.current;

    setIsCreatingDraft(false);
    setDraftCreate(null);
    draftCreateRef.current = null;
    draftCandidateRef.current = null;

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

        if (!settings.dimInsteadOfHide && !matches) {
          return null;
        }

        const dimForFocus = isFocusActive && !isHighlighted(block);

        return {
          block,
          dimmed: (settings.dimInsteadOfHide && !matches) || dimForFocus,
        };
      })
      .filter((item): item is { block: TimeBlock; dimmed: boolean } => item !== null);

    return {
      planned: toRenderable('planned'),
      actual: toRenderable('actual'),
    };
  }, [focusedPlannedId, settings.dimInsteadOfHide, sortedBlocks, tagFilter]);

  const hasAnyBlocks = sortedBlocks.length > 0;
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

  return (
    <View style={styles.screen}>
      <View style={styles.topHeaderRow}>
        <Text style={styles.appTitle}>Plan vs Actual</Text>
        <View style={styles.topActions}>
          <Pressable
            accessibilityLabel="Open daily metrics"
            accessibilityRole="button"
            style={styles.analyticsButton}
            onPress={() => setToolsSheetVisible(true)}>
            <Ionicons name="bar-chart-outline" size={18} color={UI_COLORS.neutralText} />
          </Pressable>
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            style={styles.analyticsButton}
            onPress={() => router.push('/(tabs)/settings')}>
            <Ionicons name="settings-outline" size={18} color={UI_COLORS.neutralText} />
          </Pressable>
          <Pressable
            accessibilityLabel={`Add ${selectedLane} block`}
            accessibilityRole="button"
            style={styles.addButton}
            onPress={() => openCreateEditor(selectedLane)}>
            <Ionicons name="add" size={20} color={UI_COLORS.neutralText} />
          </Pressable>
        </View>
      </View>

      <View style={styles.dateRow}>
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
      <View style={styles.dateDivider} />

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
                  {mode === 'compare' ? 'Compare' : mode === 'planned' ? 'Planned' : 'Actual'}
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
        {compareMode ? (
          <View style={styles.compareHeaderRow}>
            <Text style={styles.compareHeaderLabel}>Plan</Text>
            <View style={styles.compareHeaderDivider} />
            <Text style={styles.compareHeaderLabel}>Actual</Text>
          </View>
        ) : (
          <Text style={styles.laneHeader}>{laneVisibility.planned ? 'Plan' : 'Actual'}</Text>
        )}
      </View>

      <ScrollView
        ref={timelineScrollRef}
        scrollEnabled={activeDragId === null && !isCreatingDraft}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { height: TIMELINE_HEIGHT }]}
        onLayout={syncTimelineViewportTop}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          timelineScrollOffsetYRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator>
        <View style={[styles.timelineBody, { height: TIMELINE_HEIGHT }]}>
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
                    style={[styles.laneSurface, styles.compareLane, laneIndex === 0 && styles.compareLaneLeft]}
                    onStartShouldSetResponderCapture={() => {
                      if (focusedPlannedId !== null) {
                        setFocusedPlannedId(null);
                      }

                      return false;
                    }}>
                    {Array.from({ length: 25 }, (_, index) => {
                      const top = index * 60 * PIXELS_PER_MINUTE;

                      return <View key={index} style={[styles.hourLine, { top }]} />;
                    })}
                    {dayKey === todayDayKey ? (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.nowLineWrap,
                          { top: clamp(nowMinute, 0, MINUTES_PER_DAY) * PIXELS_PER_MINUTE },
                        ]}>
                        <View style={styles.nowLine} />
                        <Text style={styles.nowLineLabel}>Now</Text>
                      </View>
                    ) : null}

                    {renderedLaneBlocks[lane].map(({ block, dimmed }) => (
                      <Block
                        key={block.id}
                        id={block.id}
                        startMin={block.startMin}
                        endMin={block.endMin}
                        title={block.title}
                        tags={block.tags}
                        lane={block.lane}
                        onPress={handleBlockPress}
                        onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDragRelease={handleDragRelease}
                      onDragStep={handleDragStep}
                      categoryColorMap={categoryColorMap}
                      interactive={!dimmed}
                      dimmed={dimmed}
                      />
                    ))}
                  </View>
                </GestureDetector>
              ))}
            </View>
          ) : (
            <GestureDetector gesture={createGesture}>
              <View
                style={styles.laneSurface}
                onStartShouldSetResponderCapture={() => {
                  if (focusedPlannedId !== null) {
                    setFocusedPlannedId(null);
                  }

                  return false;
                }}>
                {Array.from({ length: 25 }, (_, index) => {
                  const top = index * 60 * PIXELS_PER_MINUTE;

                  return <View key={index} style={[styles.hourLine, { top }]} />;
                })}

                {dayKey === todayDayKey ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.nowLineWrap,
                      { top: clamp(nowMinute, 0, MINUTES_PER_DAY) * PIXELS_PER_MINUTE },
                    ]}>
                    <View style={styles.nowLine} />
                    <Text style={styles.nowLineLabel}>Now</Text>
                  </View>
                ) : null}

                {renderedLaneBlocks[selectedLane].map(({ block, dimmed }) => (
                  <Block
                    key={block.id}
                    id={block.id}
                    startMin={block.startMin}
                    endMin={block.endMin}
                    title={block.title}
                    tags={block.tags}
                    lane={block.lane}
                    onPress={handleBlockPress}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragRelease={handleDragRelease}
                    onDragStep={handleDragStep}
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
                      {formatHHMM(draftCreate.startMin)}-{formatHHMM(draftCreate.endMin)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </GestureDetector>
          )}
        </View>
      </ScrollView>

      <Text style={styles.feedbackText}>{feedbackMessage ?? ' '}</Text>

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
          <View style={styles.sheetCard}>
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Daily Metrics</Text>
              <Pressable
                accessibilityLabel="Close daily metrics"
                style={styles.sheetCloseButton}
                onPress={() => setToolsSheetVisible(false)}>
                <Ionicons name="close" size={18} color={UI_COLORS.neutralText} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
              <View style={[styles.summaryCard, styles.summaryCardPlanned]}>
                <View style={styles.summaryCardHeader}>
                  <Ionicons name="radio-button-on-outline" size={14} color={UI_COLORS.planned} />
                  <Text style={styles.summaryCardLabel}>Planned</Text>
                </View>
                <Text style={[styles.summaryCardValue, styles.summaryCardValuePlanned]}>{minutesToHM(plannedTotalMin)}</Text>
                <Text style={styles.summaryCardSubtext}>
                  {plannedBlocks.length} {plannedBlocks.length === 1 ? 'block' : 'blocks'}
                </Text>
              </View>

              <View style={[styles.summaryCard, styles.summaryCardActual]}>
                <View style={styles.summaryCardHeader}>
                  <Ionicons name="link-outline" size={14} color={UI_COLORS.actual} />
                  <Text style={styles.summaryCardLabel}>Linked Actual</Text>
                </View>
                <Text style={[styles.summaryCardValue, styles.summaryCardValueActual]}>
                  {minutesToHM(linkedActualTotals.linkedMinutes)}
                </Text>
                <Text style={styles.summaryCardSubtext}>
                  {linkedActualTotals.linkedBlocks} linked {linkedActualTotals.linkedBlocks === 1 ? 'block' : 'blocks'}
                </Text>
              </View>

              <View style={[styles.summaryCard, styles.summaryCardFulfillment]}>
                <View style={styles.summaryCardHeader}>
                  <Ionicons name="trending-up-outline" size={14} color={UI_COLORS.accent} />
                  <Text style={styles.summaryCardLabel}>Fulfillment</Text>
                </View>
                <Text style={[styles.summaryCardValue, styles.summaryCardValueFulfillment]}>
                  {overallFulfillmentPercent}%
                </Text>
                <Text style={styles.summaryCardSubtext}>Of planned time</Text>
              </View>

              <Text style={styles.sectionTitle}>Plan Fulfillment</Text>
              {fulfillmentRows.length === 0 ? (
                <Text style={styles.emptySheetText}>No planned blocks yet for this day.</Text>
              ) : (
                fulfillmentRows.map((row) => {
                  const linkedBlocks = actualBlocks.filter((block) => block.linkedPlannedId === row.plannedId).length;
                  const categoryTag = plannedBlocks.find((block) => block.id === row.plannedId)?.tags[0] ?? 'work';
                  const categoryColor = categoryColorMap[categoryTag.toLowerCase()] ?? getCategoryColor(categoryTag);

                  return (
                    <View key={row.plannedId} style={styles.fulfillmentCard}>
                      <View style={styles.fulfillmentRowTop}>
                        <View style={styles.fulfillmentTitleWrap}>
                          <View style={[styles.categoryDot, { backgroundColor: categoryColor }]} />
                          <Text style={styles.fulfillmentTitle}>{row.title}</Text>
                        </View>
                        <Text style={styles.fulfillmentPercent}>{row.fulfillmentPercent}%</Text>
                      </View>
                      <View style={styles.fulfillmentRowMeta}>
                        <Text style={styles.fulfillmentMeta}>Planned: {minutesToHM(row.plannedMinutes)}</Text>
                        <Text style={styles.fulfillmentMeta}>
                          Linked: {minutesToHM(row.linkedActualMinutes)} ({linkedBlocks} {linkedBlocks === 1 ? 'block' : 'blocks'})
                        </Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              width: `${row.fulfillmentPercent}%`,
                              backgroundColor: categoryColor,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })
              )}

              <Text style={styles.sectionTitle}>Time by Category</Text>
              {categoryRows.length === 0 ? (
                <Text style={styles.emptySheetText}>No categories yet for this day.</Text>
              ) : (
                categoryRows.map((row) => (
                  <View key={row.tag} style={styles.categoryCard}>
                    <View style={styles.categoryHeader}>
                      <View style={[styles.categoryDot, { backgroundColor: row.color }]} />
                      <Text style={styles.categoryTitle}>{row.label}</Text>
                    </View>

                    <View style={styles.categoryLine}>
                      <Text style={styles.categoryLineLabel}>Plan</Text>
                      <Text style={styles.categoryLineValue}>{minutesToHM(row.plannedMinutes)}</Text>
                    </View>
                    <View style={styles.categoryTrack}>
                      <View
                        style={[
                          styles.categoryBarPlan,
                          { width: `${Math.round(row.plannedRatio * 100)}%`, backgroundColor: `${row.color}66` },
                        ]}
                      />
                    </View>

                    <View style={styles.categoryLine}>
                      <Text style={styles.categoryLineLabel}>Actual</Text>
                      <Text style={styles.categoryLineValue}>{minutesToHM(row.actualMinutes)}</Text>
                    </View>
                    <View style={styles.categoryTrack}>
                      <View
                        style={[
                          styles.categoryBarActual,
                          { width: `${Math.round(row.actualRatio * 100)}%`, backgroundColor: row.color },
                        ]}
                      />
                    </View>
                  </View>
                ))
              )}
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
    paddingTop: 48,
    paddingHorizontal: 12,
    paddingBottom: 0,
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
    fontSize: 22,
    fontWeight: '700',
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
    backgroundColor: UI_COLORS.surface,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  dateNavButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: UI_COLORS.surface,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    marginBottom: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: UI_COLORS.surfaceMuted,
    borderRadius: 12,
    padding: 2,
  },
  segmentButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    borderRadius: 10,
  },
  segmentButtonSelected: {
    backgroundColor: UI_COLORS.surface,
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: UI_COLORS.neutralTextSoft,
  },
  segmentButtonTextSelected: {
    color: UI_COLORS.neutralText,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: UI_RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI_COLORS.surface,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
  },
  feedbackText: {
    minHeight: 18,
    marginBottom: 8,
    fontSize: 12,
    color: UI_COLORS.neutralTextSoft,
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
    backgroundColor: UI_COLORS.surface,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
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
    width: 54,
  },
  laneHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: UI_COLORS.neutralTextSoft,
  },
  compareHeaderRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    borderBottomColor: UI_COLORS.neutralBorder,
    paddingBottom: 6,
  },
  compareHeaderLabel: {
    flex: 1,
    textAlign: 'center',
    color: UI_COLORS.neutralText,
    fontSize: 12,
    fontWeight: '600',
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
    backgroundColor: 'transparent',
    marginBottom: 2,
  },
  scrollContent: {
    minHeight: TIMELINE_HEIGHT,
  },
  timelineBody: {
    flexDirection: 'row',
  },
  timeColumn: {
    width: 54,
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
    height: TIMELINE_HEIGHT,
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
    left: 0,
    right: 0,
    zIndex: 4,
  },
  nowLine: {
    borderTopWidth: 1,
    borderTopColor: '#DC2626',
  },
  nowLineLabel: {
    position: 'absolute',
    top: -9,
    right: 8,
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    borderRadius: 8,
    overflow: 'hidden',
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
  sheetModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: UI_COLORS.overlay,
  },
  sheetCard: {
    maxHeight: '86%',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetContent: {
    gap: 8,
    paddingBottom: 10,
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
    fontSize: 13,
    fontWeight: '700',
  },
  summaryCardValue: {
    marginTop: 2,
    fontSize: 24,
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
    fontSize: 14,
    fontWeight: '600',
    marginTop: 10,
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
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginHorizontal: 24,
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
