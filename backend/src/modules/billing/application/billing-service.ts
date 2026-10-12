import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

import type {
  AppStoreStatusItem,
  BillingServiceDependencies,
  GooglePlayPurchaseReference,
} from './ports'
import { BillingFailure } from '../domain/errors'
import type { GooglePlaySubscriptionPurchase } from '../domain/provider-values'
import {
  googlePlayTokenRetentionAfterExpiryMs,
  resolveGooglePlaySubscriptionState,
  shouldAcknowledgeGooglePlayPurchase,
} from '../domain/subscription'
import { toDateFromIso } from '../domain/purchase-policy'

type ReconcileAttemptState = {
  firstError: unknown
  latestSnapshot: SubscriptionSnapshot | null
}

const reconciliationBudgetMs = 50_000
const minimumAppStoreReconcileAttemptBudgetMs = 16_000
const minimumGooglePlayReconcileAttemptBudgetMs = 31_000

export class BillingService {
  constructor(
    private readonly dependencies: BillingServiceDependencies,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    const deadline = this.now().getTime() + reconciliationBudgetMs

    for (const signedTransactionInfo of input.signedTransactions ?? []) {
      await recordAttempt(state, () =>
        this.ingestAppStore({
          signedTransactionInfo,
          userId: input.userId,
        }),
      )
    }

    for (const originalTransactionId of input.originalTransactionIds ?? []) {
      if (deadline - this.now().getTime() < minimumAppStoreReconcileAttemptBudgetMs) break
      await recordAttempt(state, async () => {
        const statusItems = await this.dependencies.appStore.getSubscriptionStatuses({
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

  async acknowledgeGooglePlayPurchase(
    purchaseId: string,
    signal?: AbortSignal,
    verifiedPurchase?: GooglePlaySubscriptionPurchase,
  ) {
    if (!this.dependencies.billingEnabled) {
      throw new BillingFailure(
        'IAP_NOT_CONFIGURED',
        'Billing is disabled; acknowledgement will retry',
      )
    }
    signal?.throwIfAborted()

    const stored = await this.dependencies.repository.findGooglePlayPurchaseForAcknowledgement(
      purchaseId,
    )
    if (!stored || stored.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') return

    let verified: GooglePlaySubscriptionPurchase
    try {
      verified = verifiedPurchase ?? await this.dependencies.googlePlay.verifyPurchase(
        stored.purchaseToken,
        signal,
      )
    } catch (error) {
      if (
        isRetiredGooglePlayToken(error) &&
        stored.expiresAt &&
        stored.expiresAt.getTime() <= this.now().getTime() - googlePlayTokenRetentionAfterExpiryMs
      ) {
        return
      }
      throw error
    }

    if (verified.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') {
      const item = verified.lineItems?.find((line) => line.productId === stored.productId)
      const state = resolveGooglePlaySubscriptionState(
        verified.subscriptionState,
        toDateFromIso(item?.expiryTime),
        this.now(),
      )
      if (!shouldAcknowledgeGooglePlayPurchase({
        acknowledgementState: verified.acknowledgementState ?? null,
        state,
        subscriptionState: verified.subscriptionState,
      })) {
        return
      }
      await this.dependencies.googlePlay.acknowledgePurchase({
        productId: stored.productId,
        purchaseToken: stored.purchaseToken,
        signal,
      })
    }
    await this.dependencies.repository.markGooglePlayAcknowledged(stored.id)
  }

  async ingestGooglePlay(input: GooglePlayPurchaseReference & {
    userId: string
    refreshStoredPurchase?: boolean
  }) {
    const expectedRevision = await this.dependencies.repository.getGooglePlayVerificationRevision(input)
    let verifiedPurchase: GooglePlaySubscriptionPurchase
    try {
      verifiedPurchase = await this.dependencies.googlePlay.verifyPurchase(input.purchaseToken)
    } catch (error) {
      if (isRetiredGooglePlayToken(error)) {
        const retired = await this.dependencies.repository.retireUnavailableGooglePlayPurchase({
          purchaseToken: input.purchaseToken,
          userId: input.userId,
          expectedRevision,
          now: this.now(),
        })
        if (retired) return retired
      }
      throw error
    }
    const applied = await this.dependencies.repository.applyGooglePlayPurchase({
      expectedRevision,
      purchase: input,
      refreshStoredPurchase: input.refreshStoredPurchase,
      userId: input.userId,
      verifiedPurchase,
    })
    if (applied.acknowledgePurchaseId) {
      await this.acknowledgeGooglePlayPurchase(
        applied.acknowledgePurchaseId,
        undefined,
        verifiedPurchase,
      )
    }
    return applied.subscription
  }

  async reconcileGooglePlay(input: {
    purchases?: GooglePlayPurchaseReference[]
    userId: string
  }) {
    const state = emptyReconcileState()
    const deadline = this.now().getTime() + reconciliationBudgetMs
    const hasAttemptBudget = () =>
      deadline - this.now().getTime() >= minimumGooglePlayReconcileAttemptBudgetMs

    for (const purchase of input.purchases ?? []) {
      if (!hasAttemptBudget()) break
      await recordAttempt(state, () =>
        this.ingestGooglePlay({ ...purchase, userId: input.userId }),
      )
    }

    if (!state.latestSnapshot && !state.firstError) {
      for (const purchase of await this.dependencies.repository.findGooglePlayPurchases(input.userId)) {
        if (!hasAttemptBudget()) break
        await recordAttempt(state, () =>
          this.ingestGooglePlay({
            ...purchase,
            userId: input.userId,
            refreshStoredPurchase: true,
          }),
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
        await this.ingestGooglePlay({ ...reference, refreshStoredPurchase: true })
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
      const details = await this.dependencies.appStore.verifyNotification(signedPayload)
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
        notificationSignedDate: details.signedDate,
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

function isRetiredGooglePlayToken(error: unknown) {
  if (!(error instanceof BillingFailure) || error.code !== 'IAP_INVALID_TRANSACTION') return false
  const status = (error.details as { providerStatus?: number } | undefined)?.providerStatus
  return status === 410
}
