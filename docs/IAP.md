# Store subscriptions

The backend verifies App Store and Google Play purchases and owns premium access. Billing is implemented but disabled. Its schema, routes, scheduled reconciliation, and mobile provider are not active.

## Enable subscriptions

Code comments linking to `docs/IAP.md` mark activation points. Search those comments and follow the nearby implementation.

1. Enable billing models and enums in `backend/prisma/schema/billing.prisma` and their User relations in `base.prisma`. Generate the migration.
2. Replace `prisma-billing-types.ts` with generated Prisma imports as its header describes. Restore the real application helper in the billing integration suite.
3. Enable billing wiring and routes in `backend/src/app.ts`. Add both ingress groups to `routesWithOwnBudget` and provide rate-limit policies backed by the selected store.
4. Enable Google Play reconciliation and its maintenance wiring in `backend/src/jobs.ts`. Keep adapter imports inside job bodies.
5. Remove `@parked-test` from billing suites. Move mobile billing suites from `tests/parked` into `tests`. Restore the seed entitlement assertion and cover reconciliation through database integration tests.
6. Mount `IapProvider` in mobile composition and restore the profile subscription summary. Configure the stores and backend credentials.
7. Define what premium unlocks. Enforce it in the backend; the mobile entitlement check controls presentation only. Add the required public entitlement reader to the billing module.
8. Run types, tests, architecture checks, and store sandbox verification.

Maintenance already has a schedule. A separately scheduled reconcile job also needs its key in every Google credential target. See [Deployment](DEPLOYMENT.md#extra-runtime-variables).

## Remove subscriptions

Remove the billing module, schema, contracts, mobile feature, native plugin, configuration, tests, and commented wiring together. Use the activation comments and type errors to find shared references. Remove links to this guide if the feature is deleted.

Keep `google-auth-library` when social sign-in still needs it. Run types, tests, and the Maestro audit after removal.

## Store and backend configuration

In App Store Connect, create subscriptions and an In-App Purchase API key. Configure the version 2 notification URL at `https://<api-domain>/api/webhooks/app-store`. Create sandbox testers.

In Play Console, create subscriptions with active base plans and offers. Give a Google Cloud service account access to orders and subscriptions. Enable the Android Publisher API and add license testers. Test with the correct package and signing identity.

[backend/.env.example](../backend/.env.example) defines backend configuration. Bundle and package IDs must match `mobile/app.config.js`. Keep private keys and service-account credentials only in backend secrets.

The backend image includes reviewed [Apple root certificates](../backend/src/modules/billing/certs/apple/README.md). Use a replacement certificate directory only when deliberately reviewed.

`mobile/.env.example` contains public product IDs and package names. Every `EXPO_PUBLIC_*` value enters the bundle. Android offers need both product and base-plan IDs.

## Verification and ownership

Finish a transaction only after the backend verifies it and records the entitlement. Pending purchases unlock nothing. Store identity fields bind purchases to users; an existing purchase must never move to another account.

Keep product and base-plan allowlists. Apple verification uses the configured environment without automatic sandbox fallback. Production rejects Google test purchases. Restore and foreground reconciliation must preserve these checks.

App Store webhooks require verification, idempotency, and processing leases. Google maintenance refreshes stored purchases in bounded batches. Keep provider deadlines and retry behavior when upgrading SDKs.

A code redemption without `appAccountToken` needs the backend's short-lived redemption token. Do not weaken ownership checks to accept it.

## Current limits

Google reconciliation sees only tokens already submitted by the application. RTDN is not implemented. Neither are alternative billing, external purchase programs, or in-app Google code redemption.

A production backend rejects sandbox purchases. Before store review, define and implement the permitted review or tester access. Do not disable verification to make review pass.

Check current Apple and Google policies before adding another payment method. New billing programs require separate configuration and backend verification.

## Diagnostics and manual checks

Keep signed transactions, purchase tokens, private keys, cookies, and service-account JSON out of diagnostics. Use the existing structured error codes.

If products do not load, check identifiers, active plans, tester access, signing, and a rebuilt native client. If entitlement stays locked, check the backend response and device API connectivity.

With store testers, verify purchase, pending payment, restore, subscription management, another user's rejected purchase, replayed notifications, and successful maintenance. Use a development or store test build, not Expo Go.

References: [Expo IAP](https://hyochan.github.io/expo-iap/), [Apple purchase verification](https://developer.apple.com/documentation/appstoreserverapi), [Google subscription API](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get).
