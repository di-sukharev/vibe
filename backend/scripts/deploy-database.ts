import 'dotenv/config'

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { createPrisma } from '../src/db'
import {
  assertLoginCapableAdmin,
  bootstrapAdmin,
  parseAdminSeedConfig,
} from '../src/modules/users/infrastructure/admin-bootstrap'

const migration = spawnSync('bun', ['run', 'prisma:deploy'], {
  cwd: resolve(import.meta.dirname, '..'),
  env: process.env,
  stdio: 'inherit',
})
if (migration.status !== 0) {
  process.exit(migration.status ?? 1)
}

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for database deployment')
}

const hasSeedEmail = Boolean(process.env.ADMIN_SEED_EMAIL?.trim())
const hasSeedPassword = Boolean(process.env.ADMIN_SEED_PASSWORD)
if (hasSeedEmail !== hasSeedPassword) {
  throw new Error(
    'ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be supplied together for initial deployment',
  )
}

const prisma = createPrisma(databaseUrl)
try {
  if (hasSeedEmail && hasSeedPassword) {
    await bootstrapAdmin(
      prisma,
      parseAdminSeedConfig(process.env, { requirePassword: true }),
    )
  }
  await assertLoginCapableAdmin(prisma)
  console.log('Database deployment completed with a login-capable administrator.')
} finally {
  await prisma.$disconnect()
}
