import { describe, expect, test } from 'bun:test'

import {
  createRefreshToken,
  deriveRotatedRefreshToken,
  hashRefreshToken,
  hashRefreshTokenFamily,
} from './refresh-tokens'

describe('refresh tokens', () => {
  test('creates opaque tokens and stable hashes', () => {
    const secret = 'refresh-create-test-secret-at-least-32-characters'
    const refreshToken = createRefreshToken(secret)
    const hash = hashRefreshToken(refreshToken)

    expect(refreshToken.length).toBeGreaterThanOrEqual(32)
    expect(hash).toHaveLength(64)
    expect(hashRefreshToken(refreshToken)).toBe(hash)
    expect(hashRefreshToken(createRefreshToken(secret))).not.toBe(hash)
  })

  test('derives one opaque successor for concurrent uses of the same credential', () => {
    const secret = 'refresh-rotation-test-secret-at-least-32-characters'
    const successor = deriveRotatedRefreshToken('current-token', secret)

    expect(successor.length).toBeGreaterThanOrEqual(32)
    expect(successor).not.toBe('current-token')
    expect(deriveRotatedRefreshToken('current-token', secret)).toBe(successor)
    expect(deriveRotatedRefreshToken('different-token', secret)).not.toBe(successor)
  })

  test('keeps one secret family locator across arbitrarily deep rotations', () => {
    const secret = 'refresh-family-test-secret-at-least-32-characters'
    const initial = createRefreshToken(secret)
    const firstSuccessor = deriveRotatedRefreshToken(initial, secret)
    const secondSuccessor = deriveRotatedRefreshToken(firstSuccessor, secret)

    expect(hashRefreshTokenFamily(firstSuccessor, secret)).toBe(
      hashRefreshTokenFamily(initial, secret),
    )
    expect(hashRefreshTokenFamily(secondSuccessor, secret)).toBe(
      hashRefreshTokenFamily(initial, secret),
    )
    expect(hashRefreshTokenFamily(createRefreshToken(secret), secret)).not.toBe(
      hashRefreshTokenFamily(initial, secret),
    )
  })

  test('a leaked family locator alone cannot claim the family it names', () => {
    const secret = 'refresh-family-forgery-test-secret-at-least-32-characters'
    const issued = createRefreshToken(secret)
    const [familyId] = issued.split('.')

    // Both shapes are what an attacker can build from the public half of a leaked token: the
    // two-component token this format used to have, and a three-component one with a guessed tag.
    const withoutTag = `${familyId}.${'f'.repeat(43)}`
    const withForgedTag = `${familyId}.${'f'.repeat(43)}.${'g'.repeat(43)}`

    expect(hashRefreshTokenFamily(withoutTag, secret)).not.toBe(
      hashRefreshTokenFamily(issued, secret),
    )
    expect(hashRefreshTokenFamily(withForgedTag, secret)).not.toBe(
      hashRefreshTokenFamily(issued, secret),
    )
  })
})
