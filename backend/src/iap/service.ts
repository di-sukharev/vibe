import { createHash } from 'node:crypto'

import { AutoRenewStatus, Environment, OfferType, Status, Type, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload } from '@apple/app-store-server-library'
import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import { Prisma } from '../generated/prisma/client'
import { SubscriptionState } from '../generated/prisma/enums'
import { AppError } from '../http/errors'
import type {
  AppStoreStatusTransaction,
  AppStoreSubscriptionVerifier,
  AppStoreVerificationResult,
} from './apple-verifier'
import type {
  GooglePlaySubscriptionLineItem,
  GooglePlaySubscriptionPurchase,
  GooglePlaySubscriptionVerifier,
} from './google-play-verifier'
import { signOfferCodeRedemptionToken, verifyOfferCodeRedemptionToken } from './offer-code-tokens'

export type EntitlementRecord = {
  platform: 'android' | 'ios' | null
  state: SubscriptionState
  productId: string | null
  originalTransactionId: string | null
  transactionId: string | null
  expiresAt: Date | null
  willAutoRenew: boolean | null
  updatedAt: Date
}

type ApplyTransactionInput = {
  userId: string
  signedTransactionInfo: string
  signedRenewalInfo?: string | null
  allowTokenlessFirstClaim?: boolean
  verifiedTransaction: AppStoreVerificationResult<JWSTransactionDecodedPayload>
  verifiedRenewal?: AppStoreVerificationResult<JWSRenewalInfoDecodedPayload> | null
  status?: Status | number | null
}

type OfferCodeRedemptionProof = {
  issuedAt: Date
  userId: string
}

type ReconcileAttemptState = {
  firstError: unknown
  latestSnapshot: SubscriptionSnapshot | null
}

type GooglePlayPurchaseReferenceInput = {
  basePlanId?: string | null
  productId: string
  purchaseToken: string
}

export function inactiveSubscriptionSnapshot(): SubscriptionSnapshot {
  return {
    entitlement: 'premium',
    isActive: false,
    state: 'inactive',
    platform: null,
    productId: null,
    originalTransactionId: null,
    transactionId: null,
    expiresAt: null,
    willAutoRenew: null,
    updatedAt: null,
  }
}

export async function getSubscriptionSnapshot(db: DbClient, userId: string): Promise<SubscriptionSnapshot> {
  const entitlement = await db.subscriptionEntitlement.findUnique({
    where: { userId },
  })

  return entitlement ? toSubscriptionSnapshot(entitlement) : inactiveSubscriptionSnapshot()
}

export async function ingestAppStoreTransaction(input: {
  db: DbClient
  env: AppEnv
  verifier: AppStoreSubscriptionVerifier
  userId: string
  signedTransactionInfo: string
  signedRenewalInfo?: string | null
  offerCodeRedemptionToken?: string | null
}): Promise<SubscriptionSnapshot> {
  const verifiedTransaction = await input.verifier.verifyTransaction(input.signedTransactionInfo)
  const verifiedRenewal = input.signedRenewalInfo
    ? await input.verifier.verifyRenewalInfo(input.signedRenewalInfo)
    : null
  const offerCodeRedemption = input.offerCodeRedemptionToken
    ? await verifyOfferCodeRedemptionToken(input.offerCodeRedemptionToken, input.env)
    : null

  return applyVerifiedAppStoreTransaction({
    db: input.db,
    env: input.env,
    offerCodeRedemption,
    input: {
      userId: input.userId,
      signedTransactionInfo: input.signedTransactionInfo,
      signedRenewalInfo: input.signedRenewalInfo,
      verifiedTransaction,
      verifiedRenewal,
    },
  })
}

export function createOfferCodeRedemptionToken(input: {
  env: AppEnv
  userId: string
}) {
  return signOfferCodeRedemptionToken(input.userId, input.env)
}

export async function reconcileAppStoreTransactions(input: {
  db: DbClient
  env: AppEnv
  verifier: AppStoreSubscriptionVerifier
  userId: string
  signedTransactions?: string[]
  originalTransactionIds?: string[]
}): Promise<SubscriptionSnapshot> {
  const attemptState: ReconcileAttemptState = {
    firstError: null,
    latestSnapshot: null,
  }

  for (const signedTransactionInfo of input.signedTransactions ?? []) {
    await recordReconcileAttempt(attemptState, () =>
      ingestAppStoreTransaction({
        db: input.db,
        env: input.env,
        verifier: input.verifier,
        userId: input.userId,
        signedTransactionInfo,
      }),
    )
  }

  for (const originalTransactionId of input.originalTransactionIds ?? []) {
    await recordReconcileAttempt(attemptState, async () => {
      const environment = await resolveStatusLookupEnvironment({
        db: input.db,
        env: input.env,
        userId: input.userId,
        originalTransactionId,
      })
      const statusItems = await input.verifier.getSubscriptionStatuses({
        transactionId: originalTransactionId,
        environment,
      })
      return applyStatusTransactions({
        db: input.db,
        env: input.env,
        verifier: input.verifier,
        userId: input.userId,
        statusItems,
      })
    })
  }

  if (attemptState.latestSnapshot) return attemptState.latestSnapshot
  if (attemptState.firstError) throw attemptState.firstError

  return getSubscriptionSnapshot(input.db, input.userId)
}

export async function ingestGooglePlayTransaction(input: {
  basePlanId?: string | null
  db: DbClient
  env: AppEnv
  productId: string
  purchaseToken: string
  userId: string
  verifier: GooglePlaySubscriptionVerifier
}): Promise<SubscriptionSnapshot> {
  const purchase = await input.verifier.getSubscriptionPurchase({
    purchaseToken: input.purchaseToken,
  })

  return applyVerifiedGooglePlayPurchase({
    db: input.db,
    env: input.env,
    input: {
      basePlanId: input.basePlanId,
      productId: input.productId,
      purchaseToken: input.purchaseToken,
    },
    userId: input.userId,
    verifier: input.verifier,
    verifiedPurchase: purchase,
  })
}

export async function reconcileGooglePlayTransactions(input: {
  db: DbClient
  env: AppEnv
  purchases?: GooglePlayPurchaseReferenceInput[]
  userId: string
  verifier: GooglePlaySubscriptionVerifier
}): Promise<SubscriptionSnapshot> {
  const attemptState: ReconcileAttemptState = {
    firstError: null,
    latestSnapshot: null,
  }

  for (const purchase of input.purchases ?? []) {
    await recordReconcileAttempt(attemptState, () =>
      ingestGooglePlayTransaction({
        basePlanId: purchase.basePlanId,
        db: input.db,
        env: input.env,
        productId: purchase.productId,
        purchaseToken: purchase.purchaseToken,
        userId: input.userId,
        verifier: input.verifier,
      }),
    )
  }

  if (attemptState.latestSnapshot) return attemptState.latestSnapshot
  if (attemptState.firstError && (input.purchases?.length ?? 0) > 0) throw attemptState.firstError

  const storedPurchases = await input.db.googlePlaySubscriptionPurchase.findMany({
    where: { userId: input.userId },
    orderBy: [{ expiresAt: 'desc' }, { updatedAt: 'desc' }],
    take: 5,
  })

  for (const storedPurchase of storedPurchases) {
    await recordReconcileAttempt(attemptState, () =>
      ingestGooglePlayTransaction({
        basePlanId: storedPurchase.basePlanId,
        db: input.db,
        env: input.env,
        productId: storedPurchase.productId,
        purchaseToken: storedPurchase.purchaseToken,
        userId: input.userId,
        verifier: input.verifier,
      }),
    )
  }

  if (attemptState.latestSnapshot) return attemptState.latestSnapshot
  if (attemptState.firstError) throw attemptState.firstError

  return getSubscriptionSnapshot(input.db, input.userId)
}

export async function recordAndProcessAppStoreWebhook(input: {
  db: DbClient
  env: AppEnv
  verifier: AppStoreSubscriptionVerifier
  signedPayload: string
}): Promise<{ duplicate: boolean; subscription: SubscriptionSnapshot | null }> {
  const signedPayloadHash = hashToken(input.signedPayload)
  const webhook = await claimAppStoreWebhook(input.db, signedPayloadHash)
  if (!webhook) {
    return { duplicate: true, subscription: null }
  }

  try {
    const verifiedNotification = await input.verifier.verifyNotification(input.signedPayload)
    const notification = verifiedNotification.payload
    const signedTransactionInfo = notification.data?.signedTransactionInfo
    const signedRenewalInfo = notification.data?.signedRenewalInfo
    const verifiedTransaction = signedTransactionInfo
      ? await input.verifier.verifyTransaction(signedTransactionInfo)
      : null
    const verifiedRenewal = signedRenewalInfo ? await input.verifier.verifyRenewalInfo(signedRenewalInfo) : null
    const transaction = verifiedTransaction?.payload

    await input.db.appStoreWebhook.update({
      where: { id: webhook.id },
      data: {
        notificationUuid: notification.notificationUUID ?? null,
        notificationType: notification.notificationType ? String(notification.notificationType) : null,
        subtype: notification.subtype ? String(notification.subtype) : null,
        environment: formatEnvironment(notification.data?.environment ?? verifiedNotification.environment),
        originalTransactionId: transaction?.originalTransactionId ?? null,
        transactionId: transaction?.transactionId ?? null,
      },
    })

    if (!signedTransactionInfo || !verifiedTransaction) {
      await markAppStoreWebhookProcessed(input.db, webhook.id)
      return { duplicate: false, subscription: null }
    }

    const userId = await resolveWebhookUserId({
      db: input.db,
      transaction: verifiedTransaction.payload,
    })

    if (!userId) {
      await markAppStoreWebhookProcessed(input.db, webhook.id)
      return { duplicate: false, subscription: null }
    }

    const subscription = await applyVerifiedAppStoreTransaction({
      db: input.db,
      env: input.env,
      input: {
        userId,
        signedTransactionInfo,
        signedRenewalInfo,
        verifiedTransaction,
        verifiedRenewal,
        status: notification.data?.status,
      },
    })

    await markAppStoreWebhookProcessed(input.db, webhook.id)

    return { duplicate: false, subscription }
  } catch (error) {
    await releaseFailedAppStoreWebhookClaim(input.db, webhook.id)
    throw error
  }
}

async function applyStatusTransactions(input: {
  db: DbClient
  env: AppEnv
  verifier: AppStoreSubscriptionVerifier
  userId: string
  statusItems: AppStoreStatusTransaction[]
}): Promise<SubscriptionSnapshot | null> {
  const attemptState: ReconcileAttemptState = {
    firstError: null,
    latestSnapshot: null,
  }

  for (const item of input.statusItems) {
    if (!item.signedTransactionInfo) continue

    await recordReconcileAttempt(attemptState, async () => {
      const verifiedTransaction = await input.verifier.verifyTransaction(item.signedTransactionInfo!)
      const verifiedRenewal = item.signedRenewalInfo
        ? await input.verifier.verifyRenewalInfo(item.signedRenewalInfo)
        : null

      return applyVerifiedAppStoreTransaction({
        db: input.db,
        env: input.env,
        input: {
          userId: input.userId,
          signedTransactionInfo: item.signedTransactionInfo!,
          signedRenewalInfo: item.signedRenewalInfo,
          verifiedTransaction,
          verifiedRenewal,
          status: item.status,
        },
      })
    })
  }

  if (attemptState.latestSnapshot) return attemptState.latestSnapshot
  if (attemptState.firstError) throw attemptState.firstError

  return null
}

async function resolveStatusLookupEnvironment({
  db,
  env,
  userId,
  originalTransactionId,
}: {
  db: DbClient
  env: AppEnv
  userId: string
  originalTransactionId: string
}) {
  const entitlement = await db.subscriptionEntitlement.findUnique({
    where: { userId },
    select: { environment: true, originalTransactionId: true },
  })

  if (entitlement?.originalTransactionId === originalTransactionId) {
    return toAppStoreEnvironment(entitlement.environment ?? env.APPLE_IAP_ENVIRONMENT)
  }

  return toAppStoreEnvironment(env.APPLE_IAP_ENVIRONMENT)
}

async function claimAppStoreWebhook(db: DbClient, signedPayloadHash: string) {
  try {
    return await db.appStoreWebhook.create({
      data: { signedPayloadHash },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) return null
    throw error
  }
}

async function markAppStoreWebhookProcessed(db: DbClient, id: string) {
  return db.appStoreWebhook.update({
    where: { id },
    data: { processedAt: new Date() },
  })
}

async function releaseFailedAppStoreWebhookClaim(db: DbClient, id: string) {
  await db.appStoreWebhook.deleteMany({
    where: {
      id,
      processedAt: null,
    },
  })
}

async function applyVerifiedGooglePlayPurchase({
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
  const requestedBasePlanId = normalizeString(input.basePlanId)
  const purchaseToken = normalizeRequiredString(input.purchaseToken)
  const purchaseTokenHash = hashToken(purchaseToken)
  const linkedPurchaseToken = normalizeString(verifiedPurchase.linkedPurchaseToken)
  const linkedPurchaseTokenHash = linkedPurchaseToken ? hashToken(linkedPurchaseToken) : null

  assertGooglePlayProductConfigured(env, requestedProductId)

  const lineItem = selectGooglePlayLineItem({
    env,
    productId: requestedProductId,
    basePlanId: requestedBasePlanId,
    purchase: verifiedPurchase,
  })
  const productId = normalizeRequiredString(lineItem.productId)
  const basePlanId = normalizeString(lineItem.offerDetails?.basePlanId)

  await assertGooglePlayPurchaseOwnership({
    db,
    externalAccountId: normalizeString(verifiedPurchase.externalAccountIdentifiers?.obfuscatedExternalAccountId) ??
      normalizeString(verifiedPurchase.externalAccountIdentifiers?.externalAccountId),
    externalProfileId: normalizeString(verifiedPurchase.externalAccountIdentifiers?.obfuscatedExternalProfileId),
    linkedPurchaseTokenHash,
    purchaseTokenHash,
    userId,
  })

  const expiresAt = toDateFromIso(lineItem.expiryTime)
  const state = resolveGooglePlaySubscriptionState(verifiedPurchase.subscriptionState, expiresAt)
  assertGooglePlaySubscriptionHasExpiration({
    expiresAt,
    state,
    subscriptionState: verifiedPurchase.subscriptionState,
  })

  const willAutoRenew = resolveGooglePlayWillAutoRenew(verifiedPurchase.subscriptionState, lineItem)
  const latestOrderId = normalizeString(verifiedPurchase.latestOrderId)
  const acknowledgementState = normalizeString(verifiedPurchase.acknowledgementState)
  const shouldAcknowledge = shouldAcknowledgeGooglePlayPurchase({
    state,
    subscriptionState: verifiedPurchase.subscriptionState,
    acknowledgementState,
  })
  const acknowledgedAt = shouldAcknowledge ? new Date() : null

  if (shouldAcknowledge) {
    await verifier.acknowledgeSubscription({
      productId,
      purchaseToken,
    })
  }

  const storedAcknowledgementState = shouldAcknowledge
    ? 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
    : acknowledgementState
  const environment = verifiedPurchase.testPurchase ? 'sandbox' : 'production'
  const externalAccountId = normalizeString(verifiedPurchase.externalAccountIdentifiers?.obfuscatedExternalAccountId) ??
    normalizeString(verifiedPurchase.externalAccountIdentifiers?.externalAccountId)
  const externalProfileId = normalizeString(verifiedPurchase.externalAccountIdentifiers?.obfuscatedExternalProfileId)

  const entitlement = await db.$transaction(async (tx) => {
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
      },
      update: {
        userId,
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

  return toSubscriptionSnapshot(entitlement)
}

async function applyVerifiedAppStoreTransaction({
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
  const renewal = input.verifiedRenewal?.payload ?? null
  const originalTransactionId = transaction.originalTransactionId ?? renewal?.originalTransactionId
  const transactionId = transaction.transactionId
  const productId = transaction.productId ?? renewal?.productId ?? renewal?.autoRenewProductId

  if (!originalTransactionId || !transactionId || !productId) {
    throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'App Store transaction is missing required identifiers')
  }

  if (env.APPLE_IAP_PRODUCT_IDS.length === 0) {
    throw new AppError(
      503,
      'IAP_NOT_CONFIGURED',
      'App Store subscription product IDs are not configured',
    )
  }

  if (!env.APPLE_IAP_PRODUCT_IDS.includes(productId)) {
    throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'App Store transaction product is not configured')
  }

  if (transaction.type !== Type.AUTO_RENEWABLE_SUBSCRIPTION) {
    throw new AppError(
      400,
      'IAP_INVALID_TRANSACTION',
      'App Store transaction is not an auto-renewable subscription',
    )
  }

  const expiresAt = resolveSubscriptionExpiresAt(transaction, renewal, input.status)
  assertSubscriptionHasExpiration(transaction, renewal, expiresAt, input.status)
  await assertTransactionOwnership({
    db,
    userId: input.userId,
    originalTransactionId,
    appAccountToken: transaction.appAccountToken,
    allowTokenlessFirstClaim:
      input.allowTokenlessFirstClaim ||
      isValidOfferCodeTokenlessFirstClaim({
        offerCodeRedemption,
        transaction,
        userId: input.userId,
      }),
  })

  const state = resolveSubscriptionState(transaction, renewal, input.status)
  const willAutoRenew =
    renewal?.autoRenewStatus == null ? null : renewal.autoRenewStatus === AutoRenewStatus.ON
  const environment = formatEnvironment(transaction.environment ?? renewal?.environment ?? input.verifiedTransaction.environment)
  const signedTransactionHash = hashToken(input.signedTransactionInfo)
  const signedRenewalHash = input.signedRenewalInfo ? hashToken(input.signedRenewalInfo) : null

  const entitlement = await db.$transaction(async (tx) => {
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
        userId: input.userId,
        originalTransactionId,
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

  return toSubscriptionSnapshot(entitlement)
}

async function assertTransactionOwnership({
  allowTokenlessFirstClaim,
  appAccountToken,
  db,
  originalTransactionId,
  userId,
}: {
  allowTokenlessFirstClaim?: boolean
  appAccountToken: string | null | undefined
  db: DbClient
  originalTransactionId: string
  userId: string
}) {
  if (appAccountToken) {
    if (appAccountToken === userId) return
    throw ownershipMismatchError()
  }

  const existingEntitlement = await db.subscriptionEntitlement.findUnique({
    where: { originalTransactionId },
    select: { userId: true },
  })

  if (existingEntitlement?.userId === userId) return
  if (!existingEntitlement && allowTokenlessFirstClaim) return

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
  db: DbClient
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
  const existingPurchase = await db.googlePlaySubscriptionPurchase.findFirst({
    where: { OR: tokenMatches },
    select: { userId: true },
  })

  if (existingPurchase) {
    if (existingPurchase.userId === userId) return
    throw googlePlayOwnershipMismatchError()
  }

  if (externalAccountId === userId || externalProfileId === userId) return

  if (externalAccountId || externalProfileId) {
    throw googlePlayOwnershipMismatchError()
  }

  throw googlePlayOwnershipMismatchError()
}

function googlePlayOwnershipMismatchError() {
  return new AppError(
    403,
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
  return new AppError(
    403,
    'IAP_OWNERSHIP_MISMATCH',
    'This App Store purchase is linked to another account',
  )
}

function assertSubscriptionHasExpiration(
  transaction: JWSTransactionDecodedPayload,
  renewal: JWSRenewalInfoDecodedPayload | null,
  expiresAt: Date | null,
  status?: Status | number | null,
) {
  if (expiresAt || transaction.revocationDate || status === Status.REVOKED) return

  throw new AppError(
    400,
    'IAP_INVALID_TRANSACTION',
    'App Store subscription transaction is missing an expiration date',
    renewal ? undefined : { transactionId: transaction.transactionId },
  )
}

function assertGooglePlayProductConfigured(env: AppEnv, productId: string) {
  if (env.GOOGLE_PLAY_PRODUCT_IDS.length === 0) {
    throw new AppError(
      503,
      'IAP_NOT_CONFIGURED',
      'Google Play subscription product IDs are not configured',
    )
  }

  if (!env.GOOGLE_PLAY_PRODUCT_IDS.includes(productId)) {
    throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'Google Play purchase product is not configured')
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
    throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'Google Play purchase does not include the configured product')
  }

  const actualBasePlanId = normalizeString(selected.offerDetails?.basePlanId)
  if (basePlanId && actualBasePlanId !== basePlanId) {
    throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'Google Play purchase base plan does not match the request')
  }

  if (env.GOOGLE_PLAY_BASE_PLAN_IDS.length === 0) {
    throw new AppError(
      503,
      'IAP_NOT_CONFIGURED',
      'Google Play subscription base plan IDs are not configured',
    )
  }

  if (!actualBasePlanId || !env.GOOGLE_PLAY_BASE_PLAN_IDS.includes(actualBasePlanId)) {
    throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'Google Play purchase base plan is not configured')
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

  throw new AppError(
    400,
    'IAP_INVALID_TRANSACTION',
    'Google Play subscription purchase is missing an expiration date',
  )
}

function resolveGooglePlaySubscriptionState(
  subscriptionState: string | null | undefined,
  expiresAt: Date | null,
): SubscriptionState {
  switch (subscriptionState) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return isFutureDate(expiresAt) ? SubscriptionState.active : SubscriptionState.expired
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return isFutureDate(expiresAt) ? SubscriptionState.billing_grace_period : SubscriptionState.expired
    case 'SUBSCRIPTION_STATE_CANCELED':
      return isFutureDate(expiresAt) ? SubscriptionState.active : SubscriptionState.expired
    case 'SUBSCRIPTION_STATE_ON_HOLD':
    case 'SUBSCRIPTION_STATE_PAUSED':
      return SubscriptionState.billing_retry
    case 'SUBSCRIPTION_STATE_EXPIRED':
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return SubscriptionState.expired
    case 'SUBSCRIPTION_STATE_PENDING':
    case 'SUBSCRIPTION_STATE_UNSPECIFIED':
    default:
      return SubscriptionState.pending
  }
}

function resolveGooglePlayWillAutoRenew(
  subscriptionState: string | null | undefined,
  lineItem: GooglePlaySubscriptionLineItem,
) {
  if (subscriptionState === 'SUBSCRIPTION_STATE_CANCELED') return false
  return lineItem.autoRenewingPlan?.autoRenewEnabled ?? null
}

function shouldAcknowledgeGooglePlayPurchase({
  acknowledgementState,
  state,
  subscriptionState,
}: {
  acknowledgementState: string | null
  state: SubscriptionState
  subscriptionState: string | null | undefined
}) {
  if (acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') return false
  if (state === SubscriptionState.pending) return false
  if (
    state === SubscriptionState.expired ||
    state === SubscriptionState.revoked ||
    state === SubscriptionState.inactive
  ) {
    return false
  }
  return subscriptionState !== 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'
}

function compareGooglePlayLineItemsByExpiryDesc(
  left: GooglePlaySubscriptionLineItem,
  right: GooglePlaySubscriptionLineItem,
) {
  return (toDateFromIso(right.expiryTime)?.getTime() ?? 0) - (toDateFromIso(left.expiryTime)?.getTime() ?? 0)
}

function isActiveSubscriptionState(state: SubscriptionState, expiresAt: Date | null) {
  if (state !== SubscriptionState.active && state !== SubscriptionState.billing_grace_period) return false
  return !expiresAt || expiresAt.getTime() > Date.now()
}

function shouldUpdateEntitlement({
  existing,
  incoming,
}: {
  existing: EntitlementRecord & {
    webOrderLineItemId?: string | null
  }
  incoming: {
    platform: 'android' | 'ios'
    transactionId: string | null
    originalTransactionId: string | null
    purchaseDate: Date | null
    expiresAt: Date | null
    revokedAt: Date | null
    state: SubscriptionState
  }
}) {
  if (!existing.transactionId) return true
  if (incoming.transactionId && existing.transactionId === incoming.transactionId) return true

  const sameOriginalTransaction =
    Boolean(incoming.originalTransactionId) &&
    existing.originalTransactionId === incoming.originalTransactionId

  if ((incoming.revokedAt || incoming.state === SubscriptionState.revoked) && sameOriginalTransaction) {
    return true
  }

  const existingActive = isActiveSubscriptionState(existing.state, existing.expiresAt)
  const incomingActive = isActiveSubscriptionState(incoming.state, incoming.expiresAt)

  if (!incomingActive && existingActive && !sameOriginalTransaction) return false
  if (incomingActive && !existingActive) return true

  const existingFreshness = existing.expiresAt?.getTime() ?? 0
  const incomingFreshness = incoming.expiresAt?.getTime() ?? incoming.purchaseDate?.getTime() ?? 0

  if (incomingFreshness > existingFreshness) return true
  if (incomingFreshness < existingFreshness) return false

  return incomingActive || sameOriginalTransaction || existing.platform === incoming.platform
}

async function recordReconcileAttempt(
  state: ReconcileAttemptState,
  attempt: () => Promise<SubscriptionSnapshot | null>,
) {
  try {
    state.latestSnapshot = (await attempt()) ?? state.latestSnapshot
  } catch (error) {
    state.firstError ??= error
  }
}

async function resolveWebhookUserId({
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
  status?: Status | number | null,
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
  if (!expiresAt || expiresAt.getTime() > Date.now()) return SubscriptionState.active

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

export function toSubscriptionSnapshot(entitlement: EntitlementRecord): SubscriptionSnapshot {
  const state = effectiveSubscriptionState(entitlement)
  const isActive =
    state === SubscriptionState.active ||
    state === SubscriptionState.billing_grace_period

  return {
    entitlement: 'premium',
    isActive,
    state,
    platform: entitlement.platform,
    productId: entitlement.productId,
    originalTransactionId: entitlement.originalTransactionId,
    transactionId: entitlement.transactionId,
    expiresAt: entitlement.expiresAt?.toISOString() ?? null,
    willAutoRenew: entitlement.willAutoRenew,
    updatedAt: entitlement.updatedAt.toISOString(),
  }
}

function effectiveSubscriptionState(entitlement: EntitlementRecord): SubscriptionState {
  if (
    (entitlement.state === SubscriptionState.active ||
      entitlement.state === SubscriptionState.billing_grace_period) &&
    entitlement.expiresAt &&
    entitlement.expiresAt.getTime() <= Date.now()
  ) {
    return SubscriptionState.expired
  }

  return entitlement.state
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

function isFutureDate(value: Date | null) {
  return Boolean(value && value.getTime() > Date.now())
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
    throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'Google Play purchase is missing required identifiers')
  }
  return normalized
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
