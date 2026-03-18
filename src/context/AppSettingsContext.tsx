import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { clearAllBlocks, getMetaValue, setMetaValue } from '@/src/storage/blocksDb';

export type AppSettings = {
  plannedScanStartMin: number;
  actualScanStartMin: number;
  dimInsteadOfHide: boolean;
  categories: { id: string; label: string; color: string }[];
  visibleCategoryIds: string[];
};

type AppSettingsContextValue = {
  settings: AppSettings;
  loading: boolean;
  dataVersion: number;
  refreshSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  resetCategoriesToDefault: () => Promise<void>;
  resetAllData: () => Promise<void>;
  signalDataChanged: () => void;
};

export const DEFAULT_CATEGORIES: AppSettings['categories'] = [
  { id: 'health', label: 'Health', color: '#22C55E' },
  { id: 'work', label: 'Work', color: '#3B82F6' },
  { id: 'chores', label: 'Chores', color: '#EC4899' },
  { id: 'hobbies', label: 'Hobbies', color: '#8B5CF6' },
  { id: 'break', label: 'Break', color: '#F59E0B' },
  { id: 'other', label: 'None', color: '#9CA3AF' },
];
const PROTECTED_CATEGORIES: AppSettings['categories'] = [
  { id: 'break', label: 'Break', color: '#F59E0B' },
  { id: 'other', label: 'None', color: '#9CA3AF' },
];

const DEFAULT_SETTINGS: AppSettings = {
  plannedScanStartMin: 9 * 60,
  actualScanStartMin: 12 * 60,
  dimInsteadOfHide: false,
  categories: DEFAULT_CATEGORIES,
  visibleCategoryIds: DEFAULT_CATEGORIES.map((category) => category.id),
};

const META_KEYS = {
  plannedScanStartMin: 'settings_planned_scan_start_min',
  actualScanStartMin: 'settings_actual_scan_start_min',
  dimInsteadOfHide: 'settings_dim_instead_of_hide',
  categories: 'settings_categories',
  visibleCategoryIds: 'settings_visible_category_ids',
} as const;

function normalizeCategoryId(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return normalized || 'category';
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

function parseCategoriesSetting(
  rawValue: string | null,
  fallback: AppSettings['categories']
): AppSettings['categories'] {
  if (!rawValue) {
    return ensureProtectedCategories(fallback);
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return ensureProtectedCategories(fallback);
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

    return ensureProtectedCategories(sanitized.length ? sanitized : fallback);
  } catch {
    return ensureProtectedCategories(fallback);
  }
}

function parseVisibleCategoryIdsSetting(
  rawValue: string | null,
  categories: AppSettings['categories'],
  fallback: string[]
): string[] {
  const allowedIds = new Set(categories.map((category) => category.id));
  const defaultVisible = fallback.filter((id) => allowedIds.has(id));

  if (!rawValue) {
    return defaultVisible.length ? defaultVisible : categories.map((category) => category.id);
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return defaultVisible.length ? defaultVisible : categories.map((category) => category.id);
    }

    const sanitized = parsed
      .map((item) => String(item ?? '').trim().toLowerCase())
      .filter((id, index, self) => id.length > 0 && self.indexOf(id) === index && allowedIds.has(id));

    if (sanitized.length === 0) {
      return defaultVisible.length ? defaultVisible : categories.map((category) => category.id);
    }

    return sanitized;
  } catch {
    return defaultVisible.length ? defaultVisible : categories.map((category) => category.id);
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
    const [plannedRaw, actualRaw, dimRaw, categoriesRaw, visibleCategoryIdsRaw] = await Promise.all([
      getMetaValue(META_KEYS.plannedScanStartMin),
      getMetaValue(META_KEYS.actualScanStartMin),
      getMetaValue(META_KEYS.dimInsteadOfHide),
      getMetaValue(META_KEYS.categories),
      getMetaValue(META_KEYS.visibleCategoryIds),
    ]);
    const categories = parseCategoriesSetting(categoriesRaw, DEFAULT_SETTINGS.categories);

    setSettings({
      plannedScanStartMin: parseMinuteSetting(plannedRaw, DEFAULT_SETTINGS.plannedScanStartMin),
      actualScanStartMin: parseMinuteSetting(actualRaw, DEFAULT_SETTINGS.actualScanStartMin),
      dimInsteadOfHide: parseBooleanSetting(dimRaw, DEFAULT_SETTINGS.dimInsteadOfHide),
      categories,
      visibleCategoryIds: parseVisibleCategoryIdsSetting(
        visibleCategoryIdsRaw,
        categories,
        DEFAULT_SETTINGS.visibleCategoryIds
      ),
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
      nextSettings.categories = ensureProtectedCategories(nextSettings.categories);
      const allowedCategoryIds = new Set(nextSettings.categories.map((category) => category.id));
      const sanitizedVisibleCategoryIds = (nextSettings.visibleCategoryIds ?? [])
        .map((id) => id.trim().toLowerCase())
        .filter((id, index, self) => id.length > 0 && self.indexOf(id) === index && allowedCategoryIds.has(id));
      nextSettings.visibleCategoryIds =
        sanitizedVisibleCategoryIds.length > 0 ? sanitizedVisibleCategoryIds : nextSettings.categories.map((category) => category.id);

      await Promise.all([
        setMetaValue(META_KEYS.plannedScanStartMin, String(nextSettings.plannedScanStartMin)),
        setMetaValue(META_KEYS.actualScanStartMin, String(nextSettings.actualScanStartMin)),
        setMetaValue(META_KEYS.dimInsteadOfHide, nextSettings.dimInsteadOfHide ? '1' : '0'),
        setMetaValue(META_KEYS.categories, JSON.stringify(nextSettings.categories)),
        setMetaValue(META_KEYS.visibleCategoryIds, JSON.stringify(nextSettings.visibleCategoryIds)),
      ]);

      setSettings(nextSettings);
    },
    [settings]
  );

  const resetAllData = useCallback(async () => {
    await Promise.all([
      clearAllBlocks(),
      setMetaValue(META_KEYS.categories, JSON.stringify(DEFAULT_CATEGORIES)),
      setMetaValue(META_KEYS.visibleCategoryIds, JSON.stringify(DEFAULT_SETTINGS.visibleCategoryIds)),
    ]);
    setSettings((current) => ({
      ...current,
      categories: DEFAULT_CATEGORIES,
      visibleCategoryIds: DEFAULT_SETTINGS.visibleCategoryIds,
    }));
    setDataVersion((current) => current + 1);
  }, []);

  const resetCategoriesToDefault = useCallback(async () => {
    await Promise.all([
      setMetaValue(META_KEYS.categories, JSON.stringify(DEFAULT_CATEGORIES)),
      setMetaValue(META_KEYS.visibleCategoryIds, JSON.stringify(DEFAULT_SETTINGS.visibleCategoryIds)),
    ]);
    setSettings((current) => ({
      ...current,
      categories: DEFAULT_CATEGORIES,
      visibleCategoryIds: DEFAULT_SETTINGS.visibleCategoryIds,
    }));
  }, []);

  const signalDataChanged = useCallback(() => {
    setDataVersion((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({
      settings,
      loading,
      dataVersion,
      refreshSettings,
      updateSettings,
      resetCategoriesToDefault,
      resetAllData,
      signalDataChanged,
    }),
    [
      settings,
      loading,
      dataVersion,
      refreshSettings,
      updateSettings,
      resetCategoriesToDefault,
      resetAllData,
      signalDataChanged,
    ]
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
