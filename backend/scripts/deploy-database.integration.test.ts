import { expect, test } from 'bun:test'

import { createPrisma } from '../src/db'
import {
  assertMigrationSchemaOwnership,
  grantRuntimeDatabaseAccess,
  migrationSchemaOwnershipMismatches,
  transferMigrationSchemaOwnership,
} from './deploy-database'

test('runtime database grants allow current and future DML without schema DDL', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
  const suffix = `${process.pid}_${Date.now()}`
  const username = `runtime_grant_${suffix}`
  const existingTable = `runtime_existing_${suffix}`
  const futureTable = `runtime_future_${suffix}`
  const existingFunction = `runtime_existing_function_${suffix}`
  const futureFunction = `runtime_future_function_${suffix}`
  const existingProcedure = `runtime_existing_procedure_${suffix}`
  const futureProcedure = `runtime_future_procedure_${suffix}`
  const db = createPrisma(databaseUrl)

  try {
    await db.$executeRawUnsafe(`CREATE ROLE "${username}" NOLOGIN`)
    await db.$executeRawUnsafe(
      `CREATE TABLE public."${existingTable}" (id serial PRIMARY KEY, value text NOT NULL)`,
    )
    await db.$executeRawUnsafe(
      `GRANT CREATE ON SCHEMA public TO "${username}"`,
    )
    await db.$executeRawUnsafe(
      `GRANT ALL PRIVILEGES ON TABLE public."${existingTable}" TO "${username}"`,
    )
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "${username}"`,
    )
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO "${username}"`,
    )
    await db.$executeRawUnsafe(`GRANT CREATE ON SCHEMA public TO PUBLIC`)
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC`,
    )
    await db.$executeRawUnsafe(
      `CREATE FUNCTION public."${existingFunction}"() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    )
    await db.$executeRawUnsafe(
      `CREATE PROCEDURE public."${existingProcedure}"() LANGUAGE sql AS 'SELECT 1'`,
    )

    await grantRuntimeDatabaseAccess(db, { databaseName, username })

    // This object is deliberately created after the grant to prove the owner's default ACL.
    await db.$executeRawUnsafe(
      `CREATE TABLE public."${futureTable}" (id serial PRIMARY KEY, value text NOT NULL)`,
    )
    await db.$executeRawUnsafe(
      `CREATE FUNCTION public."${futureFunction}"() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    )
    await db.$executeRawUnsafe(
      `CREATE PROCEDURE public."${futureProcedure}"() LANGUAGE sql AS 'SELECT 1'`,
    )

    const [privileges] = await db.$queryRawUnsafe<
      Array<{
        can_connect: boolean
        can_create: boolean
        can_create_temporary: boolean
        existing_dml: boolean
        existing_sequence: boolean
        future_dml: boolean
        future_sequence: boolean
        can_truncate: boolean
        future_can_truncate: boolean
        existing_function_execute: boolean
        future_function_execute: boolean
        existing_procedure_execute: boolean
        future_procedure_execute: boolean
      }>
    >(
      `SELECT
        has_database_privilege($1, current_database(), 'CONNECT') AS can_connect,
        has_database_privilege($1, current_database(), 'TEMPORARY') AS can_create_temporary,
        has_schema_privilege($1, 'public', 'CREATE') AS can_create,
        has_table_privilege($1, $2, 'SELECT')
          AND has_table_privilege($1, $2, 'INSERT')
          AND has_table_privilege($1, $2, 'UPDATE')
          AND has_table_privilege($1, $2, 'DELETE') AS existing_dml,
        has_sequence_privilege($1, $3, 'USAGE')
          AND has_sequence_privilege($1, $3, 'SELECT')
          AND has_sequence_privilege($1, $3, 'UPDATE') AS existing_sequence,
        has_table_privilege($1, $4, 'SELECT')
          AND has_table_privilege($1, $4, 'INSERT')
          AND has_table_privilege($1, $4, 'UPDATE')
          AND has_table_privilege($1, $4, 'DELETE') AS future_dml,
        has_sequence_privilege($1, $5, 'USAGE')
          AND has_sequence_privilege($1, $5, 'SELECT')
          AND has_sequence_privilege($1, $5, 'UPDATE') AS future_sequence,
        has_table_privilege($1, $2, 'TRUNCATE') AS can_truncate,
        has_table_privilege($1, $4, 'TRUNCATE') AS future_can_truncate,
        has_function_privilege($1, $6, 'EXECUTE') AS existing_function_execute,
        has_function_privilege($1, $7, 'EXECUTE') AS future_function_execute,
        has_function_privilege($1, $8, 'EXECUTE') AS existing_procedure_execute,
        has_function_privilege($1, $9, 'EXECUTE') AS future_procedure_execute`,
      username,
      `public.${existingTable}`,
      `public.${existingTable}_id_seq`,
      `public.${futureTable}`,
      `public.${futureTable}_id_seq`,
      `public.${existingFunction}()`,
      `public.${futureFunction}()`,
      `public.${existingProcedure}()`,
      `public.${futureProcedure}()`,
    )

    expect(privileges).toEqual({
      can_connect: true,
      can_create: false,
      can_create_temporary: false,
      existing_dml: true,
      existing_sequence: true,
      future_dml: true,
      future_sequence: true,
      can_truncate: false,
      future_can_truncate: false,
      existing_function_execute: false,
      future_function_execute: false,
      existing_procedure_execute: false,
      future_procedure_execute: false,
    })
  } finally {
    await db.$executeRawUnsafe(
      `DROP PROCEDURE IF EXISTS public."${futureProcedure}"()`,
    )
    await db.$executeRawUnsafe(
      `DROP PROCEDURE IF EXISTS public."${existingProcedure}"()`,
    )
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${futureFunction}"()`)
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${existingFunction}"()`)
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS public."${futureTable}"`)
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS public."${existingTable}"`)
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM "${username}"`,
    )
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "${username}"`,
    )
    await db.$executeRawUnsafe(
      'ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC',
    )
    await db.$executeRawUnsafe(`DROP OWNED BY "${username}"`)
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${username}"`)
    await db.$disconnect()
  }
})

test('runtime database reconciliation rolls back every revoke when a later grant fails', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
  const suffix = `${process.pid}_${Date.now()}`
  const username = `runtime_rollback_${suffix}`
  const tableName = `runtime_rollback_${suffix}`
  const db = createPrisma(databaseUrl)

  try {
    await db.$executeRawUnsafe(`CREATE ROLE "${username}" NOLOGIN`)
    await db.$executeRawUnsafe(
      `CREATE TABLE public."${tableName}" (id bigint PRIMARY KEY)`,
    )
    await db.$executeRawUnsafe(
      `GRANT SELECT ON TABLE public."${tableName}" TO "${username}"`,
    )

    const faultingDb = {
      $transaction: (operation: Parameters<typeof db.$transaction>[0]) =>
        db.$transaction(async (transaction) =>
          operation({
            ...transaction,
            $queryRawUnsafe: transaction.$queryRawUnsafe.bind(transaction),
            async $executeRawUnsafe(statement: string) {
              if (statement.startsWith('GRANT CONNECT')) {
                throw new Error('injected grant failure')
              }
              return transaction.$executeRawUnsafe(statement)
            },
          } as never),
        ),
    }

    await expect(
      grantRuntimeDatabaseAccess(faultingDb, { databaseName, username }),
    ).rejects.toThrow('injected grant failure')

    const [{ can_select: canSelect }] = await db.$queryRawUnsafe<
      Array<{ can_select: boolean }>
    >(
      `SELECT has_table_privilege($1, $2, 'SELECT') AS can_select`,
      username,
      `public.${tableName}`,
    )
    expect(canSelect).toBe(true)
  } finally {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS public."${tableName}"`)
    await db.$executeRawUnsafe(`DROP OWNED BY "${username}"`)
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${username}"`)
    await db.$disconnect()
  }
})

test('migration ownership preflight requires both public-schema privileges', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const parsed = new URL(databaseUrl)
  const suffix = `${process.pid}_${Date.now()}`
  const username = `migration_usage_${suffix}`
  const password = `migration-password-${suffix}`
  const admin = createPrisma(databaseUrl)
  let restricted: ReturnType<typeof createPrisma> | undefined

  try {
    await admin.$executeRawUnsafe(
      `CREATE ROLE "${username}" LOGIN PASSWORD '${password}'`,
    )
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${decodeURIComponent(parsed.pathname.slice(1))}" TO "${username}"`)
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${username}"`)
    await admin.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM "${username}"`)

    parsed.username = username
    parsed.password = password
    restricted = createPrisma(parsed.toString())
    const mismatches = await migrationSchemaOwnershipMismatches(restricted, {
      expectedOwner: username,
      requireCurrentUser: true,
    })

    expect(mismatches).toContainEqual({
      kind: 'schema privilege',
      identity: 'public',
      owner: username,
    })
  } finally {
    await restricted?.$disconnect()
    await admin.$executeRawUnsafe(`DROP OWNED BY "${username}"`)
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${username}"`)
    await admin.$disconnect()
  }
})

test('runtime database reconciliation refuses inherited roles', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
  const suffix = `${process.pid}_${Date.now()}`
  const username = `runtime_member_${suffix}`
  const inheritedRole = `runtime_parent_${suffix}`
  const db = createPrisma(databaseUrl)

  try {
    await db.$executeRawUnsafe(`CREATE ROLE "${username}" NOLOGIN`)
    await db.$executeRawUnsafe(`CREATE ROLE "${inheritedRole}" NOLOGIN`)
    await db.$executeRawUnsafe(`GRANT "${inheritedRole}" TO "${username}"`)

    await expect(
      grantRuntimeDatabaseAccess(db, { databaseName, username }),
    ).rejects.toThrow('inherits role')
  } finally {
    await db.$executeRawUnsafe(
      `REVOKE "${inheritedRole}" FROM "${username}"`,
    )
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${username}"`)
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${inheritedRole}"`)
    await db.$disconnect()
  }
})

test('legacy public schema ownership is inventoried and transferred explicitly', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const suffix = `${process.pid}_${Date.now()}`
  const legacyOwner = `legacy_owner_${suffix}`
  const migrationOwner = decodeURIComponent(new URL(databaseUrl).username)
  const tableName = `legacy_table_${suffix}`
  const typeName = `legacy_enum_${suffix}`
  const db = createPrisma(databaseUrl)

  try {
    await db.$executeRawUnsafe(`CREATE ROLE "${legacyOwner}" NOLOGIN`)
    await db.$executeRawUnsafe(
      `CREATE TABLE public."${tableName}" (id serial PRIMARY KEY)`,
    )
    await db.$executeRawUnsafe(
      `CREATE TYPE public."${typeName}" AS ENUM ('active')`,
    )
    await db.$executeRawUnsafe(
      `ALTER TABLE public."${tableName}" OWNER TO "${legacyOwner}"`,
    )
    await db.$executeRawUnsafe(
      `ALTER TYPE public."${typeName}" OWNER TO "${legacyOwner}"`,
    )

    await expect(
      assertMigrationSchemaOwnership(db, {
        expectedOwner: migrationOwner,
      }),
    ).rejects.toThrow(legacyOwner)

    const transferred = await transferMigrationSchemaOwnership(db, {
      legacyOwner,
      migrationOwner,
    })
    expect(transferred.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['table', 'sequence', 'type']),
    )
    await assertMigrationSchemaOwnership(db, {
      expectedOwner: migrationOwner,
    })
  } finally {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS public."${tableName}"`)
    await db.$executeRawUnsafe(`DROP TYPE IF EXISTS public."${typeName}"`)
    await db.$executeRawUnsafe(`DROP OWNED BY "${legacyOwner}"`)
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${legacyOwner}"`)
    await db.$disconnect()
  }
})
