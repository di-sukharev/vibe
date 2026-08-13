import { describe, expect, test } from 'bun:test'

import type { S3StorageConfig } from './config'
import { StorageError } from './errors'
import { S3PrivateStorage } from './s3-storage'

const localConfig: S3StorageConfig = {
  driver: 's3',
  region: 'us-east-1',
  bucket: 'local-private-storage',
  endpoint: 'http://127.0.0.1:24331',
  accessKeyId: 'local-key',
  secretAccessKey: 'local-secret',
  forcePathStyle: true,
  uploadMaxBytes: 5 * 1024 * 1024,
  uploadUrlTtlSeconds: 900,
  downloadUrlTtlSeconds: 300,
}

const uploadInput = { key: 'avatars/2026/08/abc', contentType: 'image/png', byteSize: 1024 }

// Presigning is pure signature maths, so every assertion here runs without a server.
describe('S3PrivateStorage presigned uploads', () => {
  test('addresses the bucket in the path when path-style is on', async () => {
    const upload = await new S3PrivateStorage(localConfig).createUploadUrl(uploadInput)
    const url = new URL(upload.url)

    expect(url.host).toBe('127.0.0.1:24331')
    expect(url.pathname).toBe('/local-private-storage/avatars/2026/08/abc')
  })

  test('addresses the bucket as a subdomain when path-style is off', async () => {
    const upload = await new S3PrivateStorage({
      ...localConfig,
      endpoint: 'https://storage.example.com',
      forcePathStyle: false,
    }).createUploadUrl(uploadInput)
    const url = new URL(upload.url)

    expect(url.host).toBe('local-private-storage.storage.example.com')
    expect(url.pathname).toBe('/avatars/2026/08/abc')
  })

  test('signs the exact size, type, and write-once condition', async () => {
    const upload = await new S3PrivateStorage(localConfig).createUploadUrl(uploadInput)
    const signedHeaders = new URL(upload.url).searchParams.get('X-Amz-SignedHeaders') ?? ''

    expect(signedHeaders.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'if-none-match']),
    )
    expect(upload.headers).toEqual({ 'Content-Type': 'image/png', 'If-None-Match': '*' })
    expect(upload.contentLength).toBe(1024)
    expect(upload.method).toBe('PUT')
  })

  test('never signs an ACL, so privacy comes from the bucket rather than per-object grants', async () => {
    const upload = await new S3PrivateStorage(localConfig).createUploadUrl(uploadInput)

    expect(upload.url.toLowerCase()).not.toContain('acl')
    expect(Object.keys(upload.headers)).not.toContain('x-amz-acl')
  })

  test('does not sign an optional checksum, which would be computed over an absent body', async () => {
    const upload = await new S3PrivateStorage(localConfig).createUploadUrl(uploadInput)
    const url = new URL(upload.url)
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') ?? ''

    expect(signedHeaders).not.toContain('x-amz-checksum')
    expect(signedHeaders).not.toContain('x-amz-sdk-checksum-algorithm')
    for (const [name] of url.searchParams) {
      expect(name.toLowerCase()).not.toContain('checksum')
    }
  })

  test('expires the upload URL on the configured window', async () => {
    const upload = await new S3PrivateStorage(localConfig).createUploadUrl(uploadInput)

    expect(new URL(upload.url).searchParams.get('X-Amz-Expires')).toBe('900')
    expect(Date.parse(upload.expiresAt)).toBeGreaterThan(Date.now())
  })

  test('rejects sizes, types, keys, and lifetimes it must not sign', async () => {
    const storage = new S3PrivateStorage(localConfig)

    await expect(storage.createUploadUrl({ ...uploadInput, byteSize: 0 })).rejects.toThrow(StorageError)
    await expect(
      storage.createUploadUrl({ ...uploadInput, byteSize: localConfig.uploadMaxBytes + 1 }),
    ).rejects.toThrow(StorageError)
    await expect(storage.createUploadUrl({ ...uploadInput, contentType: 'nope' })).rejects.toThrow(
      StorageError,
    )
    await expect(storage.createUploadUrl({ ...uploadInput, key: '../escape' })).rejects.toThrow(
      StorageError,
    )
    await expect(
      storage.createUploadUrl({ ...uploadInput, expiresInSeconds: 8 * 24 * 60 * 60 }),
    ).rejects.toThrow(StorageError)
  })
})

describe('S3PrivateStorage presigned downloads', () => {
  test('signs a GET that carries its own credentials in the query string', async () => {
    const download = await new S3PrivateStorage(localConfig).createDownloadUrl({
      key: 'avatars/2026/08/abc',
    })
    const url = new URL(download.url)

    expect(url.pathname).toBe('/local-private-storage/avatars/2026/08/abc')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
    expect(url.searchParams.get('X-Amz-Credential')).toContain('local-key')
  })

  test('produces a different signature per key, so a URL cannot be repointed', async () => {
    const storage = new S3PrivateStorage(localConfig)
    const mine = await storage.createDownloadUrl({ key: 'avatars/2026/08/mine' })
    const yours = await storage.createDownloadUrl({ key: 'avatars/2026/08/yours' })

    expect(new URL(mine.url).searchParams.get('X-Amz-Signature')).not.toBe(
      new URL(yours.url).searchParams.get('X-Amz-Signature'),
    )
  })
})
