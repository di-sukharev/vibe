import { describe, expect, test } from 'bun:test'

import { decideAdminAuthorityUpdate } from './admin-authority-policy'

describe('decideAdminAuthorityUpdate', () => {
  test('does nothing for an already-admin account whose password matches', () => {
    expect(
      decideAdminAuthorityUpdate({
        existingRole: 'admin',
        passwordMatches: true,
        requestedPasswordProvided: true,
        requestedPasswordHash: 'hash',
      }),
    ).toBeNull()
  })

  test('does nothing for an already-admin account when no password was requested', () => {
    expect(
      decideAdminAuthorityUpdate({
        existingRole: 'admin',
        passwordMatches: false,
        requestedPasswordProvided: false,
        requestedPasswordHash: undefined,
      }),
    ).toBeNull()
  })

  test('rotates the password of an existing admin without touching displayName', () => {
    expect(
      decideAdminAuthorityUpdate({
        existingRole: 'admin',
        passwordMatches: false,
        requestedPasswordProvided: true,
        requestedPasswordHash: 'new-hash',
      }),
    ).toEqual({ role: 'admin', passwordHash: 'new-hash' })
  })

  test('promotes a non-admin account and resets its display name to Administrator', () => {
    expect(
      decideAdminAuthorityUpdate({
        existingRole: 'user',
        passwordMatches: false,
        requestedPasswordProvided: false,
        requestedPasswordHash: undefined,
      }),
    ).toEqual({ role: 'admin' })
  })

  test('promotes a non-admin account and rotates its password in the same write', () => {
    expect(
      decideAdminAuthorityUpdate({
        existingRole: 'user',
        passwordMatches: false,
        requestedPasswordProvided: true,
        requestedPasswordHash: 'new-hash',
      }),
    ).toEqual({ role: 'admin', passwordHash: 'new-hash' })
  })
})
