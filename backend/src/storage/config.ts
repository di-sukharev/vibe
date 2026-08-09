import { createHmac } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

import type { AppEnv } from '../env'
import { StorageError } from './errors'

/**
 * Headers a browser must be allowed to send on the direct PUT, and to read back afterwards.
 *
 * Exported because two very different places need the identical list and drifting apart would
 * break uploads in a way that only shows up in a browser: the app's CORS middleware in
 * `backend/src/app.ts` (which covers the filesystem driver, served from the API origin) and the
 * `PutBucketCors` call in `scripts/storage-local.mjs` (which covers the local S3 container).
 */
export const browserUploadAllowedHeaders = ['Content-Type', 'Authorization', 'If-None-Match']
export const browserUploadExposedHeaders = ['ETag']

export type FilesystemStorageConfig = {
  driver: 'filesystem'
  /** Absolute path. Nothing is created until the first write. */
  root: string
  /** Origin the signed local URLs point at, normally this backend itself. */
  publicBaseUrl: string
  signingKey: Buffer
  uploadMaxBytes: number
  uploadUrlTtlSeconds: number
  downloadUrlTtlSeconds: number
}

export type S3StorageConfig = {
  driver: 's3'
  region: string
  bucket: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  uploadMaxBytes: number
  uploadUrlTtlSeconds: number
  downloadUrlTtlSeconds: number
}

export type PrivateStorageConfig = FilesystemStorageConfig | S3StorageConfig

/**
 * Translates validated env into a driver configuration.
 *
 * `backend/src/env.ts` has already rejected every incoherent combination, so anything this
 * function still has to check would be a programming error rather than an operator mistake.
 */
export function privateStorageConfigFromEnv(env: AppEnv): PrivateStorageConfig {
  const shared = {
    uploadMaxBytes: env.PRIVATE_STORAGE_UPLOAD_MAX_BYTES,
    uploadUrlTtlSeconds: env.PRIVATE_STORAGE_UPLOAD_URL_TTL_SECONDS,
    downloadUrlTtlSeconds: env.PRIVATE_STORAGE_DOWNLOAD_URL_TTL_SECONDS,
  }

  if (env.PRIVATE_STORAGE_DRIVER === 's3') {
    const region = env.PRIVATE_STORAGE_REGION
    const bucket = env.PRIVATE_STORAGE_BUCKET
    const endpoint = env.PRIVATE_STORAGE_ENDPOINT
    const accessKeyId = env.PRIVATE_STORAGE_ACCESS_KEY_ID
    const secretAccessKey = env.PRIVATE_STORAGE_SECRET_ACCESS_KEY

    if (!region || !bucket || !endpoint || !accessKeyId || !secretAccessKey) {
      throw new StorageError(
        'misconfigured',
        'PRIVATE_STORAGE_DRIVER is s3 but the S3 settings are incomplete',
      )
    }

    return {
      driver: 's3',
      region,
      bucket,
      endpoint,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: env.PRIVATE_STORAGE_FORCE_PATH_STYLE,
      ...shared,
    }
  }

  return {
    driver: 'filesystem',
    root: isAbsolute(env.PRIVATE_STORAGE_LOCAL_ROOT)
      ? env.PRIVATE_STORAGE_LOCAL_ROOT
      : resolve(process.cwd(), env.PRIVATE_STORAGE_LOCAL_ROOT),
    publicBaseUrl: (
      env.PRIVATE_STORAGE_LOCAL_PUBLIC_URL ?? `http://127.0.0.1:${env.PORT}`
    ).replace(/\/+$/, ''),
    signingKey: deriveLocalSigningKey(env.JWT_SECRET),
    ...shared,
  }
}

/**
 * Derives the local URL signing key from `JWT_SECRET` rather than adding a secret to configure.
 *
 * The label keeps this key unrelated to anything else derived from the same secret, so a signed
 * storage URL can never be replayed as a token and rotating `JWT_SECRET` invalidates outstanding
 * upload URLs too, which is the behaviour you want from a rotation.
 */
export function deriveLocalSigningKey(jwtSecret: string) {
  return createHmac('sha256', jwtSecret).update('private-storage-url-v1').digest()
}
