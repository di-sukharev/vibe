# App Store and Google Play subscriptions

The mobile app sells a premium subscription through `expo-iap` on iOS and Android. The app only talks to the store. The backend verifies every purchase and owns the entitlement.

The capability is implemented and switched off, so a product that sells nothing carries no billing tables. The tables are commented out in `backend/prisma/schema/billing.prisma`, the `/api/iap` and `/api/webhooks` routes are not mounted, and the app does not mount `IapProvider`. Until you turn it on, `/paywall` says that subscriptions are not enabled. Store rules for payment methods are in [WEB_SURFACES](WEB_SURFACES.md#mobile-payments). The upstream template keeps a working copy on branch `mobile` of `github.com/di-sukharev/vibe`.

## How To Turn Subscriptions On

Code comments that mention `docs/IAP.md` mark each spot: `rg -n 'docs/IAP.md'`.

1. Uncomment the enums and models in `backend/prisma/schema/billing.prisma` and the three billing relations on `User` in `base.prisma`. Run `bun run --cwd backend prisma:migrate`.
2. Delete `backend/src/modules/billing/infrastructure/prisma-billing-types.ts`, and restore the imports in the six files its header lists. Replace the `createBillingTestApp` helper in `billing.integration.test.ts` with `createApp`. Remove the stand-in notes that `rg -l prisma-billing-types` finds.
3. In `backend/src/app.ts`, uncomment the billing import, the verifier options, `createBillingModule`, the webhook limit constants, the `/api/iap` and `/api/webhooks` ingress groups, and both routes. As the comment there says, add a `RateLimitPolicy` for each group in `backend/src/rate-limit/port.ts` and pass `store: rateLimitStore(...)`, so that `RATE_LIMIT_STORE=database` covers them.
4. In `backend/src/jobs.ts`, uncomment the `billing:google-play:reconcile` job, its result type, the three helpers, and the Google Play lines in `maintenance:process`. Keep the billing import inside the job body: `jobs.ts` stays type-only at the top level.
5. Bring the tests back:
   - Remove the `@parked-test` line from every suite under `backend/src/modules/billing/`.
   - Move the suites in `mobile/tests/parked/` up to `mobile/tests/`, and delete the directory.
   - In `backend/src/app.test.ts`, restore the four body-limit and rate tests for `/api/iap` and `/api/webhooks` from `git show 13e67da -- backend/src/app.test.ts`, and add both prefixes to the Yandex SWS loop.
   - `backend/src/jobs.test.ts` keeps no billing case. Test the Google Play job with the real-database job tests in `backend/src/jobs.integration.test.ts`.
   - In `backend/src/modules/users/users.integration.test.ts`, uncomment the check that the demo seed grants no entitlement.
6. In `mobile/src/composition/AppProviders.tsx`, uncomment the `IapProvider` import, and wrap the tree in `<IapProvider api={apis.billing}>` where its comment says. In `mobile/src/app/(tabs)/profile.tsx`, uncomment the billing import, the `useSubscriptionIap()` line, and the `SubscriptionSummary` block.
7. Set up the stores and the configuration below.
8. Decide what premium unlocks. The template gates nothing. In the app, `useSubscriptionIap()?.subscription?.isActive` is a UX check only. An API that serves premium data must check the entitlement on the server, and the billing module exports no entitlement reader yet.
9. Run `bun run typecheck`, `bun run test`, and `bun run architecture:check`. Set the `Payments / subscriptions` row in [CHECKLIST](../CHECKLIST.md) to `included`.

`maintenance:process` already runs every 15 minutes from `backend/src/job-schedules.json`. After step 4 it also reconciles Google Play when `GOOGLE_PLAY_PACKAGE_NAME` is set. To run `billing:google-play:reconcile` on its own schedule, see [BACKGROUND_JOBS](BACKGROUND_JOBS.md). Then add its job key to the targets of all four `GOOGLE_PLAY_*` variables in `extra_env_components`, or its container gets no Google Play credentials ([DEPLOYMENT](DEPLOYMENT.md#extra-runtime-variables)).

## If Subscriptions Are Not Wanted

Remove the whole capability in one pass. Shared files reference it too:

- Backend: `backend/src/modules/billing/`, `billing.prisma` and the commented relations in `base.prisma`, the commented billing code in `backend/src/app.ts` and `backend/src/jobs.ts`, and `@apple/app-store-server-library` in `backend/package.json`.
- Backend env: the `APPLE_IAP_*`, `GOOGLE_PLAY_*`, `IAP_*`, and `WEBHOOK_*` keys with their validators in `backend/src/env.ts`, their cases in `env.test.ts`, and `backend/.env.example`. Removing a key narrows `AppEnv`, so typecheck finds every other use.
- Contracts: `packages/contracts/src/iap.ts` and `iap.test.ts`, `export * from './iap'` in `index.ts`, and the `IAP_*` codes in `errors.ts`.
- Mobile: `mobile/src/features/billing/`, `mobile/src/app/paywall.tsx`, the billing entry in `mobile/src/composition/api.ts`, the paywall IDs and `profile.manageSubscriptionButton` in `mobile/src/constants/testIds.ts`, the `EXPO_PUBLIC_IAP_*` keys in `mobile/src/types/env.d.ts` and `mobile/.env.example`, the billing files in `mobile/eslint.config.js`, and `expo-iap` in `mobile/package.json` and `mobile/app.config.js`.
- Tests and notes: `mobile/tests/parked/`, `mobile/tests/offer-code-controller.test.ts`, the billing cases in `mobile/tests/api.test.ts`, the commented lines in `AppProviders.tsx` and `profile.tsx`, the other comments that `rg -n 'docs/IAP.md'` finds, and the docs that link here.

Keep `google-auth-library` while social sign-in uses it. The Maestro policy audit has no billing checks. Then set the `Payments / subscriptions` row in [CHECKLIST](../CHECKLIST.md) to `removed`, and run `bun run typecheck`, `bun run test`, and `bun run --cwd mobile e2e:maestro:audit`.

## How it works

- iOS sets `appAccountToken` to the user ID and never finishes a transaction automatically. Android sets `obfuscatedAccountId` and `obfuscatedProfileId` to the user ID.
- The app sends the App Store signed transaction or the Google Play `{ productId, purchaseToken, basePlanId? }` to `/api/iap`. It calls `finishTransaction` only after the backend has verified the purchase and written the entitlement.
- The backend verifies with `@apple/app-store-server-library` and the Android Publisher API, and acknowledges new Google Play purchases. It accepts only auto-renewable subscriptions whose product, and Google base plan, is in the allowlist.
- Apple verification uses only `APPLE_IAP_ENVIRONMENT`. Production never retries a payload against Sandbox and never switches a stored environment. With `NODE_ENV=production`, Google Play test purchases fail.
- A purchase belongs to the user in its store identity fields, or to the user who already owns it. Conflicting Google identity fields fail, claims on linked Google tokens are serialized, and a stored token never moves to another user.
- Premium is active in `active` and `billing_grace_period` until expiry. A pending purchase is not sent or finished, and it unlocks nothing; the app shows a pending notice. Responses never expose a Google purchase token.
- At launch and on return to the foreground, the app reads `GET /api/iap/entitlement`, then reconciles the store's available purchases. Restore reconciles them on both stores, after an App Store sync on iOS. An empty Android reconcile refreshes the user's stored tokens.
- For an iOS offer code, the app gets a 15-minute token from the backend and opens `presentCodeRedemptionSheetIOS()`. Only that token lets the backend link a redeemed transaction without `appAccountToken`.
- `POST /api/webhooks/app-store` takes App Store Server Notifications V2. The `WEBHOOK_*` limits bound bodies and rates before verification. A replay changes nothing. Of concurrent deliveries, one takes the processing lease and the others get a retryable `503`; a stale lease is reclaimed. A failed verification deletes its provisional row, so no attacker-controlled payload hash stays.
- The Google Play reconcile job refreshes stored non-terminal purchases not tried in the last 15 minutes. Runs are bounded: 100 rows, 15 seconds per call, 50 seconds in total. Each row is claimed before the call, so overlapping runs never repeat a purchase, and failing rows cannot starve newer ones. The job logs the due backlog and its oldest age, and exits non-zero on any failure.
- App Store status lookups abort after 15 seconds through an override of the SDK's protected `makeFetchRequest`. Recheck it after an SDK upgrade.

## Store setup

App Store Connect:

- Create auto-renewable subscriptions, for example `com.example.app.premium.monthly` and `com.example.app.premium.yearly`.
- Create an In-App Purchase API key for the backend, and note its issuer ID and key ID.
- Set the App Store Server Notifications URL, version 2, to `https://<api-domain>/api/webhooks/app-store` for the environment that backend verifies.
- Create sandbox testers. Test on a [development build](../mobile/README.md#development-build), not Expo Go.

Google Play Console:

- Create subscriptions with monthly and yearly base plans: two products, or one product with two base plans. Activate the base plans and offers.
- Create a Google Cloud service account, and enable the Android Publisher API. Link the account in Play Console with access to orders and subscriptions; the backend reads and acknowledges them.
- Add license testers. Test with a build whose package name and signing match Play Console, against a backend without `NODE_ENV=production`. New products can take time to become queryable.

## Configuration

`backend/.env.example` lists the backend variables. At startup, `backend/src/env.ts` refuses a partial App Store or Google Play group, and a group without its allowlists.

- `APPLE_IAP_ENVIRONMENT` is `Sandbox` by default. Production uses `Production` and the numeric `APPLE_IAP_APP_APPLE_ID`.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` holds the base64-encoded service-account JSON key.
- The IDs must match the app: `APPLE_IAP_BUNDLE_ID` is `ios.bundleIdentifier`, and `GOOGLE_PLAY_PACKAGE_NAME` is `android.package` in `mobile/app.config.js`.
- The backend image bundles Apple's root certificates ([manifest](../backend/src/modules/billing/certs/apple/README.md)). Leave `APPLE_IAP_ROOT_CERTS_DIR` unset unless the deployment deliberately mounts a reviewed replacement directory.
- Backend credentials are secrets. Never put the Apple private key, the service-account JSON, or another backend credential in the mobile env.

`mobile/.env.example` lists the `EXPO_PUBLIC_IAP_*` values. The app bundle includes every `EXPO_PUBLIC_*` value, so these hold only public product IDs and package names. An Android plan needs a product ID and a base plan ID. Subscription management on Android needs `EXPO_PUBLIC_IAP_ANDROID_PACKAGE_NAME`.

In production, put the public values in `extra_runtime_env`. Put the two secrets in `TF_VAR_extra_runtime_secret_env` as JSON on DigitalOcean, or in Lockbox through `extra_secret_bindings` on Yandex Cloud ([DEPLOYMENT](DEPLOYMENT.md)). Terraform hands the App Store group only to the API, and the Google Play group only to the API and the `maintenance` job ([DEPLOYMENT](DEPLOYMENT.md#extra-runtime-variables)).

## Not implemented

- In-app Google Play code redemption. Users redeem codes in Google Play, and the next app sync ingests the purchase.
- Google Real-time developer notifications (RTDN). The scheduled reconcile refreshes only tokens that the app already sent. Add RTDN when the product must see out-of-app purchases before the next app sync or react sooner. Route it through the same ingest and reconcile service.
- Alternative billing, external purchase links, signed promotional offers, user-choice billing, and developer-billing reporting.

Before you enable alternative billing or external purchase links, change the product scope and the code together:

- Get the required Apple or Google approval for each country and billing mode.
- Configure the `expo-iap` alternative-billing plugin options deliberately, including the iOS external purchase countries, entitlements, and HTTPS external URLs without query parameters.
- Handle the deep-link return, and tell the user clearly that they are leaving the app to pay.
- Validate externally completed purchases on the backend before granting premium access.
- For a Google Play billing program, choose the exact mode, collect the required reporting token, and report it to Google within the required window.

## Errors and diagnostics

The app trusts the `expo-iap` `ErrorCode` values. It stays silent only for `user-cancelled` or a legacy message that says the user cancelled the purchase or payment.

Diagnostics (`mobile/src/features/billing/iap-diagnostics.ts`) carry the event name, platform, error code, network and retry flags, messages, response code, and product ID. They must never contain signed transactions, Google purchase tokens, service-account JSON, App Store private keys, cookies, or other secrets.

| Code | Status | Cause |
| --- | --- | --- |
| `IAP_NOT_CONFIGURED` | 503 | Missing credentials, allowlists, or Apple root certificates; or Google Play refused the service account or is down. |
| `IAP_INVALID_TRANSACTION` | 400 | Unverifiable payload, wrong environment, not an auto-renewable subscription, no expiry, a Google test purchase in production, or a product or base plan outside the allowlists. |
| `IAP_OWNERSHIP_MISMATCH` | 403 | The purchase cannot be tied to this user, or the offer-code token is invalid or expired. |
| `IAP_WEBHOOK_IN_PROGRESS` | 503 | Another worker holds the notification lease. Retry later. |

If no products load, check the bundle ID or package name, the product IDs, the subscription group or active base plans and offers, the tester account, a real device, and a rebuilt development build. On Android, install through a Play testing track when required. If a purchase succeeds but premium stays locked, read the backend error, and check that the device reaches `EXPO_PUBLIC_API_URL`. Before launch, switch the environments, IDs, service-account access, and notification URL to production.

## Manual checks

On development builds with store testers, confirm that:

- a signed-in user without an entitlement uses the app, and `/paywall` opens only when the product navigates there;
- products and Android offers load, and a purchase finishes only after backend verification turns the entitlement active;
- restore brings the entitlement back after a reinstall or a new sign-in;
- a pending purchase unlocks nothing, and another user's purchase fails;
- the profile opens the store's subscription management;
- a replayed App Store notification changes nothing, and `maintenance:process` reports zero failed Google Play reconciliations.

## References

- [Expo IAP](https://hyochan.github.io/expo-iap/): [subscription validation](https://hyochan.github.io/expo-iap/guides/subscription-validation/), [troubleshooting](https://hyochan.github.io/expo-iap/guides/troubleshooting/)
- Google Play: [subscriptionsv2.get](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get), [acknowledge](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge), [RTDN](https://developer.android.com/google/play/billing/rtdn-reference)
- [Apple PKI root certificates](https://www.apple.com/certificateauthority/)
