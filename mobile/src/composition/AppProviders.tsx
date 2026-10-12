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
import { AvatarProvider, createExpoAvatarPicker } from '@/features/avatar';
import { IapProvider, type BillingApiPort } from '@/features/billing';
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
import { uploadFileAccessForPlatform } from './upload-file-access';

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
  const [uploads] = useState(() => uploadFileAccessForPlatform(Platform.OS));
  const [avatarPicker] = useState(() => createExpoAvatarPicker(uploads));
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
        <OptionalBillingProvider api={apis.billing}>
        <AvatarProvider api={apis.avatar} picker={avatarPicker} send={uploads.send}>
          <PushNotificationsProvider
            api={apis.notifications}
            registrationCoordinator={pushRegistrationCoordinator}>
            {children}
          </PushNotificationsProvider>
        </AvatarProvider>
        </OptionalBillingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function OptionalBillingProvider({ api, children }: PropsWithChildren<{ api: BillingApiPort }>) {
  return process.env.EXPO_PUBLIC_BILLING_ENABLED === 'true'
    ? <IapProvider api={api}>{children}</IapProvider>
    : children;
}
