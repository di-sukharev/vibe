type ReadinessProbeOptions = {
  /** Resolves when the dependency answered; any rejection means "not ready". */
  check: () => Promise<unknown>
  now?: () => number
  /** How long one probe result answers for. */
  windowMs: number
}

/**
 * Turns a dependency check into a probe that costs at most one check per window, however many
 * callers ask.
 *
 * A readiness endpoint sits outside every rate limiter and answers unauthenticated GETs, so a
 * flood of probes would otherwise become a flood of database round-trips competing with real
 * requests for the connection pool. Overlapping callers share the check in flight; once it
 * settles, its outcome - success or failure alike - answers for `windowMs`, after which the next
 * caller runs a fresh check. Failures are cached too: a dependency that is down is the one case
 * where retrying on every request hurts most.
 */
export function createReadinessProbe(options: ReadinessProbeOptions): () => Promise<boolean> {
  const now = options.now ?? Date.now
  let inFlight: Promise<boolean> | null = null
  let lastResult: { ready: boolean; settledAt: number } | null = null

  return () => {
    if (lastResult && now() - lastResult.settledAt < options.windowMs) {
      return Promise.resolve(lastResult.ready)
    }
    if (inFlight) return inFlight

    inFlight = runCheck(options.check).then((ready) => {
      lastResult = { ready, settledAt: now() }
      inFlight = null
      return ready
    })
    return inFlight
  }
}

async function runCheck(check: () => Promise<unknown>) {
  try {
    await check()
    return true
  } catch {
    return false
  }
}
