# Testing

[AGENTS.md](../AGENTS.md#tests-and-tdd) defines the test policy. Package scripts define commands.

## Focused runs

From the repository root:

```bash
bun run test:backend:integration -- src/modules/users/users.integration.test.ts -t 'name'
bun run test:backend:local -- src/storage/filesystem-storage.test.ts -t 'name'
bun run test:webapp
bun run e2e:webapp -- auth.spec.ts -g 'name'
```

Backend runners accept paths relative to `backend/`. Name database tests `*.integration.test.ts` and provider tests `*.live.test.ts`. Run them through their package scripts. Plain `bun test` does not prepare their environment. `test:backend:local` runs filesystem and loopback HTTP integrations without Docker or a database. `test:backend:integration` runs integrations with a real PostgreSQL test database.

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

## Client tests

Test client behavior through the browser journeys in `webapp/e2e/specs`. `bun run test:webapp` runs these journeys against the test backend and database. Test shared request schemas through backend HTTP integration tests.

## What to check

Write integration tests that exercise real components together. Examples include an HTTP request that changes database records, a job that uses its repository, or a command that operates on temporary files. Replace external providers when needed. Do not replace internal components or test helper functions in isolation.

Check API responses and resulting database changes. For external providers, check requests sent to their test implementations. Include successful cases, denied access, and relevant failures, such as invalid input or provider errors.

An API test and a browser test can cover the same user journey. The API test checks server behavior. The browser test checks the interaction that needs a browser.

Do not add unit tests, component tests, or tests of UI wording, CSS, markup, visual appearance, or snapshots. Screenshots support the user's visual review. Do not compare them against saved images as an automated test.

## Session and query changes

When changing session or query code, check these cases:

- After successful sign-out, the previous user's data is removed from the UI and query cache.
- After an account change, the previous user's data cannot appear in the new account, including in other tabs.
- A delayed response from before sign-out or an account change cannot restore the previous session or its data.
- A response for old query parameters cannot replace the results for the current parameters.

For example, start a request as user A, switch to user B, then let A's response arrive. B's session and data must remain unchanged.

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

The `zod` override requires 4.6.6 or later to fix GHSA-mrhx-c7xc-m3w5. Expo CLI still requests Zod 3. Its DevTools schemas use APIs supported by Zod 4. The mobile dependency integration test checks real plugin execution, invalid command rejection, and MCP schema conversion through the installed SDK. Remove the override when Expo CLI and the remaining dependency tree require a fixed Zod release.

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
