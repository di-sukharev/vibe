# Vibe Coding Template

<p align="center">
  <img src="docs/assets/vibe_tmpl_schema.png" alt="Vibe Coding Template architecture diagram" width="100%">
</p>

A web and mobile product template with a shared backend. The `mobile` branch adds Expo and optional subscriptions, push notifications, and social sign-in to `master`.

## Prompt to copy to your agent

```text
Set up https://github.com/di-sukharev/vibe as the base for a new project.
Before cloning, ask whether mobile is needed: use the mobile branch for yes and master for no.
Read AGENTS.md and follow the "Agent setup instructions" section in README.md.
Communicate in my language.
```

## Agent setup instructions

[AGENTS.md](AGENTS.md) defines the working rules. [CLAUDE.md](CLAUDE.md) imports them. Do not develop features before setup is complete.

1. Before cloning, ask whether mobile is needed now. Select `mobile` or `master`.
2. For mobile, clone the full repository and fetch both branches. On `mobile`, install dependencies from the lockfile and run `bun run mobile:template:check -- --published`. Stop if the command is missing or fails. The template owner must synchronize the branches and preserve the application and capability registry.
3. Read the instructions, scripts, and `.env.example` files for the selected applications. Complete [CHECKLIST.md](CHECKLIST.md) in the user's language according to its rules. Record the name and slug, active and deferred applications, features, and deployment scope. Make technical decisions yourself. Update the capability registry as features change.
4. Treat setup as a new project unless the user explicitly asks to work on the template itself. For a new project, run `git remote remove origin`. Add a new remote only from a user-provided address or a request to publish. Otherwise, report that publication is not configured. Do not open a PR in the template repository during setup.
5. Configure only the selected applications. Keep the others and record the reason for deferral in their README files. When an application becomes active, update that record, configure it, and verify it. Add browser features only for the needs of active applications. Comment on inactive code only when its purpose is unclear.
6. For web without mobile, do not configure Expo, EAS, or Maestro. Switch to the mobile branch when mobile is added. Do not set `expo.owner` or `extra.eas.projectId` in the template. In a new project, select the account or organization and use EAS project init to set them. Maestro requires an Expo development build. Expo Go is not sufficient.
7. Follow the [quick start](#quick-start). Create local `.env` files from the examples and generate `JWT_SECRET`. Do not commit or print secrets. Cloud credentials are not needed without deployment.
8. Run focused checks. Remove the *Initial setup only* section and its markers from AGENTS.md. Report local URLs, commands, results, and exact actions still needed from the user.

### Rename the project

Search with `rg -n "web_app_demo|web-app-demo|vibecoding-template|Vibe Coding Template"`. Check packages, databases, cookies, Docker and Compose, images, architecture-check aliases, and `webapp/index.html`. Make targeted edits. Regenerate `bun.lock` with the pinned Bun version. Install dependencies. Check types, architecture, and backend integration for the selected applications.

### Hosting and deployment

| Condition | Hosting |
| --- | --- |
| The audience is in Russia, or data must remain in Russia | [Yandex Cloud](docs/YANDEX_CLOUD.md) |
| Other cases | [DigitalOcean](docs/DIGITALOCEAN.md) |
| The user explicitly requires full control | [Self-hosting](docs/DEPLOYMENT.md#свой-сервер) |

Record the choice in CHECKLIST. In a new project, remove the unused cloud provider's directory and guide. Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md), [infra/README.md](infra/README.md), and the provider guide. Before cloud changes, check the remote and target commit. The branch must be clean and pushed to its upstream. Stop if it is out of sync or HEAD is detached.

Define resource sizes and composition in Terraform. Document operating changes in the guide. Request only necessary actions outside Terraform: accounts, billing, CLI setup, domains, certificates, DNS, and permissions. The mobile README covers Expo, EAS, and app stores.

## Applications

| Path and guide | Purpose |
| --- | --- |
| [backend](backend/README.md) | Bun/Hono, Prisma/PostgreSQL, Zod, JWT, OpenAPI |
| [webapp](webapp/README.md) | React/Vite, TanStack; CSR with registration and sign-in |
| [website](website/README.md) | Astro; public pages, content, and storefront |
| [mobile](mobile/README.md) | Expo Router, token authentication, files, push notifications, social sign-in, IAP, Maestro |
| [packages/contracts](packages/contracts/README.md) | Shared Zod schemas and TypeScript API types |

## Choose between `webapp` and `website`

- `website`: public pages, SEO, link previews, and catalog. Use Astro SSG by default. Use SSR or hybrid rendering when needed.
- `webapp`: screens after sign-in, user accounts, administration, and checkout without SEO.

A marketplace usually needs both. Do not move SEO into CSR or the entire account area into Astro. See [ARCHITECTURE.md](docs/ARCHITECTURE.md#клиенты) for framework selection.

Before work on data, carts, orders, or payments, read [WEB_SURFACES.md](docs/WEB_SURFACES.md). The authenticated webapp and backend own the single browser checkout. Website can pass an anonymous selection. Backend is the data source. Mobile has separate native payments. Store subscriptions are disabled. Add other payment methods according to product needs and platform rules.

## Quick start

From the repository root:

```bash
bun install --frozen-lockfile
```

On `mobile`, `linker = "isolated"` in `bunfig.toml` separates the React versions used by webapp and Expo. When switching from `hoisted`, remove only the root and workspace `node_modules` directories. Then repeat installation. Keep `bun.lock`.

[Docker Compose](docs/LOCAL_DATABASE.md) is required for backend/API work, full-stack work, files, and database tests. The built-in webapp sign-in also requires the backend, database, and migrations. You can omit them after replacing or removing authentication. Website alone does not need them.

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
docker compose --env-file backend/.env pull postgres
docker compose --env-file backend/.env up -d postgres
bun run --cwd backend prisma:deploy
bun run dev:seed
```

In PowerShell, use `Copy-Item backend/.env.example backend/.env` instead of `cp`. If Docker fails, follow the [instructions for your operating system](docs/LOCAL_DATABASE.md#если-docker-недоступен). Run PostgreSQL through Compose, not a native installation.

The seed uses `DEV_SEED_ADMIN_*` and `DEV_SEED_USER_*` from `backend/.env`. These demo credentials are public and must not be used in production:

| Role | Email | Password | Page |
| --- | --- | --- | --- |
| Administrator | `admin@example.com` | `local-admin-password` | `/admin` |
| User | `user@example.com` | `local-user-password` | `/app` |

The seed is safe to repeat. It permits only loopback databases and rejects `NODE_ENV=production`. Mobile does not require a subscription for sign-in or the components screen. The seed does not grant premium access. Mobile has no admin interface. Deployment uses `db:deploy` with `ADMIN_SEED_*`, not the local seed.

Start the required applications in separate terminals:

```bash
bun run dev:backend
bun run dev:webapp
bun run dev:website
bun run dev:mobile
```

To use another API address, set `VITE_API_URL` in `webapp/.env`, for example `http://localhost:3000`. Set `EXPO_PUBLIC_API_URL` in `mobile/.env`. Use `http://10.0.2.2:3000` for Android Emulator and the LAN address for devices and Maestro. Set `EXPO_PUBLIC_E2E=1` only for an E2E Metro session.

The browser origin must match `CORS_ORIGINS` in `backend/.env`. `http://localhost:5173` and `http://127.0.0.1:5173` are different origins. For Vite with `--host 127.0.0.1`, add the second origin and restart the backend. Otherwise, `/api/auth/refresh` returns `CORS Missing Allow Origin` and the session check fails. If you have several project copies, check which copy runs the servers on `3000` and `5173`.

## Checks

Select focused checks using [AGENTS.md](AGENTS.md#testing-and-verification) and [TESTING.md](docs/TESTING.md). Open a browser only on explicit request. Run full `bun run check` for a release, a system-wide audit, or a change across the system. It requires Docker and package registry access. Check Terraform separately.

## Documentation

The guides contain details and official sources:

| Area | Guide |
| --- | --- |
| Development, build, test, database, and release commands | [COMMANDS.md](docs/COMMANDS.md) |
| Dependency updates and temporary audit exceptions | [TESTING.md](docs/TESTING.md#dependency-updates) |
| Modules, processes, authentication, clients, and Prisma | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Schedules, jobs, and outbox | [BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md) |
| PostgreSQL, test databases, and resets | [LOCAL_DATABASE.md](docs/LOCAL_DATABASE.md) |
| Email and files | [EMAIL.md](docs/EMAIL.md), [STORAGE.md](docs/STORAGE.md) |
| Apple/Google sign-in and store subscriptions | [SOCIAL_AUTH.md](docs/SOCIAL_AUTH.md), [IAP.md](docs/IAP.md) |

## License

Apache License 2.0. When distributing a copy, fork, or derived project, keep [LICENSE](LICENSE) and [NOTICE](NOTICE). Preserve the attribution to Dima Sukharev, his GitHub account, and the source repository.
