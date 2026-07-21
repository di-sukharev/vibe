export type TaskDeferrer = {
  defer(task: (signal: AbortSignal) => Promise<void>): void
}

export type BackgroundTasks = TaskDeferrer & {
  drain(timeoutMs?: number): Promise<boolean>
}

export function createBackgroundTasks({
  onError = (error: unknown) => console.error('Background task failed', error),
  taskTimeoutMs = 20_000,
}: {
  onError?: (error: unknown) => void
  taskTimeoutMs?: number
} = {}): BackgroundTasks {
  const pending = new Set<Promise<void>>()
  const controllers = new Set<AbortController>()
  const report = (error: unknown) => {
    try {
      onError(error)
    } catch {
      // Error reporting must not create an unhandled rejection or detach task cleanup.
    }
  }

  return {
    defer(task) {
      const controller = new AbortController()
      let pendingTask: Promise<void>
      pendingTask = new Promise<void>((resolve) => {
        setTimeout(() => {
          const taskTimeout = setTimeout(() => {
            controller.abort()
            report(new Error(`Background task exceeded ${taskTimeoutMs}ms deadline`))
          }, taskTimeoutMs)
          const execution = Promise.resolve().then(() => task(controller.signal))
          void execution
            .catch(report)
            .finally(() => {
              clearTimeout(taskTimeout)
              resolve()
            })
        }, 0)
      })
      pending.add(pendingTask)
      controllers.add(controller)
      void pendingTask.finally(() => {
        pending.delete(pendingTask)
        controllers.delete(controller)
      })
    },
    async drain(timeoutMs) {
      const drainAll = async () => {
        while (pending.size > 0) {
          await Promise.all([...pending])
        }
        return true
      }

      if (timeoutMs === undefined) return drainAll()

      let drainTimeout: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<false>((resolve) => {
        drainTimeout = setTimeout(() => {
          for (const controller of controllers) controller.abort()
          resolve(false)
        }, timeoutMs)
      })
      const drained = await Promise.race([drainAll(), timedOut])
      if (drainTimeout) clearTimeout(drainTimeout)
      return drained
    },
  }
}
