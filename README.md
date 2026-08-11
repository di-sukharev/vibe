# Vibe Coding Template

<p align="center">
  <img src="docs/assets/vibe_tmpl_schema.png" alt="Vibe Coding Template architecture schema" width="100%">
</p>

A full-stack starter for web and mobile products: one repository with a Bun/Hono backend, a React CSR browser client (`webapp`), an Astro SSG/SSR site (`website`), an Expo mobile app, and shared API contracts. The goal is to give agents and developers clear architectural boundaries so new features keep following the same shape.

## Agent Intake Checklist Before Installing

[CHECKLIST.md](CHECKLIST.md) is the intake questionnaire and the durable record of what the project needs. Ask its questions in the user's language and in product terms, then write the answers into that file. Do not start feature work until everything through its *First-version capabilities* section and every conditional section activated by those answers is filled in, and keep its *Capability ledger* current whenever a capability is added or removed.

One question comes before cloning, because it selects the branch: whether a mobile app is needed now. The rest of the intake runs in the fresh checkout, where the checklist can be filled in.

- Do not hand the user the choices listed under *Decided by the agent* in `CHECKLIST.md`. Those are the agent's to make and explain, including the `webapp` vs `website` split described under "Choosing `webapp` vs `website`".
- If `mobile` is active, clone the full repository, switch to `mobile`, fetch both refs, install the locked dependencies, and run `bun run mobile:template:check -- --published` before first-run setup. Stop if the command is missing or fails: the template maintainer must synchronize `master` into the mobile-ready line while preserving its runtime and template capability ledger.
- If backend/API, full-stack, uploads, or database-backed validation is active, verify Docker Compose and the Docker daemon before local setup.
- For DigitalOcean deployment, verify App Platform GitHub integration first, then generate specs with `bun run deploy:do:specs`; never hand-substitute secrets or URLs into app specs.
- Hosting is decided once from the audience recorded in [CHECKLIST.md](CHECKLIST.md): Russia or data residency means Yandex Cloud ([docs/YANDEX_CLOUD.md](docs/YANDEX_CLOUD.md)), anything else means DigitalOcean, and an explicit wish for full control means an own server. Delete the other paths' tooling during setup rather than leaving two infrastructures in the repository: follow the "If You Chose Another Hosting" list in each document you did not pick, which for an own server means both.

## Agent Repo Download Instructions

When installing this repository from a GitHub URL into a fresh Codex or agent session, treat setup as an onboarding task before feature work. This README is the source of truth for first-run setup because fresh installers may not read `AGENTS.md`.

Give the agent this initial prompt:

```text
Install this repository into the project. Before cloning from a GitHub URL, ask whether I plan to develop a mobile app now. If yes, clone the full repository with `git clone <repo-url>`, switch to `mobile`, run `git fetch origin`, install dependencies with `bun install --frozen-lockfile`, and then run `bun run mobile:template:check -- --published` before first-run setup; that local template gate must prove the clean, pushed mobile-ready line contains current `origin/master`, the shared agent/payment contract, the Expo/IAP runtime, and its branch-specific `available` capabilities. If the command is missing or fails, stop: do not resolve template-branch conflicts inside the new product checkout; ask the template maintainer to synchronize and publish the mobile line first. If mobile is deferred, use the default branch; it intentionally contains only `mobile/README.md` as a pointer to the mobile template branch. First read README.md, CHECKLIST.md, CLAUDE.md if present, and relevant docs/*.md, including docs/LOCAL_DATABASE.md when backend/API or full-stack work is active, docs/STORAGE.md when uploads, files, images, or media are active, docs/WEB_SURFACES.md before website data, catalog, cart, checkout, order, entitlement, subscription, or payment work, and the hosting document that matches the choice recorded in CHECKLIST.md. Before setup, work through CHECKLIST.md: ask me its questions in my language and in product terms, then record my answers in that file and keep its capability ledger current; do not start feature work until everything through its First-version capabilities section and every conditional section activated by those answers is filled in, and do not ask me anything it lists under Decided by the agent. If mobile is active, follow that branch's README for Expo/EAS, Maestro, IAP, push, and social auth setup only after the template check passes. Prefer the monolithic backend in this repository; do not introduce microservices during setup. If real-time features later need horizontal scaling across multiple backend instances, use managed Redis-compatible Pub/Sub such as DigitalOcean Managed Valkey or Yandex Managed Service for Valkey to fan out events between WebSocket connections. If deployment is needed, ask where my users are and whether the data must stay in Russia, then pick the hosting yourself from that answer and record it in CHECKLIST.md: Russia or data residency means Yandex Cloud, anything else means DigitalOcean App Platform with Managed PostgreSQL and Spaces, and an explicit wish for full control means my own server. Do not ask me to compare cloud providers. Delete the tooling of the paths I did not choose, following the removal list in the hosting document. For DigitalOcean deployment, first verify that App Platform is connected to my GitHub account/organization and has access to the full monorepo branch, then generate concrete specs with `bun run deploy:do:specs` into `.scratch/deploy`; do not use manual `sed`, `perl`, or shell substitution for secrets, CORS origins, `VITE_API_URL`, or `PUBLIC_WEBAPP_URL`. On the Yandex path, use Yandex Serverless Containers, Yandex Managed Service for PostgreSQL, Yandex Object Storage, and Yandex Cloud CDN according to docs/YANDEX_CLOUD.md. If backend/API, full-stack, uploads, or any database-backed validation is active, verify Docker Compose with `docker compose version` and the Docker daemon with `docker info`; if Docker is missing or not running, explain how to install/start it for my OS before continuing. Treat this checkout as a new project by default, not as a pull request back to the template: detach the original template remote unless I explicitly say I am contributing to the template, and add my own GitHub remote only if I provide one or ask you to create/publish it. Rename package.json and other repository-specific identifiers to the chosen project name where applicable. After first-run setup is complete, delete the marked Bootstrap-Only Instructions blocks from AGENTS.md and CLAUDE.md. Use Docker Compose for local PostgreSQL on Windows, macOS, and Linux; do not require native PostgreSQL or cloud credentials for local development.

```

- First read `README.md`, [CHECKLIST.md](CHECKLIST.md), `CLAUDE.md` if present, and relevant `docs/*.md`, including [docs/WEB_SURFACES.md](docs/WEB_SURFACES.md) before website data, catalog, cart, checkout, order, entitlement, subscription, or payment work; then inspect package scripts and each active surface's app-local `.env.example` before running setup commands.
- Inspect `git remote -v` before any branch, commit, push, or PR workflow. If `origin` points to the template repository and the user has not explicitly said they are contributing to the template, treat this as a new project and detach from the template remote with `git remote remove origin`.
- If the user provides their own GitHub repository URL or asks to publish the new project, add that URL as the new `origin` after the template remote is removed. If the user has not chosen a destination yet, leave the repository with no `origin` and report that publishing is not configured.
- Do not open pull requests against the template repository during first-run project setup. Ask only if the user explicitly says this checkout is for improving the template itself.
- Run the intake from [CHECKLIST.md](CHECKLIST.md) in the user's language before making product or deployment choices, and record the answers in that file rather than only in the conversation.
- Rename the template deliberately rather than with an unreviewed global replacement. Use `rg -n "web_app_demo|web-app-demo|vibecoding-template"` to inventory package scopes, database names, cookie names, Docker/Compose isolation names, deploy image defaults, and architecture-check aliases; update each owning source, regenerate `bun.lock` with the repository's pinned Bun version, then run install, typecheck, architecture checks, backend integration, and web E2E for the active surfaces.
- After the user answers, record durable project choices in [CHECKLIST.md](CHECKLIST.md) before feature work: project name/slug, active and deferred surfaces, first-version capabilities, the capability ledger, and what deployment/release work is in or out of scope. Expand the relevant README sections when a choice needs more explanation than the checklist row holds. Once setup is complete, remove the marked `Bootstrap-Only Instructions` blocks from `AGENTS.md` and `CLAUDE.md`.
- If only the webapp is active, keep mobile intact but deferred: do not run Expo/EAS/Maestro setup, do not add mobile features, and add or update a short deferred-surface note in `mobile/README.md`. When the user later asks for mobile, remove or rewrite that note, then set up and validate mobile normally.
- If only the mobile app is active, keep webapp and website intact but deferred: do not add browser-only features or Playwright flows unless they support the active mobile/backend work, and add or update a short deferred-surface note in `webapp/README.md` or `website/README.md` as relevant. When the user later asks for webapp, remove or rewrite that note, then set up and validate webapp normally.
- Keep template-level Expo/EAS config universal. Do not commit an `expo.owner` or `extra.eas.projectId` to the template. In an installed project, write `expo.owner` and run EAS project init only after the user selects the real Expo personal account or organization that should own the app.
- Expo Push foundation is included but intentionally inert until an installed project has EAS `extra.eas.projectId`; push also stays disabled on web, `EXPO_PUBLIC_E2E=1`, or `EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=1`. When push is active, configure APNs/FCM in Expo/EAS, keep credential files and service-account secrets out of git, set backend `EXPO_PUSH_ACCESS_TOKEN` only when Expo Push Security is enabled, run `bun run --cwd backend start:worker:notifications` or `bun run --cwd backend start:cron -- notifications:process`, and verify from a logged-in physical device with an installed development or production build by temporarily setting `ENABLE_TEST_PUSH=true` and calling authenticated `POST /api/notifications/test-push`. The route queues only and is disabled by default.
- When mobile Maestro E2E is active, use an installed Expo development build, not Expo Go. Start the backend and Metro on host-reachable LAN URLs, set `EXPO_PUBLIC_E2E=1` only for E2E bundles, pass `MAESTRO_DEV_SERVER_URL`, keep backend/Metro/test-data preflight checks ahead of UI actions, and run `bun run --cwd mobile e2e:maestro:audit` after flow or runner changes.
- Prefer README-level deferred-surface notes over source-code comments. Add code comments only when a dormant code path would otherwise mislead future work.
- Default to local-only setup when the user does not need deployment yet. Local development must not require DigitalOcean credentials.
- Use [docs/LOCAL_DATABASE.md](docs/LOCAL_DATABASE.md) and `docker-compose.yml` as the local PostgreSQL source of truth. The default local database path is Docker Compose, not a native PostgreSQL install.
- If deployment is requested, use DigitalOcean App Platform as the supported production path. Use DigitalOcean Managed PostgreSQL for production databases; do not use App Platform dev databases for production.
- For the default DigitalOcean production backend/API service, start with one `apps-s-1vcpu-1gb` App Platform container (`instance_count: 1`) plus the smallest DigitalOcean Managed PostgreSQL production cluster. This keeps the initial backend and database infrastructure around $27/month before taxes, traffic overages, storage, and optional add-ons. `webapp` and fully prerendered `website` output are Static Sites and do not need runtime container sizing. A `website` route with SSR/on-demand rendering or server islands needs a runtime service.
- Deploy `webapp` and fully prerendered `website` output as DigitalOcean App Platform Static Sites, not App Platform services. They do not get `instance_size_slug` or `instance_count`; static site assets are served through DigitalOcean's global CDN by default. Use an external CDN only when the product needs advanced controls such as bot filtering, custom rate limiting, or geographic traffic rules.
- For DigitalOcean app specs, use committed `.do/*.yaml.example` templates plus `bun run deploy:do:specs`; generated specs stay in `.scratch/deploy` and must fail on empty values or unresolved placeholders before `doctl apps create`. Concrete App Platform machine defaults live in `scripts/prepare-do-specs.mjs`; update that script and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) together when changing infrastructure tiers.
- Before deployment or cloud-resource updates, verify `git remote -v` and `git status --short --branch`. Deploy only from the intended pushed release branch with a clean worktree; if local changes, untracked files, or branch sync issues are present, stop instead of cleaning, stashing, resetting, or checking out over another session's work.
- Use DigitalOcean Spaces Standard Storage, or any S3-compatible bucket, for persistent files and uploads. Do not store uploads on the App Platform container filesystem: the backend refuses the filesystem storage driver in production for exactly that reason.
- If [CHECKLIST.md](CHECKLIST.md) records Yandex Cloud, use [docs/YANDEX_CLOUD.md](docs/YANDEX_CLOUD.md) instead: Serverless Containers for backend/API, Managed Service for PostgreSQL for production data, Object Storage for files/static sites, and Cloud CDN for public static/media delivery.
- Explain manual prerequisites only for the active release path: DigitalOcean account, billing/project setup, `doctl auth init`, registry access when using DigitalOcean Container Registry, DigitalOcean Managed PostgreSQL, production domains/DNS, and Expo/EAS/App Store/Google Play accounts when mobile release work is requested.
- The agent may create uncommitted app-local `.env` files from their matching `.env.example` files and generate a local-only `JWT_SECRET`; never commit secrets or print raw secrets in the final report.
- After setup, run the smallest meaningful validation for the chosen active surfaces and report local URLs, commands run, and anything the user still needs to authorize manually.

## What's Inside

- `backend` - Bun + Hono + Prisma + PostgreSQL, custom JWT auth, Zod validation, and OpenAPI output.
- `webapp` - React + Vite + TanStack Query/Form/Router CSR browser client with the baseline auth flow.
- `website` - a separate Astro project for public SSG/SSR pages (landing, content sites, marketplace).
- `mobile` - Expo + React Native + Expo Router + TanStack Query/Form with SecureStore-backed auth.
- `packages/contracts` - shared Zod schemas and TypeScript API types.
- `CHECKLIST.md` - the install intake questionnaire and the durable record of what this project needs, including which capabilities were deliberately removed.
- `.do` - committed DigitalOcean App Platform spec templates; generate concrete specs into `.scratch/deploy` with `bun run deploy:do:specs`.
- `docker-compose.yml` - local PostgreSQL 18 through the official `postgres:18-alpine` image on port `54329`; test runners use a repository-derived port by default, or `POSTGRES_TEST_PORT` when set. PostgreSQL 18 is intentional because the backend schema uses strict database-generated UUIDv7 IDs.
- `docs/BACKGROUND_JOBS.md` - the three ways to work off the request path, the durable task outbox, and how to run them.
- `docs/TESTING.md` - the backend, Playwright, and Maestro testing contract.
- `docs/LOCAL_DATABASE.md` - cross-platform local PostgreSQL setup for Windows, macOS, and Linux.
- `docs/EMAIL.md` - transactional email: the four drivers, Postbox and Resend, and how delivery reaches the outbox.
- `docs/STORAGE.md` - private file storage: the filesystem and S3 drivers, the local S3 container, and the upload contract.
- `docs/SOCIAL_AUTH.md` - Apple and Google social auth setup for the Expo mobile app.
- `docs/IAP.md` - App Store and Google Play subscriptions: how the implementation works, and how to switch it on (it ships off) or delete it.
- `docs/WEB_SURFACES.md` - the mandatory ownership contract for SSG product data, rebuilds, browser cart/checkout, and separate mobile payment paths.

- `docs/YANDEX_CLOUD.md` - the Yandex Cloud hosting path, chosen when users or data must stay in Russia.

## Choosing `webapp` vs `website`

This template ships two browser surfaces. Putting a feature in the wrong one is the most common early mistake, so the installing agent must pick deliberately and explain the choice in product terms the user understands.

- Build it in **`website`** (Astro, static by default, SSR/hybrid only when needed) when pages must be **public and found by search engines or shared with rich link previews**: marketing/landing pages, content sites, blogs, docs, and the public storefront of a **marketplace**. For a marketplace, this usually means the landing page, category/search landing pages, public listing/product pages, SEO metadata, and rich previews.
- Build it in **`webapp`** (React, client-side rendered) when screens live **behind sign-in and do not need SEO**: login-adjacent app flows after redirect, buyer account, seller/admin panels, checkout/account workflows, dashboards, settings, and authenticated tools. No crawler needs these, so CSR is the simpler, cheaper choice.

Rule of thumb for the agent: *if a page must rank in search or preview nicely when shared, it belongs in `website`; if it is only reachable after login, it belongs in `webapp`.* Real marketplaces normally use **both**: the public catalog lives in `website`, the authenticated app lives in `webapp`, and both reuse the same `@web-app-demo/contracts` schemas. Do not rebuild SEO pages inside `webapp` to "keep everything in one app"; that loses the SEO the product needs. Do not move the full authenticated app into Astro just because the product has public SEO pages.

For product data, carts, checkout, orders, subscriptions, entitlements, or payments, [docs/WEB_SURFACES.md](docs/WEB_SURFACES.md) is mandatory reading. Browser purchases have one path: `website` may hold an anonymous local selection, but checkout and payment belong to the authenticated `webapp`, with the backend as authority. Mobile owns separate native payment experiences: the `mobile` branch already carries switched-off App Store/Google Play subscription paths and may add policy-compliant card, Apple Pay, or Google Pay flows when the product needs them.

Astro stays the default website stack for this template because it is content-first, static-first, ships little JavaScript by default, and gives agents a clear SEO surface. Choose Next.js only when the project intentionally wants a Vercel-optimized ISR/cache platform as a core product requirement. Treat TanStack Start as an optional future React full-stack path for teams that want one React app with selective SSR; it is not the simple default for non-programmer vibe-coding projects.

## Quick Start

Install dependencies first:

```bash
bun install
```

If backend/API, full-stack, or other database-backed work is active, check Docker first. Docker is the local app that runs PostgreSQL for this template:

```bash
docker compose version
docker info
```

If either command fails, install and start Docker before continuing:

- Windows: install Docker Desktop, enable the WSL 2 backend, start Docker Desktop, then rerun `docker compose version` and `docker info`.
- macOS: install and start Docker Desktop, or another Docker Engine with Compose v2, then rerun `docker compose version` and `docker info`.
- Linux: install Docker Engine and the Docker Compose plugin, start the Docker service, then rerun `docker compose version` and `docker info`.

Do not switch new users to native PostgreSQL during local setup. The repository's documented local path is Docker Compose for backend/API work.

### Backend/API Or Full-Stack

Only run this block when backend/API, full-stack, or DB-backed validation is active.

Create the backend env file:

```bash
# macOS, Linux, or Git Bash on Windows
cp backend/.env.example backend/.env
```

```powershell
# Windows PowerShell
Copy-Item backend/.env.example backend/.env
```

Then start PostgreSQL with that app-local env file:

```bash
docker compose --env-file backend/.env pull postgres
docker compose --env-file backend/.env up -d postgres
```

Then apply migrations:

```bash
bun run --cwd backend prisma:deploy
```

Create login-ready local administrator and user accounts from the
`DEV_SEED_ADMIN_*` and `DEV_SEED_USER_*` values in `backend/.env`:

```bash
bun run dev:seed
```

Use these public local demo accounts to inspect both application roles:

| Role | Email | Password | Landing page |
| --- | --- | --- | --- |
| Administrator | `admin@example.com` | `local-admin-password` | `/admin` |
| User | `user@example.com` | `local-user-password` | `/app` |

The command is idempotent, rejects `NODE_ENV=production`, and accepts only a
loopback PostgreSQL URL. It grants no subscription entitlement: signing in never
depends on billing. Mobile has no administrator UI. Deployment uses
`db:deploy` and the separate `ADMIN_SEED_*` production bootstrap variables; it
never runs this development seed. The values committed in `.env.example` are
public local defaults, so do not reuse them in a deployed environment.

### Run The Active Surfaces

Start only the app surfaces you need in separate terminals:

```bash
bun run dev:backend
bun run dev:webapp
bun run dev:website
bun run dev:mobile
```

#### Local Web Origin And Auth Startup

The included `webapp` is a full-stack browser client, not a standalone static
site. Its register, login, and session bootstrap flows require PostgreSQL and the
backend. Start the database, apply migrations, and run `dev:backend` before
opening the webapp. Website-only setups can skip backend/PostgreSQL; a webapp-only
project can skip them only after replacing or removing the included auth golden
path.

Use the same browser origin that appears in `backend/.env` under
`CORS_ORIGINS`. Origins are matched exactly: `http://localhost:5173` and
`http://127.0.0.1:5173` are different origins. If Vite is started with
`--host 127.0.0.1`, add `http://127.0.0.1:5173` to `CORS_ORIGINS` and restart the
backend. Otherwise the page can render while the initial `/api/auth/refresh`
request fails with `CORS Missing Allow Origin` and the UI reports that the
session check is temporarily unavailable.

When multiple copies of this repository exist locally, run both development
commands from the intended copy. A server left running from another copy can
keep ports `3000` or `5173` occupied and make the browser use that copy's code
or environment configuration.

Create `webapp/.env` when the browser client should use a non-default API URL:

```bash
VITE_API_URL=http://localhost:3000
```

Create `mobile/.env` for Expo:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME=
EXPO_PUBLIC_IAP_IOS_MONTHLY_PRODUCT_ID=com.example.app.premium.monthly
EXPO_PUBLIC_IAP_IOS_YEARLY_PRODUCT_ID=com.example.app.premium.yearly
EXPO_PUBLIC_IAP_ANDROID_PACKAGE_NAME=com.example.app
EXPO_PUBLIC_IAP_ANDROID_MONTHLY_PRODUCT_ID=com.example.app.premium
EXPO_PUBLIC_IAP_ANDROID_MONTHLY_BASE_PLAN_ID=monthly
EXPO_PUBLIC_IAP_ANDROID_YEARLY_PRODUCT_ID=com.example.app.premium
EXPO_PUBLIC_IAP_ANDROID_YEARLY_BASE_PLAN_ID=yearly
```

Android emulators usually need `http://10.0.2.2:3000` instead of `localhost`.

Mobile Maestro E2E should use a LAN-reachable `EXPO_PUBLIC_API_URL`, a host-reachable `MAESTRO_DEV_SERVER_URL`, and `EXPO_PUBLIC_E2E=1` only for the E2E Metro session. See [docs/TESTING.md](docs/TESTING.md) before adding or running mobile flows.

Test runners use the separate Docker Compose `postgres_test` service and the `TEST_DATABASE_URL` shape from `backend/.env.example`. Webapp Playwright E2E starts `postgres_test`, applies migrations to `web_app_demo_test`, runs the browser flow, and tears down its test database volume by default.

## Workspace Commands

- `bun run dev` - start all workspace projects in parallel dev mode.
- `bun run dev:backend` - start the backend API.
- `bun run dev:webapp` - start the Vite CSR webapp.
- `bun run dev:website` - start the Astro website project.
- `bun run dev:mobile` - start the Expo app.
- `bun run dev:backend:s3` - start the backend against the local S3 container instead of the disk.
- `bun run typecheck` - run TypeScript checks across workspaces.
- `bun run lint` - run ESLint over the webapp and the mobile app.
- `bun run architecture:check` - enforce the module/feature dependency boundaries.
- `bun run build` - run production build/typecheck/export scripts for workspaces that define them.
- `bun run architecture:check` - enforce backend module and client feature dependency boundaries.
- `bun audit` - list known vulnerabilities. It reports none today, and the `overrides` block in the
  root `package.json` is why: every entry there is a minimum version that closes an advisory in a
  transitive dependency nothing here imports directly. Treat that block as maintenance, not
  configuration - after a dependency update, drop the floors one at a time and re-run `bun audit`;
  the ones that stay quiet are no longer needed. `bun update` still moves everything within them.
  On this branch two advisories stay open: `image-size` reaches the Expo and React Native build
  tooling, and every published version including the newest is affected, so there is no floor to
  set. It is a denial of service in the ICNS/JXL/HEIF parsers that read image dimensions during a
  bundle, so it costs a developer's build, not the shipped app. Re-check after an Expo SDK bump.
- `bun run test` - run contract, backend, webapp, and mobile unit/integration tests.
- `bun run test:contracts` - run shared Zod contract tests.
- `bun run test:backend` - run backend unit and integration tests.
- `bun run test:backend:integration` - run DB-backed auth, billing, and notifications tests through `postgres_test`.
- `bun run test:webapp` - run webapp client tests.
- `bun run test:mobile` - run mobile client tests.
- `bun run test:storage:s3` - run the storage contract against a real local S3 server (needs Docker).
- `bun run --cwd backend start:cron -- <job>` - run one background job once, for example `outbox:drain`; see [docs/BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md).
- `bun run --cwd backend start:scheduler` - run the in-repo scheduler process (ships with the outbox drain every minute; `bun run dev` starts it too).
- `bun run --cwd backend start:worker` - run the loop worker process (empty until you add loops).
- `bun run --cwd backend start:worker:notifications` - run the Expo push outbox/receipt worker.
- `bun run deploy:do:specs` - safely generate concrete DigitalOcean specs under `.scratch/deploy`.
- `bun run e2e:webapp` - run the Playwright journeys through backend + Vite.
- `bun run e2e:webapp:s3` - run the same journeys against the local S3 container.
- `bun run storage:local:start|status|stop|env` - manage the optional local S3 container; `stop` keeps its volume.
- `bun run e2e:mobile` - run the Maestro auth smoke test against an installed Expo development build and host-reachable Metro URL.
- `bun run --cwd mobile e2e:maestro:audit` - check the mobile Maestro flow and runner inputs for known flaky patterns.
- `bun run --cwd backend prisma:migrate` - create/apply a Prisma migration in development.
- `bun run --cwd backend prisma:deploy` - apply existing Prisma migrations on a server.
- `bun run dev:seed` - idempotently create the local demo accounts.
- `bun run --cwd backend db:deploy` - production pre-deploy: migrate, optionally bootstrap the first administrator, and require a login-capable administrator.

## Project READMEs

- [backend/README.md](backend/README.md) - API, auth, Prisma, and backend validation.
- [docs/LOCAL_DATABASE.md](docs/LOCAL_DATABASE.md) - Docker Compose PostgreSQL setup and reset workflow.
- [docs/EMAIL.md](docs/EMAIL.md) - transactional email: the four drivers, Postbox and Resend, and how delivery reaches the outbox.
- [docs/STORAGE.md](docs/STORAGE.md) - private file storage: the filesystem and S3 drivers, the local S3 container, and the upload contract.
- [docs/SOCIAL_AUTH.md](docs/SOCIAL_AUTH.md) - Apple and Google mobile social auth setup.
- [docs/IAP.md](docs/IAP.md) - App Store and Google Play subscription setup and troubleshooting.
- [docs/BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md) - jobs and the processes that run them.
- [docs/WEB_SURFACES.md](docs/WEB_SURFACES.md) - SSG product data, rebuilds, browser cart/checkout ownership, and mobile payment boundaries.

- [docs/YANDEX_CLOUD.md](docs/YANDEX_CLOUD.md) - the Yandex Cloud hosting path, used when the checklist records it.
- [webapp/README.md](webapp/README.md) - CSR browser client setup, env, and Playwright smoke.
- [mobile/README.md](mobile/README.md) - Expo setup, push notifications, development builds, and Maestro smoke.
- [website/README.md](website/README.md) - Astro website commands, hybrid rendering, and publishing model.
- [packages/contracts/README.md](packages/contracts/README.md) - shared schema and DTO rules.

## License

This project is licensed under the Apache License 2.0. If you distribute a fork, copy, or derivative work, keep both [LICENSE](LICENSE) and [NOTICE](NOTICE) with the attribution to Dima Sukharev, GitHub profile, and the original repository.

## Architecture Notes

API contracts live in `packages/contracts` and are imported by every active layer. The backend validates input with those Zod schemas; the webapp and mobile app reuse the same schemas in TanStack Form and API clients. `UserDto.role` is the shared `user | admin` role contract; authorization still uses the current database record rather than a role embedded in JWT claims.

The backend follows the Product Modules flow `transport -> application -> domain/ports -> infrastructure`. Routes own HTTP representation, application services own use cases and orchestration, optional domain code owns pure policies and transitions, and context-specific infrastructure owns Prisma and provider SDKs. Cross-context imports go only through each module's public `index.ts`; API, worker, and cron entrypoints share `src/runtime.ts` for env and Prisma lifecycle.

Keep the default architecture monolithic. For DigitalOcean production, the backend/API default is one `apps-s-1vcpu-1gb` App Platform container so a new project starts inside the expected low-cost budget with Managed PostgreSQL while retaining a clear scale-up path. Add backend worker or scheduled-job components from the same Docker image only when a concrete background job exists; the scheduler ships with the outbox drain and is deployable as-is. For real-time features, a single backend instance can own its local WebSocket connections. If the backend is horizontally scaled and users connected to different instances must receive the same chat, presence, or live events, add a managed Redis-compatible Pub/Sub broker between instances, using DigitalOcean Managed Valkey or Yandex Managed Service for Valkey, whichever hosting the checklist records.

Ongoing engineering guidance lives in [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TESTING.md](docs/TESTING.md), and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). First-run download and product setup instructions live in this README.

## Current Upstream Documentation

For framework, API, deployment, or testing questions, consult the current upstream documentation linked here first. The repository docs describe this template's conventions; the linked docs are the authoritative source for tool behavior and provider-specific changes.

- Runtime and package manager: [Bun docs](https://bun.sh/docs)
- Backend framework: [Hono docs](https://hono.dev/docs)
- Database ORM: [Prisma docs](https://www.prisma.io/docs) and [PostgreSQL docs](https://www.postgresql.org/docs/)
- Validation and contracts: [Zod docs](https://zod.dev/)
- JWT library: [jose documentation](https://github.com/panva/jose)
- Web stack: [React docs](https://react.dev/reference/react), [Vite guide](https://vite.dev/guide/), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview), [TanStack Form](https://tanstack.com/form/latest/docs/framework/react/quick-start), and [TanStack Router](https://tanstack.com/router/latest/docs/overview)
- Testing: [Playwright docs](https://playwright.dev/docs/intro) and [Maestro docs](https://docs.maestro.dev/)
- Mobile: [Expo docs](https://docs.expo.dev/), [Expo Router docs](https://docs.expo.dev/router/introduction/), [EAS Build docs](https://docs.expo.dev/build/introduction/), [Expo Push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Expo Push sending API](https://docs.expo.dev/push-notifications/sending-notifications/), and [React Native docs](https://reactnative.dev/docs/getting-started)
- Website: [Astro docs](https://docs.astro.build/en/getting-started/)
- Local infrastructure: [Docker Compose docs](https://docs.docker.com/compose/) and [PostgreSQL Docker Official Image](https://hub.docker.com/_/postgres)
- Deployment and storage: [DigitalOcean App Platform](https://docs.digitalocean.com/products/app-platform/), [DigitalOcean App specs](https://docs.digitalocean.com/products/app-platform/reference/app-spec/), [DigitalOcean Static Sites](https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/), [DigitalOcean Managed Databases in App Platform](https://docs.digitalocean.com/products/app-platform/how-to/manage-databases/), [DigitalOcean Valkey](https://docs.digitalocean.com/products/databases/valkey/), [DigitalOcean Dockerfile builds](https://docs.digitalocean.com/products/app-platform/reference/dockerfile/), [DigitalOcean Bun buildpack](https://docs.digitalocean.com/products/app-platform/reference/buildpacks/bun/), [doctl](https://docs.digitalocean.com/reference/doctl/), [doctl apps spec validate](https://docs.digitalocean.com/reference/doctl/reference/apps/spec/validate/), [DigitalOcean Container Registry](https://docs.digitalocean.com/products/container-registry/), [DigitalOcean Spaces](https://docs.digitalocean.com/products/spaces/), [DigitalOcean Spaces CDN](https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/), and [external CDN in front of App Platform](https://docs.digitalocean.com/products/app-platform/how-to/configure-external-cdn/)
- Yandex Cloud path: [Yandex Cloud CLI](https://yandex.cloud/en/docs/cli/quickstart), [Yandex Serverless Containers](https://yandex.cloud/en/docs/serverless-containers/), [Yandex Container Registry](https://yandex.cloud/en/docs/container-registry/quickstart), [Yandex Managed PostgreSQL](https://yandex.cloud/en/docs/managed-postgresql/), [Yandex Managed Service for Valkey](https://yandex.cloud/en/docs/managed-redis/), [Yandex Object Storage static hosting](https://yandex.cloud/en/docs/storage/operations/hosting/setup), [Yandex Object Storage AWS CLI](https://yandex.cloud/en/docs/storage/tools/aws-cli), [Yandex Cloud CDN](https://yandex.cloud/en/docs/cdn/concepts/), and [Yandex Cloud Marketplace Image Resizer](https://yandex.cloud/en/marketplace/products/yc/image-resizer)
