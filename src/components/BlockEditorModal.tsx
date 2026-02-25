import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { TAG_CATALOG } from '@/src/constants/tags';
import type { Lane } from '@/src/types/blocks';

type BlockEditorModalProps = {
  visible: boolean;
  mode: 'create' | 'edit';
  lane: Lane;
  titleValue: string;
  selectedTags: string[];
  startValue: string;
  endValue: string;
  errorText: string | null;
  onChangeTitle: (value: string) => void;
  onToggleTag: (tag: string) => void;
  onChangeStart: (value: string) => void;
  onChangeEnd: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
};

export function BlockEditorModal({
  visible,
  mode,
  lane,
  titleValue,
  selectedTags,
  startValue,
  endValue,
  errorText,
  onChangeTitle,
  onToggleTag,
  onChangeStart,
  onChangeEnd,
  onCancel,
  onSave,
  onDelete,
}: BlockEditorModalProps) {
  const unknownTags = useMemo(
    () => selectedTags.filter((tag) => !TAG_CATALOG.includes(tag as (typeof TAG_CATALOG)[number])),
    [selectedTags]
  );

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.headerText}>
            {mode === 'create' ? `Add ${lane === 'planned' ? 'Planned' : 'Actual'} Block` : 'Edit Block'}
          </Text>

          <Text style={styles.label}>Title</Text>
          <TextInput
            value={titleValue}
            onChangeText={onChangeTitle}
            placeholder="Title"
            style={styles.input}
            accessibilityLabel="Block title"
          />

          <Text style={styles.label}>Tags</Text>
          <View style={styles.tagsWrap}>
            {TAG_CATALOG.map((tag) => {
              const selected = selectedTags.includes(tag);

              return (
                <Pressable
                  key={tag}
                  accessibilityLabel={`Toggle tag ${tag}`}
                  style={[styles.tagChip, selected && styles.tagChipSelected]}
                  onPress={() => onToggleTag(tag)}>
                  <Text style={[styles.tagChipText, selected && styles.tagChipTextSelected]}>{tag}</Text>
                </Pressable>
              );
            })}
            {unknownTags.map((tag) => (
              <Pressable
                key={`unknown-${tag}`}
                accessibilityLabel={`Remove unknown tag ${tag}`}
                style={[styles.tagChip, styles.unknownTagChip]}
                onPress={() => onToggleTag(tag)}>
                <Text style={styles.unknownTagChipText}>{tag}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.timeRow}>
            <View style={styles.timeCol}>
              <Text style={styles.label}>Start (HH:MM)</Text>
              <TextInput
                value={startValue}
                onChangeText={onChangeStart}
                placeholder="08:00"
                keyboardType="numbers-and-punctuation"
                style={styles.input}
                accessibilityLabel="Block start time"
              />
            </View>

            <View style={styles.timeCol}>
              <Text style={styles.label}>End (HH:MM)</Text>
              <TextInput
                value={endValue}
                onChangeText={onChangeEnd}
                placeholder="09:00"
                keyboardType="numbers-and-punctuation"
                style={styles.input}
                accessibilityLabel="Block end time"
              />
            </View>
          </View>

          <Text style={styles.errorText}>{errorText ?? ' '}</Text>

          <View style={styles.footerRow}>
            <Pressable
              accessibilityLabel="Cancel editing block"
              style={[styles.button, styles.secondaryButton]}
              onPress={onCancel}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>

            {mode === 'edit' ? (
              <Pressable
                accessibilityLabel="Delete block"
                style={[styles.button, styles.deleteButton]}
                onPress={onDelete}>
                <Text style={styles.deleteButtonText}>Delete</Text>
              </Pressable>
            ) : null}

            <Pressable accessibilityLabel="Save block" style={[styles.button, styles.primaryButton]} onPress={onSave}>
              <Text style={styles.primaryButtonText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 8,
  },
  headerText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F8FAFC',
  },
  tagChipSelected: {
    borderColor: '#0F172A',
    backgroundColor: '#0F172A',
  },
  tagChipText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  tagChipTextSelected: {
    color: '#FFFFFF',
  },
  unknownTagChip: {
    borderColor: '#94A3B8',
    backgroundColor: '#E2E8F0',
  },
  unknownTagChipText: {
    color: '#1E293B',
    fontSize: 12,
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  timeCol: {
    flex: 1,
    gap: 6,
  },
  errorText: {
    minHeight: 18,
    color: '#B91C1C',
    fontSize: 12,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  button: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#0F172A',
    flex: 1,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#F1F5F9',
  },
  secondaryButtonText: {
    color: '#0F172A',
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#FEE2E2',
  },
  deleteButtonText: {
    color: '#991B1B',
    fontWeight: '600',
  },
});
