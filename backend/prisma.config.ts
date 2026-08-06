import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const localDatabaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public'

export default defineConfig({
  // A folder, not a single file: each optional capability owns its own schema file, so removing
  // one is deleting a file plus its marked relation block in base.prisma.
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun scripts/seed-development.ts',
  },
  datasource: {
    url: localDatabaseUrl,
  },
})
