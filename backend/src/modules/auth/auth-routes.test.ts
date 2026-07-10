import { describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'

const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: 'test-route-secret-at-least-thirty-two-chars-123',
  CORS_ORIGINS: ['https://web.example.com'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: true,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  APPLE_IAP_ENVIRONMENT: 'Sandbox',
  APPLE_IAP_PRODUCT_IDS: [],
  APPLE_AUTH_JWKS_TIMEOUT_MS: 5000,
  GOOGLE_AUTH_CLIENT_IDS: [],
  GOOGLE_PLAY_PRODUCT_IDS: [],
  GOOGLE_PLAY_BASE_PLAN_IDS: [],
}

describe('auth routes', () => {
  test('rejects secure cookie refresh and logout requests from untrusted origins before auth service work', async () => {
    const app = createApp({ env, prisma: {} as DbClient })
    const refreshCookie = `web_app_demo_refresh=${'r'.repeat(32)}`

    const noOriginRefresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: refreshCookie,
      },
      body: JSON.stringify({}),
    })
    const noOriginRefreshBody = await noOriginRefresh.json()

    expect(noOriginRefresh.status).toBe(403)
    expect(noOriginRefreshBody.error.code).toBe('FORBIDDEN')

    const untrustedLogout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: refreshCookie,
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({}),
    })
    const untrustedLogoutBody = await untrustedLogout.json()

    expect(untrustedLogout.status).toBe(403)
    expect(untrustedLogoutBody.error.code).toBe('FORBIDDEN')
  })
})
