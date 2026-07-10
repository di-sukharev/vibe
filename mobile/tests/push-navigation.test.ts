import { expect, test } from 'bun:test';

import { isSafeInternalHref, resolveNotificationHref } from '../src/features/notifications/push-navigation';

test('resolveNotificationHref accepts only internal Expo Router paths', () => {
  expect(resolveNotificationHref({ href: '/details/components' })).toBe('/details/components');
  expect(resolveNotificationHref({ href: ' /paywall ' })).toBe('/paywall');
  expect(resolveNotificationHref({ href: 'https://example.com' })).toBeNull();
  expect(resolveNotificationHref({ href: '//example.com' })).toBeNull();
  expect(resolveNotificationHref({ href: 'mailto:user@example.com' })).toBeNull();
  expect(resolveNotificationHref({ href: '/bad\\path' })).toBeNull();
  expect(resolveNotificationHref({ screen: '/details/components' })).toBeNull();
});

test('isSafeInternalHref enforces length and scheme constraints', () => {
  expect(isSafeInternalHref('/')).toBe(true);
  expect(isSafeInternalHref(`/${'a'.repeat(300)}`)).toBe(false);
  expect(isSafeInternalHref('')).toBe(false);
  expect(isSafeInternalHref('mobile://details')).toBe(false);
});
