import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import {
  assertTestDatabaseUrl,
  composeEnv,
  composeProjectName,
  defaultPostgresTestPort,
  defaultTestDatabaseUrl,
  postgresPortFromDatabaseUrl,
  repositoryHash,
  repositoryRoot,
} from '../../scripts/repo-env.mjs'

const imageName = process.env.BACKEND_DOCKER_SMOKE_IMAGE ?? 'vibecoding-template-backend:smoke'
const containerName =
  process.env.BACKEND_DOCKER_SMOKE_CONTAINER ??
  `vibecoding-template-backend-smoke-${repositoryHash}-${process.pid}`
const hostPort = process.env.BACKEND_DOCKER_SMOKE_PORT ?? String(await findOpenPort())
const networkName = `${composeProjectName}_default`
const composeArgs = ['compose', '-p', composeProjectName]
const databaseUrlForHost =
  process.env.TEST_DATABASE_URL ?? defaultTestDatabaseUrl(defaultPostgresTestPort)
const databaseUrlForContainer =
  process.env.BACKEND_DOCKER_SMOKE_DATABASE_URL ??
  'postgresql://superuser:superpassword@postgres_test:5432/web_app_demo_test?schema=public'
assertTestDatabaseUrl(databaseUrlForHost)
assertTestDatabaseUrl(databaseUrlForContainer, {
  allowEnvName: 'BACKEND_DOCKER_SMOKE_ALLOW_NON_TEST_DATABASE',
})
const dockerEnv = composeEnv({
  POSTGRES_TEST_PORT: postgresPortFromDatabaseUrl(databaseUrlForHost),
})

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`)
  }
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }

        reject(new Error('Could not allocate an open TCP port'))
      })
    })
  })
}

async function waitForComposePostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      [
        ...composeArgs,
        'exec',
        '-T',
        'postgres_test',
        'pg_isready',
        '-U',
        'superuser',
        '-d',
        'web_app_demo_test',
      ],
      {
        cwd: repositoryRoot,
        env: dockerEnv,
        stdio: 'ignore',
      },
    )

    if (result.status === 0) {
      return
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  process.stderr.write('Timed out waiting for postgres_test\n')
  throw new Error('Timed out waiting for postgres_test')
}

async function waitForHealth() {
  const url = `http://127.0.0.1:${hostPort}/health`

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        process.stdout.write(`Backend Docker smoke passed: ${url}\n`)
        return
      }
    } catch {
      // Retry until the container finishes booting.
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  process.stderr.write(`Timed out waiting for ${url}\n`)
  spawnSync('docker', ['logs', containerName], { stdio: 'inherit' })
  throw new Error(`Timed out waiting for ${url}`)
}

async function smokeAuthApi() {
  const baseUrl = `http://127.0.0.1:${hostPort}`
  const email = `docker-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

  const register = await fetch(`${baseUrl}/api/auth/token/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password: 'password123',
      displayName: 'Docker Smoke',
    }),
  })

  if (register.status !== 201) {
    throw new Error(`Register failed with HTTP ${register.status}: ${await register.text()}`)
  }

  const registerBody = await register.json()
  if (!registerBody.accessToken || !registerBody.refreshToken) {
    throw new Error('Register response did not include mobile auth tokens')
  }

  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${registerBody.accessToken}`,
    },
  })

  if (me.status !== 200) {
    throw new Error(`/me failed with HTTP ${me.status}: ${await me.text()}`)
  }

  process.stdout.write('Backend Docker DB-backed auth smoke passed\n')
}

try {
  run('docker', [...composeArgs, 'up', '-d', 'postgres_test'], { env: dockerEnv })
  await waitForComposePostgres()

  run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrlForHost,
    },
  })

  run('docker', ['build', '-f', 'backend/Dockerfile', '-t', imageName, '.'])
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' })

  run('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    containerName,
    '--network',
    networkName,
    '-p',
    `${hostPort}:3000`,
    '-e',
    'PORT=3000',
    '-e',
    `DATABASE_URL=${databaseUrlForContainer}`,
    '-e',
    'JWT_SECRET=docker-smoke-secret-at-least-thirty-two-characters',
    '-e',
    'CORS_ORIGINS=http://localhost:45174',
    '-e',
    'COOKIE_SECURE=false',
    imageName,
  ])

  await waitForHealth()
  await smokeAuthApi()
} finally {
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' })
  spawnSync('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans'], {
    cwd: repositoryRoot,
    env: dockerEnv,
    stdio: 'inherit',
  })
}
