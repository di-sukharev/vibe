export type UploadsFailureKind =
  /** No such upload for this user. Also covers another user's upload, on purpose. */
  | 'not_found'
  /** The signed URL window closed before finalize arrived. */
  | 'expired'
  /** Nothing is stored at the key yet: the browser never finished the PUT. */
  | 'not_completed'
  /** Something is stored, but it is not what was declared. */
  | 'rejected'

export class UploadsFailure extends Error {
  constructor(
    readonly kind: UploadsFailureKind,
    message: string,
  ) {
    super(message)
    this.name = 'UploadsFailure'
  }
}
