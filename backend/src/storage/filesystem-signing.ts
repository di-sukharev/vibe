import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * URL signing for the filesystem driver.
 *
 * The filesystem driver has to offer the same deal as S3: a URL that grants one specific
 * operation on one specific object, for a limited time, to whoever holds it, with no session
 * involved. That is what makes the browser upload path identical on both drivers, and it is why
 * an unsigned request has to be refused rather than merely unauthenticated.
 *
 * The canonical string is versioned and has a fixed field order. Fields are newline-joined and
 * never optional-by-omission: an absent value is an empty field, so no two different claim sets
 * can produce the same string by shifting fields into each other.
 */

export type StorageUrlOperation = 'put' | 'get'

export type StorageUrlClaims = {
  operation: StorageUrlOperation
  key: string
  /** Unix seconds. */
  expiresAt: number
  contentLength?: number
  contentType?: string
  ifNoneMatch?: string
}

const signatureVersion = 'v1'

export const storageUrlParams = {
  operation: 'x-op',
  expiresAt: 'x-exp',
  contentLength: 'x-len',
  contentType: 'x-type',
  ifNoneMatch: 'x-inm',
  signature: 'x-sig',
} as const

export function canonicalStorageUrlString(claims: StorageUrlClaims) {
  return [
    signatureVersion,
    claims.operation,
    claims.key,
    String(claims.expiresAt),
    claims.contentLength === undefined ? '' : String(claims.contentLength),
    claims.contentType ?? '',
    claims.ifNoneMatch ?? '',
  ].join('\n')
}

export function signStorageUrl(signingKey: Buffer, claims: StorageUrlClaims) {
  return createHmac('sha256', signingKey).update(canonicalStorageUrlString(claims)).digest('hex')
}

export function verifyStorageUrlSignature(
  signingKey: Buffer,
  claims: StorageUrlClaims,
  signature: string,
) {
  const expected = Buffer.from(signStorageUrl(signingKey, claims), 'utf8')
  const provided = Buffer.from(signature, 'utf8')

  // Compare in constant time, but only once the lengths match: timingSafeEqual throws on a
  // length mismatch, and a wrong length is not a secret worth protecting.
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

export function storageUrlSearchParams(claims: StorageUrlClaims, signature: string) {
  const params = new URLSearchParams()
  params.set(storageUrlParams.operation, claims.operation)
  params.set(storageUrlParams.expiresAt, String(claims.expiresAt))
  if (claims.contentLength !== undefined) {
    params.set(storageUrlParams.contentLength, String(claims.contentLength))
  }
  if (claims.contentType !== undefined) params.set(storageUrlParams.contentType, claims.contentType)
  if (claims.ifNoneMatch !== undefined) params.set(storageUrlParams.ifNoneMatch, claims.ifNoneMatch)
  params.set(storageUrlParams.signature, signature)

  return params
}

/**
 * Rebuilds the claims a request is asserting. Returns `null` when the URL is not even shaped
 * like a signed one, so the caller can answer 403 without distinguishing "unsigned" from
 * "badly signed" — both are simply not authorised.
 */
export function readStorageUrlClaims(key: string, params: URLSearchParams) {
  const operation = params.get(storageUrlParams.operation)
  const expiresAt = Number(params.get(storageUrlParams.expiresAt))
  const signature = params.get(storageUrlParams.signature)

  if (operation !== 'put' && operation !== 'get') return null
  if (!signature || !Number.isInteger(expiresAt)) return null

  const rawContentLength = params.get(storageUrlParams.contentLength)
  const contentLength = rawContentLength === null ? undefined : Number(rawContentLength)
  if (contentLength !== undefined && !Number.isInteger(contentLength)) return null

  return {
    claims: {
      operation,
      key,
      expiresAt,
      ...(contentLength === undefined ? {} : { contentLength }),
      ...(params.get(storageUrlParams.contentType) === null
        ? {}
        : { contentType: params.get(storageUrlParams.contentType) as string }),
      ...(params.get(storageUrlParams.ifNoneMatch) === null
        ? {}
        : { ifNoneMatch: params.get(storageUrlParams.ifNoneMatch) as string }),
    } satisfies StorageUrlClaims,
    signature,
  }
}
