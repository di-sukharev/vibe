import { describe, expect, test } from 'bun:test'

import {
  canonicalStorageUrlString,
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
  test('keeps absent fields as empty slots so claims cannot shift into each other', () => {
    // Without fixed slots these two different claim sets would canonicalise identically.
    expect(
      canonicalStorageUrlString({ operation: 'get', key: 'a/b', expiresAt: 1, contentType: 'x' }),
    ).not.toBe(
      canonicalStorageUrlString({ operation: 'get', key: 'a/b', expiresAt: 1, ifNoneMatch: 'x' }),
    )
  })
})

describe('verifyStorageUrlSignature', () => {
  test('rejects a wrong-length signature without throwing', () => {
    expect(verifyStorageUrlSignature(signingKey, uploadClaims, '')).toBe(false)
    expect(verifyStorageUrlSignature(signingKey, uploadClaims, 'ab')).toBe(false)
  })
})
