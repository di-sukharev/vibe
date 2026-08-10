import type { EmailDelivery } from './port'

/**
 * Prints the message instead of sending it, so a developer can follow a password-reset link
 * locally without signing up to a provider. `env.ts` refuses it in production, because a
 * "delivery" that only writes to a log would leave users waiting for mail that never comes.
 *
 * The message only appears once something runs `outbox:drain`. `bun run dev` starts the scheduler
 * alongside the API for exactly this reason, so the link shows up within a minute of the request.
 */
export const consoleEmailDelivery: EmailDelivery = {
  driver: 'console',
  configured: true,
  send: async (message) => {
    console.log(
      [
        '',
        '--- email (EMAIL_DELIVERY=console) ---',
        `to: ${message.to}`,
        `subject: ${message.subject}`,
        '',
        message.text,
        '--- end email ---',
        '',
      ].join('\n'),
    )
  },
}
