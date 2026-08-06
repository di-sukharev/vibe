import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const localDatabaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun scripts/seed-development.ts',
  },
  datasource: {
    url: localDatabaseUrl,
  },
})
