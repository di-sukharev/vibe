import type { DbClient } from '../src/db'
import {
  bootstrapDevelopmentAccounts,
  type DevelopmentSeedAccounts,
} from '../src/modules/users/infrastructure/development-bootstrap'

// The seed deliberately grants no entitlement: reaching the app must not depend on a
// subscription, so products that never add billing still get a working demo login.
export async function bootstrapDevelopmentData(
  db: DbClient,
  accounts: DevelopmentSeedAccounts,
) {
  const seeded = await bootstrapDevelopmentAccounts(db, accounts)

  return {
    admin: { email: seeded.admin.email, role: seeded.admin.role },
    user: { email: seeded.user.email, role: seeded.user.role },
  }
}
