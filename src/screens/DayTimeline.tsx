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
  Switch,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Block, PIXELS_PER_MINUTE } from '@/src/components/Block';
import { BlockEditorModal } from '@/src/components/BlockEditorModal';
import { TAG_CATALOG } from '@/src/constants/tags';
import { useAppSettings } from '@/src/context/AppSettingsContext';
import { deleteBlock, getBlocksForDay, insertBlock, updateBlock } from '@/src/storage/blocksDb';
import type { Block as TimeBlock, Lane } from '@/src/types/blocks';
import { dayKeyToLocalDate, getLocalDayKey, shiftDayKey } from '@/src/utils/dayKey';
import { clamp, formatDuration, formatHHMM, parseHHMM, roundTo15 } from '@/src/utils/time';

type TagFilter = 'all' | (typeof TAG_CATALOG)[number];

type EditorState = {
  visible: boolean;
  mode: 'create' | 'edit';
  lane: Lane;
  blockId: string | null;
  title: string;
  tags: string[];
  startText: string;
  endText: string;
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
const CREATE_THRESHOLD_PX = 8;
const CREATE_DELAY_MS = 120;
const TAP_CREATE_DURATION_MIN = 60;
const SCROLL_LIKE_VELOCITY_Y = 1100;

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
  errorText: null,
};

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
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

  const sortedBlocks = useMemo(() => sortByStartMin(blocks), [blocks]);
  const selectedLaneBlocks = useMemo(
    () => sortedBlocks.filter((block) => block.lane === selectedLane),
    [selectedLane, sortedBlocks]
  );
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

  const setEditorField = useCallback((field: keyof EditorState, value: string) => {
    setEditorState((current) => ({ ...current, [field]: value, errorText: null }));
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
      };

      void (async () => {
        try {
          await updateBlock(updatedBlock, dayKey);
          setBlocks((current) =>
            sortByStartMin(current.map((block) => (block.id === updatedBlock.id ? updatedBlock : block)))
          );
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
    };

    void (async () => {
      try {
        const insertedBlock = await insertBlock(newBlockInput, dayKey);
        setBlocks((current) => sortByStartMin([...current, insertedBlock]));
        closeEditor();
      } catch {
        Alert.alert('Storage error', 'Could not create block.');
      }
    })();
  }, [closeEditor, dayKey, editorState, sortedBlocks]);

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
    (absoluteY: number) => {
      finalizeHandledRef.current = false;
      draftCandidateRef.current = null;
      draftCreateRef.current = null;
      setDraftCreate(null);
      setIsCreatingDraft(false);

      if (activeDragId !== null) {
        createGestureBlockedRef.current = true;
        return;
      }

      const minute = minuteFromAbsoluteY(absoluteY);

      if (minute === null) {
        createGestureBlockedRef.current = true;
        return;
      }

      const touchedExisting = selectedLaneBlocks.some(
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
    [activeDragId, minuteFromAbsoluteY, selectedLaneBlocks]
  );

  const updateDraftCreation = useCallback(
    (absoluteY: number, velocityY: number) => {
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
          selectedLane,
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
        setDraftCreate(initialDraft);
        setIsCreatingDraft(true);
        return;
      }

      const current = draftCreateRef.current;

      const nextRange = normalizeDraftRange(current.anchorMin, minute);
      const invalid = hasOverlap(selectedLane, null, nextRange.startMin, nextRange.endMin, sortedBlocks);
      const nextDraft: DraftCreateState = {
        ...current,
        startMin: nextRange.startMin,
        endMin: nextRange.endMin,
        invalid,
      };

      draftCreateRef.current = nextDraft;
      setDraftCreate(nextDraft);
    },
    [minuteFromAbsoluteY, selectedLane, sortedBlocks]
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

  const createGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetY([-CREATE_THRESHOLD_PX, CREATE_THRESHOLD_PX])
        .shouldCancelWhenOutside(false)
        .onBegin((event) => {
          beginDraftCreation(event.absoluteY);
        })
        .onUpdate((event) => {
          updateDraftCreation(event.absoluteY, event.velocityY);
        })
        .onFinalize(() => {
          finalizeDraftCreation();
        }),
    [beginDraftCreation, finalizeDraftCreation, updateDraftCreation]
  );

  const compareMode = laneVisibility.planned && laneVisibility.actual;

  const renderedLaneBlocks = useMemo(() => {
    const toRenderable = (lane: Lane) =>
      sortByStartMin(sortedBlocks.filter((block) => block.lane === lane))
        .map((block) => {
        const matches = matchesTagFilter(block, tagFilter);

        if (!settings.dimInsteadOfHide && !matches) {
          return null;
        }

        return {
          block,
          dimmed: settings.dimInsteadOfHide && !matches,
        };
      })
      .filter((item): item is { block: TimeBlock; dimmed: boolean } => item !== null);

    return {
      planned: toRenderable('planned'),
      actual: toRenderable('actual'),
    };
  }, [settings.dimInsteadOfHide, sortedBlocks, tagFilter]);

  const hasAnyBlocks = sortedBlocks.length > 0;
  const performanceDeltaText =
    deltaMin === 0
      ? 'On track with plan'
      : deltaMin > 0
        ? `${formatDuration(deltaMin)} ahead of plan`
        : `${formatDuration(deltaMin)} behind plan`;
  const performanceDeltaStyle =
    deltaMin === 0
      ? styles.performanceDeltaNeutral
      : deltaMin > 0
        ? styles.performanceDeltaAhead
        : styles.performanceDeltaBehind;

  const toggleLaneVisibility = useCallback((lane: Lane) => {
    setLaneVisibility((current) => {
      const nextValue = !current[lane];
      const otherLane: Lane = lane === 'planned' ? 'actual' : 'planned';

      if (!nextValue && !current[otherLane]) {
        return current;
      }

      const next = { ...current, [lane]: nextValue };

      if (nextValue) {
        setSelectedLane(lane);
      } else if (selectedLane === lane) {
        setSelectedLane(otherLane);
      }

      return next;
    });
  }, [selectedLane]);

  return (
    <View style={styles.screen}>
      <View style={styles.dayNavRow}>
        <Pressable
          accessibilityLabel="Go to previous day"
          accessibilityRole="button"
          style={styles.dayNavButton}
          onPress={goToPreviousDay}>
          <Text style={styles.dayNavButtonText}>{'<'}</Text>
        </Pressable>
        <Text style={styles.dayNavLabel}>{visibleDateLabel}</Text>
        <View style={styles.dayNavRightGroup}>
          <Pressable
            accessibilityLabel="Jump to today"
            accessibilityRole="button"
            style={styles.todayButton}
            onPress={goToToday}>
            <Text style={styles.todayButtonText}>Today</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Go to next day"
            accessibilityRole="button"
            style={[styles.dayNavButton, !canGoToNextDay && styles.dayNavButtonDisabled]}
            onPress={goToNextDay}
            disabled={!canGoToNextDay}>
            <Text style={[styles.dayNavButtonText, !canGoToNextDay && styles.dayNavButtonTextDisabled]}>
              {'>'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.topControlRow}>
        <View style={styles.segmentedControl}>
          {(['planned', 'actual'] as Lane[]).map((lane) => {
            const selected = laneVisibility[lane];

            return (
              <Pressable
                key={lane}
                accessibilityLabel={`Toggle ${lane} lane`}
                accessibilityRole="button"
                onPress={() => toggleLaneVisibility(lane)}
                style={[styles.segmentButton, selected && styles.segmentButtonSelected]}>
                <Text style={[styles.segmentButtonText, selected && styles.segmentButtonTextSelected]}>
                  {lane === 'planned' ? 'Planned' : 'Actual'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityLabel={`Add ${selectedLane} block`}
          accessibilityRole="button"
          style={styles.addButton}
          onPress={() => openCreateEditor(selectedLane)}>
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      {!hasAnyBlocks ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateTitle}>No blocks for this day.</Text>
          <Text style={styles.emptyStateBody}>Tap empty time or use the add button to create a block.</Text>
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
        <Text style={styles.laneHeader}>
          {compareMode
            ? 'Planned and actual'
            : laneVisibility.planned
              ? 'Planned lane'
              : 'Actual lane'}
        </Text>
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
                <View
                  key={lane}
                  style={[styles.laneSurface, styles.compareLane, laneIndex === 0 && styles.compareLaneLeft]}>
                  {Array.from({ length: 25 }, (_, index) => {
                    const top = index * 60 * PIXELS_PER_MINUTE;

                    return <View key={index} style={[styles.hourLine, { top }]} />;
                  })}
                  <Text style={styles.compareLaneLabel}>{lane === 'planned' ? 'Planned' : 'Actual'}</Text>

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
                      interactive={!dimmed}
                      dimmed={dimmed}
                    />
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <GestureDetector gesture={createGesture}>
              <View style={styles.laneSurface}>
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

      <Pressable
        accessibilityLabel="Open insights and tools"
        accessibilityRole="button"
        style={styles.sheetHandle}
        onPress={() => setToolsSheetVisible(true)}>
        <View style={styles.sheetHandleBar} />
        <Text style={styles.sheetHandleText}>Tools</Text>
      </Pressable>

      <BlockEditorModal
        visible={editorState.visible}
        mode={editorState.mode}
        lane={editorState.lane}
        titleValue={editorState.title}
        selectedTags={editorState.tags}
        startValue={editorState.startText}
        endValue={editorState.endText}
        errorText={editorState.errorText}
        onChangeTitle={(value) => setEditorField('title', value)}
        onToggleTag={toggleEditorTag}
        onChangeStart={(value) => setEditorField('startText', value)}
        onChangeEnd={(value) => setEditorField('endText', value)}
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
            <Text style={styles.sheetDate}>{visibleDateLabel}</Text>
            <Text style={styles.sheetTitle}>Day performance</Text>

            <View style={styles.performanceSummary}>
              <Text style={styles.performanceLine}>
                {formatDuration(plannedTotalMin)} planned · {formatDuration(actualTotalMin)} actual
              </Text>
              <Text style={[styles.performanceDelta, performanceDeltaStyle]}>{performanceDeltaText}</Text>
            </View>
            <View style={styles.sheetDivider} />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagFilterRow}>
              {(['all', ...TAG_CATALOG] as TagFilter[]).map((value) => {
                const selected = tagFilter === value;

                return (
                  <Pressable
                    key={value}
                    accessibilityLabel={`Filter by tag ${value}`}
                    accessibilityRole="button"
                    style={[styles.tagFilterPill, selected && styles.filterPillSelected]}
                    onPress={() => setTagFilter(value)}>
                    <Text style={[styles.filterPillText, selected && styles.filterPillTextSelected]}>
                      {value === 'all' ? 'All tags' : value}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.sheetSwitchRow}>
              <Text style={styles.sheetSwitchLabel}>Dim instead of hide</Text>
              <Switch
                accessibilityLabel="Toggle dim instead of hide"
                value={settings.dimInsteadOfHide}
                onValueChange={setDimMode}
              />
            </View>
            <View style={styles.sheetDivider} />

            <Pressable
              accessibilityLabel="Toggle tag breakdown"
              accessibilityRole="button"
              style={styles.collapsibleHeader}
              onPress={() => setTagBreakdownExpanded((current) => !current)}>
              <Text style={styles.collapsibleHeaderText}>
                {tagBreakdownExpanded ? '▼' : '▶'} Tag breakdown
              </Text>
            </Pressable>
            {tagBreakdownExpanded ? (
              <View style={styles.tagBreakdownWrap}>
                {visibleTagTotals.length === 0 ? (
                  <Text style={styles.tagTotalsEmpty}>No tag totals yet for this day.</Text>
                ) : (
                  visibleTagTotals.map((row) => (
                    <View key={row.tag} style={styles.tagBreakdownRow}>
                      <View style={styles.tagBreakdownMain}>
                        <Text style={styles.tagBreakdownTag}>{row.tag}</Text>
                        <Text style={styles.tagBreakdownSubline}>
                          P {formatDuration(row.plannedMin)} · A {formatDuration(row.actualMin)}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.tagBreakdownDelta,
                          row.deltaMin > 0
                            ? styles.performanceDeltaAhead
                            : row.deltaMin < 0
                              ? styles.performanceDeltaBehind
                              : styles.performanceDeltaNeutral,
                        ]}>
                        {row.deltaMin === 0
                          ? 'On track'
                          : `${formatDuration(row.deltaMin)} ${row.deltaMin > 0 ? 'ahead' : 'behind'}`}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            ) : null}
            <View style={styles.sheetDivider} />

            <View style={styles.actionList}>
              <Pressable
                accessibilityLabel="Copy planned to actual"
                accessibilityRole="button"
                style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
                onPress={() => {
                  setToolsSheetVisible(false);
                  copyPlannedToActual();
                }}>
                <View style={styles.actionRowInner}>
                  <Text style={styles.actionRowText}>Copy planned to actual</Text>
                  <Text style={styles.actionChevron}>›</Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityLabel="Copy yesterday planned"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.actionRow,
                  pressed && styles.actionRowPressed,
                  !isViewingToday && styles.menuItemDisabled,
                ]}
                disabled={!isViewingToday}
                onPress={() => {
                  setToolsSheetVisible(false);
                  copyYesterdayPlannedToToday();
                }}>
                <View style={styles.actionRowInner}>
                  <Text style={[styles.actionRowText, !isViewingToday && styles.menuItemTextDisabled]}>
                    Copy yesterday planned
                  </Text>
                  <Text style={[styles.actionChevron, !isViewingToday && styles.menuItemTextDisabled]}>
                    ›
                  </Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityLabel="Share day summary"
                accessibilityRole="button"
                style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
                onPress={() => {
                  setToolsSheetVisible(false);
                  shareDaySummary();
                }}>
                <View style={styles.actionRowInner}>
                  <Text style={styles.actionRowText}>Share day summary</Text>
                  <Text style={styles.actionChevron}>›</Text>
                </View>
              </Pressable>
            </View>
            <View style={styles.sheetDivider} />

            <Pressable
              accessibilityLabel="Toggle quick add presets"
              accessibilityRole="button"
              style={styles.collapsibleHeader}
              onPress={() => setQuickAddExpanded((current) => !current)}>
              <Text style={styles.collapsibleHeaderText}>{quickAddExpanded ? '▼' : '▶'} Quick Add</Text>
            </Pressable>
            {quickAddExpanded ? (
              <ScrollView style={styles.quickAddList}>
                {QUICK_PRESETS.map((preset) => (
                  <Pressable
                    key={preset.key}
                    accessibilityLabel={`Quick add ${preset.title}`}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.quickAddRow, pressed && styles.actionRowPressed]}
                    onPress={() => {
                      setToolsSheetVisible(false);
                      handleQuickAdd(preset);
                    }}>
                    <Text style={styles.quickAddRowTitle}>{preset.title}</Text>
                    <Text style={styles.quickAddRowMeta}>
                      {preset.durationMin}m · {preset.lane}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
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
    backgroundColor: '#F8FAFC',
    paddingTop: 56,
    paddingHorizontal: 12,
    paddingBottom: 0,
  },
  dayNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  dayNavLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  dayNavRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todayButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  todayButtonText: {
    color: '#0F172A',
    fontWeight: '600',
    fontSize: 12,
  },
  dayNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNavButtonDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  dayNavButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  dayNavButtonTextDisabled: {
    color: '#94A3B8',
  },
  topControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  segmentedControl: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  segmentButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
  },
  segmentButtonSelected: {
    backgroundColor: '#0F172A',
  },
  segmentButtonText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  segmentButtonTextSelected: {
    color: '#FFFFFF',
  },
  addButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: '#0F172A',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginTop: -1,
  },
  tagFilterRow: {
    marginBottom: 4,
    minHeight: 34,
  },
  tagFilterPill: {
    marginRight: 6,
    borderWidth: 0.5,
    borderColor: '#D8E1EC',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: '#FFFFFF',
  },
  filterPillSelected: {
    borderColor: '#0F172A',
    backgroundColor: '#0F172A',
  },
  filterPillText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
  },
  filterPillTextSelected: {
    color: '#FFFFFF',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingVertical: 2,
    marginBottom: 6,
  },
  summaryItem: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  tagTotalsCard: {
    padding: 0,
    marginBottom: 0,
  },
  tagTotalsTitle: {
    color: '#0F172A',
    fontWeight: '700',
    marginBottom: 6,
    fontSize: 13,
  },
  tagTotalsEmpty: {
    color: '#64748B',
    fontSize: 12,
  },
  tagTotalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  tagTotalsTag: {
    flex: 1,
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  tagTotalsValue: {
    color: '#334155',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  feedbackText: {
    minHeight: 18,
    marginBottom: 6,
    fontSize: 12,
    color: '#B45309',
  },
  emptyState: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 6,
  },
  emptyStateTitle: {
    fontSize: 15,
    color: '#0F172A',
    fontWeight: '700',
  },
  emptyStateBody: {
    fontSize: 13,
    color: '#475569',
  },
  emptyStateButton: {
    marginTop: 4,
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  emptyStateButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  timeHeader: {
    width: 54,
  },
  laneHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  scrollView: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    marginBottom: 6,
  },
  scrollContent: {
    minHeight: TIMELINE_HEIGHT,
  },
  timelineBody: {
    flexDirection: 'row',
  },
  timeColumn: {
    width: 54,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  hourLabelWrap: {
    position: 'absolute',
    left: 4,
    transform: [{ translateY: -6 }],
  },
  hourLabel: {
    fontSize: 10,
    color: '#64748B',
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
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
  },
  compareLaneLabel: {
    position: 'absolute',
    top: 6,
    left: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    zIndex: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
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
  sheetHandle: {
    borderTopWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginHorizontal: 14,
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#94A3B8',
    marginBottom: 6,
  },
  sheetHandleText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  sheetModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  sheetCard: {
    maxHeight: '78%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 18,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    marginBottom: 10,
  },
  sheetTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  sheetDate: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  performanceSummary: {
    marginBottom: 6,
    gap: 2,
  },
  performanceLine: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  performanceDelta: {
    fontSize: 17,
    fontWeight: '800',
  },
  performanceDeltaAhead: {
    color: '#166534',
  },
  performanceDeltaBehind: {
    color: '#9F1239',
  },
  performanceDeltaNeutral: {
    color: '#334155',
  },
  sheetDivider: {
    borderTopWidth: 0.5,
    borderTopColor: '#E2E8F0',
    marginVertical: 8,
  },
  sheetSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -2,
    marginBottom: -2,
  },
  sheetSwitchLabel: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  collapsibleHeader: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  collapsibleHeaderText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  tagBreakdownWrap: {
    paddingTop: 4,
    paddingBottom: 4,
  },
  tagBreakdownRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 6,
  },
  tagBreakdownMain: {
    flex: 1,
    paddingRight: 8,
  },
  tagBreakdownTag: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  tagBreakdownSubline: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 1,
  },
  tagBreakdownDelta: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  actionList: {
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#E2E8F0',
  },
  actionRow: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 2,
  },
  actionRowPressed: {
    backgroundColor: '#F8FAFC',
  },
  actionRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionRowText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
  },
  actionChevron: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 12,
  },
  quickAddList: {
    maxHeight: 220,
  },
  quickAddRow: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  quickAddRowTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
  },
  quickAddRowMeta: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 1,
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
