import { Stack } from 'expo-router';
import React from 'react';

import { AppSettingsProvider } from '@/src/context/AppSettingsContext';

export default function TabLayout() {
  return (
    <AppSettingsProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="month" options={{ headerShown: false }} />
        <Stack.Screen
          name="settings"
          options={{ headerShown: false, presentation: 'transparentModal', animation: 'slide_from_bottom' }}
        />
      </Stack>
    </AppSettingsProvider>
  );
}
