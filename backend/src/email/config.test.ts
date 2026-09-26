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
})
