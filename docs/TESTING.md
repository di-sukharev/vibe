# Testing

This guide covers test runners, test databases, focused commands, and E2E setup. The test policy is in "Tests and TDD" in [AGENTS.md](../AGENTS.md); scripts are indexed in [COMMANDS](COMMANDS.md).

## Rules

- Name a backend test by what it needs: `*.integration.test.ts` for PostgreSQL, `*.live.test.ts` for an external service. Other tests must run with nothing installed.
- Run integration files only through `bun run test:backend:integration`. Without its `TEST_DATABASE_URL`, they throw, so a plain `bun test` fails.
- A test database name must end in `_test`. The overrides are per runner and not interchangeable: `TEST_ALLOW_NON_TEST_DATABASE=1` (integration, Docker smoke), `BACKEND_DOCKER_SMOKE_ALLOW_NON_TEST_DATABASE=1` (the smoke container), `E2E_ALLOW_NON_TEST_DATABASE=1` (Playwright).
- Never remove a test database with `docker compose down`. It cannot target one service, so it would also stop local S3 or, with `-v`, delete its uploads.
- Do not add jsdom, happy-dom, or another DOM library.

## Test levels

- Contracts: `packages/contracts/src/*.test.ts`; `bun run test:contracts`.
- Backend unit: other `*.test.ts` and `*.test.mjs` in `backend/src` and `backend/scripts`; `bun run test:backend:unit`.
- Backend integration: `*.integration.test.ts`, the real app through HTTP with real PostgreSQL; `bun run test:backend:integration`.
- Repository scripts: `scripts/*.test.mjs`; `bun run test:infra`.
- Client unit: `webapp/tests`, `website/tests`, `mobile/tests`; `bun run test:webapp`, `bun run test:website`, `bun run test:mobile`.
- Build contracts: `website/build-contracts`; `bun run test:build-contracts`.
- E2E: Playwright specs in `webapp/e2e/specs`; `bun run e2e:webapp`.
- Mobile E2E: a Maestro flow on an Expo development build; `bun run e2e:mobile`. See [Mobile E2E](#mobile-e2e).

Tests of a capability that ships switched off are parked. A backend suite parks itself with `@parked-test` in its opening comment, and every backend runner skips it until the line is removed. This applies to the suites in `backend/src/modules/billing/`. Mobile uses no marker: `test:mobile` skips `mobile/tests/parked/`, so move a file out of it to run it. [IAP](IAP.md) lists what to restore when you turn subscriptions on.

## Focused commands

```bash
bun run test:backend:unit -- src/modules/auth/password-reset-cooldown.test.ts -t "outbox retry"
bun run test:backend:integration -- src/db.integration.test.ts -t "different jobs"
bun test packages/contracts/src/users.test.ts -t "profile updates"   # also webapp/tests, website/tests, mobile/tests
bun run --cwd webapp e2e -- auth.spec.ts -g "registers, restores"
```

`backend/scripts/test-files.mjs` selects the backend runner by filename. Backend runners take exact paths relative to `backend/` and `-t` (`--test-name-pattern`). An unknown path is an error.

## Backend integration

The repository Compose project is `COMPOSE_PROJECT_NAME` or `vibecoding-template-<hash>` from `scripts/repo-env.mjs`, not the development database's project. Each integration run starts `postgres_test` in its own project, `<repository project>-integration-<id>`. It applies migrations and runs the selected files. Then it removes that run's container, volume, and network, also after a failed start. Development data and local storage stay.

Each test gets 3 minutes, not Bun's 5 s. Password hashing is slow on a busy machine, and the budget must outlast the longest transaction timeout in `backend/src/db.ts`, 140 s, so a held lock fails its request rather than the harness. Override with `--timeout=<ms>`.

The port is derived from the checkout path. The runner does not search for a free port: a parallel run from the same checkout fails and leaves the first alone. To pin the database, set `POSTGRES_TEST_PORT` and `TEST_DATABASE_URL` with the same port. The backend runners also read both from `backend/.env`; Playwright does not.

- `TEST_KEEP_DOCKER=1` keeps the run's database.
- `TEST_SKIP_DOCKER=1` with `TEST_DATABASE_URL` uses a running database. The runner starts and removes nothing. Without a URL, it fails.

### Fast TDD loop

Start the database once, then iterate on one test. Iterations still apply new migrations.

```bash
TEST_KEEP_DOCKER=1 bun run test:backend:integration -- src/modules/users/users.integration.test.ts
TEST_SKIP_DOCKER=1 TEST_DATABASE_URL="postgresql://superuser:superpassword@localhost:<port>/web_app_demo_test?schema=public" \
  bun run test:backend:integration -- src/modules/users/users.integration.test.ts -t "name"
```

Find `<port>` with `docker ps`. When you finish, remove the kept project; `docker compose ls` shows its name:

```bash
docker compose -p <project> rm --stop --force --volumes postgres_test
docker volume rm <project>_postgres_18_test_data
docker network rm <project>_default
```

## Docker smoke

`bun run smoke:backend:docker` builds the backend image and runs it against its own `postgres_test`, in a separate Compose project on free ports. It checks `/health/ready`, a sign-up through `/api/auth/token/register`, and `/api/auth/me`. Then it removes both containers.

## Live tests

- `bun run test:storage:s3` starts local S3 and runs the storage contract against it.
- `bun run --cwd backend test:live` runs every fully configured suite: S3 storage, Postbox, and Resend. `backend/scripts/test-live.mjs` lists their variables. A partial configuration, or none, fails.

See [STORAGE](STORAGE.md) and [EMAIL](EMAIL.md).

## Client unit tests

`webapp/tests` covers client logic such as refresh and retry, `AuthProvider` state, form validation, and route tables. Test UI behavior through pure functions and hooks, not markup. When a test must mount a provider, use the real `react-dom/client` and React `act`, and reuse the root container and `window` doubles in `auth-provider.test.ts`.

`mobile/tests` follows the same model for the Expo app. It replaces Expo and React Native modules with `mock.module` from `bun:test`.

## Build contracts

Only `bun run test:build-contracts` builds. It builds `webapp` and `website`, then checks the new `website/dist`. The landing page's static HTML must carry its title, description, Open Graph title, and heading, and the hero fallback. The hero island must hydrate when the browser is idle. The R3F canvas must be a separate chunk that the island loads. A contract file run alone checks the existing `dist/`. Add a contract only for a property of the built output.

## Webapp E2E

Install the browser once with `bun run --cwd webapp e2e:install`. Docker must run; see [LOCAL_DATABASE](LOCAL_DATABASE.md). For a task, run one spec with `-g "name"`. For storage changes, also run `bun run e2e:webapp:s3`: the avatar spec against local S3. It accepts Playwright options, but no other spec.

A run (`webapp/playwright.config.ts`, `webapp/e2e/global-setup.ts`) starts `postgres_test` in the repository Compose project, applies migrations, and seeds an admin and a user. It uses checkout-derived ports, or the nearest free ones, for the database, backend, and Vite. The backend runs with email disabled and stores uploads in `webapp/e2e/.artifacts/storage`. At the end, the run removes only `postgres_test` and its volume. E2E and `bun run screens` share that Compose project, so run them one at a time.

Specs find elements by `data-testid`. Reports and failure traces, screenshots, and videos go to `webapp/e2e/.artifacts/`, which Git ignores. Debug with `bun run --cwd webapp e2e:ui`.

- `TEST_DATABASE_URL`: use this database. Its port wins.
- `POSTGRES_TEST_PORT`, `E2E_BACKEND_PORT`, `E2E_WEB_PORT`: pin a port.
- `E2E_SKIP_DOCKER=1`: use a running database. Start and remove nothing.
- `E2E_KEEP_DOCKER=1`: keep the database.

Screenshot tour (`bun run screens`): see [UI](UI.md).

## Mobile E2E

`bun run e2e:mobile` runs the Maestro auth smoke, `mobile/.maestro/flows/auth-smoke.yaml`, through `mobile/scripts/e2e/run-maestro.mjs`. It checks registration, the signed-in screen, session restore after a restart, and sign-out. The runner neither installs the app nor starts Metro or the backend.

Requirements:

- Java 17+ and the Maestro CLI. `bun run --cwd mobile e2e:maestro:setup` installs the pinned version with the official installer; `MAESTRO_VERSION` overrides it. Then add `$HOME/.maestro/bin` to `PATH`. The runner requires 2.4.0 or later (`MAESTRO_MIN_VERSION`).
- Xcode with the iOS Simulator, or Android Studio with an emulator.
- An installed Expo development build with the ID `com.webappdemo.mobile`. Expo Go does not work. [mobile/README](../mobile/README.md) shows how to build one.
- `EXPO_PUBLIC_E2E=1` for Metro and the runner. It turns off push registration and other integrations that disturb the flow.

Create `backend/.env` from `backend/.env.example` first. Then run the test database with an API on it, Metro, and the flow, each in its own terminal from the repository root. LAN addresses work for simulators and devices. The database port must match `POSTGRES_TEST_PORT`; Compose defaults to 54330.

```bash
# 1: test database and API
docker compose --env-file backend/.env up -d postgres_test
export TEST_DATABASE_URL="postgresql://superuser:superpassword@localhost:54330/web_app_demo_test?schema=public"
DATABASE_URL="$TEST_DATABASE_URL" bun run --cwd backend prisma:deploy
PORT=3000 DATABASE_URL="$TEST_DATABASE_URL" JWT_SECRET="mobile-e2e-secret-at-least-thirty-two-characters" \
  CORS_ORIGINS="http://<LAN_IP>:8081,http://localhost:8081" COOKIE_SECURE=false bun run --cwd backend start:raw

# 2: Metro for the installed development build
cd mobile && EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL="http://<LAN_IP>:3000" bunx expo start --dev-client --host lan --port 8081

# 3: the flow
EXPO_PUBLIC_E2E=1 MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081 E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health bun run e2e:mobile
```

The installed build must already reach the API through `EXPO_PUBLIC_API_URL`. `mobile/.maestro/.env.example` lists the runner options: device, app ID, dev-client scheme, test account, the `MAESTRO_SKIP_*` preflight switches, and `MAESTRO_DRY_RUN`.

Selectors are `testID` values from `mobile/src/constants/testIds.ts`. Add stable IDs for a new flow. Before a product flow, check its data through the backend API, and fail with a clear setup error before the UI starts.

Before you change a flow, its launch, or its selectors, run `bun run --cwd mobile e2e:maestro:audit`. It checks the runner and the active auth flow. It rejects `hideKeyboard`, coordinate taps, a missing dev-client `openLink`, a stale `.maestro/.env.example`, and a password typed without the visibility button.

Dev client and Maestro pitfalls:

- `launchApp` only clears state. The flow then opens `exp+<slug>://expo-development-client/?url=<metro-url>&disableOnboarding=1`; after `stopApp`, it opens the link again.
- On iOS, `secureTextEntry` can drop typed text while Maestro reports success. Tap the visibility button first; each launch starts with the password hidden.
- Dismiss the keyboard with `keyboardDismissMode="on-drag"`, a scroll, or a tap on static content, not `hideKeyboard`.
- Keep tap targets near 44–48 pt. Small `Pressable` and checkbox targets miss taps.
- Do not trust `checked: true` on a custom checkbox. Assert a visible or accessible state.
- Before an important button, use `scrollUntilVisible` with `visibilityPercentage: 100` and `centerElement: true`.
- After you remove starter routes, update the native tabs, web tabs, and string `href` values. Use object navigation for dynamic routes and query parameters, so Expo Router types check them.

The template keeps no `ios` or `android` directory. A product that owns them can test a separately built iOS app instead. That path needs its own simulator bundle ID, a runner that builds and installs the app, `launchApp` with `clearState` and `clearKeychain`, separate ports, a typed seed, backend checks after the flow, and a simulator lock. It needs no Metro or dev client.

## Dependency audit

`bun run audit` runs `bun audit`. It fails on any advisory, needs package registry access, and runs last in `bun run check`. Run it before a release and after dependency updates. Fix an advisory with an update. Ignore one only with the user's approval, and record the reason in `CHECKLIST.md`.

- When no fix exists, add `--ignore=<GHSA-id>` to the `audit` script in the root `package.json`. State the reason and a review date in the commit message.
- Root `overrides` set minimum safe versions for transitive packages. After an update, remove them one at a time. Keep an override removed if the audit still passes.
- Prisma packages have an exact version pin; see [ARCHITECTURE](ARCHITECTURE.md).
