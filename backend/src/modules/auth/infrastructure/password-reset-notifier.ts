import { isPermanentEmailError, type EmailDelivery, type EmailMessage } from '../../../email'
import { TerminalTaskError } from '../../../outbox'
import type { PasswordResetNotifier } from '../application/ports'

/**
 * Turns the two account emails into provider-neutral messages, and provider failures into outbox
 * outcomes.
 *
 * This is the seam where "the provider will never accept this address" becomes "this task can
 * never succeed": the email module knows nothing about tasks, and the drain retries everything
 * that is not a `TerminalTaskError`, so somebody has to translate. Auth infrastructure is the
 * right somebody - it already owns the other direction, queueing the task in the first place.
 */
export function createPasswordResetNotifier(
  emailDelivery: EmailDelivery,
  webappOrigin: string,
): PasswordResetNotifier {
  async function send(message: EmailMessage, signal: AbortSignal) {
    try {
      await emailDelivery.send(message, { signal })
    } catch (error) {
      if (isPermanentEmailError(error)) {
        // The provider's status and code are folded into the message, not left on `cause`: the
        // drain persists `error.message` alone into `task_outbox.last_error` and never walks the
        // chain. Without this, the rows that stay `failed` forever - the only ones an operator
        // still has to diagnose after the payload is blanked - would be the least informative
        // ones. `EmailDeliveryError` messages are PII-free by contract, so this is safe to keep.
        throw new TerminalTaskError(
          `The email provider rejected this message permanently: ${(error as Error).message}`,
          { cause: error },
        )
      }
      throw error
    }
  }

  return {
    configured: emailDelivery.configured,
    isPermanentFailure: (error) => error instanceof TerminalTaskError,
    async sendPasswordReset({ email, expiresAt, token }, signal) {
      const resetUrl = new URL('/reset-password', webappOrigin)
      resetUrl.hash = new URLSearchParams({ token }).toString()
      await send(
        {
          to: email,
          subject: 'Reset your password',
          text: [
            'Use the link below to reset your password:',
            resetUrl.toString(),
            `This link expires at ${expiresAt.toISOString()}.`,
            'If you did not request this change, you can ignore this email.',
          ].join('\n\n'),
        },
        signal,
      )
    },
    async sendPasswordChanged({ email }, signal) {
      await send(
        {
          to: email,
          subject: 'Your password was changed',
          text: 'Your password was changed and existing sessions were signed out. If this was not you, contact support immediately.',
        },
        signal,
      )
    },
  }
}
