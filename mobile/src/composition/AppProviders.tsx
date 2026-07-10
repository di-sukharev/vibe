import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { Platform } from 'react-native';

import {
  AuthProvider,
  clearStoredRefreshToken,
  getStoredRefreshToken,
  setStoredRefreshToken,
} from '@/features/auth';
import { IapProvider } from '@/features/billing';
import {
  PushNotificationsProvider,
  clearPendingExpoPushTokenCleanup,
  clearStoredExpoPushToken,
  getKnownExpoPushTokens,
  getStoredExpoPushToken,
  markStoredExpoPushTokenForCleanup,
  setPendingExpoPushTokenCleanup,
  unregisterStoredExpoPushToken,
} from '@/features/notifications';
import { createMobileApis, SessionController } from './api';
import { authTransportForPlatform } from './auth-transport';

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
      }),
  );
  const [session] = useState(() => new SessionController());
  const [apis] = useState(() =>
    createMobileApis({
      authTransport: authTransportForPlatform(Platform.OS),
      clearRefreshToken: clearStoredRefreshToken,
      getRefreshToken: getStoredRefreshToken,
      session,
      setRefreshToken: setStoredRefreshToken,
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        api={apis.auth}
        logoutSupport={{
          clearPendingExpoPushTokenCleanup,
          clearStoredExpoPushToken,
          getKnownExpoPushTokens,
          getStoredExpoPushToken,
          markStoredExpoPushTokenForCleanup,
          setPendingExpoPushTokenCleanup,
          unregisterStoredExpoPushToken: (options) =>
            unregisterStoredExpoPushToken(apis.notifications, options),
        }}
        session={session}
      >
        <IapProvider api={apis.billing}>
          <PushNotificationsProvider api={apis.notifications}>
            {children}
          </PushNotificationsProvider>
        </IapProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
