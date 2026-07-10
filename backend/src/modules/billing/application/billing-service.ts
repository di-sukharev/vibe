import type { BillingOperations } from './ports'

export class BillingService {
  constructor(private readonly operations: BillingOperations) {}

  getSubscription(userId: string) {
    return this.operations.getSubscription(userId)
  }

  ingestAppStore(input: Parameters<BillingOperations['ingestAppStore']>[0]) {
    return this.operations.ingestAppStore(input)
  }

  reconcileAppStore(input: Parameters<BillingOperations['reconcileAppStore']>[0]) {
    return this.operations.reconcileAppStore(input)
  }

  ingestGooglePlay(input: Parameters<BillingOperations['ingestGooglePlay']>[0]) {
    return this.operations.ingestGooglePlay(input)
  }

  reconcileGooglePlay(input: Parameters<BillingOperations['reconcileGooglePlay']>[0]) {
    return this.operations.reconcileGooglePlay(input)
  }

  createOfferCodeRedemption(userId: string) {
    return this.operations.createOfferCodeRedemption(userId)
  }

  processAppStoreWebhook(signedPayload: string) {
    return this.operations.processAppStoreWebhook(signedPayload)
  }
}
