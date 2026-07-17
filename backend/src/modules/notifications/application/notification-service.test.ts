import { describe, expect, test } from 'bun:test'

import type { NotificationServiceDependencies } from './ports'
import { NotificationService } from './notification-service'

const createDependencies = () => {
  const calls: Array<{ name: string; value: unknown }> = []
  const dependencies: NotificationServiceDependencies = {
    now: () => new Date('2026-07-17T03:14:30.000Z'),
    outbox: {
      enqueue: async (input) => {
        calls.push({ name: 'enqueue', value: input })
        return { created: true, id: 'outbox-id' }
      },
      process: async (options) => {
        calls.push({ name: 'process', value: options })
        return {
          failed: 0,
          loops: 1,
          pendingCount: 0,
          processed: 1,
          requeuedStale: 0,
          sent: 1,
          skipped: 0,
          transientFailed: 0,
        }
      },
      redactTerminalData: async (options) => {
        calls.push({ name: 'redact-terminal-data', value: options })
        return 2
      },
    },
    receipts: {
      check: async () => ({
        checked: 0,
        delivered: 0,
        failed: 0,
        tokensDisabled: 0,
      }),
    },
    tokens: {
      cleanup: async () => undefined,
      hasActive: async () => true,
      register: async () => 'applied',
      unregister: async () => 'applied',
    },
  }

  return { calls, dependencies }
}

describe('NotificationService', () => {
  test('queues test push once per durable minute bucket without running a worker in the API', async () => {
    const { calls, dependencies } = createDependencies()
    const service = new NotificationService(dependencies)

    const queued = await service.sendTestPush('user-id', {
      body: 'Open the app',
      href: '/components',
      title: 'Test notification',
    })

    expect(queued).toEqual({ created: true, id: 'outbox-id' })
    expect(calls).toEqual([
      {
        name: 'enqueue',
        value: {
          body: 'Open the app',
          data: {
            href: '/components',
            kind: 'test_push',
          },
          dedupeKey: 'test-push:29737634',
          title: 'Test notification',
          userId: 'user-id',
        },
      },
    ])
  })

  test('forwards bounded terminal-data repair to the outbox owner', async () => {
    const { calls, dependencies } = createDependencies()
    const service = new NotificationService(dependencies)

    expect(await service.redactTerminalData({ limit: 25 })).toBe(2)
    expect(calls).toEqual([
      { name: 'redact-terminal-data', value: { limit: 25 } },
    ])
  })
})
