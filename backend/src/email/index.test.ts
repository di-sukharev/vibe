import { describe, expect, test } from 'bun:test'

import { loadEnv } from '../env'
import { createEmailDelivery, disabledEmailDelivery } from '.'

const base = {
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
  WEBAPP_ORIGIN: 'http://localhost:5173',
}

describe('createEmailDelivery', () => {
  test('sends nothing until an install picks a driver', () => {
    const delivery = createEmailDelivery(loadEnv(base))

    expect(delivery).toBe(disabledEmailDelivery)
    expect(delivery.configured).toBe(false)
  })

  test('builds the driver EMAIL_DELIVERY names, and reports it as able to send', () => {
    const cases = [
      ['console', {}],
      [
        'resend',
        { EMAIL_FROM: 'no-reply@example.com', EMAIL_RESEND_API_KEY: 're_test_key' },
      ],
      [
        'postbox',
        {
          EMAIL_FROM: 'no-reply@example.com',
          EMAIL_POSTBOX_ACCESS_KEY_ID: 'YCAJEtest',
          EMAIL_POSTBOX_SECRET_ACCESS_KEY: 'YCPtest',
        },
      ],
    ] as const

    for (const [driver, settings] of cases) {
      const delivery = createEmailDelivery(loadEnv({ ...base, ...settings, EMAIL_DELIVERY: driver }))

      expect({ driver: delivery.driver, configured: delivery.configured }).toEqual({
        driver,
        configured: true,
      })
    }
  })

  test('the console sink prints the message rather than pretending to send it', async () => {
    const delivery = createEmailDelivery(loadEnv({ ...base, EMAIL_DELIVERY: 'console' }))
    const lines: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(' '))

    try {
      await delivery.send(
        { to: 'user@example.com', subject: 'Reset your password', text: 'https://app/reset#token=x' },
        { signal: AbortSignal.timeout(1_000) },
      )
    } finally {
      console.log = original
    }

    expect(lines.join('\n')).toContain('https://app/reset#token=x')
    expect(lines.join('\n')).toContain('user@example.com')
  })

  test('the disabled driver accepts a send and does nothing, so callers need no special case', async () => {
    await expect(
      disabledEmailDelivery.send(
        { to: 'user@example.com', subject: 's', text: 't' },
        { signal: AbortSignal.timeout(1_000) },
      ),
    ).resolves.toBeUndefined()
  })
})
