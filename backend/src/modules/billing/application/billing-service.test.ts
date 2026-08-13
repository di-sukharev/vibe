// @parked-test
//
// Subscriptions ship switched off: the tables are commented out in prisma/schema/billing.prisma,
// the routes are not mounted in src/app.ts, and this module is typed through hand-written
// stand-ins. Until docs/IAP.md is followed and billing is turned on, these suites assert a
// feature nobody runs, so they are parked rather than deleted - remove the marker above and they
// come back with the capability.

import { expect, mock, test } from 'bun:test'

import { BillingFailure } from '../domain/errors'
import { BillingService } from './billing-service'
import type { BillingServiceDependencies } from './ports'

test('reconciles a Google Play batch without letting one provider failure block the rest', async () => {
  const attemptedPurchaseIds: string[] = []
  const verifiedTokens: string[] = []
  const appliedTokens: string[] = []
  const service = new BillingService(
    googleBatchDependencies({
      applyGooglePlayPurchase: async ({ purchase }) => {
        appliedTokens.push(purchase.purchaseToken)
        return subscriptionSnapshot()
      },
      verifyPurchase: async (purchaseToken) => {
        verifiedTokens.push(purchaseToken)
        if (purchaseToken === 'broken-token') throw new Error('provider unavailable')
        return {}
      },
      claimGooglePlayReconcileAttempt: async ({ purchaseId }) => {
        attemptedPurchaseIds.push(purchaseId)
        return true
      },
    }),
  )

  await expect(
    service.reconcileGooglePlayBatch({
      before: new Date('2026-07-17T09:45:00.000Z'),
      deadline: new Date('2026-07-17T09:59:00.000Z'),
      limit: 100,
      now: () => new Date('2026-07-17T09:50:00.000Z'),
    }),
  ).resolves.toEqual({
    attempted: 3,
    backlogDue: 250,
    backlogOldestDueAt: new Date('2026-07-16T09:00:00.000Z'),
    deferred: 0,
    failed: 1,
    selected: 3,
    succeeded: 2,
  })
  expect(verifiedTokens).toEqual(['broken-token', 'active-token', 'grace-token'])
  expect(appliedTokens).toEqual(['active-token', 'grace-token'])
  expect(attemptedPurchaseIds).toEqual(['purchase-1', 'purchase-2', 'purchase-3'])
})

test('stops a Google Play batch before its deadline and reports deferred purchases', async () => {
  const verifiedTokens: string[] = []
  const clock = [
    new Date('2026-07-17T09:50:00.000Z'),
    new Date('2026-07-17T10:00:00.000Z'),
  ]
  const service = new BillingService(
    googleBatchDependencies({
      applyGooglePlayPurchase: async () => subscriptionSnapshot(),
      verifyPurchase: async (purchaseToken) => {
        verifiedTokens.push(purchaseToken)
        return {}
      },
    }),
  )

  const result = await service.reconcileGooglePlayBatch({
    before: new Date('2026-07-17T09:45:00.000Z'),
    deadline: new Date('2026-07-17T10:00:00.000Z'),
    limit: 100,
    now: () => clock.shift() ?? new Date('2026-07-17T10:00:00.000Z'),
  })

  expect(result).toEqual({
    attempted: 1,
    backlogDue: 250,
    backlogOldestDueAt: new Date('2026-07-16T09:00:00.000Z'),
    deferred: 2,
    failed: 0,
    selected: 3,
    succeeded: 1,
  })
  expect(verifiedTokens).toEqual(['broken-token'])
})

test('does not admit a Google Play attempt without enough deadline budget', async () => {
  const verifiedTokens: string[] = []
  const service = new BillingService(
    googleBatchDependencies({
      applyGooglePlayPurchase: async () => subscriptionSnapshot(),
      verifyPurchase: async (purchaseToken) => {
        verifiedTokens.push(purchaseToken)
        return {}
      },
    }),
  )

  await expect(
    service.reconcileGooglePlayBatch({
      before: new Date('2026-07-17T09:45:00.000Z'),
      deadline: new Date('2026-07-17T10:00:00.000Z'),
      limit: 100,
      now: () => new Date('2026-07-17T09:59:30.000Z'),
    }),
  ).resolves.toEqual({
    attempted: 0,
    backlogDue: 250,
    backlogOldestDueAt: new Date('2026-07-16T09:00:00.000Z'),
    deferred: 3,
    failed: 0,
    selected: 3,
    succeeded: 0,
  })
  expect(verifiedTokens).toEqual([])
})

test('skips a Google Play purchase already claimed by another reconciler', async () => {
  const verifiedTokens: string[] = []
  const service = new BillingService(
    googleBatchDependencies({
      applyGooglePlayPurchase: async () => subscriptionSnapshot(),
      claimGooglePlayReconcileAttempt: async ({ purchaseId }) => purchaseId !== 'purchase-1',
      verifyPurchase: async (purchaseToken) => {
        verifiedTokens.push(purchaseToken)
        return {}
      },
    }),
  )

  await expect(service.reconcileGooglePlayBatch({
    before: new Date('2026-07-17T09:45:00.000Z'),
    deadline: new Date('2026-07-17T10:00:00.000Z'),
    limit: 100,
    now: () => new Date('2026-07-17T09:50:00.000Z'),
  })).resolves.toEqual({
    attempted: 2,
    backlogDue: 250,
    backlogOldestDueAt: new Date('2026-07-16T09:00:00.000Z'),
    deferred: 1,
    failed: 0,
    selected: 3,
    succeeded: 2,
  })
  expect(verifiedTokens).toEqual(['active-token', 'grace-token'])
})

test('returns duplicate only for an already processed App Store webhook', async () => {
  const verifyNotification = mock(async () => {
    throw new Error('unexpected notification verification')
  })
  const service = new BillingService(
    dependencies({
      claimAppStoreWebhook: mock(async () => ({ status: 'processed' })),
      verifyNotification,
    }),
  )

  await expect(service.processAppStoreWebhook('signed-webhook')).resolves.toEqual({
    duplicate: true,
    subscription: null,
  })
  expect(verifyNotification).not.toHaveBeenCalled()
})

test('rejects a concurrently processed App Store webhook so Apple retries it', async () => {
  const verifyNotification = mock(async () => {
    throw new Error('unexpected notification verification')
  })
  const service = new BillingService(
    dependencies({
      claimAppStoreWebhook: mock(async () => ({ status: 'in_progress' })),
      verifyNotification,
    }),
  )

  await expect(service.processAppStoreWebhook('signed-webhook')).rejects.toMatchObject({
    code: 'IAP_WEBHOOK_IN_PROGRESS',
  })
  expect(verifyNotification).not.toHaveBeenCalled()
})

function dependencies(input: {
  claimAppStoreWebhook: ReturnType<typeof mock>
  verifyNotification: ReturnType<typeof mock>
}) {
  return {
    appStore: {
      describeNotification: () => {
        throw new Error('unexpected notification description')
      },
      getSubscriptionStatuses: async () => [],
      verifyNotification: input.verifyNotification,
      verifyRenewalInfo: async () => {
        throw new Error('unexpected renewal verification')
      },
      verifyTransaction: async () => {
        throw new Error('unexpected transaction verification')
      },
    },
    googlePlay: {
      verifyPurchase: async () => {
        throw new Error('unexpected Google Play verification')
      },
    },
    offerCodeTokens: {
      create: async () => '',
      verify: async () => {
        throw new BillingFailure('IAP_INVALID_TRANSACTION', 'unexpected offer token')
      },
    },
    repository: {
      applyAppStoreTransaction: async () => {
        throw new Error('unexpected transaction apply')
      },
      applyGooglePlayPurchase: async () => {
        throw new Error('unexpected Google Play apply')
      },
      claimAppStoreWebhook: input.claimAppStoreWebhook,
      claimVerifiedAppStoreWebhook: async () => {
        throw new Error('unexpected verified webhook claim')
      },
      findGooglePlayPurchases: async () => [],
      getAppStoreEnvironment: async () => 'Sandbox',
      getSubscription: async () => {
        throw new Error('unexpected subscription read')
      },
      markAppStoreWebhookProcessed: async () => {
        throw new Error('unexpected processed marker')
      },
      releaseAppStoreWebhookClaim: async () => {
        throw new Error('unexpected webhook release')
      },
      resolveAppStoreWebhookUserId: async () => null,
    },
  } as unknown as BillingServiceDependencies
}

function googleBatchDependencies(input: {
  applyGooglePlayPurchase: BillingServiceDependencies['repository']['applyGooglePlayPurchase']
  claimGooglePlayReconcileAttempt?: BillingServiceDependencies['repository']['claimGooglePlayReconcileAttempt']
  verifyPurchase: BillingServiceDependencies['googlePlay']['verifyPurchase']
}) {
  const purchases = [
    { id: 'purchase-1', userId: 'user-1', productId: 'premium', basePlanId: 'monthly', purchaseToken: 'broken-token' },
    { id: 'purchase-2', userId: 'user-2', productId: 'premium', basePlanId: 'yearly', purchaseToken: 'active-token' },
    { id: 'purchase-3', userId: 'user-3', productId: 'premium', basePlanId: 'monthly', purchaseToken: 'grace-token' },
  ]

  return {
    appStore: {},
    googlePlay: { verifyPurchase: input.verifyPurchase },
    offerCodeTokens: {},
    repository: {
      applyGooglePlayPurchase: input.applyGooglePlayPurchase,
      observeGooglePlayReconcileBacklog: async () => ({
        dueCount: 250,
        oldestDueAt: new Date('2026-07-16T09:00:00.000Z'),
      }),
      findGooglePlayPurchasesDue: async () => purchases,
      claimGooglePlayReconcileAttempt:
        input.claimGooglePlayReconcileAttempt ?? (async () => true),
    },
  } as unknown as BillingServiceDependencies
}

function subscriptionSnapshot() {
  return {
    entitlement: 'premium' as const,
    expiresAt: '2099-01-01T00:00:00.000Z',
    isActive: true,
    originalTransactionId: null,
    platform: 'android' as const,
    productId: 'premium',
    state: 'active' as const,
    transactionId: 'transaction-1',
    updatedAt: '2026-07-17T09:50:00.000Z',
    willAutoRenew: true,
  }
}
