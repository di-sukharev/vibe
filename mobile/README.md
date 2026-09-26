# Mobile

The Expo app lives on the `mobile` branch, not on `master`. It serves ordinary users on iOS, Android, and Expo Web. It uses the same API contracts as `webapp` (`@web-app-demo/contracts`). Administration and the demo admin account belong to `webapp`.

The branch adds the Expo app, development builds, Maestro E2E, and Expo Push. Social sign-in and App Store and Google Play subscriptions are implemented but switched off.

## Start from the mobile branch

```bash
git fetch origin
git merge-base --is-ancestor origin/master origin/mobile
git switch mobile
bun install --frozen-lockfile
```

Stop setup if the ancestry check fails; the template owner must merge `master` into `mobile` first. Never resolve template conflicts inside a product project.

## Branch ownership

- Make shared web, backend, infrastructure, deployment, and contract changes on `master`.
- Make mobile app changes, and backend or contract changes that only mobile needs, on `mobile`.
- Mobile payments are native and separate from the browser checkout. Read [WEB_SURFACES.md](../docs/WEB_SURFACES.md#mobile-payments) first, and check the current store rules for the product, storefront, and region.

## Screens

- `/` is registration and sign-in, without tabs.
- After sign-in, `/components` and `/profile` open in a tab shell. `/components` is the component catalog and the smoke screen after sign-in.
- `/profile` adds, replaces, and removes the profile photo. Before the upload, the app shrinks the photo and saves it as JPEG.
- `/details/[id]` is a stack screen outside the tabs, with a back button at the top left.
- `/paywall` says that subscriptions are off and offers no purchase, because `IapProvider` is not mounted. [IAP.md](../docs/IAP.md) turns subscriptions on. Then the app sells App Store and Google Play subscriptions and redeems App Store offer codes on iOS. The same guide lists the deferred billing features.
- The Apple and Google sign-in buttons and their backend route are not mounted. [SOCIAL_AUTH.md](../docs/SOCIAL_AUTH.md) turns them on.
- Native builds show bottom tabs. Expo Web shows them below 960 px and a side navigation rail from 960 px.
- `ScreenShell` (`src/components/dashboard/ScreenShell.tsx`) owns the shared screen header. The low-level `Screen` handles the safe area, scrolling, the keyboard, and the back button.

## Run locally

Prepare the backend with the root [quick start](../README.md#quick-start). The seed user signs in to the app:

| Email | Password | Screen after sign-in |
| --- | --- | --- |
| `user@example.com` | `local-user-password` | `/components` |

Sign-in and the components screen need no subscription, and the seed grants no premium access. Deployments never create the demo accounts.

Start the API and Expo in separate terminals:

```bash
bun run dev:backend
bun run dev:mobile
```

A physical device also needs a reachable storage address. The filesystem storage driver signs links with `PRIVATE_STORAGE_LOCAL_PUBLIC_URL`, which defaults to `http://127.0.0.1:<PORT>`. On a phone, that address points to the phone itself. Set it in `backend/.env` to the same host as the app's `EXPO_PUBLIC_API_URL`: the computer's LAN address, or `10.0.2.2` for the Android Emulator.

```bash
# backend/.env
PRIVATE_STORAGE_LOCAL_PUBLIC_URL="http://192.168.1.10:3000"
```

The iOS Simulator can hide this error, because its loopback address reaches the computer.

## Stack

- Expo SDK 57, React Native, TypeScript, and Expo Router.
- TanStack Query and Form, and Zod from `@web-app-demo/contracts`.
- Expo SecureStore and Expo Notifications.
- Expo ImagePicker, ImageManipulator, and FileSystem for the profile photo.
- Expo Apple Authentication and React Native Google Sign-In for the optional social sign-in.
- Expo IAP for App Store and Google Play subscriptions.
- Native shadcn-style UI primitives in `src/components/ui`.
- Maestro for the E2E smoke flow.

## Commands

From `mobile`: `bun run dev`, `android`, `ios`, `web`, `typecheck`, `lint`, `test`, `build` (a static web export), `doctor` (Expo Doctor 1.20.0), and `e2e:maestro`. From the root: `bun run dev:mobile`, `build:mobile`, `typecheck:mobile`, `test:mobile`, and `e2e:mobile`. Scripts are in [package.json](package.json); the index is [COMMANDS](../docs/COMMANDS.md).

`doctor`'s duplicate-dependencies check fails under Bun's isolated linker because of a real peer cycle (`expo` ↔ `@expo/cli` ↔ `expo-router`); this is expected and not a bug to chase. Native autolinking and the `metro.config.js` singleton resolver still keep exactly one copy per platform — verify with `bunx expo-modules-autolinking resolve --platform ios|android`.

## Environment

Copy [.env.example](.env.example) to `mobile/.env`. It holds the API address, the optional Google Sign-In IDs, the store product IDs, and the push switch. Every `EXPO_PUBLIC_*` value goes into the client bundle, so never put a secret there.

- `EXPO_PUBLIC_API_URL` is the backend origin, `http://localhost:3000` by default. Use `http://10.0.2.2:3000` on the Android Emulator and `http://<LAN_IP>:3000` on a phone. Prefer the LAN address for Maestro too.
- Set `EXPO_PUBLIC_E2E=1` only for a Metro session that serves an E2E run.
- `EXPO_PUBLIC_E2E=1` and `EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=1` each turn push registration off. Then a simulator or an E2E run never asks for permission and never changes the backend's tokens.

Apple and Google setup is in [SOCIAL_AUTH.md](../docs/SOCIAL_AUTH.md). A change to the Apple capability or the Google iOS URL scheme needs a new development build. Store setup, backend keys, sandbox and internal testing, restore, and diagnostics are in [IAP.md](../docs/IAP.md).

## Development build

A native module change needs a new development build. A JavaScript reload is not enough: the old client can crash on import. The profile photo, for example, needs `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, and the image picker config plugin that sets `NSPhotoLibraryUsageDescription`. After you pull such a change, rebuild before you open the profile. After an Expo dependency change, run `bun run --cwd mobile doctor`.

Sign up for an Expo account or use an existing one. Then, from `mobile`:

```bash
bunx eas-cli --version
bunx eas-cli login
bunx eas-cli project:init
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

Link only a product project with `project:init`; keep the template itself unlinked. `expo-dev-client` is installed. Expo prebuild generates the `ios` and `android` directories, and Git ignores them.

Google Sign-In and `expo-iap` purchases and restores need a custom development build; Expo Go cannot run them. Rebuild the development client after a change to the IAP plugin or other native setup. EAS runs prebuild itself; before a local native build, run `bunx expo prebuild --clean`. Test real purchases on a device or in a store test build with a tester account.

## Expo Push

The push code is on, but the template sets no Expo owner, project ID, or keys. Registration stays off on web, on simulators and emulators, with `EXPO_PUBLIC_E2E=1` or `EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=1`, and without an EAS project ID (`extra.eas.projectId`).

After sign-in on a physical iOS or Android device, the app registers its Expo push token with `POST /api/notifications/push-token`. On sign-out or session expiry, it tries to unregister it. A tapped notification opens only a safe internal path from `data.href`.

Registration is safe against races and stolen tokens:

- SecureStore keeps an opaque installation UUID, a separate installation secret, and a generation number that grows with each change.
- The backend stores only a hash of the secret and accepts only the newest allowed generation. It moves a token to a new owner atomically and keeps an inactive row after cleanup. A delayed request from an old account cannot take the device back, and knowing the Expo token is not enough to delete it.
- The current signed-in owner first claims an old token-only row. After that, the installation can switch accounts safely and keeps the record of an unfinished cleanup.
- The app revalidates the registration once per signed-in account at each launch. A token that the per-account limit pushed out comes back at the next launch.

The server's lock order and the token-only compatibility rules are in [ARCHITECTURE](../docs/ARCHITECTURE.md#push-registrations).

To set up push for a project:

1. Choose a personal Expo account or an organization. In `app.config.js`, set `expo.owner`, `slug`, `ios.bundleIdentifier`, and `android.package`.
2. Run `bunx eas-cli project:init`, and check that `app.config.js` has the resulting `extra.eas.projectId`. Keep the template itself unlinked.
3. Set up APNs for iOS and FCM for Android through Expo and EAS. Never commit `.p8`, `.p12`, `.keystore`, `google-services.json`, `GoogleService-Info.plist`, or a service-account JSON.
4. Build and install a development or production build on a physical device. Expo Go, a simulator, or a web export does not prove that the project's push works.
5. Run the API and a sender ([BACKGROUND_JOBS](../docs/BACKGROUND_JOBS.md#push-pipeline)). `bun run dev:backend` includes the scheduler, which runs `notifications:process` on its schedule. `bun run --cwd backend start:worker:notifications` sends continuously, and `bun run --cwd backend start:cron -- notifications:process` runs one pass. The API only queues messages. Only the sender calls Expo, so with Expo push security only the sender needs `EXPO_PUSH_ACCESS_TOKEN`.
6. Set `ENABLE_TEST_PUSH=true` for the check. Sign in on the device and call the authenticated `POST /api/notifications/test-push`. Confirm that the message arrives and that its ticket and receipt complete. The endpoint queues one test message per user per minute. Turn it off after the check.

A product push needs a stable per-user `dedupeKey`, a `title`, a `body`, and an optional internal `data.href`. The module exposes no enqueue call yet. To send one, add a `NotificationService` method that queues through the outbox port, as `sendTestPush` does. Return it from `createNotificationsModule` in `backend/src/modules/notifications/index.ts`, because other modules may import only that index. The port's adapter is `enqueuePushNotification`.

## Maestro E2E

The Maestro auth smoke flow registers a user, checks the signed-in screen, restarts the app to check the restored session, and signs out. It runs in an installed Expo development build; Expo Go is not enough. Run it against the `postgres_test` database, never the development one. [TESTING](../docs/TESTING.md#mobile-e2e) has the requirements, the commands, and the known pitfalls.

After a change to Maestro, its launch options, or mobile E2E behavior, run the audit. The runner also runs it at the start of each run.

```bash
bun run --cwd mobile e2e:maestro:audit
```

Before Maestro starts, the runner checks `EXPO_PUBLIC_E2E=1`, the API health URL, and Metro. It builds the dev-client scheme `exp+<slug>` from the app config and targets the app ID `com.webappdemo.mobile`. After you change the bundle identifier or package, set `MAESTRO_APP_ID`.

## Code rules

Uploads:

- No Maestro flow covers the profile photo, because the system picker is outside the app's view hierarchy. Unit tests put the picker behind a port and cover the upload protocol, success on `412`, normalization, and errors.
- Backend integration tests cover ownership, account isolation, and a retry after an interrupted transfer. The webapp E2E journey covers upload, reload, replacement, and removal on the filesystem driver, and on local S3 through `bun run e2e:webapp:s3`. No automated test covers the whole native path: check `expo-file-system`, the system picker, and the LAN `PRIVATE_STORAGE_LOCAL_PUBLIC_URL` on a device.
- `src/platform/uploads` owns the shared upload protocol, and `src/features/avatar` owns the endpoint, the picker, and the UI. [STORAGE](../docs/STORAGE.md#mobile-transfer) has the transfer rules, including the native and web file access pair.

Auth:

- Use TanStack Query for server data, TanStack Form for forms, and the shared Zod schemas.
- Native auth uses `/api/auth/token/*`. The refresh token lives in `expo-secure-store`; the access token lives only in memory.
- Sign-out first writes a non-secret pending marker, then clears the local access token and query cache. A successful revocation, or finally stale credentials, deletes the refresh token and then the marker. A temporary error keeps both. At launch, the app finishes a pending sign-out before any refresh and reuses the saved push cleanup data. The server call has a 2-second timeout. A failure shows a retry, and the UI stays signed out.
- Expo Web keeps the same marker protocol, but its refresh token stays only in the HttpOnly cookie. Every cookie change needs an exclusive Web Lock; without Web Locks, the client refuses before the request. A successful register, login, or logout raises the browser session epoch inside the lock. `storage` and `BroadcastChannel` events tell the other tabs. Before a request retry, refresh compares the epoch and the `{ userId, sessionId }` of the access tokens. On timeout, sign-out aborts the request and releases the lock. The native transport does not use this browser coordinator.

Layout:

- Product code lives in `src/features/auth`, `avatar`, `billing`, and `notifications`. Routes use features only through their public `index.ts`.
- `src/composition` creates the APIs and gives each provider only its own interface.
- `src/platform/api` owns fetch, the auth retry, the base URL, and errors, without endpoint knowledge. Each feature's API owns its paths and schemas.
- After a boundary change, run `bun run architecture:check`.

UI:

- `src/components/ui` implements shadcn components natively, under the same names as the `webapp` registry. Use native style props, controlled or uncontrolled values, and touch behavior instead of DOM and Radix `className` or `asChild`.
- Color, radius, spacing, text, and interaction tokens are in `src/components/ui/theme-tokens.ts` and `src/components/ui/theme.ts`.
- `src/components/dashboard` owns `ScreenShell`, `SiteHeader`, cards, navigation, rows, and the loading, empty, and error states. Auth and billing components take data, states, and callbacks, never `style` or `className`. Routes only place components.
- Render visible text through `Typography` (`src/components/ui/typography.tsx`). It owns `h1`–`h6`, body, caption, label, button, link, and code. Never import React Native `Text` into screens or primitives, and do not use the old text wrappers.

## Template owner: sync and publish

Merge `master` into `mobile`, align docs and the capability registry, then check and publish both branches. Keep the mobile code and the `available` state of the payments, push, and social capabilities. `bun run mobile:template:check` ([scripts/check-mobile-template.mjs](../scripts/check-mobile-template.mjs)) is the release gate:

```bash
git fetch origin
bun install --frozen-lockfile
bun run mobile:template:check                 # before publishing a clean candidate
bun run mobile:template:check -- --published  # after the push
```

The default mode accepts a clean commit ahead of `origin/mobile`; `--published` requires `HEAD` to equal it. Both modes require a clean tree on `mobile` that contains the current `origin/master`, and exactly the payments, push, and social capabilities in state `available`. The check then runs `bun run check` on the synchronized project and the Maestro rule audit. If it fails, do not publish.

After setup, capability states become `included` or `removed`, and this template check no longer applies. Use the project's own recorded checks for releases, such as local tests, types, and store sandboxes.

## Official docs

The app pins Expo SDK 57; read the docs for that version.

- Expo: [docs](https://docs.expo.dev/), [SDK reference](https://docs.expo.dev/versions/latest/), [Router](https://docs.expo.dev/router/introduction/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [AppleAuthentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/), [Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- Expo Push: [setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [sending API](https://docs.expo.dev/push-notifications/sending-notifications/)
- EAS: [docs](https://docs.expo.dev/eas/), [Build](https://docs.expo.dev/build/introduction/)
- [React Native Google Sign-In Expo setup](https://react-native-google-signin.github.io/docs/setting-up/expo)
- [React Native](https://reactnative.dev/docs/getting-started), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview), [TanStack Form](https://tanstack.com/form/latest/docs/framework/react/quick-start), [Zod](https://zod.dev/), [Maestro](https://docs.maestro.dev/)
