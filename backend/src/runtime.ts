import 'dotenv/config'

import { createBackgroundTasks, type BackgroundTasks } from './background-tasks'
import { createPrisma, type DbClient } from './db'
import { loadBackgroundEnv, loadEnv, type AppEnv } from './env'
import { createPrivateStorage, type PrivateStorageRuntime } from './storage'

export type BackendRuntime = {
  backgroundTasks: BackgroundTasks
  env: AppEnv
  prisma: DbClient
  /**
   * The storage port plus the routes the filesystem driver needs mounted. Background jobs reach
   * the port through `privateStorage.storage`; `jobs.ts` must stay free of runtime imports.
   */
  privateStorage: PrivateStorageRuntime
  close: (timeoutMs?: number) => Promise<void>
}

export async function closeBackendRuntime(
  resources: {
    backgroundTasks: BackgroundTasks
    prisma: Pick<DbClient, '$disconnect'>
  },
  timeoutMs: number,
) {
  const drained = await resources.backgroundTasks.drain(timeoutMs)
  if (!drained) {
    console.error('Background task drain exceeded the shutdown grace period')
  }
  await resources.prisma.$disconnect()
}

export function createBackendRuntime(source: Record<string, string | undefined> = Bun.env): BackendRuntime {
  return createRuntime(loadEnv(source))
}

export function createBackgroundRuntime(
  source: Record<string, string | undefined> = Bun.env,
): BackendRuntime {
  return createRuntime(loadBackgroundEnv(source))
}

function createRuntime(env: AppEnv): BackendRuntime {
  const prisma = createPrisma(env.DATABASE_URL)
  const backgroundTasks = createBackgroundTasks()
  const privateStorage = createPrivateStorage(env)
  let closed = false

  return {
    backgroundTasks,
    env,
    prisma,
    privateStorage,
    close: async (timeoutMs = env.SHUTDOWN_GRACE_SECONDS * 1000) => {
      if (closed) return
      closed = true
      await closeBackendRuntime({ backgroundTasks, prisma }, timeoutMs)
    },
  }
}
