// @parked-test
//
// This suite needs the billing tables, which are commented out in prisma/schema/billing.prisma.
// It still typechecks, so it cannot rot while parked, but the marker above keeps both test runners
// from executing it until the tables come back. Delete that line together with the schema
// comments; docs/IAP.md lists what to restore.
import { createHash, randomUUID } from 'node:crypto'

import { Environment, OfferType, Status, Type, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { beforeEach, afterAll, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import type { BillingDbClient } from './infrastructure/prisma-billing-types'
import { loadEnv } from '../../env'
import { BillingService } from './application/billing-service'
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
/**
 * While billing is parked, `createApp` neither accepts the verifier options nor takes a client
 * typed through the stand-ins, so this suite cannot call it directly. Keeping the suite compiling
 * is the point - switched-off code must not rot. Delete this helper and call `createApp` directly
 * when turning subscriptions on (docs/IAP.md).
 */
function createBillingTestApp(options: Record<string, unknown>) {
  return createApp(options as unknown as Parameters<typeof createApp>[0])
}

const skippedDatabaseUrl = 'postgresql://skip:skip@localhost:5432/skip'
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('iap API integration', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl ?? skippedDatabaseUrl,
    ACCESS_TOKEN_TTL_SECONDS: '60',
    APPLE_IAP_PRODUCT_IDS: 'premium_monthly,premium_yearly',
    CORS_ORIGINS: 'http://localhost:5173',
    JWT_SECRET: '12345678901234567890123456789012',
  })
  // The tables are commented out, so the generated client has no billing delegates; this suite
  // only runs once they are uncommented (see docs/IAP.md) and is excluded from the runner.
  const prisma = createPrisma(databaseUrl ?? skippedDatabaseUrl) as unknown as BillingDbClient
  let verifier = new FakeAppStoreVerifier()
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    verifier = new FakeAppStoreVerifier()
    app = createBillingTestApp({ env, prisma, appStoreIapVerifier: verifier })
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
    app = createBillingTestApp({
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

  test('serializes tokenless offer-code ownership after concurrent stale reads', async () => {
    const firstUser = await registerAndAuthorize('offer-race-first@example.com')
    const secondUser = await registerAndAuthorize('offer-race-second@example.com')
    const originalTransactionId = 'original-offer-race'
    const transactionId = 'transaction-offer-race'
    const purchaseDate = Date.now()
    const transaction = {
      ...activeTransaction(firstUser.user.id),
      appAccountToken: undefined,
      expiresDate: purchaseDate + 30 * 24 * 60 * 60 * 1000,
      offerIdentifier: 'WINBACK2026',
      offerType: OfferType.OFFER_CODE,
      originalTransactionId,
      purchaseDate,
      transactionId,
      webOrderLineItemId: 'web-order-offer-race',
    }
    verifier.setTransaction('signed-offer-race-first', transaction)
    verifier.setTransaction('signed-offer-race-second', transaction)

    await prisma.subscriptionEntitlement.create({
      data: {
        userId: secondUser.user.id,
        entitlementKey: 'premium',
        platform: 'ios',
        state: 'active',
        productId: 'premium_yearly',
        originalTransactionId: 'original-offer-race-fresher',
        transactionId: 'transaction-offer-race-fresher',
        expiresAt: new Date(purchaseDate + 365 * 24 * 60 * 60 * 1000),
        willAutoRenew: true,
        environment: 'sandbox',
      },
    })

    const firstOwnershipRead = deferred()
    const secondOwnershipRead = deferred()
    const releaseFirstRead = deferred()
    const releaseSecondRead = deferred()
    let ownershipReadCount = 0
    type FindEntitlementArgs = Parameters<typeof prisma.subscriptionEntitlement.findUnique>[0]
    const gatedDb = {
      appStoreTransaction: {
        findMany: (args: Parameters<typeof prisma.appStoreTransaction.findMany>[0]) =>
          prisma.appStoreTransaction.findMany(args),
      },
      subscriptionEntitlement: {
        findUnique: async (args: FindEntitlementArgs) => {
          const result = await prisma.subscriptionEntitlement.findUnique(args)
          if (args.where.originalTransactionId !== originalTransactionId) return result

          ownershipReadCount += 1
          if (ownershipReadCount === 1) {
            firstOwnershipRead.resolve()
            await releaseFirstRead.promise
          } else if (ownershipReadCount === 2) {
            secondOwnershipRead.resolve()
            await releaseSecondRead.promise
          }
          return result
        },
      },
      $transaction: (
        callback: Parameters<BillingDbClient['$transaction']>[0],
        options?: Parameters<BillingDbClient['$transaction']>[1],
      ) => prisma.$transaction(callback, options),
    } as unknown as BillingDbClient
    const billing = new BillingService(createBillingDependencies({
      appStoreVerifier: verifier,
      db: gatedDb,
      env,
      googlePlayVerifier: {
        acknowledgeSubscription: async () => {
          throw new Error('unexpected Google Play acknowledgement')
        },
        getSubscriptionPurchase: async () => {
          throw new Error('unexpected Google Play verification')
        },
      } satisfies GooglePlaySubscriptionVerifier,
    }))
    const firstToken = await billing.createOfferCodeRedemption(firstUser.user.id)
    const secondToken = await billing.createOfferCodeRedemption(secondUser.user.id)

    const firstClaim = billing.ingestAppStore({
      userId: firstUser.user.id,
      signedTransactionInfo: 'signed-offer-race-first',
      offerCodeRedemptionToken: firstToken,
    })
    await firstOwnershipRead.promise
    const secondClaim = billing.ingestAppStore({
      userId: secondUser.user.id,
      signedTransactionInfo: 'signed-offer-race-second',
      offerCodeRedemptionToken: secondToken,
    }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    )
    await secondOwnershipRead.promise

    releaseFirstRead.resolve()
    await expect(firstClaim).resolves.toMatchObject({ transactionId })
    releaseSecondRead.resolve()
    const secondOutcome = await secondClaim

    expect(secondOutcome).toMatchObject({
      status: 'rejected',
      reason: { code: 'IAP_OWNERSHIP_MISMATCH' },
    })
    const storedTransaction = await prisma.appStoreTransaction.findUniqueOrThrow({
      where: { transactionId },
    })
    const storedEntitlement = await prisma.subscriptionEntitlement.findUniqueOrThrow({
      where: { originalTransactionId },
    })
    expect(storedTransaction.userId).toBe(firstUser.user.id)
    expect(storedEntitlement.userId).toBe(firstUser.user.id)
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

  test('serializes concurrent first ownership claims for one Google Play purchase token', async () => {
    const firstUser = await registerAndAuthorize('google-race-first@example.com')
    const secondUser = await registerAndAuthorize('google-race-second@example.com')
    const firstOwnershipRead = deferred()
    const secondOwnershipRead = deferred()
    const releaseOwnershipReads = deferred()
    let ownershipReadCount = 0
    const gateOwnershipRead = async <T>(read: Promise<T>) => {
      const result = await read
      ownershipReadCount += 1
      if (ownershipReadCount === 1) firstOwnershipRead.resolve()
      if (ownershipReadCount === 2) secondOwnershipRead.resolve()
      await releaseOwnershipReads.promise
      return result
    }
    const gatedDb = {
      googlePlaySubscriptionPurchase: {
        findFirst: (args: Parameters<typeof prisma.googlePlaySubscriptionPurchase.findFirst>[0]) =>
          gateOwnershipRead(prisma.googlePlaySubscriptionPurchase.findFirst(args)),
        findMany: (args: Parameters<typeof prisma.googlePlaySubscriptionPurchase.findMany>[0]) =>
          gateOwnershipRead(prisma.googlePlaySubscriptionPurchase.findMany(args)),
      },
      $transaction: (
        callback: Parameters<BillingDbClient['$transaction']>[0],
        options?: Parameters<BillingDbClient['$transaction']>[1],
      ) => prisma.$transaction(callback, options),
    } as unknown as BillingDbClient
    const purchaseToken = 'google-concurrent-owner-token'
    const firstClaim = googlePlayBillingService(
      gatedDb,
      googlePlayPurchase(firstUser.user.id),
    ).ingestGooglePlay({
      basePlanId: 'monthly',
      productId: 'premium',
      purchaseToken,
      userId: firstUser.user.id,
    }).then(
      (value) => ({ status: 'fulfilled' as const, userId: firstUser.user.id, value }),
      (reason: unknown) => ({ status: 'rejected' as const, userId: firstUser.user.id, reason }),
    )
    const secondClaim = googlePlayBillingService(
      gatedDb,
      googlePlayPurchase(secondUser.user.id),
    ).ingestGooglePlay({
      basePlanId: 'monthly',
      productId: 'premium',
      purchaseToken,
      userId: secondUser.user.id,
    }).then(
      (value) => ({ status: 'fulfilled' as const, userId: secondUser.user.id, value }),
      (reason: unknown) => ({ status: 'rejected' as const, userId: secondUser.user.id, reason }),
    )

    await firstOwnershipRead.promise
    await secondOwnershipRead.promise
    releaseOwnershipReads.resolve()
    const outcomes = await Promise.all([firstClaim, secondClaim])
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: { code: 'IAP_OWNERSHIP_MISMATCH' } })
    expect(await prisma.subscriptionEntitlement.findMany({
      select: { userId: true },
    })).toEqual([{ userId: fulfilled[0]!.userId }])
    expect(await prisma.googlePlaySubscriptionPurchase.findUniqueOrThrow({
      where: { purchaseTokenHash: sha256(purchaseToken) },
      select: { userId: true },
    })).toEqual({ userId: fulfilled[0]!.userId })
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

  test('rotates stale non-terminal Google Play purchases after every reconcile attempt', async () => {
    const users = await Promise.all([
      registerAndAuthorize('google-due-active@example.com'),
      registerAndAuthorize('google-due-grace@example.com'),
      registerAndAuthorize('google-terminal@example.com'),
      registerAndAuthorize('google-fresh@example.com'),
    ])
    const records = [
      {
        userId: users[0].user.id,
        purchaseToken: 'active-token',
        reconcileAttemptedAt: new Date('2026-07-17T09:30:00.000Z'),
        state: 'active' as const,
        updatedAt: new Date('2026-07-17T09:30:00.000Z'),
      },
      {
        userId: users[1].user.id,
        purchaseToken: 'grace-token',
        reconcileAttemptedAt: new Date('2026-07-17T09:00:00.000Z'),
        state: 'billing_grace_period' as const,
        updatedAt: new Date('2026-07-17T09:00:00.000Z'),
      },
      {
        userId: users[2].user.id,
        purchaseToken: 'expired-token',
        reconcileAttemptedAt: new Date('2026-07-17T08:00:00.000Z'),
        state: 'expired' as const,
        updatedAt: new Date('2026-07-17T08:00:00.000Z'),
      },
      {
        userId: users[3].user.id,
        purchaseToken: 'fresh-token',
        reconcileAttemptedAt: new Date('2026-07-17T09:59:00.000Z'),
        state: 'active' as const,
        updatedAt: new Date('2026-07-17T09:59:00.000Z'),
      },
    ]

    for (const record of records) {
      await prisma.googlePlaySubscriptionPurchase.create({
        data: {
          ...record,
          basePlanId: 'monthly',
          productId: 'premium',
          purchaseTokenHash: sha256(record.purchaseToken),
        },
      })
    }

    const repository = createBillingDependencies({
      appStoreVerifier: verifier,
      db: prisma,
      env,
      googlePlayVerifier: {
        acknowledgeSubscription: async () => undefined,
        getSubscriptionPurchase: async () => {
          throw new Error('scheduled selection must not call Google Play')
        },
      },
    }).repository

    const due = await repository.findGooglePlayPurchasesDue({
      before: new Date('2026-07-17T09:45:00.000Z'),
      limit: 1,
    })
    const backlog = await repository.observeGooglePlayReconcileBacklog({
      before: new Date('2026-07-17T09:45:00.000Z'),
    })

    expect(due.map((purchase) => purchase.purchaseToken)).toEqual(['grace-token'])
    expect(backlog).toEqual({
      dueCount: 2,
      oldestDueAt: new Date('2026-07-17T09:00:00.000Z'),
    })

    await expect(repository.claimGooglePlayReconcileAttempt({
      attemptedAt: new Date('2026-07-17T10:00:00.000Z'),
      before: new Date('2026-07-17T09:45:00.000Z'),
      purchaseId: due[0]!.id,
    })).resolves.toBe(true)
    const nextDue = await repository.findGooglePlayPurchasesDue({
      before: new Date('2026-07-17T09:45:00.000Z'),
      limit: 1,
    })
    const nextBacklog = await repository.observeGooglePlayReconcileBacklog({
      before: new Date('2026-07-17T09:45:00.000Z'),
    })

    expect(nextDue.map((purchase) => purchase.purchaseToken)).toEqual(['active-token'])
    expect(nextBacklog).toEqual({
      dueCount: 1,
      oldestDueAt: new Date('2026-07-17T09:30:00.000Z'),
    })

    const concurrentClaims = await Promise.all([
      repository.claimGooglePlayReconcileAttempt({
        attemptedAt: new Date('2026-07-17T10:00:01.000Z'),
        before: new Date('2026-07-17T09:45:00.000Z'),
        purchaseId: nextDue[0]!.id,
      }),
      repository.claimGooglePlayReconcileAttempt({
        attemptedAt: new Date('2026-07-17T10:00:02.000Z'),
        before: new Date('2026-07-17T09:45:00.000Z'),
        purchaseId: nextDue[0]!.id,
      }),
    ])
    expect(concurrentClaims.sort()).toEqual([false, true])
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

  test('returns retryable in-progress for a re-signed App Store UUID with a fresh lease', async () => {
    verifier.setNotification('signed-webhook-resigned-in-progress', {
      notificationUUID: 'notification-resigned-in-progress-1',
      notificationType: 'DID_RENEW',
      data: { environment: Environment.SANDBOX },
    })
    await prisma.appStoreWebhook.create({
      data: {
        claimToken: randomUUID(),
        claimedAt: new Date(),
        notificationUuid: 'notification-resigned-in-progress-1',
        signedPayloadHash: sha256('signed-webhook-resigned-original'),
      },
    })

    const response = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook-resigned-in-progress' }),
    })
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('IAP_WEBHOOK_IN_PROGRESS')
    expect(await prisma.appStoreWebhook.count()).toBe(1)
  })

  test('reclaims a stale App Store UUID lease through a re-signed payload', async () => {
    verifier.setNotification('signed-webhook-resigned-reclaim', {
      notificationUUID: 'notification-resigned-reclaim-1',
      notificationType: 'DID_RENEW',
      data: { environment: Environment.SANDBOX },
    })
    const existing = await prisma.appStoreWebhook.create({
      data: {
        claimToken: randomUUID(),
        claimedAt: new Date(Date.now() - 10 * 60 * 1000),
        notificationUuid: 'notification-resigned-reclaim-1',
        signedPayloadHash: sha256('signed-webhook-resigned-reclaim-original'),
      },
    })

    const response = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook-resigned-reclaim' }),
    })
    const stored = await prisma.appStoreWebhook.findUniqueOrThrow({
      where: { id: existing.id },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ duplicate: false })
    expect(stored.processedAt).not.toBeNull()
    expect(stored.claimToken).toBeNull()
    expect(await prisma.appStoreWebhook.count()).toBe(1)
  })

  test('deduplicates concurrent re-signed App Store deliveries by notification UUID', async () => {
    const session = await registerAndAuthorize('webhook-resigned-concurrent@example.com')
    verifier.setTransaction('signed-webhook-resigned-concurrent-active', {
      ...activeTransaction(session.user.id),
      transactionId: 'transaction-webhook-resigned-concurrent',
    })
    const notification = {
      notificationUUID: 'notification-resigned-concurrent-1',
      notificationType: 'DID_RENEW' as const,
      data: {
        environment: Environment.SANDBOX,
        signedTransactionInfo: 'signed-webhook-resigned-concurrent-active',
        status: Status.ACTIVE,
      },
    }
    verifier.setNotification('signed-webhook-resigned-concurrent-a', notification)
    verifier.setNotification('signed-webhook-resigned-concurrent-b', notification)

    const [first, second] = await Promise.all([
      app.request('/api/webhooks/app-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedPayload: 'signed-webhook-resigned-concurrent-a' }),
      }),
      app.request('/api/webhooks/app-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedPayload: 'signed-webhook-resigned-concurrent-b' }),
      }),
    ])
    const bodies = [await first.json(), await second.json()]

    expect([first.status, second.status]).toContain(200)
    expect([first.status, second.status].every((status) => status === 200 || status === 503)).toBe(true)
    expect(bodies.some((body) => body.duplicate === false)).toBe(true)
    expect(
      bodies.some(
        (body) => body.duplicate === true || body.error?.code === 'IAP_WEBHOOK_IN_PROGRESS',
      ),
    ).toBe(true)
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

  test('returns 503 without verification while an App Store webhook claim lease is fresh', async () => {
    await prisma.appStoreWebhook.create({
      data: {
        claimToken: randomUUID(),
        claimedAt: new Date(),
        signedPayloadHash: sha256('signed-webhook-in-progress'),
      },
    })

    const response = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook-in-progress' }),
    })
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('IAP_WEBHOOK_IN_PROGRESS')
    expect(verifier.notificationVerificationCount('signed-webhook-in-progress')).toBe(0)
  })

  test('reclaims a stale App Store webhook lease and fences the completed claim', async () => {
    const session = await registerAndAuthorize('webhook-reclaim@example.com')
    verifier.setTransaction('signed-webhook-reclaim-active', {
      ...activeTransaction(session.user.id),
      transactionId: 'transaction-webhook-reclaim',
    })
    verifier.setNotification('signed-webhook-reclaim', {
      notificationUUID: 'notification-reclaim-1',
      notificationType: 'DID_RENEW',
      data: {
        environment: Environment.SANDBOX,
        signedTransactionInfo: 'signed-webhook-reclaim-active',
        status: Status.ACTIVE,
      },
    })
    const webhook = await prisma.appStoreWebhook.create({
      data: {
        claimToken: randomUUID(),
        claimedAt: new Date(Date.now() - 10 * 60 * 1000),
        signedPayloadHash: sha256('signed-webhook-reclaim'),
      },
    })

    const response = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook-reclaim' }),
    })
    const stored = await prisma.appStoreWebhook.findUniqueOrThrow({ where: { id: webhook.id } })

    expect(response.status).toBe(200)
    expect(stored.processedAt).not.toBeNull()
    expect(stored.claimToken).toBeNull()
    expect(stored.claimedAt).toBeNull()
    expect(verifier.notificationVerificationCount('signed-webhook-reclaim')).toBe(1)
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

    expect([first.status, second.status]).toContain(200)
    expect([first.status, second.status].every((status) => status === 200 || status === 503)).toBe(true)
    expect(bodies.some((body) => body.duplicate === false)).toBe(true)
    expect(
      bodies.some(
        (body) => body.duplicate === true || body.error?.code === 'IAP_WEBHOOK_IN_PROGRESS',
      ),
    ).toBe(true)
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

function googlePlayBillingService(
  db: BillingDbClient,
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
  DATABASE_URL: databaseUrl ?? skippedDatabaseUrl,
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
