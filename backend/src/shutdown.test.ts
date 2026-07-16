import { expect, test } from 'bun:test'

import { stopServerGracefully } from './shutdown'

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
