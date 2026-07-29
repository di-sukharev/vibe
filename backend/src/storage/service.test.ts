import { describe, expect, test } from 'bun:test'

import { AppError } from '../http/errors'
import {
  assertSafeObjectKey,
  createStorageObjectKey,
  storageConfigFromEnv,
  StorageService,
  type StorageConfig,
} from './service'

const config: StorageConfig = {
  region: 'nyc3',
  bucket: 'demo-bucket',
  endpoint: 'https://nyc3.digitaloceanspaces.com',
  cdnBaseUrl: 'https://images.example.com/assets',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  uploadMaxBytes: 1024 * 1024,
  uploadUrlTtlSeconds: 900,
  downloadUrlTtlSeconds: 300,
  publicCacheControl: 'public, max-age=31536000, immutable',
}

describe('StorageService', () => {
  test('builds safe dated object keys', () => {
    expect(
      createStorageObjectKey({
        namespace: 'User Avatars',
        ownerId: 'User 123',
        filename: '../Profile Photo.PNG',
        id: 'Upload 456',
        now: new Date('2026-05-13T10:20:30.000Z'),
      }),
    ).toBe('user-avatars/user-123/2026/05/13/upload-456-profile-photo.png')
  })

  test('rejects unsafe object keys', () => {
    expect(assertSafeObjectKey('avatars/user.png')).toBe('avatars/user.png')
    expect(() => assertSafeObjectKey('/avatars/user.png')).toThrow(AppError)
    expect(() => assertSafeObjectKey('avatars/../secret.png')).toThrow(AppError)
    expect(() => assertSafeObjectKey('avatars\\secret.png')).toThrow(AppError)
  })

  test('builds public CDN URLs with encoded path segments', () => {
    const service = new StorageService(config)

    expect(service.publicUrlForKey('avatars/user one.png')).toBe(
      'https://images.example.com/assets/avatars/user%20one.png',
    )
  })

  test('creates presigned public upload URLs without contacting Spaces', async () => {
    const service = new StorageService({ ...config, cdnBaseUrl: undefined })
    const upload = await service.createUploadUrl({
      key: 'uploads/avatar.png',
      contentType: 'IMAGE/PNG',
      byteSize: 128,
      visibility: 'public',
    })
    const uploadUrl = new URL(upload.uploadUrl)

    expect(upload.method).toBe('PUT')
    expect(upload.headers).toEqual({
      'Content-Type': 'image/png',
      'x-amz-acl': 'public-read',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    expect(upload.contentLength).toBe(128)
    expect(upload.publicUrl).toBe('https://demo-bucket.nyc3.digitaloceanspaces.com/uploads/avatar.png')
    expect(uploadUrl.hostname).toBe('demo-bucket.nyc3.digitaloceanspaces.com')
    expect(uploadUrl.pathname).toBe('/uploads/avatar.png')
    expect(uploadUrl.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(uploadUrl.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length')
  })

  test('enforces upload size and TTL limits before signing', async () => {
    const service = new StorageService(config)

    await expect(
      service.createUploadUrl({
        key: 'uploads/large.png',
        contentType: 'image/png',
        byteSize: config.uploadMaxBytes + 1,
      }),
    ).rejects.toThrow(AppError)

    await expect(
      service.createDownloadUrl({
        key: 'uploads/private.png',
        expiresInSeconds: 7 * 24 * 60 * 60 + 1,
      }),
    ).rejects.toThrow(AppError)
  })
})

describe('storageConfigFromEnv', () => {
  test('returns null until Spaces is configured', () => {
    expect(
      storageConfigFromEnv({
        PORT: 3000,
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        CORS_ORIGINS: ['http://localhost:5173'],
        ACCESS_TOKEN_TTL_SECONDS: 900,
        REFRESH_TOKEN_TTL_DAYS: 30,
        REFRESH_REUSE_GRACE_SECONDS: 10,
        SESSION_ABSOLUTE_TTL_DAYS: 90,
        SESSION_RETENTION_DAYS: 7,
        AUTH_BODY_LIMIT_BYTES: 64 * 1024,
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
        SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
        SPACES_UPLOAD_URL_TTL_SECONDS: 900,
        SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
        SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
        APPLE_IAP_ENVIRONMENT: 'Sandbox',
        APPLE_IAP_PRODUCT_IDS: [],
        APPLE_AUTH_JWKS_TIMEOUT_MS: 5000,
        GOOGLE_AUTH_CLIENT_IDS: [],
        GOOGLE_PLAY_PRODUCT_IDS: [],
        GOOGLE_PLAY_BASE_PLAN_IDS: [],
      }),
    ).toBeNull()
  })
})
