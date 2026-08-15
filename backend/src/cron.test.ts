import { expect, spyOn, test } from 'bun:test'

import { handleProviderJobInvocation, runOneShotJob } from './cron'
import type { BackendRuntime } from './runtime'

function runtimeWithLock(acquired: boolean) {
  const calls = { closes: 0, jobs: 0, transactionTimeouts: [] as number[] }
  const runtime = {
    close: async () => {
      calls.closes += 1
    },
    prisma: {
      $transaction: async (
        run: (tx: unknown) => Promise<unknown>,
        options: { timeout: number },
      ) => {
        calls.transactionTimeouts.push(options.timeout)
        return run({ $queryRaw: async () => [{ acquired }] })
      },
      $queryRaw: async () => {
        calls.jobs += 1
        return [{ '?column?': 1 }]
      },
    },
  } as unknown as BackendRuntime

  return { calls, runtime }
}

test('the provider one-shot path uses the declared advisory-lock timeout', async () => {
  const { calls, runtime } = runtimeWithLock(true)
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    await runOneShotJob(runtime, 'db:ping', [
      { expression: '* * * * *', job: 'db:ping', timeoutMs: 42_000 },
    ])

    expect(calls).toEqual({
      closes: 0,
      jobs: 1,
      transactionTimeouts: [42_000],
    })
  } finally {
    log.mockRestore()
  }
})

test('the provider one-shot path skips work while another runner owns the lock', async () => {
  const { calls, runtime } = runtimeWithLock(false)
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    await runOneShotJob(runtime, 'db:ping')

    expect(calls.jobs).toBe(0)
    expect(log).toHaveBeenCalledWith(
      'Scheduler skipped db:ping: its lock is held elsewhere.',
    )
  } finally {
    log.mockRestore()
  }
})

test('the reusable one-shot path rejects when a job fails', async () => {
  const runtime = {
    prisma: {
      $transaction: async () => {
        throw new Error('database is unreachable')
      },
    },
  } as unknown as BackendRuntime

  await expect(runOneShotJob(runtime, 'db:ping')).rejects.toThrow(
    'database is unreachable',
  )
})

test('the provider HTTP path exposes success and closes its request runtime', async () => {
  const { calls, runtime } = runtimeWithLock(true)
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    const response = await handleProviderJobInvocation(
      'db:ping',
      () => runtime,
      [{ expression: '* * * * *', job: 'db:ping', timeoutMs: 42_000 }],
    )

    expect(response.status).toBe(204)
    expect(calls).toEqual({
      closes: 1,
      jobs: 1,
      transactionTimeouts: [42_000],
    })
  } finally {
    log.mockRestore()
  }
})

test('the provider HTTP path returns non-2xx when a job fails', async () => {
  let closes = 0
  const runtime = {
    close: async () => {
      closes += 1
    },
    prisma: {
      $transaction: async () => {
        throw new Error('database is unreachable')
      },
    },
  } as unknown as BackendRuntime
  const error = spyOn(console, 'error').mockImplementation(() => {})

  try {
    const response = await handleProviderJobInvocation('db:ping', () => runtime)

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('Background job failed')
    expect(closes).toBe(1)
    expect(error).toHaveBeenCalled()
  } finally {
    error.mockRestore()
  }
})
