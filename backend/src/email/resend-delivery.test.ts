import { describe, expect, test } from 'bun:test'

import type { ResendEmailConfig } from './config'
import { contractMessage, describeEmailContract } from './email-contract'
import { createResendDelivery } from './resend-delivery'
import type { FetchLike } from './provider-request'

const config: ResendEmailConfig = {
  driver: 'resend',
  endpoint: 'https://api.resend.com',
  apiKey: 'test-api-key',
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

describeEmailContract('Resend delivery', () => ({
  driver: 'resend',
  from: config.from,
  replyTo: config.replyTo!,
  createDelivery: (fetchImpl, requestTimeoutMs) =>
    createResendDelivery({ ...config, ...(requestTimeoutMs ? { requestTimeoutMs } : {}) }, fetchImpl),
  responses: {
    accepted: () => jsonResponse(200, { id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c' }),
    // The provider's own prose names the recipient. That is the point: the contract asserts it
    // never reaches our error, and a real Resend body is the honest way to test that.
    rejected: () =>
      jsonResponse(422, {
        statusCode: 422,
        name: 'invalid_from_address',
        message: `The from address is not a valid address, so ${contractMessage.to} was not sent "${contractMessage.subject}"`,
      }),
    throttled: () => jsonResponse(429, { statusCode: 429, name: 'rate_limit_exceeded' }),
    serverError: () => jsonResponse(500, { statusCode: 500, name: 'application_error' }),
    acceptedWithoutId: () => jsonResponse(200, {}),
  },
  rejectedCode: 'invalid_from_address',
  parseRequest: ({ init }) => {
    const body = JSON.parse(String(init.body)) as Record<string, string>

    return {
      from: body.from!,
      to: body.to!,
      subject: body.subject!,
      text: body.text!,
      replyTo: body.reply_to,
    }
  },
}))

describe('Resend wire format', () => {
  async function capture(fetchImpl?: FetchLike) {
    const requests: { url: string; init: RequestInit }[] = []
    const transport: FetchLike =
      fetchImpl ??
      (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} })

        return jsonResponse(200, { id: 'message-id' })
      })

    await createResendDelivery(config, transport).send(contractMessage, {
      signal: AbortSignal.timeout(5_000),
    })

    return requests
  }

  test('posts to the send endpoint with a bearer token', async () => {
    const [request] = await capture()

    expect(request!.url).toBe('https://api.resend.com/emails')
    expect(request!.init.method).toBe('POST')
    expect(request!.init.headers).toMatchObject({
      authorization: 'Bearer test-api-key',
      'content-type': 'application/json',
    })
  })

  test('omits reply_to entirely when the install did not configure one', async () => {
    // Resend rejects a null reply_to, so an absent value has to be absent rather than empty.
    const requests: { init: RequestInit }[] = []
    const { replyTo: _replyTo, ...withoutReplyTo } = config

    await createResendDelivery(withoutReplyTo, async (_url, init) => {
      requests.push({ init: init ?? {} })

      return jsonResponse(200, { id: 'message-id' })
    }).send(contractMessage, { signal: AbortSignal.timeout(5_000) })

    expect(JSON.parse(String(requests[0]!.init.body))).not.toHaveProperty('reply_to')
  })
})
