export type PaywallViewState =
  | 'loading'
  | 'signed-out'
  | 'billing-off'
  | 'unsupported'
  | 'subscribed'
  | 'purchase';

// Nothing redirects into or away from the paywall any more, so the screen has to resolve its
// own state. Order matters: an active subscriber must see confirmation even on a build where
// the store is unavailable, otherwise a completed purchase looks like it did nothing.
export function paywallViewState(input: {
  isBillingMounted: boolean;
  isBootstrapping: boolean;
  isSignedIn: boolean;
  isStoreSupported: boolean;
  isSubscribed: boolean;
}): PaywallViewState {
  if (input.isBootstrapping) return 'loading';
  if (!input.isSignedIn) return 'signed-out';
  // Shipped state: the template mounts no billing provider, so the screen explains itself
  // instead of pretending a purchase is possible.
  if (!input.isBillingMounted) return 'billing-off';
  if (input.isSubscribed) return 'subscribed';
  if (!input.isStoreSupported) return 'unsupported';
  return 'purchase';
}
