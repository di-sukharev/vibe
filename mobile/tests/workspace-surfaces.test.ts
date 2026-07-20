import { expect, test } from 'bun:test';

import {
  formatSubscriptionPlatform,
  formatSubscriptionState,
} from '../src/features/billing/components/subscription-summary-model';

test('subscription summary turns backend states into compact account copy', () => {
  expect(formatSubscriptionState('billing_grace_period')).toBe(
    'Billing grace period',
  );
  expect(formatSubscriptionState('inactive')).toBe('Inactive');
  expect(formatSubscriptionPlatform('ios')).toBe('App Store');
  expect(formatSubscriptionPlatform('android')).toBe('Google Play');
  expect(formatSubscriptionPlatform(null)).toBe('Not connected');
});
