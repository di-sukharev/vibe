import { spawnSync } from 'node:child_process'
import {
  composeEnv,
  composeProjectName,
  postgresTestDataVolume,
  postgresTestService,
  repositoryRoot,
} from './env'

/**
 * Removes the test database this run created, and nothing else.
 *
 * Deliberately not `docker compose down -v`: that cannot be scoped to a service, so it would
 * also stop the optional local storage container and delete its named volume. Running the web
 * E2E suite must not destroy uploads a developer is keeping in local S3 storage.
 */
export default function globalTeardown() {
  if (process.env.E2E_SKIP_DOCKER === '1' || process.env.E2E_KEEP_DOCKER === '1') {
    return
  }

  const env = composeEnv()

  run(
    ['compose', '-p', composeProjectName, 'rm', '--stop', '--force', '--volumes', postgresTestService],
    env,
  )
  // The test database keeps its data in a named volume, which `compose rm --volumes` leaves
  // alone; a stale one would carry rows into the next run.
  spawnSync('docker', ['volume', 'rm', '--force', `${composeProjectName}_${postgresTestDataVolume}`], {
    cwd: repositoryRoot,
    env,
    stdio: 'ignore',
  })
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync('docker', args, { cwd: repositoryRoot, env, stdio: 'inherit' })

  if (result.status !== 0) {
    throw new Error(`Command failed: docker ${args.join(' ')}`)
  }
}
