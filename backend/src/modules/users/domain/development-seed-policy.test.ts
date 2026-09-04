import { describe, expect, test } from 'bun:test'

import { decideDevelopmentUserRotation } from './development-seed-policy'

describe('decideDevelopmentUserRotation', () => {
  test('refuses an email that belongs to an administrator', () => {
    expect(decideDevelopmentUserRotation({ role: 'admin', passwordMatches: false })).toBe(
      'wrong_role',
    )
  })

  test('does nothing when the password already matches', () => {
    expect(decideDevelopmentUserRotation({ role: 'user', passwordMatches: true })).toBe('noop')
  })

  test('rotates the password when it does not match', () => {
    expect(decideDevelopmentUserRotation({ role: 'user', passwordMatches: false })).toBe('rotate')
  })
})
