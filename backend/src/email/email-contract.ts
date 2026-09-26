import { describe, expect, spyOn, test } from 'bun:test'

import { EmailDeliveryError } from './errors'
import type { EmailDelivery, EmailMessage } from './port'
import type { FetchLike } from './provider-request'

/**
 * The one behavioural contract both provider drivers must satisfy.
 *
 * It is executed once per driver against a programmable transport, and that is deliberate: the
 * part that has to agree between Postbox and Resend is how a response becomes a retry or a
 * give-up, and no live provider will produce a 429, a 5xx and a truncated body on demand. Each
 * driver supplies bodies its own API really returns, so the shared assertions run against
 * provider-shaped input rather than an invented one.
 *
 * The live tests are separate on purpose and prove the half this cannot: that a real endpoint
 * accepts what the driver signs and sends. Neither run is sufficient alone.
 *
 * Deliberately not named `*.test.ts`: it defines tests but does not own any, so it must not be
 * collected by a runner on its own.
 */

export const contractMessage: EmailMessage = {
  to: 'recipient@example.com',
  subject: 'Reset your password',
  text: 'Use the link below to reset your password:\n\nhttps://app.example.com/reset-password#token=abc',
}

export type CapturedRequest = { url: string; init: RequestInit }

export type EmailContractSetup = {
  /** The `from` the setup configured, so the contract can prove it survives the mapping. */
  from: string
  replyTo: string
  createDelivery(fetchImpl: FetchLike, requestTimeoutMs?: number): EmailDelivery
  /** Responses shaped like the ones this provider really returns. */
  responses: {
    accepted: () => Response
    /**
     * A rejection the provider will never accept a retry of - a malformed sender or recipient.
     * Deliberately not an *unverified* sender: providers report that as 401/403, which this
     * module classifies as transient on purpose, and mislabelling it here is how someone would
     * later "fix" the classification and burn every in-flight reset token.
     */
    rejected: () => Response
    throttled: () => Response
    serverError: () => Response
    /** 2xx that is syntactically fine but carries no message id. */
    acceptedWithoutId: () => Response
  }
  /** The machine-readable code inside `responses.rejected`, which must reach the error details. */
  rejectedCode: string
  /** Recovers the message from a captured request, proving the mapping loses nothing. */
  parseRequest(request: CapturedRequest): {
    from: string
    to: string
    subject: string
    text: string
    replyTo?: string
  }
}

export function describeEmailContract(name: string, createSetup: () => EmailContractSetup) {
  describe(name, () => {
    function capturing(respond: () => Response | Promise<Response>) {
      const requests: CapturedRequest[] = []
      const fetchImpl: FetchLike = async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} })

        return respond()
      }

      return { fetchImpl, requests }
    }

    async function failureFrom(send: () => Promise<void>) {
      // A transport failure is logged on purpose; keep it out of the test output.
      const transportLog = spyOn(console, 'error').mockImplementation(() => {})

      try {
        await send()
      } catch (error) {
        return error
      } finally {
        transportLog.mockRestore()
      }

      throw new Error('Expected the send to reject, but it resolved.')
    }

    test('the message survives the mapping to the provider request', async () => {
      const setup = createSetup()
      const { fetchImpl, requests } = capturing(() => setup.responses.accepted())

      await setup
        .createDelivery(fetchImpl)
        .send(contractMessage, { signal: AbortSignal.timeout(5_000) })

      expect(requests).toHaveLength(1)
      expect(setup.parseRequest(requests[0]!)).toEqual({
        from: setup.from,
        to: contractMessage.to,
        subject: contractMessage.subject,
        text: contractMessage.text,
        replyTo: setup.replyTo,
      })
    })

    test('throttling, outages, auth failures, and unconfirmed acceptances are transient', async () => {
      // 401 and 403 mean a revoked or not-yet-propagated key. A permanent classification makes
      // the notifier raise TerminalTaskError, and deliverPasswordReset then invalidates the reset
      // token on the spot: a routine credential rotation would destroy every reset in the window.
      // A 2xx without a message id could be a proxy's cheerful 200, not a delivered email.
      const setup = createSetup()
      const transports: Record<string, FetchLike> = {
        throttled: async () => setup.responses.throttled(),
        'server error': async () => setup.responses.serverError(),
        'transport failure': async () => {
          throw new Error('getaddrinfo ENOTFOUND')
        },
        'status 401': async () => new Response('{}', { status: 401 }),
        'status 403': async () => new Response('{}', { status: 403 }),
        'status 408': async () => new Response('{}', { status: 408 }),
        'accepted without a message id': async () => setup.responses.acceptedWithoutId(),
        'accepted with a body that is not JSON': async () =>
          new Response('<html>gateway</html>', { status: 200 }),
      }

      for (const [label, transport] of Object.entries(transports)) {
        const error = await failureFrom(() =>
          setup
            .createDelivery(transport)
            .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
        )

        expect([label, error instanceof EmailDeliveryError && error.kind]).toEqual([
          label,
          'transient',
        ])
      }
    })

    test('a rejection the provider will never accept is permanent, and carries its code', async () => {
      const setup = createSetup()
      const error = await failureFrom(() =>
        setup
          .createDelivery(async () => setup.responses.rejected())
          .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
      )

      expect(error).toBeInstanceOf(EmailDeliveryError)
      expect((error as EmailDeliveryError).kind).toBe('permanent')
      expect((error as EmailDeliveryError).details).toMatchObject({ code: setup.rejectedCode })
    })

    test('a request cut off by its timeout or by its caller is transient', async () => {
      // The drain aborts a task at its deadline, so the request has to stop at whichever of the
      // two fires first rather than hold the drain.
      const setup = createSetup()
      const caller = new AbortController()
      const hangUntilAborted = (afterSubscribing?: () => void): FetchLike => async (_url, init) => {
        await new Promise((_resolve, reject) => {
          // Subscribe before aborting: the internal signal fires synchronously, so the other
          // order would miss the event and hang instead of failing.
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          afterSubscribing?.()
        })

        return setup.responses.accepted()
      }

      const timedOut = await failureFrom(() =>
        setup
          .createDelivery(hangUntilAborted(), 20)
          .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
      )
      const cancelled = await failureFrom(() =>
        setup
          .createDelivery(hangUntilAborted(() => caller.abort()))
          .send(contractMessage, { signal: caller.signal }),
      )

      expect((timedOut as EmailDeliveryError).kind).toBe('transient')
      expect((cancelled as EmailDeliveryError).kind).toBe('transient')
    })

    test('an already-aborted caller is refused without troubling the provider', async () => {
      const setup = createSetup()
      const { fetchImpl, requests } = capturing(() => setup.responses.accepted())
      const controller = new AbortController()
      controller.abort()

      const error = await failureFrom(() =>
        setup.createDelivery(fetchImpl).send(contractMessage, { signal: controller.signal }),
      )

      expect((error as EmailDeliveryError).kind).toBe('transient')
      expect(requests).toHaveLength(0)
    })

    test('no failure ever names the recipient, the subject, or the body', async () => {
      // Whatever a handler throws lands in task_outbox.last_error, which outlives the payload the
      // drain blanks. A chatty provider message would put the redacted data straight back.
      const setup = createSetup()
      const responses = [
        setup.responses.rejected,
        setup.responses.throttled,
        setup.responses.serverError,
        setup.responses.acceptedWithoutId,
      ]

      // Including the transport-throw path: a runtime can put the URL, and on some runtimes the
      // request body, into the message it throws, which is why that message is never forwarded.
      const transports = [
        ...responses.map((respond) => async () => respond()),
        async () => {
          throw new Error(`connect failed while sending "${contractMessage.subject}" to ${contractMessage.to}: ${contractMessage.text}`)
        },
      ]

      for (const respond of transports) {
        const error = await failureFrom(() =>
          setup
            .createDelivery(respond)
            .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
        )

        const reported = `${(error as Error).message} ${JSON.stringify((error as EmailDeliveryError).details)}`
        expect(reported).not.toContain(contractMessage.to)
        expect(reported).not.toContain(contractMessage.subject)
        expect(reported).not.toContain(contractMessage.text)
      }
    })
  })
}
