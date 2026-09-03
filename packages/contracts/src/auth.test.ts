import { describe, expect, test } from 'bun:test'

import type { UserDto } from './index'
import {
  apiErrorSchema,
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  emailSchema,
  loginRequestSchema,
  meResponseSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestResponseSchema,
  passwordResetRequestSchema,
  passwordSchema,
  registerRequestSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
  userSchema,
} from './index'

const validUser = {
  id: 'user_1',
  email: 'user@example.com',
  displayName: null,
  role: 'user',
  createdAt: '2026-05-11T00:00:00.000Z',
} satisfies UserDto

describe('auth contracts', () => {
  test('normalizes registration and login input', () => {
    expect(
      registerRequestSchema.parse({
        email: ' USER@Example.COM ',
        password: 'password123',
        displayName: ' Jane ',
      }),
    ).toEqual({
      email: 'user@example.com',
      password: 'password123',
      displayName: 'Jane',
    })

    expect(
      registerRequestSchema.parse({
        email: 'user@example.com',
        password: 'password123',
        displayName: '',
      }),
    ).toEqual({
      email: 'user@example.com',
      password: 'password123',
      displayName: undefined,
    })

    expect(
      loginRequestSchema.parse({
        email: ' USER@Example.COM ',
        password: 'password123',
      }),
    ).toEqual({
      email: 'user@example.com',
      password: 'password123',
    })
  })

  test('rejects invalid auth request payloads', () => {
    expect(() =>
      registerRequestSchema.parse({
        email: 'not-an-email',
        password: 'short',
        displayName: 'A',
      }),
    ).toThrow()

    expect(() =>
      loginRequestSchema.parse({
        email: 'user@example.com',
        password: 'short',
      }),
    ).toThrow()
  })

  test('normalizes password reset requests and keeps their response generic', () => {
    expect(passwordResetRequestSchema.parse({ email: ' USER@Example.COM ' })).toEqual({
      email: 'user@example.com',
    })
    expect(passwordResetRequestResponseSchema.parse({ accepted: true })).toEqual({
      accepted: true,
    })
    expect(() => passwordResetRequestResponseSchema.parse({ accepted: false })).toThrow()
  })

  test('requires a bounded reset token and a valid replacement password', () => {
    const token = 't'.repeat(43)
    expect(
      passwordResetConfirmRequestSchema.parse({ token, password: 'new-password-123' }),
    ).toEqual({ token, password: 'new-password-123' })
    expect(() =>
      passwordResetConfirmRequestSchema.parse({ token: 'short', password: 'new-password-123' }),
    ).toThrow()
    expect(() =>
      passwordResetConfirmRequestSchema.parse({ token, password: 'short' }),
    ).toThrow()
  })

  test('bounds the reset token at its upper end', () => {
    const maxToken = 't'.repeat(256)
    expect(
      passwordResetConfirmRequestSchema.parse({ token: maxToken, password: 'new-password-123' })
        .token,
    ).toBe(maxToken)
    expect(() =>
      passwordResetConfirmRequestSchema.parse({
        token: 't'.repeat(257),
        password: 'new-password-123',
      }),
    ).toThrow()
  })

  test('bounds email and password length at both ends', () => {
    const maxLocal = 'a'.repeat(254 - '@example.com'.length)
    const maxEmail = `${maxLocal}@example.com`
    expect(maxEmail.length).toBe(254)
    expect(emailSchema.parse(maxEmail)).toBe(maxEmail)
    expect(() => emailSchema.parse(`a${maxEmail}`)).toThrow()

    const minPassword = 'p'.repeat(8)
    const maxPassword = 'p'.repeat(128)
    expect(passwordSchema.parse(minPassword)).toBe(minPassword)
    expect(passwordSchema.parse(maxPassword)).toBe(maxPassword)
    expect(() => passwordSchema.parse('p'.repeat(129))).toThrow()
  })

  test('rejects a createdAt that is not a valid ISO datetime', () => {
    expect(() => userSchema.parse({ ...validUser, createdAt: '2026-05-11' })).toThrow()
  })

  test('keeps cookie requests empty and requires explicit token transport credentials', () => {
    expect(cookieRefreshRequestSchema.parse(undefined)).toEqual({})
    expect(cookieRefreshRequestSchema.parse({})).toEqual({})
    expect(cookieLogoutRequestSchema.parse(undefined)).toEqual({})
    expect(cookieLogoutRequestSchema.parse({})).toEqual({})

    const refreshToken = 'r'.repeat(32)
    expect(tokenRefreshRequestSchema.parse({ refreshToken })).toEqual({ refreshToken })
    expect(tokenLogoutRequestSchema.parse({ refreshToken })).toEqual({ refreshToken })

    expect(() => cookieRefreshRequestSchema.parse({ refreshToken })).toThrow()
    expect(() => cookieLogoutRequestSchema.parse({ refreshToken })).toThrow()
    expect(() => tokenRefreshRequestSchema.parse({})).toThrow()
    expect(() => tokenLogoutRequestSchema.parse({ refreshToken: 'short' })).toThrow()
  })

  test('keeps cookie responses token-free and requires tokens for explicit token transport', () => {
    expect(
      cookieAuthResponseSchema.parse({
        user: validUser,
        accessToken: 'access-token',
      }),
    ).toEqual({
      user: validUser,
      accessToken: 'access-token',
    })

    expect(() =>
      cookieAuthResponseSchema.parse({
        user: validUser,
        accessToken: 'access-token',
        refreshToken: 'must-not-be-exposed',
      }),
    ).toThrow()

    expect(
      tokenAuthResponseSchema.parse({
        user: validUser,
        accessToken: 'access-token',
        refreshToken: 'token-transport-refresh-token',
      }),
    ).toEqual({
      user: validUser,
      accessToken: 'access-token',
      refreshToken: 'token-transport-refresh-token',
    })

    expect(() => tokenAuthResponseSchema.parse({ user: validUser, accessToken: 'access-token' })).toThrow()
    expect(cookieRefreshResponseSchema.parse({ accessToken: 'access-token' })).toEqual({
      accessToken: 'access-token',
    })
    expect(
      tokenRefreshResponseSchema.parse({
        accessToken: 'access-token',
        refreshToken: 'token-transport-refresh-token',
      }),
    ).toEqual({
      accessToken: 'access-token',
      refreshToken: 'token-transport-refresh-token',
    })
    expect(meResponseSchema.parse({ user: validUser })).toEqual({ user: validUser })
  })

  test('validates stable API error response shape', () => {
    expect(
      apiErrorSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          details: [{ path: ['email'], message: 'Invalid email address' }],
        },
      }),
    ).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: [{ path: ['email'], message: 'Invalid email address' }],
      },
    })

    expect(() =>
      apiErrorSchema.parse({
        error: {
          code: 'SOMETHING_ELSE',
          message: 'Nope',
        },
      }),
    ).toThrow()
  })
})
