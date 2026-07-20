import 'dotenv/config'

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { createPrisma, type DbClient } from '../src/db'
import {
  assertLoginCapableAdmin,
  bootstrapAdmin,
  parseAdminSeedConfig,
} from '../src/modules/users/infrastructure/admin-bootstrap'

type DatabaseDeployDependencies = {
  assertAdmin(db: DbClient): Promise<void>
  bootstrap(
    db: DbClient,
    config: ReturnType<typeof parseAdminSeedConfig>,
  ): Promise<unknown>
  createDatabase(databaseUrl: string): DbClient
  log(message: string): void
  migrate(
    databaseUrl: string,
    source: Record<string, string | undefined>,
  ): void | Promise<void>
}

const defaultDependencies: DatabaseDeployDependencies = {
  assertAdmin: assertLoginCapableAdmin,
  bootstrap: bootstrapAdmin,
  createDatabase: createPrisma,
  log: console.log,
  migrate(databaseUrl, source) {
    const migration = spawnSync('bun', ['run', 'prisma:deploy'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        ...source,
        DATABASE_URL: databaseUrl,
      },
      stdio: 'inherit',
    })
    if (migration.status !== 0) {
      throw new Error(`Database migration failed with status ${migration.status ?? 1}`)
    }
  },
}

export async function deployDatabase(
  source: Record<string, string | undefined>,
  dependencies: DatabaseDeployDependencies = defaultDependencies,
) {
  const config = databaseDeployConfig(source)

  await dependencies.migrate(config.databaseUrl, source)

  const prisma = dependencies.createDatabase(config.databaseUrl)
  try {
    if (config.seed !== null) {
      await dependencies.bootstrap(prisma, config.seed)
    }
    await dependencies.assertAdmin(prisma)
  } finally {
    await prisma.$disconnect()
  }
  dependencies.log('Database deployment completed with a login-capable administrator.')
}

function databaseDeployConfig(source: Record<string, string | undefined>) {
  const databaseUrl = source.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for database deployment')
  }

  const hasSeedEmail = Boolean(source.ADMIN_SEED_EMAIL?.trim())
  const hasSeedPassword = Boolean(source.ADMIN_SEED_PASSWORD)
  if (hasSeedEmail !== hasSeedPassword) {
    throw new Error(
      'ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be supplied together for initial deployment',
    )
  }

  return {
    databaseUrl,
    seed:
      hasSeedEmail && hasSeedPassword
        ? parseAdminSeedConfig(source, { requirePassword: true })
        : null,
  }
}

if (import.meta.main) {
  await deployDatabase(process.env)
}
