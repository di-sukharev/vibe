/**
 * Thrown by a handler that knows the work can never succeed, however many times it is tried -
 * a payload that will not validate, a resource that is gone for good.
 *
 * The drain retries everything else. That default is deliberate: a generic outbox cannot classify
 * failures from handlers it knows nothing about, and guessing wrong in the retryable direction
 * costs a few pointless attempts, while guessing wrong in the terminal direction silently drops
 * work the caller was promised. Handlers that *can* classify opt out by throwing this.
 */
export class TerminalTaskError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TerminalTaskError'
  }
}

export function isTerminalTaskError(error: unknown): error is TerminalTaskError {
  return error instanceof TerminalTaskError
}
