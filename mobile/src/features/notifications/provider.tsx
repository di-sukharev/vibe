import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import type * as Notifications from 'expo-notifications';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/features/auth';
import type { NotificationsApiPort } from './api';
import {
  beginPushInstallationMutation,
  commitPushInstallationRegistration,
  getPendingExpoPushTokenCleanupTokens,
  getPushInstallationRegistration,
  getStoredExpoPushToken,
  setPendingExpoPushTokenCleanup,
  unregisterStoredExpoPushToken,
} from './push-token-store';
import { shouldEnablePushNotifications } from './push-notification-settings';
import { resolveNotificationHref } from './push-navigation';
import { consumeInitialNotificationResponse } from './notification-response';
import {
  cleanupExpoPushRegistrationAfterPermissionDenied,
  syncExpoPushTokenRegistration,
} from './push-registration';
import type { PushRegistrationCoordinator } from './registration-coordinator';

type PushNotificationsContextValue = {
  error: string | null;
  expoPushToken: string | null;
  isEnabled: boolean;
};

const PushNotificationsContext = createContext<PushNotificationsContextValue | null>(null);

export function PushNotificationsProvider({
  api,
  children,
  registrationCoordinator,
}: PropsWithChildren<{
  api: NotificationsApiPort;
  registrationCoordinator: PushRegistrationCoordinator;
}>) {
  const auth = useAuth();
  const accountScope = auth.accountScope;
  const isAccountScopeCurrent = auth.isAccountScopeCurrent;
  const router = useRouter();
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notificationsRef = useRef<typeof Notifications | null>(null);
  const hasConfiguredHandler = useRef(false);
  const lastHandledResponseId = useRef<string | null>(null);
  const launchValidatedAccountScopes = useRef(new Set<string>());
  const projectId = getExpoProjectId();
  const isEnabled = shouldEnablePushNotifications({
    disablePushNotifications: process.env.EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS,
    e2e: process.env.EXPO_PUBLIC_E2E,
    isDevice: Device.isDevice,
    platformOS: Platform.OS,
    projectId,
  });

  const loadNotifications = useCallback(async () => {
    if (notificationsRef.current) return notificationsRef.current;

    const module = await import('expo-notifications');
    notificationsRef.current = module;

    if (!hasConfiguredHandler.current) {
      module.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      hasConfiguredHandler.current = true;
    }

    return module;
  }, []);

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (responseId && responseId === lastHandledResponseId.current) return;
      if (responseId) lastHandledResponseId.current = responseId;

      const href = resolveNotificationHref(response.notification.request.content.data);
      if (!href) return;

      router.push(href);
    },
    [router],
  );

  useEffect(() => {
    if (!auth.user || !isEnabled) {
      setExpoPushToken(null);
    }
  }, [auth.user, isEnabled]);

  useEffect(() => {
    if (!accountScope || auth.isTransitioning || !isEnabled || !projectId) return;

    let isCancelled = false;
    const registrationUserId = accountScope.userId;
    const accountScopeKey = `${accountScope.generation}:${registrationUserId}`;
    const isRegistrationCancelled = () =>
      isCancelled || !isAccountScopeCurrent(accountScope);

    async function register() {
      const easProjectId = projectId;
      if (!easProjectId || isRegistrationCancelled()) return;

      setError(null);

      try {
        const notifications = await loadNotifications();
        if (isRegistrationCancelled()) return;
        const existingPermissions = await notifications.getPermissionsAsync();
        if (isRegistrationCancelled()) return;
        const finalStatus =
          existingPermissions.status === 'granted'
            ? existingPermissions.status
            : (await notifications.requestPermissionsAsync()).status;
        if (isRegistrationCancelled()) return;

        if (finalStatus !== 'granted') {
          if (isRegistrationCancelled()) return;
          setError('Push notification permission was not granted');
          if (isRegistrationCancelled()) return;
          setExpoPushToken(null);
          if (isRegistrationCancelled()) return;
          await cleanupExpoPushRegistrationAfterPermissionDenied({
            isCancelled: isRegistrationCancelled,
            unregisterStoredExpoPushToken: () =>
              unregisterStoredExpoPushToken(api, {
                clearStoredOnFailure: true,
                isCancelled: isRegistrationCancelled,
              }),
          });
          return;
        }

        if (Platform.OS === 'android') {
          if (isRegistrationCancelled()) return;
          await notifications.setNotificationChannelAsync('default', {
            importance: notifications.AndroidImportance.MAX,
            lightColor: '#208AEF',
            name: 'Default',
            vibrationPattern: [0, 250, 250, 250],
          });
          if (isRegistrationCancelled()) return;
        }

        if (isRegistrationCancelled()) return;
        const tokenResponse = await notifications.getExpoPushTokenAsync({ projectId: easProjectId });
        if (isRegistrationCancelled()) return;

        const nextToken = tokenResponse.data;
        const registration = await syncExpoPushTokenRegistration({
          api,
          beginInstallationMutation: beginPushInstallationMutation,
          completeInstallationRegistration: commitPushInstallationRegistration,
          expoPushToken: nextToken,
          forceRevalidation: !launchValidatedAccountScopes.current.has(accountScopeKey),
          getInstallationRegistration: getPushInstallationRegistration,
          getPendingExpoPushTokenCleanupTokens,
          getStoredExpoPushToken,
          isCancelled: isRegistrationCancelled,
          platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null,
          setPendingExpoPushTokenCleanup: (expoPushToken) =>
            setPendingExpoPushTokenCleanup(expoPushToken, {
              isCancelled: isRegistrationCancelled,
            }),
          userId: registrationUserId,
        });

        if (isRegistrationCancelled()) return;
        if (registration) {
          launchValidatedAccountScopes.current.add(accountScopeKey);
        }
        setExpoPushToken(nextToken);
      } catch (registrationError) {
        if (isRegistrationCancelled()) return;
        setError(registrationError instanceof Error ? registrationError.message : 'Push registration failed');
      }
    }

    void registrationCoordinator.run(register);

    return () => {
      isCancelled = true;
    };
  }, [
    api,
    accountScope,
    auth.isTransitioning,
    isEnabled,
    isAccountScopeCurrent,
    loadNotifications,
    projectId,
    registrationCoordinator,
  ]);

  useEffect(() => {
    if (!isEnabled) return;

    let isCancelled = false;
    let notificationSubscription: Notifications.Subscription | null = null;
    let responseSubscription: Notifications.Subscription | null = null;

    async function listen() {
      const notifications = await loadNotifications();
      if (isCancelled) return;

      notificationSubscription = notifications.addNotificationReceivedListener(() => undefined);
      responseSubscription = notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

      await consumeInitialNotificationResponse({
        clear: notifications.clearLastNotificationResponseAsync,
        get: notifications.getLastNotificationResponseAsync,
        handle: handleNotificationResponse,
        isCancelled: () => isCancelled,
      });
    }

    void listen().catch(() => {
      if (!isCancelled) {
        setError('Push notification listener could not start. Please restart the app.');
      }
    });

    return () => {
      isCancelled = true;
      notificationSubscription?.remove();
      responseSubscription?.remove();
    };
  }, [handleNotificationResponse, isEnabled, loadNotifications]);

  const value = useMemo<PushNotificationsContextValue>(
    () => ({
      error,
      expoPushToken,
      isEnabled,
    }),
    [error, expoPushToken, isEnabled],
  );

  return <PushNotificationsContext.Provider value={value}>{children}</PushNotificationsContext.Provider>;
}

export function usePushNotifications() {
  const context = useContext(PushNotificationsContext);
  if (!context) {
    throw new Error('usePushNotifications must be used inside PushNotificationsProvider');
  }

  return context;
}

function getExpoProjectId() {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return Constants.easConfig?.projectId ?? extra?.eas?.projectId ?? null;
}
