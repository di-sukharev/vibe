import { GoogleAuth, type JWTInput } from 'google-auth-library'

import type { AppEnv } from '../../../env'
import { BillingFailure } from '../domain/errors'

const androidPublisherScope = 'https://www.googleapis.com/auth/androidpublisher'
const androidPublisherBaseUrl = 'https://androidpublisher.googleapis.com/androidpublisher/v3'
const googlePlayRequestTimeoutMs = 15_000

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

export type GooglePlaySubscriptionVerifier = {
  acknowledgeSubscription: (input: {
    productId: string
    purchaseToken: string
  }) => Promise<void>
  getSubscriptionPurchase: (input: {
    purchaseToken: string
  }) => Promise<GooglePlaySubscriptionPurchase>
}

type GooglePlayApiRequester = {
  request: <T>(input: {
    data?: unknown
    method: 'GET' | 'POST'
    timeout?: number
    url: string
  }) => Promise<{ data: T }>
}

export function createGooglePlaySubscriptionVerifier(
  env: AppEnv,
  requester?: GooglePlayApiRequester,
): GooglePlaySubscriptionVerifier {
  const getRequester = requester ? () => requester : createRequesterFactory(env)

  return {
    async getSubscriptionPurchase({ purchaseToken }) {
      const url = `${androidPublisherBaseUrl}/applications/${encodeURIComponent(
        googlePlayPackageName(env),
      )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`

      try {
        const response = await getRequester().request<GooglePlaySubscriptionPurchase>({
          method: 'GET',
          timeout: googlePlayRequestTimeoutMs,
          url,
        })
        return response.data
      } catch (error) {
        throw mapGooglePlayApiError(error)
      }
    },
    async acknowledgeSubscription({ productId, purchaseToken }) {
      const url = `${androidPublisherBaseUrl}/applications/${encodeURIComponent(
        googlePlayPackageName(env),
      )}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(
        purchaseToken,
      )}:acknowledge`

      try {
        await getRequester().request<unknown>({
          data: {},
          method: 'POST',
          timeout: googlePlayRequestTimeoutMs,
          url,
        })
      } catch (error) {
        throw mapGooglePlayApiError(error)
      }
    },
  }
}

function createRequesterFactory(env: AppEnv) {
  let requester: GooglePlayApiRequester | null = null

  return () => {
    if (!requester) {
      requester = new GoogleAuth({
        credentials: googlePlayServiceAccount(env),
        scopes: [androidPublisherScope],
      })
    }

    return requester
  }
}

function googlePlayPackageName(env: AppEnv) {
  if (!env.GOOGLE_PLAY_PACKAGE_NAME) {
    throw new BillingFailure(
      'IAP_NOT_CONFIGURED',
      'Google Play package name is not configured',
    )
  }

  return env.GOOGLE_PLAY_PACKAGE_NAME
}

function googlePlayServiceAccount(env: AppEnv): JWTInput {
  if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64) {
    throw new BillingFailure(
      'IAP_NOT_CONFIGURED',
      'Google Play service account credentials are not configured',
    )
  }

  const rawCredentials = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64.trim()
  const decoded = rawCredentials.startsWith('{')
    ? rawCredentials
    : Buffer.from(rawCredentials, 'base64').toString('utf8')

  try {
    return JSON.parse(decoded) as JWTInput
  } catch {
    throw new BillingFailure(
      'IAP_NOT_CONFIGURED',
      'Google Play service account credentials are not valid JSON',
    )
  }
}

function mapGooglePlayApiError(error: unknown) {
  const status = googleApiStatus(error)

  if (status === 400 || status === 404) {
    return new BillingFailure(
      'IAP_INVALID_TRANSACTION',
      'Google Play purchase could not be verified',
    )
  }

  if (status === 401 || status === 403) {
    return new BillingFailure(
      'IAP_NOT_CONFIGURED',
      'Google Play API credentials are not authorized for subscription verification',
    )
  }

  if (error instanceof BillingFailure) return error

  return new BillingFailure(
    'IAP_NOT_CONFIGURED',
    'Google Play subscription verification is temporarily unavailable',
  )
}

function googleApiStatus(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const response = 'response' in error ? (error as { response?: unknown }).response : null
  if (!response || typeof response !== 'object' || !('status' in response)) return null
  const status = (response as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}
