const expoPushSendUrl = 'https://exp.host/--/api/v2/push/send'
const expoPushReceiptsUrl = 'https://exp.host/--/api/v2/push/getReceipts'
export const defaultExpoPushRequestTimeoutMs = 30_000
const maxSendBatchSize = 100
const maxReceiptBatchSize = 1000

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type ExpoPushMessage = {
  body: string
  data?: Record<string, unknown>
  sound?: 'default' | null
  title: string
  to: string
}

export type ExpoTicket =
  | {
      id: string
      status: 'ok'
    }
  | {
      details?: {
        error?: string
      }
      message?: string
      status: 'error'
    }

export type ExpoReceipt =
  | {
      status: 'ok'
    }
  | {
      details?: {
        error?: string
      }
      message?: string
      status: 'error'
    }

export class ExpoPushTransientError extends Error {}
export class ExpoPushPermanentError extends Error {}

export type ExpoPushClientOptions = {
  accessToken?: string
  fetchImpl?: FetchLike
  requestTimeoutMs?: number
  signal?: AbortSignal
}

export function createExpoPushClient(options: ExpoPushClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    send: (messages: ExpoPushMessage[]) =>
      sendExpoPushMessages(messages, {
        accessToken: options.accessToken,
        fetchImpl,
        requestTimeoutMs: options.requestTimeoutMs,
        signal: options.signal,
      }),
    receipts: (ticketIds: string[]) =>
      getExpoPushReceipts(ticketIds, {
        accessToken: options.accessToken,
        fetchImpl,
        requestTimeoutMs: options.requestTimeoutMs,
        signal: options.signal,
      }),
  }
}

export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
  options: ExpoPushClientOptions = {},
): Promise<ExpoTicket[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const tickets: ExpoTicket[] = []

  for (const batch of chunk(messages, maxSendBatchSize)) {
    const response = await postJson(
      fetchImpl,
      expoPushSendUrl,
      batch,
      options.accessToken,
      options.requestTimeoutMs,
      options.signal,
    )
    const batchTickets = parseExpoTickets(response)

    if (batchTickets.length !== batch.length) {
      throw new ExpoPushTransientError('Expo push response did not match request batch size')
    }

    tickets.push(...batchTickets)
  }

  return tickets
}

export async function getExpoPushReceipts(
  ticketIds: string[],
  options: ExpoPushClientOptions = {},
): Promise<Record<string, ExpoReceipt>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const receipts: Record<string, ExpoReceipt> = {}

  for (const batch of chunk(ticketIds, maxReceiptBatchSize)) {
    const response = await postJson(
      fetchImpl,
      expoPushReceiptsUrl,
      { ids: batch },
      options.accessToken,
      options.requestTimeoutMs,
      options.signal,
    )
    Object.assign(receipts, parseExpoReceipts(response))
  }

  return receipts
}

export function isDeviceNotRegisteredError(value: { details?: { error?: string }; status: string }) {
  return value.details?.error === 'DeviceNotRegistered'
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
  accessToken: string | undefined,
  requestTimeoutMs = defaultExpoPushRequestTimeoutMs,
  signal?: AbortSignal,
): Promise<unknown> {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs)
  const abortFromCaller = () => abortController.abort()
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: headers(accessToken),
        body: JSON.stringify(body),
        signal: abortController.signal,
      })
    } catch (error) {
      throw new ExpoPushTransientError(
        error instanceof Error ? error.message : 'Expo push request failed',
      )
    }

    if (!response.ok) {
      const message = `Expo push API returned ${response.status} ${response.statusText}`
      if (response.status === 429 || response.status >= 500) {
        throw new ExpoPushTransientError(message)
      }
      throw new ExpoPushPermanentError(message)
    }

    try {
      return await response.json()
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new ExpoPushTransientError(
          error instanceof Error ? error.message : 'Expo push request failed',
        )
      }
      throw new ExpoPushTransientError('Expo push API returned invalid JSON')
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

function parseExpoTickets(value: unknown): ExpoTicket[] {
  if (!isRecord(value) || !('data' in value)) throw invalidExpoResponse()
  const candidates = Array.isArray(value.data) ? value.data : [value.data]
  if (!candidates.every(isExpoTicket)) throw invalidExpoResponse()
  return candidates
}

function parseExpoReceipts(value: unknown): Record<string, ExpoReceipt> {
  if (!isRecord(value) || !isRecord(value.data)) throw invalidExpoResponse()
  if (!Object.values(value.data).every(isExpoReceipt)) throw invalidExpoResponse()
  return value.data as Record<string, ExpoReceipt>
}

function isExpoTicket(value: unknown): value is ExpoTicket {
  if (!isRecord(value)) return false
  if (value.status === 'ok') return typeof value.id === 'string' && value.id.length > 0
  return value.status === 'error' && hasValidProviderErrorFields(value)
}

function isExpoReceipt(value: unknown): value is ExpoReceipt {
  if (!isRecord(value)) return false
  if (value.status === 'ok') return true
  return value.status === 'error' && hasValidProviderErrorFields(value)
}

function hasValidProviderErrorFields(value: Record<string, unknown>) {
  if (value.message !== undefined && typeof value.message !== 'string') return false
  if (value.details === undefined) return true
  return isRecord(value.details) &&
    (value.details.error === undefined || typeof value.details.error === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidExpoResponse() {
  return new ExpoPushTransientError('Expo push API returned an invalid response shape')
}

function headers(accessToken: string | undefined) {
  const headers = new Headers({
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  })

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return headers
}

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}
