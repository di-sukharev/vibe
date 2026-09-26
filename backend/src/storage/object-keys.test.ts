import { describe, expect, test } from 'bun:test'

import { StorageError } from './errors'
import { assertSafeObjectKey, createStorageObjectKey } from './object-keys'

describe('createStorageObjectKey', () => {
  test('builds a dated key with no room for user data in it, padding the month to sort', () => {
    const key = createStorageObjectKey({
      namespace: 'avatars',
      id: '019c0000-0000-7000-8000-000000000001',
      now: new Date('2026-01-05T12:00:00.000Z'),
    })

    expect(key).toBe('avatars/2026/01/019c0000-0000-7000-8000-000000000001')
  })

  test('refuses a namespace that could smuggle a path or user data into the key', () => {
    for (const namespace of ['', 'a/b', '../escape', 'user@example.com', 'av atars', '-lead']) {
      expect(() => createStorageObjectKey({ namespace })).toThrow(StorageError)
    }

    // Casing and surrounding space are normalised rather than rejected: they carry no meaning.
    expect(createStorageObjectKey({ namespace: '  Avatars  ', id: 'x' })).toContain('avatars/')
  })
})

describe('assertSafeObjectKey', () => {
  test('accepts ordinary relative keys', () => {
    expect(assertSafeObjectKey('avatars/2026/08/abc')).toBe('avatars/2026/08/abc')
    expect(assertSafeObjectKey('  avatars/2026/08/abc  ')).toBe('avatars/2026/08/abc')
  })

  test('rejects traversal, absolute, empty, and control-character keys as invalid keys', () => {
    // The kind matters to callers: `invalid_key` means a backend-generated key was malformed,
    // which is a bug to keep loud rather than a client error.
    for (const key of [
      '',
      '   ',
      '/avatars/a',
      'avatars/a/',
      'avatars/../../etc/passwd',
      'avatars/./a',
      'avatars//a',
      'avatars\\a',
      'avatars/a\u0000b',
      'avatars/a\u001Fb',
      'a'.repeat(1025),
    ]) {
      expect(() => assertSafeObjectKey(key)).toThrow(
        expect.objectContaining({ kind: 'invalid_key', name: 'StorageError' }),
      )
    }
  })
})
