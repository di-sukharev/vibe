import { AsyncLocalStorage } from 'node:async_hooks'
import { GoogleAuth, gaxios, type JWTInput } from 'google-auth-library'

import type { AppEnv } from '../../../env'
import { BillingFailure } from '../domain/errors'
import type { GooglePlaySubscriptionPurchase } from '../domain/provider-values'

const androidPublisherScope = 'https://www.googleapis.com/auth/androidpublisher'
const androidPublisherBaseUrl = 'https://androidpublisher.googleapis.com/androidpublisher/v3'
const googlePlayRequestTimeoutMs = 15_000

export type { GooglePlaySubscriptionPurchase, GooglePlaySubscriptionLineItem } from '../domain/provider-values'

export type GooglePlaySubscriptionVerifier = {
  acknowledgeSubscription: (input: {
    productId: string
    purchaseToken: string
    signal?: AbortSignal
  }) => Promise<void>
  getSubscriptionPurchase: (input: {
    purchaseToken: string
    signal?: AbortSignal
  }) => Promise<GooglePlaySubscriptionPurchase>
}

type GooglePlayApiRequester = {
  request: <T>(input: {
    data?: unknown
    method: 'GET' | 'POST'
    signal?: AbortSignal
    url: string
  }) => Promise<{ data: T }>
}

export function createGooglePlaySubscriptionVerifier(
  env: AppEnv,
  options: {
    requester?: GooglePlayApiRequester
    fetchImplementation?: gaxios.GaxiosOptions['fetchImplementation']
    requestTimeoutMs?: number
  } = {},
): GooglePlaySubscriptionVerifier {
  const requestScope = new AsyncLocalStorage<AbortSignal>()
  const requester = options.requester
  const getRequester = requester
    ? () => requester
    : createRequesterFactory(env, requestScope, options.fetchImplementation)

  async function request<T>(input: Parameters<GooglePlayApiRequester['request']>[0]) {
    const controller = new AbortController()
    const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal
    signal.throwIfAborted()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        const error = new DOMException('Google Play request timed out', 'AbortError')
        controller.abort(error)
        reject(error)
      }, options.requestTimeoutMs ?? googlePlayRequestTimeoutMs)
    })
    try {
      // Abort network work and also bound SDK retry delays between requests.
      return await Promise.race([
        requestScope.run(signal, () =>
          getRequester().request<T>({ ...input, signal }),
        ),
        deadline,
      ])
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    async getSubscriptionPurchase({ purchaseToken, signal }) {
      const url = `${androidPublisherBaseUrl}/applications/${encodeURIComponent(
        googlePlayPackageName(env),
      )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`

      try {
        const response = await request<GooglePlaySubscriptionPurchase>({
          method: 'GET',
          signal,
          url,
        })
        return response.data
      } catch (error) {
        throw mapGooglePlayApiError(error)
      }
    },
    async acknowledgeSubscription({ productId, purchaseToken, signal }) {
      const url = `${androidPublisherBaseUrl}/applications/${encodeURIComponent(
        googlePlayPackageName(env),
      )}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(
        purchaseToken,
      )}:acknowledge`

      try {
        await request<unknown>({
          data: {},
          method: 'POST',
          signal,
          url,
        })
      } catch (error) {
        throw mapGooglePlayApiError(error)
      }
    },
  }
}

function createRequesterFactory(
  env: AppEnv,
  requestScope: AsyncLocalStorage<AbortSignal>,
  fetchImplementation?: gaxios.GaxiosOptions['fetchImplementation'],
) {
  let requester: GooglePlayApiRequester | null = null

  return () => {
    if (!requester) {
      const transporter = new gaxios.Gaxios({ fetchImplementation })
      // GoogleAuth does not forward the API request signal to its OAuth request.
      transporter.interceptors.request.add({
        resolved: async (options) => {
          const signal = requestScope.getStore()
          if (signal) {
            signal.throwIfAborted()
            options.signal = options.signal
              ? AbortSignal.any([options.signal, signal])
              : signal
          }
          return options
        },
      })
      requester = new GoogleAuth({
        clientOptions: { transporter },
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

  if (status === 400 || status === 404 || status === 410) {
    return new BillingFailure(
      'IAP_INVALID_TRANSACTION',
      'Google Play purchase could not be verified',
      { providerStatus: status },
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
