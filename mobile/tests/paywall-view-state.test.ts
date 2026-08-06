import { expect, test } from 'bun:test';

import { paywallViewState } from '../src/features/billing/screens/paywall-view-state';

const signedInSubscriber = {
  isBootstrapping: false,
  isSignedIn: true,
  isStoreSupported: true,
  isSubscribed: true,
};

test('an active subscriber sees confirmation, including where the store is unavailable', () => {
  expect(paywallViewState(signedInSubscriber)).toBe('subscribed');
  expect(paywallViewState({ ...signedInSubscriber, isStoreSupported: false })).toBe('subscribed');
});

test('a signed-in non-subscriber gets the purchase surface, or the unsupported notice off-store', () => {
  expect(paywallViewState({ ...signedInSubscriber, isSubscribed: false })).toBe('purchase');
  expect(
    paywallViewState({ ...signedInSubscriber, isStoreSupported: false, isSubscribed: false }),
  ).toBe('unsupported');
});

test('session resolution wins over everything: no flash of a paywall for a subscriber', () => {
  expect(paywallViewState({ ...signedInSubscriber, isBootstrapping: true })).toBe('loading');
  expect(
    paywallViewState({ ...signedInSubscriber, isBootstrapping: true, isSubscribed: false }),
  ).toBe('loading');
});

test('a signed-out visitor is sent away before any billing state is considered', () => {
  expect(paywallViewState({ ...signedInSubscriber, isSignedIn: false })).toBe('signed-out');
  expect(
    paywallViewState({ ...signedInSubscriber, isSignedIn: false, isSubscribed: false }),
  ).toBe('signed-out');
});
