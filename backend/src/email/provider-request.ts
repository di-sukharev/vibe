import { EmailDeliveryError } from './errors'

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type ProviderRequest = {
  /** Names the provider in error messages and log lines. */
  provider: string
  url: string
  headers: Record<string, string>
  /** Already serialised, because Postbox has to sign exactly these bytes. */
  body: string
  fetchImpl: FetchLike
  requestTimeoutMs: number
  signal: AbortSignal
}

/**
 * The one HTTP call both provider drivers make, and the one place a response becomes an
 * `EmailErrorKind`.
 *
 * Shared rather than duplicated because the classification is the part that has to agree: two
 * drivers that each decided for themselves what "retryable" means would both pass their own tests
 * and then diverge in production, where the difference is a reset email that either arrives late
 * or never arrives at all. The rule is:
 *
 * | a thrown fetch, our timeout, the caller aborting | transient |
 * | 408, 429, or any 5xx                             | transient |
 * | 401, 403, or 404                                 | transient |
 * | any other non-2xx                                | permanent |
 * | 2xx whose body will not parse                    | transient |
 *
 * The auth statuses look permanent and are not. A revoked, rotated, or not-yet-propagated key,
 * and a sending domain whose verification has not finished, arrive as 401 or 403, and both are
 * operator errors that fix themselves once the operator acts. Calling them
 * permanent would make a routine credential rotation destroy the reset tokens of everyone who
 * asked during the window: the notifier turns `permanent` into a `TerminalTaskError`, and
 * `deliverPasswordReset` invalidates the token the moment it sees one. Being wrong in this
 * direction costs four pointless attempts over half an hour; being wrong in the other costs a
 * user their password reset. That is the same reasoning `errors.ts` applies to `misconfigured`.
 *
 * The caller's signal is *linked into* an internal controller rather than passed through, so the
 * request is bounded by whichever fires first - the task deadline or this timeout - and the timer
 * and the listener are both released on every path.
 */
export async function sendProviderRequest({
  provider,
  url,
  headers,
  body,
  fetchImpl,
  requestTimeoutMs,
  signal,
}: ProviderRequest): Promise<unknown> {
  // Refused before the request rather than by relying on `fetch` to notice the aborted signal: a
  // caller that has already given up must not cost the provider a send it will never hear about,
  // and on an at-least-once retry that send would be a duplicate email.
  if (signal.aborted) {
    throw new EmailDeliveryError('transient', `${provider} was not called because the caller aborted`, {
      provider,
    })
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs)
  const abortFromCaller = () => abortController.abort()
  signal.addEventListener('abort', abortFromCaller, { once: true })

  try {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: abortController.signal,
      })
    } catch (error) {
      // The thrown message never reaches the error we raise: an aborted or failed fetch can name
      // the URL, and on some runtimes the request body, which is where the recipient lives - and
      // our message is persisted in `task_outbox.last_error`, which outlives the blanked payload.
      // It does go to the process log, because a DNS failure, a TLS failure and a bug in our own
      // header construction are otherwise indistinguishable forever. Logs are retained by both
      // hosting paths, so this is a deliberate trade rather than a free one: the runtime's message
      // names the URL, not the body, and it stays out of the row that outlives the payload.
      console.error(`${provider} transport failure:`, error)

      // The three reasons are named apart for the same diagnostic reason.
      const reason = signal.aborted
        ? 'before the caller aborted'
        : abortController.signal.aborted
          ? `within its ${requestTimeoutMs}ms timeout`
          : 'and the transport failed'

      throw new EmailDeliveryError('transient', `${provider} request did not complete ${reason}`, {
        provider,
      })
    }

    if (!response.ok) throw await providerResponseError(provider, response)

    try {
      return await response.json()
    } catch {
      throw new EmailDeliveryError(
        'transient',
        abortController.signal.aborted
          ? `${provider} response was cut short`
          : `${provider} returned a body that is not JSON`,
        { provider, status: response.status },
      )
    }
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abortFromCaller)
  }
}

/**
 * Statuses a later attempt can still succeed at, once an operator or the provider recovers.
 *
 * 404 belongs here with the auth statuses for the same reason: the endpoint is validated as an
 * origin and the driver appends its own path, so a 404 can never be caused by message content -
 * it means the install points somewhere wrong, which is an operator error, not a dead message.
 */
const transientStatuses = new Set([401, 403, 404, 408, 429])

async function providerResponseError(provider: string, response: Response) {
  const code = await providerErrorCode(response)
  const kind =
    transientStatuses.has(response.status) || response.status >= 500 ? 'transient' : 'permanent'

  return new EmailDeliveryError(
    kind,
    `${provider} rejected the message with ${response.status}${code ? ` (${code})` : ''}`,
    { provider, status: response.status, ...(code ? { code } : {}) },
  )
}

/**
 * Reads only the machine-readable error code, never the provider's prose.
 *
 * Both providers put the offending address into their human message - "Email address is not
 * verified: someone@example.com" - and this string ends up in `task_outbox.last_error`, which
 * outlives the blanked payload. The code alone is what an operator needs to look the failure up.
 */
async function providerErrorCode(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null)
  if (body === null || typeof body !== 'object') return null

  const record = body as Record<string, unknown>
  // `name` is Resend's code; `__type` and `code` are the SESv2 shapes Postbox inherits.
  const candidate = record.name ?? record.__type ?? record.code

  return typeof candidate === 'string' && /^[\w.#:-]{1,64}$/.test(candidate) ? candidate : null
}
