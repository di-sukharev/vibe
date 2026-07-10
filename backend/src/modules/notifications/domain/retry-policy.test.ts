import { describe, expect, test } from 'bun:test'

import {
  initialReceiptCheckAt,
  isReceiptCheckTerminal,
  isRetryableProviderError,
  nextReceiptCheckAt,
  outboxRetryAt,
  shouldRetryOutbox,
} from './retry-policy'

const now = new Date('2026-07-10T12:00:00.000Z')

describe('notification retry policy', () => {
  test('uses bounded exponential outbox retry decisions', () => {
    expect(shouldRetryOutbox(2)).toBe(true)
    expect(shouldRetryOutbox(3)).toBe(false)
    expect(outboxRetryAt(1, now).toISOString()).toBe('2026-07-10T12:02:00.000Z')
    expect(outboxRetryAt(2, now).toISOString()).toBe('2026-07-10T12:04:00.000Z')
  })

  test('schedules receipt checks and caps receipt retry delay', () => {
    expect(initialReceiptCheckAt(now).toISOString()).toBe('2026-07-10T12:00:15.000Z')
    expect(nextReceiptCheckAt(20, now).toISOString()).toBe('2026-07-10T14:00:00.000Z')
    expect(isReceiptCheckTerminal(7)).toBe(false)
    expect(isReceiptCheckTerminal(8)).toBe(true)
  })

  test('classifies only retryable Expo provider codes', () => {
    expect(isRetryableProviderError('MessageRateExceeded')).toBe(true)
    expect(isRetryableProviderError('DeviceNotRegistered')).toBe(false)
  })
})
