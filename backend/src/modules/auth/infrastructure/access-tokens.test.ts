import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../../env'
import { signAccessToken, verifyAccessToken } from './access-tokens'

const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: false,
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
  })
})
