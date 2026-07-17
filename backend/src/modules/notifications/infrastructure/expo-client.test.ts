import { describe, expect, test } from 'bun:test'

import {
  ExpoPushPermanentError,
  ExpoPushTransientError,
  getExpoPushReceipts,
  isDeviceNotRegisteredError,
  sendExpoPushMessages,
} from './expo-client'

describe('Expo push client', () => {
  test('chunks send requests and attaches the optional Expo access token', async () => {
    const calls: Array<{ authorization: string | null; body: unknown; url: string }> = []
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        authorization: new Headers(init?.headers).get('Authorization'),
        body: JSON.parse(String(init?.body)),
        url: String(input),
      })

      const messages = JSON.parse(String(init?.body)) as unknown[]
      return json({
        data: messages.map((_, index) => ({
          id: `ticket-${calls.length}-${index}`,
          status: 'ok',
        })),
      })
    }

    const tickets = await sendExpoPushMessages(
      Array.from({ length: 101 }, (_, index) => ({
        body: `Body ${index}`,
        title: `Title ${index}`,
        to: `ExponentPushToken[token-${index}]`,
      })),
      { accessToken: 'expo-access-token', fetchImpl },
    )

    expect(tickets).toHaveLength(101)
    expect(calls).toHaveLength(2)
    expect((calls[0]?.body as unknown[]).length).toBe(100)
    expect((calls[1]?.body as unknown[]).length).toBe(1)
    expect(calls[0]?.authorization).toBe('Bearer expo-access-token')
  })

  test('classifies send API failures by retryability', async () => {
    await expect(
      sendExpoPushMessages(
        [{ body: 'Body', title: 'Title', to: 'ExponentPushToken[token]' }],
        {
          fetchImpl: async () => new Response('{}', { status: 429, statusText: 'Too Many Requests' }),
        },
      ),
    ).rejects.toBeInstanceOf(ExpoPushTransientError)

    await expect(
      sendExpoPushMessages(
        [{ body: 'Body', title: 'Title', to: 'ExponentPushToken[token]' }],
        {
          fetchImpl: async () => new Response('{}', { status: 400, statusText: 'Bad Request' }),
        },
      ),
    ).rejects.toBeInstanceOf(ExpoPushPermanentError)
  })

  test('times out stalled Expo requests as transient failures', async () => {
    await expect(
      sendExpoPushMessages(
        [{ body: 'Body', title: 'Title', to: 'ExponentPushToken[token]' }],
        {
          fetchImpl: async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
            }),
          requestTimeoutMs: 1,
        },
      ),
    ).rejects.toBeInstanceOf(ExpoPushTransientError)
  })

  test('times out a stalled Expo response body as a transient failure', async () => {
    let stalledBody: ReturnType<typeof createStalledJsonResponse> | undefined
    const request = sendExpoPushMessages(
      [{ body: 'Body', title: 'Title', to: 'ExponentPushToken[token]' }],
      {
        fetchImpl: async (_input, init) => {
          stalledBody = createStalledJsonResponse(init?.signal)
          return stalledBody.response
        },
        requestTimeoutMs: 5,
      },
    )
    const settled = observeSettlement(request)

    try {
      await stalledBody?.bodyStarted
      const outcome = await Promise.race([
        settled,
        delay(250).then(() => ({ status: 'stalled' }) as const),
      ])

      expect(outcome.status).toBe('rejected')
      if (outcome.status === 'rejected') {
        expect(outcome.error).toBeInstanceOf(ExpoPushTransientError)
      }
    } finally {
      stalledBody?.cleanup()
      await settled
    }
  })

  test('cancels an active Expo request when the worker aborts', async () => {
    const controller = new AbortController()
    const request = sendExpoPushMessages(
      [{ body: 'Body', title: 'Title', to: 'ExponentPushToken[token]' }],
      {
        fetchImpl: async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('worker aborted')))
            controller.abort()
          }),
        requestTimeoutMs: 30_000,
        signal: controller.signal,
      },
    )

    await expect(request).rejects.toBeInstanceOf(ExpoPushTransientError)
  })

  test('cancels a stalled Expo response body when the worker aborts', async () => {
    const controller = new AbortController()
    let stalledBody: ReturnType<typeof createStalledJsonResponse> | undefined
    const request = sendExpoPushMessages(
      [{ body: 'Body', title: 'Title', to: 'ExponentPushToken[token]' }],
      {
        fetchImpl: async (_input, init) => {
          stalledBody = createStalledJsonResponse(init?.signal)
          return stalledBody.response
        },
        requestTimeoutMs: 30_000,
        signal: controller.signal,
      },
    )
    const settled = observeSettlement(request)

    try {
      await stalledBody?.bodyStarted
      controller.abort()
      const outcome = await Promise.race([
        settled,
        delay(250).then(() => ({ status: 'stalled' }) as const),
      ])

      expect(outcome.status).toBe('rejected')
      if (outcome.status === 'rejected') {
        expect(outcome.error).toBeInstanceOf(ExpoPushTransientError)
      }
    } finally {
      stalledBody?.cleanup()
      await settled
    }
  })

  test('cleans request timers and caller abort listeners after every completion path', async () => {
    const fetchOutcomes = [
      () => json({ data: [{ id: 'ticket-1', status: 'ok' }] }),
      () => new Response('not json', { status: 200 }),
      () => new Response('{}', { status: 400, statusText: 'Bad Request' }),
      () => {
        throw new Error('network failed')
      },
    ]

    for (const fetchOutcome of fetchOutcomes) {
      const callerController = new AbortController()
      let requestSignal: AbortSignal | null | undefined
      const request = sendExpoPushMessages(
        [{ body: 'Body', title: 'Title', to: 'ExponentPushToken[token]' }],
        {
          fetchImpl: async (_input, init) => {
            requestSignal = init?.signal
            return fetchOutcome()
          },
          requestTimeoutMs: 5,
          signal: callerController.signal,
        },
      )

      await request.catch(() => undefined)
      await delay(20)
      expect(requestSignal?.aborted).toBe(false)

      callerController.abort()
      expect(requestSignal?.aborted).toBe(false)
    }
  })

  test('reads receipts and exposes DeviceNotRegistered errors', async () => {
    const receipts = await getExpoPushReceipts(['ticket-1', 'ticket-2'], {
      fetchImpl: async (_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ ids: ['ticket-1', 'ticket-2'] })
        return json({
          data: {
            'ticket-1': { status: 'ok' },
            'ticket-2': {
              details: { error: 'DeviceNotRegistered' },
              message: 'The device cannot receive notifications',
              status: 'error',
            },
          },
        })
      },
    })

    expect(receipts['ticket-1']?.status).toBe('ok')
    expect(isDeviceNotRegisteredError(receipts['ticket-2']!)).toBe(true)
  })

  test('rejects malformed successful Expo responses as transient provider failures', async () => {
    await expect(
      sendExpoPushMessages(
        [{ body: 'Body', title: 'Title', to: 'ExponentPushToken[token]' }],
        {
          fetchImpl: async () => json({ data: [{ status: 'ok' }] }),
        },
      ),
    ).rejects.toBeInstanceOf(ExpoPushTransientError)

    await expect(
      getExpoPushReceipts(['ticket-1'], {
        fetchImpl: async () => json({ data: { 'ticket-1': { status: 'surprise' } } }),
      }),
    ).rejects.toBeInstanceOf(ExpoPushTransientError)
  })
})

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
  })
}

function createStalledJsonResponse(signal?: AbortSignal | null) {
  let abortBody: (() => void) | undefined
  let rejectBody: ((error: Error) => void) | undefined
  let resolveBodyStarted: (() => void) | undefined
  const bodyStarted = new Promise<void>((resolve) => {
    resolveBodyStarted = resolve
  })

  const response = {
    json: () => {
      resolveBodyStarted?.()
      return new Promise<unknown>((_resolve, reject) => {
        rejectBody = reject
        abortBody = () => reject(new Error('response body aborted'))
        if (signal?.aborted) abortBody()
        else signal?.addEventListener('abort', abortBody, { once: true })
      })
    },
    ok: true,
    status: 200,
    statusText: 'OK',
  } as Response

  return {
    bodyStarted,
    cleanup: () => {
      if (abortBody) signal?.removeEventListener('abort', abortBody)
      rejectBody?.(new Error('test cleanup'))
    },
    response,
  }
}

function observeSettlement<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }) as const,
    (error: unknown) => ({ error, status: 'rejected' }) as const,
  )
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
