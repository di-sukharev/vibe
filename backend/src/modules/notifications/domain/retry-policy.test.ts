import { describe, expect, test } from 'bun:test'

import {
  isReceiptCheckTerminal,
  nextReceiptCheckAt,
  outboxRetryAt,
  shouldRetryOutbox,
} from './retry-policy'

const now = new Date('2026-07-10T12:00:00.000Z')

// The first receipt check delay and the provider codes that requeue a send are asserted through
// the outbox in `notifications.integration.test.ts`.
describe('notification retry policy', () => {
  test('uses bounded exponential outbox retry decisions', () => {
    expect(shouldRetryOutbox(2)).toBe(true)
    expect(shouldRetryOutbox(3)).toBe(false)
    expect(outboxRetryAt(1, now).toISOString()).toBe('2026-07-10T12:02:00.000Z')
    expect(outboxRetryAt(2, now).toISOString()).toBe('2026-07-10T12:04:00.000Z')
  })

  test('caps receipt retry delay and bounds receipt checks', () => {
    expect(nextReceiptCheckAt(20, now).toISOString()).toBe('2026-07-10T14:00:00.000Z')
    expect(isReceiptCheckTerminal(7)).toBe(false)
    expect(isReceiptCheckTerminal(8)).toBe(true)
  })
})
