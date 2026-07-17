import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

import type {
  AppStoreStatusItem,
  BillingServiceDependencies,
  GooglePlayPurchaseReference,
} from './ports'
import { BillingFailure } from '../domain/errors'

type ReconcileAttemptState = {
  firstError: unknown
  latestSnapshot: SubscriptionSnapshot | null
}

const minimumGooglePlayReconcileAttemptBudgetMs = 31_000

export class BillingService {
  constructor(private readonly dependencies: BillingServiceDependencies) {}

  getSubscription(userId: string) {
    return this.dependencies.repository.getSubscription(userId)
  }

  async ingestAppStore(input: {
    offerCodeRedemptionToken?: string | null
    signedRenewalInfo?: string | null
    signedTransactionInfo: string
    userId: string
  }) {
    const verifiedTransaction = await this.dependencies.appStore.verifyTransaction(
      input.signedTransactionInfo,
    )
    const verifiedRenewal = input.signedRenewalInfo
      ? await this.dependencies.appStore.verifyRenewalInfo(input.signedRenewalInfo)
      : null
    const offerCodeRedemption = input.offerCodeRedemptionToken
      ? await this.dependencies.offerCodeTokens.verify(input.offerCodeRedemptionToken)
      : null

    return this.dependencies.repository.applyAppStoreTransaction({
      offerCodeRedemption,
      signedRenewalInfo: input.signedRenewalInfo,
      signedTransactionInfo: input.signedTransactionInfo,
      userId: input.userId,
      verifiedRenewal,
      verifiedTransaction,
    })
  }

  async reconcileAppStore(input: {
    originalTransactionIds?: string[]
    signedTransactions?: string[]
    userId: string
  }) {
    const state = emptyReconcileState()

    for (const signedTransactionInfo of input.signedTransactions ?? []) {
      await recordAttempt(state, () =>
        this.ingestAppStore({
          signedTransactionInfo,
          userId: input.userId,
        }),
      )
    }

    for (const originalTransactionId of input.originalTransactionIds ?? []) {
      await recordAttempt(state, async () => {
        const environment = await this.dependencies.repository.getAppStoreEnvironment({
          originalTransactionId,
          userId: input.userId,
        })
        const statusItems = await this.dependencies.appStore.getSubscriptionStatuses({
          environment,
          transactionId: originalTransactionId,
        })
        return this.applyAppStoreStatusItems(input.userId, statusItems)
      })
    }

    return resolveReconcileResult(
      state,
      () => this.dependencies.repository.getSubscription(input.userId),
    )
  }

  async ingestGooglePlay(input: GooglePlayPurchaseReference & { userId: string }) {
    const verifiedPurchase = await this.dependencies.googlePlay.verifyPurchase(input.purchaseToken)
    return this.dependencies.repository.applyGooglePlayPurchase({
      purchase: input,
      userId: input.userId,
      verifiedPurchase,
    })
  }

  async reconcileGooglePlay(input: {
    purchases?: GooglePlayPurchaseReference[]
    userId: string
  }) {
    const state = emptyReconcileState()

    for (const purchase of input.purchases ?? []) {
      await recordAttempt(state, () =>
        this.ingestGooglePlay({ ...purchase, userId: input.userId }),
      )
    }

    if (!state.latestSnapshot && !state.firstError) {
      for (const purchase of await this.dependencies.repository.findGooglePlayPurchases(input.userId)) {
        await recordAttempt(state, () =>
          this.ingestGooglePlay({ ...purchase, userId: input.userId }),
        )
      }
    }

    return resolveReconcileResult(
      state,
      () => this.dependencies.repository.getSubscription(input.userId),
    )
  }

  async reconcileGooglePlayBatch(input: {
    before: Date
    deadline: Date
    limit: number
    now?: () => Date
  }) {
    const [backlog, purchases] = await Promise.all([
      this.dependencies.repository.observeGooglePlayReconcileBacklog({
        before: input.before,
      }),
      this.dependencies.repository.findGooglePlayPurchasesDue({
        before: input.before,
        limit: input.limit,
      }),
    ])
    const now = input.now ?? (() => new Date())
    let attempted = 0
    let failed = 0
    let succeeded = 0

    for (const purchase of purchases) {
      const attemptedAt = now()
      if (
        input.deadline.getTime() - attemptedAt.getTime() <
        minimumGooglePlayReconcileAttemptBudgetMs
      ) {
        break
      }
      const claimed = await this.dependencies.repository.claimGooglePlayReconcileAttempt({
        attemptedAt,
        before: input.before,
        purchaseId: purchase.id,
      })
      if (!claimed) continue
      attempted += 1

      try {
        const { id: _purchaseId, ...reference } = purchase
        await this.ingestGooglePlay(reference)
        succeeded += 1
      } catch {
        failed += 1
      }
    }

    return {
      attempted,
      backlogDue: backlog.dueCount,
      backlogOldestDueAt: backlog.oldestDueAt,
      deferred: purchases.length - attempted,
      failed,
      selected: purchases.length,
      succeeded,
    }
  }

  createOfferCodeRedemption(userId: string) {
    return this.dependencies.offerCodeTokens.create(userId)
  }

  async processAppStoreWebhook(signedPayload: string) {
    const webhook = await this.dependencies.repository.claimAppStoreWebhook(signedPayload)
    if (webhook.status === 'processed') return { duplicate: true, subscription: null }
    if (webhook.status === 'in_progress') {
      throw new BillingFailure(
        'IAP_WEBHOOK_IN_PROGRESS',
        'App Store webhook is already being processed; retry later',
      )
    }

    let claim = { claimToken: webhook.claimToken, id: webhook.id }

    try {
      const verifiedNotification = await this.dependencies.appStore.verifyNotification(signedPayload)
      const details = this.dependencies.appStore.describeNotification(verifiedNotification)
      const verifiedTransaction = details.signedTransactionInfo
        ? await this.dependencies.appStore.verifyTransaction(details.signedTransactionInfo)
        : null
      const verifiedRenewal = details.signedRenewalInfo
        ? await this.dependencies.appStore.verifyRenewalInfo(details.signedRenewalInfo)
        : null

      const verifiedWebhook = await this.dependencies.repository.claimVerifiedAppStoreWebhook({
        claimToken: claim.claimToken,
        details,
        id: claim.id,
        verifiedTransaction,
      })
      if (verifiedWebhook.status === 'processed') {
        return { duplicate: true, subscription: null }
      }
      if (verifiedWebhook.status === 'in_progress') {
        throw new BillingFailure(
          'IAP_WEBHOOK_IN_PROGRESS',
          'App Store webhook is already being processed; retry later',
        )
      }
      claim = {
        claimToken: verifiedWebhook.claimToken,
        id: verifiedWebhook.id,
      }

      if (!details.signedTransactionInfo || !verifiedTransaction) {
        await this.dependencies.repository.markAppStoreWebhookProcessed(claim)
        return { duplicate: false, subscription: null }
      }

      const userId = await this.dependencies.repository.resolveAppStoreWebhookUserId(
        verifiedTransaction,
      )
      if (!userId) {
        await this.dependencies.repository.markAppStoreWebhookProcessed(claim)
        return { duplicate: false, subscription: null }
      }

      const subscription = await this.dependencies.repository.applyAppStoreTransaction({
        signedRenewalInfo: details.signedRenewalInfo,
        signedTransactionInfo: details.signedTransactionInfo,
        status: details.status,
        userId,
        verifiedRenewal,
        verifiedTransaction,
      })
      await this.dependencies.repository.markAppStoreWebhookProcessed(claim)
      return { duplicate: false, subscription }
    } catch (error) {
      await this.dependencies.repository.releaseAppStoreWebhookClaim(claim)
      throw error
    }
  }

  private async applyAppStoreStatusItems(userId: string, items: AppStoreStatusItem[]) {
    const state = emptyReconcileState()

    for (const item of items) {
      if (!item.signedTransactionInfo) continue
      await recordAttempt(state, async () => {
        const verifiedTransaction = await this.dependencies.appStore.verifyTransaction(
          item.signedTransactionInfo!,
        )
        const verifiedRenewal = item.signedRenewalInfo
          ? await this.dependencies.appStore.verifyRenewalInfo(item.signedRenewalInfo)
          : null
        return this.dependencies.repository.applyAppStoreTransaction({
          signedRenewalInfo: item.signedRenewalInfo,
          signedTransactionInfo: item.signedTransactionInfo!,
          status: item.status,
          userId,
          verifiedRenewal,
          verifiedTransaction,
        })
      })
    }

    if (state.latestSnapshot) return state.latestSnapshot
    if (state.firstError) throw state.firstError
    return null
  }
}

function emptyReconcileState(): ReconcileAttemptState {
  return { firstError: null, latestSnapshot: null }
}

async function recordAttempt(
  state: ReconcileAttemptState,
  attempt: () => Promise<SubscriptionSnapshot | null>,
) {
  try {
    state.latestSnapshot = (await attempt()) ?? state.latestSnapshot
  } catch (error) {
    state.firstError ??= error
  }
}

async function resolveReconcileResult(
  state: ReconcileAttemptState,
  fallback: () => Promise<SubscriptionSnapshot>,
) {
  if (state.latestSnapshot) return state.latestSnapshot
  if (state.firstError) throw state.firstError
  return fallback()
}
