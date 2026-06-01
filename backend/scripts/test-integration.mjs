import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertTestDatabaseUrl,
  composeEnv,
  composeProjectName,
  defaultTestDatabaseUrl,
  postgresPortFromDatabaseUrl,
} from '../../scripts/repo-env.mjs'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const repositoryRoot = resolve(backendRoot, '..')
const databaseUrl = process.env.TEST_DATABASE_URL ?? defaultTestDatabaseUrl()
assertTestDatabaseUrl(databaseUrl)
const dockerEnv = composeEnv({
  POSTGRES_TEST_PORT: postgresPortFromDatabaseUrl(databaseUrl),
})
const composeArgs = ['compose', '-p', composeProjectName]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? backendRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function waitForComposePostgres(service, database, env) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      [...composeArgs, 'exec', '-T', service, 'pg_isready', '-U', 'superuser', '-d', database],
      {
        cwd: repositoryRoot,
        env,
        stdio: 'ignore',
      },
    )

    if (result.status === 0) {
      return
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  process.stderr.write(`Timed out waiting for Docker Compose service "${service}"\n`)
  process.exit(1)
}

const env = {
  ...dockerEnv,
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
}

if (process.env.TEST_SKIP_DOCKER !== '1') {
  run('docker', [...composeArgs, 'up', '-d', 'postgres_test'], {
    cwd: repositoryRoot,
    env,
  })
  await waitForComposePostgres('postgres_test', 'web_app_demo_test', env)
}

run('bun', ['run', 'prisma:generate'], { env })
run('bun', ['run', 'prisma:deploy'], { env })
run(
  'bun',
  [
    'test',
    'src/auth/auth.integration.test.ts',
    'src/iap/iap.integration.test.ts',
    'src/notifications/notifications.integration.test.ts',
  ],
  { env },
)
