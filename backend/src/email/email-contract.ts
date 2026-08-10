import { describe, expect, test } from 'bun:test'

import { EmailDeliveryError } from './errors'
import type { EmailDelivery, EmailDriverName, EmailMessage } from './port'
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
  driver: EmailDriverName
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
      try {
        await send()
      } catch (error) {
        return error
      }

      throw new Error('Expected the send to reject, but it resolved.')
    }

    test('identifies itself and reports that it can send', () => {
      const setup = createSetup()
      const delivery = setup.createDelivery(async () => setup.responses.accepted())

      expect({ driver: delivery.driver, configured: delivery.configured }).toEqual({
        driver: setup.driver,
        configured: true,
      })
    })

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

    test('throttling and provider outages are transient, so the outbox tries again', async () => {
      const setup = createSetup()

      for (const respond of [setup.responses.throttled, setup.responses.serverError]) {
        const error = await failureFrom(() =>
          setup
            .createDelivery(async () => respond())
            .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
        )

        expect(error).toBeInstanceOf(EmailDeliveryError)
        expect((error as EmailDeliveryError).kind).toBe('transient')
      }
    })

    test('a transport failure is transient', async () => {
      const setup = createSetup()
      const error = await failureFrom(() =>
        setup
          .createDelivery(async () => {
            throw new Error(`getaddrinfo ENOTFOUND for ${contractMessage.to}`)
          })
          .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
      )

      expect((error as EmailDeliveryError).kind).toBe('transient')
    })

    test('a revoked or not-yet-propagated key is transient, not a reason to burn the token', async () => {
      // A permanent classification here makes the notifier raise TerminalTaskError, which makes
      // deliverPasswordReset invalidate the reset token on the spot. A routine credential
      // rotation would then destroy the reset of every user who asked during the window.
      for (const status of [401, 403, 408]) {
        const setup = createSetup()
        const error = await failureFrom(() =>
          setup
            .createDelivery(async () => new Response('{}', { status }))
            .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
        )

        expect((error as EmailDeliveryError).kind).toBe('transient')
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

    test('an acceptance without a message id is transient rather than a silent success', async () => {
      // Otherwise a proxy returning a cheerful 200 would look exactly like a delivered email.
      const setup = createSetup()
      const error = await failureFrom(() =>
        setup
          .createDelivery(async () => setup.responses.acceptedWithoutId())
          .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
      )

      expect((error as EmailDeliveryError).kind).toBe('transient')
    })

    test('a body that is not JSON is transient', async () => {
      const setup = createSetup()
      const error = await failureFrom(() =>
        setup
          .createDelivery(async () => new Response('<html>gateway</html>', { status: 200 }))
          .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
      )

      expect((error as EmailDeliveryError).kind).toBe('transient')
    })

    test('a request slower than the timeout is transient', async () => {
      const setup = createSetup()
      const error = await failureFrom(() =>
        setup
          .createDelivery(async (_url, init) => {
            await new Promise((resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            })

            return setup.responses.accepted()
          }, 20)
          .send(contractMessage, { signal: AbortSignal.timeout(5_000) }),
      )

      expect((error as EmailDeliveryError).kind).toBe('transient')
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

    test('a caller aborting mid-flight cancels the request and leaves no listener behind', async () => {
      // The drain aborts a task at its deadline and then keeps running. A driver that left its
      // listener attached would leak one per attempt onto a signal that outlives the send.
      const setup = createSetup()
      const controller = new AbortController()
      const removed: string[] = []
      const originalRemove = controller.signal.removeEventListener.bind(controller.signal)
      controller.signal.removeEventListener = ((type: string, ...rest: never[]) => {
        removed.push(type)

        return (originalRemove as (type: string, ...rest: never[]) => void)(type, ...rest)
      }) as typeof controller.signal.removeEventListener

      const error = await failureFrom(() =>
        setup
          .createDelivery(async (_url, init) => {
            await new Promise((_resolve, reject) => {
              // Subscribe before aborting: the internal signal fires synchronously, so the other
              // order would miss the event and hang instead of failing.
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
              controller.abort()
            })

            return setup.responses.accepted()
          })
          .send(contractMessage, { signal: controller.signal }),
      )

      expect((error as EmailDeliveryError).kind).toBe('transient')
      expect(removed).toContain('abort')
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
