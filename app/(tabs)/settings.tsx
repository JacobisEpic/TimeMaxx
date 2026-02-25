import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useAppSettings } from '@/src/context/AppSettingsContext';
import { formatHHMM } from '@/src/utils/time';

const MINUTES_PER_DAY = 24 * 60;
const STEP_MINUTES = 15;

function clampMinute(value: number): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(value / STEP_MINUTES) * STEP_MINUTES));
}

export default function SettingsScreen() {
  const { settings, updateSettings, resetAllData } = useAppSettings();
  const [saving, setSaving] = useState(false);

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
