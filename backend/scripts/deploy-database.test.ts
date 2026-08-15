import { describe, expect, test } from 'bun:test'

import type { DbClient } from '../src/db'
import {
  assertMigrationSchemaOwnership,
  deployDatabase,
  grantRuntimeDatabaseAccess,
} from './deploy-database'

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

    expect(calls.indexOf('ownership:unused')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('migrate')).toBeGreaterThan(
      calls.indexOf('ownership:unused'),
    )
    expect(calls.indexOf('grant:unused:none')).toBeGreaterThan(
      calls.indexOf('migrate'),
    )
    expect(calls.indexOf('bootstrap:admin@example.com')).toBeGreaterThan(calls.indexOf('migrate'))
    expect(calls.indexOf('bootstrap:admin@example.com')).toBeGreaterThan(
      calls.indexOf('grant:unused:none'),
    )
    expect(calls.indexOf('assert')).toBeGreaterThan(calls.indexOf('bootstrap:admin@example.com'))
  })

  test('grants a separate runtime login after migration and before application checks', async () => {
    const calls: string[] = []
    await deployDatabase(
      {
        DATABASE_URL: databaseUrl,
        DATABASE_RUNTIME_USER: 'product_app',
      },
      dependenciesRecording(calls),
    )

    expect(calls).toEqual([
      'create',
      'ownership:unused',
      'migrate',
      'grant:unused:product_app',
      'assert',
      'disconnect',
      'log',
    ])
  })

  test('grants only runtime DML and matching future-object privileges', async () => {
    const statements: string[] = []
    await grantRuntimeDatabaseAccess(
      {
        async $transaction(operation) {
          return operation({
            async $queryRawUnsafe() {
              return []
            },
            async $executeRawUnsafe(statement: string) {
              statements.push(statement)
              return 0
            },
          } as never)
        },
      },
      { databaseName: 'product', username: 'product_app' },
    )

    expect(statements).toContain(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "product_app"',
    )
    expect(statements).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "product_app"',
    )
    expect(statements).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "product_app"',
    )
    expect(statements).toContain(
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
    )
    expect(statements).toContain(
      'REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC',
    )
    expect(statements).toContain(
      'REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM "product_app"',
    )
    expect(statements).toContain(
      'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    )
    expect(statements.join('\n')).not.toContain('GRANT CREATE')
    expect(statements.join('\n')).not.toContain('GRANT TRUNCATE')
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

  test('reports concrete ownership mismatches without mutating the database', async () => {
    await expect(
      assertMigrationSchemaOwnership(
        {
          async $queryRawUnsafe() {
            return [
              {
                kind: 'table',
                identity: 'public._prisma_migrations',
                owner: 'legacy_owner',
              },
            ]
          },
        },
        { expectedOwner: 'product_migration' },
      ),
    ).rejects.toThrow('public._prisma_migrations')
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
