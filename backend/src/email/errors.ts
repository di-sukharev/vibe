/**
 * Email delivery failures.
 *
 * These stay independent of HTTP and of the task outbox: `backend/src/email` is infrastructure
 * shared by any product module, and only the caller knows what a rejected recipient means for its
 * own flow. Drivers classify; callers decide. `password-reset-notifier.ts` is the one place that
 * turns a `permanent` failure into a `TerminalTaskError`, because that is where "this provider
 * will never accept this address" becomes "this task can never succeed".
 *
 * The message is deliberately narrow: provider name, HTTP status, provider error code. Never the
 * recipient, the subject, or the body. Whatever escapes a handler lands in `task_outbox.last_error`,
 * which outlives the payload the drain blanks on purpose - so a chatty error message would put
 * back exactly the data the redaction removes. `email-contract.ts` asserts it against fixtures
 * carrying the real provider prose.
 */

export type EmailErrorKind =
  /** Retrying could work: a network failure, a timeout, throttling, or a provider 5xx. */
  | 'transient'
  /**
   * Retrying cannot work: a rejected recipient, an unverified sender, a malformed request, a
   * revoked key. The caller may compensate now rather than waiting for attempts to run out.
   */
  | 'permanent'
  /** This install is wrong. `env.ts` should have refused it at startup. */
  | 'misconfigured'

export class EmailDeliveryError extends Error {
  constructor(
    readonly kind: EmailErrorKind,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'EmailDeliveryError'
  }
}

/**
 * True only for failures the provider will never accept.
 *
 * `misconfigured` deliberately answers false. It follows the same reasoning as
 * `outbox/errors.ts`: guessing wrong in the retryable direction costs a few pointless attempts,
 * while guessing wrong in the terminal direction silently drops work a user was promised - and an
 * install whose configuration was fixed between attempts should recover on its own.
 */
export function isPermanentEmailError(error: unknown): boolean {
  return error instanceof EmailDeliveryError && error.kind === 'permanent'
}
