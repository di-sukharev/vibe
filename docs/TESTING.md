# Testing

The goal of this template's tests is to show future agents where behavior should be verified and how to keep E2E broad enough to protect valuable behavior without turning it into exhaustive matrices.

## Pyramid

- Contracts/unit: shared Zod schema matrices, env parsing, JWTs, password hashing, client API refresh/retry behavior, and token cleanup.
- Backend integration: refresh-token rotation and replay detection, one-time password reset and session revocation, auth/role guards, profile updates, serialized administrator role changes, duplicate registration, concurrency, and stable error shapes through real routes and PostgreSQL.
- Webapp Playwright: valuable browser flows through a real backend and Vite UI.
- Mobile Maestro: valuable mobile smoke and regression flows against an installed Expo development build.

Client E2E should cover valuable user journeys, including non-happy-path states that protect real product behavior, when they can stay stable. Important edge cases must be covered at some automated level; choosing integration, contract, or unit coverage instead of E2E is not permission to skip them. Negative validation matrices, combinatorial edge cases, concurrency, and pure rules belong in unit/integration tests.

## Choosing Test Level

Default to the highest useful behavioral boundary:

- Use E2E when the risk is user-visible and crosses client/backend boundaries: critical journeys, auth/session restore, persistence, navigation, high-risk regressions, and important empty/error states.
- Use backend integration for API/auth/persistence/contracts, stable error shapes, validation behavior, concurrency, and database-backed domain rules.
- Use contract/unit tests selectively for shared schema matrices, pure rules with many branches, env parsing, security/token helpers, password hashing, and client retry/cache/token cleanup behavior that would be brittle or expensive in E2E.

For TDD-first work, list the expected behavior and important edge cases before implementation, then write the first failing test at the boundary that best catches the regression. Important edge cases include validation boundaries, permission failures, expired sessions, empty data, duplicate or conflicting writes, retry/recovery paths, and persistence after refresh or restart.

Do not add E2E coverage just because a branch exists. Add it when it prevents a plausible product regression and can stay stable through explicit setup, stable selectors/test IDs, isolated test data, and deterministic assertions. Do not skip important edge cases just because they are not E2E-worthy; cover them through integration, contract, or unit tests. Keep exhaustive validation matrices and combinatorial edge cases out of E2E.

## Backend

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
docker compose --env-file backend/.env up -d postgres
bun run test
bun run test:contracts
bun run test:backend
bun run test:backend:integration
bun run test:webapp
bun run test:mobile
bun run --cwd backend prisma:validate
bun run smoke:backend:docker
```

Backend test files are discovered, not listed, and the filename decides which of the three runners
picks them up. Anything under `backend/src` or `backend/scripts` named `*.integration.test.ts` needs
the Docker Postgres and runs in `test:integration`. Anything named `*.live.test.ts` needs an external
service or account that no runner starts for it - the local S3 container, or an email provider - and
runs in `test:live`.
Everything else named `*.test.ts` or `*.test.mjs` runs in `test:unit` with nothing installed. Name a
test accordingly: `backend/scripts/test-files.mjs` owns the split and `backend/scripts/test-files.test.mjs`
fails if the runners stop being complementary. A suite belonging to a capability that ships switched
off marks itself `@parked-test` in its opening comment and runs in no runner until that line is
deleted; `backend/src/modules/billing/billing.integration.test.ts` is the example.
The third category exists so `bun run test` stays runnable on a machine with no Docker daemon. A
live test landing in the unit set would fail for everyone who has not started a container, and a red
suite people learn to ignore is worse than no suite. Run the live tests deliberately:

```bash
bun run test:storage:s3          # starts the local S3 container and runs the storage contract
bun run --cwd backend test:live  # runs whichever live suites the environment configures
```

`backend/scripts/test-live.mjs` owns a table of live suites - storage, Postbox, Resend - each with
the variables it needs. It runs the ones that are fully configured, refuses with the missing names
when one is half configured, and refuses outright when none is, because a live contract test that
quietly passes without contacting anything proves nothing. Every `*.live.test.ts` must belong to
exactly one suite or the script fails, the same reasoning as the unclaimed-file check above. See
[STORAGE.md](STORAGE.md) and [EMAIL.md](EMAIL.md).

Contract tests live in `packages/contracts/src/*.test.ts` and protect shared request/response/error schemas used by backend, webapp, and mobile. Webapp and mobile unit tests live in each client `tests/` directory and cover API refresh/retry behavior that would be too expensive and brittle to fully exercise in E2E.

Backend tests live next to their owning product modules. Integration tests exercise auth, users/admin RBAC, and notifications through application/transport boundaries and real PostgreSQL persistence. The billing suite is parked with its capability (docs/IAP.md) and runs again once the tables are uncommented. The integration runner starts `postgres_test`, applies migrations, and covers session rotation, role guards, profile validation, last-admin/concurrent-demotion safety, role-change session revocation, seed idempotence, ownership, outbox retries, receipts, and stable error shapes. By default, the test database port is derived from the absolute repository path so parallel checkouts do not collide, and `TEST_DATABASE_URL` is derived from that port. Set `POSTGRES_TEST_PORT` and `TEST_DATABASE_URL` only when a fixed test database is required. Local database startup, credentials, and reset behavior are documented in [LOCAL_DATABASE.md](LOCAL_DATABASE.md).

The integration and Docker smoke runners refuse database names that do not end with `_test` unless an override is set intentionally. This protects `web_app_demo` development data from test writes.

The Docker smoke test uses a unique Compose project and host port for every invocation, builds the backend image, starts it against its own `postgres_test`, waits for `/health/ready`, verifies DB-backed token auth, and removes only the isolated containers, network, and volume it created.

No runner uses `docker compose down`. It cannot be scoped to a service, so it would stop the optional
local storage container and delete the volume holding a developer's uploads as a side effect of
running tests. Teardown removes the test database service and its named volume explicitly instead.

This template does not ship with GitHub Actions or another hosted validation runner. Run the relevant checks locally after each task, starting with the smallest set that meaningfully covers the changed surface and expanding only when risk justifies it. Production releases and activated SSG rebuilds follow the selected hosting provider's deployment runbook; they do not run task validation.

## Webapp E2E

Playwright is configured in `webapp/playwright.config.ts`.

First-time setup:

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
bun run --cwd webapp e2e:install
bun run e2e:webapp
```

If `docker compose version` or `docker info` fails, install/start Docker first by following [LOCAL_DATABASE.md](LOCAL_DATABASE.md). Do not replace this with native PostgreSQL for new users.

The webapp E2E flow:

- starts `docker compose up -d postgres_test` unless `E2E_SKIP_DOCKER=1` is set;
- chooses repository-derived ports by default, and automatically moves to the nearest free ports if those are already occupied;
- generates the Prisma client and applies migrations;
- seeds a login-capable E2E administrator without exposing its credentials to the browser bundle;
- uses `TEST_DATABASE_URL` as the primary database URL, then passes that value to the backend as `DATABASE_URL` inside the test run;
- starts the backend on `E2E_BACKEND_PORT`, which defaults to a repository-derived port;
- starts Vite on `E2E_WEB_PORT`, which defaults to a repository-derived port;
- removes the `postgres_test` service and its named volume after the run unless `E2E_KEEP_DOCKER=1` is set, leaving every other service and volume in the project untouched;
- stores filesystem-driver uploads under `webapp/e2e/.artifacts/storage` rather than `backend/.storage`;
- runs the user path: validation -> register -> `/app` sidebar -> refresh -> profile persistence -> logout/login safe return;
- runs the administrator path: seeded login -> `/admin` sidebar -> cross-role redirects -> search/promotion -> target session revocation -> admin login;
- restores one logical browser session concurrently in two tabs, propagates confirmed logout and bootstrap-error recovery, and converges both tabs on the winning session after competing account changes;
- runs the avatar path: upload -> finalize -> persistence across a reload -> replace -> delete, plus an aborted transfer that recovers on retry, a file that is not the image it claims to be, and one user's avatar staying invisible to another.

The avatar spec runs against the filesystem driver by default, so `bun run e2e:webapp` needs no
extra container. Run the identical spec against a real S3 server with:

```bash
bun run e2e:webapp:s3
```

Both must pass. That is what proves a project can develop locally and deploy to a bucket without
changing product code.

Useful env:

```bash
TEST_DATABASE_URL="postgresql://superuser:superpassword@localhost:<test-port>/web_app_demo_test?schema=public"
POSTGRES_TEST_PORT=<test-port>
E2E_BACKEND_PORT=<backend-port>
E2E_WEB_PORT=<web-port>
E2E_SKIP_DOCKER=1
E2E_KEEP_DOCKER=1
```

By default, Playwright computes `POSTGRES_TEST_PORT` from the absolute repository path and refuses to run against a database that does not use the `_test` suffix. This prevents E2E from accidentally writing to development or production data. Use `DATABASE_URL` only as a low-level override; `TEST_DATABASE_URL` is the documented test entry point.

Playwright artifacts live in `webapp/e2e/.artifacts/` and are not committed. For interactive debugging:

```bash
bun run --cwd webapp e2e:ui
```

## Mobile Maestro E2E

The Maestro flow is `mobile/.maestro/flows/auth-smoke.yaml`; the runner is `mobile/scripts/e2e/run-maestro.mjs`.

Install the CLI:

```bash
bun run --cwd mobile e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version
```

The setup script installs the repo-pinned Maestro CLI through the official installer. Override intentionally with `MAESTRO_VERSION=<version> bun run --cwd mobile e2e:maestro:setup`. The runner requires Maestro `2.4.0+` by default; override the minimum with `MAESTRO_MIN_VERSION` only when validating a known compatible newer policy.

Prerequisites:

- Java 17+.
- Xcode/iOS Simulator for iOS, or Android Studio/emulator for Android.
- An installed Expo development build with `bundleIdentifier/package` set to `com.webappdemo.mobile`. Maestro should not run this template flow through Expo Go.
- A backend started against Docker Compose `postgres_test`, reachable at the `EXPO_PUBLIC_API_URL` used when Metro serves the bundle.
- A host-reachable `E2E_API_HEALTH_URL` for runner preflight, for example `http://<LAN_IP>:3000/health`.
- A host-reachable Metro URL in `MAESTRO_DEV_SERVER_URL`, for example `http://<LAN_IP>:8081`.
- `EXPO_PUBLIC_E2E=1` set when Metro serves the bundle and when the runner starts. This keeps E2E-only integrations such as push registration disabled; the Maestro flow reveals the password through the same eye control users receive.

Start the mobile E2E backend on the test database in a separate terminal. Prefer LAN-reachable URLs for both iOS Simulator and Android Emulator so the same runbook also works on physical devices:

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

If you use a custom `POSTGRES_TEST_PORT`, use the same port in both `TEST_DATABASE_URL` and `DATABASE_URL`. The Maestro runner does not start the backend itself because the installed mobile build must already point at the correct API URL.

In another terminal, start Metro for an installed development build:

```bash
cd mobile
export LAN_IP=<your-machine-lan-ip>
export BACKEND_PORT=3000
export METRO_PORT=8081
EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL="http://$LAN_IP:$BACKEND_PORT" bunx expo start --dev-client --host lan --port "$METRO_PORT"
```

Development build examples:

```bash
cd mobile
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000 bunx eas-cli build --profile development --platform ios
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000 bunx eas-cli build --profile development --platform android
```

Run the smoke flow:

```bash
EXPO_PUBLIC_E2E=1 MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081 E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health bun run --cwd mobile e2e:maestro
```

Useful env:

```bash
MAESTRO_DEVICE="iPhone 16 Pro"
MAESTRO_APP_ID=com.webappdemo.mobile
MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081
MAESTRO_DEV_CLIENT_SCHEME=exp+mobile
MAESTRO_MIN_VERSION=2.4.0
E2E_DISPLAY_NAME="Mobile E2E User"
E2E_EMAIL="mobile-e2e@example.com"
E2E_PASSWORD=password123
E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health
EXPO_PUBLIC_E2E=1
MAESTRO_SKIP_API_PREFLIGHT=1
MAESTRO_SKIP_METRO_PREFLIGHT=1
MAESTRO_SKIP_E2E_ENV_PREFLIGHT=1
MAESTRO_DRY_RUN=1
```

Mobile E2E uses `testID` selectors from `mobile/src/constants/testIds.ts`. New flows should add stable selectors in UI instead of relying on fragile coordinates. Text selectors are acceptable for final user-visible messages. The mobile auth smoke checks register, the signed-in dashboard, session restore after app relaunch, and logout. Any product-specific flow that depends on fixture data, such as an order flow that needs an available catalog item, should perform a preflight through the backend API before Maestro starts. Fail with a clear setup error when required test data is missing instead of falling over midway through the UI.

Before changing Maestro startup, selectors, or E2E-only app behavior, run:

```bash
bun run --cwd mobile e2e:maestro:audit
```

The policy audit keeps the template from reintroducing known-bad patterns such as `hideKeyboard`, coordinate taps, missing dev-client `openLink`, stale `.maestro/.env.example`, or password automation that bypasses the user-facing visibility control.

The template intentionally keeps the official mobile lane on Expo dev client because it does not commit generated native `ios`/`android` folders. A mature product may later move to a bundled iOS E2E app once native folders are owned by that project. That stronger lane should use a dedicated simulator bundle id, runner-owned build/install, one launch helper with `launchApp.clearState/clearKeychain`, isolated backend ports, typed seed manifests, post-run backend assertions, a machine-wide simulator lock, and no Metro/dev-client handoff.

### Mobile E2E Pitfalls: Expo Dev Client + Maestro

- Maestro needs an installed Expo development build when the app uses `expo-dev-client` or native dependencies. Running the flow through Expo Go usually tests the Expo launcher, not this app.
- `launchApp` is only used to clear state at the beginning. The flow then opens the bundle through `openLink` with `exp+<slug>://expo-development-client/?url=<metro-url>&disableOnboarding=1`, and it opens the same link again after `stopApp`.
- Metro and backend URLs must be reachable from the target device. Prefer `EXPO_PUBLIC_API_URL=http://<LAN_IP>:<BACKEND_PORT>`, `bunx expo start --dev-client --host lan --port <METRO_PORT>`, and `MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:<METRO_PORT>`.
- `secureTextEntry` can break Maestro input on iOS even when Maestro reports success. The flow taps the real password-visibility control before entering the password; every app launch still starts with the password hidden.
- `hideKeyboard` is unreliable on React Native/iOS. Prefer `keyboardDismissMode="on-drag"` on scroll containers, scrolling to the next target, or tapping stable static content when a keyboard must be dismissed.
- Keep touch targets at least about `44-48pt`. Small `Pressable` controls and custom checkboxes can produce missed taps.
- Do not rely on `checked: true` for custom React Native checkbox controls. Maestro may expose an accessible value such as `checkbox, checked` while the hierarchy `checked` field remains false. Assert a stable visible or accessible state instead.
- `scrollUntilVisible` can stop when an element is barely inside the viewport. Use `visibilityPercentage: 100` and `centerElement: true` before tapping important CTA buttons.
- After removing Expo starter routes, clean native tabs, web tabs, and string `href` values at the same time. Prefer object-form navigation for dynamic or query routes so typed Expo Router routes catch stale paths.
- Product E2E should validate test data before the UI flow starts: backend health, auth/session prerequisites, and required seed data should fail or skip in preflight with a readable message.

## Current Upstream Documentation

For testing questions, consult the current upstream documentation linked here first. This document describes this repository's testing contract; upstream docs are authoritative for runner behavior.

- Playwright intro: https://playwright.dev/docs/intro
- Playwright `webServer`: https://playwright.dev/docs/test-webserver
- Playwright `baseURL`, traces, screenshots, and video: https://playwright.dev/docs/test-use-options
- Playwright CLI and browser install: https://playwright.dev/docs/test-cli and https://playwright.dev/docs/browsers
- Maestro docs: https://docs.maestro.dev/
- Maestro CLI install/run: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli and https://docs.maestro.dev/maestro-cli/run-your-first-test-with-the-maestro-cli
- Maestro selectors, launch reset, deep links, waits, and scrolls: https://docs.maestro.dev/api-reference/selectors, https://docs.maestro.dev/reference/commands-available/launchapp, https://docs.maestro.dev/api-reference/commands/openlink, https://docs.maestro.dev/reference/commands-available/extendedwaituntil, and https://docs.maestro.dev/reference/commands-available/scrolluntilvisible
- Expo development build deep links: https://docs.expo.dev/develop/development-builds/development-workflows/
- Expo dev client: https://docs.expo.dev/versions/latest/sdk/dev-client/
- Docker Compose: https://docs.docker.com/compose/
- PostgreSQL Docker Official Image: https://hub.docker.com/_/postgres
