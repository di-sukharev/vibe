import {
  acquireUserAuthenticationAuthorityLock,
  type DbClient,
  userAuthorityTransitionTransactionOptions,
} from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import { decideDevelopmentUserRotation } from '../domain/development-seed-policy'
import { bootstrapAdmin } from './admin-bootstrap'

export type DevelopmentSeedAccounts = {
  admin: DevelopmentSeedCredentials
  user: DevelopmentSeedCredentials
}

type DevelopmentSeedCredentials = {
  email: string
  password: string
}

export async function bootstrapDevelopmentAccounts(
  db: DbClient,
  accounts: DevelopmentSeedAccounts,
) {
  const admin = await bootstrapAdmin(db, accounts.admin)
  const user = await bootstrapDevelopmentUser(db, accounts.user)

  return {
    admin: { email: admin.email, role: 'admin' as const },
    user: { email: user.email, id: user.id, role: 'user' as const },
  }
}

async function bootstrapDevelopmentUser(
  db: DbClient,
  credentials: DevelopmentSeedAccounts['user'],
) {
  for (;;) {
    const existing = await db.user.findUnique({
      where: { email: credentials.email },
      select: { id: true, passwordHash: true, role: true },
    })
    if (existing) {
      return updateExistingDevelopmentUser(db, existing, credentials)
    }

    try {
      return await db.user.create({
        data: {
          displayName: 'Development User',
          email: credentials.email,
          passwordHash: await Bun.password.hash(credentials.password, { algorithm: 'argon2id' }),
          role: 'user',
        },
        select: { email: true, id: true },
      })
    } catch (error) {
      if (!isUniqueConstraintFailure(error)) throw error
      // Another seed created this email; retry through the fenced update path.
    }
  }
}

async function updateExistingDevelopmentUser(
  db: DbClient,
  existing: { id: string; passwordHash: string | null; role: string },
  credentials: DevelopmentSeedAccounts['user'],
) {
  const passwordMatchesBeforeLock =
    existing.passwordHash !== null &&
    await matchesPassword(credentials.password, existing.passwordHash)
  const outcome = decideDevelopmentUserRotation({
    role: existing.role,
    passwordMatches: passwordMatchesBeforeLock,
  })
  if (outcome === 'wrong_role') {
    throw new Error(`Development user email ${credentials.email} belongs to an administrator`)
  }
  if (outcome === 'noop') {
    return { email: credentials.email, id: existing.id }
  }

  const requestedPasswordHash = await Bun.password.hash(credentials.password, {
    algorithm: 'argon2id',
  })
  return db.$transaction(async (tx) => {
    await acquireUserAuthenticationAuthorityLock(tx, existing.id)
    const current = await tx.user.findUniqueOrThrow({
      where: { id: existing.id },
      select: { passwordHash: true, role: true },
    })
    const passwordMatches =
      current.passwordHash !== null &&
      await matchesPassword(credentials.password, current.passwordHash)
    const raceOutcome = decideDevelopmentUserRotation({ role: current.role, passwordMatches })
    if (raceOutcome === 'wrong_role') {
      throw new Error(`Development user email ${credentials.email} belongs to an administrator`)
    }
    if (raceOutcome === 'noop') {
      return { email: credentials.email, id: existing.id }
    }

    const now = new Date()
    const updated = await tx.user.update({
      where: { id: existing.id },
      data: { passwordHash: requestedPasswordHash },
      select: { email: true, id: true },
    })
    await tx.authSession.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: now },
    })
    await tx.passwordResetToken.updateMany({
      where: { userId: existing.id, usedAt: null },
      data: { usedAt: now },
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
