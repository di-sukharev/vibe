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

`bun run test:integration` starts `postgres_test` from `../docker-compose.yml`, applies Prisma migrations to `web_app_demo_test`, and runs DB-backed auth API tests. If Docker is managed separately, set `TEST_SKIP_DOCKER=1` and `TEST_DATABASE_URL`. The test database name must end with `_test` unless `TEST_ALLOW_NON_TEST_DATABASE=1` is set intentionally.

`bun run smoke:docker` builds the backend Docker image, starts it against `postgres_test`, waits for `/health/ready`, and removes only the smoke container it created.

## Env

Copy `backend/.env.example` to `backend/.env` for local development and pass it to manual Compose commands with `docker compose --env-file backend/.env ...`. The example `DATABASE_URL` matches the Docker Compose `postgres` service documented in [../docs/LOCAL_DATABASE.md](../docs/LOCAL_DATABASE.md): database `web_app_demo`, user `superuser`, password `superpassword`, host port `54329`.

The example `TEST_DATABASE_URL` matches the Docker Compose `postgres_test` service: database `web_app_demo_test`, user `superuser`, password `superpassword`, manual host port `54330`. Automated runners may replace the port with a repository-derived value so parallel checkouts do not collide.

Keep an explicit username and password in Prisma connection URLs even on local native PostgreSQL installs. Peer-auth style URLs without a user can make Prisma schema-engine commands such as `migrate dev`, `migrate deploy`, and `db push` fail with an unhelpful generic engine error.

`JWT_SECRET` must be at least 32 characters locally. Production accepts the 64-or-more-character hexadecimal output of `openssl rand -hex 32`; do not use the `.env.example` placeholder, repeated characters, or human phrases.

`ADMIN_SEED_EMAIL` defaults to `admin@example.com` for local seeding.
`ADMIN_SEED_PASSWORD` is optional locally: without it, `bun run prisma:seed`
creates a new locked account with `passwordHash = null`; promoting an existing
account preserves its current password credential. With a password, the seed
hashes it with Argon2id and creates or unlocks the account. The seed is
idempotent and an empty password never erases an
existing hash; reusing the already configured password also preserves the hash,
active sessions, and push registrations. Production uses `bun run db:deploy`: it applies migrations,
optionally bootstraps the first administrator from a paired email/password, then
fails unless at least one administrator has a password credential.
Production bootstrap also rejects blank, known-placeholder, and repeated-pattern
passwords in addition to enforcing the 12–128 character limit.

`COOKIE_SECURE=false` is appropriate for local HTTP; production requires `COOKIE_SECURE=true` with exact HTTPS origins in `CORS_ORIGINS`. Production browser auth uses `SameSite=None; Secure` refresh cookies, so wildcard, empty, HTTP, or path-bearing CORS origins are invalid. Every cookie-backed auth write (`register`, `login`, `refresh`, and `logout`) also requires a trusted `Origin` in production cookie mode.

Auth and authenticated account-management writes use `AUTH_BODY_LIMIT_BYTES` and `AUTH_RATE_LIMIT_*`; authenticated IAP ingress uses independent `IAP_BODY_LIMIT_BYTES` and `IAP_RATE_LIMIT_*` controls; App Store webhook ingress has separate, burst-tolerant `WEBHOOK_BODY_LIMIT_BYTES` and `WEBHOOK_RATE_LIMIT_*` controls. `INGRESS_RATE_LIMIT_PROVIDER=local` applies those IP-keyed budgets through bounded in-process fixed-window limiters and is the default for local development and DigitalOcean. `INGRESS_RATE_LIMIT_PROVIDER=yandex-sws` disables only those backend ingress budgets after the documented Smart Web Security ARL policy is active; body limits and application-owned budgets remain enabled. The full Yandex rule table, response contract, rollout, rollback, and official documentation links are in [../docs/YANDEX_CLOUD.md](../docs/YANDEX_CLOUD.md).

Invalid webhook signatures release and delete their provisional idempotency claim, so attacker-controlled payloads are not retained. A conflicting cross-account claim for an existing Expo token quarantines delivery without transferring installation ownership; the authorized installation can re-enable the token by registering with its secret. `TRUST_PROXY=false` uses the direct Bun connection address. Behind a trusted proxy, set `TRUST_PROXY=true` together with the provider's authoritative `TRUSTED_PROXY_CLIENT_IP_HEADER`; use `TRUSTED_PROXY_CLIENT_IP_POSITION=last` only when the provider appends the client to a comma-separated chain. DigitalOcean App Platform uses `do-connecting-ip`, while the documented Yandex Serverless Containers path uses the last `X-Forwarded-For` value. Client IP resolution is still required for session metadata when SWS owns ingress limiting. The default App Platform shape is one API instance. Before horizontally scaling local rate-limit mode, move rate-limit state to a shared trusted store or edge/WAF layer.

`WEBAPP_ORIGIN` is the public browser-app origin used to compose transactional links such as password reset. It defaults to the first `CORS_ORIGINS` entry. Email delivery is provider-neutral: `createApp` accepts an `EmailDelivery` adapter, while the committed runtime uses a disabled adapter until a project wires its chosen provider. With delivery disabled, password-reset requests still return the same generic accepted response and do not create tokens.

`REFRESH_TOKEN_TTL_DAYS` is the sliding credential lifetime, while `SESSION_ABSOLUTE_TTL_DAYS` limits the total logical session lifetime. `REFRESH_REUSE_GRACE_SECONDS` tolerates a short concurrent refresh race; replaying the immediately previous credential after that window revokes the logical session. Keep the grace window short (the default is 10 seconds). Run `maintenance:process` on a schedule to delete revoked, sliding-expired, and absolute-expired rows after `SESSION_RETENTION_DAYS`, remove expired password-reset tokens, and perform the configured billing/notification maintenance; `auth:sessions:cleanup` remains available when auth cleanup needs its own schedule.

Mobile social auth is optional. Configure `APPLE_AUTH_BUNDLE_ID`, `APPLE_AUTH_JWKS_TIMEOUT_MS`, and `GOOGLE_AUTH_CLIENT_IDS` only when the Expo app should offer Apple or Google sign-in. These values are provider identifiers, not secrets. Full setup: [../docs/SOCIAL_AUTH.md](../docs/SOCIAL_AUTH.md).

DigitalOcean Spaces env is optional. Leave `SPACES_*` blank until the product needs uploads, media, exports, or downloads. When storage is active, configure the complete Spaces group in `backend/.env` and follow [../docs/STORAGE.md](../docs/STORAGE.md).

Expo Push is optional at first run, but the backend foundation is ready. APNs and FCM credentials are configured in Expo/EAS for the mobile project; the notification worker or cron needs `EXPO_PUSH_ACCESS_TOKEN` only when Expo push security is enabled, while the enqueue-only API does not. Active registrations are bounded per account by `PUSH_TOKEN_MAX_PER_USER` (default 10), including under concurrent requests. Each app installation uses a persistent opaque UUID, a separate secret whose hash is stored by the backend, and a monotonically increasing generation. Registration and deactivation are serialized by account, Expo token, and installation in PostgreSQL, so an older request cannot reclaim a token after a newer account has taken over the same device, while knowledge of an Expo token alone cannot delete or steal another installation. If local installation storage is reset while Expo returns the same token, the same account can atomically bind it to a new installation and deactivate the obsolete one. On an account switch, the unchanged token can move only with the same installation secret and a newer generation; a delayed request from the previous account is then stale. A launch registration also serves as a bounded heartbeat: an older device evicted by the per-account cap can restore itself the next time it opens, evicting the least-recent remaining registration under the same cap. Product code should use the public notifications module in `src/modules/notifications/index.ts` after committing the domain event, with a stable per-user `dedupeKey`, `title`, `body`, and optional `data.href`.
Registration rechecks the authenticated session inside the same per-user database fence used by every terminal session revocation, so a late mobile registration cannot recreate a token after logout or refresh-token replay detection. Immediately before an Expo send, the worker acquires the same account, token, and installation fences, rechecks session-bound authority, and holds admission until the bounded provider call finishes. Therefore a completed terminal revocation or authorized account transfer cannot be followed by a send admitted from an older snapshot; if the provider already returned a ticket, the worker persists it before honoring shutdown to avoid duplicate delivery. Legacy unbound registrations are fail-closed until the current app re-registers them with installation and session authority. Session maintenance removes unbound, expired, revoked, orphaned, and cross-user registrations before applying the configured auth-session retention window.
Once every delivery reaches a terminal state, the backend removes the raw Expo token and redacts the outbox title, body, and data. Delivery status and provider metadata remain available for operational diagnosis without retaining notification content indefinitely.

Native IAP is optional. App Store and Google Play verification require complete credential and product/base-plan allowlist groups; the default Docker image already includes Apple's public root certificates. Production App Store verification is environment-pinned. When Google Play is configured, scheduled `maintenance:process` also refreshes stale stored purchase tokens in bounded batches. Follow [../docs/IAP.md](../docs/IAP.md), and let `scripts/prepare-do-specs.mjs` validate and emit production store env rather than editing generated specs.

## Runtime Entrypoints

The backend is one workspace with one Prisma schema and one Dockerfile, but it has separate runtime entrypoints:

- API: `bun run start:api`, backed by `src/index.ts`.
- Worker: `bun run start:worker`, backed by `src/worker.ts`. It is intentionally empty until a real long-running background handler is added, and deployment generation refuses to deploy this placeholder command as an App Platform worker.
- Notification worker: `bun run start:worker:notifications`, backed by `src/worker.ts notifications`, drains pending push outbox rows and checks Expo receipts continuously. Shutdown aborts active Expo HTTP calls, stops before the receipt phase or another claim, and caps an outbox pass below `SHUTDOWN_GRACE_SECONDS` so runtime termination still has time to persist the fenced retry state. It logs non-zero delivery/receipt activity and failures, plus a sparse five-minute heartbeat while idle rather than one log per poll.
- Cron: `bun run start:cron -- <task>`, backed by `src/cron.ts`. Available tasks are `noop`, `db:ping`, `notifications:process`, `auth:sessions:cleanup`, `billing:google-play:reconcile`, and the recommended combined `maintenance:process`.

All entrypoints use `src/runtime.ts` for env loading, Prisma creation, and cleanup, so backend services can be shared without duplicating Prisma schema or database setup. Worker and cron entrypoints use the background loader, which deliberately replaces any inherited `JWT_SECRET` with a public non-signing placeholder; their deployment components receive no API signing key.

## Push Notifications API

- `POST /api/notifications/push-token` atomically claims an installation generation for the current user and replaces that installation's previous Expo token.
- `POST /api/notifications/push-token/unregister` advances the installation generation to a durable inactive tombstone and removes its known tokens. It returns `applied: false` when a newer generation already won.
- `POST /api/notifications/test-push` queues one test push for the current user when `ENABLE_TEST_PUSH=true`. It is disabled by default, limited durably to one enqueue per user per minute, and never runs delivery inside the API request; use the notification worker or cron to process it.

Push delivery is durable: `PushNotificationOutbox` stores the queued message, `PushDelivery` stores Expo ticket/receipt state, delayed receipts are checked with backoff, transient Expo failures are retried, and `DeviceNotRegistered` disables stale tokens.

Delivery is at-least-once across the send-to-ticket-persistence boundary: Expo may accept a request immediately before the worker stops, leaving no persisted ticket and causing a retry. Payloads and deep-link destinations must therefore be idempotent. Opening the same link twice must be safe, and a duplicate notification must never repeat an irreversible business action.

Primary keys use database-generated UUIDv7 values in PostgreSQL (`@default(dbgenerated("uuidv7()")) @db.Uuid`). Use UUIDv7 consistently for new primary keys and foreign-key references that point at them; do not introduce new `cuid()`, `uuid()`, `serial`, or `bigserial` IDs into this template. PostgreSQL 18+ is required anywhere the backend schema is applied so IDs are generated consistently through Prisma, raw SQL, imports, and future non-Prisma writers.

## Deployment

Production deployment for the backend uses DigitalOcean App Platform with DigitalOcean Managed PostgreSQL by default. Follow the shared runbook in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) instead of duplicating provider-specific steps here. The root `bun run deploy:do:specs` command generates concrete App Platform specs safely under `.scratch/deploy`; do not hand-substitute secrets or URLs into specs. If the user explicitly chooses Yandex Cloud, use [../docs/YANDEX_CLOUD.md](../docs/YANDEX_CLOUD.md).

## Auth API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/token/register`
- `POST /api/auth/token/login`
- `POST /api/auth/token/social/apple`
- `POST /api/auth/token/social/google`
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

Passwords are hashed through `Bun.password` with Argon2id. Access tokens are short-lived JWTs through `jose`. Initial refresh tokens are random; rotated successors are opaque, domain-separated HMAC values derived with the server secret so concurrent uses of the same credential receive the same successor. The database stores the current and immediately previous SHA-256 hashes plus a family locator hash. Refresh atomically rotates the credential inside the same logical session, so another browser tab's still-valid access token is not revoked. Reuse of any older family credential after the short race-tolerance window revokes that session as potentially compromised.

Successful cookie refresh responses keep the established `{ accessToken }` shape; token refresh adds only the rotated refresh credential required by native storage. Clients compare the `userId` and `sessionId` claims in the current and refreshed access tokens before replacing local state or retrying an authenticated request. Keeping the response additive-free preserves phased rollout compatibility with installed strict-parser clients.

Social auth users use the provider subject as the stable identity key. The backend does not automatically link social identities to existing password accounts by email; if the email already exists, social signup returns `AUTH_EMAIL_ALREADY_EXISTS`.

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
the password before inserting a session. Push admission has a shared, bounded
transaction budget, and authority transitions have a larger budget so they can
wait for an already-admitted provider call before revoking delivery authority.
Admin list responses expose only `id`, `email`, `displayName`,
`role`, and `createdAt`.

## Architecture

`src/index.ts` only starts the API server. `src/runtime.ts` loads env and creates the Prisma client for API, worker, and cron entrypoints. `src/app.ts` is the composition root. Product contexts live under `src/modules/<context>` and expose only `index.ts` across context boundaries. Auth is the authentication/principal golden path; the separate users context owns profiles, admin directory reads, and role policy. Billing and notifications demonstrate the same boundaries for provider-heavy and asynchronous contexts: `transport` owns Hono/HTTP, `application` owns use cases and orchestration through narrow ports, optional `domain` code stays pure, and `infrastructure` owns Prisma and provider adapters. Context-wide `*Operations` facades and forwarding-only application services are not part of the pattern. Route factories capture dependencies in closures; request context contains only the authenticated principal. Run `bun run architecture:check` to enforce these dependency rules. `src/db.ts` normalizes DigitalOcean Managed PostgreSQL URLs that use `sslmode=require` so the Prisma PostgreSQL adapter uses libpq-compatible TLS handling.

The storage service lives in `src/storage` and wraps DigitalOcean Spaces through S3-compatible SDK calls. Product-specific upload routes should validate ownership and permissions, then delegate object key generation, presigned upload/download URLs, public CDN URL construction, and deletion to that service.

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
- [Google Auth Library for Node.js](https://docs.cloud.google.com/nodejs/docs/reference/google-auth-library/latest/google-auth-library/oauth2client)
- [Docker Compose docs](https://docs.docker.com/compose/)
- [PostgreSQL Docker Official Image](https://hub.docker.com/_/postgres)
- [DigitalOcean Spaces docs](https://docs.digitalocean.com/products/spaces/)
- [DigitalOcean Spaces CDN docs](https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/)
