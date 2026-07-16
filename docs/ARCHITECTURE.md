# Product Modules Architecture

This repository defines a golden path for web and mobile products: shared contracts, a modular-monolith backend, a CSR browser app (`webapp`), an Astro SSG/SSR site (`website`), and a runnable Expo mobile app, with little custom infrastructure.

The approach is **progressive DDD-lite**. Product contexts get explicit ownership and dependency direction without forcing every context to have every layer. Add a `domain` directory only when the feature has real policies, calculations, or state transitions. Do not add empty layers, generic/base repositories, CQRS, event sourcing, or extra services as architecture decoration.

## Contracts

`packages/contracts` is the source of truth for API payloads, DTOs, and error shapes. New endpoints should start with Zod schemas in contracts. The backend then uses those schemas for request validation, while the webapp and mobile app use them in TanStack Form and API clients.

Do not hand-copy API shapes into clients. When a contract changes, validate producer and consumers in one pass: backend transport/application, webapp feature adapter/form, and mobile feature adapter/form.

## Backend

Backend product contexts live under `src/modules/<context>` and follow this flow:

```text
transport -> application -> domain/ports -> infrastructure -> DTO
```

- `src/index.ts` is the API runtime entrypoint.
- `src/worker.ts` is the long-running worker entrypoint. Keep it disabled in deployment specs until a real background handler is registered.
- `src/cron.ts` is the one-shot scheduled-job entrypoint. Add concrete tasks to its registry and deploy scheduled jobs only for named product tasks.
- `src/runtime.ts` owns shared env loading, Prisma creation, and runtime cleanup for all backend entrypoints.
- `src/app.ts` is the composition root. It owns the Hono app, CORS, secure headers, error handling, module construction, route mounting, and OpenAPI output.
- `src/env.ts` validates environment variables with Zod.
- `src/db.ts` creates the Prisma client.
- `src/modules/auth/index.ts` is the auth module's public boundary and golden path. Its route factory captures dependencies in closures; request context contains only the authenticated principal.
- `src/modules/notifications/index.ts` owns Expo Push token registration, durable push outbox processing, Expo ticket/receipt handling, and stale-token cleanup.

Backend module ownership:

```text
modules/<context>/
  index.ts          # only cross-context import boundary
  transport/        # Hono, HTTP validation and representation
  application/      # use cases, permissions, transactions, orchestration
  domain/           # optional pure policies, transitions and calculations
  infrastructure/   # Prisma and external provider adapters
```

Transport must not import Prisma, database adapters, or module infrastructure. Application and domain must not import Hono, Prisma, environment configuration, HTTP infrastructure, or provider SDKs. Infrastructure implements context-specific ports and never imports HTTP transport; repositories expose product operations rather than generic CRUD. Cross-context collaboration goes through public `index.ts` APIs or explicit application ports such as auth's `SubscriptionReader` and `LogoutCleanup`, never through another context's internals.

Routes stay thin and translate HTTP into application calls and application failures into the stable API error shape. Do not put business rules into Hono handlers, UI clients, or child components.

Application services must own real use-case orchestration through narrow capability ports. Do not introduce context-wide `*Operations` ports or one-to-one forwarding services that merely rename infrastructure methods. Keep provider normalization and persistence details in infrastructure, then expose only the subject-specific operations the use case needs.

## Runtime Shape And Real-Time

The default runtime shape is a modular monolith: one backend codebase, one database, shared contracts, and clear feature boundaries inside the repository. The backend can expose separate API, worker, and cron entrypoints while still sharing Prisma schema, env validation, services, and contracts. Do not add queues, brokers, or extra infrastructure until the product has a concrete need that the monolith cannot meet clearly.

On the default DigitalOcean production path, run the backend/API as one `apps-s-1vcpu-1gb` App Platform container so the starting infrastructure stays inside the low-cost budget when paired with the smallest production Managed PostgreSQL cluster. Add App Platform worker or scheduled-job components from the same `backend/Dockerfile` only when the product has a concrete background or periodic task. `webapp` and fully prerendered `website` output remain App Platform Static Site components and do not have runtime container sizes. A `website` route with SSR/on-demand rendering or server islands needs a runtime service.

For real-time features such as chat, presence, collaboration, live notifications, or activity feeds, start with the same backend service. A single instance can keep an in-memory registry of its own WebSocket connections. Once the backend runs multiple instances, in-memory fanout is no longer enough: one user may be connected to instance A while another is connected to instance B. At that point, add a managed Redis-compatible Pub/Sub broker between backend instances so each instance can publish domain events and subscribe to events it must deliver to its local sockets.

On the default DigitalOcean path, use DigitalOcean Managed Valkey for this broker. On the optional Yandex Cloud path, use Yandex Managed Service for Valkey. Add this infrastructure only when horizontal scaling and cross-instance WebSocket/SSE delivery are actually required; it is not part of the baseline local setup.

Valkey Pub/Sub is only a fanout mechanism. Keep durable chat messages, notifications, collaboration state, and audit-relevant events in PostgreSQL; publish compact event identifiers after commits; and make clients recover by reconnecting and refetching from the API after missed realtime messages.

## Auth

Auth v1 is custom JWT-based auth:

- Passwords use `Bun.password.hash/verify` with Argon2id.
- Access tokens are short-lived JWTs signed and verified with `jose`.
- Refresh tokens are opaque random credentials with a secret family locator; PostgreSQL stores only hashes of the family, current credential, and immediately previous credential.
- Browser routes under `/api/auth/*` are used by the webapp and Expo Web. They keep the refresh token only in an HttpOnly cookie and never return it in JSON. Local HTTP uses `SameSite=Lax`; HTTPS production uses `Secure` and `SameSite=None` so browser auth works across separate client/API origins.
- Native iOS and Android routes under `/api/auth/token/*` never read or set cookies and explicitly exchange refresh tokens in JSON/body payloads. Native mobile stores refresh tokens in `expo-secure-store` and keeps access tokens in memory.
- Mobile social auth uses Apple/Google provider subjects as stable identity keys. Social auth does not auto-link to existing password accounts by email; products that need linking should add an explicit authenticated account-linking flow.

Refresh-token rotation updates the credential atomically inside one logical session, preserving already-issued access tokens for other tabs. The immediately previous credential is accepted only during a short race-tolerance window; presenting any older credential after that window revokes the token family as potentially compromised. `/api/auth/me` checks both the JWT and the active database session, including its absolute lifetime.

## Frontend

There are two browser surfaces, split by whether the pages need SEO. `website` (Astro, SSG by default, SSR/hybrid only when needed) owns public, search-indexable, and link-previewed pages: landing, marketing, content, and the public catalog of a storefront or marketplace. `webapp` (React CSR) owns screens that live behind sign-in and need no SEO: buyer account, seller/admin panels, checkout/account workflows, dashboards, settings, and authenticated tools. A marketplace normally uses both surfaces, sharing `@web-app-demo/contracts`. The native mobile app is a third client that consumes the same contracts. The decision rule the installing agent should apply is in the root [README.md](../README.md) under "Choosing `webapp` vs `website`".

The webapp and mobile app follow the same client rules:

- TanStack Query owns server state.
- TanStack Form owns form state.
- Zod schemas come from `@web-app-demo/contracts`.
- `src/platform/api` owns endpoint-agnostic fetch, base URL handling, response parsing, and the shared API error.
- `src/features/<context>` owns endpoint paths, schemas, server-state adapters, providers, and product UI for that context.
- Routes and `src/main.tsx` are thin composition files and import features through their public `index.ts`.
- `src/components/ui` and `src/platform` never import product features. Features may use platform code and UI primitives; cross-feature imports must use the target feature's public index and the resulting feature graph must stay acyclic. Put collaboration that would create a cycle into composition behind a narrow owning port.

Auth in `src/features/auth` is the client golden path: its API adapter owns auth endpoints and refresh/retry, its provider exposes only auth behavior, and pages never receive a universal API service locator. Future providers should receive narrow context APIs such as `BillingApi` or `NotificationsApi` from composition.

Mobile composition selects cookie auth for Expo Web and token auth for native iOS/Android. Browser refresh credentials must never be persisted in `localStorage`, `sessionStorage`, AsyncStorage, or another JavaScript-readable store.

Do not create a new form, query, auth, or API abstraction until the existing pattern stops solving the current problem.

`website` is a separate Astro workspace for public SSG/SSR pages. Pages prerender to static HTML by default. Marketplace freshness should climb this ladder: SSG plus rebuild/redeploy for durable listing/category/content changes; cached on-demand/SSR routes with CDN headers such as `stale-while-revalidate` when freshness matters more than a full redeploy cycle; Astro server islands for non-SEO-critical dynamic or personalized fragments; uncached or personalized SSR only for request-specific pages such as live search, personalized public views, or inventory/price pages where stale HTML is unacceptable. On-demand/SSR routes and server islands both require an Astro adapter and a runtime-capable deployment; they do not work from a pure Static Site host or object-storage static website. Server islands on cached pages or rolling deploys require a stable secret `ASTRO_KEY` shared by build and runtime environments; never commit it, expose it as `PUBLIC_*`, or bake it into static output. Shared CDN caching is only for anonymous, public-equivalent HTML; auth-dependent or personalized responses must use `private`/`no-store` or a deliberate `Vary: Cookie`/`Authorization` strategy, and `ASTRO_KEY` is not a cache privacy boundary.

SEO-critical content must be present in the initial HTML: titles, descriptions, canonical URLs, social preview tags, product/category names, indexable descriptions, and public prices when snippets need them. Client islands and server islands may enhance the page, but they must not be the only source of SEO-critical content. `website` does not own the full auth flow and should not duplicate the CSR client from `webapp`; auth in `website` is limited to public-site needs such as a logged-in header state or lightweight actions. If the website starts reading API data or shared DTOs, connect `@web-app-demo/contracts` and validate producer/consumer sides the same way as `webapp` and `mobile`.

Astro remains the default website stack because it is content-first, static-first, low-JS by default, and gives agents a clear SEO surface. Choose Next.js only when a project intentionally wants a Vercel-optimized ISR/cache platform. Treat TanStack Start as an optional future React full-stack path for teams that want one React app with selective SSR, not as the baseline for non-programmer vibe-coding projects.

## Testing

Backend unit/integration tests verify auth, billing, and notifications behavior at their owning layers. Webapp E2E uses Playwright and starts a real backend + Vite through `webServer`. Mobile E2E uses Maestro and stable React Native `testID` selectors.

Client E2E in this template is a happy-path smoke layer, not the place for large validation matrices. Keep negative payloads, password/JWT/session rules, and error-shape checks in backend tests. Add fast client-level tests for form validation and API state edge cases when those surfaces grow.

Run `bun run architecture:check` as part of every validation ladder. The dependency-free checker reports forbidden static imports as `path:line`, has fixture tests for each rule family, and runs in CI. File length is deliberately not an architecture rule; ownership and dependency direction are.

## Prisma

Do not hand-write Prisma migration SQL. Change `backend/prisma/schema.prisma`, then use:

```bash
bun run --cwd backend prisma:migrate
```

The template uses database-generated UUIDv7 primary keys (`@default(dbgenerated("uuidv7()")) @db.Uuid`) instead of ORM-generated `cuid()`/`uuid()`. That keeps ID generation consistent for Prisma Client, direct SQL, imports, and any future background workers or non-Prisma writers, but it also means the schema requires PostgreSQL 18+.

Treat UUIDv7 as a repository-level rule, not a one-off model detail. New primary keys should use database-generated UUIDv7, and foreign keys that reference those IDs should use `@db.Uuid` so the type stays native all the way through PostgreSQL and Prisma.

For production, apply already-created migrations:

```bash
bun run --cwd backend prisma:deploy
```

## Local Infrastructure

Local PostgreSQL is provided by Docker Compose, not by a native database install. The development service uses `postgres:18-alpine`, exposes `web_app_demo` on host port `54329`, and stores data in the `postgres_18_data` volume. The test service uses the same image with database `web_app_demo_test`; automated runners set `POSTGRES_TEST_PORT` to a repository-derived port when they need isolation. PostgreSQL 18 is intentional here because the backend schema relies on the native `uuidv7()` database function.

Keep `docker-compose.yml`, `backend/.env.example`, `.env.example`, and [LOCAL_DATABASE.md](LOCAL_DATABASE.md) aligned when changing local database names, ports, credentials, image tags, or volume paths.

## Storage

Persistent files and media belong in DigitalOcean Spaces, not in the App Platform container filesystem. The backend owns storage access through `src/storage`, including safe object keys, presigned uploads/downloads, public CDN URL construction, and object deletion. Product features that use uploads should store ownership and retention metadata in PostgreSQL when permissions, deletion, audit, or private access matter.

For image optimization, generate app-owned variants in the backend, a worker, or a dedicated App Platform service, then store those variants in Spaces and serve public variants through Spaces CDN. DigitalOcean Spaces and Spaces CDN do not provide first-party dynamic image resizing or format transformation.

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
- [Expo docs](https://docs.expo.dev/)
- [Expo Router docs](https://docs.expo.dev/router/introduction/)
