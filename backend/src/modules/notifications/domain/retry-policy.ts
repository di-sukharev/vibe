const baseOutboxRetryDelayMs = 2 * 60 * 1000
const initialReceiptCheckDelayMs = 15_000
const baseReceiptRetryDelayMs = 2 * 60 * 1000
const maxReceiptRetryDelayMs = 2 * 60 * 60 * 1000
const maxOutboxAttempts = 3
const maxReceiptAttempts = 8
const retryableProviderCodes = new Set(['MessageRateExceeded'])

export function shouldRetryOutbox(nextAttempts: number) {
  return nextAttempts < maxOutboxAttempts
}

export function isReceiptCheckTerminal(nextAttempts: number) {
  return nextAttempts >= maxReceiptAttempts
}

export function outboxRetryAt(attempts: number, now: Date) {
  return new Date(
    now.getTime() + baseOutboxRetryDelayMs * 2 ** Math.max(attempts - 1, 0),
  )
}

export function initialReceiptCheckAt(now: Date) {
  return new Date(now.getTime() + initialReceiptCheckDelayMs)
}

export function nextReceiptCheckAt(attempts: number, now: Date) {
  return new Date(
    now.getTime() +
      Math.min(
        baseReceiptRetryDelayMs * 2 ** Math.max(attempts - 1, 0),
        maxReceiptRetryDelayMs,
      ),
  )
}

export function isRetryableProviderError(errorCode: string | undefined) {
  return Boolean(errorCode && retryableProviderCodes.has(errorCode))
}
