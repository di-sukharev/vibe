import 'dotenv/config'

import { createPrisma, type DbClient } from '../src/db'
import {
  migrationSchemaOwnershipMismatches,
  transferMigrationSchemaOwnership,
} from './deploy-database'

type AdoptionDependencies = {
  createDatabase(databaseUrl: string): DbClient
  log(message: string): void
}

const defaultDependencies: AdoptionDependencies = {
  createDatabase: createPrisma,
  log: console.log,
}

export function databaseOwnerAdoptionConfig(
  source: Record<string, string | undefined>,
  arguments_: string[],
) {
  const databaseUrl = source.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required and must authenticate as the legacy owner or another role allowed to transfer ownership',
    )
  }
  const legacyOwner = regularRole(source.DATABASE_LEGACY_OWNER, 'DATABASE_LEGACY_OWNER')
  const migrationOwner = regularRole(
    source.DATABASE_MIGRATION_USER,
    'DATABASE_MIGRATION_USER',
  )
  if (legacyOwner === migrationOwner) {
    throw new Error('Legacy and migration owners must be different roles')
  }

  const normalizedArguments = arguments_.filter((argument) => argument !== '--')
  const unknownArguments = normalizedArguments.filter(
    (argument) => argument !== '--apply',
  )
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown db:adopt-owner option: ${unknownArguments[0]}`)
  }
  const apply = normalizedArguments.includes('--apply')
  const expectedConfirmation = `${legacyOwner}->${migrationOwner}`
  if (
    apply &&
    source.CONFIRM_DATABASE_OWNER_ADOPTION !== expectedConfirmation
  ) {
    throw new Error(
      `Set CONFIRM_DATABASE_OWNER_ADOPTION=${expectedConfirmation} for the reviewed one-time transfer`,
    )
  }

  return { apply, databaseUrl, legacyOwner, migrationOwner }
}

export async function adoptDatabaseOwner(
  source: Record<string, string | undefined>,
  arguments_: string[],
  dependencies: AdoptionDependencies = defaultDependencies,
) {
  const config = databaseOwnerAdoptionConfig(source, arguments_)
  const db = dependencies.createDatabase(config.databaseUrl)
  try {
    const mismatches = await migrationSchemaOwnershipMismatches(db, {
      expectedOwner: config.migrationOwner,
    })
    const unexpectedOwners = [
      ...new Set(
        mismatches
          .map(({ owner }) => owner)
          .filter((owner) => owner !== config.legacyOwner),
      ),
    ]
    if (unexpectedOwners.length > 0) {
      throw new Error(
        `Refusing a partial transfer: public schema also contains objects owned by ${unexpectedOwners.join(', ')}`,
      )
    }

    dependencies.log(
      JSON.stringify(
        {
          mode: config.apply ? 'apply' : 'inventory',
          legacyOwner: config.legacyOwner,
          migrationOwner: config.migrationOwner,
          objects: mismatches,
        },
        null,
        2,
      ),
    )
    if (!config.apply || mismatches.length === 0) return mismatches

    const transferred = await transferMigrationSchemaOwnership(db, config)
    dependencies.log(
      `Transferred ${transferred.length} public-schema object(s) to ${config.migrationOwner}.`,
    )
    return transferred
  } finally {
    await db.$disconnect()
  }
}

function regularRole(value: string | undefined, name: string) {
  const role = value?.trim()
  if (!role || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(role)) {
    throw new Error(`${name} must be a regular PostgreSQL role name`)
  }
  return role
}

if (import.meta.main) {
  await adoptDatabaseOwner(process.env, process.argv.slice(2))
}
