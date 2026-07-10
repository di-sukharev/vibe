import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

export type BillingOperations = {
  getSubscription(userId: string): Promise<SubscriptionSnapshot>
  ingestAppStore(input: {
    userId: string
    signedTransactionInfo: string
    signedRenewalInfo?: string | null
    offerCodeRedemptionToken?: string | null
  }): Promise<SubscriptionSnapshot>
  reconcileAppStore(input: {
    userId: string
    signedTransactions?: string[]
    originalTransactionIds?: string[]
  }): Promise<SubscriptionSnapshot>
  ingestGooglePlay(input: {
    basePlanId?: string | null
    productId: string
    purchaseToken: string
    userId: string
  }): Promise<SubscriptionSnapshot>
  reconcileGooglePlay(input: {
    purchases?: Array<{
      basePlanId?: string | null
      productId: string
      purchaseToken: string
    }>
    userId: string
  }): Promise<SubscriptionSnapshot>
  createOfferCodeRedemption(userId: string): Promise<string>
  processAppStoreWebhook(
    signedPayload: string,
  ): Promise<{ duplicate: boolean; subscription: SubscriptionSnapshot | null }>
}
