import { createHash, randomUUID } from 'node:crypto'

import { AutoRenewStatus, Environment, OfferType, Status, Type, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload } from '@apple/app-store-server-library'
import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

import type { DbClient } from '../../../db'
import type { AppEnv } from '../../../env'
import { Prisma } from '../../../generated/prisma/client'
import { SubscriptionState } from '../../../generated/prisma/enums'
import { BillingFailure } from '../domain/errors'
import type {
  AppStoreNotificationDetails,
  AppStoreWebhookClaim,
} from '../application/ports'
import type { AppStoreVerificationResult } from './apple-verifier'
import type {
  GooglePlaySubscriptionLineItem,
  GooglePlaySubscriptionPurchase,
  GooglePlaySubscriptionVerifier,
} from './google-play-verifier'
import {
  inactiveSubscriptionSnapshot,
  resolveGooglePlaySubscriptionState,
  resolveGooglePlayWillAutoRenew,
  shouldAcknowledgeGooglePlayPurchase,
  shouldUpdateEntitlement,
  toSubscriptionSnapshot,
  type EntitlementRecord,
} from '../domain/subscription'

export type ApplyTransactionInput = {
  userId: string
  signedTransactionInfo: string
  signedRenewalInfo?: string | null
  allowTokenlessFirstClaim?: boolean
  verifiedTransaction: AppStoreVerificationResult<JWSTransactionDecodedPayload>
  verifiedRenewal?: AppStoreVerificationResult<JWSRenewalInfoDecodedPayload> | null
  status?: Status | number | null
}

export type OfferCodeRedemptionProof = {
  issuedAt: Date
  userId: string
}

export type GooglePlayPurchaseReferenceInput = {
  basePlanId?: string | null
  productId: string
  purchaseToken: string
}

const APP_STORE_WEBHOOK_CLAIM_LEASE_MS = 5 * 60 * 1000

export async function getSubscriptionSnapshot(db: DbClient, userId: string): Promise<SubscriptionSnapshot> {
  const entitlement = await db.subscriptionEntitlement.findUnique({
    where: { userId },
  })

  return entitlement ? toSubscriptionSnapshot(entitlement, new Date()) : inactiveSubscriptionSnapshot()
}

export async function resolveStatusLookupEnvironment({
  env,
}: {
  db: DbClient
  env: AppEnv
  userId: string
  originalTransactionId: string
}) {
  return toAppStoreEnvironment(env.APPLE_IAP_ENVIRONMENT)
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
    verifiedTransaction?: AppStoreVerificationResult<JWSTransactionDecodedPayload> | null
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
  input,
  userId,
  verifier,
  verifiedPurchase,
}: {
  db: DbClient
  env: AppEnv
  input: GooglePlayPurchaseReferenceInput
  userId: string
  verifier: GooglePlaySubscriptionVerifier
  verifiedPurchase: GooglePlaySubscriptionPurchase
}): Promise<SubscriptionSnapshot> {
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

  assertGooglePlayProductConfigured(env, requestedProductId)

  if (env.NODE_ENV === 'production' && verifiedPurchase.testPurchase != null) {
    throw new BillingFailure(
      'IAP_INVALID_TRANSACTION',
      'Google Play test purchases are not accepted in production',
    )
  }

  const lineItem = selectGooglePlayLineItem({
    env,
    productId: requestedProductId,
    basePlanId: requestedBasePlanId,
    purchase: verifiedPurchase,
  })
  const productId = normalizeRequiredString(lineItem.productId)
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
  const latestOrderId = normalizeString(verifiedPurchase.latestOrderId)
  const acknowledgementState = normalizeString(verifiedPurchase.acknowledgementState)
  const shouldAcknowledge = shouldAcknowledgeGooglePlayPurchase({
    state,
    subscriptionState: verifiedPurchase.subscriptionState,
    acknowledgementState,
  })
  const acknowledgedAt = shouldAcknowledge ? now : null

  if (shouldAcknowledge) {
    await verifier.acknowledgeSubscription({
      productId,
      purchaseToken,
    })
  }

  const storedAcknowledgementState = shouldAcknowledge
    ? 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
    : acknowledgementState
  const environment = verifiedPurchase.testPurchase != null ? 'sandbox' : 'production'

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

    await tx.googlePlaySubscriptionPurchase.upsert({
      where: { purchaseTokenHash },
      create: {
        userId,
        purchaseToken,
        purchaseTokenHash,
        linkedPurchaseToken,
        linkedPurchaseTokenHash,
        productId,
        basePlanId,
        latestOrderId,
        state,
        environment,
        acknowledgementState: storedAcknowledgementState,
        externalAccountId,
        externalProfileId,
        expiresAt,
        willAutoRenew,
        acknowledgedAt,
        reconcileAttemptedAt: now,
      },
      update: {
        purchaseToken,
        linkedPurchaseToken,
        linkedPurchaseTokenHash,
        productId,
        basePlanId,
        latestOrderId,
        state,
        environment,
        acknowledgementState: storedAcknowledgementState,
        externalAccountId,
        externalProfileId,
        expiresAt,
        willAutoRenew,
        ...(acknowledgedAt ? { acknowledgedAt } : {}),
        reconcileAttemptedAt: now,
      },
    })

    const existingEntitlement = await tx.subscriptionEntitlement.findUnique({
      where: { userId },
    })

    if (
      existingEntitlement &&
      !shouldUpdateEntitlement({
        existing: existingEntitlement,
        incoming: {
          platform: 'android',
          transactionId: latestOrderId,
          originalTransactionId: null,
          purchaseDate: toDateFromIso(verifiedPurchase.startTime),
          expiresAt,
          revokedAt: null,
          state,
        },
        now,
      })
    ) {
      return existingEntitlement
    }

    return tx.subscriptionEntitlement.upsert({
      where: { userId },
      create: {
        userId,
        entitlementKey: 'premium',
        platform: 'android',
        state,
        productId,
        originalTransactionId: null,
        transactionId: latestOrderId,
        webOrderLineItemId: null,
        expiresAt,
        willAutoRenew,
        environment,
      },
      update: {
        platform: 'android',
        state,
        productId,
        originalTransactionId: null,
        transactionId: latestOrderId,
        webOrderLineItemId: null,
        expiresAt,
        willAutoRenew,
        environment,
      },
    })
  })

  return toSubscriptionSnapshot(entitlement, now)
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
  const originalTransactionId = transaction.originalTransactionId ?? renewal?.originalTransactionId
  const transactionId = transaction.transactionId
  const productId = transaction.productId ?? renewal?.productId ?? renewal?.autoRenewProductId

  if (!originalTransactionId || !transactionId || !productId) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'App Store transaction is missing required identifiers')
  }

  if (env.APPLE_IAP_PRODUCT_IDS.length === 0) {
    throw new BillingFailure(
      'IAP_NOT_CONFIGURED',
      'App Store subscription product IDs are not configured',
    )
  }

  if (!env.APPLE_IAP_PRODUCT_IDS.includes(productId)) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'App Store transaction product is not configured')
  }

  if (transaction.type !== Type.AUTO_RENEWABLE_SUBSCRIPTION) {
    throw new BillingFailure(
      'IAP_INVALID_TRANSACTION',
      'App Store transaction is not an auto-renewable subscription',
    )
  }

  assertAppStoreEnvironmentMatchesConfiguration({
    configuredEnvironment: env.APPLE_IAP_ENVIRONMENT,
    renewalEnvironment: renewal?.environment,
    transactionEnvironment: transaction.environment,
    verifiedEnvironment: input.verifiedTransaction.environment,
  })

  const expiresAt = resolveSubscriptionExpiresAt(transaction, renewal, input.status)
  assertSubscriptionHasExpiration(transaction, renewal, expiresAt, input.status)
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

  const state = resolveSubscriptionState(transaction, renewal, input.status, now)
  const willAutoRenew =
    renewal?.autoRenewStatus == null ? null : renewal.autoRenewStatus === AutoRenewStatus.ON
  const environment = formatEnvironment(transaction.environment ?? renewal?.environment ?? input.verifiedTransaction.environment)
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

    await tx.appStoreTransaction.upsert({
      where: { transactionId },
      create: {
        userId: input.userId,
        originalTransactionId,
        transactionId,
        webOrderLineItemId: transaction.webOrderLineItemId ?? null,
        productId,
        state,
        environment,
        appAccountToken: transaction.appAccountToken ?? null,
        purchaseDate: toDate(transaction.purchaseDate),
        expiresAt,
        revokedAt: toDate(transaction.revocationDate),
        willAutoRenew,
        signedTransactionHash,
        signedRenewalHash,
      },
      update: {
        webOrderLineItemId: transaction.webOrderLineItemId ?? null,
        productId,
        state,
        environment,
        appAccountToken: transaction.appAccountToken ?? null,
        purchaseDate: toDate(transaction.purchaseDate),
        expiresAt,
        revokedAt: toDate(transaction.revocationDate),
        willAutoRenew,
        signedTransactionHash,
        signedRenewalHash,
      },
    })

    const existingEntitlement = await tx.subscriptionEntitlement.findUnique({
      where: { userId: input.userId },
    })

    if (
      existingEntitlement &&
      !shouldUpdateEntitlement({
        existing: existingEntitlement,
        incoming: {
          platform: 'ios',
          transactionId,
          originalTransactionId,
          purchaseDate: toDate(transaction.purchaseDate),
          expiresAt,
          revokedAt: toDate(transaction.revocationDate),
          state,
        },
        now,
      })
    ) {
      return existingEntitlement
    }

    return tx.subscriptionEntitlement.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        entitlementKey: 'premium',
        platform: 'ios',
        state,
        productId,
        originalTransactionId,
        transactionId,
        webOrderLineItemId: transaction.webOrderLineItemId ?? null,
        expiresAt,
        willAutoRenew,
        environment,
      },
      update: {
        platform: 'ios',
        state,
        productId,
        originalTransactionId,
        transactionId,
        webOrderLineItemId: transaction.webOrderLineItemId ?? null,
        expiresAt,
        willAutoRenew,
        environment,
      },
    })
  })

  return toSubscriptionSnapshot(entitlement, now)
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

function assertAppStoreEnvironmentMatchesConfiguration({
  configuredEnvironment,
  renewalEnvironment,
  transactionEnvironment,
  verifiedEnvironment,
}: {
  configuredEnvironment: AppEnv['APPLE_IAP_ENVIRONMENT']
  renewalEnvironment?: Environment | string | null
  transactionEnvironment?: Environment | string | null
  verifiedEnvironment: Environment
}) {
  const configured = toAppStoreEnvironment(configuredEnvironment)
  const observed = [verifiedEnvironment, transactionEnvironment, renewalEnvironment]
    .filter((value): value is Environment | string => value != null)
    .map(toAppStoreEnvironment)

  if (observed.some((environment) => environment !== configured)) {
    throw new BillingFailure(
      'IAP_INVALID_TRANSACTION',
      'App Store transaction environment does not match the configured environment',
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
  if (appAccountToken) {
    if (appAccountToken === userId) return
    throw ownershipMismatchError()
  }

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
  const transactionIdentityMismatch = existingTransactions.some(
    (stored) =>
      stored.transactionId === transactionId &&
      (stored.originalTransactionId !== originalTransactionId || stored.userId !== userId),
  )
  const originalTransactionOwnerMismatch = existingTransactions.some(
    (stored) =>
      stored.originalTransactionId === originalTransactionId && stored.userId !== userId,
  )

  if (transactionIdentityMismatch || originalTransactionOwnerMismatch) {
    throw ownershipMismatchError()
  }

  if (existingEntitlement?.userId === userId) return
  if (existingEntitlement) throw ownershipMismatchError()
  if (existingTransactions.some((stored) => stored.userId === userId)) return
  if (allowTokenlessFirstClaim) return

  throw ownershipMismatchError()
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

  if (existingPurchases.length > 0) {
    if (existingPurchases.every((purchase) => purchase.userId === userId)) return
    throw googlePlayOwnershipMismatchError()
  }

  if (externalAccountId === userId || externalProfileId === userId) return

  if (externalAccountId || externalProfileId) {
    throw googlePlayOwnershipMismatchError()
  }

  throw googlePlayOwnershipMismatchError()
}

function assertGooglePlayExternalIdentityConsistent({
  externalAccountId,
  externalProfileId,
}: {
  externalAccountId: string | null
  externalProfileId: string | null
}) {
  if (externalAccountId && externalProfileId && externalAccountId !== externalProfileId) {
    throw googlePlayOwnershipMismatchError()
  }
}

function googlePlayOwnershipMismatchError() {
  return new BillingFailure(
    'IAP_OWNERSHIP_MISMATCH',
    'This Google Play purchase is linked to another account',
  )
}

function isValidOfferCodeTokenlessFirstClaim({
  offerCodeRedemption,
  transaction,
  userId,
}: {
  offerCodeRedemption?: OfferCodeRedemptionProof | null
  transaction: JWSTransactionDecodedPayload
  userId: string
}) {
  if (!offerCodeRedemption) return false
  if (offerCodeRedemption.userId !== userId) return false
  if (transaction.appAccountToken) return false
  if (transaction.offerType !== OfferType.OFFER_CODE) return false
  if (!transaction.offerIdentifier?.trim()) return false

  const purchaseDate = toDate(transaction.purchaseDate)
  if (!purchaseDate) return false

  return purchaseDate.getTime() >= offerCodeRedemption.issuedAt.getTime() - 5 * 60 * 1000
}

function ownershipMismatchError() {
  return new BillingFailure(
    'IAP_OWNERSHIP_MISMATCH',
    'This App Store purchase is linked to another account',
  )
}

function assertSubscriptionHasExpiration(
  transaction: JWSTransactionDecodedPayload,
  renewal: JWSRenewalInfoDecodedPayload | null,
  expiresAt: Date | null,
  status: Status | number | null | undefined,
) {
  if (expiresAt || transaction.revocationDate || status === Status.REVOKED) return

  throw new BillingFailure(
    'IAP_INVALID_TRANSACTION',
    'App Store subscription transaction is missing an expiration date',
    renewal ? undefined : { transactionId: transaction.transactionId },
  )
}

function assertGooglePlayProductConfigured(env: AppEnv, productId: string) {
  if (env.GOOGLE_PLAY_PRODUCT_IDS.length === 0) {
    throw new BillingFailure(
      'IAP_NOT_CONFIGURED',
      'Google Play subscription product IDs are not configured',
    )
  }

  if (!env.GOOGLE_PLAY_PRODUCT_IDS.includes(productId)) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Google Play purchase product is not configured')
  }
}

function selectGooglePlayLineItem({
  basePlanId,
  env,
  productId,
  purchase,
}: {
  basePlanId: string | null
  env: AppEnv
  productId: string
  purchase: GooglePlaySubscriptionPurchase
}) {
  const lineItems = purchase.lineItems ?? []
  const matchingProductItems = lineItems.filter((item) => normalizeString(item.productId) === productId)
  const matchingItems = basePlanId
    ? matchingProductItems.filter((item) => normalizeString(item.offerDetails?.basePlanId) === basePlanId)
    : matchingProductItems
  const selected = matchingItems.sort(compareGooglePlayLineItemsByExpiryDesc)[0] ?? null

  if (!selected) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Google Play purchase does not include the configured product')
  }

  const actualBasePlanId = normalizeString(selected.offerDetails?.basePlanId)
  if (basePlanId && actualBasePlanId !== basePlanId) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Google Play purchase base plan does not match the request')
  }

  if (env.GOOGLE_PLAY_BASE_PLAN_IDS.length === 0) {
    throw new BillingFailure(
      'IAP_NOT_CONFIGURED',
      'Google Play subscription base plan IDs are not configured',
    )
  }

  if (!actualBasePlanId || !env.GOOGLE_PLAY_BASE_PLAN_IDS.includes(actualBasePlanId)) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Google Play purchase base plan is not configured')
  }

  return selected
}

function assertGooglePlaySubscriptionHasExpiration({
  expiresAt,
  state,
  subscriptionState,
}: {
  expiresAt: Date | null
  state: SubscriptionState
  subscriptionState: string | null | undefined
}) {
  if (
    expiresAt ||
    state === SubscriptionState.pending ||
    subscriptionState === 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'
  ) {
    return
  }

  throw new BillingFailure(
    'IAP_INVALID_TRANSACTION',
    'Google Play subscription purchase is missing an expiration date',
  )
}

function compareGooglePlayLineItemsByExpiryDesc(
  left: GooglePlaySubscriptionLineItem,
  right: GooglePlaySubscriptionLineItem,
) {
  return (toDateFromIso(right.expiryTime)?.getTime() ?? 0) - (toDateFromIso(left.expiryTime)?.getTime() ?? 0)
}

export async function resolveWebhookUserId({
  db,
  transaction,
}: {
  db: DbClient
  transaction: JWSTransactionDecodedPayload
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
  }

  return null
}

function resolveSubscriptionState(
  transaction: JWSTransactionDecodedPayload,
  renewal: JWSRenewalInfoDecodedPayload | null,
  status: Status | number | null | undefined,
  now: Date,
): SubscriptionState {
  if (transaction.revocationDate) return SubscriptionState.revoked

  switch (status) {
    case Status.ACTIVE:
      return SubscriptionState.active
    case Status.BILLING_GRACE_PERIOD:
      return SubscriptionState.billing_grace_period
    case Status.BILLING_RETRY:
      return SubscriptionState.billing_retry
    case Status.EXPIRED:
      return SubscriptionState.expired
    case Status.REVOKED:
      return SubscriptionState.revoked
  }

  if (renewal?.isInBillingRetryPeriod) return SubscriptionState.billing_retry

  const expiresAt = resolveSubscriptionExpiresAt(transaction, renewal, status)
  if (!expiresAt || expiresAt.getTime() > now.getTime()) return SubscriptionState.active

  return SubscriptionState.expired
}

function resolveSubscriptionExpiresAt(
  transaction: JWSTransactionDecodedPayload,
  renewal: JWSRenewalInfoDecodedPayload | null,
  status?: Status | number | null,
) {
  const standardExpiresAt = toDate(transaction.expiresDate ?? renewal?.renewalDate)
  const gracePeriodExpiresAt =
    status === Status.BILLING_GRACE_PERIOD ? toDate(renewal?.gracePeriodExpiresDate) : null

  if (
    gracePeriodExpiresAt &&
    (!standardExpiresAt || gracePeriodExpiresAt.getTime() > standardExpiresAt.getTime())
  ) {
    return gracePeriodExpiresAt
  }

  return standardExpiresAt
}

function toDate(value: number | null | undefined) {
  if (!value) return null
  return new Date(value)
}

function toDateFromIso(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatEnvironment(value: Environment | string | null | undefined) {
  if (!value) return null
  return String(value).toLowerCase()
}

function toAppStoreEnvironment(value: Environment | string | null | undefined) {
  if (value === Environment.PRODUCTION || value === 'Production' || value === 'production') {
    return Environment.PRODUCTION
  }

  return Environment.SANDBOX
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeString(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeRequiredString(value: string | null | undefined) {
  const normalized = normalizeString(value)
  if (!normalized) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Google Play purchase is missing required identifiers')
  }
  return normalized
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
