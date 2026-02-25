import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Keyboard,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { UI_COLORS, UI_RADIUS, UI_TYPE } from '@/src/constants/uiTheme';
import { useAppSettings } from '@/src/context/AppSettingsContext';
import { seedLastNDays } from '@/src/dev/seedData';

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

function normalizeCategoryId(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return normalized || 'category';
}

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, updateSettings, resetAllData, signalDataChanged } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryColor, setCategoryColor] = useState(CATEGORY_COLORS[0]);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [editingCategoryColor, setEditingCategoryColor] = useState(CATEGORY_COLORS[0]);

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
      'This will permanently delete all plan and done blocks on every day. This cannot be undone.',
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
                Alert.alert('Data reset', 'All blocks were deleted.');
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
                  <Text style={styles.debugButtonText}>Populate 7 days of sample data</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Populate calendar with sample data for 30 days"
                  style={styles.debugButton}
                  onPress={() => confirmSeedData(30)}
                  disabled={saving}>
                  <Text style={styles.debugButtonText}>Populate 30 days of sample data</Text>
                </Pressable>
              </View>
            ) : null}
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
                  disabled={saving || !editingCategoryId}
                  onPress={() => {
                    if (editingCategoryId) {
                      void removeCategory(editingCategoryId);
                      closeCategoryEditor();
                    }
                  }}>
                  <Text style={styles.editorDeleteButtonText}>Delete</Text>
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
