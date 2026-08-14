# Mobile

The mobile app is built with Expo and React Native. It provides the baseline auth flow using the same API contracts as the webapp.

## Project Surface Status

This section may be updated during first-run bootstrap. If the root `README.md` marks mobile as deferred, add a short note here explaining that mobile work is intentionally paused. When the user activates mobile, remove or rewrite that note before starting Expo or React Native development.

## Current App Shape

- `/` is the register/login screen and intentionally has no tabs.
- Mobile is a user-only product surface. Administrator tools and the seeded
  administrator account belong to the browser webapp, not the mobile UI.
- Authenticated users land on `/components`, which lives in the bottom tab shell with `/profile`.
- `/profile` lets a signed-in user set, replace, and remove a profile photo. Picking a photo resizes it and re-encodes it as JPEG before upload, so phone photos fit the size limit and render on the web too.
- `/details/[id]` is a stack screen outside the tabs and uses an in-screen back button at the top left.
- `/paywall` renders the subscription flow, which ships **switched off**: `IapProvider` is not mounted, so the screen states that subscriptions are not enabled instead of offering a purchase. Turning it on is documented in `docs/IAP.md`.
- Once enabled, App Store and Google Play subscriptions are working purchase paths, with App Store offer-code redemption on iOS. Google Play code redemption, signed promotional-offer purchases, alternative billing, and external purchase links are deferred.
- Sign in with Apple / Google is implemented and also switched off: the buttons are not rendered and the backend route is not mounted (see `docs/SOCIAL_AUTH.md`).
- Product screens compose `src/components/dashboard/ScreenShell.tsx`, which owns the shared native site header and delegates safe-area, scrolling, keyboard avoidance, and back navigation to the low-level `Screen` layout primitive.
- Phones use the native bottom-tab shell. Expo Web switches to the same compact side-rail/inset composition at the shared wide-layout breakpoint.

## Cross-Surface Payment Contract

Read [../docs/WEB_SURFACES.md](../docs/WEB_SURFACES.md) before payment work. Mobile owns its
native payment experience separately from browser checkout. The App Store and Google Play
subscription paths are already present but switched off until the capability ledger activates
them. A product may also add policy-compliant card, Apple Pay, or Google Pay flows in mobile without
routing them through `website` or `webapp`; re-check current store rules for the product type,
storefront, and region first.

## Local Demo User

From the repository root, prepare the local backend once:

```bash
docker compose --env-file backend/.env up -d postgres
bun run --cwd backend prisma:deploy
bun run dev:seed

```

The development seed creates the demo accounts only. It grants no entitlement,
because reaching the app must not depend on a subscription:

| Email | Password | Mobile landing page |
| --- | --- | --- |
| `user@example.com` | `local-user-password` | `/components` |

Start the API and Expo app in separate terminals:

```bash
bun run dev:backend
bun run dev:mobile
```

**On a physical device, set the storage URL too.** With the default filesystem storage driver the
backend signs upload and download URLs against `PRIVATE_STORAGE_LOCAL_PUBLIC_URL`, which defaults
to `http://127.0.0.1:<PORT>` — and on a phone that address is the phone. The avatar upload then
fails in a way that looks like a bug in the feature. Set it next to `EXPO_PUBLIC_API_URL`:

```bash
# backend/.env - use the machine's LAN address, or 10.0.2.2 for the Android emulator
PRIVATE_STORAGE_LOCAL_PUBLIC_URL="http://192.168.1.10:3000"
```

The iOS simulator hides this problem entirely, which is what makes it worth writing down.

This mobile flow intentionally does not expose or use the development
administrator. The same backend seed maintains that account only for the webapp.
The demo entitlement is created only by the loopback-only development seed and
is never part of deployment.

## Stack

- Expo SDK 57
- React Native
- TypeScript
- Expo Router
- TanStack Query
- TanStack Form
- Expo SecureStore
- Expo Notifications
- Expo ImagePicker, ImageManipulator, and FileSystem (profile photo upload)
- Expo Apple Authentication and React Native Google Sign-In for optional social auth
- Expo IAP for App Store and Google Play subscription transport
- Zod contracts from `@web-app-demo/contracts`
- Native ShadCN-style UI primitives in `src/components/ui`
- Maestro E2E smoke flow

## Commands

```bash
bun run dev
bun run android
bun run ios
bun run web
bun run typecheck
bun run lint
bun run build
bun run doctor
bun run e2e:maestro
```

From the repository root, use `bun run dev:mobile`, `bun run build:mobile`, `bun run typecheck:mobile`, and `bun run e2e:mobile`.

## Env

Create `mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME=
EXPO_PUBLIC_IAP_IOS_MONTHLY_PRODUCT_ID=com.example.app.premium.monthly
EXPO_PUBLIC_IAP_IOS_YEARLY_PRODUCT_ID=com.example.app.premium.yearly
EXPO_PUBLIC_IAP_ANDROID_PACKAGE_NAME=com.example.app
EXPO_PUBLIC_IAP_ANDROID_MONTHLY_PRODUCT_ID=com.example.app.premium
EXPO_PUBLIC_IAP_ANDROID_MONTHLY_BASE_PLAN_ID=monthly
EXPO_PUBLIC_IAP_ANDROID_YEARLY_PRODUCT_ID=com.example.app.premium
EXPO_PUBLIC_IAP_ANDROID_YEARLY_BASE_PLAN_ID=yearly
EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=0
```

Use this value on Android emulators:

```bash
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

For Maestro E2E against Expo dev client, prefer a LAN-reachable API URL and set `EXPO_PUBLIC_E2E=1` only for the E2E Metro session:

```bash
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000
EXPO_PUBLIC_E2E=1
```

`EXPO_PUBLIC_E2E=1` and `EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=1` disable push registration so simulators and E2E runs do not request notification permission or mutate backend push tokens.

`EXPO_PUBLIC_*` variables are included in the client bundle, so never put secrets there.

Apple and Google auth setup is documented in [../docs/SOCIAL_AUTH.md](../docs/SOCIAL_AUTH.md). Changing Apple capability or Google iOS URL scheme requires a new development build.

IAP setup, backend store credentials, sandbox/internal testing, restore behavior, and troubleshooting are documented in [../docs/IAP.md](../docs/IAP.md).

## Expo Push Notifications

The template already includes the Expo Push foundation, but it intentionally does not commit Expo owner/project identity or provider credentials. Push registration is disabled on web, in `EXPO_PUBLIC_E2E=1` bundles, when `EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=1`, and when EAS `extra.eas.projectId` is missing.

After mobile auth resolves on a physical iOS or Android device, the app registers an Expo push token through `POST /api/notifications/push-token`, unregisters best-effort on logout/session expiry, and navigates from notifications only to safe internal `data.href` paths. SecureStore keeps one opaque installation UUID, a separate installation secret, and a monotonic mutation generation across restarts and account switches. The backend stores only the secret hash, applies only the newest authorized generation, atomically transfers token ownership, and retains an inactive tombstone after cleanup; a delayed request from the previous account therefore cannot reclaim the device, and knowing an Expo token is not sufficient to delete it. Existing token-only SecureStore data is first claimed by its authenticated owner, after which the same installation can transfer safely between accounts without dropping pending cleanup evidence. The provider revalidates once per authenticated scope on each app launch, so a device evicted by the per-account token cap recovers on its next open.

Setup checklist for a real project:

1. During bootstrap, choose the real Expo personal account or organization, then set `expo.owner`, project slug, `ios.bundleIdentifier`, and `android.package`.
2. Run `bunx eas-cli project:init` so the installed project gets EAS `extra.eas.projectId`. Leave this unconfigured in the template itself.
3. Configure push credentials in Expo/EAS: APNs key/certificate for iOS and FCM for Android according to Expo's push notification docs. Do not commit `.p8`, `.p12`, `.keystore`, `google-services.json`, `GoogleService-Info.plist`, service-account JSON, or other credential files.
4. Build and install an Expo development client or production build on a physical device. Expo Go, simulators, and the baseline web export are not the validation target for project push notifications.
5. Backend: run the API plus `bun run --cwd backend start:worker:notifications` for continuous delivery, or `bun run --cwd backend start:cron -- notifications:process` as the scheduled/recovery path. If Expo Push Security is enabled, set `EXPO_PUSH_ACCESS_TOKEN` only for the worker and/or notification cron that calls Expo; the API only enqueues notifications.
6. Temporarily set backend `ENABLE_TEST_PUSH=true`, sign in on the device, and call authenticated `POST /api/notifications/test-push`. The route queues only; confirm the worker/cron delivers it and completes the ticket/receipt flow. The endpoint is limited to one test enqueue per user per minute and should remain disabled outside a bounded verification window.

Backend product code sends real notifications by calling `enqueuePushNotification` with a stable per-user `dedupeKey`, `title`, `body`, and optional internal `data.href`.

## Development Build

Adding or changing a native module means a **new development build** — reloading JavaScript is not
enough, and an existing dev client throws at import time. The profile photo feature added
`expo-image-picker`, `expo-image-manipulator`, and `expo-file-system`, and an `expo-image-picker`
config plugin that writes `NSPhotoLibraryUsageDescription`. If you pull that change, rebuild before
opening the profile screen. Run `bun run --cwd mobile doctor` after any Expo dependency change.

1. Sign up or log in to an Expo account.
2. Check EAS CLI availability with `bunx eas-cli --version`.
3. Log in with `bunx eas-cli login`.
4. Link the project with `bunx eas-cli project:init`.
5. Build a development build:

```bash
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

`expo-dev-client` is already installed. Native `ios` and `android` folders are not stored in this template; Expo prebuild/development build workflows generate them when needed.

Google Sign-In, App Store purchase flows, and Google Play purchase flows require a custom development build. Google Sign-In does not use Expo Go as the validation target for this template.

`expo-iap` requires a custom development build. App Store and Google Play purchase/restore flows do not work in Expo Go.

After changing the `expo-iap` config plugin or native purchase setup, rebuild the development client before testing. EAS handles prebuild during the remote build; for local native projects, run `npx expo prebuild --clean` before rebuilding. Real store purchase and restore checks should run on real devices or Play/App Store testing builds with tester accounts.

## Maestro E2E

The Maestro smoke flow verifies `register -> current user -> logout` against an installed Expo development build. It is designed for Expo dev client, not Expo Go. Run it against a backend that is using Docker Compose `postgres_test`, not the development database.

Start the backend test database and API in a separate terminal:

Create `backend/.env` from `backend/.env.example` first if it does not already
exist. Keep `POSTGRES_TEST_PORT` and `TEST_DATABASE_URL` aligned there when using
a custom test port.

```bash
docker compose version
docker info
docker compose --env-file backend/.env up -d postgres_test
export TEST_DATABASE_URL="postgresql://superuser:superpassword@localhost:54330/web_app_demo_test?schema=public"
export LAN_IP=<your-machine-lan-ip>
export BACKEND_PORT=3000
export METRO_PORT=8081
DATABASE_URL="$TEST_DATABASE_URL" bun run --cwd backend prisma:deploy
PORT="$BACKEND_PORT" DATABASE_URL="$TEST_DATABASE_URL" JWT_SECRET="mobile-e2e-secret-at-least-thirty-two-characters" CORS_ORIGINS="http://$LAN_IP:$METRO_PORT,http://localhost:$METRO_PORT" COOKIE_SECURE=false bun run --cwd backend start:raw
```

Start Metro for the installed dev build in another terminal:

```bash
export LAN_IP=<your-machine-lan-ip>
export BACKEND_PORT=3000
export METRO_PORT=8081
EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL="http://$LAN_IP:$BACKEND_PORT" bunx expo start --dev-client --host lan --port "$METRO_PORT"
```

```bash
bun run e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
EXPO_PUBLIC_E2E=1 MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081 E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health bun run e2e:maestro
```

Run the local policy audit after changing Maestro flows or runner inputs:

```bash
bun run e2e:maestro:audit
```

Before running the flow, the backend must be reachable at the `EXPO_PUBLIC_API_URL` used when Metro serves the mobile bundle, and Metro must be reachable at `MAESTRO_DEV_SERVER_URL`. The runner opens `exp+mobile://expo-development-client/?url=<metro-url>` after state reset and after app relaunch so Maestro lands in the app bundle instead of the Expo launcher or simulator home screen. If you rename the Expo slug, set `MAESTRO_DEV_CLIENT_SCHEME=exp+<slug>`.

Stable selectors live in `src/constants/testIds.ts`, the flow is `.maestro/flows/auth-smoke.yaml`, and the runner is `scripts/e2e/run-maestro.mjs`. Detailed runbook: [../docs/TESTING.md](../docs/TESTING.md).

## Practice

The profile photo has no Maestro flow: choosing a photo opens the operating system's own picker,
a native modal outside the app's view hierarchy that Maestro cannot drive. The upload protocol,
the 412-is-success rule, the normalization plan, and the error copy are covered by unit tests
instead, with the picker behind a port.

What that leaves unproven is worth stating plainly. The **web** build has been driven end to end
in a real browser - pick, resize to 512px, re-encode as JPEG, measure, ticket, PUT, finalize,
display, replace, remove, reload, and an account switch that must not show the previous account's
photo. The **native** round trip has not: `expo-file-system`'s upload, the OS picker itself, and
the `PRIVATE_STORAGE_LOCAL_PUBLIC_URL` loopback trap below are reachable only from a device, and
a simulator hides the last one because there `127.0.0.1` is the host. Run those by hand on a dev
build before trusting them.

File uploads follow the same split as the API layer: `src/platform/uploads` owns the transfer
protocol and knows nothing about what is being uploaded, while `src/features/avatar` owns the
endpoints, the photo picker, and the UI. A second kind of upload reuses the protocol instead of
copying it.

Reading a file is the one part that differs per platform, so it is a port: `UploadFileAccess`
pairs "measure the bytes" with "send the bytes", and `AppProviders` picks `nativeFileAccess` or
`webFileAccess` once from `Platform.OS`. They travel together because a ticket is signed for one
exact byte count - measuring with one platform's reader and sending with the other's produces an
opaque 403 from storage. This matters because `expo-file-system` is a warn-only stub on web while
the picker and manipulator work there, so `bun run web` would otherwise reach the upload with a
valid image and no way to read it.

Use TanStack Query for server state, TanStack Form for forms, and shared Zod schemas for validation. Native iOS/Android use `/api/auth/token/*`: the refresh token is stored in `expo-secure-store` and the access token lives only in app memory. Logout first persists a non-secret pending marker beside that existing credential, then clears in-memory access/query state immediately. A confirmed revocation or terminal stale authority clears the refresh credential before clearing the marker; a timeout or network error retains both. On restart, bootstrap sees the marker before attempting refresh, remains anonymous, and boundedly retries logout with the retained credential and session-scoped push cleanup evidence. Expo Web follows the same marker protocol without copying its cookie authority into JavaScript: its refresh token stays in the backend-issued HttpOnly cookie and is never written to JavaScript storage. Expo Web serializes cookie-mutating auth requests through an exclusive Web Lock, with an in-process queue fallback. Successful register, login, and logout transitions increment a monotonic browser epoch inside that lock; storage/BroadcastChannel events invalidate other tabs, and refresh verifies both the captured epoch and the backend-issued `{ userId, sessionId }` identity before retrying an authenticated request. Bounded logout aborts its request at the timeout so it cannot retain the shared lock indefinitely. The native token transport does not use the browser coordinator.

Product code lives in `src/features/auth`, `src/features/avatar`, `src/features/billing`, and `src/features/notifications`. `src/composition` builds the namespaced APIs and passes each provider only its own interface. `src/platform/api` owns endpoint-agnostic fetch, auth retry, base URL, and error parsing; each feature API owns its endpoint paths and schemas. Routes are thin wrappers that import features through public indexes. Run `bun run architecture:check` after boundary changes and `bun run doctor` (pinned to Expo Doctor 1.20.0) after Expo dependency changes.

Mobile UI primitives live in `src/components/ui` and mirror the local Web ShadCN registry by file name. They are React Native-first implementations using native style props, controlled/uncontrolled values, and native touch patterns instead of DOM/Radix props such as `className` or `asChild`. The protected `/components` route is the local component catalog and the post-auth smoke surface.

The canonical native color, radius, spacing, typography, and interaction tokens live in `src/components/ui/theme-tokens.ts` and `src/components/ui/theme.ts`. Shared dashboard composition belongs in `src/components/dashboard`: `ScreenShell`, `SiteHeader`, section/metric/account cards, navigation rail/items, data rows, and reusable loading/empty/error states. Product-owned auth and billing components accept semantic data, state, and callbacks; they do not expose `style` or `className`. Routes only arrange those closed components.

Render visible text through `src/components/ui/typography.tsx`. `Typography` owns the mobile type scale from `h1` through `h6` plus body, caption, label, button, link, and code text variants; screens and UI primitives should not import React Native `Text` directly or use legacy text wrappers.

## Mobile Template Line Synchronization

Template maintainers merge `master` into `mobile`, preserve the mobile runtime and its
`available` Payments/Push/Social capability rows, then validate the clean candidate before push:

```bash
git fetch origin
bun install --frozen-lockfile
bun run mobile:template:check
```

After pushing the validated candidate, verify the published ref:

```bash
git fetch origin
bun run mobile:template:check -- --published
```

The default check allows a clean candidate ahead of `origin/mobile`; `--published` additionally
requires `HEAD` to equal that ref. Both verify current `origin/master`, the native App Store and
Google Play paths, the cross-surface contract, equivalent agent instructions, the template ledger,
and the relevant local suites. If the check fails, stop setup or template publication. After first-run setup
changes capabilities to `included` or `removed`, do not use this template gate for product releases;
use the installed product's recorded local test, typecheck, store-sandbox, and release runbooks.

## Current Upstream Documentation

For Expo, React Native, routing, secure storage, EAS, forms, server-state, or E2E questions, consult the current upstream documentation linked here first. This README describes this app's conventions; upstream docs are authoritative for platform behavior.

- [Expo docs](https://docs.expo.dev/)
- [Expo SDK 57 docs](https://docs.expo.dev/versions/latest/)
- [Expo Router docs](https://docs.expo.dev/router/introduction/)
- [Expo SecureStore docs](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo AppleAuthentication docs](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
- [React Native Google Sign-In Expo setup](https://react-native-google-signin.github.io/docs/setting-up/expo)
- [Expo Notifications docs](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo Push Notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo Push Notifications sending API](https://docs.expo.dev/push-notifications/sending-notifications/)
- [Expo EAS docs](https://docs.expo.dev/eas/)
- [EAS Build docs](https://docs.expo.dev/build/introduction/)
- [React Native docs](https://reactnative.dev/docs/getting-started)
- [TanStack Query React docs](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Form React docs](https://tanstack.com/form/latest/docs/framework/react/quick-start)
- [Zod docs](https://zod.dev/)
- [Maestro docs](https://docs.maestro.dev/)
