import { expect, test } from 'bun:test'

import { shutdownBackend, stopServerGracefully } from './shutdown'

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
