import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const scriptPath = resolve(import.meta.dirname, 'seed-development.ts')

describe('development seed command', () => {
  test('refuses production seeding before connecting to the database', () => {
    const credentialCases = [
      {},
      {
        ADMIN_SEED_EMAIL: 'admin@example.com',
        ADMIN_SEED_PASSWORD: 'short',
      },
      {
        ADMIN_SEED_EMAIL: 'admin@example.com',
        ADMIN_SEED_PASSWORD: 'aaaaaaaaaaaa',
      },
    ]

    for (const credentials of credentialCases) {
      const result = spawnSync('bun', [scriptPath], {
        env: {
          ...process.env,
          ADMIN_SEED_EMAIL: undefined,
          ADMIN_SEED_PASSWORD: undefined,
          DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
          NODE_ENV: 'production',
          ...credentials,
        },
        encoding: 'utf8',
      })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'Development seed is disabled in production',
      )
    }
  })
})
