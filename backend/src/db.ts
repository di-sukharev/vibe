import { PrismaPg } from '@prisma/adapter-pg'

import { Prisma, PrismaClient } from './generated/prisma/client'

export function createPrisma(connectionString: string) {
  const adapter = new PrismaPg({ connectionString: normalizePgConnectionString(connectionString) })
  return new PrismaClient({ adapter })
}

export type DbClient = ReturnType<typeof createPrisma>

// Push admission intentionally holds its per-user fence through the provider
// call. Authority transitions acquire that target fence before their short
// global role-policy section, so this budget always covers the complete send
// fence plus the final revocation work.
export const maximumPushSendFenceTransactionMs = 120_000
export const userAuthorityTransitionTransactionOptions = {
  timeout: maximumPushSendFenceTransactionMs + 15_000,
} as const

export function acquireUserRoleMutationLock(
  prisma: Pick<DbClient, '$executeRaw'>,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('user-role-mutations', 0))`,
  )
}

export function acquireUserAuthenticationAuthorityLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  userId: string,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-authority:${userId}`}, 0))`,
  )
}

export function acquirePushTokenUserLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  userId: string,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-tokens:${userId}`}, 0))`,
  )
}

export function acquirePushTokenValueLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  expoPushToken: string,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-token:${expoPushToken}`}, 0))`,
  )
}

export function acquirePushInstallationLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  installationId: string,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-installation:${installationId}`}, 0))`,
  )
}

export function normalizePgConnectionString(connectionString: string) {
  const url = new URL(connectionString)
  const sslMode = url.searchParams.get('sslmode')
  const useLibpqCompat = url.searchParams.get('uselibpqcompat')

  if (sslMode === 'require' && useLibpqCompat === null) {
    url.searchParams.set('uselibpqcompat', 'true')
  }

  return url.toString()
}
