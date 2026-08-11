import { expect, test } from 'bun:test'

import { Sha256 } from './sha256'

/**
 * Known-answer tests for the twelve lines of crypto the Postbox signature rests on.
 *
 * The HMAC branch is the whole SigV4 signing-key derivation, and nothing else offline touches it:
 * `postbox-delivery.test.ts` only asserts that an `authorization` header exists and names the
 * right scope, so a `digest()` that returned hex instead of bytes, or a key coercion that
 * silently changed meaning, would leave every test green and fail only against the real endpoint.
 */

async function digest(secret: unknown, chunks: (string | Uint8Array)[]) {
  const hash = new Sha256(secret)
  for (const chunk of chunks) hash.update(chunk)

  return Buffer.from(await hash.digest()).toString('hex')
}

test('the keyed mode derives the signing key from AWS’s own published test vector', async () => {
  // From the AWS Signature Version 4 test suite: the four chained HMACs that turn a secret key
  // into a request signing key. If any link mis-encodes, this value changes.
  let key: Uint8Array | string = 'AWS4wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'

  for (const step of ['20150830', 'us-east-1', 'iam', 'aws4_request']) {
    const round: Sha256 = new Sha256(key)
    round.update(step)
    key = await round.digest()
  }

  expect(Buffer.from(key).toString('hex')).toBe(
    'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9',
  )
})

test('a keyed digest differs from an unkeyed one, so the secret is not silently ignored', async () => {
  // The failure mode that would otherwise look fine: a constructor that dropped its argument
  // would still sign every request, just with a signature nobody can verify.
  expect(await digest('a-key', ['payload'])).not.toBe(await digest(undefined, ['payload']))
})
