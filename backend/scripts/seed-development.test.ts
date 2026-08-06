import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const scriptPath = resolve(import.meta.dirname, 'seed-development.ts')

describe('development seed command', () => {
  test('refuses production seeding before connecting to the database', () => {
    const credentialCases = [
      {},
      {
        DEV_SEED_ADMIN_EMAIL: 'admin@example.com',
        DEV_SEED_ADMIN_PASSWORD: 'short',
      },
      {
        DEV_SEED_ADMIN_EMAIL: 'admin@example.com',
        DEV_SEED_ADMIN_PASSWORD: 'local-admin-password',
        DEV_SEED_USER_EMAIL: 'user@example.com',
        DEV_SEED_USER_PASSWORD: 'local-user-password',
      },
    ]

    for (const credentials of credentialCases) {
      const result = spawnSync('bun', [scriptPath], {
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
          DEV_SEED_ADMIN_EMAIL: '',
          DEV_SEED_ADMIN_PASSWORD: '',
          DEV_SEED_USER_EMAIL: '',
          DEV_SEED_USER_PASSWORD: '',
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
