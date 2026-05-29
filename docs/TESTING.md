# Testing

The goal of this template's tests is to show future agents where behavior should be verified and how to keep E2E broad enough to protect valuable behavior without turning it into exhaustive matrices.

## Pyramid

- Contracts/unit: shared Zod schema matrices, env parsing, JWTs, password hashing, client API refresh/retry behavior, and token cleanup.
- Backend integration: refresh-token rotation, auth guards, duplicate registration, concurrency, and stable error shapes through real routes and PostgreSQL.
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
docker compose up -d postgres
cp backend/.env.example backend/.env
bun run test
bun run test:contracts
bun run test:backend
bun run test:backend:integration
bun run test:webapp
bun run test:mobile
bun run --cwd backend prisma:validate
bun run smoke:backend:docker
```

Contract tests live in `packages/contracts/src/*.test.ts` and protect shared request/response/error schemas used by backend, webapp, and mobile. Webapp and mobile unit tests live in each client `tests/` directory and cover API refresh/retry behavior that would be too expensive and brittle to fully exercise in E2E.

Backend tests live next to backend code and verify auth behavior through services and routes. The integration runner starts `postgres_test`, applies migrations, and runs register/login/refresh/logout/guard/error-shape scenarios. By default, the test database port is derived from the absolute repository path so parallel checkouts do not collide, and `TEST_DATABASE_URL` is derived from that port. Set `POSTGRES_TEST_PORT` and `TEST_DATABASE_URL` only when a fixed test database is required. Local database startup, credentials, and reset behavior are documented in [LOCAL_DATABASE.md](LOCAL_DATABASE.md).

The integration and Docker smoke runners refuse database names that do not end with `_test` unless an override is set intentionally. This protects `web_app_demo` development data from test writes.

The Docker smoke test builds the backend image, starts it against `postgres_test`, waits for `/health`, and removes only the smoke container it created.

`.github/workflows/ci.yml` runs typecheck, contract tests, webapp client tests, mobile client tests, backend tests, and the webapp Playwright smoke flow on pushes to `main` and pull requests.

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
- uses `TEST_DATABASE_URL` as the primary database URL, then passes that value to the backend as `DATABASE_URL` inside the test run;
- starts the backend on `E2E_BACKEND_PORT`, which defaults to a repository-derived port;
- starts Vite on `E2E_WEB_PORT`, which defaults to a repository-derived port;
- stops its `postgres_test` compose project and removes the test volume after the run unless `E2E_KEEP_DOCKER=1` is set;
- runs the auth smoke path: client validation visibility -> register/login mode switching -> register -> cookie refresh after reload -> protected route -> logout -> invalid login error -> successful login.

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
- `EXPO_PUBLIC_E2E=1` set when Metro serves the bundle and when the runner starts. This keeps the password field automatable in E2E while production bundles keep `secureTextEntry`.

Start the mobile E2E backend on the test database in a separate terminal. Prefer LAN-reachable URLs for both iOS Simulator and Android Emulator so the same runbook also works on physical devices:

```bash
docker compose version
docker info
docker compose up -d postgres_test
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

Mobile E2E uses `testID` selectors from `mobile/src/constants/testIds.ts`. New flows should add stable selectors in UI instead of relying on fragile coordinates. Text selectors are acceptable for final user-visible messages. The auth smoke checks register, session restore after app relaunch, and logout. Any product-specific flow that depends on fixture data, such as an order flow that needs an available catalog item, should perform a preflight through the backend API before Maestro starts. Fail with a clear setup error when required test data is missing instead of falling over midway through the UI.

Before changing Maestro startup, selectors, or E2E-only app behavior, run:

```bash
bun run --cwd mobile e2e:maestro:audit
```

The policy audit keeps the template from reintroducing known-bad patterns such as `hideKeyboard`, coordinate taps, missing dev-client `openLink`, stale `.maestro/.env.example`, or production password fields being weakened outside `EXPO_PUBLIC_E2E=1`.

The template intentionally keeps the official mobile lane on Expo dev client because it does not commit generated native `ios`/`android` folders. A mature product may later move to a bundled iOS E2E app once native folders are owned by that project. That stronger lane should use a dedicated simulator bundle id, runner-owned build/install, one launch helper with `launchApp.clearState/clearKeychain`, isolated backend ports, typed seed manifests, post-run backend assertions, a machine-wide simulator lock, and no Metro/dev-client handoff.

### Mobile E2E Pitfalls: Expo Dev Client + Maestro

- Maestro needs an installed Expo development build when the app uses `expo-dev-client` or native dependencies. Running the flow through Expo Go usually tests the Expo launcher, not this app.
- `launchApp` is only used to clear state at the beginning. The flow then opens the bundle through `openLink` with `exp+<slug>://expo-development-client/?url=<metro-url>&disableOnboarding=1`, and it opens the same link again after `stopApp`.
- Metro and backend URLs must be reachable from the target device. Prefer `EXPO_PUBLIC_API_URL=http://<LAN_IP>:<BACKEND_PORT>`, `bunx expo start --dev-client --host lan --port <METRO_PORT>`, and `MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:<METRO_PORT>`.
- `secureTextEntry` can break Maestro input on iOS even when Maestro reports success. The template uses `EXPO_PUBLIC_E2E=1` to make the password field non-secure only in E2E bundles.
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
