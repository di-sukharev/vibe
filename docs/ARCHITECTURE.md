# Product Modules Architecture

This repository defines a golden path for web and backend products: shared contracts, a modular-monolith backend, one CSR browser app (`webapp`), one Astro SSG/SSR site (`website`), and little custom infrastructure. The runnable mobile app lives on the `mobile` branch and extends this architecture only when mobile is active.

The approach is **progressive DDD-lite**. Product contexts get explicit ownership and dependency direction without forcing every context to have every layer. Add a `domain` directory only when the feature has real policies, calculations, or state transitions. Do not add empty layers, generic/base repositories, CQRS, event sourcing, or extra services as architecture decoration.

## Contracts

`packages/contracts` is the source of truth for API payloads, DTOs, and error shapes. New endpoints should start with Zod schemas in contracts. The backend then uses those schemas for request validation, while the webapp uses them in TanStack Form and API clients.

Do not hand-copy API shapes into clients. When a contract changes, validate producer and consumers in one pass: backend route/service and webapp API client/form. On the `mobile` branch, include the mobile API client/form in that same pass.

## Backend

Backend product contexts live under `src/modules/<context>` and follow this flow:

```text
transport -> application -> domain/ports -> infrastructure -> DTO
```

- `src/index.ts` is the API runtime entrypoint.
- `src/jobs.ts` is the background-job registry: one declaration per job, shared by all three runners below. Do not declare a job inside a runner.
- `src/cron.ts` owns the one-job executor. CLI/system cron mode exits after one run; Yandex timer
  mode serves that executor over HTTP so failures become non-2xx and activate trigger retries.
- `src/scheduler.ts` is the long-running timer process; `src/worker.ts` is the long-running loop process. `job-schedules.json` includes outbox, upload cleanup, and auth cleanup; Terraform deploys them through a DigitalOcean scheduler worker or Yandex timer tasks. The loop worker ships empty. See [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md).
- `src/runtime.ts` owns shared env loading, Prisma creation, and runtime cleanup for all backend entrypoints.
- `src/background-tasks.ts` defers response-independent best-effort work and lets the API drain accepted tasks before graceful shutdown. Tasks receive an `AbortSignal`; a task deadline aborts work but keeps its cleanup tracked until settlement, while server draining and task cleanup consume one shared absolute shutdown deadline. It holds work whose loss on a restart is acceptable - deleting an object whose upload row was rejected, for instance.
- `src/outbox` holds work whose loss is not acceptable: a row in `task_outbox`, claimed and retried by the `outbox:drain` job until it succeeds or gives up. Three mechanisms, one distinction: `background-tasks.ts` for best-effort work inside a request, `outbox` for durable one-off work, `jobs.ts` for work on a timer. Password reset uses the outbox, which is also what keeps the public response path account-independent: the request writes one row for any address - or none for any address, while a flood keeps the queue's ceiling full - and the handler does the lookup. See [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md).
- `src/app.ts` is the composition root. It owns the Hono app, CORS, secure headers, error handling, module construction, route mounting, and OpenAPI output.
- `src/env.ts` validates environment variables with Zod.
- `src/db.ts` creates the Prisma client.
- `src/modules/auth/index.ts` is the auth module's public boundary and golden path. Its route factory captures dependencies in closures; request context contains only the authenticated principal.
- `src/modules/users/index.ts` owns profile updates, administrator reads, and role mutations. It depends on auth only through the authenticated principal and route-guard capabilities.

Backend module ownership:

```text
modules/<context>/
  index.ts          # only cross-context import boundary
  transport/        # Hono, HTTP validation and representation
  application/      # use cases, permissions, transactions, orchestration
  domain/           # optional pure policies, transitions and calculations
  infrastructure/   # Prisma and external provider adapters
```

Transport must not import Prisma. Application and domain must not import Hono, Prisma, environment configuration, or provider SDKs. Infrastructure implements context-specific ports; repositories expose product operations rather than generic CRUD. Cross-context collaboration goes through public `index.ts` APIs or explicit application ports such as auth's `ProjectUser` and `LogoutCleanup`, never through another context's internals.

Routes stay thin and translate HTTP into application calls and application failures into the stable API error shape. Do not put business rules into Hono handlers, UI clients, or child components.

## Runtime Shape And Real-Time

The default runtime shape is a modular monolith: one backend codebase, one database, shared contracts, and clear feature boundaries inside the repository. The backend can expose separate API, worker, and cron entrypoints while still sharing Prisma schema, env validation, services, and contracts.

**Solve the problem with the infrastructure that already exists before adding a new infrastructure element.** The starting set is PostgreSQL, one backend process, and the job runners in `backend/src/jobs.ts`. A queue, a broker, an event log, a cache, or a search engine is not just a library: it is a new thing to deploy, monitor, secure, back up and pay for, and a new way for the product to be broken while the database is healthy.

Each of those has a smaller first answer inside what is already here:

- durable background work belongs in the `task_outbox` table drained by the `outbox:drain` job, not in a queue service with its own consumer process;
- a slow read belongs behind an index or a narrower query before it belongs behind a cache;
- a text search belongs in PostgreSQL full-text search before it belongs in a search engine;
- a cross-process notification belongs in a row plus a poll before it belongs in a broker.

This is not absolute. Add the component when a **measured** limit of the current approach has been reached and the new component removes that limit: the drain cannot keep up at the shortest interval the hosting allows and the backlog grows across runs; delivery is needed to processes that do not share this database; the work needs ordering or exactly-once semantics PostgreSQL cannot express; retention or throughput would put queue rows on a different storage path from product data; or real-time fanout must cross backend instances, which is the case the next paragraphs describe. Record the measurement in `CHECKLIST.md` next to the capability row before adding the component, so a later session can tell a real limit from a preference.

The Terraform launch profiles keep one API runtime and one Managed PostgreSQL node: an `apps-s-1vcpu-1gb` App Platform service plus scheduler worker on DigitalOcean, or a Serverless Container plus task timers on Yandex. Both run the same `backend/Dockerfile`; the recurring schedule is declared once in `backend/src/job-schedules.json`. `webapp` and fully prerendered `website` stay static hosting and do not need application runtime sizing. A `website` route with SSR/on-demand rendering or server islands needs an explicit runtime service in the selected provider stack.

For real-time features such as chat, presence, collaboration, live notifications, or activity feeds, start with the same backend service. A single instance can keep an in-memory registry of its own WebSocket connections. Once the backend runs multiple instances, in-memory fanout is no longer enough: one user may be connected to instance A while another is connected to instance B. At that point, add a managed Redis-compatible Pub/Sub broker between backend instances so each instance can publish domain events and subscribe to events it must deliver to its local sockets.

Use DigitalOcean Managed Valkey or Yandex Managed Service for Valkey, whichever hosting `CHECKLIST.md` records; on an own server, run a Valkey or Redis container next to the backend. Add this infrastructure only when horizontal scaling and cross-instance WebSocket/SSE delivery are actually required; it is not part of the baseline local setup.

Valkey Pub/Sub is only a fanout mechanism. Keep durable chat messages, notifications, collaboration state, and audit-relevant events in PostgreSQL; publish compact event identifiers after commits; and make clients recover by reconnecting and refetching from the API after missed realtime messages.

## Auth

Auth v1 is custom JWT-based auth:

- Passwords use `Bun.password.hash/verify` with Argon2id.
- Access tokens are short-lived JWTs signed and verified with `jose`.
- Refresh tokens are opaque random tokens; only the current and immediately previous SHA-256 hashes are stored in PostgreSQL.
- Browser routes under `/api/auth/*` keep the refresh token only in an HttpOnly cookie and never return it in JSON. Local HTTP uses `SameSite=Lax`; HTTPS production uses `Secure` and `SameSite=None` so browser auth works across separate webapp/API origins.
- Native routes under `/api/auth/token/*` never read or set cookies and explicitly exchange refresh tokens in JSON/body payloads. The `mobile` branch stores those tokens through its native adapter.

Refresh-token rotation updates the credential atomically inside one logical session, preserving already-issued access tokens for other tabs. The immediately previous refresh credential is accepted only during a short race-tolerance window; replay after that window revokes the session as potentially compromised. `/api/auth/me` checks both the JWT and the active database session, including its absolute lifetime.

Password reset is part of the auth application boundary. A provider-neutral email port receives transactional messages; the default adapter is deliberately disabled. Reset requests are generic, rate-limited by account cooldown, and persist only a SHA-256 token hash. Confirmation changes the password, consumes outstanding reset credentials, and revokes active sessions in the same authentication-authority transaction without automatically creating a new session.

Roles are `user | admin` in PostgreSQL and in `UserDto`, but deliberately absent
from JWT claims. Every authenticated request resolves the current user through
the active database session, so server authorization observes promotions and
demotions immediately. Registration and new social accounts always create
`user`; only the users/admin module changes roles. Its serialized transaction
prevents self-demotion and a zero-administrator state, and revokes the target’s
sessions after a real change. Existing-account session issuance, role changes,
and bootstrap credential changes share a per-user authentication-authority
fence. Login re-reads the user and verifies the current password under that
fence before inserting a session, so an old credential cannot create a session
after a password reset and a session response uses the role current at issuance.

## Frontend

There are two browser surfaces, split by whether the pages need SEO. `website` (Astro, SSG by default, SSR/hybrid only when needed) owns public, search-indexable, and link-previewed pages: landing, marketing, content, and the public catalog of a storefront or marketplace. `webapp` (React CSR) owns screens that live behind sign-in and need no SEO: buyer account, seller/admin panels, checkout/account workflows, dashboards, settings, and authenticated tools. A marketplace normally uses both surfaces, sharing `@web-app-demo/contracts`. The decision rule the installing agent should apply is in the root [README.md](../README.md) under "Choosing `webapp` vs `website`"; the mandatory data/cart/payment ownership contract is [WEB_SURFACES.md](WEB_SURFACES.md).

Browser commerce has one authenticated checkout in `webapp`: `website` may provide public product
information and an anonymous local cart, but it cannot create payments or own order state. Mobile
is a separate native payment boundary and may use its configured store, wallet, or card path while
the backend keeps shared orders and entitlements authoritative. Do not route native payment through
the public website or create parallel browser checkout implementations.

The webapp follows these client rules:

- TanStack Query owns server state.
- TanStack Form owns form state.
- Zod schemas come from `@web-app-demo/contracts`.
- `src/platform/api` owns endpoint-agnostic fetch, base URL handling, response parsing, and the shared API error.
- `src/features/<context>` owns endpoint paths, schemas, server-state adapters, providers, and product UI for that context.
- Routes and `src/main.tsx` are thin composition files and import features through their public `index.ts`.
- `src/components/ui` and `src/platform` never import product features. Features may use platform code and UI primitives; cross-feature imports must use the target feature's public index.

Auth in `src/features/auth` is the client golden path: its API adapter owns auth endpoints and refresh/retry, its provider exposes only auth behavior, and pages never receive a universal API service locator. Future providers should receive narrow context APIs such as `BillingApi` or `NotificationsApi` from composition.

The webapp has two non-overlapping authenticated route trees: `/app/*` for
`user`, and `/admin/*` for `admin`. Route guards wait for auth bootstrap, redirect
guests through a role-checked internal return path, and send cross-role requests
to the current role’s home. The return-path allow-list is the role’s protected
route table in `src/features/navigation`: a path matcher over literal and named
`$param` segments, so parameterised routes survive the login round-trip. A unit
test pins that table to the routes registered under each workspace layout and
rejects route shapes the matcher does not understand; the sidebar menu is a
presentation subset of it. The shared workspace shell owns the full shadcn
dashboard-01 sidebar/inset visual unit; role navigation is a pure feature-owned
map. Shared shell building blocks live in `src/components/dashboard`, while
account and admin panels stay with their owning feature. Dashboard metrics and
tables render only contract-validated API state; the template does not ship fake
analytics or demo chart data.

UI primitives in `src/components/ui` are the complete local shadcn library and
remain available for future product work. Closed product components own their
visual surface and accept semantic data, state, and callbacks rather than
`className` or `style`. Routes/pages compose them through layout wrappers.
Low-level UI and explicit layout primitives are the only styling-prop boundary.
Product components expose semantic data, state, and callbacks; inherited DOM
contracts must be narrowed locally instead of forwarding `className` or `style`.

The `mobile` branch selects cookie auth for Expo Web and token auth for native
iOS/Android. Browser refresh credentials must never be persisted in
`localStorage`, `sessionStorage`, AsyncStorage, or another JavaScript-readable
store.
Do not create a new form, query, auth, or API abstraction until the existing pattern stops solving the current problem.

`website` is a separate Astro workspace for public SSG/SSR pages. Pages prerender to static HTML by default. Marketplace freshness should climb this ladder: SSG plus rebuild/redeploy for durable listing/category/content changes; cached on-demand/SSR routes with CDN headers such as `stale-while-revalidate` when freshness matters more than a full redeploy cycle; Astro server islands for non-SEO-critical dynamic or personalized fragments; uncached or personalized SSR only for request-specific pages such as live search, personalized public views, or inventory/price pages where stale HTML is unacceptable. On-demand/SSR routes and server islands both require an Astro adapter and a runtime-capable deployment; they do not work from a pure Static Site host or object-storage static website. Server islands on cached pages or rolling deploys require a stable secret `ASTRO_KEY` shared by build and runtime environments; never commit it, expose it as `PUBLIC_*`, or bake it into static output. Shared CDN caching is only for anonymous, public-equivalent HTML; auth-dependent or personalized responses must use `private`/`no-store` or a deliberate `Vary: Cookie`/`Authorization` strategy, and `ASTRO_KEY` is not a cache privacy boundary.

SEO-critical content must be present in the initial HTML: titles, descriptions, canonical URLs, social preview tags, product/category names, indexable descriptions, and public prices when snippets need them. Client islands and server islands may enhance the page, but they must not be the only source of SEO-critical content. `website` does not own the full auth flow and should not duplicate the CSR client from `webapp`; auth in `website` is limited to public-site needs such as a logged-in header state or lightweight actions. If the website starts reading API data or shared DTOs, connect `@web-app-demo/contracts` and validate producer/consumer sides the same way as `webapp`.

Astro remains the default website stack because it is content-first, static-first, low-JS by default, and gives agents a clear SEO surface. Choose Next.js only when a project intentionally wants a Vercel-optimized ISR/cache platform. Treat TanStack Start as an optional future React full-stack path for teams that want one React app with selective SSR, not as the baseline for non-programmer vibe-coding projects.

## Testing

Backend unit/integration tests verify auth and users/admin RBAC behavior at their owning layers. Webapp E2E uses Playwright and starts a real backend + Vite through `webServer`, including a seeded administrator and session-revoking role promotion. Mobile E2E lives on the `mobile` branch and uses Maestro with stable React Native `testID` selectors.

Client E2E is a curated portfolio of product journeys and failure mechanisms that depend on a real
browser. Negative payload matrices, password/JWT rules, stable API error shapes, concurrency, and
pure rules stay in their owning backend integration, contract, or unit layers. Follow
[TESTING.md](TESTING.md) to choose the narrowest stable boundary that detects the task's regression.

Run `bun run architecture:check` when module, feature, contract, platform, or UI dependency boundaries change. The dependency-free checker reports forbidden static imports as `path:line` and has fixture tests for each rule family. File length is deliberately not an architecture rule; ownership and dependency direction are.

## Prisma

Do not hand-write Prisma migration SQL. Change `backend/prisma/schema.prisma`, then use:

```bash
bun run --cwd backend prisma:migrate
```

The template uses database-generated UUIDv7 primary keys (`@default(dbgenerated("uuidv7()")) @db.Uuid`) instead of ORM-generated `cuid()`/`uuid()`. That keeps ID generation consistent for Prisma Client, direct SQL, imports, and any future background workers or non-Prisma writers, but it also means the schema requires PostgreSQL 18+.

A closed set of values belongs in a Postgres enum; an open one does not. `task_outbox.status` is an enum because a row is only ever pending, processing, done, skipped or failed, and changing that genuinely is a schema change. `task_outbox.type` is plain text validated in code against the handler registry, so adding a task type stays a code change instead of an `ALTER TYPE` that cannot be rolled back. Recurring job names follow the same rule: `scheduler.ts` rejects an unknown name from `job-schedules.json`, and Yandex Terraform reads that same file when creating HTTP job containers.

Treat UUIDv7 as a repository-level rule, not a one-off model detail. New primary keys should use database-generated UUIDv7, and foreign keys that reference those IDs should use `@db.Uuid` so the type stays native all the way through PostgreSQL and Prisma.

For production, apply already-created migrations:

```bash
bun run --cwd backend prisma:deploy
```

## Local Infrastructure

Local PostgreSQL is provided by Docker Compose, not by a native database install. The development service uses `postgres:18-alpine`, exposes `web_app_demo` on host port `54329`, and stores data in the `postgres_18_data` volume. The test service uses the same image with database `web_app_demo_test`; automated runners set `POSTGRES_TEST_PORT` to a repository-derived port when they need isolation. PostgreSQL 18 is intentional here because the backend schema relies on the native `uuidv7()` database function.

Keep `docker-compose.yml`, `backend/.env.example`, and [LOCAL_DATABASE.md](LOCAL_DATABASE.md) aligned when changing local database names, ports, credentials, image tags, or volume paths.

## Storage

The backend owns storage access through `src/storage`, which exposes one provider-neutral port: presigned upload, presigned download, HEAD, ranged read, and delete. Two drivers implement it - a filesystem driver that needs nothing installed, and an S3 driver for any S3-compatible endpoint - and one shared contract suite is run against both, so moving between them is configuration rather than code.

`src/storage` is a backend-wide service, not a product module. It is the only place the AWS SDK appears; `scripts/architecture-check.mjs` forbids `@aws-sdk/` inside any module's `domain`, `application`, or `transport` layer, so a product module reaches storage through the port. `backend/src/modules/uploads` is the worked example: it owns the avatar use cases and the database rows, and knows nothing about which driver is configured.

Ownership, state, and retention live in PostgreSQL, because storage cannot answer who a file belongs to or whether an upload finished. Object keys are generated by the backend and carry no personal data.

For image optimization, generate app-owned variants in the backend or a worker and store them under stable keys. See [STORAGE.md](STORAGE.md).

## Current Upstream Documentation

For framework and API questions, consult the current upstream documentation linked here first. This document describes repository conventions; upstream docs are authoritative for tool behavior.

- [Bun docs](https://bun.sh/docs)
- [Hono docs](https://hono.dev/docs)
- [Hono Zod OpenAPI example](https://hono.dev/examples/zod-openapi)
- [Prisma docs](https://www.prisma.io/docs)
- [PostgreSQL docs](https://www.postgresql.org/docs/)
- [PostgreSQL Docker Official Image](https://hub.docker.com/_/postgres)
- [DigitalOcean Spaces docs](https://docs.digitalocean.com/products/spaces/)
- [DigitalOcean Valkey docs](https://docs.digitalocean.com/products/databases/valkey/)
- [Yandex Managed Service for Valkey docs](https://yandex.cloud/en/docs/managed-redis/)
- [Zod docs](https://zod.dev/)
- [jose documentation](https://github.com/panva/jose)
- [TanStack Query React docs](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Form React docs](https://tanstack.com/form/latest/docs/framework/react/quick-start)
- [TanStack Router docs](https://tanstack.com/router/latest/docs/overview)
