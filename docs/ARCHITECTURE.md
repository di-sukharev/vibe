# Architecture

This guide owns module boundaries, auth and sessions, Prisma rules, and infrastructure growth. Use progressive DDD-lite: explicit owners and dependency directions, no mandatory layers. Add `domain` only for real rules. Never add empty layers, generic repositories, CQRS, or event sourcing.

## Contracts first

`packages/contracts` defines API requests, responses, and errors as Zod schemas. Start every endpoint there. Backend routes declare the schemas through `@hono/zod-openapi`, which also generates `GET /openapi.json`. After a change, check the backend route and service. Then check the feature API adapters, forms, and UI state in `webapp` and `mobile`.

## Backend modules

A context lives in `backend/src/modules/<context>`. Dependencies point inward: `transport` → `application` → `domain`.

- `index.ts`: public API and composition. Other code imports the context only here or through an application port, such as auth's `LogoutCleanup`, which `notifications` implements.
- `transport/`: Hono routes and HTTP mapping. Never imports `infrastructure`, Prisma, `pg`, `jose`, or provider SDKs.
- `application/`: use cases, permissions, transactions, and ports. Never imports `transport`, `infrastructure`, Hono, Prisma, `jose`, `env`, `src/http`, or provider SDKs.
- `domain/` (optional): pure rules and calculations. Imports only `domain` and contracts.
- `infrastructure/`: Prisma and SDK adapters that implement application ports. Never imports `transport` or `src/http`.
- Only `index.ts` and module-wide tests sit at the module root.

Routes translate HTTP into application calls and map failures to the stable API error format. Repositories offer product operations, not generic CRUD. The request context carries only the authenticated user.

A use case gets narrow ports with only the operations it needs, never a generic `*Operations` object. Provider normalization and persistence stay in `infrastructure`.

Shared code sits outside `modules`: `src/app.ts` (composition, CORS, secure headers, rate limits, errors, OpenAPI), `src/env.ts` (environment validation), `src/runtime.ts` (env, Prisma, email, storage, and shutdown for every process), and `src/db.ts` (Prisma client, advisory locks). [BACKGROUND_JOBS](BACKGROUND_JOBS.md) owns background work and the API, cron, scheduler, and worker processes.

`bun run architecture:check` enforces these rules plus the client and contract boundaries. It also rejects an import cycle between client features; move that coordination into composition or behind the owner's port. It scans imports without running code and reports each violation as `path:line [rule] message`.

## Infrastructure growth

Each new broker, cache, search engine, or log store adds deployment, security, monitoring, backups, and cost. Start with the outbox for durable work, an index for slow reads, PostgreSQL full-text search, a row plus polling for cross-process signals, and `RATE_LIMIT_STORE=database` for shared rate limits.

Add infrastructure only for a measured limit that it removes. Record the measurement next to the capability in `CHECKLIST.md` first. Examples: the outbox backlog grows at the shortest drain interval; PostgreSQL cannot express the required ordering or exactly-once delivery; events must cross backend instances.

Realtime features start in the same backend, with WebSocket connections in instance memory. Add Redis-compatible Pub/Sub only when clients on different instances need the same events. Use DigitalOcean or Yandex managed Valkey, per the hosting in `CHECKLIST.md`, or a Valkey container on an own server.

Pub/Sub only distributes events. Store messages, notifications, shared state, and audit events in PostgreSQL. Publish short IDs after the commit. After a reconnect, clients recover through the API.

## Auth and sessions

`backend/src/modules/auth` uses its own JWT scheme:

- Passwords: Argon2id through `Bun.password`. An unknown email still runs a decoy hash check, so timing does not reveal accounts.
- Access token: a short-lived HS256 JWT (`jose`, `JWT_SECRET`, `ACCESS_TOKEN_TTL_SECONDS`) with `sub`, `sessionId`, and `email`, but no role.
- Refresh token: opaque. PostgreSQL stores only SHA-256 hashes of the current and previous tokens and of the token family.

Each protected request verifies the JWT and loads the active session and user, so revocations and role changes apply at once.

Route families:

- `/api/auth/*` (browsers: `webapp` and Expo Web): the refresh token lives only in the HttpOnly cookie `web_app_demo_refresh`, never in JSON. `COOKIE_SECURE=false` (local) sets `SameSite=Lax`. `COOKIE_SECURE=true` (production) sets `Secure; SameSite=None`, and register, login, refresh, and logout require an `Origin` from `CORS_ORIGINS`.
- `/api/auth/token/*` (iOS and Android): no cookies. The refresh token travels in JSON and lives in `expo-secure-store`. The access token stays in memory.
- Access tokens travel as `Authorization: Bearer`. Never keep a browser refresh token in `localStorage`, `sessionStorage`, AsyncStorage, or other JavaScript-readable storage.
- Browser clients change the cookie only under a Web Lock, so tabs change it one at a time. Without Web Locks, the client fails before the request. Client rules: [webapp/README](../webapp/README.md), [mobile/README](../mobile/README.md).

Rotation:

- Each refresh derives the next token by HMAC from the presented token and the server secret, so concurrent refreshes get the same successor.
- Rotation swaps the hashes atomically within the same session, so other tabs keep their access tokens. `REFRESH_TOKEN_TTL_DAYS` slides; `SESSION_ABSOLUTE_TTL_DAYS` caps the session.
- The previous token stays valid for `REFRESH_REUSE_GRACE_SECONDS` (default 10, maximum 60). Any later reuse of an old token revokes the session. Do not widen the window without need.
- A refresh returns only the access token, plus the next refresh token on the token route. Before a client retries a request, it compares `userId` and `sessionId` in the old and new access tokens. A request never repeats under another account or session.

Password reset:

- The request always returns the same `202` and never looks up the account. With `EMAIL_DELIVERY=disabled` it writes nothing. Otherwise it enqueues an `auth:password-reset` outbox task for any address, up to the cap in [BACKGROUND_JOBS](BACKGROUND_JOBS.md#anonymous-enqueue).
- The task handler looks up the account and issues at most one token per account per minute. It stores the SHA-256 of a random 32-byte token valid for 30 minutes and mails a link with the token in its URL fragment. If delivery fails permanently or on the final attempt, the handler invalidates the unsent token.
- Confirmation is one transaction: it changes the password hash, consumes all reset tokens, revokes all sessions, and enqueues an `auth:password-changed` notice. The response clears the refresh cookie; there is no automatic sign-in.

Roles:

- `user | admin` lives in `users.role` and `UserDto`, never in the JWT. Registration and social sign-in create `user`; clients never choose a role. Only the role endpoint and the admin bootstraps (`db:deploy`, dev seed) grant `admin`.
- `PATCH /api/admin/users/{userId}/role` runs under a global lock. It refuses self-demotion and removal of the last admin. A real change revokes the target's sessions, push tokens, and unused reset tokens in one transaction.
- `/api/admin/*` requires `admin` on the server and returns `403 FORBIDDEN` otherwise.

Login, role changes, reset tokens, and bootstraps share a per-user advisory lock (`acquireUserAuthenticationAuthorityLock` in `backend/src/db.ts`). Under it, login re-reads the user and re-checks the password before it inserts the session, so an old password cannot open a session after a reset.

Apple and Google sign-in ship switched off. They key an account on the provider subject and never link it to a password account by email. See [SOCIAL_AUTH](SOCIAL_AUTH.md).

### Push registrations

`backend/src/modules/notifications` binds an Expo push token to an app installation, its generation, and the session that registered it.

- Registration, unregistration, sign-out, account transfer, and sending take PostgreSQL locks in one order: user, token, installation.
- A send holds the user's push lock through the Expo call, for at most 120 seconds. Under the locks, it re-reads which tokens active sessions still own, and sends only to those.
- Role changes and bootstraps take the target's push lock first, so they wait for a running send. Their transaction timeouts exceed the send limit. A role change then takes the global role lock and only then the target's auth lock. So it never waits on another user's send, and a queued role change never blocks a login.
- The auth cleanup binds an old token without a session to the user's newest active session. With no such session, it deletes the token. It also deletes every token whose session has ended.

Installed apps update later than the backend, and a strict parser breaks on a new response field. So the push routes still accept the old token-only register and unregister bodies. They act only for the current session and cannot change an installation. Remove them in a separate release, once no supported app version sends them.

## Clients

`webapp` (React CSR) owns the browser app after sign-in. `website` (Astro SSG) owns public SEO pages. `mobile` (Expo) is the iOS, Android, and Expo Web app on the same API and contracts. Their rules are in [webapp/README](../webapp/README.md), [website/README](../website/README.md), and [mobile/README](../mobile/README.md). Data, cart, checkout, and payment boundaries are in [WEB_SURFACES](WEB_SURFACES.md). App Store and Google Play subscriptions ship switched off; see [IAP](IAP.md).

## Prisma

- Pin `prisma`, `@prisma/client`, and `@prisma/adapter-pg` to one exact version (now `7.10.0`) in `backend/package.json`, because a patch release once installed an incomplete client. `bun update --latest` can replace the pin. Upgrade all three together, and only after `typecheck`, backend tests, and E2E pass.
- PostgreSQL 18+ generates primary keys as UUIDv7: `@id @default(dbgenerated("uuidv7()")) @db.Uuid`. Raw SQL and imports therefore get the same IDs as Prisma. Foreign keys to them use `@db.Uuid`. Never use `cuid()`, `uuid()`, `serial`, or `bigserial`. A table reached only by its natural key, like `RateLimitBucket`, keys on it.
- Closed value sets are Postgres enums, such as `UserRole` and `TaskOutboxStatus`; changing one is a migration. Open sets are `text` checked by a code registry, such as `task_outbox.type` by `backend/src/outbox/handlers.ts`. A new value then needs no irreversible `ALTER TYPE`.
- The schema is a folder, `backend/prisma/schema/`: `base.prisma` plus one file per capability, such as `notifications.prisma` and the commented-out `billing.prisma`. Removing a capability deletes its file and its marked relations in `base.prisma`.
- Edit the schema files, then run `bun run --cwd backend prisma:migrate`. Write migration SQL by hand only on request. Production applies committed migrations with `prisma:deploy` inside `db:deploy`.

## Local infrastructure

Docker Compose runs PostgreSQL 18 for development and tests. [LOCAL_DATABASE](LOCAL_DATABASE.md) owns its commands, ports, volumes, and resets.

## Storage

`backend/src/storage` is a shared service with `filesystem` and `s3` drivers, not a product module. Only `src/storage` imports `@aws-sdk/*`, and `architecture:check` forbids `@aws-sdk/` in module `domain`, `application`, and `transport`. PostgreSQL owns object ownership, state, and retention. Reference module: `backend/src/modules/uploads`. See [STORAGE](STORAGE.md).
