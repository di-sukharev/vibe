import { spawnSync } from 'node:child_process'
import {
  composeEnv,
  composeProjectName,
  defaultDatabaseUrl,
  repositoryRoot,
} from './env'

const composeArgs = ['compose', '-p', composeProjectName]

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`)
  }
}

async function waitForComposePostgres(service: string, database: string, env: NodeJS.ProcessEnv) {
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

  throw new Error(`Timed out waiting for Docker Compose service "${service}"`)
}

export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? defaultDatabaseUrl
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '')

  if (!databaseName.endsWith('_test') && process.env.E2E_ALLOW_NON_TEST_DATABASE !== '1') {
    throw new Error(
      `Refusing to run Playwright against non-test database "${databaseName}". Use a *_test database or set E2E_ALLOW_NON_TEST_DATABASE=1 intentionally.`,
    )
  }

  process.env.TEST_DATABASE_URL = databaseUrl
  process.env.DATABASE_URL = databaseUrl

  const env = composeEnv({
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
  })

  if (process.env.E2E_SKIP_DOCKER !== '1') {
    run('docker', [...composeArgs, 'up', '-d', 'postgres_test'], env)
    await waitForComposePostgres('postgres_test', 'web_app_demo_test', env)
  }

  run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], env)
}
