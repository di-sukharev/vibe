# Parked tests

These suites belong to a capability that ships switched off. The mobile `test` script skips this directory with `--path-ignore-patterns`. [TESTING](../../../docs/TESTING.md) describes parking in both packages.

`iap-provider.test.tsx`, `iap.test.ts`, and `paywall-view-state.test.ts` cover store subscriptions. `AppProviders.tsx` does not mount `IapProvider`, so the shipped app never runs that code.

To restore a suite, move it up to `mobile/tests/`. Its imports already resolve from there. [IAP](../../../docs/IAP.md) lists the other steps.

The suites stay because [CHECKLIST](../../../CHECKLIST.md) records payments as `available`: implemented and switched off.
