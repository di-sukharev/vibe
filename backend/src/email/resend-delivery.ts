import type { ResendEmailConfig } from './config'
import { EmailDeliveryError } from './errors'
import type { EmailDelivery } from './port'
import { sendProviderRequest, type FetchLike } from './provider-request'

/**
 * Resend, the provider for installs hosted outside Russia.
 *
 * A bearer token and one JSON POST, with no request signing. `Idempotency-Key` is deliberately
 * not sent - see the refusals in `port.ts`.
 */
export function createResendDelivery(
  config: ResendEmailConfig,
  fetchImpl: FetchLike = fetch,
): EmailDelivery {
  return {
    driver: 'resend',
    configured: true,
    async send(message, { signal }) {
      const body = await sendProviderRequest({
        provider: 'Resend',
        url: `${config.endpoint}/emails`,
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        }),
        fetchImpl,
        requestTimeoutMs: config.requestTimeoutMs,
        signal,
      })

      const id = messageId(body)
      if (!id) {
        // An accepted send always carries an id. Without one we cannot tell an acceptance from a
        // proxy's cheerful 200, so treat it as transient and let the outbox try again.
        throw new EmailDeliveryError('transient', 'Resend accepted the message without returning an id', {
          provider: 'Resend',
        })
      }

      console.log(`Email sent via Resend (id=${id}).`)
    },
  }
}

function messageId(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null

  const id = (body as Record<string, unknown>).id

  return typeof id === 'string' && id.length > 0 ? id : null
}
