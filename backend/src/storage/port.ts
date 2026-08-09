/**
 * The provider-neutral private storage port.
 *
 * Two drivers implement it and one contract suite proves they behave the same: a filesystem
 * driver that needs nothing installed, and an S3 driver that talks to any S3-compatible
 * endpoint. Product code depends on this file only, so moving from a local disk to a real
 * bucket is a configuration change rather than a code change.
 *
 * Deliberately absent: public URLs, CDN base URLs, ACLs, and visibility. Everything stored
 * here is private, and privacy comes from the bucket default rather than a per-object ACL.
 */

export type StorageDriverName = 'filesystem' | 's3'

export type PresignedUpload = {
  key: string
  method: 'PUT'
  url: string
  /**
   * Exactly what the browser must send. Both entries are part of the signature, so changing
   * either one invalidates the upload rather than altering it:
   * - `Content-Type` pins the declared media type;
   * - `If-None-Match: *` makes the key write-once, so a retry cannot overwrite a stored object.
   */
  headers: Record<string, string>
  contentLength: number
  expiresAt: string
}

export type PresignedDownload = {
  key: string
  url: string
  expiresAt: string
}

export type StorageObjectHead = {
  key: string
  contentLength: number
  contentType: string
  etag?: string
}

export type CreateUploadUrlInput = {
  key: string
  contentType: string
  byteSize: number
  expiresInSeconds?: number
}

export type CreateDownloadUrlInput = {
  key: string
  expiresInSeconds?: number
}

export type ReadRangeInput = {
  /** Inclusive first byte. */
  start: number
  /** Inclusive last byte, matching the HTTP `Range` header rather than a JS slice end. */
  end: number
}

export interface PrivateStorage {
  readonly driver: StorageDriverName

  createUploadUrl(input: CreateUploadUrlInput): Promise<PresignedUpload>

  createDownloadUrl(input: CreateDownloadUrlInput): Promise<PresignedDownload>

  /** Resolves to `null` for a missing object rather than throwing, on every driver. */
  headObject(key: string): Promise<StorageObjectHead | null>

  /** Resolves to `null` for a missing object. Used to read magic bytes without a full download. */
  readRange(key: string, range: ReadRangeInput): Promise<Uint8Array | null>

  /** Idempotent: deleting a key that is not there succeeds. */
  deleteObject(key: string): Promise<void>
}
