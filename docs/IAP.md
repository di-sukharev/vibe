# App Store and Google Play IAP

This template implements premium subscriptions through `expo-iap` on iOS and Android. The mobile app is only the store transport; the backend is the entitlement source of truth.

## Status: Off By Default

The whole implementation is here and it works, but it is switched off: the billing tables are
commented out in `backend/prisma/schema/billing.prisma`, the IAP routes are not mounted, and the
mobile app does not mount `IapProvider`. A project that never sells anything pays nothing for it,
and a project that does sell turns it on without writing the hard parts again.

Reference implementation, if this copy ever drifts: `github.com/di-sukharev/vibe`, branch `mobile`,
directories `backend/src/modules/billing` and `mobile/src/features/billing`.

### How To Turn Subscriptions On

Most steps below are commented-out blocks waiting for you, and `rg -l 'docs/IAP.md'` finds them.

1. Uncomment the models in `backend/prisma/schema/billing.prisma` and the three billing relations
   on `User` in `backend/prisma/schema/base.prisma`.
2. Run `bun run --cwd backend prisma:migrate` to create the tables.
3. Delete `backend/src/modules/billing/infrastructure/prisma-billing-types.ts`, restore the imports
   it replaced (its header lists all six importing files), and drop the `createBillingTestApp`
   helper in `billing.integration.test.ts` in favour of calling `createApp` directly. Then drop the
   header comments that describe the stand-ins - `rg -l prisma-billing-types` finds them, including
   the ones in `billing-routes.test.ts` and `infrastructure/billing-operations.test.ts`, and the
   parked-marker note at the top of `billing.integration.test.ts`.
4. Uncomment the billing wiring in `backend/src/app.ts`: the module import, the two verifier
   options, `createBillingModule`, the `/api/iap` and `/api/webhooks` routes, their ingress groups,
   and the webhook limit constants.
5. Uncomment the billing job, its `GooglePlayReconcileResult` type and three helpers, and the
   `maintenance:process` rows in
   `backend/src/jobs.ts`. Keep the module import inside the job body: `jobs.ts` must stay
   type-only at the top level, and `scripts/repo-env.test.mjs` fails if it does not.
6. Restore the tests: the parked cases in `backend/src/app.test.ts` (ingress and the OpenAPI paths),
   `backend/src/jobs.test.ts` (its mock and the two env keys, plus a `reconcile: 0` counter in the
   `calls` initializer, which is asserted but has no commented line to restore), and the
   entitlement assertion in `backend/src/modules/users/users.integration.test.ts`. Nothing
   else in the suite needs touching: the job-list assertion reads the registry, and the parked-suite
   assertion reads `billing.prisma`, so neither hard-codes a list that step 1 invalidates. Then
   delete the
   `@parked-test` line at the top of `backend/src/modules/billing/billing.integration.test.ts` so
   both test runners pick it up again (it already typechecks, so nothing else is needed).
7. Allow the job in deployment specs: uncomment the `providerEnv` branch in
   `scripts/prepare-do-specs.mjs` that gives `billing:google-play:reconcile` the Google Play group,
   and restore the parked assertion in `scripts/prepare-do-specs.test.mjs`. The generator validates
   job names against `backend/src/jobs.ts` directly, so step 5 is what makes the job schedulable -
   there is no second list to update.
8. Uncomment `<IapProvider>` in `mobile/src/composition/AppProviders.tsx`, then in
   `mobile/src/app/(tabs)/profile.tsx` uncomment all three parked pieces: the `@/features/billing`
   imports, the `const iap = useSubscriptionIap()` line, and the `SubscriptionSummary` block.
9. Configure the store credentials described below, then decide what your product gates behind
   `useSubscriptionIap()?.subscription` - the hook returns `null` while `IapProvider` is not
   mounted, and the template gates nothing on its own.

Then run `bun run typecheck`, `bun run test`, and `bun run architecture:check`. The paywall stops
showing its "not enabled" notice as soon as the provider is mounted.

### If Subscriptions Are Not Wanted

Deleting is safe but touches more than the billing directories, because a few neutral files
reference them. Remove all of it in one pass:

- `backend/prisma/schema/billing.prisma` and the commented relations in `base.prisma`
- `backend/src/modules/billing/` (module, tests, Apple root certificates)
- `mobile/src/features/billing/`, `mobile/src/app/paywall.tsx`, the paywall entries in
  `mobile/src/constants/testIds.ts` (the paywall entries and `profile.manageSubscriptionButton`),
  the `EXPO_PUBLIC_IAP_*` declarations in
  `mobile/src/types/env.d.ts`, and the billing globs in `mobile/eslint.config.js`
- `packages/contracts/src/iap.ts`, `iap.test.ts`, the `export * from './iap'` line in
  `packages/contracts/src/index.ts`, and the `IAP_*` codes in `packages/contracts/src/errors.ts`
- the commented wiring in `backend/src/app.ts` and `backend/src/jobs.ts`, plus the
  `@apple/app-store-server-library` dependency in `backend/package.json`
- the parked comment blocks that would otherwise point at deleted code: the ingress and OpenAPI
  cases plus the Yandex rows in `backend/src/app.test.ts`, the reconcile case in
  `backend/src/jobs.test.ts`, the entitlement assertion in
  `backend/src/modules/users/users.integration.test.ts`, the `IapProvider` lines in
  `mobile/src/composition/AppProviders.tsx`, and the billing block in
  `mobile/src/app/(tabs)/profile.tsx`
- the billing entry in `mobile/src/composition/api.ts`, plus the paywall checks and `paywallPath`
  constants in `mobile/scripts/e2e/maestro-policy-audit.mjs` and `mobile/tests/maestro-policy-audit.test.ts`
- the billing cases in `mobile/tests/api.test.ts` and `mobile/tests/select-registration.test.tsx`;
  the whole of `mobile/tests/iap*.test.*`, `mobile/tests/offer-code-controller.test.ts`,
  `mobile/tests/paywall-view-state.test.ts`, and `mobile/tests/workspace-surfaces.test.ts`
  (entirely billing)
- the store credential groups in `scripts/prepare-do-specs.mjs` (including `optionalIapEnvBlock`
  with its `maintenance:process` caller, the Apple certificates path, and the
  `billing:google-play:reconcile` scheduled-job branch) with their assertions in
  `scripts/prepare-do-specs.test.mjs`, and the `IAP_*` entries in `.do/backend-app.yaml.example`
- the `APPLE_IAP_*`, `GOOGLE_PLAY_*`, `IAP_*`, and `WEBHOOK_*` entries in `backend/src/env.ts`
  (the webhook limits exist only for App Store notifications) with their
  validators, their assertions in `backend/src/env.test.ts`, the same keys in every backend test
  env fixture, and `backend/.env.example` (removing them from `env.ts` narrows `AppEnv`, so
  anything still naming them fails typecheck)
- `expo-iap` in `mobile/package.json`, its plugin entry in `mobile/app.config.js`, the
  `EXPO_PUBLIC_IAP_*` keys in `mobile/.env.example`, and the subscription bullets in
  `mobile/README.md`

Then record `removed` in the `CHECKLIST.md` capability ledger and run `bun run typecheck`,
`bun run test`, and `bun run --cwd mobile e2e:maestro:audit`.

## Runtime Shape

- Mobile fetches configured subscription products through `expo-iap`.
- iOS purchases use `request.apple`, `appAccountToken: user.id`, and `andDangerouslyFinishTransactionAutomatically: false`.
- Android purchases use `request.google`, `subscriptionOffers`, and the same `user.id` for `obfuscatedAccountId` and `obfuscatedProfileId`. The backend rejects conflicting identity fields, serializes ownership claims across the current and linked purchase-token chain, and never reassigns a stored token to another user.
- Mobile sends App Store signed transaction JWS or Google Play `{ productId, purchaseToken, basePlanId? }` to the backend.
- Backend verifies App Store data with `@apple/app-store-server-library` and Google Play data with Android Publisher API `subscriptionsv2.get`.
- Apple verification is pinned to `APPLE_IAP_ENVIRONMENT`; production never retries an invalid payload against Sandbox or silently migrates a stored environment.
- Backend rejects products outside `APPLE_IAP_PRODUCT_IDS` or `GOOGLE_PLAY_PRODUCT_IDS`; Google Play verification also requires `GOOGLE_PLAY_BASE_PLAN_IDS` to explicitly allow every accepted base plan.
- Mobile calls `finishTransaction` only after backend verification and entitlement write succeed.
- Restore and foreground sync use store available purchases, then backend reconcile. Android also supports empty reconcile so the backend can refresh stored Google purchase tokens.
- Public subscription snapshots never expose raw Google purchase tokens.

## Store Setup

### App Store Connect

Create auto-renewable subscription products, for example:

- `com.example.app.premium.monthly`
- `com.example.app.premium.yearly`

Create sandbox testers and test on a real iOS development build. Expo Go cannot load the native IAP module.

### Google Play Console

Create subscription products and base plans. The template env supports either two product IDs or one product ID with two base plans:

- monthly product/base plan
- yearly product/base plan

Activate the base plans/offers, add license testers, and test with an Android build whose package name and signing match Play Console. Google Play products may take time to become queryable.

## Backend Env

App Store:

```bash
APPLE_IAP_BUNDLE_ID=com.example.app
APPLE_IAP_APP_APPLE_ID=1234567890
APPLE_IAP_ENVIRONMENT=Sandbox
APPLE_IAP_ISSUER_ID=...
APPLE_IAP_KEY_ID=...
APPLE_IAP_PRIVATE_KEY_BASE64=...
APPLE_IAP_PRODUCT_IDS=com.example.app.premium.monthly,com.example.app.premium.yearly
```

The backend image bundles the public Apple trust anchors published by Apple. Leave
`APPLE_IAP_ROOT_CERTS_DIR` unset normally; set it only when the deployment intentionally mounts a
reviewed replacement directory. Use `APPLE_IAP_ENVIRONMENT=Production` and the numeric
`APPLE_IAP_APP_APPLE_ID` in production. Sandbox and Production payloads are not interchangeable.

Google Play:

```bash
GOOGLE_PLAY_PACKAGE_NAME=com.example.app
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64=...
GOOGLE_PLAY_PRODUCT_IDS=com.example.app.premium
GOOGLE_PLAY_BASE_PLAN_IDS=monthly,yearly
```

Create a Google Cloud service account, link it in Play Console, grant subscription/order read access, enable the Android Publisher API, then base64-encode the downloaded service-account JSON for `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`.

Backend credentials are secrets. Do not put App Store API keys, Apple private keys, or Google service-account JSON in mobile env.

For the default DigitalOcean path, export either complete store group before running
`bun run deploy:do:specs backend-final`. The generator rejects partial groups, rejects App Store
Sandbox configuration in a production spec, uses the bundled certificate path, and emits the Apple
private key and Google service-account JSON as `SECRET` runtime values.

## Mobile Env

Create `mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000

EXPO_PUBLIC_IAP_IOS_MONTHLY_PRODUCT_ID=com.example.app.premium.monthly
EXPO_PUBLIC_IAP_IOS_YEARLY_PRODUCT_ID=com.example.app.premium.yearly

EXPO_PUBLIC_IAP_ANDROID_PACKAGE_NAME=com.example.app
EXPO_PUBLIC_IAP_ANDROID_MONTHLY_PRODUCT_ID=com.example.app.premium
EXPO_PUBLIC_IAP_ANDROID_MONTHLY_BASE_PLAN_ID=monthly
EXPO_PUBLIC_IAP_ANDROID_YEARLY_PRODUCT_ID=com.example.app.premium
EXPO_PUBLIC_IAP_ANDROID_YEARLY_BASE_PLAN_ID=yearly
```

`EXPO_PUBLIC_*` values are bundled into the app. They may contain public product IDs and package names, never backend credentials.

## Development Builds

`expo-iap` is native. Use custom development builds, not Expo Go:

```bash
bunx eas-cli build --profile development --platform ios
bunx eas-cli build --profile development --platform android
```

Start Metro with a device-reachable API URL:

```bash
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000 bunx expo start --dev-client --host lan
```

After changing native purchase setup or config plugin options, rebuild the development client.

## Restore, Sync, and Freshness

The paywall exposes restore on both stores.

- iOS restore asks StoreKit for available purchases, sends signed transactions to `POST /api/iap/app-store/transactions`, and sends known original transaction IDs to `POST /api/iap/app-store/reconcile`.
- Android restore asks Google Play Billing for available purchases, sends `{ productId, purchaseToken }` pairs to `POST /api/iap/google-play/reconcile`, and falls back to empty reconcile so the backend can refresh stored tokens.
- Launch and foreground sync call backend entitlement first, then store available purchases when the store connection is available.

The backend includes a bounded scheduled safety net for already stored Google Play purchase tokens. `maintenance:process` selects only `pending`, active, grace-period, and billing-retry rows whose last reconcile attempt is at least 15 minutes old, then atomically advances that timestamp before the provider call so overlapping cron/manual runs cannot process the same purchase. It processes at most 100 rows per run and gives each Android Publisher request a 15-second timeout. It admits another purchase only while at least 31 seconds remain in the 50-second task budget, covering the worst-case verification plus acknowledgement calls. Every claimed attempt advances the separate reconcile timestamp, including provider failures, so permanently failing rows cannot starve newer purchases. Failures do not block the remaining admitted batch, but any failures make the scheduled job exit non-zero after reporting aggregate counts. Cron metrics also report the total due backlog and the oldest due age, so a batch that succeeds but remains persistently undersized is visible. Terminal purchases leave the polling set.

Schedule `maintenance:process` at least every 15 minutes in production. Once subscriptions are turned on it combines Google Play reconcile with auth-session cleanup and skips billing when Google Play is not configured; while they are off it performs the auth and notification maintenance only. `billing:google-play:reconcile` is also available as a dedicated task once subscriptions are turned on and requires the complete Google Play environment group. The DigitalOcean spec generator places Google credentials in the API and the applicable scheduled job, not unrelated workers.

This polling path does not replace Google RTDN: it can refresh only tokens that the app has already ingested. Add RTDN when the product must discover out-of-app purchases or react closer to real time; route RTDN through the same backend ingest/reconcile application service.

App Store subscription status lookup has a 15-second application deadline. The installed Apple server SDK exposes neither a request timeout nor an `AbortSignal` for `getAllSubscriptionStatuses()`, so the backend returns control at the deadline but cannot cancel the SDK's underlying transport request. Keep provider concurrency bounded at the caller/runtime level and re-check this limitation when upgrading the SDK.

## Offer Codes and Deferred Billing Surfaces

App Store offer-code redemption is supported on iOS. Mobile creates a short-lived backend redemption token, opens `presentCodeRedemptionSheetIOS()`, and links tokenless redeemed transactions only after that user action.

Google Play code redemption is not implemented in this template. Users can still redeem Play codes through Google Play. The scheduled reconcile refreshes an already known token; products that must discover a newly redeemed purchase without opening the app still need RTDN.

Alternative billing, external purchase links, signed promotional-offer purchase flows, user-choice billing, and developer-billing reporting are deferred.

Before enabling alternative billing or external purchase links, update product scope and implementation together:

- obtain the required Apple or Google approval for each country and billing mode;
- configure `expo-iap` alternative-billing plugin options intentionally, including iOS external purchase countries, entitlements, and HTTPS external URLs without query parameters;
- implement deep-link return handling and clear user copy that the user is leaving the app for external payment;
- add backend validation for externally completed purchases before granting premium access;
- for Android billing programs, choose the exact Google Play mode, collect the required reporting token, and report it to Google within the required window.

## Error Handling Policy

Mobile treats structured Expo IAP error codes from Expo IAP's `ErrorCode` enum as the source of truth. User cancellations are silent only for the `user-cancelled` code or legacy messages that explicitly say the purchase/payment action was cancelled by the user.

Pending purchases are not sent to backend ingest and are not finished locally. The user sees pending copy until the store emits a purchased transaction or backend entitlement changes.

IAP diagnostics include event name, platform, normalized code, retryability, message, response code, and product ID when available. Diagnostics must not include raw signed transactions, Google Play purchase tokens, service-account JSON, App Store private keys, cookies, or other secrets.

## Validation

Automated checks:

```bash
bun run test:contracts
bun run test:backend
bun run test:mobile
bun run typecheck
bun run --cwd backend prisma:validate
```

Manual checks:

- authenticated users reach the app without an entitlement; `/paywall` is reachable only when the product navigates there
- products and Android base plan offers load on real development builds
- purchase does not auto-finish before backend verification
- the entitlement returned by `GET /api/iap/entitlement` turns active only after store verification
- restore rehydrates entitlement after reinstall/logout/login
- pending purchases do not unlock premium
- ownership mismatch fails when the store purchase belongs to another app user
- profile opens App Store or Google Play subscription management
- App Store webhook replay is idempotent
- App Store webhook concurrent delivery either owns the processing lease or returns a retryable response; stale leases are reclaimed safely
- App Store webhook bodies and request rates are bounded before verification through the separate `WEBHOOK_BODY_LIMIT_BYTES` and `WEBHOOK_RATE_LIMIT_*` controls, and failed verification deletes its provisional claim instead of retaining attacker-controlled payload hashes
- `maintenance:process` runs every 15 minutes and reports zero failed Google Play reconciliations
- RTDN is configured when newly redeemed or otherwise out-of-app purchases must be discovered before the app next syncs

## Troubleshooting

- Products empty on iOS: verify bundle ID, SKU spelling, subscription group status, sandbox tester, real device, and rebuilt custom dev-client.
- Products empty on Android: verify package name, Play Console product IDs, active base plans/offers, license tester, Play-enabled build, and that the app was installed through a Play-compatible testing path when required.
- `IAP_NOT_CONFIGURED`: backend is missing the configured store credentials or required product allowlist.
- `IAP_INVALID_TRANSACTION`: signed JWS or Google Play purchase token is missing, unverifiable, expired, missing required expiry, or not in the configured product/base-plan allowlist.
- `IAP_OWNERSHIP_MISMATCH`: App Store `appAccountToken` or Google Play obfuscated account/profile ID does not match the authenticated user, and the store token is not already linked to that user.
- Purchase succeeds but access stays locked: inspect backend verification errors and confirm mobile can reach `EXPO_PUBLIC_API_URL`.
- Works in sandbox/internal testing but not production: switch store environments, package/bundle IDs, product IDs, service-account access, and webhook/RTDN setup to production values.

## References

- Expo IAP docs: https://hyochan.github.io/expo-iap/
- Expo IAP subscription validation: https://hyochan.github.io/expo-iap/guides/subscription-validation/
- Expo IAP troubleshooting: https://hyochan.github.io/expo-iap/guides/troubleshooting/
- Google Play subscriptionsv2.get: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
- Google Play acknowledge: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge
- Google Play RTDN: https://developer.android.com/google/play/billing/rtdn-reference
- Apple PKI root certificates: https://www.apple.com/certificateauthority/
