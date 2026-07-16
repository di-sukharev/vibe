import { describe, expect, test } from 'bun:test'

import {
  createRefreshToken,
  deriveRotatedRefreshToken,
  hashRefreshToken,
  hashRefreshTokenFamily,
} from './refresh-tokens'

describe('refresh tokens', () => {
  test('creates opaque tokens and stable hashes', () => {
    const refreshToken = createRefreshToken()
    const hash = hashRefreshToken(refreshToken)

    expect(refreshToken.length).toBeGreaterThanOrEqual(32)
    expect(hash).toHaveLength(64)
    expect(hashRefreshToken(refreshToken)).toBe(hash)
    expect(hashRefreshToken(createRefreshToken())).not.toBe(hash)
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
    const initial = createRefreshToken()
    const firstSuccessor = deriveRotatedRefreshToken(initial, secret)
    const secondSuccessor = deriveRotatedRefreshToken(firstSuccessor, secret)

    expect(hashRefreshTokenFamily(firstSuccessor, secret)).toBe(
      hashRefreshTokenFamily(initial, secret),
    )
    expect(hashRefreshTokenFamily(secondSuccessor, secret)).toBe(
      hashRefreshTokenFamily(initial, secret),
    )
    expect(hashRefreshTokenFamily(createRefreshToken(), secret)).not.toBe(
      hashRefreshTokenFamily(initial, secret),
    )
  })
})
