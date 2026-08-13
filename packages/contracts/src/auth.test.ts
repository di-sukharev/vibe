import { describe, expect, test } from 'bun:test'

import {
  apiErrorSchema,
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  internalNotificationHrefSchema,
  loginRequestSchema,
  meResponseSchema,
  pushMutationResponseSchema,
  registerPushTokenRequestSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestResponseSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  socialAuthProviderParamsSchema,
  socialAuthRequestSchema,
  testPushNotificationRequestSchema,
  testPushNotificationResponseSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
  unregisterPushTokenRequestSchema,
} from './index'

const validUser = {
  id: 'user_1',
  email: 'user@example.com',
  displayName: null,
  role: 'user',
  createdAt: '2026-05-11T00:00:00.000Z',
} as const

describe('auth contracts', () => {
  test('normalizes registration, login, and social auth input', () => {
    expect(
      registerRequestSchema.parse({
        email: ' USER@Example.COM ',
        password: 'password123',
        displayName: ' Jane ',
      }),
    ).toEqual({ email: 'user@example.com', password: 'password123', displayName: 'Jane' })
    expect(
      loginRequestSchema.parse({ email: ' USER@Example.COM ', password: 'password123' }),
    ).toEqual({ email: 'user@example.com', password: 'password123' })
    expect(socialAuthProviderParamsSchema.parse({ provider: 'apple' })).toEqual({ provider: 'apple' })
    expect(
      socialAuthRequestSchema.parse({ idToken: ' provider-token ', displayName: ' Jane ' }),
    ).toEqual({ idToken: 'provider-token', displayName: 'Jane' })
    expect(() => socialAuthProviderParamsSchema.parse({ provider: 'facebook' })).toThrow()
    expect(() => socialAuthRequestSchema.parse({ idToken: '' })).toThrow()
  })

  test('rejects invalid auth request payloads', () => {
    // One violation per payload. A payload breaking all three rules at once throws whichever rule
    // you delete, so it asserts none of them.
    const valid = { email: 'user@example.com', password: 'password123', displayName: 'Jane' }

    expect(registerRequestSchema.parse(valid)).toMatchObject({ email: 'user@example.com' })
    expect(() => registerRequestSchema.parse({ ...valid, email: 'not-an-email' })).toThrow()
    expect(() => registerRequestSchema.parse({ ...valid, password: 'short' })).toThrow()
    expect(() => registerRequestSchema.parse({ ...valid, displayName: 'A' })).toThrow()
    expect(() =>
      loginRequestSchema.parse({ email: 'user@example.com', password: 'short' }),
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

  test('keeps cookie requests empty and requires explicit token transport credentials', () => {
    expect(cookieRefreshRequestSchema.parse(undefined)).toEqual({})
    expect(cookieLogoutRequestSchema.parse({})).toEqual({})

    const refreshToken = 'r'.repeat(32)
    expect(tokenRefreshRequestSchema.parse({ refreshToken })).toEqual({ refreshToken })
    expect(
      tokenLogoutRequestSchema.parse({
        expoPushToken: 'ExponentPushToken[logout-token]',
        expoPushTokens: ['ExponentPushToken[logout-old-token]'],
        refreshToken,
      }),
    ).toEqual({
      expoPushToken: 'ExponentPushToken[logout-token]',
      expoPushTokens: ['ExponentPushToken[logout-old-token]'],
      refreshToken,
    })

    expect(() => cookieRefreshRequestSchema.parse({ refreshToken })).toThrow()
    expect(() => cookieLogoutRequestSchema.parse({ refreshToken })).toThrow()
    expect(() => tokenRefreshRequestSchema.parse({})).toThrow()
    expect(() => tokenLogoutRequestSchema.parse({ refreshToken: 'short' })).toThrow()
    expect(() => tokenLogoutRequestSchema.parse({ refreshToken, expoPushToken: 'bad' })).toThrow()
  })

  test('keeps cookie responses token-free and requires tokens for explicit token transport', () => {
    const cookieResponse = { user: validUser, accessToken: 'access-token' }
    expect(cookieAuthResponseSchema.parse(cookieResponse)).toEqual(cookieResponse)
    expect(() =>
      cookieAuthResponseSchema.parse({ ...cookieResponse, refreshToken: 'must-not-be-exposed' }),
    ).toThrow()

    const tokenResponse = {
      ...cookieResponse,
      refreshToken: 'token-transport-refresh-token',
    }
    expect(tokenAuthResponseSchema.parse(tokenResponse)).toEqual(tokenResponse)
    expect(() => tokenAuthResponseSchema.parse(cookieResponse)).toThrow()
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

  test('an old client that sends only `ok` still gets `applied` derived for it', () => {
    // The hand-written "legacy" schemas that used to sit here were written in this file on both
    // sides, so they asserted one local literal against another. This is the part that carries a
    // rule: the field a client of the previous version never sends is filled in for it.
    expect(pushMutationResponseSchema.parse({ ok: true })).toEqual({
      applied: true,
      ok: true,
    })
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
      apiErrorSchema.parse({ error: { code: 'SOMETHING_ELSE', message: 'Nope' } }),
    ).toThrow()
    expect(
      apiErrorSchema.parse({
        error: { code: 'AUTH_PROVIDER_NOT_CONFIGURED', message: 'Provider is not configured' },
      }),
    ).toEqual({
      error: { code: 'AUTH_PROVIDER_NOT_CONFIGURED', message: 'Provider is not configured' },
    })
  })

  test('validates Expo push notification contracts', () => {
    const installationId = '018fd4f2-1f3a-7c88-bc49-333333333333'
    const installationSecret = '118fd4f2-1f3a-4c88-bc49-333333333333'
    expect(
      registerPushTokenRequestSchema.parse({
        expoPushToken: ' ExponentPushToken[test-token] ',
        deviceId: 'device-1',
        installationId,
        installationSecret,
        generation: 7,
        platform: 'ios',
        previousExpoPushTokens: ['ExponentPushToken[previous-token]'],
      }),
    ).toEqual({
      expoPushToken: 'ExponentPushToken[test-token]',
      deviceId: 'device-1',
      installationId,
      installationSecret,
      generation: 7,
      platform: 'ios',
      previousExpoPushTokens: ['ExponentPushToken[previous-token]'],
    })
    expect(
      unregisterPushTokenRequestSchema.parse({
        expoPushTokens: ['ExponentPushToken[test-token]'],
        generation: 8,
        installationId,
        installationSecret,
      }),
    ).toEqual({
      expoPushTokens: ['ExponentPushToken[test-token]'],
      generation: 8,
      installationId,
      installationSecret,
    })
    expect(pushMutationResponseSchema.parse({ applied: true, ok: true })).toEqual({
      applied: true,
      ok: true,
    })
    expect(
      testPushNotificationRequestSchema.parse({
        title: ' Hello ',
        body: ' Ready ',
        href: '/details/components',
      }),
    ).toEqual({ title: 'Hello', body: 'Ready', href: '/details/components' })
    expect(testPushNotificationRequestSchema.parse(undefined)).toEqual({
      title: 'Test notification',
      body: 'Expo Push is configured.',
      href: '/',
    })
    expect(
      testPushNotificationResponseSchema.parse({
        ok: true,
        outboxId: '018fd4f2-1f3a-7c88-bc49-333333333333',
      }),
    ).toMatchObject({ ok: true })
    expect(() => registerPushTokenRequestSchema.parse({ expoPushToken: 'not-a-token' })).toThrow()

    // Each rejection below is paired with the payload that differs only in the field under test.
    // Without the pair these assertions throw for a missing `installationSecret` instead, which is
    // what they did until it was noticed: the generation fence and the token cap went unasserted.
    const registration = {
      expoPushToken: 'ExponentPushToken[test-token]',
      installationId,
      installationSecret,
    }
    expect(registerPushTokenRequestSchema.parse({ ...registration, generation: 1 })).toMatchObject({
      generation: 1,
    })
    // Generation 0 would let a replayed registration tie with the live one instead of losing to it.
    expect(() => registerPushTokenRequestSchema.parse({ ...registration, generation: 0 })).toThrow()

    const tokens = (count: number) =>
      Array.from({ length: count }, (_, index) => `ExponentPushToken[token-${index}]`)
    const unregistration = { generation: 8, installationId, installationSecret }
    expect(
      unregisterPushTokenRequestSchema.parse({ ...unregistration, expoPushTokens: tokens(12) }),
    ).toMatchObject({ expoPushTokens: tokens(12) })
    expect(() =>
      unregisterPushTokenRequestSchema.parse({ ...unregistration, expoPushTokens: tokens(13) }),
    ).toThrow()
    expect(() => internalNotificationHrefSchema.parse('https://example.com')).toThrow()
    expect(() => internalNotificationHrefSchema.parse('//example.com')).toThrow()
  })
})
