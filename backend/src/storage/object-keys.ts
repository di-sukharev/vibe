import { randomUUID } from 'node:crypto'

import { StorageError } from './errors'

const maxObjectKeyLength = 1024

export type CreateObjectKeyInput = {
  namespace: string
  id?: string
  now?: Date
}

/**
 * Builds `<namespace>/<yyyy>/<mm>/<uuid>`.
 *
 * The shape is the privacy rule made structural: there is nowhere to put an email, a display
 * name, a record id, or an original filename, so a key cannot leak one by accident. Ownership
 * lives in PostgreSQL, which is also the only place that can enforce it. The date segments exist
 * so a bucket stays browsable and lifecycle rules can target a prefix.
 */
export function createStorageObjectKey(input: CreateObjectKeyInput) {
  const now = input.now ?? new Date()
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')

  return assertSafeObjectKey(
    [assertSafeNamespace(input.namespace), year, month, input.id ?? randomUUID()].join('/'),
  )
}

export function assertSafeObjectKey(key: string) {
  const normalizedKey = key.trim()

  if (!normalizedKey || normalizedKey.length > maxObjectKeyLength) {
    throw new StorageError('invalid_key', 'Storage object key is empty or too long')
  }

  if (normalizedKey.startsWith('/') || normalizedKey.endsWith('/')) {
    throw new StorageError('invalid_key', 'Storage object key must be relative')
  }

  if (/[\u0000-\u001F\\]/.test(normalizedKey)) {
    throw new StorageError('invalid_key', 'Storage object key contains unsupported characters')
  }

  if (
    normalizedKey.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new StorageError('invalid_key', 'Storage object key contains an unsafe path segment')
  }

  return normalizedKey
}

function assertSafeNamespace(namespace: string) {
  const sanitized = namespace.trim().toLowerCase()

  if (!/^[a-z0-9][a-z0-9-]*$/.test(sanitized)) {
    throw new StorageError(
      'invalid_key',
      'Storage namespace must be lowercase letters, digits, and dashes',
    )
  }

  return sanitized
}
