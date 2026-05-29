import { spawnSync } from 'node:child_process'
import { composeEnv, composeProjectName, repositoryRoot } from './env'

export default function globalTeardown() {
  if (process.env.E2E_SKIP_DOCKER === '1' || process.env.E2E_KEEP_DOCKER === '1') {
    return
  }

  const result = spawnSync('docker', ['compose', '-p', composeProjectName, 'down', '-v'], {
    cwd: repositoryRoot,
    env: composeEnv(),
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`Command failed: docker compose -p ${composeProjectName} down -v`)
  }
}
