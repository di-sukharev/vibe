import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { portFromUrl } from './url'

export const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const repositoryHash = createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12)
export const preferredPostgresTestPort =
  30000 + (Number.parseInt(repositoryHash.slice(0, 6), 16) % 20000)
export const preferredBackendPort =
  50000 + (Number.parseInt(repositoryHash.slice(6, 12), 16) % 5000)
export const preferredWebPort =
  55000 + (Number.parseInt(repositoryHash.slice(0, 6), 16) % 5000)
export const composeProjectName =
  process.env.COMPOSE_PROJECT_NAME ?? `vibecoding-template-${repositoryHash}`
export const defaultPostgresTestPort =
  process.env.POSTGRES_TEST_PORT ?? String(preferredPostgresTestPort)
export const defaultBackendPort =
  process.env.E2E_BACKEND_PORT ?? String(preferredBackendPort)
export const defaultWebPort =
  process.env.E2E_WEB_PORT ?? String(preferredWebPort)
export const defaultDatabaseUrl = `postgresql://superuser:superpassword@localhost:${defaultPostgresTestPort}/web_app_demo_test?schema=public`

export function composeEnv(extra: NodeJS.ProcessEnv = {}) {
  const explicitDatabaseUrl =
    extra.TEST_DATABASE_URL ?? extra.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  const postgresTestPort = portFromUrl(explicitDatabaseUrl) ?? extra.POSTGRES_TEST_PORT ?? defaultPostgresTestPort

  return {
    ...process.env,
    ...extra,
    COMPOSE_PROJECT_NAME: composeProjectName,
    POSTGRES_TEST_PORT: postgresTestPort,
  }
}
