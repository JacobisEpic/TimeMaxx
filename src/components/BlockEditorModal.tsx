import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { UI_COLORS, UI_RADIUS, UI_TYPE } from '@/src/constants/uiTheme';
import type { Lane } from '@/src/types/blocks';
import { formatHHMM, parseHHMM } from '@/src/utils/time';

type PlannedLinkOption = {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
};

type PickerType = 'startTime' | 'endTime' | 'duration' | null;

type BlockEditorModalProps = {
  visible: boolean;
  mode: 'create' | 'edit';
  lane: Lane;
  titleValue: string;
  selectedTags: string[];
  startValue: string;
  endValue: string;
  linkedPlannedId: string | null;
  categoryOptions: Array<{ id: string; label: string; color: string }>;
  plannedLinkOptions: PlannedLinkOption[];
  errorText: string | null;
  saveDisabled?: boolean;
  onChangeTitle: (value: string) => void;
  onToggleTag: (tag: string) => void;
  onChangeStart: (value: string) => void;
  onChangeEnd: (value: string) => void;
  onChangeLane: (lane: Lane) => void;
  onChangeLinkedPlannedId: (value: string | null) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
};

const CATEGORY_OPTIONS = [
  { label: 'Work', id: 'work', color: '#3B82F6' },
  { label: 'Deep Focus', id: 'focus', color: '#8B5CF6' },
  { label: 'Workout', id: 'health', color: '#22C55E' },
  { label: 'Meeting', id: 'meeting', color: '#0EA5A4' },
  { label: 'Personal', id: 'personal', color: '#14B8A6' },
  { label: 'Break', id: 'break', color: '#F59E0B' },
] as const;

const START_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  label:
    hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`,
  value: hour,
}));
const START_MINUTE_OPTIONS = [0, 15, 30, 45];
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180];

function toDurationLabel(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (rest === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${rest} min`;
}

function getStartAndDuration(startValue: string, endValue: string): { startMin: number; durationMin: number } {
  const parsedStart = parseHHMM(startValue);
  const parsedEnd = parseHHMM(endValue);

  if (parsedStart === null || parsedEnd === null || parsedEnd <= parsedStart) {
    return { startMin: 8 * 60, durationMin: 60 };
  }

  return { startMin: parsedStart, durationMin: parsedEnd - parsedStart };
}

export function BlockEditorModal({
  visible,
  mode,
  lane,
  titleValue,
  selectedTags,
  startValue,
  endValue,
  linkedPlannedId,
  categoryOptions,
  plannedLinkOptions,
  errorText,
  saveDisabled = false,
  onChangeTitle,
  onToggleTag,
  onChangeStart,
  onChangeEnd,
  onChangeLane,
  onChangeLinkedPlannedId,
  onCancel,
  onSave,
  onDelete,
}: BlockEditorModalProps) {
  const [linkPickerVisible, setLinkPickerVisible] = useState(false);
  const [pickerType, setPickerType] = useState<PickerType>(null);
  const [wheelHour, setWheelHour] = useState(8);
  const [wheelMinute, setWheelMinute] = useState(0);
  const [wheelPeriod, setWheelPeriod] = useState<'AM' | 'PM'>('AM');
  const [wheelDuration, setWheelDuration] = useState(60);

  const resolvedCategoryOptions = categoryOptions.length ? categoryOptions : [...CATEGORY_OPTIONS];
  const unknownTags = useMemo(() => {
    const knownIds = new Set(resolvedCategoryOptions.map((category) => category.id));
    return selectedTags.filter((tag) => !knownIds.has(tag));
  }, [resolvedCategoryOptions, selectedTags]);
  const linkedOption = useMemo(
    () => plannedLinkOptions.find((option) => option.id === linkedPlannedId) ?? null,
    [linkedPlannedId, plannedLinkOptions]
  );
  const linkControlDisabled = plannedLinkOptions.length === 0;
  const linkedLabel = linkedOption
    ? `${linkedOption.title} (${formatHHMM(linkedOption.startMin)}-${formatHHMM(linkedOption.endMin)})`
    : 'None';
  const timeState = getStartAndDuration(startValue, endValue);
  const selectedHour = Math.floor(timeState.startMin / 60);
  const selectedMinute = timeState.startMin % 60;
  const parsedEnd = parseHHMM(endValue);
  const safeEnd = parsedEnd !== null ? parsedEnd : Math.min(24 * 60, timeState.startMin + timeState.durationMin);
  const selectedEndHour = Math.floor(safeEnd / 60);
  const selectedEndMinute = safeEnd % 60;

  useEffect(() => {
    if (!visible) {
      setLinkPickerVisible(false);
      setPickerType(null);
    }
  }, [visible]);

  useEffect(() => {
    if (pickerType === null) {
      return;
    }

    const sourceHour = pickerType === 'endTime' ? selectedEndHour : selectedHour;
    const sourceMinute = pickerType === 'endTime' ? selectedEndMinute : selectedMinute;
    const hour12 = sourceHour % 12 === 0 ? 12 : sourceHour % 12;
    const period: 'AM' | 'PM' = sourceHour >= 12 ? 'PM' : 'AM';
    const minute = START_MINUTE_OPTIONS.includes(sourceMinute as 0 | 15 | 30 | 45) ? sourceMinute : 0;
    setWheelHour(hour12);
    setWheelMinute(minute);
    setWheelPeriod(period);
    setWheelDuration(timeState.durationMin);
  }, [pickerType, selectedEndHour, selectedEndMinute, selectedHour, selectedMinute, timeState.durationMin]);

  const applyStartAndDuration = (startMin: number, durationMin: number) => {
    const nextStart = Math.max(0, Math.min(23 * 60 + 45, startMin));
    const safeDuration = Math.max(15, durationMin);
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
    const nextEnd = Math.max(start + 15, Math.min(24 * 60, requestedEnd));
    onChangeEnd(formatHHMM(nextEnd));
    setWheelDuration(nextEnd - start);
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissLayer} onPress={onCancel} />
        <View style={styles.card}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.headerText}>{mode === 'create' ? 'Add Time Block' : 'Edit Time Block'}</Text>
            <Pressable accessibilityLabel="Close editor" style={styles.closeButton} onPress={onCancel}>
              <Ionicons name="close" size={18} color={UI_COLORS.neutralText} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.formBody}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              value={titleValue}
              onChangeText={onChangeTitle}
              placeholder="What are you working on?"
              style={styles.input}
              accessibilityLabel="Block title"
              placeholderTextColor={UI_COLORS.neutralTextSoft}
            />

            <Text style={styles.label}>Category</Text>
            <View style={styles.categoryGrid}>
              {[...resolvedCategoryOptions, ...unknownTags.map((tag) => ({ label: tag, id: tag, color: '#94A3B8' }))].map((option) => {
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
            </View>

            <Text style={styles.label}>Type</Text>
            <View style={styles.typeRow}>
              {(['planned', 'actual'] as Lane[]).map((value) => {
                const selected = lane === value;

                return (
                  <Pressable
                    key={value}
                    accessibilityLabel={`Set type ${value}`}
                    style={[styles.typeChip, selected && styles.typeChipSelected]}
                    onPress={() => onChangeLane(value)}>
                    <Text style={[styles.typeChipText, selected && styles.typeChipTextSelected]}>
                      {value === 'planned' ? 'Plan' : 'Actual'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.timeTitleRow}>
              <Text style={styles.label}>Start Time</Text>
              <Text style={styles.label}>End Time</Text>
            </View>
            <View style={styles.timeControlRow}>
              <View style={styles.startControlGroup}>
                <Pressable style={styles.dropdown} onPress={() => setPickerType('startTime')}>
                  <Text style={styles.dropdownText}>{START_HOUR_OPTIONS[selectedHour]?.label ?? '8 AM'}</Text>
                  <Ionicons name="chevron-down" size={14} color={UI_COLORS.neutralTextSoft} />
                </Pressable>
                <Text style={styles.timeColon}>:</Text>
                <Pressable style={styles.dropdownMinute} onPress={() => setPickerType('startTime')}>
                  <Text style={styles.dropdownText}>{String(selectedMinute).padStart(2, '0')}</Text>
                  <Ionicons name="chevron-down" size={14} color={UI_COLORS.neutralTextSoft} />
                </Pressable>
              </View>
              <View style={styles.startControlGroup}>
                <Pressable style={styles.dropdown} onPress={() => setPickerType('endTime')}>
                  <Text style={styles.dropdownText}>{START_HOUR_OPTIONS[selectedEndHour]?.label ?? '9 AM'}</Text>
                  <Ionicons name="chevron-down" size={14} color={UI_COLORS.neutralTextSoft} />
                </Pressable>
                <Text style={styles.timeColon}>:</Text>
                <Pressable style={styles.dropdownMinute} onPress={() => setPickerType('endTime')}>
                  <Text style={styles.dropdownText}>{String(selectedEndMinute).padStart(2, '0')}</Text>
                  <Ionicons name="chevron-down" size={14} color={UI_COLORS.neutralTextSoft} />
                </Pressable>
              </View>
            </View>

            <View style={styles.timeTitleRow}>
              <Text style={styles.label}>Duration</Text>
            </View>
            <View style={styles.timeControlRow}>
              <Pressable style={styles.durationControl} onPress={() => setPickerType('duration')}>
                <Text style={styles.dropdownText}>{toDurationLabel(timeState.durationMin)}</Text>
                <Ionicons name="chevron-down" size={14} color={UI_COLORS.neutralTextSoft} />
              </Pressable>
            </View>

            {lane === 'actual' ? (
              <View style={styles.linkSection}>
                <Text style={styles.label}>Linked to</Text>
                <Pressable
                  accessibilityLabel="Select linked planned block"
                  accessibilityRole="button"
                  style={[styles.linkRow, linkControlDisabled && styles.linkRowDisabled]}
                  onPress={() => setLinkPickerVisible(true)}
                  disabled={linkControlDisabled}>
                  <Text style={[styles.linkRowText, linkControlDisabled && styles.linkRowTextDisabled]} numberOfLines={1}>
                    {linkControlDisabled ? 'None' : linkedLabel}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={UI_COLORS.neutralTextSoft} />
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.errorText}>{errorText ?? ' '}</Text>

            <View style={styles.footerRow}>
              {mode === 'edit' ? (
                <Pressable
                  accessibilityLabel="Delete block"
                  style={[styles.secondaryButton, styles.deleteButton]}
                  onPress={onDelete}>
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityLabel={mode === 'create' ? 'Add block' : 'Save block'}
                style={[styles.primaryButton, saveDisabled && styles.primaryButtonDisabled]}
                onPress={onSave}
                disabled={saveDisabled}>
                <Text style={styles.primaryButtonText}>{mode === 'create' ? 'Add Block' : 'Save Block'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={linkPickerVisible}
        onRequestClose={() => setLinkPickerVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <Pressable style={styles.pickerDismissLayer} onPress={() => setLinkPickerVisible(false)} />
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Link Actual Block</Text>
            <Pressable
              accessibilityLabel="Unlink planned block"
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
                    accessibilityLabel={`Link to ${option.title}`}
                    style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                    onPress={() => {
                      onChangeLinkedPlannedId(option.id);
                      setLinkPickerVisible(false);
                    }}>
                    <Text style={[styles.pickerRowTitle, selected && styles.pickerRowTitleSelected]}>
                      {option.title}
                    </Text>
                    <Text style={styles.pickerRowTime}>
                      {formatHHMM(option.startMin)}-{formatHHMM(option.endMin)}
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
              {pickerType === 'duration'
                ? 'Duration'
                : pickerType === 'endTime'
                  ? 'End Time'
                  : 'Start Time'}
            </Text>
            {pickerType === 'duration' ? (
              <View style={styles.pickerWheelWrap}>
                <Picker
                  selectedValue={wheelDuration}
                  onValueChange={(nextDuration) => {
                    setWheelDuration(Number(nextDuration));
                    applyStartAndDuration(timeState.startMin, Number(nextDuration));
                  }}>
                  {DURATION_OPTIONS.map((value) => (
                    <Picker.Item key={`duration-wheel-${value}`} label={toDurationLabel(value)} value={value} />
                  ))}
                </Picker>
              </View>
            ) : (
              <View style={styles.pickerWheelRow}>
                <View style={styles.pickerWheelColumn}>
                  <Picker
                    selectedValue={wheelHour}
                    onValueChange={(nextHour) => {
                      const value = Number(nextHour);
                      setWheelHour(value);
                      applyWheelTime(pickerType === 'endTime' ? 'end' : 'start', value, wheelMinute, wheelPeriod);
                    }}>
                    {Array.from({ length: 12 }, (_, index) => (
                      <Picker.Item key={`hour-wheel-${index + 1}`} label={String(index + 1)} value={index + 1} />
                    ))}
                  </Picker>
                </View>
                <View style={styles.pickerWheelColumn}>
                  <Picker
                    selectedValue={wheelMinute}
                    onValueChange={(nextMinute) => {
                      const value = Number(nextMinute);
                      setWheelMinute(value);
                      applyWheelTime(pickerType === 'endTime' ? 'end' : 'start', wheelHour, value, wheelPeriod);
                    }}>
                    {START_MINUTE_OPTIONS.map((value) => (
                      <Picker.Item key={`minute-wheel-${value}`} label={String(value).padStart(2, '0')} value={value} />
                    ))}
                  </Picker>
                </View>
                <View style={styles.pickerWheelColumn}>
                  <Picker
                    selectedValue={wheelPeriod}
                    onValueChange={(nextPeriod) => {
                      const value = nextPeriod === 'AM' ? 'AM' : 'PM';
                      setWheelPeriod(value);
                      applyWheelTime(pickerType === 'endTime' ? 'end' : 'start', wheelHour, wheelMinute, value);
                    }}>
                    <Picker.Item label="AM" value="AM" />
                    <Picker.Item label="PM" value="PM" />
                  </Picker>
                </View>
              </View>
            )}
            <Pressable style={styles.pickerDoneButton} onPress={() => setPickerType(null)}>
              <Text style={styles.pickerDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: UI_COLORS.overlay,
    justifyContent: 'flex-end',
  },
  dismissLayer: {
    flex: 1,
  },
  card: {
    backgroundColor: UI_COLORS.surface,
    borderTopLeftRadius: UI_RADIUS.sheet,
    borderTopRightRadius: UI_RADIUS.sheet,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    maxHeight: '90%',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerText: {
    color: UI_COLORS.neutralText,
    fontSize: UI_TYPE.section,
    fontWeight: '800',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: UI_COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formBody: {
    gap: 10,
    paddingBottom: 8,
  },
  label: {
    fontSize: UI_TYPE.body,
    color: UI_COLORS.neutralText,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: UI_COLORS.neutralText,
    backgroundColor: UI_COLORS.surface,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryChip: {
    width: '48%',
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingVertical: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: UI_COLORS.surface,
  },
  categoryChipSelected: {
    borderColor: UI_COLORS.neutralText,
    backgroundColor: '#F9FAFB',
  },
  categoryChipText: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  categoryChipTextSelected: {
    color: UI_COLORS.neutralText,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  typeChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: UI_COLORS.surface,
  },
  typeChipSelected: {
    borderColor: UI_COLORS.neutralText,
    backgroundColor: '#F9FAFB',
  },
  typeChipText: {
    color: UI_COLORS.neutralTextSoft,
    fontWeight: '700',
  },
  typeChipTextSelected: {
    color: UI_COLORS.neutralText,
  },
  timeTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeControlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  startControlGroup: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dropdown: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: UI_COLORS.surface,
  },
  dropdownMinute: {
    width: 76,
    minHeight: 42,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: UI_COLORS.surface,
  },
  durationControl: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: UI_COLORS.surface,
  },
  dropdownText: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  timeColon: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 16,
    fontWeight: '700',
  },
  errorText: {
    minHeight: 18,
    color: '#B91C1C',
    fontSize: UI_TYPE.caption,
  },
  linkSection: {
    gap: 6,
    marginTop: 2,
  },
  linkRow: {
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: UI_COLORS.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  linkRowDisabled: {
    backgroundColor: UI_COLORS.surfaceMuted,
  },
  linkRowText: {
    flex: 1,
    color: UI_COLORS.neutralText,
    fontSize: 13,
  },
  linkRowTextDisabled: {
    color: '#94A3B8',
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  secondaryButton: {
    borderRadius: UI_RADIUS.control,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: UI_COLORS.surfaceMuted,
  },
  deleteButton: {
    backgroundColor: '#FEE2E2',
  },
  deleteButtonText: {
    color: '#991B1B',
    fontWeight: '700',
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: UI_RADIUS.control,
    backgroundColor: UI_COLORS.neutralText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: '#C7CDD6',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  pickerBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: UI_COLORS.overlay,
  },
  pickerDismissLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  pickerCard: {
    backgroundColor: UI_COLORS.surface,
    borderRadius: UI_RADIUS.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    maxHeight: '70%',
  },
  pickerTitle: {
    color: UI_COLORS.neutralText,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
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
    backgroundColor: UI_COLORS.surfaceMuted,
  },
  pickerDoneText: {
    color: UI_COLORS.neutralText,
    fontWeight: '600',
    fontSize: 13,
  },
  pickerRow: {
    borderRadius: UI_RADIUS.control,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: UI_COLORS.surface,
    marginBottom: 6,
  },
  pickerRowSelected: {
    borderColor: UI_COLORS.neutralText,
    backgroundColor: '#F9FAFB',
  },
  pickerRowTitle: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  pickerRowTitleSelected: {
    color: UI_COLORS.neutralText,
  },
  pickerRowTime: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: UI_TYPE.caption,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
});
