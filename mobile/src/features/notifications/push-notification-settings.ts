export type PushNotificationRuntime = {
  disablePushNotifications?: string;
  e2e?: string;
  isDevice: boolean;
  platformOS: string;
  projectId?: string | null;
};

export function shouldEnablePushNotifications(runtime: PushNotificationRuntime) {
  if (runtime.platformOS === 'web') return false;
  if (!runtime.isDevice) return false;
  if (runtime.e2e === '1') return false;
  if (runtime.disablePushNotifications === '1') return false;
  if (!runtime.projectId) return false;
  return true;
}
