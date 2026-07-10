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
})

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
  })
}
