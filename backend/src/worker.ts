import { createBackgroundRuntime, type BackendRuntime } from './runtime'
import { createNotificationsModule } from './modules/notifications'

type WorkerMode = 'notifications' | 'noop'
type WorkerSignal = 'SIGINT' | 'SIGTERM'
type WorkerSignalSource = {
  off(signal: WorkerSignal, listener: () => void): unknown
  once(signal: WorkerSignal, listener: () => void): unknown
}

type WorkerLogger = Pick<Console, 'error' | 'log'>

const defaultWorkerHeartbeatIntervalMs = 5 * 60 * 1_000

export async function runWorker(
  runtime: BackendRuntime,
  mode: WorkerMode = 'noop',
  options: { signal?: AbortSignal } = {},
) {
  if (mode === 'notifications') {
    await runNotificationsWorker(runtime, options)
    return
  }

  console.log('Backend worker entrypoint initialized; no background handlers are registered yet.')
}

export async function runNotificationsWorker(
  runtime: BackendRuntime,
  options: {
    heartbeatIntervalMs?: number
    logger?: WorkerLogger
    notifications?: Pick<
      ReturnType<typeof createNotificationsModule>,
      'checkReceipts' | 'processOutbox'
    >
    now?: () => number
    pollIntervalMs?: number
    signal?: AbortSignal
  } = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? defaultWorkerHeartbeatIntervalMs
  const logger = options.logger ?? console
  const now = options.now ?? Date.now
  const notifications =
    options.notifications ??
    createNotificationsModule({
      db: runtime.prisma,
      env: runtime.env,
    })
  const shutdownBudgetMs = Math.max(1, runtime.env.SHUTDOWN_GRACE_SECONDS * 1_000 - 5_000)
  const processMaxRuntimeMs = Math.min(
    runtime.env.PUSH_OUTBOX_PROCESS_MAX_RUNTIME_MS ?? shutdownBudgetMs,
    shutdownBudgetMs,
  )
  let lastHeartbeatAt = now()
  logger.log(`Notification worker started; polling every ${pollIntervalMs}ms.`)

  while (!options.signal?.aborted) {
    const outbox = await notifications
      .processOutbox({ maxRuntimeMs: processMaxRuntimeMs, signal: options.signal })
      .catch((error: unknown) => {
        if (!options.signal?.aborted) {
          logger.error('[NotificationWorker] processPushOutbox failed:', error)
        }
        return null
      })
    if (options.signal?.aborted) break

    const receipts = await notifications
      .checkReceipts({ signal: options.signal })
      .catch((error: unknown) => {
        if (!options.signal?.aborted) {
          logger.error('[NotificationWorker] checkPushReceipts failed:', error)
        }
        return null
      })

    if (options.signal?.aborted) break

    const currentTime = now()
    if (hasNotificationActivity(outbox, receipts)) {
      logger.log('[NotificationWorker] activity', { outbox, receipts })
      lastHeartbeatAt = currentTime
    } else {
      if (currentTime - lastHeartbeatAt >= heartbeatIntervalMs) {
        logger.log('[NotificationWorker] heartbeat')
        lastHeartbeatAt = currentTime
      }
    }

    await delay(pollIntervalMs, options.signal)
  }
}

export async function main(argv: string[] = Bun.argv.slice(2)) {
  const runtime = createBackgroundRuntime()
  const mode = argv[0] === 'notifications' ? 'notifications' : 'noop'
  const shutdown = listenForWorkerShutdown()

  try {
    await runWorker(runtime, mode, { signal: shutdown.signal })
  } finally {
    shutdown.dispose()
    await runtime.close()
  }
}

export function listenForWorkerShutdown(source: WorkerSignalSource = process) {
  const controller = new AbortController()
  const abort = () => controller.abort()

  source.once('SIGINT', abort)
  source.once('SIGTERM', abort)

  return {
    signal: controller.signal,
    dispose() {
      source.off('SIGINT', abort)
      source.off('SIGTERM', abort)
    },
  }
}

if (import.meta.main) {
  await main()
}

function delay(ms: number, signal: AbortSignal | undefined) {
  if (signal?.aborted) return Promise.resolve()

  return new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>
    const finish = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    timeout = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

function hasNotificationActivity(
  outbox: Awaited<ReturnType<ReturnType<typeof createNotificationsModule>['processOutbox']>> | null,
  receipts: Awaited<ReturnType<ReturnType<typeof createNotificationsModule>['checkReceipts']>> | null,
) {
  return (
    (outbox != null && Object.values(outbox).some((value) => value > 0)) ||
    (receipts != null && Object.values(receipts).some((value) => value > 0))
  )
}
