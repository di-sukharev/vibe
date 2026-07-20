export type UsersFailureKind = 'forbidden' | 'not_found' | 'role_conflict'

export class UsersFailure extends Error {
  constructor(
    public readonly kind: UsersFailureKind,
    message: string,
  ) {
    super(message)
  }
}
