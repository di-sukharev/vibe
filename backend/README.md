# Backend

The backend owns the API, authentication, integrations, persistence, and server-side business logic. Web and mobile clients rely on the shared data contract in `packages/contracts`.

## Stack

- Bun
- Hono
- Prisma 7
- PostgreSQL
- Zod
- jose JWT
- TypeScript

## Commands

Run these from the repository root:

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
docker compose --env-file backend/.env pull postgres
docker compose --env-file backend/.env up -d postgres
bun run --cwd backend dev
bun run --cwd backend typecheck
bun run --cwd backend test
bun run --cwd backend test:unit
bun run --cwd backend test:integration
bun run --cwd backend start:api
bun run --cwd backend start:worker
bun run --cwd backend start:worker:notifications
bun run --cwd backend start:scheduler
bun run --cwd backend start:cron -- noop
bun run --cwd backend start:cron -- notifications:process
bun run --cwd backend smoke:docker
bun run --cwd backend prisma:validate
bun run --cwd backend prisma:generate
bun run --cwd backend prisma:migrate
bun run --cwd backend prisma:deploy
bun run --cwd backend prisma:seed
bun run --cwd backend db:deploy
```

On Windows PowerShell, use `Copy-Item backend/.env.example backend/.env` instead of `cp`. Workspace aliases are also available from the repository root: `bun run dev:backend`, `bun run build:backend`, `bun run typecheck:backend`, and `bun run test:backend`.

`bun run test:integration` starts `postgres_test` from `../docker-compose.yml`, applies Prisma migrations to `web_app_demo_test`, and runs DB-backed auth API tests. Every managed invocation owns a unique Compose project, so its `finally` cleanup can remove only that run's service, named test volume, and default network, including after a partial startup failure. Set `TEST_KEEP_DOCKER=1` to retain those resources for investigation. If Docker is managed separately, set `TEST_SKIP_DOCKER=1` and `TEST_DATABASE_URL`; the runner requires both and will not touch Docker resources. The test database name must end with `_test` unless `TEST_ALLOW_NON_TEST_DATABASE=1` is set intentionally.

`bun run smoke:docker` builds the backend Docker image, starts it against `postgres_test`, waits for `/health/ready`, and removes only the smoke container it created.

## Env

Copy `backend/.env.example` to `backend/.env` for local development and pass it to manual Compose commands with `docker compose --env-file backend/.env ...`. The example `DATABASE_URL` matches the Docker Compose `postgres` service documented in [../docs/LOCAL_DATABASE.md](../docs/LOCAL_DATABASE.md): database `web_app_demo`, user `superuser`, password `superpassword`, host port `54329`.

The example `TEST_DATABASE_URL` matches the Docker Compose `postgres_test` service: database `web_app_demo_test`, user `superuser`, password `superpassword`, manual host port `54330`. Automated runners may replace the port with a repository-derived value so parallel checkouts do not collide.

Keep an explicit username and password in Prisma connection URLs even on local native PostgreSQL installs. Peer-auth style URLs without a user can make Prisma schema-engine commands such as `migrate dev`, `migrate deploy`, and `db push` fail with an unhelpful generic engine error.

`JWT_SECRET` must be at least 32 characters locally. Production accepts the 64-or-more-character hexadecimal output of `openssl rand -hex 32`; do not use the `.env.example` placeholder, repeated characters, or human phrases.

`bun run prisma:seed` (or `bun run dev:seed` from the repository root) is the
explicit local development seed. It requires the paired `DEV_SEED_ADMIN_*` and
`DEV_SEED_USER_*` email/password values from `backend/.env`, creates login-ready
administrator and ordinary-user accounts, gives the ordinary user a local-only
`DevelopmentSeed` premium entitlement, and rejects `NODE_ENV=production` and any
non-loopback PostgreSQL URL.

The development seed is idempotent: unchanged passwords preserve their hashes,
active sessions, and push registrations. Replacing a configured credential
updates its Argon2id hash and revokes stale authentication and push authority.
The committed values are public local defaults and must never be reused in a
deployed environment.

Production remains a separate path. `bun run db:deploy` checks migration ownership before Prisma,
applies migrations, removes unsafe PostgreSQL `PUBLIC` privileges for both cloud paths, reconciles a
separate DigitalOcean runtime role back to DML-only access, and optionally bootstraps only the first administrator from paired
`ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD`, then fails unless at least one
administrator has a password credential. Production bootstrap rejects blank,
known-placeholder, and repeated-pattern passwords in addition to enforcing the
12–128 character limit; it never creates the local demo user or entitlement.

`COOKIE_SECURE=false` is appropriate for local HTTP; production requires `COOKIE_SECURE=true` with exact HTTPS origins in `CORS_ORIGINS`. Production browser auth uses `SameSite=None; Secure` refresh cookies, so wildcard, empty, HTTP, or path-bearing CORS origins are invalid. Every cookie-backed auth write (`register`, `login`, `refresh`, and `logout`) also requires a trusted `Origin` in production cookie mode.

`WEBAPP_ORIGIN` is the public browser-app origin used to compose transactional links such as password reset. It defaults to the first `CORS_ORIGINS` entry. Email delivery is provider-neutral and built in one place, `createEmailDelivery` in `src/email`, so the API and the `outbox:drain` job share it. `EMAIL_DELIVERY` selects one of four drivers: `disabled` (the default), `console`, `postbox` for Yandex Cloud Postbox, and `resend`. `console` prints messages instead of sending them so a reset link can be followed locally, and production refuses it. With delivery disabled, password-reset requests still return the same generic accepted response and do not create tokens. The provider groups, the failure classification, and the live suites are in [../docs/EMAIL.md](../docs/EMAIL.md).

Auth, IAP, and webhook ingress use separate body and rate-limit budgets. `INGRESS_RATE_LIMIT_PROVIDER=local` keeps the bounded in-process limiters enabled; `yandex-sws` is valid only after the documented Smart Web Security policy replaces them at the edge. `TRUST_PROXY=false` uses the direct Bun connection address. Behind a trusted proxy, set `TRUST_PROXY=true` together with the provider's authoritative client-IP header. DigitalOcean uses `do-connecting-ip`; the documented Yandex path uses the last `X-Forwarded-For` value.

`REFRESH_TOKEN_TTL_DAYS` is the sliding credential lifetime, while `SESSION_ABSOLUTE_TTL_DAYS` limits the total logical session lifetime. `REFRESH_REUSE_GRACE_SECONDS` tolerates a short concurrent refresh race; replaying an older family credential after that window revokes the logical session. The mobile schedule runs `maintenance:process`, which combines auth cleanup with notification redaction and, once enabled, bounded Google Play reconciliation.

Mobile social auth ships switched off: routes and buttons stay unmounted until the product enables
them. Configure Apple/Google identifiers only then; see [../docs/SOCIAL_AUTH.md](../docs/SOCIAL_AUTH.md).

Expo Push is implemented but inert until EAS and provider credentials are configured. The API only
registers installations and enqueues durable messages; `notifications:process` or
`start:worker:notifications` owns delivery and receipt polling. Native subscriptions likewise ship
switched off; enable or delete them as one product capability using [../docs/IAP.md](../docs/IAP.md).

Private file storage is on by default and needs no configuration: `PRIVATE_STORAGE_DRIVER=filesystem` stores uploads under `backend/.storage`, so `bun run dev` works with no cloud account and no Docker. Switch to `s3` to develop against the local container (`bun run storage:local:start`) or a real bucket; production refuses the filesystem driver. The full rule set and the upload contract are in [../docs/STORAGE.md](../docs/STORAGE.md).

## Runtime Entrypoints

The backend is one workspace with one Prisma schema and one Dockerfile, but it has separate runtime entrypoints:

- API: `bun run start:api`, backed by `src/index.ts`.
- Jobs: declared once in `src/jobs.ts` and shared by the runners below. The mobile line adds `notifications:process` and combined `maintenance:process` to the baseline registry; see [../docs/BACKGROUND_JOBS.md](../docs/BACKGROUND_JOBS.md).
- Cron: `bun run start:cron -- <job>`, backed by `src/cron.ts`. CLI mode runs one job and exits;
  Yandex Terraform starts the same executor in HTTP mode so a failed job returns non-2xx to the
  timer trigger.
- Scheduler: `bun run start:scheduler`, backed by `src/scheduler.ts`. Keeps schedules in the repository instead of a cloud console. `bun run dev` runs it next to the API, so a queued email leaves in development without a second terminal.
- Worker: `bun run start:worker`, backed by `src/worker.ts`. A loop for work that must run more often than once a minute. `src/job-schedules.json` ships task-outbox and push processing every minute, upload cleanup hourly, and combined auth/notification maintenance every 15 minutes; `bun run dev` starts that scheduler alongside the API, and Terraform deploys the matching production runner. The loop worker ships empty, so give it a loop before deploying it - a process that exits immediately gets restarted forever.
- Notification worker: `bun run start:worker:notifications` continuously drains the Expo outbox and checks receipts with abort-aware shutdown. The default mobile schedule also runs `notifications:process` every minute, so a separate persistent worker is optional when that latency is acceptable.

All entrypoints use `src/runtime.ts` for env loading, Prisma creation, and cleanup. Background entrypoints use `createBackgroundRuntime`, which never uses the API's signing key.

## Push Notifications API

- `POST /api/notifications/push-token` registers one authorized installation generation.
- `POST /api/notifications/push-token/unregister` advances it to an inactive tombstone.
- `POST /api/notifications/test-push` queues a bounded test message only while `ENABLE_TEST_PUSH=true`.

Push is durable and at-least-once across the Expo send/ticket boundary. Deep-link destinations and
notification effects must therefore remain idempotent.

Primary keys use database-generated UUIDv7 values in PostgreSQL (`@default(dbgenerated("uuidv7()")) @db.Uuid`). Use UUIDv7 consistently for new primary keys and foreign-key references that point at them; do not introduce new `cuid()`, `uuid()`, `serial`, or `bigserial` IDs into this template. PostgreSQL 18+ is required anywhere the backend schema is applied so IDs are generated consistently through Prisma, raw SQL, imports, and future non-Prisma writers.

## Deployment

Production infrastructure is Terraform under [../infra](../infra/README.md). Follow the shared safety and release contract in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md), then the provider runbook selected in `CHECKLIST.md`: [DigitalOcean](../docs/DIGITALOCEAN.md) or [Yandex Cloud](../docs/YANDEX_CLOUD.md). One `bun run release -- <provider>` build uses `backend/Dockerfile`, gates promotion on `db:deploy`, deploys the API and scheduled work, and verifies readiness. Never put a secret in committed tfvars or backend configuration.

When adopting a legacy database, run `bun run db:adopt-owner` first for a read-only public-schema
ownership inventory. The exact confirmation and `-- --apply` sequence lives in
[../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md); normal deployment never transfers ownership
implicitly.

## Auth API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/token/register`
- `POST /api/auth/token/login`
- `POST /api/auth/token/social/apple` (mounted only when social sign-in is enabled)
- `POST /api/auth/token/social/google` (mounted only when social sign-in is enabled)
- `POST /api/auth/token/refresh`
- `POST /api/auth/token/logout`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/confirm`
- `PATCH /api/users/me`
- `GET /api/admin/dashboard`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId/role`
- `GET /openapi.json`
- `GET /health/live`
- `GET /health/ready`

`GET /api/admin/users` has a separate in-memory read budget, keyed by administrator ID and shared across that administrator's sessions and search filters. It defaults to 120 requests per 60 seconds through `ADMIN_USERS_READ_RATE_LIMIT_*` and does not consume the account-mutation budget. The store is process-local; use shared rate-limit state when the API runs in multiple backend processes and global enforcement is required.

Passwords are hashed through `Bun.password` with Argon2id. Access tokens are short-lived JWTs through `jose`. Initial refresh tokens are random; rotated successors are opaque, domain-separated HMAC values derived with the server secret so concurrent uses of the same credential receive the same successor. Only current and immediately previous SHA-256 hashes are stored in the database. Refresh atomically rotates the credential inside the same logical session, so another browser tab's still-valid access token is not revoked. Reuse of the previous credential after the short race-tolerance window revokes that session as potentially compromised.

Password reset uses a random 32-byte, 30-minute token. Only its SHA-256 hash is stored, requests are limited to one token per account per minute, and account lookup plus email delivery run after the generic response so response timing does not reveal whether an email exists. The API runtime drains accepted background tasks during graceful shutdown; every task has a deadline, server and task draining share one absolute shutdown deadline, and email adapters must honor the supplied `AbortSignal`. Timed-out work stays tracked while abort cleanup settles inside the remaining shutdown budget. Delivery remains best-effort across abrupt process loss, so clients keep the generic retryable experience. A failed reset email invalidates its token and is reported through the background-task error boundary. A successful confirmation atomically changes the Argon2id password hash, consumes every outstanding reset token, revokes every active session, clears the browser refresh cookie, and does not sign the user in automatically. Reset links place the raw token in the URL fragment so it is not sent in the initial HTTP request or referrer. Scheduled auth cleanup removes expired reset-token rows.

Every password registration and new social account is created with role `user`;
clients cannot submit a role. `UserDto` includes the current `user | admin` role,
but access JWTs do not. Authenticated requests load the active session and user
from PostgreSQL, so a role change takes effect without waiting for a token to
expire. All `/api/admin/*` routes apply the same server-side `403 FORBIDDEN`
guard.

The users module owns self-service profile updates, safe admin summaries,
dashboard counts, and role changes. A role change is serialized in PostgreSQL,
cannot demote the acting administrator or leave the system without an
administrator, and revokes every session of the affected user only when the role
actually changes. Role/bootstrap authority changes and existing-account session
issuance share a per-user fence; login re-reads the current user and re-verifies
the password before inserting a session.
Admin list responses expose only `id`, `email`, `displayName`,
`role`, and `createdAt`.

## Architecture

`src/index.ts` only starts the API server. `src/runtime.ts` loads env and creates the Prisma client for API, worker, and cron entrypoints. `src/app.ts` is the composition root. Product contexts live under `src/modules/<context>` and expose only `index.ts` across context boundaries. Auth is the authentication/principal golden path; the separate users context owns profiles, admin directory reads, and role policy. `transport` owns Hono/HTTP, `application` owns use cases and ports, optional `domain` code stays pure, and `infrastructure` owns Prisma and token/password adapters. Route factories capture dependencies in closures; request context contains only the authenticated principal. Run `bun run architecture:check` to enforce these dependency rules. `src/db.ts` normalizes DigitalOcean Managed PostgreSQL URLs that use `sslmode=require` so the Prisma PostgreSQL adapter uses libpq-compatible TLS handling.

The storage service lives in `src/storage` and wraps private S3-compatible storage. Product-specific upload routes should validate ownership and permissions, then delegate object key generation, presigned upload/download URLs, and deletion to that service. Terraform creates a dedicated private media bucket and scoped runtime credentials on either supported cloud.

Prisma migration SQL is not written by hand. Change `prisma/schema.prisma`, then run `bun run prisma:migrate`.

## Current Upstream Documentation

For backend framework, ORM, auth, validation, and runtime questions, consult the current upstream documentation linked here first. This README describes this backend's conventions; upstream docs are authoritative for API behavior.

- [Bun docs](https://bun.sh/docs)
- [Hono docs](https://hono.dev/docs)
- [Hono Zod OpenAPI example](https://hono.dev/examples/zod-openapi)
- [Prisma docs](https://www.prisma.io/docs)
- [Prisma migrations](https://www.prisma.io/docs/orm/prisma-migrate)
- [PostgreSQL docs](https://www.postgresql.org/docs/)
- [Zod docs](https://zod.dev/)
- [jose documentation](https://github.com/panva/jose)
- [Docker Compose docs](https://docs.docker.com/compose/)
- [PostgreSQL Docker Official Image](https://hub.docker.com/_/postgres)
- [DigitalOcean Spaces docs](https://docs.digitalocean.com/products/spaces/)
- [DigitalOcean Spaces CDN docs](https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/)
