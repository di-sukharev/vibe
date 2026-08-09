import { describe, expect, test } from 'bun:test'

import { loadEnv } from '../env'
import { drainOptionsFromEnv, enqueueTask } from './index'

const prisma = {
  taskOutbox: {
    createMany: async () => ({ count: 1 }),
    findUniqueOrThrow: async () => ({ id: 'queued' }),
  },
} as never

describe('enqueueTask', () => {
  test('refuses a type no handler can run, naming the ones that exist', async () => {
    // Without this the row is written happily and then skipped by every drain forever, while
    // the caller believes the work was accepted.
    await expect(
      enqueueTask(prisma, { dedupeKey: 'k', payload: {}, type: 'auth:password-rest' }, {
        'auth:password-reset': { run: async () => undefined },
      }),
    ).rejects.toThrow('Unknown task type "auth:password-rest". Available types: auth:password-reset')
  })

  test('queues a registered type', async () => {
    await expect(
      enqueueTask(prisma, { dedupeKey: 'k', payload: {}, type: 'test:work' }, {
        'test:work': { run: async () => undefined },
      }),
    ).resolves.toEqual({ created: true, id: 'queued' })
  })
})

describe('drainOptionsFromEnv', () => {
  test('carries every knob the environment exposes', () => {
    // Dropping one here would silently ignore an operator's setting: the drain would fall back
    // to its own default and nothing would say so.
    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      TASK_OUTBOX_BATCH_LIMIT: '7',
      TASK_OUTBOX_LEASE_STALE_MS: '90000',
      TASK_OUTBOX_MAX_RUNTIME_MS: '11000',
      TASK_OUTBOX_RETENTION_DAYS: '3',
    })

    expect(drainOptionsFromEnv(env)).toEqual({
      leaseStaleMs: 90_000,
      limit: 7,
      maxRuntimeMs: 11_000,
      retentionDays: 3,
    })
  })
})
