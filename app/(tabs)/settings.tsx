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
import { TAG_CATALOG } from '@/src/constants/tags';
import { UI_COLORS, UI_RADIUS, UI_TYPE, getCategoryLabel } from '@/src/constants/uiTheme';
import { useAppSettings } from '@/src/context/AppSettingsContext';
import { seedLastNDays } from '@/src/dev/seedData';
import { getBlocksForDay, insertBlock } from '@/src/storage/blocksDb';
import type { Block as TimeBlock, Lane } from '@/src/types/blocks';
import { dayKeyToLocalDate, getLocalDayKey, shiftDayKey } from '@/src/utils/dayKey';
import { formatDuration, formatHHMM, parseHHMM } from '@/src/utils/time';

const CATEGORY_COLORS = [
  '#3B82F6',
  '#8B5CF6',
  '#22C55E',
  '#0EA5A4',
  '#14B8A6',
  '#F59E0B',
  '#94A3B8',
  '#EF4444',
];
const SHEET_VISIBLE_HEIGHT = '86%';
type TagFilter = 'all' | (typeof TAG_CATALOG)[number];
type ParsedSummaryBlock = {
  lane: Lane;
  title: string;
  tags: string[];
  startMin: number;
  endMin: number;
};

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

function isExcludedFromMetrics(block: TimeBlock): boolean {
  const key = block.tags[0]?.trim().toLowerCase() || 'uncategorized';
  return key === 'other' || key === 'none';
}

function formatBlockLine(block: TimeBlock): string {
  const tagsText = block.tags.length > 0 ? block.tags.join(', ') : 'none';
  return `${formatHHMM(block.startMin)}-${formatHHMM(block.endMin)} | ${block.title} | tags: ${tagsText}`;
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

function parseTagFilterParam(input: string | string[] | undefined): TagFilter | null {
  const raw = Array.isArray(input) ? input[0] : input;
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'all') {
    return 'all';
  }

  return (TAG_CATALOG as readonly string[]).includes(normalized) ? (normalized as TagFilter) : null;
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
  const startMin = parseHHMM(startText);
  const endMin = parseHHMM(endText);
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

export default function SettingsScreen() {
  const router = useRouter();
  const { dayKey: dayKeyParam, tagFilter: tagFilterParam } = useLocalSearchParams<{
    dayKey?: string | string[];
    tagFilter?: string | string[];
  }>();
  const routeDayKeyRaw = Array.isArray(dayKeyParam) ? dayKeyParam[0] : dayKeyParam;
  const routeDayKey = routeDayKeyRaw && dayKeyToLocalDate(routeDayKeyRaw) ? routeDayKeyRaw : null;
  const timelineDayKey = routeDayKey ?? getLocalDayKey();
  const routeTagFilter = parseTagFilterParam(tagFilterParam);
  const { settings, updateSettings, resetAllData, signalDataChanged, dataVersion } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryColor, setCategoryColor] = useState(CATEGORY_COLORS[0]);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [editingCategoryColor, setEditingCategoryColor] = useState(CATEGORY_COLORS[0]);
  const [activeLegalDocKey, setActiveLegalDocKey] = useState<LegalDocumentKey | null>(null);
  const [importSummaryVisible, setImportSummaryVisible] = useState(false);
  const [importSummaryText, setImportSummaryText] = useState('');
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
  const timelineTagTotals = useMemo(
    () => buildTagTotals(timelineBlocks.filter((block) => !isExcludedFromMetrics(block))),
    [timelineBlocks]
  );
  const timelineTagFilterOptions = useMemo(() => {
    const options = new Set<TagFilter>(['all']);
    timelineTagTotals.forEach((row) => {
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
  }, [timelineTagTotals]);

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
    } catch {
      Alert.alert('Settings error', 'Could not add category.');
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = async (id: string) => {
    if (id === 'other') {
      Alert.alert('Protected category', 'The None category cannot be deleted.');
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
  };

  const closeCategoryEditor = () => {
    setEditingCategoryId(null);
    setEditingCategoryName('');
    setEditingCategoryColor(CATEGORY_COLORS[0]);
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

  const shareTimelineSummary = useCallback(() => {
    const metricBlocks = timelineBlocks.filter((block) => !isExcludedFromMetrics(block));
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
      title: `Day summary ${timelineDayKey}`,
    });
  }, [timelineBlocks, timelineDateLabel, timelineDayKey, timelineTagTotals]);

  const importTimelineSummary = useCallback(() => {
    const parsed = parseSummaryInput(importSummaryText);
    if (parsed.blocks.length === 0) {
      Alert.alert('Nothing to import', 'Paste a valid shared summary with plan and/or done blocks.');
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
          ...parsed.blocks.filter((block) => block.lane === 'planned'),
          ...parsed.blocks.filter((block) => block.lane === 'actual'),
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
        setImportSummaryVisible(false);
        setImportSummaryText('');
        Alert.alert(
          'Import complete',
          `Created ${created}, skipped duplicates ${skippedDuplicate}, skipped overlaps ${skippedOverlap}, invalid lines ${parsed.invalidLines}.`
        );
      } catch {
        Alert.alert('Import error', 'Could not import summary.');
      } finally {
        setSaving(false);
      }
    })();
  }, [importSummaryText, signalDataChanged, timelineDayKey]);

  const copyPlanToDone = useCallback(() => {
    void (async () => {
      const planned = sortByStartMin(timelineBlocks.filter((block) => block.lane === 'planned'));
      const targetActual = sortByStartMin(timelineBlocks.filter((block) => block.lane === 'actual'));
      let created = 0;
      let skipped = 0;

      try {
        for (const plannedBlock of planned) {
          if (hasOverlap('actual', plannedBlock.startMin, plannedBlock.endMin, targetActual)) {
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
            timelineDayKey
          );

          targetActual.push(inserted);
          created += 1;
        }

        signalDataChanged();
        Alert.alert('Copy complete', `Created ${created}, skipped ${skipped}.`);
      } catch {
        signalDataChanged();
        Alert.alert('Storage error', 'Could not finish copy plan to done.');
      }
    })();
  }, [signalDataChanged, timelineBlocks, timelineDayKey]);

  const isTimelineToday = timelineDayKey === getLocalDayKey();

  const copyYesterdayPlanToToday = useCallback(() => {
    if (!isTimelineToday) {
      return;
    }

    void (async () => {
      const yesterdayKey = shiftDayKey(timelineDayKey, -1);
      try {
        const yesterdayBlocks = await getBlocksForDay(yesterdayKey);
        const yesterdayPlanned = sortByStartMin(yesterdayBlocks.filter((block) => block.lane === 'planned'));
        const targetPlanned = sortByStartMin(timelineBlocks.filter((block) => block.lane === 'planned'));
        let created = 0;
        let skipped = 0;

        for (const plannedBlock of yesterdayPlanned) {
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
            timelineDayKey
          );
          targetPlanned.push(inserted);
          created += 1;
        }

        signalDataChanged();
        Alert.alert('Copy complete', `Created ${created}, skipped ${skipped}.`);
      } catch {
        signalDataChanged();
        Alert.alert('Storage error', 'Could not copy yesterday plan blocks.');
      }
    })();
  }, [isTimelineToday, signalDataChanged, timelineBlocks, timelineDayKey]);

  const applyTimelineFilter = (filter: TagFilter) => {
    router.replace({
      pathname: '/(tabs)',
      params: {
        dayKey: timelineDayKey,
        tagFilter: filter,
      },
    });
  };

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
                {CATEGORY_COLORS.map((color) => {
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
              </ScrollView>
              <Pressable
                accessibilityLabel="Add category"
                style={styles.addCategoryButton}
                onPress={() => void addCategory()}>
                <Text style={styles.addCategoryButtonText}>Add category</Text>
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
            <Text style={styles.sectionTitle}>Timeline Actions</Text>
            <Text style={styles.toggleHint}>For {timelineDateLabel}</Text>
            <View style={styles.timelineActionList}>
              <Pressable
                accessibilityLabel="Share timeline summary"
                style={styles.timelineActionButton}
                onPress={shareTimelineSummary}>
                <Text style={styles.timelineActionButtonText}>Share Summary</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Import timeline summary"
                style={styles.timelineActionButton}
                onPress={() => setImportSummaryVisible(true)}>
                <Text style={styles.timelineActionButtonText}>Import Summary</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Copy plan blocks into done lane"
                style={styles.timelineActionButton}
                onPress={copyPlanToDone}>
                <Text style={styles.timelineActionButtonText}>Copy Plan to Done</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Copy yesterday plan blocks to today"
                style={[styles.timelineActionButton, !isTimelineToday && styles.timelineActionButtonDisabled]}
                onPress={copyYesterdayPlanToToday}
                disabled={!isTimelineToday}>
                <Text
                  style={[
                    styles.timelineActionButtonText,
                    !isTimelineToday && styles.timelineActionButtonTextDisabled,
                  ]}>
                  Copy Yesterday Plan
                </Text>
              </Pressable>
            </View>
            <Text style={styles.sectionTitle}>Timeline Filter</Text>
            <View style={styles.filterRow}>
              {timelineTagFilterOptions.map((option) => {
                const selected = (routeTagFilter ?? 'all') === option;
                const label = option === 'all' ? 'All' : getCategoryLabel(option);

                return (
                  <Pressable
                    key={option}
                    accessibilityLabel={`Show ${label} blocks on timeline`}
                    style={[styles.filterChip, selected && styles.filterChipSelected]}
                    onPress={() => applyTimelineFilter(option)}>
                    <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
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
            <View style={styles.editorCard}>
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
                {CATEGORY_COLORS.map((color) => {
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
              </ScrollView>

              <View style={styles.editorActions}>
                <Pressable style={styles.editorSaveButton} disabled={saving} onPress={() => void saveCategoryEditor()}>
                  <Text style={styles.editorSaveButtonText}>Save</Text>
                </Pressable>
                <Pressable
                  style={styles.editorDeleteButton}
                  disabled={saving || !editingCategoryId || editingCategoryId === 'other'}
                  onPress={() => {
                    if (editingCategoryId) {
                      void removeCategory(editingCategoryId);
                      closeCategoryEditor();
                    }
                  }}>
                  <Text style={styles.editorDeleteButtonText}>
                    {editingCategoryId === 'other' ? 'Protected' : 'Delete'}
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
        visible={importSummaryVisible}
        onRequestClose={() => setImportSummaryVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setImportSummaryVisible(false)} />
          <View style={styles.keyboardLift}>
            <View style={styles.sheetCard}>
              <View style={styles.sheetGrabber} />
              <View style={styles.sheetHeaderRow}>
                <Text style={styles.sheetTitle}>Import Summary</Text>
                <Pressable
                  accessibilityLabel="Close summary import"
                  style={styles.sheetCloseButton}
                  onPress={() => setImportSummaryVisible(false)}>
                  <Ionicons name="close" size={20} color={UI_COLORS.neutralText} />
                </Pressable>
              </View>
              <Text style={styles.toggleHint}>Paste text from Share Summary output.</Text>
              <TextInput
                value={importSummaryText}
                onChangeText={setImportSummaryText}
                multiline
                textAlignVertical="top"
                style={styles.summaryImportInput}
                placeholder="Paste summary text here..."
                placeholderTextColor="#94A3B8"
              />
              <View style={styles.editorActions}>
                <Pressable style={styles.editorDeleteButton} onPress={() => setImportSummaryVisible(false)}>
                  <Text style={styles.editorDeleteButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={styles.editorSaveButton}
                  disabled={saving}
                  onPress={importTimelineSummary}>
                  <Text style={styles.editorSaveButtonText}>Import</Text>
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
  timelineActionButtonDisabled: {
    backgroundColor: UI_COLORS.surfaceMuted,
    opacity: 0.7,
  },
  timelineActionButtonText: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  timelineActionButtonTextDisabled: {
    color: UI_COLORS.neutralTextSoft,
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
