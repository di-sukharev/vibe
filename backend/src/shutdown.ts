type StoppableServer = {
  stop(force?: boolean): Promise<void>
}

type CloseableRuntime = {
  close(timeoutMs?: number): Promise<void>
}

export async function shutdownBackend(
  server: StoppableServer,
  runtime: CloseableRuntime,
  gracePeriodMs: number,
  now: () => number = Date.now,
) {
  const deadline = now() + gracePeriodMs
  await stopServerGracefully(server, gracePeriodMs)
  await runtime.close(Math.max(0, deadline - now()))
}

export async function stopServerGracefully(server: StoppableServer, gracePeriodMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timedOut = await Promise.race([
    server.stop().then(() => false),
    new Promise<true>((resolve) => {
      timeout = setTimeout(() => resolve(true), gracePeriodMs)
    }),
  ])

  if (timeout) clearTimeout(timeout)
  if (timedOut) await server.stop(true)
}

type SignalShutdownOptions = {
  exit?: (code: number) => void
  log?: (message: string, error: unknown) => void
}

/**
 * A signal handler cannot await. Left as a bare `void shutdown(...)`, a rejected shutdown becomes an
 * unhandled rejection that tears the process down immediately, skipping the in-flight work the
 * graceful path exists to wait for. Runs once per process and turns a failure into a reported
 * non-zero exit instead.
 */
export function createSignalShutdown(
  shutdown: (signal: string) => Promise<void>,
  { exit = (code: number) => process.exit(code), log = console.error }: SignalShutdownOptions = {},
) {
  let started = false

  return (signal: string) => {
    if (started) return
    started = true

    void shutdown(signal).catch((error: unknown) => {
      log(`Shutdown after ${signal} failed.`, error)
      exit(1)
    })
  }
}
