import { describe, expect, test } from 'bun:test'

import type { PostboxEmailConfig } from './config'
import { contractMessage, describeEmailContract } from './email-contract'
import { createPostboxDelivery } from './postbox-delivery'
import type { FetchLike } from './provider-request'

const config: PostboxEmailConfig = {
  driver: 'postbox',
  endpoint: 'https://postbox.cloud.yandex.net',
  region: 'ru-central1',
  accessKeyId: 'YCAJEtest',
  secretAccessKey: 'YCPtest',
  from: 'Example <no-reply@example.com>',
  replyTo: 'support@example.com',
  requestTimeoutMs: 10_000,
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type SesRequestBody = {
  FromEmailAddress: string
  Destination: { ToAddresses: string[] }
  ReplyToAddresses?: string[]
  ConfigurationSetName?: string
  Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string } } } }
}

describeEmailContract('Postbox delivery', () => ({
  driver: 'postbox',
  from: config.from,
  replyTo: config.replyTo!,
  createDelivery: (fetchImpl, requestTimeoutMs) =>
    createPostboxDelivery({ ...config, ...(requestTimeoutMs ? { requestTimeoutMs } : {}) }, fetchImpl),
  responses: {
    accepted: () => jsonResponse(200, { MessageId: '0000019a-postbox-message-id' }),
    // A real SESv2 rejection names the address it refused. The contract asserts that string never
    // reaches our error, so the fixture has to contain it.
    rejected: () =>
      jsonResponse(400, {
        __type: 'MessageRejected',
        message: `Local address contains control or whitespace: ${contractMessage.to} ("${contractMessage.subject}")`,
      }),
    throttled: () => jsonResponse(429, { __type: 'TooManyRequestsException' }),
    serverError: () => jsonResponse(500, { __type: 'InternalServiceErrorException' }),
    acceptedWithoutId: () => jsonResponse(200, {}),
  },
  rejectedCode: 'MessageRejected',
  parseRequest: ({ init }) => {
    const body = JSON.parse(String(init.body)) as SesRequestBody

    return {
      from: body.FromEmailAddress,
      to: body.Destination.ToAddresses[0]!,
      subject: body.Content.Simple.Subject.Data,
      text: body.Content.Simple.Body.Text.Data,
      replyTo: body.ReplyToAddresses?.[0],
    }
  },
}))

describe('Postbox wire format', () => {
  async function capture(overrides: Partial<PostboxEmailConfig> = {}) {
    const requests: { url: string; init: RequestInit }[] = []
    const transport: FetchLike = async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} })

      return jsonResponse(200, { MessageId: 'message-id' })
    }

    await createPostboxDelivery({ ...config, ...overrides }, transport).send(contractMessage, {
      signal: AbortSignal.timeout(5_000),
    })

    return requests[0]!
  }

  test('posts an SESv2 document to the outbound-emails endpoint', async () => {
    const request = await capture()

    expect(request.url).toBe('https://postbox.cloud.yandex.net/v2/email/outbound-emails')
    expect(request.init.method).toBe('POST')
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      FromEmailAddress: config.from,
      Destination: { ToAddresses: [contractMessage.to] },
      Content: {
        Simple: {
          Subject: { Data: contractMessage.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: contractMessage.text, Charset: 'UTF-8' } },
        },
      },
    })
  })

  test('signs the request for the ses service in the configured region', async () => {
    const request = await capture()
    const headers = request.init.headers as Record<string, string>

    expect(Object.keys(headers)).toEqual(
      expect.arrayContaining(['authorization', 'x-amz-date', 'x-amz-content-sha256', 'host']),
    )
    expect(headers.authorization).toContain('/ru-central1/ses/aws4_request')
  })

  test('signs the host header, which the signer does not add on its own', async () => {
    // Omitting it is silent locally and fatal against the real endpoint: `host` drops out of
    // SignedHeaders and Postbox rejects the signature. This is the assertion that catches it.
    const request = await capture()
    const headers = request.init.headers as Record<string, string>
    const signedHeaders = /SignedHeaders=([^,]*)/.exec(headers.authorization!)?.[1]?.split(';')

    expect(headers.host).toBe('postbox.cloud.yandex.net')
    expect(signedHeaders).toContain('host')
  })

  test('carries the port into the signed host for a non-default endpoint', async () => {
    // A signature over a host without its port does not verify, so a proxied or test endpoint
    // would fail in a way that looks like bad credentials.
    const request = await capture({ endpoint: 'https://postbox.internal:8443' })
    const headers = request.init.headers as Record<string, string>

    expect(headers.host).toBe('postbox.internal:8443')
    expect(request.url).toBe('https://postbox.internal:8443/v2/email/outbound-emails')
  })

  test('passes a configuration set through when the install has one', async () => {
    const request = await capture({ configurationSet: 'transactional' })

    expect(JSON.parse(String(request.init.body))).toMatchObject({
      ConfigurationSetName: 'transactional',
    })
  })
})
