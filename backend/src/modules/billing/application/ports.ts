import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

import type {
  VerifiedAppStoreTransaction,
  VerifiedAppStoreRenewal,
  GooglePlaySubscriptionPurchase,
  AppStoreSubscriptionStatus,
  OfferCodeRedemptionProof,
} from '../domain/provider-values'

export type AppStoreStatusItem = {
  status?: AppStoreSubscriptionStatus
  signedRenewalInfo?: string
  signedTransactionInfo?: string
}

export type AppStoreNotificationDetails = {
  signedDate: number
  environment: string | null
  notificationType: string | null
  notificationUuid: string | null
  signedRenewalInfo?: string
  signedTransactionInfo?: string
  status?: AppStoreSubscriptionStatus
  subtype: string | null
}

export type GooglePlayPurchaseReference = {
  basePlanId?: string | null
  productId: string
  purchaseToken: string
}

export type StoredGooglePlayPurchaseReference = GooglePlayPurchaseReference & {
  id: string
  userId: string
}

export type BillingRevision = { id: string; revision: number } | null

export type GooglePlayVerificationRevision = {
  purchase: BillingRevision
  entitlement: BillingRevision
}

export type { OfferCodeRedemptionProof } from '../domain/provider-values'

export type AppStoreWebhookClaim =
  | { status: 'claimed'; claimToken: string; id: string }
  | { status: 'in_progress' }
  | { status: 'processed' }

export type AppStoreProvider = {
  getSubscriptionStatuses(input: {
    transactionId: string
  }): Promise<AppStoreStatusItem[]>
  verifyNotification(signedPayload: string): Promise<AppStoreNotificationDetails>
  verifyRenewalInfo(signedRenewalInfo: string): Promise<VerifiedAppStoreRenewal>
  verifyTransaction(signedTransactionInfo: string): Promise<VerifiedAppStoreTransaction>
}

export type GooglePlayProvider = {
  acknowledgePurchase(input: {
    productId: string
    purchaseToken: string
    signal?: AbortSignal
  }): Promise<void>
  verifyPurchase(purchaseToken: string, signal?: AbortSignal): Promise<GooglePlaySubscriptionPurchase>
}

export type OfferCodeTokens = {
  create(userId: string): Promise<string>
  verify(token: string): Promise<OfferCodeRedemptionProof>
}

export type BillingRepository = {
  retireUnavailableGooglePlayPurchase(input: {
    purchaseToken: string
    userId: string
    expectedRevision: GooglePlayVerificationRevision
    now: Date
  }): Promise<SubscriptionSnapshot | null>
  findGooglePlayPurchaseForAcknowledgement(purchaseId: string): Promise<{
    id: string
    productId: string
    purchaseToken: string
    acknowledgementState: string | null
    expiresAt: Date | null
  } | null>
  markGooglePlayAcknowledged(purchaseId: string): Promise<void>
  applyAppStoreTransaction(input: {
    notificationSignedDate?: number
    allowTokenlessFirstClaim?: boolean
    offerCodeRedemption?: OfferCodeRedemptionProof | null
    signedRenewalInfo?: string | null
    signedTransactionInfo: string
    status?: AppStoreSubscriptionStatus | null
    userId: string
    verifiedRenewal?: VerifiedAppStoreRenewal | null
    verifiedTransaction: VerifiedAppStoreTransaction
  }): Promise<SubscriptionSnapshot>
  applyGooglePlayPurchase(input: {
    expectedRevision: GooglePlayVerificationRevision
    purchase: GooglePlayPurchaseReference
    refreshStoredPurchase?: boolean
    userId: string
    verifiedPurchase: GooglePlaySubscriptionPurchase
  }): Promise<{ subscription: SubscriptionSnapshot; acknowledgePurchaseId: string | null }>
  getGooglePlayVerificationRevision(input: {
    purchaseToken: string
    userId: string
  }): Promise<GooglePlayVerificationRevision>
  claimAppStoreWebhook(signedPayload: string): Promise<AppStoreWebhookClaim>
  claimVerifiedAppStoreWebhook(input: {
    claimToken: string
    details: AppStoreNotificationDetails
    id: string
    verifiedTransaction?: VerifiedAppStoreTransaction | null
  }): Promise<AppStoreWebhookClaim>
  findGooglePlayPurchases(userId: string): Promise<GooglePlayPurchaseReference[]>
  findGooglePlayPurchasesDue(input: {
    before: Date
    limit: number
  }): Promise<StoredGooglePlayPurchaseReference[]>
  observeGooglePlayReconcileBacklog(input: {
    before: Date
  }): Promise<{
    dueCount: number
    oldestDueAt: Date | null
  }>
  claimGooglePlayReconcileAttempt(input: {
    attemptedAt: Date
    before: Date
    purchaseId: string
  }): Promise<boolean>
  getSubscription(userId: string): Promise<SubscriptionSnapshot>
  markAppStoreWebhookProcessed(claim: { claimToken: string; id: string }): Promise<void>
  releaseAppStoreWebhookClaim(claim: { claimToken: string; id: string }): Promise<void>
  resolveAppStoreWebhookUserId(
    verifiedTransaction: VerifiedAppStoreTransaction,
  ): Promise<string | null>
}

export type BillingServiceDependencies = {
  billingEnabled: boolean
  appStore: AppStoreProvider
  googlePlay: GooglePlayProvider
  offerCodeTokens: OfferCodeTokens
  repository: BillingRepository
}
