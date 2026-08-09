import type { Hono } from 'hono'

import type { AppEnv } from '../env'
import { privateStorageConfigFromEnv } from './config'
import { createFilesystemStorageRoutes } from './filesystem-routes'
import { FilesystemPrivateStorage } from './filesystem-storage'
import type { PrivateStorage } from './port'
import { S3PrivateStorage } from './s3-storage'

export type PrivateStorageRuntime = {
  storage: PrivateStorage
  /**
   * Present only for the filesystem driver, which needs the backend to serve the URLs it signs.
   * With an S3 driver the browser talks to the bucket directly and there is nothing to mount.
   */
  httpRoutes: Hono | null
}

export function createPrivateStorage(env: AppEnv): PrivateStorageRuntime {
  const config = privateStorageConfigFromEnv(env)

  if (config.driver === 's3') {
    return { storage: new S3PrivateStorage(config), httpRoutes: null }
  }

  return {
    storage: new FilesystemPrivateStorage(config),
    httpRoutes: createFilesystemStorageRoutes(config),
  }
}

export {
  browserUploadAllowedHeaders,
  browserUploadExposedHeaders,
  privateStorageConfigFromEnv,
} from './config'
export { StorageError, type StorageErrorKind } from './errors'
export { filesystemStorageRoutePrefix } from './filesystem-storage'
export { assertSafeObjectKey, createStorageObjectKey } from './object-keys'
export type {
  PresignedDownload,
  PresignedUpload,
  PrivateStorage,
  StorageDriverName,
  StorageObjectHead,
} from './port'
