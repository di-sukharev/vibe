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

Backend runners accept paths relative to `backend/`. Name database tests `*.integration.test.ts` and provider tests `*.live.test.ts`. Run them through their package scripts. Plain `bun test` does not prepare their environment.

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

Test client session, transport, validation, and navigation behavior in `webapp/tests`. Reuse the existing provider test setup when React must mount. Do not add jsdom or another DOM library.

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
