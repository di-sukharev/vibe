export type AppStoreSubscriptionStatus = 'active' | 'expired' | 'billing_retry' | 'billing_grace_period' | 'revoked'

export type AppStoreTransaction = {
  signedDate: number
  appAccountToken?: string | null
  environment?: string | null
  expiresDate?: number | null
  offerIdentifier?: string | null
  isOfferCode: boolean
  originalTransactionId?: string | null
  productId?: string | null
  purchaseDate?: number | null
  revocationDate?: number | null
  transactionId?: string | null
  isAutoRenewable: boolean
  isUpgraded: boolean
  webOrderLineItemId?: string | null
}

export type AppStoreRenewal = {
  signedDate: number
  willAutoRenew: boolean | null
  environment?: string | null
  gracePeriodExpiresDate?: number | null
  isInBillingRetryPeriod?: boolean | null
  originalTransactionId?: string | null
  productId?: string | null
}

export type VerifiedAppStoreTransaction = { environment: string; payload: AppStoreTransaction }
export type VerifiedAppStoreRenewal = { environment: string; payload: AppStoreRenewal }

export type GooglePlayAcknowledgementState =
  | 'ACKNOWLEDGEMENT_STATE_UNSPECIFIED'
  | 'ACKNOWLEDGEMENT_STATE_PENDING'
  | 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'

export type GooglePlaySubscriptionState =
  | 'SUBSCRIPTION_STATE_UNSPECIFIED'
  | 'SUBSCRIPTION_STATE_PENDING'
  | 'SUBSCRIPTION_STATE_ACTIVE'
  | 'SUBSCRIPTION_STATE_PAUSED'
  | 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
  | 'SUBSCRIPTION_STATE_ON_HOLD'
  | 'SUBSCRIPTION_STATE_CANCELED'
  | 'SUBSCRIPTION_STATE_EXPIRED'
  | 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'

export type GooglePlaySubscriptionLineItem = {
  latestSuccessfulOrderId?: string | null
  autoRenewingPlan?: {
    autoRenewEnabled?: boolean | null
  } | null
  expiryTime?: string | null
  offerDetails?: {
    basePlanId?: string | null
    offerId?: string | null
    offerTags?: string[] | null
  } | null
  productId?: string | null
}

export type GooglePlaySubscriptionPurchase = {
  acknowledgementState?: GooglePlayAcknowledgementState | string | null
  externalAccountIdentifiers?: {
    externalAccountId?: string | null
    obfuscatedExternalAccountId?: string | null
    obfuscatedExternalProfileId?: string | null
  } | null
  latestOrderId?: string | null
  lineItems?: GooglePlaySubscriptionLineItem[] | null
  linkedPurchaseToken?: string | null
  regionCode?: string | null
  startTime?: string | null
  subscriptionState?: GooglePlaySubscriptionState | string | null
  testPurchase?: Record<string, never> | null
}

export type OfferCodeRedemptionProof = { issuedAt: Date; userId: string }
