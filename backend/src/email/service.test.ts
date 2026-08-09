import { describe, expect, test } from 'bun:test'

import { loadEnv } from '../env'
import { createEmailDelivery, disabledEmailDelivery } from './service'

const base = {
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
}

describe('createEmailDelivery', () => {
  test('ships disabled, so a template with no provider queues nothing', () => {
    // requestPasswordReset short-circuits on `configured`, so this is what keeps an install
    // without a provider from accumulating outbox rows nobody will ever deliver.
    const delivery = createEmailDelivery(loadEnv(base))

    expect(delivery).toBe(disabledEmailDelivery)
    expect(delivery.configured).toBe(false)
  })

  test('the console sink reports itself configured and prints the message', async () => {
    const delivery = createEmailDelivery(loadEnv({ ...base, EMAIL_DELIVERY: 'console' }))
    const printed: string[] = []
    const log = console.log
    console.log = (...args: unknown[]) => void printed.push(args.join(' '))

    try {
      expect(delivery.configured).toBe(true)
      await delivery.send(
        { subject: 'Reset your password', text: 'https://example.test/reset#token=abc', to: 'user@example.com' },
        { signal: new AbortController().signal },
      )
    } finally {
      console.log = log
    }

    expect(printed.join('\n')).toContain('user@example.com')
    expect(printed.join('\n')).toContain('https://example.test/reset#token=abc')
  })

  test('production refuses the console sink outright', () => {
    // It reports itself configured, so production would mint tokens and queue tasks whose
    // "delivery" is a log line while the user waits for mail that never comes.
    expect(() =>
      loadEnv({
        ...base,
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
        EMAIL_DELIVERY: 'console',
        JWT_SECRET: '0123456789abcdef'.repeat(4),
        NODE_ENV: 'production',
        PRIVATE_STORAGE_ACCESS_KEY_ID: 'access-key',
        PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
        PRIVATE_STORAGE_BUCKET: 'uploads',
        PRIVATE_STORAGE_DRIVER: 's3',
        PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com',
        PRIVATE_STORAGE_REGION: 'ru-central1',
        PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      }),
    ).toThrow('EMAIL_DELIVERY')
  })
})
