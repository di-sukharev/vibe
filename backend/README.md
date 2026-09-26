# Backend

The backend serves the API and owns sign-in, data storage, integrations, and server-side business rules. Module layers, auth internals, and Prisma rules are in [ARCHITECTURE](../docs/ARCHITECTURE.md).

## Stack

Bun, Hono with `@hono/zod-openapi`, Prisma 7 on PostgreSQL 18, Zod, `jose`, and TypeScript.

## Commands

[COMMANDS](../docs/COMMANDS.md) indexes the scripts, and [TESTING](../docs/TESTING.md) covers the test runners. Backend-only commands, from the root:

```bash
bun run --cwd backend dev              # API and scheduler, with watch
bun run --cwd backend start:api        # API only, as deployed
bun run --cwd backend prisma:generate  # client in src/generated/prisma
```

`dev` runs the scheduler next to the API, so the outbox drains and local reset links appear within a minute. `dev`, `typecheck`, `build`, and `start:api` run `prisma:generate` first. [LOCAL_DATABASE](../docs/LOCAL_DATABASE.md) sets up PostgreSQL and `backend/.env`.

## Entry points

All processes share the Prisma schema, the `backend/Dockerfile` image, and `src/runtime.ts`. Jobs are declared in `src/jobs.ts`. [BACKGROUND_JOBS](../docs/BACKGROUND_JOBS.md) explains when to run each process.

| Process | Command | File |
| --- | --- | --- |
| API | `start:api` | `src/index.ts` |
| One job, then exit | `start:cron -- <job>` | `src/cron.ts` |
| Schedule from `src/job-schedules.json` | `start:scheduler` | `src/scheduler.ts` |
| Loops; empty by default | `start:worker` | `src/worker.ts` |
| Continuous push pipeline; optional | `start:worker:notifications` | `src/worker.ts` |

Cron, the scheduler, and the worker use `createBackgroundRuntime`. It replaces `JWT_SECRET` with a placeholder, so the background runtime never carries the token-signing key.

Cron, the scheduler, and the worker use `createBackgroundRuntime`. It replaces `JWT_SECRET` with a placeholder, so the background runtime never carries the token-signing key.

## Environment

`backend/.env.example` documents each variable. `src/env.ts` rejects invalid combinations at startup. Non-obvious choices:

- `RATE_LIMIT_STORE`: `memory` (default) counts inside one process, up to 10,000 keys. Use it while one API process serves every request. `database` shares counters across processes through one PostgreSQL upsert per limited request; Terraform sets it for Yandex. Its `rate_limit_buckets` rows hold client addresses or user IDs, which are temporary personal data. Only the auth cleanup deletes them, in `maintenance:process` every 15 minutes, so every deployment with `database` must run the scheduled jobs.
- `SESSION_RETENTION_DAYS`: the auth cleanup keeps revoked and expired sessions this long, then deletes them. It also deletes expired reset tokens and spent rate-limit windows. `maintenance:process` runs it, and `auth:sessions:cleanup` runs it alone.
- `INGRESS_RATE_LIMIT_PROVIDER`: `local` (default) applies the per-address write limits in the app. `yandex-sws` turns them off and keeps the body limits. It requires `TRUST_PROXY=true`, `TRUSTED_PROXY_CLIENT_IP_HEADER=x-forwarded-for`, and `TRUSTED_PROXY_CLIENT_IP_POSITION=last`. Use it only after a Yandex Smart Web Security rate-limit profile is active and verified at the edge.
- `TRUST_PROXY`: behind a proxy, set `TRUST_PROXY=true` and the proxy's `TRUSTED_PROXY_CLIENT_IP_HEADER`. Otherwise all clients share the proxy's rate-limit key. Set `TRUSTED_PROXY_CLIENT_IP_POSITION=last` only if the proxy appends the client address. Terraform sets both for its providers.
- `EMAIL_DELIVERY`: the schema default is `disabled`; `.env.example` sets `console`, which prints reset links. Production refuses `console`. With `disabled`, a reset request answers normally but creates no token or task. See [EMAIL](../docs/EMAIL.md).
- `PRIVATE_STORAGE_DRIVER`: `filesystem` (default) writes to `backend/.storage` without cloud or Docker. `s3` works with the local container (`bun run storage:local:start`) or a real bucket. Production refuses `filesystem`. See [STORAGE](../docs/STORAGE.md).
- Production-like runtimes (`NODE_ENV=production` or `COOKIE_SECURE=true`) require HTTPS `CORS_ORIGINS` and a `JWT_SECRET` of at least 64 hex characters (`openssl rand -hex 32`). `NODE_ENV=production` also requires `COOKIE_SECURE=true`.
- `src/db.ts` adds `uselibpqcompat=true` to a `DATABASE_URL` with `sslmode=require`, so TLS behaves as in libpq.
- Seeds: `bun run dev:seed` creates the local admin and user from `DEV_SEED_*`, with no subscription or premium access. It refuses production and non-loopback database URLs. A rerun with unchanged passwords keeps the hashes, sessions, and push registrations. A changed password is rehashed, and that account's sessions and push registrations are revoked. `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` feed only `db:deploy`, which creates the first production admin (12–128 characters, no placeholder or repeated pattern).
- Push: `ENABLE_TEST_PUSH=true` opens the test endpoint; keep it off outside a check. `EXPO_PUSH_ACCESS_TOKEN` is needed only when the Expo project enables push security. APNs and FCM keys live in Expo, not here. Setup: [mobile/README](../mobile/README.md).
- Apple and Google sign-in (`APPLE_AUTH_*`, `GOOGLE_AUTH_CLIENT_IDS`) ship switched off: the route and the buttons are not wired. See [SOCIAL_AUTH](../docs/SOCIAL_AUTH.md).
- Store subscriptions (`APPLE_IAP_*`, `GOOGLE_PLAY_*`, and the `IAP_*` and `WEBHOOK_*` body and rate limits of their routes) ship switched off. Turn them on or remove them with [IAP](../docs/IAP.md).

## API

`GET /openapi.json` lists every `/api` route. Endpoint families:

| Prefix | Owner | Purpose |
| --- | --- | --- |
| `/api/auth/*` | auth | Browser cookie sessions, `/api/auth/token/*` for native apps, password reset |
| `/api/users/*` | users | The current user's profile |
| `/api/admin/*` | users | Dashboard, user directory, role changes; `admin` only |
| `/api/uploads/*` | uploads | Avatar upload, finalize, read, and delete |
| `/api/notifications/*` | notifications | Push token registration and unregistration; a test push only with `ENABLE_TEST_PUSH=true` |
| `/storage/*` | storage | Signed local URLs; `filesystem` driver only |
| `/health/live`, `/health/ready` | app | Liveness; readiness (`SELECT 1`, cached for one second, `200` or `503`) |

Switched-off capabilities mount no routes: social sign-in (`POST /api/auth/token/social/{provider}`) and subscriptions (`/api/iap/*`, `/api/webhooks/*`).

With `INGRESS_RATE_LIMIT_PROVIDER=local`, each client address gets `AUTH_RATE_LIMIT_MAX` writes per window under `/api/auth/*`, and a separate equal budget under users, admin, and uploads. `AUTH_BODY_LIMIT_BYTES` caps those request bodies. `GET /api/admin/users` has its own per-admin budget (`ADMIN_USERS_READ_RATE_LIMIT_*`). Session, token, reset, and role rules are in [ARCHITECTURE](../docs/ARCHITECTURE.md).

`notifications` registers Expo push tokens per app installation and queues pushes in PostgreSQL. Unregistering keeps an inactive installation row with a newer generation. The test push allows one message per user per minute. `notifications:process` or `start:worker:notifications` sends the queue and checks receipts ([BACKGROUND_JOBS](../docs/BACKGROUND_JOBS.md#push-pipeline)).

## Deploy

Follow [DEPLOYMENT](../docs/DEPLOYMENT.md) and the guide for the provider in `CHECKLIST.md`. `bun run release -- <provider>` runs `db:deploy` before it switches traffic. `db:deploy` checks database ownership, applies migrations, restricts privileges, optionally creates the first admin, and requires a login-capable admin. If the ownership check fails on an existing database, follow the `db:adopt-owner` steps in DEPLOYMENT.
