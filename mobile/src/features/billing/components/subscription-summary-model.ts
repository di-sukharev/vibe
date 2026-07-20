import type { SubscriptionState } from '@web-app-demo/contracts';

export function formatSubscriptionState(state: SubscriptionState) {
  const label = state.replaceAll('_', ' ');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function formatSubscriptionPlatform(platform: 'android' | 'ios' | null) {
  if (platform === 'ios') return 'App Store';
  if (platform === 'android') return 'Google Play';
  return 'Not connected';
}

export function formatSubscriptionDate(expiresAt: string | null) {
  if (!expiresAt) return 'Not available';

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(expiresAt));
}
