export class NotificationFailure extends Error {
  constructor(public readonly kind: 'no_active_token' | 'rate_limited', message: string) { super(message) }
}
