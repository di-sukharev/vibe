import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

export type VerifiedProviderValue = object

export type AppStoreStatusItem = {
  status?: number
  signedRenewalInfo?: string
  signedTransactionInfo?: string
}

export type AppStoreNotificationDetails = {
  environment: string | null
  notificationType: string | null
  notificationUuid: string | null
  signedRenewalInfo?: string
  signedTransactionInfo?: string
  status?: number
  subtype: string | null
}

export type GooglePlayPurchaseReference = {
  basePlanId?: string | null
  productId: string
  purchaseToken: string
}

export type OfferCodeRedemptionProof = {
  issuedAt: Date
  userId: string
}

export type AppStoreProvider = {
  describeNotification(value: VerifiedProviderValue): AppStoreNotificationDetails
  getSubscriptionStatuses(input: {
    environment?: string | null
    transactionId: string
  }): Promise<AppStoreStatusItem[]>
  verifyNotification(signedPayload: string): Promise<VerifiedProviderValue>
  verifyRenewalInfo(signedRenewalInfo: string): Promise<VerifiedProviderValue>
  verifyTransaction(signedTransactionInfo: string): Promise<VerifiedProviderValue>
}

export type GooglePlayProvider = {
  verifyPurchase(purchaseToken: string): Promise<VerifiedProviderValue>
}

export type OfferCodeTokens = {
  create(userId: string): Promise<string>
  verify(token: string): Promise<OfferCodeRedemptionProof>
}

export type BillingRepository = {
  applyAppStoreTransaction(input: {
    allowTokenlessFirstClaim?: boolean
    offerCodeRedemption?: OfferCodeRedemptionProof | null
    signedRenewalInfo?: string | null
    signedTransactionInfo: string
    status?: number | null
    userId: string
    verifiedRenewal?: VerifiedProviderValue | null
    verifiedTransaction: VerifiedProviderValue
  }): Promise<SubscriptionSnapshot>
  applyGooglePlayPurchase(input: {
    purchase: GooglePlayPurchaseReference
    userId: string
    verifiedPurchase: VerifiedProviderValue
  }): Promise<SubscriptionSnapshot>
  claimAppStoreWebhook(signedPayload: string): Promise<{ id: string } | null>
  findGooglePlayPurchases(userId: string): Promise<GooglePlayPurchaseReference[]>
  getAppStoreEnvironment(input: {
    originalTransactionId: string
    userId: string
  }): Promise<string>
  getSubscription(userId: string): Promise<SubscriptionSnapshot>
  markAppStoreWebhookProcessed(id: string): Promise<void>
  recordAppStoreWebhook(input: {
    details: AppStoreNotificationDetails
    id: string
    verifiedTransaction?: VerifiedProviderValue | null
  }): Promise<void>
  releaseAppStoreWebhookClaim(id: string): Promise<void>
  resolveAppStoreWebhookUserId(
    verifiedTransaction: VerifiedProviderValue,
  ): Promise<string | null>
}

export type BillingServiceDependencies = {
  appStore: AppStoreProvider
  googlePlay: GooglePlayProvider
  offerCodeTokens: OfferCodeTokens
  repository: BillingRepository
}
