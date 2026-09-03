import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  currentBrowserSessionEpoch,
  publishBrowserSessionState,
  subscribeToBrowserSessionChanges,
} from '../src/features/auth/session-coordinator'

// Mirrors the module's private localStorage key so a simulated "other tab" write
// lands in the same slot this tab's storage listener actually watches.
const sessionEventStorageKey = 'web_app_demo:auth-session-event'

let fakeWindow: EventTarget

beforeEach(() => {
  fakeWindow = new EventTarget()
  globalThis.window = fakeWindow as unknown as Window & typeof globalThis
  globalThis.localStorage = fakeLocalStorage() as unknown as Storage
})

afterEach(() => {
  // @ts-expect-error test-only teardown: these globals do not exist outside a browser
  delete globalThis.window
  // @ts-expect-error test-only teardown: these globals do not exist outside a browser
  delete globalThis.localStorage
})

test('a same-key storage write from another tab notifies subscribers and updates the local epoch; other keys are ignored', () => {
  const received: Array<{ epoch: string; state: string }> = []
  const unsubscribe = subscribeToBrowserSessionChanges((event) => received.push(event))

  fakeWindow.dispatchEvent(
    storageEvent('some-unrelated-key', JSON.stringify({ epoch: 'x', state: 'cleared' })),
  )
  expect(received).toHaveLength(0)

  fakeWindow.dispatchEvent(
    storageEvent(sessionEventStorageKey, JSON.stringify({ epoch: 'tab-b-epoch', state: 'cleared' })),
  )
  expect(received).toEqual([{ epoch: 'tab-b-epoch', state: 'cleared' }])
  expect(currentBrowserSessionEpoch()).toBe('tab-b-epoch')

  unsubscribe()
  fakeWindow.dispatchEvent(
    storageEvent(sessionEventStorageKey, JSON.stringify({ epoch: 'tab-c-epoch', state: 'authenticated' })),
  )
  expect(received).toHaveLength(1)
})

test('a corrupted stored session event is ignored rather than thrown, both on direct read and on a cross-tab notification', () => {
  const knownGoodEvent = publishBrowserSessionState('authenticated')
  expect(currentBrowserSessionEpoch()).toBe(knownGoodEvent.epoch)

  localStorage.setItem(sessionEventStorageKey, '{not json')
  expect(currentBrowserSessionEpoch()).toBe(knownGoodEvent.epoch)

  const received: unknown[] = []
  subscribeToBrowserSessionChanges((event) => received.push(event))

  expect(() =>
    fakeWindow.dispatchEvent(storageEvent(sessionEventStorageKey, '{not json')),
  ).not.toThrow()
  expect(received).toHaveLength(0)
  expect(currentBrowserSessionEpoch()).toBe(knownGoodEvent.epoch)
})

test('a well-formed but invalid-shape stored event (bad state, non-string epoch) is ignored, on read and on notification', () => {
  const knownGoodEvent = publishBrowserSessionState('cleared')

  for (const malformed of [
    JSON.stringify({ epoch: 'e', state: 'logged-out' }),
    JSON.stringify({ epoch: 1, state: 'cleared' }),
  ]) {
    localStorage.setItem(sessionEventStorageKey, malformed)
    expect(currentBrowserSessionEpoch()).toBe(knownGoodEvent.epoch)
  }

  const received: unknown[] = []
  subscribeToBrowserSessionChanges((event) => received.push(event))
  fakeWindow.dispatchEvent(
    storageEvent(sessionEventStorageKey, JSON.stringify({ epoch: 'e', state: 'logged-out' })),
  )
  expect(received).toHaveLength(0)
  expect(currentBrowserSessionEpoch()).toBe(knownGoodEvent.epoch)
})

function fakeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

function storageEvent(key: string, newValue: string | null) {
  return Object.assign(new Event('storage'), { key, newValue })
}
