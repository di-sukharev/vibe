import { expect, test } from 'bun:test'

import { createReadinessProbe } from './readiness'

function createHarness({ windowMs = 1_000 }: { windowMs?: number } = {}) {
  let now = 1_000
  let checks = 0
  let outcome: 'ok' | 'down' = 'ok'
  let release: (() => void) | null = null
  const probe = createReadinessProbe({
    check: () => new Promise<void>((resolve, reject) => {
      checks += 1
      release = () => (outcome === 'ok' ? resolve() : reject(new Error('down')))
    }),
    now: () => now,
    windowMs,
  })

  return {
    advance: (ms: number) => {
      now += ms
    },
    get checks() {
      return checks
    },
    probe,
    release: () => {
      if (!release) throw new Error('no check in flight')
      const settle = release
      release = null
      settle()
    },
    setOutcome: (next: 'ok' | 'down') => {
      outcome = next
    },
  }
}

test('overlapping callers share one check and its result answers for the window', async () => {
  const harness = createHarness({ windowMs: 1_000 })

  const overlapping = Promise.all([harness.probe(), harness.probe(), harness.probe()])
  expect(harness.checks).toBe(1)
  harness.release()
  expect(await overlapping).toEqual([true, true, true])

  harness.advance(999)
  expect(await harness.probe()).toBe(true)
  expect(harness.checks).toBe(1)

  harness.advance(1)
  const fresh = harness.probe()
  expect(harness.checks).toBe(2)
  harness.release()
  expect(await fresh).toBe(true)
})

test('a failed check reports not ready and is not retried inside the window', async () => {
  const harness = createHarness({ windowMs: 1_000 })
  harness.setOutcome('down')

  const overlapping = Promise.all([harness.probe(), harness.probe()])
  harness.release()
  expect(await overlapping).toEqual([false, false])
  expect(harness.checks).toBe(1)

  harness.advance(500)
  expect(await harness.probe()).toBe(false)
  expect(harness.checks).toBe(1)

  // Recovery is observed by the first check after the window, not by the cached failure.
  harness.setOutcome('ok')
  harness.advance(500)
  const recovered = harness.probe()
  expect(harness.checks).toBe(2)
  harness.release()
  expect(await recovered).toBe(true)
})

test('the window starts when the check settles, not when it started', async () => {
  const harness = createHarness({ windowMs: 1_000 })

  const slow = harness.probe()
  harness.advance(5_000)
  harness.release()
  expect(await slow).toBe(true)

  // Even though the check ran for longer than the window, its answer is fresh once it lands.
  harness.advance(999)
  expect(await harness.probe()).toBe(true)
  expect(harness.checks).toBe(1)
})

test('a check that throws synchronously counts as not ready instead of escaping', async () => {
  const probe = createReadinessProbe({
    check: () => {
      throw new Error('client not initialised')
    },
    windowMs: 1_000,
  })

  expect(await probe()).toBe(false)
})
