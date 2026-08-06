export type PaywallViewState =
  | 'loading'
  | 'signed-out'
  | 'unsupported'
  | 'subscribed'
  | 'purchase';

// Nothing redirects into or away from the paywall any more, so the screen has to resolve its
// own state. Order matters: an active subscriber must see confirmation even on a build where
// the store is unavailable, otherwise a completed purchase looks like it did nothing.
export function paywallViewState(input: {
  isBootstrapping: boolean;
  isSignedIn: boolean;
  isStoreSupported: boolean;
  isSubscribed: boolean;
}): PaywallViewState {
  if (input.isBootstrapping) return 'loading';
  if (!input.isSignedIn) return 'signed-out';
  if (input.isSubscribed) return 'subscribed';
  if (!input.isStoreSupported) return 'unsupported';
  return 'purchase';
}
