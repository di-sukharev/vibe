import 'dotenv/config'

import { createPrisma } from '../src/db'
import { parseDevelopmentSeedConfig } from './development-seed-config'
import { bootstrapDevelopmentData } from './development-seed'

const config = parseDevelopmentSeedConfig(process.env)
const prisma = createPrisma(config.databaseUrl)

try {
  const result = await bootstrapDevelopmentData(prisma, config.accounts)
  console.log(`Seeded development administrator ${result.admin.email}.`)
  console.log(`Seeded development user ${result.user.email}.`)
} finally {
  await prisma.$disconnect()
}
