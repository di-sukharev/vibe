import { describe, expect, test } from 'bun:test'

import type { PostboxEmailConfig } from './config'
import { EmailDeliveryError } from './errors'
import { createPostboxDelivery } from './postbox-delivery'

/**
 * The Postbox driver against the real Yandex Cloud endpoint.
 *
 * This is the run that proves the SigV4 signature. A wrong service, a wrong region, or a `host`
 * header missing from `SignedHeaders` all produce a valid-looking request that only the real
 * endpoint rejects - `postbox-delivery.test.ts` can assert the shape of the signature but never
 * that Postbox accepts it.
 *
 * Started by `bun run --cwd backend test:live` with the variables in docs/EMAIL.md,
 * "Proving it works". `test-live.mjs` refuses to run without them.
 */

const accessKeyId = process.env.EMAIL_POSTBOX_ACCESS_KEY_ID
const secretAccessKey = process.env.EMAIL_POSTBOX_SECRET_ACCESS_KEY
const from = process.env.EMAIL_FROM
const to = process.env.EMAIL_LIVE_TEST_TO
const configured = Boolean(accessKeyId && secretAccessKey && from && to)
const maybeDescribe = configured ? describe : describe.skip

const config: PostboxEmailConfig = {
  driver: 'postbox',
  endpoint: process.env.EMAIL_POSTBOX_ENDPOINT ?? 'https://postbox.cloud.yandex.net',
  region: process.env.EMAIL_POSTBOX_REGION ?? 'ru-central1',
  accessKeyId: accessKeyId ?? '',
  secretAccessKey: secretAccessKey ?? '',
  from: from ?? '',
  requestTimeoutMs: 15_000,
}

maybeDescribe('Postbox delivery against the live API', () => {
  test('the signed request is accepted and returns a provider id', async () => {
    await createPostboxDelivery(config).send(
      {
        to: to!,
        subject: 'Template live test: Postbox',
        text: `Sent by the repository live suite at ${new Date().toISOString()}.\n\nIf this arrived, the SigV4 signature and the SESv2 body are both right.`,
      },
      { signal: AbortSignal.timeout(20_000) },
    )
  })

  test('a malformed recipient is permanent, so the outbox gives up instead of retrying forever', async () => {
    // A syntactically invalid recipient is rejected by the API before anything leaves, so it
    // costs no bounce and no deliverability. Deliberately not an unverified sender: that arrives
    // as 401/403, which this module classifies as transient on purpose - see docs/EMAIL.md.
    const error = await createPostboxDelivery(config)
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
