# Local PostgreSQL

Use Docker Compose for local PostgreSQL on Windows, macOS, and Linux. Do not ask users to install PostgreSQL natively during first-run setup unless they explicitly choose to manage their own database.

This template currently uses the official `postgres:18-alpine` image. The major version is pinned to PostgreSQL 18 instead of `postgres:latest` so patch updates are easy while unexpected major upgrades do not break local volumes. PostgreSQL 18 is also a schema requirement for this template because Prisma models use database-generated UUIDv7 defaults through the native `uuidv7()` function.

Use explicit `postgresql://user:password@host:port/db?schema=public` URLs for Prisma commands, even on native local installs. Peer-auth style URLs without a user can make Prisma schema-engine commands fail with a generic error instead of a useful connection diagnostic.

## Prerequisites

- Windows: Docker Desktop with the WSL 2 backend enabled.
- macOS: Docker Desktop or another Docker Engine with Compose v2.
- Linux: Docker Engine and the Docker Compose plugin.

Check that Compose is available and the Docker daemon is running:

```bash
docker compose version
docker info
```

Run commands from the repository root.

## If Docker Is Missing

Agents should check `docker compose version` and `docker info` before database or E2E setup. If either command fails, do this:

1. Tell the user that Docker is the local app this template uses to run PostgreSQL. Do not ask them to install native PostgreSQL.
2. Ask them to install/start the right Docker option for their OS:
   - Windows: Docker Desktop with the WSL 2 backend enabled.
   - macOS: Docker Desktop, or another Docker Engine that includes Compose v2.
   - Linux: Docker Engine plus the Docker Compose plugin, with the Docker service running.
3. After installation, rerun `docker compose version` and `docker info`.
4. Continue only after both commands succeed. Then run `docker compose pull postgres` and `docker compose up -d postgres`.

If Docker cannot be installed on the machine, local database-backed development and E2E are blocked. Do not silently fall back to a cloud database or a different local PostgreSQL setup.

## Start Development Database

```bash
docker compose pull postgres
docker compose up -d postgres
docker compose ps postgres
docker compose exec postgres pg_isready -U superuser -d web_app_demo
```

The development database is:

```text
host: localhost
port: 54329
database: web_app_demo
user: superuser
password: superpassword
DATABASE_URL: postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public
```

Create the backend env file:

```bash
# macOS, Linux, or Git Bash on Windows
cp backend/.env.example backend/.env
```

```powershell
# Windows PowerShell
Copy-Item backend/.env.example backend/.env
```

Then apply Prisma migrations:

```bash
bun run --cwd backend prisma:deploy
```

## Optional Port Overrides

If `54329` is already in use, create a repository-root `.env` from `.env.example` and change `POSTGRES_PORT`:

```bash
# macOS, Linux, or Git Bash on Windows
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

After changing the port, update `backend/.env` so `DATABASE_URL` uses the same port.

## Test Database

`postgres_test` is reserved for integration, Docker smoke, and Playwright flows:

```bash
docker compose up -d postgres_test
```

Manual default connection:

```text
host: localhost
port: 54330
database: web_app_demo_test
user: superuser
password: superpassword
TEST_DATABASE_URL: postgresql://superuser:superpassword@localhost:54330/web_app_demo_test?schema=public
```

Automated test runners normally set a repository-derived `POSTGRES_TEST_PORT` and derive `TEST_DATABASE_URL` from it so multiple template checkouts can run in parallel. Set `POSTGRES_TEST_PORT` only when a fixed test database port is required.

The test database name must end with `_test`. Backend integration, Docker smoke, and Playwright E2E refuse non-test database names by default so they do not write to development data.

## Reset Local Data

Stop containers but keep local data:

```bash
docker compose down
```

Delete local PostgreSQL data only when you intentionally want a clean database:

```bash
docker compose down -v
```

PostgreSQL major upgrades are not automatic data migrations. If this template bumps from one PostgreSQL major version to another, either export/import the data manually or delete the local development volumes with `docker compose down -v` when the data is disposable.

## Current Upstream Documentation

- Docker Compose: https://docs.docker.com/compose/
- PostgreSQL Docker Official Image: https://hub.docker.com/_/postgres
- PostgreSQL docs: https://www.postgresql.org/docs/
