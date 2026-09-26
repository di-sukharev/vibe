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
      {
        DATABASE_URL: databaseUrl,
        DATABASE_RUNTIME_USER: 'runtime-user',
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

  test('grants access after migration, then bootstraps before verifying the administrator', async () => {
    // The order is the rule: grants and the bootstrap need the migrated schema, and verifying the
    // administrator before the bootstrap would check an account that did not exist yet. The grant
    // runs without a runtime login too, because it also hardens what PUBLIC may do.
    const seeded: string[] = []
    await deployDatabase(
      {
        DATABASE_URL: databaseUrl,
        ADMIN_SEED_EMAIL: ' ADMIN@Example.COM ',
        ADMIN_SEED_PASSWORD: 'a-strong-initial-password',
      },
      dependenciesRecording(seeded),
    )
    const withRuntimeLogin: string[] = []
    await deployDatabase(
      { DATABASE_URL: databaseUrl, DATABASE_RUNTIME_USER: 'product_app' },
      dependenciesRecording(withRuntimeLogin),
    )

    expect(seeded).toEqual([
      'create',
      'ownership:unused',
      'migrate',
      'grant:unused:none',
      'bootstrap:admin@example.com',
      'assert',
      'disconnect',
      'log',
    ])
    expect(withRuntimeLogin).toEqual([
      'create',
      'ownership:unused',
      'migrate',
      'grant:unused:product_app',
      'assert',
      'disconnect',
      'log',
    ])
  })

  test('fails closed before migration when public schema objects have another owner', async () => {
    const calls: string[] = []

    await expect(
      deployDatabase(
        { DATABASE_URL: databaseUrl },
        {
          ...dependenciesRecording(calls),
          async assertMigrationOwnership() {
            throw new Error('legacy ownership remains')
          },
        },
      ),
    ).rejects.toThrow('legacy ownership remains')
    expect(calls).toEqual(['create', 'disconnect'])
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
  async grantRuntimeAccess() {
    throw new Error('grantRuntimeAccess must not run')
  },
  async assertMigrationOwnership() {
    throw new Error('assertMigrationOwnership must not run')
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
    async assertMigrationOwnership(
      _db: DbClient,
      input: { expectedOwner: string },
    ) {
      calls.push(`ownership:${input.expectedOwner}`)
    },
    async grantRuntimeAccess(
      _db: DbClient,
      input: { databaseName: string; username: string | null },
    ) {
      calls.push(`grant:${input.databaseName}:${input.username ?? 'none'}`)
    },
    log() {
      calls.push('log')
    },
    migrate() {
      calls.push('migrate')
    },
  }
}
