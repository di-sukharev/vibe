/**
 * Decides what to do with an email that already belongs to someone when seeding the development
 * user, pulled out so the rule can be unit tested without a database. `updateExistingDevelopmentUser`
 * runs this same decision twice - once before taking the lock, once after re-reading the row inside
 * it - so both call sites agree on the outcome by construction instead of by copy-pasted `if`s.
 */
export type DevelopmentUserRotation = 'wrong_role' | 'noop' | 'rotate'

export function decideDevelopmentUserRotation(input: {
  role: string
  passwordMatches: boolean
}): DevelopmentUserRotation {
  if (input.role !== 'user') {
    return 'wrong_role'
  }
  if (input.passwordMatches) {
    return 'noop'
  }
  return 'rotate'
}
