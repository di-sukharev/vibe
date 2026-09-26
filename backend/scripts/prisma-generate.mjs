import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const lockPath = resolve(backendRoot, '.prisma-generate.lock')
const generatedPath = resolve(backendRoot, 'src/generated/prisma')

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

// A lock left by a killed run would otherwise stall every later typecheck, test, and dev start.
function lockIsStale() {
  try {
    const owner = Number.parseInt(readFileSync(lockPath, 'utf8'), 10)
    if (Number.isInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0)
        return false
      } catch (error) {
        return error?.code === 'ESRCH'
      }
    }
    return Date.now() - statSync(lockPath).mtimeMs > 120_000
  } catch {
    return false
  }
}

async function acquireLock() {
  mkdirSync(dirname(lockPath), { recursive: true })

  for (let attempt = 1; attempt <= 120; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeSync(fd, String(process.pid))
      return fd
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        if (lockIsStale()) {
          rmSync(lockPath, { force: true })
          continue
        }
        await sleep(500)
        continue
      }

      throw error
    }
  }

  throw new Error(`Timed out waiting for ${lockPath}`)
}

const fd = await acquireLock()

try {
  if (process.env.PRISMA_GENERATE_CLEAN === '1') {
    rmSync(generatedPath, { recursive: true, force: true })
  }

  const result = spawnSync('bun', ['run', 'prisma:generate:raw'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:5432/web_app_demo?schema=public',
    },
    stdio: 'inherit',
  })

  process.exitCode = result.status ?? 1
} finally {
  closeSync(fd)
  rmSync(lockPath, { force: true })
}
