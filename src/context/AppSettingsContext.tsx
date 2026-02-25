import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { clearAllBlocks, getMetaValue, setMetaValue } from '@/src/storage/blocksDb';

export type AppSettings = {
  plannedScanStartMin: number;
  actualScanStartMin: number;
  dimInsteadOfHide: boolean;
  categories: Array<{ id: string; label: string; color: string }>;
};

type AppSettingsContextValue = {
  settings: AppSettings;
  loading: boolean;
  dataVersion: number;
  refreshSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  resetAllData: () => Promise<void>;
};

const DEFAULT_SETTINGS: AppSettings = {
  plannedScanStartMin: 9 * 60,
  actualScanStartMin: 12 * 60,
  dimInsteadOfHide: false,
  categories: [
    { id: 'work', label: 'Work', color: '#3B82F6' },
    { id: 'focus', label: 'Deep Focus', color: '#8B5CF6' },
    { id: 'health', label: 'Workout', color: '#22C55E' },
    { id: 'meeting', label: 'Meeting', color: '#0EA5A4' },
    { id: 'personal', label: 'Personal', color: '#14B8A6' },
    { id: 'break', label: 'Break', color: '#F59E0B' },
    { id: 'admin', label: 'Admin', color: '#94A3B8' },
  ],
};

const META_KEYS = {
  plannedScanStartMin: 'settings_planned_scan_start_min',
  actualScanStartMin: 'settings_actual_scan_start_min',
  dimInsteadOfHide: 'settings_dim_instead_of_hide',
  categories: 'settings_categories',
} as const;

function normalizeCategoryId(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return normalized || 'category';
}

function parseCategoriesSetting(
  rawValue: string | null,
  fallback: AppSettings['categories']
): AppSettings['categories'] {
  if (!rawValue) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return fallback;
    }

    const sanitized = parsed
      .map((item) => {
        if (typeof item !== 'object' || item === null) {
          return null;
        }

        const id = normalizeCategoryId(String((item as { id?: unknown }).id ?? ''));
        const label = String((item as { label?: unknown }).label ?? '').trim();
        const color = String((item as { color?: unknown }).color ?? '').trim();

        if (!id || !label || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
          return null;
        }

        return { id, label, color };
      })
      .filter((item): item is { id: string; label: string; color: string } => item !== null);

    return sanitized.length ? sanitized : fallback;
  } catch {
    return fallback;
  }
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function parseMinuteSetting(rawValue: string | null, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(24 * 60, Math.round(parsed / 15) * 15));
}

function parseBooleanSetting(rawValue: string | null, fallback: boolean): boolean {
  if (rawValue === null) {
    return fallback;
  }

  return rawValue === '1';
}

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);

  const refreshSettings = useCallback(async () => {
    const [plannedRaw, actualRaw, dimRaw, categoriesRaw] = await Promise.all([
      getMetaValue(META_KEYS.plannedScanStartMin),
      getMetaValue(META_KEYS.actualScanStartMin),
      getMetaValue(META_KEYS.dimInsteadOfHide),
      getMetaValue(META_KEYS.categories),
    ]);

    setSettings({
      plannedScanStartMin: parseMinuteSetting(plannedRaw, DEFAULT_SETTINGS.plannedScanStartMin),
      actualScanStartMin: parseMinuteSetting(actualRaw, DEFAULT_SETTINGS.actualScanStartMin),
      dimInsteadOfHide: parseBooleanSetting(dimRaw, DEFAULT_SETTINGS.dimInsteadOfHide),
      categories: parseCategoriesSetting(categoriesRaw, DEFAULT_SETTINGS.categories),
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refreshSettings();
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshSettings]);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const nextSettings = {
        ...settings,
        ...patch,
      };

      await Promise.all([
        setMetaValue(META_KEYS.plannedScanStartMin, String(nextSettings.plannedScanStartMin)),
        setMetaValue(META_KEYS.actualScanStartMin, String(nextSettings.actualScanStartMin)),
        setMetaValue(META_KEYS.dimInsteadOfHide, nextSettings.dimInsteadOfHide ? '1' : '0'),
        setMetaValue(META_KEYS.categories, JSON.stringify(nextSettings.categories)),
      ]);

      setSettings(nextSettings);
    },
    [settings]
  );

  const resetAllData = useCallback(async () => {
    await clearAllBlocks();
    setDataVersion((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({
      settings,
      loading,
      dataVersion,
      refreshSettings,
      updateSettings,
      resetAllData,
    }),
    [settings, loading, dataVersion, refreshSettings, updateSettings, resetAllData]
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings(): AppSettingsContextValue {
  const value = useContext(AppSettingsContext);

  if (!value) {
    throw new Error('useAppSettings must be used within AppSettingsProvider');
  }

  return value;
}
