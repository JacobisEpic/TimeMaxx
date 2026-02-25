import { Stack } from 'expo-router';
import React from 'react';

import { AppSettingsProvider } from '@/src/context/AppSettingsContext';

export default function TabLayout() {
  return (
    <AppSettingsProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'modal' }} />
      </Stack>
    </AppSettingsProvider>
  );
}
