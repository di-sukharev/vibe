import { describe, expect, test } from 'bun:test'

import { databaseOwnerAdoptionConfig } from './adopt-database-owner'

describe('database owner adoption command', () => {
  const source = {
    DATABASE_URL: 'postgresql://legacy:secret@localhost:5432/product',
    DATABASE_LEGACY_OWNER: 'legacy_owner',
    DATABASE_MIGRATION_USER: 'product_migration',
  }

  test('defaults to a read-only inventory', () => {
    expect(databaseOwnerAdoptionConfig(source, [])).toMatchObject({
      apply: false,
      legacyOwner: 'legacy_owner',
      migrationOwner: 'product_migration',
    })
  })

  test('requires an exact explicit confirmation before ownership changes', () => {
    expect(() => databaseOwnerAdoptionConfig(source, ['--apply'])).toThrow(
      'CONFIRM_DATABASE_OWNER_ADOPTION=legacy_owner->product_migration',
    )
    expect(
      databaseOwnerAdoptionConfig(
        {
          ...source,
          CONFIRM_DATABASE_OWNER_ADOPTION:
            'legacy_owner->product_migration',
        },
        ['--apply'],
      ),
    ).toMatchObject({ apply: true })
  })
})
