import { expect, test } from 'bun:test'

import { createBackgroundTasks } from './background-tasks'

test('background tasks start after the caller returns and drain before shutdown', async () => {
  const events: string[] = []
  const backgroundTasks = createBackgroundTasks()

  backgroundTasks.defer(async () => {
    events.push('task')
  })
  events.push('response')

  expect(events).toEqual(['response'])
  expect(await backgroundTasks.drain()).toBe(true)
  expect(events).toEqual(['response', 'task'])
})

test('background task failures are reported without rejecting the drain', async () => {
  const errors: unknown[] = []
  const backgroundTasks = createBackgroundTasks({
    onError: (error) => errors.push(error),
  })
  const failure = new Error('delivery failed')

  backgroundTasks.defer(async () => {
    throw failure
  })

  await expect(backgroundTasks.drain()).resolves.toBe(true)
  expect(errors).toEqual([failure])
})

test('task timeout keeps abort cleanup tracked until it actually settles', async () => {
  const errors: unknown[] = []
  let cleanupCompleted = false
  const backgroundTasks = createBackgroundTasks({
    onError: (error) => errors.push(error),
    taskTimeoutMs: 5,
  })

  backgroundTasks.defer(async (signal) => {
    try {
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('provider aborted'))
          return
        }
        signal.addEventListener('abort', () => reject(new Error('provider aborted')), {
          once: true,
        })
      })
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      cleanupCompleted = true
      throw error
    }
  })

  await expect(backgroundTasks.drain()).resolves.toBe(true)
  expect(cleanupCompleted).toBe(true)
  expect(errors).toHaveLength(2)
  expect(String(errors[0])).toContain('exceeded 5ms deadline')
  expect(String(errors[1])).toContain('provider aborted')
})

test('bounded drain aborts pending work instead of blocking shutdown', async () => {
  let aborted = false
  const backgroundTasks = createBackgroundTasks({ taskTimeoutMs: 1_000 })
  backgroundTasks.defer(async (signal) => {
    if (signal.aborted) {
      aborted = true
      return
    }
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => {
        aborted = true
        resolve()
      }, { once: true })
    })
  })

  await expect(backgroundTasks.drain(5)).resolves.toBe(false)
  expect(aborted).toBe(true)
  await expect(backgroundTasks.drain()).resolves.toBe(true)
})
