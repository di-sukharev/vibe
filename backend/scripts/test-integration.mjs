import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertTestDatabaseUrl,
  composeEnv,
  composeProjectName,
  defaultTestDatabaseUrl,
  postgresPortFromDatabaseUrl,
  postgresTestDataVolume,
  postgresTestService,
} from '../../scripts/repo-env.mjs'
import { backendTestFiles } from './test-files.mjs'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const repositoryRoot = resolve(backendRoot, '..')

class CommandFailure extends Error {
  constructor(command, args, exitCode) {
    super(`${command} ${args.join(' ')} failed with exit code ${exitCode}`)
    this.exitCode = exitCode
  }
}

export async function runBackendIntegration({
  environment = process.env,
  integrationTestFiles,
  spawn = spawnSync,
  writeError = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const managesDocker = environment.TEST_SKIP_DOCKER !== '1'
  if (!managesDocker && !environment.TEST_DATABASE_URL) {
    throw new Error('TEST_SKIP_DOCKER=1 requires TEST_DATABASE_URL')
  }

  const databaseUrl = environment.TEST_DATABASE_URL ?? defaultTestDatabaseUrl()
  assertTestDatabaseUrl(databaseUrl)

  const dockerProjectName = `${composeProjectName}-integration-${randomUUID().slice(0, 8)}`
  const composeArgs = ['compose', '-p', dockerProjectName]
  const dockerEnv = {
    ...composeEnv(),
    ...environment,
    COMPOSE_PROJECT_NAME: dockerProjectName,
    POSTGRES_TEST_PORT: postgresPortFromDatabaseUrl(databaseUrl),
  }
  const env = {
    ...dockerEnv,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
  }
  const keepsDocker = environment.TEST_KEEP_DOCKER === '1'

  const run = (command, args, options = {}) => {
    const result = spawn(command, args, {
      cwd: options.cwd ?? backendRoot,
      env: options.env ?? environment,
      stdio: options.stdio ?? 'inherit',
    })

    if (result.status !== 0) {
      throw new CommandFailure(command, args, result.status ?? 1)
    }
  }

  const waitForComposePostgres = async () => {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const result = spawn(
        'docker',
        [
          ...composeArgs,
          'exec',
          '-T',
          postgresTestService,
          'pg_isready',
          '-U',
          'superuser',
          '-d',
          'web_app_demo_test',
        ],
        {
          cwd: repositoryRoot,
          env,
          stdio: 'ignore',
        },
      )

      if (result.status === 0) return
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
    }

    throw new Error(`Timed out waiting for Docker Compose service "${postgresTestService}"`)
  }

  const cleanupDocker = () => {
    const cleanupFailures = []
    const steps = [
      [
        'docker',
        [...composeArgs, 'rm', '--stop', '--force', '--volumes', postgresTestService],
        { cwd: repositoryRoot, env },
      ],
      [
        'docker',
        ['volume', 'rm', '--force', `${dockerProjectName}_${postgresTestDataVolume}`],
        { cwd: repositoryRoot, env, stdio: 'ignore' },
      ],
      [
        'docker',
        ['network', 'rm', `${dockerProjectName}_default`],
        { cwd: repositoryRoot, env, stdio: 'ignore' },
      ],
    ]

    for (const [command, args, options] of steps) {
      try {
        run(command, args, options)
      } catch (error) {
        cleanupFailures.push(error)
      }
    }

    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, 'Could not fully remove the integration database')
    }
  }

  let primaryFailure

  try {
    if (managesDocker) {
      run('docker', [...composeArgs, 'up', '-d', postgresTestService], {
        cwd: repositoryRoot,
        env,
      })
      await waitForComposePostgres()
    }

    run('bun', ['run', 'prisma:generate'], { env })
    run('bun', ['run', 'prisma:deploy'], { env })

    const discoveredTestFiles = integrationTestFiles ?? backendTestFiles(backendRoot).integration
    if (discoveredTestFiles.length === 0) {
      throw new Error('No *.integration.test.* files found under backend/src or backend/scripts')
    }

    run('bun', ['test', ...discoveredTestFiles], { env })
  } catch (error) {
    primaryFailure = error
  } finally {
    if (managesDocker && !keepsDocker) {
      try {
        cleanupDocker()
      } catch (cleanupFailure) {
        if (primaryFailure) {
          writeError(`Docker cleanup also failed: ${errorMessage(cleanupFailure)}`)
        } else {
          primaryFailure = cleanupFailure
        }
      }
    }
  }

  if (primaryFailure) throw primaryFailure
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return `${error.message}: ${[...error.errors].map(errorMessage).join('; ')}`
  }
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) {
  try {
    await runBackendIntegration()
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = error instanceof CommandFailure ? error.exitCode : 1
  }
}
