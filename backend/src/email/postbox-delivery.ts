import { SignatureV4 } from '@smithy/signature-v4'

import type { PostboxEmailConfig } from './config'
import { EmailDeliveryError } from './errors'
import type { EmailDelivery } from './port'
import { sendProviderRequest, type FetchLike } from './provider-request'
import { Sha256 } from './sha256'

/** SESv2's send endpoint, which Postbox implements. */
const outboundEmailsPath = '/v2/email/outbound-emails'

/**
 * Yandex Cloud Postbox, the provider for installs hosted in Russia.
 *
 * Postbox speaks the Amazon SESv2 API, so the request is an SESv2 document signed with AWS
 * SigV4 under service `ses` and the Yandex region. That is why this driver reuses the signer the
 * AWS SDK already brings in for S3 storage rather than adding an SES client: the signature is the
 * only AWS-shaped part of the exchange, and everything else is one JSON POST.
 *
 * `@smithy/signature-v4` is pinned to an exact version in `backend/package.json`, and that is
 * load-bearing rather than lazy: any range wide enough to admit a newer release makes the package
 * manager hoist a second copy of the signer and its 5 MB `@smithy/core`, then push the AWS SDK's
 * already-resolved copies down into nineteen nested duplicates. Pinning to the version the SDK
 * has resolved keeps the install at one copy. Bump it when the SDK's own copy moves.
 */
export function createPostboxDelivery(
  config: PostboxEmailConfig,
  fetchImpl: FetchLike = fetch,
): EmailDelivery {
  const endpoint = new URL(`${config.endpoint}${outboundEmailsPath}`)
  const signer = new SignatureV4({
    service: 'ses',
    region: config.region,
    sha256: Sha256,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  })

  return {
    driver: 'postbox',
    configured: true,
    async send(message, { signal }) {
      const body = JSON.stringify({
        FromEmailAddress: config.from,
        Destination: { ToAddresses: [message.to] },
        ...(config.replyTo ? { ReplyToAddresses: [config.replyTo] } : {}),
        ...(config.configurationSet ? { ConfigurationSetName: config.configurationSet } : {}),
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: message.text, Charset: 'UTF-8' } },
          },
        },
      })

      const signed = await signer.sign({
        method: 'POST',
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        ...(endpoint.port ? { port: Number(endpoint.port) } : {}),
        path: endpoint.pathname,
        query: {},
        headers: {
          'content-type': 'application/json',
          // The signer signs the headers it is given and adds none of its own beyond the AWS
          // ones, so `host` has to be set here. Without it `host` drops out of SignedHeaders and
          // the endpoint rejects the signature - a failure that only shows up against the real
          // service, which is why `postbox-delivery.test.ts` asserts it.
          host: endpoint.host,
        },
        body,
      })

      const response = await sendProviderRequest({
        provider: 'Postbox',
        url: endpoint.toString(),
        headers: signed.headers,
        body,
        fetchImpl,
        requestTimeoutMs: config.requestTimeoutMs,
        signal,
      })

      const id = messageId(response)
      if (!id) {
        // An accepted send always carries a MessageId. Without one we cannot tell an acceptance
        // from a proxy's cheerful 200, so treat it as transient and let the outbox try again.
        throw new EmailDeliveryError('transient', 'Postbox accepted the message without returning an id', {
          provider: 'Postbox',
        })
      }

      console.log(`Email sent via Postbox (id=${id}).`)
    },
  }
}

function messageId(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null

  const id = (body as Record<string, unknown>).MessageId

  return typeof id === 'string' && id.length > 0 ? id : null
}
