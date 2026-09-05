# Testing

The goal of this template's tests is to help future agents prove each change at the narrowest stable boundary while keeping a small, valuable browser regression portfolio.

Focused task validation is the default. `bun run check` is the broad repository regression for an
explicit release/audit pass or a genuinely cross-cutting change. Its chain is
`template:check -> architecture:check -> audit -> typecheck -> lint -> test`. The audit needs
registry access, and the broad command requires Docker because its test phase includes backend
integration. `bun run template:check` is the fast, dependency-free guard for `CHECKLIST.md`, the
capability ledger, the `CLAUDE.md` import of `AGENTS.md`, and local Markdown file, directory, and
heading links. Terraform remains an explicit optional signal through `bun run test:terraform` when
its CLI is installed.

## Pyramid

- Contracts/unit: pure rules, shared Zod wire shapes, env parsing, JWTs, password hashing, client API refresh/retry behavior, and token cleanup.
- Backend integration: route/auth/database behavior such as refresh-token rotation, one-time password reset, role guards, profile persistence, duplicate registration, and concurrency.
- Webapp Playwright: a curated portfolio of product journeys and failure mechanisms that depend on a real browser and Vite UI.
- Mobile Maestro: lives on the `mobile` branch with the runnable Expo app.
- Focused manual browser passes: primary evidence for visual and local interaction work when permanent automation has no recurring regression value.

## Task Validation

- Scope acceptance and validation to the changed behavior or invariant and its directly coupled risks, with one decisive observable primary signal.
- Use the narrowest stable boundary that directly detects the failure; add targeted secondary checks for coupled risks.
- Run a pre-change baseline when the same focused signal clarifies the current behavior, then reuse it after the edit.
- Place pure rules and isolated client logic in unit tests, shared wire shapes in contract tests, and route/auth/database behavior in backend integration tests.
- Keep Playwright as a small portfolio of product-critical client-to-API journeys plus failure mechanisms that depend on a real browser: cookies and session restore, reloads and redirects, multiple tabs, navigation, or browser file transfer and CORS.
- Before adding browser E2E, name the neighboring lower-level coverage and the unique failure mechanism, or extend an existing journey. Mock-heavy validation, copy, success/error, loading, and empty-state matrices stay below E2E unless they uniquely exercise cookies, reloads, redirects, multiple tabs, navigation, file transfer or CORS, or browser accessibility or focus.
- A focused manual browser pass records the route, starting state, action, and expected outcome; it can be the primary signal for visual or local interaction work.
- Finish with the task-specific signals and widen from the concrete blast radius. Broad repository regression is a separate release/audit activity unless the change itself is genuinely cross-cutting.

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
bun run --cwd backend prisma:validate
bun run smoke:backend:docker

# Focused examples used during ordinary tasks:
bun run test:backend:unit -- src/modules/auth/password-reset-cooldown.test.ts -t "outbox retry"
bun run test:backend:integration -- src/db.integration.test.ts -t "different jobs"
bun test packages/contracts/src/users.test.ts -t "profile updates"
```

Backend test files are discovered, not listed, and the filename decides which of the three runners
picks them up. Anything under `backend/src` or `backend/scripts` named `*.integration.test.ts` needs
the Docker Postgres and runs in `test:integration`. Anything named `*.live.test.ts` needs an external
service or account that no runner starts for it - the local S3 container, or an email provider - and
runs in `test:live`.
Everything else named `*.test.ts` or `*.test.mjs` runs in `test:unit` with nothing installed. Name a
test accordingly: `backend/scripts/test-files.mjs` owns the split. The unit and integration runners
accept exact discovered file paths relative to `backend/` plus Bun's `-t`/`--test-name-pattern`
filter. Omitting both selects the complete runner-owned suite for broad regression.

The third category keeps `bun run test:backend:unit` runnable without Docker. The root
`bun run test` still requires Docker because it deliberately includes backend integration. A live
test landing in the unit set would fail for everyone who has not configured that provider, so run
live tests deliberately:

```bash
bun run test:storage:s3          # starts the local S3 container and runs the storage contract
bun run --cwd backend test:live  # runs whichever live suites the environment configures
```

`backend/scripts/test-live.mjs` owns a table of live suites - storage, Postbox, Resend - each with
the variables it needs. It runs the ones that are fully configured, refuses with the missing names
when one is half configured, and refuses outright when none is, because a live contract test that
quietly passes without contacting anything proves nothing. See [STORAGE.md](STORAGE.md) and
[EMAIL.md](EMAIL.md).

Contract tests live in `packages/contracts/src/*.test.ts` and protect shared request/response/error schemas used by backend and webapp. Webapp unit tests live in `webapp/tests` and cover API refresh/retry behavior and the `AuthProvider` session-state contract that would be too expensive and brittle to fully exercise in E2E. The provider test renders the real provider with `react-dom/client` under React `act` against a small in-test root-container and `window` shim; the repository deliberately has no jsdom or happy-dom, so extend that shim rather than adding a DOM library. The `mobile` branch extends this same contract/testing model for Expo.

Backend tests live next to their owning product modules. Integration tests exercise auth and users/admin RBAC through application/transport boundaries and real PostgreSQL persistence. Every managed invocation owns a unique `${COMPOSE_PROJECT_NAME}-integration-<run>` Compose project, starts `postgres_test`, waits for readiness, applies migrations, and runs the selected integration files, or every discovered integration file when no filter is supplied. Its `finally` cleanup removes only that run's service, exact `<run-project>_postgres_18_test_data` volume, and default network, including after a partial startup failure; it cannot remove another run's resources. It never stops the development database or optional local storage. Set `TEST_KEEP_DOCKER=1` to keep the runner-managed test database for investigation. Set `TEST_SKIP_DOCKER=1` together with an explicit `TEST_DATABASE_URL` to use an externally managed test database; the runner rejects the skip flag without that URL, and in this mode it neither starts nor removes Docker resources. By default, the test database port is derived from the absolute repository path so parallel checkouts do not collide, and `TEST_DATABASE_URL` is derived from that port. Set `POSTGRES_TEST_PORT` and `TEST_DATABASE_URL` only when a fixed test database is required. Local database startup, credentials, and reset behavior are documented in [LOCAL_DATABASE.md](LOCAL_DATABASE.md).

Two managed integration runs from the same checkout use separate Compose projects but still target
the same repository-derived host port. If one already owns that port, the other fails startup
without tearing the owner down. To reuse a database another process manages, set
`TEST_SKIP_DOCKER=1` with its explicit test-only URL.

The integration and Docker smoke runners refuse database names that do not end with `_test` unless an override is set intentionally. This protects `web_app_demo` development data from test writes.

The Docker smoke test builds the backend image, starts it against `postgres_test`, waits for `/health/ready`, and removes only the smoke container it created.

No runner uses `docker compose down`. It cannot be scoped to a service, so it would stop the optional
local storage container and delete the volume holding a developer's uploads as a side effect of
running tests. Teardown removes the test database service and its named volume explicitly instead.

This template does not ship with GitHub Actions or another hosted validation runner. Run the focused task signals locally; run broad regression deliberately as release/audit work. Production releases and activated SSG rebuilds follow the selected hosting provider's deployment runbook rather than replacing task validation.

## Webapp E2E

Playwright is configured in `webapp/playwright.config.ts`.

First-time setup:

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
bun run --cwd webapp e2e:install
bun run --cwd webapp e2e -- auth.spec.ts -g "registers, restores"
```

The focused command above runs one existing journey. Use the same `spec -g "test name"` shape for
ordinary task validation; `bun run e2e:webapp` runs the full portfolio for explicit broad regression.
If `docker compose version` or `docker info` fails, install/start Docker first by following
[LOCAL_DATABASE.md](LOCAL_DATABASE.md). Do not replace this with native PostgreSQL for new users.

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
- exercises the curated auth/profile round trip, role-safe navigation and promotion, browser session coordination, and avatar storage journey.

The avatar spec runs against the filesystem driver by default, so `bun run e2e:webapp` needs no
extra container. Run that spec, and only that spec, against a real S3 server with:

```bash
bun run e2e:webapp:s3
```

Use this focused S3 signal when storage behavior changes or as part of a deliberate storage audit.
It proves that local development and bucket deployment use the same browser journey without
repeating unrelated auth and RBAC scenarios. Additional arguments may be Playwright options; the
runner keeps positional file selection fixed on `avatar.spec.ts`.

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

The default branch intentionally does not contain the runnable Expo app or Maestro runner. Use the `mobile` branch for mobile E2E setup, dev-client guidance, stable React Native `testID` selectors, and `bun run --cwd mobile e2e:maestro:audit`.

## Current Upstream Documentation

For testing questions, consult the current upstream documentation linked here first. This document describes this repository's testing contract; upstream docs are authoritative for runner behavior.

- Playwright intro: https://playwright.dev/docs/intro
- Playwright `webServer`: https://playwright.dev/docs/test-webserver
- Playwright `baseURL`, traces, screenshots, and video: https://playwright.dev/docs/test-use-options
- Playwright CLI and browser install: https://playwright.dev/docs/test-cli and https://playwright.dev/docs/browsers
- Docker Compose: https://docs.docker.com/compose/
- PostgreSQL Docker Official Image: https://hub.docker.com/_/postgres
