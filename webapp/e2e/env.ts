import {
  assertTestDatabaseUrl,
  composeProjectName,
  defaultPostgresTestPort,
  defaultTestDatabaseUrl,
  postgresTestDataVolume,
  postgresTestService,
  preferredPostgresTestPort,
  repositoryHash,
  repositoryRoot,
} from '../../scripts/repo-env.mjs'
import { portFromUrl } from './url'

/**
 * Docker and PostgreSQL constants come from the same module the backend integration runner and
 * the Docker smoke use, so a renamed volume or service cannot leave this run cleaning up the
 * wrong one.
 */
export {
  composeProjectName,
  defaultTestDatabaseUrl,
  postgresTestDataVolume,
  postgresTestService,
  preferredPostgresTestPort,
  repositoryRoot,
}

export const preferredBackendPort =
  50000 + (Number.parseInt(repositoryHash.slice(6, 12), 16) % 5000)
export const preferredWebPort =
  55000 + (Number.parseInt(repositoryHash.slice(0, 6), 16) % 5000)
export const defaultDatabaseUrl = defaultTestDatabaseUrl(defaultPostgresTestPort)
export const e2eAdminEmail = 'admin@example.com'
export const e2eAdminPassword = 'admin-e2e-password'

/**
 * The E2E counterpart of the backend runner's `TEST_ALLOW_NON_TEST_DATABASE`: the same rule,
 * unlocked by its own variable, so allowing one runner onto a development database never
 * silently allows the other.
 */
export function assertE2eDatabaseUrl(databaseUrl: string) {
  assertTestDatabaseUrl(databaseUrl, { allowEnvName: 'E2E_ALLOW_NON_TEST_DATABASE' })
}

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
