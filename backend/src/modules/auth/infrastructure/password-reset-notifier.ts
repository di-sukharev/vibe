import type { EmailDelivery } from '../../../email/service'
import type { PasswordResetNotifier } from '../application/ports'

export function createPasswordResetNotifier(
  emailDelivery: EmailDelivery,
  webappOrigin: string,
): PasswordResetNotifier {
  return {
    configured: emailDelivery.configured,
    async sendPasswordReset({ email, expiresAt, token }, signal) {
      const resetUrl = new URL('/reset-password', webappOrigin)
      resetUrl.hash = new URLSearchParams({ token }).toString()
      await emailDelivery.send(
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
        { signal },
      )
    },
    async sendPasswordChanged({ email }, signal) {
      await emailDelivery.send(
        {
          to: email,
          subject: 'Your password was changed',
          text: 'Your password was changed and existing sessions were signed out. If this was not you, contact support immediately.',
        },
        { signal },
      )
    },
  }
}
