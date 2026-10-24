# Deployment

The template provides two independent static builds and one backend Docker image. Choose hosting and deployment tools for the product's audience, data location, and operating needs. This repository does not provision production resources or publish releases.

Build each artifact from a known, immutable source revision with the Bun version in [package.json](../package.json) and the committed lockfile. Record the revision, image digest, and public build configuration with the release. Deploy only on request, from a clean checkout whose selected commit is fully pushed.

## Static applications

Run these commands from the repository root after `bun install --frozen-lockfile`:

| Application | Build command | Publish directory | Public build variables |
| --- | --- | --- | --- |
| Website | `bun run build:website` | `website/build/client` | `VITE_WEBSITE_URL`, `VITE_WEBAPP_URL` |
| Webapp | `bun run build:webapp` | `webapp/build/client` | `VITE_API_URL` |

Set the variables before building. They are public and embedded in the output. Keep secrets out of `VITE_*` variables. Changing these values requires a rebuild of the affected application. Website URLs control canonical links and navigation to the webapp. `VITE_API_URL` selects the backend API.

Both applications use React Router Framework Mode on Vite. The website prerenders its routes at build time. Serve its files with ordinary missing-page handling and an HTTP 404 for unknown paths. The webapp renders in the browser. Its host must return `index.html` for application deep links, including a direct visit to `/app/profile`, while serving existing assets normally. Do not rewrite missing assets to HTML.

Publish the directories independently. Neither application needs a production React Router server. Vite development and preview servers are local tools. `bun run static:precompress -- <directory>` can create compressed assets when the chosen static host supports them.

## Backend image and processes

Build from the repository root:

```bash
docker build -f backend/Dockerfile -t <registry>/<project>-backend:<revision> .
```

Resolve and deploy the resulting image by digest. The image's working directory is `/app/backend`. Use the same image for the following processes:

| Process | Container command | Configuration |
| --- | --- | --- |
| Database deployment | `bun run db:deploy` | Migration-owner `DATABASE_URL`, runtime role name in `DATABASE_RUNTIME_USER`, initial administrator seed when needed |
| API | Default image command | Production API environment, runtime-role `DATABASE_URL`, `JWT_SECRET` |
| Scheduler | `bun run start:scheduler` | Production background environment, runtime-role `DATABASE_URL` |
| One job | `bun run start:cron -- <job>` | Same background environment as the scheduler |

Run `db:deploy` to completion before replacing the API or background processes. The API does not apply migrations at startup. Keep migrations compatible with the running version until replacement finishes. A failed database deployment must stop promotion. Schema changes go forward; rollback requires an application version that works with the current schema.

Run the scheduler under a supervisor, or configure an external scheduler to invoke the individual jobs in [Background jobs](BACKGROUND_JOBS.md). Allow graceful shutdown for active jobs.

Only the API needs `JWT_SECRET`. The API and all background processes initialize storage and email adapters. Supply production S3 configuration and credentials to each process, including jobs that only use the database. Enabled email delivery requires provider configuration and credentials in each process. Keep these settings the same for the API and email-draining runners. `db:deploy` needs neither storage nor email configuration.

### Database roles and first administrator

Create a migration owner and a separate runtime login in PostgreSQL. Use the owner only for database deployment. `db:deploy` checks schema ownership, applies migrations, removes unsafe PUBLIC privileges, and grants the runtime role the required data access. It refuses elevated runtime roles and roles that own database objects. Always supply `DATABASE_RUNTIME_USER` when using a separate runtime login. A missing value skips runtime-role grants.

The command also requires a login-capable administrator. On the first deployment, supply `ADMIN_SEED_EMAIL` and a strong `ADMIN_SEED_PASSWORD` together to this process. Remove them after success and change the password after first sign-in. Reusing the seed can reset the administrator password and revoke sessions. Never use the development seed in production.

An existing database can need an ownership transfer. This utility is independent of hosting. First inventory through the legacy owner or another connection permitted to transfer ownership:

```bash
export DATABASE_URL='<privileged connection>'
export DATABASE_LEGACY_OWNER='<current owner>'
export DATABASE_MIGRATION_USER='<new migration owner>'
bun run --cwd backend db:adopt-owner
```

Review the inventory and obtain approval before applying it:

```bash
export CONFIRM_DATABASE_OWNER_ADOPTION="${DATABASE_LEGACY_OWNER}->${DATABASE_MIGRATION_USER}"
bun run --cwd backend db:adopt-owner -- --apply
unset DATABASE_URL DATABASE_LEGACY_OWNER DATABASE_MIGRATION_USER CONFIRM_DATABASE_OWNER_ADOPTION
```

The utility excludes extension objects and refuses mixed legacy owners. Run `db:deploy` with the new migration-owner connection after the transfer.

## Operator responsibilities

Configure HTTPS, domains, trusted ingress headers, API CORS origins, and secure cookies. Set `RATE_LIMIT_STORE=database` when multiple API processes handle requests. Follow [backend configuration](../backend/README.md#configuration) and the validated environment schema. Keep credentials in a secret manager and separate migration, runtime, and operator access.

Provide PostgreSQL 18 or later, private S3-compatible storage, and any selected email service. Database ID defaults require the native `uuidv7()` function. Configure bucket CORS, version retention, database and object backups, and restore tests. [Storage](STORAGE.md) and [Email](EMAIL.md) describe their application contracts. Hosting choice does not select an email provider.

Monitor API readiness, scheduler failures, outbox backlog, storage failures, and backup recovery. The operator owns resource sizing, updates, release coordination, and rollback procedures. Run `bun run check` and `bun run smoke:backend:docker` before a release. Verify the deployed API and static routing on the chosen host.
