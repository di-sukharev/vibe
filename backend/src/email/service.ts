import type { AppEnv } from '../env'

export type EmailMessage = {
  to: string
  subject: string
  text: string
}

export type EmailDelivery = {
  configured: boolean
  send(message: EmailMessage, options: { signal: AbortSignal }): Promise<void>
}

export const disabledEmailDelivery: EmailDelivery = {
  configured: false,
  send: async () => undefined,
}

/**
 * The one place a delivery adapter is built, so the API and the `outbox:drain` job get the same
 * one. A drain runs under `cron.ts`, which never calls `createApp`, so a default parameter on
 * `createApp` could never have reached it.
 *
 * No provider ships with the template. Wire yours here: return an adapter with
 * `configured: true` whose `send` honours the `AbortSignal`.
 *
 * That is half of it. Reset emails are queued in `task_outbox` and only leave once something
 * runs `outbox:drain`, and both runner collections ship empty - so an install that wires a
 * provider and stops here accepts every request, accumulates rows, and sends nothing. Pick a
 * runner in docs/BACKGROUND_JOBS.md, "Running the drain".
 */
export function createEmailDelivery(env: AppEnv): EmailDelivery {
  if (env.EMAIL_DELIVERY === 'console') return consoleEmailDelivery

  return disabledEmailDelivery
}

/**
 * Prints the message instead of sending it, so a developer can follow a password-reset link
 * locally without signing up to a provider. `env.ts` refuses it in production, because a
 * "delivery" that only writes to a log would leave users waiting for mail that never comes.
 */
const consoleEmailDelivery: EmailDelivery = {
  configured: true,
  send: async (message) => {
    console.log(
      ['', '--- email (EMAIL_DELIVERY=console) ---', `to: ${message.to}`, `subject: ${message.subject}`, '', message.text, '--- end email ---', ''].join(
        '\n',
      ),
    )
  },
}
