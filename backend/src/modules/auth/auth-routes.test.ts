import { describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import type { DbClient } from '../../db'
import { loadEnv } from '../../env'

const env = loadEnv({
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  ACCESS_TOKEN_TTL_SECONDS: '60',
  COOKIE_SECURE: 'true',
  CORS_ORIGINS: 'https://web.example.com',
  JWT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  TRUST_PROXY: 'true',
  TRUSTED_PROXY_CLIENT_IP_HEADER: 'do-connecting-ip',
})

describe('auth routes', () => {
  test('limits auth request bodies before validation or password work', async () => {
    const app = createApp({ env: { ...env, AUTH_BODY_LIMIT_BYTES: 32 }, prisma: {} as DbClient })
    const response = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'body@example.com', password: 'x'.repeat(64) }),
    })

    expect(response.status).toBe(413)
  })

  test('rate limits repeated auth writes from one client before service work', async () => {
    const app = createApp({ env: { ...env, AUTH_RATE_LIMIT_MAX: 1 }, prisma: {} as DbClient })
    const request = () => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.8',
        'Do-Connecting-Ip': '203.0.113.10',
      },
      body: JSON.stringify({ email: 'invalid', password: 'short' }),
    })

    expect((await request()).status).toBe(400)
    const limited = await request()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })

  test('uses the configured trusted proxy header instead of a shared ingress address', async () => {
    const app = createApp({ env: { ...env, AUTH_RATE_LIMIT_MAX: 1 }, prisma: {} as DbClient })
    const request = (clientIp: string) => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.8',
        'Do-Connecting-Ip': clientIp,
      },
      body: JSON.stringify({ email: 'invalid', password: 'short' }),
    })

    expect((await request('203.0.113.10')).status).toBe(400)
    expect((await request('203.0.113.11')).status).toBe(400)
    expect((await request('203.0.113.10')).status).toBe(429)
  })

  test('can select the trusted last address from an appended proxy chain', async () => {
    const app = createApp({
      env: {
        ...env,
        AUTH_RATE_LIMIT_MAX: 1,
        TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-forwarded-for',
        TRUSTED_PROXY_CLIENT_IP_POSITION: 'last',
      },
      prisma: {} as DbClient,
    })
    const request = (clientIp: string) => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `198.51.100.99, ${clientIp}`,
      },
      body: JSON.stringify({ email: 'invalid', password: 'short' }),
    })

    expect((await request('203.0.113.10')).status).toBe(400)
    expect((await request('203.0.113.11')).status).toBe(400)
    expect((await request('203.0.113.10')).status).toBe(429)
  })

  test('rejects all secure cookie auth writes from untrusted origins before auth service work', async () => {
    const app = createApp({ env, prisma: {} as DbClient })
    const refreshCookie = `web_app_demo_refresh=${'r'.repeat(32)}`

    const untrustedLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    })
    const untrustedLoginBody = await untrustedLogin.json()

    expect(untrustedLogin.status).toBe(403)
    expect(untrustedLoginBody.error.code).toBe('FORBIDDEN')

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

  test('accepts password reset requests generically while email delivery is disabled', async () => {
    const app = createApp({ env, prisma: {} as DbClient })
    const response = await app.request('/api/auth/password-reset/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({ email: 'unknown@example.com' }),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })
  })
})
