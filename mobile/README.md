# Mobile

Expo serves ordinary users on iOS, Android, and web. Administration belongs to webapp. Scripts and dependencies are in [package.json](package.json). Store subscriptions are disabled by default. Social sign-in remains disabled.

## Run locally

Prepare the [backend](../backend/README.md#local-development). Copy [.env.example](.env.example) to `mobile/.env`. Run the API and Expo in separate terminals:

```bash
bun run dev:backend
bun run dev:mobile
```

Use the local user account from `DEV_SEED_*`. The seed does not grant premium access.

### Environment

`EXPO_PUBLIC_API_URL` must be reachable from the device. Android Emulator uses `10.0.2.2`; a physical phone uses the computer's LAN address. For local filesystem uploads, set `PRIVATE_STORAGE_LOCAL_PUBLIC_URL` in `backend/.env` to the same reachable host.

Every `EXPO_PUBLIC_*` value enters the client bundle. Keep secrets out of these variables. `EXPO_PUBLIC_E2E=1` and `EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=1` disable push registration.

Bun uses isolated dependencies. When switching between master and mobile, remove root and workspace `node_modules` and reinstall. Keep `bun.lock`.

Expo Doctor can report duplicate packages from the isolated peer cycle between Expo, its CLI, and Router. Verify native autolinking and the Metro singleton resolver before changing dependency structure.

## Development build

Expo SDK, native module, plugin, capability, or URL-scheme changes require a new development build. JavaScript reload cannot update the installed native client.

For a product project, authenticate with EAS and initialize it under the user's Expo account:

```bash
bunx eas-cli login
bunx eas-cli project:init
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

Keep the template unlinked. Google sign-in, store purchases, and Maestro need a development or store build. Expo Go is insufficient. Test purchases and push on the required device and tester account.

## Sessions

Native refresh tokens stay in SecureStore; access tokens stay in memory. Expo Web uses HttpOnly cookies and an exclusive Web Lock. It refuses cookie changes when Web Locks are unavailable.

Sign-out records a pending marker before clearing local state. Temporary failures retain cleanup data. On launch, finish pending revocation before refreshing. Do not retry a request under a different user or session.

Session changes must cancel user queries and pending requests. Use the existing transport and session coordination instead of duplicating them.

## Components and files

Routes compose public feature APIs. `src/composition` wires each provider to its own API. Platform code owns HTTP and file mechanics without product endpoints.

Use native UI primitives and `Typography`. Theme tokens belong to `src/components/ui`. Product components own visual styles; routes place them through layout wrappers. Do not forward `style` or `className` into product components.

Use CSS safe-area insets on web. Expo Router does not measure web insets during streamed hydration. Keep native safe-area handling in the native component implementation.

[Storage](../docs/STORAGE.md#mobile-transfer) explains native and web upload differences. The profile picker and file transfer still need device verification.

## Push notifications

Set the product owner, app identifiers, and EAS project ID in `app.config.js`. Configure APNs and FCM through Expo. Keep signing files and service-account credentials out of Git.

Registration requires a physical device and a configured EAS project. Simulators, web, and E2E do not register. The installation secret and generation prevent delayed requests from another account from reclaiming the token.

The API queues messages. Run the scheduled sender or `start:worker:notifications`; see [Push pipeline](../docs/BACKGROUND_JOBS.md#push-pipeline). Only the sender needs the Expo push security secret.

For verification, temporarily enable `ENABLE_TEST_PUSH` and call the authenticated test-push endpoint. Confirm arrival, ticket, and receipt, then disable the endpoint. Notification destinations must remain safe internal routes.

## Optional features and tests

Use [Subscriptions](../docs/IAP.md) and [Social sign-in](../docs/SOCIAL_AUTH.md) to enable or remove those features. Check current store rules before changing purchase behavior.

[Testing](../docs/TESTING.md#mobile-e2e) covers Maestro. Package scripts define types, lint, and bundle export for iOS, Android, and web. Run the auth journey against a development build after flow changes.

## Template maintenance

Keep shared changes on master and mobile-specific changes on mobile. Merge master before publishing mobile. On a clean mobile commit, run `bun run mobile:template:check`. After pushing, add `-- --published` to verify the published commit.

The gate requires master ancestry and runs all repository checks plus bundle export for every platform. It does not run Maestro on a device. A new product uses its own release process.
