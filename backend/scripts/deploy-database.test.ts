import { describe, expect, test } from 'bun:test'

import type { DbClient } from '../src/db'
import { deployDatabase } from './deploy-database'

describe('database deployment command', () => {
  test('rejects invalid configuration before attempting a migration', async () => {
    const invalidSources = [
      {},
      {
        DATABASE_URL: databaseUrl,
        ADMIN_SEED_EMAIL: 'admin@example.com',
      },
      {
        DATABASE_URL: databaseUrl,
        ADMIN_SEED_EMAIL: 'admin@example.com',
        ADMIN_SEED_PASSWORD: 'aaaaaaaaaaaa',
      },
    ]

    for (const source of invalidSources) {
      let migrationAttempts = 0
      await expect(
        deployDatabase(source, {
          ...unusedDependencies,
          migrate() {
            migrationAttempts += 1
          },
        }),
      ).rejects.toThrow()
      expect(migrationAttempts).toBe(0)
    }
  })

  test('bootstraps paired strong credentials before verifying the administrator', async () => {
    // The order is the rule: bootstrapping after the check would verify an account that did not
    // exist yet, and either step before the migration would run against the old schema. Asserted
    // as relative positions - `disconnect` and `log` land wherever they land.
    const calls: string[] = []
    await deployDatabase(
      {
        DATABASE_URL: databaseUrl,
        ADMIN_SEED_EMAIL: ' ADMIN@Example.COM ',
        ADMIN_SEED_PASSWORD: 'a-strong-initial-password',
      },
      dependenciesRecording(calls),
    )

    expect(calls.indexOf('migrate')).toBe(0)
    expect(calls.indexOf('bootstrap:admin@example.com')).toBeGreaterThan(calls.indexOf('migrate'))
    expect(calls.indexOf('assert')).toBeGreaterThan(calls.indexOf('bootstrap:admin@example.com'))
  })
})

const databaseUrl = 'postgresql://unused:unused@127.0.0.1:1/unused'

const unusedDependencies = {
  async assertAdmin() {
    throw new Error('assertAdmin must not run')
  },
  async bootstrap() {
    throw new Error('bootstrap must not run')
  },
  createDatabase() {
    throw new Error('createDatabase must not run')
  },
  log() {
    throw new Error('log must not run')
  },
  migrate() {
    throw new Error('migrate must not run')
  },
}

function dependenciesRecording(calls: string[]) {
  const db = {
    async $disconnect() {
      calls.push('disconnect')
    },
  } as unknown as DbClient

  return {
    async assertAdmin() {
      calls.push('assert')
    },
    async bootstrap(
      _db: DbClient,
      config: { email: string },
    ) {
      calls.push(`bootstrap:${config.email}`)
    },
    createDatabase() {
      calls.push('create')
      return db
    },
    log() {
      calls.push('log')
    },
    migrate() {
      calls.push('migrate')
    },
  }
}
