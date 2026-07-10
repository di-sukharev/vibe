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
import { AppError } from '../../../http/errors'

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

export function createAppStoreSubscriptionVerifier(env: AppEnv): AppStoreSubscriptionVerifier {
  const verifierCache = new Map<Environment, SignedDataVerifier>()
  const apiClientCache = new Map<Environment, AppStoreServerAPIClient>()
  let rootCertificatesCache: Buffer[] | null = null

  function requireBundleId() {
    if (!env.APPLE_IAP_BUNDLE_ID) {
      throw new AppError(
        503,
        'IAP_NOT_CONFIGURED',
        'App Store IAP verification is not configured',
      )
    }

    return env.APPLE_IAP_BUNDLE_ID
  }

  function readRootCertificates() {
    if (rootCertificatesCache) return rootCertificatesCache

    const certsDir =
      env.APPLE_IAP_ROOT_CERTS_DIR ?? resolve(import.meta.dir, '../../certs/apple')
    let certFiles: string[]

    try {
      certFiles = readdirSync(certsDir)
        .filter((fileName) => ['.cer', '.crt', '.der'].includes(extname(fileName).toLowerCase()))
        .sort()
    } catch {
      throw new AppError(
        503,
        'IAP_NOT_CONFIGURED',
        'Apple root certificates are missing for App Store IAP verification',
      )
    }

    if (certFiles.length === 0) {
      throw new AppError(
        503,
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

    const verifier = new SignedDataVerifier(
      readRootCertificates(),
      false,
      environment,
      requireBundleId(),
      environment === Environment.PRODUCTION ? env.APPLE_IAP_APP_APPLE_ID : undefined,
    )

    verifierCache.set(environment, verifier)
    return verifier
  }

  function decodePrivateKey(value: string) {
    return value.includes('BEGIN PRIVATE KEY') ? value : Buffer.from(value, 'base64').toString('utf8')
  }

  function getApiClient(environment: Environment) {
    const cached = apiClientCache.get(environment)
    if (cached) return cached

    if (!env.APPLE_IAP_ISSUER_ID || !env.APPLE_IAP_KEY_ID || !env.APPLE_IAP_PRIVATE_KEY_BASE64) {
      throw new AppError(
        503,
        'IAP_NOT_CONFIGURED',
        'App Store Server API credentials are not configured',
      )
    }

    const client = new AppStoreServerAPIClient(
      decodePrivateKey(env.APPLE_IAP_PRIVATE_KEY_BASE64),
      env.APPLE_IAP_KEY_ID,
      env.APPLE_IAP_ISSUER_ID,
      requireBundleId(),
      environment,
    )
    apiClientCache.set(environment, client)
    return client
  }

  function verificationEnvironments() {
    if (env.APPLE_IAP_ENVIRONMENT === 'Production') {
      return [Environment.PRODUCTION, Environment.SANDBOX]
    }

    return [Environment.SANDBOX, Environment.PRODUCTION]
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

    throw new AppError(
      400,
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

  return {
    verifyTransaction: (signedTransactionInfo) =>
      verifyWithFallback((verifier) => verifier.verifyAndDecodeTransaction(signedTransactionInfo)),
    verifyRenewalInfo: (signedRenewalInfo) =>
      verifyWithFallback((verifier) => verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo)),
    verifyNotification: (signedPayload) =>
      verifyWithFallback((verifier) => verifier.verifyAndDecodeNotification(signedPayload)),
    getSubscriptionStatuses: async ({ transactionId, environment }) => {
      const client = getApiClient(normalizeEnvironment(environment))
      const response = await client.getAllSubscriptionStatuses(transactionId)

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
  return error instanceof AppError && error.code === 'IAP_NOT_CONFIGURED'
}
