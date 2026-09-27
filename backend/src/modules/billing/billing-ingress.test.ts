// @parked-test
//
// Subscriptions ship switched off: src/app.ts mounts no `/api/iap` or `/api/webhooks` route and no
// ingress budget for them. Remove the marker above with the other billing suites (docs/IAP.md).
import { expect, test } from 'bun:test'

import { createApp } from '../../app'
import type { DbClient } from '../../db'
import { loadEnv } from '../../env'

const env = loadEnv({
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
})

function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Spends the one-write account budget, so a billing route answering 429 next would show that it
// still counts against the account budget instead of its own.
async function spendAccountBudget(app: ReturnType<typeof createApp>) {
  const response = await app.request('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(response.status).toBe(401)
}

test('App Store webhook ingress rejects oversized bodies before billing work', async () => {
  const app = createApp({
    env: { ...env, WEBHOOK_BODY_LIMIT_BYTES: 32 },
    prisma: {} as DbClient,
  })

  const response = await post(app, '/api/webhooks/app-store', { signedPayload: 'x'.repeat(64) })

  expect(response.status).toBe(413)
})

test('App Store webhook ingress has its own bounded request rate', async () => {
  const app = createApp({
    env: { ...env, AUTH_RATE_LIMIT_MAX: 1, WEBHOOK_RATE_LIMIT_MAX: 1 },
    prisma: {} as DbClient,
  })
  await spendAccountBudget(app)

  expect((await post(app, '/api/webhooks/app-store', {})).status).not.toBe(429)
  const limited = await post(app, '/api/webhooks/app-store', {})
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBeTruthy()
})

test('IAP ingress rejects oversized bodies before authentication and validation', async () => {
  const app = createApp({
    env: { ...env, IAP_BODY_LIMIT_BYTES: 32 },
    prisma: {} as DbClient,
  })

  const response = await post(app, '/api/iap/app-store/transactions', {
    signedTransactionInfo: 'x'.repeat(64),
  })

  expect(response.status).toBe(413)
})

test('IAP ingress has its own bounded request rate', async () => {
  const app = createApp({
    env: { ...env, AUTH_RATE_LIMIT_MAX: 1, IAP_RATE_LIMIT_MAX: 1 },
    prisma: {} as DbClient,
  })
  await spendAccountBudget(app)
  const transaction = { signedTransactionInfo: 'signed-transaction' }

  expect((await post(app, '/api/iap/app-store/transactions', transaction)).status).not.toBe(429)
  const limited = await post(app, '/api/iap/app-store/transactions', transaction)
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBeTruthy()
})
