import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { UI_COLORS, UI_RADIUS, UI_TYPE } from '@/src/constants/uiTheme';
import type { Lane } from '@/src/types/blocks';
import { formatHHMM, parseHHMM } from '@/src/utils/time';

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
  lane: Lane;
  titleValue: string;
  selectedTags: string[];
  startValue: string;
  endValue: string;
  linkedPlannedId: string | null;
  categoryOptions: { id: string; label: string; color: string }[];
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
  { label: 'None', id: 'other', color: '#9CA3AF' },
] as const;

const START_MINUTE_OPTIONS = [0, 15, 30, 45];
const SHEET_VISIBLE_HEIGHT = '86%';

function toTimeLabel(hour24: number, minute: number): string {
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
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

  const resolvedCategoryOptions = useMemo(
    () => (categoryOptions.length ? categoryOptions : [...CATEGORY_OPTIONS]),
    [categoryOptions]
  );
  const unknownTags = useMemo(() => {
    const knownIds = new Set(resolvedCategoryOptions.map((category) => category.id));
    return selectedTags.filter((tag) => !knownIds.has(tag));
  }, [resolvedCategoryOptions, selectedTags]);
  const categoryRenderOptions = useMemo(
    () => [...resolvedCategoryOptions, ...unknownTags.map((tag) => ({ label: tag, id: tag, color: '#94A3B8' }))],
    [resolvedCategoryOptions, unknownTags]
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
          <View style={styles.headerLaneRow}>
            {(['planned', 'actual'] as Lane[]).map((value) => {
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
              placeholderTextColor={UI_COLORS.neutralTextSoft}
            />

            <View style={styles.timeControlRow}>
              <View style={styles.timeColumn}>
                <Text style={styles.label}>Start Time</Text>
                <View style={styles.startControlGroup}>
                  <Pressable style={styles.dropdown} onPress={() => setPickerType('startTime')}>
                    <Text style={styles.dropdownText}>{toTimeLabel(selectedHour, selectedMinute)}</Text>
                    <Ionicons name="chevron-down" size={14} color={UI_COLORS.neutralTextSoft} />
                  </Pressable>
                </View>
              </View>
              <View style={styles.timeColumn}>
                <Text style={styles.label}>End Time</Text>
                <View style={styles.startControlGroup}>
                  <Pressable style={styles.dropdown} onPress={() => setPickerType('endTime')}>
                    <Text style={styles.dropdownText}>{toTimeLabel(selectedEndHour, selectedEndMinute)}</Text>
                    <Ionicons name="chevron-down" size={14} color={UI_COLORS.neutralTextSoft} />
                  </Pressable>
                </View>
              </View>
            </View>

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
                  {lane === 'actual' && selectedCategoryId && selectedCategoryRowIndex === rowIndex ? (
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
                                  {formatHHMM(option.startMin)}-{formatHHMM(option.endMin)}
                                </Text>
                              </View>
                              <Ionicons
                                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                                size={18}
                                color={selected ? UI_COLORS.planned : UI_COLORS.neutralTextSoft}
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
            {lane === 'actual' && !selectedCategoryId ? (
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
              {pickerType === 'endTime' ? 'End Time' : 'Start Time'}
            </Text>
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
    height: SHEET_VISIBLE_HEIGHT,
    backgroundColor: UI_COLORS.surface,
    borderTopLeftRadius: UI_RADIUS.sheet,
    borderTopRightRadius: UI_RADIUS.sheet,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 10,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
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
    marginBottom: 8,
  },
  headerLaneRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  headerLaneChip: {
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: UI_COLORS.surfaceMuted,
  },
  headerLaneChipSelected: {
    backgroundColor: UI_COLORS.surface,
    borderColor: UI_COLORS.neutralText,
  },
  headerLaneChipText: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  headerLaneChipTextSelected: {
    color: UI_COLORS.neutralText,
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
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formBody: {
    gap: 10,
    paddingBottom: 12,
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
  categoryChipSpacer: {
    flex: 1,
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
  timeControlRow: {
    flexDirection: 'row',
    gap: 10,
  },
  timeColumn: {
    flex: 1,
    gap: 6,
  },
  startControlGroup: {
    flexDirection: 'row',
    alignItems: 'center',
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
  dropdownText: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
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
  inlineLinkSection: {
    gap: 6,
    marginTop: 2,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: UI_RADIUS.control,
    padding: 10,
    backgroundColor: UI_COLORS.surface,
  },
  inlineLinkHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlineLinkBrowse: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  inlineLinkOption: {
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: UI_COLORS.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  inlineLinkOptionSelected: {
    borderColor: UI_COLORS.planned,
    backgroundColor: UI_COLORS.plannedTint,
  },
  inlineLinkCopy: {
    flex: 1,
    gap: 1,
  },
  inlineLinkTitle: {
    color: UI_COLORS.neutralText,
    fontSize: 13,
    fontWeight: '600',
  },
  inlineLinkTitleSelected: {
    color: UI_COLORS.neutralText,
  },
  inlineLinkTime: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 11,
    fontWeight: '500',
  },
  inlineLinkEmpty: {
    color: UI_COLORS.neutralTextSoft,
    fontSize: 12,
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
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: UI_COLORS.neutralBorder,
    backgroundColor: UI_COLORS.surface,
  },
  secondaryButton: {
    borderRadius: UI_RADIUS.control,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: UI_COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
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
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
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
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
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
    borderWidth: 1,
    borderColor: UI_COLORS.neutralBorder,
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
