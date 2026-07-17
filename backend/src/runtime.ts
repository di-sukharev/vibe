import 'dotenv/config'

import { createPrisma, type DbClient } from './db'
import { loadBackgroundEnv, loadEnv, type AppEnv } from './env'

export type BackendRuntime = {
  env: AppEnv
  prisma: DbClient
  close: () => Promise<void>
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
  let closed = false

  return {
    env,
    prisma,
    close: async () => {
      if (closed) return
      closed = true
      await prisma.$disconnect()
    },
  }
}
