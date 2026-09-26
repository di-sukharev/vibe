# Architecture

This guide owns module boundaries, auth and sessions, Prisma rules, and infrastructure growth. Use progressive DDD-lite: explicit owners and dependency directions, no mandatory layers. Add `domain` only for real rules. Never add empty layers, generic repositories, CQRS, or event sourcing.

## Contracts first

`packages/contracts` defines API requests, responses, and errors as Zod schemas. Start every endpoint there. Backend routes declare the schemas through `@hono/zod-openapi`, which also generates `GET /openapi.json`. After a change, check the backend route and service, the webapp API client and forms, and the mobile API and forms on the `mobile` branch.

## New feature

`bun run scaffold:feature -- <plural-kebab-name>` generates a full-stack owned resource (a list scoped to the signed-in user, plus create) in the shape of the `users`/`admin` reference slices: a contracts file, a three-layer backend module (`transport`/`application`/`infrastructure`, no `domain` - this shape has no rules beyond ownership), its integration test, a Prisma model file, and a webapp feature with a unit-tested pure model. It inserts text only before an explicit `// scaffold:<name>` marker comment already checked into the contracts index, `backend/src/app.ts`, `backend/prisma/schema/base.prisma` (the `User` back-relation), `webapp/src/routes.tsx`, `webapp/src/features/navigation/model.ts`, and the sidebar icon map in `webapp/src/components/WorkspaceShell.tsx`.

It refuses, before it writes anything, a name that is not kebab-case or is reserved, a missing marker, an existing file, a name that collides with an existing module, feature, contracts file, Prisma model, `User` field, mapped table, or contracts export, and a name whose inserted lines would repeat an identifier or path already in the edited file (for example `user-settings`, whose `userSettingsRoute` exists in `routes.tsx`). It prints the singular it derived; it guesses one only for unambiguous English endings and otherwise asks for `--singular <word>` (for example `buses`, `quizzes`, or `cases`). If any later step fails, `prisma generate` included, or SIGINT or SIGTERM arrives, it deletes what it created and restores the files it edited. `--dry-run` lists the files without touching the tree.

After it runs, create the migration (`bun run --cwd backend prisma:migrate -- --name add_<name>`), then add the feature's row to `CHECKLIST.md`. `bun run test:scaffold` generates the sample features `items` and `invoice-items` in a scratch copy of the repository and runs typecheck, `lint`, the webapp tests, `architecture:check`, and the generated integration tests there, against a test database in its own Docker Compose project that it removes afterward. A change to the reference slices that breaks the templates then fails in `bun run check`, not at the next `scaffold:feature` call.

## Backend modules

A context lives in `backend/src/modules/<context>`. Dependencies point inward: `transport` → `application` → `domain`.

- `index.ts`: public API and composition. Other code imports the context only here or through an application port, such as auth's `ProjectUser`.
- `transport/`: Hono routes and HTTP mapping. Never imports `infrastructure`, Prisma, `pg`, `jose`, or provider SDKs.
- `application/`: use cases, permissions, transactions, and ports. Never imports `transport`, `infrastructure`, Hono, Prisma, `jose`, `env`, or provider SDKs.
- `domain/` (optional): pure rules and calculations. Imports only `domain` and contracts.
- `infrastructure/`: Prisma and SDK adapters that implement application ports. Never imports `transport`.
- Only `index.ts` and module-wide tests sit at the module root.

Routes translate HTTP into application calls and map failures to the stable API error format. Repositories offer product operations, not generic CRUD. The request context carries only the authenticated user.

Shared code sits outside `modules`: `src/app.ts` (composition, CORS, secure headers, rate limits, errors, OpenAPI), `src/env.ts` (environment validation), `src/runtime.ts` (env, Prisma, email, storage, and shutdown for every process), and `src/db.ts` (Prisma client, advisory locks). [BACKGROUND_JOBS](BACKGROUND_JOBS.md) owns background work and the API, cron, scheduler, and worker processes.

`bun run architecture:check` enforces these rules plus the client and contract boundaries. It scans imports without running code and reports each violation as `path:line [rule] message`.

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

- `/api/auth/*` (browsers): the refresh token lives only in the HttpOnly cookie `web_app_demo_refresh`, never in JSON. `COOKIE_SECURE=false` (local) sets `SameSite=Lax`. `COOKIE_SECURE=true` (production) sets `Secure; SameSite=None`, and register, login, refresh, and logout require an `Origin` from `CORS_ORIGINS`.
- `/api/auth/token/*` (native apps): no cookies. The refresh token travels in JSON and lives in native secure storage.
- Access tokens travel as `Authorization: Bearer`. Expo Web uses the cookie routes. Never keep a browser refresh token in `localStorage`, `sessionStorage`, AsyncStorage, or other JavaScript-readable storage.

Rotation:

- Each refresh derives the next token by HMAC from the presented token and the server secret, so concurrent refreshes get the same successor.
- Rotation swaps the hashes atomically within the same session, so other tabs keep their access tokens. `REFRESH_TOKEN_TTL_DAYS` slides; `SESSION_ABSOLUTE_TTL_DAYS` caps the session.
- The previous token stays valid for `REFRESH_REUSE_GRACE_SECONDS` (default 10, maximum 60). Any later reuse of an old token revokes the session. Do not widen the window without need.

Password reset:

- The request always returns the same `202` and never looks up the account. With `EMAIL_DELIVERY=disabled` it writes nothing. Otherwise it enqueues an `auth:password-reset` outbox task for any address, up to the cap in [BACKGROUND_JOBS](BACKGROUND_JOBS.md#anonymous-enqueue).
- The task handler looks up the account and issues at most one token per account per minute. It stores the SHA-256 of a random 32-byte token valid for 30 minutes and mails a link with the token in its URL fragment. If delivery fails permanently or on the final attempt, the handler invalidates the unsent token.
- Confirmation is one transaction: it changes the password hash, consumes all reset tokens, revokes all sessions, and enqueues an `auth:password-changed` notice. The response clears the refresh cookie; there is no automatic sign-in.

Roles:

- `user | admin` lives in `users.role` and `UserDto`, never in the JWT. Registration creates `user`; clients never choose a role. Only the role endpoint and the admin bootstraps (`db:deploy`, dev seed) grant `admin`.
- `PATCH /api/admin/users/{userId}/role` runs under a global lock. It refuses self-demotion and removal of the last admin. A real change revokes the target's sessions and unused reset tokens.
- `/api/admin/*` requires `admin` on the server and returns `403 FORBIDDEN` otherwise.

Login, role changes, reset tokens, and bootstraps share a per-user advisory lock (`acquireUserAuthenticationAuthorityLock` in `backend/src/db.ts`). Under it, login re-reads the user and re-checks the password before it inserts the session, so an old password cannot open a session after a reset.

## Clients

`webapp` (React CSR) owns everything after sign-in. `website` (Astro SSG) owns public SEO pages. Their rules are in [webapp/README](../webapp/README.md) and [website/README](../website/README.md). Data, cart, checkout, and payment boundaries are in [WEB_SURFACES](WEB_SURFACES.md).

## Prisma

- Pin `prisma`, `@prisma/client`, and `@prisma/adapter-pg` to one exact version (now `7.10.0`) in `backend/package.json`, because a patch release once installed an incomplete client. `bun update --latest` can replace the pin. Upgrade all three together, and only after `typecheck`, backend tests, and E2E pass.
- PostgreSQL 18+ generates primary keys as UUIDv7: `@id @default(dbgenerated("uuidv7()")) @db.Uuid`. Raw SQL and imports therefore get the same IDs as Prisma. Foreign keys to them use `@db.Uuid`. Never use `cuid()`, `uuid()`, `serial`, or `bigserial`. A table reached only by its natural key, like `RateLimitBucket`, keys on it.
- Closed value sets are Postgres enums, such as `UserRole` and `TaskOutboxStatus`; changing one is a migration. Open sets are `text` checked by a code registry, such as `task_outbox.type` by `backend/src/outbox/handlers.ts`. A new value then needs no irreversible `ALTER TYPE`.
- Edit `backend/prisma/schema/`, then run `bun run --cwd backend prisma:migrate`. Write migration SQL by hand only on request. Production applies committed migrations with `prisma:deploy` inside `db:deploy`.

## Local infrastructure

Docker Compose runs PostgreSQL 18 for development and tests. [LOCAL_DATABASE](LOCAL_DATABASE.md) owns its commands, ports, volumes, and resets.

## Storage

`backend/src/storage` is a shared service with `filesystem` and `s3` drivers, not a product module. Only `src/storage` imports `@aws-sdk/*`, and `architecture:check` forbids `@aws-sdk/` in module `domain`, `application`, and `transport`. PostgreSQL owns object ownership, state, and retention. Reference module: `backend/src/modules/uploads`. See [STORAGE](STORAGE.md).
