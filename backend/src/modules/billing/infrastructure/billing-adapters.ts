import { AutoRenewStatus, OfferType, Status, Type } from '@apple/app-store-server-library'
import type { AppStoreSubscriptionStatus } from '../domain/provider-values'
import { requireAppStoreSignedDate } from '../domain/purchase-policy'

import type { AppEnv } from '../../../env'
import type { DbClient } from '../../../db'
import { SubscriptionState } from '../../../generated/prisma/enums'
import type { BillingServiceDependencies } from '../application/ports'
import type { AppStoreSubscriptionVerifier } from './apple-verifier'
import {
  applyVerifiedAppStoreTransaction,
  applyVerifiedGooglePlayPurchase,
  claimAppStoreWebhook,
  claimVerifiedAppStoreWebhook,
  getSubscriptionSnapshot,
  getGooglePlayVerificationRevision,
  retireUnavailableGooglePlayPurchase,
  markAppStoreWebhookProcessed,
  releaseFailedAppStoreWebhookClaim,
  resolveWebhookUserId,
  webhookClaimLostError,
} from './billing-operations'
import type {
  GooglePlaySubscriptionVerifier,
} from './google-play-verifier'
import { signOfferCodeRedemptionToken, verifyOfferCodeRedemptionToken } from './offer-code-tokens'

export function createBillingDependencies(input: {
  appStoreVerifier: AppStoreSubscriptionVerifier
  db: DbClient
  env: AppEnv
  googlePlayVerifier: GooglePlaySubscriptionVerifier
}): BillingServiceDependencies {
  return {
    billingEnabled: input.env.BILLING_ENABLED,
    appStore: {
      verifyNotification: async (signedPayload) => {
        const verified = await input.appStoreVerifier.verifyNotification(signedPayload)
        const notification = verified.payload
        return {
          signedDate: requireAppStoreSignedDate(notification.signedDate),
          environment: formatEnvironment(notification.data?.environment ?? verified.environment),
          notificationType: notification.notificationType
            ? String(notification.notificationType)
            : null,
          notificationUuid: notification.notificationUUID ?? null,
          signedRenewalInfo: notification.data?.signedRenewalInfo,
          signedTransactionInfo: notification.data?.signedTransactionInfo,
          status: subscriptionStatus(notification.data?.status),
          subtype: notification.subtype ? String(notification.subtype) : null,
        }
      },
      getSubscriptionStatuses: async (request) =>
        (await input.appStoreVerifier.getSubscriptionStatuses(request)).map((item) => ({
          ...item,
          status: subscriptionStatus(item.status),
        })),
      verifyRenewalInfo: async (signedRenewalInfo) => {
        const verified = await input.appStoreVerifier.verifyRenewalInfo(signedRenewalInfo)
        const payload = verified.payload
        return {
          environment: String(verified.environment),
          payload: {
            signedDate: requireAppStoreSignedDate(payload.signedDate),
            willAutoRenew: payload.autoRenewStatus == null
              ? null
              : payload.autoRenewStatus === AutoRenewStatus.ON,
            environment: payload.environment,
            gracePeriodExpiresDate: payload.gracePeriodExpiresDate,
            isInBillingRetryPeriod: payload.isInBillingRetryPeriod,
            originalTransactionId: payload.originalTransactionId,
            productId: payload.productId,
          },
        }
      },
      verifyTransaction: async (signedTransactionInfo) => {
        const verified = await input.appStoreVerifier.verifyTransaction(signedTransactionInfo)
        const payload = verified.payload
        return {
          environment: String(verified.environment),
          payload: {
            signedDate: requireAppStoreSignedDate(payload.signedDate),
            appAccountToken: payload.appAccountToken?.toLowerCase(),
            environment: payload.environment,
            expiresDate: payload.expiresDate,
            offerIdentifier: payload.offerIdentifier,
            isOfferCode: payload.offerType === OfferType.OFFER_CODE,
            originalTransactionId: payload.originalTransactionId,
            productId: payload.productId,
            purchaseDate: payload.purchaseDate,
            revocationDate: payload.revocationDate,
            transactionId: payload.transactionId,
            isAutoRenewable: payload.type === Type.AUTO_RENEWABLE_SUBSCRIPTION,
            isUpgraded: payload.isUpgraded === true,
            webOrderLineItemId: payload.webOrderLineItemId,
          },
        }
      },
    },
    googlePlay: {
      acknowledgePurchase: (request) => input.googlePlayVerifier.acknowledgeSubscription(request),
      verifyPurchase: (purchaseToken, signal) =>
        input.googlePlayVerifier.getSubscriptionPurchase({ purchaseToken, signal }),
    },
    offerCodeTokens: {
      create: (userId) => signOfferCodeRedemptionToken(userId, input.env),
      verify: (token) => verifyOfferCodeRedemptionToken(token, input.env),
    },
    repository: {
      retireUnavailableGooglePlayPurchase: (request) =>
        retireUnavailableGooglePlayPurchase(input.db, request),
      findGooglePlayPurchaseForAcknowledgement: (id) =>
        input.db.googlePlaySubscriptionPurchase.findUnique({
          where: { id },
          select: {
            id: true,
            productId: true,
            purchaseToken: true,
            acknowledgementState: true,
            expiresAt: true,
          },
        }),
      markGooglePlayAcknowledged: async (id) => {
        await input.db.googlePlaySubscriptionPurchase.updateMany({
          where: {
            id,
            OR: [
              { acknowledgementState: null },
              { acknowledgementState: { not: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' } },
            ],
          },
          data: {
            acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
            acknowledgedAt: new Date(),
            revision: { increment: 1 },
          },
        })
      },
      applyAppStoreTransaction: (request) =>
        applyVerifiedAppStoreTransaction({
          db: input.db,
          env: input.env,
          offerCodeRedemption: request.offerCodeRedemption,
          input: {
            notificationSignedDate: request.notificationSignedDate,
            allowTokenlessFirstClaim: request.allowTokenlessFirstClaim,
            signedRenewalInfo: request.signedRenewalInfo,
            signedTransactionInfo: request.signedTransactionInfo,
            status: request.status,
            userId: request.userId,
            verifiedRenewal:
              request.verifiedRenewal ??
              null,
            verifiedTransaction:
              request.verifiedTransaction,
          },
        }),
      applyGooglePlayPurchase: (request) =>
        applyVerifiedGooglePlayPurchase({
          expectedRevision: request.expectedRevision,
          db: input.db,
          env: input.env,
          input: request.purchase,
          refreshStoredPurchase: request.refreshStoredPurchase,
          userId: request.userId,
          verifiedPurchase: request.verifiedPurchase,
        }),
      getGooglePlayVerificationRevision: (request) =>
        getGooglePlayVerificationRevision(input.db, request),
      claimAppStoreWebhook: (signedPayload) => claimAppStoreWebhook(input.db, signedPayload),
      findGooglePlayPurchases: async (userId) => {
        const purchases = await input.db.googlePlaySubscriptionPurchase.findMany({
          where: { userId, supersededById: null },
          orderBy: [{ expiresAt: 'desc' }, { updatedAt: 'desc' }],
          take: 5,
          select: { basePlanId: true, productId: true, purchaseToken: true },
        })
        return purchases
      },
      findGooglePlayPurchasesDue: ({ before, limit }) =>
        input.db.googlePlaySubscriptionPurchase.findMany({
          where: {
            supersededById: null,
            state: {
              in: [
                SubscriptionState.pending,
                SubscriptionState.active,
                SubscriptionState.billing_grace_period,
                SubscriptionState.billing_retry,
              ],
            },
            OR: [
              { reconcileAttemptedAt: null },
              { reconcileAttemptedAt: { lt: before } },
            ],
          },
          orderBy: [
            { reconcileAttemptedAt: { sort: 'asc', nulls: 'first' } },
            { id: 'asc' },
          ],
          take: limit,
          select: {
            id: true,
            userId: true,
            basePlanId: true,
            productId: true,
            purchaseToken: true,
          },
        }),
      observeGooglePlayReconcileBacklog: async ({ before }) => {
        const [observation] = await input.db.$queryRaw<
          Array<{ dueCount: bigint; oldestDueAt: Date | null }>
        >`
          SELECT
            COUNT(*)::bigint AS "dueCount",
            MIN(COALESCE(reconcile_attempted_at, created_at)) AS "oldestDueAt"
          FROM google_play_subscription_purchases
          WHERE superseded_by_id IS NULL
            AND state IN ('pending', 'active', 'billing_grace_period', 'billing_retry')
            AND (
              reconcile_attempted_at IS NULL
              OR reconcile_attempted_at < ${before}
            )
        `

        return {
          dueCount: Number(observation?.dueCount ?? 0),
          oldestDueAt: observation?.oldestDueAt ?? null,
        }
      },
      claimGooglePlayReconcileAttempt: async ({ attemptedAt, before, purchaseId }) => {
        const claimed = await input.db.googlePlaySubscriptionPurchase.updateMany({
          where: {
            id: purchaseId,
            supersededById: null,
            state: {
              in: [
                SubscriptionState.pending,
                SubscriptionState.active,
                SubscriptionState.billing_grace_period,
                SubscriptionState.billing_retry,
              ],
            },
            OR: [
              { reconcileAttemptedAt: null },
              { reconcileAttemptedAt: { lt: before } },
            ],
          },
          data: { reconcileAttemptedAt: attemptedAt },
        })
        return claimed.count === 1
      },
      getSubscription: (userId) => getSubscriptionSnapshot(input.db, userId),
      markAppStoreWebhookProcessed: (claim) => markAppStoreWebhookProcessed(input.db, claim),
      claimVerifiedAppStoreWebhook: ({ claimToken, details, id, verifiedTransaction }) =>
        claimVerifiedAppStoreWebhook(input.db, {
          claimToken,
          details,
          id,
          verifiedTransaction: verifiedTransaction
            ? verifiedTransaction
            : null,
        }),
      releaseAppStoreWebhookClaim: (claim) =>
        releaseFailedAppStoreWebhookClaim(input.db, claim),
      resolveAppStoreWebhookUserId: (verifiedTransaction) =>
        resolveWebhookUserId({
          db: input.db,
          transaction: verifiedTransaction.payload,
        }),
    },
  }
}

function formatEnvironment(value: unknown) {
  return value == null ? null : String(value).toLowerCase()
}

function subscriptionStatus(value: number | null | undefined): AppStoreSubscriptionStatus | undefined {
  switch (value) {
    case Status.ACTIVE: return 'active'
    case Status.EXPIRED: return 'expired'
    case Status.BILLING_RETRY: return 'billing_retry'
    case Status.BILLING_GRACE_PERIOD: return 'billing_grace_period'
    case Status.REVOKED: return 'revoked'
  }
}
