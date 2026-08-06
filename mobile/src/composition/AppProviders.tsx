import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

import {
  AuthProvider,
  clearPendingLogout,
  clearStoredRefreshToken,
  getPendingLogout,
  getStoredRefreshToken,
  markPendingLogout,
  setStoredRefreshToken,
} from '@/features/auth';
// capability:billing:start
import { IapProvider } from '@/features/billing';
// capability:billing:end
import {
  PushNotificationsProvider,
  PushRegistrationCoordinator,
  clearPendingExpoPushTokenCleanup,
  clearStoredExpoPushToken,
  getKnownExpoPushTokens,
  getStoredExpoPushToken,
  markStoredExpoPushTokenForCleanup,
  setPendingExpoPushTokenCleanup,
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
  const [session] = useState(() => new SessionController({
    clearLogoutIntent: clearPendingLogout,
    clearRefreshToken: clearStoredRefreshToken,
    getLogoutIntent: getPendingLogout,
    getRefreshToken: getStoredRefreshToken,
    setLogoutIntent: markPendingLogout,
    setRefreshToken: setStoredRefreshToken,
  }));
  const [pushRegistrationCoordinator] = useState(() => new PushRegistrationCoordinator());
  const [apis] = useState(() =>
    createMobileApis({
      authTransport: authTransportForPlatform(Platform.OS),
      session,
    }),
  );
  const logoutSupport = useMemo(() => ({
    clearPendingExpoPushTokenCleanup,
    clearStoredExpoPushToken,
    drainPushRegistrations: () => pushRegistrationCoordinator.drain(),
    getKnownExpoPushTokens,
    getStoredExpoPushToken,
    markStoredExpoPushTokenForCleanup,
    setPendingExpoPushTokenCleanup,
  }), [pushRegistrationCoordinator]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        api={apis.auth}
        logoutSupport={logoutSupport}
        session={session}
      >
        <IapProvider api={apis.billing}>
          <PushNotificationsProvider
            api={apis.notifications}
            registrationCoordinator={pushRegistrationCoordinator}>
            {children}
          </PushNotificationsProvider>
        </IapProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
