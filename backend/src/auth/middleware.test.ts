import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { AppError, handleError } from '../http/errors'
import type { AuthenticatedHonoEnv } from '../http/context'
import type { StorageService } from '../storage/service'
import type { AuthService } from './service'
import { requireAuth } from './middleware'

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

describe('requireAuth middleware', () => {
  test('rejects missing and invalid bearer tokens', async () => {
    const app = createProtectedTestApp()

    const missing = await app.request('/protected')
    expect(missing.status).toBe(401)

    const invalid = await app.request('/protected', {
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    })
    expect(invalid.status).toBe(401)
  })

  test('sets typed authenticated user context for downstream handlers', async () => {
    const app = createProtectedTestApp()

    const response = await app.request('/protected', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      email: 'user@example.com',
      sessionId: 'session-1',
      userId: 'user-1',
    })
  })
})

function createProtectedTestApp() {
  const app = new Hono<AuthenticatedHonoEnv>()
  const authService = {
    async authenticateAccessToken(accessToken: string | undefined) {
      if (accessToken !== 'valid-token') {
        throw new AppError(401, 'UNAUTHORIZED', 'Access token is invalid or expired')
      }

      return {
        id: 'user-1',
        email: 'user@example.com',
        displayName: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        sessionId: 'session-1',
      }
    },
  } as AuthService

  app.use('*', async (c, next) => {
    c.set('authService', authService)
    c.set('env', env)
    c.set('storageService', null as StorageService | null)
    await next()
  })
  app.use('*', requireAuth)
  app.get('/protected', (c) => {
    const user = c.var.user

    return c.json({
      email: user.email,
      sessionId: user.sessionId,
      userId: user.id,
    })
  })
  app.onError(handleError)

  return app
}
