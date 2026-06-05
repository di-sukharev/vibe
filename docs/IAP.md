# App Store and Google Play IAP

This template implements premium subscriptions through `expo-iap` on iOS and Android. The mobile app is only the store transport; the backend is the entitlement source of truth.

## Runtime Shape

- Mobile fetches configured subscription products through `expo-iap`.
- iOS purchases use `request.apple`, `appAccountToken: user.id`, and `andDangerouslyFinishTransactionAutomatically: false`.
- Android purchases use `request.google`, `subscriptionOffers`, and `obfuscatedAccountId/ProfileId: user.id`.
- Mobile sends App Store signed transaction JWS or Google Play `{ productId, purchaseToken, basePlanId? }` to the backend.
- Backend verifies App Store data with `@apple/app-store-server-library` and Google Play data with Android Publisher API `subscriptionsv2.get`.
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
APPLE_IAP_ROOT_CERTS_DIR=/absolute/path/to/apple/root-certs
APPLE_IAP_PRODUCT_IDS=com.example.app.premium.monthly,com.example.app.premium.yearly
```

Google Play:

```bash
GOOGLE_PLAY_PACKAGE_NAME=com.example.app
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64=...
GOOGLE_PLAY_PRODUCT_IDS=com.example.app.premium
GOOGLE_PLAY_BASE_PLAN_IDS=monthly,yearly
```

Create a Google Cloud service account, link it in Play Console, grant subscription/order read access, enable the Android Publisher API, then base64-encode the downloaded service-account JSON for `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`.

Backend credentials are secrets. Do not put App Store API keys, Apple private keys, or Google service-account JSON in mobile env.

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

V1 does not include Google RTDN or a scheduled backend reconcile job. Before serious production use, add RTDN or cron so renewals, holds, refunds, and revocations update even when the user does not open the app. Design that integration to call the same backend Google Play reconcile service.

## Offer Codes and Deferred Billing Surfaces

App Store offer-code redemption is supported on iOS. Mobile creates a short-lived backend redemption token, opens `presentCodeRedemptionSheetIOS()`, and links tokenless redeemed transactions only after that user action.

Google Play code redemption is not implemented in this template. Users can still redeem Play codes through Google Play; production apps that depend on out-of-app redemption freshness should add RTDN or scheduled reconcile.

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

- inactive authenticated user lands on `/paywall`
- products and Android base plan offers load on real development builds
- purchase does not auto-finish before backend verification
- backend activates `/components` only after store verification
- restore rehydrates entitlement after reinstall/logout/login
- pending purchases do not unlock premium
- ownership mismatch fails when the store purchase belongs to another app user
- profile opens App Store or Google Play subscription management
- App Store webhook replay is idempotent
- Google Play renew/hold/revoke freshness is covered by RTDN or scheduled reconcile before production launch

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
