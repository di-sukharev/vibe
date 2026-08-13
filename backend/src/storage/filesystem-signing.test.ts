import { describe, expect, test } from 'bun:test'

import {
  canonicalStorageUrlString,
  readStorageUrlClaims,
  signStorageUrl,
  storageUrlParams,
  storageUrlSearchParams,
  verifyStorageUrlSignature,
  type StorageUrlClaims,
} from './filesystem-signing'

const signingKey = Buffer.alloc(32, 7)

const uploadClaims: StorageUrlClaims = {
  operation: 'put',
  key: 'avatars/2026/08/abc',
  expiresAt: 1_786_000_000,
  contentLength: 70,
  contentType: 'image/png',
  ifNoneMatch: '*',
}

describe('canonicalStorageUrlString', () => {
  test('is a fixed, versioned field order', () => {
    expect(canonicalStorageUrlString(uploadClaims)).toBe(
      'v1\nput\navatars/2026/08/abc\n1786000000\n70\nimage/png\n*',
    )
  })

  test('keeps absent fields as empty slots so claims cannot shift into each other', () => {
    expect(
      canonicalStorageUrlString({ operation: 'get', key: 'a/b', expiresAt: 1 }),
    ).toBe('v1\nget\na/b\n1\n\n\n')

    // Without fixed slots these two different claim sets would canonicalise identically.
    expect(
      canonicalStorageUrlString({ operation: 'get', key: 'a/b', expiresAt: 1, contentType: 'x' }),
    ).not.toBe(
      canonicalStorageUrlString({ operation: 'get', key: 'a/b', expiresAt: 1, ifNoneMatch: 'x' }),
    )
  })
})

describe('signStorageUrl', () => {
  test('is a stable golden vector, so a signing change cannot pass unnoticed', () => {
    // Pinned to a literal, not to another call of the same function: comparing the signer with
    // itself passes whatever the algorithm becomes, which is the one regression this test exists
    // to catch. Every URL signed before a change that alters this value stops verifying.
    expect(signStorageUrl(signingKey, uploadClaims)).toBe(
      'f0bb9b65978cded2455fbb8d1210438fba1d4d44138652e5b4d7eb3461bcfb42',
    )
  })

  test('changes when any single claim changes', () => {
    const signature = signStorageUrl(signingKey, uploadClaims)

    for (const mutated of [
      { ...uploadClaims, operation: 'get' as const },
      { ...uploadClaims, key: 'avatars/2026/08/other' },
      { ...uploadClaims, expiresAt: uploadClaims.expiresAt + 1 },
      { ...uploadClaims, contentLength: 71 },
      { ...uploadClaims, contentType: 'image/jpeg' },
      { ...uploadClaims, ifNoneMatch: undefined },
    ]) {
      expect(signStorageUrl(signingKey, mutated)).not.toBe(signature)
    }
  })

  test('changes when the signing key changes', () => {
    expect(signStorageUrl(Buffer.alloc(32, 8), uploadClaims)).not.toBe(
      signStorageUrl(signingKey, uploadClaims),
    )
  })
})

describe('verifyStorageUrlSignature', () => {
  test('accepts its own signature and rejects everything else', () => {
    const signature = signStorageUrl(signingKey, uploadClaims)

    expect(verifyStorageUrlSignature(signingKey, uploadClaims, signature)).toBe(true)
    expect(verifyStorageUrlSignature(signingKey, uploadClaims, 'f'.repeat(64))).toBe(false)
    expect(
      verifyStorageUrlSignature(signingKey, { ...uploadClaims, contentLength: 71 }, signature),
    ).toBe(false)
  })

  test('rejects a wrong-length signature without throwing', () => {
    expect(verifyStorageUrlSignature(signingKey, uploadClaims, '')).toBe(false)
    expect(verifyStorageUrlSignature(signingKey, uploadClaims, 'ab')).toBe(false)
  })
})

describe('readStorageUrlClaims', () => {
  test('round-trips the claims a signed URL carries', () => {
    const signature = signStorageUrl(signingKey, uploadClaims)
    const params = storageUrlSearchParams(uploadClaims, signature)

    const parsed = readStorageUrlClaims(uploadClaims.key, params)

    expect(parsed?.signature).toBe(signature)
    expect(parsed?.claims).toEqual(uploadClaims)
    expect(verifyStorageUrlSignature(signingKey, parsed!.claims, parsed!.signature)).toBe(true)
  })

  test('returns null for anything not shaped like a signed URL', () => {
    const complete = storageUrlSearchParams(uploadClaims, signStorageUrl(signingKey, uploadClaims))

    expect(readStorageUrlClaims('a/b', new URLSearchParams())).toBeNull()

    for (const removed of [storageUrlParams.signature, storageUrlParams.operation]) {
      const params = new URLSearchParams(complete)
      params.delete(removed)
      expect(readStorageUrlClaims(uploadClaims.key, params)).toBeNull()
    }

    for (const [name, value] of [
      [storageUrlParams.operation, 'delete'],
      [storageUrlParams.expiresAt, 'soon'],
      [storageUrlParams.contentLength, 'lots'],
    ] as const) {
      const params = new URLSearchParams(complete)
      params.set(name, value)
      expect(readStorageUrlClaims(uploadClaims.key, params)).toBeNull()
    }
  })
})
