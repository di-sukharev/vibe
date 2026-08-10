import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import type { PostboxEmailConfig, ResendEmailConfig } from './config'
import { createPostboxDelivery } from './postbox-delivery'
import { createResendDelivery } from './resend-delivery'

/**
 * Both drivers against a real HTTP server, over the real global `fetch`.
 *
 * The contract suite injects a transport, so it proves what the driver *decides* but never that
 * the runtime sends what the driver built. This closes that gap without an account: a wrong
 * method, a header the runtime strips, or a body that never reaches the wire shows up here. It is
 * the cheapest possible check on the one thing the live suites would otherwise own alone.
 *
 * Not a `*.live.test.ts`: it starts its own server on an ephemeral port and needs nothing
 * installed, so it belongs in the unit run.
 */

type CapturedRequest = { method: string; path: string; headers: Record<string, string>; body: string }

let server: ReturnType<typeof Bun.serve>
let received: CapturedRequest[] = []

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      received.push({
        method: request.method,
        path: url.pathname,
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.text(),
      })

      return Response.json({ MessageId: 'loopback-id', id: 'loopback-id' })
    },
  })
})

afterAll(() => {
  server.stop(true)
})

function endpoint() {
  return `http://127.0.0.1:${server.port}`
}

describe('the runtime sends what the driver built', () => {
  test('Postbox: the signed headers survive the real fetch, host included', async () => {
    received = []
    const config: PostboxEmailConfig = {
      driver: 'postbox',
      endpoint: endpoint(),
      region: 'ru-central1',
      accessKeyId: 'YCAJEtest',
      secretAccessKey: 'YCPtest',
      from: 'Example <no-reply@example.com>',
      requestTimeoutMs: 5_000,
    }

    await createPostboxDelivery(config).send(
      { to: 'user@example.com', subject: 'Reset', text: 'link' },
      { signal: AbortSignal.timeout(10_000) },
    )

    const request = received[0]!
    expect({ method: request.method, path: request.path }).toEqual({
      method: 'POST',
      path: '/v2/email/outbound-emails',
    })
    // The signature covers `host`, so the value that arrives has to be the value that was signed.
    // A runtime that rewrote or dropped it would make every live send fail with a signature error.
    const signedHeaders = /SignedHeaders=([^,]*)/.exec(request.headers.authorization!)?.[1]!.split(';')
    expect(signedHeaders).toContain('host')
    expect(request.headers.host).toBe(`127.0.0.1:${server.port}`)
    expect(request.headers['x-amz-content-sha256']).toBe(
      new Bun.CryptoHasher('sha256').update(request.body).digest('hex'),
    )
    expect(JSON.parse(request.body)).toMatchObject({
      Destination: { ToAddresses: ['user@example.com'] },
    })
  })

  test('Resend: the bearer token and the body reach the wire', async () => {
    received = []
    const config: ResendEmailConfig = {
      driver: 'resend',
      endpoint: endpoint(),
      apiKey: 'test-api-key',
      from: 'no-reply@example.com',
      requestTimeoutMs: 5_000,
    }

    await createResendDelivery(config).send(
      { to: 'user@example.com', subject: 'Reset', text: 'link' },
      { signal: AbortSignal.timeout(10_000) },
    )

    const request = received[0]!
    expect({ method: request.method, path: request.path }).toEqual({ method: 'POST', path: '/emails' })
    expect(request.headers.authorization).toBe('Bearer test-api-key')
    expect(JSON.parse(request.body)).toMatchObject({ to: 'user@example.com', text: 'link' })
  })
})
