import {
  assertAppStoreOwnership,
  assertGooglePlayOwnership,
  assertGooglePlayProductionPurchase,
} from '../domain/purchase-policy'
import {
  assertAppStoreProduct,
  assertGooglePlayExternalIdentityConsistent,
  isValidOfferCodeTokenlessFirstClaim,
  assertSubscriptionHasExpiration,
  assertGooglePlayProductConfigured,
  selectGooglePlayLineItem,
  assertGooglePlaySubscriptionHasExpiration,
  toDate,
  toDateFromIso,
  formatEnvironment,
  normalizeString,
  normalizeRequiredString,
} from '../domain/purchase-policy'
import { createHash, randomUUID } from 'node:crypto'

import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

import type { AppEnv } from '../../../env'
import { enqueueTask } from '../../../outbox'
import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import { BillingFailure } from '../domain/errors'
import { mergeAppStoreSnapshot } from '../domain/apple-snapshot'
import { refreshSubscriptionEntitlement } from './subscription-entitlement'
import type {
  BillingRepository,
  BillingRevision,
  GooglePlayVerificationRevision,
  GooglePlayPurchaseReference,
  OfferCodeRedemptionProof,
  AppStoreNotificationDetails,
  AppStoreWebhookClaim,
} from '../application/ports'
import type {
  AppStoreTransaction,
  VerifiedAppStoreTransaction,
} from '../domain/provider-values'
import type {
  GooglePlaySubscriptionPurchase,
} from './google-play-verifier'
import {
  googlePlayTokenRetentionAfterExpiryMs,
  inactiveSubscriptionSnapshot,
  resolveGooglePlaySubscriptionState,
  resolveGooglePlayWillAutoRenew,
  shouldAcknowledgeGooglePlayPurchase,
  toSubscriptionSnapshot,
} from '../domain/subscription'

type ApplyTransactionInput = Parameters<BillingRepository['applyAppStoreTransaction']>[0]

const APP_STORE_WEBHOOK_CLAIM_LEASE_MS = 5 * 60 * 1000

export async function getSubscriptionSnapshot(db: DbClient, userId: string): Promise<SubscriptionSnapshot> {
  const now = new Date()
  const entitlement = await db.$transaction(async (tx) => {
    await acquireEntitlementLock(tx, userId)
    return refreshSubscriptionEntitlement(tx, userId, now)
  })
  return entitlement ? toSubscriptionSnapshot(entitlement, now) : inactiveSubscriptionSnapshot()
}

export async function claimAppStoreWebhook(db: DbClient, signedPayload: string) {
  const signedPayloadHash = hashToken(signedPayload)
  const claimToken = randomUUID()
  const claimedAt = new Date()
  try {
    const webhook = await db.appStoreWebhook.create({
      data: { claimToken, claimedAt, signedPayloadHash },
    })
    return { status: 'claimed' as const, claimToken, id: webhook.id }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
  }

  const webhook = await db.appStoreWebhook.findUnique({
    where: { signedPayloadHash },
    select: { id: true, processedAt: true },
  })
  if (!webhook) {
    throw new BillingFailure(
      'IAP_WEBHOOK_IN_PROGRESS',
      'App Store webhook claim changed concurrently; retry later',
    )
  }
  if (webhook.processedAt) return { status: 'processed' as const }

  const reclaimed = await db.appStoreWebhook.updateMany({
    where: {
      signedPayloadHash,
      processedAt: null,
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: new Date(claimedAt.getTime() - APP_STORE_WEBHOOK_CLAIM_LEASE_MS) } },
      ],
    },
    data: { claimToken, claimedAt },
  })

  if (reclaimed.count === 0) return { status: 'in_progress' as const }
  return { status: 'claimed' as const, claimToken, id: webhook.id }
}

export async function claimVerifiedAppStoreWebhook(
  db: DbClient,
  input: {
    claimToken: string
    details: AppStoreNotificationDetails
    id: string
    verifiedTransaction?: VerifiedAppStoreTransaction | null
  },
): Promise<AppStoreWebhookClaim> {
  const claimedAt = new Date()
  const transaction = input.verifiedTransaction?.payload ?? null
  const verifiedData = {
    environment: input.details.environment,
    notificationType: input.details.notificationType,
    notificationUuid: input.details.notificationUuid,
    originalTransactionId: transaction?.originalTransactionId ?? null,
    subtype: input.details.subtype,
    transactionId: transaction?.transactionId ?? null,
  }

  try {
    const result = await db.appStoreWebhook.updateMany({
      where: {
        claimToken: input.claimToken,
        id: input.id,
        processedAt: null,
      },
      data: { ...verifiedData, claimedAt },
    })
    if (result.count === 0) throw webhookClaimLostError()
    return {
      status: 'claimed',
      claimToken: input.claimToken,
      id: input.id,
    }
  } catch (error) {
    if (!input.details.notificationUuid || !isUniqueConstraintError(error)) throw error
  }

  const existing = await db.appStoreWebhook.findUnique({
    where: { notificationUuid: input.details.notificationUuid },
    select: { id: true, processedAt: true },
  })
  if (!existing) {
    throw new BillingFailure(
      'IAP_WEBHOOK_IN_PROGRESS',
      'App Store webhook identity changed concurrently; retry later',
    )
  }

  const provisionalReleased = await db.appStoreWebhook.deleteMany({
    where: {
      claimToken: input.claimToken,
      id: input.id,
      notificationUuid: null,
      processedAt: null,
    },
  })
  if (provisionalReleased.count === 0) throw webhookClaimLostError()
  if (existing.processedAt) return { status: 'processed' }

  const reclaimed = await db.appStoreWebhook.updateMany({
    where: {
      id: existing.id,
      processedAt: null,
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: new Date(claimedAt.getTime() - APP_STORE_WEBHOOK_CLAIM_LEASE_MS) } },
      ],
    },
    data: {
      ...verifiedData,
      claimToken: input.claimToken,
      claimedAt,
    },
  })
  if (reclaimed.count === 1) {
    return {
      status: 'claimed',
      claimToken: input.claimToken,
      id: existing.id,
    }
  }

  const latest = await db.appStoreWebhook.findUnique({
    where: { id: existing.id },
    select: { processedAt: true },
  })
  return latest?.processedAt
    ? { status: 'processed' }
    : { status: 'in_progress' }
}

export async function markAppStoreWebhookProcessed(
  db: DbClient,
  claim: { claimToken: string; id: string },
) {
  const result = await db.appStoreWebhook.updateMany({
    where: { id: claim.id, claimToken: claim.claimToken, processedAt: null },
    data: { claimToken: null, claimedAt: null, processedAt: new Date() },
  })

  if (result.count === 0) throw webhookClaimLostError()
}

export async function releaseFailedAppStoreWebhookClaim(
  db: DbClient,
  claim: { claimToken: string; id: string },
) {
  await db.appStoreWebhook.deleteMany({
    where: {
      id: claim.id,
      claimToken: claim.claimToken,
      processedAt: null,
    },
  })
}

export function webhookClaimLostError() {
  return new BillingFailure(
    'IAP_WEBHOOK_IN_PROGRESS',
    'App Store webhook claim is no longer owned by this worker; retry later',
  )
}

export async function applyVerifiedGooglePlayPurchase({
  db,
  env,
  expectedRevision,
  input,
  userId,
  verifiedPurchase,
  refreshStoredPurchase,
}: {
  db: DbClient
  env: AppEnv
  expectedRevision: GooglePlayVerificationRevision
  input: GooglePlayPurchaseReference
  userId: string
  verifiedPurchase: GooglePlaySubscriptionPurchase
  refreshStoredPurchase?: boolean
}): Promise<{ subscription: SubscriptionSnapshot; acknowledgePurchaseId: string | null }> {
  const requestedProductId = normalizeRequiredString(input.productId)
  const now = new Date()
  const requestedBasePlanId = normalizeString(input.basePlanId)
  const purchaseToken = normalizeRequiredString(input.purchaseToken)
  const purchaseTokenHash = hashToken(purchaseToken)
  const linkedPurchaseToken = normalizeString(verifiedPurchase.linkedPurchaseToken)
  const linkedPurchaseTokenHash = linkedPurchaseToken ? hashToken(linkedPurchaseToken) : null
  const externalAccountId = normalizeString(verifiedPurchase.externalAccountIdentifiers?.obfuscatedExternalAccountId) ??
    normalizeString(verifiedPurchase.externalAccountIdentifiers?.externalAccountId)
  const externalProfileId = normalizeString(verifiedPurchase.externalAccountIdentifiers?.obfuscatedExternalProfileId)

  if (!refreshStoredPurchase) assertGooglePlayProductConfigured(env, requestedProductId)

  assertGooglePlayProductionPurchase(env, verifiedPurchase.testPurchase != null)

  const requestedLineItem = selectGooglePlayLineItem({
    env,
    productId: requestedProductId,
    basePlanId: requestedBasePlanId,
    purchase: verifiedPurchase,
    refreshStoredPurchase,
  })
  const lineItem = expectedRevision.purchase && !refreshStoredPurchase
    ? selectGooglePlayLineItem({
        env,
        productId: requestedProductId,
        basePlanId: requestedBasePlanId,
        purchase: verifiedPurchase,
        refreshStoredPurchase: true,
      })
    : requestedLineItem
  const productId = normalizeRequiredString(lineItem.productId)
  assertGooglePlayProductConfigured(env, productId)
  const basePlanId = normalizeString(lineItem.offerDetails?.basePlanId)

  assertGooglePlayExternalIdentityConsistent({ externalAccountId, externalProfileId })
  await assertGooglePlayPurchaseOwnership({
    db,
    externalAccountId,
    externalProfileId,
    linkedPurchaseTokenHash,
    purchaseTokenHash,
    userId,
  })

  const expiresAt = toDateFromIso(lineItem.expiryTime)
  const state = resolveGooglePlaySubscriptionState(
    verifiedPurchase.subscriptionState,
    expiresAt,
    now,
  )
  assertGooglePlaySubscriptionHasExpiration({
    expiresAt,
    state,
    subscriptionState: verifiedPurchase.subscriptionState,
  })

  const willAutoRenew = resolveGooglePlayWillAutoRenew(
    verifiedPurchase.subscriptionState,
    lineItem.autoRenewingPlan?.autoRenewEnabled,
  )
  const latestOrderId = normalizeString(lineItem.latestSuccessfulOrderId) ??
    normalizeString(verifiedPurchase.latestOrderId)
  const acknowledgementState = normalizeString(verifiedPurchase.acknowledgementState)
  const shouldAcknowledge = shouldAcknowledgeGooglePlayPurchase({
    state,
    subscriptionState: verifiedPurchase.subscriptionState,
    acknowledgementState,
  })
  const environment = verifiedPurchase.testPurchase != null ? 'sandbox' : 'production'

  let acknowledgePurchaseId: string | null = null
  const entitlement = await db.$transaction(async (tx) => {
    await acquireGooglePlayPurchaseLocks(tx, [purchaseTokenHash, linkedPurchaseTokenHash])
    await acquireEntitlementLock(tx, userId)
    await assertGooglePlayPurchaseOwnership({
      db: tx,
      externalAccountId,
      externalProfileId,
      linkedPurchaseTokenHash,
      purchaseTokenHash,
      userId,
    })

    const [storedPurchase, existingEntitlement] = await Promise.all([
      tx.googlePlaySubscriptionPurchase.findUnique({ where: { purchaseTokenHash } }),
      tx.subscriptionEntitlement.findUnique({ where: { userId } }),
    ])
    // Store responses can finish out of order. Check both records after ownership:
    // a purchase may change while a stronger entitlement stays on another provider.
    if (
      !sameRevision(expectedRevision.purchase, storedPurchase) ||
      !sameRevision(expectedRevision.entitlement, existingEntitlement)
    ) {
      if (!storedPurchase) {
        // Native must not finish a first purchase until its token is durable.
        throw new BillingFailure(
          'IAP_NOT_CONFIGURED',
          'Subscription changed during verification; retry the purchase',
        )
      }
      if (!storedPurchase.supersededById && shouldAcknowledgeGooglePlayPurchase({
        state: storedPurchase.state,
        acknowledgementState: storedPurchase.acknowledgementState,
        subscriptionState: null,
      })) {
        throw new BillingFailure(
          'IAP_NOT_CONFIGURED',
          'Subscription acknowledgement is pending; retry the purchase',
        )
      }
      return refreshSubscriptionEntitlement(tx, userId, now)
    }

    const successor = await tx.googlePlaySubscriptionPurchase.findFirst({
      where: { linkedPurchaseTokenHash: purchaseTokenHash, replacesLinkedPurchase: true },
      select: { id: true },
    })
    // A late intermediate token still connects its predecessor to the replacement
    // chain. Retain that evidence without granting access or acknowledging it again.
    const supersededById = storedPurchase?.supersededById ?? successor?.id ?? null
    const completesReplacement = Boolean(
      linkedPurchaseTokenHash &&
      state !== 'pending' &&
      verifiedPurchase.subscriptionState !== 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED',
    )

    const savedPurchase = await tx.googlePlaySubscriptionPurchase.upsert({
      where: { purchaseTokenHash },
      create: {
        userId,
        purchaseToken,
        purchaseTokenHash,
        linkedPurchaseToken,
        linkedPurchaseTokenHash,
        supersededById,
        replacesLinkedPurchase: completesReplacement,
        productId,
        basePlanId,
        latestOrderId,
        state,
        environment,
        acknowledgementState,
        externalAccountId,
        externalProfileId,
        expiresAt,
        willAutoRenew,
        reconcileAttemptedAt: now,
      },
      update: supersededById ? {
        revision: { increment: 1 },
        supersededById,
        ...(completesReplacement ? {
          linkedPurchaseToken,
          linkedPurchaseTokenHash,
          replacesLinkedPurchase: true,
        } : {}),
      } : {
        revision: { increment: 1 },
        purchaseToken,
        linkedPurchaseToken,
        linkedPurchaseTokenHash,
        supersededById,
        replacesLinkedPurchase: completesReplacement,
        productId,
        basePlanId,
        latestOrderId,
        state,
        environment,
        acknowledgementState,
        externalAccountId,
        externalProfileId,
        expiresAt,
        willAutoRenew,
        reconcileAttemptedAt: now,
      },
    })

    if (shouldAcknowledge && !supersededById) {
      await enqueueTask(tx, {
        type: 'billing:google-play:acknowledge',
        dedupeKey: savedPurchase.id,
        payload: { purchaseId: savedPurchase.id },
      })
      acknowledgePurchaseId = savedPurchase.id
    }

    const predecessor = completesReplacement && linkedPurchaseTokenHash
      ? await tx.googlePlaySubscriptionPurchase.findUnique({
          where: { purchaseTokenHash: linkedPurchaseTokenHash },
        })
      : null
    if (predecessor && predecessor.id !== savedPurchase.id) {
      await tx.googlePlaySubscriptionPurchase.update({
        where: { id: predecessor.id },
        data: { supersededById: savedPurchase.id, revision: { increment: 1 } },
      })
    }
    return refreshSubscriptionEntitlement(tx, userId, now)
  })

  return {
    acknowledgePurchaseId,
    subscription: entitlement ? toSubscriptionSnapshot(entitlement, now) : inactiveSubscriptionSnapshot(),
  }
}

export async function retireUnavailableGooglePlayPurchase(
  db: DbClient,
  input: {
    purchaseToken: string
    userId: string
    expectedRevision: GooglePlayVerificationRevision
    now: Date
  },
): Promise<SubscriptionSnapshot | null> {
  const purchaseTokenHash = hashToken(input.purchaseToken)
  return db.$transaction(async (tx) => {
    await acquireGooglePlayPurchaseLocks(tx, [purchaseTokenHash])
    await acquireEntitlementLock(tx, input.userId)
    const purchase = await tx.googlePlaySubscriptionPurchase.findUnique({
      where: { purchaseTokenHash },
    })
    if (
      !purchase ||
      purchase.userId !== input.userId ||
      !sameRevision(input.expectedRevision.purchase, purchase) ||
      !purchase.expiresAt ||
      purchase.expiresAt.getTime() > input.now.getTime() - googlePlayTokenRetentionAfterExpiryMs
    ) {
      return null
    }
    await tx.googlePlaySubscriptionPurchase.update({
      where: { id: purchase.id },
      data: { state: 'expired', revision: { increment: 1 } },
    })
    const entitlement = await refreshSubscriptionEntitlement(tx, input.userId, input.now)
    return entitlement ? toSubscriptionSnapshot(entitlement, input.now) : inactiveSubscriptionSnapshot()
  })
}

export async function getGooglePlayVerificationRevision(
  db: DbClient,
  input: { purchaseToken: string; userId: string },
): Promise<GooglePlayVerificationRevision> {
  const [purchase, entitlement] = await Promise.all([
    db.googlePlaySubscriptionPurchase.findUnique({
      where: { purchaseTokenHash: hashToken(normalizeRequiredString(input.purchaseToken)) },
      select: { id: true, revision: true },
    }),
    db.subscriptionEntitlement.findUnique({
      where: { userId: input.userId },
      select: { id: true, revision: true },
    }),
  ])
  return { purchase, entitlement }
}

function sameRevision(expected: BillingRevision, actual: BillingRevision) {
  return expected?.id === actual?.id && expected?.revision === actual?.revision
}

export async function applyVerifiedAppStoreTransaction({
  db,
  env,
  offerCodeRedemption,
  input,
}: {
  db: DbClient
  env: AppEnv
  offerCodeRedemption?: OfferCodeRedemptionProof | null
  input: ApplyTransactionInput
}): Promise<SubscriptionSnapshot> {
  const transaction = input.verifiedTransaction.payload
  const now = new Date()
  const renewal = input.verifiedRenewal?.payload ?? null
  const originalTransactionId = transaction.originalTransactionId ?? ''
  const transactionId = transaction.transactionId ?? ''
  const productId = transaction.productId ?? ''

  assertAppStoreProduct({
    env,
    originalTransactionId,
    transactionId,
    productId,
    transaction,
    renewal,
    verifiedEnvironment: input.verifiedTransaction.environment,
  })
  assertSubscriptionHasExpiration(transaction, renewal, toDate(transaction.expiresDate), input.status)
  const allowTokenlessFirstClaim =
    input.allowTokenlessFirstClaim ||
    isValidOfferCodeTokenlessFirstClaim({
      offerCodeRedemption,
      transaction,
      userId: input.userId,
    })
  await assertTransactionOwnership({
    db,
    userId: input.userId,
    originalTransactionId,
    transactionId,
    appAccountToken: transaction.appAccountToken,
    allowTokenlessFirstClaim,
  })

  const environment = formatEnvironment(
    transaction.environment ?? renewal?.environment ?? input.verifiedTransaction.environment,
  )
  const signedTransactionHash = hashToken(input.signedTransactionInfo)
  const signedRenewalHash = input.signedRenewalInfo ? hashToken(input.signedRenewalInfo) : null

  const entitlement = await db.$transaction(async (tx) => {
    await acquireAppStoreTransactionLocks(tx, originalTransactionId, transactionId)
    await acquireEntitlementLock(tx, input.userId)
    await assertTransactionOwnership({
      db: tx,
      userId: input.userId,
      originalTransactionId,
      transactionId,
      appAccountToken: transaction.appAccountToken,
      allowTokenlessFirstClaim,
    })

    const storedTransaction = await tx.appStoreTransaction.findUnique({ where: { transactionId } })
    const merged = mergeAppStoreSnapshot({
      existing: storedTransaction,
      transaction,
      renewal,
      status: input.status,
      notificationSignedDate: input.notificationSignedDate,
      now,
    })
    if (!merged.changed) return refreshSubscriptionEntitlement(tx, input.userId, now)

    const transactionData = {
      webOrderLineItemId: transaction.webOrderLineItemId ?? null,
      productId,
      environment,
      appAccountToken: transaction.appAccountToken ?? null,
      purchaseDate: toDate(transaction.purchaseDate),
      signedTransactionHash,
    }
    await tx.appStoreTransaction.upsert({
      where: { transactionId },
      create: {
        userId: input.userId,
        originalTransactionId,
        transactionId,
        ...transactionData,
        ...merged.facts,
        signedRenewalHash,
      },
      update: {
        ...(merged.transactionChanged ? transactionData : {}),
        ...merged.facts,
        ...(merged.renewalChanged ? { signedRenewalHash } : {}),
      },
    })
    return refreshSubscriptionEntitlement(tx, input.userId, now)
  })

  return entitlement ? toSubscriptionSnapshot(entitlement, now) : inactiveSubscriptionSnapshot()
}

async function acquireAppStoreTransactionLocks(
  db: Pick<DbClient, '$executeRaw'>,
  originalTransactionId: string,
  transactionId: string,
) {
  await db.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-app-store-original:${originalTransactionId}`}, 0))`,
  )
  await db.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-app-store-transaction:${transactionId}`}, 0))`,
  )
}

async function acquireEntitlementLock(
  db: Pick<DbClient, '$executeRaw'>,
  userId: string,
) {
  await db.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-entitlement:${userId}`}, 0))`,
  )
}

async function acquireGooglePlayPurchaseLocks(
  db: Pick<DbClient, '$executeRaw'>,
  purchaseTokenHashes: Array<string | null>,
) {
  const uniqueHashes = [...new Set(purchaseTokenHashes.filter((hash): hash is string => hash != null))]
    .sort()

  for (const purchaseTokenHash of uniqueHashes) {
    await db.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-google-play-purchase:${purchaseTokenHash}`}, 0))`,
    )
  }
}

async function assertTransactionOwnership({
  allowTokenlessFirstClaim,
  appAccountToken,
  db,
  originalTransactionId,
  transactionId,
  userId,
}: {
  allowTokenlessFirstClaim?: boolean
  appAccountToken: string | null | undefined
  db: Pick<DbClient, 'appStoreTransaction' | 'subscriptionEntitlement'>
  originalTransactionId: string
  transactionId: string
  userId: string
}) {
  const [existingEntitlement, existingTransactions] = await Promise.all([
    db.subscriptionEntitlement.findUnique({
      where: { originalTransactionId },
      select: { userId: true },
    }),
    db.appStoreTransaction.findMany({
      where: {
        OR: [{ originalTransactionId }, { transactionId }],
      },
      select: {
        originalTransactionId: true,
        transactionId: true,
        userId: true,
      },
    }),
  ])
  assertAppStoreOwnership({ userId, appAccountToken, originalTransactionId, transactionId,
    allowTokenlessFirstClaim, existingEntitlement, existingTransactions })
}

async function assertGooglePlayPurchaseOwnership({
  db,
  externalAccountId,
  externalProfileId,
  linkedPurchaseTokenHash,
  purchaseTokenHash,
  userId,
}: {
  db: Pick<DbClient, 'googlePlaySubscriptionPurchase'>
  externalAccountId: string | null
  externalProfileId: string | null
  linkedPurchaseTokenHash: string | null
  purchaseTokenHash: string
  userId: string
}) {
  const tokenMatches = [
    { purchaseTokenHash },
    { linkedPurchaseTokenHash: purchaseTokenHash },
    ...(linkedPurchaseTokenHash
      ? [
          { purchaseTokenHash: linkedPurchaseTokenHash },
          { linkedPurchaseTokenHash },
        ]
      : []),
  ]
  const existingPurchases = await db.googlePlaySubscriptionPurchase.findMany({
    where: { OR: tokenMatches },
    select: { userId: true },
  })

  assertGooglePlayOwnership({ userId, externalAccountId, externalProfileId, existingPurchases })
}

export async function resolveWebhookUserId({
  db,
  transaction,
}: {
  db: DbClient
  transaction: AppStoreTransaction
}) {
  if (transaction.appAccountToken) {
    const user = await db.user.findUnique({
      where: { id: transaction.appAccountToken },
      select: { id: true },
    })
    if (user) return user.id
  }

  if (transaction.originalTransactionId) {
    const entitlement = await db.subscriptionEntitlement.findUnique({
      where: { originalTransactionId: transaction.originalTransactionId },
      select: { userId: true },
    })
    if (entitlement) return entitlement.userId

    // Another store can replace the current entitlement. The Apple chain still
    // belongs to the account recorded by its verified purchase history.
    const purchase = await db.appStoreTransaction.findFirst({
      where: { originalTransactionId: transaction.originalTransactionId },
      select: { userId: true },
    })
    if (purchase) return purchase.userId
  }

  return null
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
