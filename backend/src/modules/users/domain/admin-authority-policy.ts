import type { UserRole } from '@web-app-demo/contracts'

/**
 * Decides what `updateExistingAdmin` should write, pulled out of the Prisma transaction so it can
 * be unit tested without a database.
 */
export type AdminAuthorityUpdate = {
  role: 'admin'
  passwordHash?: string
}

export function decideAdminAuthorityUpdate(input: {
  existingRole: UserRole
  passwordMatches: boolean
  requestedPasswordProvided: boolean
  requestedPasswordHash: string | undefined
}): AdminAuthorityUpdate | null {
  const passwordChanges = input.requestedPasswordProvided && !input.passwordMatches
  const promotesToAdmin = input.existingRole !== 'admin'

  if (!promotesToAdmin && !passwordChanges) {
    return null
  }

  return {
    role: 'admin',
    ...(passwordChanges ? { passwordHash: input.requestedPasswordHash! } : {}),
  }
}
