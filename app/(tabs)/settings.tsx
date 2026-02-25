import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useAppSettings } from '@/src/context/AppSettingsContext';
import { formatHHMM } from '@/src/utils/time';

const MINUTES_PER_DAY = 24 * 60;
const STEP_MINUTES = 15;
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

function clampMinute(value: number): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(value / STEP_MINUTES) * STEP_MINUTES));
}

function normalizeCategoryId(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return normalized || 'category';
}

export default function SettingsScreen() {
  const { settings, updateSettings, resetAllData } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryColor, setCategoryColor] = useState(CATEGORY_COLORS[0]);

  const plannedLabel = useMemo(() => formatHHMM(settings.plannedScanStartMin), [settings.plannedScanStartMin]);
  const actualLabel = useMemo(() => formatHHMM(settings.actualScanStartMin), [settings.actualScanStartMin]);

  const adjustScanTime = async (
    key: 'plannedScanStartMin' | 'actualScanStartMin',
    delta: number
  ) => {
    setSaving(true);

    try {
      const current = settings[key];
      await updateSettings({ [key]: clampMinute(current + delta) });
    } catch {
      Alert.alert('Settings error', 'Could not update scan time.');
    } finally {
      setSaving(false);
    }
  };

  const toggleDimMode = async (value: boolean) => {
    setSaving(true);

    try {
      await updateSettings({ dimInsteadOfHide: value });
    } catch {
      Alert.alert('Settings error', 'Could not update dim mode setting.');
    } finally {
      setSaving(false);
    }
  };

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

  const updateCategoryColor = async (id: string, color: string) => {
    setSaving(true);
    try {
      await updateSettings({
        categories: settings.categories.map((item) => (item.id === id ? { ...item, color } : item)),
      });
    } catch {
      Alert.alert('Settings error', 'Could not update category color.');
    } finally {
      setSaving(false);
    }
  };

  const confirmResetAllData = () => {
    Alert.alert(
      'Reset all data',
      'This will permanently delete all planned and actual blocks on every day. This cannot be undone.',
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Default start scan time (planned)</Text>
        <View style={styles.row}>
          <Pressable
            accessibilityLabel="Decrease planned scan time"
            style={styles.adjustButton}
            onPress={() => {
              void adjustScanTime('plannedScanStartMin', -STEP_MINUTES);
            }}
            disabled={saving}>
            <Text style={styles.adjustButtonText}>-15m</Text>
          </Pressable>
          <Text style={styles.valueText}>{plannedLabel}</Text>
          <Pressable
            accessibilityLabel="Increase planned scan time"
            style={styles.adjustButton}
            onPress={() => {
              void adjustScanTime('plannedScanStartMin', STEP_MINUTES);
            }}
            disabled={saving}>
            <Text style={styles.adjustButtonText}>+15m</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Default start scan time (actual)</Text>
        <View style={styles.row}>
          <Pressable
            accessibilityLabel="Decrease actual scan time"
            style={styles.adjustButton}
            onPress={() => {
              void adjustScanTime('actualScanStartMin', -STEP_MINUTES);
            }}
            disabled={saving}>
            <Text style={styles.adjustButtonText}>-15m</Text>
          </Pressable>
          <Text style={styles.valueText}>{actualLabel}</Text>
          <Pressable
            accessibilityLabel="Increase actual scan time"
            style={styles.adjustButton}
            onPress={() => {
              void adjustScanTime('actualScanStartMin', STEP_MINUTES);
            }}
            disabled={saving}>
            <Text style={styles.adjustButtonText}>+15m</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Dim instead of hide</Text>
          <Switch
            accessibilityLabel="Toggle dim instead of hide"
            value={settings.dimInsteadOfHide}
            onValueChange={(value) => {
              void toggleDimMode(value);
            }}
            disabled={saving}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <View style={styles.categoryList}>
          {settings.categories.map((category) => (
            <View key={category.id} style={styles.categoryRow}>
              <View style={styles.categoryMain}>
                <View style={[styles.colorDot, { backgroundColor: category.color }]} />
                <Text style={styles.categoryName}>{category.label}</Text>
              </View>
              <View style={styles.categoryActions}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorRow}>
                  {CATEGORY_COLORS.map((color) => {
                    const selected = color === category.color;

                    return (
                      <Pressable
                        key={`${category.id}-${color}`}
                        accessibilityLabel={`Set ${category.label} color`}
                        style={[styles.colorChoice, { backgroundColor: color }, selected && styles.colorChoiceSelected]}
                        disabled={saving}
                        onPress={() => {
                          void updateCategoryColor(category.id, color);
                        }}
                      />
                    );
                  })}
                </ScrollView>
                <Pressable
                  accessibilityLabel={`Remove ${category.label} category`}
                  style={styles.removeButton}
                  disabled={saving}
                  onPress={() => {
                    void removeCategory(category.id);
                  }}>
                  <Text style={styles.removeButtonText}>Remove</Text>
                </Pressable>
              </View>
            </View>
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
          <Pressable accessibilityLabel="Add category" style={styles.addCategoryButton} onPress={() => void addCategory()}>
            <Text style={styles.addCategoryButtonText}>Add category</Text>
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
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  categoryList: {
    gap: 10,
  },
  categoryRow: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  categoryMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  categoryActions: {
    gap: 8,
  },
  colorRow: {
    gap: 8,
  },
  colorChoice: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  colorChoiceSelected: {
    borderColor: '#0F172A',
    borderWidth: 2,
  },
  removeButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FEF2F2',
  },
  removeButtonText: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '600',
  },
  addCategoryForm: {
    marginTop: 4,
    gap: 8,
  },
  categoryInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
  },
  addCategoryButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  addCategoryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adjustButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  adjustButtonText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '600',
  },
  valueText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  resetButton: {
    borderWidth: 1,
    borderColor: '#B91C1C',
    borderRadius: 8,
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
});
