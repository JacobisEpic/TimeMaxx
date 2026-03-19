import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UI_RADIUS, UI_TYPE, type UIColors, useUIColors } from '@/src/constants/uiTheme';
import { DEFAULT_CATEGORIES } from '@/src/context/AppSettingsContext';
import type {
  BlockMonthlyRepeatMode,
  BlockRepeatEndMode,
  BlockRepeatPreset,
  Lane,
} from '@/src/types/blocks';
import { dayKeyToLocalDate, getLocalDayKey } from '@/src/utils/dayKey';
import { formatHHMM, formatMinutesAmPm, parseHHMM } from '@/src/utils/time';

type PlannedLinkOption = {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  tags: string[];
};

type PickerType = 'startTime' | 'endTime' | null;

type BlockEditorModalProps = {
  visible: boolean;
  mode: 'create' | 'edit';
  showRepeatControls?: boolean;
  lane: Lane;
  titleValue: string;
  selectedTags: string[];
  startValue: string;
  endValue: string;
  repeatPreset: BlockRepeatPreset;
  repeatIntervalText: string;
  repeatWeekDays: number[];
  repeatMonthlyMode: BlockMonthlyRepeatMode;
  repeatEndMode: BlockRepeatEndMode;
  repeatUntilDayKey: string;
  repeatOccurrenceCountText: string;
  linkedPlannedId: string | null;
  categoryOptions: { id: string; label: string; color: string }[];
  plannedLinkOptions: PlannedLinkOption[];
  errorText: string | null;
  saveDisabled?: boolean;
  onChangeTitle: (value: string) => void;
  onToggleTag: (tag: string) => void;
  onChangeStart: (value: string) => void;
  onChangeEnd: (value: string) => void;
  onChangeRepeatPreset: (preset: BlockRepeatPreset) => void;
  onChangeRepeatIntervalText: (value: string) => void;
  onToggleRepeatWeekDay: (day: number) => void;
  onChangeRepeatMonthlyMode: (value: BlockMonthlyRepeatMode) => void;
  onChangeRepeatEndMode: (value: BlockRepeatEndMode) => void;
  onChangeRepeatUntilDayKey: (value: string) => void;
  onChangeRepeatOccurrenceCountText: (value: string) => void;
  onChangeLane: (lane: Lane) => void;
  onChangeLinkedPlannedId: (value: string | null) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  onCopyToDone?: () => void;
};

const CATEGORY_OPTIONS = DEFAULT_CATEGORIES;

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => index);
const HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);
const PERIOD_OPTIONS = ['AM', 'PM'] as const;
const SHEET_VISIBLE_HEIGHT = '86%';
const TIME_WHEEL_REPEAT_COUNT = Platform.OS === 'ios' ? 5 : 1;
const TIME_WHEEL_CENTER_REPEAT_INDEX = Math.floor(TIME_WHEEL_REPEAT_COUNT / 2);
const REPEAT_OPTIONS: { value: BlockRepeatPreset; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Every weekday (Mon-Fri)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];
const REPEAT_END_OPTIONS: { value: BlockRepeatEndMode; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'onDate', label: 'On date' },
  { value: 'afterCount', label: 'After count' },
];
const REPEAT_MONTHLY_OPTIONS: { value: BlockMonthlyRepeatMode; label: string }[] = [
  { value: 'dayOfMonth', label: 'Day of month' },
  { value: 'ordinalWeekday', label: 'Ordinal weekday' },
];
const WEEKDAY_OPTIONS = [
  { value: 0, label: 'S' },
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'T' },
  { value: 5, label: 'F' },
  { value: 6, label: 'S' },
];
const CALENDAR_WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DONE_TEXT_INPUT_PROPS = {
  returnKeyType: 'done' as const,
  enterKeyHint: 'done' as const,
  inputAccessoryViewButtonLabel: 'Done',
  submitBehavior: 'blurAndSubmit' as const,
};

type CircularWheelItem<T extends string | number> = {
  key: string;
  label: string;
  logicalIndex: number;
  repeatIndex: number;
  token: string;
  value: T;
};

type CalendarCell = {
  key: string;
  dayKey: string;
  date: Date;
  inCurrentMonth: boolean;
};

function toTimeLabel(hour24: number, minute: number): string {
  return formatMinutesAmPm(hour24 * 60 + minute);
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function formatRepeatUntilLabel(dayKey: string): string {
  const date = dayKeyToLocalDate(dayKey);
  if (!date) {
    return 'Select date';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function buildCalendarCells(monthStart: Date): CalendarCell[] {
  const start = getMonthStart(monthStart);
  const firstWeekday = start.getDay();
  const dayCount = getDaysInMonth(start);
  const rowCount = Math.ceil((firstWeekday + dayCount) / 7);
  const totalCells = rowCount * 7;
  const cells: CalendarCell[] = [];

  for (let i = 0; i < totalCells; i += 1) {
    const dayOfMonth = i - firstWeekday + 1;
    const cellDate = new Date(start.getFullYear(), start.getMonth(), dayOfMonth);
    const inCurrentMonth =
      cellDate.getMonth() === start.getMonth() && cellDate.getFullYear() === start.getFullYear();

    cells.push({
      key: `${getLocalDayKey(cellDate)}-${i}`,
      dayKey: getLocalDayKey(cellDate),
      date: cellDate,
      inCurrentMonth,
    });
  }

  return cells;
}

function getStartAndDuration(startValue: string, endValue: string): { startMin: number; durationMin: number } {
  const parsedStart = parseHHMM(startValue);
  const parsedEnd = parseHHMM(endValue);

  if (parsedStart === null || parsedEnd === null || parsedEnd <= parsedStart) {
    return { startMin: 8 * 60, durationMin: 60 };
  }

  return { startMin: parsedStart, durationMin: parsedEnd - parsedStart };
}

function buildCircularWheelItems<T extends string | number>(
  values: readonly T[],
  getLabel: (value: T) => string
): CircularWheelItem<T>[] {
  return Array.from({ length: TIME_WHEEL_REPEAT_COUNT }, (_, repeatIndex) =>
    values.map((value, logicalIndex) => ({
      key: `wheel-${repeatIndex}-${logicalIndex}-${String(value)}`,
      label: getLabel(value),
      logicalIndex,
      repeatIndex,
      token: `${repeatIndex}-${logicalIndex}`,
      value,
    }))
  ).flat();
}

function getCircularWheelToken<T extends string | number>(
  items: readonly CircularWheelItem<T>[],
  values: readonly T[],
  value: T
): string {
  const logicalIndex = values.findIndex((entry) => entry === value);
  const safeLogicalIndex = logicalIndex >= 0 ? logicalIndex : 0;
  const selectedItem = items[TIME_WHEEL_CENTER_REPEAT_INDEX * values.length + safeLogicalIndex] ?? items[0];
  return selectedItem?.token ?? '';
}

function resolveCircularWheelSelection<T extends string | number>(
  items: readonly CircularWheelItem<T>[],
  itemIndex: number,
  fallbackToken: string
): CircularWheelItem<T> | null {
  return items[itemIndex] ?? items.find((item) => item.token === fallbackToken) ?? null;
}

function dismissKeyboardOnSubmit() {
  Keyboard.dismiss();
}

const HOUR_WHEEL_ITEMS = buildCircularWheelItems(HOUR_OPTIONS, (value) => String(value));
const MINUTE_WHEEL_ITEMS = buildCircularWheelItems(MINUTE_OPTIONS, (value) => String(value).padStart(2, '0'));

export function BlockEditorModal({
  visible,
  mode,
  showRepeatControls = mode === 'create',
  lane,
  titleValue,
  selectedTags,
  startValue,
  endValue,
  repeatPreset,
  repeatIntervalText,
  repeatWeekDays,
  repeatMonthlyMode,
  repeatEndMode,
  repeatUntilDayKey,
  repeatOccurrenceCountText,
  linkedPlannedId,
  categoryOptions,
  plannedLinkOptions,
  errorText,
  saveDisabled = false,
  onChangeTitle,
  onToggleTag,
  onChangeStart,
  onChangeEnd,
  onChangeRepeatPreset,
  onChangeRepeatIntervalText,
  onToggleRepeatWeekDay,
  onChangeRepeatMonthlyMode,
  onChangeRepeatEndMode,
  onChangeRepeatUntilDayKey,
  onChangeRepeatOccurrenceCountText,
  onChangeLane,
  onChangeLinkedPlannedId,
  onCancel,
  onSave,
  onDelete,
  onCopyToDone,
}: BlockEditorModalProps) {
  const insets = useSafeAreaInsets();
  const colors = useUIColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [linkPickerVisible, setLinkPickerVisible] = useState(false);
  const [pickerType, setPickerType] = useState<PickerType>(null);
  const [repeatPickerVisible, setRepeatPickerVisible] = useState(false);
  const [repeatCalendarVisible, setRepeatCalendarVisible] = useState(false);
  const [repeatCalendarMonthStart, setRepeatCalendarMonthStart] = useState<Date>(() => {
    const parsed = dayKeyToLocalDate(repeatUntilDayKey);
    return getMonthStart(parsed ?? new Date());
  });
  const [wheelHour, setWheelHour] = useState(8);
  const [wheelHourToken, setWheelHourToken] = useState(() =>
    getCircularWheelToken(HOUR_WHEEL_ITEMS, HOUR_OPTIONS, 8)
  );
  const [wheelMinute, setWheelMinute] = useState(0);
  const [wheelMinuteToken, setWheelMinuteToken] = useState(() =>
    getCircularWheelToken(MINUTE_WHEEL_ITEMS, MINUTE_OPTIONS, 0)
  );
  const [wheelPeriod, setWheelPeriod] = useState<(typeof PERIOD_OPTIONS)[number]>('AM');
  const [wheelDuration, setWheelDuration] = useState(60);

  const resolvedCategoryOptions = useMemo(
    () => (categoryOptions.length ? categoryOptions : [...CATEGORY_OPTIONS]),
    [categoryOptions]
  );
  const unknownTags = useMemo(() => {
    const knownIds = new Set(resolvedCategoryOptions.map((category) => category.id));
    return selectedTags.filter((tag) => !knownIds.has(tag));
  }, [resolvedCategoryOptions, selectedTags]);
  const categoryRenderOptions = useMemo(
    () => [...resolvedCategoryOptions, ...unknownTags.map((tag) => ({ label: tag, id: tag, color: colors.neutralTextSoft }))],
    [colors.neutralTextSoft, resolvedCategoryOptions, unknownTags]
  );
  const selectedCategoryId = selectedTags[0]?.toLowerCase() ?? null;
  const selectedCategoryLabel =
    resolvedCategoryOptions.find((option) => option.id.toLowerCase() === selectedCategoryId)?.label ?? null;
  const categoryMatchedOptions = useMemo(() => {
    if (!selectedCategoryId) {
      return [];
    }

    return plannedLinkOptions.filter(
      (option) => option.tags[0]?.toLowerCase() === selectedCategoryId
    );
  }, [plannedLinkOptions, selectedCategoryId]);
  const selectedCategoryIndex = useMemo(
    () =>
      selectedCategoryId
        ? categoryRenderOptions.findIndex((option) => option.id.toLowerCase() === selectedCategoryId)
        : -1,
    [categoryRenderOptions, selectedCategoryId]
  );
  const selectedCategoryRowIndex = selectedCategoryIndex >= 0 ? Math.floor(selectedCategoryIndex / 2) : -1;
  const categoryRows = useMemo(() => {
    const rows: typeof categoryRenderOptions[] = [];

    for (let index = 0; index < categoryRenderOptions.length; index += 2) {
      rows.push(categoryRenderOptions.slice(index, index + 2));
    }

    return rows;
  }, [categoryRenderOptions]);
  const timeState = getStartAndDuration(startValue, endValue);
  const selectedHour = Math.floor(timeState.startMin / 60);
  const selectedMinute = timeState.startMin % 60;
  const parsedEnd = parseHHMM(endValue);
  const safeEnd = parsedEnd !== null ? parsedEnd : Math.min(24 * 60, timeState.startMin + timeState.durationMin);
  const selectedEndHour = Math.floor(safeEnd / 60);
  const selectedEndMinute = safeEnd % 60;
  const repeatLabel = useMemo(
    () => REPEAT_OPTIONS.find((option) => option.value === repeatPreset)?.label ?? 'Does not repeat',
    [repeatPreset]
  );
  const repeatIntervalUnit = useMemo(() => {
    if (repeatPreset === 'daily') {
      return 'day(s)';
    }
    if (repeatPreset === 'weekdays' || repeatPreset === 'weekly') {
      return 'week(s)';
    }
    if (repeatPreset === 'monthly') {
      return 'month(s)';
    }
    return 'year(s)';
  }, [repeatPreset]);
  const repeatUntilLabel = useMemo(() => formatRepeatUntilLabel(repeatUntilDayKey), [repeatUntilDayKey]);
  const todayDayKey = useMemo(() => getLocalDayKey(), []);
  const repeatCalendarMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      }).format(repeatCalendarMonthStart),
    [repeatCalendarMonthStart]
  );
  const repeatCalendarCells = useMemo(
    () => buildCalendarCells(repeatCalendarMonthStart),
    [repeatCalendarMonthStart]
  );

  useEffect(() => {
    if (!visible) {
      setLinkPickerVisible(false);
      setPickerType(null);
      setRepeatPickerVisible(false);
      setRepeatCalendarVisible(false);
    }
  }, [visible]);

  const openRepeatCalendar = () => {
    const selectedDate = dayKeyToLocalDate(repeatUntilDayKey);
    setRepeatCalendarMonthStart(getMonthStart(selectedDate ?? new Date()));
    setRepeatCalendarVisible(true);
  };

  useEffect(() => {
    if (pickerType === null) {
      return;
    }

    const sourceHour = pickerType === 'endTime' ? selectedEndHour : selectedHour;
    const sourceMinute = pickerType === 'endTime' ? selectedEndMinute : selectedMinute;
    const hour12 = sourceHour % 12 === 0 ? 12 : sourceHour % 12;
    const period: 'AM' | 'PM' = sourceHour >= 12 ? 'PM' : 'AM';
    const minute = sourceMinute >= 0 && sourceMinute <= 59 ? sourceMinute : 0;
    setWheelHour(hour12);
    setWheelHourToken(getCircularWheelToken(HOUR_WHEEL_ITEMS, HOUR_OPTIONS, hour12));
    setWheelMinute(minute);
    setWheelMinuteToken(getCircularWheelToken(MINUTE_WHEEL_ITEMS, MINUTE_OPTIONS, minute));
    setWheelPeriod(period);
    setWheelDuration(timeState.durationMin);
  }, [pickerType, selectedEndHour, selectedEndMinute, selectedHour, selectedMinute, timeState.durationMin]);

  const applyStartAndDuration = (startMin: number, durationMin: number) => {
    const nextStart = Math.max(0, Math.min(23 * 60 + 59, startMin));
    const safeDuration = Math.max(1, durationMin);
    const nextEnd = Math.min(24 * 60, nextStart + safeDuration);

    onChangeStart(formatHHMM(nextStart));
    onChangeEnd(formatHHMM(nextEnd));
  };

  const applyWheelTime = (kind: 'start' | 'end', hour12: number, minute: number, period: 'AM' | 'PM') => {
    const hour24 = (hour12 % 12) + (period === 'PM' ? 12 : 0);
    if (kind === 'start') {
      applyStartAndDuration(hour24 * 60 + minute, wheelDuration);
      return;
    }

    const startParsed = parseHHMM(startValue);
    const start = startParsed === null ? timeState.startMin : startParsed;
    const requestedEnd = hour24 * 60 + minute;
    const nextEnd = Math.max(start + 1, Math.min(24 * 60, requestedEnd));
    onChangeEnd(formatHHMM(nextEnd));
    setWheelDuration(nextEnd - start);
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissLayer} onPress={onCancel} />
        <View
          style={[
            styles.card,
            {
              paddingBottom: 18 + insets.bottom,
              paddingLeft: 16 + insets.left,
              paddingRight: 16 + insets.right,
            },
          ]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.headerText}>{mode === 'create' ? 'Add Time Block' : 'Edit Time Block'}</Text>
            <Pressable accessibilityLabel="Close editor" style={styles.closeButton} onPress={onCancel}>
              <Ionicons name="close" size={18} color={colors.neutralText} />
            </Pressable>
          </View>
          <View style={styles.headerLaneRow}>
            {(['planned', 'done'] as Lane[]).map((value) => {
              const selected = lane === value;

              return (
                <Pressable
                  key={`header-${value}`}
                  accessibilityLabel={`Set type ${value === 'planned' ? 'plan' : 'done'}`}
                  style={[styles.headerLaneChip, selected && styles.headerLaneChipSelected]}
                  onPress={() => onChangeLane(value)}>
                  <Text style={[styles.headerLaneChipText, selected && styles.headerLaneChipTextSelected]}>
                    {value === 'planned' ? 'Plan' : 'Done'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.formBody}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScrollBeginDrag={() => Keyboard.dismiss()}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              value={titleValue}
              onChangeText={onChangeTitle}
              placeholder="What are you working on?"
              style={styles.input}
              accessibilityLabel="Block title"
              placeholderTextColor={colors.neutralTextSoft}
              {...DONE_TEXT_INPUT_PROPS}
              onSubmitEditing={dismissKeyboardOnSubmit}
            />

            <View style={styles.timeControlRow}>
              <View style={styles.timeColumn}>
                <Text style={styles.label}>Start Time</Text>
                <View style={styles.startControlGroup}>
                  <Pressable style={styles.dropdown} onPress={() => setPickerType('startTime')}>
                    <Text style={styles.dropdownText}>{toTimeLabel(selectedHour, selectedMinute)}</Text>
                    <Ionicons name="chevron-down" size={14} color={colors.neutralTextSoft} />
                  </Pressable>
                </View>
              </View>
              <View style={styles.timeColumn}>
                <Text style={styles.label}>End Time</Text>
                <View style={styles.startControlGroup}>
                  <Pressable style={styles.dropdown} onPress={() => setPickerType('endTime')}>
                    <Text style={styles.dropdownText}>{toTimeLabel(selectedEndHour, selectedEndMinute)}</Text>
                    <Ionicons name="chevron-down" size={14} color={colors.neutralTextSoft} />
                  </Pressable>
                </View>
              </View>
            </View>

            {showRepeatControls ? (
              <View style={styles.repeatSection}>
                <Text style={styles.label}>Repeat</Text>
                <Pressable
                  accessibilityLabel="Choose repeat rule"
                  style={styles.dropdown}
                  onPress={() => setRepeatPickerVisible(true)}>
                  <Text style={styles.dropdownText}>{repeatLabel}</Text>
                  <Ionicons name="chevron-down" size={14} color={colors.neutralTextSoft} />
                </Pressable>
                {repeatPreset !== 'none' ? (
                  <View style={styles.repeatDetailsWrap}>
                    {repeatPreset !== 'weekdays' ? (
                      <View style={styles.repeatUntilWrap}>
                        <Text style={styles.label}>Every</Text>
                        <View style={styles.repeatInlineRow}>
                          <TextInput
                            value={repeatIntervalText}
                            onChangeText={onChangeRepeatIntervalText}
                            placeholder="1"
                            style={[styles.input, styles.repeatNumberInput]}
                            keyboardType="number-pad"
                            accessibilityLabel="Repeat interval"
                            placeholderTextColor={colors.neutralTextSoft}
                            {...DONE_TEXT_INPUT_PROPS}
                            onSubmitEditing={dismissKeyboardOnSubmit}
                          />
                          <Text style={styles.repeatInlineLabel}>{repeatIntervalUnit}</Text>
                        </View>
                      </View>
                    ) : null}

                    {repeatPreset === 'weekly' ? (
                      <View style={styles.repeatUntilWrap}>
                        <Text style={styles.label}>Days</Text>
                        <View style={styles.weekdayRow}>
                          {WEEKDAY_OPTIONS.map((day) => {
                            const selected = repeatWeekDays.includes(day.value);
                            return (
                              <Pressable
                                key={`repeat-day-${day.value}`}
                                accessibilityLabel={`Toggle ${day.label}`}
                                style={[styles.weekdayChip, selected && styles.weekdayChipSelected]}
                                onPress={() => onToggleRepeatWeekDay(day.value)}>
                                <Text style={[styles.weekdayChipText, selected && styles.weekdayChipTextSelected]}>
                                  {day.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    ) : null}

                    {repeatPreset === 'monthly' ? (
                      <View style={styles.repeatUntilWrap}>
                        <Text style={styles.label}>Monthly Pattern</Text>
                        <View style={styles.modeChipRow}>
                          {REPEAT_MONTHLY_OPTIONS.map((option) => {
                            const selected = option.value === repeatMonthlyMode;
                            return (
                              <Pressable
                                key={option.value}
                                accessibilityLabel={`Use ${option.label}`}
                                style={[styles.modeChip, selected && styles.modeChipSelected]}
                                onPress={() => onChangeRepeatMonthlyMode(option.value)}>
                                <Text style={[styles.modeChipText, selected && styles.modeChipTextSelected]}>
                                  {option.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.repeatUntilWrap}>
                      <Text style={styles.label}>Ends</Text>
                      <View style={styles.modeChipRow}>
                        {REPEAT_END_OPTIONS.map((option) => {
                          const selected = option.value === repeatEndMode;
                          return (
                            <Pressable
                              key={option.value}
                              accessibilityLabel={`Set end mode ${option.label}`}
                              style={[styles.modeChip, selected && styles.modeChipSelected]}
                              onPress={() => onChangeRepeatEndMode(option.value)}>
                              <Text style={[styles.modeChipText, selected && styles.modeChipTextSelected]}>
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    {repeatEndMode === 'onDate' ? (
                      <View style={styles.repeatUntilWrap}>
                        <Text style={styles.label}>Repeat Until</Text>
                        <Pressable
                          accessibilityLabel="Pick repeat until date"
                          style={styles.dropdown}
                          onPress={openRepeatCalendar}>
                          <View style={styles.repeatDateValueWrap}>
                            <Text style={styles.dropdownText}>{repeatUntilLabel}</Text>
                            <Text style={styles.repeatHintText}>Tap to choose</Text>
                          </View>
                          <Ionicons name="calendar-outline" size={16} color={colors.neutralTextSoft} />
                        </Pressable>
                      </View>
                    ) : null}

                    {repeatEndMode === 'afterCount' ? (
                      <View style={styles.repeatUntilWrap}>
                        <Text style={styles.label}>Occurrences</Text>
                        <TextInput
                          value={repeatOccurrenceCountText}
                          onChangeText={onChangeRepeatOccurrenceCountText}
                          placeholder="10"
                          style={[styles.input, styles.repeatNumberInput]}
                          keyboardType="number-pad"
                          accessibilityLabel="Repeat occurrence count"
                          placeholderTextColor={colors.neutralTextSoft}
                          {...DONE_TEXT_INPUT_PROPS}
                          onSubmitEditing={dismissKeyboardOnSubmit}
                        />
                      </View>
                    ) : null}

                    {repeatEndMode === 'never' ? (
                      <Text style={styles.repeatHintText}>
                        Creates a one-year rolling series from the start date.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.label}>Category</Text>
            <View style={styles.categoryGrid}>
              {categoryRows.map((row, rowIndex) => (
                <React.Fragment key={`category-row-${rowIndex}`}>
                  <View style={styles.categoryGridRow}>
                    {row.map((option) => {
                      const selected = selectedTags.includes(option.id);

                      return (
                        <Pressable
                          key={option.id}
                          accessibilityLabel={`Select category ${option.label}`}
                          style={[styles.categoryChip, selected && styles.categoryChipSelected]}
                          onPress={() => onToggleTag(option.id)}>
                          <View style={[styles.categoryDot, { backgroundColor: option.color }]} />
                          <Text style={[styles.categoryChipText, selected && styles.categoryChipTextSelected]}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {row.length < 2 ? <View style={styles.categoryChipSpacer} /> : null}
                  </View>
                  {lane === 'done' && selectedCategoryId && selectedCategoryRowIndex === rowIndex ? (
                    <View style={styles.inlineLinkSection}>
                      <View style={styles.inlineLinkHeader}>
                        <Text style={styles.label}>Counts toward</Text>
                        <Pressable
                          accessibilityLabel="Browse all plan blocks"
                          accessibilityRole="button"
                          onPress={() => setLinkPickerVisible(true)}>
                          <Text style={styles.inlineLinkBrowse}>Browse all</Text>
                        </Pressable>
                      </View>
                      {categoryMatchedOptions.length === 0 ? (
                        <Text style={styles.inlineLinkEmpty}>
                          No plan blocks found in {selectedCategoryLabel ?? 'this category'}.
                        </Text>
                      ) : (
                        categoryMatchedOptions.map((option) => {
                          const selected = option.id === linkedPlannedId;

                          return (
                            <Pressable
                              key={`inline-link-${option.id}`}
                              accessibilityLabel={`Count toward ${option.title}`}
                              style={[styles.inlineLinkOption, selected && styles.inlineLinkOptionSelected]}
                              onPress={() => onChangeLinkedPlannedId(selected ? null : option.id)}>
                              <View style={styles.inlineLinkCopy}>
                                <Text style={[styles.inlineLinkTitle, selected && styles.inlineLinkTitleSelected]} numberOfLines={1}>
                                  {option.title}
                                </Text>
                                <Text style={styles.inlineLinkTime}>
                                  {formatMinutesAmPm(option.startMin)}-{formatMinutesAmPm(option.endMin)}
                                </Text>
                              </View>
                              <Ionicons
                                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                                size={18}
                                color={selected ? colors.planned : colors.neutralTextSoft}
                              />
                            </Pressable>
                          );
                        })
                      )}
                    </View>
                  ) : null}
                </React.Fragment>
              ))}
            </View>
            {lane === 'done' && !selectedCategoryId ? (
              <View style={styles.inlineLinkSection}>
                <View style={styles.inlineLinkHeader}>
                  <Text style={styles.label}>Counts toward</Text>
                  <Pressable
                    accessibilityLabel="Browse all plan blocks"
                    accessibilityRole="button"
                    onPress={() => setLinkPickerVisible(true)}>
                    <Text style={styles.inlineLinkBrowse}>Browse all</Text>
                  </Pressable>
                </View>
                <Text style={styles.inlineLinkEmpty}>Select a category to see matching plan blocks.</Text>
              </View>
            ) : null}

          <Text style={styles.errorText}>{errorText ?? ' '}</Text>
          </ScrollView>
          <View style={styles.footerRow}>
            {mode === 'edit' ? (
              <Pressable
                accessibilityLabel="Delete block"
                style={[styles.secondaryButton, styles.deleteButton]}
                onPress={onDelete}>
                <Text style={styles.deleteButtonText}>Delete</Text>
              </Pressable>
            ) : null}
            {mode === 'edit' && lane === 'planned' && onCopyToDone ? (
              <Pressable
                accessibilityLabel="Copy block to done"
                style={[styles.secondaryButton, styles.copyButton]}
                onPress={onCopyToDone}>
                <Text style={styles.copyButtonText}>Copy to Done</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel={mode === 'create' ? 'Add block' : 'Save block'}
              style={[styles.primaryButton, saveDisabled && styles.primaryButtonDisabled]}
              onPress={onSave}
              disabled={saveDisabled}>
              <Text style={styles.primaryButtonText}>{mode === 'create' ? 'Add' : 'Save'}</Text>
            </Pressable>
          </View>
          </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={repeatPickerVisible}
        onRequestClose={() => setRepeatPickerVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <Pressable style={styles.pickerDismissLayer} onPress={() => setRepeatPickerVisible(false)} />
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Repeat</Text>
            {REPEAT_OPTIONS.map((option) => {
              const selected = option.value === repeatPreset;

              return (
                <Pressable
                  key={option.value}
                  accessibilityLabel={`Set repeat ${option.label}`}
                  style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                  onPress={() => {
                    onChangeRepeatPreset(option.value);
                    setRepeatPickerVisible(false);
                  }}>
                  <Text style={[styles.pickerRowTitle, selected && styles.pickerRowTitleSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={repeatCalendarVisible}
        onRequestClose={() => setRepeatCalendarVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <Pressable style={styles.pickerDismissLayer} onPress={() => setRepeatCalendarVisible(false)} />
          <View style={styles.calendarCard}>
            <View style={styles.calendarHeaderRow}>
              <Pressable
                accessibilityLabel="Previous month"
                style={styles.calendarNavButton}
                onPress={() =>
                  setRepeatCalendarMonthStart(
                    (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1)
                  )
                }>
                <Ionicons name="chevron-back" size={16} color={colors.neutralText} />
              </Pressable>
              <Text style={styles.pickerTitle}>{repeatCalendarMonthLabel}</Text>
              <Pressable
                accessibilityLabel="Next month"
                style={styles.calendarNavButton}
                onPress={() =>
                  setRepeatCalendarMonthStart(
                    (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1)
                  )
                }>
                <Ionicons name="chevron-forward" size={16} color={colors.neutralText} />
              </Pressable>
            </View>
            <View style={styles.calendarWeekdayRow}>
              {CALENDAR_WEEKDAY_LABELS.map((label, index) => (
                <Text key={`weekday-${label}-${index}`} style={styles.calendarWeekdayText}>
                  {label}
                </Text>
              ))}
            </View>
            <View style={styles.calendarGrid}>
              {repeatCalendarCells.map((cell) => {
                const selected = cell.dayKey === repeatUntilDayKey;
                const isToday = cell.dayKey === todayDayKey;
                const muted = !cell.inCurrentMonth;
                return (
                  <View key={cell.key} style={styles.calendarCell}>
                    <Pressable
                      accessibilityLabel={`Select ${cell.dayKey}`}
                      style={[
                        styles.calendarDayCard,
                        muted && styles.calendarDayCardMuted,
                        selected && styles.calendarDayCardSelected,
                        isToday && styles.calendarDayCardToday,
                      ]}
                      onPress={() => {
                        onChangeRepeatUntilDayKey(cell.dayKey);
                        setRepeatCalendarVisible(false);
                      }}>
                      <Text
                        style={[
                          styles.calendarDayText,
                          muted && styles.calendarDayTextMuted,
                          selected && styles.calendarDayTextSelected,
                        ]}>
                        {cell.date.getDate()}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
            <Pressable style={styles.pickerDoneButton} onPress={() => setRepeatCalendarVisible(false)}>
              <Text style={styles.pickerDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={linkPickerVisible}
        onRequestClose={() => setLinkPickerVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <Pressable style={styles.pickerDismissLayer} onPress={() => setLinkPickerVisible(false)} />
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Counts Toward</Text>
            <Pressable
              accessibilityLabel="Clear plan linkage"
              style={styles.pickerRow}
              onPress={() => {
                onChangeLinkedPlannedId(null);
                setLinkPickerVisible(false);
              }}>
              <Text style={styles.pickerRowTitle}>None</Text>
            </Pressable>
            <ScrollView style={styles.linkList} showsVerticalScrollIndicator={false}>
              {plannedLinkOptions.map((option) => {
                const selected = option.id === linkedPlannedId;

                return (
                  <Pressable
                    key={option.id}
                    accessibilityLabel={`Count toward ${option.title}`}
                    style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                    onPress={() => {
                      onChangeLinkedPlannedId(option.id);
                      setLinkPickerVisible(false);
                    }}>
                    <Text style={[styles.pickerRowTitle, selected && styles.pickerRowTitleSelected]}>
                      {option.title}
                    </Text>
                    <Text style={styles.pickerRowTime}>
                      {formatMinutesAmPm(option.startMin)}-{formatMinutesAmPm(option.endMin)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={pickerType !== null} onRequestClose={() => setPickerType(null)}>
        <View style={styles.pickerBackdrop}>
          <Pressable style={styles.pickerDismissLayer} onPress={() => setPickerType(null)} />
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>
              {pickerType === 'endTime' ? 'End Time' : 'Start Time'}
            </Text>
            <View style={styles.pickerWheelRow}>
              <View style={styles.pickerWheelColumn}>
                <Picker
                  selectedValue={wheelHourToken}
                  onValueChange={(nextToken, itemIndex) => {
                    const selectedItem = resolveCircularWheelSelection(HOUR_WHEEL_ITEMS, itemIndex, String(nextToken));
                    if (!selectedItem) {
                      return;
                    }

                    const value = Number(selectedItem.value);
                    const centeredToken =
                      selectedItem.repeatIndex === TIME_WHEEL_CENTER_REPEAT_INDEX
                        ? selectedItem.token
                        : getCircularWheelToken(HOUR_WHEEL_ITEMS, HOUR_OPTIONS, value);
                    setWheelHour(value);
                    setWheelHourToken(centeredToken);
                    applyWheelTime(pickerType === 'endTime' ? 'end' : 'start', value, wheelMinute, wheelPeriod);
                  }}>
                  {HOUR_WHEEL_ITEMS.map((item) => (
                    <Picker.Item key={item.key} label={item.label} value={item.token} />
                  ))}
                </Picker>
              </View>
              <View style={styles.pickerWheelColumn}>
                <Picker
                  selectedValue={wheelMinuteToken}
                  onValueChange={(nextToken, itemIndex) => {
                    const selectedItem = resolveCircularWheelSelection(MINUTE_WHEEL_ITEMS, itemIndex, String(nextToken));
                    if (!selectedItem) {
                      return;
                    }

                    const value = Number(selectedItem.value);
                    const centeredToken =
                      selectedItem.repeatIndex === TIME_WHEEL_CENTER_REPEAT_INDEX
                        ? selectedItem.token
                        : getCircularWheelToken(MINUTE_WHEEL_ITEMS, MINUTE_OPTIONS, value);
                    setWheelMinute(value);
                    setWheelMinuteToken(centeredToken);
                    applyWheelTime(pickerType === 'endTime' ? 'end' : 'start', wheelHour, value, wheelPeriod);
                  }}>
                  {MINUTE_WHEEL_ITEMS.map((item) => (
                    <Picker.Item key={item.key} label={item.label} value={item.token} />
                  ))}
                </Picker>
              </View>
              <View style={styles.pickerWheelColumn}>
                <Picker
                  selectedValue={wheelPeriod}
                  onValueChange={(nextPeriod) => {
                    const value = nextPeriod === 'PM' ? 'PM' : 'AM';
                    setWheelPeriod(value);
                    applyWheelTime(pickerType === 'endTime' ? 'end' : 'start', wheelHour, wheelMinute, value);
                  }}>
                  {PERIOD_OPTIONS.map((item) => (
                    <Picker.Item key={item} label={item} value={item} />
                  ))}
                </Picker>
              </View>
            </View>
            <Pressable style={styles.pickerDoneButton} onPress={() => setPickerType(null)}>
              <Text style={styles.pickerDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

function createStyles(colors: UIColors) {
  const isDark = colors.appBackground === '#0B0D11';
  const theme = {
    cardShadow: isDark ? '#000000' : '#111827',
    destructiveBackground: isDark ? '#3F1D1D' : '#FEE2E2',
    destructiveText: isDark ? '#FCA5A5' : '#991B1B',
    primaryButtonBackground: colors.neutralText,
    primaryButtonDisabled: isDark ? '#374151' : '#C7CDD6',
    onPrimaryText: isDark ? '#0B0D11' : '#FFFFFF',
  };

  return StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  dismissLayer: {
    flex: 1,
  },
  card: {
    height: SHEET_VISIBLE_HEIGHT,
    backgroundColor: colors.surface,
    borderTopLeftRadius: UI_RADIUS.sheet,
    borderTopRightRadius: UI_RADIUS.sheet,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    shadowColor: theme.cardShadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 10,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.neutralBorder,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLaneRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  headerLaneChip: {
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surfaceMuted,
  },
  headerLaneChipSelected: {
    backgroundColor: colors.surface,
    borderColor: colors.neutralText,
  },
  headerLaneChipText: {
    color: colors.neutralTextSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  headerLaneChipTextSelected: {
    color: colors.neutralText,
  },
  headerText: {
    color: colors.neutralText,
    fontSize: UI_TYPE.section,
    fontWeight: '800',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formBody: {
    gap: 10,
    paddingBottom: 12,
  },
  label: {
    fontSize: UI_TYPE.body,
    color: colors.neutralText,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.neutralText,
    backgroundColor: colors.surface,
  },
  categoryGrid: {
    flexDirection: 'column',
    gap: 10,
  },
  categoryGridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  categoryChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingVertical: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface,
  },
  categoryChipSelected: {
    borderColor: colors.neutralText,
    backgroundColor: colors.surfaceMuted,
  },
  categoryChipSpacer: {
    flex: 1,
  },
  categoryChipText: {
    color: colors.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  categoryChipTextSelected: {
    color: colors.neutralText,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timeControlRow: {
    flexDirection: 'row',
    gap: 10,
  },
  timeColumn: {
    flex: 1,
    gap: 6,
  },
  repeatSection: {
    gap: 6,
  },
  repeatDetailsWrap: {
    gap: 8,
  },
  repeatUntilWrap: {
    gap: 6,
  },
  repeatInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  repeatNumberInput: {
    width: 88,
  },
  repeatInlineLabel: {
    color: colors.neutralTextSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  repeatDateValueWrap: {
    flex: 1,
    gap: 2,
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  weekdayChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  weekdayChipSelected: {
    borderColor: colors.neutralText,
    backgroundColor: colors.surfaceMuted,
  },
  weekdayChipText: {
    color: colors.neutralTextSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  weekdayChipTextSelected: {
    color: colors.neutralText,
  },
  modeChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modeChip: {
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  modeChipSelected: {
    borderColor: colors.neutralText,
    backgroundColor: colors.surfaceMuted,
  },
  modeChipText: {
    color: colors.neutralTextSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  modeChipTextSelected: {
    color: colors.neutralText,
  },
  repeatHintText: {
    color: colors.neutralTextSoft,
    fontSize: UI_TYPE.caption,
  },
  startControlGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdown: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
  },
  dropdownText: {
    color: colors.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    minHeight: 18,
    color: theme.destructiveText,
    fontSize: UI_TYPE.caption,
  },
  linkSection: {
    gap: 6,
    marginTop: 2,
  },
  inlineLinkSection: {
    gap: 6,
    marginTop: 2,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: UI_RADIUS.control,
    padding: 10,
    backgroundColor: colors.surface,
  },
  inlineLinkHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlineLinkBrowse: {
    color: colors.neutralTextSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  inlineLinkOption: {
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  inlineLinkOptionSelected: {
    borderColor: colors.planned,
    backgroundColor: colors.plannedTint,
  },
  inlineLinkCopy: {
    flex: 1,
    gap: 1,
  },
  inlineLinkTitle: {
    color: colors.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  inlineLinkTitleSelected: {
    color: colors.neutralText,
  },
  inlineLinkTime: {
    color: colors.neutralTextSoft,
    fontSize: 11,
    fontWeight: '500',
  },
  inlineLinkEmpty: {
    color: colors.neutralTextSoft,
    fontSize: 12,
  },
  linkRow: {
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  linkRowDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  linkRowText: {
    flex: 1,
    color: colors.neutralText,
    fontSize: 13,
  },
  linkRowTextDisabled: {
    color: colors.neutralTextSoft,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.neutralBorder,
    backgroundColor: colors.surface,
  },
  secondaryButton: {
    borderRadius: UI_RADIUS.control,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
  },
  deleteButton: {
    backgroundColor: theme.destructiveBackground,
  },
  deleteButtonText: {
    color: theme.destructiveText,
    fontWeight: '700',
  },
  copyButton: {
    backgroundColor: colors.plannedTint,
    borderColor: colors.planned,
  },
  copyButtonText: {
    color: colors.planned,
    fontWeight: '700',
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: UI_RADIUS.control,
    backgroundColor: theme.primaryButtonBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: theme.primaryButtonDisabled,
  },
  primaryButtonText: {
    color: theme.onPrimaryText,
    fontSize: 15,
    fontWeight: '700',
  },
  pickerBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: colors.overlay,
  },
  pickerDismissLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: UI_RADIUS.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: colors.neutralBorder,
  },
  calendarCard: {
    backgroundColor: colors.surface,
    borderRadius: UI_RADIUS.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
  },
  pickerTitle: {
    color: colors.neutralText,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calendarNavButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarWeekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  calendarWeekdayText: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: colors.neutralTextSoft,
    fontSize: 11,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  calendarCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  calendarDayCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.glassSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayCardMuted: {
    borderColor: colors.glassStrokeSoft,
    backgroundColor: colors.surfaceMuted,
  },
  calendarDayCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  calendarDayCardToday: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  calendarDayText: {
    color: colors.neutralText,
    fontSize: 12,
    fontWeight: '800',
  },
  calendarDayTextMuted: {
    color: colors.neutralTextSoft,
  },
  calendarDayTextSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  linkList: {
    maxHeight: 300,
  },
  pickerWheelWrap: {
    height: 220,
    justifyContent: 'center',
  },
  pickerWheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 220,
  },
  pickerWheelColumn: {
    flex: 1,
    height: 220,
  },
  pickerDoneButton: {
    alignSelf: 'flex-end',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
  },
  pickerDoneText: {
    color: colors.neutralText,
    fontWeight: '600',
    fontSize: 13,
  },
  pickerRow: {
    borderRadius: UI_RADIUS.control,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: colors.surface,
    marginBottom: 6,
  },
  pickerRowSelected: {
    borderColor: colors.neutralText,
    backgroundColor: colors.surfaceMuted,
  },
  pickerRowTitle: {
    color: colors.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  pickerRowTitleSelected: {
    color: colors.neutralText,
  },
  pickerRowTime: {
    color: colors.neutralTextSoft,
    fontSize: UI_TYPE.caption,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  });
}
