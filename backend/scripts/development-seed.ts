import type { DbClient } from '../src/db'
import { bootstrapDevelopmentEntitlement } from '../src/modules/billing/infrastructure/development-entitlement'
import {
  bootstrapDevelopmentAccounts,
  type DevelopmentSeedAccounts,
} from '../src/modules/users/infrastructure/development-bootstrap'

export async function bootstrapDevelopmentData(
  db: DbClient,
  accounts: DevelopmentSeedAccounts,
) {
  const seeded = await bootstrapDevelopmentAccounts(db, accounts)
  await bootstrapDevelopmentEntitlement(db, seeded.user.id)

  return {
    admin: { email: seeded.admin.email, role: seeded.admin.role },
    user: { email: seeded.user.email, role: seeded.user.role },
  }
}
