import { describe, expect, test } from 'bun:test'

import { loadEnv } from '../env'
import { defaultTaskDeadlineMs } from '../outbox/retry-policy'
import { isUsableEmailAddress } from './address'
import { emailDeliveryConfigFromEnv } from './config'

const base = {
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
  WEBAPP_ORIGIN: 'http://localhost:5173',
}

describe('isUsableEmailAddress', () => {
  test('accepts the two forms both providers take', () => {
    for (const value of [
      'no-reply@example.com',
      'Example App <no-reply@example.com>',
      '"Example App" <no-reply@example.com>',
    ]) {
      expect(isUsableEmailAddress(value)).toBe(true)
    }
  })

  test('refuses anything that could smuggle a second recipient or a header', () => {
    // A permissive parser here would turn one operator-supplied setting into header injection.
    // Both forms are covered: the bare address and the display-name form, which is the one that
    // looks harmless because the payload hides in the name rather than the address.
    for (const value of [
      'Bob <a@x.com> <b@y.com>',
      'a@example.com, b@example.com',
      'a@example.com\nBcc: c@example.com',
      '<a@example.com>, <b@example.com>',
      'Bob\nBcc: attacker@evil.com <a@example.com>',
      'Bob\r\nBcc: attacker@evil.com <a@example.com>',
      'Bob\u0000X <a@example.com>',
      'Bob, Alice <a@example.com>',
      'Bo\u0000b@example.com',
      'a@b',
      'no-at-sign',
      '',
      '   ',
      '<>',
    ]) {
      expect(isUsableEmailAddress(value)).toBe(false)
    }
  })
})

describe('emailDeliveryConfigFromEnv', () => {
  test('carries the sender and timeout onto every sending driver', () => {
    const config = emailDeliveryConfigFromEnv(
      loadEnv({
        ...base,
        EMAIL_DELIVERY: 'resend',
        EMAIL_FROM: 'Example <no-reply@example.com>',
        EMAIL_REPLY_TO: 'support@example.com',
        EMAIL_REQUEST_TIMEOUT_MS: '4000',
        EMAIL_RESEND_API_KEY: 're_test_key',
      }),
    )

    expect(config).toEqual({
      driver: 'resend',
      endpoint: 'https://api.resend.com',
      apiKey: 're_test_key',
      from: 'Example <no-reply@example.com>',
      replyTo: 'support@example.com',
      requestTimeoutMs: 4_000,
    })
  })

  test('leaves optional settings absent rather than undefined, so a driver can spread them', () => {
    const config = emailDeliveryConfigFromEnv(
      loadEnv({
        ...base,
        EMAIL_DELIVERY: 'postbox',
        EMAIL_FROM: 'no-reply@example.com',
        EMAIL_POSTBOX_ACCESS_KEY_ID: 'YCAJEtest',
        EMAIL_POSTBOX_SECRET_ACCESS_KEY: 'YCPtest',
      }),
    )

    expect(config).not.toHaveProperty('replyTo')
    expect(config).not.toHaveProperty('configurationSet')
    expect(config).toMatchObject({ driver: 'postbox', region: 'ru-central1' })
  })

  test('strips a trailing slash so the driver never builds a double-slashed path', () => {
    const config = emailDeliveryConfigFromEnv(
      loadEnv({
        ...base,
        EMAIL_DELIVERY: 'postbox',
        EMAIL_FROM: 'no-reply@example.com',
        EMAIL_POSTBOX_ENDPOINT: 'https://postbox.cloud.yandex.net/',
        EMAIL_POSTBOX_ACCESS_KEY_ID: 'YCAJEtest',
        EMAIL_POSTBOX_SECRET_ACCESS_KEY: 'YCPtest',
      }),
    )

    expect(config).toMatchObject({ endpoint: 'https://postbox.cloud.yandex.net' })
  })

  test('the inert drivers carry no settings at all', () => {
    expect(emailDeliveryConfigFromEnv(loadEnv(base))).toEqual({ driver: 'disabled' })
    expect(emailDeliveryConfigFromEnv(loadEnv({ ...base, EMAIL_DELIVERY: 'console' }))).toEqual({
      driver: 'console',
    })
  })
})

describe('the request timeout stays inside the task deadline', () => {
  test('a timeout the drain would abort before it fires is refused by name', () => {
    // Otherwise raising EMAIL_REQUEST_TIMEOUT_MS would be inert: the drain kills the attempt at
    // `defaultTaskDeadlineMs` first, so the operator would see no change and no warning.
    expect(() => loadEnv({ ...base, EMAIL_REQUEST_TIMEOUT_MS: '30000' })).toThrow(
      'EMAIL_REQUEST_TIMEOUT_MS',
    )
    expect(loadEnv({ ...base, EMAIL_REQUEST_TIMEOUT_MS: '14000' }).EMAIL_REQUEST_TIMEOUT_MS).toBe(
      14_000,
    )
    expect(loadEnv(base).EMAIL_REQUEST_TIMEOUT_MS).toBeLessThan(defaultTaskDeadlineMs)
  })

  test('the schema ceiling itself stays under the deadline, not merely the default', () => {
    const ceiling = 14_000

    expect(loadEnv({ ...base, EMAIL_REQUEST_TIMEOUT_MS: String(ceiling) }).EMAIL_REQUEST_TIMEOUT_MS)
      .toBeLessThan(defaultTaskDeadlineMs)
    expect(() => loadEnv({ ...base, EMAIL_REQUEST_TIMEOUT_MS: String(ceiling + 1) })).toThrow(
      'EMAIL_REQUEST_TIMEOUT_MS',
    )
  })
})
