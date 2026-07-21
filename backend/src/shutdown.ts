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
