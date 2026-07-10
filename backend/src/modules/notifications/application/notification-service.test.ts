import { describe, expect, test } from 'bun:test'

import type { NotificationServiceDependencies } from './ports'
import { NotificationService } from './notification-service'

const createDependencies = () => {
  const calls: Array<{ name: string; value: unknown }> = []
  const dependencies: NotificationServiceDependencies = {
    createDedupeId: () => 'dedupe-id',
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
      register: async () => undefined,
      unregister: async () => undefined,
    },
  }

  return { calls, dependencies }
}

describe('NotificationService', () => {
  test('owns test-push enqueue and immediate processing orchestration', async () => {
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
          dedupeKey: 'test-push:user-id:dedupe-id',
          title: 'Test notification',
          userId: 'user-id',
        },
      },
      {
        name: 'process',
        value: { maxLoops: 1, onlyIds: ['outbox-id'] },
      },
    ])
  })
})
