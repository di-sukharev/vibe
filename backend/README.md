# Backend

Bun and Hono serve the API. Prisma uses PostgreSQL. Package versions and scripts are in [package.json](package.json). [AGENTS.md](../AGENTS.md) defines module boundaries.

## Local development

Install Docker Engine or Docker Desktop with Compose. Check it before database work:

```bash
docker compose version
docker info
```

From the repository root:

```bash
cp backend/.env.example backend/.env
docker compose --env-file backend/.env up -d --wait postgres
bun run --cwd backend prisma:deploy
bun run dev:seed
bun run dev:backend
```

In PowerShell, use `Copy-Item` instead of `cp`. Generate `JWT_SECRET` locally before startup. `dev:backend` starts the API and scheduler. The scheduler sends queued local email and performs maintenance.

[.env.example](.env.example) defines local settings. [src/env.ts](src/env.ts) validates them. If the database port is busy, change `POSTGRES_PORT` and the port in `DATABASE_URL` together.

The seed creates local accounts from `DEV_SEED_*`. It refuses production and non-loopback databases. Changing a seeded password revokes that account's sessions. `DEV_SEED_DEMO=1 bun run dev:seed` also creates list and pagination fixtures.

### Reset local data

A changed or squashed migration history can cause `P3018`, `P3009`, or schema drift. Do not edit migration history to hide the error. Back up useful data and get approval before deleting it.

For a disposable development database, remove only its service and volume:

```bash
docker compose --env-file backend/.env rm --stop --force --volumes postgres
docker volume rm <compose-project>_postgres_18_data
docker compose --env-file backend/.env up -d --wait postgres
bun run --cwd backend prisma:deploy
bun run dev:seed
```

Find the project name with `docker compose --env-file backend/.env ls`. Check the volume name against [docker-compose.yml](../docker-compose.yml). Do not use `down -v`: it also deletes local storage data. Switching from `mobile` to `master` can require a database reset because mobile tables remain.

## Configuration

Use the environment schema instead of copying its validation rules into documentation. Production needs HTTPS origins, secure cookies, a strong JWT secret, and persistent S3 storage.

Set `RATE_LIMIT_STORE=database` when more than one API process serves requests. Run scheduled jobs to remove expired sessions, reset tokens, and rate-limit rows.

Configure `TRUST_PROXY` only for a trusted ingress and its actual client-IP header. An incorrect header can merge all clients into one rate-limit bucket.

Email and file procedures are in [Email](../docs/EMAIL.md) and [Storage](../docs/STORAGE.md).

## Authentication

The implementation is in [src/modules/auth](src/modules/auth). Browser refresh tokens stay in HttpOnly cookies. Native refresh tokens use the token endpoints and secure device storage. Browser JavaScript must not store refresh tokens.

Protected requests load the active session and current user. Keep role checks and revocation on the server. Password reset must not reveal whether an account exists. Reset confirmation consumes tokens and revokes sessions in one transaction.

Role changes must not remove the last administrator. Keep password changes, session creation, and role changes under the existing authentication locks.

## API and background processes

`GET /openapi.json` describes the API. `/health/live` checks the process; `/health/ready` checks database access.

The API, scheduler, cron, and worker share the runtime and Docker image. Only the API needs the JWT signing secret. [Background jobs](../docs/BACKGROUND_JOBS.md) explains the other processes.

## Database releases

`db:deploy` checks ownership, applies migrations, restricts runtime grants, and requires a login-capable administrator. The first release can create that administrator from `ADMIN_SEED_*`. Never use the development seed in production.

For existing databases and release recovery, follow [Deployment](../docs/DEPLOYMENT.md).
