import { afterEach, beforeEach, expect, test } from 'bun:test'

import { handleProviderJobRequest } from './cron'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; run bun run test:backend:integration')

// Terraform binds JWT_SECRET only to the API, so a Yandex job container boots this adapter
// without it. The adapter's default runtime must come from the process environment as is.
const saved = { DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: process.env.JWT_SECRET }

beforeEach(() => {
  process.env.DATABASE_URL = databaseUrl
  delete process.env.JWT_SECRET
})

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test('the provider HTTP job adapter runs a job without JWT_SECRET in the environment', async () => {
  const response = await handleProviderJobRequest(
    new Request('http://jobs.internal/', { method: 'POST' }),
    'db:ping',
  )

  expect(response.status).toBe(204)
})
