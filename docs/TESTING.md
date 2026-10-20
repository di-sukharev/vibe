# Testing

[AGENTS.md](../AGENTS.md#tests-and-tdd) defines the test policy. Package scripts define commands. Prefer HTTP integration tests for backend behavior. Keep unit tests for cases that those tests cannot cover efficiently.

## Focused runs

From the repository root:

```bash
bun run test:backend:integration -- src/modules/users/users.integration.test.ts -t 'name'
bun run test:backend:unit -- src/path.test.ts -t 'name'
bun run test:webapp
bun run e2e:webapp -- auth.spec.ts -g 'name'
```

Backend runners accept paths relative to `backend/`. Name database tests `*.integration.test.ts` and provider tests `*.live.test.ts`. Run them through their package scripts. Plain `bun test` does not prepare their environment. The local `test:backend:unit` command runs filesystem and loopback HTTP integrations without Docker.

## Integration database

The integration runner starts PostgreSQL in a separate Compose project, applies migrations, and removes its resources afterward. It does not remove development or local storage data.

Database names must end in `_test`. Do not override this protection for normal development. Ports derive from the checkout. Parallel integration runs from the same checkout need distinct ports.

For a TDD loop, keep the database after the first run:

```bash
TEST_KEEP_DOCKER=1 bun run test:backend:integration -- src/modules/users/users.integration.test.ts
TEST_SKIP_DOCKER=1 TEST_DATABASE_URL='<kept test database URL>' \
  bun run test:backend:integration -- src/modules/users/users.integration.test.ts -t 'name'
```

Find its project and port with `docker compose ls` and `docker ps`. After the last iteration, remove that run's `postgres_test`, named test volume, and network. Never use `docker compose down -v`: it can also delete storage data.

## Client and build tests

Test client behavior through the browser journeys in `webapp/e2e/specs`. `bun run test:webapp` runs these journeys against the test backend and database. Test shared request schemas through backend HTTP integration tests.

`bun run test:build-contracts` builds both web applications and checks the website output. Use these tests for published metadata, static fallbacks, and asset loading. Running a contract file alone checks the existing build.

## Browser tests and screenshots

Install Playwright once with `bun run --cwd webapp e2e:install`. Docker must be running. Specs are in `webapp/e2e/specs` and use stable `data-testid` selectors.

The runner starts a test database, backend, and Vite. It seeds test accounts and removes its database afterward. Reports and failure artifacts are in `webapp/e2e/.artifacts`.

E2E and screenshots share a Compose project. Run them separately or set different `COMPOSE_PROJECT_NAME` values. `E2E_KEEP_DOCKER=1` keeps the database; `E2E_SKIP_DOCKER=1` uses an existing test database.

`bun run e2e:webapp:s3` runs the avatar journey against local S3. [UI](UI.md#visual-check) explains screenshots. Maestro instructions are on the mobile branch.

## Other checks

`bun run test:infra` tests repository scripts without cloud changes. `bun run test:terraform` checks Terraform with mocked providers and needs the Terraform CLI. Neither proves a live deployment.

`bun run smoke:backend:docker` checks the backend image against an isolated test database. `bun run --cwd backend test:live` runs configured provider suites and can send real email. See [Storage](STORAGE.md) and [Email](EMAIL.md).

## Dependency audit

`bun run audit` runs `bun audit` and fails on advisories. Run it after dependency updates and before release. Fix advisories with compatible updates. Skip an advisory only with the user's approval. Apply the approved exception for that run unless a persistent exception was requested.

Keep transitive overrides only while needed. Upgrade the three Prisma packages together and verify backend types, tests, and affected client behavior.

The `braces` override pins the API-compatible [`@zklogic/braces` fork](https://github.com/ArfanKhalilMughal/braces) for [CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Upstream has no patched release. The fork limits parser nesting and keeps deeper input as literal text. `scripts/glob-security.test.mjs` checks the exploit and normal range expansion in Node. Remove the override when the dependency tree uses an upstream fix or no longer needs `braces`.

Mobile pins `node-forge` to the immutable fix commit from [upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152). This PR is not merged or released. It rejects extra elements in the RSA digest algorithm. Replace the pin when an official fixed release is available. `decode-uri-component` uses the official 0.5.0 fix. The one-line `query-string` patch reads its ESM default export from CommonJS. Remove that patch and override when Expo Router updates its query parser. `scripts/mobile-dependency-security.test.mjs` verifies malformed URL input and RSA signatures through Expo's installed dependencies. The audit has no advisory exceptions.

## Mobile tests

Test mobile client behavior with the Maestro journey below. Billing and push tests use the real backend and PostgreSQL. Billing tests cover both configuration modes. Add social sign-in integration tests when that feature is enabled.

### Mobile E2E

Maestro requires Java 17+, its CLI, and an installed Expo development build. Expo Go cannot run the flow. Use the pinned installer through `bun run --cwd mobile e2e:maestro:setup`.

Prepare a test database, apply migrations, and run the backend against it. Start Metro with `EXPO_PUBLIC_E2E=1` and a reachable API address. Then run:

```bash
EXPO_PUBLIC_E2E=1 MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081 \
  E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health bun run e2e:mobile
```

The runner does not install the application or start its services. Its options are in `mobile/.maestro/.env.example`. Never point it at the development database. For a renamed app, set `MAESTRO_APP_ID`.

The auth flow verifies registration, session restoration after restart, and sign-out. Run it after changes to flows or launch behavior. `bun run mobile:template:check --published` checks branch publication, runs the repository checks, and exports iOS, Android, and web bundles. It does not run a device journey.

Use stable `testID` selectors. Reveal secure password input before typing. Dismiss the keyboard through scrolling or static content, rather than `hideKeyboard`. Keep important controls fully visible before tapping.
