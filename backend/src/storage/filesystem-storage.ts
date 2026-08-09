import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import type { FilesystemStorageConfig } from './config'
import { StorageError } from './errors'
import { signStorageUrl, storageUrlSearchParams, type StorageUrlClaims } from './filesystem-signing'
import { assertSafeObjectKey } from './object-keys'
import type {
  CreateDownloadUrlInput,
  CreateUploadUrlInput,
  PresignedDownload,
  PresignedUpload,
  PrivateStorage,
  ReadRangeInput,
  StorageObjectHead,
} from './port'
import {
  assertByteSize,
  assertContentType,
  assertReadRange,
  assertSignedUrlTtl,
  expiresAtFromNow,
} from './request-guards'

export const filesystemStorageRoutePrefix = '/storage/objects'

export type StoredObjectMetadata = {
  contentType: string
  contentLength: number
  etag: string
}

/**
 * Private storage on the local disk, with the same contract as S3.
 *
 * This is the default driver so that `bun run dev` needs no cloud account, no credentials, and
 * no Docker. It is not a stub: it signs real time-limited URLs, refuses unsigned reads, and
 * enforces write-once keys, because a development driver that is more permissive than production
 * teaches the wrong lesson and hides the bugs it is supposed to surface.
 *
 * Objects and their metadata live in two parallel trees under the configured root, so a
 * metadata file can never collide with an object key.
 */
export class FilesystemPrivateStorage implements PrivateStorage {
  readonly driver = 'filesystem' as const

  constructor(private readonly config: FilesystemStorageConfig) {}

  async createUploadUrl(input: CreateUploadUrlInput): Promise<PresignedUpload> {
    const key = assertSafeObjectKey(input.key)
    const contentType = assertContentType(input.contentType)
    const contentLength = assertByteSize(input.byteSize, this.config.uploadMaxBytes)
    const expiresIn = assertSignedUrlTtl(input.expiresInSeconds ?? this.config.uploadUrlTtlSeconds)
    const claims: StorageUrlClaims = {
      operation: 'put',
      key,
      expiresAt: unixSecondsFromNow(expiresIn),
      contentLength,
      contentType,
      ifNoneMatch: '*',
    }

    return {
      key,
      method: 'PUT',
      url: this.signedUrl(claims),
      headers: {
        'Content-Type': contentType,
        'If-None-Match': '*',
      },
      contentLength,
      expiresAt: expiresAtFromNow(expiresIn),
    }
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<PresignedDownload> {
    const key = assertSafeObjectKey(input.key)
    const expiresIn = assertSignedUrlTtl(input.expiresInSeconds ?? this.config.downloadUrlTtlSeconds)

    return {
      key,
      url: this.signedUrl({ operation: 'get', key, expiresAt: unixSecondsFromNow(expiresIn) }),
      expiresAt: expiresAtFromNow(expiresIn),
    }
  }

  async headObject(key: string): Promise<StorageObjectHead | null> {
    const safeKey = assertSafeObjectKey(key)
    const metadata = await this.readMetadata(safeKey)
    if (!metadata) return null

    return {
      key: safeKey,
      contentLength: metadata.contentLength,
      contentType: metadata.contentType,
      etag: metadata.etag,
    }
  }

  async readRange(key: string, range: ReadRangeInput): Promise<Uint8Array | null> {
    const safeKey = assertSafeObjectKey(key)
    const { start, end } = assertReadRange(range)

    let handle
    try {
      handle = await open(this.objectPath(safeKey), 'r')
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }

    try {
      const buffer = Buffer.alloc(end - start + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      return new Uint8Array(buffer.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  }

  async deleteObject(key: string) {
    const safeKey = assertSafeObjectKey(key)

    await Promise.all([
      unlinkIfPresent(this.objectPath(safeKey)),
      unlinkIfPresent(this.metadataPath(safeKey)),
    ])
  }

  /**
   * Stores an object exactly once.
   *
   * `link()` rather than `rename()` is what makes this race-free: it refuses to replace an
   * existing name, so two concurrent uploads of the same key produce one winner and one
   * `EEXIST`, and a partially written file never appears under the final name.
   */
  async putObjectOnce(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ stored: true; etag: string } | { stored: false; reason: 'already_exists' }> {
    const safeKey = assertSafeObjectKey(key)
    const objectPath = this.objectPath(safeKey)

    if (await pathExists(objectPath)) return { stored: false, reason: 'already_exists' }

    await mkdir(dirname(objectPath), { recursive: true })
    const temporaryPath = `${objectPath}.${randomUUID()}.part`
    await writeFile(temporaryPath, body, { flag: 'wx' })

    try {
      await link(temporaryPath, objectPath)
    } catch (error) {
      await unlinkIfPresent(temporaryPath)
      if (isExistingFile(error)) return { stored: false, reason: 'already_exists' }
      throw error
    }

    await unlinkIfPresent(temporaryPath)

    const etag = `"${createHash('md5').update(body).digest('hex')}"`
    const metadataPath = this.metadataPath(safeKey)
    await mkdir(dirname(metadataPath), { recursive: true })
    await writeFile(
      metadataPath,
      JSON.stringify({ contentType, contentLength: body.byteLength, etag } satisfies StoredObjectMetadata),
    )

    return { stored: true, etag }
  }

  async readMetadata(key: string): Promise<StoredObjectMetadata | null> {
    try {
      return JSON.parse(await readFile(this.metadataPath(key), 'utf8')) as StoredObjectMetadata
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  }

  objectPath(key: string) {
    return this.resolveWithin(join(this.config.root, 'objects'), key)
  }

  private metadataPath(key: string) {
    return this.resolveWithin(join(this.config.root, 'metadata'), key)
  }

  /**
   * Belt and braces on top of `assertSafeObjectKey`: even a key that slipped through validation
   * cannot address anything outside its tree.
   */
  private resolveWithin(root: string, key: string) {
    const resolved = resolve(root, key)

    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new StorageError('invalid_key', 'Storage object key escapes the storage root')
    }

    return resolved
  }

  private signedUrl(claims: StorageUrlClaims) {
    const params = storageUrlSearchParams(claims, signStorageUrl(this.config.signingKey, claims))
    const path = claims.key.split('/').map(encodeURIComponent).join('/')

    return `${this.config.publicBaseUrl}${filesystemStorageRoutePrefix}/${path}?${params.toString()}`
  }
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissingFile(error)) return false
    throw error
  }
}

async function unlinkIfPresent(path: string) {
  try {
    await unlink(path)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
}

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function isExistingFile(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

function unixSecondsFromNow(seconds: number) {
  return Math.floor(Date.now() / 1000) + seconds
}
