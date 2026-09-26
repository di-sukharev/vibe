import { describe, expect, test } from 'bun:test'

import { EmailDeliveryError, type EmailDelivery, type EmailMessage } from '../../../email'
import { TerminalTaskError } from '../../../outbox'
import { createPasswordResetNotifier } from './password-reset-notifier'

const signal = new AbortController().signal

function notifierThatFailsWith(error: unknown) {
  const delivery: EmailDelivery = {
    driver: 'resend',
    configured: true,
    send: async () => {
      throw error
    },
  }

  return createPasswordResetNotifier(delivery, 'https://app.example.com')
}

function capturingNotifier() {
  const sent: EmailMessage[] = []
  const delivery: EmailDelivery = {
    driver: 'console',
    configured: true,
    send: async (message) => void sent.push(message),
  }

  return { notifier: createPasswordResetNotifier(delivery, 'https://app.example.com'), sent }
}

describe('createPasswordResetNotifier', () => {
  test('puts the token in the URL fragment, which browsers never send to a server', async () => {
    const { notifier, sent } = capturingNotifier()

    await notifier.sendPasswordReset(
      { email: 'user@example.com', token: 'reset-token', expiresAt: new Date('2026-01-01T00:30:00.000Z') },
      signal,
    )

    const link = sent[0]!.text.split('\n\n').find((part) => part.startsWith('http'))
    expect(link).toBe('https://app.example.com/reset-password#token=reset-token')
  })

  test('a permanent provider rejection becomes terminal, so the drain stops retrying it', async () => {
    // Five attempts at an address the provider will never accept is five identical failures and
    // a reset token left alive between each one.
    const notifier = notifierThatFailsWith(
      new EmailDeliveryError('permanent', 'Resend rejected the message with 422 (invalid_from_address)'),
    )

    const error = await notifier
      .sendPasswordReset(
        { email: 'user@example.com', token: 't', expiresAt: new Date() },
        signal,
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      )

    expect(error).toBeInstanceOf(TerminalTaskError)
    expect((error as TerminalTaskError).cause).toBeInstanceOf(EmailDeliveryError)
    expect(notifier.isPermanentFailure(error)).toBe(true)
  })

  test('what reaches task_outbox.last_error still names the status and the provider code', async () => {
    // The drain persists `error.message` alone and never walks `.cause`, so anything left only on
    // the cause is lost. These rows stay `failed` forever with a blanked payload - they are the
    // only thing an operator has left, and "rejected permanently" alone cannot tell an unverified
    // domain from a revoked key.
    const notifier = notifierThatFailsWith(
      new EmailDeliveryError('permanent', 'Resend rejected the message with 422 (invalid_from_address)'),
    )

    const error = await notifier
      .sendPasswordReset({ email: 'user@example.com', token: 't', expiresAt: new Date() }, signal)
      .then(
        () => null,
        (thrown: unknown) => thrown,
      )

    const persisted = (error as Error).message
    expect(persisted).toContain('422')
    expect(persisted).toContain('invalid_from_address')
    // And still nothing about the recipient, which is the reason the payload is blanked at all.
    expect(persisted).not.toContain('user@example.com')
  })

  test('transient and non-email failures pass through untouched, so the drain retries them', async () => {
    // A bug in our own code must not look like "this address can never receive mail".
    for (const original of [
      new EmailDeliveryError('transient', 'Resend rejected the message with 429 (rate_limit_exceeded)'),
      new TypeError('undefined is not a function'),
    ]) {
      const notifier = notifierThatFailsWith(original)

      const error = await notifier
        .sendPasswordChanged({ email: 'user@example.com' }, signal)
        .then(
          () => null,
          (thrown: unknown) => thrown,
        )

      expect(error).toBe(original)
      expect(notifier.isPermanentFailure(error)).toBe(false)
    }
  })
})
