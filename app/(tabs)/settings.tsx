import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { LEGAL_DOCUMENTS, type LegalDocumentKey, SUPPORT_EMAIL } from '@/src/constants/legal';
import { UI_COLORS, UI_RADIUS, UI_TYPE } from '@/src/constants/uiTheme';
import { useAppSettings, type AppSettings } from '@/src/context/AppSettingsContext';
import { seedLastNDays } from '@/src/dev/seedData';
import { clearAllBlocks, getAllBlocksByDay, getBlocksForDay, insertBlock } from '@/src/storage/blocksDb';
import type { Block as TimeBlock, BlockRepeatRule, Lane } from '@/src/types/blocks';
import { dayKeyToLocalDate, getLocalDayKey, shiftDayKey } from '@/src/utils/dayKey';
import { isExcludedFromExecutionMetrics } from '@/src/utils/executionScore';
import { normalizeRepeatRule } from '@/src/utils/recurrence';
import { formatDuration, formatMinutesAmPm, parseTimeText } from '@/src/utils/time';

const CATEGORY_COLORS = [
  '#3B82F6',
  '#22C55E',
  '#8B5CF6',
  '#EC4899',
  '#EF4444',
  '#F59E0B',
  '#EAB308',
  '#F97316',
  '#06B6D4',
  '#14B8A6',
  '#0EA5A4',
  '#10B981',
  '#84CC16',
  '#6366F1',
  '#A855F7',
  '#D946EF',
  '#0F766E',
  '#1D4ED8',
  '#7C3AED',
  '#B91C1C',
  '#475569',
  '#94A3B8',
];
const SHEET_VISIBLE_HEIGHT = '86%';
const CALENDAR_WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type CalendarDayCell = {
  key: string;
  dayKey: string | null;
  date: Date | null;
  inCurrentMonth: boolean;
};

type CopyPlanCalendarFocus = 'source' | 'target';

type ParsedSummaryBlock = {
  lane: Lane;
  title: string;
  tags: string[];
  startMin: number;
  endMin: number;
};

const FULL_BACKUP_SCHEMA = 'plan-vs-actual.backup.v1';
const PROTECTED_CATEGORIES: AppSettings['categories'] = [
  { id: 'break', label: 'Break', color: '#F59E0B' },
  { id: 'other', label: 'None', color: '#9CA3AF' },
];

type ImportedBackupBlock = {
  id: string;
  lane: Lane;
  title: string;
  tags: string[];
  startMin: number;
  endMin: number;
  linkedPlannedId?: string | null;
  recurrenceId?: string | null;
  recurrenceIndex?: number | null;
  repeatRule?: BlockRepeatRule | null;
};

type FullBackupPayload = {
  schema: typeof FULL_BACKUP_SCHEMA;
  exportedAt: string;
  settings: AppSettings;
  blocksByDay: Record<string, TimeBlock[]>;
};

type ParsedFullBackupInput = {
  settings: AppSettings;
  blocksByDay: Record<string, ImportedBackupBlock[]>;
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

function parseRoundedMinute(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(24 * 60, Math.round(parsed / 15) * 15));
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value !== 'boolean') {
    return fallback;
  }

  return value;
}

function ensureProtectedCategories(categories: AppSettings['categories']): AppSettings['categories'] {
  const protectedById = new Map(PROTECTED_CATEGORIES.map((category) => [category.id, category]));
  const normalized = categories.map((item) => {
    const protectedCategory = protectedById.get(item.id);
    if (!protectedCategory) {
      return item;
    }

    return { ...item, label: protectedCategory.label, color: protectedCategory.color };
  });
  const existingIds = new Set(normalized.map((item) => item.id));

  for (const protectedCategory of PROTECTED_CATEGORIES) {
    if (!existingIds.has(protectedCategory.id)) {
      normalized.push({ ...protectedCategory });
    }
  }

  return normalized;
}

function parseImportedSettings(raw: unknown, fallback: AppSettings): AppSettings | null {
  if (!isRecord(raw)) {
    return null;
  }

  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
  const categoryIds = new Set<string>();
  const parsedCategories = rawCategories
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const id = normalizeCategoryId(String(item.id ?? item.label ?? ''));
      const label = String(item.label ?? '').trim();
      const color = normalizeHexColor(String(item.color ?? ''));
      if (!id || !label || !color || categoryIds.has(id)) {
        return null;
      }
      categoryIds.add(id);
      return { id, label, color };
    })
    .filter((item): item is { id: string; label: string; color: string } => item !== null);
  const categories = ensureProtectedCategories(parsedCategories.length > 0 ? parsedCategories : fallback.categories);

  const allowedVisibleCategoryIds = new Set(categories.map((category) => category.id));
  const visibleCategoryIdsRaw = Array.isArray(raw.visibleCategoryIds) ? raw.visibleCategoryIds : fallback.visibleCategoryIds;
  const visibleCategoryIds = visibleCategoryIdsRaw
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter(
      (id, index, self) => id.length > 0 && self.indexOf(id) === index && allowedVisibleCategoryIds.has(id)
    );

  return {
    plannedScanStartMin: parseRoundedMinute(raw.plannedScanStartMin, fallback.plannedScanStartMin),
    actualScanStartMin: parseRoundedMinute(raw.actualScanStartMin, fallback.actualScanStartMin),
    dimInsteadOfHide: parseBoolean(raw.dimInsteadOfHide, fallback.dimInsteadOfHide),
    debugMode: parseBoolean(raw.debugMode, fallback.debugMode),
    categories,
    visibleCategoryIds: visibleCategoryIds.length > 0 ? visibleCategoryIds : categories.map((category) => category.id),
  };
}

function parseImportedRepeatRule(rawRule: unknown, dayKey: string): BlockRepeatRule | null {
  if (!isRecord(rawRule)) {
    return null;
  }

  const presetRaw = rawRule.preset;
  const preset =
    presetRaw === 'none' ||
    presetRaw === 'daily' ||
    presetRaw === 'weekdays' ||
    presetRaw === 'weekly' ||
    presetRaw === 'monthly' ||
    presetRaw === 'yearly'
      ? presetRaw
      : 'none';

  return normalizeRepeatRule(
    {
      preset,
      interval: Number(rawRule.interval ?? 1),
      weekDays: Array.isArray(rawRule.weekDays)
        ? rawRule.weekDays.map((value) => Number(value)).filter((value) => Number.isInteger(value))
        : [],
      monthlyMode: rawRule.monthlyMode === 'ordinalWeekday' ? 'ordinalWeekday' : 'dayOfMonth',
      endMode: rawRule.endMode === 'never' ? 'never' : rawRule.endMode === 'afterCount' ? 'afterCount' : 'onDate',
      endDayKey: typeof rawRule.endDayKey === 'string' ? rawRule.endDayKey : dayKey,
      occurrenceCount: Number(rawRule.occurrenceCount ?? 10),
    },
    dayKey
  );
}

function parseImportedBackupBlock(raw: unknown, fallbackId: string, dayKey: string): ImportedBackupBlock | null {
  if (!isRecord(raw)) {
    return null;
  }

  const lane = raw.lane === 'planned' || raw.lane === 'actual' ? raw.lane : null;
  if (!lane) {
    return null;
  }

  const startMin = Math.round(Number(raw.startMin));
  const endMin = Math.round(Number(raw.endMin));
  if (
    !Number.isFinite(startMin) ||
    !Number.isFinite(endMin) ||
    startMin < 0 ||
    endMin > 24 * 60 ||
    endMin <= startMin
  ) {
    return null;
  }

  const title = String(raw.title ?? '').trim() || 'Untitled';
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((item) => String(item ?? '').trim()).filter((tag) => tag.length > 0)
    : [];
  const linkedPlannedId =
    lane === 'actual' && typeof raw.linkedPlannedId === 'string' && raw.linkedPlannedId.trim().length > 0
      ? raw.linkedPlannedId.trim()
      : null;
  const recurrenceId =
    typeof raw.recurrenceId === 'string' && raw.recurrenceId.trim().length > 0 ? raw.recurrenceId.trim() : null;
  const rawRecurrenceIndex = Number(raw.recurrenceIndex);
  const recurrenceIndex =
    recurrenceId && Number.isInteger(rawRecurrenceIndex) && rawRecurrenceIndex >= 1
      ? rawRecurrenceIndex
      : null;
  const repeatRule = recurrenceId ? parseImportedRepeatRule(raw.repeatRule, dayKey) : null;
  const id = typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id.trim() : fallbackId;

  return {
    id,
    lane,
    title,
    tags,
    startMin,
    endMin,
    linkedPlannedId: lane === 'actual' ? linkedPlannedId : undefined,
    recurrenceId,
    recurrenceIndex,
    repeatRule,
  };
}

function parseFullBackupInput(input: string, fallbackSettings: AppSettings): ParsedFullBackupInput | null {
  try {
    const parsed = JSON.parse(input);
    if (!isRecord(parsed)) {
      return null;
    }

    if (parsed.schema !== FULL_BACKUP_SCHEMA) {
      return null;
    }

    const settings = parseImportedSettings(parsed.settings, fallbackSettings);
    if (!settings) {
      return null;
    }

    const rawBlocksByDay = parsed.blocksByDay;
    if (!isRecord(rawBlocksByDay)) {
      return null;
    }

    const blocksByDay: Record<string, ImportedBackupBlock[]> = {};
    for (const [dayKey, rawBlocks] of Object.entries(rawBlocksByDay)) {
      if (!dayKeyToLocalDate(dayKey)) {
        return null;
      }
      if (!Array.isArray(rawBlocks)) {
        return null;
      }

      const parsedBlocks: ImportedBackupBlock[] = [];
      for (let index = 0; index < rawBlocks.length; index += 1) {
        const parsedBlock = parseImportedBackupBlock(rawBlocks[index], `${dayKey}-${index + 1}`, dayKey);
        if (!parsedBlock) {
          return null;
        }
        parsedBlocks.push(parsedBlock);
      }

      blocksByDay[dayKey] = parsedBlocks;
    }

    return {
      settings,
      blocksByDay,
    };
  } catch {
    return null;
  }
}

function sortByStartMin(items: TimeBlock[]): TimeBlock[] {
  return [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id)
  );
}

function hasOverlap(
  lane: Lane,
  startMin: number,
  endMin: number,
  blocks: TimeBlock[]
): boolean {
  return blocks.some((other) => {
    if (other.lane !== lane) {
      return false;
    }

    return startMin < other.endMin && endMin > other.startMin;
  });
}

function formatBlockLine(block: TimeBlock): string {
  const tagsText = block.tags.length > 0 ? block.tags.join(', ') : 'none';
  return `${formatMinutesAmPm(block.startMin)}-${formatMinutesAmPm(block.endMin)} | ${block.title} | tags: ${tagsText}`;
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

function parseSummaryBlockLine(line: string, lane: Lane): ParsedSummaryBlock | null {
  const tagMarker = ' | tags: ';
  const tagIndex = line.lastIndexOf(tagMarker);
  if (tagIndex <= 0) {
    return null;
  }

  const left = line.slice(0, tagIndex).trim();
  const tagsRaw = line.slice(tagIndex + tagMarker.length).trim();
  const leftSeparatorIndex = left.indexOf(' | ');
  if (leftSeparatorIndex <= 0) {
    return null;
  }

  const timeRange = left.slice(0, leftSeparatorIndex).trim();
  const title = left.slice(leftSeparatorIndex + 3).trim();
  const hyphenIndex = timeRange.indexOf('-');
  if (hyphenIndex <= 0) {
    return null;
  }

  const startText = timeRange.slice(0, hyphenIndex).trim();
  const endText = timeRange.slice(hyphenIndex + 1).trim();
  const startMin = parseTimeText(startText);
  const endMin = parseTimeText(endText);
  if (startMin === null || endMin === null || endMin <= startMin) {
    return null;
  }

  const tags =
    tagsRaw.toLowerCase() === 'none'
      ? []
      : tagsRaw
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0);

  return {
    lane,
    title,
    tags: tags.length ? [tags[0]] : [],
    startMin,
    endMin,
  };
}

function parseSummaryInput(input: string): { blocks: ParsedSummaryBlock[]; invalidLines: number } {
  const lines = input.split(/\r?\n/).map((line) => line.trim());
  const blocks: ParsedSummaryBlock[] = [];
  let invalidLines = 0;
  let section: Lane | null = null;

  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line === 'Plan blocks:') {
      section = 'planned';
      continue;
    }
    if (line === 'Done blocks:') {
      section = 'actual';
      continue;
    }
    if (section === null || line === 'none') {
      continue;
    }

    const parsed = parseSummaryBlockLine(line, section);
    if (!parsed) {
      invalidLines += 1;
      continue;
    }
    blocks.push(parsed);
  }

  return { blocks, invalidLines };
}

function getBlockIdentityKey(input: { lane: Lane; title: string; startMin: number; endMin: number }): string {
  return `${input.lane}|${input.startMin}|${input.endMin}|${input.title.trim().toLowerCase()}`;
}

function getPlanLinkKey(input: { title: string; startMin: number; endMin: number }): string {
  return `${input.startMin}|${input.endMin}|${input.title.trim().toLowerCase()}`;
}

function normalizeCategoryId(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return normalized || 'category';
}

function normalizeHexColor(input: string): string | null {
  const normalized = input.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function shiftMonth(monthStart: Date, delta: number): Date {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + delta, 1);
}

function buildCalendarDayCells(monthStart: Date): CalendarDayCell[] {
  const start = getMonthStart(monthStart);
  const firstWeekday = start.getDay();
  const dayCount = getDaysInMonth(start);
  const totalCells = Math.ceil((firstWeekday + dayCount) / 7) * 7;
  const cells: CalendarDayCell[] = [];

  for (let i = 0; i < totalCells; i += 1) {
    const dayOfMonth = i - firstWeekday + 1;
    const inCurrentMonth = dayOfMonth >= 1 && dayOfMonth <= dayCount;
    const date = inCurrentMonth ? new Date(start.getFullYear(), start.getMonth(), dayOfMonth) : null;
    cells.push({
      key: `${start.getFullYear()}-${start.getMonth() + 1}-${i}`,
      dayKey: date ? getLocalDayKey(date) : null,
      date,
      inCurrentMonth,
    });
  }

  return cells;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { dayKey: dayKeyParam } = useLocalSearchParams<{
    dayKey?: string | string[];
  }>();
  const routeDayKeyRaw = Array.isArray(dayKeyParam) ? dayKeyParam[0] : dayKeyParam;
  const routeDayKey = routeDayKeyRaw && dayKeyToLocalDate(routeDayKeyRaw) ? routeDayKeyRaw : null;
  const timelineDayKey = routeDayKey ?? getLocalDayKey();
  const { settings, updateSettings, resetCategoriesToDefault, resetAllData, signalDataChanged, dataVersion } =
    useAppSettings();
  const [saving, setSaving] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryColor, setCategoryColor] = useState(CATEGORY_COLORS[0]);
  const [showAddCustomColorInput, setShowAddCustomColorInput] = useState(false);
  const [customAddColorInput, setCustomAddColorInput] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [editingCategoryColor, setEditingCategoryColor] = useState(CATEGORY_COLORS[0]);
  const [showEditCustomColorInput, setShowEditCustomColorInput] = useState(false);
  const [customEditColorInput, setCustomEditColorInput] = useState('');
  const [activeLegalDocKey, setActiveLegalDocKey] = useState<LegalDocumentKey | null>(null);
  const [importDataVisible, setImportDataVisible] = useState(false);
  const [importDataText, setImportDataText] = useState('');
  const [copyPlanFromDayVisible, setCopyPlanFromDayVisible] = useState(false);
  const [copyPlanTargetDayKey, setCopyPlanTargetDayKey] = useState(timelineDayKey);
  const [copyPlanSourceDayKey, setCopyPlanSourceDayKey] = useState(() => shiftDayKey(timelineDayKey, -1));
  const [copyPlanCalendarFocus, setCopyPlanCalendarFocus] = useState<CopyPlanCalendarFocus>('source');
  const [copyPlanCalendarMonthStart, setCopyPlanCalendarMonthStart] = useState(() => {
    const initialSourceDate = dayKeyToLocalDate(shiftDayKey(timelineDayKey, -1)) ?? new Date();
    return getMonthStart(initialSourceDate);
  });
  const [timelineBlocks, setTimelineBlocks] = useState<TimeBlock[]>([]);

  const activeLegalDoc = LEGAL_DOCUMENTS.find((document) => document.key === activeLegalDocKey) ?? null;
  const timelineDateLabel = useMemo(() => {
    const date = dayKeyToLocalDate(timelineDayKey);
    if (!date) {
      return timelineDayKey;
    }

    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }, [timelineDayKey]);
  const todayDayKey = getLocalDayKey();
  const copySourceDateLabel = useMemo(() => {
    const sourceDate = dayKeyToLocalDate(copyPlanSourceDayKey);
    if (!sourceDate) {
      return copyPlanSourceDayKey;
    }

    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(sourceDate);
  }, [copyPlanSourceDayKey]);
  const copyTargetDateLabel = useMemo(() => {
    const targetDate = dayKeyToLocalDate(copyPlanTargetDayKey);
    if (!targetDate) {
      return copyPlanTargetDayKey;
    }

    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(targetDate);
  }, [copyPlanTargetDayKey]);
  const copyCalendarMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      }).format(copyPlanCalendarMonthStart),
    [copyPlanCalendarMonthStart]
  );
  const copyPlanCalendarCells = useMemo(
    () => buildCalendarDayCells(copyPlanCalendarMonthStart),
    [copyPlanCalendarMonthStart]
  );
  const timelineTagTotals = useMemo(
    () => buildTagTotals(timelineBlocks.filter((block) => !isExcludedFromExecutionMetrics(block))),
    [timelineBlocks]
  );
  const visibleCategoryIdSet = useMemo(
    () => new Set(settings.visibleCategoryIds.map((id) => id.toLowerCase())),
    [settings.visibleCategoryIds]
  );
  const usedCategoryColorSet = useMemo(
    () => new Set(settings.categories.map((category) => category.color.trim().toUpperCase())),
    [settings.categories]
  );
  const allCategoryColors = useMemo(() => {
    const all = [...CATEGORY_COLORS, ...settings.categories.map((category) => category.color)];
    return all.filter((color, index, self) => self.indexOf(color) === index);
  }, [settings.categories]);
  const addColorOptions = useMemo(
    () =>
      allCategoryColors.filter((color) => {
        const normalized = color.trim().toUpperCase();
        return !usedCategoryColorSet.has(normalized) || normalized === categoryColor.trim().toUpperCase();
      }),
    [allCategoryColors, categoryColor, usedCategoryColorSet]
  );
  const editingCategoryColorSetExcludingCurrent = useMemo(() => {
    if (!editingCategoryId) {
      return new Set<string>();
    }

    return new Set(
      settings.categories
        .filter((category) => category.id !== editingCategoryId)
        .map((category) => category.color.trim().toUpperCase())
    );
  }, [editingCategoryId, settings.categories]);
  const editColorOptions = useMemo(
    () =>
      allCategoryColors.filter((color) => {
        const normalized = color.trim().toUpperCase();
        return (
          !editingCategoryColorSetExcludingCurrent.has(normalized) ||
          normalized === editingCategoryColor.trim().toUpperCase()
        );
      }),
    [allCategoryColors, editingCategoryColor, editingCategoryColorSetExcludingCurrent]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const blocks = await getBlocksForDay(timelineDayKey);
      if (!cancelled) {
        setTimelineBlocks(sortByStartMin(blocks));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataVersion, timelineDayKey]);

  useEffect(() => {
    if (!copyPlanFromDayVisible) {
      const fallbackTargetDayKey = timelineDayKey;
      const fallbackSourceDayKey = shiftDayKey(timelineDayKey, -1);
      const fallbackSourceDate = dayKeyToLocalDate(fallbackSourceDayKey);
      setCopyPlanTargetDayKey(fallbackTargetDayKey);
      setCopyPlanSourceDayKey(fallbackSourceDayKey);
      setCopyPlanCalendarFocus('source');
      if (fallbackSourceDate) {
        setCopyPlanCalendarMonthStart(getMonthStart(fallbackSourceDate));
      }
    }
  }, [copyPlanFromDayVisible, timelineDayKey]);

  useEffect(() => {
    if (addColorOptions.length === 0) {
      return;
    }

    const hasSelected = addColorOptions.some(
      (color) => color.trim().toUpperCase() === categoryColor.trim().toUpperCase()
    );
    if (!hasSelected) {
      setCategoryColor(addColorOptions[0]);
    }
  }, [addColorOptions, categoryColor]);

  useEffect(() => {
    if (editColorOptions.length === 0) {
      return;
    }

    const hasSelected = editColorOptions.some(
      (color) => color.trim().toUpperCase() === editingCategoryColor.trim().toUpperCase()
    );
    if (!hasSelected) {
      setEditingCategoryColor(editColorOptions[0]);
    }
  }, [editColorOptions, editingCategoryColor]);

  const addCategory = async () => {
    const label = categoryName.trim();

    if (!label) {
      Alert.alert('Missing name', 'Enter a category name.');
      return;
    }

    const id = normalizeCategoryId(label);

    if (settings.categories.some((item) => item.id === id)) {
      Alert.alert('Duplicate category', 'A category with this name already exists.');
      return;
    }

    setSaving(true);
    try {
      await updateSettings({
        categories: [...settings.categories, { id, label, color: categoryColor }],
      });
      setCategoryName('');
      setShowAddCustomColorInput(false);
      setCustomAddColorInput('');
    } catch {
      Alert.alert('Settings error', 'Could not add category.');
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = async (id: string) => {
    if (id === 'other' || id === 'break') {
      Alert.alert('Protected category', 'The None and Break categories cannot be deleted.');
      return;
    }

    if (settings.categories.length <= 1) {
      Alert.alert('At least one category', 'Keep at least one category.');
      return;
    }

    setSaving(true);
    try {
      await updateSettings({ categories: settings.categories.filter((item) => item.id !== id) });
    } catch {
      Alert.alert('Settings error', 'Could not remove category.');
    } finally {
      setSaving(false);
    }
  };

  const openCategoryEditor = (id: string) => {
    const category = settings.categories.find((item) => item.id === id);
    if (!category) {
      return;
    }

    setEditingCategoryId(category.id);
    setEditingCategoryName(category.label);
    setEditingCategoryColor(category.color);
    setShowEditCustomColorInput(false);
    setCustomEditColorInput('');
  };

  const closeCategoryEditor = () => {
    setEditingCategoryId(null);
    setEditingCategoryName('');
    setEditingCategoryColor(CATEGORY_COLORS[0]);
    setShowEditCustomColorInput(false);
    setCustomEditColorInput('');
  };

  const applyAddCustomColor = () => {
    const normalized = normalizeHexColor(customAddColorInput);
    if (!normalized) {
      Alert.alert('Invalid color', 'Enter a valid hex color like #22C55E.');
      return;
    }

    if (usedCategoryColorSet.has(normalized)) {
      Alert.alert('Color in use', 'That color is already used by another category.');
      return;
    }

    setCategoryColor(normalized);
    setCustomAddColorInput('');
    setShowAddCustomColorInput(false);
  };

  const applyEditCustomColor = () => {
    if (!editingCategoryId) {
      return;
    }

    const normalized = normalizeHexColor(customEditColorInput);
    if (!normalized) {
      Alert.alert('Invalid color', 'Enter a valid hex color like #22C55E.');
      return;
    }

    if (editingCategoryColorSetExcludingCurrent.has(normalized)) {
      Alert.alert('Color in use', 'That color is already used by another category.');
      return;
    }

    setEditingCategoryColor(normalized);
    setCustomEditColorInput('');
    setShowEditCustomColorInput(false);
  };

  const saveCategoryEditor = async () => {
    if (!editingCategoryId) {
      return;
    }

    const label = editingCategoryName.trim();
    if (!label) {
      Alert.alert('Missing name', 'Enter a category name.');
      return;
    }

    setSaving(true);
    try {
      await updateSettings({
        categories: settings.categories.map((item) =>
          item.id === editingCategoryId ? { ...item, label, color: editingCategoryColor } : item
        ),
      });
      closeCategoryEditor();
    } catch {
      Alert.alert('Settings error', 'Could not update category.');
    } finally {
      setSaving(false);
    }
  };

  const toggleCategoryVisibility = async (categoryId: string) => {
    const normalizedId = categoryId.trim().toLowerCase();
    const currentlyVisible = settings.visibleCategoryIds.map((id) => id.toLowerCase());
    const isVisible = currentlyVisible.includes(normalizedId);
    const nextVisible = isVisible
      ? currentlyVisible.filter((id) => id !== normalizedId)
      : [...currentlyVisible, normalizedId];

    if (nextVisible.length === 0) {
      Alert.alert('Keep one visible', 'Select at least one category to keep timeline blocks visible.');
      return;
    }

    setSaving(true);
    try {
      await updateSettings({ visibleCategoryIds: nextVisible });
    } catch {
      Alert.alert('Settings error', 'Could not update timeline visibility filters.');
    } finally {
      setSaving(false);
    }
  };

  const confirmResetAllData = () => {
    Alert.alert(
      'Reset all data',
      'This will permanently delete all plan and done blocks on every day and reset categories to defaults. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset all data',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSaving(true);

              try {
                await resetAllData();
                Alert.alert('Data reset', 'All blocks were deleted and categories were reset.');
              } catch {
                Alert.alert('Storage error', 'Could not reset data.');
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ]
    );
  };

  const confirmResetCategoriesToDefault = () => {
    Alert.alert(
      'Reset categories to defaults',
      'This will replace your current categories and timeline category visibility filters with the defaults.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset categories',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSaving(true);
              try {
                await resetCategoriesToDefault();
                Alert.alert('Categories reset', 'Categories and visibility filters were reset to defaults.');
              } catch {
                Alert.alert('Settings error', 'Could not reset categories.');
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ]
    );
  };

  const toggleDebugMode = async (enabled: boolean) => {
    setSaving(true);
    try {
      await updateSettings({ debugMode: enabled });
    } catch {
      Alert.alert('Settings error', 'Could not update debug mode.');
    } finally {
      setSaving(false);
    }
  };

  const confirmSeedData = (days: number) => {
    Alert.alert(
      'Generate sample data',
      `This clears all current blocks and generates sample plan/done data for the last ${days} days, including today.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: () => {
            void (async () => {
              setSaving(true);
              try {
                await resetAllData();
                await seedLastNDays(days);
                signalDataChanged();
                Alert.alert('Sample data ready', `Generated sample data for ${days} days.`);
              } catch {
                Alert.alert('Storage error', 'Could not generate sample data.');
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ]
    );
  };

  const exportAllData = useCallback(() => {
    void (async () => {
      setSaving(true);
      try {
        const blocksByDay = await getAllBlocksByDay();
        const payload: FullBackupPayload = {
          schema: FULL_BACKUP_SCHEMA,
          exportedAt: new Date().toISOString(),
          settings,
          blocksByDay,
        };

        await Share.share({
          message: JSON.stringify(payload, null, 2),
          title: 'Plan vs Actual Full Backup',
        });
      } catch {
        Alert.alert('Export error', 'Could not export all data.');
      } finally {
        setSaving(false);
      }
    })();
  }, [settings]);

  const exportTimelineDayData = useCallback(() => {
    const metricBlocks = timelineBlocks.filter((block) => !isExcludedFromExecutionMetrics(block));
    const plannedBlocks = sortByStartMin(metricBlocks.filter((block) => block.lane === 'planned'));
    const actualBlocks = sortByStartMin(metricBlocks.filter((block) => block.lane === 'actual'));
    const plannedTotal = plannedBlocks.reduce((total, block) => total + Math.max(0, block.endMin - block.startMin), 0);
    const doneTotal = actualBlocks.reduce((total, block) => total + Math.max(0, block.endMin - block.startMin), 0);
    const tagLines = timelineTagTotals.length
      ? timelineTagTotals
          .map(
            (row) =>
              `${row.tag}: plan ${formatDuration(row.plannedMin)}, done ${formatDuration(
                row.actualMin
              )}, delta ${row.deltaMin >= 0 ? '+' : '-'}${formatDuration(row.deltaMin)}`
          )
          .join('\n')
      : 'none';
    const plannedLines = plannedBlocks.length ? plannedBlocks.map(formatBlockLine).join('\n') : 'none';
    const actualLines = actualBlocks.length ? actualBlocks.map(formatBlockLine).join('\n') : 'none';
    const summary = [
      `Date: ${timelineDateLabel}`,
      `Plan total: ${formatDuration(plannedTotal)}`,
      `Done total: ${formatDuration(doneTotal)}`,
      `Delta: ${doneTotal - plannedTotal >= 0 ? '+' : '-'}${formatDuration(doneTotal - plannedTotal)}`,
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
      title: `Day data ${timelineDayKey}`,
    });
  }, [timelineBlocks, timelineDateLabel, timelineDayKey, timelineTagTotals]);

  const importData = useCallback(() => {
    const input = importDataText.trim();
    if (!input) {
      Alert.alert('Nothing to import', `Paste backup JSON or text from "Export Today's data."`);
      return;
    }

    const parsedBackup = parseFullBackupInput(input, settings);
    if (parsedBackup) {
      Alert.alert(
        'Import all data',
        'Detected full backup JSON. This replaces all current blocks and settings with the backup data. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import all data',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setSaving(true);
                try {
                  await clearAllBlocks();
                  await updateSettings(parsedBackup.settings);

                  const sortedDayKeys = Object.keys(parsedBackup.blocksByDay).sort((a, b) => a.localeCompare(b));
                  const plannedIdMap = new Map<string, string>();
                  let importedCount = 0;

                  for (const dayKey of sortedDayKeys) {
                    const blocks = parsedBackup.blocksByDay[dayKey] ?? [];
                    const plannedBlocks = sortByStartMin(blocks.filter((block) => block.lane === 'planned'));
                    for (const block of plannedBlocks) {
                      const inserted = await insertBlock(
                        {
                          lane: 'planned',
                          title: block.title,
                          tags: [...block.tags],
                          startMin: block.startMin,
                          endMin: block.endMin,
                          recurrenceId: block.recurrenceId ?? null,
                          recurrenceIndex: block.recurrenceIndex ?? null,
                          repeatRule: block.recurrenceId ? block.repeatRule ?? null : null,
                        },
                        dayKey
                      );
                      plannedIdMap.set(block.id, inserted.id);
                      importedCount += 1;
                    }
                  }

                  for (const dayKey of sortedDayKeys) {
                    const blocks = parsedBackup.blocksByDay[dayKey] ?? [];
                    const actualBlocks = sortByStartMin(blocks.filter((block) => block.lane === 'actual'));
                    for (const block of actualBlocks) {
                      const linkedPlannedId = block.linkedPlannedId ? plannedIdMap.get(block.linkedPlannedId) ?? null : null;
                      await insertBlock(
                        {
                          lane: 'actual',
                          title: block.title,
                          tags: [...block.tags],
                          startMin: block.startMin,
                          endMin: block.endMin,
                          linkedPlannedId,
                          recurrenceId: block.recurrenceId ?? null,
                          recurrenceIndex: block.recurrenceIndex ?? null,
                          repeatRule: block.recurrenceId ? block.repeatRule ?? null : null,
                        },
                        dayKey
                      );
                      importedCount += 1;
                    }
                  }

                  signalDataChanged();
                  setImportDataVisible(false);
                  setImportDataText('');
                  Alert.alert('Import complete', `Imported ${importedCount} blocks across ${sortedDayKeys.length} days.`);
                } catch {
                  signalDataChanged();
                  Alert.alert('Import error', 'Could not import all data.');
                } finally {
                  setSaving(false);
                }
              })();
            },
          },
        ]
      );
      return;
    }

    const parsedSummary = parseSummaryInput(input);
    if (parsedSummary.blocks.length === 0) {
      Alert.alert('Unsupported import', `Paste backup JSON from "Export all data" or text from "Export Today's data."`);
      return;
    }

    void (async () => {
      setSaving(true);
      try {
        const existingBlocks = sortByStartMin(await getBlocksForDay(timelineDayKey));
        const workingBlocks = [...existingBlocks];
        const existingIdentity = new Set(
          existingBlocks.map((block) =>
            getBlockIdentityKey({
              lane: block.lane,
              title: block.title,
              startMin: block.startMin,
              endMin: block.endMin,
            })
          )
        );
        const planLinkByKey = new Map<string, string>();
        existingBlocks.forEach((block) => {
          if (block.lane === 'planned') {
            planLinkByKey.set(
              getPlanLinkKey({ title: block.title, startMin: block.startMin, endMin: block.endMin }),
              block.id
            );
          }
        });

        let created = 0;
        let skippedOverlap = 0;
        let skippedDuplicate = 0;
        const plannedFirst = [
          ...parsedSummary.blocks.filter((block) => block.lane === 'planned'),
          ...parsedSummary.blocks.filter((block) => block.lane === 'actual'),
        ];

        for (const block of plannedFirst) {
          const identityKey = getBlockIdentityKey(block);
          if (existingIdentity.has(identityKey)) {
            skippedDuplicate += 1;
            continue;
          }

          if (hasOverlap(block.lane, block.startMin, block.endMin, workingBlocks)) {
            skippedOverlap += 1;
            continue;
          }

          const linkedPlannedId =
            block.lane === 'actual'
              ? planLinkByKey.get(
                  getPlanLinkKey({ title: block.title, startMin: block.startMin, endMin: block.endMin })
                ) ?? null
              : null;

          const inserted = await insertBlock(
            {
              lane: block.lane,
              title: block.title,
              tags: block.tags,
              startMin: block.startMin,
              endMin: block.endMin,
              linkedPlannedId: block.lane === 'actual' ? linkedPlannedId : undefined,
            },
            timelineDayKey
          );
          workingBlocks.push(inserted);
          existingIdentity.add(identityKey);
          if (inserted.lane === 'planned') {
            planLinkByKey.set(
              getPlanLinkKey({ title: inserted.title, startMin: inserted.startMin, endMin: inserted.endMin }),
              inserted.id
            );
          }
          created += 1;
        }

        signalDataChanged();
        setImportDataVisible(false);
        setImportDataText('');
        Alert.alert(
          'Import complete',
          `Created ${created}, skipped duplicates ${skippedDuplicate}, skipped overlaps ${skippedOverlap}, invalid lines ${parsedSummary.invalidLines}.`
        );
      } catch {
        Alert.alert('Import error', "Could not import Today's data.");
      } finally {
        setSaving(false);
      }
    })();
  }, [importDataText, settings, signalDataChanged, timelineDayKey, updateSettings]);

  const openCopyPlanFromPastDay = useCallback(() => {
    const fallbackTargetDayKey = timelineDayKey;
    const fallbackSourceDayKey = shiftDayKey(timelineDayKey, -1);
    const fallbackSourceDate = dayKeyToLocalDate(fallbackSourceDayKey);
    setCopyPlanTargetDayKey(fallbackTargetDayKey);
    setCopyPlanSourceDayKey(fallbackSourceDayKey);
    setCopyPlanCalendarFocus('source');
    if (fallbackSourceDate) {
      setCopyPlanCalendarMonthStart(getMonthStart(fallbackSourceDate));
    }
    setCopyPlanFromDayVisible(true);
  }, [timelineDayKey]);

  const focusCopyPlanCalendarField = useCallback(
    (field: CopyPlanCalendarFocus) => {
      setCopyPlanCalendarFocus(field);
      const focusDate = dayKeyToLocalDate(field === 'source' ? copyPlanSourceDayKey : copyPlanTargetDayKey);
      if (focusDate) {
        setCopyPlanCalendarMonthStart(getMonthStart(focusDate));
      }
    },
    [copyPlanSourceDayKey, copyPlanTargetDayKey]
  );

  const handleCopyPlanCalendarSelectDay = useCallback(
    (selectedDayKey: string) => {
      if (copyPlanCalendarFocus === 'source') {
        setCopyPlanSourceDayKey(selectedDayKey);
        if (selectedDayKey >= copyPlanTargetDayKey) {
          setCopyPlanTargetDayKey(shiftDayKey(selectedDayKey, 1));
        }
        return;
      }

      setCopyPlanTargetDayKey(selectedDayKey);
      if (selectedDayKey <= copyPlanSourceDayKey) {
        setCopyPlanSourceDayKey(shiftDayKey(selectedDayKey, -1));
      }
    },
    [copyPlanCalendarFocus, copyPlanSourceDayKey, copyPlanTargetDayKey]
  );

  const copyPlanFromSpecificDay = useCallback(() => {
    const sourceDayKey = copyPlanSourceDayKey.trim();
    const targetDayKey = copyPlanTargetDayKey.trim();
    if (!dayKeyToLocalDate(sourceDayKey)) {
      Alert.alert('Invalid date', 'Select a valid source day.');
      return;
    }
    if (!dayKeyToLocalDate(targetDayKey)) {
      Alert.alert('Invalid date', 'Select a valid target day.');
      return;
    }
    if (sourceDayKey >= targetDayKey) {
      Alert.alert('Choose a past day', 'Source day must be before the target day.');
      return;
    }

    void (async () => {
      try {
        const [sourceBlocks, targetBlocks] = await Promise.all([
          getBlocksForDay(sourceDayKey),
          getBlocksForDay(targetDayKey),
        ]);
        const sourcePlanned = sortByStartMin(sourceBlocks.filter((block) => block.lane === 'planned'));
        if (sourcePlanned.length === 0) {
          Alert.alert('Nothing to copy', 'No plan blocks found on the selected source day.');
          return;
        }
        const targetPlanned = sortByStartMin(targetBlocks.filter((block) => block.lane === 'planned'));
        let created = 0;
        let skipped = 0;

        for (const plannedBlock of sourcePlanned) {
          if (hasOverlap('planned', plannedBlock.startMin, plannedBlock.endMin, targetPlanned)) {
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
            targetDayKey
          );
          targetPlanned.push(inserted);
          created += 1;
        }

        signalDataChanged();
        setCopyPlanFromDayVisible(false);
        if (created === 0) {
          Alert.alert('Nothing copied', `All ${skipped} source blocks overlap existing plan blocks.`);
          return;
        }

        Alert.alert('Copy complete', `Created ${created}, skipped ${skipped}.`);
      } catch {
        signalDataChanged();
        Alert.alert('Storage error', 'Could not copy plan blocks from source day.');
      }
    })();
  }, [copyPlanSourceDayKey, copyPlanTargetDayKey, signalDataChanged]);

  const openSupportEmail = () => {
    void (async () => {
      const subject = encodeURIComponent('Plan vs Actual Support');
      const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}`;

      try {
        const supported = await Linking.canOpenURL(url);
        if (!supported) {
          Alert.alert('Email unavailable', `Please contact us at ${SUPPORT_EMAIL}.`);
          return;
        }

        await Linking.openURL(url);
      } catch {
        Alert.alert('Email unavailable', `Please contact us at ${SUPPORT_EMAIL}.`);
      }
    })();
  };

  const openPublicUrl = (url: string | null) => {
    if (!url) {
      Alert.alert(
        'Public URL not configured',
        'Set a public URL for this document before App Store submission.'
      );
      return;
    }

    void (async () => {
      try {
        const supported = await Linking.canOpenURL(url);
        if (!supported) {
          Alert.alert('Cannot open link', 'Please verify the URL configuration.');
          return;
        }

        await Linking.openURL(url);
      } catch {
        Alert.alert('Cannot open link', 'Please verify the URL configuration.');
      }
    })();
  };

  return (
    <View style={styles.modalRoot}>
      <Pressable accessibilityLabel="Close settings" style={styles.backdrop} onPress={() => router.back()} />
      <View style={styles.keyboardLift}>
        <View style={styles.sheetCard}>
          <View style={styles.sheetGrabber} />
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Settings</Text>
            <Pressable accessibilityLabel="Close settings" style={styles.sheetCloseButton} onPress={() => router.back()}>
              <Ionicons name="close" size={20} color={UI_COLORS.neutralText} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScrollBeginDrag={() => Keyboard.dismiss()}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <View style={styles.listGroup}>
              {settings.categories.map((category) => (
                <Pressable
                  key={category.id}
                  style={[styles.listRow, styles.categoryRow]}
                  onPress={() => openCategoryEditor(category.id)}
                  accessibilityLabel={`Edit ${category.label} category`}>
                  <View style={styles.categoryMain}>
                    <Pressable
                      accessibilityLabel={`${visibleCategoryIdSet.has(category.id) ? 'Hide' : 'Show'} ${category.label} on timeline`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: visibleCategoryIdSet.has(category.id) }}
                      style={styles.categoryVisibilityToggle}
                      onPress={() => void toggleCategoryVisibility(category.id)}>
                      <Ionicons
                        name={visibleCategoryIdSet.has(category.id) ? 'checkbox' : 'square-outline'}
                        size={17}
                        color={visibleCategoryIdSet.has(category.id) ? category.color : UI_COLORS.neutralTextSoft}
                      />
                    </Pressable>
                    <View style={[styles.colorDot, { backgroundColor: category.color }]} />
                    <Text style={styles.categoryName}>{category.label}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={UI_COLORS.neutralTextSoft} />
                </Pressable>
              ))}
            </View>
            <View style={styles.addCategoryForm}>
              <TextInput
                value={categoryName}
                onChangeText={setCategoryName}
                style={styles.categoryInput}
                placeholder="New category name"
                placeholderTextColor="#94A3B8"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorRow}>
                {addColorOptions.map((color) => {
                  const selected = color === categoryColor;
                  return (
                    <Pressable
                      key={`new-${color}`}
                      accessibilityLabel={`Choose ${color} for new category`}
                      style={[styles.colorChoice, { backgroundColor: color }, selected && styles.colorChoiceSelected]}
                      onPress={() => setCategoryColor(color)}
                    />
                  );
                })}
                <Pressable
                  accessibilityLabel="Add custom category color"
                  style={styles.customColorButton}
                  onPress={() => setShowAddCustomColorInput((value) => !value)}>
                  <Ionicons name="add" size={16} color={UI_COLORS.neutralText} />
                </Pressable>
              </ScrollView>
              {showAddCustomColorInput ? (
                <View style={styles.customColorRow}>
                  <TextInput
                    value={customAddColorInput}
                    onChangeText={setCustomAddColorInput}
                    style={styles.customColorInput}
                    placeholder="#RRGGBB"
                    autoCapitalize="characters"
                    maxLength={7}
                    placeholderTextColor="#94A3B8"
                  />
                  <Pressable style={styles.customColorApplyButton} onPress={applyAddCustomColor}>
                    <Text style={styles.customColorApplyButtonText}>Use</Text>
                  </Pressable>
                </View>
              ) : null}
              <Pressable
                accessibilityLabel="Add category"
                style={styles.addCategoryButton}
                onPress={() => void addCategory()}>
                <Text style={styles.addCategoryButtonText}>Add category</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Actions</Text>
            <Text style={styles.toggleHint}>For {timelineDateLabel}</Text>
            <Text style={styles.toggleHint}>Switching phones? Export all data on one device, then import it on the other.</Text>
            <View style={styles.timelineActionList}>
              <Pressable
                accessibilityLabel="Export all data"
                style={styles.timelineActionButton}
                onPress={exportAllData}>
                <Text style={styles.timelineActionButtonText}>Export all data</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Import data"
                style={styles.timelineActionButton}
                onPress={() => setImportDataVisible(true)}>
                <Text style={styles.timelineActionButtonText}>Import data</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Export today's data"
                style={styles.timelineActionButton}
                onPress={exportTimelineDayData}>
                <Text style={styles.timelineActionButtonText}>Export Today&apos;s data</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Copy plan blocks from a past day"
                style={styles.timelineActionButton}
                onPress={openCopyPlanFromPastDay}>
                <Text style={styles.timelineActionButtonText}>Copy Plan from Past Day</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Reset categories to defaults"
                style={styles.timelineActionButton}
                onPress={confirmResetCategoriesToDefault}
                disabled={saving}>
                <Text style={styles.timelineActionButtonText}>Reset categories to defaults</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.sectionTitle}>Debug mode</Text>
                <Text style={styles.toggleHint}>Show testing tools and data utilities.</Text>
              </View>
              <Switch
                accessibilityLabel="Toggle debug mode"
                value={settings.debugMode}
                onValueChange={(value) => void toggleDebugMode(value)}
                disabled={saving}
                trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                thumbColor={settings.debugMode ? '#1D4ED8' : '#F8FAFC'}
              />
            </View>

            {settings.debugMode ? (
              <View style={styles.debugActions}>
                <Pressable
                  accessibilityLabel="Populate calendar with sample data for 7 days"
                  style={styles.debugButton}
                  onPress={() => confirmSeedData(7)}
                  disabled={saving}>
                  <Text style={styles.debugButtonText}>Populate 7 days of dense sample data</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Populate calendar with sample data for 30 days"
                  style={styles.debugButton}
                  onPress={() => confirmSeedData(30)}
                  disabled={saving}>
                  <Text style={styles.debugButtonText}>Populate 30 days of dense sample data</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Legal & Support</Text>
            <Text style={styles.toggleHint}>Required links for App Store review.</Text>
            <View style={styles.listGroup}>
              {LEGAL_DOCUMENTS.map((document) => (
                <Pressable
                  key={document.key}
                  accessibilityLabel={`Open ${document.title}`}
                  style={[styles.listRow, styles.legalRow]}
                  onPress={() => setActiveLegalDocKey(document.key)}>
                  <View style={styles.legalRowCopy}>
                    <Text style={styles.categoryName}>{document.title}</Text>
                    <Text style={styles.legalSummary}>{document.summary}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={UI_COLORS.neutralTextSoft} />
                </Pressable>
              ))}
              <Pressable accessibilityLabel="Contact support by email" style={[styles.listRow, styles.legalRow]} onPress={openSupportEmail}>
                <View style={styles.legalRowCopy}>
                  <Text style={styles.categoryName}>Contact Email</Text>
                  <Text style={styles.legalSummary}>{SUPPORT_EMAIL}</Text>
                </View>
                <Ionicons name="mail-outline" size={16} color={UI_COLORS.neutralTextSoft} />
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <Pressable
              accessibilityLabel="Reset all data"
              style={styles.resetButton}
              onPress={confirmResetAllData}
              disabled={saving}>
              <Text style={styles.resetButtonText}>Reset all data</Text>
            </Pressable>
          </View>
          </ScrollView>
        </View>
      </View>

      <Modal transparent animationType="fade" visible={editingCategoryId !== null} onRequestClose={closeCategoryEditor}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeCategoryEditor} />
          <View style={styles.keyboardLift}>
            <View style={styles.sheetCard}>
              <View style={styles.sheetGrabber} />
              <View style={styles.sheetHeaderRow}>
                <Text style={styles.sheetTitle}>Edit Category</Text>
                <Pressable accessibilityLabel="Close category editor" style={styles.sheetCloseButton} onPress={closeCategoryEditor}>
                  <Ionicons name="close" size={20} color={UI_COLORS.neutralText} />
                </Pressable>
              </View>

              <Text style={styles.sectionTitle}>Name</Text>
              <TextInput
                value={editingCategoryName}
                onChangeText={setEditingCategoryName}
                style={styles.categoryInput}
                placeholder="Category name"
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.sectionTitle}>Color</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorRow}>
                {editColorOptions.map((color) => {
                  const selected = color === editingCategoryColor;
                  return (
                    <Pressable
                      key={`edit-${color}`}
                      accessibilityLabel={`Choose ${color}`}
                      style={[styles.colorChoice, { backgroundColor: color }, selected && styles.colorChoiceSelected]}
                      onPress={() => setEditingCategoryColor(color)}
                    />
                  );
                })}
                <Pressable
                  accessibilityLabel="Add custom category color"
                  style={styles.customColorButton}
                  onPress={() => setShowEditCustomColorInput((value) => !value)}>
                  <Ionicons name="add" size={16} color={UI_COLORS.neutralText} />
                </Pressable>
              </ScrollView>
              {showEditCustomColorInput ? (
                <View style={styles.customColorRow}>
                  <TextInput
                    value={customEditColorInput}
                    onChangeText={setCustomEditColorInput}
                    style={styles.customColorInput}
                    placeholder="#RRGGBB"
                    autoCapitalize="characters"
                    maxLength={7}
                    placeholderTextColor="#94A3B8"
                  />
                  <Pressable style={styles.customColorApplyButton} onPress={applyEditCustomColor}>
                    <Text style={styles.customColorApplyButtonText}>Use</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.editorActions}>
                <Pressable style={styles.editorSaveButton} disabled={saving} onPress={() => void saveCategoryEditor()}>
                  <Text style={styles.editorSaveButtonText}>Save</Text>
                </Pressable>
                <Pressable
                  style={styles.editorDeleteButton}
                  disabled={
                    saving || !editingCategoryId || editingCategoryId === 'other' || editingCategoryId === 'break'
                  }
                  onPress={() => {
                    if (editingCategoryId) {
                      void removeCategory(editingCategoryId);
                      closeCategoryEditor();
                    }
                  }}>
                  <Text style={styles.editorDeleteButtonText}>
                    {editingCategoryId === 'other' || editingCategoryId === 'break' ? 'Protected' : 'Delete'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={activeLegalDoc !== null}
        onRequestClose={() => setActiveLegalDocKey(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setActiveLegalDocKey(null)} />
          <View style={styles.keyboardLift}>
            <View style={styles.editorCard}>
              <View style={styles.sheetHeaderRow}>
                <Text style={styles.sheetTitle}>{activeLegalDoc?.title ?? ''}</Text>
                <Pressable
                  accessibilityLabel="Close legal document"
                  style={styles.sheetCloseButton}
                  onPress={() => setActiveLegalDocKey(null)}>
                  <Ionicons name="close" size={20} color={UI_COLORS.neutralText} />
                </Pressable>
              </View>
              <ScrollView style={styles.legalScroll} contentContainerStyle={styles.legalBody}>
                {(activeLegalDoc?.sections ?? []).map((section) => (
                  <Text key={section} style={styles.legalParagraph}>
                    {section}
                  </Text>
                ))}
              </ScrollView>
              <View style={styles.editorActions}>
                {activeLegalDoc?.publicUrl ? (
                  <Pressable
                    style={styles.editorSaveButton}
                    onPress={() => openPublicUrl(activeLegalDoc.publicUrl)}>
                    <Text style={styles.editorSaveButtonText}>Open public URL</Text>
                  </Pressable>
                ) : (
                  <View style={styles.legalPublicUrlHint}>
                    <Text style={styles.legalSummary}>Public URL not configured yet.</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={importDataVisible}
        onRequestClose={() => setImportDataVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setImportDataVisible(false)} />
          <View style={styles.keyboardLift}>
            <View style={styles.sheetCard}>
              <View style={styles.sheetGrabber} />
              <View style={styles.sheetHeaderRow}>
                <Text style={styles.sheetTitle}>Import Data</Text>
                <Pressable
                  accessibilityLabel="Close import data"
                  style={styles.sheetCloseButton}
                  onPress={() => setImportDataVisible(false)}>
                  <Ionicons name="close" size={20} color={UI_COLORS.neutralText} />
                </Pressable>
              </View>
              <Text style={styles.toggleHint}>Paste backup JSON from Export all data, or text from Export Today&apos;s data.</Text>
              <TextInput
                value={importDataText}
                onChangeText={setImportDataText}
                multiline
                textAlignVertical="top"
                style={styles.summaryImportInput}
                placeholder="Paste import text here..."
                placeholderTextColor="#94A3B8"
              />
              <View style={styles.editorActions}>
                <Pressable style={styles.editorDeleteButton} onPress={() => setImportDataVisible(false)}>
                  <Text style={styles.editorDeleteButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={styles.editorSaveButton}
                  disabled={saving}
                  onPress={importData}>
                  <Text style={styles.editorSaveButtonText}>Import</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={copyPlanFromDayVisible}
        onRequestClose={() => setCopyPlanFromDayVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setCopyPlanFromDayVisible(false)} />
          <View style={styles.keyboardLift}>
            <View style={styles.sheetCard}>
              <View style={styles.sheetGrabber} />
              <View style={styles.sheetHeaderRow}>
                <Text style={styles.sheetTitle}>Copy Plan from Past Day</Text>
                <Pressable
                  accessibilityLabel="Close copy plan dialog"
                  style={styles.sheetCloseButton}
                  onPress={() => setCopyPlanFromDayVisible(false)}>
                  <Ionicons name="close" size={20} color={UI_COLORS.neutralText} />
                </Pressable>
              </View>
              <Text style={[styles.toggleHint, styles.copyPlanHint]}>Pick source and target days, then copy.</Text>
              <View style={styles.copyPlanFieldRow}>
                <Pressable
                  accessibilityLabel="Edit source day"
                  style={[
                    styles.copyPlanFieldCard,
                    copyPlanCalendarFocus === 'source' && styles.copyPlanFieldCardActive,
                  ]}
                  onPress={() => focusCopyPlanCalendarField('source')}>
                  <Text style={styles.copyPlanFieldLabel}>Source day</Text>
                  <Text style={styles.copyPlanFieldValue}>{copySourceDateLabel}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Edit target day"
                  style={[
                    styles.copyPlanFieldCard,
                    copyPlanCalendarFocus === 'target' && styles.copyPlanFieldCardActive,
                  ]}
                  onPress={() => focusCopyPlanCalendarField('target')}>
                  <Text style={styles.copyPlanFieldLabel}>Target day</Text>
                  <Text style={styles.copyPlanFieldValue}>{copyTargetDateLabel}</Text>
                </Pressable>
              </View>
              <View style={styles.copyPlanCalendarCard}>
                <View style={styles.copyPlanMonthRow}>
                  <Pressable
                    accessibilityLabel="Show previous month"
                    style={styles.copyPlanMonthButton}
                    onPress={() => setCopyPlanCalendarMonthStart((current) => shiftMonth(current, -1))}>
                    <Ionicons name="chevron-back" size={16} color={UI_COLORS.neutralText} />
                  </Pressable>
                  <Text style={styles.copyPlanMonthLabel}>{copyCalendarMonthLabel}</Text>
                  <Pressable
                    accessibilityLabel="Show next month"
                    style={styles.copyPlanMonthButton}
                    onPress={() => setCopyPlanCalendarMonthStart((current) => shiftMonth(current, 1))}>
                    <Ionicons name="chevron-forward" size={16} color={UI_COLORS.neutralText} />
                  </Pressable>
                </View>
                <View style={styles.copyPlanWeekdayRow}>
                  {CALENDAR_WEEKDAY_LABELS.map((label, index) => (
                    <Text key={`copy-day-${index}`} style={styles.copyPlanWeekdayText}>
                      {label}
                    </Text>
                  ))}
                </View>
                <View style={styles.copyPlanGrid}>
                  {copyPlanCalendarCells.map((cell) => {
                    const cellDayKey = cell.dayKey;
                    const inCurrentMonth = cell.inCurrentMonth;
                    const selectable = inCurrentMonth && !!cellDayKey;
                    const sourceSelected = !!cellDayKey && cellDayKey === copyPlanSourceDayKey;
                    const targetSelected = !!cellDayKey && cellDayKey === copyPlanTargetDayKey;
                    const isToday = !!cellDayKey && cellDayKey === todayDayKey;

                    return (
                      <Pressable
                        key={cell.key}
                        accessibilityLabel={
                          cellDayKey
                            ? `Use ${cellDayKey} as ${copyPlanCalendarFocus === 'source' ? 'source' : 'target'} day`
                            : 'Calendar day'
                        }
                        disabled={!selectable}
                        onPress={() => {
                          if (cellDayKey && selectable) {
                            handleCopyPlanCalendarSelectDay(cellDayKey);
                          }
                        }}
                        style={styles.copyPlanDayCell}>
                        {isToday ? <View style={styles.copyPlanTodayCircle} /> : null}
                        <View
                          style={[
                            styles.copyPlanDayNumber,
                            sourceSelected && styles.copyPlanDayNumberSourceSelected,
                            targetSelected && styles.copyPlanDayNumberTargetSelected,
                          ]}>
                          <Text
                            style={[
                              styles.copyPlanDayText,
                              !inCurrentMonth && styles.copyPlanDayTextOutsideMonth,
                              !selectable && styles.copyPlanDayTextDisabled,
                            ]}>
                            {cell.date?.getDate() ?? ''}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Text style={styles.toggleHint}>Source must be before target.</Text>
              <View style={styles.editorActions}>
                <Pressable style={styles.editorSaveButton} disabled={saving} onPress={copyPlanFromSpecificDay}>
                  <Text style={styles.editorSaveButtonText}>Copy Plan</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
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
  keyboardLift: {
    flex: 1,
    justifyContent: 'flex-end',
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
  screen: {
    backgroundColor: UI_COLORS.surface,
  },
  content: {
    paddingTop: 4,
    paddingBottom: 10,
    gap: 12,
  },
  section: {
    backgroundColor: UI_COLORS.surface,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.card,
    padding: 14,
    gap: 10,
  },
  listGroup: {
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.card,
    backgroundColor: UI_COLORS.surface,
    overflow: 'hidden',
  },
  categoryRow: {
    paddingVertical: 11,
  },
  listRow: {
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI_COLORS.neutralBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryVisibilityToggle: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryName: {
    color: UI_COLORS.neutralText,
    fontSize: 14,
    fontWeight: '600',
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  colorRow: {
    gap: 8,
  },
  colorChoice: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
  },
  colorChoiceSelected: {
    borderColor: UI_COLORS.neutralText,
    borderWidth: 2,
  },
  customColorButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customColorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customColorInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: UI_COLORS.neutralText,
    backgroundColor: UI_COLORS.surface,
  },
  customColorApplyButton: {
    borderRadius: UI_RADIUS.control,
    backgroundColor: UI_COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  customColorApplyButtonText: {
    color: UI_COLORS.neutralText,
    fontSize: 12,
    fontWeight: '600',
  },
  addCategoryForm: {
    marginTop: 4,
    gap: 8,
  },
  categoryInput: {
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: UI_COLORS.neutralText,
    backgroundColor: UI_COLORS.surface,
  },
  addCategoryButton: {
    alignSelf: 'flex-start',
    borderRadius: UI_RADIUS.control,
    backgroundColor: UI_COLORS.neutralText,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  addCategoryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: UI_COLORS.neutralText,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleCopy: {
    flex: 1,
    gap: 2,
  },
  toggleHint: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '500',
  },
  debugActions: {
    marginTop: 2,
    gap: 8,
  },
  debugButton: {
    borderWidth: 1,
    borderColor: '#1D4ED8',
    borderRadius: UI_RADIUS.control,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  debugButtonText: {
    color: '#1E3A8A',
    fontSize: 13,
    fontWeight: '700',
  },
  timelineActionList: {
    gap: 8,
  },
  timelineActionButton: {
    minHeight: 40,
    borderRadius: UI_RADIUS.control,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surface,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineActionButtonText: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  resetButton: {
    borderWidth: 1,
    borderColor: '#B91C1C',
    borderRadius: UI_RADIUS.control,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
  },
  legalRow: {
    paddingVertical: 10,
  },
  legalRowCopy: {
    flex: 1,
    gap: 2,
    paddingRight: 8,
  },
  legalSummary: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '500',
  },
  legalScroll: {
    maxHeight: 280,
  },
  legalBody: {
    gap: 10,
    paddingBottom: 6,
  },
  legalParagraph: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  legalPublicUrlHint: {
    flex: 1,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    backgroundColor: UI_COLORS.surfaceMuted,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  summaryImportInput: {
    minHeight: 220,
    maxHeight: 360,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    color: UI_COLORS.neutralText,
    backgroundColor: UI_COLORS.surface,
  },
  copyPlanCalendarCard: {
    borderWidth: 1,
    borderColor: '#D4DDE8',
    borderRadius: UI_RADIUS.card,
    backgroundColor: '#F8FBFF',
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 12,
  },
  copyPlanHint: {
    marginBottom: 10,
  },
  copyPlanFieldRow: {
    flexDirection: 'row',
    gap: 8,
  },
  copyPlanFieldCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.card,
    backgroundColor: UI_COLORS.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  copyPlanFieldCardActive: {
    borderColor: '#1D4ED8',
    backgroundColor: '#EFF6FF',
  },
  copyPlanFieldLabel: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  copyPlanFieldValue: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '700',
  },
  copyPlanMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copyPlanMonthButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyPlanMonthLabel: {
    color: UI_COLORS.neutralText,
    fontSize: 14,
    fontWeight: '700',
  },
  copyPlanWeekdayRow: {
    flexDirection: 'row',
  },
  copyPlanWeekdayText: {
    flex: 1,
    textAlign: 'center',
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  copyPlanGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  copyPlanDayCell: {
    width: '14.2857%',
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  copyPlanDayNumber: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  copyPlanDayNumberSourceSelected: {
    borderWidth: 2,
    borderColor: '#FF3B30',
  },
  copyPlanDayNumberTargetSelected: {
    borderWidth: 2,
    borderColor: '#2563EB',
  },
  copyPlanDayText: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '700',
  },
  copyPlanDayTextOutsideMonth: {
    color: '#C2CBD6',
  },
  copyPlanDayTextDisabled: {
    color: UI_COLORS.neutralTextSoft,
  },
  copyPlanTodayCircle: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#FF3B30',
  },
  editorCard: {
    marginHorizontal: 16,
    borderRadius: UI_RADIUS.card,
    backgroundColor: UI_COLORS.surface,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
  },
  editorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  editorSaveButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: UI_RADIUS.control,
    backgroundColor: UI_COLORS.neutralText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorSaveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  editorDeleteButton: {
    minHeight: 42,
    borderRadius: UI_RADIUS.control,
    borderWidth: 1,
    borderColor: '#B91C1C',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorDeleteButtonText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
  },
});
