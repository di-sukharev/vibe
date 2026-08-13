# Parked tests

Suites for a capability this app ships switched off. `bun run test` skips this directory through
`--path-ignore-patterns`, so nothing here runs until the capability is turned on.

To bring a suite back, move the file up into `mobile/tests/` and run the suite. There is no marker
to remove and no list to edit: the directory is the whole mechanism.

## What is parked, and why

- `iap-provider.test.tsx`, `iap.test.ts`, `paywall-view-state.test.ts` — store subscriptions.
  `AppProviders.tsx` does not mount `IapProvider`, so `useSubscriptionIap()` returns `null`
  everywhere in the shipped app. `docs/IAP.md` says what to switch on; the backend half of the
  same capability is parked in place with a `@parked-test` marker, which is the equivalent
  mechanism on that side.

These suites were kept rather than deleted because `CHECKLIST.md` records payments as *available* —
implemented, switched off. Whoever turns billing on gets its tests back in the same commit.
