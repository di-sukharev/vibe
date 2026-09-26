# Commands

Root scripts from [package.json](../package.json). Run `bun run <script>` from the repository root. "(Docker)" means that it needs Docker.

## Develop and build

- `dev`: all apps in parallel; the backend includes the scheduler.
- `dev:backend|webapp|website`: one app.
- `dev:backend:s3`: backend with local S3 (Docker).
- `storage:local:start|status|stop|env`: local S3 container; `stop` keeps its volume ([STORAGE](STORAGE.md)).
- `storybook:webapp|website`: catalogs on ports 6006 and 6007.
- `storybook:build[:webapp|:website]`: static catalogs.
- `build[:webapp|:website|:backend]`: production builds; backend and contracts only type-check.
- `static:precompress`: `.br` and `.gz` copies of text assets in `webapp/dist` and `website/dist` for self-hosting ([DEPLOYMENT](DEPLOYMENT.md)).

## Checks and tests

[TESTING](TESTING.md) has focused runs, test databases, and the audit process.

- `check`: `template:check` → `architecture:check` → `typecheck` → `lint` → `test` → `test:build-contracts` → `audit` (Docker, package registry).
- `template:check`: `CHECKLIST.md` and its registry, the `CLAUDE.md` import, the `AGENTS.md` word budget, Markdown links.
- `architecture:check`: module and feature import boundaries.
- `typecheck[:webapp|:website|:backend]`: types, all or one.
- `lint`: webapp ESLint, including UI rules.
- `audit`: `bun audit`; fails on any advisory.
- `test`: `test:infra`, `test:contracts`, `test:backend`, `test:webapp`, `test:website` (Docker).
- `test:infra`: tests of all repository scripts in `scripts/`; no cloud changes.
- `test:contracts`: Zod contracts.
- `test:backend`: `test:backend:unit`, then `test:backend:integration` (Docker).
- `test:webapp|website`: client unit tests; no build.
- `test:build-contracts`: builds `webapp` and `website`, then checks `website/dist`.
- `test:storage:s3`: storage contract against local S3 (Docker).
- `test:terraform`: every Terraform root; needs the Terraform CLI; not in `check`.
- `smoke:backend:docker`: backend image against a test database (Docker).
- `e2e:webapp`: Playwright journeys (Docker).
- `e2e:webapp:s3`: avatar journey against local S3 (Docker).
- `screens`: screenshot tour of webapp and website pages (Docker, [UI](UI.md)).
- `mobile:template:check`: release gate of the `mobile` branch ([mobile/README](../mobile/README.md)).

## Database and jobs

Run these as `bun run --cwd backend <script>`, except the root `dev:seed`.

- `dev:seed`: creates or updates the local demo accounts ([LOCAL_DATABASE](LOCAL_DATABASE.md)).
- `prisma:migrate`: creates and applies a development migration.
- `prisma:deploy`: applies existing migrations.
- `prisma:validate`: validates `schema.prisma`.
- `db:deploy`: the release database step (ownership, migrations, privileges, first administrator if needed).
- `db:adopt-owner`: lists objects that a legacy owner still owns; `-- --apply` transfers them after the user confirms ([DEPLOYMENT](DEPLOYMENT.md)).
- `start:cron -- <job>`: one job once, for example `outbox:drain`.
- `start:scheduler`: jobs on the schedules in `backend/src/job-schedules.json` ([BACKGROUND_JOBS](BACKGROUND_JOBS.md)).
- `start:worker`: `workerLoops` in `backend/src/worker.ts`, empty by default.

## Infrastructure and releases

`<provider>` is `digitalocean` or `yandex`. Follow [infra/README](../infra/README.md).

- `infra:bootstrap -- <provider> --new`: creates remote state. Without `--new`, continues.
- `infra:plan -- <provider>`: the protected production plan; applies nothing.
- `infra:apply -- <provider>`: applies the reviewed saved plan of the foundation.
- `infra:import -- <provider> <root> <address> <id> [adoption flags]`: imports a resource and checks a saved plan.
- `infra:output -- <provider>`: prints safe operational values.
- `release -- <provider>`: builds, migrates, switches, publishes, and checks a release.
