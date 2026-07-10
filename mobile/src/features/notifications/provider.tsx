import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import type * as Notifications from 'expo-notifications';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/features/auth';
import type { NotificationsApiPort } from './api';
import {
  clearPendingExpoPushTokenCleanup,
  getPendingExpoPushTokenCleanup,
  getPendingExpoPushTokenCleanupTokens,
  getStoredExpoPushToken,
  setPendingExpoPushTokenCleanup,
  setStoredExpoPushToken,
  unregisterStoredExpoPushToken,
} from './push-token-store';
import { shouldEnablePushNotifications } from './push-notification-settings';
import { resolveNotificationHref } from './push-navigation';
import {
  cleanupExpoPushRegistrationAfterPermissionDenied,
  syncExpoPushTokenRegistration,
} from './push-registration';

type PushNotificationsContextValue = {
  error: string | null;
  expoPushToken: string | null;
  isEnabled: boolean;
};

const PushNotificationsContext = createContext<PushNotificationsContextValue | null>(null);

export function PushNotificationsProvider({
  api,
  children,
}: PropsWithChildren<{ api: NotificationsApiPort }>) {
  const auth = useAuth();
  const router = useRouter();
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notificationsRef = useRef<typeof Notifications | null>(null);
  const hasConfiguredHandler = useRef(false);
  const lastHandledResponseId = useRef<string | null>(null);
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
    if (!auth.user || !isEnabled || !projectId) return;

    let isCancelled = false;

    async function register() {
      const easProjectId = projectId;
      if (!easProjectId) return;

      setError(null);

      try {
        const notifications = await loadNotifications();
        const existingPermissions = await notifications.getPermissionsAsync();
        const finalStatus =
          existingPermissions.status === 'granted'
            ? existingPermissions.status
            : (await notifications.requestPermissionsAsync()).status;

        if (finalStatus !== 'granted') {
          setError('Push notification permission was not granted');
          setExpoPushToken(null);
          await cleanupExpoPushRegistrationAfterPermissionDenied({
            unregisterStoredExpoPushToken: () =>
              unregisterStoredExpoPushToken(api, { clearStoredOnFailure: true }),
          });
          return;
        }

        if (Platform.OS === 'android') {
          await notifications.setNotificationChannelAsync('default', {
            importance: notifications.AndroidImportance.MAX,
            lightColor: '#208AEF',
            name: 'Default',
            vibrationPattern: [0, 250, 250, 250],
          });
        }

        const tokenResponse = await notifications.getExpoPushTokenAsync({ projectId: easProjectId });
        if (isCancelled) return;

        const nextToken = tokenResponse.data;
        await syncExpoPushTokenRegistration({
          api,
          clearPendingExpoPushTokenCleanup,
          expoPushToken: nextToken,
          getPendingExpoPushTokenCleanup,
          getPendingExpoPushTokenCleanupTokens,
          getStoredExpoPushToken,
          platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null,
          setPendingExpoPushTokenCleanup,
          setStoredExpoPushToken,
        });

        setExpoPushToken(nextToken);
      } catch (registrationError) {
        if (isCancelled) return;
        setError(registrationError instanceof Error ? registrationError.message : 'Push registration failed');
      }
    }

    void register();

    return () => {
      isCancelled = true;
    };
  }, [api, auth.user, isEnabled, loadNotifications, projectId]);

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

      const initialResponse = await notifications.getLastNotificationResponseAsync();
      if (initialResponse && !isCancelled) {
        handleNotificationResponse(initialResponse);
      }
    }

    void listen();

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
