import 'dotenv/config'

import { createPrisma } from '../src/db'
import {
  bootstrapAdmin,
  parseAdminSeedConfig,
} from '../src/modules/users/infrastructure/admin-bootstrap'

if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'prisma:seed is disabled in production; use db:deploy for strict administrator bootstrap',
  )
}

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed the administrator')
}

const prisma = createPrisma(databaseUrl)
try {
  const result = await bootstrapAdmin(
    prisma,
    parseAdminSeedConfig(process.env, { requirePassword: false }),
  )
  if (result.locked) {
    console.log(
      `Seeded locked administrator ${result.email}. Set ADMIN_SEED_PASSWORD and run the seed again to enable password login.`,
    )
  } else {
    console.log(`Seeded login-capable administrator ${result.email}.`)
  }
} finally {
  await prisma.$disconnect()
}
