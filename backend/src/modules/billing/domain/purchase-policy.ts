import { BillingFailure } from './errors'
import type { SubscriptionStateValue } from './subscription'
import type {
  AppStoreTransaction,
  AppStoreRenewal,
  AppStoreSubscriptionStatus,
  GooglePlaySubscriptionPurchase,
  GooglePlaySubscriptionLineItem,
} from './provider-values'
import type { OfferCodeRedemptionProof } from './provider-values'

export type BillingPolicy = {
  APPLE_IAP_ENVIRONMENT: 'Sandbox' | 'Production'
  APPLE_IAP_PRODUCT_IDS: string[]
  GOOGLE_PLAY_PRODUCT_IDS: string[]
  GOOGLE_PLAY_BASE_PLAN_IDS: string[]
  NODE_ENV?: string
}

export function requireAppStoreSignedDate(value: number | null | undefined): number {
  if (value == null || !Number.isSafeInteger(value) || value <= 0 || Number.isNaN(new Date(value).getTime())) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'App Store signed data is missing a valid signing date')
  }
  return value
}

function policyEnvironment(value: string | null | undefined) {
  return value?.toLowerCase() === 'production' ? 'production' : 'sandbox'
}

export function assertAppStoreEnvironmentMatchesConfiguration({
  configuredEnvironment,
  renewalEnvironment,
  transactionEnvironment,
  verifiedEnvironment,
}: {
  configuredEnvironment: BillingPolicy['APPLE_IAP_ENVIRONMENT']
  renewalEnvironment?: string | null
  transactionEnvironment?: string | null
  verifiedEnvironment: string
}) {
  const configured = policyEnvironment(configuredEnvironment)
  const observed = [verifiedEnvironment, transactionEnvironment, renewalEnvironment]
    .filter((value): value is string => value != null)
    .map(policyEnvironment)

  if (observed.some((environment) => environment !== configured)) {
    throw new BillingFailure(
      'IAP_INVALID_TRANSACTION',
      'App Store transaction environment does not match the configured environment',
    )
  }
}

export function assertGooglePlayExternalIdentityConsistent({
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

export function googlePlayOwnershipMismatchError() {
  return new BillingFailure(
    'IAP_OWNERSHIP_MISMATCH',
    'This Google Play purchase is linked to another account',
  )
}

export function isValidOfferCodeTokenlessFirstClaim({
  offerCodeRedemption,
  transaction,
  userId,
}: {
  offerCodeRedemption?: OfferCodeRedemptionProof | null
  transaction: AppStoreTransaction
  userId: string
}) {
  if (!offerCodeRedemption) return false
  if (offerCodeRedemption.userId !== userId) return false
  if (transaction.appAccountToken) return false
  if (!transaction.isOfferCode) return false
  if (!transaction.offerIdentifier?.trim()) return false

  const purchaseDate = toDate(transaction.purchaseDate)
  if (!purchaseDate) return false

  return purchaseDate.getTime() >= offerCodeRedemption.issuedAt.getTime() - 5 * 60 * 1000
}

export function ownershipMismatchError() {
  return new BillingFailure(
    'IAP_OWNERSHIP_MISMATCH',
    'This App Store purchase is linked to another account',
  )
}

export function assertSubscriptionHasExpiration(
  transaction: AppStoreTransaction,
  renewal: AppStoreRenewal | null,
  expiresAt: Date | null,
  status: AppStoreSubscriptionStatus | null | undefined,
) {
  if (expiresAt || transaction.revocationDate || status === 'revoked') return

  throw new BillingFailure(
    'IAP_INVALID_TRANSACTION',
    'App Store subscription transaction is missing an expiration date',
    renewal ? undefined : { transactionId: transaction.transactionId },
  )
}

export function assertGooglePlayProductConfigured(env: BillingPolicy, productId: string) {
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

export function selectGooglePlayLineItem({
  basePlanId,
  env,
  productId,
  purchase,
  refreshStoredPurchase = false,
}: {
  refreshStoredPurchase?: boolean
  basePlanId: string | null
  env: BillingPolicy
  productId: string
  purchase: GooglePlaySubscriptionPurchase
}) {
  const lineItems = purchase.lineItems ?? []
  const currentItems = refreshStoredPurchase
    ? lineItems.filter((item) =>
        env.GOOGLE_PLAY_PRODUCT_IDS.includes(normalizeString(item.productId) ?? '') &&
        env.GOOGLE_PLAY_BASE_PLAN_IDS.includes(normalizeString(item.offerDetails?.basePlanId) ?? '') &&
        toDateFromIso(item.expiryTime),
      )
    : []
  const matchingProductItems = currentItems.length
    ? currentItems
    : lineItems.filter((item) => normalizeString(item.productId) === productId)
  const matchingItems = basePlanId && !currentItems.length
    ? matchingProductItems.filter((item) => normalizeString(item.offerDetails?.basePlanId) === basePlanId)
    : matchingProductItems
  const selected = matchingItems.sort(compareGooglePlayLineItemsByExpiryDesc)[0] ?? null

  if (!selected) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Google Play purchase does not include the configured product')
  }

  const actualBasePlanId = normalizeString(selected.offerDetails?.basePlanId)
  if (!refreshStoredPurchase && basePlanId && actualBasePlanId !== basePlanId) {
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

export function assertGooglePlaySubscriptionHasExpiration({
  expiresAt,
  state,
  subscriptionState,
}: {
  expiresAt: Date | null
  state: SubscriptionStateValue
  subscriptionState: string | null | undefined
}) {
  if (
    expiresAt ||
    state === 'pending' ||
    subscriptionState === 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'
  ) {
    return
  }

  throw new BillingFailure(
    'IAP_INVALID_TRANSACTION',
    'Google Play subscription purchase is missing an expiration date',
  )
}

export function compareGooglePlayLineItemsByExpiryDesc(
  left: GooglePlaySubscriptionLineItem,
  right: GooglePlaySubscriptionLineItem,
) {
  return (toDateFromIso(right.expiryTime)?.getTime() ?? 0) - (toDateFromIso(left.expiryTime)?.getTime() ?? 0)
}

export function toDate(value: number | null | undefined) {
  if (!value) return null
  return new Date(value)
}

export function toDateFromIso(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatEnvironment(value: string | null | undefined) {
  if (!value) return null
  return String(value).toLowerCase()
}

export function normalizeString(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function normalizeRequiredString(value: string | null | undefined) {
  const normalized = normalizeString(value)
  if (!normalized) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Google Play purchase is missing required identifiers')
  }
  return normalized
}

export function assertAppStoreProduct({
  env,
  originalTransactionId,
  transactionId,
  productId,
  transaction,
  renewal,
  verifiedEnvironment,
}: {
  env: BillingPolicy
  originalTransactionId: string
  transactionId: string
  productId: string
  transaction: AppStoreTransaction
  renewal: AppStoreRenewal | null
  verifiedEnvironment: string
}) {
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

  if (!transaction.isAutoRenewable) {
    throw new BillingFailure(
      'IAP_INVALID_TRANSACTION',
      'App Store transaction is not an auto-renewable subscription',
    )
  }

  assertAppStoreEnvironmentMatchesConfiguration({
    configuredEnvironment: env.APPLE_IAP_ENVIRONMENT,
    renewalEnvironment: renewal?.environment,
    transactionEnvironment: transaction.environment,
    verifiedEnvironment,
  })

  if (renewal && (
    renewal.originalTransactionId !== originalTransactionId ||
    renewal.productId !== productId
  )) {
    throw new BillingFailure(
      'IAP_INVALID_TRANSACTION',
      'App Store renewal information does not match the transaction',
    )
  }
}

export function assertAppStoreOwnership(input: {
  userId: string; appAccountToken?: string | null; originalTransactionId: string; transactionId: string;
  allowTokenlessFirstClaim?: boolean;
  existingEntitlement: { userId: string } | null;
  existingTransactions: Array<{ userId: string; originalTransactionId: string; transactionId: string }>;
}) {
  const { userId, appAccountToken, originalTransactionId, transactionId, existingEntitlement, existingTransactions } = input
  if (appAccountToken && appAccountToken !== userId) throw ownershipMismatchError()
  const identityMismatch = existingTransactions.some((stored) =>
    stored.transactionId === transactionId &&
    (stored.originalTransactionId !== originalTransactionId || stored.userId !== userId))
  const ownerMismatch = existingTransactions.some((stored) =>
    stored.originalTransactionId === originalTransactionId && stored.userId !== userId)
  if (identityMismatch || ownerMismatch) throw ownershipMismatchError()
  if (existingEntitlement && existingEntitlement.userId !== userId) throw ownershipMismatchError()
  if (appAccountToken) return
  if (existingEntitlement?.userId === userId) return
  if (existingTransactions.some((stored) => stored.userId === userId)) return
  if (input.allowTokenlessFirstClaim) return
  throw ownershipMismatchError()
}

export function assertGooglePlayOwnership(input: {
  userId: string; externalAccountId: string | null; externalProfileId: string | null;
  existingPurchases: Array<{ userId: string }>;
}) {
  if ((input.externalAccountId && input.externalAccountId !== input.userId) ||
    (input.externalProfileId && input.externalProfileId !== input.userId)) {
    throw googlePlayOwnershipMismatchError()
  }
  if (input.existingPurchases.length) {
    if (input.existingPurchases.every((purchase) => purchase.userId === input.userId)) return
    throw googlePlayOwnershipMismatchError()
  }
  if (input.externalAccountId === input.userId || input.externalProfileId === input.userId) return
  throw googlePlayOwnershipMismatchError()
}

export function assertGooglePlayProductionPurchase(env: BillingPolicy, isTestPurchase: boolean) {
  if (env.NODE_ENV === 'production' && isTestPurchase) {
    throw new BillingFailure('IAP_INVALID_TRANSACTION', 'Google Play test purchases are not accepted in production')
  }
}
