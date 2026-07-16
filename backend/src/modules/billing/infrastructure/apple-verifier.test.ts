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
  AUTH_RATE_LIMIT_MAX: 60,
  AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
  SHUTDOWN_GRACE_SECONDS: 20,
  TRUST_PROXY: false,
  COOKIE_SECURE: false,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  APPLE_IAP_ENVIRONMENT: 'Sandbox',
  APPLE_IAP_PRODUCT_IDS: ['premium_monthly'],
  APPLE_AUTH_JWKS_TIMEOUT_MS: 5000,
  GOOGLE_AUTH_CLIENT_IDS: [],
  GOOGLE_PLAY_PRODUCT_IDS: [],
  GOOGLE_PLAY_BASE_PLAN_IDS: [],
}

test('preserves App Store verifier configuration errors for missing root certificates', async () => {
  const verifier = createAppStoreSubscriptionVerifier({
    ...baseEnv,
    APPLE_IAP_BUNDLE_ID: 'com.example.app',
    APPLE_IAP_ROOT_CERTS_DIR: '/definitely/missing/apple/root-certs',
  })

  await expect(verifier.verifyTransaction('signed-transaction')).rejects.toMatchObject({
    code: 'IAP_NOT_CONFIGURED',
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
