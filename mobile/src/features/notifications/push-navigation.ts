import type { Href } from 'expo-router';

export function resolveNotificationHref(data: unknown): Href | null {
  if (!data || typeof data !== 'object') return null;

  const href = (data as Record<string, unknown>).href;
  if (typeof href !== 'string') return null;

  const trimmed = href.trim();
  if (!isSafeInternalHref(trimmed)) return null;

  return trimmed as Href;
}

export function isSafeInternalHref(value: string) {
  return (
    value.length > 0 &&
    value.length <= 300 &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !/^[a-z][a-z\d+.-]*:/i.test(value)
  );
}
