import type { Prisma } from '../../../generated/prisma/client'
import {
  effectiveSubscriptionState,
  selectSubscriptionSource,
  type SubscriptionSource,
} from '../domain/subscription'

/** The caller holds the user's entitlement lock for the entire transaction. */
export async function refreshSubscriptionEntitlement(
  db: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const [current, apple, google] = await Promise.all([
    db.subscriptionEntitlement.findUnique({ where: { userId } }),
    db.appStoreTransaction.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        transactionId: true,
        originalTransactionId: true,
        productId: true,
        state: true,
        expiresAt: true,
        purchaseDate: true,
        revokedAt: true,
        willAutoRenew: true,
        environment: true,
        webOrderLineItemId: true,
        stateSignedAt: true,
        updatedAt: true,
      },
    }),
    db.googlePlaySubscriptionPurchase.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        supersededById: true,
        productId: true,
        latestOrderId: true,
        state: true,
        expiresAt: true,
        willAutoRenew: true,
        environment: true,
        updatedAt: true,
      },
    }),
  ])
  const sources: SubscriptionSource[] = [
    ...apple.map((purchase) => ({
      ...purchase,
      platform: 'ios' as const,
      googlePlayPurchaseId: null,
      appStoreSignedAt: purchase.stateSignedAt,
    })),
    ...google
      .filter((purchase) => !purchase.supersededById)
      .map((purchase) => ({
        ...purchase,
        platform: 'android' as const,
        googlePlayPurchaseId: purchase.id,
        originalTransactionId: null,
        transactionId: purchase.latestOrderId,
        purchaseDate: null,
        revokedAt: null,
        webOrderLineItemId: null,
        appStoreSignedAt: null,
      })),
  ]
  const selected = selectSubscriptionSource(sources, current, now)
  if (!selected) return current

  const data = {
    platform: selected.platform,
    googlePlayPurchaseId: selected.googlePlayPurchaseId ?? null,
    state: effectiveSubscriptionState(selected, now),
    productId: selected.productId,
    originalTransactionId: selected.originalTransactionId,
    transactionId: selected.transactionId,
    webOrderLineItemId: selected.webOrderLineItemId,
    expiresAt: selected.expiresAt,
    willAutoRenew: selected.willAutoRenew,
    environment: selected.environment,
    appStoreSignedAt: selected.appStoreSignedAt ?? null,
  }
  const unchanged = current && Object.entries(data).every(([key, value]) => {
    const previous = current[key as keyof typeof data]
    return value instanceof Date && previous instanceof Date
      ? value.getTime() === previous.getTime()
      : value === previous
  })
  if (unchanged) return current
  return db.subscriptionEntitlement.upsert({
    where: { userId },
    create: { userId, entitlementKey: 'premium', ...data },
    update: { ...data, revision: { increment: 1 } },
  })
}
