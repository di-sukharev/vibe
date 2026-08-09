/**
 * Storage-layer failures.
 *
 * These stay independent of HTTP: `backend/src/storage` is infrastructure shared by any product
 * module, and only the calling module knows what an invalid key or an oversized upload means for
 * its own contract. Callers translate; the storage layer only reports.
 */

export type StorageErrorKind =
  /** A key was empty, absolute, traversing, or otherwise unusable as an object name. */
  | 'invalid_key'
  /** A caller asked for something the driver refuses to sign: bad size, bad type, bad TTL. */
  | 'invalid_request'
  /** The driver is not usable with the current configuration. */
  | 'misconfigured'

export class StorageError extends Error {
  constructor(
    readonly kind: StorageErrorKind,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'StorageError'
  }
}
