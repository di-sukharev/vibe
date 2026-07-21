import { expect, test } from 'bun:test'

import { createBackgroundTasks } from './background-tasks'
import { closeBackendRuntime } from './runtime'

test('runtime close lets accepted work use the remaining grace period before disconnecting', async () => {
  const events: string[] = []
  const backgroundTasks = createBackgroundTasks({ taskTimeoutMs: 1_000 })
  backgroundTasks.defer(async (signal) => {
    expect(signal.aborted).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(signal.aborted).toBe(false)
    events.push('delivered')
  })

  await closeBackendRuntime(
    {
      backgroundTasks,
      prisma: {
        $disconnect: async () => {
          events.push('disconnected')
        },
      },
    },
    100,
  )

  expect(events).toEqual(['delivered', 'disconnected'])
})
