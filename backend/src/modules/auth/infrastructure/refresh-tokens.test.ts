import { describe, expect, test } from 'bun:test'

import { createRefreshToken, hashRefreshToken } from './refresh-tokens'

describe('refresh tokens', () => {
  test('creates opaque tokens and stable hashes', () => {
    const refreshToken = createRefreshToken()
    const hash = hashRefreshToken(refreshToken)

    expect(refreshToken.length).toBeGreaterThanOrEqual(32)
    expect(hash).toHaveLength(64)
    expect(hashRefreshToken(refreshToken)).toBe(hash)
    expect(hashRefreshToken(createRefreshToken())).not.toBe(hash)
  })
})
