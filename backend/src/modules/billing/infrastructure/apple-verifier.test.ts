import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

import { loadEnv } from '../../../env'
import { createAppStoreSubscriptionVerifier } from './apple-verifier'

const baseEnv = loadEnv({
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  ACCESS_TOKEN_TTL_SECONDS: '60',
  APPLE_IAP_PRODUCT_IDS: 'premium_monthly',
  CORS_ORIGINS: 'http://localhost:5173',
  JWT_SECRET: '12345678901234567890123456789012',
})

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
