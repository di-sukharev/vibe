import { readdirSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
  type Status,
} from '@apple/app-store-server-library'

import type { AppEnv } from '../../../env'
import { BillingFailure } from '../domain/errors'

export type AppStoreVerificationResult<T> = {
  environment: Environment
  payload: T
}

export type AppStoreStatusTransaction = {
  status?: Status | number
  signedTransactionInfo?: string
  signedRenewalInfo?: string
}

export type AppStoreSubscriptionVerifier = {
  verifyTransaction: (
    signedTransactionInfo: string,
  ) => Promise<AppStoreVerificationResult<JWSTransactionDecodedPayload>>
  verifyRenewalInfo: (
    signedRenewalInfo: string,
  ) => Promise<AppStoreVerificationResult<JWSRenewalInfoDecodedPayload>>
  verifyNotification: (
    signedPayload: string,
  ) => Promise<AppStoreVerificationResult<ResponseBodyV2DecodedPayload>>
  getSubscriptionStatuses: (input: {
    transactionId: string
    environment?: Environment | string | null
  }) => Promise<AppStoreStatusTransaction[]>
}

type AppStoreStatusApiClient = {
  abortPendingRequests?: () => void
  getAllSubscriptionStatuses(transactionId: string): Promise<{
    data?: Array<{
      lastTransactions?: AppStoreStatusTransaction[]
    }>
  }>
}

type AppStoreFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

type AppStoreSubscriptionVerifierOptions = {
  apiClientFactory?: (input: {
    bundleId: string
    environment: Environment
    issuerId: string
    keyId: string
    privateKey: string
  }) => AppStoreStatusApiClient
  fetchImpl?: AppStoreFetch
  statusLookupTimeoutMs?: number
}

const appStoreStatusLookupTimeoutMs = 15_000
const appStoreServerBaseUrls = {
  [Environment.PRODUCTION]: 'https://api.storekit.itunes.apple.com',
  [Environment.SANDBOX]: 'https://api.storekit-sandbox.itunes.apple.com',
} as const

class AbortableAppStoreServerAPIClient extends AppStoreServerAPIClient {
  private readonly controllers = new Set<AbortController>()

  constructor(
    signingKey: string,
    keyId: string,
    issuerId: string,
    bundleId: string,
    private readonly environment: Environment.PRODUCTION | Environment.SANDBOX,
    private readonly fetchImpl: AppStoreFetch = fetch,
  ) {
    super(signingKey, keyId, issuerId, bundleId, environment)
  }

  abortPendingRequests() {
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  protected override makeFetchRequest(
    path: string,
    parsedQueryParameters: URLSearchParams,
    method: string,
    requestBody: string | Buffer | undefined,
    headers: Record<string, string>,
  ): Promise<import('node-fetch').Response> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const query = parsedQueryParameters.toString()
    const request = this.fetchImpl(
      `${appStoreServerBaseUrls[this.environment]}${path}${query ? `?${query}` : ''}`,
      {
        body: requestBody as BodyInit | undefined,
        headers,
        method,
        signal: controller.signal,
      },
    ).finally(() => {
      this.controllers.delete(controller)
    })
    return request as unknown as Promise<import('node-fetch').Response>
  }
}

export function createAppStoreSubscriptionVerifier(
  env: AppEnv,
  options: AppStoreSubscriptionVerifierOptions = {},
): AppStoreSubscriptionVerifier {
  const verifierCache = new Map<Environment, SignedDataVerifier>()
  let rootCertificatesCache: Buffer[] | null = null

  function requireBundleId() {
    if (!env.APPLE_IAP_BUNDLE_ID) {
      throw new BillingFailure(
        'IAP_NOT_CONFIGURED',
        'App Store IAP verification is not configured',
      )
    }

    return env.APPLE_IAP_BUNDLE_ID
  }

  function readRootCertificates() {
    if (rootCertificatesCache) return rootCertificatesCache

    const certsDir =
      env.APPLE_IAP_ROOT_CERTS_DIR ?? resolve(import.meta.dir, '../certs/apple')
    let certFiles: string[]

    try {
      certFiles = readdirSync(certsDir)
        .filter((fileName) =>
          ['.cer', '.crt', '.der', '.pem'].includes(extname(fileName).toLowerCase()),
        )
        .sort()
    } catch {
      throw new BillingFailure(
        'IAP_NOT_CONFIGURED',
        'Apple root certificates are missing for App Store IAP verification',
      )
    }

    if (certFiles.length === 0) {
      throw new BillingFailure(
        'IAP_NOT_CONFIGURED',
        'Apple root certificates are missing for App Store IAP verification',
      )
    }

    rootCertificatesCache = certFiles.map((fileName) => readFileSync(resolve(certsDir, fileName)))
    return rootCertificatesCache
  }

  function getVerifier(environment: Environment) {
    const cached = verifierCache.get(environment)
    if (cached) return cached

    let verifier: SignedDataVerifier
    try {
      verifier = new SignedDataVerifier(
        readRootCertificates(),
        false,
        environment,
        requireBundleId(),
        environment === Environment.PRODUCTION ? env.APPLE_IAP_APP_APPLE_ID : undefined,
      )
    } catch (error) {
      if (isIapConfigurationError(error)) throw error
      throw new BillingFailure(
        'IAP_NOT_CONFIGURED',
        'Apple root certificates or verifier identifiers are invalid',
      )
    }

    verifierCache.set(environment, verifier)
    return verifier
  }

  function decodePrivateKey(value: string) {
    return value.includes('BEGIN PRIVATE KEY') ? value : Buffer.from(value, 'base64').toString('utf8')
  }

  function getApiClient(environment: Environment) {
    if (!env.APPLE_IAP_ISSUER_ID || !env.APPLE_IAP_KEY_ID || !env.APPLE_IAP_PRIVATE_KEY_BASE64) {
      throw new BillingFailure(
        'IAP_NOT_CONFIGURED',
        'App Store Server API credentials are not configured',
      )
    }

    const input = {
      bundleId: requireBundleId(),
      environment,
      issuerId: env.APPLE_IAP_ISSUER_ID,
      keyId: env.APPLE_IAP_KEY_ID,
      privateKey: decodePrivateKey(env.APPLE_IAP_PRIVATE_KEY_BASE64),
    }
    const client = options.apiClientFactory
      ? options.apiClientFactory(input)
      : new AbortableAppStoreServerAPIClient(
          input.privateKey,
          input.keyId,
          input.issuerId,
          input.bundleId,
          input.environment as Environment.PRODUCTION | Environment.SANDBOX,
          options.fetchImpl,
        )
    return client
  }

  function verificationEnvironments() {
    return [normalizeEnvironment(env.APPLE_IAP_ENVIRONMENT)]
  }

  async function verifyWithFallback<T>(
    verify: (verifier: SignedDataVerifier) => Promise<T>,
  ): Promise<AppStoreVerificationResult<T>> {
    for (const environment of verificationEnvironments()) {
      try {
        return {
          environment,
          payload: await verify(getVerifier(environment)),
        }
      } catch (error) {
        if (isIapConfigurationError(error)) throw error
      }
    }

    throw new BillingFailure(
      'IAP_INVALID_TRANSACTION',
      'App Store signed payload could not be verified',
    )
  }

  function normalizeEnvironment(value: Environment | string | null | undefined) {
    if (value === Environment.PRODUCTION || value === 'Production' || value === 'production') {
      return Environment.PRODUCTION
    }

    return Environment.SANDBOX
  }

  if (env.APPLE_IAP_BUNDLE_ID) {
    getVerifier(normalizeEnvironment(env.APPLE_IAP_ENVIRONMENT))
  }

  return {
    verifyTransaction: (signedTransactionInfo) =>
      verifyWithFallback((verifier) => verifier.verifyAndDecodeTransaction(signedTransactionInfo)),
    verifyRenewalInfo: (signedRenewalInfo) =>
      verifyWithFallback((verifier) => verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo)),
    verifyNotification: (signedPayload) =>
      verifyWithFallback((verifier) => verifier.verifyAndDecodeNotification(signedPayload)),
    getSubscriptionStatuses: async ({ transactionId, environment }) => {
      const client = getApiClient(normalizeEnvironment(environment))
      const timeoutMs = options.statusLookupTimeoutMs ?? appStoreStatusLookupTimeoutMs
      const response = await withApplicationDeadline(
        client.getAllSubscriptionStatuses(transactionId),
        timeoutMs,
        `App Store subscription status lookup exceeded ${timeoutMs}ms`,
        () => client.abortPendingRequests?.(),
      )

      return (
        response.data?.flatMap((group) =>
          (group.lastTransactions ?? []).map((transaction) => ({
            status: transaction.status,
            signedTransactionInfo: transaction.signedTransactionInfo,
            signedRenewalInfo: transaction.signedRenewalInfo,
          })),
        ) ?? []
      )
    },
  }
}

function isIapConfigurationError(error: unknown) {
  return error instanceof BillingFailure && error.code === 'IAP_NOT_CONFIGURED'
}

function withApplicationDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(message))
      onTimeout?.()
    }, timeoutMs)
    operation.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
