import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Block, PIXELS_PER_MINUTE } from '@/src/components/Block';
import { BlockEditorModal } from '@/src/components/BlockEditorModal';
import { TAG_CATALOG } from '@/src/constants/tags';
import { useAppSettings } from '@/src/context/AppSettingsContext';
import { deleteBlock, getBlocksForDay, insertBlock, updateBlock } from '@/src/storage/blocksDb';
import type { Block as TimeBlock, Lane } from '@/src/types/blocks';
import { dayKeyToLocalDate, getLocalDayKey, shiftDayKey } from '@/src/utils/dayKey';
import { clamp, formatDuration, formatHHMM, parseHHMM, roundTo15 } from '@/src/utils/time';

type LaneFilter = 'all' | Lane;
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

const MINUTES_PER_DAY = 24 * 60;
const TIMELINE_HEIGHT = MINUTES_PER_DAY * PIXELS_PER_MINUTE;
const DEFAULT_VIEWPORT_HOURS = 10;
const VIEWPORT_HEIGHT = DEFAULT_VIEWPORT_HOURS * 60 * PIXELS_PER_MINUTE;
const FEEDBACK_DURATION_MS = 1500;

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
  return [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id));
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

function matchesFilters(block: TimeBlock, laneFilter: LaneFilter, tagFilter: TagFilter): boolean {
  if (laneFilter !== 'all' && block.lane !== laneFilter) {
    return false;
  }

  if (tagFilter !== 'all' && !block.tags.map((tag) => tag.toLowerCase()).includes(tagFilter)) {
    return false;
  }

  return true;
}

function buildTagTotals(blocks: TimeBlock[]): Array<{ tag: string; plannedMin: number; actualMin: number; deltaMin: number }> {
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

function getDefaultCreateRange(): { startMin: number; endMin: number } {
  const now = new Date();
  const currentMinute = now.getHours() * 60 + now.getMinutes();

  let startMin = clamp(roundTo15(currentMinute), 0, 1439);
  let endMin = clamp(startMin + 60, 0, MINUTES_PER_DAY);

  if (endMin - startMin <= 0) {
    startMin = 480;
    endMin = 540;
  }

  return { startMin, endMin };
}

export default function DayTimeline() {
  const { settings, loading: settingsLoading, updateSettings, dataVersion } = useAppSettings();

  const [dayKey, setDayKey] = useState(getLocalDayKey());
  const [reloadTick, setReloadTick] = useState(0);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState>(INITIAL_EDITOR_STATE);
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('all');
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRequestIdRef = useRef(0);

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

  const laneRenderBlocks = useMemo(() => {
    return {
      planned: sortedBlocks.filter((block) => block.lane === 'planned'),
      actual: sortedBlocks.filter((block) => block.lane === 'actual'),
    };
  }, [sortedBlocks]);

  const reloadCurrentDay = useCallback(() => {
    setReloadTick((current) => current + 1);
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

  const openCreateEditor = useCallback((lane: Lane) => {
    const { startMin, endMin } = getDefaultCreateRange();

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
  }, []);

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
          setBlocks((current) => sortByStartMin(current.map((block) => (block.id === blockId ? updatedBlock : block))));
        } catch {
          Alert.alert('Storage error', 'Could not save drag change.');
        }
      })();
    },
    [dayKey, showFeedback, sortedBlocks]
  );

  const handleBlockPress = useCallback(
    (blockId: string) => {
      if (activeDragId !== null) {
        return;
      }

      const block = sortedBlocks.find((item) => item.id === blockId);

      if (!block) {
        return;
      }

      openEditEditor(block);
    },
    [activeDragId, openEditEditor, sortedBlocks]
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
          setBlocks((current) => sortByStartMin(current.map((block) => (block.id === updatedBlock.id ? updatedBlock : block))));
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
          setQuickAddVisible(false);
          openEditEditor(inserted);
        } catch {
          Alert.alert('Storage error', 'Could not create quick add block.');
        }
      })();
    },
    [dayKey, openEditEditor, settings.actualScanStartMin, settings.plannedScanStartMin, sortedBlocks]
  );

  const copyPlannedToActual = useCallback(() => {
    setMenuVisible(false);

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

    setMenuVisible(false);

    void (async () => {
      const yesterdayKey = shiftDayKey(todayDayKey, -1);

      try {
        const yesterdayBlocks = await getBlocksForDay(yesterdayKey);
        const yesterdayPlanned = sortByStartMin(yesterdayBlocks.filter((block) => block.lane === 'planned'));
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

  const toggleDimMode = useCallback(() => {
    setMenuVisible(false);

    void (async () => {
      try {
        await updateSettings({ dimInsteadOfHide: !settings.dimInsteadOfHide });
      } catch {
        Alert.alert('Settings error', 'Could not update dim mode setting.');
      }
    })();
  }, [settings.dimInsteadOfHide, updateSettings]);

  const shareDaySummary = useCallback(() => {
    setMenuVisible(false);

    const plannedBlocks = sortByStartMin(sortedBlocks.filter((block) => block.lane === 'planned'));
    const actualBlocks = sortByStartMin(sortedBlocks.filter((block) => block.lane === 'actual'));

    const dateText = visibleDateLabel;
    const tagLines = tagTotals.length
      ? tagTotals
          .map(
            (row) =>
              `${row.tag}: planned ${formatDuration(row.plannedMin)}, actual ${formatDuration(row.actualMin)}, delta ${row.deltaMin >= 0 ? '+' : '-'}${formatDuration(row.deltaMin)}`
          )
          .join('\n')
      : 'none';

    const plannedLines = plannedBlocks.length ? plannedBlocks.map(formatBlockLine).join('\n') : 'none';
    const actualLines = actualBlocks.length ? actualBlocks.map(formatBlockLine).join('\n') : 'none';

    const summary = [
      `Date: ${dateText}`,
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

  const renderLaneBlocks = useCallback(
    (lane: Lane) => {
      return laneRenderBlocks[lane].map((block) => {
        const matches = matchesFilters(block, laneFilter, tagFilter);

        if (!settings.dimInsteadOfHide && !matches) {
          return null;
        }

        const dimmed = settings.dimInsteadOfHide && !matches;

        return (
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
        );
      });
    },
    [handleBlockPress, handleDragEnd, handleDragRelease, handleDragStart, laneFilter, laneRenderBlocks, settings.dimInsteadOfHide, tagFilter]
  );

  const hasAnyBlocks = sortedBlocks.length > 0;

  return (
    <View style={styles.screen}>
      <View style={styles.titleRow}>
        <Text style={styles.screenTitle}>Daily Timeline</Text>
        <Pressable
          accessibilityLabel="Open day actions"
          style={styles.menuButton}
          onPress={() => setMenuVisible(true)}>
          <Text style={styles.menuButtonText}>Menu</Text>
        </Pressable>
      </View>

      <View style={styles.dayNavRow}>
        <Pressable
          accessibilityLabel="Go to previous day"
          style={styles.dayNavButton}
          onPress={goToPreviousDay}>
          <Text style={styles.dayNavButtonText}>{'<'}</Text>
        </Pressable>
        <Text style={styles.dayNavLabel}>{visibleDateLabel}</Text>
        <View style={styles.dayNavRightGroup}>
          <Pressable accessibilityLabel="Jump to today" style={styles.todayButton} onPress={goToToday}>
            <Text style={styles.todayButtonText}>Today</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Go to next day"
            style={[styles.dayNavButton, !canGoToNextDay && styles.dayNavButtonDisabled]}
            onPress={goToNextDay}
            disabled={!canGoToNextDay}>
            <Text style={[styles.dayNavButtonText, !canGoToNextDay && styles.dayNavButtonTextDisabled]}>
              {'>'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.quickFilterRow}>
        <Pressable
          accessibilityLabel="Open quick add presets"
          style={styles.quickAddButton}
          onPress={() => setQuickAddVisible(true)}>
          <Text style={styles.quickAddButtonText}>Quick Add</Text>
        </Pressable>

        <View style={styles.filterPillsRow}>
          {(['all', 'planned', 'actual'] as LaneFilter[]).map((value) => {
            const selected = laneFilter === value;

            return (
              <Pressable
                key={value}
                accessibilityLabel={`Filter lane ${value}`}
                style={[styles.filterPill, selected && styles.filterPillSelected]}
                onPress={() => setLaneFilter(value)}>
                <Text style={[styles.filterPillText, selected && styles.filterPillTextSelected]}>
                  {value === 'all' ? 'All' : value === 'planned' ? 'Planned' : 'Actual'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagFilterRow}>
        {(['all', ...TAG_CATALOG] as TagFilter[]).map((value) => {
          const selected = tagFilter === value;

          return (
            <Pressable
              key={value}
              accessibilityLabel={`Filter by tag ${value}`}
              style={[styles.tagFilterPill, selected && styles.filterPillSelected]}
              onPress={() => setTagFilter(value)}>
              <Text style={[styles.filterPillText, selected && styles.filterPillTextSelected]}>
                {value === 'all' ? 'All tags' : value}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryItem}>Planned: {formatDuration(plannedTotalMin)}</Text>
        <Text style={styles.summaryItem}>Actual: {formatDuration(actualTotalMin)}</Text>
        <Text style={styles.summaryItem}>
          Delta: {deltaMin >= 0 ? '+' : '-'}
          {formatDuration(deltaMin)}
        </Text>
      </View>

      <View style={styles.tagTotalsCard}>
        <Text style={styles.tagTotalsTitle}>Tag totals</Text>
        {visibleTagTotals.length === 0 ? (
          <Text style={styles.tagTotalsEmpty}>No tag totals yet for this day.</Text>
        ) : (
          visibleTagTotals.map((row) => (
            <View key={row.tag} style={styles.tagTotalsRow}>
              <Text style={styles.tagTotalsTag}>{row.tag}</Text>
              <Text style={styles.tagTotalsValue}>P {formatDuration(row.plannedMin)}</Text>
              <Text style={styles.tagTotalsValue}>A {formatDuration(row.actualMin)}</Text>
              <Text style={styles.tagTotalsValue}>
                D {row.deltaMin >= 0 ? '+' : '-'}
                {formatDuration(row.deltaMin)}
              </Text>
            </View>
          ))
        )}
      </View>

      <Text style={styles.feedbackText}>{feedbackMessage ?? ' '}</Text>

      {!hasAnyBlocks ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateTitle}>No blocks for this day.</Text>
          <Text style={styles.emptyStateBody}>Use Quick Add to create your first planned or actual block.</Text>
          <Pressable
            accessibilityLabel="Add first block"
            style={styles.emptyStateButton}
            onPress={() => setQuickAddVisible(true)}>
            <Text style={styles.emptyStateButtonText}>Add first block</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.headerRow}>
        <View style={styles.timeHeader} />
        <View style={styles.laneHeaderCell}>
          <Text style={styles.laneHeader}>Planned</Text>
          <Pressable
            accessibilityLabel="Add planned block"
            style={styles.addButton}
            onPress={() => openCreateEditor('planned')}>
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        </View>
        <View style={styles.laneHeaderCell}>
          <Text style={styles.laneHeader}>Actual</Text>
          <Pressable
            accessibilityLabel="Add actual block"
            style={styles.addButton}
            onPress={() => openCreateEditor('actual')}>
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        scrollEnabled={activeDragId === null}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { height: TIMELINE_HEIGHT }]}
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

          <View style={styles.lanesWrap}>
            {Array.from({ length: 25 }, (_, index) => {
              const top = index * 60 * PIXELS_PER_MINUTE;

              return <View key={index} style={[styles.hourLine, { top }]} />;
            })}

            <View style={[styles.laneColumn, styles.leftLane]}>{renderLaneBlocks('planned')}</View>

            <View style={styles.laneColumn}>{renderLaneBlocks('actual')}</View>
          </View>
        </View>
      </ScrollView>

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

      <Modal animationType="fade" transparent visible={quickAddVisible} onRequestClose={() => setQuickAddVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.quickAddCard}>
            <Text style={styles.quickAddTitle}>Quick Add</Text>
            {QUICK_PRESETS.map((preset) => (
              <Pressable
                key={preset.key}
                accessibilityLabel={`Quick add ${preset.title}`}
                style={styles.quickAddPreset}
                onPress={() => handleQuickAdd(preset)}>
                <Text style={styles.quickAddPresetTitle}>{preset.title}</Text>
                <Text style={styles.quickAddPresetBody}>
                  {preset.durationMin}m | {preset.lane} | {preset.tags.join(', ')}
                </Text>
              </Pressable>
            ))}
            <Pressable accessibilityLabel="Close quick add" style={styles.modalClose} onPress={() => setQuickAddVisible(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={menuVisible} onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuCard}>
            <Pressable accessibilityLabel="Share day summary" style={styles.menuItem} onPress={shareDaySummary}>
              <Text style={styles.menuItemText}>Share day summary</Text>
            </Pressable>
            <Pressable accessibilityLabel="Copy planned to actual" style={styles.menuItem} onPress={copyPlannedToActual}>
              <Text style={styles.menuItemText}>Copy planned to actual</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Copy yesterday planned"
              style={[styles.menuItem, !isViewingToday && styles.menuItemDisabled]}
              onPress={copyYesterdayPlannedToToday}
              disabled={!isViewingToday}>
              <Text style={[styles.menuItemText, !isViewingToday && styles.menuItemTextDisabled]}>
                Copy yesterday planned
              </Text>
            </Pressable>
            <Pressable accessibilityLabel="Toggle dim instead of hide" style={styles.menuItem} onPress={toggleDimMode}>
              <Text style={styles.menuItemText}>
                {settings.dimInsteadOfHide ? 'Hide non-matching blocks' : 'Dim instead of hide'}
              </Text>
            </Pressable>
            <Pressable accessibilityLabel="Close menu" style={styles.menuItem} onPress={() => setMenuVisible(false)}>
              <Text style={styles.menuItemText}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
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
    paddingBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  menuButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  menuButtonText: {
    color: '#0F172A',
    fontWeight: '600',
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
  quickFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  quickAddButton: {
    borderWidth: 1,
    borderColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#0F172A',
  },
  quickAddButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  filterPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    flex: 1,
  },
  filterPill: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
  tagFilterRow: {
    marginBottom: 8,
    minHeight: 34,
  },
  tagFilterPill: {
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  summaryItem: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  tagTotalsCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
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
    marginBottom: 8,
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
  laneHeaderCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  laneHeader: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  addButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FFFFFF',
  },
  addButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  scrollView: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
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
  lanesWrap: {
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  laneColumn: {
    flex: 1,
    position: 'relative',
  },
  leftLane: {
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
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
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  quickAddPreset: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
  },
  quickAddPresetTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  quickAddPresetBody: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
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
