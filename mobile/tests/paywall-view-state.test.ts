import { expect, test } from 'bun:test';

import { paywallViewState } from '../src/features/billing/screens/paywall-view-state';

const signedInSubscriber = {
  isBillingMounted: true,
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

test('the shipped state explains itself: billing is not mounted at all', () => {
  // This is what every project sees until it follows docs/IAP.md, so it must win over the
  // store-unavailable and purchase branches rather than showing a dead buy button.
  expect(paywallViewState({ ...signedInSubscriber, isBillingMounted: false })).toBe('billing-off');
  expect(
    paywallViewState({
      ...signedInSubscriber,
      isBillingMounted: false,
      isStoreSupported: false,
      isSubscribed: false,
    }),
  ).toBe('billing-off');
});

test('an unmounted provider still yields to session resolution and sign-in', () => {
  expect(
    paywallViewState({ ...signedInSubscriber, isBillingMounted: false, isBootstrapping: true }),
  ).toBe('loading');
  expect(
    paywallViewState({ ...signedInSubscriber, isBillingMounted: false, isSignedIn: false }),
  ).toBe('signed-out');
});
