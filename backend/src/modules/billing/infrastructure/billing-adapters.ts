import type {
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library'

import type { DbClient } from '../../../db'
import type { AppEnv } from '../../../env'
import type { BillingServiceDependencies } from '../application/ports'
import type { AppStoreVerificationResult, AppStoreSubscriptionVerifier } from './apple-verifier'
import {
  applyVerifiedAppStoreTransaction,
  applyVerifiedGooglePlayPurchase,
  claimAppStoreWebhook,
  getSubscriptionSnapshot,
  markAppStoreWebhookProcessed,
  releaseFailedAppStoreWebhookClaim,
  resolveStatusLookupEnvironment,
  resolveWebhookUserId,
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
      getAppStoreEnvironment: async (request) =>
        String(
          await resolveStatusLookupEnvironment({
            db: input.db,
            env: input.env,
            ...request,
          }),
        ),
      getSubscription: (userId) => getSubscriptionSnapshot(input.db, userId),
      markAppStoreWebhookProcessed: (id) => markAppStoreWebhookProcessed(input.db, id),
      recordAppStoreWebhook: async ({ details, id, verifiedTransaction }) => {
        const transaction = verifiedTransaction
          ? (verifiedTransaction as AppStoreVerificationResult<JWSTransactionDecodedPayload>)
              .payload
          : null
        await input.db.appStoreWebhook.update({
          where: { id },
          data: {
            environment: details.environment,
            notificationType: details.notificationType,
            notificationUuid: details.notificationUuid,
            originalTransactionId: transaction?.originalTransactionId ?? null,
            subtype: details.subtype,
            transactionId: transaction?.transactionId ?? null,
          },
        })
      },
      releaseAppStoreWebhookClaim: (id) => releaseFailedAppStoreWebhookClaim(input.db, id),
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
