import { describe, expect, test } from 'bun:test'
import { decodeJwt, SignJWT } from 'jose'

import { signAccessToken, verifyAccessToken } from './access-tokens'

const env = {
  JWT_SECRET: '12345678901234567890123456789012',
  ACCESS_TOKEN_TTL_SECONDS: 60,
}

describe('access tokens', () => {
  test('signs and verifies session-scoped JWT payloads', async () => {
    const token = await signAccessToken(
      {
        sub: 'user_1',
        sessionId: 'session_1',
        email: 'user@example.com',
      },
      env,
    )

    await expect(verifyAccessToken(token, env)).resolves.toEqual({
      sub: 'user_1',
      sessionId: 'session_1',
      email: 'user@example.com',
    })
    expect(decodeJwt(token)).not.toHaveProperty('role')
  })

  test('rejects JWTs signed with any algorithm except HS256', async () => {
    const token = await new SignJWT({
      sessionId: 'session_1',
      email: 'user@example.com',
    })
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject('user_1')
      .setExpirationTime('1m')
      .sign(new TextEncoder().encode(env.JWT_SECRET))

    await expect(verifyAccessToken(token, env)).rejects.toThrow()
  })
})
