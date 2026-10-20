import { createHash, randomUUID } from 'node:crypto'

import { Environment, OfferType, Status, Type, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { beforeEach, afterAll, describe, expect, test } from 'bun:test'
import { SignJWT } from 'jose'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import type { DbClient } from '../../db'
import { loadEnv, type AppEnv } from '../../env'
import { BillingService } from './application/billing-service'
import { createBillingTasks } from './index'
import { BillingFailure } from './domain/errors'
import type {
  AppStoreSubscriptionVerifier,
  AppStoreVerificationResult,
} from './infrastructure/apple-verifier'
import { createBillingDependencies } from './infrastructure/billing-adapters'
import type {
  GooglePlaySubscriptionPurchase,
  GooglePlaySubscriptionVerifier,
} from './infrastructure/google-play-verifier'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; run bun run test:backend:integration')

describe('iap API integration', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    ACCESS_TOKEN_TTL_SECONDS: '60',
    BILLING_ENABLED: 'true',
    APPLE_IAP_PRODUCT_IDS: 'premium_monthly,premium_yearly',
    CORS_ORIGINS: 'http://localhost:5173',
    JWT_SECRET: '12345678901234567890123456789012',
  })
  const prisma = createPrisma(databaseUrl)
  let verifier = new FakeAppStoreVerifier()
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    verifier = new FakeAppStoreVerifier()
    app = createApp({ env, prisma, appStoreIapVerifier: verifier })
    await prisma.taskOutbox.deleteMany()
    await prisma.appStoreWebhook.deleteMany()
    await prisma.appStoreTransaction.deleteMany()
    await prisma.googlePlaySubscriptionPurchase.deleteMany()
    await prisma.subscriptionEntitlement.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const protectedRequests = [
    { method: 'GET', path: '/api/iap/entitlement' },
    { method: 'POST', path: '/api/iap/app-store/offer-code-redemption' },
    { method: 'POST', path: '/api/iap/app-store/transactions', body: { signedTransactionInfo: 'signed' } },
    { method: 'POST', path: '/api/iap/app-store/reconcile', body: { originalTransactionIds: ['original'] } },
    { method: 'POST', path: '/api/iap/google-play/transactions', body: { productId: 'premium', purchaseToken: 'token' } },
    { method: 'POST', path: '/api/iap/google-play/reconcile', body: {} },
  ]

  test('omits billing routes by default and when disabled without calling stores', async () => {
    const session = await registerAndAuthorize('disabled-billing@example.com')
    let providerCalls = 0
    const unexpectedCall = async (): Promise<never> => {
      providerCalls += 1
      throw new Error('disabled billing called a store')
    }
    const defaultEnv = loadEnv({ DATABASE_URL: databaseUrl, JWT_SECRET: env.JWT_SECRET })
    expect(defaultEnv.BILLING_ENABLED).toBe(false)
    for (const disabledEnv of [defaultEnv, { ...env, BILLING_ENABLED: false }]) {
      const disabledApp = createApp({
        env: disabledEnv,
        prisma,
        appStoreIapVerifier: {
          verifyTransaction: unexpectedCall,
          verifyRenewalInfo: unexpectedCall,
          verifyNotification: unexpectedCall,
          getSubscriptionStatuses: unexpectedCall,
        },
        googlePlayIapVerifier: {
          getSubscriptionPurchase: unexpectedCall,
          acknowledgeSubscription: unexpectedCall,
        },
      })
      for (const request of [
        ...protectedRequests,
        { method: 'POST', path: '/api/webhooks/app-store', body: { signedPayload: 'signed' } },
      ]) {
        const response = await disabledApp.request(request.path, {
          method: request.method,
          headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
        })
        expect(response.status).toBe(404)
      }
    }
    expect(providerCalls).toBe(0)
    expect(await prisma.appStoreWebhook.count()).toBe(0)
    expect(await prisma.appStoreTransaction.count()).toBe(0)
    expect(await prisma.googlePlaySubscriptionPurchase.count()).toBe(0)
  })

  test('protects every enabled IAP endpoint before store calls', async () => {
    let providerCalls = 0
    const unexpectedCall = async (): Promise<never> => {
      providerCalls += 1
      throw new Error('unauthenticated request called a store')
    }
    const protectedApp = createApp({
      env, prisma,
      appStoreIapVerifier: {
        verifyTransaction: unexpectedCall, verifyRenewalInfo: unexpectedCall,
        verifyNotification: unexpectedCall, getSubscriptionStatuses: unexpectedCall,
      },
      googlePlayIapVerifier: { getSubscriptionPurchase: unexpectedCall, acknowledgeSubscription: unexpectedCall },
    })
    for (const request of protectedRequests) {
      const response = await protectedApp.request(request.path, {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      })
      expect(response.status).toBe(401)
    }
    expect(providerCalls).toBe(0)
  })

  test('bounds enabled IAP and webhook ingress independently of the account budget', async () => {
    for (const [path, body] of [
      ['/api/iap/app-store/transactions', { signedTransactionInfo: 'x'.repeat(64) }],
      ['/api/webhooks/app-store', { signedPayload: 'x'.repeat(64) }],
    ] as const) {
      const boundedApp = createApp({
        env: { ...env, IAP_BODY_LIMIT_BYTES: 32, WEBHOOK_BODY_LIMIT_BYTES: 32 }, prisma,
      })
      const oversized = await boundedApp.request(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      expect(oversized.status).toBe(413)
    }
    const rateApp = createApp({
      env: { ...env, AUTH_RATE_LIMIT_MAX: 1, IAP_RATE_LIMIT_MAX: 1, WEBHOOK_RATE_LIMIT_MAX: 1 },
      prisma, appStoreIapVerifier: verifier,
    })
    const account = await rateApp.request('/api/users/me', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(account.status).toBe(401)
    for (const [path, body, firstStatus] of [
      ['/api/iap/app-store/transactions', { signedTransactionInfo: 'signed' }, 401],
      ['/api/webhooks/app-store', { signedPayload: 'unverified' }, 400],
    ] as const) {
      const post = () => rateApp.request(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      expect((await post()).status).toBe(firstStatus)
      const limited = await post()
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).toBeTruthy()
    }
    expect(await prisma.appStoreWebhook.count()).toBe(0)
  })

  test('accepts the same Apple account UUID in uppercase through receipts and notifications', async () => {
    const session = await registerAndAuthorize('apple-uppercase-token@example.com')
    verifier.setTransaction('uppercase-receipt', activeTransaction(session.user.id.toUpperCase()))
    const receipt = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'uppercase-receipt',
    })
    expect(receipt.status).toBe(200)
    verifier.setTransaction('uppercase-renewal', {
      ...activeTransaction(session.user.id.toUpperCase()), transactionId: 'uppercase-next-period',
    })
    verifier.setNotification('uppercase-notification', {
      notificationUUID: 'uppercase-notification', notificationType: 'DID_RENEW',
      data: { signedTransactionInfo: 'uppercase-renewal', status: Status.ACTIVE },
    })
    expect((await webhook('uppercase-notification')).status).toBe(200)
    expect(await prisma.appStoreTransaction.count({ where: { userId: session.user.id } })).toBe(2)
  })

  test('rejects a signed renewal from another Apple subscription chain', async () => {
    const session = await registerAndAuthorize('apple-renewal-chain@example.com')
    verifier.setTransaction('chain-transaction', activeTransaction(session.user.id))
    verifier.setRenewal('foreign-renewal', {
      ...activeRenewal(), originalTransactionId: 'another-chain',
    })
    const rejected = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'chain-transaction', signedRenewalInfo: 'foreign-renewal',
    })
    expect(rejected.status).toBe(400)
    expect(await prisma.appStoreTransaction.count()).toBe(0)
    expect(await prisma.subscriptionEntitlement.count()).toBe(0)
  })

  test('merges Apple renewal and transaction clocks without erasing renewal or refund facts', async () => {
    const session = await registerAndAuthorize('apple-independent-clocks@example.com')
    const signedDate = Date.now() - 20_000
    const transaction = { ...activeTransaction(session.user.id), signedDate }
    const ingest = (signedTransactionInfo: string, signedRenewalInfo?: string) =>
      postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo, signedRenewalInfo })
    verifier.setTransaction('clock-original', transaction)
    verifier.setRenewal('clock-renewal-initial', { ...activeRenewal(), signedDate })
    expect((await ingest('clock-original', 'clock-renewal-initial')).status).toBe(200)

    verifier.setRenewal('clock-renewal-updated', {
      ...activeRenewal(), signedDate: signedDate + 2_000, autoRenewStatus: 0,
      autoRenewProductId: 'premium_yearly',
    })
    const renewal = await ingest('clock-original', 'clock-renewal-updated')
    expect(renewal.status).toBe(200)
    expect((await renewal.json()).subscription.willAutoRenew).toBe(false)

    verifier.setTransaction('clock-new-receipt', { ...transaction, signedDate: signedDate + 3_000 })
    const receipt = await ingest('clock-new-receipt')
    expect(receipt.status).toBe(200)
    expect((await receipt.json()).subscription.willAutoRenew).toBe(false)
    const oldRenewal = await ingest('clock-new-receipt', 'clock-renewal-initial')
    expect(oldRenewal.status).toBe(200)
    expect((await oldRenewal.json()).subscription.willAutoRenew).toBe(false)

    verifier.setTransaction('clock-refund', {
      ...transaction, signedDate: signedDate + 4_000, revocationDate: signedDate + 4_000,
    })
    expect((await ingest('clock-refund')).status).toBe(200)
    verifier.setRenewal('clock-renewal-after-refund', {
      ...activeRenewal(), signedDate: signedDate + 5_000,
    })
    const replay = await ingest('clock-new-receipt', 'clock-renewal-after-refund')
    expect(replay.status).toBe(200)
    expect((await replay.json()).subscription).toMatchObject({ state: 'revoked', isActive: false })
    const stored = await prisma.appStoreTransaction.findFirstOrThrow()
    expect(stored.revokedAt?.getTime()).toBe(signedDate + 4_000)
    expect(stored.signedTransactionHash).toBe(sha256('clock-refund'))

    verifier.setTransaction('clock-reversal', { ...transaction, signedDate: signedDate + 6_000 })
    const reversal = await ingest('clock-reversal')
    expect(reversal.status).toBe(200)
    expect((await reversal.json()).subscription).toMatchObject({ state: 'active', isActive: true, willAutoRenew: true })
  })

  test('enriches an unchanged Apple transaction with grace status and preserves it across bare receipts', async () => {
    const session = await registerAndAuthorize('apple-grace-clocks@example.com')
    const signedDate = Date.now() - 20_000
    const transaction = { ...activeTransaction(session.user.id), signedDate, expiresDate: Date.now() - 60_000 }
    const gracePeriodExpiresDate = Date.now() + 86_400_000
    verifier.setTransaction('grace-original', transaction)
    expect((await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'grace-original',
    })).status).toBe(200)
    verifier.setRenewal('grace-current-renewal', {
      ...activeRenewal(), signedDate: signedDate + 2_000,
      isInBillingRetryPeriod: true, gracePeriodExpiresDate,
    })
    verifier.setStatuses('original-active', [{
      status: Status.BILLING_GRACE_PERIOD,
      signedTransactionInfo: 'grace-original', signedRenewalInfo: 'grace-current-renewal',
    }])
    const grace = await postJson('/api/iap/app-store/reconcile', session.accessToken, {
      originalTransactionIds: ['original-active'],
    })
    expect(grace.status).toBe(200)
    expect((await grace.json()).subscription).toMatchObject({
      state: 'billing_grace_period', isActive: true, expiresAt: new Date(gracePeriodExpiresDate).toISOString(),
    })
    verifier.setTransaction('grace-new-receipt', { ...transaction, signedDate: signedDate + 3_000 })
    const receipt = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'grace-new-receipt',
    })
    expect(receipt.status).toBe(200)
    expect((await receipt.json()).subscription).toMatchObject({
      state: 'billing_grace_period', isActive: true, willAutoRenew: true,
      expiresAt: new Date(gracePeriodExpiresDate).toISOString(),
    })
  })

  test('replaces an Apple annual period with a newer shorter upgrade and ignores its upgraded predecessor', async () => {
    const session = await registerAndAuthorize('apple-shorter-upgrade@example.com')
    const signedDate = Date.now() - 20_000
    const annual = {
      ...activeTransaction(session.user.id), signedDate, productId: 'premium_yearly',
      transactionId: 'upgrade-annual', expiresDate: Date.now() + 365 * 86_400_000,
      purchaseDate: Date.now() - 10 * 86_400_000,
    }
    const monthly = {
      ...annual, signedDate: signedDate + 2_000, productId: 'premium_monthly',
      transactionId: 'upgrade-monthly', expiresDate: Date.now() + 30 * 86_400_000,
      purchaseDate: Date.now() - 60_000,
    }
    const ingest = (signedTransactionInfo: string) =>
      postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo })
    verifier.setTransaction('upgrade-old', annual)
    verifier.setTransaction('upgrade-new', monthly)
    expect((await ingest('upgrade-old')).status).toBe(200)
    const upgraded = await ingest('upgrade-new')
    expect(upgraded.status).toBe(200)
    expect((await upgraded.json()).subscription).toMatchObject({
      transactionId: 'upgrade-monthly', productId: 'premium_monthly', isActive: true,
      expiresAt: new Date(monthly.expiresDate).toISOString(),
    })
    verifier.setTransaction('upgrade-old-refreshed', { ...annual, signedDate: signedDate + 3_000, isUpgraded: true })
    expect((await ingest('upgrade-old-refreshed')).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ transactionId: 'upgrade-monthly' })
    verifier.setNotification('upgrade-expired', {
      signedDate: signedDate + 4_000, notificationUUID: 'upgrade-expired', notificationType: 'EXPIRED',
      data: { status: Status.EXPIRED, signedTransactionInfo: 'upgrade-new' },
    })
    const expired = await webhook('upgrade-expired')
    expect(expired.status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ transactionId: 'upgrade-monthly', state: 'expired' })
  })

  test('does not grant access from an already upgraded Apple transaction', async () => {
    const session = await registerAndAuthorize('apple-upgraded-first@example.com')
    verifier.setTransaction('already-upgraded', { ...activeTransaction(session.user.id), isUpgraded: true })
    const response = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'already-upgraded',
    })
    expect(response.status).toBe(200)
    expect((await response.json()).subscription.isActive).toBe(false)
  })

  test('ingests a valid App Store transaction and exposes it on the entitlement endpoint', async () => {
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

    const entitlement = await app.request('/api/iap/entitlement', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    const entitlementBody = await entitlement.json()

    expect(entitlement.status).toBe(200)
    expect(entitlementBody.subscription.isActive).toBe(true)
    expect(entitlementBody.subscription.transactionId).toBe('transaction-active')

    // The user contract stays billing-free, so a product without subscriptions never sees one.
    const me = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    const meBody = await me.json()

    expect(me.status).toBe(200)
    expect(meBody.user).not.toHaveProperty('subscription')
  })

  test('serves the active subscription to a freshly logged-in session', async () => {
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

    const entitlement = await app.request('/api/iap/entitlement', {
      headers: { Authorization: `Bearer ${body.accessToken}` },
    })

    expect(entitlement.status).toBe(200)
    expect((await entitlement.json()).subscription).toMatchObject({
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

  test('rejects conflicting Google Play account and profile ownership evidence', async () => {
    const firstUser = await registerAndAuthorize('google-conflict-first@example.com')
    const secondUser = await registerAndAuthorize('google-conflict-second@example.com')
    const billing = googlePlayBillingService(
      prisma,
      googlePlayPurchase(firstUser.user.id, secondUser.user.id),
    )

    await expect(billing.ingestGooglePlay({
      basePlanId: 'monthly',
      productId: 'premium',
      purchaseToken: 'google-conflicting-identity-token',
      userId: firstUser.user.id,
    })).rejects.toMatchObject({ code: 'IAP_OWNERSHIP_MISMATCH' })
    expect(await prisma.googlePlaySubscriptionPurchase.count()).toBe(0)
    expect(await prisma.subscriptionEntitlement.count()).toBe(0)
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

  test('keeps an Apple refund when old receipts and notifications replay, but accepts a newer reversal and renewal', async () => {
    const session = await registerAndAuthorize('apple-freshness@example.com')
    const signedDate = Date.now() - 10_000
    const purchased = { ...activeTransaction(session.user.id), signedDate }
    const refunded = { ...purchased, signedDate: signedDate + 2_000, revocationDate: signedDate + 2_000 }
    verifier.setTransaction('freshness-purchased', purchased)
    verifier.setTransaction('freshness-refunded', refunded)
    verifier.setNotification('freshness-refund', {
      notificationUUID: 'freshness-refund', notificationType: 'REFUND', signedDate: signedDate + 2_001,
      data: { signedTransactionInfo: 'freshness-refunded', status: Status.REVOKED },
    })
    verifier.setNotification('freshness-delayed-active', {
      notificationUUID: 'freshness-delayed-active', notificationType: 'DID_RENEW', signedDate: signedDate + 1,
      data: { signedTransactionInfo: 'freshness-purchased', status: Status.ACTIVE },
    })
    const ingest = (signedTransactionInfo: string) => postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo })
    expect((await ingest('freshness-purchased')).status).toBe(200)
    expect((await webhook('freshness-refund')).status).toBe(200)
    for (const replay of [() => ingest('freshness-purchased'), () => webhook('freshness-delayed-active')]) {
      expect((await replay()).status).toBe(200)
      expect(await prisma.appStoreTransaction.findUniqueOrThrow({ where: { transactionId: purchased.transactionId } })).toMatchObject({
        state: 'revoked', revokedAt: new Date(refunded.revocationDate), signedTransactionHash: sha256('freshness-refunded'),
      })
      expect(await prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { userId: session.user.id } })).toMatchObject({ state: 'revoked' })
    }

    verifier.setTransaction('freshness-reversed', { ...purchased, signedDate: signedDate + 4_000 })
    verifier.setNotification('freshness-reversal', {
      notificationUUID: 'freshness-reversal', notificationType: 'REFUND_REVERSED', signedDate: signedDate + 4_001,
      data: { signedTransactionInfo: 'freshness-reversed', status: Status.ACTIVE },
    })
    expect((await webhook('freshness-reversal')).status).toBe(200)
    expect(await prisma.appStoreTransaction.findFirstOrThrow()).toMatchObject({ state: 'active', revokedAt: null })
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ state: 'active' })

    verifier.setTransaction('freshness-renewed', {
      ...purchased, signedDate: signedDate + 6_000, transactionId: 'freshness-next-period',
      expiresDate: purchased.expiresDate! + 30 * 24 * 60 * 60 * 1000,
    })
    expect((await ingest('freshness-renewed')).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ state: 'active', transactionId: 'freshness-next-period' })
  })

  test('orders Apple status-only notifications by their signed date and fences older subscription periods', async () => {
    const session = await registerAndAuthorize('apple-status-freshness@example.com')
    const signedDate = Date.now() - 10_000
    const purchased = { ...activeTransaction(session.user.id), signedDate }
    verifier.setTransaction('status-purchased', purchased)
    verifier.setNotification('status-revoked', {
      notificationUUID: 'status-revoked', notificationType: 'REFUND', signedDate: signedDate + 4_000,
      data: { signedTransactionInfo: 'status-purchased', status: Status.REVOKED },
    })
    verifier.setNotification('status-delayed-active', {
      notificationUUID: 'status-delayed-active', notificationType: 'DID_RENEW', signedDate: signedDate + 2_000,
      data: { signedTransactionInfo: 'status-purchased', status: Status.ACTIVE },
    })
    expect((await webhook('status-revoked')).status).toBe(200)
    expect((await webhook('status-delayed-active')).status).toBe(200)
    expect(await prisma.appStoreTransaction.findFirstOrThrow()).toMatchObject({ state: 'revoked' })
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ state: 'revoked' })

    verifier.setRenewal('status-new-renewal', { ...activeRenewal(), signedDate: signedDate + 5_000 })
    verifier.setStatuses('original-active', [{
      status: Status.ACTIVE, signedTransactionInfo: 'status-purchased', signedRenewalInfo: 'status-new-renewal',
    }])
    const renewalOnly = await postJson('/api/iap/app-store/reconcile', session.accessToken, {
      originalTransactionIds: ['original-active'],
    })
    expect(renewalOnly.status).toBe(200)
    expect((await renewalOnly.json()).subscription).toMatchObject({ state: 'revoked', isActive: false })

    verifier.setTransaction('status-older-period', { ...purchased, transactionId: 'status-older-period', signedDate: signedDate - 1_000 })
    expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'status-older-period' })).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ state: 'revoked', transactionId: purchased.transactionId })

    verifier.setTransaction('status-current', { ...purchased, signedDate: signedDate + 6_000 })
    verifier.setStatuses('original-active', [{ status: Status.ACTIVE, signedTransactionInfo: 'status-current' }])
    const current = await postJson('/api/iap/app-store/reconcile', session.accessToken, { originalTransactionIds: ['original-active'] })
    expect(current.status).toBe(200)
    expect((await current.json()).subscription).toMatchObject({ state: 'active', isActive: true })
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

  test.each([false, true])('keeps the current Apple period when an older period is refunded (late delivery: %s)', async (lateDelivery) => {
    const session = await registerAndAuthorize('apple-period-refund@example.com')
    const now = Date.now()
    const previous = {
      ...activeTransaction(session.user.id), transactionId: 'previous-period',
      purchaseDate: now - 60 * 86_400_000, expiresDate: now - 30 * 86_400_000,
      signedDate: now - 5_000,
    }
    const current = {
      ...activeTransaction(session.user.id), transactionId: 'current-period',
      purchaseDate: now - 30 * 86_400_000, signedDate: now - 3_000,
    }
    verifier.setTransaction('previous-period', previous)
    verifier.setTransaction('current-period', current)
    for (const signedTransactionInfo of ['previous-period', 'current-period']) {
      expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo })).status).toBe(200)
    }
    const refundSignedAt = now - (lateDelivery ? 4_000 : 2_000)
    verifier.setTransaction('previous-refunded', { ...previous, revocationDate: refundSignedAt, signedDate: refundSignedAt })
    verifier.setNotification('previous-refund', {
      notificationUUID: 'previous-refund', signedDate: refundSignedAt, notificationType: 'REFUND',
      data: { signedTransactionInfo: 'previous-refunded', status: Status.ACTIVE },
    })
    expect((await webhook('previous-refund')).status).toBe(200)
    expect(await prisma.appStoreTransaction.findUniqueOrThrow({ where: { transactionId: previous.transactionId } })).toMatchObject({
      state: 'revoked', revokedAt: new Date(refundSignedAt), signedTransactionHash: sha256('previous-refunded'),
    })
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({
      state: 'active', transactionId: current.transactionId, expiresAt: new Date(current.expiresDate!),
    })

    verifier.setTransaction('current-refunded', { ...current, revocationDate: now - 1_000, signedDate: now - 1_000 })
    verifier.setNotification('current-refund', {
      notificationUUID: 'current-refund', signedDate: now - 1_000, notificationType: 'REFUND',
      data: { signedTransactionInfo: 'current-refunded', status: Status.REVOKED },
    })
    expect((await webhook('current-refund')).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ state: 'revoked', transactionId: current.transactionId })
    verifier.setTransaction('current-reversed', { ...current, signedDate: now })
    verifier.setNotification('current-reversal', {
      notificationUUID: 'current-reversal', signedDate: now, notificationType: 'REFUND_REVERSED',
      data: { signedTransactionInfo: 'current-reversed', status: Status.ACTIVE },
    })
    expect((await webhook('current-reversal')).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ state: 'active', transactionId: current.transactionId })
  })

  test('fences an older Apple request that completes verification after a refund commits', async () => {
    const session = await registerAndAuthorize('apple-delayed-receipt@example.com')
    const signedDate = Date.now() - 5_000
    const purchased = { ...activeTransaction(session.user.id), signedDate }
    verifier.setTransaction('delayed-purchased', purchased)
    verifier.setTransaction('delayed-refunded', { ...purchased, signedDate: signedDate + 2_000, revocationDate: signedDate + 2_000 })
    verifier.setNotification('delayed-refund', {
      notificationUUID: 'delayed-refund', notificationType: 'REFUND', signedDate: signedDate + 2_001,
      data: { signedTransactionInfo: 'delayed-refunded', status: Status.REVOKED },
    })
    const entered = deferred()
    const release = deferred()
    const verify = verifier.verifyTransaction.bind(verifier)
    verifier.verifyTransaction = async (signed) => {
      const result = await verify(signed)
      if (signed === 'delayed-purchased') {
        entered.resolve()
        await release.promise
      }
      return result
    }
    const delayed = postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'delayed-purchased' })
    try {
      await entered.promise
      expect((await webhook('delayed-refund')).status).toBe(200)
    } finally {
      release.resolve()
    }
    const response = await delayed
    expect(response.status).toBe(200)
    expect((await response.json()).subscription).toMatchObject({ state: 'revoked', isActive: false })
    expect(await prisma.appStoreTransaction.findFirstOrThrow()).toMatchObject({ state: 'revoked', signedTransactionHash: sha256('delayed-refunded') })
  })

  test('applies a refund for a newer Apple replacement period with a shorter duration', async () => {
    const session = await registerAndAuthorize('apple-replacement-refund@example.com')
    const now = Date.now()
    verifier.setTransaction('before-replacement', { ...activeTransaction(session.user.id), signedDate: now - 1_000 })
    expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'before-replacement' })).status).toBe(200)
    verifier.setTransaction('replacement-refund', {
      ...activeTransaction(session.user.id), transactionId: 'replacement-period',
      purchaseDate: now, expiresDate: now + 5 * 86_400_000, signedDate: now + 1, revocationDate: now + 1,
    })
    verifier.setNotification('replacement-refund', {
      notificationUUID: 'replacement-refund', signedDate: now + 1, notificationType: 'REFUND',
      data: { signedTransactionInfo: 'replacement-refund', status: Status.REVOKED },
    })
    expect((await webhook('replacement-refund')).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ state: 'revoked', transactionId: 'replacement-period' })
  })

  test('rejects Apple snapshots with missing or invalid signed dates without writes', async () => {
    const session = await registerAndAuthorize('apple-invalid-date@example.com')
    for (const signedDate of [undefined, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      verifier.setTransaction('invalid-date', { ...activeTransaction(session.user.id), signedDate })
      const response = await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'invalid-date' })
      expect(response.status).toBe(400)
    }
    verifier.setTransaction('valid-date', activeTransaction(session.user.id))
    verifier.setNotification('invalid-notification-date', {
      notificationUUID: 'invalid-date', signedDate: undefined,
      data: { signedTransactionInfo: 'valid-date', status: Status.ACTIVE },
    })
    expect((await webhook('invalid-notification-date')).status).toBe(400)
    expect(await prisma.appStoreTransaction.count()).toBe(0)
    expect(await prisma.subscriptionEntitlement.count()).toBe(0)
    expect(await prisma.appStoreWebhook.count()).toBe(0)
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

  test('deduplicates re-signed App Store webhooks by verified notification UUID', async () => {
    const session = await registerAndAuthorize('webhook-resigned@example.com')
    verifier.setTransaction('signed-webhook-resigned-active', {
      ...activeTransaction(session.user.id),
      transactionId: 'transaction-webhook-resigned',
    })
    const notification = {
      notificationUUID: 'notification-resigned-1',
      notificationType: 'DID_RENEW' as const,
      data: {
        environment: Environment.SANDBOX,
        signedTransactionInfo: 'signed-webhook-resigned-active',
        status: Status.ACTIVE,
      },
    }
    verifier.setNotification('signed-webhook-resigned-a', notification)
    verifier.setNotification('signed-webhook-resigned-b', notification)

    const first = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook-resigned-a' }),
    })
    const second = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook-resigned-b' }),
    })

    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ duplicate: false })
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ duplicate: true })
    expect(await prisma.appStoreWebhook.count()).toBe(1)
    expect(await prisma.appStoreTransaction.count()).toBe(1)
  })

  test('does not retain unverified App Store webhook payloads', async () => {
    const response = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'attacker-controlled-invalid-payload' }),
    })

    expect(response.status).toBe(400)
    expect(await prisma.appStoreWebhook.count()).toBe(0)
  })


  test('persists Apple grace expiration and removes access on status-only revocation', async () => {
    const session = await registerAndAuthorize('grace-revoked@example.com')
    const graceExpiry = Date.now() + 3 * 24 * 60 * 60 * 1000
    verifier.setTransaction('signed-grace', {
      ...activeTransaction(session.user.id), expiresDate: Date.now() - 24 * 60 * 60 * 1000,
    })
    verifier.setRenewal('renewal-grace', { ...activeRenewal(), gracePeriodExpiresDate: graceExpiry })
    verifier.setStatuses('original-active', [{
      status: Status.BILLING_GRACE_PERIOD, signedTransactionInfo: 'signed-grace', signedRenewalInfo: 'renewal-grace',
    }])
    const grace = await postJson('/api/iap/app-store/reconcile', session.accessToken, { originalTransactionIds: ['original-active'] })
    expect(grace.status).toBe(200)
    expect((await grace.json()).subscription).toMatchObject({
      isActive: true, state: 'billing_grace_period', expiresAt: new Date(graceExpiry).toISOString(),
    })
    expect((await prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { userId: session.user.id } })).expiresAt?.getTime()).toBe(graceExpiry)
    verifier.setTransaction('signed-future', activeTransaction(session.user.id))
    expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'signed-future' })).status).toBe(200)
    verifier.setTransaction('signed-revoked', {
      ...activeTransaction(session.user.id), expiresDate: undefined,
    })
    verifier.setStatuses('original-active', [{ status: Status.REVOKED, signedTransactionInfo: 'signed-revoked' }])
    const revoked = await postJson('/api/iap/app-store/reconcile', session.accessToken, { originalTransactionIds: ['original-active'] })
    expect(revoked.status).toBe(200)
    expect((await revoked.json()).subscription).toMatchObject({ isActive: false, state: 'revoked', transactionId: 'transaction-active' })
    expect((await prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { userId: session.user.id } })).state).toBe('revoked')
  })

  test('requires a current issuing-user offer-code token and verified offer metadata', async () => {
    const session = await registerAndAuthorize('offer-owner@example.com')
    const other = await registerAndAuthorize('offer-other@example.com')
    const issue = await postJson('/api/iap/app-store/offer-code-redemption', session.accessToken, undefined)
    expect(issue.status).toBe(200)
    const { token } = await issue.json()
    const expiredToken = await new SignJWT({ scope: 'iap_offer_code_redemption' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(session.user.id)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 30)
      .sign(new TextEncoder().encode(env.JWT_SECRET))
    const offer: JWSTransactionDecodedPayload = {
      ...activeTransaction(session.user.id), appAccountToken: undefined,
      purchaseDate: Date.now(), offerType: OfferType.OFFER_CODE, offerIdentifier: 'WINBACK2026',
    }
    verifier.setTransaction('signed-offer', offer)
    for (const [accessToken, proof] of [
      [other.accessToken, token], [session.accessToken, expiredToken], [session.accessToken, 'not-a-jwt'],
    ]) {
      const rejected = await postJson('/api/iap/app-store/transactions', accessToken, {
        signedTransactionInfo: 'signed-offer', offerCodeRedemptionToken: proof,
      })
      expect(rejected.status).toBe(403)
      expect((await rejected.json()).error.code).toBe('IAP_OWNERSHIP_MISMATCH')
    }
    for (const overrides of [
      { offerType: undefined }, { offerType: OfferType.PROMOTIONAL_OFFER },
      { offerIdentifier: undefined }, { offerIdentifier: '   ' },
    ]) {
      verifier.setTransaction('signed-invalid-offer', { ...offer, ...overrides })
      const rejected = await postJson('/api/iap/app-store/transactions', session.accessToken, {
        signedTransactionInfo: 'signed-invalid-offer', offerCodeRedemptionToken: token,
      })
      expect(rejected.status).toBe(403)
    }
    expect(await prisma.appStoreTransaction.count()).toBe(0)
    expect(await prisma.subscriptionEntitlement.count()).toBe(0)
    const accepted = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-offer', offerCodeRedemptionToken: token,
    })
    expect(accepted.status).toBe(200)
    expect((await prisma.appStoreTransaction.findFirstOrThrow()).userId).toBe(session.user.id)
  })

  test('resolves tokenless Apple webhooks from purchase history after Google replaces the entitlement', async () => {
    const owner = await registerAndAuthorize('apple-history-owner@example.com')
    const other = await registerAndAuthorize('apple-history-other@example.com')
    const issue = await postJson('/api/iap/app-store/offer-code-redemption', owner.accessToken, undefined)
    expect(issue.status).toBe(200)
    const { token } = await issue.json()
    const now = Date.now()
    const dayMs = 86_400_000
    const offer = {
      ...activeTransaction(owner.user.id), appAccountToken: undefined,
      purchaseDate: now, expiresDate: now + dayMs, signedDate: now,
      offerType: OfferType.OFFER_CODE, offerIdentifier: 'HISTORY2026',
    }
    verifier.setTransaction('history-offer', offer)
    expect((await postJson('/api/iap/app-store/transactions', owner.accessToken, {
      signedTransactionInfo: 'history-offer', offerCodeRedemptionToken: token,
    })).status).toBe(200)

    const googlePurchase = googlePlayPurchase(owner.user.id)
    googlePurchase.lineItems![0]!.expiryTime = new Date(now + 2 * dayMs).toISOString()
    app = googleApp({
      getSubscriptionPurchase: async () => googlePurchase,
      acknowledgeSubscription: async () => undefined,
    })
    expect((await googleIngest(owner.accessToken)).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { userId: owner.user.id } }))
      .toMatchObject({ platform: 'android', originalTransactionId: null })

    const renewed = {
      ...offer, transactionId: 'history-renewed', purchaseDate: now + 1,
      expiresDate: now + 3 * dayMs, signedDate: now + 1,
    }
    verifier.setTransaction('history-renewed', renewed)
    verifier.setTransaction('history-with-account-token', { ...renewed, appAccountToken: owner.user.id })
    for (const signedTransactionInfo of ['history-renewed', 'history-with-account-token']) {
      const denied = await postJson('/api/iap/app-store/transactions', other.accessToken, { signedTransactionInfo })
      expect(denied.status).toBe(403)
      expect((await denied.json()).error.code).toBe('IAP_OWNERSHIP_MISMATCH')
    }

    verifier.setTransaction('history-unknown', {
      ...renewed, originalTransactionId: 'unknown-original', transactionId: 'unknown-transaction',
    })
    verifier.setNotification('history-unknown', {
      notificationUUID: 'history-unknown', signedDate: now + 2,
      data: { signedTransactionInfo: 'history-unknown', status: Status.ACTIVE },
    })
    expect((await webhook('history-unknown')).status).toBe(200)
    expect(await prisma.appStoreTransaction.count()).toBe(1)

    verifier.setNotification('history-renewed', {
      notificationUUID: 'history-renewed', notificationType: 'DID_RENEW', signedDate: now + 2,
      data: { signedTransactionInfo: 'history-renewed', status: Status.ACTIVE },
    })
    expect((await webhook('history-renewed')).status).toBe(200)
    expect(await prisma.appStoreTransaction.findUnique({ where: { transactionId: renewed.transactionId } }))
      .toMatchObject({ userId: owner.user.id, state: 'active' })
    expect(await prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { userId: owner.user.id } }))
      .toMatchObject({ platform: 'ios', state: 'active', transactionId: renewed.transactionId })

    verifier.setTransaction('history-refunded', { ...renewed, signedDate: now + 3, revocationDate: now + 3 })
    verifier.setNotification('history-refunded', {
      notificationUUID: 'history-refunded', notificationType: 'REFUND', signedDate: now + 4,
      data: { signedTransactionInfo: 'history-refunded', status: Status.REVOKED },
    })
    expect((await webhook('history-refunded')).status).toBe(200)
    expect(await prisma.appStoreTransaction.findUniqueOrThrow({ where: { transactionId: renewed.transactionId } }))
      .toMatchObject({ userId: owner.user.id, state: 'revoked' })
    expect(await prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { userId: owner.user.id } }))
      .toMatchObject({ state: 'active', platform: 'android' })
    expect(await prisma.subscriptionEntitlement.findUnique({ where: { userId: other.user.id } })).toBeNull()
  })

  test.each(['receipt', 'webhook'] as const)('rejects an Apple account-token owner change through %s after Google replaces the entitlement', async (ingress) => {
    const owner = await registerAndAuthorize('apple-immutable-owner@example.com')
    const other = await registerAndAuthorize('apple-immutable-other@example.com')
    const purchased = activeTransaction(owner.user.id)
    verifier.setTransaction('immutable-purchase', purchased)
    expect((await postJson('/api/iap/app-store/transactions', owner.accessToken, {
      signedTransactionInfo: 'immutable-purchase',
    })).status).toBe(200)
    app = googleApp({
      getSubscriptionPurchase: async () => googlePlayPurchase(owner.user.id),
      acknowledgeSubscription: async () => undefined,
    })
    expect((await googleIngest(owner.accessToken)).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { userId: owner.user.id } }))
      .toMatchObject({ platform: 'android', originalTransactionId: null })

    verifier.setTransaction('immutable-renewal', {
      ...purchased, appAccountToken: other.user.id, transactionId: 'immutable-renewal',
      signedDate: purchased.signedDate! + 1,
    })
    verifier.setNotification('immutable-renewal', {
      notificationUUID: 'immutable-renewal', signedDate: purchased.signedDate! + 2,
      data: { signedTransactionInfo: 'immutable-renewal', status: Status.ACTIVE },
    })
    const rejected = ingress === 'receipt'
      ? await postJson('/api/iap/app-store/transactions', other.accessToken, { signedTransactionInfo: 'immutable-renewal' })
      : await webhook('immutable-renewal')
    expect(rejected.status).toBe(403)
    expect((await rejected.json()).error.code).toBe('IAP_OWNERSHIP_MISMATCH')

    // Historical ownership must not authorize a receipt carrying another account's token.
    const conflictingToken = await postJson('/api/iap/app-store/transactions', owner.accessToken, {
      signedTransactionInfo: 'immutable-renewal',
    })
    expect(conflictingToken.status).toBe(403)
    expect((await conflictingToken.json()).error.code).toBe('IAP_OWNERSHIP_MISMATCH')
    expect(await prisma.appStoreTransaction.findMany()).toMatchObject([
      { userId: owner.user.id, transactionId: purchased.transactionId },
    ])
    expect(await prisma.subscriptionEntitlement.findUnique({ where: { userId: other.user.id } })).toBeNull()
    expect(await prisma.appStoreWebhook.count()).toBe(0)
  })

  test('rejects verified non-subscriptions and sandbox purchases in production without writes', async () => {
    const session = await registerAndAuthorize('invalid-apple-type@example.com')
    verifier.setTransaction('signed-consumable', { ...activeTransaction(session.user.id), type: Type.CONSUMABLE })
    expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'signed-consumable' })).status).toBe(400)
    app = createApp({ env: { ...env, APPLE_IAP_ENVIRONMENT: 'Production', APPLE_IAP_APP_APPLE_ID: 123456789 }, prisma, appStoreIapVerifier: verifier })
    verifier.setTransaction('signed-sandbox', activeTransaction(session.user.id))
    expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'signed-sandbox' })).status).toBe(400)
    expect(await prisma.appStoreTransaction.count()).toBe(0)
    expect(await prisma.subscriptionEntitlement.count()).toBe(0)
  })

  test('durably grants Google Play before acknowledgement and safely retries failures and replay', async () => {
    const session = await registerAndAuthorize('google-ack@example.com')
    const purchase = googlePlayPurchase(session.user.id)
    purchase.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_PENDING'
    let acknowledgementFails = true
    const googleVerifier: GooglePlaySubscriptionVerifier = {
      getSubscriptionPurchase: async () => purchase,
      acknowledgeSubscription: async () => {
        expect(await prisma.subscriptionEntitlement.count()).toBe(1)
        expect(await prisma.googlePlaySubscriptionPurchase.count()).toBe(1)
        expect(await prisma.taskOutbox.count({ where: { type: 'billing:google-play:acknowledge' } })).toBe(1)
        if (acknowledgementFails) throw new Error('Google Play unavailable')
        purchase.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
      },
    }
    app = googleApp(googleVerifier)
    expect((await googleIngest(session.accessToken)).status).toBe(500)
    expect(await prisma.googlePlaySubscriptionPurchase.count()).toBe(1)
    expect(await prisma.subscriptionEntitlement.count()).toBe(1)
    acknowledgementFails = false
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await googleIngest(session.accessToken)
      expect(response.status).toBe(200)
      expect((await response.json()).subscription).toMatchObject({ isActive: true, platform: 'android', state: 'active' })
    }
    expect(await prisma.googlePlaySubscriptionPurchase.count()).toBe(1)
    expect(await prisma.subscriptionEntitlement.count()).toBe(1)
    expect(await prisma.googlePlaySubscriptionPurchase.findFirstOrThrow()).toMatchObject({
      userId: session.user.id, basePlanId: 'monthly', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    })
    const restored = await postJson('/api/iap/google-play/reconcile', session.accessToken, {})
    expect(restored.status).toBe(200)
    expect((await restored.json()).subscription.isActive).toBe(true)
  })

  test('rejects Google Play production test purchases, foreign owners and missing allowlists', async () => {
    const owner = await registerAndAuthorize('google-policy-owner@example.com')
    const other = await registerAndAuthorize('google-policy-other@example.com')
    let acknowledgeCalls = 0
    const purchase = { ...googlePlayPurchase(owner.user.id), acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' }
    const googleVerifier: GooglePlaySubscriptionVerifier = {
      getSubscriptionPurchase: async () => purchase,
      acknowledgeSubscription: async () => { acknowledgeCalls += 1 },
    }
    for (const [settings, token, status, code] of [
      [{ NODE_ENV: 'production' as const }, owner.accessToken, 400, 'IAP_INVALID_TRANSACTION'],
      [{}, other.accessToken, 403, 'IAP_OWNERSHIP_MISMATCH'],
      [{ GOOGLE_PLAY_BASE_PLAN_IDS: [] }, owner.accessToken, 503, 'IAP_NOT_CONFIGURED'],
    ] satisfies Array<[Partial<AppEnv>, string, number, string]>) {
      app = googleApp(googleVerifier, settings)
      const rejected = await googleIngest(token)
      expect(rejected.status).toBe(status)
      expect((await rejected.json()).error.code).toBe(code)
    }
    expect(acknowledgeCalls).toBe(0)
    expect(await prisma.googlePlaySubscriptionPurchase.count()).toBe(0)
    expect(await prisma.subscriptionEntitlement.count()).toBe(0)
  })

  test('recovers durable Google acknowledgement after restart and waits while billing is disabled', async () => {
    const session = await registerAndAuthorize('google-restart@example.com')
    const purchase = { ...googlePlayPurchase(session.user.id), acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' }
    app = googleApp({ getSubscriptionPurchase: async () => purchase, acknowledgeSubscription: async () => { throw new Error('Provider unavailable') } })
    expect((await googleIngest(session.accessToken)).status).toBe(500)
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'billing:google-play:acknowledge' } })
    const purchaseId = (task.payload as { purchaseId: string }).purchaseId
    expect(task.payload).toEqual({ purchaseId })
    let providerCalls = 0
    const signal = new AbortController().signal
    const googlePlayVerifier: GooglePlaySubscriptionVerifier = {
      getSubscriptionPurchase: async (input) => { expect(input.signal).toBe(signal); providerCalls += 1; return purchase },
      acknowledgeSubscription: async (input) => { expect(input.signal).toBe(signal); providerCalls += 1; purchase.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' },
    }
    await expect(createBillingTasks({ db: prisma, env: { ...env, BILLING_ENABLED: false }, googlePlayVerifier }).acknowledgeGooglePlayPurchase(purchaseId, signal)).rejects.toThrow('Billing is disabled')
    expect(providerCalls).toBe(0)
    const tasks = createBillingTasks({ db: prisma, env, googlePlayVerifier })
    await tasks.acknowledgeGooglePlayPurchase(purchaseId, signal)
    await tasks.acknowledgeGooglePlayPurchase(purchaseId, signal)
    expect(providerCalls).toBe(2)
    expect(await prisma.googlePlaySubscriptionPurchase.findUniqueOrThrow({ where: { id: purchaseId } })).toMatchObject({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' })
  })

  test('uses modern Google line item orders and stable identity when an order is absent', async () => {
    const session = await registerAndAuthorize('google-no-order@example.com')
    const purchase = googlePlayPurchase(session.user.id)
    delete purchase.latestOrderId
    purchase.lineItems![0]!.latestSuccessfulOrderId = 'modern-order'
    app = googleApp({ getSubscriptionPurchase: async () => purchase, acknowledgeSubscription: async () => undefined })
    const ingest = (token: string) => postJson('/api/iap/google-play/transactions', session.accessToken, { productId: 'premium', purchaseToken: token })
    expect((await ingest('current')).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ transactionId: 'modern-order' })
    delete purchase.lineItems![0]!.latestSuccessfulOrderId
    expect((await ingest('current')).status).toBe(200)
    const currentId = (await prisma.subscriptionEntitlement.findFirstOrThrow()).googlePlayPurchaseId
    expect(currentId).not.toBeNull()
    purchase.subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED'
    purchase.lineItems![0]!.expiryTime = new Date(Date.now() - 1000).toISOString()
    expect((await (await ingest('old')).json()).subscription.isActive).toBe(true)
    expect((await (await ingest('current')).json()).subscription.isActive).toBe(false)
    expect((await prisma.subscriptionEntitlement.findFirstOrThrow()).googlePlayPurchaseId).toBe(currentId)
  })

  test.each([true, false])('keeps replaced Google tokens from revoking or restoring access; predecessor submitted=%s', async (submitPredecessor) => {
    const session = await registerAndAuthorize('google-replacement@example.com')
    const old = googlePlayPurchase(session.user.id)
    delete old.latestOrderId
    const replacement = structuredClone(old)
    replacement.linkedPurchaseToken = 'previous-token'
    replacement.lineItems![0]!.expiryTime = '2098-07-01T00:00:00Z'
    let current = old
    app = googleApp({ getSubscriptionPurchase: async () => current, acknowledgeSubscription: async () => undefined })
    const ingest = (token: string) => postJson('/api/iap/google-play/transactions', session.accessToken, { productId: 'premium', purchaseToken: token })
    if (submitPredecessor) expect((await ingest('previous-token')).status).toBe(200)
    current = replacement
    expect((await ingest('replacement-token')).status).toBe(200)
    const replacementId = (await prisma.subscriptionEntitlement.findFirstOrThrow()).googlePlayPurchaseId
    current = { ...old, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }
    expect((await (await ingest('previous-token')).json()).subscription.isActive).toBe(true)
    current = { ...replacement, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }
    expect((await (await ingest('replacement-token')).json()).subscription.isActive).toBe(false)
    current = old
    expect((await (await ingest('previous-token')).json()).subscription.isActive).toBe(false)
    expect((await prisma.subscriptionEntitlement.findFirstOrThrow()).googlePlayPurchaseId).toBe(replacementId)
  })

  test.each([
    { order: ['a', 'c', 'b'], revoked: false },
    { order: ['a', 'd', 'c', 'b'], revoked: true },
    { order: ['d', 'c', 'b', 'a'], revoked: false },
  ])('retains Google replacement ancestry across late intermediate tokens: %j', async ({ order, revoked }: { order: readonly string[]; revoked: boolean }) => {
    const session = await registerAndAuthorize('google-late-ancestry@example.com')
    const winner = order.includes('d') ? 'd' : 'c'
    const purchases = new Map(['a', 'b', 'c', 'd'].map((token, index, tokens) => {
      const purchase = googlePlayPurchase(session.user.id)
      purchase.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_PENDING'
      purchase.linkedPurchaseToken = tokens[index - 1]
      return [token, purchase] as const
    }))
    const acknowledged: string[] = []
    app = googleApp({
      getSubscriptionPurchase: async ({ purchaseToken }) => purchases.get(purchaseToken)!,
      acknowledgeSubscription: async ({ purchaseToken }) => { acknowledged.push(purchaseToken) },
    })
    const ingest = (purchaseToken: string) => postJson('/api/iap/google-play/transactions', session.accessToken, {
      productId: 'premium', purchaseToken,
    })
    for (const token of order) expect((await ingest(token)).status).toBe(200)

    const rows = await prisma.googlePlaySubscriptionPurchase.findMany()
    expect(rows).toHaveLength(order.length)
    for (const row of rows) {
      if (row.purchaseToken !== winner) expect(row.supersededById).not.toBeNull()
    }
    expect(acknowledged).toEqual(order[0] === 'a' ? ['a', winner] : [winner])
    expect(await prisma.taskOutbox.count()).toBe(acknowledged.length)

    const ended = purchases.get(winner)!
    ended.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
    ended.subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED'
    if (!revoked) ended.lineItems![0]!.expiryTime = new Date(Date.now() - 1000).toISOString()
    expect((await (await ingest(winner)).json()).subscription.isActive).toBe(false)
    for (const token of order.filter((token) => token !== winner)) {
      expect((await (await ingest(token)).json()).subscription.isActive).toBe(false)
    }
    const read = await app.request('/api/iap/entitlement', { headers: { Authorization: `Bearer ${session.accessToken}` } })
    expect((await read.json()).subscription.isActive).toBe(false)
    expect(acknowledged).toEqual(order[0] === 'a' ? ['a', winner] : [winner])
  })

  test('canceled pending Google replacement preserves its predecessor', async () => {
    const session = await registerAndAuthorize('google-pending-replacement@example.com')
    const purchase = googlePlayPurchase(session.user.id)
    delete purchase.latestOrderId
    app = googleApp({ getSubscriptionPurchase: async () => purchase, acknowledgeSubscription: async () => undefined })
    expect((await googleIngest(session.accessToken)).status).toBe(200)
    purchase.linkedPurchaseToken = 'purchase-token'
    purchase.subscriptionState = 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'
    const canceled = await postJson('/api/iap/google-play/transactions', session.accessToken, { productId: 'premium', purchaseToken: 'pending-replacement' })
    expect((await canceled.json()).subscription.isActive).toBe(true)
    expect(await prisma.googlePlaySubscriptionPurchase.findUniqueOrThrow({ where: { purchaseTokenHash: sha256('purchase-token') } })).toMatchObject({ supersededById: null })
  })

  test('rejects explicit foreign Google identity even when token history belongs to caller', async () => {
    const session = await registerAndAuthorize('google-identity-conflict@example.com')
    const other = await registerAndAuthorize('google-identity-other@example.com')
    const purchase = googlePlayPurchase(session.user.id)
    app = googleApp({ getSubscriptionPurchase: async () => purchase, acknowledgeSubscription: async () => undefined })
    expect((await googleIngest(session.accessToken)).status).toBe(200)
    purchase.externalAccountIdentifiers = googlePlayPurchase(other.user.id).externalAccountIdentifiers
    expect((await googleIngest(session.accessToken)).status).toBe(403)
  })

  test('refreshes current allowed Google line item after a deferred plan change', async () => {
    const session = await registerAndAuthorize('google-current-plan@example.com')
    const purchase = googlePlayPurchase(session.user.id)
    app = googleApp({ getSubscriptionPurchase: async () => purchase, acknowledgeSubscription: async () => undefined }, { GOOGLE_PLAY_BASE_PLAN_IDS: ['monthly', 'yearly'], GOOGLE_PLAY_PRODUCT_IDS: ['premium', 'premium-yearly'] })
    expect((await googleIngest(session.accessToken)).status).toBe(200)
    const oldItem = purchase.lineItems![0]!
    purchase.lineItems!.push({ ...oldItem, productId: 'premium-yearly', offerDetails: { basePlanId: 'yearly' }, expiryTime: null })
    expect((await postJson('/api/iap/google-play/reconcile', session.accessToken, {})).status).toBe(200)
    expect(await prisma.googlePlaySubscriptionPurchase.findFirstOrThrow()).toMatchObject({ productId: 'premium', basePlanId: 'monthly' })
    oldItem.expiryTime = new Date(Date.now() - 1000).toISOString()
    purchase.lineItems![1]!.expiryTime = '2099-08-01T00:00:00Z'
    expect((await postJson('/api/iap/google-play/reconcile', session.accessToken, {})).status).toBe(200)
    expect(await prisma.googlePlaySubscriptionPurchase.findFirstOrThrow()).toMatchObject({ productId: 'premium-yearly', basePlanId: 'yearly' })
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ productId: 'premium-yearly', state: 'active' })
    const obsoleteProduct = await googleIngest(session.accessToken)
    expect(obsoleteProduct.status).toBe(200)
    expect((await obsoleteProduct.json()).subscription).toMatchObject({ productId: 'premium-yearly', isActive: true })
    expect(await prisma.googlePlaySubscriptionPurchase.findFirstOrThrow()).toMatchObject({ productId: 'premium-yearly', basePlanId: 'yearly', state: 'active' })
    expect((await postJson('/api/iap/google-play/transactions', session.accessToken, { productId: 'premium-yearly', basePlanId: 'monthly', purchaseToken: 'purchase-token' })).status).toBe(400)
  })

  test.each(['read', 'receipt', 'google-revocation'] as const)('retains paid Apple access after the selected Google purchase ends through %s', async (operation) => {
    const session = await registerAndAuthorize('remaining-apple@example.com')
    verifier.setTransaction('remaining-apple', activeTransaction(session.user.id))
    expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'remaining-apple' })).status).toBe(200)
    const googlePurchase = googlePlayPurchase(session.user.id)
    app = googleApp({ getSubscriptionPurchase: async () => googlePurchase, acknowledgeSubscription: async () => undefined })
    expect((await googleIngest(session.accessToken)).status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ platform: 'android' })

    const expiredAt = new Date(Date.now() - 1_000)
    if (operation !== 'google-revocation') {
      // Advance the stored paid period without relying on wall-clock sleeps.
      await prisma.googlePlaySubscriptionPurchase.updateMany({ data: { expiresAt: expiredAt } })
      await prisma.subscriptionEntitlement.updateMany({ data: { expiresAt: expiredAt } })
    } else {
      googlePurchase.subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED'
      googlePurchase.lineItems![0]!.expiryTime = expiredAt.toISOString()
    }
    const response = operation === 'read'
      ? await app.request('/api/iap/entitlement', { headers: { Authorization: `Bearer ${session.accessToken}` } })
      : operation === 'receipt'
        ? await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'remaining-apple' })
        : await googleIngest(session.accessToken)
    expect(response.status).toBe(200)
    expect((await response.json()).subscription).toMatchObject({ isActive: true, platform: 'ios', transactionId: 'transaction-active' })
    const saved = await prisma.subscriptionEntitlement.findFirstOrThrow()
    expect(saved).toMatchObject({ platform: 'ios', state: 'active' })
    const read = await app.request('/api/iap/entitlement', { headers: { Authorization: `Bearer ${session.accessToken}` } })
    expect(read.status).toBe(200)
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ revision: saved.revision, updatedAt: saved.updatedAt })
  })

  test.each([
    { providerStatus: 410, old: true, retired: true },
    { providerStatus: 410, old: false, retired: false },
    { providerStatus: 503, old: true, retired: false },
    { providerStatus: 403, old: true, retired: false },
  ])('retires only unavailable Google tokens beyond their documented lifetime: %j', async ({ providerStatus, old, retired }) => {
    const session = await registerAndAuthorize('google-retired@example.com')
    let unavailable = false
    app = googleApp({
      getSubscriptionPurchase: async () => {
        if (unavailable) throw new BillingFailure(providerStatus === 410 ? 'IAP_INVALID_TRANSACTION' : 'IAP_NOT_CONFIGURED', 'Provider rejected token', { providerStatus })
        return googlePlayPurchase(session.user.id)
      },
      acknowledgeSubscription: async () => undefined,
    })
    expect((await googleIngest(session.accessToken)).status).toBe(200)
    if (old) await prisma.googlePlaySubscriptionPurchase.updateMany({ data: { expiresAt: new Date(Date.now() - 61 * 24 * 60 * 60 * 1000) } })
    unavailable = true
    const result = await googleIngest(session.accessToken)
    expect(result.status).toBe(retired ? 200 : providerStatus === 410 ? 400 : 503)
    expect((await prisma.googlePlaySubscriptionPurchase.findFirstOrThrow()).state).toBe(retired ? 'expired' : 'active')
    expect((await prisma.subscriptionEntitlement.findFirstOrThrow()).state).toBe(retired ? 'expired' : 'active')
  })

  test('keeps a Google Play purchase bound to its first owner after store account evidence disappears', async () => {
    const owner = await registerAndAuthorize('google-linked-owner@example.com')
    const other = await registerAndAuthorize('google-linked-other@example.com')
    const purchase = googlePlayPurchase(owner.user.id)
    app = googleApp({
      getSubscriptionPurchase: async () => purchase,
      acknowledgeSubscription: async () => undefined,
    })
    expect((await googleIngest(owner.accessToken)).status).toBe(200)
    purchase.externalAccountIdentifiers = undefined
    const rejected = await googleIngest(other.accessToken)
    expect(rejected.status).toBe(403)
    expect((await rejected.json()).error.code).toBe('IAP_OWNERSHIP_MISMATCH')
    expect((await prisma.googlePlaySubscriptionPurchase.findFirstOrThrow()).userId).toBe(owner.user.id)
    expect(await prisma.subscriptionEntitlement.findUnique({ where: { userId: other.user.id } })).toBeNull()
  })

  test('does not grant or acknowledge pending Google Play purchases', async () => {
    const session = await registerAndAuthorize('google-pending@example.com')
    const purchase = googlePlayPurchase(session.user.id)
    purchase.subscriptionState = 'SUBSCRIPTION_STATE_PENDING'
    purchase.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_PENDING'
    purchase.latestOrderId = null
    purchase.lineItems![0]!.expiryTime = null
    let acknowledgeCalls = 0
    app = googleApp({
      getSubscriptionPurchase: async () => purchase,
      acknowledgeSubscription: async () => { acknowledgeCalls += 1 },
    })
    const response = await googleIngest(session.accessToken)
    expect(response.status).toBe(200)
    expect((await response.json()).subscription).toMatchObject({ isActive: false, state: 'pending' })
    expect(acknowledgeCalls).toBe(0)
    expect((await prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { userId: session.user.id } })).state).toBe('pending')
  })

  test.each([
    { initialPurchase: false, newerProvider: 'google', retainApple: false },
    { initialPurchase: true, newerProvider: 'google', retainApple: false },
    { initialPurchase: false, newerProvider: 'apple', retainApple: false },
    { initialPurchase: true, newerProvider: 'apple', retainApple: false },
    { initialPurchase: true, newerProvider: 'google', retainApple: true },
  ])('discards an obsolete Google response after a newer commit: %j', async ({ initialPurchase, newerProvider, retainApple }) => {
    const session = await registerAndAuthorize('google-obsolete@example.com')
    let acknowledgementCalls = 0
    const active = googlePlayPurchase(session.user.id)
    active.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_PENDING'
    if (retainApple) active.lineItems![0]!.expiryTime = new Date(Date.now() + 86_400_000).toISOString()
    const expired: GooglePlaySubscriptionPurchase = {
      ...active, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
      lineItems: active.lineItems!.map((item) => ({ ...item, expiryTime: new Date(Date.now() - 1_000).toISOString() })),
    }
    const entered = deferred()
    const release = deferred()
    let delay = false
    let observed = expired
    app = googleApp({
      getSubscriptionPurchase: async () => {
        const response = observed
        if (delay) {
          delay = false
          entered.resolve()
          await release.promise
        }
        return response
      },
      acknowledgeSubscription: async () => { acknowledgementCalls += 1 },
    })
    if (retainApple) {
      verifier.setTransaction('retained-apple', activeTransaction(session.user.id))
      expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'retained-apple' })).status).toBe(200)
    }
    if (initialPurchase) expect((await googleIngest(session.accessToken)).status).toBe(200)
    observed = active
    delay = true
    const obsolete = googleIngest(session.accessToken)
    await entered.promise
    try {
      if (newerProvider === 'google') {
        observed = expired
        expect((await googleIngest(session.accessToken)).status).toBe(200)
      } else {
        verifier.setTransaction('newer-apple', activeTransaction(session.user.id))
        expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'newer-apple' })).status).toBe(200)
      }
    } finally {
      release.resolve()
    }
    const response = await obsolete
    expect(acknowledgementCalls).toBe(0)
    const expected = newerProvider === 'google' && !retainApple
      ? { state: 'expired', platform: 'android', isActive: false }
      : { state: 'active', platform: 'ios', isActive: true }
    if (!initialPurchase && newerProvider === 'apple') {
      // Do not let native finish a first purchase whose token was not persisted.
      expect(response.status).toBe(503)
      expect((await response.json()).error.code).toBe('IAP_NOT_CONFIGURED')
    } else {
      expect(response.status).toBe(200)
      expect((await response.json()).subscription).toMatchObject(expected)
    }
    expect(await prisma.subscriptionEntitlement.findFirstOrThrow()).toMatchObject({ state: expected.state, platform: expected.platform })
    const storedPurchase = await prisma.googlePlaySubscriptionPurchase.findFirst()
    if (initialPurchase || newerProvider === 'google') {
      expect(storedPurchase).toMatchObject({ state: 'expired', expiresAt: new Date(expired.lineItems![0]!.expiryTime!) })
    } else {
      expect(storedPurchase).toBeNull()
    }

    // A later verification starts with the current revision and can grant access.
    observed = active
    const fresh = await googleIngest(session.accessToken)
    expect(fresh.status).toBe(200)
    expect((await fresh.json()).subscription).toMatchObject({ state: 'active', platform: retainApple ? 'ios' : 'android', isActive: true })
    expect(await prisma.googlePlaySubscriptionPurchase.findFirstOrThrow()).toMatchObject({ state: 'active' })
  })

  test('does not let an expired Google Play purchase replace a fresher Apple entitlement', async () => {
    const session = await registerAndAuthorize('google-stale@example.com')
    verifier.setTransaction('signed-current-apple', activeTransaction(session.user.id))
    expect((await postJson('/api/iap/app-store/transactions', session.accessToken, { signedTransactionInfo: 'signed-current-apple' })).status).toBe(200)
    const purchase = googlePlayPurchase(session.user.id)
    purchase.subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED'
    purchase.lineItems![0]!.expiryTime = '2026-06-01T00:00:00.000Z'
    app = googleApp({ getSubscriptionPurchase: async () => purchase, acknowledgeSubscription: async () => undefined })
    const response = await googleIngest(session.accessToken)
    expect(response.status).toBe(200)
    expect((await response.json()).subscription).toMatchObject({ isActive: true, platform: 'ios', transactionId: 'transaction-active' })
    expect((await prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { userId: session.user.id } })).platform).toBe('ios')
    expect((await prisma.googlePlaySubscriptionPurchase.findFirstOrThrow()).state).toBe('expired')
  })

  function googleApp(googlePlayIapVerifier: GooglePlaySubscriptionVerifier, overrides: Partial<AppEnv> = {}) {
    return createApp({
      env: { ...env, GOOGLE_PLAY_PRODUCT_IDS: ['premium'], GOOGLE_PLAY_BASE_PLAN_IDS: ['monthly'], ...overrides },
      prisma, appStoreIapVerifier: verifier, googlePlayIapVerifier,
    })
  }

  function googleIngest(accessToken: string) {
    return postJson('/api/iap/google-play/transactions', accessToken, {
      productId: 'premium', basePlanId: 'monthly', purchaseToken: 'purchase-token',
    })
  }

  function webhook(signedPayload: string) {
    return app.request('/api/webhooks/app-store', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signedPayload }),
    })
  }

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
    this.notifications.set(signedPayload, { signedDate: Date.now(), ...payload })
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

  async getSubscriptionStatuses(request: { transactionId: string }) {
    return this.statuses.get(request.transactionId) ?? []
  }
}

function activeTransaction(appAccountToken: string): JWSTransactionDecodedPayload {
  return {
    signedDate: Date.now(),
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
    signedDate: Date.now(),
    autoRenewProductId: 'premium_monthly',
    autoRenewStatus: 1,
    environment: Environment.SANDBOX,
    originalTransactionId: 'original-active',
    productId: 'premium_monthly',
    renewalDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
  }
}

function googlePlayBillingService(
  db: DbClient,
  purchase: GooglePlaySubscriptionPurchase,
) {
  return new BillingService(createBillingDependencies({
    appStoreVerifier: new FakeAppStoreVerifier(),
    db,
    env: {
      ...envForGooglePlay,
    },
    googlePlayVerifier: {
      acknowledgeSubscription: async () => undefined,
      getSubscriptionPurchase: async () => purchase,
    },
  }))
}

const envForGooglePlay = loadEnv({
  DATABASE_URL: databaseUrl,
  ACCESS_TOKEN_TTL_SECONDS: '60',
  CORS_ORIGINS: 'http://localhost:5173',
  GOOGLE_PLAY_BASE_PLAN_IDS: 'monthly',
  GOOGLE_PLAY_PRODUCT_IDS: 'premium',
  JWT_SECRET: '12345678901234567890123456789012',
})

function googlePlayPurchase(
  accountId: string,
  profileId = accountId,
): GooglePlaySubscriptionPurchase {
  return {
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    externalAccountIdentifiers: {
      obfuscatedExternalAccountId: accountId,
      obfuscatedExternalProfileId: profileId,
    },
    latestOrderId: 'GPA.1234-5678-9012-34567',
    lineItems: [{
      autoRenewingPlan: { autoRenewEnabled: true },
      expiryTime: '2099-07-01T00:00:00.000Z',
      offerDetails: { basePlanId: 'monthly' },
      productId: 'premium',
    }],
    startTime: '2026-07-17T00:00:00.000Z',
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    testPurchase: {},
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
