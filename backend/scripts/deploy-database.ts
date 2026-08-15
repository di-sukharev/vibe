import 'dotenv/config'

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { createPrisma, type DbClient } from '../src/db'
import {
  assertLoginCapableAdmin,
  bootstrapAdmin,
  parseAdminSeedConfig,
} from '../src/modules/users/infrastructure/admin-bootstrap'

type DatabaseDeployDependencies = {
  assertAdmin(db: DbClient): Promise<void>
  assertMigrationOwnership(
    db: DbClient,
    input: { expectedOwner: string },
  ): Promise<void>
  bootstrap(
    db: DbClient,
    config: ReturnType<typeof parseAdminSeedConfig>,
  ): Promise<unknown>
  createDatabase(databaseUrl: string): DbClient
  grantRuntimeAccess(
    db: DbClient,
    input: { databaseName: string; username: string | null },
  ): Promise<void>
  log(message: string): void
  migrate(
    databaseUrl: string,
    source: Record<string, string | undefined>,
  ): void | Promise<void>
}

const defaultDependencies: DatabaseDeployDependencies = {
  assertAdmin: assertLoginCapableAdmin,
  assertMigrationOwnership: assertMigrationSchemaOwnership,
  bootstrap: bootstrapAdmin,
  createDatabase: createPrisma,
  grantRuntimeAccess: grantRuntimeDatabaseAccess,
  log: console.log,
  migrate(databaseUrl, source) {
    const migration = spawnSync('bun', ['run', 'prisma:deploy'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        ...source,
        DATABASE_URL: databaseUrl,
      },
      stdio: 'inherit',
    })
    if (migration.status !== 0) {
      throw new Error(`Database migration failed with status ${migration.status ?? 1}`)
    }
  },
}

export async function deployDatabase(
  source: Record<string, string | undefined>,
  dependencies: DatabaseDeployDependencies = defaultDependencies,
) {
  const config = databaseDeployConfig(source)
  const prisma = dependencies.createDatabase(config.databaseUrl)
  try {
    await dependencies.assertMigrationOwnership(prisma, {
      expectedOwner: config.migrationDatabaseUser,
    })
    await dependencies.migrate(config.databaseUrl, source)
    await dependencies.grantRuntimeAccess(prisma, {
      databaseName: config.databaseName,
      username: config.runtimeDatabaseUser,
    })
    if (config.seed !== null) {
      await dependencies.bootstrap(prisma, config.seed)
    }
    await dependencies.assertAdmin(prisma)
  } finally {
    await prisma.$disconnect()
  }
  dependencies.log('Database deployment completed with a login-capable administrator.')
}

function databaseDeployConfig(source: Record<string, string | undefined>) {
  const databaseUrl = source.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for database deployment')
  }

  const hasSeedEmail = Boolean(source.ADMIN_SEED_EMAIL?.trim())
  const hasSeedPassword = Boolean(source.ADMIN_SEED_PASSWORD)
  if (hasSeedEmail !== hasSeedPassword) {
    throw new Error(
      'ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be supplied together for initial deployment',
    )
  }

  return {
    databaseUrl,
    databaseName: databaseNameFromUrl(databaseUrl),
    migrationDatabaseUser: databaseUserFromUrl(databaseUrl),
    runtimeDatabaseUser: parseRuntimeDatabaseUser(
      source.DATABASE_RUNTIME_USER,
    ),
    seed:
      hasSeedEmail && hasSeedPassword
        ? parseAdminSeedConfig(source, { requirePassword: true })
        : null,
  }
}

function databaseUserFromUrl(databaseUrl: string) {
  const username = decodeURIComponent(new URL(databaseUrl).username)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(username)) {
    throw new Error(
      'DATABASE_URL must authenticate as a regular PostgreSQL role',
    )
  }
  return username
}

function parseRuntimeDatabaseUser(value: string | undefined) {
  const username = value?.trim()
  if (!username) return null
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(username)) {
    throw new Error(
      'DATABASE_RUNTIME_USER must be a lowercase PostgreSQL identifier',
    )
  }
  return username
}

function databaseNameFromUrl(databaseUrl: string) {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol')
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!databaseName || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error(
      'DATABASE_URL must select a database with a regular PostgreSQL identifier',
    )
  }
  return databaseName
}

export async function grantRuntimeDatabaseAccess(
  db: Pick<DbClient, '$transaction'>,
  {
    databaseName,
    username,
  }: { databaseName: string; username: string | null },
) {
  const database = quoteIdentifier(databaseName)
  const publicStatements = [
    `REVOKE TEMPORARY ON DATABASE ${database} FROM PUBLIC`,
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
    'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC',
    'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC',
    'REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC',
    // PostgreSQL's built-in PUBLIC function EXECUTE grant is global. A schema-scoped REVOKE can
    // only undo an earlier schema-scoped GRANT, so this one must also be global for future routines.
    'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  ]
  const role = username === null ? null : quoteIdentifier(username)
  const runtimeStatements =
    role === null
      ? []
      : [
          `REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${role}`,
          `REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${role}`,
          `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`,
          `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
          `REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM ${role}`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM ${role}`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM ${role}`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM ${role}`,
          `GRANT CONNECT ON DATABASE ${database} TO ${role}`,
          `GRANT USAGE ON SCHEMA public TO ${role}`,
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
          `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`,
        ]

  // PUBLIC is inherited by every login, so harden its current and default ACLs for both providers.
  // DigitalOcean additionally needs explicit DML grants because its Terraform provider cannot
  // express object privileges. Keep the preflight and every ACL change atomic so a failed
  // deployment cannot strand the active runtime after its old grants were revoked.
  await db.$transaction(
    async (transaction) => {
      if (username !== null) {
        const roleProblems = await runtimeRolePrivilegeProblems(transaction, {
          username,
        })
        if (roleProblems.length > 0) {
          throw new Error(
            `Runtime database role ${username} is not safely reconcilable: ${roleProblems
              .map(({ problem }) => problem)
              .join('; ')}. Remove inherited/elevated roles and transfer owned objects before deployment.`,
          )
        }
      }
      for (const statement of [...publicStatements, ...runtimeStatements]) {
        await transaction.$executeRawUnsafe(statement)
      }
    },
    { timeout: 60_000 },
  )
}

export async function runtimeRolePrivilegeProblems(
  db: Pick<DbClient, '$queryRawUnsafe'>,
  { username }: { username: string },
) {
  return db.$queryRawUnsafe<Array<{ problem: string }>>(
    `SELECT 'role does not exist' AS problem
       WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
     UNION ALL
     SELECT 'has elevated role attributes' AS problem
       FROM pg_roles
      WHERE rolname = $1
        AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
     UNION ALL
     SELECT format('inherits role %I', parent.rolname) AS problem
       FROM pg_auth_members membership
       JOIN pg_roles member ON member.oid = membership.member
       JOIN pg_roles parent ON parent.oid = membership.roleid
      WHERE member.rolname = $1
     UNION ALL
     SELECT format('owns database %I', database.datname) AS problem
       FROM pg_database database
       JOIN pg_roles owner ON owner.oid = database.datdba
      WHERE owner.rolname = $1
     UNION ALL
     SELECT format('owns schema %I', namespace.nspname) AS problem
       FROM pg_namespace namespace
       JOIN pg_roles owner ON owner.oid = namespace.nspowner
      WHERE owner.rolname = $1
        AND namespace.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
        AND namespace.nspname <> 'information_schema'
     UNION ALL
     SELECT format('owns relation %I.%I', namespace.nspname, relation.relname) AS problem
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       JOIN pg_roles owner ON owner.oid = relation.relowner
      WHERE owner.rolname = $1
        AND namespace.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
        AND namespace.nspname <> 'information_schema'
     UNION ALL
     SELECT format('owns routine %s', routine.oid::regprocedure) AS problem
       FROM pg_proc routine
       JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
       JOIN pg_roles owner ON owner.oid = routine.proowner
      WHERE owner.rolname = $1
        AND namespace.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
        AND namespace.nspname <> 'information_schema'
     UNION ALL
     SELECT format('owns type %I.%I', namespace.nspname, owned_type.typname) AS problem
       FROM pg_type owned_type
       JOIN pg_namespace namespace ON namespace.oid = owned_type.typnamespace
       JOIN pg_roles owner ON owner.oid = owned_type.typowner
      WHERE owner.rolname = $1
        AND owned_type.typtype IN ('d', 'e')
        AND namespace.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
        AND namespace.nspname <> 'information_schema'
     ORDER BY problem`,
    username,
  )
}

type SchemaOwnershipMismatch = {
  kind: string
  identity: string
  owner: string
}

export async function migrationSchemaOwnershipMismatches(
  db: Pick<DbClient, '$queryRawUnsafe'>,
  {
    expectedOwner,
    requireCurrentUser = false,
  }: { expectedOwner: string; requireCurrentUser?: boolean },
) {
  quoteIdentifier(expectedOwner)
  return db.$queryRawUnsafe<SchemaOwnershipMismatch[]>(
    `SELECT 'connection' AS kind, current_user AS identity, current_user AS owner
       WHERE $2::boolean AND current_user <> $1
     UNION ALL
     SELECT 'schema privilege' AS kind, 'public' AS identity, current_user AS owner
       WHERE $2::boolean
         AND (
           NOT has_schema_privilege(current_user, 'public', 'USAGE')
           OR NOT has_schema_privilege(current_user, 'public', 'CREATE')
         )
     UNION ALL
     SELECT 'schema' AS kind,
            format('%I', namespace.nspname) AS identity,
            pg_get_userbyid(namespace.nspowner) AS owner
       FROM pg_namespace namespace
      WHERE namespace.nspname = 'public'
        AND pg_get_userbyid(namespace.nspowner) NOT IN ($1, 'pg_database_owner')
     UNION ALL
     SELECT CASE relation.relkind
              WHEN 'S' THEN 'sequence'
              WHEN 'v' THEN 'view'
              WHEN 'm' THEN 'materialized view'
              WHEN 'f' THEN 'foreign table'
              ELSE 'table'
            END AS kind,
            format('%I.%I', namespace.nspname, relation.relname) AS identity,
            pg_get_userbyid(relation.relowner) AS owner
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND pg_get_userbyid(relation.relowner) <> $1
        AND NOT EXISTS (
          SELECT 1
            FROM pg_depend dependency
           WHERE dependency.classid = 'pg_class'::regclass
             AND dependency.objid = relation.oid
             AND dependency.deptype = 'e'
        )
     UNION ALL
     SELECT CASE routine.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind,
            routine.oid::regprocedure::text AS identity,
            pg_get_userbyid(routine.proowner) AS owner
       FROM pg_proc routine
       JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
        AND pg_get_userbyid(routine.proowner) <> $1
        AND NOT EXISTS (
          SELECT 1
            FROM pg_depend dependency
           WHERE dependency.classid = 'pg_proc'::regclass
             AND dependency.objid = routine.oid
             AND dependency.deptype = 'e'
        )
     UNION ALL
     SELECT 'type' AS kind,
            format('%I.%I', namespace.nspname, owned_type.typname) AS identity,
            pg_get_userbyid(owned_type.typowner) AS owner
       FROM pg_type owned_type
       JOIN pg_namespace namespace ON namespace.oid = owned_type.typnamespace
      WHERE namespace.nspname = 'public'
        AND owned_type.typtype IN ('d', 'e')
        AND pg_get_userbyid(owned_type.typowner) <> $1
        AND NOT EXISTS (
          SELECT 1
            FROM pg_depend dependency
           WHERE dependency.classid = 'pg_type'::regclass
             AND dependency.objid = owned_type.oid
             AND dependency.deptype = 'e'
        )
     ORDER BY kind, identity`,
    expectedOwner,
    requireCurrentUser,
  )
}

export async function assertMigrationSchemaOwnership(
  db: Pick<DbClient, '$queryRawUnsafe'>,
  { expectedOwner }: { expectedOwner: string },
) {
  const mismatches = await migrationSchemaOwnershipMismatches(db, {
    expectedOwner,
    requireCurrentUser: true,
  })
  if (mismatches.length === 0) return

  const preview = mismatches
    .slice(0, 8)
    .map(({ kind, identity, owner }) => `${kind} ${identity} is owned by ${owner}`)
    .join('; ')
  throw new Error(
    `Database migration ownership preflight failed for ${expectedOwner}: ${preview}. Run the documented db:adopt-owner inventory and transfer before the first Terraform-managed migration.`,
  )
}

type OwnershipTransferRow = SchemaOwnershipMismatch & { statement: string }

export async function transferMigrationSchemaOwnership(
  db: Pick<DbClient, '$queryRawUnsafe' | '$transaction'>,
  {
    legacyOwner,
    migrationOwner,
  }: { legacyOwner: string; migrationOwner: string },
) {
  quoteIdentifier(legacyOwner)
  quoteIdentifier(migrationOwner)
  if (legacyOwner === migrationOwner) {
    throw new Error('Legacy and migration owners must be different roles')
  }

  const mismatches = await migrationSchemaOwnershipMismatches(db, {
    expectedOwner: migrationOwner,
  })
  const unexpectedOwners = [
    ...new Set(
      mismatches
        .map(({ owner }) => owner)
        .filter((owner) => owner !== legacyOwner),
    ),
  ]
  if (unexpectedOwners.length > 0) {
    throw new Error(
      `Ownership transfer is incomplete: public schema also contains objects owned by ${unexpectedOwners.join(', ')}`,
    )
  }

  const transferRows = await db.$queryRawUnsafe<OwnershipTransferRow[]>(
    `SELECT 'schema' AS kind,
            format('%I', namespace.nspname) AS identity,
            pg_get_userbyid(namespace.nspowner) AS owner,
            format('ALTER SCHEMA %I OWNER TO %I', namespace.nspname, $2::text) AS statement,
            50 AS sort_order
       FROM pg_namespace namespace
      WHERE namespace.nspname = 'public'
        AND pg_get_userbyid(namespace.nspowner) = $1
     UNION ALL
     SELECT CASE relation.relkind
              WHEN 'S' THEN 'sequence'
              WHEN 'v' THEN 'view'
              WHEN 'm' THEN 'materialized view'
              WHEN 'f' THEN 'foreign table'
              ELSE 'table'
            END AS kind,
            format('%I.%I', namespace.nspname, relation.relname) AS identity,
            pg_get_userbyid(relation.relowner) AS owner,
            format(
              CASE relation.relkind
                WHEN 'S' THEN 'ALTER SEQUENCE %I.%I OWNER TO %I'
                WHEN 'v' THEN 'ALTER VIEW %I.%I OWNER TO %I'
                WHEN 'm' THEN 'ALTER MATERIALIZED VIEW %I.%I OWNER TO %I'
                WHEN 'f' THEN 'ALTER FOREIGN TABLE %I.%I OWNER TO %I'
                ELSE 'ALTER TABLE %I.%I OWNER TO %I'
              END,
              namespace.nspname,
              relation.relname,
              $2::text
            ) AS statement,
            CASE relation.relkind WHEN 'S' THEN 20 ELSE 10 END AS sort_order
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND pg_get_userbyid(relation.relowner) = $1
        AND NOT EXISTS (
          SELECT 1
            FROM pg_depend dependency
           WHERE dependency.classid = 'pg_class'::regclass
             AND dependency.objid = relation.oid
             AND dependency.deptype = 'e'
        )
     UNION ALL
     SELECT CASE routine.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind,
            routine.oid::regprocedure::text AS identity,
            pg_get_userbyid(routine.proowner) AS owner,
            format(
              CASE routine.prokind
                WHEN 'p' THEN 'ALTER PROCEDURE %s OWNER TO %I'
                WHEN 'a' THEN 'ALTER AGGREGATE %s OWNER TO %I'
                ELSE 'ALTER FUNCTION %s OWNER TO %I'
              END,
              routine.oid::regprocedure,
              $2::text
            ) AS statement,
            30 AS sort_order
       FROM pg_proc routine
       JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
        AND pg_get_userbyid(routine.proowner) = $1
        AND NOT EXISTS (
          SELECT 1
            FROM pg_depend dependency
           WHERE dependency.classid = 'pg_proc'::regclass
             AND dependency.objid = routine.oid
             AND dependency.deptype = 'e'
        )
     UNION ALL
     SELECT 'type' AS kind,
            format('%I.%I', namespace.nspname, owned_type.typname) AS identity,
            pg_get_userbyid(owned_type.typowner) AS owner,
            format('ALTER TYPE %I.%I OWNER TO %I', namespace.nspname, owned_type.typname, $2::text) AS statement,
            40 AS sort_order
       FROM pg_type owned_type
       JOIN pg_namespace namespace ON namespace.oid = owned_type.typnamespace
      WHERE namespace.nspname = 'public'
        AND owned_type.typtype IN ('d', 'e')
        AND pg_get_userbyid(owned_type.typowner) = $1
        AND NOT EXISTS (
          SELECT 1
            FROM pg_depend dependency
           WHERE dependency.classid = 'pg_type'::regclass
             AND dependency.objid = owned_type.oid
             AND dependency.deptype = 'e'
        )
     ORDER BY sort_order, kind, identity`,
    legacyOwner,
    migrationOwner,
  )

  await db.$transaction(async (transaction) => {
    for (const row of transferRows) {
      await transaction.$executeRawUnsafe(row.statement)
    }
  })

  const remaining = await migrationSchemaOwnershipMismatches(db, {
    expectedOwner: migrationOwner,
  })
  if (remaining.length > 0) {
    throw new Error('Ownership transfer completed with unexpected leftovers')
  }
  return transferRows.map(({ kind, identity, owner }) => ({
    kind,
    identity,
    owner,
  }))
}

function quoteIdentifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) {
    throw new Error('Unsafe PostgreSQL identifier')
  }
  return `"${value}"`
}

if (import.meta.main) {
  await deployDatabase(process.env)
}
