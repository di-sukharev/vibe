# Testing

This guide covers local setup and commands. [AGENTS.md](../AGENTS.md#testing-and-verification) defines check selection and E2E limits.

Use focused checks for routine tasks. Run full `bun run check` for an explicit release, a system-wide audit, or a change across the system:

`template:check -> architecture:check -> audit -> typecheck -> lint -> test -> test:build-contracts`.

The dependency audit needs package registry access. Backend integration needs Docker. Only the last test script builds the applications and writes `dist/`. It checks the production output of `webapp` and `website`.

`bun run template:check` checks `CHECKLIST.md`, the capability registry, the `AGENTS.md` import in `CLAUDE.md`, and Markdown links. It needs no extra dependencies. Run `bun run test:terraform` separately. It requires Terraform CLI.

## Test levels

- Contracts/unit: pure rules, Zod contracts, environment settings, JWT, password hashes, client refresh/retry, and token cleanup.
- Build contracts: properties of the completed `dist/`, such as CSS isolation and a separate hero scene. See [build contracts](#build-contracts).
- Backend integration: the real application and HTTP with isolated PostgreSQL. Check sign-in, permissions, profile storage, errors, and concurrency.
- Playwright: important successful paths through the real webapp and backend.
- Maestro: successful native paths in an installed Expo development build.

## Task checks

Follow the [rules](../AGENTS.md#testing-and-verification) and select a focused command below. Backend integration covers most profile changes. A client scenario can prove that a value persists after a reload. It must not depend on notification wording.

Open a browser only on explicit request. For such a run, record the route, initial state, action, and result.

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

# Focused checks for routine tasks:
bun run test:backend:unit -- src/modules/auth/password-reset-cooldown.test.ts -t "outbox retry"
bun run test:backend:integration -- src/db.integration.test.ts -t "different jobs"
bun test packages/contracts/src/users.test.ts -t "profile updates"
```

Files in `backend/src` and `backend/scripts` are discovered automatically. `backend/scripts/test-files.mjs` selects the runner by filename:

| Filename | Runner | Requirements |
| --- | --- | --- |
| `*.integration.test.ts` | `test:integration` | Docker PostgreSQL |
| `*.live.test.ts` | `test:live` | An external service or account that the runner does not start |
| Other `*.test.ts` and `*.test.mjs` files | `test:unit` | No external services |

Tests for a disabled capability have `@parked-test` in the opening comment. They do not run until the marker is removed. This currently applies to the `backend/src/modules/billing/` suites. Mobile uses no marker. It excludes `mobile/tests/parked/` through `--path-ignore-patterns`. Move a file out of that directory to enable it.

Unit and integration runners accept exact discovered paths relative to `backend/` and the `-t`/`--test-name-pattern` filter. Without filters, they run the full suite.

Integration allows 3 minutes per test instead of Bun's default 5 seconds. Password hashing on a busy machine can take more than 5 seconds. A test body can continue after a timeout and interfere with cleanup for the next test. For a focused run, change the timeout with `--timeout=<ms>`.

`bun run test:backend:unit` does not require Docker. The root `bun run test` requires it because it includes integration tests. Do not put a live test in the unit suite. Run it explicitly:

```bash
bun run test:storage:s3          # starts local S3 and checks the contract
bun run --cwd backend test:live  # checks configured external services
```

`backend/scripts/test-live.mjs` defines the storage, Postbox, and Resend suites and their required variables. It runs fully configured suites. Partial configuration produces an error with the missing variable names. The command also fails if no suite is configured. See [STORAGE](STORAGE.md) and [EMAIL](EMAIL.md).

`packages/contracts/src/*.test.ts` checks request, response, and error contracts for backend, webapp, and mobile. Client unit tests in each client's `tests/` check refresh/retry. Webapp also checks `AuthProvider` state where full E2E tests would be expensive and fragile.

The provider test uses the real `react-dom/client`, React `act`, and small test doubles for the root container and `window`. The repository has no jsdom or happy-dom. Extend the existing test doubles. Do not add a DOM library. Check components that produce HTML, such as profile form validation, with `react-dom/server` and `renderToStaticMarkup`. The `mobile` branch extends the same model for Expo.

Backend tests are next to their modules. Integration checks authentication, users/admin RBAC, and notifications through the application and transport with real PostgreSQL. Billing tests are disabled with the capability. Enable them after enabling the tables according to [IAP.md](IAP.md). Coverage includes session rotation, permissions, profiles, the last administrator, concurrent role demotions, session revocation, seed idempotency, ownership, outbox retries, receipts, and error formats.

Each managed run creates a separate `${COMPOSE_PROJECT_NAME}-integration-<run>`. It starts `postgres_test`, waits for readiness, applies migrations, and runs the selected files. Without a filter, it runs all discovered integration tests.

`finally` removes only that run's service, `<run-project>_postgres_18_test_data` volume, and network. Cleanup also runs after a partial startup failure. The development database and local storage are not affected.

- `TEST_KEEP_DOCKER=1` keeps resources for diagnosis.
- For an external test database, set both `TEST_SKIP_DOCKER=1` and an explicit `TEST_DATABASE_URL`. Skipping Docker without a URL is prohibited. This mode does not start or clean up Docker.
- By default, the port is derived from the absolute repository path, and the URL is derived from the port. For a fixed database, set `POSTGRES_TEST_PORT` and `TEST_DATABASE_URL`.

Two runs from the same checkout get different Compose projects but the same derived port. If the port is occupied, the second run fails without stopping the first. To use another run's managed database, enable skip and supply its test URL.

Integration and Docker smoke require a database name with `_test` by default. A separate variable permits an intentional exception. This protects `web_app_demo` from test writes. See [LOCAL_DATABASE.md](LOCAL_DATABASE.md) for connection and reset instructions.

Docker smoke creates a separate Compose project and port. It builds the backend and starts it with its own `postgres_test`. It waits for `/health/ready`, checks token authentication with the database, and removes only its own containers, network, and volume.

No runner uses `docker compose down`. That command is not limited to one service and can remove upload storage. Runners target only the test database service and its volume for removal.

The template has no GitHub Actions or other cloud test runner. Run task checks locally. Production releases and enabled automatic SSG rebuilds follow the hosting guide. They do not replace task tests.

## Build contracts

```bash
bun run test:build-contracts
```

The script builds `webapp` and `website`. It then runs `webapp/build-contracts/*.test.ts` and `website/build-contracts/*.test.ts`. These checks read the new `dist/` output:

- CSS excludes utilities used only by stories.
- Static HTML includes the hero fallback.
- The R3F scene remains a separate part that loads lazily.

`bun run test:webapp` and `bun run test:website` only read data. They do not create `dist/` or inherit the developer's build environment. Thus, `bun run check` builds and checks the output once, after the other tests.

A build-contract file run on its own checks the existing `dist/`. If it is missing, the error points to the build command. Add these checks only for properties of the completed output. Use unit tests for other properties.

## Webapp E2E

Playwright configuration is in `webapp/playwright.config.ts`. For the first run:

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
bun run --cwd webapp e2e:install
bun run --cwd webapp e2e -- auth.spec.ts -g "registers, restores"
```

For a task, use `spec -g "test name"`. Reserve the full `bun run e2e:webapp` for an explicitly requested broad check. If Docker is unavailable, follow [LOCAL_DATABASE.md](LOCAL_DATABASE.md). Do not replace it with a native database for new users.

The E2E script:

- Runs `docker compose up -d postgres_test` unless `E2E_SKIP_DOCKER=1` is set.
- Selects ports based on the repository. If occupied, it selects the nearest free ports.
- Generates Prisma, applies migrations, and creates an E2E administrator. The administrator's password does not enter the browser build.
- Passes `TEST_DATABASE_URL` to the backend as `DATABASE_URL`.
- Starts the backend on `E2E_BACKEND_PORT` and Vite on `E2E_WEB_PORT`.
- Removes only `postgres_test` and its volume after the run unless `E2E_KEEP_DOCKER=1` is set.
- Stores test files in `webapp/e2e/.artifacts/storage`, not `backend/.storage`.
- Checks authentication and profiles, role routes and promotion, session coordination across tabs, and avatars.

The avatar scenario uses filesystem storage by default, with no extra container. To run the same scenario with real S3:

```bash
bun run e2e:webapp:s3
```

Use this check for storage changes or an explicit storage audit. It does not repeat the other authentication and RBAC scenarios. Extra arguments can set Playwright options, but the test file remains `avatar.spec.ts`.

Variables:

```bash
TEST_DATABASE_URL="postgresql://superuser:superpassword@localhost:<test-port>/web_app_demo_test?schema=public"
POSTGRES_TEST_PORT=<test-port>
E2E_BACKEND_PORT=<backend-port>
E2E_WEB_PORT=<web-port>
E2E_SKIP_DOCKER=1
E2E_KEEP_DOCKER=1
E2E_ALLOW_NON_TEST_DATABASE=1
```

Playwright requires a database name with `_test` by default. Only explicit `E2E_ALLOW_NON_TEST_DATABASE=1` removes this restriction. Backend uses a separate `TEST_ALLOW_NON_TEST_DATABASE`. These variables are not interchangeable.

`TEST_DATABASE_URL` is the documented input. Reserve `DATABASE_URL` for low-level overrides. `scripts/repo-env.mjs` derives the Compose project, service, volume, and port. E2E and backend integration share it.

Do not commit artifacts from `webapp/e2e/.artifacts/`. For interactive debugging:

```bash
bun run --cwd webapp e2e:ui
```

## Mobile Maestro E2E

Scenario: `mobile/.maestro/flows/auth-smoke.yaml`. Runner: `mobile/scripts/e2e/run-maestro.mjs`.

Install the CLI:

```bash
bun run --cwd mobile e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version
```

The script uses the official installer and a pinned Maestro version. To override it explicitly, use `MAESTRO_VERSION=<version> bun run --cwd mobile e2e:maestro:setup`. The runner requires `2.4.0+`. Change `MAESTRO_MIN_VERSION` only when verifying a compatible new policy.

Requirements:

- Java 17+.
- Xcode and iOS Simulator, or Android Studio and an emulator.
- An installed Expo development build with `bundleIdentifier/package` set to `com.webappdemo.mobile`. Expo Go is not sufficient.
- A backend with Docker Compose `postgres_test`, reachable through the Metro build's `EXPO_PUBLIC_API_URL`.
- An `E2E_API_HEALTH_URL` reachable from the computer, for example `http://<LAN_IP>:3000/health`.
- A reachable Metro server at `MAESTRO_DEV_SERVER_URL`, for example `http://<LAN_IP>:8081`.
- `EXPO_PUBLIC_E2E=1` when starting Metro and the runner. It disables push registration and other integrations that interfere with E2E. The scenario uses the regular password visibility button before entering the password.

Create `backend/.env` from `backend/.env.example` if it is missing. For a custom port, keep `POSTGRES_TEST_PORT` and `TEST_DATABASE_URL` consistent. Start the test database and API in a separate terminal. LAN addresses work for simulators and physical devices:

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

The port in `TEST_DATABASE_URL` and `DATABASE_URL` must match `POSTGRES_TEST_PORT`. Maestro does not start the backend. The installed application must already have the correct API URL.

In another terminal, start Metro for the installed development build:

```bash
cd mobile
export LAN_IP=<your-machine-lan-ip>
export BACKEND_PORT=3000
export METRO_PORT=8081
EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL="http://$LAN_IP:$BACKEND_PORT" bunx expo start --dev-client --host lan --port "$METRO_PORT"
```

Build examples:

```bash
cd mobile
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000 bunx eas-cli build --profile development --platform ios
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000 bunx eas-cli build --profile development --platform android
```

Run the smoke scenario:

```bash
EXPO_PUBLIC_E2E=1 MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081 E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health bun run --cwd mobile e2e:maestro
```

Available options:

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

`testID` selectors are in `mobile/src/constants/testIds.ts`. Add stable IDs for new scenarios. Check data and completed actions according to [AGENTS.md](../AGENTS.md#testing-and-verification). Auth smoke checks registration, opening the account area, session restoration after restart, and logout.

Before a product scenario, check the required data through the backend API. For example, an order needs an available product. Missing data must produce a clear setup error before the UI starts.

Before changing Maestro startup, selectors, or E2E behavior, run:

```bash
bun run --cwd mobile e2e:maestro:audit
```

The audit checks the runner and active authentication scenario. It rejects `hideKeyboard`, coordinate taps, missing dev-client `openLink`, an outdated `.maestro/.env.example`, and password entry that bypasses the user's visibility button. Inactive capabilities are outside the audit scope.

The standard path uses Expo dev client. Native `ios` and `android` directories are not stored in Git. If the product starts to own these directories, it can use a separately built iOS E2E application. That path requires a separate simulator bundle ID, a runner that builds and installs the application, and shared startup with `launchApp.clearState/clearKeychain`. It also requires separate ports, a typed seed, backend checks after the scenario, and a simulator lock on the computer. Metro and dev client are not needed for that path.

### Expo Dev Client and Maestro limitations

- Use an installed development build. Expo Go can open its own launcher instead of the application.
- `launchApp` only clears the initial state. Then `openLink` opens `exp+<slug>://expo-development-client/?url=<metro-url>&disableOnboarding=1`. After `stopApp`, open the same link again.
- The device must reach Metro and the backend. Prefer `EXPO_PUBLIC_API_URL=http://<LAN_IP>:<BACKEND_PORT>`, `bunx expo start --dev-client --host lan --port <METRO_PORT>`, and `MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:<METRO_PORT>`.
- `secureTextEntry` can prevent input on iOS even when Maestro reports success. First tap the regular password visibility button. Each application start begins with the password hidden.
- Use `keyboardDismissMode="on-drag"`, scrolling, or a tap on a stable static element instead of unreliable `hideKeyboard`.
- Keep tap targets around `44–48pt` or larger. Small `Pressable` and checkbox targets can miss taps.
- For a custom checkbox, do not rely on `checked: true`. The accessible value can be `checkbox, checked` while the hierarchy field is false. Check a stable visible or accessible state.
- Before an important button, set `scrollUntilVisible` options to `visibilityPercentage: 100` and `centerElement: true`.
- After removing starter routes, update native tabs, web tabs, and string `href` values. For dynamic routes or query parameters, use object navigation with Expo Router type checks.
- Before the UI starts, check backend availability, authentication and session prerequisites, and seed data. On failure, stop or skip the scenario with a clear message.

## Dependency updates

Root package.json `overrides` set minimum safe versions for transitive packages that are not imported directly. After an update, remove constraints one at a time. Keep them removed if `bun run audit` passes. `bun update` respects the constraints.

If no fix is available, add a narrow temporary `temporaryAuditExceptions` entry in [scripts/dependency-audit.mjs](../scripts/dependency-audit.mjs). The entry records the vulnerability, lockfile versions, direct consumers, projects, and expiry date. It does not permit a direct application dependency or import.

The mobile exceptions cover three advisories:

- `image-size@1.2.1` in the Metro build: `GHSA-w3rx-r6r6-pgpr`, `GHSA-5p2g-fcmc-qvqq`. Review by 2026-09-24. See the [upstream issue](https://github.com/github/advisory-database/issues/9028).
- `decode-uri-component@0.2.2` through `query-string` in Expo Router deep links: `GHSA-vcc3-ghjq-m6fr`. Review by 2026-12-05. The fixed `0.5.0` is ESM-only and incompatible with the `^0.2.2` requirement. An override breaks Metro.

Remove exceptions after a compatible fix is available.

See [ARCHITECTURE.md](ARCHITECTURE.md#prisma) for the Prisma version constraint.

## Official documentation

The repository contract is described above. Check runner behavior against the current official documentation:

- [Playwright](https://playwright.dev/docs/intro)
- [Playwright webServer](https://playwright.dev/docs/test-webserver)
- [baseURL, traces, screenshots, and video](https://playwright.dev/docs/test-use-options)
- [Playwright CLI](https://playwright.dev/docs/test-cli) and [browser installation](https://playwright.dev/docs/browsers)
- [Docker Compose](https://docs.docker.com/compose/)
- [Official PostgreSQL image](https://hub.docker.com/_/postgres)

[Maestro documentation](https://docs.maestro.dev/)

[Maestro CLI installation](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli) [First Maestro test](https://docs.maestro.dev/maestro-cli/run-your-first-test-with-the-maestro-cli)

[Maestro selectors](https://docs.maestro.dev/api-reference/selectors,) [launchApp](https://docs.maestro.dev/reference/commands-available/launchapp,) [openLink](https://docs.maestro.dev/api-reference/commands/openlink,) [extendedWaitUntil](https://docs.maestro.dev/reference/commands-available/extendedwaituntil,) [scrollUntilVisible](https://docs.maestro.dev/reference/commands-available/scrolluntilvisible)

[Expo development workflows](https://docs.expo.dev/develop/development-builds/development-workflows/)
