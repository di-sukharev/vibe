# Vibe Coding Template

<p align="center">
  <img src="docs/assets/vibe_tmpl_schema.png" alt="Vibe Coding Template architecture schema" width="100%">
</p>

A full-stack starter for web and mobile products: one repository with a Bun/Hono backend, a React CSR browser client (`webapp`), an Astro SSG/SSR site (`website`), an Expo mobile app, and shared API contracts. This `mobile` branch is the default branch plus the native application and its optional IAP, push, and social-auth capabilities.

## Agent Intake Checklist Before Installing

[CHECKLIST.md](CHECKLIST.md) is the intake questionnaire and the durable record of what the project needs. Ask its questions in the user's language and in product terms, then write the answers into that file. Do not start feature work until everything through its _First-version capabilities_ section and every conditional section activated by those answers is filled in, and keep its _Capability ledger_ current whenever a capability is added or removed.

One question comes before cloning, because it selects the branch: whether a mobile app is needed now. The rest of the intake runs in the fresh checkout, where the checklist can be filled in.

- Do not hand the user the choices listed under _Decided by the agent_ in `CHECKLIST.md`. Those are the agent's to make and explain, including the `webapp` vs `website` split described under "Choosing `webapp` vs `website`".
- If `mobile` is active, clone the full repository, switch to `mobile`, fetch both refs, install the locked dependencies, and run `bun run mobile:template:check -- --published` before first-run setup. Stop if the command is missing or fails: the template maintainer must synchronize `master` into the mobile-ready line while preserving its runtime and template capability ledger.
- If backend/API, full-stack, uploads, or database-backed validation is active, verify Docker Compose and the Docker daemon before local setup.
- Production infrastructure is Terraform under [`infra/`](infra/README.md); create state once with `bun run infra:bootstrap -- <provider> --new`, apply deliberate foundation changes with `bun run infra:apply -- <provider>`, inspect with `bun run infra:plan -- <provider>`, and deploy release-owned surfaces with `bun run release -- <provider>`.
- Hosting is decided once from the audience recorded in [CHECKLIST.md](CHECKLIST.md): Russia or data residency means Yandex Cloud ([docs/YANDEX_CLOUD.md](docs/YANDEX_CLOUD.md)), anything else means DigitalOcean ([docs/DIGITALOCEAN.md](docs/DIGITALOCEAN.md)), and an explicit wish for full control means an own server. In an installed project, delete the unused provider directory and runbook rather than keeping two possible production states.

## Agent Repo Download Instructions

When installing this repository from a GitHub URL into a fresh Codex or agent session, treat setup as an onboarding task before feature work. This README is the source of truth for first-run setup because fresh installers may not read `AGENTS.md`.

Give the agent this initial prompt:

```text
Install this repository into the project. Before cloning, ask whether I need the mobile app now;
use the mobile branch only when I do, and run its published-template gate before setup. Read
README.md, CHECKLIST.md, CLAUDE.md, and the docs for every active surface. Run the CHECKLIST
intake in my language and record every durable answer before feature work.

Treat this as a new project unless I explicitly say I am contributing to the template: inspect
git remotes, detach the template remote, and add my repository only when I provide or request one.
Use Docker Compose for local PostgreSQL and do not require cloud credentials for local work.

If deployment is requested, ask where users are and whether data must stay in Russia. Choose
Yandex Cloud for Russia/data residency, DigitalOcean otherwise, or an own server only when I ask
for full control; record the result rather than asking me to compare providers. Keep the matching
Terraform stack and delete the unused provider directory/runbook. Copy its bootstrap and
production terraform.tfvars.example files, fill project values, keep secrets uncommitted, run
bun run infra:bootstrap -- <provider> --new, apply foundation with bun run infra:apply -- <provider>, inspect bun run infra:plan -- <provider>, and release all
surfaces with bun run release -- <provider>. Follow docs/DEPLOYMENT.md and the selected provider
runbook. Never deploy from a dirty, detached, unpushed, or wrong branch.

Prefer the monolithic backend. Use Managed PostgreSQL and private object storage for production
media; never use a container filesystem for durable uploads. After setup, remove the marked
Bootstrap-Only Instructions blocks from AGENTS.md and CLAUDE.md, validate the active surfaces,
and report exact remaining account/domain authorizations without printing secrets.
```

- First read `README.md`, [CHECKLIST.md](CHECKLIST.md), `CLAUDE.md` if present, and relevant `docs/*.md`, including [docs/WEB_SURFACES.md](docs/WEB_SURFACES.md) before website data, catalog, cart, checkout, order, entitlement, subscription, or payment work; then inspect package scripts and each active surface's app-local `.env.example` before running setup commands.
- Inspect `git remote -v` before any branch, commit, push, or PR workflow. If `origin` points to the template repository and the user has not explicitly said they are contributing to the template, treat this as a new project and detach from the template remote with `git remote remove origin`.
- If the user provides their own GitHub repository URL or asks to publish the new project, add that URL as the new `origin` after the template remote is removed. If the user has not chosen a destination yet, leave the repository with no `origin` and report that publishing is not configured.
- Do not open pull requests against the template repository during first-run project setup. Ask only if the user explicitly says this checkout is for improving the template itself.
- Run the intake from [CHECKLIST.md](CHECKLIST.md) in the user's language before making product or deployment choices, and record the answers in that file rather than only in the conversation.
- Rename the template deliberately rather than with an unreviewed global replacement. Use `rg -n "web_app_demo|web-app-demo|vibecoding-template"` to inventory package scopes, database names, cookie names, Docker/Compose isolation names, deploy image defaults, and architecture-check aliases; update each owning source, regenerate `bun.lock` with the repository's pinned Bun version, then run install, typecheck, architecture checks, backend integration, and web E2E for the active surfaces.
- After the user answers, record durable project choices in [CHECKLIST.md](CHECKLIST.md) before feature work: project name/slug, active and deferred surfaces, first-version capabilities, the capability ledger, and what deployment/release work is in or out of scope. Expand the relevant README sections when a choice needs more explanation than the checklist row holds. Once setup is complete, remove the marked `Bootstrap-Only Instructions` blocks from `AGENTS.md` and `CLAUDE.md`.
- If only the webapp is active, keep mobile deferred on the default branch: do not run Expo/EAS/Maestro setup and do not add mobile features. When the user later asks for mobile, switch to the `mobile` branch first.
- If only the mobile app is active, keep webapp and website intact but deferred: do not add browser-only features or Playwright flows unless they support the active mobile/backend work, and add or update a short deferred-surface note in `webapp/README.md` or `website/README.md` as relevant. When the user later asks for webapp, remove or rewrite that note, then set up and validate webapp normally.
- On the `mobile` branch, keep template-level Expo/EAS config universal. Do not commit an `expo.owner` or `extra.eas.projectId` to the template. In an installed project, write `expo.owner` and run EAS project init only after the user selects the real Expo personal account or organization that should own the app.
- On the `mobile` branch, use an installed Expo development build for Maestro E2E, not Expo Go. Follow that branch's mobile README before running mobile flows.
- Prefer README-level deferred-surface notes over source-code comments. Add code comments only when a dormant code path would otherwise mislead future work.
- Default to local-only setup when the user does not need deployment yet. Local development must not require DigitalOcean credentials.
- Use [docs/LOCAL_DATABASE.md](docs/LOCAL_DATABASE.md) and `docker-compose.yml` as the local PostgreSQL source of truth. The default local database path is Docker Compose, not a native PostgreSQL install.
- If deployment is requested, read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), select the hosting from the recorded audience, and keep the matching Terraform stack as the production source of truth.
- For the DigitalOcean launch profile, start with one `apps-s-1vcpu-1gb` API container plus the smallest production Managed PostgreSQL cluster. Check current provider pricing before approval; `webapp` and fully prerendered `website` are Static Sites and do not need runtime container sizing. A `website` route with SSR/on-demand rendering or server islands needs a runtime service.
- Deploy `webapp` and fully prerendered `website` output as DigitalOcean App Platform Static Sites, not App Platform services. They do not get `instance_size_slug` or `instance_count`; static site assets are served through DigitalOcean's global CDN by default. Use an external CDN only when the product needs advanced controls such as bot filtering, custom rate limiting, or geographic traffic rules.
- Copy the selected provider's `terraform.tfvars.example` files, keep real `.tfvars` and state credentials uncommitted, bootstrap remote state once, apply the foundation explicitly, and use the unified release command only after its plan is clean. Machine tiers and service shape live in Terraform; update the provider runbook with material operational changes.
- Before deployment or cloud-resource updates, verify `git remote -v` and `git status --short --branch`. Deploy only from the intended pushed release branch with a clean worktree; if local changes, untracked files, or branch sync issues are present, stop instead of cleaning, stashing, resetting, or checking out over another session's work.
- Use DigitalOcean Spaces Standard Storage, or any S3-compatible bucket, for persistent files and uploads. Do not store uploads on the App Platform container filesystem: the backend refuses the filesystem storage driver in production for exactly that reason.
- If [CHECKLIST.md](CHECKLIST.md) records Yandex Cloud, use Serverless Containers, Managed Service for PostgreSQL, Object Storage, and opt-in Cloud CDN exactly as declared under `infra/yandex`. If it records DigitalOcean, use App Platform, Managed PostgreSQL, DOCR, and a private media Space under `infra/digitalocean`.
- Explain manual prerequisites only for the active release path: cloud account/billing, provider CLI login, production domains/certificates/DNS, and account-level authorization that Terraform cannot portably create. Expo/EAS/App Store/Google Play setup lives on the `mobile` branch.
- The agent may create uncommitted app-local `.env` files from their matching `.env.example` files and generate a local-only `JWT_SECRET`; never commit secrets or print raw secrets in the final report.
- After setup, run the smallest meaningful validation for the chosen active surfaces and report local URLs, commands run, and anything the user still needs to authorize manually.

## What's Inside

- `backend` - Bun + Hono + Prisma + PostgreSQL, custom JWT auth, Zod validation, and OpenAPI output.
- `webapp` - React + Vite + TanStack Query/Form/Router CSR browser client with the baseline auth flow.
- `website` - a separate Astro project for public SSG/SSR pages (landing, content sites, marketplace).
- `mobile` - Expo Router app with token auth, uploads, optional push/social/IAP foundations, and Maestro flows.
- `packages/contracts` - shared Zod schemas and TypeScript API types.
- `CHECKLIST.md` - the install intake questionnaire and the durable record of what this project needs, including which capabilities were deliberately removed.
- `infra` - provider-specific Terraform bootstrap, stateful foundation, migration/runtime, and static release roots for DigitalOcean and Yandex Cloud.
- `docker-compose.yml` - local PostgreSQL 18 through the official `postgres:18-alpine` image on port `54329`; test runners use a repository-derived port by default, or `POSTGRES_TEST_PORT` when set. PostgreSQL 18 is intentional because the backend schema uses strict database-generated UUIDv7 IDs.
- `docs/BACKGROUND_JOBS.md` - the three ways to work off the request path, the durable task outbox, and how to run them.
- `docs/TESTING.md` - the backend, Playwright, and mobile Maestro testing contract.
- `docs/LOCAL_DATABASE.md` - cross-platform local PostgreSQL setup for Windows, macOS, and Linux.
- `docs/EMAIL.md` - transactional email: the four drivers, Postbox and Resend, and how delivery reaches the outbox.
- `docs/STORAGE.md` - private file storage: the filesystem and S3 drivers, the local S3 container, and the upload contract.
- `docs/WEB_SURFACES.md` - the mandatory ownership contract for SSG product data, rebuilds, browser cart/checkout, and separate mobile payment paths.
- `docs/YANDEX_CLOUD.md` - the Yandex Cloud hosting path, chosen when users or data must stay in Russia.
- `docs/DIGITALOCEAN.md` - the DigitalOcean hosting path for audiences without Russian data residency.

## Choosing `webapp` vs `website`

This template ships two browser surfaces. Putting a feature in the wrong one is the most common early mistake, so the installing agent must pick deliberately and explain the choice in product terms the user understands.

- Build it in **`website`** (Astro, static by default, SSR/hybrid only when needed) when pages must be **public and found by search engines or shared with rich link previews**: marketing/landing pages, content sites, blogs, docs, and the public storefront of a **marketplace**. For a marketplace, this usually means the landing page, category/search landing pages, public listing/product pages, SEO metadata, and rich previews.
- Build it in **`webapp`** (React, client-side rendered) when screens live **behind sign-in and do not need SEO**: login-adjacent app flows after redirect, buyer account, seller/admin panels, checkout/account workflows, dashboards, settings, and authenticated tools. No crawler needs these, so CSR is the simpler, cheaper choice.

Rule of thumb for the agent: _if a page must rank in search or preview nicely when shared, it belongs in `website`; if it is only reachable after login, it belongs in `webapp`._ Real marketplaces normally use **both**: the public catalog lives in `website`, the authenticated app lives in `webapp`, and both reuse the same `@web-app-demo/contracts` schemas. Do not rebuild SEO pages inside `webapp` to "keep everything in one app"; that loses the SEO the product needs. Do not move the full authenticated app into Astro just because the product has public SEO pages.

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

| Role          | Email               | Password               | Landing page |
| ------------- | ------------------- | ---------------------- | ------------ |
| Administrator | `admin@example.com` | `local-admin-password` | `/admin`     |
| User          | `user@example.com`  | `local-user-password`  | `/app`       |

The command is idempotent, rejects `NODE_ENV=production`, and accepts only a
loopback PostgreSQL URL. On the `mobile` branch it also gives the ordinary demo
user a local-only active premium entitlement so mobile opens its main component
surface immediately; mobile has no administrator UI. Deployment uses
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

Create `mobile/.env` with `EXPO_PUBLIC_API_URL`. Android emulators normally use
`http://10.0.2.2:3000`; physical devices and Maestro need a host-reachable LAN URL. Keep
`EXPO_PUBLIC_E2E=1` limited to the E2E Metro bundle. Product/store identifiers and the complete
Expo/EAS setup are documented in [mobile/README.md](mobile/README.md).

Test runners use the separate Docker Compose `postgres_test` service and the `TEST_DATABASE_URL` shape from `backend/.env.example`. Webapp Playwright E2E starts `postgres_test`, applies migrations to `web_app_demo_test`, runs the browser flow, and tears down its test database volume by default.

For an ordinary completed task, `bun run check` is the canonical local quality gate. It validates
the reusable-template invariants first, then architecture boundaries, dependency advisories,
typecheck, lint, and the full test suite. The full suite includes backend integration tests, so
Docker must be installed and the daemon running. The dependency audit needs registry access.
Terraform validation remains a separate `bun run test:terraform` signal because it depends on the
Terraform CLI rather than the normal application toolchain.

## Workspace Commands

- `bun run dev` - start all workspace projects in parallel dev mode.
- `bun run dev:backend` - start the backend API.
- `bun run dev:webapp` - start the Vite CSR webapp.
- `bun run dev:website` - start the Astro website project.
- `bun run dev:mobile` - start the Expo mobile app.
- `bun run dev:backend:s3` - start the backend against the local S3 container instead of the disk.
- `bun run check` - canonical task-completion gate: template invariants, architecture, dependency
  audit, typecheck, lint, and all tests; requires registry access and Docker for backend integration.
- `bun run template:check` - validate checklist state, capability-ledger states, equivalent agent
  instructions, and local Markdown file, directory, and heading links.
- `bun run typecheck` - run TypeScript checks across workspaces.
- `bun run lint` - run ESLint over the webapp and mobile app.
- `bun run architecture:check` - enforce the module/feature dependency boundaries.
- `bun run build` - run production build/typecheck/export scripts for workspaces that define them.
- `bun run static:precompress` - write `.br` and `.gz` next to the text assets in `webapp/dist` and
  `website/dist`, after those builds. Deliberately not part of `build`: only the own-server proxy
  reads those sidecars. Hosted releases upload/build the original assets and let their edge layer
  negotiate compression when available.
- `bun run audit` - fail on unreviewed dependency vulnerabilities. The `overrides` block in the root
  `package.json` sets minimum safe versions for fixable transitive advisories. The mobile line also
  carries two narrow, expiring exceptions for `image-size@1.2.1` because Metro uses it only for
  local build assets and no patched npm release exists. The gate accepts only
  `GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq`, verifies every lockfile resolution and reverse
  installed-dependency path (Metro is the only direct consumer; only mobile reaches it), refuses
  direct application use or graph drift, and expires after 2026-09-24. Track the upstream
  [advisory-database issue](https://github.com/github/advisory-database/issues/9028), remove the
  exceptions as soon as a fixed release reaches Expo/Metro, and re-run `bun run audit` after every
  dependency update. `bun update` still moves override ranges within their safe floors.
- Prisma is pinned to an exact `7.9.0` in `backend/package.json`, and that is deliberate: 7.9.1
  cannot be installed. `bun add @prisma/client@7.9.1` in an empty directory produces 12 KB and
  three files instead of 78 MB and seventeen, with an empty `runtime/`, so the generated client's
  `@prisma/client/runtime/client` import stops resolving and every Prisma type collapses - about
  180 typecheck errors that look nothing like a packaging problem. The published tarball is
  intact, so this is an install-side failure. `bun update` cannot move an exact pin; `bun update
--latest` can, so check Prisma after one, and try 7.9.2 when it ships.
- `bun run test` - run infrastructure, contract, backend, webapp, website, and mobile tests; requires
  Docker because backend integration starts PostgreSQL.
- `bun run test:terraform` - validate every Terraform root when the Terraform CLI is installed;
  intentionally separate from `bun run check`.
- `bun run test:infra` - run release orchestration and infrastructure safety tests (no cloud mutation).
- `bun run test:contracts` - run shared Zod contract tests.
- `bun run test:backend` - run backend unit and integration tests.
- `bun run test:backend:integration` - run DB-backed auth tests through `postgres_test`.
- `bun run test:webapp` - run webapp client tests.
- `bun run test:mobile` - run mobile client tests.
- `bun run test:storage:s3` - run the storage contract against a real local S3 server (needs Docker).
- `bun run --cwd backend start:cron -- <job>` - run one background job once, for example `outbox:drain`; see [docs/BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md).
- `bun run --cwd backend start:scheduler` - run the mobile line's shared schedule: task outbox and push every minute, upload cleanup hourly, and maintenance every 15 minutes (`bun run dev` starts it too).
- `bun run --cwd backend start:worker` - run the loop worker process (empty until you add loops).
- `bun run --cwd backend start:worker:notifications` - run the lower-latency Expo push worker instead of the one-minute scheduled topology.
- `bun run infra:bootstrap -- <digitalocean|yandex> --new` - create and migrate the selected provider's remote Terraform state; omit `--new` only when resuming, or use the documented recovery flags to reattach.
- `bun run infra:apply -- <digitalocean|yandex>` - apply a guarded saved plan to the stateful foundation only.
- `bun run infra:import -- <provider> <root> <address> <id> [adoption flags]` - import an existing resource into its exact state root and check the resulting saved plan.
- `bun run infra:output -- <digitalocean|yandex>` - print only the safe operational Terraform outputs.
- `bun run infra:plan -- <digitalocean|yandex>` - inspect a guarded production Terraform plan without applying it.
- `bun run release -- <digitalocean|yandex>` - build, migrate, promote, publish, and verify one production release.
- `bun run e2e:webapp` - run the Playwright journeys through backend + Vite.
- `bun run e2e:webapp:s3` - run the same journeys against the local S3 container.
- `bun run e2e:mobile` - run Maestro against an installed Expo development build and host-reachable Metro URL.
- `bun run --cwd mobile e2e:maestro:audit` - audit the mobile flows and runner inputs for known flaky patterns.
- `bun run storage:local:start|status|stop|env` - manage the optional local S3 container; `stop` keeps its volume.
- `bun run --cwd backend prisma:migrate` - create/apply a Prisma migration in development.
- `bun run --cwd backend prisma:deploy` - apply existing Prisma migrations on a server.
- `bun run dev:seed` - idempotently create the local demo accounts.
- `bun run --cwd backend db:deploy` - production pre-deploy: migrate, optionally bootstrap the first administrator, and require a login-capable administrator.
- `bun run --cwd backend db:adopt-owner` - read-only inventory for legacy PostgreSQL ownership; add the documented confirmation and `-- --apply` only for the reviewed one-time transfer.

## Project READMEs

- [backend/README.md](backend/README.md) - API, auth, Prisma, and backend validation.
- [docs/LOCAL_DATABASE.md](docs/LOCAL_DATABASE.md) - Docker Compose PostgreSQL setup and reset workflow.
- [docs/EMAIL.md](docs/EMAIL.md) - transactional email: the four drivers, Postbox and Resend, and how delivery reaches the outbox.
- [docs/STORAGE.md](docs/STORAGE.md) - private file storage: the filesystem and S3 drivers, the local S3 container, and the upload contract.
- [docs/SOCIAL_AUTH.md](docs/SOCIAL_AUTH.md) - Apple and Google mobile social-auth setup.
- [docs/IAP.md](docs/IAP.md) - switched-off App Store and Google Play subscription paths.
- [docs/WEB_SURFACES.md](docs/WEB_SURFACES.md) - SSG product data, rebuilds, browser cart/checkout ownership, and mobile payment boundaries.
- [docs/YANDEX_CLOUD.md](docs/YANDEX_CLOUD.md) - the Yandex Cloud hosting path, used when the checklist records it.
- [webapp/README.md](webapp/README.md) - CSR browser client setup, env, and Playwright smoke.
- [mobile/README.md](mobile/README.md) - Expo, EAS, push, development-build, and Maestro setup.
- [website/README.md](website/README.md) - Astro website commands, hybrid rendering, and publishing model.
- [packages/contracts/README.md](packages/contracts/README.md) - shared schema and DTO rules.

## License

This project is licensed under the Apache License 2.0. If you distribute a fork, copy, or derivative work, keep both [LICENSE](LICENSE) and [NOTICE](NOTICE) with the attribution to Dima Sukharev, GitHub profile, and the original repository.

## Architecture Notes

API contracts live in `packages/contracts` and are imported by every active layer. The backend validates input with those Zod schemas; webapp and mobile reuse the same contracts in their forms and API clients. `UserDto.role` is the shared `user | admin` role contract; authorization uses the current database record rather than a role embedded in JWT claims.

The backend API flow is `route -> validation -> auth/session guard -> service -> Prisma -> DTO`. Routes stay thin, auth business logic lives in the feature service, and API, worker, and cron entrypoints share `src/runtime.ts` for env and Prisma setup.

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
- Mobile: [Expo docs](https://docs.expo.dev/), [Expo Router](https://docs.expo.dev/router/introduction/), [EAS Build](https://docs.expo.dev/build/introduction/), and [React Native docs](https://reactnative.dev/docs/getting-started)
- Website: [Astro docs](https://docs.astro.build/en/getting-started/)
- Local infrastructure: [Docker Compose docs](https://docs.docker.com/compose/) and [PostgreSQL Docker Official Image](https://hub.docker.com/_/postgres)
- DigitalOcean infrastructure: [Terraform provider](https://docs.digitalocean.com/reference/terraform/), [App Platform](https://docs.digitalocean.com/products/app-platform/), [Static Sites](https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/), [Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/), [Container Registry](https://docs.digitalocean.com/products/container-registry/), [Spaces](https://docs.digitalocean.com/products/spaces/), and [doctl](https://docs.digitalocean.com/reference/doctl/)
- Yandex Cloud path: [Yandex Cloud CLI](https://yandex.cloud/en/docs/cli/quickstart), [Yandex Serverless Containers](https://yandex.cloud/en/docs/serverless-containers/), [Yandex Container Registry](https://yandex.cloud/en/docs/container-registry/quickstart), [Yandex Managed PostgreSQL](https://yandex.cloud/en/docs/managed-postgresql/), [Yandex Managed Service for Valkey](https://yandex.cloud/en/docs/managed-redis/), [Yandex Object Storage static hosting](https://yandex.cloud/en/docs/storage/operations/hosting/setup), [Yandex Object Storage AWS CLI](https://yandex.cloud/en/docs/storage/tools/aws-cli), [Yandex Cloud CDN](https://yandex.cloud/en/docs/cdn/concepts/), and [Yandex Cloud Marketplace Image Resizer](https://yandex.cloud/en/marketplace/products/yc/image-resizer)
