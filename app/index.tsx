import { Redirect } from 'expo-router';
import React from 'react';

export default function IndexRoute() {
  return <Redirect href="/(tabs)" />;
}
