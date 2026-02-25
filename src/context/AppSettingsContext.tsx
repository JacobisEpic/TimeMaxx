import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { clearAllBlocks, getMetaValue, setMetaValue } from '@/src/storage/blocksDb';

export type AppSettings = {
  plannedScanStartMin: number;
  actualScanStartMin: number;
  dimInsteadOfHide: boolean;
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
};

const META_KEYS = {
  plannedScanStartMin: 'settings_planned_scan_start_min',
  actualScanStartMin: 'settings_actual_scan_start_min',
  dimInsteadOfHide: 'settings_dim_instead_of_hide',
} as const;

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
    const [plannedRaw, actualRaw, dimRaw] = await Promise.all([
      getMetaValue(META_KEYS.plannedScanStartMin),
      getMetaValue(META_KEYS.actualScanStartMin),
      getMetaValue(META_KEYS.dimInsteadOfHide),
    ]);

    setSettings({
      plannedScanStartMin: parseMinuteSetting(plannedRaw, DEFAULT_SETTINGS.plannedScanStartMin),
      actualScanStartMin: parseMinuteSetting(actualRaw, DEFAULT_SETTINGS.actualScanStartMin),
      dimInsteadOfHide: parseBooleanSetting(dimRaw, DEFAULT_SETTINGS.dimInsteadOfHide),
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
