import {
  acquirePushTokenUserLock,
  acquireUserAuthenticationAuthorityLock,
  type DbClient,
  userAuthorityTransitionTransactionOptions,
} from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import type { AdminSeedConfig } from '../domain/admin-seed-config'

export { parseAdminSeedConfig } from '../domain/admin-seed-config'

export async function bootstrapAdmin(
  db: DbClient,
  config: AdminSeedConfig,
) {
  const requestedPasswordHash =
    config.password === null
      ? undefined
      : await Bun.password.hash(config.password, { algorithm: 'argon2id' })

  const admin = await upsertAdmin(db, config, requestedPasswordHash)

  return {
    email: admin.email,
    locked: admin.passwordHash === null,
  }
}

async function upsertAdmin(
  db: DbClient,
  config: AdminSeedConfig,
  requestedPasswordHash: string | undefined,
) {
  for (;;) {
    const existing = await db.user.findUnique({
      where: { email: config.email },
      select: { id: true },
    })
    if (existing) {
      return updateExistingAdmin(db, existing.id, config, requestedPasswordHash)
    }

    try {
      return await db.user.create({
        data: {
          email: config.email,
          displayName: 'Administrator',
          passwordHash: requestedPasswordHash ?? null,
          role: 'admin',
        },
        select: { email: true, passwordHash: true },
      })
    } catch (error) {
      if (!isUniqueConstraintFailure(error)) throw error
      // Another bootstrap created this email; retry through the fenced update path.
    }
  }
}

function updateExistingAdmin(
  db: DbClient,
  userId: string,
  config: AdminSeedConfig,
  requestedPasswordHash: string | undefined,
) {
  return db.$transaction(async (tx) => {
    await acquirePushTokenUserLock(tx, userId)
    await acquireUserAuthenticationAuthorityLock(tx, userId)
    const existing = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, passwordHash: true, role: true },
    })
    const passwordMatches =
      config.password !== null &&
      existing.passwordHash !== null &&
      await matchesPassword(config.password, existing.passwordHash)
    const passwordChanges = config.password !== null && !passwordMatches
    const changesAuthenticationAuthority = existing.role !== 'admin' || passwordChanges
    if (!changesAuthenticationAuthority) {
      return { email: config.email, passwordHash: existing.passwordHash }
    }
    const now = new Date()

    const updated = await tx.user.update({
      where: { id: existing.id },
      data: {
        role: 'admin',
        ...(passwordChanges ? { passwordHash: requestedPasswordHash! } : {}),
      },
      select: { email: true, passwordHash: true },
    })
    await tx.authSession.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: now },
    })
    await tx.passwordResetToken.updateMany({
      where: { userId: existing.id, usedAt: null },
      data: { usedAt: now },
    })
    await tx.pushToken.deleteMany({
      where: { userId: existing.id },
    })
    return updated
  }, userAuthorityTransitionTransactionOptions)
}

function isUniqueConstraintFailure(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function matchesPassword(password: string, passwordHash: string) {
  try {
    return await Bun.password.verify(password, passwordHash)
  } catch {
    return false
  }
}

export async function assertLoginCapableAdmin(db: DbClient) {
  const count = await db.user.count({
    where: {
      role: 'admin',
      passwordHash: { not: null },
    },
  })
  if (count === 0) {
    throw new Error(
      'Deployment requires at least one administrator with a password credential',
    )
  }
}
