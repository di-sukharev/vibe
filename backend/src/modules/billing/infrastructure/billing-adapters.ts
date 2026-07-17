import type {
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library'

import type { DbClient } from '../../../db'
import type { AppEnv } from '../../../env'
import { SubscriptionState } from '../../../generated/prisma/enums'
import type { BillingServiceDependencies } from '../application/ports'
import type { AppStoreVerificationResult, AppStoreSubscriptionVerifier } from './apple-verifier'
import {
  applyVerifiedAppStoreTransaction,
  applyVerifiedGooglePlayPurchase,
  claimAppStoreWebhook,
  claimVerifiedAppStoreWebhook,
  getSubscriptionSnapshot,
  markAppStoreWebhookProcessed,
  releaseFailedAppStoreWebhookClaim,
  resolveStatusLookupEnvironment,
  resolveWebhookUserId,
  webhookClaimLostError,
} from './billing-operations'
import type {
  GooglePlaySubscriptionPurchase,
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
    appStore: {
      describeNotification: (value) => {
        const verified = value as AppStoreVerificationResult<ResponseBodyV2DecodedPayload>
        const notification = verified.payload
        return {
          environment: formatEnvironment(notification.data?.environment ?? verified.environment),
          notificationType: notification.notificationType
            ? String(notification.notificationType)
            : null,
          notificationUuid: notification.notificationUUID ?? null,
          signedRenewalInfo: notification.data?.signedRenewalInfo,
          signedTransactionInfo: notification.data?.signedTransactionInfo,
          status: notification.data?.status,
          subtype: notification.subtype ? String(notification.subtype) : null,
        }
      },
      getSubscriptionStatuses: (request) =>
        input.appStoreVerifier.getSubscriptionStatuses(request),
      verifyNotification: (signedPayload) =>
        input.appStoreVerifier.verifyNotification(signedPayload),
      verifyRenewalInfo: (signedRenewalInfo) =>
        input.appStoreVerifier.verifyRenewalInfo(signedRenewalInfo),
      verifyTransaction: (signedTransactionInfo) =>
        input.appStoreVerifier.verifyTransaction(signedTransactionInfo),
    },
    googlePlay: {
      verifyPurchase: (purchaseToken) =>
        input.googlePlayVerifier.getSubscriptionPurchase({ purchaseToken }),
    },
    offerCodeTokens: {
      create: (userId) => signOfferCodeRedemptionToken(userId, input.env),
      verify: (token) => verifyOfferCodeRedemptionToken(token, input.env),
    },
    repository: {
      applyAppStoreTransaction: (request) =>
        applyVerifiedAppStoreTransaction({
          db: input.db,
          env: input.env,
          offerCodeRedemption: request.offerCodeRedemption,
          input: {
            allowTokenlessFirstClaim: request.allowTokenlessFirstClaim,
            signedRenewalInfo: request.signedRenewalInfo,
            signedTransactionInfo: request.signedTransactionInfo,
            status: request.status,
            userId: request.userId,
            verifiedRenewal:
              (request.verifiedRenewal as AppStoreVerificationResult<JWSRenewalInfoDecodedPayload> | null | undefined) ??
              null,
            verifiedTransaction:
              request.verifiedTransaction as AppStoreVerificationResult<JWSTransactionDecodedPayload>,
          },
        }),
      applyGooglePlayPurchase: (request) =>
        applyVerifiedGooglePlayPurchase({
          db: input.db,
          env: input.env,
          input: request.purchase,
          userId: request.userId,
          verifier: input.googlePlayVerifier,
          verifiedPurchase: request.verifiedPurchase as GooglePlaySubscriptionPurchase,
        }),
      claimAppStoreWebhook: (signedPayload) => claimAppStoreWebhook(input.db, signedPayload),
      findGooglePlayPurchases: async (userId) => {
        const purchases = await input.db.googlePlaySubscriptionPurchase.findMany({
          where: { userId },
          orderBy: [{ expiresAt: 'desc' }, { updatedAt: 'desc' }],
          take: 5,
          select: { basePlanId: true, productId: true, purchaseToken: true },
        })
        return purchases
      },
      findGooglePlayPurchasesDue: ({ before, limit }) =>
        input.db.googlePlaySubscriptionPurchase.findMany({
          where: {
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
          WHERE state IN ('pending', 'active', 'billing_grace_period', 'billing_retry')
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
      getAppStoreEnvironment: async (request) =>
        String(
          await resolveStatusLookupEnvironment({
            db: input.db,
            env: input.env,
            ...request,
          }),
        ),
      getSubscription: (userId) => getSubscriptionSnapshot(input.db, userId),
      markAppStoreWebhookProcessed: (claim) => markAppStoreWebhookProcessed(input.db, claim),
      claimVerifiedAppStoreWebhook: ({ claimToken, details, id, verifiedTransaction }) =>
        claimVerifiedAppStoreWebhook(input.db, {
          claimToken,
          details,
          id,
          verifiedTransaction: verifiedTransaction
            ? verifiedTransaction as AppStoreVerificationResult<JWSTransactionDecodedPayload>
            : null,
        }),
      releaseAppStoreWebhookClaim: (claim) =>
        releaseFailedAppStoreWebhookClaim(input.db, claim),
      resolveAppStoreWebhookUserId: (verifiedTransaction) =>
        resolveWebhookUserId({
          db: input.db,
          transaction: (
            verifiedTransaction as AppStoreVerificationResult<JWSTransactionDecodedPayload>
          ).payload,
        }),
    },
  }
}

function formatEnvironment(value: unknown) {
  return value == null ? null : String(value).toLowerCase()
}
