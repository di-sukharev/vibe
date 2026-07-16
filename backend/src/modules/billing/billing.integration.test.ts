import { randomUUID } from 'node:crypto'

import { Environment, Status, Type, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { beforeEach, afterAll, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'
import { BillingFailure } from './domain/errors'
import type {
  AppStoreSubscriptionVerifier,
  AppStoreVerificationResult,
} from './infrastructure/apple-verifier'

const databaseUrl = process.env.TEST_DATABASE_URL
const skippedDatabaseUrl = 'postgresql://skip:skip@localhost:5432/skip'
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('iap API integration', () => {
  const env: AppEnv = {
    PORT: 3000,
    DATABASE_URL: databaseUrl ?? skippedDatabaseUrl,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: ['http://localhost:5173'],
    ACCESS_TOKEN_TTL_SECONDS: 60,
    REFRESH_TOKEN_TTL_DAYS: 30,
    REFRESH_REUSE_GRACE_SECONDS: 10,
    SESSION_ABSOLUTE_TTL_DAYS: 90,
    SESSION_RETENTION_DAYS: 7,
    AUTH_BODY_LIMIT_BYTES: 64 * 1024,
    AUTH_RATE_LIMIT_MAX: 60,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    SHUTDOWN_GRACE_SECONDS: 20,
    TRUST_PROXY: false,
    COOKIE_SECURE: false,
    SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    SPACES_UPLOAD_URL_TTL_SECONDS: 900,
    SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
    SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
    APPLE_IAP_ENVIRONMENT: 'Sandbox',
    APPLE_IAP_PRODUCT_IDS: ['premium_monthly', 'premium_yearly'],
    APPLE_AUTH_JWKS_TIMEOUT_MS: 5000,
    GOOGLE_AUTH_CLIENT_IDS: [],
    GOOGLE_PLAY_PRODUCT_IDS: [],
    GOOGLE_PLAY_BASE_PLAN_IDS: [],
  }
  const prisma = createPrisma(databaseUrl ?? skippedDatabaseUrl)
  let verifier = new FakeAppStoreVerifier()
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    verifier = new FakeAppStoreVerifier()
    app = createApp({ env, prisma, appStoreIapVerifier: verifier })
    await prisma.appStoreWebhook.deleteMany()
    await prisma.appStoreTransaction.deleteMany()
    await prisma.subscriptionEntitlement.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('ingests a valid App Store transaction and exposes it on /me', async () => {
    const session = await registerAndAuthorize('active@example.com')
    verifier.setTransaction('signed-active', activeTransaction(session.user.id))
    verifier.setRenewal('signed-renewal-active', activeRenewal())

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-active',
      signedRenewalInfo: 'signed-renewal-active',
    })
    const ingestBody = await ingest.json()

    expect(ingest.status).toBe(200)
    expect(ingestBody.subscription).toMatchObject({
      entitlement: 'premium',
      isActive: true,
      platform: 'ios',
      productId: 'premium_monthly',
      state: 'active',
    })

    const me = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    const meBody = await me.json()

    expect(me.status).toBe(200)
    expect(meBody.user.subscription.isActive).toBe(true)
    expect(meBody.user.subscription.transactionId).toBe('transaction-active')
  })

  test('returns the active subscription in the login session response', async () => {
    const session = await registerAndAuthorize('login-subscriber@example.com')
    verifier.setTransaction('signed-login-active', activeTransaction(session.user.id))

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-login-active',
    })
    expect(ingest.status).toBe(200)

    const login = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'login-subscriber@example.com',
        password: 'password123',
      }),
    })
    const body = await login.json()

    expect(login.status).toBe(200)
    expect(body.user.subscription).toMatchObject({
      isActive: true,
      transactionId: 'transaction-active',
    })
  })

  test('rejects invalid transactions without finishing ownership state', async () => {
    const session = await registerAndAuthorize('invalid@example.com')

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-missing',
    })
    const body = await ingest.json()

    expect(ingest.status).toBe(400)
    expect(body.error.code).toBe('IAP_INVALID_TRANSACTION')
    expect(body.error.details).toBeUndefined()
    expect(await prisma.subscriptionEntitlement.count()).toBe(0)
  })

  test('rejects a purchase linked to another app account token', async () => {
    const session = await registerAndAuthorize('owner@example.com')
    verifier.setTransaction('signed-other-owner', activeTransaction(randomUUID()))

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-other-owner',
    })
    const body = await ingest.json()

    expect(ingest.status).toBe(403)
    expect(body.error.code).toBe('IAP_OWNERSHIP_MISMATCH')
    expect(await prisma.appStoreTransaction.count()).toBe(0)
  })

  test('rejects verified products when the backend allowlist is empty', async () => {
    const session = await registerAndAuthorize('missing-products@example.com')
    verifier.setTransaction('signed-no-products', activeTransaction(session.user.id))
    app = createApp({
      env: {
        ...env,
        APPLE_IAP_PRODUCT_IDS: [],
      },
      prisma,
      appStoreIapVerifier: verifier,
    })

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-no-products',
    })
    const body = await ingest.json()

    expect(ingest.status).toBe(503)
    expect(body.error.code).toBe('IAP_NOT_CONFIGURED')
    expect(await prisma.subscriptionEntitlement.count()).toBe(0)
  })

  test('rejects first-time transactions without an app account token', async () => {
    const session = await registerAndAuthorize('missing-token@example.com')
    verifier.setTransaction('signed-no-token', {
      ...activeTransaction(session.user.id),
      appAccountToken: undefined,
    })

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-no-token',
    })
    const body = await ingest.json()

    expect(ingest.status).toBe(403)
    expect(body.error.code).toBe('IAP_OWNERSHIP_MISMATCH')
    expect(await prisma.appStoreTransaction.count()).toBe(0)
  })

  test('accepts app-account-less renewals for an already linked original transaction', async () => {
    const session = await registerAndAuthorize('renewal-no-token@example.com')
    verifier.setTransaction('signed-initial', activeTransaction(session.user.id))
    verifier.setTransaction('signed-renewal-no-token', {
      ...activeTransaction(session.user.id),
      appAccountToken: undefined,
      expiresDate: Date.now() + 60 * 24 * 60 * 60 * 1000,
      purchaseDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      transactionId: 'transaction-renewal-no-token',
      webOrderLineItemId: 'web-order-renewal-no-token',
    })
    verifier.setStatuses('original-active', [
      {
        status: Status.ACTIVE,
        signedTransactionInfo: 'signed-renewal-no-token',
      },
    ])

    const initial = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-initial',
    })
    expect(initial.status).toBe(200)

    const reconcile = await postJson('/api/iap/app-store/reconcile', session.accessToken, {
      originalTransactionIds: ['original-active'],
    })
    const body = await reconcile.json()

    expect(reconcile.status).toBe(200)
    expect(body.subscription).toMatchObject({
      isActive: true,
      transactionId: 'transaction-renewal-no-token',
    })
  })

  test('continues original transaction reconciliation when one cached signed transaction is invalid', async () => {
    const session = await registerAndAuthorize('mixed-reconcile@example.com')
    verifier.setTransaction('signed-status-active', {
      ...activeTransaction(session.user.id),
      transactionId: 'transaction-status-active',
    })
    verifier.setStatuses('original-active', [
      {
        status: Status.ACTIVE,
        signedTransactionInfo: 'signed-status-active',
      },
    ])

    const reconcile = await postJson('/api/iap/app-store/reconcile', session.accessToken, {
      signedTransactions: ['signed-missing'],
      originalTransactionIds: ['original-active'],
    })
    const body = await reconcile.json()

    expect(reconcile.status).toBe(200)
    expect(body.subscription).toMatchObject({
      isActive: true,
      state: 'active',
      transactionId: 'transaction-status-active',
    })
  })

  test('updates entitlement state when App Store status changes without extending expiration', async () => {
    const session = await registerAndAuthorize('status-transition@example.com')
    const expiresDate = Date.now() + 30 * 24 * 60 * 60 * 1000
    verifier.setTransaction('signed-status-initial', {
      ...activeTransaction(session.user.id),
      expiresDate,
      transactionId: 'transaction-status-initial',
    })
    verifier.setTransaction('signed-status-retry', {
      ...activeTransaction(session.user.id),
      expiresDate,
      purchaseDate: Date.now() + 60_000,
      transactionId: 'transaction-status-retry',
      webOrderLineItemId: 'web-order-status-retry',
    })
    verifier.setStatuses('original-active', [
      {
        status: Status.BILLING_RETRY,
        signedTransactionInfo: 'signed-status-retry',
      },
    ])

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-status-initial',
    })
    expect(ingest.status).toBe(200)

    const reconcile = await postJson('/api/iap/app-store/reconcile', session.accessToken, {
      originalTransactionIds: ['original-active'],
    })
    const body = await reconcile.json()

    expect(reconcile.status).toBe(200)
    expect(body.subscription).toMatchObject({
      isActive: false,
      state: 'billing_retry',
      transactionId: 'transaction-status-retry',
    })
  })

  test('replays the same transaction idempotently', async () => {
    const session = await registerAndAuthorize('replay@example.com')
    verifier.setTransaction('signed-replay', activeTransaction(session.user.id))

    const first = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-replay',
    })
    const second = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-replay',
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await prisma.appStoreTransaction.count()).toBe(1)
    expect(await prisma.subscriptionEntitlement.count()).toBe(1)
  })

  test('reconciles expired App Store status to an inactive entitlement', async () => {
    const session = await registerAndAuthorize('expired@example.com')
    verifier.setTransaction('signed-expired', {
      ...activeTransaction(session.user.id),
      expiresDate: Date.now() - 24 * 60 * 60 * 1000,
      transactionId: 'transaction-expired',
    })
    verifier.setStatuses('original-active', [
      {
        status: Status.EXPIRED,
        signedTransactionInfo: 'signed-expired',
      },
    ])

    const reconcile = await postJson('/api/iap/app-store/reconcile', session.accessToken, {
      originalTransactionIds: ['original-active'],
    })
    const body = await reconcile.json()

    expect(reconcile.status).toBe(200)
    expect(body.subscription).toMatchObject({
      isActive: false,
      state: 'expired',
      transactionId: 'transaction-expired',
    })
  })

  test('does not let stale expired transactions overwrite a newer active entitlement', async () => {
    const session = await registerAndAuthorize('stale@example.com')
    verifier.setTransaction('signed-new-active', {
      ...activeTransaction(session.user.id),
      expiresDate: Date.now() + 60 * 24 * 60 * 60 * 1000,
      purchaseDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      transactionId: 'transaction-new-active',
      webOrderLineItemId: 'web-order-new-active',
    })
    verifier.setTransaction('signed-old-expired', {
      ...activeTransaction(session.user.id),
      expiresDate: Date.now() - 24 * 60 * 60 * 1000,
      purchaseDate: Date.now() - 60 * 24 * 60 * 60 * 1000,
      transactionId: 'transaction-old-expired',
      webOrderLineItemId: 'web-order-old-expired',
    })
    verifier.setStatuses('original-active', [
      {
        status: Status.EXPIRED,
        signedTransactionInfo: 'signed-old-expired',
      },
    ])

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-new-active',
    })
    expect(ingest.status).toBe(200)

    const reconcile = await postJson('/api/iap/app-store/reconcile', session.accessToken, {
      originalTransactionIds: ['original-active'],
    })
    const body = await reconcile.json()

    expect(reconcile.status).toBe(200)
    expect(body.subscription).toMatchObject({
      isActive: true,
      state: 'active',
      transactionId: 'transaction-new-active',
    })
  })

  test('reports stored active entitlements with past expiration as expired', async () => {
    const session = await registerAndAuthorize('missed-webhook@example.com')
    await prisma.subscriptionEntitlement.create({
      data: {
        userId: session.user.id,
        entitlementKey: 'premium',
        platform: 'ios',
        state: 'active',
        productId: 'premium_monthly',
        originalTransactionId: 'original-missed-webhook',
        transactionId: 'transaction-missed-webhook',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        willAutoRenew: false,
        environment: 'sandbox',
      },
    })

    const entitlement = await app.request('/api/iap/entitlement', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    const body = await entitlement.json()

    expect(entitlement.status).toBe(200)
    expect(body.subscription).toMatchObject({
      isActive: false,
      state: 'expired',
      transactionId: 'transaction-missed-webhook',
    })
  })

  test('records duplicate App Store webhooks once and processes the first payload', async () => {
    const session = await registerAndAuthorize('webhook@example.com')
    verifier.setTransaction('signed-webhook-active', {
      ...activeTransaction(session.user.id),
      transactionId: 'transaction-webhook',
    })
    verifier.setNotification('signed-webhook', {
      notificationUUID: 'notification-1',
      notificationType: 'DID_RENEW',
      data: {
        environment: Environment.SANDBOX,
        signedTransactionInfo: 'signed-webhook-active',
        status: Status.ACTIVE,
      },
    })

    const first = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook' }),
    })
    const firstBody = await first.json()
    const second = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook' }),
    })
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(firstBody.duplicate).toBe(false)
    expect(second.status).toBe(200)
    expect(secondBody.duplicate).toBe(true)
    expect(await prisma.appStoreWebhook.count()).toBe(1)
    expect(await prisma.appStoreTransaction.count()).toBe(1)
  })

  test('deduplicates concurrent App Store webhook deliveries before verification side effects', async () => {
    const session = await registerAndAuthorize('webhook-concurrent@example.com')
    verifier.setTransaction('signed-webhook-concurrent-active', {
      ...activeTransaction(session.user.id),
      transactionId: 'transaction-webhook-concurrent',
    })
    verifier.setNotification('signed-webhook-concurrent', {
      notificationUUID: 'notification-concurrent-1',
      notificationType: 'DID_RENEW',
      data: {
        environment: Environment.SANDBOX,
        signedTransactionInfo: 'signed-webhook-concurrent-active',
        status: Status.ACTIVE,
      },
    })

    const [first, second] = await Promise.all([
      app.request('/api/webhooks/app-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedPayload: 'signed-webhook-concurrent' }),
      }),
      app.request('/api/webhooks/app-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedPayload: 'signed-webhook-concurrent' }),
      }),
    ])
    const bodies = [await first.json(), await second.json()]

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(bodies.map((body) => body.duplicate).sort()).toEqual([false, true])
    expect(verifier.notificationVerificationCount('signed-webhook-concurrent')).toBe(1)
    expect(await prisma.appStoreWebhook.count()).toBe(1)
    expect(await prisma.appStoreTransaction.count()).toBe(1)
  })

  async function registerAndAuthorize(email: string) {
    const response = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: 'password123',
      }),
    })
    expect(response.status).toBe(201)
    return response.json() as Promise<{
      accessToken: string
      user: { id: string }
    }>
  }

  function postJson(path: string, accessToken: string, body: unknown) {
    return app.request(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }
})

class FakeAppStoreVerifier implements AppStoreSubscriptionVerifier {
  private readonly transactions = new Map<string, JWSTransactionDecodedPayload>()
  private readonly renewals = new Map<string, JWSRenewalInfoDecodedPayload>()
  private readonly notifications = new Map<string, ResponseBodyV2DecodedPayload>()
  private readonly notificationVerificationCounts = new Map<string, number>()
  private readonly statuses = new Map<string, Awaited<ReturnType<AppStoreSubscriptionVerifier['getSubscriptionStatuses']>>>()

  setTransaction(signedTransactionInfo: string, payload: JWSTransactionDecodedPayload) {
    this.transactions.set(signedTransactionInfo, payload)
  }

  setRenewal(signedRenewalInfo: string, payload: JWSRenewalInfoDecodedPayload) {
    this.renewals.set(signedRenewalInfo, payload)
  }

  setNotification(signedPayload: string, payload: ResponseBodyV2DecodedPayload) {
    this.notifications.set(signedPayload, payload)
  }

  setStatuses(
    transactionId: string,
    statuses: Awaited<ReturnType<AppStoreSubscriptionVerifier['getSubscriptionStatuses']>>,
  ) {
    this.statuses.set(transactionId, statuses)
  }

  notificationVerificationCount(signedPayload: string) {
    return this.notificationVerificationCounts.get(signedPayload) ?? 0
  }

  async verifyTransaction(
    signedTransactionInfo: string,
  ): Promise<AppStoreVerificationResult<JWSTransactionDecodedPayload>> {
    const payload = this.transactions.get(signedTransactionInfo)
    if (!payload) {
      throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Fake transaction not found')
    }
    return { environment: Environment.SANDBOX, payload }
  }

  async verifyRenewalInfo(
    signedRenewalInfo: string,
  ): Promise<AppStoreVerificationResult<JWSRenewalInfoDecodedPayload>> {
    const payload = this.renewals.get(signedRenewalInfo)
    if (!payload) {
      throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Fake renewal not found')
    }
    return { environment: Environment.SANDBOX, payload }
  }

  async verifyNotification(
    signedPayload: string,
  ): Promise<AppStoreVerificationResult<ResponseBodyV2DecodedPayload>> {
    this.notificationVerificationCounts.set(
      signedPayload,
      this.notificationVerificationCount(signedPayload) + 1,
    )
    const payload = this.notifications.get(signedPayload)
    if (!payload) {
      throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Fake notification not found')
    }
    return { environment: Environment.SANDBOX, payload }
  }

  async getSubscriptionStatuses({ transactionId }: { transactionId: string }) {
    return this.statuses.get(transactionId) ?? []
  }
}

function activeTransaction(appAccountToken: string): JWSTransactionDecodedPayload {
  return {
    appAccountToken,
    environment: Environment.SANDBOX,
    expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
    originalTransactionId: 'original-active',
    productId: 'premium_monthly',
    purchaseDate: Date.now() - 60_000,
    transactionId: 'transaction-active',
    type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
    webOrderLineItemId: 'web-order-active',
  }
}

function activeRenewal(): JWSRenewalInfoDecodedPayload {
  return {
    autoRenewProductId: 'premium_monthly',
    autoRenewStatus: 1,
    environment: Environment.SANDBOX,
    originalTransactionId: 'original-active',
    productId: 'premium_monthly',
    renewalDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
  }
}
