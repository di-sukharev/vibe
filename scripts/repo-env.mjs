import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const repositoryHash = createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12)
export const composeProjectName =
  process.env.COMPOSE_PROJECT_NAME ?? `vibecoding-template-${repositoryHash}`
export const defaultPostgresTestPort =
  process.env.POSTGRES_TEST_PORT ?? String(30000 + (Number.parseInt(repositoryHash.slice(0, 6), 16) % 20000))
/**
 * Local S3 port, in a band no other repository-derived port uses.
 *
 * 30000-49999 is the test database, 50000-54999 the E2E backend, and 55000-59999 the E2E web
 * server (see webapp/e2e/env.ts). Sharing a band would make two checkouts of this template
 * collide on some machines and not others, which is the worst kind of flake to debug.
 */
export const defaultPrivateStorageS3Port =
  process.env.PRIVATE_STORAGE_S3_PORT ??
  String(24000 + (Number.parseInt(repositoryHash.slice(6, 12), 16) % 4000))

/**
 * Fixed, obviously fake credentials for the local S3 container.
 *
 * Literal rather than derived from the environment on purpose: if these read from `AWS_*` or any
 * other ambient variable, a developer with real cloud credentials exported in their shell could
 * silently point the local container, or a test, at a real bucket.
 */
export const localPrivateStorageBucket = 'local-private-storage'
export const localPrivateStorageAccessKeyId = 'local-private-storage-not-a-real-key'
export const localPrivateStorageSecretAccessKey =
  'local-private-storage-not-a-real-secret-do-not-use-in-production'
export const localPrivateStorageService = 'storage_s3'
export const postgresTestService = 'postgres_test'
/**
 * Named so teardown can remove exactly this volume. `docker compose down -v` cannot be scoped to
 * a service, so it would also delete the local storage volume - and with it uploads a developer
 * expects to survive a test run.
 */
export const postgresTestDataVolume = 'postgres_18_test_data'

export function localPrivateStorageEndpoint(port = defaultPrivateStorageS3Port) {
  return `http://127.0.0.1:${port}`
}

/**
 * The `PRIVATE_STORAGE_*` block that switches a backend onto the local S3 container. Built in
 * one place so the dev server, the live tests, and the E2E run cannot drift apart.
 */
export function localPrivateStorageEnv(port = defaultPrivateStorageS3Port) {
  return {
    PRIVATE_STORAGE_DRIVER: 's3',
    PRIVATE_STORAGE_REGION: 'us-east-1',
    PRIVATE_STORAGE_BUCKET: localPrivateStorageBucket,
    PRIVATE_STORAGE_ENDPOINT: localPrivateStorageEndpoint(port),
    PRIVATE_STORAGE_ACCESS_KEY_ID: localPrivateStorageAccessKeyId,
    PRIVATE_STORAGE_SECRET_ACCESS_KEY: localPrivateStorageSecretAccessKey,
    PRIVATE_STORAGE_FORCE_PATH_STYLE: 'true',
  }
}

/**
 * Local S3 mode is for development only. This refuses anything that is not loopback, so a
 * mistyped port or an inherited variable cannot turn `storage:local:*` into a command that
 * reconfigures, or writes to, a real bucket.
 */
export function assertLocalPrivateStorageEndpoint(endpoint) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the local storage container with NODE_ENV=production.')
  }

  const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  let hostname
  try {
    hostname = new URL(endpoint).hostname
  } catch {
    throw new Error(`Local storage endpoint is not a valid URL: ${endpoint}`)
  }

  if (!loopback.has(hostname)) {
    throw new Error(
      `Refusing to use "${endpoint}" as a local storage endpoint: it is not a loopback address.`,
    )
  }

  return endpoint
}

/**
 * CORS rule for the local bucket.
 *
 * `allowedHeaders` is passed in from the backend's own list so the container allows exactly what
 * the filesystem driver's CORS layer allows, and a browser upload behaves the same on both.
 */
export function localPrivateStorageCorsRule(allowedOrigins, allowedHeaders, exposedHeaders) {
  return {
    AllowedOrigins: allowedOrigins,
    AllowedMethods: ['GET', 'PUT', 'HEAD', 'DELETE'],
    AllowedHeaders: allowedHeaders,
    ExposeHeaders: exposedHeaders,
    MaxAgeSeconds: 600,
  }
}

export function defaultTestDatabaseUrl(port = defaultPostgresTestPort) {
  return `postgresql://superuser:superpassword@localhost:${port}/web_app_demo_test?schema=public`
}

export function postgresPortFromDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl)
  if (url.port) return url.port
  return '5432'
}

export function assertTestDatabaseUrl(
  databaseUrl,
  { allowEnvName = 'TEST_ALLOW_NON_TEST_DATABASE' } = {},
) {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '')

  if (!databaseName.endsWith('_test') && process.env[allowEnvName] !== '1') {
    throw new Error(
      `Refusing to run tests against non-test database "${databaseName}". Use a *_test database or set ${allowEnvName}=1 intentionally.`,
    )
  }
}

export function composeEnv(extra = {}) {
  return {
    ...process.env,
    POSTGRES_TEST_PORT: defaultPostgresTestPort,
    PRIVATE_STORAGE_S3_PORT: defaultPrivateStorageS3Port,
    COMPOSE_PROJECT_NAME: composeProjectName,
    ...extra,
  }
}
