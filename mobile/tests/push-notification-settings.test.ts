import { expect, test } from 'bun:test';

import { shouldEnablePushNotifications } from '../src/features/notifications/push-notification-settings';

const enabledRuntime = {
  isDevice: true,
  platformOS: 'ios',
  projectId: 'eas-project-id',
};

test('shouldEnablePushNotifications disables unsupported push runtimes', () => {
  expect(shouldEnablePushNotifications(enabledRuntime)).toBe(true);
  expect(shouldEnablePushNotifications({ ...enabledRuntime, platformOS: 'web' })).toBe(false);
  expect(shouldEnablePushNotifications({ ...enabledRuntime, isDevice: false })).toBe(false);
  expect(shouldEnablePushNotifications({ ...enabledRuntime, e2e: '1' })).toBe(false);
  expect(shouldEnablePushNotifications({ ...enabledRuntime, disablePushNotifications: '1' })).toBe(false);
  expect(shouldEnablePushNotifications({ ...enabledRuntime, projectId: null })).toBe(false);
  expect(shouldEnablePushNotifications({ ...enabledRuntime, projectId: '' })).toBe(false);
});
