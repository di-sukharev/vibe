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

type ExpoSendResponse = {
  data: ExpoTicket | ExpoTicket[]
}

type ExpoReceiptResponse = {
  data: Record<string, ExpoReceipt>
}

export class ExpoPushTransientError extends Error {}
export class ExpoPushPermanentError extends Error {}

export type ExpoPushClientOptions = {
  accessToken?: string
  fetchImpl?: FetchLike
  requestTimeoutMs?: number
}

export function createExpoPushClient(options: ExpoPushClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    send: (messages: ExpoPushMessage[]) =>
      sendExpoPushMessages(messages, {
        accessToken: options.accessToken,
        fetchImpl,
        requestTimeoutMs: options.requestTimeoutMs,
      }),
    receipts: (ticketIds: string[]) =>
      getExpoPushReceipts(ticketIds, {
        accessToken: options.accessToken,
        fetchImpl,
        requestTimeoutMs: options.requestTimeoutMs,
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
    const response = await postJson<ExpoSendResponse>(
      fetchImpl,
      expoPushSendUrl,
      batch,
      options.accessToken,
      options.requestTimeoutMs,
    )
    const batchTickets = Array.isArray(response.data) ? response.data : [response.data]

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
    const response = await postJson<ExpoReceiptResponse>(
      fetchImpl,
      expoPushReceiptsUrl,
      { ids: batch },
      options.accessToken,
      options.requestTimeoutMs,
    )
    Object.assign(receipts, response.data)
  }

  return receipts
}

export function isDeviceNotRegisteredError(value: { details?: { error?: string }; status: string }) {
  return value.details?.error === 'DeviceNotRegistered'
}

async function postJson<T>(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
  accessToken: string | undefined,
  requestTimeoutMs = defaultExpoPushRequestTimeoutMs,
): Promise<T> {
  let response: Response
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs)

  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: headers(accessToken),
      body: JSON.stringify(body),
      signal: abortController.signal,
    })
  } catch (error) {
    throw new ExpoPushTransientError(error instanceof Error ? error.message : 'Expo push request failed')
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const message = `Expo push API returned ${response.status} ${response.statusText}`
    if (response.status === 429 || response.status >= 500) {
      throw new ExpoPushTransientError(message)
    }
    throw new ExpoPushPermanentError(message)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new ExpoPushTransientError('Expo push API returned invalid JSON')
  }
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
