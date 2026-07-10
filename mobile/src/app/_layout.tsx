import { Stack } from 'expo-router';

import { AppProviders } from '@/composition/AppProviders';

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack screenOptions={{ headerShown: false }} />
    </AppProviders>
  );
}
