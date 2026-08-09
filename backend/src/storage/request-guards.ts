import { StorageError } from './errors'

const maxSignedUrlTtlSeconds = 7 * 24 * 60 * 60

/**
 * Request validation shared by both drivers.
 *
 * It lives outside the drivers on purpose: the filesystem driver and the S3 driver have to
 * reject the same inputs with the same reasons, or the contract suite would be proving that two
 * different contracts each hold. Anything a driver validated on its own would be a place where
 * local development and production could quietly disagree.
 */

export function assertContentType(contentType: string) {
  const normalized = contentType.trim().toLowerCase()

  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
    throw new StorageError('invalid_request', 'Upload content type is invalid')
  }

  return normalized
}

export function assertByteSize(byteSize: number, uploadMaxBytes: number) {
  if (!Number.isInteger(byteSize) || byteSize <= 0 || byteSize > uploadMaxBytes) {
    throw new StorageError('invalid_request', 'Upload size is outside the allowed range', {
      maxBytes: uploadMaxBytes,
    })
  }

  return byteSize
}

export function assertSignedUrlTtl(expiresInSeconds: number) {
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    expiresInSeconds > maxSignedUrlTtlSeconds
  ) {
    throw new StorageError('invalid_request', 'Signed URL expiration is outside the allowed range')
  }

  return expiresInSeconds
}

export function assertReadRange(range: { start: number; end: number }) {
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start
  ) {
    throw new StorageError('invalid_request', 'Read range is invalid')
  }

  return range
}

export function expiresAtFromNow(expiresInSeconds: number) {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString()
}
