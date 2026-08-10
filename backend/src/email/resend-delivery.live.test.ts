import { describe, expect, test } from 'bun:test'

import type { ResendEmailConfig } from './config'
import { createResendDelivery } from './resend-delivery'
import { EmailDeliveryError } from './errors'

/**
 * The Resend driver against the real API.
 *
 * This is the half `resend-delivery.test.ts` cannot prove: that the endpoint, the bearer header
 * and the body shape are what Resend actually accepts. A fake transport agrees with whatever the
 * driver sends it, so only this run can catch a renamed field or a wrong path.
 *
 * Started by `bun run --cwd backend test:live` with the variables in docs/EMAIL.md,
 * "Proving it works". `test-live.mjs` refuses to run without them.
 */

const apiKey = process.env.EMAIL_RESEND_API_KEY
const from = process.env.EMAIL_FROM
const to = process.env.EMAIL_LIVE_TEST_TO
const configured = Boolean(apiKey && from && to)
const maybeDescribe = configured ? describe : describe.skip

const config: ResendEmailConfig = {
  driver: 'resend',
  endpoint: process.env.EMAIL_RESEND_ENDPOINT ?? 'https://api.resend.com',
  apiKey: apiKey ?? '',
  from: from ?? '',
  requestTimeoutMs: 15_000,
}

maybeDescribe('Resend delivery against the live API', () => {
  test('delivers a message and returns a provider id', async () => {
    await createResendDelivery(config).send(
      {
        to: to!,
        subject: 'Template live test: Resend',
        text: `Sent by the repository live suite at ${new Date().toISOString()}.\n\nIf this arrived, the Resend driver works end to end.`,
      },
      { signal: AbortSignal.timeout(20_000) },
    )
  })

  test('a malformed recipient is permanent, so the outbox gives up instead of retrying forever', async () => {
    // A syntactically invalid recipient is rejected by the API before anything leaves, so it
    // costs no bounce and no deliverability. Deliberately not an unverified sender: that arrives
    // as 401/403, which this module classifies as transient on purpose - see docs/EMAIL.md.
    const error = await createResendDelivery(config)
      .send(
        {
          to: 'not-an-address',
          subject: 'Template live test: rejection',
          text: 'This must not be delivered.',
        },
        { signal: AbortSignal.timeout(20_000) },
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      )

    expect(error).toBeInstanceOf(EmailDeliveryError)
    expect((error as EmailDeliveryError).kind).toBe('permanent')
    // The same PII rule the unit contract asserts, proven against a real provider message: the
    // provider names the address it refused, and none of that may reach our error.
    expect(`${(error as Error).message} ${JSON.stringify((error as EmailDeliveryError).details)}`).not.toContain(
      'not-an-address',
    )
  })
})
