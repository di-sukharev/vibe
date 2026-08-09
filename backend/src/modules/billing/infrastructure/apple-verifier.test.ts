import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

import type { AppEnv } from '../../../env'
import { createAppStoreSubscriptionVerifier } from './apple-verifier'

const baseEnv: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  JWT_SECRET: '12345678901234567890123456789012',
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  REFRESH_REUSE_GRACE_SECONDS: 10,
  SESSION_ABSOLUTE_TTL_DAYS: 90,
  SESSION_RETENTION_DAYS: 7,
  AUTH_BODY_LIMIT_BYTES: 64 * 1024,
  INGRESS_RATE_LIMIT_PROVIDER: 'local',
  AUTH_RATE_LIMIT_MAX: 60,
  AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
  ADMIN_USERS_READ_RATE_LIMIT_MAX: 120,
  ADMIN_USERS_READ_RATE_LIMIT_WINDOW_SECONDS: 60,
  IAP_BODY_LIMIT_BYTES: 64 * 1024,
  IAP_RATE_LIMIT_MAX: 60,
  IAP_RATE_LIMIT_WINDOW_SECONDS: 60,
  SHUTDOWN_GRACE_SECONDS: 20,
  TRUST_PROXY: false,
  COOKIE_SECURE: false,
  ENABLE_TEST_PUSH: false,
  PRIVATE_STORAGE_DRIVER: 'filesystem',
  PRIVATE_STORAGE_LOCAL_ROOT: '.storage',
  PRIVATE_STORAGE_FORCE_PATH_STYLE: false,
  PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: false,
  PRIVATE_STORAGE_UPLOAD_MAX_BYTES: 5 * 1024 * 1024,
  PRIVATE_STORAGE_UPLOAD_URL_TTL_SECONDS: 900,
  PRIVATE_STORAGE_DOWNLOAD_URL_TTL_SECONDS: 300,
  APPLE_IAP_ENVIRONMENT: 'Sandbox',
  APPLE_IAP_PRODUCT_IDS: ['premium_monthly'],
  APPLE_AUTH_JWKS_TIMEOUT_MS: 5000,
  GOOGLE_AUTH_CLIENT_IDS: [],
  GOOGLE_PLAY_PRODUCT_IDS: [],
  GOOGLE_PLAY_BASE_PLAN_IDS: [],
}

test('fails fast when configured App Store root certificates are missing', () => {
  expect(() => createAppStoreSubscriptionVerifier({
    ...baseEnv,
    APPLE_IAP_BUNDLE_ID: 'com.example.app',
    APPLE_IAP_ROOT_CERTS_DIR: '/definitely/missing/apple/root-certs',
  })).toThrow(expect.objectContaining({
    code: 'IAP_NOT_CONFIGURED',
  }))
})

test('loads the bundled Apple root certificates by default', async () => {
  const verifier = createAppStoreSubscriptionVerifier({
    ...baseEnv,
    APPLE_IAP_BUNDLE_ID: 'com.example.app',
  })

  await expect(verifier.verifyTransaction('not-a-signed-transaction')).rejects.toMatchObject({
    code: 'IAP_INVALID_TRANSACTION',
  })
})

test('preserves App Store verifier configuration errors for missing bundle id', async () => {
  const certsDir = mkdtempSync(join(tmpdir(), 'iap-root-certs-'))
  writeFileSync(join(certsDir, 'root.cer'), 'not-a-real-cert')

  try {
    const verifier = createAppStoreSubscriptionVerifier({
      ...baseEnv,
      APPLE_IAP_ROOT_CERTS_DIR: certsDir,
    })

    await expect(verifier.verifyTransaction('signed-transaction')).rejects.toMatchObject({
      code: 'IAP_NOT_CONFIGURED',
    })
  } finally {
    rmSync(certsDir, { force: true, recursive: true })
  }
})

test('fails fast when configured App Store root certificates are corrupt', () => {
  const certsDir = mkdtempSync(join(tmpdir(), 'iap-invalid-root-certs-'))
  writeFileSync(join(certsDir, 'root.crt'), 'not-a-real-cert')

  try {
    expect(() => createAppStoreSubscriptionVerifier({
      ...baseEnv,
      APPLE_IAP_BUNDLE_ID: 'com.example.app',
      APPLE_IAP_ROOT_CERTS_DIR: certsDir,
    })).toThrow(expect.objectContaining({
      code: 'IAP_NOT_CONFIGURED',
    }))
  } finally {
    rmSync(certsDir, { force: true, recursive: true })
  }
})

test('bounds a stalled App Store subscription status lookup', async () => {
  let aborted = false
  const verifier = createAppStoreSubscriptionVerifier(
    {
      ...baseEnv,
      APPLE_IAP_BUNDLE_ID: 'com.example.app',
      APPLE_IAP_ISSUER_ID: 'issuer-id',
      APPLE_IAP_KEY_ID: 'key-id',
      APPLE_IAP_PRIVATE_KEY_BASE64: 'private-key',
    },
    {
      apiClientFactory: () => ({
        abortPendingRequests: () => {
          aborted = true
        },
        getAllSubscriptionStatuses: () => new Promise(() => {}),
      }),
      statusLookupTimeoutMs: 5,
    },
  )

  await expect(
    verifier.getSubscriptionStatuses({ transactionId: 'original-transaction-id' }),
  ).rejects.toThrow('App Store subscription status lookup exceeded 5ms')
  expect(aborted).toBe(true)
})

test('aborts the underlying App Store request when its deadline elapses', async () => {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })
  const observedSignal: { current: AbortSignal | null } = { current: null }
  const verifier = createAppStoreSubscriptionVerifier(
    {
      ...baseEnv,
      APPLE_IAP_BUNDLE_ID: 'com.example.app',
      APPLE_IAP_ISSUER_ID: '8f9977c2-9ef0-4c44-b313-b8ae76c651df',
      APPLE_IAP_KEY_ID: 'APPLEKEY1',
      APPLE_IAP_PRIVATE_KEY_BASE64: privateKey,
    },
    {
      fetchImpl: (_input, init) => new Promise<Response>((_resolve, reject) => {
        observedSignal.current = init?.signal ?? null
        observedSignal.current?.addEventListener('abort', () => {
          reject(new Error('App Store request aborted'))
        }, { once: true })
      }),
      statusLookupTimeoutMs: 5,
    },
  )

  await expect(
    verifier.getSubscriptionStatuses({ transactionId: 'original-transaction-id' }),
  ).rejects.toThrow('App Store subscription status lookup exceeded 5ms')
  expect(observedSignal.current?.aborted).toBe(true)
})
