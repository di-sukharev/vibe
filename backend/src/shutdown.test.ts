import { expect, test } from 'bun:test'

import { createSignalShutdown, shutdownBackend, stopServerGracefully } from './shutdown'

test('stopServerGracefully lets in-flight work finish before forcing shutdown', async () => {
  const calls: boolean[] = []
  const server = {
    stop: async (force?: boolean) => {
      calls.push(Boolean(force))
    },
  }

  await stopServerGracefully(server, 100)
  expect(calls).toEqual([false])
})

test('stopServerGracefully force closes only after the grace period', async () => {
  const calls: boolean[] = []
  const server = {
    stop: async (force?: boolean) => {
      calls.push(Boolean(force))
      if (!force) await new Promise(() => undefined)
    },
  }

  await stopServerGracefully(server, 1)
  expect(calls).toEqual([false, true])
})

test('shutdownBackend gives background cleanup only the remaining shared grace period', async () => {
  let now = 1_000
  let backgroundGrace: number | undefined
  const server = {
    stop: async () => {
      now += 70
    },
  }
  const runtime = {
    close: async (timeoutMs?: number) => {
      backgroundGrace = timeoutMs
    },
  }

  await shutdownBackend(server, runtime, 100, () => now)

  expect(backgroundGrace).toBe(30)
})

test('createSignalShutdown runs the shutdown once no matter how many signals arrive', async () => {
  const signals: string[] = []
  const exits: number[] = []
  const handle = createSignalShutdown(
    async (signal) => {
      signals.push(signal)
    },
    { exit: (code) => exits.push(code), log: () => undefined },
  )

  handle('SIGTERM')
  handle('SIGINT')
  await settle()

  expect(signals).toEqual(['SIGTERM'])
  expect(exits).toEqual([])
})

test('createSignalShutdown reports a failed shutdown and exits non-zero', async () => {
  const logged: Array<[string, unknown]> = []
  const exits: number[] = []
  const failure = new Error('closing the database pool failed')
  const handle = createSignalShutdown(
    async () => {
      throw failure
    },
    { exit: (code) => exits.push(code), log: (message, error) => logged.push([message, error]) },
  )

  handle('SIGTERM')
  await settle()

  expect(logged).toEqual([['Shutdown after SIGTERM failed.', failure]])
  expect(exits).toEqual([1])
})

test('createSignalShutdown keeps a failed shutdown out of the unhandled rejection path', async () => {
  const handle = createSignalShutdown(
    async () => {
      throw new Error('closing the database pool failed')
    },
    { exit: () => undefined, log: () => undefined },
  )

  handle('SIGTERM')
  // An escaped rejection from the shutdown fails this test on its own once the loop turns.
  await settle()
})

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 10))
}
