# Commands

Root scripts from [package.json](../package.json). Run `bun run <script>` from the repository root. "(Docker)" means that it needs Docker.

## Develop and build

- `dev`: all apps in parallel; the backend includes the scheduler.
- `dev:backend|webapp|website|mobile`: one app.
- `dev:backend:s3`: backend with local S3 (Docker).
- `storage:local:start|status|stop|env`: local S3 container; `stop` keeps its volume ([STORAGE](STORAGE.md)).
- `storybook:webapp|website`: catalogs on ports 6006 and 6007.
- `storybook:build[:webapp|:website]`: static catalogs.
- `build[:webapp|:website|:mobile|:backend]`: production builds; `mobile` exports its web build, and backend and contracts only type-check.
- `static:precompress`: `.br` and `.gz` copies of text assets in `webapp/dist` and `website/dist` for self-hosting ([DEPLOYMENT](DEPLOYMENT.md)).
- `theme`: writes the theme tokens from `theme.json` into `webapp/src/index.css` and `website/src/styles/global.css` ([UI](UI.md)); `-- --check` only verifies.

## Checks and tests

[TESTING](TESTING.md) has focused runs, test databases, and the audit process.

- `check`: `template:check` → `architecture:check` → `typecheck` → `lint` → `test` → `test:build-contracts` → `audit` (Docker, package registry).
- `template:check`: `CHECKLIST.md` and its registry, the `CLAUDE.md` import, the `AGENTS.md` word budget, Markdown links.
- `architecture:check`: module and feature import boundaries.
- `typecheck[:webapp|:website|:mobile|:backend]`: types, all or one.
- `lint`: webapp ESLint, including UI rules, then mobile `expo lint`.
- `audit`: `bun audit`; fails on any advisory.
- `test`: `test:infra`, `test:contracts`, `test:backend`, `test:webapp`, `test:website`, `test:mobile` (Docker).
- `test:infra`: tests of all repository scripts in `scripts/`; no cloud changes.
- `test:contracts`: Zod contracts.
- `test:backend`: `test:backend:unit`, then `test:backend:integration` (Docker).
- `test:webapp|website|mobile`: client unit tests; no build.
- `test:build-contracts`: builds `webapp` and `website`, then checks `website/dist`.
- `test:storage:s3`: storage contract against local S3 (Docker).
- `test:terraform`: every Terraform root; needs the Terraform CLI; not in `check`.
- `smoke:backend:docker`: backend image against a test database (Docker).
- `e2e:webapp`: Playwright journeys (Docker).
- `e2e:webapp:s3`: avatar journey against local S3 (Docker).
- `e2e:mobile`: Maestro auth smoke on an Expo development build; needs Metro and a backend ([TESTING](TESTING.md#mobile-e2e)). `bun run --cwd mobile e2e:maestro:audit` checks the flow rules.
- `screens`: screenshot tour of webapp and website pages (Docker, [UI](UI.md)).
- `mobile:template:check`: release gate of the `mobile` branch ([mobile/README](../mobile/README.md)).

## Database and jobs

Run these as `bun run --cwd backend <script>`, except the root `dev:seed`.

- `dev:seed`: creates or updates the local demo accounts ([LOCAL_DATABASE](LOCAL_DATABASE.md)). `DEV_SEED_DEMO=1 bun run dev:seed` also adds ~40 fixed fixture users, for exercising lists and pagination locally.
- `prisma:migrate`: creates and applies a development migration.
- `prisma:deploy`: applies existing migrations.
- `prisma:validate`: validates the schema in `prisma/schema/`.
- `db:deploy`: the release database step (ownership, migrations, privileges, first administrator if needed).
- `db:adopt-owner`: lists objects that a legacy owner still owns; `-- --apply` transfers them after the user confirms ([DEPLOYMENT](DEPLOYMENT.md)).
- `start:cron -- <job>`: one job once, for example `outbox:drain`.
- `start:scheduler`: jobs on the schedules in `backend/src/job-schedules.json` ([BACKGROUND_JOBS](BACKGROUND_JOBS.md)).
- `start:worker`: `workerLoops` in `backend/src/worker.ts`, empty by default.
- `start:worker:notifications`: the continuous push pipeline, for push latency under a minute ([BACKGROUND_JOBS](BACKGROUND_JOBS.md#push-pipeline)).

## Infrastructure and releases

`<provider>` is `digitalocean` or `yandex`. Follow [infra/README](../infra/README.md).

- `infra:bootstrap -- <provider> --new`: creates remote state. Without `--new`, continues.
- `infra:plan -- <provider>`: the protected production plan; applies nothing.
- `infra:apply -- <provider>`: applies the reviewed saved plan of the foundation.
- `infra:import -- <provider> <root> <address> <id> [adoption flags]`: imports a resource and checks a saved plan.
- `infra:output -- <provider>`: prints safe operational values.
- `release -- <provider>`: builds, migrates, switches, publishes, and checks a release.
