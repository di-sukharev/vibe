import { describe, expect, test } from 'bun:test'

import { loadEnv } from '../env'
import { createEmailDelivery, disabledEmailDelivery } from '.'

const base = {
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
  WEBAPP_ORIGIN: 'http://localhost:5173',
}

// Password reset sends nothing, behind the same 202, while `configured` is false.
describe('createEmailDelivery', () => {
  test('sends nothing until an install picks a driver', () => {
    const delivery = createEmailDelivery(loadEnv(base))

    expect(delivery).toBe(disabledEmailDelivery)
    expect(delivery.configured).toBe(false)
  })

  test('builds the driver EMAIL_DELIVERY names, and reports it as able to send', () => {
    const cases = [
      ['console', {}],
      ['resend', { EMAIL_FROM: 'no-reply@example.com', EMAIL_RESEND_API_KEY: 're_test_key' }],
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
})
