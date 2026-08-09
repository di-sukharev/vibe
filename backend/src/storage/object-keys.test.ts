import { describe, expect, test } from 'bun:test'

import { StorageError } from './errors'
import { assertSafeObjectKey, createStorageObjectKey } from './object-keys'

describe('createStorageObjectKey', () => {
  test('builds a dated key with no room for user data in it', () => {
    const key = createStorageObjectKey({
      namespace: 'avatars',
      id: '019c0000-0000-7000-8000-000000000001',
      now: new Date('2026-08-09T12:00:00.000Z'),
    })

    expect(key).toBe('avatars/2026/08/019c0000-0000-7000-8000-000000000001')
  })

  test('pads the month so keys sort lexicographically', () => {
    expect(
      createStorageObjectKey({ namespace: 'avatars', id: 'x', now: new Date('2026-01-05T00:00:00Z') }),
    ).toBe('avatars/2026/01/x')
  })

  test('generates a random id when the caller has none', () => {
    const first = createStorageObjectKey({ namespace: 'avatars' })
    const second = createStorageObjectKey({ namespace: 'avatars' })

    expect(first).not.toBe(second)
    expect(first.startsWith('avatars/')).toBe(true)
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

  test('rejects traversal, absolute, empty, and control-character keys', () => {
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
      expect(() => assertSafeObjectKey(key)).toThrow(StorageError)
    }
  })

  test('reports an invalid key as a storage failure, not an HTTP status', () => {
    try {
      assertSafeObjectKey('../escape')
      throw new Error('expected a StorageError')
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError)
      expect((error as StorageError).kind).toBe('invalid_key')
    }
  })
})
