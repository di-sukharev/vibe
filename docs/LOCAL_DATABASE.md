# Local PostgreSQL

Docker Compose runs PostgreSQL 18 for development and tests. This guide owns its commands, ports, volumes, and resets.

- Use Docker Compose on Windows, macOS, and Linux. Install PostgreSQL natively only when the user explicitly chooses it. Even then, keep a full URL with user and password, as in `backend/.env.example`.
- Pass `--env-file backend/.env` to every `docker compose` command. Compose reads only a root `.env`, and the template keeps none.
- The image is `postgres:18-alpine`. Keep the major version pinned: a new major version cannot read the old volume. To upgrade, export and import the data, or [reset](#reset-local-data) it.
- When you change a service name, port, credential, image, or volume, update `docker-compose.yml`, `backend/.env.example`, and this guide together.

## Requirements

- Windows: Docker Desktop with WSL 2.
- macOS: Docker Desktop, or Docker Engine with Compose v2.
- Linux: Docker Engine and the Docker Compose plugin.

Check Compose and the Docker daemon from the repository root:

```bash
docker compose version
docker info
```

## If Docker is unavailable

Run both checks before database or E2E work. If one fails:

1. Tell the user that the template runs its local PostgreSQL in Docker.
2. Ask the user to install and start Docker for their OS, as listed above.
3. Repeat both checks. Continue only when both succeed.

Do not offer a native, cloud, or other local database on your own. If Docker cannot be installed, tell the user that database work and checks are blocked.

## Start the development database

```bash
cp backend/.env.example backend/.env   # PowerShell: Copy-Item backend/.env.example backend/.env
docker compose --env-file backend/.env up -d --wait postgres
bun run --cwd backend prisma:deploy
bun run dev:seed                       # optional: demo accounts from DEV_SEED_* in backend/.env
```

`DATABASE_URL` in `backend/.env` holds the connection: `localhost:54329`, database `web_app_demo`, user `superuser`, password `superpassword`.

The seed refuses `NODE_ENV=production` and non-loopback database URLs. Deployments run `db:deploy`, not the seed.

## Change the port

If `54329` is busy, set `POSTGRES_PORT` and the port in `DATABASE_URL` in `backend/.env` to the same free port.

## Test database

Test runners start, migrate, and remove their own `postgres_test` on a per-checkout port. See [TESTING](TESTING.md).

## Reset local data

```bash
docker compose --env-file backend/.env down      # stop containers, keep data
docker compose --env-file backend/.env down -v   # delete local database and storage data
```

Run `down -v` only for an intentional reset.

## If migration history changed

`P3018` with `type "user_role" already exists`, and later `P3009`, mean that the database has another migration history, for example from squashed migrations or another branch. Do not repair the history by hand. If the local data is disposable, reset and migrate again:

```bash
docker compose --env-file backend/.env down -v
docker compose --env-file backend/.env up -d --wait postgres
bun run --cwd backend prisma:deploy
bun run dev:seed
```

If the data matters, back it up first and get the user's approval to delete it.

Switching from `mobile` to `master` needs the same reset: the extra `mobile` tables stay, `prisma migrate deploy` applies nothing, and `prisma migrate dev` reports drift. Switching from `master` to `mobile` needs no reset.

References: [Docker Compose](https://docs.docker.com/compose/), [PostgreSQL image](https://hub.docker.com/_/postgres).
