type StoppableServer = {
  stop(force?: boolean): Promise<void>
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
